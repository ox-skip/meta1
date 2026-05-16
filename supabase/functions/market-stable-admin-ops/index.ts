import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { ethers } from "https://esm.sh/ethers@6.16.0";

import { adminError, getAdminContext } from "../_shared/market/admin.ts";
import { resolveRpcUrlForChain } from "../_shared/market/chainRpc.ts";
import { orderKeyKeccak } from "../_shared/market/crypto.ts";
import { bad, methodNotAllowed, ok } from "../_shared/market/http.ts";

type AdminAction =
  | "pause"
  | "unpause"
  | "update_fee_bps"
  | "update_fee_recipient"
  | "update_arbiter"
  | "allow_wallet"
  | "emergency_withdraw"
  | "rescue_deposit_tx";

function envAny(...names: string[]) {
  for (const n of names) {
    const v = Deno.env.get(n);
    if (v && v.trim().length > 0) return v.trim();
  }
  return "";
}

function escrowAdminKeyForChain(chain: string) {
  const upper = chain.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  return envAny(
    `ESCROW_ADMIN_PRIVATE_KEY_${upper}`,
    `ADMIN_PRIVATE_KEY_${upper}`,
    "ESCROW_ADMIN_PRIVATE_KEY",
    "ADMIN_PRIVATE_KEY",
  );
}

function arbiterKeyForChain(chain: string) {
  const upper = chain.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  return envAny(`ARBITER_PRIVATE_KEY_${upper}`, "ARBITER_PRIVATE_KEY");
}

function normalizeAction(input: unknown): AdminAction | "" {
  const raw = String(input ?? "").trim().toLowerCase().replace(/-/g, "_");
  if (
    raw === "pause" ||
    raw === "unpause" ||
    raw === "update_fee_bps" ||
    raw === "update_fee_recipient" ||
    raw === "update_arbiter" ||
    raw === "allow_wallet" ||
    raw === "emergency_withdraw" ||
    raw === "arbiter_withdraw" ||
    raw === "rescue_deposit_tx" ||
    raw === "rescue_missed_deposit" ||
    raw === "return_missed_deposit"
  ) {
    if (raw === "arbiter_withdraw") return "emergency_withdraw";
    if (raw === "rescue_missed_deposit" || raw === "return_missed_deposit") return "rescue_deposit_tx";
    return raw as AdminAction;
  }
  return "";
}

function requireAddress(name: string, value: unknown) {
  const raw = String(value ?? "").trim();
  if (!ethers.isAddress(raw)) throw new Error(`Invalid ${name}`);
  return raw;
}

function requireBoolean(name: string, value: unknown) {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`Invalid ${name}`);
}

function requireFeeBps(value: unknown) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 200) throw new Error("fee_bps must be an integer between 0 and 200");
  return n;
}

function requireOrderKey(value: unknown) {
  const raw = String(value ?? "").trim();
  const withPrefix = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(withPrefix)) throw new Error("order_key must be a 32-byte hex value");
  return withPrefix;
}

function requireTxHash(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!/^0x[a-fA-F0-9]{64}$/.test(raw)) throw new Error("tx_hash must be a transaction hash");
  return raw;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(value);
}

function isOrderKey(value: string) {
  return /^(0x)?[a-fA-F0-9]{64}$/.test(value);
}

const depositEventMultiToken = ethers.id("EscrowDeposited(bytes32,address,address,address,uint256)");
const depositEventSingleToken = ethers.id("EscrowDeposited(bytes32,address,address,uint256)");

function addressFromTopic(topic: unknown) {
  const raw = String(topic ?? "");
  if (!/^0x[a-fA-F0-9]{64}$/.test(raw)) throw new Error("Invalid event address topic");
  return ethers.getAddress(`0x${raw.slice(-40)}`);
}

