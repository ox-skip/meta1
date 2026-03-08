import { Platform } from "react-native";

import { callFn } from "@/services/functions";
import { fetchJsonWithTimeout, getSupabaseAnonKeyOrThrow, getSupabaseFunctionsBaseUrl } from "@/services/net";
import { requireLocalAuth } from "@/utils/secureAuth";

const PI_SDK_URL_DEFAULT = "https://sdk.minepi.com/pi-sdk.js";

export type StockPiQuote = {
  side: "buy" | "sell";
  stock_id: string;
  user_id?: string;
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
  raw?: Record<string, unknown>;
};

export type StockPiLiquidity = {
  stock_id: string;
  pool_pi_reserved: number;
  queued_liability_pi: number;
  coverage_ratio: number;
  flow_balance: number;
  lpi: number;
  budget_pi: number;
  available_budget_pi: number;
  sell_spread_bps: number;
  cooldown_seconds: number;
  early_exit_fee_bps: number;
  supply_release_multiplier: number;
  sells_paused: boolean;
};

export type StockPiBuyIntent = {
  ok: boolean;
  stock_id: string;
  slug?: string;
  order_id: string;
  quote: StockPiQuote & { quote_signature: string; quote_expires_at: string };
  checkout_token: string;
  callbacks: {
    approve: string;
    complete: string;
    cancel?: string;
  };
  liquidity: StockPiLiquidity;
};

type StockPiCompleteResult = {
  ok: boolean;
  stock_id: string;
  order_id: string;
  quote_ref: string;
  payment_id: string;
  txid: string;
  settled: boolean;
  paid_pi_amount?: number;
  trade_id?: string | null;
};

export type StockPiHandoffResult = {
  ok: true;
  stock_id: string;
  order_id: string;
  handoff_required: true;
  mode: "web_browser" | "native_app";
  checkout_url: string;
  pi_browser_url: string;
  quote_ref: string;
  checkout_token: string;
  quote_expires_at: string;
  gross_pi: number;
  quantity: number;
  gross_usdc: number;
  message: string;
};

type PiSdk = {
  init?: (input?: Record<string, unknown>) => void;
  authenticate?: (
    scopes: string[],
    onIncompletePaymentFound?: (payment: { identifier?: string }) => void | Promise<void>,
  ) => Promise<unknown> | void;
  createPayment?: (
    payment: { amount: number; memo?: string; metadata?: Record<string, unknown> },
    callbacks: {
      onReadyForServerApproval?: (paymentId: string) => void | Promise<void>;
      onReadyForServerCompletion?: (paymentId: string, txid: string) => void | Promise<void>;
      onCancel?: (paymentId?: string) => void | Promise<void>;
      onError?: (error: unknown, payment?: { identifier?: string }) => void | Promise<void>;
      onIncompletePaymentFound?: (payment: { identifier?: string }) => void | Promise<void>;
    },
  ) => void;
  __bestcityStockPiInited?: boolean;
  __bestcityStockPiPaymentsScopeGranted?: boolean;
};

let piSdkLoadPromise: Promise<PiSdk | null> | null = null;

function isPiSandbox() {
  const raw = String(process.env.EXPO_PUBLIC_PI_SANDBOX ?? "true").trim().toLowerCase();
  return !["0", "false", "no", "off"].includes(raw);
}

function getPiGlobal(): PiSdk | null {
  const anyGlobal = globalThis as any;
  const pi = (anyGlobal?.Pi ?? anyGlobal?.window?.Pi) as PiSdk | undefined;
  return pi && typeof pi.createPayment === "function" ? pi : null;
}

export function isPiBrowserEnvironment() {
  if (Platform.OS !== "web") return false;
  const anyGlobal = globalThis as any;
  const ua = String(anyGlobal?.navigator?.userAgent || "").toLowerCase();
  const explicitMarker =
    anyGlobal?.__PI_BROWSER__ === true ||
    anyGlobal?.window?.__PI_BROWSER__ === true ||
    anyGlobal?.Pi?.isPiBrowser === true ||
    anyGlobal?.window?.Pi?.isPiBrowser === true;
  return explicitMarker || ua.includes("pibrowser") || ua.includes("minepi") || ua.includes("pi browser");
}

