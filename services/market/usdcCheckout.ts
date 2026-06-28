import { createPublicClient, encodeFunctionData, http } from "viem";

import { supabase } from "@/services/supabase";
import { callFn } from "@/services/functions";
import { requireLocalAuth } from "@/utils/secureAuth";
import { getSmartAccount } from "@/utils/aaWallet";
import { getPreferredMarketChain, MarketChainConfig } from "@/services/market/chainConfig";

const RPC_CHAIN_TX_FINALIZE_CANDIDATES = ["market_chain_tx_finalize_rpc"];
export const PI_TESTNET_CHAIN = "pi_testnet";

function isMissingRpcError(err: any) {
  const msg = String(err?.message || err || "").toLowerCase();
  return (
    msg.includes("function") && msg.includes("does not exist")
  ) || msg.includes("could not find the function") || msg.includes("pgrst202") || msg.includes("42883");
}

async function rpcWithFallback<T = any>(names: string[], params: Record<string, unknown>) {
  let lastError: any = null;
  const primary = names[0] || "";
  for (const name of names) {
    const out = await supabase.rpc(name, params as any);
    if (!out.error) {
      if (name !== primary) {
        console.log("[Checkout] RPC fallback matched", { primary, matched: name });
      }
      return { name, data: out.data as T };
    }
    lastError = out.error;
    if (!isMissingRpcError(out.error)) {
      throw new Error(out.error.message || `RPC ${name} failed`);
    }
  }
  throw new Error(lastError?.message || `No RPC candidate matched: ${names.join(", ")}`);
}

export type StableSymbol = "USDC" | "USDT";

export function isWalletMismatchError(input: unknown) {
  const msg = String((input as any)?.message ?? input ?? "").toLowerCase();
  return (
    msg.includes("wallet key mismatch") ||
    msg.includes("saved wallet exists") ||
    msg.includes("connect wallet") ||
    msg.includes("wallet connection")
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isEvmAddress(value?: string | null) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || "").trim());
}

function normalizeWalletAddress(value?: string | null) {
  return String(value || "").trim();
}

function isLikelyPiWalletAddress(value?: string | null) {
  const v = normalizeWalletAddress(value);
  return /^[A-Za-z0-9._-]{8,128}$/.test(v);
}

function isHexHash(v?: string | null) {
  return /^0x[a-fA-F0-9]{64}$/.test(String(v || "").trim());
}

function normalizeHexHash(v?: string | null) {
  const value = String(v || "").trim();
  return isHexHash(value) ? value : "";
}

async function hashLooksLikeOnchainTx(chain: MarketChainConfig, hash: string) {
  const h = normalizeHexHash(hash);
  if (!h) return false;
  const rpcUrl = String(chain.rpc_url || "").trim();
  if (!rpcUrl) return false;

  try {
    const publicClient = createPublicClient({ transport: http(rpcUrl) });
    try {
      const receipt = await publicClient.getTransactionReceipt({ hash: h as `0x${string}` });
      if (receipt) return true;
    } catch {
      // fall through
    }
    try {
      const requestAny = publicClient.request as any;
      const tx = await requestAny({
        method: "eth_getTransactionByHash" as any,
        params: [h as `0x${string}`],
      });
      if (String(tx?.hash || "").toLowerCase() === h.toLowerCase()) return true;
    } catch {
      // ignore
    }
  } catch {
    // ignore
  }

  return false;
}

async function resolveSubmittedHashes(chain: MarketChainConfig, sendResult: any) {
  const hashCandidate = normalizeHexHash(String(sendResult?.hash ?? ""));
  const txFromResult = normalizeHexHash(String(sendResult?.transactionHash ?? ""));
  const userOpFromResult = normalizeHexHash(String(sendResult?.userOpHash ?? sendResult?.userOperationHash ?? ""));

  let txHash = txFromResult;
  let userOpHash = userOpFromResult;

  if (!txHash && hashCandidate) {
    if (await hashLooksLikeOnchainTx(chain, hashCandidate)) {
      txHash = hashCandidate;
    } else {
      // `hash` from AA providers may be either tx hash or userOp hash.
      // Keep both paths available; later settling logic will resolve correctly.
      userOpHash = hashCandidate;
    }
  }

  if (!txHash && userOpHash) {
    txHash = await resolveUserOpToTxHash(chain, userOpHash, 30, 3000);
  }
  // If we still don't have txHash but have userOpHash, keep userOpHash for reindex fallback
  if (!txHash && userOpHash) {
    // Don't try to resolve again - userOpHash is already set above
  }

  return { txHash: normalizeHexHash(txHash), userOpHash: normalizeHexHash(userOpHash) };
}

type ChainFinalizeEvent = "DEPOSIT" | "RELEASE" | "REFUND";

function expectedOrderStatusForEvent(eventType: ChainFinalizeEvent) {
  if (eventType === "DEPOSIT") return "IN_ESCROW";
  if (eventType === "RELEASE") return "RELEASED";
  if (eventType === "REFUND") return "REFUNDED";
  return "";
}