function extractDepositEvent(receipt: any, escrowAddress: string) {
  const escrow = ethers.getAddress(escrowAddress);
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const logs = Array.isArray(receipt?.logs) ? receipt.logs : [];

  for (const log of logs) {
    if (ethers.getAddress(String(log?.address ?? "0x0000000000000000000000000000000000000000")) !== escrow) continue;
    const topics = Array.isArray(log?.topics) ? log.topics : [];
    const topic0 = String(topics[0] ?? "").toLowerCase();
    const orderKey = String(topics[1] ?? "");
    if (!/^0x[a-fA-F0-9]{64}$/.test(orderKey)) continue;

    if (topic0 === depositEventMultiToken.toLowerCase()) {
      const decoded = coder.decode(["address", "uint256"], String(log.data ?? "0x"));
      return {
        orderKey,
        buyer: addressFromTopic(topics[2]),
        seller: addressFromTopic(topics[3]),
        token: ethers.getAddress(String(decoded[0])),
        amountRaw: decoded[1].toString(),
      };
    }

    if (topic0 === depositEventSingleToken.toLowerCase()) {
      const decoded = coder.decode(["uint256"], String(log.data ?? "0x"));
      return {
        orderKey,
        buyer: addressFromTopic(topics[2]),
        seller: addressFromTopic(topics[3]),
        token: null,
        amountRaw: decoded[0].toString(),
      };
    }
  }

  return null;
}

function isSuperAdmin(ctx: { roleKey: string; permissions: string[] }) {
  return ctx.roleKey === "super_admin" || ctx.permissions.includes("*");
}

async function resolveOrderKey(admin: any, body: any) {
  const raw = String(body?.order_key ?? body?.orderKey ?? body?.order_id ?? body?.orderId ?? "").trim();
  if (isOrderKey(raw)) return { orderKey: requireOrderKey(raw), orderId: null };
  if (!isUuid(raw)) throw new Error("Enter a 32-byte order_key or an order UUID.");

  const { data: escrowRow } = await admin
    .from("market_crypto_escrows")
    .select("order_key")
    .eq("order_id", raw)
    .maybeSingle();

  const storedKey = String(escrowRow?.order_key ?? "").trim();
  return {
    orderKey: isOrderKey(storedKey) ? requireOrderKey(storedKey) : orderKeyKeccak(raw),
    orderId: raw,
  };
}

const escrowAdminAbi = [
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function settlementWalletAllowed(address wallet) view returns (bool)",
  "function updateFeeBps(uint16 newBps) external",
  "function updateFeeRecipient(address newRecipient) external",
  "function updateArbiter(address newArbiter) external",
  "function pause() external",
  "function unpause() external",
  "function setSettlementWalletAllowed(address wallet, bool allowed) external",
  "function arbiterWithdraw(bytes32 orderKey, address recipient) external",
] as const;

