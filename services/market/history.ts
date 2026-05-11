import { supabase } from "@/services/supabase";
import {
  fetchJsonWithTimeout,
  getSupabaseAnonKeyOrThrow,
  getSupabaseFunctionsBaseUrl,
  getSupabaseJwtOrThrow,
} from "@/services/net";

export type HistoryKind =
  | "deposit"
  | "withdrawal"
  | "transfer_in"
  | "transfer_out"
  | "market_buy"
  | "market_sell"
  | "market_crypto"
  | "stock_buy"
  | "stock_sell"
  | "stock_profit"
  | "fee"
  | "refund"
  | "release"
  | "event";

export type MarketHistoryEntry = {
  id: string;
  source_table: string;
  source_id: string;
  kind: HistoryKind | string;
  title: string;
  amount: number;
  currency: string;
  status: string;
  tx_hash: string | null;
  order_id: string | null;
  stock_id: string | null;
  details: any;
  occurred_at: string;
  created_at: string;
};

const FN_MARKET_HISTORY_LIST = "market-history-list";

function toNum(input: unknown, fallback = 0) {
  const n = Number(input);
  return Number.isFinite(n) ? n : fallback;
}

function toIso(input: unknown, fallback?: string) {
  const d = new Date(String(input || ""));
  if (Number.isFinite(d.getTime())) return d.toISOString();
  return fallback || new Date().toISOString();
}

function parseJsonObject(value: unknown) {
  if (!value) return null;
  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function normalizeRow(row: any): MarketHistoryEntry {
  return {
    id: String(row.id || ""),
    source_table: String(row.source_table || ""),
    source_id: String(row.source_id || ""),
    kind: String(row.kind || ""),
    title: String(row.title || "Transaction"),
    amount: toNum(row.amount, 0),
    currency: String(row.currency || "USD").toUpperCase(),
    status: String(row.status || "PENDING").toUpperCase(),
    tx_hash: row.tx_hash ? String(row.tx_hash) : null,
    order_id: row.order_id ? String(row.order_id) : null,
    stock_id: row.stock_id ? String(row.stock_id) : null,
    details: row.details ?? {},
    occurred_at: toIso(row.occurred_at, toIso(row.created_at)),
    created_at: toIso(row.created_at),
  };
}

function notificationOrderId(row: any, metadata: Record<string, unknown>) {
  if (String(row?.entity_type || "").trim().toLowerCase() === "market_order" && row?.entity_id) {
    return String(row.entity_id);
  }
  const value = metadata.order_id ?? metadata.orderId;
  return value ? String(value) : null;
}

function notificationStockId(row: any, metadata: Record<string, unknown>) {
  if (String(row?.entity_type || "").trim().toLowerCase().includes("stock") && row?.entity_id) {
    return String(row.entity_id);
  }
  const value = metadata.stock_id ?? metadata.stockId;
  return value ? String(value) : null;
}

function notificationTxHash(metadata: Record<string, unknown>) {
  const value = metadata.tx_hash ?? metadata.transaction_hash ?? metadata.hash ?? metadata.txHash;
  return value ? String(value) : null;
}

function normalizeNotificationRow(row: any): MarketHistoryEntry {
  const metadata = parseJsonObject(row?.metadata) ?? {};
  return {
    id: `notification:${String(row?.id || "")}`,
    source_table: "account_notifications",
    source_id: String(row?.id || ""),
    kind: "event",
    title: String(row?.title || "Account event"),
    amount: 0,
    currency: "USD",
    status: row?.read_at ? "READ" : "NEW",
    tx_hash: notificationTxHash(metadata),
    order_id: notificationOrderId(row, metadata),
    stock_id: notificationStockId(row, metadata),
    details: {
      notification_kind: String(row?.kind || "general"),
      body: row?.body ? String(row.body) : null,
      route: row?.route ? String(row.route) : null,
      entity_type: row?.entity_type ? String(row.entity_type) : null,
      entity_id: row?.entity_id ? String(row.entity_id) : null,
      actor_id: row?.actor_id ? String(row.actor_id) : null,
      read_at: row?.read_at ? toIso(row.read_at) : null,
      metadata,
    },
    occurred_at: toIso(row?.created_at, toIso(row?.updated_at)),
    created_at: toIso(row?.created_at, toIso(row?.updated_at)),
  };
}

function mergeHistoryRows(limit: number, ...groups: MarketHistoryEntry[][]) {
  const map = new Map<string, MarketHistoryEntry>();
  for (const row of groups.flat()) {
    if (!row?.id || map.has(row.id)) continue;
    map.set(row.id, row);
  }
  return Array.from(map.values())
    .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())
    .slice(0, limit);
}