async function resolveUserOpToTxHash(
  chain: MarketChainConfig,
  userOpHash: string,
  attempts = 20,
  intervalMs = 2000,
) {
  const op = String(userOpHash || "").trim();
  if (!isHexHash(op)) return "";
  const rpcUrl = String(chain.rpc_url || "").trim();
  if (!rpcUrl) return "";

  try {
    const publicClient = createPublicClient({ transport: http(rpcUrl) });
    const requestAny = publicClient.request as any;
    for (let i = 0; i < attempts; i++) {
      try {
        const receipt: any =
          (await requestAny({
            method: "eth_getUserOperationReceipt" as any,
            params: [op as `0x${string}`],
          })) ??
          (await requestAny({
            method: "alchemy_getUserOperationReceipt" as any,
            params: [op as `0x${string}`],
          }));
        const tx = String(receipt?.receipt?.transactionHash || receipt?.transactionHash || "");
        if (isHexHash(tx)) return tx;
      } catch {
        // keep retrying until attempts exhausted
      }
      await sleep(intervalMs);
    }
  } catch {
    // ignore
  }
  return "";
}

async function readOrderStatus(orderId: string) {
  const { data, error } = await supabase
    .from("market_orders")
    .select("status")
    .eq("id", orderId)
    .maybeSingle();
  if (error) {
    console.log("[Checkout] order status read failed", error.message);
    return "";
  }
  return String((data as any)?.status || "");
}

async function tryFinalizeOnce(
  orderId: string,
  chainName: string,
  txHash: string,
  eventType: ChainFinalizeEvent,
) {
  try {
    const out = await rpcWithFallback(RPC_CHAIN_TX_FINALIZE_CANDIDATES, {
      p_order_id: orderId,
      p_chain: chainName,
      p_tx_hash: txHash,
      p_event_type: eventType,
    });
    const data = out.data as any;
    if (data?.ok === false) {
      return {
        ok: false,
        error: String(data?.message || data?.reason || `Finalize ${eventType} failed`),
        data,
      };
    }
    return { ok: true, error: null as string | null, data: out.data };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e), data: null as any };
  }
}

async function tryFinalizeViaFunction(
  orderId: string,
  chainName: string,
  txHash: string,
  eventType: ChainFinalizeEvent,
) {
  try {
    const { data, error } = await supabase.functions.invoke("market-chain-tx-finalize", {
      body: {
        order_id: orderId,
        chain: chainName,
        tx_hash: txHash,
        event_type: eventType,
      },
    });
    if (error) return { ok: false, error: String(error.message || error), data: null as any };
    if ((data as any)?.ok === false) {
      return {
        ok: false,
        error: String((data as any)?.message || (data as any)?.reason || `Finalize ${eventType} failed`),
        data,
      };
    }
    return { ok: true, error: null as string | null, data };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e), data: null as any };
  }
}

async function settleOrderFromTx(
  orderId: string,
  chainName: string,
  txHash: string,
  eventType: ChainFinalizeEvent,
  maxAttempts = 12,
  intervalMs = 3000,
) {
  const want = expectedOrderStatusForEvent(eventType);
  if (!isHexHash(txHash)) return false;

  for (let i = 0; i < maxAttempts; i++) {
    const fnRes = await tryFinalizeViaFunction(orderId, chainName, txHash, eventType);
    if (!fnRes.ok) {
      console.log("[Checkout] chain finalize function failed", fnRes.error);
      const rpcRes = await tryFinalizeOnce(orderId, chainName, txHash, eventType);
      if (!rpcRes.ok) {
        console.log("[Checkout] chain finalize RPC fallback failed", rpcRes.error);
      }
    }

    const status = await readOrderStatus(orderId);
    if (want && status === want) {
      console.log("[Checkout] chain finalize settled", { orderId, status, txHash, eventType });
      return true;
    }

    await sleep(intervalMs);
  }

  return false;
}

function txHashFromReindexResult(data: any) {
  return normalizeHexHash(
    String(
      data?.tx_hash ??
        data?.transaction_hash ??
        data?.transactionHash ??
        data?.deposit_tx_hash ??
        data?.depositTxHash ??
        "",
    ),
  );
}

async function runReindexFallback(orderId: string, txHash?: string | null) {
  try {
    const body: Record<string, unknown> = { order_id: orderId };
    if (isHexHash(txHash)) body.tx_hash = txHash;
    const { data, error } = await supabase.functions.invoke("market-escrow-reindex", {
      body,
    });
    if (error) {
      console.log("[Checkout] escrow reindex fallback failed", error.message);
      return { txHash: "", applied: false, data: null as any };
    }
    console.log("[Checkout] escrow reindex fallback result", data ?? null);
    return {
      txHash: txHashFromReindexResult(data),
      applied: (data as any)?.applied === true,
      data,
    };
  } catch (e: any) {
    console.log("[Checkout] escrow reindex fallback error", String(e?.message || e));
    return { txHash: "", applied: false, data: null as any };
  }
}

async function readLatestDepositIntent(orderId: string, chainName?: string | null) {
  return readLatestIntent(orderId, "DEPOSIT", chainName);
}

async function readLatestIntent(orderId: string, intentType: ChainFinalizeEvent, chainName?: string | null) {
  let query = supabase
    .from("market_crypto_intents")
    .select("tx_hash,client_reference,chain,status,created_at,provider_ref_id")
    .eq("order_id", orderId)
    .eq("intent_type", intentType);
  if (chainName) query = query.eq("chain", chainName);

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;

const txHash = String((data as any)?.tx_hash || "").trim();
  const userOpHash = String((data as any)?.client_reference || "").trim();
  const refId = String((data as any)?.provider_ref_id || "").trim();
  return {
    txHash: normalizeHexHash(txHash),
    userOpHash: normalizeHexHash(userOpHash),
    chain: String((data as any)?.chain || "").trim(),
    status: String((data as any)?.status || "").trim(),
    refId: refId || null,
  };
}

