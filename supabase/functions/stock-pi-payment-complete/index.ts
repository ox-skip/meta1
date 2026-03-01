import { bad, methodNotAllowed, ok, unauth } from "../_shared/market/http.ts";
import { getPiUsdPrice, piCompletePayment, toFixedString, toSafeNumber } from "../_shared/market/pi.ts";
import { supabaseAdminClient, supabaseUserClient } from "../_shared/market/supabase.ts";

const PI_AMOUNT_EPSILON = 0.0000005;

async function safeAudit(admin: any, payload: Record<string, unknown>) {
  const { error } = await admin.from("market_audit_logs").insert(payload);
  if (error) {
    console.warn("[stock-pi-payment-complete] audit insert skipped:", error.message);
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  const supabase = supabaseUserClient(req);
  const admin = supabaseAdminClient();
  const body = await req.json().catch(() => ({}));
  const stock_id = String(body?.stock_id ?? body?.identity_id ?? "").trim();
  const quote_ref = String(body?.quote_ref ?? "").trim();
  const payment_id = String(body?.payment_id ?? "").trim();
  const txid = String(body?.txid ?? "").trim();
  const checkout_token = String(body?.checkout_token ?? "").trim();

  if (!stock_id) return bad("stock_id required");
  if (!quote_ref) return bad("quote_ref required");
  if (!payment_id) return bad("payment_id required");
  if (!txid) return bad("txid required");

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  const user = auth?.user ?? null;
  const usingCheckoutToken = !user && !!checkout_token;
  if (authErr && !usingCheckoutToken) return unauth();
  if (!user && !usingCheckoutToken) return unauth();

  let query = admin
    .from("market_stock_pi_payments")
    .select("id,stock_id,user_id,order_id,quote_id,quote_ref,payment_id,status,quote_pi_amount,quote_usd_amount,paid_pi_amount,txid,checkout_token_expires_at")
    .eq("stock_id", stock_id)
    .eq("quote_ref", quote_ref);
  if (user) query = query.eq("user_id", user.id);
  if (!user && checkout_token) query = query.eq("checkout_token", checkout_token);

  const { data: row, error: rowErr } = await query.maybeSingle();
  if (rowErr) return bad(rowErr.message);
  if (!row) return bad("Pi buy payment not found");
  if (user && row.user_id !== user.id) return bad("Not your payment");

  if (!user) {
    const tokenExpiresAtMs = new Date(String((row as any)?.checkout_token_expires_at || "")).getTime();
    if (!Number.isFinite(tokenExpiresAtMs) || tokenExpiresAtMs <= Date.now()) {
      return bad("Pi checkout session expired. Start the Pi buy again.");
    }
  }

  const boundPaymentId = String(row.payment_id || "").trim();
  if (boundPaymentId && boundPaymentId !== payment_id) return bad("Quote is bound to another payment id");

  const status = String(row.status || "").toUpperCase();
  if (status === "SETTLED") {
    return ok({
      ok: true,
      stock_id,
      order_id: row.order_id,
      quote_ref,
      payment_id: String(row.payment_id || payment_id),
      txid: String((row as any).txid || txid),
      settled: true,
      paid_pi_amount: Number(toFixedString(toSafeNumber((row as any).paid_pi_amount, 0), 8)),
      idempotent: true,
    });
  }
  if (status === "CANCELLED") return bad("Pi buy payment is cancelled");

  let completeResponse: any = {};
  try {
    completeResponse = await piCompletePayment(payment_id, txid);
  } catch (e: any) {
    await admin
      .from("market_stock_pi_payments")
      .update({
        payment_id,
        txid,
        status: "FAILED",
        raw: { complete_error: String(e?.message || e || "Pi complete failed") },
      })
      .eq("id", row.id);
    return bad(String(e?.message || e || "Pi complete failed"));
  }

  const completionVerified =
    (completeResponse as any)?.status?.developer_completed === true &&
    (completeResponse as any)?.status?.transaction_verified === true;
  if (!completionVerified) {
    await admin
      .from("market_stock_pi_payments")
      .update({
        payment_id,
        txid,
        status: "FAILED",
        raw: {
          complete_response: completeResponse,
          reason: "pi_completion_unverified",
        },
      })
      .eq("id", row.id);
    return bad("Pi payment completion could not be verified server-side");
  }

  const paidPiAmount = toSafeNumber((completeResponse as any)?.amount, toSafeNumber(row.quote_pi_amount, 0));
  const quotedPiAmount = toSafeNumber(row.quote_pi_amount, 0);
  if (Math.abs(paidPiAmount - quotedPiAmount) > PI_AMOUNT_EPSILON) {
    await admin
      .from("market_stock_pi_payments")
      .update({
        payment_id,
        txid,
        status: "FAILED",
        raw: {
          complete_response: completeResponse,
          quote_pi_amount: quotedPiAmount,
          paid_pi_amount: paidPiAmount,
          reason: "pi_amount_mismatch",
        },
      })
      .eq("id", row.id);
    return bad("Pi payment amount does not match the locked quote");
  }

  const completionPriceUsd = await getPiUsdPrice();
  const { error: paymentUpdErr } = await admin
    .from("market_stock_pi_payments")
    .update({
      payment_id,
      txid,
      paid_pi_amount: Number(toFixedString(paidPiAmount, 8)),
      completion_price_usd: Number(toFixedString(completionPriceUsd, 8)),
      raw: {
        complete_response: completeResponse,
      },
    })
    .eq("id", row.id)
    .in("status", ["QUOTED", "APPROVED", "FAILED"]);
  if (paymentUpdErr) return bad(paymentUpdErr.message);

  const idemKey = `stock:pi:buy:settle:${row.id}:${payment_id}:${txid}`;
  const { data: fillRes, error: fillErr } = await admin.rpc("market_stock_pi_fill_buy", {
    p_payment_row_id: row.id,
    p_idempotency_key: idemKey,
    p_metadata: {
      txid,
      payment_id,
      complete_response: completeResponse,
    },
  });
  if (fillErr) return bad(fillErr.message);

  await safeAudit(admin, {
    actor_id: user?.id ?? null,
    actor_type: user ? "user" : "system",
    action: "STOCK_PI_BUY_SETTLED",
    entity_type: "market_stock_identities",
    entity_id: stock_id,
    payload: {
      order_id: row.order_id,
      trade_id: (fillRes as any)?.[0]?.trade_id ?? null,
      quote_ref,
      payment_id,
      txid,
      paid_pi_amount: Number(toFixedString(paidPiAmount, 8)),
      quote_usd_amount: Number(toFixedString(toSafeNumber(row.quote_usd_amount, 0), 8)),
    },
  });

  return ok({
    ok: true,
    stock_id,
    order_id: row.order_id,
    quote_ref,
    payment_id,
    txid,
    settled: true,
    paid_pi_amount: Number(toFixedString(paidPiAmount, 8)),
    new_balance_qty: (fillRes as any)?.[0]?.new_balance_qty ?? null,
    trade_id: (fillRes as any)?.[0]?.trade_id ?? null,
  });
});
