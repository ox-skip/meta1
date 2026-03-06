import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import AppHeader from "@/components/common/AppHeader";
import { createPiStockIdentity } from "@/services/market/piStock";
import { friendlyMarketError } from "@/utils/marketUx";

const BG_TOP = "#111827";
const BG_BOTTOM = "#0B1020";
const CARD = "rgba(255,255,255,0.06)";
const BORDER = "rgba(255,255,255,0.12)";
const MUTED = "rgba(255,255,255,0.68)";

export default function CreatePiStockIdentityScreen() {
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [slug, setSlug] = useState("");
  const [initialPrice, setInitialPrice] = useState("0.01");

  async function onCreate() {
    setErr(null);
    setOkMsg(null);
    try {
      setSubmitting(true);
      const res = await createPiStockIdentity({
        name: name.trim(),
        symbol: symbol.trim().toUpperCase(),
        slug: slug.trim() || null,
        initial_price_usdc: Number(initialPrice || 0.01),
      });
      const createdSlug = String(res.identity?.slug || "");
      setOkMsg(res.created ? "Pi stock identity created." : "Pi stock identity already exists.");
      if (createdSlug) {
        setTimeout(() => {
          router.replace(`/market/stock/${createdSlug}` as any);
        }, 400);
      }
    } catch (e: any) {
      setErr(friendlyMarketError(e, "Could not create Pi stock identity."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <LinearGradient colors={[BG_TOP, BG_BOTTOM]} style={{ flex: 1, paddingHorizontal: 16, paddingTop: 14 }}>
      <AppHeader title="Create Pi Stock" subtitle="Create a Pi-native identity for the unified stock market." />
      <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
        <View style={{ marginTop: 12, gap: 10 }}>
          <View style={{ borderRadius: 14, padding: 12, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
            <Text style={{ color: "#fff", fontWeight: "800" }}>Name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Example: Ada Fashion House Pi"
              placeholderTextColor="rgba(255,255,255,0.45)"
              style={{ marginTop: 8, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, color: "#fff", backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: BORDER }}
              editable={!submitting}
            />
          </View>

          <View style={{ borderRadius: 14, padding: 12, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
            <Text style={{ color: "#fff", fontWeight: "800" }}>Symbol</Text>
            <TextInput
              value={symbol}
              onChangeText={(value) => setSymbol(value.toUpperCase())}
              placeholder="Example: ADAPI"
              placeholderTextColor="rgba(255,255,255,0.45)"
              autoCapitalize="characters"
              style={{ marginTop: 8, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, color: "#fff", backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: BORDER }}
              editable={!submitting}
            />
          </View>

          <View style={{ borderRadius: 14, padding: 12, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
            <Text style={{ color: "#fff", fontWeight: "800" }}>Slug (optional)</Text>
            <TextInput
              value={slug}
              onChangeText={setSlug}
              placeholder="ada-fashion-house-pi-stock"
              placeholderTextColor="rgba(255,255,255,0.45)"
              style={{ marginTop: 8, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, color: "#fff", backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: BORDER }}
              editable={!submitting}
            />
          </View>

          <View style={{ borderRadius: 14, padding: 12, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
            <Text style={{ color: "#fff", fontWeight: "800" }}>Initial Price (USD reference)</Text>
            <TextInput
              value={initialPrice}
              onChangeText={setInitialPrice}
              keyboardType="decimal-pad"
              placeholder="0.01"
              placeholderTextColor="rgba(255,255,255,0.45)"
              style={{ marginTop: 8, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, color: "#fff", backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: BORDER }}
              editable={!submitting}
            />
          </View>
        </View>

        <View style={{ marginTop: 12, borderRadius: 14, padding: 12, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
          <Text style={{ color: "#fff", fontWeight: "900" }}>Pi-native Rules</Text>
          <Text style={{ marginTop: 6, color: MUTED, fontSize: 12 }}>
            This creates a Pi-native stock identity. It appears in the same market list as EVM stocks, but buy/sell settlement stays on Pi.
          </Text>
        </View>

        {!!err ? (
          <View style={{ marginTop: 12, borderRadius: 12, padding: 10, backgroundColor: "rgba(127,29,29,0.26)", borderWidth: 1, borderColor: "rgba(239,68,68,0.35)" }}>
            <Text style={{ color: "#FCA5A5", fontWeight: "800" }}>{err}</Text>
          </View>
        ) : null}

        {!!okMsg ? (
          <View style={{ marginTop: 12, borderRadius: 12, padding: 10, backgroundColor: "rgba(6,78,59,0.26)", borderWidth: 1, borderColor: "rgba(16,185,129,0.40)" }}>
            <Text style={{ color: "#A7F3D0", fontWeight: "800" }}>{okMsg}</Text>
          </View>
        ) : null}

        <Pressable
          onPress={onCreate}
          disabled={submitting}
          style={{
            marginTop: 14,
            borderRadius: 14,
            paddingVertical: 13,
            alignItems: "center",
            backgroundColor: submitting ? "rgba(245,158,11,0.22)" : "rgba(245,158,11,0.38)",
            borderWidth: 1,
            borderColor: "rgba(245,158,11,0.48)",
          }}
        >
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#FFFBEB", fontWeight: "900", fontSize: 15 }}>Create Pi Stock Identity</Text>}
        </Pressable>
      </ScrollView>
    </LinearGradient>
  );
}
