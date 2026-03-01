import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.87.1";

import { buildQuote, isLaunchGuardActive, resolveLiquidityUsdc, resolveSpotPriceUsdc, type StockIdentity } from "./stock.ts";
import { clampPositive, randomQuoteRef, toFixedString, toSafeNumber } from "./pi.ts";

const QUOTE_SECRET_ENV = "MARKET_STOCK_PI_QUOTE_SECRET";

export type StockPiLiquidityMetrics = {
  stock_id: string;
  pool_pi_reserved: number;
  queued_liability_pi: number;
  inflow_ema_24h: number;
  outflow_ema_24h: number;
  spent_24h_pi: number;
  coverage_ratio: number;
  flow_balance: number;
  lpi: number;
  budget_multiplier: number;
  base_budget_pi: number;
  budget_pi: number;
  available_budget_pi: number;
  sell_spread_bps: number;
  cooldown_seconds: number;
  early_exit_fee_bps: number;
  supply_release_multiplier: number;
  sells_paused: boolean;
};

export type StockPiComputedQuote = {
  side: "buy" | "sell";
  stock_id: string;
  user_id: string;
  rail: "pi";
  quote_ref: string;
  quote_signature?: string;
  quote_expires_at?: string;
  price_spot_usdc: number;
  price_execution_usdc: number;
  gross_usdc: number;
  fee_usdc: number;
  net_usdc: number;
  pi_price_usd: number;
  gross_pi: number;
  fee_pi: number;
  net_pi: number;
  quantity: number;
  price_impact_bps: number;
  slippage_bps: number;
  stress_spread_bps: number;
  fee_bps: number;
  lpi: number;
  coverage_ratio: number;
  flow_balance: number;
  early_exit_fee_bps: number;
  cooldown_seconds: number;
  supply_release_multiplier: number;
  sells_paused: boolean;
  liquidity_usdc: number;
  raw: Record<string, unknown>;
};

