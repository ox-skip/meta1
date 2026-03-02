import { callFn } from "@/services/functions";
import { supabase } from "@/services/supabase";
import { Platform } from "react-native";

function isMissingFunctionError(err: unknown) {
  const msg = String((err as any)?.message ?? err ?? "");
  return /requested function was not found|function was not found|edge function not found/i.test(msg);
}

function shouldFallbackStockOverview(err: unknown) {
  const msg = String((err as any)?.message ?? err ?? "").toLowerCase();
  if (msg.includes("session") || msg.includes("jwt") || msg.includes("not authenticated")) {
    return false;
  }
  return (
    msg.includes("network") ||
    msg.includes("failed to fetch") ||
    msg.includes("load failed") ||
    msg.includes("cors") ||
    msg.includes("failed to send a request to the edge function") ||
    msg.includes("preflight") ||
    msg.includes("405") ||
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("edge function") ||
    msg.includes("column") ||
    msg.includes("schema") ||
    msg.includes("relation") ||
    isMissingFunctionError(err)
  );
}

async function callStockFn<T>(primary: string, body: any, fallback?: string, timeoutMs = 20_000) {
  try {
    return await callFn<T>(primary, body, timeoutMs);
  } catch (e) {
    if (fallback && isMissingFunctionError(e)) {
      return await callFn<T>(fallback, body, timeoutMs);
    }
    throw e;
  }
}

export type StockOverviewItem = {
  identity_id: string;
  store_id: string;
  slug: string;
  token_name: string;
  token_symbol: string;
  chain: string;
  status: string;
  market_username: string | null;
  display_name?: string | null;
  business_name: string | null;
  is_verified: boolean;
  logo_path?: string | null;
  price: number;
  market_cap: number;
  volume_24h_quote: number;
  trades_24h: number;
  last_trade_at: string | null;
  change_24h_pct?: number;
  sparkline_prices?: number[];
  created_at?: string;
};

export type StockMarketKind = "evm" | "pi" | "all";