async function loadPiSdkScript() {
  if (Platform.OS !== "web") return null;

  const existing = getPiGlobal();
  if (existing) return existing;
  if (piSdkLoadPromise) return await piSdkLoadPromise;

  piSdkLoadPromise = new Promise<PiSdk | null>((resolve) => {
    const doc = (globalThis as any)?.document as Document | undefined;
    if (!doc) {
      resolve(null);
      return;
    }

    const scriptId = "bestcity-stock-pi-sdk";
    const existingScript = doc.getElementById(scriptId) as HTMLScriptElement | null;
    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(getPiGlobal()), { once: true });
      existingScript.addEventListener("error", () => resolve(null), { once: true });
      setTimeout(() => resolve(getPiGlobal()), 4000);
      return;
    }

    const script = doc.createElement("script");
    script.id = scriptId;
    script.async = true;
    script.src = String(process.env.EXPO_PUBLIC_PI_SDK_URL || PI_SDK_URL_DEFAULT).trim();
    script.onload = () => resolve(getPiGlobal());
    script.onerror = () => resolve(null);
    doc.head.appendChild(script);
    setTimeout(() => resolve(getPiGlobal()), 5000);
  });

  return await piSdkLoadPromise;
}

async function resolvePiSdk() {
  const existing = getPiGlobal();
  if (existing) return existing;
  return await loadPiSdkScript();
}

async function getPiSdk() {
  const pi = await resolvePiSdk();
  if (!pi || typeof pi.createPayment !== "function") {
    throw new Error("Pi SDK is unavailable. Continue in Pi Browser to finish this stock purchase.");
  }
  return pi;
}

function ensurePiSdkInitialized(pi: PiSdk) {
  if (pi.__bestcityStockPiInited) return;
  if (typeof pi.init === "function") {
    pi.init({
      version: "2.0",
      sandbox: isPiSandbox(),
    });
  }
  pi.__bestcityStockPiInited = true;
}

async function ensurePiPaymentsScope(
  pi: PiSdk,
  onIncompletePaymentFound?: (payment: { identifier?: string }) => void | Promise<void>,
) {
  if (pi.__bestcityStockPiPaymentsScopeGranted) return;
  if (typeof pi.authenticate !== "function") {
    throw new Error("Pi SDK authenticate() is unavailable. Open checkout in Pi Browser and try again.");
  }

  await pi.authenticate(["payments"], onIncompletePaymentFound);
  pi.__bestcityStockPiPaymentsScopeGranted = true;
}

function normalizeBaseUrl(url: string) {
  return url.trim().replace(/\/+$/, "");
}

function getPublicWebBaseUrl() {
  const fromEnv = String(
    process.env.EXPO_PUBLIC_SITE_URL ||
      process.env.EXPO_PUBLIC_WEB_URL ||
      process.env.EXPO_PUBLIC_APP_URL ||
      "",
  ).trim();

  if (Platform.OS === "web" && typeof window !== "undefined" && window.location?.origin) {
    return normalizeBaseUrl(fromEnv || window.location.origin);
  }
  if (fromEnv) return normalizeBaseUrl(fromEnv);
  throw new Error("Missing EXPO_PUBLIC_SITE_URL for Pi Browser handoff.");
}

function buildQuery(input: Record<string, string | number | boolean | null | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value === null || value === undefined || value === "") continue;
    params.set(key, String(value));
  }
  return params.toString();
}

