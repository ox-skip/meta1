import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";

import AppHeader from "@/components/common/AppHeader";
import { InAppTutorial } from "@/components/onboarding/InAppTutorial";
import { fetchMyStockPortfolio } from "@/services/market/stocks";
import { tutorialFlows } from "@/services/onboarding/definitions";
import { friendlyMarketError } from "@/utils/marketUx";

const BG_TOP = "#0D1B2A";
const BG_BOTTOM = "#071018";
const CARD = "rgba(255,255,255,0.06)";
const BORDER = "rgba(255,255,255,0.12)";
const MINT = "#2DD4BF";
const MUTED = "rgba(255,255,255,0.68)";

export default function StockPortfolioScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState<any[]>([]);

  async function load() {
    setErr(null);
    try {
      const res = await fetchMyStockPortfolio();
      setRows(res.positions ?? []);
      setTotal(Number(res.total_value_usdc ?? 0));
    } catch (e: any) {
      setRows([]);
      setTotal(0);
      setErr(friendlyMarketError(e, "Unable to load your stock portfolio."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <LinearGradient colors={[BG_TOP, BG_BOTTOM]} style={{ flex: 1, paddingHorizontal: 16, paddingTop: 14 }}>
      <InAppTutorial enabled={!loading} flow={tutorialFlows.stockPortfolio} />
      <AppHeader title="Stock Portfolio" subtitle="Holdings from your digital stock trades." />
      <ScrollView
        contentContainerStyle={{ paddingBottom: 28 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      >
        <View style={{ marginTop: 10, borderRadius: 16, padding: 14, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
          <Text style={{ color: MUTED, fontWeight: "700", fontSize: 12 }}>Total Value</Text>
          <Text style={{ marginTop: 6, color: "#fff", fontWeight: "900", fontSize: 24 }}>${total.toFixed(2)}</Text>
        </View>

        {loading ? (
          <View style={{ marginTop: 24, alignItems: "center" }}>
            <ActivityIndicator />
            <Text style={{ marginTop: 8, color: MUTED }}>Loading portfolio...</Text>
          </View>
        ) : null}

        {!!err ? (
          <View style={{ marginTop: 12, borderRadius: 12, padding: 10, backgroundColor: "rgba(127,29,29,0.26)", borderWidth: 1, borderColor: "rgba(239,68,68,0.35)" }}>
            <Text style={{ color: "#FCA5A5", fontWeight: "800" }}>{err}</Text>
          </View>
        ) : null}

        {!loading && !err && rows.length === 0 ? (
          <View style={{ marginTop: 12, borderRadius: 14, padding: 12, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
            <Text style={{ color: "#fff", fontWeight: "900" }}>No holdings yet</Text>
            <Text style={{ marginTop: 6, color: MUTED }}>Buy a stock identity to see it here.</Text>
            <Pressable
              onPress={() => router.push("/market/stock" as any)}
              style={{
                marginTop: 10,
                borderRadius: 10,
                paddingVertical: 10,
                alignItems: "center",
                backgroundColor: "rgba(45,212,191,0.16)",
                borderWidth: 1,
                borderColor: "rgba(45,212,191,0.45)",
              }}
            >
              <Text style={{ color: "#ECFEFF", fontWeight: "900" }}>Browse Stocks</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={{ marginTop: 10, gap: 10 }}>
          {rows.map((row: any) => {
            const stock = row.identity;
            const symbol = String(stock?.symbol || "");
            const name = String(stock?.name || "Stock");
            const slug = String(stock?.slug || "");
            const qty = Number(row.balance_qty ?? 0);
            const avg = Number(row.avg_cost_usdc ?? 0);
            const locked = Number(row.locked_redemption_qty ?? 0);
            const price = Number(row.price_now_usdc ?? 0);
            const value = Number(row.value_usdc ?? 0);
            const pnl = Number(row.unrealized_pnl_usdc ?? 0);

            return (
              <Pressable
                key={`${row.stock_id}-${row.user_id}`}
                onPress={() => slug && router.push(`/market/stock/${slug}` as any)}
                style={{ borderRadius: 14, padding: 12, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: "#fff", fontWeight: "900" }}>
                      {name} <Text style={{ color: "#99F6E4" }}>({symbol})</Text>
                    </Text>
                    <Text style={{ marginTop: 4, color: MUTED, fontSize: 12 }}>Qty {qty.toFixed(6)} - Avg ${avg.toFixed(6)}</Text>
                    {locked > 0 ? (
                      <Text style={{ marginTop: 2, color: "#FDE68A", fontSize: 11 }}>
                        Locked for redemption {locked.toFixed(6)}
                      </Text>
                    ) : null}
                    <Text style={{ marginTop: 2, color: "rgba(255,255,255,0.55)", fontSize: 11 }}>
                      Current ${price.toFixed(6)}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={{ color: "#fff", fontWeight: "900" }}>${value.toFixed(2)}</Text>
                    <Text style={{ marginTop: 4, color: pnl >= 0 ? MINT : "#FCA5A5", fontSize: 12, fontWeight: "800" }}>
                      {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}
                    </Text>
                    <Ionicons style={{ marginTop: 3 }} name="chevron-forward" size={16} color="rgba(255,255,255,0.7)" />
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </LinearGradient>
  );
}
