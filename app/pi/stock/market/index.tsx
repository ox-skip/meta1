import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";

import AppHeader from "@/components/common/AppHeader";
import { fetchStocksOverview, type StockOverviewItem } from "@/services/market/stocks";
import { friendlyMarketError } from "@/utils/marketUx";

const BG_TOP = "#111827";
const BG_BOTTOM = "#0B1020";
const CARD = "rgba(255,255,255,0.06)";
const BORDER = "rgba(255,255,255,0.12)";
const GOLD = "#F59E0B";
const SKY = "#38BDF8";
const MUTED = "rgba(255,255,255,0.68)";

export default function PiStockMarketScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [items, setItems] = useState<StockOverviewItem[]>([]);
  const [query, setQuery] = useState("");

  async function load() {
    setErr(null);
    try {
      const res = await fetchStocksOverview(80, 0, "pi");
      setItems(res.items ?? []);
    } catch (e: any) {
      setErr(friendlyMarketError(e, "Unable to load Pi stock market right now."));
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => {
      const text = `${item.token_name} ${item.token_symbol} ${item.business_name || ""} ${item.market_username || ""}`.toLowerCase();
      return text.includes(q);
    });
  }, [items, query]);

  return (
    <LinearGradient colors={[BG_TOP, BG_BOTTOM]} style={{ flex: 1, paddingHorizontal: 16, paddingTop: 14 }}>
      <AppHeader title="Pi Stock Market" subtitle="Pi-native stock identities. Pi buy, Pi sell, Pi creation." />
      <ScrollView
        contentContainerStyle={{ paddingBottom: 28 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      >
        <View style={{ marginTop: 8, flexDirection: "row", gap: 10 }}>
          <Pressable
            onPress={() => router.push("/pi/stock/market/create" as any)}
            style={{
              flex: 1,
              borderRadius: 14,
              paddingVertical: 12,
              alignItems: "center",
              backgroundColor: "rgba(245,158,11,0.14)",
              borderWidth: 1,
              borderColor: "rgba(245,158,11,0.35)",
            }}
          >
            <Text style={{ color: "#FFFBEB", fontWeight: "900" }}>Create Pi Stock</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push("/market/stock" as any)}
            style={{
              flex: 1,
              borderRadius: 14,
              paddingVertical: 12,
              alignItems: "center",
              backgroundColor: "rgba(56,189,248,0.14)",
              borderWidth: 1,
              borderColor: "rgba(56,189,248,0.35)",
            }}
          >
            <Text style={{ color: "#E0F2FE", fontWeight: "900" }}>Open EVM Market</Text>
          </Pressable>
        </View>

        <View
          style={{
            marginTop: 12,
            flexDirection: "row",
            gap: 8,
            alignItems: "center",
            borderRadius: 14,
            paddingHorizontal: 12,
            paddingVertical: 10,
            backgroundColor: CARD,
            borderWidth: 1,
            borderColor: BORDER,
          }}
        >
          <Ionicons name="search-outline" size={18} color="rgba(255,255,255,0.75)" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search Pi stock"
            placeholderTextColor="rgba(255,255,255,0.46)"
            style={{ flex: 1, color: "#fff", fontWeight: "700" }}
          />
        </View>

        <View style={{ marginTop: 12, borderRadius: 14, padding: 12, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
          <Text style={{ color: "#fff", fontWeight: "900" }}>Market Rules</Text>
          <Text style={{ marginTop: 6, color: MUTED, fontSize: 12 }}>
            Pi-native stock is separate from the EVM stock market. Existing EVM stock identities cannot be bought or sold with Pi.
          </Text>
        </View>

        {loading ? (
          <View style={{ marginTop: 26, alignItems: "center" }}>
            <ActivityIndicator />
            <Text style={{ marginTop: 10, color: MUTED }}>Loading Pi stock market...</Text>
          </View>
        ) : null}

        {!!err ? (
          <View style={{ marginTop: 12, borderRadius: 14, padding: 12, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
            <Text style={{ color: "#FCA5A5", fontWeight: "800" }}>{err}</Text>
          </View>
        ) : null}

        {!loading && filtered.length === 0 ? (
          <View style={{ marginTop: 14, borderRadius: 14, padding: 12, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
            <Text style={{ color: "#fff", fontWeight: "900" }}>No Pi stock identities yet</Text>
            <Text style={{ marginTop: 6, color: MUTED }}>Verified stores can create one and trade it fully on the Pi rail.</Text>
          </View>
        ) : null}

        <View style={{ marginTop: 10, gap: 10 }}>
          {filtered.map((item) => (
            <Pressable
              key={item.identity_id}
              onPress={() => router.push(`/pi/stock/market/${item.slug}` as any)}
              style={{
                borderRadius: 16,
                padding: 12,
                backgroundColor: CARD,
                borderWidth: 1,
                borderColor: BORDER,
              }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: "#fff", fontWeight: "900", fontSize: 16 }}>
                    {item.token_name} <Text style={{ color: "#FCD34D" }}>({item.token_symbol})</Text>
                  </Text>
                  <Text style={{ marginTop: 4, color: MUTED, fontSize: 12 }} numberOfLines={1}>
                    @{item.market_username || "store"} - {item.business_name || "Store"}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={{ color: "#fff", fontWeight: "900" }}>${Number(item.price || 0).toFixed(6)}</Text>
                  <Text style={{ marginTop: 4, color: Number(item.change_24h_pct || 0) >= 0 ? SKY : GOLD, fontSize: 11, fontWeight: "800" }}>
                    {Number(item.change_24h_pct || 0) >= 0 ? "+" : ""}
                    {Number(item.change_24h_pct || 0).toFixed(2)}%
                  </Text>
                </View>
              </View>

              <View style={{ marginTop: 10, flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ color: MUTED, fontSize: 11 }}>24h Vol ${Number(item.volume_24h_quote || 0).toFixed(2)}</Text>
                <Text style={{ color: MUTED, fontSize: 11 }}>{Number(item.trades_24h || 0)} trades</Text>
              </View>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </LinearGradient>
  );
}
