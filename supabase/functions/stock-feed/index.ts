import { bad, methodNotAllowed, ok } from "../_shared/market/http.ts";
import { supabaseAdminClient, supabaseUserClient } from "../_shared/market/supabase.ts";
import {
  aggregateCandles,
  isLaunchGuardActive,
  isTradingPaused,
  parseTimeframe,
  resolveStockIdentity,
  timeframeMinutes,
  toNum,
} from "../_shared/market/stock.ts";

function toInt(input: unknown, fallback: number, min: number, max: number) {
  const n = Number(input);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function parseMarket(input: unknown): "evm" | "pi" | "all" {
  const value = String(input ?? "evm").trim().toLowerCase();
  if (value === "pi" || value === "all") return value;
  return "evm";
}

function isMissingPiSchemaError(error: unknown) {
  const msg = String((error as any)?.message ?? error ?? "").toLowerCase();
  return (
    msg.includes("market_stock_pi_") ||
    msg.includes("market_stock_quotes") ||
    msg.includes("locked_redemption_qty") ||
    msg.includes("does not exist")
  );
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  const admin = supabaseAdminClient();
  const userClient = supabaseUserClient(req);
  const body = await req.json().catch(() => ({}));
  const mode = String(body?.mode ?? "list").trim().toLowerCase();

  if (mode === "list") {
    const limit = toInt(body?.limit, 30, 1, 100);
    const offset = toInt(body?.offset, 0, 0, 5000);
    const market = parseMarket(body?.market);

    let listQuery = admin
      .from("market_stock_identities")
      .select("id,store_id,slug,name,symbol,chain,active,launch_guard_until,trading_paused_until,launched_at,created_at")
      .neq("active", false)
      .order("created_at", { ascending: false });
    if (market === "pi") listQuery = listQuery.eq("chain", "pi_testnet");
    if (market === "evm") listQuery = listQuery.neq("chain", "pi_testnet");
    const { data: identities, error: listErr } = await listQuery.range(offset, offset + limit - 1);
    if (listErr) return bad(listErr.message);

    const rows = identities ?? [];
    const stockIds = rows.map((r: any) => String(r.id));
    const storeIds = rows.map((r: any) => String(r.store_id));

    const [sellerRes, pointRes, tradesRes, chainsRes] = await Promise.all([
      storeIds.length
        ? admin
          .from("market_seller_profiles")
          .select("user_id,market_username,display_name,business_name,is_verified,logo_path")
          .in("user_id", storeIds)
        : Promise.resolve({ data: [] as any[], error: null } as any),
      stockIds.length
        ? admin
          .from("market_stock_price_points")
          .select("stock_id,last_price_usdc,market_cap_usdc,updated_at")
          .in("stock_id", stockIds)
        : Promise.resolve({ data: [] as any[], error: null } as any),
      stockIds.length
        ? admin
          .from("market_stock_trades")
          .select("stock_id,notional_usdc,price_usdc,traded_at")
          .in("stock_id", stockIds)
          .gte("traded_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
          .order("traded_at", { ascending: false })
          .limit(1000)
        : Promise.resolve({ data: [] as any[], error: null } as any),
      admin
        .from("market_chain_config")
        .select("chain,chain_id,active,identity_factory,identity_router,identity_name_registry,identity_stable_address")
        .eq("active", true)
        .order("created_at", { ascending: false }),
    ]);

    if (sellerRes.error) return bad(sellerRes.error.message);
    if (pointRes.error) return bad(pointRes.error.message);
    if (tradesRes.error) return bad(tradesRes.error.message);
    if (chainsRes.error) return bad(chainsRes.error.message);

    const sellerMap = new Map<string, any>((sellerRes.data ?? []).map((s: any) => [String(s.user_id), s]));
    const pointMap = new Map<string, any>((pointRes.data ?? []).map((p: any) => [String(p.stock_id), p]));
    const tradeAgg = new Map<
      string,
      {
        volume: number;
        trades: number;
        last: string | null;
        latestPrice: number | null;
        oldestPrice: number | null;
        sparkline: number[];
      }
    >();
    for (const row of (tradesRes.data ?? [])) {
      const key = String((row as any).stock_id);
      const cur = tradeAgg.get(key) ?? {
        volume: 0,
        trades: 0,
        last: null,
        latestPrice: null,
        oldestPrice: null,
        sparkline: [],
      };
      cur.volume += toNum((row as any).notional_usdc, 0);
      cur.trades += 1;
      const t = String((row as any).traded_at ?? "");
      const p = toNum((row as any).price_usdc, 0);
      if (cur.latestPrice == null && p > 0) cur.latestPrice = p;
      if (p > 0) cur.oldestPrice = p;
      if (p > 0 && cur.sparkline.length < 24) cur.sparkline.push(p);
      if (!cur.last || new Date(t).getTime() > new Date(cur.last).getTime()) cur.last = t;
      tradeAgg.set(key, cur);
    }

    const items = rows.map((r: any) => {
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
      const paused = isTradingPaused({
        ...r,
        chain_id: 0,
        total_supply: 10_000_000,
        creation_lp_usdc: 45,
      } as any);
      const guard = isLaunchGuardActive({
        ...r,
        chain_id: 0,
        total_supply: 10_000_000,
        creation_lp_usdc: 45,
      } as any);
      const status = paused ? "PAUSED" : guard ? "BOOTSTRAP" : "ACTIVE";
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
        status,
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
        created_at: String(r.created_at),
      };
    }).sort((a, b) => {
      if (b.volume_24h_quote !== a.volume_24h_quote) return b.volume_24h_quote - a.volume_24h_quote;
      return b.market_cap - a.market_cap;
    });

    return ok({
      ok: true,
      mode: "list",
      items,
      chains: chainsRes.data ?? [],
      pagination: { limit, offset },
    });
  }

  const stockId = String(body?.stock_id ?? body?.identity_id ?? "").trim();
  const slug = String(body?.slug ?? "").trim().toLowerCase();
  const timeframe = parseTimeframe(body?.timeframe);
  const candleLimit = toInt(body?.candle_limit, 140, 20, 800);
  const tradeLimit = toInt(body?.trade_limit, 50, 20, 300);

  const identity = await resolveStockIdentity(admin as any, { stockId, slug });
  if (!identity) return bad("Stock identity not found");

  const [sellerRes, pointRes, reserveRes, reinvestRes] = await Promise.all([
    admin
      .from("market_seller_profiles")
      .select("user_id,market_username,display_name,business_name,is_verified,logo_path,banner_path")
      .eq("user_id", identity.store_id)
      .maybeSingle(),
    admin
      .from("market_stock_price_points")
      .select("stock_id,last_price_usdc,market_cap_usdc,updated_at")
      .eq("stock_id", identity.id)
      .maybeSingle(),
    admin
      .from("market_stock_reserve_balance")
      .select("stock_id,store_id,reserve_usdc,updated_at")
      .eq("stock_id", identity.id)
      .maybeSingle(),
    admin
      .from("market_stock_reinvestments")
      .select("id,source_type,gross_usdc,platform_usdc,liquidity_usdc,staking_usdc,status,tx_hash,created_at")
      .eq("stock_id", identity.id)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  if (sellerRes.error) return bad(sellerRes.error.message);
  if (pointRes.error) return bad(pointRes.error.message);
  if (reserveRes.error) return bad(reserveRes.error.message);
  if (reinvestRes.error) return bad(reinvestRes.error.message);

  let trades: any[] = [];
  {
    const tradesWithRail = await admin
      .from("market_stock_trades")
      .select("id,stock_id,user_id,side,price_usdc,quantity,notional_usdc,fee_usdc,traded_at,chain_tx_hash,settlement_rail,external_txid")
      .eq("stock_id", identity.id)
      .order("traded_at", { ascending: false })
      .limit(tradeLimit);
    if (!tradesWithRail.error) {
      trades = tradesWithRail.data ?? [];
    } else if (isMissingPiSchemaError(tradesWithRail.error)) {
      const tradesFallback = await admin
        .from("market_stock_trades")
        .select("id,stock_id,user_id,side,price_usdc,quantity,notional_usdc,fee_usdc,traded_at,chain_tx_hash")
        .eq("stock_id", identity.id)
        .order("traded_at", { ascending: false })
        .limit(tradeLimit);
      if (tradesFallback.error) return bad(tradesFallback.error.message);
      trades = (tradesFallback.data ?? []).map((row: any) => ({
        ...row,
        settlement_rail: "evm",
        external_txid: null,
      }));
    } else {
      return bad(tradesWithRail.error.message);
    }
  }

  let piMetrics: any = null;
  if (identity.chain === "pi_testnet") {
    const piMetricsRes = await admin
      .from("market_stock_pi_liquidity_metrics_v")
      .select("*")
      .eq("stock_id", identity.id)
      .maybeSingle();
    if (piMetricsRes.error && !isMissingPiSchemaError(piMetricsRes.error)) {
      return bad(piMetricsRes.error.message);
    }
    piMetrics = piMetricsRes.error ? null : (piMetricsRes.data ?? null);
  }

  const multiplier = timeframeMinutes(timeframe);
  const sourceLimit = Math.max(candleLimit, candleLimit * multiplier);
  const { data: sourceCandles, error: candleErr } = await admin
    .from("market_stock_candles_1m")
    .select("stock_id,bucket_start,open_price_usdc,high_price_usdc,low_price_usdc,close_price_usdc,volume_qty,volume_usdc,trades_count")
    .eq("stock_id", identity.id)
    .order("bucket_start", { ascending: false })
    .limit(sourceLimit);
  if (candleErr) return bad(candleErr.message);

  const ascSource = [...(sourceCandles ?? [])].reverse() as any[];
  const candles = aggregateCandles(
    ascSource.map((c) => ({
      bucket_start: String(c.bucket_start),
      open_price_usdc: toNum(c.open_price_usdc, 0),
      high_price_usdc: toNum(c.high_price_usdc, 0),
      low_price_usdc: toNum(c.low_price_usdc, 0),
      close_price_usdc: toNum(c.close_price_usdc, 0),
      volume_qty: toNum(c.volume_qty, 0),
      volume_usdc: toNum(c.volume_usdc, 0),
      trades_count: toNum(c.trades_count, 0),
    })),
    timeframe,
  ).slice(-candleLimit);

  const { data: auth } = await userClient.auth.getUser();
  const uid = auth?.user?.id ?? null;
  let myPosition: any = null;
  if (uid) {
    let pos: any = null;
    {
      const posWithLocked = await admin
        .from("market_stock_positions")
        .select("stock_id,user_id,balance_qty,avg_cost_usdc,realized_pnl_usdc,locked_redemption_qty,updated_at")
        .eq("stock_id", identity.id)
        .eq("user_id", uid)
        .maybeSingle();
      if (!posWithLocked.error) {
        pos = posWithLocked.data ?? null;
      } else if (isMissingPiSchemaError(posWithLocked.error)) {
        const posFallback = await admin
          .from("market_stock_positions")
          .select("stock_id,user_id,balance_qty,avg_cost_usdc,realized_pnl_usdc,updated_at")
          .eq("stock_id", identity.id)
          .eq("user_id", uid)
          .maybeSingle();
        if (posFallback.error) return bad(posFallback.error.message);
        pos = posFallback.data ? { ...posFallback.data, locked_redemption_qty: 0 } : null;
      } else {
        return bad(posWithLocked.error.message);
      }
    }

    let piRows: any[] = [];
    if (identity.chain === "pi_testnet") {
      const piRowsRes = await admin
        .from("market_stock_pi_redemption_queue")
        .select("id,queue_seq,status,quantity_locked,locked_net_usdc,locked_net_payout_pi,attempt_count,next_retry_at,created_at,completed_at")
        .eq("stock_id", identity.id)
        .eq("user_id", uid)
        .order("created_at", { ascending: false })
        .limit(8);
      if (piRowsRes.error && !isMissingPiSchemaError(piRowsRes.error)) return bad(piRowsRes.error.message);
      piRows = piRowsRes.error ? [] : (piRowsRes.data ?? []);
    }
    myPosition = {
      ...(pos || {}),
      locked_redemption_qty: Number((pos as any)?.locked_redemption_qty ?? 0),
      pi_redemptions: piRows,
    };
  }

  const cutoffIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: candles24, error: candles24Err } = await admin
    .from("market_stock_candles_1m")
    .select("volume_usdc,trades_count")
    .eq("stock_id", identity.id)
    .gte("bucket_start", cutoffIso);
  if (candles24Err) return bad(candles24Err.message);

  let volume24h = 0;
  let trades24h = 0;
  for (const row of candles24 ?? []) {
    volume24h += toNum((row as any)?.volume_usdc, 0);
    trades24h += toNum((row as any)?.trades_count, 0);
  }

  // Fallback for early bootstrap periods before candles are populated.
  if ((candles24 ?? []).length === 0) {
    volume24h = trades.reduce((acc: number, t: any) => acc + toNum(t.notional_usdc, 0), 0);
    trades24h = trades.length;
  }

  return ok({
    ok: true,
    mode: "detail",
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
  });
});