async function ensureDepositSettled(
  orderId: string,
  chain: MarketChainConfig,
  txHash: string,
  userOpHash: string,
  refId?: string | null,
) {
  let resolvedTxHash = normalizeHexHash(txHash);
  let resolvedUserOpHash = normalizeHexHash(userOpHash);
  let recoveredFinalizeAttempted = false;

  if (resolvedTxHash && !resolvedUserOpHash) {
    const maybeResolved = await resolveUserOpToTxHash(chain, resolvedTxHash, 5, 2000);
    if (isHexHash(maybeResolved)) {
      resolvedUserOpHash = resolvedTxHash;
      resolvedTxHash = maybeResolved;
    }
  }

  if (!resolvedTxHash && resolvedUserOpHash) {
    resolvedTxHash = await resolveUserOpToTxHash(chain, resolvedUserOpHash, 20, 2000);
  }

if (resolvedTxHash) {
    const settled = await settleOrderFromTx(orderId, chain.chain, resolvedTxHash, "DEPOSIT", 12, 3000);
    if (settled) return { settled: true, txHash: resolvedTxHash };
  }

  for (let i = 0; i < 6; i++) {
    // If refId looks like a tx hash, try it directly as tx hash first.
    // This handles cases where Circle SDK failed to resolve but the hash is valid.
    if (!resolvedTxHash && refId && isHexHash(refId)) {
      resolvedTxHash = refId;
      const settled = await settleOrderFromTx(orderId, chain.chain, resolvedTxHash, "DEPOSIT", 4, 2000);
      if (settled) return { settled: true, txHash: resolvedTxHash };
    }

    // Poll Circle for transaction status if we have a refId but no txHash yet
    if (!resolvedTxHash) {
      const latestIntent = await readLatestDepositIntent(orderId, chain.chain);
      const activeRefId = refId || latestIntent?.refId;
      // Only poll Circle if refId is not a raw tx hash (Circle refIds are typically non-hex or short IDs)
      if (activeRefId && !isHexHash(activeRefId)) {
        try {
          const circleTx = await callFn<{ transaction?: any }>("circle-wallet", {
            action: "transaction_by_ref",
            chain: chain.chain,
            refId: activeRefId,
          }, 5000);
          const circleHash = String(circleTx?.transaction?.txHash ?? circleTx?.transaction?.transactionHash ?? "").trim();
          if (isHexHash(circleHash)) {
            resolvedTxHash = circleHash;
            const settled = await settleOrderFromTx(orderId, chain.chain, resolvedTxHash, "DEPOSIT", 4, 2000);
            if (settled) return { settled: true, txHash: resolvedTxHash };
          }
        } catch {
          // Circle polling failed, continue with reindex fallback
        }
      }
    }

    const reindex = await runReindexFallback(orderId, resolvedTxHash || null);
    if (reindex.txHash && !resolvedTxHash) {
      resolvedTxHash = reindex.txHash;
    }

    const status = await readOrderStatus(orderId);
    if (status === "IN_ESCROW") {
      return { settled: true, txHash: resolvedTxHash || "" };
    }

    if (!resolvedTxHash) {
      const latest = await readLatestDepositIntent(orderId, chain.chain);
      if (latest?.txHash) {
        resolvedTxHash = latest.txHash;
      } else if (latest?.userOpHash) {
        resolvedUserOpHash = latest.userOpHash;
        resolvedTxHash = await resolveUserOpToTxHash(chain, resolvedUserOpHash, 4, 2000);
      } else if (latest?.refId && isHexHash(latest.refId)) {
        // provider_ref_id may contain a raw tx hash that Circle couldn't resolve
        resolvedTxHash = latest.refId;
      }

      if (resolvedTxHash && !recoveredFinalizeAttempted) {
        recoveredFinalizeAttempted = true;
        const settled = await settleOrderFromTx(orderId, chain.chain, resolvedTxHash, "DEPOSIT", 4, 2000);
        if (settled) return { settled: true, txHash: resolvedTxHash };
      }
    }

    await sleep(3000);
  }

  return { settled: false, txHash: resolvedTxHash || "" };
}