function toPiBrowserUrl(checkoutUrl: string) {
  const parsed = new URL(checkoutUrl);
  return `pi://${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function buildPiStockCheckoutUrl(intent: StockPiBuyIntent, returnUrl?: string | null) {
  const base = getPublicWebBaseUrl();
  const query = buildQuery({
    stock_id: intent.stock_id,
    slug: intent.slug || "",
    order_id: intent.order_id,
    quote_ref: intent.quote.quote_ref,
    quote_signature: intent.quote.quote_signature,
    checkout_token: intent.checkout_token,
    quote_expires_at: intent.quote.quote_expires_at,
    gross_pi: intent.quote.gross_pi,
    quantity: intent.quote.quantity,
    gross_usdc: intent.quote.gross_usdc,
    price_execution_usdc: intent.quote.price_execution_usdc,
    return_to: returnUrl || "",
    auto: 1,
  });
  return `${base}/pi/stock/${encodeURIComponent(intent.stock_id)}?${query}`;
}

export function buildPiStockBrowserHandoff(intent: StockPiBuyIntent, returnUrl?: string | null): StockPiHandoffResult {
  const checkoutUrl = buildPiStockCheckoutUrl(intent, returnUrl);
  return {
    ok: true,
    stock_id: intent.stock_id,
    order_id: intent.order_id,
    handoff_required: true,
    mode: Platform.OS === "web" ? "web_browser" : "native_app",
    checkout_url: checkoutUrl,
    pi_browser_url: toPiBrowserUrl(checkoutUrl),
    quote_ref: intent.quote.quote_ref,
    checkout_token: intent.checkout_token,
    quote_expires_at: intent.quote.quote_expires_at,
    gross_pi: intent.quote.gross_pi,
    quantity: intent.quote.quantity,
    gross_usdc: intent.quote.gross_usdc,
    message: "Continue this stock purchase in Pi Browser.",
  };
}

function extractFnErrorMessage(name: string, res: Response, text: string, json: any) {
  return (
    json?.message ||
    json?.error ||
    (typeof json === "string" ? json : null) ||
    (text && text.length < 500 ? text : null) ||
    `Function ${name} failed (${res.status})`
  );
}

async function callPublicFn<T>(name: string, body: Record<string, unknown>, timeoutMs = 20_000): Promise<T> {
  const base = getSupabaseFunctionsBaseUrl();
  const { res, text, json } = await fetchJsonWithTimeout(
    `${base}/${name}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: getSupabaseAnonKeyOrThrow(),
      },
      body: JSON.stringify(body ?? {}),
    },
    timeoutMs,
  );

  if (!res.ok || (json as any)?.success === false) {
    throw new Error(extractFnErrorMessage(name, res, text, json));
  }
  return json as T;
}

export async function getPiStockQuote(input: {
  stock_id?: string;
  slug?: string;
  side: "buy" | "sell";
  amount_usdc?: number;
  quantity?: number;
}) {
  return await callFn<{
    ok: boolean;
    identity: any;
    quote: StockPiQuote;
    liquidity: StockPiLiquidity;
  }>("stock-pi-quote", input);
}

export async function lockPiStockSellQuote(input: {
  stock_id?: string;
  slug?: string;
  quantity: number;
}) {
  return await callFn<{
    ok: boolean;
    stock_id: string;
    quote: StockPiQuote & { quote_signature: string; quote_expires_at: string };
    liquidity: StockPiLiquidity;
    recipient_pi_uid: string;
    available_qty: number;
  }>("stock-pi-sell-quote", input);
}

export async function submitPiStockSell(input: {
  stock_id?: string;
  quote_ref: string;
  quote_signature: string;
}) {
  return await callFn<{
    ok: boolean;
    stock_id: string;
    order_id: string;
    queue_id: string;
    queue_status: string;
    queue_position: number;
    queue_seq: number | null;
    locked_payout_pi: number;
    locked_net_usdc: number;
    locked_quantity: number;
    cooldown_seconds: number;
    lpi: number;
  }>("stock-pi-sell-submit", input);
}

export async function createPiStockIdentity(input: {
  name: string;
  symbol: string;
  slug?: string | null;
  initial_price_usdc?: number;
}) {
  return await callFn<{
    ok: boolean;
    created: boolean;
    identity: any;
  }>("stock-pi-create-identity", input);
}

async function requestPiStockBuyIntent(input: { stock_id?: string; slug?: string; amount_usdc: number }) {
  return await callFn<StockPiBuyIntent>("stock-pi-buy-intent", input);
}

