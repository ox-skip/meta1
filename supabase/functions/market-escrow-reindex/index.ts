import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { keccak256, stringToHex } from "https://esm.sh/viem@2.45.1";
import { envAny } from "../_shared/market/env.ts";
import { resolveRpcUrlForChain } from "../_shared/market/chainRpc.ts";

type RpcLog = {
  address?: string;
  topics?: string[];
  data?: string;
  transactionHash?: string;
  logIndex?: string | number;
  blockNumber?: string | number;
};

type ChainConfig = {
  chain: string;
  rpc_url: string | null;
  escrow_address: string | null;
  usdc_address: string | null;
  usdt_address: string | null;
  confirmations_required?: number | null;
};

const TOPIC_DEPOSIT_MULTI = keccak256(stringToHex("EscrowDeposited(bytes32,address,address,address,uint256)"));
const TOPIC_DEPOSIT_SINGLE = keccak256(stringToHex("EscrowDeposited(bytes32,address,address,uint256)"));

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function rpcCall(rpcUrl: string, method: string, params: unknown[]) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.error) throw new Error(json?.error?.message || `RPC ${method} failed`);
  return json?.result;
}

function toNum(hexOrNum: string | number | null | undefined): number {
  if (typeof hexOrNum === "number") return hexOrNum;
  if (!hexOrNum) return 0;
  const raw = String(hexOrNum);
  return raw.startsWith("0x") ? parseInt(raw, 16) : Number(raw);
}

function hexToAddress(topicHex?: string): string | null {
  if (!topicHex || !topicHex.startsWith("0x")) return null;
  return `0x${topicHex.slice(-40)}`.toLowerCase();
}

function hexToBigInt(hex?: string): bigint {
  if (!hex || !hex.startsWith("0x")) return 0n;
  return BigInt(hex);
}

function decodeData(dataHex?: string) {
  const data = String(dataHex ?? "");
  if (!data.startsWith("0x")) return { token: null, amountRaw: 0n };
  const payload = data.slice(2);
  if (payload.length >= 64 * 2) {
    const tokenSlot = payload.slice(0, 64);
    const amountSlot = payload.slice(64, 128);
    const token = `0x${tokenSlot.slice(24 * 2)}`.toLowerCase();
    const amountRaw = hexToBigInt(`0x${amountSlot}`);
    return { token, amountRaw };
  }
  if (payload.length >= 64) {
    const amountRaw = hexToBigInt(`0x${payload.slice(0, 64)}`);
    return { token: null, amountRaw };
  }
  return { token: null, amountRaw: 0n };
}

function normalizeOrderKey(key: string | null | undefined) {
  const raw = String(key ?? "").toLowerCase().replace(/^0x/, "");
  return raw.padStart(64, "0");
}