async function ensureReleaseSettled(
  orderId: string,
  chain: MarketChainConfig,
  txHash: string,
  userOpHash: string,
  refId?: string | null,
) {
  let resolvedTxHash = normalizeHexHash(txHash);
  let resolvedUserOpHash = normalizeHexHash(userOpHash);
  let recoveredFinalizeAttempted = false;

  if (resolvedTxHash && !resolvedUserOpHash) {
    const maybeResolved = await resolveUserOpToTxHash(chain, resolvedTxHash, 6, 2000);
    if (isHexHash(maybeResolved)) {
      resolvedUserOpHash = resolvedTxHash;
      resolvedTxHash = maybeResolved;
    }
  }

  if (!resolvedTxHash && resolvedUserOpHash) {
    resolvedTxHash = await resolveUserOpToTxHash(chain, resolvedUserOpHash, 20, 2000);
  }

  if (resolvedTxHash) {
    const settled = await settleOrderFromTx(orderId, chain.chain, resolvedTxHash, "RELEASE", 12, 3000);
    if (settled) return { settled: true, txHash: resolvedTxHash };
  }

  for (let i = 0; i < 6; i++) {
    // If refId looks like a tx hash, try it directly as tx hash first.
    // This handles cases where Circle SDK failed to resolve but the hash is valid.
    if (!resolvedTxHash && refId && isHexHash(refId)) {
      resolvedTxHash = refId;
      const settled = await settleOrderFromTx(orderId, chain.chain, resolvedTxHash, "RELEASE", 4, 2000);
      if (settled) return { settled: true, txHash: resolvedTxHash };
    }

    // Poll Circle for transaction status if we have a refId but no txHash yet
    if (!resolvedTxHash) {
      const latestIntent = await readLatestIntent(orderId, "RELEASE", chain.chain);
      const activeRefId = refId || latestIntent?.refId;
      // Only poll Circle if refId is not a raw tx hash (Circle refIds are typically non-hex or short IDs)
      if (activeRefId && !isHexHash(activeRefId)) {
        try {
          const circleTx = await callFn<{ transaction?: any }>("circle-wallet", {
            action: "transaction_by_ref",
            chain: chain.chain,
            refId: activeRefId,
          }, 5000);
          const circleHash = String(circleTx?.transaction?.txHash ?? circleTx?.transaction?.transactionHash ?? "").trim();
          if (isHexHash(circleHash)) {
            resolvedTxHash = circleHash;
            const settled = await settleOrderFromTx(orderId, chain.chain, resolvedTxHash, "RELEASE", 4, 2000);
            if (settled) return { settled: true, txHash: resolvedTxHash };
          }
        } catch {
          // Circle polling failed, continue with reindex fallback
        }
      }
    }

    await runReindexFallback(orderId, resolvedTxHash || null);

    const status = await readOrderStatus(orderId);
    if (status === "RELEASED") {
      return { settled: true, txHash: resolvedTxHash || "" };
    }

const latest = await readLatestIntent(orderId, "RELEASE", chain.chain);
     if (latest?.txHash && !resolvedTxHash) {
       resolvedTxHash = latest.txHash;
     }
     if (latest?.userOpHash && !resolvedUserOpHash) {
       resolvedUserOpHash = latest.userOpHash;
     }
     // Check provider_ref_id for raw tx hash when Circle couldn't resolve
     if (!resolvedTxHash && latest?.refId && isHexHash(latest.refId)) {
       resolvedTxHash = latest.refId;
     }

     if (!resolvedTxHash && resolvedUserOpHash) {
       resolvedTxHash = await resolveUserOpToTxHash(chain, resolvedUserOpHash, 4, 2000);
     }

     if (resolvedTxHash && !recoveredFinalizeAttempted) {
       recoveredFinalizeAttempted = true;
       const settled = await settleOrderFromTx(orderId, chain.chain, resolvedTxHash, "RELEASE", 4, 2000);
       if (settled) return { settled: true, txHash: resolvedTxHash };
     }

    await sleep(3000);
  }

  return { settled: false, txHash: resolvedTxHash || "" };
}

const ESCROW_ABI = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "orderKey", type: "bytes32" },
      { name: "seller", type: "address" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "release",
    stateMutability: "nonpayable",
    inputs: [{ name: "orderKey", type: "bytes32" }],
    outputs: [],
  },
] as const;

const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "ok", type: "bool" }],
  },
] as const;