function toNum(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function applyMarketFilter<T extends { chain?: string | null }>(rows: T[], market: StockMarketKind) {
  if (market === "all") return rows;
  return rows.filter((row) => {
    const chain = String(row?.chain ?? "").toLowerCase();
    return market === "pi" ? chain === "pi_testnet" : chain !== "pi_testnet";
  });
}

function parseStockTimeframe(input: unknown): "1m" | "5m" | "15m" | "1h" | "4h" | "1d" {
  const value = String(input ?? "1m").trim().toLowerCase();
  if (value === "1m" || value === "5m" || value === "15m" || value === "1h" || value === "4h" || value === "1d") {
    return value;
  }
  return "1m";
}

function timeframeMinutes(tf: "1m" | "5m" | "15m" | "1h" | "4h" | "1d") {
  if (tf === "1m") return 1;
  if (tf === "5m") return 5;
  if (tf === "15m") return 15;
  if (tf === "1h") return 60;
  if (tf === "4h") return 240;
  return 1440;
}

function bucketStartIso(tsIso: string, tf: "1m" | "5m" | "15m" | "1h" | "4h" | "1d") {
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

function aggregateCandles(
  rows: Array<{
    bucket_start: string;
    open_price_usdc: number;
    high_price_usdc: number;
    low_price_usdc: number;
    close_price_usdc: number;
    volume_qty: number;
    volume_usdc: number;
    trades_count: number;
  }>,
  timeframe: "1m" | "5m" | "15m" | "1h" | "4h" | "1d",
) {
  if (timeframe === "1m") return rows;

  const out = new Map<string, (typeof rows)[number]>();
  const sorted = [...rows].sort((a, b) => new Date(a.bucket_start).getTime() - new Date(b.bucket_start).getTime());

  for (const row of sorted) {
    const key = bucketStartIso(row.bucket_start, timeframe);
    const existing = out.get(key);
    if (!existing) {
      out.set(key, { ...row, bucket_start: key });
      continue;
    }
    existing.high_price_usdc = Math.max(existing.high_price_usdc, toNum(row.high_price_usdc, 0));
    existing.low_price_usdc = Math.min(existing.low_price_usdc, toNum(row.low_price_usdc, 0));
    existing.close_price_usdc = toNum(row.close_price_usdc, existing.close_price_usdc);
    existing.volume_qty += toNum(row.volume_qty, 0);
    existing.volume_usdc += toNum(row.volume_usdc, 0);
    existing.trades_count += toNum(row.trades_count, 0);
  }

  return Array.from(out.values()).sort((a, b) => new Date(a.bucket_start).getTime() - new Date(b.bucket_start).getTime());
}

function isLaunchGuardActive(stock: any, nowMs = Date.now()) {
  const guardUntil = stock?.launch_guard_until ? Date.parse(String(stock.launch_guard_until)) : Number.NaN;
  if (Number.isFinite(guardUntil) && guardUntil > nowMs) return true;
  if (!stock?.launched_at) return true;
  const launchedMs = Date.parse(String(stock.launched_at));
  if (!Number.isFinite(launchedMs)) return true;
  return (nowMs - launchedMs) / (1000 * 60 * 60) < 48;
}

function isTradingPaused(stock: any, nowMs = Date.now()) {
  if (stock?.active === false) return true;
  if (!stock?.trading_paused_until) return false;
  const pausedMs = Date.parse(String(stock.trading_paused_until));
  return Number.isFinite(pausedMs) && pausedMs > nowMs;
}

function isMissingPiSchemaError(error: unknown) {
  const msg = String((error as any)?.message ?? error ?? "").toLowerCase();
  return (
    msg.includes("market_stock_pi_") ||
    msg.includes("market_stock_quotes") ||
    msg.includes("locked_redemption_qty") ||
    msg.includes("settlement_rail") ||
    msg.includes("external_txid") ||
    msg.includes("does not exist")
  );
}

async function resolveStockIdentityFallback(params: { stock_id?: string; slug?: string }) {
  const stockId = String(params.stock_id ?? "").trim();
  const slug = String(params.slug ?? "").trim().toLowerCase();
  if (!stockId && !slug) throw new Error("Stock identity not found");

  let query = supabase
    .from("market_stock_identities")
    .select(
      "id,store_id,chain,chain_id,token_address,pool_address,slug,name,symbol,total_supply,creation_lp_usdc,launch_guard_until,trading_paused_until,active,launched_at,created_at",
    )
    .limit(1);

  query = stockId ? query.eq("id", stockId) : query.eq("slug", slug);

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Stock identity not found");
  return data;
}

async function fetchStockDetailFallback(params: {
  stock_id?: string;
  slug?: string;
  timeframe?: "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
  candle_limit?: number;
  trade_limit?: number;
}) {
  const timeframe = parseStockTimeframe(params.timeframe);
  const candleLimit = Math.max(20, Math.min(800, Math.floor(Number(params.candle_limit ?? 180))));
  const tradeLimit = Math.max(20, Math.min(300, Math.floor(Number(params.trade_limit ?? 80))));
  const identity = await resolveStockIdentityFallback(params);

  const [sellerRes, pointRes, reserveRes, reinvestRes] = await Promise.all([
    supabase
      .from("market_seller_profiles")
      .select("user_id,market_username,display_name,business_name,is_verified,logo_path,banner_path")
      .eq("user_id", identity.store_id)
      .maybeSingle(),
    supabase
      .from("market_stock_price_points")
      .select("stock_id,last_price_usdc,market_cap_usdc,updated_at")
      .eq("stock_id", identity.id)
      .maybeSingle(),
    supabase
      .from("market_stock_reserve_balance")
      .select("stock_id,store_id,reserve_usdc,updated_at")
      .eq("stock_id", identity.id)
      .maybeSingle(),
    supabase
      .from("market_stock_reinvestments")
      .select("id,source_type,gross_usdc,platform_usdc,liquidity_usdc,staking_usdc,status,tx_hash,created_at")
      .eq("stock_id", identity.id)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  if (sellerRes.error) throw new Error(sellerRes.error.message);
  if (pointRes.error) throw new Error(pointRes.error.message);
  if (reserveRes.error) throw new Error(reserveRes.error.message);
  if (reinvestRes.error) throw new Error(reinvestRes.error.message);

  let trades: any[] = [];
  {
    const tradesWithRail = await supabase
      .from("market_stock_trades")
      .select("id,stock_id,user_id,side,price_usdc,quantity,notional_usdc,fee_usdc,traded_at,chain_tx_hash,settlement_rail,external_txid")
      .eq("stock_id", identity.id)
      .order("traded_at", { ascending: false })
      .limit(tradeLimit);
    if (!tradesWithRail.error) {
      trades = tradesWithRail.data ?? [];
    } else if (isMissingPiSchemaError(tradesWithRail.error)) {
      const tradesFallback = await supabase
        .from("market_stock_trades")
        .select("id,stock_id,user_id,side,price_usdc,quantity,notional_usdc,fee_usdc,traded_at,chain_tx_hash")
        .eq("stock_id", identity.id)
        .order("traded_at", { ascending: false })
        .limit(tradeLimit);
      if (tradesFallback.error) throw new Error(tradesFallback.error.message);
      trades = (tradesFallback.data ?? []).map((row: any) => ({
        ...row,
        settlement_rail: "evm",
        external_txid: null,
      }));
    } else {
      throw new Error(tradesWithRail.error.message);
    }
  }

  let piMetrics: any = null;
  if (String(identity.chain || "").toLowerCase() === "pi_testnet") {
    const piMetricsRes = await supabase
      .from("market_stock_pi_liquidity_metrics_v")
      .select("*")
      .eq("stock_id", identity.id)
      .maybeSingle();
    if (piMetricsRes.error && !isMissingPiSchemaError(piMetricsRes.error)) {
      throw new Error(piMetricsRes.error.message);
    }
    piMetrics = piMetricsRes.error ? null : (piMetricsRes.data ?? null);
  }

  const sourceLimit = Math.max(candleLimit, candleLimit * timeframeMinutes(timeframe));
  const { data: sourceCandles, error: candleErr } = await supabase
    .from("market_stock_candles_1m")
    .select("stock_id,bucket_start,open_price_usdc,high_price_usdc,low_price_usdc,close_price_usdc,volume_qty,volume_usdc,trades_count")
    .eq("stock_id", identity.id)
    .order("bucket_start", { ascending: false })
    .limit(sourceLimit);
  if (candleErr) throw new Error(candleErr.message);

  const ascSource = [...(sourceCandles ?? [])].reverse().map((c: any) => ({
    bucket_start: String(c.bucket_start),
    open_price_usdc: toNum(c.open_price_usdc, 0),
    high_price_usdc: toNum(c.high_price_usdc, 0),
    low_price_usdc: toNum(c.low_price_usdc, 0),
    close_price_usdc: toNum(c.close_price_usdc, 0),
    volume_qty: toNum(c.volume_qty, 0),
    volume_usdc: toNum(c.volume_usdc, 0),
    trades_count: toNum(c.trades_count, 0),
  }));
  const candles = aggregateCandles(ascSource, timeframe).slice(-candleLimit);

  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id ?? null;

  let myPosition: any = null;
  if (uid) {
    let pos: any = null;
    const withLocked = await supabase
      .from("market_stock_positions")
      .select("stock_id,user_id,balance_qty,avg_cost_usdc,realized_pnl_usdc,locked_redemption_qty,updated_at")
      .eq("stock_id", identity.id)
      .eq("user_id", uid)
      .maybeSingle();
    if (!withLocked.error) {
      pos = withLocked.data ?? null;
    } else if (isMissingPiSchemaError(withLocked.error)) {
      const posFallback = await supabase
        .from("market_stock_positions")
        .select("stock_id,user_id,balance_qty,avg_cost_usdc,realized_pnl_usdc,updated_at")
        .eq("stock_id", identity.id)
        .eq("user_id", uid)
        .maybeSingle();
      if (posFallback.error) throw new Error(posFallback.error.message);
      pos = posFallback.data ? { ...posFallback.data, locked_redemption_qty: 0 } : null;
    } else {
      throw new Error(withLocked.error.message);
    }

    let piRows: any[] = [];
    if (String(identity.chain || "").toLowerCase() === "pi_testnet") {
      const piRowsRes = await supabase
        .from("market_stock_pi_redemption_queue")
        .select("id,queue_seq,status,quantity_locked,locked_net_usdc,locked_net_payout_pi,attempt_count,next_retry_at,created_at,completed_at")
        .eq("stock_id", identity.id)
        .eq("user_id", uid)
        .order("created_at", { ascending: false })
        .limit(8);
      if (piRowsRes.error && !isMissingPiSchemaError(piRowsRes.error)) throw new Error(piRowsRes.error.message);
      piRows = piRowsRes.error ? [] : (piRowsRes.data ?? []);
    }

    myPosition = {
      ...(pos || {}),
      locked_redemption_qty: Number((pos as any)?.locked_redemption_qty ?? 0),
      pi_redemptions: piRows,
    };
  }

  const cutoffIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: candles24, error: candles24Err } = await supabase
    .from("market_stock_candles_1m")
    .select("volume_usdc,trades_count")
    .eq("stock_id", identity.id)
    .gte("bucket_start", cutoffIso);
  if (candles24Err) throw new Error(candles24Err.message);

  let volume24h = 0;
  let trades24h = 0;
  for (const row of candles24 ?? []) {
    volume24h += toNum((row as any)?.volume_usdc, 0);
    trades24h += toNum((row as any)?.trades_count, 0);
  }
  if ((candles24 ?? []).length === 0) {
    volume24h = trades.reduce((acc: number, t: any) => acc + toNum(t.notional_usdc, 0), 0);
    trades24h = trades.length;
  }

  return {
    ok: true as const,
    mode: "detail" as const,
    timeframe,
    identity,
    seller: sellerRes.data ?? null,
    stats: {
      price: toNum(pointRes.data?.last_price_usdc, 0.01),
      market_cap: toNum(pointRes.data?.market_cap_usdc, 0),
      volume_24h_quote: volume24h,
      trades_24h: trades24h,
      price_point_at: pointRes.data?.updated_at ?? null,
      launch_guard_active: isLaunchGuardActive(identity),
      trading_paused: isTradingPaused(identity),
    },
    reserve: reserveRes.data ?? null,
    reinvestments: reinvestRes.data ?? [],
    candles,
    trades,
    my_position: myPosition,
    pi: {
      liquidity: piMetrics,
      my_redemptions: (myPosition as any)?.pi_redemptions ?? [],
    },
  };
}

async function fetchStocksOverviewFallback(limit = 30, offset = 0, market: StockMarketKind = "evm") {
  const end = Math.max(offset, offset + Math.max(1, limit) - 1);

  let listQuery = supabase
    .from("market_stock_identities")
    .select("id,store_id,slug,name,symbol,chain,active,created_at")
    .order("created_at", { ascending: false });

  if (market === "pi") listQuery = listQuery.eq("chain", "pi_testnet");
  if (market === "evm") listQuery = listQuery.neq("chain", "pi_testnet");

  const { data: identities, error: listErr } = await listQuery.range(offset, end);
  if (listErr) throw new Error(listErr.message);

  const rows = identities ?? [];
  const stockIds = rows.map((r: any) => String(r.id));
  const storeIds = rows.map((r: any) => String(r.store_id));

  const [sellerRes, pointRes, tradesRes, chainsRes] = await Promise.all([
    storeIds.length
      ? supabase
          .from("market_seller_profiles")
          .select("user_id,market_username,display_name,business_name,is_verified,logo_path")
          .in("user_id", storeIds)
      : Promise.resolve({ data: [] as any[], error: null } as any),
    stockIds.length
      ? supabase
          .from("market_stock_price_points")
          .select("stock_id,last_price_usdc,market_cap_usdc,updated_at")
          .in("stock_id", stockIds)
      : Promise.resolve({ data: [] as any[], error: null } as any),
    stockIds.length
      ? supabase
          .from("market_stock_trades")
          .select("stock_id,notional_usdc,price_usdc,traded_at")
          .in("stock_id", stockIds)
          .gte("traded_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
          .order("traded_at", { ascending: false })
          .limit(1000)
      : Promise.resolve({ data: [] as any[], error: null } as any),
    supabase
      .from("market_chain_config")
      .select("chain,chain_id,active")
      .eq("active", true)
      .order("created_at", { ascending: false }),
  ]);

  if (sellerRes.error) throw new Error(sellerRes.error.message);
  if (pointRes.error) throw new Error(pointRes.error.message);
  if (tradesRes.error) throw new Error(tradesRes.error.message);
  if (chainsRes.error) throw new Error(chainsRes.error.message);

  const sellerMap = new Map<string, any>((sellerRes.data ?? []).map((s: any) => [String(s.user_id), s]));
  const pointMap = new Map<string, any>((pointRes.data ?? []).map((p: any) => [String(p.stock_id), p]));

  const tradeAgg = new Map<
    string,
    { volume: number; trades: number; last: string | null; latestPrice: number | null; oldestPrice: number | null; sparkline: number[] }
  >();
  for (const row of tradesRes.data ?? []) {
    const key = String((row as any).stock_id);
    const cur = tradeAgg.get(key) ?? {
      volume: 0,
      trades: 0,
      last: null,
      latestPrice: null,
      oldestPrice: null,
      sparkline: [] as number[],
    };
    cur.volume += toNum((row as any).notional_usdc, 0);
    cur.trades += 1;
    const tradedAt = String((row as any).traded_at ?? "");
    const p = toNum((row as any).price_usdc, 0);
    if (cur.latestPrice == null && p > 0) cur.latestPrice = p;
    if (p > 0) cur.oldestPrice = p;
    if (p > 0 && cur.sparkline.length < 24) cur.sparkline.push(p);
    if (!cur.last || new Date(tradedAt).getTime() > new Date(cur.last).getTime()) cur.last = tradedAt;
    tradeAgg.set(key, cur);
  }

  const items: StockOverviewItem[] = applyMarketFilter(rows, market).map((r: any) => {
    const stockId = String(r.id);
    const point = pointMap.get(stockId);
    const seller = sellerMap.get(String(r.store_id));
    const agg = tradeAgg.get(stockId) ?? {
      volume: 0,
      trades: 0,
      last: null,
      latestPrice: null,
      oldestPrice: null,
      sparkline: [] as number[],
    };

    const lastPrice = toNum(point?.last_price_usdc, 0.01);
    const oldPrice = toNum(agg.oldestPrice, lastPrice);
    const changePct = oldPrice > 0 ? ((lastPrice - oldPrice) / oldPrice) * 100 : 0;

    return {
      identity_id: stockId,
      store_id: String(r.store_id),
      slug: String(r.slug),
      token_name: String(r.name),
      token_symbol: String(r.symbol),
      chain: String(r.chain),
      status: r?.active === false ? "PAUSED" : "ACTIVE",
      market_username: seller?.market_username ?? null,
      display_name: seller?.display_name ?? null,
      business_name: seller?.business_name ?? null,
      is_verified: Boolean(seller?.is_verified),
      logo_path: seller?.logo_path ?? null,
      price: lastPrice,
      market_cap: toNum(point?.market_cap_usdc, 0),
      volume_24h_quote: agg.volume,
      trades_24h: agg.trades,
      last_trade_at: agg.last,
      change_24h_pct: Number.isFinite(changePct) ? changePct : 0,
      sparkline_prices: agg.sparkline.length ? [...agg.sparkline].reverse() : [lastPrice],
      created_at: String(r.created_at || ""),
    };
  });

  items.sort((a, b) => {
    if (b.volume_24h_quote !== a.volume_24h_quote) return b.volume_24h_quote - a.volume_24h_quote;
    return b.market_cap - a.market_cap;
  });

  return {
    ok: true as const,
    mode: "list" as const,
    items,
    chains: chainsRes.data ?? [],
    pagination: { limit, offset },
  };
}

export async function fetchStocksOverview(limit = 30, offset = 0, market: StockMarketKind = "evm") {
  // Web builds can hit CORS/preflight failures for Edge functions; prefer direct table reads first.
  if (Platform.OS === "web") {
    try {
      return await fetchStocksOverviewFallback(limit, offset, market);
    } catch {
      // Fall through to Edge function path as a secondary attempt.
    }
  }

  try {
    return await callStockFn<{
      ok: boolean;
      mode: "list";
      items: StockOverviewItem[];
      chains: any[];
      pagination: { limit: number; offset: number };
    }>("stock-feed", { mode: "list", limit, offset, market }, "stocks-market-data");
  } catch (e) {
    if (!shouldFallbackStockOverview(e)) throw e;
    return await fetchStocksOverviewFallback(limit, offset, market);
  }
}

export async function fetchStockDetail(params: {
  stock_id?: string;
  slug?: string;
  timeframe?: "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
  candle_limit?: number;
  trade_limit?: number;
}) {
  const body = {
    mode: "detail",
    stock_id: params.stock_id,
    slug: params.slug,
    timeframe: params.timeframe ?? "1m",
    candle_limit: params.candle_limit ?? 180,
    trade_limit: params.trade_limit ?? 80,
  };

  if (Platform.OS === "web") {
    try {
      return await fetchStockDetailFallback(params);
    } catch {
      // Fall through to the edge function path.
    }
  }

  try {
    return await callStockFn<{
      ok: boolean;
      mode: "detail";
      timeframe: string;
      identity: any;
      seller: any;
      stats: {
        price: number;
        market_cap: number;
        volume_24h_quote: number;
        trades_24h: number;
        price_point_at: string | null;
        launch_guard_active: boolean;
        trading_paused: boolean;
      };
      reserve: any;
      reinvestments: any[];
      candles: any[];
      trades: any[];
      my_position: any;
      pi?: any;
    }>("stock-feed", body, "stocks-market-data", 30_000);
  } catch (e) {
    if (!shouldFallbackStockOverview(e)) throw e;
    return await fetchStockDetailFallback(params);
  }
}

export async function createStockIdentity(input: {
  name: string;
  symbol: string;
  chain?: string | null;
  slug?: string | null;
  initial_price_usdc?: number;
  tx_hash?: string;
  user_op_hash?: string;
  token_address?: string;
  pool_address?: string;
  vault_address?: string;
  staking_address?: string;
  store_key?: string;
  force_sync_existing?: boolean;
}) {
  return await callStockFn<{
    ok: boolean;
    created: boolean;
    identity: any;
    chain_config: any;
    economics: {
      creation_fee_usdc: number;
      liquidity_usdc: number;
      reserve_usdc: number;
    };
  }>("stock-create-identity", input, "stocks-create-identity");
}

export async function getStockQuote(input: {
  stock_id?: string;
  slug?: string;
  side: "buy" | "sell";
  amount_usdc?: number;
  quantity?: number;
  max_slippage_bps?: number;
}) {
  return await callStockFn<{
    ok: boolean;
    identity: any;
    wallet: any;
    quote: any;
    guardrails: any;
  }>("stock-quote", input);
}

export async function submitStockOrder(input: {
  stock_id?: string;
  slug?: string;
  side: "buy" | "sell";
  amount_usdc?: number;
  quantity?: number;
  max_slippage_bps?: number;
  tx_hash?: string;
  user_op_hash?: string;
  execution_mode?: "backend_fill" | "onchain";
  quote_snapshot?: any;
}) {
  return await callStockFn<{
    ok: boolean;
    order_id: string | null;
    trade: any;
    quote: any;
    identity: any;
    wallet: any;
    execution: any;
  }>("stock-submit-order", input, "stocks-place-trade", 35_000);
}

export async function listStockChat(input: {
  stock_id?: string;
  slug?: string;
  limit?: number;
  before?: string;
}) {
  return await callStockFn<{
    ok: boolean;
    action: "list";
    stock: any;
    messages: any[];
  }>("stock-chat", {
    action: "list",
    stock_id: input.stock_id,
    slug: input.slug,
    limit: input.limit ?? 50,
    before: input.before ?? null,
  }, "stocks-chat");
}

export async function postStockChat(input: { stock_id?: string; slug?: string; body: string }) {
  return await callStockFn<{
    ok: boolean;
    action: "post";
    stock: any;
    message: any;
  }>("stock-chat", {
    action: "post",
    stock_id: input.stock_id,
    slug: input.slug,
    body: input.body,
  }, "stocks-chat");
}

export async function fetchMyStockPortfolio() {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  const user = auth?.user;
  if (!user) throw new Error("Not authenticated");

  let positions: any[] | null = null;
  {
    const withLocked = await supabase
      .from("market_stock_positions")
      .select("stock_id,user_id,balance_qty,avg_cost_usdc,realized_pnl_usdc,locked_redemption_qty,updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });
    if (!withLocked.error) {
      positions = withLocked.data ?? [];
    } else if (String(withLocked.error.message || "").toLowerCase().includes("locked_redemption_qty")) {
      const fallback = await supabase
        .from("market_stock_positions")
        .select("stock_id,user_id,balance_qty,avg_cost_usdc,realized_pnl_usdc,updated_at")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false });
      if (fallback.error) throw new Error(fallback.error.message);
      positions = (fallback.data ?? []).map((row: any) => ({ ...row, locked_redemption_qty: 0 }));
    } else {
      throw new Error(withLocked.error.message);
    }
  }

  const rows = positions ?? [];
  const stockIds = Array.from(new Set(rows.map((p: any) => String(p.stock_id))));
  if (!stockIds.length) return { positions: [], total_value_usdc: 0 };

  const [{ data: identities, error: idErr }, { data: points, error: pointErr }] = await Promise.all([
    supabase
      .from("market_stock_identities")
      .select("id,slug,name,symbol,chain,active")
      .in("id", stockIds),
    supabase
      .from("market_stock_price_points")
      .select("stock_id,last_price_usdc,market_cap_usdc,updated_at")
      .in("stock_id", stockIds),
  ]);
  if (idErr) throw new Error(idErr.message);
  if (pointErr) throw new Error(pointErr.message);

  const identityMap = new Map((identities ?? []).map((r: any) => [String(r.id), r]));
  const pointMap = new Map((points ?? []).map((r: any) => [String(r.stock_id), r]));

  const computed = rows.map((p: any) => {
    const identity = identityMap.get(String(p.stock_id)) ?? null;
    const point = pointMap.get(String(p.stock_id));
    const priceNow = Number(point?.last_price_usdc ?? 0);
    const qty = Number(p.balance_qty ?? 0);
    const lockedQty = Number(p.locked_redemption_qty ?? 0);
    const avg = Number(p.avg_cost_usdc ?? 0);
    const value = qty * priceNow;
    const unrealized = (priceNow - avg) * qty;
    return {
      ...p,
      identity,
      locked_redemption_qty: lockedQty,
      price_now_usdc: priceNow,
      value_usdc: value,
      unrealized_pnl_usdc: unrealized,
    };
  });

  const total = computed.reduce((acc, p) => acc + Number(p.value_usdc ?? 0), 0);
  return {
    positions: computed,
    total_value_usdc: total,
  };
}
