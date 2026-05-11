import { Platform } from "react-native";

import { callFn } from "@/services/functions";
import { fetchJsonWithTimeout, getSupabaseAnonKeyOrThrow, getSupabaseFunctionsBaseUrl } from "@/services/net";
import { requireLocalAuth } from "@/utils/secureAuth";

const PI_SDK_URL_DEFAULT = "https://sdk.minepi.com/pi-sdk.js";

export type PiPaymentIntent = {
  ok: boolean;
  order_id: string;
  quote_ref: string;
  checkout_token?: string;
  quote_usd_amount: number;
  pi_amount: number;
  quote_price_usd: number;
  quote_expires_at: string;
  is_topup: boolean;
  strict_underpayment_protection: boolean;
  memo: string;
  metadata: {
    order_id: string;
    quote_ref: string;
    seller_pi_wallet?: string;
  };
  seller_pi_wallet?: string;
};

type PiCompleteResult = {
  ok: boolean;
  order_id: string;
  payment_id: string;
  txid: string;
  settled: boolean;
  underpaid?: boolean;
  strict_underpayment_protection?: boolean;
  shortfall_usd?: number;
  topup_pi_required?: number;
  cumulative_paid_usd?: number;
  required_usd?: number;
};

export type PiPaymentHandoffResult = {
  ok: true;
  order_id: string;
  handoff_required: true;
  mode: "web_browser" | "native_app";
  checkout_url: string;
  pi_browser_url: string;
  quote_ref: string;
  checkout_token: string;
  quote_expires_at: string;
  pi_amount: number;
  quote_usd_amount: number;
  quote_price_usd: number;
  memo: string;
  message: string;
};

