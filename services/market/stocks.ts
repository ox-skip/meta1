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

function toNum(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function fetchStocksOverviewFallback(limit = 30, offset = 0) {
  const end = Math.max(offset, offset + Math.max(1, limit) - 1);

  const { data: identities, error: listErr } = await supabase
    .from("market_stock_identities")
    .select("id,store_id,slug,name,symbol,chain,active,created_at")
    .order("created_at", { ascending: false })
    .range(offset, end);
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

  const items: StockOverviewItem[] = rows.map((r: any) => {
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

export async function fetchStocksOverview(limit = 30, offset = 0) {
  // Web builds can hit CORS/preflight failures for Edge functions; prefer direct table reads first.
  if (Platform.OS === "web") {
    try {
      return await fetchStocksOverviewFallback(limit, offset);
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
    }>("stock-feed", { mode: "list", limit, offset }, "stocks-market-data");
  } catch (e) {
    if (!shouldFallbackStockOverview(e)) throw e;
    return await fetchStocksOverviewFallback(limit, offset);
  }
}

export async function fetchStockDetail(params: {
  stock_id?: string;
  slug?: string;
  timeframe?: "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
  candle_limit?: number;
  trade_limit?: number;
}) {
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
  }>("stock-feed", {
    mode: "detail",
    stock_id: params.stock_id,
    slug: params.slug,
    timeframe: params.timeframe ?? "1m",
    candle_limit: params.candle_limit ?? 180,
    trade_limit: params.trade_limit ?? 80,
  }, "stocks-market-data", 30_000);
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

  const { data: positions, error: posErr } = await supabase
    .from("market_stock_positions")
    .select("stock_id,user_id,balance_qty,avg_cost_usdc,realized_pnl_usdc,locked_redemption_qty,updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });
  if (posErr) throw new Error(posErr.message);

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
