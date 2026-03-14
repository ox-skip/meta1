import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.87.1";

export type StockSide = "buy" | "sell";

export type StockIdentity = {
  id: string;
  store_id: string;
  chain: string;
  chain_id: number;
  token_address: string | null;
  pool_address: string | null;
  slug: string;
  name: string;
  symbol: string;
  total_supply: number;
  creation_lp_usdc: number;
  launch_guard_until: string | null;
  trading_paused_until: string | null;
  active: boolean;
  launched_at: string | null;
};

export type StockQuote = {
  side: StockSide;
  price_spot_usdc: number;
  price_execution_usdc: number;
  quantity: number;
  notional_usdc: number;
  fee_usdc: number;
  price_impact_bps: number;
  slippage_bps: number;
  max_trade_usdc: number;
  cooldown_seconds: number;
  liquidity_usdc: number;
  launch_guard_active: boolean;
};

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function toNum(input: unknown, fallback = 0) {
  const n = Number(input);
  return Number.isFinite(n) ? n : fallback;
}

export function parseSide(input: unknown): StockSide | null {
  const v = String(input ?? "")
    .trim()
    .toLowerCase();
  if (v === "buy" || v === "sell") return v;
  return null;
}

export function parseTimeframe(input: unknown): "1m" | "5m" | "15m" | "1h" | "4h" | "1d" {
  const v = String(input ?? "1m")
    .trim()
    .toLowerCase();
  if (v === "1m" || v === "5m" || v === "15m" || v === "1h" || v === "4h" || v === "1d") return v;
  return "1m";
}

export function timeframeMinutes(tf: "1m" | "5m" | "15m" | "1h" | "4h" | "1d") {
  if (tf === "1m") return 1;
  if (tf === "5m") return 5;
  if (tf === "15m") return 15;
  if (tf === "1h") return 60;
  if (tf === "4h") return 240;
  return 1440;
}

export function bucketStartIso(tsIso: string, tf: "1m" | "5m" | "15m" | "1h" | "4h" | "1d") {
  const d = new Date(tsIso);
  if (!Number.isFinite(d.getTime())) return new Date().toISOString();
  const m = timeframeMinutes(tf);
  const minutes = d.getUTCMinutes();
  const flooredMinute = Math.floor(minutes / m) * m;
  d.setUTCSeconds(0, 0);
  if (m < 60) {
    d.setUTCMinutes(flooredMinute);
  } else if (m === 60) {
    d.setUTCMinutes(0);
  } else if (m === 240) {
    d.setUTCMinutes(0);
    d.setUTCHours(Math.floor(d.getUTCHours() / 4) * 4);
  } else {
    d.setUTCMinutes(0);
    d.setUTCHours(0);
  }
  return d.toISOString();
}

export async function resolveStockIdentity(
  admin: SupabaseClient,
  args: { stockId?: string | null; slug?: string | null },
) {
  const stockId = String(args.stockId ?? "").trim();
  const slug = String(args.slug ?? "").trim().toLowerCase();

  if (!stockId && !slug) return null;

  let q = admin
    .from("market_stock_identities")
    .select(
      "id,store_id,chain,chain_id,token_address,pool_address,slug,name,symbol,total_supply,creation_lp_usdc,launch_guard_until,trading_paused_until,active,launched_at",
    )
    .limit(1);

  if (stockId) q = q.eq("id", stockId);
  else q = q.eq("slug", slug);

  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  return {
    id: String(data.id),
    store_id: String(data.store_id),
    chain: String(data.chain),
    chain_id: toNum(data.chain_id, 0),
    token_address: data.token_address ? String(data.token_address) : null,
    pool_address: data.pool_address ? String(data.pool_address) : null,
    slug: String(data.slug),
    name: String(data.name),
    symbol: String(data.symbol),
    total_supply: toNum(data.total_supply, 100_000_000),
    creation_lp_usdc: toNum(data.creation_lp_usdc, 0),
    launch_guard_until: data.launch_guard_until ? String(data.launch_guard_until) : null,
    trading_paused_until: data.trading_paused_until ? String(data.trading_paused_until) : null,
    active: Boolean(data.active),
    launched_at: data.launched_at ? String(data.launched_at) : null,
  } as StockIdentity;
}

export async function resolveLiquidityUsdc(admin: SupabaseClient, stock: StockIdentity) {
  const { data, error } = await admin
    .from("market_stock_reinvestments")
    .select("liquidity_usdc,status")
    .eq("stock_id", stock.id)
    .in("status", ["submitted", "confirmed"]);

  if (error) throw new Error(error.message);

  const reinvested = (data ?? []).reduce((acc: number, row: any) => acc + toNum(row.liquidity_usdc, 0), 0);
  return Math.max(1, stock.creation_lp_usdc + reinvested);
}

