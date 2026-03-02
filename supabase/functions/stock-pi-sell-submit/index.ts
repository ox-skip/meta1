import { bad, methodNotAllowed, ok, unauth } from "../_shared/market/http.ts";
import { verifyStockPiQuoteSignature } from "../_shared/market/stockPi.ts";
import { supabaseAdminClient, supabaseUserClient } from "../_shared/market/supabase.ts";

async function safeAudit(admin: any, payload: Record<string, unknown>) {
  const { error } = await admin.from("market_audit_logs").insert(payload);
  if (error) {
    console.warn("[stock-pi-sell-submit] audit insert skipped:", error.message);
  }
}

async function loadQueueSnapshot(admin: any, queueId: string, stockId: string) {
  const { data: queueRow, error: queueErr } = await admin
    .from("market_stock_pi_redemption_queue")
    .select("id,order_id,queue_seq,status,locked_net_payout_pi,locked_net_usdc,quantity_locked")
    .eq("id", queueId)
    .maybeSingle();
  if (queueErr) throw new Error(queueErr.message);
  if (!queueRow) return null;

  let queuePosition = 1;
  if (queueRow?.queue_seq) {
    const { count, error: countErr } = await admin
      .from("market_stock_pi_redemption_queue")
      .select("id", { count: "exact", head: true })
      .eq("stock_id", stockId)
      .in("status", ["QUEUED", "PROCESSING"])
      .lte("queue_seq", Number(queueRow.queue_seq));
    if (countErr) throw new Error(countErr.message);
    queuePosition = Math.max(1, Number(count ?? 1));
  }

  return {
    queue_id: queueRow.id,
    order_id: queueRow.order_id,
    queue_status: queueRow.status,
    queue_seq: queueRow.queue_seq,
    queue_position: queuePosition,
    locked_payout_pi: Number((queueRow as any).locked_net_payout_pi ?? 0),
    locked_net_usdc: Number((queueRow as any).locked_net_usdc ?? 0),
    locked_quantity: Number((queueRow as any).quantity_locked ?? 0),
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  const userClient = supabaseUserClient(req);
  const admin = supabaseAdminClient();
  const { data: auth, error: authErr } = await userClient.auth.getUser();
  const user = auth?.user;
  if (authErr || !user) return unauth();

  const body = await req.json().catch(() => ({}));
  const stock_id = String(body?.stock_id ?? body?.identity_id ?? "").trim();
  const quote_ref = String(body?.quote_ref ?? "").trim();
  const quote_signature = String(body?.quote_signature ?? "").trim();
  if (!stock_id) return bad("stock_id required");
  if (!quote_ref) return bad("quote_ref required");
  if (!quote_signature) return bad("quote_signature required");

  try {
    const { data: identity, error: identityErr } = await admin
      .from("market_stock_identities")
      .select("id,chain")
      .eq("id", stock_id)
      .maybeSingle();
    if (identityErr) return bad(identityErr.message);
    if (!identity) return bad("Stock identity not found");
    if (String(identity.chain || "").toLowerCase() !== "pi_testnet") {
      return bad("Pi trading is only available for Pi-native stock identities");
    }

    const { data: quote, error: quoteErr } = await admin
      .from("market_stock_quotes")
      .select("*")
      .eq("stock_id", stock_id)
      .eq("user_id", user.id)
      .eq("quote_ref", quote_ref)
      .maybeSingle();
    if (quoteErr) return bad(quoteErr.message);
    if (!quote) return bad("Locked sell quote not found");

    const expiresAtMs = new Date(String((quote as any)?.quote_expires_at || "")).getTime();
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      await admin.from("market_stock_quotes").update({ status: "EXPIRED" }).eq("id", quote.id);
      return bad("Locked sell quote expired");
    }
    if (String((quote as any)?.status || "").toUpperCase() === "CONSUMED") {
      const { data: existingQueue } = await admin
        .from("market_stock_pi_redemption_queue")
        .select("id")
        .eq("quote_id", quote.id)
        .maybeSingle();
      if (existingQueue) {
        const snapshot = await loadQueueSnapshot(admin, String(existingQueue.id), stock_id);
        if (!snapshot) return bad("Locked sell quote queue entry was not found");
        return ok({
          ok: true,
          stock_id,
          ...snapshot,
          cooldown_seconds: Number((quote as any).cooldown_seconds ?? 0),
          lpi: Number((quote as any).lpi ?? 0),
          idempotent: true,
        });
      }
      return bad("Locked sell quote already consumed");
    }

    const signatureValid = quote_signature === String((quote as any)?.quote_signature || "").trim()
      && await verifyStockPiQuoteSignature(
        {
          quote_ref: String((quote as any).quote_ref),
          stock_id: String((quote as any).stock_id),
          user_id: String((quote as any).user_id),
          side: String((quote as any).side) as "buy" | "sell",
          price_execution_usdc: Number((quote as any).price_execution_usdc ?? 0),
          gross_usdc: Number((quote as any).gross_usdc ?? 0),
          fee_usdc: Number((quote as any).fee_usdc ?? 0),
          net_usdc: Number((quote as any).net_usdc ?? 0),
          pi_price_usd: Number((quote as any).pi_price_usd ?? 0),
          gross_pi: Number((quote as any).gross_pi ?? 0),
          fee_pi: Number((quote as any).fee_pi ?? 0),
          net_pi: Number((quote as any).net_pi ?? 0),
          quantity: Number((quote as any).quantity ?? 0),
          stress_spread_bps: Number((quote as any).stress_spread_bps ?? 0),
          fee_bps: Number((quote as any).fee_bps ?? 0),
          lpi: Number((quote as any).lpi ?? 0),
          coverage_ratio: Number((quote as any).coverage_ratio ?? 0),
          flow_balance: Number((quote as any).flow_balance ?? 0),
          early_exit_fee_bps: Number((quote as any).early_exit_fee_bps ?? 0),
          cooldown_seconds: Number((quote as any).cooldown_seconds ?? 0),
          supply_release_multiplier: Number((quote as any).supply_release_multiplier ?? 1),
          quote_expires_at: String((quote as any).quote_expires_at),
        },
        quote_signature,
      );
    if (!signatureValid) return bad("Sell quote signature invalid");

    const { data: wallet, error: walletErr } = await admin
      .from("crypto_wallets")
      .select("address")
      .eq("user_id", user.id)
      .eq("chain", "pi_testnet")
      .maybeSingle();
    if (walletErr) return bad(walletErr.message);
    const piUid = String((wallet as any)?.address || "").trim();
    if (!piUid) return bad("Save your PI wallet address before selling on the Pi rail.");

    const existingOrderRes = await admin
      .from("market_stock_orders")
      .select("*")
      .eq("stock_id", stock_id)
      .eq("user_id", user.id)
      .eq("side", "sell")
      .eq("quote_ref", quote_ref)
      .maybeSingle();
    if (existingOrderRes.error) return bad(existingOrderRes.error.message);

    let order = existingOrderRes.data ?? null;
    if (!order) {
      const orderInsert = await admin
        .from("market_stock_orders")
        .insert({
          stock_id,
          user_id: user.id,
          side: "sell",
          quote_price_usdc: Number((quote as any).price_execution_usdc ?? 0),
          quantity: Number((quote as any).quantity ?? 0),
          slippage_bps: Math.round(Number((quote as any).slippage_bps ?? 0)),
          max_price_impact_bps: Math.round(Number((quote as any).price_impact_bps ?? 0)),
          settlement_rail: "pi",
          quote_ref,
          status: "pending",
        })
        .select("*")
        .single();
      if (orderInsert.error) return bad(orderInsert.error.message);
      order = orderInsert.data ?? null;
    }
    if (!order) return bad("Unable to create sell order");

    const idemKey = `stock:pi:sell:lock:${quote.id}:${user.id}`;
    const { data: rpcRes, error: rpcErr } = await admin.rpc("market_stock_pi_lock_sell", {
      p_quote_id: quote.id,
      p_order_id: order.id,
      p_stock_id: stock_id,
      p_user_id: user.id,
      p_quote_ref: quote_ref,
      p_recipient_pi_uid: piUid,
      p_recipient_wallet: piUid,
      p_idempotency_key: idemKey,
      p_metadata: {
        quote_signature,
        submitted_at: new Date().toISOString(),
      },
    });
    if (rpcErr) {
      await admin
        .from("market_stock_orders")
        .update({
          status: "failed",
          fail_reason: rpcErr.message,
        })
        .eq("id", order.id)
        .eq("user_id", user.id);
      return bad(rpcErr.message);
    }

    const queueId = String((rpcRes as any)?.[0]?.queue_id || "").trim();
    const lockedOrderId = String((rpcRes as any)?.[0]?.order_id || order.id).trim();
    if (queueId && lockedOrderId && lockedOrderId !== String(order.id)) {
      await admin
        .from("market_stock_orders")
        .update({
          status: "cancelled",
          fail_reason: "Pi sell replay reused an existing queue entry",
        })
        .eq("id", order.id)
        .eq("user_id", user.id)
        .eq("status", "pending");
    }
    const queueSnapshot = queueId ? await loadQueueSnapshot(admin, queueId, stock_id) : null;

    await safeAudit(admin, {
      actor_id: user.id,
      actor_type: "user",
      action: "STOCK_PI_SELL_LOCKED",
      entity_type: "market_stock_identities",
      entity_id: stock_id,
      payload: {
        order_id: lockedOrderId || order.id,
        queue_id: queueId,
        quote_ref,
        locked_payout_pi: Number((quote as any).net_pi ?? 0),
        locked_net_usdc: Number((quote as any).net_usdc ?? 0),
      },
    });

    return ok({
      ok: true,
      stock_id,
      order_id: lockedOrderId || order.id,
      queue_id: queueSnapshot?.queue_id ?? queueId,
      queue_status: queueSnapshot?.queue_status ?? "QUEUED",
      queue_seq: queueSnapshot?.queue_seq ?? null,
      queue_position: queueSnapshot?.queue_position ?? 1,
      locked_payout_pi: queueSnapshot?.locked_payout_pi ?? Number((quote as any).net_pi ?? 0),
      locked_net_usdc: queueSnapshot?.locked_net_usdc ?? Number((quote as any).net_usdc ?? 0),
      locked_quantity: queueSnapshot?.locked_quantity ?? Number((quote as any).quantity ?? 0),
      cooldown_seconds: Number((quote as any).cooldown_seconds ?? 0),
      lpi: Number((quote as any).lpi ?? 0),
    });
  } catch (e: any) {
    return bad(String(e?.message || e || "Unable to submit Pi sell"));
  }
});
