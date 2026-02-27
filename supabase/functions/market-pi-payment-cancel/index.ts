import { bad, methodNotAllowed, ok, unauth } from "../_shared/market/http.ts";
import { toFixedString, toSafeNumber } from "../_shared/market/pi.ts";
import { supabaseAdminClient, supabaseUserClient } from "../_shared/market/supabase.ts";

const PI_CHAIN = "pi_testnet";

async function safeInsertIntent(admin: any, input: {
  order_id: string;
  amount_usd: number;
  amount_pi: number;
  payment_id?: string | null;
  quote_ref: string;
  failure_reason: string;
}) {
  const { error } = await admin.from("market_crypto_intents").insert({
    order_id: input.order_id,
    intent_type: "DEPOSIT",
    status: "FAILED",
    chain: PI_CHAIN,
    from_wallet: null,
    to_wallet: "pi_escrow",
    amount_units: Number(toFixedString(input.amount_usd, 8)),
    amount_raw: toFixedString(input.amount_pi, 8),
    client_reference: input.payment_id || input.quote_ref,
    tx_hash: null,
    failure_reason: input.failure_reason,
  });
  if (error) {
    console.warn("[market-pi-payment-cancel] intent insert skipped:", error.message);
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  const supabase = supabaseUserClient(req);
  const admin = supabaseAdminClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  const user = auth?.user;
  if (authErr || !user) return unauth();

  const body = await req.json().catch(() => ({}));
  const order_id = String(body?.order_id ?? "").trim();
  const quote_ref = String(body?.quote_ref ?? "").trim();
  const payment_id = String(body?.payment_id ?? "").trim();
  const reason = String(body?.reason ?? "cancelled_by_user").trim();

  if (!order_id) return bad("order_id required");
  if (!quote_ref) return bad("quote_ref required");

  const { data: order, error: orderErr } = await admin
    .from("market_orders")
    .select("id,buyer_id")
    .eq("id", order_id)
    .maybeSingle();
  if (orderErr) return bad(orderErr.message);
  if (!order) return bad("Order not found");
  if (order.buyer_id !== user.id) return bad("Not your order");

  const { data: row, error: rowErr } = await admin
    .from("market_pi_payments")
    .select("id,status,quote_usd_amount,quote_pi_amount,payment_id")
    .eq("order_id", order_id)
    .eq("buyer_id", user.id)
    .eq("quote_ref", quote_ref)
    .maybeSingle();
  if (rowErr) return bad(rowErr.message);
  if (!row) return bad("Pi quote not found");

  const status = String(row.status || "").toUpperCase();
  if (status === "SETTLED") {
    return ok({
      ok: true,
      order_id,
      quote_ref,
      payment_id: String(row.payment_id || payment_id),
      status,
      idempotent: true,
    });
  }

  const { error: updErr } = await admin
    .from("market_pi_payments")
    .update({
      payment_id: payment_id || row.payment_id || null,
      status: "CANCELLED",
      raw: { cancel_reason: reason, cancelled_at: new Date().toISOString() },
    })
    .eq("id", row.id);
  if (updErr) return bad(updErr.message);

  await safeInsertIntent(admin, {
    order_id,
    amount_usd: toSafeNumber(row.quote_usd_amount, 0),
    amount_pi: toSafeNumber(row.quote_pi_amount, 0),
    payment_id: payment_id || row.payment_id || null,
    quote_ref,
    failure_reason: `PI_CANCELLED: ${reason}`,
  });

  return ok({
    ok: true,
    order_id,
    quote_ref,
    payment_id: payment_id || row.payment_id || null,
    status: "CANCELLED",
  });
});

