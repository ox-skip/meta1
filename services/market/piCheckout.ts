import { Platform } from "react-native";

import { callFn } from "@/services/functions";
import { requireLocalAuth } from "@/utils/secureAuth";

type PiPaymentIntent = {
  ok: boolean;
  order_id: string;
  quote_ref: string;
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
  };
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

type PiSdk = {
  init?: (input?: Record<string, unknown>) => void;
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
};

function isPiSandbox() {
  const raw = String(process.env.EXPO_PUBLIC_PI_SANDBOX ?? "true").trim().toLowerCase();
  return !["0", "false", "no", "off"].includes(raw);
}

function getPiSdk(): PiSdk {
  const anyGlobal = globalThis as any;
  const pi = (anyGlobal?.Pi ?? anyGlobal?.window?.Pi) as PiSdk | undefined;
  if (!pi || typeof pi.createPayment !== "function") {
    throw new Error("Pi SDK is unavailable. Open checkout in Pi Browser and try again.");
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

async function requestPiIntent(orderId: string) {
  const out = await callFn<PiPaymentIntent>("market-pi-deposit-intent", {
    order_id: orderId,
  });
  return out;
}

async function approvePiPayment(orderId: string, quoteRef: string, paymentId: string) {
  await callFn("market-pi-payment-approve", {
    order_id: orderId,
    quote_ref: quoteRef,
    payment_id: paymentId,
  });
}

async function completePiPayment(orderId: string, quoteRef: string, paymentId: string, txid: string) {
  return await callFn<PiCompleteResult>("market-pi-payment-complete", {
    order_id: orderId,
    quote_ref: quoteRef,
    payment_id: paymentId,
    txid,
  });
}

async function cancelPiPayment(orderId: string, quoteRef: string, paymentId?: string | null, reason?: string) {
  try {
    await callFn("market-pi-payment-cancel", {
      order_id: orderId,
      quote_ref: quoteRef,
      payment_id: paymentId || null,
      reason: reason || "cancelled_by_user",
    });
  } catch {
    // best-effort cancel
  }
}

export async function payPiForOrder(orderId: string) {
  if (Platform.OS !== "web") {
    throw new Error("Pi payment is currently available on web Pi Browser.");
  }

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

  const pi = getPiSdk();
  ensurePiSdkInitialized(pi);

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
            await approvePiPayment(orderId, intent.quote_ref, String(paymentId || "").trim());
          },
          onReadyForServerCompletion: async (paymentId: string, txid: string) => {
            const out = await completePiPayment(
              orderId,
              intent.quote_ref,
              String(paymentId || "").trim(),
              String(txid || "").trim(),
            );
            finalizeResolve(out);
          },
          onCancel: async (paymentId?: string) => {
            await cancelPiPayment(orderId, intent.quote_ref, paymentId ?? null, "cancelled_by_user");
            finalizeReject(new Error("Pi payment was cancelled."));
          },
          onIncompletePaymentFound: async (payment?: { identifier?: string }) => {
            // Let normal flow continue; this callback is informational.
            const pid = String(payment?.identifier || "").trim();
            if (pid) {
              await approvePiPayment(orderId, intent.quote_ref, pid).catch(() => null);
            }
          },
          onError: async (error: unknown, payment?: { identifier?: string }) => {
            const pid = String(payment?.identifier || "").trim();
            await cancelPiPayment(orderId, intent.quote_ref, pid || null, "sdk_error");
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

export async function releasePiForOrder(orderId: string) {
  const localAuth = await requireLocalAuth("Release escrow to seller");
  if (!localAuth.ok) throw new Error(localAuth.message || "Authentication required");

  const out = await callFn("market-pi-release-intent", {
    order_id: orderId,
  });
  return out as any;
}