async function approvePiStockPayment(stockId: string, quoteRef: string, paymentId: string, checkoutToken?: string | null) {
  const body = {
    stock_id: stockId,
    quote_ref: quoteRef,
    payment_id: paymentId,
    checkout_token: checkoutToken || undefined,
  };

  if (checkoutToken) {
    await callPublicFn("stock-pi-payment-approve", body);
    return;
  }

  await callFn("stock-pi-payment-approve", body);
}

async function completePiStockPayment(
  stockId: string,
  quoteRef: string,
  paymentId: string,
  txid: string,
  checkoutToken?: string | null,
) {
  const body = {
    stock_id: stockId,
    quote_ref: quoteRef,
    payment_id: paymentId,
    txid,
    checkout_token: checkoutToken || undefined,
  };

  if (checkoutToken) {
    return await callPublicFn<StockPiCompleteResult>("stock-pi-payment-complete", body);
  }

  return await callFn<StockPiCompleteResult>("stock-pi-payment-complete", body);
}

async function cancelPiStockPayment(
  stockId: string,
  quoteRef: string,
  paymentId?: string | null,
  checkoutToken?: string | null,
) {
  const body = {
    stock_id: stockId,
    quote_ref: quoteRef,
    payment_id: paymentId || undefined,
    checkout_token: checkoutToken || undefined,
  };

  try {
    if (checkoutToken) {
      await callPublicFn("stock-pi-payment-cancel", body);
      return;
    }
    await callFn("stock-pi-payment-cancel", body);
  } catch {
    // best effort
  }
}

