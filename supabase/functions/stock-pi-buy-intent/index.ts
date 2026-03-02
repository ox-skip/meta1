import { bad, methodNotAllowed, ok, unauth } from "../_shared/market/http.ts";
import { getPiUsdPrice } from "../_shared/market/pi.ts";
import {
  computeStockPiQuote,
  newStockPiCheckoutToken,
  persistStockPiMetrics,
  readStockPiQuoteTtlSeconds,
  resolvePiStockMarketContext,
  signStockPiQuote,
} from "../_shared/market/stockPi.ts";
import { resolveStockIdentity, toNum } from "../_shared/market/stock.ts";
import { supabaseAdminClient, supabaseUserClient } from "../_shared/market/supabase.ts";

async function safeAudit(admin: any, payload: Record<string, unknown>) {
  const { error } = await admin.from("market_audit_logs").insert(payload);
  if (error) {
    console.warn("[stock-pi-buy-intent] audit insert skipped:", error.message);
  }
}

async function cleanupBuyIntent(admin: any, orderId?: string | null, quoteId?: string | null) {
  if (quoteId) {
    await admin.from("market_stock_quotes").delete().eq("id", quoteId).then(() => null).catch(() => null);
  }
  if (orderId) {
    const { error } = await admin.from("market_stock_orders").delete().eq("id", orderId);
    if (error) {
      await admin
        .from("market_stock_orders")
        .update({
          status: "failed",
          fail_reason: "Pi buy intent setup rolled back",
        })
        .eq("id", orderId)
        .then(() => null)
        .catch(() => null);
    }
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  const userClient = supabaseUserClient(req);
  const admin = supabaseAdminClient();
  const { data: auth, error: authErr } = await userClient.auth.getUser();
  const user = auth?.user;
  if (authErr || !user) return unauth();

  const body = await req.json().catch(() => ({}));
  const stockId = String(body?.stock_id ?? body?.identity_id ?? "").trim();
  const slug = String(body?.slug ?? "").trim().toLowerCase();
  const amountUsdc = toNum(body?.amount_usdc, 0);
  if (amountUsdc <= 0) return bad("amount_usdc must be > 0");

  try {
    const identity = await resolveStockIdentity(admin as any, { stockId, slug });
    if (!identity) return bad("Stock identity not found");
    if (identity.chain !== "pi_testnet") return bad("Pi trading is only available for Pi-native stock identities");

    const [piUsdPrice, market] = await Promise.all([
      getPiUsdPrice(),
      resolvePiStockMarketContext(admin as any, identity),
    ]);
    await persistStockPiMetrics(admin as any, market.metrics);

    const ttlSeconds = readStockPiQuoteTtlSeconds();
    const quoteExpiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const quote = computeStockPiQuote({
      stock: identity,
      userId: user.id,
      side: "buy",
      amountUsdc,
      piUsdPrice,
      spotPriceUsdc: market.spotPriceUsdc,
      liquidityUsdc: market.liquidityUsdc,
      metrics: market.metrics,
      launchGuardActive: market.launchGuardActive,
    });

    const quoteSignature = await signStockPiQuote({
      ...quote,
      quote_expires_at: quoteExpiresAt,
    });
    const checkoutToken = newStockPiCheckoutToken();

    let orderId: string | null = null;
    let quoteRowId: string | null = null;

    const { data: order, error: orderErr } = await admin
      .from("market_stock_orders")
      .insert({
        stock_id: identity.id,
        user_id: user.id,
        side: "buy",
        quote_price_usdc: quote.price_execution_usdc,
        amount_usdc: quote.gross_usdc,
        slippage_bps: Math.round(quote.slippage_bps),
        max_price_impact_bps: Math.round(quote.price_impact_bps),
        settlement_rail: "pi",
        quote_ref: quote.quote_ref,
        status: "pending",
      })
      .select("*")
      .single();
    if (orderErr || !order) return bad(orderErr?.message ?? "Unable to create stock order");
    orderId = String(order.id);

    const { data: quoteRow, error: quoteErr } = await admin
      .from("market_stock_quotes")
      .insert({
        stock_id: identity.id,
        user_id: user.id,
        rail: "pi",
        side: "buy",
        quote_ref: quote.quote_ref,
        quote_signature: quoteSignature,
        quote_expires_at: quoteExpiresAt,
        price_spot_usdc: quote.price_spot_usdc,
        price_execution_usdc: quote.price_execution_usdc,
        gross_usdc: quote.gross_usdc,
        fee_usdc: quote.fee_usdc,
        net_usdc: quote.net_usdc,
        pi_price_usd: quote.pi_price_usd,
        gross_pi: quote.gross_pi,
        fee_pi: quote.fee_pi,
        net_pi: quote.net_pi,
        quantity: quote.quantity,
        price_impact_bps: Math.round(quote.price_impact_bps),
        slippage_bps: Math.round(quote.slippage_bps),
        stress_spread_bps: Math.round(quote.stress_spread_bps),
        fee_bps: Math.round(quote.fee_bps),
        lpi: quote.lpi,
        coverage_ratio: quote.coverage_ratio,
        flow_balance: quote.flow_balance,
        early_exit_fee_bps: Math.round(quote.early_exit_fee_bps),
        cooldown_seconds: Math.round(quote.cooldown_seconds),
        supply_release_multiplier: quote.supply_release_multiplier,
        raw: quote.raw,
      })
      .select("*")
      .single();
    if (quoteErr || !quoteRow) {
      await cleanupBuyIntent(admin, orderId, null);
      return bad(quoteErr?.message ?? "Unable to create Pi quote");
    }
    quoteRowId = String(quoteRow.id);

    const { error: paymentErr } = await admin.from("market_stock_pi_payments").insert({
      stock_id: identity.id,
      user_id: user.id,
      order_id: order.id,
      quote_id: quoteRow.id,
      quote_ref: quote.quote_ref,
      checkout_token: checkoutToken,
      checkout_token_expires_at: quoteExpiresAt,
      quote_pi_amount: quote.gross_pi,
      quote_usd_amount: quote.net_usdc,
      quantity: quote.quantity,
      status: "QUOTED",
      raw: {
        quote_signature: quoteSignature,
        quote_fee_bps: quote.fee_bps,
        supply_release_multiplier: quote.supply_release_multiplier,
      },
    });
    if (paymentErr) {
      await cleanupBuyIntent(admin, orderId, quoteRowId);
      return bad(paymentErr.message);
    }

    await safeAudit(admin, {
      actor_id: user.id,
      actor_type: "user",
      action: "STOCK_PI_BUY_INTENT_CREATED",
      entity_type: "market_stock_identities",
      entity_id: identity.id,
      payload: {
        order_id: order.id,
        quote_ref: quote.quote_ref,
        quantity: quote.quantity,
        gross_usdc: quote.gross_usdc,
        fee_usdc: quote.fee_usdc,
        gross_pi: quote.gross_pi,
        quote_expires_at: quoteExpiresAt,
      },
    });

    return ok({
      ok: true,
      stock_id: identity.id,
      slug: identity.slug,
      order_id: order.id,
      quote: {
        ...quote,
        quote_signature: quoteSignature,
        quote_expires_at: quoteExpiresAt,
      },
      checkout_token: checkoutToken,
      callbacks: {
        approve: "stock-pi-payment-approve",
        complete: "stock-pi-payment-complete",
        cancel: "stock-pi-payment-cancel",
      },
      liquidity: market.metrics,
    });
  } catch (e: any) {
    return bad(String(e?.message || e || "Unable to create Pi buy intent"));
  }
});
