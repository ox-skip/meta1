import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import Svg, { Path } from "react-native-svg";

import AppHeader from "@/components/common/AppHeader";
import {
  STOCK,
  StockActionTile,
  StockAlert,
  StockEmptyState,
  StockLoadingState,
  StockMetric,
  StockPanel,
  StockPill,
  StockScreen,
  StockSearchField,
  StockSegment,
  formatStockMoney,
  formatStockPct,
  formatStockPrice,
  stockChainLabel,
} from "@/components/market/stock/StockUi";
import { InAppTutorial } from "@/components/onboarding/InAppTutorial";
import { fetchStocksOverview, type StockOverviewItem } from "@/services/market/stocks";
import { tutorialFlows } from "@/services/onboarding/definitions";
import { supabase } from "@/services/supabase";
import { friendlyMarketError } from "@/utils/marketUx";

type SortMode = "trending" | "most_traded" | "largest_cap" | "new";

function sellerLogoUrl(path?: string | null) {
  if (!path) return null;
  const { data } = supabase.storage.from("market-sellers").getPublicUrl(path);
  return data?.publicUrl ?? null;
}

function MiniSparkline({ values, positive }: { values: number[]; positive: boolean }) {
  const width = 108;
  const height = 36;
  const safe = (values ?? []).filter((v) => Number.isFinite(v));
  if (safe.length < 2) {
    return <View style={{ width, height, borderRadius: 12, backgroundColor: STOCK.panelSoft }} />;
  }

  const min = Math.min(...safe);
  const max = Math.max(...safe);
  const range = Math.max(0.0000001, max - min);
  const step = width / Math.max(1, safe.length - 1);
  const points = safe.map((value, index) => {
    const x = index * step;
    const y = height - ((value - min) / range) * height;
    return `${x},${y}`;
  });
  const linePath = `M ${points.join(" L ")}`;
  const areaPath = `${linePath} L ${width},${height} L 0,${height} Z`;
  const stroke = positive ? STOCK.mint : STOCK.red;

  return (
    <View style={{ width, height }}>
      <Svg width={width} height={height}>
        <Path d={areaPath} fill={positive ? "rgba(52,211,153,0.12)" : "rgba(251,113,133,0.11)"} />
        <Path d={linePath} stroke={stroke} strokeWidth={2.3} strokeLinecap="round" fill="none" />
      </Svg>
    </View>
  );
}
function scoreTrending(item: StockOverviewItem) {
  const vol = Number(item.volume_24h_quote || 0);
  const trades = Number(item.trades_24h || 0);
  const change = Math.abs(Number(item.change_24h_pct || 0));
  const last = item.last_trade_at ? new Date(item.last_trade_at).getTime() : 0;
  const recentBoost = last > 0 ? Math.max(0, 1 - (Date.now() - last) / (1000 * 60 * 60 * 6)) : 0;
  return vol * 0.55 + trades * 40 + change * 12 + recentBoost * 900;
}

