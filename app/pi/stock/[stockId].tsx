import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  buildPiStockBrowserHandoff,
  parsePiStockIntentFromQuery,
  payPiStockWithCheckoutToken,
  type StockPiBuyIntent,
} from "@/services/market/piStock";
import { friendlyMarketError } from "@/utils/marketUx";

const BG0 = "#071018";
const BG1 = "#0D1B2A";

export default function PublicPiStockCheckout() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const stockId = useMemo(() => {
    const value = params.stockId;
    return Array.isArray(value) ? String(value[0] || "").trim() : String(value || "").trim();
  }, [params.stockId]);
  const returnTo = useMemo(() => {
    const value = params.return_to;
    return Array.isArray(value) ? String(value[0] || "").trim() : String(value || "").trim();
  }, [params.return_to]);
  const stockSlug = useMemo(() => {
    const value = params.slug;
    return Array.isArray(value) ? String(value[0] || "").trim() : String(value || "").trim();
  }, [params.slug]);
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
      const parsed = parsePiStockIntentFromQuery({
        ...params,
        stock_id: stockId,
      });
      return { intent: parsed as StockPiBuyIntent, error: null as string | null };
    } catch (e: any) {
      return { intent: null, error: String(e?.message || "Invalid Pi stock checkout link.") };
    }
  }, [params, stockId]);

  const handoff = useMemo(() => {
    if (!intentState.intent) return null;
    try {
      return buildPiStockBrowserHandoff(intentState.intent, returnTo || null);
    } catch {
      return null;
    }
  }, [intentState.intent, returnTo]);

  async function openReturnTarget() {
    if (!returnTo) return;
    try {
      await Linking.openURL(returnTo);
    } catch {
      // ignore
    }
  }

  async function openPiBrowser() {
    if (!handoff) return;
    try {
      await Linking.openURL(handoff.pi_browser_url);
      return;
    } catch {
      // fallback below
    }
    try {
      await Linking.openURL(handoff.checkout_url);
    } catch (e: any) {
      setErr(friendlyMarketError(e, "We couldn't open Pi Browser."));
    }
  }

  async function handleResult(res: any) {
    Alert.alert(
      "Pi stock purchase confirmed",
      "Your Pi payment is confirmed and your stock position has been credited.",
      [
        returnTo
          ? { text: "Return to BestCity", onPress: () => void openReturnTarget() }
          : {
            text: "Open stock",
            onPress: () => router.replace((`/market/stock/${stockSlug || stockId}` as any) as any),
          },
      ],
    );
  }

  async function startPayment() {
    if (busy || !intentState.intent) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await payPiStockWithCheckoutToken(intentState.intent);
      await handleResult(res);
    } catch (e: any) {
      const message = String(e?.message || e || "");
      if (message.toLowerCase().includes("pi sdk is unavailable")) {
        setErr("Pi Browser is required on this screen. Tap the button below to open it there.");
      } else {
        setErr(friendlyMarketError(e, "We couldn't complete the Pi stock purchase."));
      }
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!autoStart || autoStartedRef.current || !intentState.intent) return;
    autoStartedRef.current = true;
    void startPayment();
  }, [autoStart, intentState.intent?.quote.quote_ref]);

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
          <Text style={{ color: "#fff", fontSize: 24, fontWeight: "900" }}>Pi Stock Checkout</Text>
          <Text style={{ marginTop: 8, color: "rgba(255,255,255,0.72)", lineHeight: 20 }}>
            Finish this BestCity stock purchase in Pi Browser. The share quantity and Pi amount are locked to this quote.
          </Text>

          <View style={{ marginTop: 18, gap: 8 }}>
            <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 12 }}>Stock</Text>
            <Text style={{ color: "#fff", fontWeight: "800" }}>{stockId || "n/a"}</Text>
            <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 12, marginTop: 10 }}>Required</Text>
            <Text style={{ color: "#fff", fontWeight: "900", fontSize: 20 }}>
              {intentState.intent ? `${Number(intentState.intent.quote.gross_pi).toFixed(8)} PI` : "n/a"}
            </Text>
            <Text style={{ color: "rgba(255,255,255,0.72)" }}>
              Shares: {intentState.intent ? Number(intentState.intent.quote.quantity).toFixed(6) : "n/a"}
            </Text>
            <Text style={{ color: "rgba(255,255,255,0.72)" }}>
              USD: {intentState.intent ? `$${Number(intentState.intent.quote.gross_usdc).toFixed(4)}` : "n/a"}
            </Text>
            <Text style={{ color: "rgba(255,255,255,0.55)", fontSize: 12 }}>
              Quote expires: {intentState.intent?.quote.quote_expires_at || "n/a"}
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
              backgroundColor: busy ? "rgba(45,212,191,0.45)" : "rgba(45,212,191,0.74)",
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