function isMissingHistoryTableError(error: unknown) {
  const msg = String((error as any)?.message || error || "").toLowerCase();
  return (
    msg.includes("market_transaction_history") &&
    (msg.includes("does not exist") ||
      msg.includes("relation") ||
      msg.includes("schema cache") ||
      msg.includes("pgrst"))
  );
}

function isMissingHistoryRpcError(error: unknown) {
  const msg = String((error as any)?.message || error || "").toLowerCase();
  return (
    msg.includes("does not exist") ||
    msg.includes("could not find the function") ||
    msg.includes("schema cache") ||
    msg.includes("pgrst202") ||
    msg.includes("42883")
  );
}

function orderStatusToHistory(status: unknown) {
  const s = String(status || "").toUpperCase();
  if (["RELEASED"].includes(s)) return "SUCCESS";
  if (["REFUNDED"].includes(s)) return "REFUNDED";
  if (["CANCELLED"].includes(s)) return "CANCELLED";
  if (["FAILED"].includes(s)) return "FAILED";
  return "PENDING";
}

function walletTxKind(type: unknown): HistoryKind {
  const t = String(type || "").toLowerCase();
  if (t === "deposit") return "deposit";
  if (t === "withdrawal") return "withdrawal";
  if (t === "transfer_in") return "transfer_in";
  if (t === "transfer_out") return "transfer_out";
  if (t === "bill" || t === "fee") return "fee";
  return "fee";
}

function walletTxTitle(type: unknown) {
  const t = String(type || "").toLowerCase();
  if (t === "deposit") return "NGN wallet deposit";
  if (t === "withdrawal") return "NGN wallet withdrawal";
  if (t === "transfer_in") return "Wallet transfer received";
  if (t === "transfer_out") return "Wallet transfer sent";
  if (t === "bill") return "Wallet bill payment";
  if (t === "fee") return "Wallet fee";
  return "Wallet transaction";
}

function withdrawalStatusToHistory(status: unknown) {
  const s = String(status || "").toUpperCase();
  if (["SUCCESS", "SUCCEEDED", "COMPLETED", "DONE", "PAID"].includes(s)) return "SUCCESS";
  if (["FAILED", "CANCELLED", "CANCELED", "REJECTED"].includes(s)) return "FAILED";
  if (["REVERSED", "REFUNDED"].includes(s)) return "REFUNDED";
  return s || "PENDING";
}

function currencyFromMeta(meta: unknown, fallback = "NGN") {
  const parsed = parseJsonObject(meta);
  const value = parsed?.currency ?? parsed?.Currency;
  return String(value || fallback).toUpperCase();
}

async function safeListQuery<T>(
  label: string,
  run: () => Promise<{ data: T[] | null; error: any }> | { data: T[] | null; error: any } | any,
) {
  try {
    const res = await run();
    if (res.error) {
      console.warn(`[history] ${label} skipped: ${String(res.error?.message || res.error)}`);
      return [] as T[];
    }
    return (res.data ?? []) as T[];
  } catch (e: any) {
    console.warn(`[history] ${label} failed: ${String(e?.message || e)}`);
    return [] as T[];
  }
}