serve(async (req) => {
  try {
    const SB_URL = envAny(["SB_URL", "SUPABASE_URL", "sb_url"], "");
    const SB_SERVICE = envAny(
      ["SB_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY", "sb_secret_key", "sb_scret_key"],
      "",
    );
    const SB_ANON = envAny(["SB_ANON_KEY", "SUPABASE_ANON_KEY", "SUPABASE_ANON", "sb_anon"], "");
    if (!SB_URL || !SB_SERVICE || !SB_ANON) {
      return json(500, {
        ok: false,
        message: "Missing env vars",
        hasSB_URL: !!SB_URL,
        hasSB_SERVICE_ROLE_KEY: !!SB_SERVICE,
        hasSB_ANON_KEY: !!SB_ANON,
      });
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SB_URL, SB_ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(SB_URL, SB_SERVICE);

    const { data: authData, error: authErr } = await userClient.auth.getUser();
    if (authErr || !authData?.user) return json(401, { ok: false, message: "Not authenticated" });

    const body = await req.json().catch(() => ({}));
    const orderId = String(body?.order_id ?? "");
    const txHashInput = String(body?.tx_hash ?? "").trim().toLowerCase();
    if (!orderId) {
      return json(400, { ok: false, message: "Missing order_id" });
    }

    const { data: order, error: orderErr } = await admin
      .from("market_orders")
      .select("id,buyer_id,seller_id")
      .eq("id", orderId)
      .maybeSingle();
    if (orderErr || !order) return json(404, { ok: false, message: "Order not found" });

    const uid = authData.user.id;
    if (order.buyer_id !== uid && order.seller_id !== uid) {
      return json(403, { ok: false, message: "Not your order" });
    }

    const { data: esc, error: escErr } = await admin
      .from("market_crypto_escrows")
      .select("order_id,order_key,chain,token_address")
      .eq("order_id", orderId)
      .maybeSingle();
    if (escErr || !esc?.order_key) return json(404, { ok: false, message: "Escrow mapping missing" });

    const { data: cfg, error: cfgErr } = await admin
      .from("market_chain_config")
      .select("chain,rpc_url,escrow_address,usdc_address,usdt_address,confirmations_required")
      .eq("chain", esc.chain)
      .eq("active", true)
      .maybeSingle();
    if (cfgErr) return json(400, { ok: false, message: cfgErr.message });
    if (!cfg) return json(400, { ok: false, message: "Active chain config missing" });

    const rpcUrl = resolveRpcUrlForChain(esc.chain, cfg.rpc_url);
    if (!rpcUrl) {
      const prefix = String(esc.chain || "").toUpperCase().replace(/[^A-Z0-9]/g, "_");
      return json(400, {
        ok: false,
        message: `Chain RPC URL missing for ${esc.chain}. Set market_chain_config.rpc_url, ${prefix}_RPC_URL, ${prefix}_MAINNET_RPC_URL, or ALCHEMY_API_KEY.`,
      });
    }
    if (!cfg.escrow_address) {
      return json(400, { ok: false, message: `Escrow address missing for ${esc.chain}` });
    }

    const wantKey = normalizeOrderKey(esc.order_key);
    const escrowAddr = String(cfg.escrow_address).toLowerCase();
    const required = Math.max(1, Number(cfg.confirmations_required ?? 1));
    const latestHex = await rpcCall(rpcUrl, "eth_blockNumber", []);
    const latest = toNum(latestHex);

    let hit: RpcLog | null = null;
    let resolvedTxHash = txHashInput;
    let hitBlock = 0;
    let confirmations = 0;

    if (txHashInput.startsWith("0x")) {
      const receipt = await rpcCall(rpcUrl, "eth_getTransactionReceipt", [txHashInput]);
      const receiptBlock = toNum(receipt?.blockNumber ?? 0);
      if (!receiptBlock) {
        return json(200, { ok: true, applied: false, pending: "receipt" });
      }
      confirmations = latest - receiptBlock + 1;
      if (confirmations < required) {
        return json(200, {
          ok: true,
          applied: false,
          pending: "confirmations",
          required,
          confirmations,
          remaining: Math.max(0, required - confirmations),
        });
      }

      const logs = (receipt?.logs ?? []) as RpcLog[];
      hit =
        logs.find((log) => {
          const addr = String(log.address ?? "").toLowerCase();
          const topic0 = String(log.topics?.[0] ?? "").toLowerCase();
          const topic1 = normalizeOrderKey(String(log.topics?.[1] ?? ""));
          const isDeposit = topic0 === TOPIC_DEPOSIT_MULTI || topic0 === TOPIC_DEPOSIT_SINGLE;
          return addr === escrowAddr && isDeposit && topic1 === wantKey;
        }) ?? null;

      if (!hit) {
        return json(404, { ok: false, message: "Deposit event not found in tx logs" });
      }
      hitBlock = toNum(hit.blockNumber as any) || receiptBlock;
      resolvedTxHash = String(hit.transactionHash ?? txHashInput).toLowerCase();
    } else {
      // No tx hash yet (AA path): find deposit by order key directly from chain logs.
      const fromBlock = Math.max(0, latest - 8000);
      const logs = (await rpcCall(rpcUrl, "eth_getLogs", [
        {
          address: cfg.escrow_address,
          fromBlock: `0x${fromBlock.toString(16)}`,
          toBlock: `0x${latest.toString(16)}`,
          topics: [[TOPIC_DEPOSIT_MULTI, TOPIC_DEPOSIT_SINGLE], [`0x${wantKey}`]],
        },
      ])) as RpcLog[];

      if (!logs?.length) {
        return json(200, { ok: true, applied: false, pending: "event_not_found_yet" });
      }

      logs.sort((a, b) => {
        const ab = toNum(a.blockNumber as any);
        const bb = toNum(b.blockNumber as any);
        if (ab !== bb) return ab - bb;
        return toNum(a.logIndex as any) - toNum(b.logIndex as any);
      });

      hit = logs[logs.length - 1] ?? null;
      hitBlock = toNum(hit?.blockNumber as any);
      confirmations = latest - hitBlock + 1;
      if (confirmations < required) {
        return json(200, {
          ok: true,
          applied: false,
          pending: "confirmations",
          required,
          confirmations,
          remaining: Math.max(0, required - confirmations),
        });
      }
      resolvedTxHash = String(hit?.transactionHash ?? "").toLowerCase();
      if (!resolvedTxHash.startsWith("0x")) {
        return json(200, { ok: true, applied: false, pending: "tx_hash_missing" });
      }
    }

    if (!hit) {
      return json(200, { ok: true, applied: false, pending: "event_not_found_yet" });
    }

    const buyer = hexToAddress(hit.topics?.[2]);
    const seller = hexToAddress(hit.topics?.[3]);
    const { token, amountRaw } = decodeData(hit.data);
    const tokenAddr = (token || esc.token_address || cfg.usdc_address || "").toLowerCase();
    const amountUnits = Number(amountRaw) / 1_000_000;

    await admin.rpc("market_apply_chain_deposit", {
      p_order_id: esc.order_id,
      p_buyer_wallet: buyer,
      p_seller_wallet: seller,
      p_amount_raw: amountRaw ? amountRaw.toString() : null,
      p_amount_units: amountUnits,
      p_tx_hash: String(hit.transactionHash ?? resolvedTxHash),
      p_log_index: toNum(hit.logIndex as any),
      p_block_number: toNum(hit.blockNumber as any),
      p_block_time: null,
      p_raw: hit,
      p_token_address: tokenAddr,
    });

    return json(200, {
      ok: true,
      applied: true,
      order_id: orderId,
      tx_hash: resolvedTxHash,
      confirmations,
      required,
      block_number: hitBlock,
    });
  } catch (err: any) {
    return json(500, { ok: false, message: String(err?.message || err) });
  }
});
