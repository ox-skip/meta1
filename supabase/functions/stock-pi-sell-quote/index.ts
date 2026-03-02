import { bad, methodNotAllowed, ok, unauth } from "../_shared/market/http.ts";
import { getPiUsdPrice } from "../_shared/market/pi.ts";
import {
  computeStockPiQuote,
  persistStockPiMetrics,
  readStockPiQuoteTtlSeconds,
  resolvePiStockMarketContext,
  signStockPiQuote,
} from "../_shared/market/stockPi.ts";
import { resolveStockIdentity, toNum } from "../_shared/market/stock.ts";
import { supabaseAdminClient, supabaseUserClient } from "../_shared/market/supabase.ts";

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
  const quantity = toNum(body?.quantity, 0);
  if (quantity <= 0) return bad("quantity must be > 0");

  try {
    const identity = await resolveStockIdentity(admin as any, { stockId, slug });
    if (!identity) return bad("Stock identity not found");
    if (identity.chain !== "pi_testnet") return bad("Pi trading is only available for Pi-native stock identities");

    const { data: wallet, error: walletErr } = await admin
      .from("crypto_wallets")
      .select("address")
      .eq("user_id", user.id)
      .eq("chain", "pi_testnet")
      .maybeSingle();
    if (walletErr) return bad(walletErr.message);
    const piUid = String((wallet as any)?.address || "").trim();
    if (!piUid) return bad("Save your PI wallet address before selling on the Pi rail.");

    const { data: position, error: posErr } = await admin
      .from("market_stock_positions")
      .select("balance_qty,locked_redemption_qty")
      .eq("stock_id", identity.id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (posErr) return bad(posErr.message);

    const availableQty = Math.max(
      0,
      toNum((position as any)?.balance_qty, 0) - toNum((position as any)?.locked_redemption_qty, 0),
    );
    if (availableQty < quantity) {
      return bad(`Insufficient unlocked balance. Available: ${availableQty.toFixed(6)} ${identity.symbol}`);
    }

    const [piUsdPrice, market] = await Promise.all([
      getPiUsdPrice(),
      resolvePiStockMarketContext(admin as any, identity),
    ]);
    await persistStockPiMetrics(admin as any, market.metrics);

    const quoteExpiresAt = new Date(Date.now() + readStockPiQuoteTtlSeconds() * 1000).toISOString();
    const quote = computeStockPiQuote({
      stock: identity,
      userId: user.id,
      side: "sell",
      quantity,
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

    const { error: quoteErr } = await admin.from("market_stock_quotes").insert({
      stock_id: identity.id,
      user_id: user.id,
      rail: "pi",
      side: "sell",
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
      raw: {
        ...quote.raw,
        recipient_pi_uid: piUid,
        available_qty: availableQty,
      },
    });
    if (quoteErr) return bad(quoteErr.message);

    return ok({
      ok: true,
      stock_id: identity.id,
      quote: {
        ...quote,
        quote_signature: quoteSignature,
        quote_expires_at: quoteExpiresAt,
      },
      liquidity: market.metrics,
      recipient_pi_uid: piUid,
      available_qty: availableQty,
    });
  } catch (e: any) {
    return bad(String(e?.message || e || "Unable to create locked sell quote"));
  }
});