async function fetchHistoryViaFunction(limit: number) {
  const base = getSupabaseFunctionsBaseUrl();
  const anon = getSupabaseAnonKeyOrThrow();
  const jwt = await getSupabaseJwtOrThrow();

  const url = `${base}/${FN_MARKET_HISTORY_LIST}?limit=${encodeURIComponent(String(Math.min(Math.max(limit, 1), 500)))}`;
  const { res, json, text } = await fetchJsonWithTimeout(
    url,
    {
      method: "GET",
      headers: {
        apikey: anon,
        Authorization: `Bearer ${jwt}`,
      },
    },
    18000,
  );

  if (!res.ok) {
    throw new Error(String((json as any)?.error || text || `History function failed (${res.status})`));
  }

  const rows = Array.isArray((json as any)?.items) ? ((json as any).items as any[]) : [];
  return rows.map(normalizeRow);
}

async function fetchNotificationHistory(userId: string, limit: number) {
  const { data, error } = await supabase
    .from("account_notifications")
    .select("id,kind,title,body,route,entity_type,entity_id,actor_id,metadata,read_at,created_at,updated_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 500));

  if (error) {
    console.warn(`[history] account_notifications skipped: ${String(error?.message || error)}`);
    return [] as MarketHistoryEntry[];
  }

  return ((data ?? []) as any[]).map(normalizeNotificationRow);
}

async function fetchNotificationHistoryDetail(userId: string, notificationId: string) {
  const { data, error } = await supabase
    .from("account_notifications")
    .select("id,kind,title,body,route,entity_type,entity_id,actor_id,metadata,read_at,created_at,updated_at")
    .eq("user_id", userId)
    .eq("id", notificationId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? normalizeNotificationRow(data) : null;
}

async function fetchLegacyHistory(userId: string, limit: number) {
  const maxRows = Math.min(limit, 250);
  const [walletRows, withdrawalRows, paystackRows, orderRows, stockTradeRows, stockPositionRows] = await Promise.all([
    safeListQuery("app_wallet_tx_simple", () =>
      supabase
        .from("app_wallet_tx_simple")
        .select("id,user_id,type,amount,reference,meta,created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(maxRows),
    ),
    safeListQuery("withdrawals_simple", () =>
      supabase
        .from("withdrawals_simple")
        .select("id,user_id,status,amount,fee,total_debit,bank_name,account_number,account_name,paystack_reference,paystack_transfer_code,meta,created_at,updated_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(maxRows),
    ),
    safeListQuery("paystack_events_simple", () =>
      supabase
        .from("paystack_events_simple")
        .select("id,user_id,reference,amount,fee,raw,created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(maxRows),
    ),
    safeListQuery("market_orders", () =>
      supabase
        .from("market_orders")
        .select("id,buyer_id,seller_id,listing_id,quantity,unit_price,amount,fee_amount,currency,status,created_at,in_escrow_at,delivered_at,released_at,refunded_at,cancelled_at")
        .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
        .order("created_at", { ascending: false })
        .limit(maxRows),
    ),
    safeListQuery("market_stock_trades", () =>
      supabase
        .from("market_stock_trades")
        .select("id,stock_id,side,price_usdc,quantity,notional_usdc,fee_usdc,chain_tx_hash,traded_at,created_at")
        .eq("user_id", userId)
        .order("traded_at", { ascending: false })
        .limit(maxRows),
    ),
    safeListQuery("market_stock_positions", () =>
      supabase
        .from("market_stock_positions")
        .select("stock_id,realized_pnl_usdc,updated_at")
        .eq("user_id", userId)
        .neq("realized_pnl_usdc", 0)
        .order("updated_at", { ascending: false })
        .limit(100),
    ),
  ]);

  const orders = (orderRows ?? []) as any[];
  const orderMap = new Map<string, any>(orders.map((o: any) => [String(o.id), o]));
  const orderIds = orders.map((o: any) => String(o.id));

  const [intentRows, chainEventRows] = await Promise.all([
    orderIds.length
      ? safeListQuery("market_crypto_intents", () =>
          supabase
            .from("market_crypto_intents")
            .select("id,order_id,intent_type,status,chain,from_wallet,to_wallet,amount_units,amount_raw,tx_hash,client_reference,created_at,updated_at")
            .in("order_id", orderIds)
            .order("created_at", { ascending: false })
            .limit(Math.min(limit * 2, 500)),
        )
      : Promise.resolve([] as any[]),
    orderIds.length
      ? safeListQuery("market_chain_events", () =>
          supabase
            .from("market_chain_events")
            .select("id,order_id,event_type,tx_hash,chain,block_time,created_at,amount_units,amount_raw,buyer_wallet,seller_wallet")
            .in("order_id", orderIds)
            .order("created_at", { ascending: false })
            .limit(Math.min(limit * 2, 500)),
        )
      : Promise.resolve([] as any[]),
  ]);

  const stockIds = Array.from(
    new Set([
      ...((stockTradeRows ?? []) as any[]).map((r: any) => String(r.stock_id)),
      ...((stockPositionRows ?? []) as any[]).map((r: any) => String(r.stock_id)),
    ]),
  );

  const stockRows = stockIds.length
    ? await safeListQuery("market_stock_identities", () =>
        supabase.from("market_stock_identities").select("id,slug,name,symbol").in("id", stockIds),
      )
    : [];
  const stockMap = new Map<string, any>((stockRows ?? []).map((s: any) => [String(s.id), s]));

  const out: MarketHistoryEntry[] = [];

  for (const tx of walletRows ?? []) {
    const meta = parseJsonObject((tx as any).meta) ?? {};
    out.push({
      id: `wallet:${String((tx as any).id)}`,
      source_table: "app_wallet_tx_simple",
      source_id: String((tx as any).id),
      kind: walletTxKind((tx as any).type),
      title: walletTxTitle((tx as any).type),
      amount: toNum((tx as any).amount, 0),
      currency: currencyFromMeta(meta, "NGN"),
      status: "SUCCESS",
      tx_hash: null,
      order_id: null,
      stock_id: null,
      details: {
        reference: (tx as any).reference ?? null,
        wallet_type: (tx as any).type ?? null,
        meta,
      },
      occurred_at: toIso((tx as any).created_at),
      created_at: toIso((tx as any).created_at),
    });
  }

  for (const withdrawal of withdrawalRows ?? []) {
    const meta = parseJsonObject((withdrawal as any).meta) ?? {};
    out.push({
      id: `withdrawal:${String((withdrawal as any).id)}`,
      source_table: "withdrawals_simple",
      source_id: String((withdrawal as any).id),
      kind: "withdrawal",
      title: "Bank withdrawal",
      amount: toNum(
        (withdrawal as any).total_debit,
        toNum((withdrawal as any).amount, 0) + toNum((withdrawal as any).fee, 0),
      ),
      currency: currencyFromMeta(meta, "NGN"),
      status: withdrawalStatusToHistory((withdrawal as any).status),
      tx_hash: null,
      order_id: null,
      stock_id: null,
      details: {
        status: (withdrawal as any).status ?? null,
        bank_name: (withdrawal as any).bank_name ?? null,
        account_number: (withdrawal as any).account_number ?? null,
        account_name: (withdrawal as any).account_name ?? null,
        paystack_reference: (withdrawal as any).paystack_reference ?? null,
        paystack_transfer_code: (withdrawal as any).paystack_transfer_code ?? null,
        fee: (withdrawal as any).fee ?? null,
        meta,
      },
      occurred_at: toIso((withdrawal as any).updated_at || (withdrawal as any).created_at),
      created_at: toIso((withdrawal as any).created_at),
    });
  }

  for (const deposit of paystackRows ?? []) {
    const raw = parseJsonObject((deposit as any).raw) ?? {};
    out.push({
      id: `paystack:${String((deposit as any).id || (deposit as any).reference)}`,
      source_table: "paystack_events_simple",
      source_id: String((deposit as any).id || (deposit as any).reference || ""),
      kind: "deposit",
      title: "Paystack deposit received",
      amount: toNum((deposit as any).amount, 0),
      currency: currencyFromMeta(raw, "NGN"),
      status: "SUCCESS",
      tx_hash: null,
      order_id: null,
      stock_id: null,
      details: {
        reference: (deposit as any).reference ?? null,
        fee: (deposit as any).fee ?? null,
        raw,
      },
      occurred_at: toIso((deposit as any).created_at),
      created_at: toIso((deposit as any).created_at),
    });
  }

  for (const order of orders) {
    const isBuyer = String(order.buyer_id) === userId;
    const role = isBuyer ? "buyer" : "seller";
    const amount = isBuyer ? toNum(order.amount, 0) + toNum(order.fee_amount, 0) : toNum(order.amount, 0);
    out.push({
      id: `order:${String(order.id)}:${role}`,
      source_table: "market_orders",
      source_id: String(order.id),
      kind: isBuyer ? "market_buy" : "market_sell",
      title: isBuyer ? "Marketplace purchase" : "Marketplace sale",
      amount,
      currency: String(order.currency || "USD").toUpperCase(),
      status: orderStatusToHistory(order.status),
      tx_hash: null,
      order_id: String(order.id),
      stock_id: null,
      details: {
        role,
        listing_id: order.listing_id ?? null,
        quantity: order.quantity ?? 1,
        unit_price: order.unit_price ?? 0,
        base_amount: order.amount ?? 0,
        fee_amount: order.fee_amount ?? 0,
        order_status: String(order.status || "").toUpperCase(),
      },
      occurred_at: toIso(
        order.released_at ||
          order.refunded_at ||
          order.cancelled_at ||
          order.delivered_at ||
          order.in_escrow_at ||
          order.created_at,
      ),
      created_at: toIso(order.created_at),
    });
  }

  for (const intent of intentRows ?? []) {
    const order = orderMap.get(String((intent as any).order_id));
    if (!order) continue;
    const type = String((intent as any).intent_type || "").toUpperCase();
    const isBuyer = String(order.buyer_id) === userId;
    const isSeller = String(order.seller_id) === userId;
    if (type === "DEPOSIT" && !isBuyer) continue;
    if (type === "REFUND" && !isBuyer) continue;
    if (type === "RELEASE" && !isSeller) continue;

    const title =
      type === "DEPOSIT"
        ? "Crypto escrow deposit"
        : type === "RELEASE"
        ? "Crypto escrow release"
        : type === "REFUND"
        ? "Crypto escrow refund"
        : "Crypto escrow activity";

    out.push({
      id: `crypto:${String((intent as any).id)}`,
      source_table: "market_crypto_intents",
      source_id: String((intent as any).id),
      kind: "market_crypto",
      title,
      amount: toNum((intent as any).amount_units, toNum(order.amount, 0)),
      currency: String(order.currency || "USDC").toUpperCase(),
      status: String((intent as any).status || "PENDING").toUpperCase(),
      tx_hash: (intent as any).tx_hash ? String((intent as any).tx_hash) : null,
      order_id: String(order.id),
      stock_id: null,
      details: {
        intent_type: type,
        chain: (intent as any).chain ?? null,
        from_wallet: (intent as any).from_wallet ?? null,
        to_wallet: (intent as any).to_wallet ?? null,
        amount_raw: (intent as any).amount_raw ?? null,
        client_reference: (intent as any).client_reference ?? null,
      },
      occurred_at: toIso((intent as any).updated_at || (intent as any).created_at),
      created_at: toIso((intent as any).created_at),
    });
  }

  for (const ev of chainEventRows ?? []) {
    const order = orderMap.get(String((ev as any).order_id));
    if (!order) continue;
    const eventType = String((ev as any).event_type || "").toUpperCase();
    const isBuyer = String(order.buyer_id) === userId;
    const isSeller = String(order.seller_id) === userId;
    if (eventType.includes("DEPOSIT") && !isBuyer) continue;
    if (eventType.includes("REFUND") && !isBuyer) continue;
    if (eventType.includes("RELEASE") && !isSeller) continue;
    if (!eventType.includes("DEPOSIT") && !eventType.includes("REFUND") && !eventType.includes("RELEASE")) {
      if (!isBuyer && !isSeller) continue;
    }

    out.push({
      id: `chain:${String((ev as any).id)}`,
      source_table: "market_chain_events",
      source_id: String((ev as any).id),
      kind: "market_crypto",
      title: `On-chain ${eventType.toLowerCase().replace(/_/g, " ")}`,
      amount: toNum((ev as any).amount_units, toNum(order.amount, 0)),
      currency: String(order.currency || "USDC").toUpperCase(),
      status: "CONFIRMED",
      tx_hash: (ev as any).tx_hash ? String((ev as any).tx_hash) : null,
      order_id: String(order.id),
      stock_id: null,
      details: {
        event_type: eventType,
        chain: (ev as any).chain ?? null,
        buyer_wallet: (ev as any).buyer_wallet ?? null,
        seller_wallet: (ev as any).seller_wallet ?? null,
        amount_raw: (ev as any).amount_raw ?? null,
      },
      occurred_at: toIso((ev as any).block_time || (ev as any).created_at),
      created_at: toIso((ev as any).created_at),
    });
  }

  for (const trade of stockTradeRows ?? []) {
    const stock = stockMap.get(String((trade as any).stock_id));
    const side = String((trade as any).side || "").toLowerCase();
    const symbol = String(stock?.symbol || "STK").toUpperCase();
    out.push({
      id: `stock:${String((trade as any).id)}`,
      source_table: "market_stock_trades",
      source_id: String((trade as any).id),
      kind: side === "sell" ? "stock_sell" : "stock_buy",
      title: side === "sell" ? `Stock sell: ${symbol}` : `Stock buy: ${symbol}`,
      amount: toNum((trade as any).notional_usdc, 0),
      currency: "USDC",
      status: "SUCCESS",
      tx_hash: (trade as any).chain_tx_hash ? String((trade as any).chain_tx_hash) : null,
      order_id: null,
      stock_id: String((trade as any).stock_id),
      details: {
        stock_name: stock?.name ?? null,
        stock_symbol: symbol,
        side,
        price_usdc: toNum((trade as any).price_usdc, 0),
        quantity: toNum((trade as any).quantity, 0),
        fee_usdc: toNum((trade as any).fee_usdc, 0),
      },
      occurred_at: toIso((trade as any).traded_at || (trade as any).created_at),
      created_at: toIso((trade as any).created_at),
    });
  }

  for (const row of stockPositionRows ?? []) {
    const stock = stockMap.get(String((row as any).stock_id));
    const symbol = String(stock?.symbol || "STK").toUpperCase();
    const pnl = toNum((row as any).realized_pnl_usdc, 0);
    out.push({
      id: `stock-profit:${String((row as any).stock_id)}`,
      source_table: "market_stock_positions",
      source_id: String((row as any).stock_id),
      kind: "stock_profit",
      title: pnl >= 0 ? `Realized stock profit: ${symbol}` : `Realized stock loss: ${symbol}`,
      amount: pnl,
      currency: "USDC",
      status: "SUCCESS",
      tx_hash: null,
      order_id: null,
      stock_id: String((row as any).stock_id),
      details: {
        stock_name: stock?.name ?? null,
        stock_symbol: symbol,
        realized_pnl_usdc_total: pnl,
      },
      occurred_at: toIso((row as any).updated_at),
      created_at: toIso((row as any).updated_at),
    });
  }

  return out
    .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())
    .slice(0, limit);
}

let historyBackfillAttemptedForUser = "";
let historyBackfillAttemptedAt = 0;

async function maybeBackfillHistory(limit: number) {
  const candidates = ["market_history_backfill_me"];
  for (const fn of candidates) {
    const { error } = await supabase.rpc(fn, { p_limit: Math.min(Math.max(limit, 100), 5000) } as any);
    if (!error) return true;
    if (!isMissingHistoryRpcError(error)) {
      console.warn(`[history] ${fn} failed: ${String(error?.message || error)}`);
      return false;
    }
  }
  return false;
}

export async function fetchMarketHistory(limit = 300) {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  const user = auth?.user;
  if (!user) throw new Error("Not authenticated");

  const now = Date.now();
  const shouldAttemptBackfill =
    historyBackfillAttemptedForUser !== user.id ||
    now - historyBackfillAttemptedAt > 60_000;
  if (shouldAttemptBackfill) {
    historyBackfillAttemptedForUser = user.id;
    historyBackfillAttemptedAt = now;
    await maybeBackfillHistory(limit);
  }

  const notificationRowsPromise = fetchNotificationHistory(user.id, limit).catch(
    () => [] as MarketHistoryEntry[],
  );
  const withNotifications = async (rows: MarketHistoryEntry[]) =>
    mergeHistoryRows(limit, rows, await notificationRowsPromise);

  const readHistoryTable = async () =>
    await supabase
      .from("market_transaction_history")
      .select("id,source_table,source_id,kind,title,amount,currency,status,tx_hash,order_id,stock_id,details,occurred_at,created_at")
      .eq("user_id", user.id)
      .order("occurred_at", { ascending: false })
      .limit(Math.min(limit, 500));

  const tryFunctionFallback = async () => {
    try {
      return await fetchHistoryViaFunction(limit);
    } catch (e: any) {
      console.warn(`[history] ${FN_MARKET_HISTORY_LIST} failed: ${String(e?.message || e)}`);
      return [] as MarketHistoryEntry[];
    }
  };

  let tableRes = await readHistoryTable();

  if (!tableRes.error) {
    let rows = ((tableRes.data ?? []) as any[]).map(normalizeRow);
    if (rows.length > 0) return await withNotifications(rows);

    const backfilled = await maybeBackfillHistory(limit);
    if (backfilled) {
      tableRes = await readHistoryTable();
      if (!tableRes.error) {
        rows = ((tableRes.data ?? []) as any[]).map(normalizeRow);
        if (rows.length > 0) return await withNotifications(rows);
      }
    }

    // If history table exists but isn't populated yet, fall back to live legacy sources.
    const legacyRows = await fetchLegacyHistory(user.id, limit);
    if (legacyRows.length > 0) return await withNotifications(legacyRows);

    return await withNotifications(await tryFunctionFallback());
  }

  if (!isMissingHistoryTableError(tableRes.error)) {
    const functionRows = await tryFunctionFallback();
    const mergedFunctionRows = await withNotifications(functionRows);
    if (mergedFunctionRows.length > 0) return mergedFunctionRows;
    throw new Error(tableRes.error.message);
  }

  const legacyRows = await fetchLegacyHistory(user.id, limit);
  if (legacyRows.length > 0) return await withNotifications(legacyRows);

  return await withNotifications(await tryFunctionFallback());
}

function looksLikeUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

export async function fetchMarketHistoryDetail(entryId: string) {
  const id = String(entryId || "").trim();
  if (!id) return null;

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  const user = auth?.user;
  if (!user) throw new Error("Not authenticated");

  const notificationId = id.startsWith("notification:") ? id.slice("notification:".length).trim() : "";
  if (looksLikeUuid(notificationId)) {
    return await fetchNotificationHistoryDetail(user.id, notificationId);
  }

  if (looksLikeUuid(id)) {
    const tableRes = await supabase
      .from("market_transaction_history")
      .select("id,source_table,source_id,kind,title,amount,currency,status,tx_hash,order_id,stock_id,details,occurred_at,created_at")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!tableRes.error && tableRes.data) return normalizeRow(tableRes.data);
    const notificationRow = await fetchNotificationHistoryDetail(user.id, id).catch(() => null);
    if (notificationRow) return notificationRow;
    if (tableRes.error && !isMissingHistoryTableError(tableRes.error)) {
      const functionRows = await fetchHistoryViaFunction(500).catch(() => [] as MarketHistoryEntry[]);
      const fromFunction = functionRows.find((x) => x.id === id);
      if (fromFunction) return fromFunction;
      throw new Error(tableRes.error.message);
    }
  }

  const items = await fetchMarketHistory(500);
  return items.find((x) => x.id === id) ?? null;
}
