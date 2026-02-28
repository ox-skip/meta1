import { bad, methodNotAllowed, ok, unauth } from "../_shared/market/http.ts";
import { piApprovePayment, toFixedString, toSafeNumber } from "../_shared/market/pi.ts";
import { supabaseAdminClient, supabaseUserClient } from "../_shared/market/supabase.ts";

const PI_CHAIN = "pi_testnet";

async function safeInsertIntent(admin: any, input: {
  order_id: string;
  status: string;
  amount_usd: number;
  amount_pi: number;
  payment_id: string;
  quote_ref: string;
  failure_reason?: string | null;
}) {
  const { error } = await admin.from("market_crypto_intents").insert({
    order_id: input.order_id,
    intent_type: "DEPOSIT",
    status: input.status,
    chain: PI_CHAIN,
    from_wallet: null,
    to_wallet: "pi_escrow",
    amount_units: Number(toFixedString(input.amount_usd, 8)),
    amount_raw: toFixedString(input.amount_pi, 8),
    client_reference: input.payment_id || input.quote_ref,
    tx_hash: null,
    failure_reason: input.failure_reason || null,
  });
  if (error) {
    console.warn("[market-pi-payment-approve] intent insert skipped:", error.message);
  }
}

async function safeAudit(admin: any, payload: Record<string, unknown>) {
  const { error } = await admin.from("market_audit_logs").insert(payload);
  if (error) {
    console.warn("[market-pi-payment-approve] audit insert skipped:", error.message);
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  const supabase = supabaseUserClient(req);
  const admin = supabaseAdminClient();

  const body = await req.json().catch(() => ({}));
  const order_id = String(body?.order_id ?? "").trim();
  const quote_ref = String(body?.quote_ref ?? "").trim();
  const payment_id = String(body?.payment_id ?? "").trim();
  const checkout_token = String(body?.checkout_token ?? "").trim();

  if (!order_id) return bad("order_id required");
  if (!quote_ref) return bad("quote_ref required");
  if (!payment_id) return bad("payment_id required");

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  const user = auth?.user ?? null;
  const usingCheckoutToken = !user && !!checkout_token;
  if (authErr && !usingCheckoutToken) return unauth();
  if (!user && !usingCheckoutToken) return unauth();

  const { data: order, error: orderErr } = await admin
    .from("market_orders")
    .select("id,buyer_id,status")
    .eq("id", order_id)
    .maybeSingle();
  if (orderErr) return bad(orderErr.message);
  if (!order) return bad("Order not found");
  if (user && order.buyer_id !== user.id) return bad("Not your order");
  if (String(order.status || "").toUpperCase() !== "CREATED") return bad(`Order status ${order.status} is not payable`);

  let rowQuery = admin
    .from("market_pi_payments")
    .select("id,quote_ref,payment_id,quote_expires_at,status,quote_usd_amount,quote_pi_amount,buyer_id,checkout_token,checkout_token_expires_at")
    .eq("order_id", order_id)
    .eq("quote_ref", quote_ref);

  if (user) rowQuery = rowQuery.eq("buyer_id", user.id);
  if (!user && checkout_token) rowQuery = rowQuery.eq("checkout_token", checkout_token);

  const { data: row, error: rowErr } = await rowQuery.maybeSingle();
  if (rowErr) return bad(rowErr.message);
  if (!row) return bad("Pi quote not found");
  if (user && row.buyer_id !== user.id) return bad("Not your quote");
  if (!user) {
    const tokenExpiresAtMs = new Date(String((row as any)?.checkout_token_expires_at || "")).getTime();
    if (!Number.isFinite(tokenExpiresAtMs) || tokenExpiresAtMs <= Date.now()) {
      return bad("Pi checkout session expired. Start Pi checkout again.");
    }
  }

  const status = String(row.status || "").toUpperCase();
  if (["SETTLED", "UNDERPAID", "CANCELLED"].includes(status)) {
    return ok({
      ok: true,
      order_id,
      quote_ref,
      payment_id: String(row.payment_id || payment_id),
      status,
      idempotent: true,
    });
  }

  const now = Date.now();
  const exp = new Date(String(row.quote_expires_at || "")).getTime();
  if (!Number.isFinite(exp) || exp <= now) return bad("Quote expired. Request a new Pi quote.");

  const existingPaymentId = String(row.payment_id || "").trim();
  if (existingPaymentId && existingPaymentId !== payment_id) {
    return bad("Quote already bound to a different payment id");
  }

  try {
    await piApprovePayment(payment_id);
  } catch (e: any) {
    const failMessage = String(e?.message || "Pi approve failed");
    await admin
      .from("market_pi_payments")
      .update({
        payment_id,
        status: "FAILED",
        raw: { approve_error: failMessage },
      })
      .eq("id", row.id);

    await safeInsertIntent(admin, {
      order_id,
      status: "FAILED",
      amount_usd: toSafeNumber(row.quote_usd_amount, 0),
      amount_pi: toSafeNumber(row.quote_pi_amount, 0),
      payment_id,
      quote_ref,
      failure_reason: failMessage,
    });
    return bad(failMessage);
  }

  const { error: updErr } = await admin
    .from("market_pi_payments")
    .update({
      payment_id,
      status: "APPROVED",
      raw: { approved_at: new Date().toISOString() },
    })
    .eq("id", row.id);
  if (updErr) return bad(updErr.message);

  await safeInsertIntent(admin, {
    order_id,
    status: "SUBMITTED",
    amount_usd: toSafeNumber(row.quote_usd_amount, 0),
    amount_pi: toSafeNumber(row.quote_pi_amount, 0),
    payment_id,
    quote_ref,
  });

  await safeAudit(admin, {
    actor_id: user?.id ?? null,
    actor_type: user ? "user" : "system",
    action: "PI_DEPOSIT_APPROVED",
    entity_type: "market_orders",
    entity_id: order_id,
    payload: { quote_ref, payment_id },
  });

  return ok({
    ok: true,
    order_id,
    quote_ref,
    payment_id,
    status: "APPROVED",
  });
});
