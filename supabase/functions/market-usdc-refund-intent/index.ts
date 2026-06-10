import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { ethers } from "https://esm.sh/ethers@6.16.0";
import { adminError, requireAdmin } from "../_shared/market/admin.ts";
import { resolveRpcUrlForChain } from "../_shared/market/chainRpc.ts";
import { insertCryptoIntent } from "../_shared/market/cryptoIntent.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

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

function normalizeOrderKey(value: unknown) {
  const raw = String(value ?? "").trim();
  const withPrefix = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(withPrefix)) {
    throw new Error("Stored escrow order_key must be a 32-byte hex value");
  }
  return withPrefix;
}

// Minimal ABI for refund()
const escrowAbi = [
  "function refund(bytes32 orderKey) external",
] as const;

serve(async (req) => {
  let admin: any = null;
  let order_id = "";
  let esc: any = null;

  try {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return json(405, { ok: false, message: "Method not allowed" });

    const authFail = await requireAdmin(req);
    if (authFail) return authFail;

    const SB_URL = envAny("SB_URL", "SUPABASE_URL");
    const SB_SERVICE = envAny("SB_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY");
    if (!SB_URL || !SB_SERVICE) return json(500, { ok: false, message: "Missing Supabase env vars" });

    admin = createClient(SB_URL, SB_SERVICE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = await req.json().catch(() => ({}));
    order_id = String(body?.order_id ?? "");
    const reason = String(body?.reason ?? "admin_refund");

    if (!order_id) return json(400, { ok: false, message: "order_id required" });

    const { data: order } = await admin
      .from("market_orders")
      .select("id,currency,status")
      .eq("id", order_id)
      .maybeSingle();

    if (!order) return json(404, { ok: false, message: "Order not found" });
    if (!["USDC", "USDT"].includes(String(order.currency || "").toUpperCase())) {
      return json(400, { ok: false, message: "Order must be USDC or USDT" });
    }

    const allowedStatuses = new Set(["IN_ESCROW", "OUT_FOR_DELIVERY", "DELIVERED", "DELIVERABLE_UPLOADED", "DISPUTED"]);
    if (!allowedStatuses.has(String(order.status || "").toUpperCase())) {
      return json(400, { ok: false, message: `Cannot refund from status: ${order.status}` });
    }

    const escRes = await admin
      .from("market_crypto_escrows")
      .select("order_id,order_key,escrow_address,buyer_wallet,seller_wallet,token_address,amount_units,amount_raw,chain")
      .eq("order_id", order_id)
      .maybeSingle();
    esc = escRes.data as any;

    if (!esc?.order_key || !esc?.escrow_address) return json(404, { ok: false, message: "Crypto escrow mapping missing" });
    const orderKey = normalizeOrderKey(esc.order_key);

    const { data: cfg } = await admin
      .from("market_chain_config")
      .select("rpc_url,chain")
      .eq("chain", esc.chain)
      .maybeSingle();

    const rpcUrl = resolveRpcUrlForChain(esc.chain, cfg?.rpc_url);
    const arbiterKey = arbiterKeyForChain(esc.chain);

    if (!rpcUrl || !arbiterKey) {
      return json(500, { ok: false, message: "Missing RPC URL or ARBITER_PRIVATE_KEY in secrets" });
    }

    await insertCryptoIntent(admin, {
      orderId: order_id,
      intentType: "REFUND",
      status: "PROCESSING",
      chain: esc.chain,
      fromWallet: esc.seller_wallet,
      toWallet: esc.buyer_wallet,
      tokenAddress: esc.token_address,
      escrowAddress: esc.escrow_address,
      amountUnits: Number(esc.amount_units ?? 0),
      amountRaw: esc.amount_raw ?? null,
      orderKey,
    });

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(arbiterKey, provider);
    const contract = new ethers.Contract(esc.escrow_address, escrowAbi, wallet);

    const tx = await contract.refund(orderKey);

    await insertCryptoIntent(admin, {
      orderId: order_id,
      intentType: "REFUND",
      status: "SUBMITTED",
      chain: esc.chain,
      fromWallet: esc.seller_wallet,
      toWallet: esc.buyer_wallet,
      tokenAddress: esc.token_address,
      escrowAddress: esc.escrow_address,
      amountUnits: Number(esc.amount_units ?? 0),
      amountRaw: esc.amount_raw ?? null,
      txHash: tx.hash,
      orderKey,
    });

    await admin.from("market_audit_logs").insert({
      actor_id: null,
      actor_type: "admin",
      action: `STABLE_REFUND_SUBMITTED`,
      entity_type: "market_orders",
      entity_id: order_id,
      payload: { reason, tx_hash: tx.hash, order_key: orderKey, chain: esc.chain, currency: order.currency },
    });

    return json(200, {
      ok: true,
      order_id,
      order_key: orderKey,
      tx_hash: tx.hash,
      message: "Refund tx submitted. Indexer will finalize status once confirmed.",
    });
  } catch (e: unknown) {
    if (admin && order_id && esc) {
      const msg = e instanceof Error ? e.message : String(e || "refund_failed");
      try {
        await insertCryptoIntent(admin, {
          orderId: order_id,
          intentType: "REFUND",
          status: "FAILED",
          chain: esc.chain,
          fromWallet: esc.seller_wallet ?? null,
          toWallet: esc.buyer_wallet ?? null,
          tokenAddress: esc.token_address,
          escrowAddress: esc.escrow_address,
          amountUnits: Number(esc.amount_units ?? 0),
          amountRaw: esc.amount_raw ?? null,
          failureReason: msg,
          orderKey: esc.order_key,
        });
      } catch {
        // Best-effort failure bookkeeping only.
      }
    }
    return adminError(e);
  }
});
