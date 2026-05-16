import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { ethers } from "https://esm.sh/ethers@6.16.0";

import { adminError, requireAdmin } from "../_shared/market/admin.ts";
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
  | "emergency_withdraw";

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
    raw === "arbiter_withdraw"
  ) {
    return raw === "arbiter_withdraw" ? "emergency_withdraw" : raw;
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
  if (!/^0x[a-fA-F0-9]{64}$/.test(raw)) throw new Error("order_key must be a 32-byte hex value");
  return raw;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(value);
}

function isOrderKey(value: string) {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
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
    orderKey: isOrderKey(storedKey) ? storedKey : orderKeyKeccak(raw),
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

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  try {
    const authFail = await requireAdmin(req, { requireSession: true, permissions: ["chain.admin"] });
    if (authFail) return authFail;

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
      return bad("action must be one of pause, unpause, update_fee_bps, update_fee_recipient, update_arbiter, allow_wallet, emergency_withdraw");
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
    if (action === "emergency_withdraw" && !arbiterKey) {
      return bad("Missing ARBITER_PRIVATE_KEY in secrets");
    }
    if (action !== "emergency_withdraw" && !adminKey) {
      return bad("Missing ESCROW_ADMIN_PRIVATE_KEY in secrets");
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(action === "emergency_withdraw" ? arbiterKey : adminKey, provider);
    const contract = new ethers.Contract(cfg.escrow_address, escrowAdminAbi, wallet);

    let tx: { hash: string; wait: () => Promise<unknown> };
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
    } else {
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
    }

    await tx.wait();

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
      actor_id: null,
      actor_type: "admin",
      action: `STABLE_ADMIN_${String(action).toUpperCase()}`,
      entity_type: "market_chain_config",
      entity_id: null,
      payload: {
        chain: cfg.chain,
        escrow_address: cfg.escrow_address,
        tx_hash: tx.hash,
        note,
        ...response,
      },
    });

    return ok({
      ok: true,
      tx_hash: tx.hash,
      ...response,
    });
  } catch (e) {
    return adminError(e);
  }
});