async function createPiPayment(intent: StockPiBuyIntent, checkoutToken?: string | null) {
  const pi = await getPiSdk();
  ensurePiSdkInitialized(pi);
  await ensurePiPaymentsScope(pi, async (payment?: { identifier?: string }) => {
    const pid = String(payment?.identifier || "").trim();
    if (pid) {
      await approvePiStockPayment(intent.stock_id, intent.quote.quote_ref, pid, checkoutToken).catch(() => null);
    }
  });

  const out = await new Promise<StockPiCompleteResult>((resolve, reject) => {
    let done = false;
    const finishResolve = (value: StockPiCompleteResult) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    const finishReject = (error: unknown) => {
      if (done) return;
      done = true;
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    try {
      pi.createPayment?.(
        {
          amount: Number(intent.quote.gross_pi),
          memo: `BestCity stock ${intent.stock_id}`,
          metadata: {
            stock_id: intent.stock_id,
            order_id: intent.order_id,
            quote_ref: intent.quote.quote_ref,
          },
        },
        {
          onReadyForServerApproval: async (paymentId: string) => {
            await approvePiStockPayment(intent.stock_id, intent.quote.quote_ref, String(paymentId || "").trim(), checkoutToken);
          },
          onReadyForServerCompletion: async (paymentId: string, txid: string) => {
            const res = await completePiStockPayment(
              intent.stock_id,
              intent.quote.quote_ref,
              String(paymentId || "").trim(),
              String(txid || "").trim(),
              checkoutToken,
            );
            finishResolve(res);
          },
          onIncompletePaymentFound: async (payment?: { identifier?: string }) => {
            const pid = String(payment?.identifier || "").trim();
            if (pid) {
              await approvePiStockPayment(intent.stock_id, intent.quote.quote_ref, pid, checkoutToken).catch(() => null);
            }
          },
          onCancel: async () => {
            await cancelPiStockPayment(intent.stock_id, intent.quote.quote_ref, null, checkoutToken);
            finishReject(new Error("Pi stock payment was cancelled."));
          },
          onError: async (error: unknown) => {
            await cancelPiStockPayment(intent.stock_id, intent.quote.quote_ref, null, checkoutToken);
            finishReject(error);
          },
        },
      );
    } catch (e: any) {
      finishReject(new Error(String(e?.message || e)));
    }
  });

  return out;
}

export async function buyStockWithPi(
  input: { stock_id?: string; slug?: string; amount_usdc: number },
  options?: { returnUrl?: string | null },
) {
  const localAuth = await requireLocalAuth("Confirm PI stock purchase");
  if (!localAuth.ok) throw new Error(localAuth.message || "Authentication required");

  const intent = await requestPiStockBuyIntent(input);
  if (Platform.OS !== "web" || !isPiBrowserEnvironment()) {
    return buildPiStockBrowserHandoff(intent, options?.returnUrl || null);
  }

  const pi = await resolvePiSdk();
  if (!pi || typeof pi.createPayment !== "function") {
    return buildPiStockBrowserHandoff(intent, options?.returnUrl || null);
  }

  ensurePiSdkInitialized(pi);
  return await createPiPayment(intent);
}

export async function payPiStockWithCheckoutToken(intent: StockPiBuyIntent) {
  if (Platform.OS !== "web" || !isPiBrowserEnvironment()) {
    throw new Error("Pi stock checkout must run inside Pi Browser.");
  }
  if (!intent.checkout_token) {
    throw new Error("Missing checkout token");
  }
  return await createPiPayment(intent, intent.checkout_token);
}

export function parsePiStockIntentFromQuery(input: Record<string, string | string[] | undefined>): StockPiBuyIntent {
  const read = (key: string) => {
    const value = input[key];
    return Array.isArray(value) ? String(value[0] || "").trim() : String(value || "").trim();
  };

  const stockId = read("stock_id");
  const slug = read("slug");
  const orderId = read("order_id");
  const quoteRef = read("quote_ref");
  const quoteSignature = read("quote_signature");
  const checkoutToken = read("checkout_token");
  const quoteExpiresAt = read("quote_expires_at");
  const grossPi = Number(read("gross_pi") || 0);
  const quantity = Number(read("quantity") || 0);
  const grossUsdc = Number(read("gross_usdc") || 0);
  const priceExecutionUsdc = Number(read("price_execution_usdc") || 0);

  if (!stockId) throw new Error("Missing stock_id");
  if (!orderId) throw new Error("Missing order_id");
  if (!quoteRef) throw new Error("Missing quote_ref");
  if (!quoteSignature) throw new Error("Missing quote_signature");
  if (!checkoutToken) throw new Error("Missing checkout_token");
  if (!quoteExpiresAt) throw new Error("Missing quote_expires_at");

  return {
    ok: true,
    stock_id: stockId,
    slug: slug || undefined,
    order_id: orderId,
    checkout_token: checkoutToken,
    callbacks: {
      approve: "stock-pi-payment-approve",
      complete: "stock-pi-payment-complete",
      cancel: "stock-pi-payment-cancel",
    },
    liquidity: {
      stock_id: stockId,
      pool_pi_reserved: 0,
      queued_liability_pi: 0,
      coverage_ratio: 1,
      flow_balance: 1,
      lpi: 0,
      budget_pi: 0,
      available_budget_pi: 0,
      sell_spread_bps: 0,
      cooldown_seconds: 0,
      early_exit_fee_bps: 0,
      supply_release_multiplier: 1,
      sells_paused: false,
    },
    quote: {
      side: "buy",
      stock_id: stockId,
      rail: "pi",
      quote_ref: quoteRef,
      quote_signature: quoteSignature,
      quote_expires_at: quoteExpiresAt,
      price_spot_usdc: priceExecutionUsdc,
      price_execution_usdc: priceExecutionUsdc,
      gross_usdc: grossUsdc,
      fee_usdc: 0,
      net_usdc: grossUsdc,
      pi_price_usd: grossPi > 0 ? grossUsdc / grossPi : 0,
      gross_pi: grossPi,
      fee_pi: 0,
      net_pi: grossPi,
      quantity,
      price_impact_bps: 0,
      slippage_bps: 0,
      stress_spread_bps: 0,
      fee_bps: 0,
      lpi: 0,
      coverage_ratio: 1,
      flow_balance: 1,
      early_exit_fee_bps: 0,
      cooldown_seconds: 0,
      supply_release_multiplier: 1,
      sells_paused: false,
      liquidity_usdc: 0,
    },
  };
}
