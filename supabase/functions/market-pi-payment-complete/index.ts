import { bad, methodNotAllowed, ok, unauth } from "../_shared/market/http.ts";
import {
  getPiUsdPrice,
  piCompletePayment,
  roundDown,
  roundUp,
  sumPaidUsd,
  toFixedString,
  toSafeNumber,
} from "../_shared/market/pi.ts";
import { supabaseAdminClient, supabaseUserClient } from "../_shared/market/supabase.ts";

const PI_CHAIN = "pi_testnet";

async function safeInsertIntent(admin: any, input: {
  order_id: string;
  status: string;
  amount_usd: number;
  amount_pi: number;
  payment_id: string;
  txid?: string | null;
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
    client_reference: input.payment_id,
    tx_hash: input.txid || null,
    failure_reason: input.failure_reason || null,
  });
  if (error) {
    console.warn("[market-pi-payment-complete] intent insert skipped:", error.message);
  }
}

async function safeAudit(admin: any, payload: Record<string, unknown>) {
  const { error } = await admin.from("market_audit_logs").insert(payload);
  if (error) {
    console.warn("[market-pi-payment-complete] audit insert skipped:", error.message);
  }
}

async function transitionToInEscrow(admin: any, order: any) {
  try {
    const tr = await admin.rpc("market_transition_order_status", {
      p_order_id: order.id,
      p_expected_version: Number(order.version ?? 0),
      p_new_status: "IN_ESCROW",
      p_note: "Pi payment confirmed",
    });
    if (!tr.error) return null;
  } catch {
    // fallback below
  }

  const { error } = await admin
    .from("market_orders")
    .update({
      status: "IN_ESCROW",
      in_escrow_at: new Date().toISOString(),
      version: Number(order.version ?? 0) + 1,
    })
    .eq("id", order.id)
    .eq("status", "CREATED");

  return error ? String(error.message || "Unable to transition order to IN_ESCROW") : null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  const supabase = supabaseUserClient(req);
  const admin = supabaseAdminClient();

  const body = await req.json().catch(() => ({}));
  const order_id = String(body?.order_id ?? "").trim();
  const quote_ref = String(body?.quote_ref ?? "").trim();
  const payment_id = String(body?.payment_id ?? "").trim();
  const txid = String(body?.txid ?? "").trim();
  const checkout_token = String(body?.checkout_token ?? "").trim();

  if (!order_id) return bad("order_id required");
  if (!quote_ref) return bad("quote_ref required");
  if (!payment_id) return bad("payment_id required");
  if (!txid) return bad("txid required");

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  const user = auth?.user ?? null;
  const usingCheckoutToken = !user && !!checkout_token;
  if (authErr && !usingCheckoutToken) return unauth();
  if (!user && !usingCheckoutToken) return unauth();

  const { data: order, error: orderErr } = await admin
    .from("market_orders")
    .select("id,buyer_id,status,amount,version")
    .eq("id", order_id)
    .maybeSingle();
  if (orderErr) return bad(orderErr.message);
  if (!order) return bad("Order not found");
  if (user && order.buyer_id !== user.id) return bad("Not your order");
  if (!["CREATED", "IN_ESCROW"].includes(String(order.status || "").toUpperCase())) {
    return bad(`Order status ${order.status} cannot accept Pi completion`);
  }

  let rowQuery = admin
    .from("market_pi_payments")
    .select("id,quote_ref,payment_id,quote_pi_amount,quote_usd_amount,status,txid,paid_usd,shortfall_usd,topup_pi_required,buyer_id,checkout_token_expires_at")
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

  const existingPaymentId = String(row.payment_id || "").trim();
  if (existingPaymentId && existingPaymentId !== payment_id) return bad("Quote bound to a different payment id");

  const status = String(row.status || "").toUpperCase();
  if (status === "SETTLED") {
    return ok({
      ok: true,
      order_id,
      payment_id,
      txid: String(row.txid || txid),
      settled: true,
      idempotent: true,
    });
  }
  if (status === "UNDERPAID" && String(row.txid || "").trim() === txid) {
    return ok({
      ok: true,
      order_id,
      payment_id,
      txid,
      settled: false,
      underpaid: true,
      shortfall_usd: toSafeNumber(row.shortfall_usd, 0),
      topup_pi_required: toSafeNumber(row.topup_pi_required, 0),
      idempotent: true,
    });
  }
  if (status === "CANCELLED") return bad("Payment is cancelled");

  let completeResponse: any = {};
  try {
    completeResponse = await piCompletePayment(payment_id, txid);
  } catch (e: any) {
    const failMessage = String(e?.message || "Pi complete failed");
    await admin
      .from("market_pi_payments")
      .update({
        payment_id,
        txid,
        status: "FAILED",
        raw: { complete_error: failMessage },
      })
      .eq("id", row.id);

    await safeInsertIntent(admin, {
      order_id,
      status: "FAILED",
      amount_usd: toSafeNumber(row.quote_usd_amount, 0),
      amount_pi: toSafeNumber(row.quote_pi_amount, 0),
      payment_id,
      txid,
      failure_reason: failMessage,
    });
    return bad(failMessage);
  }

  const livePriceUsd = await getPiUsdPrice();
  if (livePriceUsd <= 0) return bad("PI/USD price unavailable");

  const piPaidRaw = toSafeNumber((completeResponse as any)?.amount, toSafeNumber(row.quote_pi_amount, 0));
  const piPaid = roundDown(piPaidRaw, 8);
  if (piPaid <= 0) return bad("Invalid Pi payment amount");

  const thisPaidUsd = roundDown(piPaid * livePriceUsd, 8);

  const { data: orderPayments, error: payErr } = await admin
    .from("market_pi_payments")
    .select("id,status,paid_usd")
    .eq("order_id", order_id);
  if (payErr) return bad(payErr.message);

  const previousPaidUsd = sumPaidUsd(
    ((orderPayments as any[]) ?? []).filter((p) => String(p.id || "") !== String(row.id || "")),
  );

  const cumulativePaidUsd = roundDown(previousPaidUsd + thisPaidUsd, 8);
  const orderUsd = toSafeNumber(order.amount, 0);
  const shortfallUsd = roundDown(Math.max(0, orderUsd - cumulativePaidUsd), 8);
  const topupPiRequired = shortfallUsd > 0 ? roundUp(shortfallUsd / livePriceUsd, 8) : 0;
  const nextStatus = shortfallUsd > 0 ? "UNDERPAID" : "SETTLED";

  const { error: updErr } = await admin
    .from("market_pi_payments")
    .update({
      payment_id,
      txid,
      status: nextStatus,
      paid_pi_amount: Number(toFixedString(piPaid, 8)),
      completion_price_usd: Number(toFixedString(livePriceUsd, 8)),
      paid_usd: Number(toFixedString(thisPaidUsd, 8)),
      cumulative_paid_usd: Number(toFixedString(cumulativePaidUsd, 8)),
      shortfall_usd: Number(toFixedString(shortfallUsd, 8)),
      topup_pi_required: Number(toFixedString(topupPiRequired, 8)),
      raw: {
        complete_response: completeResponse,
        strict_underpayment_protection: true,
      },
    })
    .eq("id", row.id);
  if (updErr) return bad(updErr.message);

  if (shortfallUsd > 0) {
    const reason = `UNDERPAID: paid_usd=${toFixedString(cumulativePaidUsd, 8)} required_usd=${toFixedString(orderUsd, 8)} shortfall_usd=${toFixedString(shortfallUsd, 8)}`;
    await safeInsertIntent(admin, {
      order_id,
      status: "FAILED",
      amount_usd: thisPaidUsd,
      amount_pi: piPaid,
      payment_id,
      txid,
      failure_reason: reason,
    });
    await safeAudit(admin, {
      actor_id: user?.id ?? null,
      actor_type: user ? "user" : "system",
      action: "PI_DEPOSIT_UNDERPAID",
      entity_type: "market_orders",
      entity_id: order_id,
      payload: {
        payment_id,
        txid,
        this_paid_usd: Number(toFixedString(thisPaidUsd, 8)),
        cumulative_paid_usd: Number(toFixedString(cumulativePaidUsd, 8)),
        required_usd: Number(toFixedString(orderUsd, 8)),
        shortfall_usd: Number(toFixedString(shortfallUsd, 8)),
        topup_pi_required: Number(toFixedString(topupPiRequired, 8)),
      },
    });
    return ok({
      ok: true,
      order_id,
      payment_id,
      txid,
      settled: false,
      underpaid: true,
      strict_underpayment_protection: true,
      this_paid_usd: Number(toFixedString(thisPaidUsd, 8)),
      cumulative_paid_usd: Number(toFixedString(cumulativePaidUsd, 8)),
      required_usd: Number(toFixedString(orderUsd, 8)),
      shortfall_usd: Number(toFixedString(shortfallUsd, 8)),
      topup_pi_required: Number(toFixedString(topupPiRequired, 8)),
    });
  }

  await safeInsertIntent(admin, {
    order_id,
    status: "CONFIRMED",
    amount_usd: thisPaidUsd,
    amount_pi: piPaid,
    payment_id,
    txid,
  });

  if (String(order.status || "").toUpperCase() === "CREATED") {
    const trErr = await transitionToInEscrow(admin, order);
    if (trErr) return bad(trErr);
  }

  await safeAudit(admin, {
    actor_id: user?.id ?? null,
    actor_type: user ? "user" : "system",
    action: "PI_DEPOSIT_CONFIRMED",
    entity_type: "market_orders",
    entity_id: order_id,
    payload: {
      payment_id,
      txid,
      this_paid_usd: Number(toFixedString(thisPaidUsd, 8)),
      cumulative_paid_usd: Number(toFixedString(cumulativePaidUsd, 8)),
      required_usd: Number(toFixedString(orderUsd, 8)),
      settled: true,
    },
  });

  return ok({
    ok: true,
    order_id,
    payment_id,
    txid,
    settled: true,
    underpaid: false,
    strict_underpayment_protection: true,
    this_paid_usd: Number(toFixedString(thisPaidUsd, 8)),
    cumulative_paid_usd: Number(toFixedString(cumulativePaidUsd, 8)),
    required_usd: Number(toFixedString(orderUsd, 8)),
    shortfall_usd: 0,
    topup_pi_required: 0,
  });
});
