import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import AppHeader from "@/components/common/AppHeader";
import {
  STOCK,
  StockAlert,
  StockField,
  StockInput,
  StockMetric,
  StockPanel,
  StockPill,
  StockScreen,
  formatStockPrice,
} from "@/components/market/stock/StockUi";
import { createPiStockIdentity } from "@/services/market/piStock";
import { friendlyMarketError } from "@/utils/marketUx";

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
      if (!name.trim() || name.trim().length < 3) throw new Error("Name must be at least 3 characters");
      if (!symbol.trim() || symbol.trim().length < 2) throw new Error("Symbol must be at least 2 characters");
      const price = Number(initialPrice || 0);
      if (!Number.isFinite(price) || price <= 0) throw new Error("Enter a valid initial price");
      setSubmitting(true);
      const res = await createPiStockIdentity({
        name: name.trim(),
        symbol: symbol.trim().toUpperCase(),
        slug: slug.trim() || null,
        initial_price_usdc: price,
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
    <StockScreen>
      <AppHeader title="Create Pi Stock" subtitle="Publish a Pi-native market identity for your store." />
      <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
        <StockPanel style={{ marginTop: 10 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <StockPill label="Pi Native" tone="amber" icon="planet-outline" compact />
              <Text style={{ marginTop: 12, color: STOCK.ink, fontSize: 28, fontWeight: "900" }}>
                Pi settlement
              </Text>
              <Text style={{ marginTop: 4, color: STOCK.muted, fontWeight: "800" }}>
                Listed beside EVM stocks with Pi buy and sell settlement.
              </Text>
            </View>
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: 22,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "rgba(245,158,11,0.15)",
                borderWidth: 1,
                borderColor: "rgba(245,158,11,0.42)",
              }}
            >
              <Ionicons name="planet" size={25} color={STOCK.amber} />
            </View>
          </View>
          <View style={{ marginTop: 16, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            <StockMetric label="Rail" value="PI" tone="amber" />
            <StockMetric label="Reference" value={formatStockPrice(Number(initialPrice || 0), 4)} tone="cyan" />
            <StockMetric label="Status" value="Tradable" tone="mint" />
          </View>
        </StockPanel>

        <View style={{ marginTop: 12, gap: 10 }}>
          <StockField label="Stock Name" caption="Use the public store or product name for this Pi market.">
            <StockInput value={name} onChangeText={setName} placeholder="Ada Fashion House Pi" editable={!submitting} />
          </StockField>

          <StockField label="Ticker Symbol" caption="Keep it short enough for the trading header and order cards.">
            <StockInput
              value={symbol}
              onChangeText={(value) => setSymbol(value.toUpperCase())}
              placeholder="ADAPI"
              autoCapitalize="characters"
              editable={!submitting}
            />
          </StockField>

          <StockField label="Market Slug" caption="Optional. Leave blank to generate one from the stock name.">
            <StockInput
              value={slug}
              onChangeText={setSlug}
              placeholder="ada-fashion-house-pi-stock"
              autoCapitalize="none"
              editable={!submitting}
            />
          </StockField>

          <StockField label="Initial Price" caption="USD reference used when the Pi identity is first listed.">
            <StockInput
              value={initialPrice}
              onChangeText={setInitialPrice}
              keyboardType="decimal-pad"
              placeholder="0.01"
              editable={!submitting}
            />
          </StockField>
        </View>

        <StockPanel style={{ marginTop: 12 }}>
          <Text style={{ color: STOCK.ink, fontWeight: "900", fontSize: 15 }}>Pi Market Rules</Text>
          <Text style={{ marginTop: 6, color: STOCK.muted, fontSize: 12, lineHeight: 18 }}>
            Buy orders authorize in Pi Browser. Sell orders use locked redemption quotes and the stock queue budget.
          </Text>
        </StockPanel>

        {!!err ? <StockAlert>{err}</StockAlert> : null}
        {!!okMsg ? <StockAlert tone="mint">{okMsg}</StockAlert> : null}

        <Pressable
          onPress={onCreate}
          disabled={submitting}
          style={{
            marginTop: 14,
            borderRadius: 18,
            minHeight: 52,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: submitting ? "rgba(255,255,255,0.12)" : "rgba(245,158,11,0.25)",
            borderWidth: 1,
            borderColor: submitting ? STOCK.border : "rgba(245,158,11,0.52)",
          }}
        >
          <Text style={{ color: submitting ? STOCK.faint : "#FEF3C7", fontWeight: "900", fontSize: 15 }}>
            {submitting ? "Creating" : "Create Pi Stock"}
          </Text>
        </Pressable>
      </ScrollView>
    </StockScreen>
  );
}
