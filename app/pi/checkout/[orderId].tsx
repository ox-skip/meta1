import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  buildPiBrowserHandoff,
  parsePiIntentFromQuery,
  payPiWithCheckoutToken,
  type PiPaymentIntent,
} from "@/services/market/piCheckout";
import { friendlyMarketError } from "@/utils/marketUx";

const BG0 = "#05040B";
const BG1 = "#0A0620";

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(id);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(id);
        reject(error);
      });
  });
}

function delayResult<T>(timeoutMs: number, value: T) {
  return new Promise<T>((resolve) => {
    setTimeout(() => resolve(value), timeoutMs);
  });
}

async function tryOpenExternalUrl(url?: string | null, settleAfterMs = 1200) {
  const target = String(url || "").trim();
  if (!target) return false;

  try {
    return await Promise.race([
      Linking.openURL(target)
        .then(() => true)
        .catch(() => false),
      delayResult(settleAfterMs, true),
    ]);
  } catch {
    return false;
  }
}

export default function PublicPiCheckout() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const orderId = useMemo(() => {
    const value = params.orderId;
    return Array.isArray(value) ? String(value[0] || "").trim() : String(value || "").trim();
  }, [params.orderId]);
  const returnTo = useMemo(() => {
    const value = params.return_to;
    return Array.isArray(value) ? String(value[0] || "").trim() : String(value || "").trim();
  }, [params.return_to]);
  const autoStart = useMemo(() => {
    const value = params.auto;
    const raw = Array.isArray(value) ? String(value[0] || "").trim().toLowerCase() : String(value || "").trim().toLowerCase();
    return ["1", "true", "yes"].includes(raw);
  }, [params.auto]);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const autoStartedRef = useRef(false);

  const intentState = useMemo(() => {
    try {
      const parsed = parsePiIntentFromQuery({
        ...params,
        order_id: orderId,
      });
      return { intent: parsed as PiPaymentIntent, error: null as string | null };
    } catch (e: any) {
      return { intent: null, error: String(e?.message || "Invalid Pi checkout link.") };
    }
  }, [orderId, params]);

  const handoff = useMemo(() => {
    if (!intentState.intent) return null;
    try {
      return buildPiBrowserHandoff(intentState.intent, returnTo || null);
    } catch {
      return null;
    }
  }, [intentState.intent, returnTo]);

  async function openReturnTarget() {
    if (!returnTo) return;
    try {
      await Linking.openURL(returnTo);
    } catch {
      // leave user on current page if the return target fails
    }
  }

  async function openPiBrowser() {
    if (!handoff) return;
    const opened =
      (await tryOpenExternalUrl(handoff.pi_browser_url)) ||
      (handoff.pi_browser_url !== handoff.checkout_url && (await tryOpenExternalUrl(handoff.checkout_url)));
    if (!opened) {
      setErr("We couldn't open Pi Browser. Open Pi Browser manually and retry this payment.");
    }
  }

  async function handleResult(res: any) {
    if (res?.underpaid === true || res?.settled === false) {
      const shortfallUsd = Number(res?.shortfall_usd ?? 0);
      const topupPi = Number(res?.topup_pi_required ?? 0);
      Alert.alert(
        "Top-up required",
        `This payment reached escrow but is still under the required USD value.\n\nShortfall: $${shortfallUsd.toFixed(4)}\nTop-up needed: ${topupPi.toFixed(8)} PI\n\nReturn to BestCity and start Pi checkout again for the top-up quote.`,
        [
          returnTo
            ? { text: "Return", onPress: () => void openReturnTarget() }
            : { text: "OK" },
        ],
      );
      return;
    }

    Alert.alert(
      "Pi payment confirmed",
      "Your Pi payment is confirmed and the order is now in escrow.",
      [
        returnTo
          ? { text: "Return to BestCity", onPress: () => void openReturnTarget() }
          : {
            text: "Open order",
            onPress: () => router.replace((`/market/order/${orderId}` as any) as any),
          },
      ],
    );
  }

  async function startPayment() {
    if (busy || !intentState.intent) return;
    setErr(null);
    setBusy(true);
    try {
      const res = await withTimeout(
        payPiWithCheckoutToken(intentState.intent),
        25_000,
        "Pi checkout is taking too long. Retry once, then open Pi Browser manually if needed.",
      );
      await handleResult(res);
    } catch (e: any) {
      const message = String(e?.message || e || "");
      const lower = message.toLowerCase();
      if (lower.includes("pi sdk is unavailable") || lower.includes("pi browser")) {
        setErr("Pi Browser is required on this screen. Tap the button below to open it there.");
      } else {
        setErr(friendlyMarketError(e, "We couldn't complete Pi checkout."));
      }
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!autoStart || autoStartedRef.current || !intentState.intent) return;
    autoStartedRef.current = true;
    void startPayment();
  }, [autoStart, intentState.intent?.quote_ref]);

  return (
    <LinearGradient colors={[BG1, BG0]} style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 20,
          paddingBottom: Math.max(insets.bottom, 20) + 24,
          paddingHorizontal: 18,
        }}
      >
        <View
          style={{
            borderRadius: 24,
            padding: 18,
            backgroundColor: "rgba(255,255,255,0.06)",
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.12)",
          }}
        >
          <Text style={{ color: "#fff", fontSize: 24, fontWeight: "900" }}>Pi Checkout</Text>
          <Text style={{ marginTop: 8, color: "rgba(255,255,255,0.72)", lineHeight: 20 }}>
            Finish this BestCity order payment in Pi Browser. The quote is already locked to this order.
          </Text>

          <View style={{ marginTop: 18, gap: 8 }}>
            <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 12 }}>Order</Text>
            <Text style={{ color: "#fff", fontWeight: "800" }}>{orderId || "n/a"}</Text>
            <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 12, marginTop: 10 }}>Required</Text>
            <Text style={{ color: "#fff", fontWeight: "900", fontSize: 20 }}>
              {intentState.intent ? `${Number(intentState.intent.pi_amount).toFixed(8)} PI` : "n/a"}
            </Text>
            <Text style={{ color: "rgba(255,255,255,0.72)" }}>
              USD snapshot: {intentState.intent ? `$${Number(intentState.intent.quote_usd_amount).toFixed(4)}` : "n/a"}
            </Text>
            <Text style={{ color: "rgba(255,255,255,0.55)", fontSize: 12 }}>
              Quote expires: {intentState.intent?.quote_expires_at || "n/a"}
            </Text>
          </View>

          {!!intentState.error ? (
            <Text style={{ marginTop: 16, color: "#FCA5A5", fontWeight: "800" }}>{intentState.error}</Text>
          ) : null}

          {!!err ? (
            <Text style={{ marginTop: 16, color: "#FCA5A5", fontWeight: "800" }}>{err}</Text>
          ) : null}

          <Pressable
            disabled={busy || !intentState.intent}
            onPress={() => void startPayment()}
            style={{
              marginTop: 18,
              borderRadius: 18,
              minHeight: 54,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: busy ? "rgba(124,58,237,0.45)" : "#7C3AED",
              opacity: busy || !intentState.intent ? 0.75 : 1,
            }}
          >
            {busy ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <ActivityIndicator color="#fff" />
                <Text style={{ color: "#fff", fontWeight: "900" }}>Processing...</Text>
              </View>
            ) : (
              <Text style={{ color: "#fff", fontWeight: "900" }}>Pay With Pi</Text>
            )}
          </Pressable>

          <Pressable
            disabled={!handoff}
            onPress={() => void openPiBrowser()}
            style={{
              marginTop: 12,
              borderRadius: 18,
              minHeight: 52,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.14)",
              backgroundColor: "rgba(255,255,255,0.04)",
              opacity: handoff ? 1 : 0.65,
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "900" }}>Open In Pi Browser</Text>
          </Pressable>

          {returnTo ? (
            <Pressable
              onPress={() => void openReturnTarget()}
              style={{
                marginTop: 12,
                borderRadius: 18,
                minHeight: 50,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ color: "rgba(255,255,255,0.72)", fontWeight: "800" }}>Return To BestCity</Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    </LinearGradient>
  );
}
