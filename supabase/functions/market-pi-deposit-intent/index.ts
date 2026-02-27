import { bad, methodNotAllowed, ok, unauth } from "../_shared/market/http.ts";
import { supabaseAdminClient, supabaseUserClient } from "../_shared/market/supabase.ts";
import {
  addBps,
  getPiUsdPrice,
  nowPlusSeconds,
  randomQuoteRef,
  readPiQuoteBufferBps,
  readPiQuoteTtlSeconds,
  roundUp,
  sumPaidUsd,
  toFixedString,
  toSafeNumber,
} from "../_shared/market/pi.ts";

const PI_CHAIN = "pi_testnet";

async function safeInsertIntent(admin: any, input: {
  order_id: string;
  status: string;
  amount_usd: number;
  amount_pi: number;
  quote_ref: string;
  payment_id?: string | null;
  txid?: string | null;
  failure_reason?: string | null;
}) {
  const payload = {
    order_id: input.order_id,
    intent_type: "DEPOSIT",
    status: input.status,
    chain: PI_CHAIN,
    from_wallet: null,
    to_wallet: "pi_escrow",
    amount_units: Number(toFixedString(input.amount_usd, 8)),
    amount_raw: toFixedString(input.amount_pi, 8),
    client_reference: input.payment_id || input.quote_ref,
    tx_hash: input.txid || null,
    failure_reason: input.failure_reason || null,
  };

  const { error } = await admin.from("market_crypto_intents").insert(payload);
  if (error) {
    console.warn("[market-pi-deposit-intent] intent insert skipped:", error.message);
  }
}

