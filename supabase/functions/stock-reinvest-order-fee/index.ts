import { adminError, requireAdmin } from "../_shared/market/admin.ts";
import { bad, methodNotAllowed, ok } from "../_shared/market/http.ts";
import { supabaseAdminClient } from "../_shared/market/supabase.ts";

function round6(n: number) {
  return Math.round(n * 1_000_000) / 1_000_000;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  try {
    const blocked = requireAdmin(req);
    if (blocked) return blocked;

    const admin = supabaseAdminClient();
    const body = await req.json().catch(() => ({}));
    const orderId = String(body?.order_id ?? "").trim();
    const stockIdInput = String(body?.stock_id ?? "").trim() || null;
    const idemKey = String(body?.idempotency_key ?? `stock:reinvest:order:${orderId}`).trim();

    if (!orderId) return bad("order_id is required");
    if (!idemKey) return bad("idempotency_key is required");

    const { data: existing, error: existingErr } = await admin
      .from("market_stock_reinvestments")
      .select("*")
      .eq("idempotency_key", idemKey)
      .maybeSingle();
    if (existingErr) return bad(existingErr.message);
    if (existing) return ok({ ok: true, created: false, reinvestment: existing });

    const { data: order, error: orderErr } = await admin
      .from("market_orders")
      .select("id,seller_id,amount,fee_amount,status,currency")
      .eq("id", orderId)
      .maybeSingle();
    if (orderErr) return bad(orderErr.message);
    if (!order) return bad("Order not found");

    const validOrderStatus = new Set(["IN_ESCROW", "DELIVERED", "RELEASED"]);
    if (!validOrderStatus.has(String(order.status ?? ""))) {
      return bad(`Order status not eligible (${order.status})`);
    }

    let identity: any = null;
    if (stockIdInput) {
      const { data, error } = await admin
        .from("market_stock_identities")
        .select("*")
        .eq("id", stockIdInput)
        .maybeSingle();
      if (error) return bad(error.message);
      identity = data;
    } else {
      const { data, error } = await admin
        .from("market_stock_identities")
        .select("*")
        .eq("store_id", order.seller_id)
        .neq("chain", "pi_testnet")
        .maybeSingle();
      if (error) return bad(error.message);
      identity = data;
    }
    if (!identity) return bad("No stock identity found for order seller");
    if (String(identity.chain ?? "").toLowerCase() === "pi_testnet") {
      return bad("Order-fee reinvestment is only supported for the formal EVM stock identity");
    }

    const grossFee = round6(Number(order.fee_amount ?? 0) > 0 ? Number(order.fee_amount) : Number(order.amount ?? 0) * 0.01);
    if (!Number.isFinite(grossFee) || grossFee <= 0) return bad("Invalid fee amount for reinvestment");

    const opsBps = Number(identity.reinvest_ops_bps ?? 5000);
    const liquidityBps = Number(identity.reinvest_liquidity_bps ?? 4500);
    const stakingBps = Number(identity.reinvest_staking_bps ?? 500);
    if (opsBps + liquidityBps + stakingBps !== 10000) {
      return bad("Invalid reinvest bps config for stock identity");
    }

    const platformUsdc = round6(grossFee * (opsBps / 10_000));
    const liquidityUsdc = round6(grossFee * (liquidityBps / 10_000));
    const stakingUsdc = round6(grossFee - platformUsdc - liquidityUsdc);

    const { data: created, error: createErr } = await admin
      .from("market_stock_reinvestments")
      .insert({
        stock_id: identity.id,
        store_id: identity.store_id,
        order_id: order.id,
        source_type: "order_fee",
        gross_usdc: grossFee,
        platform_usdc: platformUsdc,
        liquidity_usdc: liquidityUsdc,
        staking_usdc: stakingUsdc,
        chain: identity.chain,
        status: "queued",
        idempotency_key: idemKey,
      })
      .select("*")
      .single();
    if (createErr || !created) return bad(createErr?.message ?? "Failed to create reinvestment");

    return ok({
      ok: true,
      created: true,
      reinvestment: created,
      split: {
        gross_usdc: grossFee,
        platform_usdc: platformUsdc,
        liquidity_usdc: liquidityUsdc,
        staking_usdc: stakingUsdc,
      },
    });
  } catch (e) {
    return adminError(e);
  }
});