type PiSdk = {
  init?: (input?: Record<string, unknown>) => void;
  authenticate?: (
    scopes: string[],
    onIncompletePaymentFound?: (payment: { identifier?: string }) => void | Promise<void>,
  ) => Promise<unknown>;
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
  __bestcityInited?: boolean;
  __bestcityPaymentsScopeGranted?: boolean;
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

function hasPiBrowserUserAgent() {
  if (Platform.OS !== "web") return false;
  const ua = String((globalThis as any)?.navigator?.userAgent || "").toLowerCase();
  return ua.includes("pibrowser") || ua.includes("minepi") || ua.includes("pi browser");
}

export function isPiBrowserEnvironment() {
  if (Platform.OS !== "web") return false;
  const anyGlobal = globalThis as any;
  const explicitMarker =
    anyGlobal?.__PI_BROWSER__ === true ||
    anyGlobal?.window?.__PI_BROWSER__ === true ||
    anyGlobal?.Pi?.isPiBrowser === true ||
    anyGlobal?.window?.Pi?.isPiBrowser === true;
  return explicitMarker || hasPiBrowserUserAgent();
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

    const scriptId = "bestcity-pi-sdk";
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

  const result = await piSdkLoadPromise;
  return result;
}

async function resolvePiSdk() {
  const existing = getPiGlobal();
  if (existing) return existing;
  return await loadPiSdkScript();
}

async function getPiSdk() {
  const pi = await resolvePiSdk();
  if (!pi || typeof pi.createPayment !== "function") {
    throw new Error("Pi SDK is unavailable. Continue in Pi Browser to finish this payment.");
  }
  return pi;
}

function ensurePiSdkInitialized(pi: PiSdk) {
  if (pi.__bestcityInited) return;
  if (typeof pi.init === "function") {
    pi.init({
      version: "2.0",
      sandbox: isPiSandbox(),
    });
  }
  pi.__bestcityInited = true;
}

async function ensurePiPaymentsScope(
  pi: PiSdk,
  onIncompletePaymentFound?: (payment: { identifier?: string }) => void | Promise<void>,
) {
  if (pi.__bestcityPaymentsScopeGranted) return;
  if (typeof pi.authenticate !== "function") {
    throw new Error("Pi SDK authenticate() is unavailable. Open checkout in Pi Browser and try again.");
  }

  await pi.authenticate(["payments"], onIncompletePaymentFound);
  pi.__bestcityPaymentsScopeGranted = true;
}

function normalizeBaseUrl(url: string) {
  let value = String(url || "").trim();
  if (!value) return "";
  value = value.replace(/^(https?):\/\/https?:?\/\/+/i, "$1://");
  value = value.replace(/^(https?):?\/\/+/i, "$1://");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    value = `https://${value.replace(/^\/+/, "")}`;
  }
  const parsed = new URL(value);
  const path = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${path}`;
}

function getPublicWebBaseUrl() {
  if (Platform.OS === "web" && typeof window !== "undefined" && window.location?.origin) {
    return normalizeBaseUrl(window.location.origin);
  }

  const fromEnv = String(
    process.env.EXPO_PUBLIC_SITE_URL ||
      process.env.EXPO_PUBLIC_WEB_URL ||
      process.env.EXPO_PUBLIC_APP_URL ||
      "",
  ).trim();
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

function buildPiCheckoutUrl(intent: PiPaymentIntent, returnUrl?: string | null) {
  const base = getPublicWebBaseUrl();
  const query = buildQuery({
    quote_ref: intent.quote_ref,
    checkout_token: String(intent.checkout_token || "").trim(),
    quote_usd_amount: intent.quote_usd_amount,
    pi_amount: intent.pi_amount,
    quote_price_usd: intent.quote_price_usd,
    quote_expires_at: intent.quote_expires_at,
    is_topup: intent.is_topup ? 1 : 0,
    memo: intent.memo,
    seller_pi_wallet: intent.seller_pi_wallet || intent.metadata?.seller_pi_wallet || "",
    return_to: returnUrl || "",
    auto: 1,
  });
  return `${base}/pi/checkout/${encodeURIComponent(intent.order_id)}?${query}`;
}

export function buildPiBrowserHandoff(intent: PiPaymentIntent, returnUrl?: string | null): PiPaymentHandoffResult {
  const checkoutToken = String(intent.checkout_token || "").trim();
  if (!checkoutToken) throw new Error("Missing Pi checkout token. Start Pi checkout again.");

  const checkoutUrl = buildPiCheckoutUrl(intent, returnUrl);
  return {
    ok: true,
    order_id: intent.order_id,
    handoff_required: true,
    mode: Platform.OS === "web" ? "web_browser" : "native_app",
    checkout_url: checkoutUrl,
    pi_browser_url: toPiBrowserUrl(checkoutUrl),
    quote_ref: intent.quote_ref,
    checkout_token: checkoutToken,
    quote_expires_at: intent.quote_expires_at,
    pi_amount: intent.pi_amount,
    quote_usd_amount: intent.quote_usd_amount,
    quote_price_usd: intent.quote_price_usd,
    memo: intent.memo,
    message: "Continue this payment in Pi Browser.",
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

async function callPiPublicFn<T>(name: string, body: Record<string, unknown>, timeoutMs = 20000): Promise<T> {
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

async function requestPiIntent(orderId: string) {
  return await callFn<PiPaymentIntent>("market-pi-deposit-intent", {
    order_id: orderId,
  });
}

async function approvePiPayment(orderId: string, quoteRef: string, paymentId: string, checkoutToken?: string | null) {
  const body = {
    order_id: orderId,
    quote_ref: quoteRef,
    payment_id: paymentId,
    checkout_token: checkoutToken || undefined,
  };

  if (checkoutToken) {
    await callPiPublicFn("market-pi-payment-approve", body);
    return;
  }

  await callFn("market-pi-payment-approve", body);
}

async function completePiPayment(
  orderId: string,
  quoteRef: string,
  paymentId: string,
  txid: string,
  checkoutToken?: string | null,
) {
  const body = {
    order_id: orderId,
    quote_ref: quoteRef,
    payment_id: paymentId,
    txid,
    checkout_token: checkoutToken || undefined,
  };

  if (checkoutToken) {
    return await callPiPublicFn<PiCompleteResult>("market-pi-payment-complete", body);
  }

  return await callFn<PiCompleteResult>("market-pi-payment-complete", body);
}

async function cancelPiPayment(
  orderId: string,
  quoteRef: string,
  paymentId?: string | null,
  reason?: string,
  checkoutToken?: string | null,
) {
  try {
    const body = {
      order_id: orderId,
      quote_ref: quoteRef,
      payment_id: paymentId || null,
      reason: reason || "cancelled_by_user",
      checkout_token: checkoutToken || undefined,
    };

    if (checkoutToken) {
      await callPiPublicFn("market-pi-payment-cancel", body);
      return;
    }

    await callFn("market-pi-payment-cancel", body);
  } catch {}
}

async function createPiPayment(intent: PiPaymentIntent, checkoutToken?: string | null) {
  const pi = await getPiSdk();
  ensurePiSdkInitialized(pi);
  await ensurePiPaymentsScope(pi, async (payment?: { identifier?: string }) => {
    const pid = String(payment?.identifier || "").trim();
    if (pid) {
      await approvePiPayment(intent.order_id, intent.quote_ref, pid, checkoutToken).catch(() => null);
    }
  });

  const result = await new Promise<PiCompleteResult>((resolve, reject) => {
    let done = false;
    const finalizeResolve = (value: PiCompleteResult) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    const finalizeReject = (error: unknown) => {
      if (done) return;
      done = true;
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    try {
      pi.createPayment?.(
        {
          amount: Number(intent.pi_amount),
          memo: intent.memo,
          metadata: intent.metadata,
        },
        {
          onReadyForServerApproval: async (paymentId: string) => {
            await approvePiPayment(intent.order_id, intent.quote_ref, String(paymentId || "").trim(), checkoutToken);
          },
          onReadyForServerCompletion: async (paymentId: string, txid: string) => {
            const out = await completePiPayment(
              intent.order_id,
              intent.quote_ref,
              String(paymentId || "").trim(),
              String(txid || "").trim(),
              checkoutToken,
            );
            finalizeResolve(out);
          },
          onCancel: async (paymentId?: string) => {
            await cancelPiPayment(
              intent.order_id,
              intent.quote_ref,
              paymentId ?? null,
              "cancelled_by_user",
              checkoutToken,
            );
            finalizeReject(new Error("Pi payment was cancelled."));
          },
          onIncompletePaymentFound: async (payment?: { identifier?: string }) => {
            const pid = String(payment?.identifier || "").trim();
            if (pid) {
              await approvePiPayment(intent.order_id, intent.quote_ref, pid, checkoutToken).catch(() => null);
            }
          },
          onError: async (error: unknown, payment?: { identifier?: string }) => {
            const pid = String(payment?.identifier || "").trim();
            await cancelPiPayment(intent.order_id, intent.quote_ref, pid || null, "sdk_error", checkoutToken);
            const msg = String((error as any)?.message || error || "Pi payment failed");
            finalizeReject(new Error(msg));
          },
        },
      );
    } catch (e: any) {
      finalizeReject(new Error(String(e?.message || e)));
    }
  });

  return {
    ...result,
    quote_ref: intent.quote_ref,
    pi_amount: intent.pi_amount,
    quote_usd_amount: intent.quote_usd_amount,
    quote_price_usd: intent.quote_price_usd,
    strict_underpayment_protection: intent.strict_underpayment_protection === true,
  };
}

export async function payPiForOrder(orderId: string, options?: { returnUrl?: string | null }) {
  const localAuth = await requireLocalAuth("Confirm PI deposit");
  if (!localAuth.ok) throw new Error(localAuth.message || "Authentication required");

  const intent = await requestPiIntent(orderId);
  if ((intent as any)?.already_settled) {
    return {
      ok: true,
      order_id: orderId,
      settled: true,
      already_settled: true,
      strict_underpayment_protection: true,
    };
  }

  if (Platform.OS !== "web" || !isPiBrowserEnvironment()) {
    return buildPiBrowserHandoff(intent, options?.returnUrl || null);
  }

  const pi = await resolvePiSdk();
  if (!pi || typeof pi.createPayment !== "function") {
    return buildPiBrowserHandoff(intent, options?.returnUrl || null);
  }

  ensurePiSdkInitialized(pi);
  return await createPiPayment(intent);
}

export async function payPiWithCheckoutToken(intent: PiPaymentIntent) {
  if (Platform.OS !== "web" || !isPiBrowserEnvironment()) {
    throw new Error("Pi checkout must run inside Pi Browser.");
  }

  const checkoutToken = String(intent.checkout_token || "").trim();
  if (!checkoutToken) {
    throw new Error("Missing Pi checkout token.");
  }

  return await createPiPayment(intent, checkoutToken);
}

export function parsePiIntentFromQuery(input: Record<string, string | string[] | undefined>): PiPaymentIntent {
  const read = (key: string) => {
    const value = input[key];
    return Array.isArray(value) ? String(value[0] || "").trim() : String(value || "").trim();
  };

  const orderId = read("order_id");
  const quoteRef = read("quote_ref");
  const checkoutToken = read("checkout_token");
  const piAmount = Number(read("pi_amount") || 0);
  const quoteUsdAmount = Number(read("quote_usd_amount") || 0);
  const quotePriceUsd = Number(read("quote_price_usd") || 0);
  const quoteExpiresAt = read("quote_expires_at");
  const memo = read("memo");
  const sellerPiWallet = read("seller_pi_wallet");
  const isTopup = ["1", "true", "yes"].includes(read("is_topup").toLowerCase());

  if (!orderId) throw new Error("Missing order_id");
  if (!quoteRef) throw new Error("Missing quote_ref");
  if (!checkoutToken) throw new Error("Missing checkout_token");
  if (!Number.isFinite(piAmount) || piAmount <= 0) throw new Error("Invalid pi_amount");
  if (!Number.isFinite(quoteUsdAmount) || quoteUsdAmount <= 0) throw new Error("Invalid quote_usd_amount");
  if (!Number.isFinite(quotePriceUsd) || quotePriceUsd <= 0) throw new Error("Invalid quote_price_usd");
  if (!quoteExpiresAt) throw new Error("Missing quote_expires_at");
  if (!memo) throw new Error("Missing memo");

  return {
    ok: true,
    order_id: orderId,
    quote_ref: quoteRef,
    checkout_token: checkoutToken,
    quote_usd_amount: quoteUsdAmount,
    pi_amount: piAmount,
    quote_price_usd: quotePriceUsd,
    quote_expires_at: quoteExpiresAt,
    is_topup: isTopup,
    strict_underpayment_protection: true,
    memo,
    metadata: {
      order_id: orderId,
      quote_ref: quoteRef,
      seller_pi_wallet: sellerPiWallet || undefined,
    },
    seller_pi_wallet: sellerPiWallet || undefined,
  };
}

export function buildPiReturnUrl(orderId: string) {
  const base = getPublicWebBaseUrl();
  return `${base}/market/order/${encodeURIComponent(orderId)}`;
}

export function buildNativeOrderReturnUrl(orderId: string) {
  return `bestcitypay://market/order/${encodeURIComponent(orderId)}`;
}

export async function releasePiForOrder(orderId: string) {
  const localAuth = await requireLocalAuth("Release escrow to seller");
  if (!localAuth.ok) throw new Error(localAuth.message || "Authentication required");

  const out = await callFn("market-pi-release-intent", {
    order_id: orderId,
  });
  return out as any;
}
