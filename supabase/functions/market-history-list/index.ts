import { bad, methodNotAllowed, ok, unauth } from "../_shared/market/http.ts";
import { supabaseAdminClient, supabaseUserClient } from "../_shared/market/supabase.ts";

type HistoryKind =
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
  | "release";

type HistoryRow = {
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
  details: Record<string, unknown>;
  occurred_at: string;
  created_at: string;
};

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  return token.length ? token : null;
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function toNum(input: unknown, fallback = 0) {
  const n = Number(input);
  return Number.isFinite(n) ? n : fallback;
}

function toIso(input: unknown, fallback?: string) {
  const d = new Date(String(input || ""));
  if (Number.isFinite(d.getTime())) return d.toISOString();
  return fallback || new Date().toISOString();
}

function normalizeRow(row: any): HistoryRow {
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

function orderStatusToHistory(status: unknown) {
  const s = String(status || "").toUpperCase();
  if (["RELEASED"].includes(s)) return "SUCCESS";
  if (["REFUNDED"].includes(s)) return "REFUNDED";
  if (["CANCELLED"].includes(s)) return "CANCELLED";
  if (["FAILED"].includes(s)) return "FAILED";
  return "PENDING";
}

function withdrawalStatusToHistory(status: unknown) {
  const s = String(status || "").toLowerCase();
  if (s === "successful") return "SUCCESS";
  if (s === "processing" || s === "pending") return "PENDING";
  if (s === "failed" || s === "reversed") return "FAILED";
  if (s === "refunded") return "REFUNDED";
  return "PENDING";
}

function walletTypeToKind(input: unknown): HistoryKind {
  const t = String(input || "").toLowerCase();
  if (t === "deposit") return "deposit";
  if (t === "withdrawal") return "withdrawal";
  if (t === "transfer_in") return "transfer_in";
  if (t === "transfer_out") return "transfer_out";
  if (t === "fee" || t === "bill") return "fee";
  return "fee";
}

function walletTypeTitle(input: unknown) {
  const t = String(input || "").toLowerCase();
  if (t === "deposit") return "NGN wallet deposit";
  if (t === "withdrawal") return "NGN wallet withdrawal";
  if (t === "transfer_in") return "Wallet transfer received";
  if (t === "transfer_out") return "Wallet transfer sent";
  if (t === "bill") return "Wallet bill payment";
  if (t === "fee") return "Wallet fee";
  return "Wallet transaction";
}

async function safeListQuery<T>(_label: string, run: () => Promise<{ data: T[] | null; error: any }>) {
  try {
    const res = await run();
    if (res.error) return [] as T[];
    return (res.data ?? []) as T[];
  } catch {
    return [] as T[];
  }
}

async function fetchLegacyHistory(admin: ReturnType<typeof supabaseAdminClient>, userId: string, limit: number) {
  const maxRows = Math.min(limit, 250);
  const [walletRows, withdrawalRows, paystackRows, orderRows, stockTradeRows, stockPositionRows] = await Promise.all([
    safeListQuery("app_wallet_tx_simple", () =>
      admin
        .from("app_wallet_tx_simple")
        .select("id,type,amount,reference,meta,created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(maxRows),
    ) as Promise<any[]>,
    safeListQuery("withdrawals_simple", () =>
      admin
        .from("withdrawals_simple")
        .select(
          "id,amount,fee,total_debit,bank_name,account_number,account_name,paystack_reference,paystack_transfer_code,status,meta,created_at,updated_at",
        )
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(maxRows),
    ) as Promise<any[]>,
    safeListQuery("paystack_events_simple", () =>
      admin
        .from("paystack_events_simple")
        .select("reference,amount,fee,raw,created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(maxRows),
    ) as Promise<any[]>,
    safeListQuery("market_orders", () =>
      admin
        .from("market_orders")
        .select(
          "id,buyer_id,seller_id,listing_id,quantity,unit_price,amount,fee_amount,currency,status,created_at,in_escrow_at,delivered_at,released_at,refunded_at,cancelled_at",
        )
        .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
        .order("created_at", { ascending: false })
        .limit(maxRows),
    ) as Promise<any[]>,
    safeListQuery("market_stock_trades", () =>
      admin
        .from("market_stock_trades")
        .select("id,stock_id,side,price_usdc,quantity,notional_usdc,fee_usdc,chain_tx_hash,traded_at,created_at")
        .eq("user_id", userId)
        .order("traded_at", { ascending: false })
        .limit(maxRows),
    ) as Promise<any[]>,
    safeListQuery("market_stock_positions", () =>
      admin
        .from("market_stock_positions")
        .select("stock_id,realized_pnl_usdc,updated_at")
        .eq("user_id", userId)
        .neq("realized_pnl_usdc", 0)
        .order("updated_at", { ascending: false })
        .limit(100),
    ) as Promise<any[]>,
  ]);

  const orders = (orderRows ?? []) as any[];
  const orderMap = new Map<string, any>(orders.map((o: any) => [String(o.id), o]));
  const orderIds = orders.map((o: any) => String(o.id));

  const [intentRows, chainEventRows] = await Promise.all([
    orderIds.length
      ? safeListQuery("market_crypto_intents", () =>
          admin
            .from("market_crypto_intents")
            .select(
              "id,order_id,intent_type,status,chain,from_wallet,to_wallet,amount_units,amount_raw,tx_hash,client_reference,created_at,updated_at",
            )
            .in("order_id", orderIds)
            .order("created_at", { ascending: false })
            .limit(Math.min(limit * 2, 500)),
        )
      : Promise.resolve([] as any[]),
    orderIds.length
      ? safeListQuery("market_chain_events", () =>
          admin
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
        admin.from("market_stock_identities").select("id,slug,name,symbol").in("id", stockIds),
      )
    : [];
  const stockMap = new Map<string, any>((stockRows ?? []).map((s: any) => [String(s.id), s]));

  const out: HistoryRow[] = [];

  for (const tx of walletRows ?? []) {
    const kind = walletTypeToKind((tx as any).type);
    out.push({
      id: `wallet:${String((tx as any).id)}`,
      source_table: "app_wallet_tx_simple",
      source_id: String((tx as any).id),
      kind,
      title: walletTypeTitle((tx as any).type),
      amount: toNum((tx as any).amount, 0),
      currency: String((tx as any)?.meta?.currency || "NGN").toUpperCase(),
      status: "SUCCESS",
      tx_hash: null,
      order_id: null,
      stock_id: null,
      details: {
        reference: (tx as any).reference ?? null,
        meta: (tx as any).meta ?? {},
      },
      occurred_at: toIso((tx as any).created_at),
      created_at: toIso((tx as any).created_at),
    });
  }

  for (const wd of withdrawalRows ?? []) {
    out.push({
      id: `wd:${String((wd as any).id)}`,
      source_table: "withdrawals_simple",
      source_id: String((wd as any).id),
      kind: "withdrawal",
      title: "Bank withdrawal",
      amount: toNum((wd as any).total_debit, toNum((wd as any).amount, 0) + toNum((wd as any).fee, 0)),
      currency: String((wd as any)?.meta?.currency || "NGN").toUpperCase(),
      status: withdrawalStatusToHistory((wd as any).status),
      tx_hash: null,
      order_id: null,
      stock_id: null,
      details: {
        status: (wd as any).status ?? null,
        bank_name: (wd as any).bank_name ?? null,
        account_number: (wd as any).account_number ?? null,
        account_name: (wd as any).account_name ?? null,
        paystack_reference: (wd as any).paystack_reference ?? null,
        paystack_transfer_code: (wd as any).paystack_transfer_code ?? null,
        meta: (wd as any).meta ?? {},
      },
      occurred_at: toIso((wd as any).updated_at || (wd as any).created_at),
      created_at: toIso((wd as any).created_at),
    });
  }

  for (const row of paystackRows ?? []) {
    out.push({
      id: `paystack:${String((row as any).reference)}`,
      source_table: "paystack_events_simple",
      source_id: String((row as any).reference),
      kind: "deposit",
      title: "Paystack deposit received",
      amount: toNum((row as any).amount, 0),
      currency: "NGN",
      status: "SUCCESS",
      tx_hash: null,
      order_id: null,
      stock_id: null,
      details: {
        reference: (row as any).reference ?? null,
        fee: (row as any).fee ?? null,
        raw: (row as any).raw ?? {},
      },
      occurred_at: toIso((row as any).created_at),
      created_at: toIso((row as any).created_at),
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
        order.released_at || order.refunded_at || order.cancelled_at || order.delivered_at || order.in_escrow_at || order.created_at,
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

  return out.sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime()).slice(0, limit);
}

Deno.serve(async (req) => {
  if (req.method !== "GET") return methodNotAllowed(req);

  const token = extractBearerToken(req);
  if (!token) return unauth();

  const authClient = supabaseUserClient(req);
  const admin = supabaseAdminClient();

  const { data: userRes, error: userErr } = await authClient.auth.getUser(token);
  if (userErr || !userRes?.user) return unauth();

  const userId = userRes.user.id;
  const url = new URL(req.url);
  const limit = clampInt(url.searchParams.get("limit"), 1, 500, 300);

  const readHistoryTable = async () =>
    await admin
      .from("market_transaction_history")
      .select("id,source_table,source_id,kind,title,amount,currency,status,tx_hash,order_id,stock_id,details,occurred_at,created_at")
      .eq("user_id", userId)
      .order("occurred_at", { ascending: false })
      .limit(limit);

  let tableRes = await readHistoryTable();
  if (!tableRes.error && (tableRes.data?.length ?? 0) > 0) {
    return ok({ items: (tableRes.data ?? []).map(normalizeRow), source: "market_transaction_history" });
  }

  let backfillError: string | null = null;
  const { error: bfErr } = await authClient.rpc("market_history_backfill_me", {
    p_limit: Math.min(Math.max(limit, 100), 5000),
  } as any);
  if (bfErr) {
    backfillError = String(bfErr?.message || bfErr);
  } else {
    tableRes = await readHistoryTable();
    if (!tableRes.error && (tableRes.data?.length ?? 0) > 0) {
      return ok({ items: (tableRes.data ?? []).map(normalizeRow), source: "market_transaction_history_backfill" });
    }
  }

  const fallbackRows = await fetchLegacyHistory(admin, userId, limit);
  return ok({
    items: fallbackRows,
    source: "legacy_fallback",
    backfill_error: backfillError,
    history_table_error: tableRes.error ? String(tableRes.error?.message || tableRes.error) : null,
  });
});