function round(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function round8(value: number) {
  return round(value, 8);
}

export function round12(value: number) {
  return round(value, 12);
}

function encodeBase64(bytes: Uint8Array) {
  let text = "";
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function quoteSigningSecret() {
  const secret = String(Deno.env.get(QUOTE_SECRET_ENV) || "").trim();
  if (!secret) {
    throw new Error(`Missing ${QUOTE_SECRET_ENV}`);
  }
  return secret;
}

export function stockPiQuotePayload(quote: Pick<
  StockPiComputedQuote,
  | "quote_ref"
  | "stock_id"
  | "user_id"
  | "side"
  | "price_execution_usdc"
  | "gross_usdc"
  | "fee_usdc"
  | "net_usdc"
  | "pi_price_usd"
  | "gross_pi"
  | "fee_pi"
  | "net_pi"
  | "quantity"
  | "stress_spread_bps"
  | "fee_bps"
  | "lpi"
  | "coverage_ratio"
  | "flow_balance"
  | "early_exit_fee_bps"
  | "cooldown_seconds"
  | "supply_release_multiplier"
> & { quote_expires_at: string }) {
  return [
    quote.quote_ref,
    quote.stock_id,
    quote.user_id,
    quote.side,
    toFixedString(quote.price_execution_usdc, 8),
    toFixedString(quote.gross_usdc, 8),
    toFixedString(quote.fee_usdc, 8),
    toFixedString(quote.net_usdc, 8),
    toFixedString(quote.pi_price_usd, 8),
    toFixedString(quote.gross_pi, 8),
    toFixedString(quote.fee_pi, 8),
    toFixedString(quote.net_pi, 8),
    toFixedString(quote.quantity, 12),
    String(Math.round(quote.stress_spread_bps)),
    String(Math.round(quote.fee_bps)),
    toFixedString(quote.lpi, 8),
    toFixedString(quote.coverage_ratio, 8),
    toFixedString(quote.flow_balance, 8),
    String(Math.round(quote.early_exit_fee_bps)),
    String(Math.round(quote.cooldown_seconds)),
    toFixedString(quote.supply_release_multiplier, 8),
    quote.quote_expires_at,
  ].join("|");
}

export async function signStockPiQuote(quote: Pick<
  StockPiComputedQuote,
  | "quote_ref"
  | "stock_id"
  | "user_id"
  | "side"
  | "price_execution_usdc"
  | "gross_usdc"
  | "fee_usdc"
  | "net_usdc"
  | "pi_price_usd"
  | "gross_pi"
  | "fee_pi"
  | "net_pi"
  | "quantity"
  | "stress_spread_bps"
  | "fee_bps"
  | "lpi"
  | "coverage_ratio"
  | "flow_balance"
  | "early_exit_fee_bps"
  | "cooldown_seconds"
  | "supply_release_multiplier"
> & { quote_expires_at: string }) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(quoteSigningSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(stockPiQuotePayload(quote)),
  );
  return encodeBase64(new Uint8Array(signature));
}

export async function verifyStockPiQuoteSignature(
  quote: Pick<
    StockPiComputedQuote,
    | "quote_ref"
    | "stock_id"
    | "user_id"
    | "side"
    | "price_execution_usdc"
    | "gross_usdc"
    | "fee_usdc"
    | "net_usdc"
    | "pi_price_usd"
    | "gross_pi"
    | "fee_pi"
    | "net_pi"
    | "quantity"
    | "stress_spread_bps"
    | "fee_bps"
    | "lpi"
    | "coverage_ratio"
    | "flow_balance"
    | "early_exit_fee_bps"
    | "cooldown_seconds"
    | "supply_release_multiplier"
  > & { quote_expires_at: string },
  signature: string,
) {
  const expected = await signStockPiQuote(quote);
  return expected === String(signature || "").trim();
}

export function readStockPiQuoteTtlSeconds() {
  return Math.max(30, Math.min(900, Math.floor(toSafeNumber(Deno.env.get("MARKET_STOCK_PI_QUOTE_TTL_SECONDS"), 180))));
}

export function readStockPiBaseFeeBps() {
  return Math.max(0, Math.min(400, Math.floor(toSafeNumber(Deno.env.get("MARKET_STOCK_PI_BASE_FEE_BPS"), 50))));
}

export function readStockPiSellFeeBps() {
  return Math.max(0, Math.min(800, Math.floor(toSafeNumber(Deno.env.get("MARKET_STOCK_PI_SELL_FEE_BPS"), readStockPiBaseFeeBps()))));
}

export function readStockPiBuyFeeBps() {
  return Math.max(0, Math.min(800, Math.floor(toSafeNumber(Deno.env.get("MARKET_STOCK_PI_BUY_FEE_BPS"), readStockPiBaseFeeBps()))));
}

export function newStockPiCheckoutToken() {
  return crypto.randomUUID();
}

export async function resolveStockPiMetrics(admin: SupabaseClient, stockId: string): Promise<StockPiLiquidityMetrics> {
  const { data, error } = await admin
    .from("market_stock_pi_liquidity_metrics_v")
    .select("*")
    .eq("stock_id", stockId)
    .maybeSingle();
  if (error) throw new Error(error.message);

  return {
    stock_id: stockId,
    pool_pi_reserved: toSafeNumber((data as any)?.pool_pi_reserved, 0),
    queued_liability_pi: toSafeNumber((data as any)?.queued_liability_pi, 0),
    inflow_ema_24h: toSafeNumber((data as any)?.inflow_ema_24h, 0),
    outflow_ema_24h: toSafeNumber((data as any)?.outflow_ema_24h, 0),
    spent_24h_pi: toSafeNumber((data as any)?.spent_24h_pi, 0),
    coverage_ratio: toSafeNumber((data as any)?.coverage_ratio, 1),
    flow_balance: toSafeNumber((data as any)?.flow_balance, 1),
    lpi: toSafeNumber((data as any)?.lpi, 0),
    budget_multiplier: toSafeNumber((data as any)?.budget_multiplier, 1),
    base_budget_pi: toSafeNumber((data as any)?.base_budget_pi, 0),
    budget_pi: toSafeNumber((data as any)?.budget_pi, 0),
    available_budget_pi: toSafeNumber((data as any)?.available_budget_pi, 0),
    sell_spread_bps: Math.round(toSafeNumber((data as any)?.sell_spread_bps, 0)),
    cooldown_seconds: Math.round(toSafeNumber((data as any)?.cooldown_seconds, 30)),
    early_exit_fee_bps: Math.round(toSafeNumber((data as any)?.early_exit_fee_bps, 50)),
    supply_release_multiplier: toSafeNumber((data as any)?.supply_release_multiplier, 1),
    sells_paused: Boolean((data as any)?.sells_paused),
  };
}

export async function persistStockPiMetrics(admin: SupabaseClient, metrics: StockPiLiquidityMetrics) {
  const { error } = await admin
    .from("market_stock_pi_liquidity_state")
    .upsert({
      stock_id: metrics.stock_id,
      last_budget_pi: round8(metrics.budget_pi),
      last_budget_window_used_pi: round8(metrics.spent_24h_pi),
      last_coverage_ratio: round8(metrics.coverage_ratio),
      last_flow_balance: round8(metrics.flow_balance),
      last_lpi: round8(metrics.lpi),
      last_budget_multiplier: round8(metrics.budget_multiplier),
      last_sell_spread_bps: Math.round(metrics.sell_spread_bps),
      last_cooldown_seconds: Math.round(metrics.cooldown_seconds),
      last_early_exit_fee_bps: Math.round(metrics.early_exit_fee_bps),
      last_supply_release_multiplier: round8(metrics.supply_release_multiplier),
      sells_paused: metrics.sells_paused,
      circuit_breaker_reason: metrics.sells_paused ? "lpi" : null,
      updated_at: new Date().toISOString(),
    });
  if (error) throw new Error(error.message);
}

export async function resolvePiStockMarketContext(admin: SupabaseClient, identity: StockIdentity) {
  const [spotPriceUsdc, liquidityUsdc, metrics] = await Promise.all([
    resolveSpotPriceUsdc(admin, identity.id, 0.01),
    resolveLiquidityUsdc(admin, identity),
    resolveStockPiMetrics(admin, identity.id),
  ]);

  return {
    spotPriceUsdc,
    liquidityUsdc,
    metrics,
    launchGuardActive: isLaunchGuardActive(identity),
  };
}

export function computeStockPiQuote(input: {
  stock: StockIdentity;
  userId: string;
  side: "buy" | "sell";
  amountUsdc?: number;
  quantity?: number;
  piUsdPrice: number;
  spotPriceUsdc: number;
  liquidityUsdc: number;
  metrics: StockPiLiquidityMetrics;
  launchGuardActive: boolean;
  quoteRef?: string;
}) {
  const side = input.side;
  const piUsdPrice = Math.max(0.00000001, toSafeNumber(input.piUsdPrice, 0));
  if (piUsdPrice <= 0) throw new Error("PI/USD price unavailable");

  const metrics = input.metrics;
  const baseFeeBps = side === "buy" ? readStockPiBuyFeeBps() : readStockPiSellFeeBps();
  const preview = buildQuote({
    side,
    spotPriceUsdc: input.spotPriceUsdc,
    liquidityUsdc: input.liquidityUsdc,
    amountUsdc: side === "buy" ? toSafeNumber(input.amountUsdc, 0) : undefined,
    quantity: side === "sell" ? toSafeNumber(input.quantity, 0) : undefined,
    feeBps: baseFeeBps,
    maxSlippageBps: 3000,
    launchGuardActive: input.launchGuardActive,
  });

  const supplyReleaseMultiplier = Math.max(0.25, Math.min(1, toSafeNumber(metrics.supply_release_multiplier, 1)));
  const sellSpreadBps = Math.max(0, Math.min(1200, Math.round(metrics.sell_spread_bps)));
  const cooldownSeconds = Math.max(10, Math.min(300, Math.round(metrics.cooldown_seconds)));
  const earlyExitFeeBps = Math.max(baseFeeBps, Math.min(500, Math.round(metrics.early_exit_fee_bps)));

  if (side === "sell" && metrics.sells_paused) {
    throw new Error("Pi sell queue is paused for this stock while liquidity recovers.");
  }

  if (side === "buy") {
    const grossUsdc = round8(preview.notional_usdc);
    const feeUsdc = round8(grossUsdc * (baseFeeBps / 10_000));
    const totalUsdc = round8(grossUsdc + feeUsdc);
    const adjustedQuantity = round12(preview.quantity * supplyReleaseMultiplier);
    const effectiveExecution = adjustedQuantity > 0 ? round8(grossUsdc / adjustedQuantity) : round8(preview.price_execution_usdc);
    const totalPi = round8(totalUsdc / piUsdPrice);
    const feePi = round8(feeUsdc / piUsdPrice);

    return {
      side,
      stock_id: input.stock.id,
      user_id: input.userId,
      rail: "pi" as const,
      quote_ref: input.quoteRef || randomQuoteRef(),
      price_spot_usdc: round8(preview.price_spot_usdc),
      price_execution_usdc: Math.max(0.00000001, effectiveExecution),
      gross_usdc: grossUsdc,
      fee_usdc: feeUsdc,
      net_usdc: totalUsdc,
      pi_price_usd: round8(piUsdPrice),
      gross_pi: totalPi,
      fee_pi: feePi,
      net_pi: totalPi,
      quantity: adjustedQuantity,
      price_impact_bps: round8(preview.price_impact_bps),
      slippage_bps: round8(preview.slippage_bps),
      stress_spread_bps: 0,
      fee_bps: baseFeeBps,
      lpi: round8(metrics.lpi),
      coverage_ratio: round8(metrics.coverage_ratio),
      flow_balance: round8(metrics.flow_balance),
      early_exit_fee_bps: 0,
      cooldown_seconds: cooldownSeconds,
      supply_release_multiplier: round8(supplyReleaseMultiplier),
      sells_paused: metrics.sells_paused,
      liquidity_usdc: round8(input.liquidityUsdc),
      raw: {
        preview_execution_price_usdc: round8(preview.price_execution_usdc),
        throttle_applied: supplyReleaseMultiplier < 1,
      },
    } satisfies StockPiComputedQuote;
  }

  const stressedExecution = Math.max(0.00000001, round8(preview.price_execution_usdc * (1 - sellSpreadBps / 10_000)));
  const grossUsdc = round8(stressedExecution * preview.quantity);
  const feeUsdc = round8(grossUsdc * (earlyExitFeeBps / 10_000));
  const netUsdc = round8(Math.max(0, grossUsdc - feeUsdc));
  const grossPi = round8(grossUsdc / piUsdPrice);
  const feePi = round8(feeUsdc / piUsdPrice);
  const netPi = round8(netUsdc / piUsdPrice);

  if (netPi <= 0 || netUsdc <= 0) {
    throw new Error("Sell quote fell below the minimum payout after stress adjustments.");
  }

  return {
    side,
    stock_id: input.stock.id,
    user_id: input.userId,
    rail: "pi" as const,
    quote_ref: input.quoteRef || randomQuoteRef(),
    price_spot_usdc: round8(preview.price_spot_usdc),
    price_execution_usdc: stressedExecution,
    gross_usdc: grossUsdc,
    fee_usdc: feeUsdc,
    net_usdc: netUsdc,
    pi_price_usd: round8(piUsdPrice),
    gross_pi: grossPi,
    fee_pi: feePi,
    net_pi: netPi,
    quantity: round12(preview.quantity),
    price_impact_bps: round8(preview.price_impact_bps),
    slippage_bps: round8(preview.slippage_bps + sellSpreadBps),
    stress_spread_bps: sellSpreadBps,
    fee_bps: earlyExitFeeBps,
    lpi: round8(metrics.lpi),
    coverage_ratio: round8(metrics.coverage_ratio),
    flow_balance: round8(metrics.flow_balance),
    early_exit_fee_bps: earlyExitFeeBps,
    cooldown_seconds: cooldownSeconds,
    supply_release_multiplier: round8(supplyReleaseMultiplier),
    sells_paused: metrics.sells_paused,
    liquidity_usdc: round8(input.liquidityUsdc),
    raw: {
      preview_execution_price_usdc: round8(preview.price_execution_usdc),
      circuit_breaker: metrics.sells_paused,
    },
  } satisfies StockPiComputedQuote;
}

export function stockPiQueueStatusLabel(status: unknown) {
  const value = String(status || "").trim().toUpperCase();
  if (value === "QUEUED") return "Queued";
  if (value === "PROCESSING") return "Processing";
  if (value === "PAID") return "Paid";
  if (value === "FAILED") return "Retrying";
  if (value === "CANCELLED") return "Cancelled";
  return value || "Unknown";
}

export function hasBudgetForQueue(metrics: StockPiLiquidityMetrics, payoutPi: number) {
  const required = clampPositive(payoutPi);
  return metrics.available_budget_pi >= required && metrics.pool_pi_reserved >= required;
}