export default function StockHomeScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [items, setItems] = useState<StockOverviewItem[]>([]);
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("trending");

  async function load() {
    setErr(null);
    try {
      const res = await fetchStocksOverview(80, 0, "all");
      setItems(res.items ?? []);
    } catch (e: any) {
      setErr(friendlyMarketError(e, "Unable to load digital stock market right now."));
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const ranked = useMemo(() => {
    const rows = [...items];
    if (sortMode === "most_traded") {
      rows.sort((a, b) => {
        if ((b.trades_24h || 0) !== (a.trades_24h || 0)) return (b.trades_24h || 0) - (a.trades_24h || 0);
        return (b.volume_24h_quote || 0) - (a.volume_24h_quote || 0);
      });
      return rows;
    }
    if (sortMode === "largest_cap") {
      rows.sort((a, b) => (b.market_cap || 0) - (a.market_cap || 0));
      return rows;
    }
    if (sortMode === "new") {
      rows.sort((a, b) => {
        const at = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bt = b.created_at ? new Date(b.created_at).getTime() : 0;
        return bt - at;
      });
      return rows;
    }
    rows.sort((a, b) => scoreTrending(b) - scoreTrending(a));
    return rows;
  }, [items, sortMode]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ranked;
    return ranked.filter((item) => {
      const text = `${item.token_name} ${item.token_symbol} ${item.business_name || ""} ${item.market_username || ""}`.toLowerCase();
      return text.includes(q);
    });
  }, [ranked, query]);

  const summary = useMemo(() => {
    const marketCap = items.reduce((sum, item) => sum + Number(item.market_cap || 0), 0);
    const volume = items.reduce((sum, item) => sum + Number(item.volume_24h_quote || 0), 0);
    const active = items.filter((item) => String(item.status || "").toUpperCase() === "ACTIVE").length;
    const pi = items.filter((item) => String(item.chain || "").toLowerCase() === "pi_testnet").length;
    return { marketCap, volume, active, pi };
  }, [items]);

  return (
    <StockScreen>
      <InAppTutorial enabled={!loading} flow={tutorialFlows.stockHome} />
      <AppHeader title="Digital Stock" subtitle="Store-backed equities with live pricing and on-chain execution." />
      <ScrollView
        contentContainerStyle={{ paddingBottom: 28 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      >
        <StockPanel style={{ marginTop: 10, overflow: "hidden" }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <StockPill label="Live Market" tone="mint" icon="pulse-outline" compact />
              <Text style={{ marginTop: 12, color: STOCK.ink, fontSize: 31, fontWeight: "900" }}>
                {formatStockMoney(summary.marketCap)}
              </Text>
              <Text style={{ marginTop: 4, color: STOCK.muted, fontWeight: "800" }}>Combined market value</Text>
            </View>
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: 22,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "rgba(34,211,238,0.12)",
                borderWidth: 1,
                borderColor: "rgba(34,211,238,0.32)",
              }}
            >
              <Ionicons name="stats-chart" size={25} color={STOCK.cyan} />
            </View>
          </View>

          <View style={{ marginTop: 16, flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
            <StockMetric label="24h Volume" value={formatStockMoney(summary.volume)} tone="cyan" />
            <StockMetric label="Listed" value={String(items.length)} caption={`${summary.active} active`} />
            <StockMetric label="Pi Rails" value={String(summary.pi)} tone="amber" />
          </View>
        </StockPanel>

        <View style={{ marginTop: 12, flexDirection: "row", gap: 10 }}>
          <StockActionTile
            icon="add-circle-outline"
            label="Create EVM"
            caption="Verified stores"
            tone="mint"
            onPress={() => router.push("/market/stock/create" as any)}
          />
          <StockActionTile
            icon="wallet-outline"
            label="Portfolio"
            caption="Positions"
            tone="cyan"
            onPress={() => router.push("/market/stock/portfolio" as any)}
          />
          <StockActionTile
            icon="planet-outline"
            label="Create Pi"
            caption="Pi native"
            tone="amber"
            onPress={() => router.push("/pi/stock/market/create" as any)}
          />
        </View>

        <View style={{ marginTop: 12 }}>
          <StockSearchField
            value={query}
            onChangeText={setQuery}
            placeholder="Search ticker, store, or name"
          />
        </View>

        <View style={{ marginTop: 12 }}>
          <StockSegment
            value={sortMode}
            onChange={setSortMode}
            options={[
              { key: "trending", label: "Trending", tone: "mint" },
              { key: "most_traded", label: "Most Traded", tone: "cyan" },
              { key: "largest_cap", label: "Largest Cap", tone: "amber" },
              { key: "new", label: "New", tone: "plain" },
            ]}
          />
        </View>

        {loading ? <StockLoadingState label="Loading market" /> : null}

        {!!err ? <StockAlert>{err}</StockAlert> : null}

        {!loading && filtered.length === 0 ? (
          <View style={{ marginTop: 14 }}>
            <StockEmptyState
              icon="storefront-outline"
              title="No stock identities"
              message="Verified stores can publish a tradable stock identity from their seller account."
              actionLabel="Create Stock"
              onAction={() => router.push("/market/stock/create" as any)}
            />
          </View>
        ) : null}

        <View style={{ marginTop: 12, gap: 11 }}>
          {filtered.map((item) => {
            const logo = sellerLogoUrl(item.logo_path);
            const change = Number(item.change_24h_pct || 0);
            const positive = change >= 0;
            return (
              <StockPanel key={item.identity_id} style={{ padding: 12 }}>
                <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
                  <Pressable
                    disabled={!item.market_username}
                    onPress={() =>
                      item.market_username
                        ? router.push(`/market/profile/${item.market_username}` as any)
                        : undefined
                    }
                    style={{
                      width: 58,
                      height: 58,
                      borderRadius: 21,
                      overflow: "hidden",
                      borderWidth: 1,
                      borderColor: STOCK.borderStrong,
                      backgroundColor: STOCK.panelSoft,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {logo ? (
                      <Image source={{ uri: logo }} style={{ width: 58, height: 58 }} />
                    ) : (
                      <Ionicons name="storefront-outline" size={23} color={STOCK.muted} />
                    )}
                  </Pressable>

                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ color: STOCK.ink, fontWeight: "900", fontSize: 16 }} numberOfLines={1}>
                      {item.token_name}
                    </Text>
                    <View style={{ marginTop: 4, flexDirection: "row", alignItems: "center", gap: 5 }}>
                      <Text style={{ color: STOCK.muted, fontSize: 12, fontWeight: "700", flexShrink: 1 }} numberOfLines={1}>
                        {item.token_symbol} - @{item.market_username || "store"}
                      </Text>
                      {item.is_verified ? <Ionicons name="checkmark-circle" size={13} color={STOCK.cyan} /> : null}
                    </View>
                    <View style={{ marginTop: 8, flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                      <StockPill label={stockChainLabel(item.chain)} compact />
                      <StockPill
                        label={String(item.status || "ACTIVE").toUpperCase()}
                        tone={String(item.status || "").toUpperCase() === "ACTIVE" ? "mint" : "amber"}
                        compact
                      />
                    </View>
                  </View>

                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={{ color: STOCK.ink, fontWeight: "900", fontSize: 16 }}>
                      {formatStockPrice(item.price, 4)}
                    </Text>
                    <StockPill label={formatStockPct(change)} tone={positive ? "mint" : "red"} compact />
                  </View>
                </View>

                <View style={{ marginTop: 12, flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                      <StockMetric label="Volume" value={formatStockMoney(item.volume_24h_quote)} style={{ minWidth: 88, padding: 10 }} />
                      <StockMetric label="MCap" value={formatStockMoney(item.market_cap)} style={{ minWidth: 88, padding: 10 }} />
                      <StockMetric label="Trades" value={String(Number(item.trades_24h || 0))} style={{ minWidth: 76, padding: 10 }} />
                    </View>
                  </View>
                  <MiniSparkline values={item.sparkline_prices ?? [Number(item.price || 0)]} positive={positive} />
                </View>

                <View style={{ marginTop: 12, flexDirection: "row", gap: 9 }}>
                  <Pressable
                    onPress={() => router.push(`/market/stock/${item.slug}` as any)}
                    style={{
                      flex: 1,
                      minHeight: 43,
                      borderRadius: 14,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: "rgba(52,211,153,0.18)",
                      borderWidth: 1,
                      borderColor: "rgba(52,211,153,0.46)",
                    }}
                  >
                    <Text style={{ color: "#D1FAE5", fontWeight: "900" }}>Open Market</Text>
                  </Pressable>
                  <Pressable
                    disabled={!item.market_username}
                    onPress={() =>
                      item.market_username
                        ? router.push(`/market/profile/${item.market_username}` as any)
                        : undefined
                    }
                    style={{
                      width: 46,
                      minHeight: 43,
                      borderRadius: 14,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: STOCK.panelSoft,
                      borderWidth: 1,
                      borderColor: STOCK.border,
                      opacity: item.market_username ? 1 : 0.55,
                    }}
                  >
                    <Ionicons name="storefront-outline" size={18} color={STOCK.ink} />
                  </Pressable>
                </View>
              </StockPanel>
            );
          })}
        </View>
      </ScrollView>
    </StockScreen>
  );
}