export async function getMyWalletForChain(chain: string) {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  const user = auth?.user;
  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("crypto_wallets")
    .select("id,user_id,chain,address,created_at")
    .eq("user_id", user.id)
    .eq("chain", chain)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

export async function getMyPiWallet() {
  return getMyWalletForChain(PI_TESTNET_CHAIN);
}

export async function saveMyPiWallet(rawAddress: string) {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  const user = auth?.user;
  if (!user) throw new Error("Not authenticated");

  const address = normalizeWalletAddress(rawAddress);

  if (!address) {
    const { error: delErr } = await supabase
      .from("crypto_wallets")
      .delete()
      .eq("user_id", user.id)
      .eq("chain", PI_TESTNET_CHAIN);
    if (delErr) throw new Error(delErr.message);
    return { address: "" };
  }

  if (!isLikelyPiWalletAddress(address)) {
    throw new Error("Enter a valid PI wallet address.");
  }

  const existing = await supabase
    .from("crypto_wallets")
    .select("id,user_id,chain,address,created_at")
    .eq("user_id", user.id)
    .eq("chain", PI_TESTNET_CHAIN)
    .order("created_at", { ascending: true });
  if (existing.error) throw new Error(existing.error.message);

  const rows = existing.data ?? [];
  if (rows.length > 0) {
    const normalizedTarget = address.toLowerCase();
    const keeper = rows.find((r: any) => String(r.address || "").toLowerCase() === normalizedTarget) ?? rows[0];
    const duplicateIds = rows.filter((r: any) => r.id !== keeper.id).map((r: any) => r.id);

    if (duplicateIds.length > 0) {
      const { error: delErr } = await supabase
        .from("crypto_wallets")
        .delete()
        .in("id", duplicateIds);
      if (delErr) throw new Error(delErr.message);
    }

    if (String(keeper.address || "").toLowerCase() !== normalizedTarget) {
      const { error: updErr } = await supabase
        .from("crypto_wallets")
        .update({ address })
        .eq("id", keeper.id);
      if (updErr) throw new Error(updErr.message);
    }

    return { address };
  }

  const { data: pairConflict, error: pairErr } = await supabase
    .from("crypto_wallets")
    .select("id,user_id")
    .eq("chain", PI_TESTNET_CHAIN)
    .eq("address", address)
    .neq("user_id", user.id)
    .limit(1);
  if (pairErr) throw new Error(pairErr.message);
  if (pairConflict && pairConflict.length > 0) {
    throw new Error(`PI wallet ${address} is already linked to another account.`);
  }

  const { error: insErr } = await supabase
    .from("crypto_wallets")
    .insert({ user_id: user.id, chain: PI_TESTNET_CHAIN, address });
  if (insErr) throw new Error(insErr.message);

  return { address };
}

export async function registerWallet(chain: string, address: string) {
  // Prefer direct table write so wallet creation does not depend on Edge Function JWT flow.
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  const user = auth?.user;
  if (!user) throw new Error("Not authenticated");

  const existing = await supabase
    .from("crypto_wallets")
    .select("id,user_id,chain,address,created_at,wallet_type")
    .eq("user_id", user.id)
    .eq("chain", chain)
    .order("created_at", { ascending: true });
  if (existing.error) throw new Error(existing.error.message);

  const rows = existing.data ?? [];
  if (rows.length > 0) {
    const normalizedTarget = String(address).toLowerCase();
    const keeper = rows.find((r: any) => String(r.address || "").toLowerCase() === normalizedTarget) ?? rows[0];
    const duplicateIds = rows.filter((r: any) => r.id !== keeper.id).map((r: any) => r.id);
    if (duplicateIds.length > 0) {
      const { error: delErr } = await supabase
        .from("crypto_wallets")
        .delete()
        .in("id", duplicateIds);
      if (delErr) throw new Error(delErr.message);
    }

    if (String(keeper.address || "").toLowerCase() !== normalizedTarget) {
      const keeperType = String((keeper as any).wallet_type || "").toLowerCase();
      const update = keeperType.startsWith("circle") ? { address } : { address, wallet_type: "aa" };
      const { data, error } = await supabase
        .from("crypto_wallets")
        .update(update)
        .eq("id", keeper.id)
        .select("user_id,chain,address")
        .single();
      if (error) throw new Error(error.message);
      return data;
    }

    const { data, error } = await supabase
      .from("crypto_wallets")
      .select("user_id,chain,address")
      .eq("id", keeper.id)
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  // Protect against chain+address already used by another account.
  const { data: pairConflict, error: pairErr } = await supabase
    .from("crypto_wallets")
    .select("id,user_id")
    .eq("chain", chain)
    .eq("address", address)
    .neq("user_id", user.id)
    .limit(1);
  if (pairErr) throw new Error(pairErr.message);
  if (pairConflict && pairConflict.length > 0) {
    throw new Error(`Address ${address} is already registered on ${chain} for another account.`);
  }

  const { data, error } = await supabase
    .from("crypto_wallets")
    .insert({ user_id: user.id, chain, address, wallet_type: "aa" })
    .select("user_id,chain,address")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function ensureSmartAccount(chainConfig: MarketChainConfig) {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  const user = auth?.user;
  if (!user) throw new Error("Not authenticated");

  await ensureWalletAddressOnChain(chainConfig);
  const { address, client } = await getSmartAccount(chainConfig, user.id);
  return { address, client };
}

export async function ensureWalletAddressOnChain(chainConfig: MarketChainConfig) {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  const user = auth?.user;
  if (!user) throw new Error("Not authenticated");

  const { address } = await getSmartAccount(chainConfig, user.id);
  await registerWallet(chainConfig.chain, address);
  return { address };
}

export async function replaceSavedWalletWithDevice(chainConfig: MarketChainConfig) {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  const user = auth?.user;
  if (!user) throw new Error("Not authenticated");

  const out = await getSmartAccount(chainConfig, user.id);
  const derived = String(out.address || "");
  if (!/^0x[a-fA-F0-9]{40}$/.test(derived)) {
    throw new Error("Wallet connection failed. Connect wallet and try again.");
  }

  const { data: existingRows, error: existingErr } = await supabase
    .from("crypto_wallets")
    .select("id,chain,address,created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  if (existingErr) throw new Error(existingErr.message);

  const byChain = new Map<string, any[]>();
  for (const row of existingRows ?? []) {
    const chain = String((row as any).chain || "");
    const list = byChain.get(chain) ?? [];
    list.push(row);
    byChain.set(chain, list);
  }

  for (const [chain, rows] of byChain.entries()) {
    if (String(chain || "").toLowerCase() === PI_TESTNET_CHAIN) {
      // PI wallet addresses are manually managed and are not derived from EVM sessions.
      continue;
    }

    const { data: pairConflict, error: pairErr } = await supabase
      .from("crypto_wallets")
      .select("id,user_id")
      .eq("chain", chain)
      .eq("address", derived)
      .neq("user_id", user.id)
      .limit(1);
    if (pairErr) throw new Error(pairErr.message);
    if (pairConflict && pairConflict.length > 0) {
      throw new Error(`Address ${derived} is already registered on ${chain} for another account.`);
    }

    const keeper = rows.find((r: any) => String(r.address || "").toLowerCase() === String(derived).toLowerCase()) ?? rows[0];
    const duplicateIds = rows.filter((r: any) => r.id !== keeper.id).map((r: any) => r.id);
    if (duplicateIds.length > 0) {
      const { error: delErr } = await supabase
        .from("crypto_wallets")
        .delete()
        .in("id", duplicateIds);
      if (delErr) throw new Error(delErr.message);
    }

    if (String(keeper.address || "").toLowerCase() !== String(derived).toLowerCase()) {
      const { error: updErr } = await supabase
        .from("crypto_wallets")
        .update({ address: derived, wallet_type: "aa" })
        .eq("id", keeper.id);
      if (updErr) throw new Error(updErr.message);
    }
  }

  if (String(chainConfig.chain || "").toLowerCase() !== PI_TESTNET_CHAIN) {
    const { data: existingChainRows, error: chainErr } = await supabase
      .from("crypto_wallets")
      .select("id")
      .eq("user_id", user.id)
      .eq("chain", chainConfig.chain)
      .limit(1);
    if (chainErr) throw new Error(chainErr.message);

    if (!existingChainRows || existingChainRows.length === 0) {
      const { data: pairConflict, error: pairErr } = await supabase
        .from("crypto_wallets")
        .select("id,user_id")
        .eq("chain", chainConfig.chain)
        .eq("address", derived)
        .neq("user_id", user.id)
        .limit(1);
      if (pairErr) throw new Error(pairErr.message);
      if (pairConflict && pairConflict.length > 0) {
        throw new Error(`Address ${derived} is already registered on ${chainConfig.chain} for another account.`);
      }

      const { error: insErr } = await supabase
        .from("crypto_wallets")
        .insert({ user_id: user.id, chain: chainConfig.chain, address: derived, wallet_type: "aa" });
      if (insErr) throw new Error(insErr.message);
    }
  }

  return { address: derived };
}

export function isPiChain(chain?: string | null) {
  return String(chain || "").toLowerCase() === PI_TESTNET_CHAIN;
}

export function isPiWalletAddress(value?: string | null) {
  const v = normalizeWalletAddress(value);
  if (!v) return false;
  if (isEvmAddress(v)) return false;
  return isLikelyPiWalletAddress(v);
}

export function isEvmWalletAddress(value?: string | null) {
  return isEvmAddress(value);
}

function nativeGasSymbol(chainName?: string | null) {
  return String(chainName || "").trim().toLowerCase() === "arc_testnet" ? "USDC" : "ETH";
}

export async function payStableForOrder(
  orderId: string,
  symbol: StableSymbol = "USDC",
  chainOverride?: MarketChainConfig | null,
) {
  const chain = chainOverride ?? (await getPreferredMarketChain());
  if (!chain) throw new Error("No active chain configuration found.");

  const localAuth = await requireLocalAuth(`Confirm ${symbol} deposit`);
  if (!localAuth.ok) throw new Error(localAuth.message || "Authentication required");

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  const user = auth?.user;
  if (!user) throw new Error("Not authenticated");

  const { client, account, address } = await getSmartAccount(chain, user.id);
  // Ensure strict escrow intent reads the same active wallet that will sign the tx.
  await registerWallet(chain.chain, address);

  const intent: {
    ok: boolean;
    order_id: string;
    order_key: string;
    escrow_address: string;
    usdc_address?: string;
    usdt_address?: string;
    token_address?: string;
    seller_wallet: string;
    amount_raw: string;
    buyer_total_raw: string;
    fee_bps: number;
    chain: string;
  } = await (async () => {
    const out = await callFn("market-usdc-deposit-intent", {
      order_id: orderId,
      chain: chain.chain,
      token: symbol,
    });
    return out as any;
  })();

  const tokenAddress =
    intent.token_address ||
    (symbol === "USDT" ? intent.usdt_address : intent.usdc_address) ||
    intent.usdc_address ||
    "";

  if (!tokenAddress) {
    throw new Error(`${symbol} token address is not configured for this network.`);
  }
  const buyerAddress = String(address || "").toLowerCase();
  const sellerAddress = String(intent.seller_wallet || "").toLowerCase();
  if (buyerAddress && sellerAddress && buyerAddress === sellerAddress) {
    throw new Error("Buyer and seller wallet cannot be the same.");
  }

  // Pre-check balances to avoid opaque UserOp reverts.
  try {
    const rpcUrl = chain.rpc_url || "";
    if (rpcUrl) {
      const publicClient = createPublicClient({ transport: http(rpcUrl) });
      const ethBal = await publicClient.getBalance({ address: address as `0x${string}` });
      const bal = await publicClient.readContract({
        abi: [
          {
            type: "function",
            name: "balanceOf",
            stateMutability: "view",
            inputs: [{ name: "owner", type: "address" }],
            outputs: [{ name: "bal", type: "uint256" }],
          },
        ],
        address: tokenAddress as `0x${string}`,
        functionName: "balanceOf",
        args: [address as `0x${string}`],
      });
      const need = BigInt(intent.buyer_total_raw || "0");
      if (BigInt(bal) < need) {
        throw new Error(
          `Insufficient ${symbol} balance on your wallet.\n\nWallet: ${address}\nHave: ${bal.toString()}\nNeed: ${need.toString()}`,
        );
      }
      // Wallet must have enough native gas token to pay network fees.
      if (ethBal < 50_000_000_000_000n) {
        const gasSymbol = nativeGasSymbol(chain.chain);
        throw new Error(
          `Not enough ${gasSymbol} on ${chain.chain} for network fees.\n\nWallet: ${address}\nAdd a small amount of ${gasSymbol} and try again.`,
        );
      }
    }
  } catch (e) {
    // Surface as a normal error so user sees it.
    throw e;
  }

  const approveData = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: "approve",
    args: [intent.escrow_address as `0x${string}`, BigInt(intent.buyer_total_raw)],
  });

  const depositData = encodeFunctionData({
    abi: ESCROW_ABI,
    functionName: "deposit",
    args: [intent.order_key as `0x${string}`, intent.seller_wallet as `0x${string}`, tokenAddress as `0x${string}`, BigInt(intent.amount_raw)],
  });

// Send sequentially to get clearer errors.
  const approveTx = await (client as any).sendTransaction({
    account,
    to: tokenAddress as `0x${string}`,
    data: approveData,
  });
  const approveHash = String((approveTx as any)?.hash ?? (approveTx as any)?.transactionHash ?? "");

  const sendResult = await (client as any).sendTransaction({
    account,
    to: intent.escrow_address as `0x${string}`,
    data: depositData,
  });

const txHash = normalizeHexHash(String((sendResult as any)?.transactionHash ?? ""));
   const userOpHash = normalizeHexHash(String((sendResult as any)?.userOpHash ?? (sendResult as any)?.userOperationHash ?? ""));
   const rawHash = normalizeHexHash(String((sendResult as any)?.hash ?? ""));
   const sendRefId = String((sendResult as any)?.refId || "").trim();
   console.log("[Checkout] deposit send result", {
     tx_hash: txHash || rawHash || null,
     user_op_hash: userOpHash || null,
     chain: chain.chain,
   });

   // Some AA wallets return userOp hash in `hash`. Classify and resolve before persisting.
   const resolvedHashes = await resolveSubmittedHashes(chain, sendResult);
   let resolvedTxHash = resolvedHashes.txHash;
   const resolvedUserOpHash = resolvedHashes.userOpHash || userOpHash || "";
   // If resolveSubmittedHashes didn't classify rawHash, try it as a potential tx hash.
   // This handles Circle SDK failing to resolve immediately but hash being valid onchain.
   if (!resolvedTxHash && rawHash && !resolvedUserOpHash) {
     const looksOnchain = await hashLooksLikeOnchainTx(chain, rawHash);
     if (looksOnchain) {
       resolvedTxHash = rawHash;
     }
   }
   console.log("[Checkout] deposit resolved tx", {
     resolved_tx_hash: resolvedTxHash || null,
     user_op_hash: resolvedUserOpHash || null,
     raw_hash_for_recovery: rawHash || null,
   });

   try {
     await callFn("market-usdc-deposit-submit", {
       order_id: orderId,
       chain: chain.chain,
       token: symbol,
       tx_hash: resolvedTxHash || null,
     });
   } catch (e: any) {
     console.log("[Checkout] deposit submit function failed", String(e?.message || e));
   }
   // Ensure intent is marked submitted even if we only have a userOp hash.
   const intentUpdate: any = { status: "SUBMITTED" };
   if (resolvedTxHash) intentUpdate.tx_hash = resolvedTxHash;
   if (resolvedUserOpHash) intentUpdate.client_reference = resolvedUserOpHash;
   // Persist rawHash as provider_ref_id when we don't have a resolved tx hash.
   // This enables the poller to recover the tx hash on manual resync.
   const persistentRefId = sendRefId || (rawHash && !resolvedTxHash ? rawHash : "");
   if (persistentRefId && !intentUpdate.tx_hash) {
     intentUpdate.provider_ref_id = persistentRefId;
   }
  const { error: intentUpdErr } = await supabase
    .from("market_crypto_intents")
    .update(intentUpdate)
    .eq("order_id", orderId)
    .eq("intent_type", "DEPOSIT")
    .eq("chain", chain.chain);
  if (intentUpdErr) {
    // RLS can block direct updates; the RPC should still have stored it.
    console.log("[Checkout] deposit intent update blocked", intentUpdErr.message);
  }

  const settle = await ensureDepositSettled(orderId, chain, resolvedTxHash, resolvedUserOpHash, persistentRefId);
  if (settle.txHash && !resolvedTxHash) {
    resolvedTxHash = settle.txHash;
    if (!settle.settled) {
      try {
        await callFn("market-usdc-deposit-submit", {
          order_id: orderId,
          chain: chain.chain,
          token: symbol,
          tx_hash: resolvedTxHash,
        });
      } catch (e: any) {
        console.log("[Checkout] recovered deposit hash submit failed", String(e?.message || e));
      }
    }
  }
  if (!settle.settled) {
    console.log("[Checkout] deposit not settled within wait window", {
      order_id: orderId,
      tx_hash: resolvedTxHash || null,
      user_op_hash: resolvedUserOpHash || null,
    });
  }

  return { ...intent, token_symbol: symbol, token_address: tokenAddress, tx_hash: resolvedTxHash || null, user_op_hash: resolvedUserOpHash || null, pending_index: !resolvedTxHash && !resolvedUserOpHash };
}

export async function payUsdcForOrder(orderId: string, chainOverride?: MarketChainConfig | null) {
  return payStableForOrder(orderId, "USDC", chainOverride);
}

export async function payUsdtForOrder(orderId: string, chainOverride?: MarketChainConfig | null) {
  return payStableForOrder(orderId, "USDT", chainOverride);
}

export async function releaseUsdcForOrder(orderId: string) {
  const chain = await getPreferredMarketChain();
  if (!chain) throw new Error("No active chain configuration found.");

  const localAuth = await requireLocalAuth("Release escrow to seller");
  if (!localAuth.ok) throw new Error(localAuth.message || "Authentication required");

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  const user = auth?.user;
  if (!user) throw new Error("Not authenticated");

  const { client, account, address } = await getSmartAccount(chain, user.id);
  await registerWallet(chain.chain, address);

  const intent: {
    ok: boolean;
    order_id: string;
    order_key: string;
    escrow_address: string;
    chain: string;
  } = await (async () => {
    const out = await callFn("market-usdc-release-intent", {
      order_id: orderId,
      chain: chain.chain,
    });
    return out as any;
  })();

  const data = encodeFunctionData({
    abi: ESCROW_ABI,
    functionName: "release",
    args: [intent.order_key as `0x${string}`],
  });

  const sendResult = await (client as any).sendTransaction({
    account,
    to: intent.escrow_address as `0x${string}`,
    data,
  });

const txHash = normalizeHexHash(String((sendResult as any)?.transactionHash ?? ""));
   const userOpHash = normalizeHexHash(String((sendResult as any)?.userOpHash ?? (sendResult as any)?.userOperationHash ?? ""));
   const rawHash = normalizeHexHash(String((sendResult as any)?.hash ?? ""));
   console.log("[Checkout] release send result", {
     tx_hash: txHash || rawHash || null,
     user_op_hash: userOpHash || null,
     chain: chain.chain,
   });

   const resolvedHashes = await resolveSubmittedHashes(chain, sendResult);
   let resolvedTxHash = resolvedHashes.txHash;
   const resolvedUserOpHash = resolvedHashes.userOpHash || userOpHash || "";
   // If resolveSubmittedHashes didn't classify rawHash, try it as a potential tx hash.
   // This handles Circle SDK failing to resolve immediately but hash being valid onchain.
   if (!resolvedTxHash && rawHash && !resolvedUserOpHash) {
     const looksOnchain = await hashLooksLikeOnchainTx(chain, rawHash);
     if (looksOnchain) {
       resolvedTxHash = rawHash;
     }
   }
   console.log("[Checkout] release resolved tx", {
     resolved_tx_hash: resolvedTxHash || null,
     user_op_hash: resolvedUserOpHash || null,
     raw_hash_for_recovery: rawHash || null,
   });

   try {
     await callFn("market-usdc-release-submit", {
       order_id: orderId,
       chain: chain.chain,
       tx_hash: resolvedTxHash || null,
     });
   } catch (e: any) {
     console.log("[Checkout] release submit function failed", String(e?.message || e));
   }
   const intentUpdate: any = { status: "SUBMITTED" };
   if (resolvedTxHash) intentUpdate.tx_hash = resolvedTxHash;
   if (resolvedUserOpHash) intentUpdate.client_reference = resolvedUserOpHash;
   // Persist rawHash as provider_ref_id when we don't have a resolved tx hash.
   // This enables the poller to recover the tx hash on manual resync.
   const persistentRefId = String(sendResult?.refId || "") || (rawHash && !resolvedTxHash ? rawHash : "");
   if (persistentRefId && !intentUpdate.tx_hash) {
     intentUpdate.provider_ref_id = persistentRefId;
   }
   const { error: intentUpdErr } = await supabase
     .from("market_crypto_intents")
     .update(intentUpdate)
     .eq("order_id", orderId)
     .eq("intent_type", "RELEASE")
     .eq("chain", chain.chain);
   if (intentUpdErr) {
     console.log("[Checkout] release intent update blocked", intentUpdErr.message);
   }

   const settle = await ensureReleaseSettled(orderId, chain, resolvedTxHash, resolvedUserOpHash, persistentRefId);
  if (settle.txHash && !resolvedTxHash) {
    resolvedTxHash = settle.txHash;
  }
  if (!settle.settled) {
    console.log("[Checkout] release not settled within wait window", {
      order_id: orderId,
      tx_hash: resolvedTxHash || null,
      user_op_hash: resolvedUserOpHash || null,
    });
  }

return { ...intent, tx_hash: resolvedTxHash || null, user_op_hash: resolvedUserOpHash || null };
}

async function reindexDeposit(orderId: string, txHash?: string | null) {
  try {
    const body: Record<string, unknown> = { order_id: orderId };
    if (isHexHash(txHash)) body.tx_hash = txHash;
    const { data, error } = await supabase.functions.invoke("market-escrow-reindex", { body });
    if (error) throw error;
    return { ok: (data as any)?.applied === true, data };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

export async function autoSyncPendingDeposit(orderId: string) {
  const { data: escrow, error: escErr } = await supabase
    .from("market_crypto_escrows")
    .select("order_id,chain,order_key,deposited_tx_hash,deposited_at")
    .eq("order_id", orderId)
    .maybeSingle();
  
  if (escErr || !escrow) return { ok: false, error: "Escrow record not found" };
  if (escrow.deposited_tx_hash || escrow.deposited_at) return { ok: true, already_settled: true };

  const { data: latestIntent } = await supabase
    .from("market_crypto_intents")
    .select("tx_hash,client_reference")
    .eq("order_id", orderId)
    .eq("intent_type", "DEPOSIT")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const txHash = String((latestIntent as any)?.tx_hash || "").trim();
  const reindexResult = await reindexDeposit(orderId, isHexHash(txHash) ? txHash : null);
  
  return {
    ok: reindexResult.ok || (reindexResult as any)?.data?.applied === true,
    reindexed: reindexResult.ok,
    tx_hash: (reindexResult as any)?.data?.tx_hash || txHash || null,
  };
}