const ARBITER_ROLE = ethers.id("ARBITER_ROLE");
const DEFAULT_ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000";

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  try {
    const ctx = await getAdminContext(req, { requireSession: true, permissions: ["chain.admin"] });
    if (ctx instanceof Response) return ctx;

    const SB_URL = envAny("SB_URL", "SUPABASE_URL");
    const SB_SERVICE = envAny("SB_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY");
    if (!SB_URL || !SB_SERVICE) return bad("Missing Supabase env vars");

    const admin = createClient(SB_URL, SB_SERVICE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = await req.json().catch(() => ({}));
    const chain = String(body?.chain ?? "").trim();
    const action = normalizeAction(body?.action);
    const note = body?.note ? String(body.note) : null;

    if (!chain) return bad("chain required");
    if (!action) {
      return bad("action must be one of pause, unpause, update_fee_bps, update_fee_recipient, update_arbiter, allow_wallet, emergency_withdraw, rescue_deposit_tx");
    }
    if ((action === "emergency_withdraw" || action === "rescue_deposit_tx") && !isSuperAdmin(ctx)) {
      return bad("Super admin only");
    }

    const { data: cfg, error: cfgErr } = await admin
      .from("market_chain_config")
      .select("chain,rpc_url,escrow_address,fee_bps")
      .eq("chain", chain)
      .maybeSingle();
    if (cfgErr) return bad(cfgErr.message);
    if (!cfg?.escrow_address) return bad("Chain config missing escrow_address");

    const rpcUrl = resolveRpcUrlForChain(cfg.chain, cfg.rpc_url);
    const adminKey = escrowAdminKeyForChain(cfg.chain);
    const arbiterKey = arbiterKeyForChain(cfg.chain);
    if (!rpcUrl) return bad("Missing RPC URL in secrets or chain config");
    if ((action === "emergency_withdraw" || action === "rescue_deposit_tx") && !arbiterKey) {
      return bad("Missing ARBITER_PRIVATE_KEY in secrets");
    }
    if (action !== "emergency_withdraw" && !adminKey) {
      return bad("Missing ESCROW_ADMIN_PRIVATE_KEY in secrets");
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(action === "emergency_withdraw" ? arbiterKey : adminKey, provider);
    const contract = new ethers.Contract(cfg.escrow_address, escrowAdminAbi, wallet);

    let tx: { hash: string; wait: () => Promise<unknown> };
    let allowTxHash: string | null = null;
    let cleanupTxHash: string | null = null;
    let cleanupWarning: string | null = null;
    let cleanupSettlementWallet: { contract: any; wallet: string } | null = null;
    let depositTxHash: string | null = null;
    const response: Record<string, unknown> = { chain: cfg.chain, escrow_address: cfg.escrow_address, action };

    if (action === "pause" || action === "unpause") {
      tx = action === "pause" ? await contract.pause() : await contract.unpause();
    } else if (action === "update_fee_bps") {
      const feeBps = requireFeeBps(body?.fee_bps);
      tx = await contract.updateFeeBps(feeBps);
      response.fee_bps = feeBps;
    } else if (action === "update_fee_recipient") {
      const recipient = requireAddress("fee_recipient", body?.fee_recipient ?? body?.recipient);
      tx = await contract.updateFeeRecipient(recipient);
      response.fee_recipient = recipient;
    } else if (action === "update_arbiter") {
      const arbiter = requireAddress("arbiter", body?.arbiter);
      tx = await contract.updateArbiter(arbiter);
      response.arbiter = arbiter;
    } else if (action === "allow_wallet") {
      const walletAddress = requireAddress("wallet", body?.wallet);
      const allowed = requireBoolean("allowed", body?.allowed);
      tx = await contract.setSettlementWalletAllowed(walletAddress, allowed);
      response.wallet = walletAddress;
      response.allowed = allowed;
    } else if (action === "emergency_withdraw") {
      const { orderKey, orderId } = await resolveOrderKey(admin, body);
      const recipient = requireAddress("recipient", body?.recipient);
      const signerAddress = await wallet.getAddress();
      const hasArbiterRole = await contract.hasRole(ARBITER_ROLE, signerAddress);
      if (!hasArbiterRole) {
        return bad(
          `Configured arbiter signer ${signerAddress} does not have ARBITER_ROLE on this escrow contract.`,
        );
      }

      const allowed = await contract.settlementWalletAllowed(recipient);
      if (!allowed) {
        return bad("recipient not allowed. Use Allow rescue wallet first, then retry the escrow withdrawal.");
      }

      tx = await contract.arbiterWithdraw(orderKey, recipient);
      response.order_key = orderKey;
      if (orderId) response.order_id = orderId;
      response.recipient = recipient;
      response.signer = signerAddress;
    } else {
      depositTxHash = requireTxHash(body?.tx_hash ?? body?.txHash ?? body?.deposit_tx_hash ?? body?.depositTxHash);
      const receipt = await provider.getTransactionReceipt(depositTxHash);
      if (!receipt) return bad("Deposit transaction was not found on this chain.");
      if (receipt.status === 0) return bad("Deposit transaction failed on-chain.");

      const deposit = extractDepositEvent(receipt, cfg.escrow_address);
      if (!deposit) {
        return bad("No EscrowDeposited event from this chain escrow contract was found in that transaction.");
      }

      const adminWallet = new ethers.Wallet(adminKey, provider);
      const arbiterWallet = new ethers.Wallet(arbiterKey, provider);
      const adminContract = new ethers.Contract(cfg.escrow_address, escrowAdminAbi, adminWallet);
      const arbiterContract = new ethers.Contract(cfg.escrow_address, escrowAdminAbi, arbiterWallet);

      const adminAddress = await adminWallet.getAddress();
      const arbiterAddress = await arbiterWallet.getAddress();
      const hasDefaultAdminRole = await adminContract.hasRole(DEFAULT_ADMIN_ROLE, adminAddress);
      if (!hasDefaultAdminRole) {
        return bad(`Configured admin signer ${adminAddress} does not have DEFAULT_ADMIN_ROLE on this escrow contract.`);
      }
      const hasArbiterRole = await arbiterContract.hasRole(ARBITER_ROLE, arbiterAddress);
      if (!hasArbiterRole) {
        return bad(`Configured arbiter signer ${arbiterAddress} does not have ARBITER_ROLE on this escrow contract.`);
      }

      const allowed = await adminContract.settlementWalletAllowed(deposit.buyer);
      if (!allowed) {
        const allowTx = await adminContract.setSettlementWalletAllowed(deposit.buyer, true);
        allowTxHash = allowTx.hash;
        await allowTx.wait();
        cleanupSettlementWallet = { contract: adminContract, wallet: deposit.buyer };
      }

      tx = await arbiterContract.arbiterWithdraw(deposit.orderKey, deposit.buyer);
      response.deposit_tx_hash = depositTxHash;
      response.order_key = deposit.orderKey;
      response.recipient = deposit.buyer;
      response.buyer = deposit.buyer;
      response.seller = deposit.seller;
      response.token_address = deposit.token;
      response.amount_raw = deposit.amountRaw;
      response.allow_tx_hash = allowTxHash;
      response.admin_signer = adminAddress;
      response.arbiter_signer = arbiterAddress;
    }

    await tx.wait();

    if (cleanupSettlementWallet) {
      try {
        const cleanupTx = await cleanupSettlementWallet.contract.setSettlementWalletAllowed(cleanupSettlementWallet.wallet, false);
        cleanupTxHash = cleanupTx.hash;
        await cleanupTx.wait();
        response.cleanup_tx_hash = cleanupTxHash;
      } catch (cleanupError) {
        cleanupWarning = String((cleanupError as any)?.message ?? cleanupError);
        response.cleanup_warning = cleanupWarning;
      }
    }

    if (action === "update_fee_bps") {
      const { error: updateErr } = await admin
        .from("market_chain_config")
        .update({
          fee_bps: Number(response.fee_bps),
          updated_at: new Date().toISOString(),
        })
        .eq("chain", cfg.chain);
      if (updateErr) return bad(updateErr.message);
    }

    await admin.from("market_audit_logs").insert({
      actor_id: ctx.userId === "service-token" ? null : ctx.userId,
      actor_type: "admin",
      action: `STABLE_ADMIN_${String(action).toUpperCase()}`,
      entity_type: "market_chain_config",
      entity_id: null,
      payload: {
        chain: cfg.chain,
        escrow_address: cfg.escrow_address,
        tx_hash: tx.hash,
        deposit_tx_hash: depositTxHash,
        allow_tx_hash: allowTxHash,
        cleanup_tx_hash: cleanupTxHash,
        cleanup_warning: cleanupWarning,
        note,
        ...response,
      },
    });

    return ok({
      ok: true,
      tx_hash: tx.hash,
      deposit_tx_hash: depositTxHash,
      allow_tx_hash: allowTxHash,
      cleanup_tx_hash: cleanupTxHash,
      cleanup_warning: cleanupWarning,
      ...response,
    });
  } catch (e) {
    return adminError(e);
  }
});