export async function resolveSpotPriceUsdc(admin: SupabaseClient, stockId: string, fallback = 0.01) {
  const { data, error } = await admin
    .from("market_stock_price_points")
    .select("last_price_usdc")
    .eq("stock_id", stockId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return Math.max(0.000001, toNum(data?.last_price_usdc, fallback));
}

export function isLaunchGuardActive(stock: StockIdentity, nowMs = Date.now()) {
  const guardUntil = stock.launch_guard_until ? Date.parse(stock.launch_guard_until) : NaN;
  if (Number.isFinite(guardUntil) && guardUntil > nowMs) return true;
  if (!stock.launched_at) return true;
  const launchedMs = Date.parse(stock.launched_at);
  if (!Number.isFinite(launchedMs)) return true;
  const hoursSince = (nowMs - launchedMs) / (1000 * 60 * 60);
  return hoursSince < 48;
}

export function isTradingPaused(stock: StockIdentity, nowMs = Date.now()) {
  if (!stock.active) return true;
  if (!stock.trading_paused_until) return false;
  const pausedMs = Date.parse(stock.trading_paused_until);
  return Number.isFinite(pausedMs) && pausedMs > nowMs;
}

export function buildQuote(input: {
  side: StockSide;
  spotPriceUsdc: number;
  liquidityUsdc: number;
  amountUsdc?: number;
  quantity?: number;
  feeBps?: number;
  maxSlippageBps?: number;
  launchGuardActive: boolean;
}) {
  const side = input.side;
  const feeBps = clamp(toNum(input.feeBps, 50), 0, 300);
  const maxSlippageBps = clamp(toNum(input.maxSlippageBps, 1200), 50, 5000);
  const spot = Math.max(0.000001, toNum(input.spotPriceUsdc, 0.01));
  const liquidityUsdc = Math.max(1, toNum(input.liquidityUsdc, 1));

  const amountUsdc = Math.max(0, toNum(input.amountUsdc, 0));
  const quantity = Math.max(0, toNum(input.quantity, 0));
  if (side === "buy" && amountUsdc <= 0) {
    throw new Error("amount_usdc must be > 0 for buy orders");
  }
  if (side === "sell" && quantity <= 0) {
    throw new Error("quantity must be > 0 for sell orders");
  }

  const maxTradeRatio = input.launchGuardActive ? 0.1 : 0.2;
  // Product requirement: allow users to attempt up to $20 per trade from quote layer.
  // On-chain bootstrap guardrails still apply and can reject above-chain limits.
  const maxTradeUsdc = Math.max(liquidityUsdc * maxTradeRatio, 20);

  const notionalPreImpact = side === "buy" ? amountUsdc : quantity * spot;
  if (notionalPreImpact > maxTradeUsdc) {
    throw new Error(`Order exceeds max size (${maxTradeUsdc.toFixed(6)} USDC)`);
  }

  const impactRawBps = (notionalPreImpact / liquidityUsdc) * 5000;
  const impactBps = clamp(impactRawBps, 1, input.launchGuardActive ? 1200 : 2200);
  const execution = side === "buy"
    ? spot * (1 + impactBps / 10_000)
    : Math.max(0.000001, spot * (1 - impactBps / 10_000));
  const slippageBps = Math.abs(((execution - spot) / spot) * 10_000);
  if (slippageBps > maxSlippageBps) {
    throw new Error(`Slippage too high (${slippageBps.toFixed(2)} bps > ${maxSlippageBps} bps)`);
  }

  const notional = side === "buy" ? amountUsdc : quantity * execution;
  const qty = side === "buy" ? notional / execution : quantity;
  const fee = notional * (feeBps / 10_000);

  const quote: StockQuote = {
    side,
    price_spot_usdc: spot,
    price_execution_usdc: execution,
    quantity: qty,
    notional_usdc: notional,
    fee_usdc: fee,
    price_impact_bps: impactBps,
    slippage_bps: slippageBps,
    max_trade_usdc: maxTradeUsdc,
    cooldown_seconds: 10,
    liquidity_usdc: liquidityUsdc,
    launch_guard_active: input.launchGuardActive,
  };

  return quote;
}

type CandleRow = {
  bucket_start: string;
  open_price_usdc: number;
  high_price_usdc: number;
  low_price_usdc: number;
  close_price_usdc: number;
  volume_qty: number;
  volume_usdc: number;
  trades_count: number;
};

export function aggregateCandles(
  rows: CandleRow[],
  timeframe: "1m" | "5m" | "15m" | "1h" | "4h" | "1d",
): CandleRow[] {
  if (timeframe === "1m") return rows;

  const sorted = [...rows].sort(
    (a, b) => new Date(a.bucket_start).getTime() - new Date(b.bucket_start).getTime(),
  );
  const out = new Map<string, CandleRow>();

  for (const row of sorted) {
    const key = bucketStartIso(row.bucket_start, timeframe);
    const existing = out.get(key);
    if (!existing) {
      out.set(key, {
        bucket_start: key,
        open_price_usdc: toNum(row.open_price_usdc, 0),
        high_price_usdc: toNum(row.high_price_usdc, 0),
        low_price_usdc: toNum(row.low_price_usdc, 0),
        close_price_usdc: toNum(row.close_price_usdc, 0),
        volume_qty: toNum(row.volume_qty, 0),
        volume_usdc: toNum(row.volume_usdc, 0),
        trades_count: toNum(row.trades_count, 0),
      });
      continue;
    }
    existing.high_price_usdc = Math.max(existing.high_price_usdc, toNum(row.high_price_usdc, 0));
    existing.low_price_usdc = Math.min(existing.low_price_usdc, toNum(row.low_price_usdc, 0));
    existing.close_price_usdc = toNum(row.close_price_usdc, existing.close_price_usdc);
    existing.volume_qty += toNum(row.volume_qty, 0);
    existing.volume_usdc += toNum(row.volume_usdc, 0);
    existing.trades_count += toNum(row.trades_count, 0);
  }

  return Array.from(out.values()).sort(
    (a, b) => new Date(a.bucket_start).getTime() - new Date(b.bucket_start).getTime(),
  );
}
