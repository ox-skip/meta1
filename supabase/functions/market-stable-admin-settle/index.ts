import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { ethers } from "https://esm.sh/ethers@6.16.0";

import { adminError, requireAdmin } from "../_shared/market/admin.ts";
import { resolveRpcUrlForChain } from "../_shared/market/chainRpc.ts";
import { bad, methodNotAllowed, ok } from "../_shared/market/http.ts";

type Decision = "RELEASE" | "REFUND";

function envAny(...names: string[]) {
  for (const n of names) {
    const v = Deno.env.get(n);
    if (v && v.trim().length > 0) return v.trim();
  }
  return "";
}

function arbiterKeyForChain(chain: string) {
  const upper = chain.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  return envAny(`ARBITER_PRIVATE_KEY_${upper}`, "ARBITER_PRIVATE_KEY");
}

const escrowAbi = [
  "function arbiterRelease(bytes32 orderKey) external",
  "function refund(bytes32 orderKey) external",
] as const;

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  try {
    const authFail = await requireAdmin(req);
    if (authFail) return authFail;

    const SB_URL = envAny("SB_URL", "SUPABASE_URL");
    const SB_SERVICE = envAny("SB_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY");
    if (!SB_URL || !SB_SERVICE) return bad("Missing Supabase env vars");

    const admin = createClient(SB_URL, SB_SERVICE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = await req.json().catch(() => ({}));
    const order_id = String(body?.order_id ?? "");
    const decision = String(body?.decision ?? "").toUpperCase() as Decision;
    const note = body?.note ? String(body.note) : null;

    if (!order_id) return bad("order_id required");
    if (!["RELEASE", "REFUND"].includes(decision)) return bad("decision must be RELEASE or REFUND");

    const { data: order } = await admin
      .from("market_orders")
      .select("id,currency,status")
      .eq("id", order_id)
      .maybeSingle();
    if (!order) return bad("Order not found");
    if (!["USDC", "USDT"].includes(String(order.currency || "").toUpperCase())) {
      return bad("Order must be USDC or USDT");
    }

    const releaseStatuses = new Set(["IN_ESCROW", "DELIVERED", "DELIVERABLE_UPLOADED", "DISPUTED"]);
    const refundStatuses = new Set(["IN_ESCROW", "OUT_FOR_DELIVERY", "DELIVERED", "DELIVERABLE_UPLOADED", "DISPUTED"]);
    const orderStatus = String(order.status || "").toUpperCase();
    if (decision === "RELEASE" && !releaseStatuses.has(orderStatus)) {
      return bad(`Cannot release from status: ${order.status}`);
    }
    if (decision === "REFUND" && !refundStatuses.has(orderStatus)) {
      return bad(`Cannot refund from status: ${order.status}`);
    }

    const { data: esc } = await admin
      .from("market_crypto_escrows")
      .select("order_id,order_key,escrow_address,buyer_wallet,seller_wallet,amount_units,amount_raw,chain")
      .eq("order_id", order_id)
      .maybeSingle();
    if (!esc?.order_key || !esc?.escrow_address) return bad("Crypto escrow mapping missing");

    const { data: cfg } = await admin
      .from("market_chain_config")
      .select("rpc_url,chain")
      .eq("chain", esc.chain)
      .maybeSingle();

    const rpcUrl = resolveRpcUrlForChain(esc.chain, cfg?.rpc_url);
    const arbiterKey = arbiterKeyForChain(esc.chain);
    if (!rpcUrl || !arbiterKey) {
      return bad("Missing RPC URL or ARBITER_PRIVATE_KEY in secrets");
    }

    const intentType = decision === "RELEASE" ? "RELEASE" : "REFUND";
    const fromWallet = decision === "RELEASE" ? esc.escrow_address : esc.escrow_address;
    const toWallet = decision === "RELEASE" ? esc.seller_wallet : esc.buyer_wallet;

    await admin.rpc("market_set_crypto_intent", {
      p_order_id: order_id,
      p_intent_type: intentType,
      p_status: "PROCESSING",
      p_from_wallet: fromWallet,
      p_to_wallet: toWallet,
      p_amount_units: Number(esc.amount_units ?? 0),
      p_amount_raw: esc.amount_raw ?? null,
      p_tx_hash: null,
      p_failure_reason: null,
    });

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(arbiterKey, provider);
    const contract = new ethers.Contract(esc.escrow_address, escrowAbi, wallet);

    const tx =
      decision === "RELEASE"
        ? await contract.arbiterRelease(esc.order_key)
        : await contract.refund(esc.order_key);

    await admin.rpc("market_set_crypto_intent", {
      p_order_id: order_id,
      p_intent_type: intentType,
      p_status: "SUBMITTED",
      p_from_wallet: fromWallet,
      p_to_wallet: toWallet,
      p_amount_units: Number(esc.amount_units ?? 0),
      p_amount_raw: esc.amount_raw ?? null,
      p_tx_hash: tx.hash,
      p_failure_reason: null,
    });

    await admin.from("market_audit_logs").insert({
      actor_id: null,
      actor_type: "admin",
      action: `STABLE_${decision}_SUBMITTED`,
      entity_type: "market_orders",
      entity_id: order_id,
      payload: { note, tx_hash: tx.hash, order_key: esc.order_key, chain: esc.chain },
    });

    return ok({
      ok: true,
      order_id,
      chain: esc.chain,
      decision,
      tx_hash: tx.hash,
      message: `${decision} tx submitted. Chain confirmation will finalize the order state.`,
    });
  } catch (e) {
    return adminError(e);
  }
});