async function safeAudit(admin: any, payload: Record<string, unknown>) {
  const { error } = await admin.from("market_audit_logs").insert(payload);
  if (error) {
    console.warn("[market-pi-deposit-intent] audit insert skipped:", error.message);
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

  if (!order_id) return bad("order_id required");

  const { data: order, error: orderErr } = await admin
    .from("market_orders")
    .select("id,buyer_id,status,amount,currency,listing_id")
    .eq("id", order_id)
    .maybeSingle();

  if (orderErr) return bad(orderErr.message);
  if (!order) return bad("Order not found");
  if (order.buyer_id !== user.id) return bad("Not your order");
  if (String(order.status || "").toUpperCase() !== "CREATED") {
    return bad(`Order status ${order.status} is not payable`);
  }

  const { data: listing, error: listingErr } = await admin
    .from("market_listings")
    .select("id,payment_options,currency,is_active")
    .eq("id", order.listing_id)
    .maybeSingle();

  if (listingErr) return bad(listingErr.message);
  if (!listing || !listing.is_active) return bad("Listing not found or inactive");

  const po = (listing.payment_options ?? {}) as Record<string, unknown>;
  const hasRoutes =
    typeof po.allow_usdc === "boolean" ||
    typeof po.allow_usdt === "boolean" ||
    typeof po.allow_ngn === "boolean" ||
    typeof po.allow_pi === "boolean";
  const allowPi = hasRoutes ? po.allow_pi === true : false;
  if (!allowPi) return bad("Listing does not accept Pi payments");

  const orderCurrency = String(order.currency ?? "").toUpperCase();
  if (!["USDC", "USDT", "USD"].includes(orderCurrency)) {
    return bad("Pi checkout is supported only for USD-canonical listings");
  }

  const { data: paidRows, error: paidErr } = await admin
    .from("market_pi_payments")
    .select("status,paid_usd")
    .eq("order_id", order.id);
  if (paidErr) return bad(paidErr.message);

  const orderUsd = toSafeNumber(order.amount, 0);
  if (orderUsd <= 0) return bad("Invalid order amount");

  const alreadyPaidUsd = sumPaidUsd((paidRows as any[]) ?? []);
  const remainingUsd = Math.max(0, orderUsd - alreadyPaidUsd);
  if (remainingUsd <= 0) {
    return ok({
      ok: true,
      order_id: order.id,
      already_settled: true,
      order_usd_amount: Number(toFixedString(orderUsd, 8)),
      already_paid_usd: Number(toFixedString(alreadyPaidUsd, 8)),
      shortfall_usd: 0,
    });
  }

  const nowIso = new Date().toISOString();
  const { data: activeQuote } = await admin
    .from("market_pi_payments")
    .select("id,quote_ref,quote_usd_amount,quote_pi_amount,quote_price_usd,quote_expires_at,is_topup")
    .eq("order_id", order.id)
    .eq("buyer_id", user.id)
    .eq("status", "QUOTED")
    .gt("quote_expires_at", nowIso)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (activeQuote) {
    return ok({
      ok: true,
      order_id: order.id,
      quote_ref: activeQuote.quote_ref,
      quote_usd_amount: toSafeNumber(activeQuote.quote_usd_amount, remainingUsd),
      pi_amount: toSafeNumber(activeQuote.quote_pi_amount, 0),
      quote_price_usd: toSafeNumber(activeQuote.quote_price_usd, 0),
      quote_expires_at: activeQuote.quote_expires_at,
      is_topup: activeQuote.is_topup === true,
      strict_underpayment_protection: true,
      memo: activeQuote.is_topup === true
        ? `BestCity order top-up ${order.id}`
        : `BestCity order ${order.id}`,
      metadata: {
        order_id: order.id,
        quote_ref: activeQuote.quote_ref,
      },
      callbacks: {
        approve: "market-pi-payment-approve",
        complete: "market-pi-payment-complete",
        cancel: "market-pi-payment-cancel",
      },
    });
  }

  const priceUsd = await getPiUsdPrice();
  if (priceUsd <= 0) return bad("PI/USD price unavailable");

  const quoteBufferBps = readPiQuoteBufferBps();
  const ttlSec = readPiQuoteTtlSeconds();
  const bufferedUsd = addBps(remainingUsd, quoteBufferBps);
  const piAmount = roundUp(bufferedUsd / priceUsd, 8);
  if (!Number.isFinite(piAmount) || piAmount <= 0) return bad("Unable to compute Pi amount");

  const quoteRef = randomQuoteRef();
  const quoteExpiresAt = nowPlusSeconds(ttlSec);
  const isTopup = alreadyPaidUsd > 0;

  const { error: insertErr } = await admin.from("market_pi_payments").insert({
    order_id: order.id,
    buyer_id: user.id,
    quote_ref: quoteRef,
    quote_usd_amount: Number(toFixedString(remainingUsd, 8)),
    quote_pi_amount: Number(toFixedString(piAmount, 8)),
    quote_price_usd: Number(toFixedString(priceUsd, 8)),
    quote_expires_at: quoteExpiresAt,
    is_topup: isTopup,
    status: "QUOTED",
    raw: {
      quote_buffer_bps: quoteBufferBps,
      strict_underpayment_protection: true,
    },
  });
  if (insertErr) return bad(insertErr.message);

  await safeInsertIntent(admin, {
    order_id: order.id,
    status: "CREATED",
    amount_usd: remainingUsd,
    amount_pi: piAmount,
    quote_ref: quoteRef,
  });

  await safeAudit(admin, {
    actor_id: user.id,
    actor_type: "user",
    action: "PI_DEPOSIT_QUOTE_CREATED",
    entity_type: "market_orders",
    entity_id: order.id,
    payload: {
      quote_ref: quoteRef,
      quote_usd_amount: Number(toFixedString(remainingUsd, 8)),
      quote_pi_amount: Number(toFixedString(piAmount, 8)),
      quote_price_usd: Number(toFixedString(priceUsd, 8)),
      is_topup: isTopup,
      quote_expires_at: quoteExpiresAt,
    },
  });

  return ok({
    ok: true,
    order_id: order.id,
    quote_ref: quoteRef,
    quote_usd_amount: Number(toFixedString(remainingUsd, 8)),
    pi_amount: Number(toFixedString(piAmount, 8)),
    quote_price_usd: Number(toFixedString(priceUsd, 8)),
    quote_expires_at: quoteExpiresAt,
    is_topup: isTopup,
    strict_underpayment_protection: true,
    order_usd_amount: Number(toFixedString(orderUsd, 8)),
    already_paid_usd: Number(toFixedString(alreadyPaidUsd, 8)),
    shortfall_usd: Number(toFixedString(remainingUsd, 8)),
    memo: isTopup ? `BestCity order top-up ${order.id}` : `BestCity order ${order.id}`,
    metadata: {
      order_id: order.id,
      quote_ref: quoteRef,
    },
    callbacks: {
      approve: "market-pi-payment-approve",
      complete: "market-pi-payment-complete",
      cancel: "market-pi-payment-cancel",
    },
  });
});

