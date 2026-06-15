import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import Svg, { Path } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";

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
import { InAppTutorial, TutorialTarget } from "@/components/onboarding/InAppTutorial";
import { tutorialFlows } from "@/services/onboarding/definitions";
import { fetchStocksOverview, type StockOverviewItem } from "@/services/market/stocks";
import { supabase } from "@/services/supabase";
import { friendlyMarketError } from "@/utils/marketUx";

type SortMode = "trending" | "most_traded" | "largest_cap" | "new";
type TradeSide = "buy" | "sell";
type ChainRow = {
  chain?: string | null;
  chain_id?: number | string | null;
  active?: boolean | null;
};

function sellerLogoUrl(path?: string | null) {
  if (!path) return null;
  const { data } = supabase.storage.from("market-sellers").getPublicUrl(path);
  return data?.publicUrl ?? null;
}

function finiteNumber(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function MiniSparkline({ values, positive, width = 122, height = 40 }: { values: number[]; positive: boolean; width?: number; height?: number }) {
  const safe = (values ?? []).map(Number).filter((v) => Number.isFinite(v));
  if (safe.length < 2) {
    return <View style={{ width, height, borderRadius: 8, backgroundColor: STOCK.panelSoft }} />;
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
        <Path d={areaPath} fill={positive ? "rgba(47,214,163,0.14)" : "rgba(255,92,122,0.12)"} />
        <Path d={linePath} stroke={stroke} strokeWidth={2.4} strokeLinecap="round" fill="none" />
      </Svg>
    </View>
  );
}

function scoreTrending(item: StockOverviewItem) {
  const vol = finiteNumber(item.volume_24h_quote);
  const trades = finiteNumber(item.trades_24h);
  const change = Math.abs(finiteNumber(item.change_24h_pct));
  const last = item.last_trade_at ? new Date(item.last_trade_at).getTime() : 0;
  const recentBoost = last > 0 ? Math.max(0, 1 - (Date.now() - last) / (1000 * 60 * 60 * 6)) : 0;
  return vol * 0.55 + trades * 40 + change * 12 + recentBoost * 900;
}

function stockStatusTone(status?: string | null): "mint" | "amber" | "red" {
  const raw = String(status || "ACTIVE").toUpperCase();
  if (raw === "PAUSED") return "red";
  if (raw === "BOOTSTRAP" || raw === "GUARDED") return "amber";
  return "mint";
}

function stockStatusLabel(status?: string | null) {
  const raw = String(status || "ACTIVE").toUpperCase();
  if (raw === "BOOTSTRAP") return "LAUNCH GUARD";
  return raw;
}

function formatLastTrade(value?: string | null) {
  if (!value) return "No trades yet";
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms)) return "No trades yet";
  const minutes = Math.max(1, Math.round((Date.now() - ms) / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function uniqueChainRows(items: StockOverviewItem[], rows: ChainRow[]) {
  const fromConfig = rows
    .filter((row) => row?.active !== false && String(row?.chain || "").trim())
    .map((row) => ({ chain: String(row.chain), chain_id: row.chain_id }));
  const seen = new Set(fromConfig.map((row) => row.chain.toLowerCase()));

  items.forEach((item) => {
    const chain = String(item.chain || "").trim();
    if (!chain || seen.has(chain.toLowerCase())) return;
    seen.add(chain.toLowerCase());
    fromConfig.push({ chain, chain_id: null });
  });

  return fromConfig;
}

export default function StockHomeScreen() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isWide = width >= 920;
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [items, setItems] = useState<StockOverviewItem[]>([]);
  const [chainRows, setChainRows] = useState<ChainRow[]>([]);
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("trending");
  const [watchIds, setWatchIds] = useState<string[]>([]);
  const [toolsVisible, setToolsVisible] = useState(false);

  async function load() {
    setErr(null);
    try {
      const res = await fetchStocksOverview(100, 0, "evm");
      setItems(res.items ?? []);
      setChainRows((res.chains ?? []) as ChainRow[]);
    } catch (e: any) {
      setErr(friendlyMarketError(e, "Unable to load digital stock market right now."));
      setItems([]);
      setChainRows([]);
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
        if (finiteNumber(b.trades_24h) !== finiteNumber(a.trades_24h)) return finiteNumber(b.trades_24h) - finiteNumber(a.trades_24h);
        return finiteNumber(b.volume_24h_quote) - finiteNumber(a.volume_24h_quote);
      });
      return rows;
    }
    if (sortMode === "largest_cap") {
      rows.sort((a, b) => finiteNumber(b.market_cap) - finiteNumber(a.market_cap));
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
      const text = `${item.token_name} ${item.token_symbol} ${item.business_name || ""} ${item.market_username || ""} ${item.chain || ""}`.toLowerCase();
      return text.includes(q);
    });
  }, [ranked, query]);

  const summary = useMemo(() => {
    const marketCap = items.reduce((sum, item) => sum + finiteNumber(item.market_cap), 0);
    const volume = items.reduce((sum, item) => sum + finiteNumber(item.volume_24h_quote), 0);
    const active = items.filter((item) => String(item.status || "").toUpperCase() === "ACTIVE").length;
    const guarded = items.filter((item) => String(item.status || "").toUpperCase() === "BOOTSTRAP").length;
    const trades = items.reduce((sum, item) => sum + finiteNumber(item.trades_24h), 0);
    const chains = uniqueChainRows(items, chainRows);
    const topMover = [...items].sort((a, b) => Math.abs(finiteNumber(b.change_24h_pct)) - Math.abs(finiteNumber(a.change_24h_pct)))[0] ?? null;
    const leader = ranked[0] ?? null;
    return { marketCap, volume, active, guarded, trades, chains, topMover, leader };
  }, [chainRows, items, ranked]);

  const watchItems = useMemo(
    () => items.filter((item) => watchIds.includes(item.identity_id)).slice(0, 4),
    [items, watchIds],
  );

  function toggleWatch(id: string) {
    setWatchIds((current) => (current.includes(id) ? current.filter((next) => next !== id) : [...current, id]));
  }

  function openStock(item: StockOverviewItem, side?: TradeSide) {
    router.push({
      pathname: "/market/stock/[slug]" as any,
      params: side ? { slug: item.slug, side } : { slug: item.slug },
    });
  }

  function renderAssistant() {
    const topMover = summary.topMover;
    const moverChange = topMover ? finiteNumber(topMover.change_24h_pct) : 0;
    const networkLabel = summary.chains.length
      ? summary.chains.slice(0, 3).map((row) => stockChainLabel(row.chain)).join(" / ")
      : "No active network";

    const tiles = [
      {
        label: "Explain launch",
        value: summary.guarded ? `${summary.guarded} guarded` : "Open trading",
        icon: "rocket-outline" as const,
        tone: summary.guarded ? STOCK.amber : STOCK.mint,
      },
      {
        label: "Network",
        value: networkLabel,
        icon: "git-network-outline" as const,
        tone: STOCK.cyan,
      },
      {
        label: "Movement",
        value: topMover ? `${topMover.token_symbol} ${formatStockPct(moverChange)}` : "Waiting",
        icon: moverChange >= 0 ? "trending-up-outline" as const : "trending-down-outline" as const,
        tone: moverChange >= 0 ? STOCK.mint : STOCK.red,
      },
      {
        label: "Risk",
        value: summary.volume > 0 ? "Check volume" : "Thin market",
        icon: "warning-outline" as const,
        tone: STOCK.amber,
      },
    ];

    return (
      <StockPanel style={{ marginTop: 12, backgroundColor: "rgba(98,168,255,0.08)", borderColor: "rgba(98,168,255,0.24)" }}>
        <View style={{ flexDirection: "row", gap: 11, alignItems: "flex-start" }}>
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 8,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(98,168,255,0.16)",
              borderWidth: 1,
              borderColor: "rgba(98,168,255,0.34)",
            }}
          >
            <Ionicons name="sparkles-outline" size={19} color={STOCK.cyan} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: STOCK.cyan, fontWeight: "900", fontSize: 11 }}>BESTCITY AI STOCK ASSISTANT</Text>
            <Text style={{ marginTop: 4, color: STOCK.ink, fontWeight: "900", fontSize: 16 }}>
              Read launch status, network, movement, and risk before trading.
            </Text>
            <Text style={{ marginTop: 5, color: STOCK.muted, fontSize: 12, lineHeight: 18 }}>
              Assistant surfaces summarize what to inspect. Quotes and orders still run inside the stock detail screen.
            </Text>
          </View>
        </View>

        <View style={{ marginTop: 12, flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {tiles.map((tile) => (
            <View
              key={tile.label}
              style={{
                flexGrow: 1,
                flexBasis: isWide ? 136 : 142,
                borderRadius: 8,
                padding: 11,
                backgroundColor: `${tile.tone}12`,
                borderWidth: 1,
                borderColor: `${tile.tone}35`,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
                <Ionicons name={tile.icon} size={15} color={tile.tone} />
                <Text style={{ color: STOCK.muted, fontSize: 10, fontWeight: "900" }}>{tile.label}</Text>
              </View>
              <Text numberOfLines={1} style={{ marginTop: 8, color: STOCK.ink, fontSize: 13, fontWeight: "900" }}>
                {tile.value}
              </Text>
            </View>
          ))}
        </View>

        <View style={{ marginTop: 12, flexDirection: "row", gap: 9, flexWrap: "wrap" }}>
          <Pressable
            disabled={!summary.leader}
            onPress={() => summary.leader ? openStock(summary.leader) : undefined}
            style={{
              flex: 1,
              minWidth: 148,
              minHeight: 42,
              borderRadius: 8,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(47,214,163,0.16)",
              borderWidth: 1,
              borderColor: "rgba(47,214,163,0.42)",
              opacity: summary.leader ? 1 : 0.55,
            }}
          >
            <Text style={{ color: "#D7FFF3", fontWeight: "900" }}>Open active stock</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push("/market/stock/portfolio" as any)}
            style={{
              flex: 1,
              minWidth: 148,
              minHeight: 42,
              borderRadius: 8,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: STOCK.panelSoft,
              borderWidth: 1,
              borderColor: STOCK.border,
            }}
          >
            <Text style={{ color: STOCK.ink, fontWeight: "900" }}>Review portfolio</Text>
          </Pressable>
        </View>
      </StockPanel>
    );
  }

  function renderWatchlist() {
    if (!watchItems.length) {
      return (
        <StockPanel style={{ marginTop: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Ionicons name="star-outline" size={18} color={STOCK.amber} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: STOCK.ink, fontWeight: "900" }}>Watchlist</Text>
              <Text style={{ marginTop: 3, color: STOCK.muted, fontSize: 12 }}>
                Tap Watch on any active stock to pin it here for this session.
              </Text>
            </View>
          </View>
        </StockPanel>
      );
    }

    return (
      <StockPanel style={{ marginTop: 12 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <Text style={{ color: STOCK.ink, fontWeight: "900", fontSize: 15 }}>Watchlist</Text>
          <StockPill label={`${watchItems.length} pinned`} tone="amber" compact />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12, marginHorizontal: -4 }} contentContainerStyle={{ paddingHorizontal: 4, gap: 9 }}>
          {watchItems.map((item) => {
            const change = finiteNumber(item.change_24h_pct);
            return (
              <Pressable
                key={item.identity_id}
                onPress={() => openStock(item)}
                style={{
                  width: 160,
                  borderRadius: 8,
                  padding: 11,
                  backgroundColor: STOCK.panelSoft,
                  borderWidth: 1,
                  borderColor: STOCK.border,
                }}
              >
                <Text numberOfLines={1} style={{ color: STOCK.ink, fontWeight: "900" }}>{item.token_symbol}</Text>
                <Text numberOfLines={1} style={{ marginTop: 3, color: STOCK.muted, fontSize: 11 }}>{item.token_name}</Text>
                <View style={{ marginTop: 10, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <Text style={{ color: STOCK.ink, fontWeight: "900" }}>{formatStockPrice(item.price, 4)}</Text>
                  <StockPill label={formatStockPct(change)} tone={change >= 0 ? "mint" : "red"} compact />
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      </StockPanel>
    );
  }

  function renderStockRow(item: StockOverviewItem, index: number, compact = false) {
    const logo = sellerLogoUrl(item.logo_path);
    const change = finiteNumber(item.change_24h_pct);
    const positive = change >= 0;
    const watched = watchIds.includes(item.identity_id);
    const status = stockStatusLabel(item.status);
    const statusTone = stockStatusTone(item.status);
    const rowWide = isWide && !compact;

    const row = (
      <Pressable
        onPress={() => openStock(item)}
        style={({ pressed }) => ({
          marginTop: compact ? 0 : 10,
          borderRadius: compact ? 0 : 16,
          paddingVertical: compact ? 13 : 14,
          paddingHorizontal: compact ? 4 : 14,
          backgroundColor: compact
            ? "transparent"
            : pressed
            ? "rgba(98,168,255,0.12)"
            : "rgba(247,250,252,0.045)",
          borderBottomWidth: compact ? 1 : 0,
          borderBottomColor: "rgba(247,250,252,0.10)",
          borderWidth: compact ? 0 : 1,
          borderColor: compact ? "transparent" : "rgba(247,250,252,0.13)",
          transform: [{ translateY: pressed && !compact ? 1 : 0 }],
        })}
      >
        <View style={{ flexDirection: rowWide ? "row" : "column", gap: rowWide ? 16 : 12, alignItems: rowWide ? "center" : "stretch" }}>
          <View style={{ flex: 1.2, minWidth: 0 }}>
            <View style={{ flexDirection: "row", gap: 11, alignItems: "center" }}>
              <Pressable
                disabled={!item.market_username}
                onPress={() => item.market_username ? router.push(`/market/profile/${item.market_username}` as any) : undefined}
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 14,
                  overflow: "hidden",
                  borderWidth: 1,
                  borderColor: STOCK.borderStrong,
                  backgroundColor: STOCK.panelSoft,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {logo ? (
                  <Image source={{ uri: logo }} style={{ width: 48, height: 48 }} />
                ) : (
                  <Ionicons name="storefront-outline" size={20} color={STOCK.muted} />
                )}
              </Pressable>

              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
                  <Text numberOfLines={1} style={{ color: STOCK.ink, fontWeight: "900", fontSize: 16, flexShrink: 1 }}>
                    {item.token_symbol}
                  </Text>
                  {item.is_verified ? <Ionicons name="checkmark-circle" size={15} color={STOCK.cyan} /> : null}
                  <StockPill label={status} tone={statusTone} compact />
                </View>
                <Text numberOfLines={1} style={{ marginTop: 4, color: STOCK.ink, fontWeight: "800", fontSize: 12 }}>
                  {item.token_name}
                </Text>
                <Text numberOfLines={1} style={{ marginTop: 4, color: STOCK.faint, fontWeight: "800", fontSize: 10 }}>
                  @{item.market_username || "store"} / {stockChainLabel(item.chain)} / {formatLastTrade(item.last_trade_at)}
                </Text>
              </View>

              <Pressable
                onPress={() => toggleWatch(item.identity_id)}
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 12,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: watched ? "rgba(245,184,75,0.18)" : STOCK.panelSoft,
                  borderWidth: 1,
                  borderColor: watched ? "rgba(245,184,75,0.42)" : STOCK.border,
                }}
              >
                <Ionicons name={watched ? "star" : "star-outline"} size={16} color={watched ? STOCK.amber : STOCK.ink} />
              </Pressable>
            </View>

            <View style={{ marginTop: 12, flexDirection: "row", gap: 14, flexWrap: "wrap" }}>
              {[
                ["Price", formatStockPrice(item.price, 4), STOCK.ink],
                ["Vol", formatStockMoney(item.volume_24h_quote), STOCK.cyan],
                ["Cap", formatStockMoney(item.market_cap), STOCK.muted],
                ["Trades", String(finiteNumber(item.trades_24h)), STOCK.amber],
              ].map(([label, value, tone]) => (
                <View key={label} style={{ minWidth: compact ? 76 : 88 }}>
                  <Text style={{ color: STOCK.faint, fontSize: 9, fontWeight: "900", textTransform: "uppercase" }}>{label}</Text>
                  <Text numberOfLines={1} style={{ marginTop: 3, color: tone, fontSize: label === "Price" ? 16 : 12, fontWeight: "900" }}>
                    {value}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          <View style={{ width: rowWide ? 238 : "100%", gap: 10 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <MiniSparkline values={item.sparkline_prices ?? [finiteNumber(item.price)]} positive={positive} width={compact ? 96 : 118} height={38} />
              <StockPill label={formatStockPct(change)} tone={positive ? "mint" : "red"} icon={positive ? "trending-up-outline" : "trending-down-outline"} compact />
            </View>

            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable
                onPress={() => openStock(item, "buy")}
                style={{
                  flex: 1,
                  minHeight: 38,
                  borderRadius: 10,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "rgba(47,214,163,0.18)",
                  borderWidth: 1,
                  borderColor: "rgba(47,214,163,0.48)",
                  flexDirection: "row",
                  gap: 6,
                }}
              >
                <Ionicons name="add-outline" size={16} color="#D7FFF3" />
                <Text style={{ color: "#D7FFF3", fontWeight: "900" }}>Buy</Text>
              </Pressable>
              <Pressable
                onPress={() => openStock(item, "sell")}
                style={{
                  flex: 1,
                  minHeight: 38,
                  borderRadius: 10,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "rgba(255,92,122,0.15)",
                  borderWidth: 1,
                  borderColor: "rgba(255,92,122,0.42)",
                  flexDirection: "row",
                  gap: 6,
                }}
              >
                <Ionicons name="remove-outline" size={16} color="#FFE3EA" />
                <Text style={{ color: "#FFE3EA", fontWeight: "900" }}>Sell</Text>
              </Pressable>
              <Pressable
                onPress={() => openStock(item)}
                style={{
                  width: 40,
                  minHeight: 38,
                  borderRadius: 10,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: STOCK.panelSoft,
                  borderWidth: 1,
                  borderColor: STOCK.border,
                }}
              >
                <Ionicons name="open-outline" size={16} color={STOCK.ink} />
              </Pressable>
            </View>
          </View>
        </View>
      </Pressable>
    );

    return index === 0 && !compact ? (
      <TutorialTarget key={item.identity_id} id="stock.home.openMarket">
        {row}
      </TutorialTarget>
    ) : (
      <React.Fragment key={`${item.identity_id}-${compact ? "modal" : "main"}`}>{row}</React.Fragment>
    );
  }

  function renderStockHero() {
    const leader = summary.leader;
    const leaderChange = leader ? finiteNumber(leader.change_24h_pct) : 0;
    const leaderPositive = leaderChange >= 0;

    return (
      <LinearGradient
        colors={["rgba(98,168,255,0.18)", "rgba(47,214,163,0.10)", "rgba(247,250,252,0.045)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          marginTop: 10,
          borderRadius: 18,
          borderWidth: 1,
          borderColor: "rgba(247,250,252,0.15)",
          padding: isWide ? 18 : 14,
          overflow: "hidden",
        }}
      >
        <View style={{ flexDirection: isWide ? "row" : "column", gap: isWide ? 18 : 14, alignItems: isWide ? "center" : "stretch" }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 14,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "rgba(47,214,163,0.16)",
                  borderWidth: 1,
                  borderColor: "rgba(47,214,163,0.36)",
                }}
              >
                <Ionicons name="pulse-outline" size={20} color={STOCK.mint} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: STOCK.ink, fontWeight: "900", fontSize: isWide ? 25 : 20 }} numberOfLines={1}>
                  Digital stock board
                </Text>
                <Text style={{ marginTop: 3, color: STOCK.muted, fontWeight: "800", fontSize: 12 }} numberOfLines={1}>
                  {filtered.length} in view / {summary.active} active / {summary.chains.length} networks
                </Text>
              </View>
            </View>

            <TutorialTarget id="stock.home.search">
              <View style={{ marginTop: 14 }}>
                <StockSearchField
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search ticker, store, network, or slug"
                />
              </View>
            </TutorialTarget>

            <View style={{ marginTop: 12, flexDirection: "row", flexWrap: "wrap", gap: 9 }}>
              <TutorialTarget id="stock.home.shortcuts">
                <Pressable
                  onPress={() => setToolsVisible(true)}
                  style={({ pressed }) => ({
                    minHeight: 42,
                    borderRadius: 12,
                    paddingHorizontal: 13,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    backgroundColor: pressed ? "rgba(98,168,255,0.22)" : "rgba(98,168,255,0.16)",
                    borderWidth: 1,
                    borderColor: "rgba(98,168,255,0.38)",
                  })}
                >
                  <Ionicons name="options-outline" size={17} color={STOCK.cyan} />
                  <Text style={{ color: STOCK.ink, fontWeight: "900", fontSize: 12 }}>Market tools</Text>
                </Pressable>
              </TutorialTarget>
              <Pressable
                onPress={() => router.push("/market/stock/create" as any)}
                style={{
                  minHeight: 42,
                  borderRadius: 12,
                  paddingHorizontal: 13,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  backgroundColor: "rgba(47,214,163,0.16)",
                  borderWidth: 1,
                  borderColor: "rgba(47,214,163,0.38)",
                }}
              >
                <Ionicons name="add-circle-outline" size={17} color={STOCK.mint} />
                <Text style={{ color: STOCK.ink, fontWeight: "900", fontSize: 12 }}>Launch</Text>
              </Pressable>
              <Pressable
                onPress={() => router.push("/market/stock/portfolio" as any)}
                style={{
                  minHeight: 42,
                  borderRadius: 12,
                  paddingHorizontal: 13,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  backgroundColor: "rgba(245,184,75,0.14)",
                  borderWidth: 1,
                  borderColor: "rgba(245,184,75,0.36)",
                }}
              >
                <Ionicons name="wallet-outline" size={17} color={STOCK.amber} />
                <Text style={{ color: STOCK.ink, fontWeight: "900", fontSize: 12 }}>Portfolio</Text>
              </Pressable>
            </View>
          </View>

          <View
            style={{
              width: isWide ? 360 : "100%",
              borderRadius: 16,
              padding: 14,
              backgroundColor: "rgba(5,7,6,0.38)",
              borderWidth: 1,
              borderColor: "rgba(247,250,252,0.12)",
            }}
          >
            <Text style={{ color: STOCK.faint, fontSize: 10, fontWeight: "900", textTransform: "uppercase" }}>Most active now</Text>
            {leader ? (
              <>
                <View style={{ marginTop: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ color: STOCK.ink, fontWeight: "900", fontSize: 19 }}>
                      {leader.token_symbol} / {formatStockPrice(leader.price, 4)}
                    </Text>
                    <Text numberOfLines={1} style={{ marginTop: 4, color: STOCK.muted, fontWeight: "800", fontSize: 12 }}>
                      {leader.token_name}
                    </Text>
                  </View>
                  <StockPill label={formatStockPct(leaderChange)} tone={leaderPositive ? "mint" : "red"} icon={leaderPositive ? "trending-up-outline" : "trending-down-outline"} compact />
                </View>
                <View style={{ marginTop: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                  <MiniSparkline values={leader.sparkline_prices ?? [finiteNumber(leader.price)]} positive={leaderPositive} width={132} height={42} />
                  <Pressable
                    onPress={() => openStock(leader)}
                    style={{
                      minHeight: 40,
                      borderRadius: 12,
                      paddingHorizontal: 14,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: "rgba(47,214,163,0.18)",
                      borderWidth: 1,
                      borderColor: "rgba(47,214,163,0.42)",
                    }}
                  >
                    <Text style={{ color: "#D7FFF3", fontWeight: "900", fontSize: 12 }}>Open</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <Text style={{ marginTop: 10, color: STOCK.muted, lineHeight: 18 }}>Stocks will appear here after the market feed loads.</Text>
            )}
          </View>
        </View>
      </LinearGradient>
    );
  }

  function StockToolsModal() {
    const panelWidth = isWide ? Math.min(720, width - 48) : undefined;

    return (
      <Modal visible={toolsVisible} animationType="slide" transparent onRequestClose={() => setToolsVisible(false)}>
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.72)",
            justifyContent: isWide ? "center" : "flex-end",
            alignItems: isWide ? "flex-end" : "stretch",
            padding: isWide ? 22 : 0,
          }}
        >
          <Pressable
            style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
            onPress={() => setToolsVisible(false)}
          />
          <View
            style={{
              width: panelWidth as any,
              height: isWide ? "90%" : "88%",
              maxHeight: isWide ? 780 : undefined,
              borderTopLeftRadius: isWide ? 24 : 28,
              borderTopRightRadius: 28,
              borderBottomLeftRadius: isWide ? 24 : 0,
              borderBottomRightRadius: isWide ? 24 : 0,
              backgroundColor: "rgba(5,7,6,0.98)",
              borderWidth: 1,
              borderColor: "rgba(247,250,252,0.12)",
              overflow: "hidden",
              shadowColor: "#000",
              shadowOpacity: 0.34,
              shadowRadius: 30,
              shadowOffset: { width: 0, height: 18 },
              elevation: 12,
            }}
          >
            <View style={{ alignItems: "center", paddingTop: isWide ? 8 : 10, paddingBottom: 8 }}>
              <View style={{ width: 56, height: 5, borderRadius: 999, backgroundColor: "rgba(247,250,252,0.14)" }} />
            </View>

            <LinearGradient
              colors={["rgba(47,214,163,0.18)", "rgba(98,168,255,0.13)", "rgba(5,7,6,0.96)"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ paddingHorizontal: isWide ? 18 : 20, paddingTop: isWide ? 16 : 18, paddingBottom: 16, gap: 13 }}
            >
              <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: STOCK.ink, fontWeight: "900", fontSize: isWide ? 20 : 22 }}>Stock controls</Text>
                  <Text style={{ marginTop: 5, color: STOCK.muted, fontSize: 13, lineHeight: 19 }}>
                    Search, sorting, watchlist, analytics, and the complete stock board live here.
                  </Text>
                </View>
                <Pressable
                  onPress={() => setToolsVisible(false)}
                  style={({ pressed }) => ({
                    width: 40,
                    height: 40,
                    borderRadius: 14,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: pressed ? "rgba(247,250,252,0.13)" : "rgba(247,250,252,0.08)",
                  })}
                >
                  <Ionicons name="close" size={20} color={STOCK.ink} />
                </Pressable>
              </View>

              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                <StockPill label={`${filtered.length} in view`} tone="cyan" icon="analytics-outline" compact />
                <StockPill label={`${summary.active} active`} tone="mint" icon="pulse-outline" compact />
                <StockPill label={`${summary.guarded} guarded`} tone={summary.guarded ? "amber" : "plain"} icon="rocket-outline" compact />
                <StockPill label={`${summary.chains.length} networks`} tone="cyan" icon="git-network-outline" compact />
              </View>
            </LinearGradient>

            <ScrollView
              style={{ flex: 1 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
              contentContainerStyle={{ paddingHorizontal: isWide ? 18 : 20, paddingTop: 14, paddingBottom: Math.max(22, insets.bottom + 22), gap: 14 }}
            >
              <StockPanel style={{ padding: isWide ? 14 : 12, backgroundColor: "rgba(247,250,252,0.055)" }}>
                <Text style={{ color: STOCK.ink, fontWeight: "900", fontSize: 13 }}>Filter board</Text>
                <View style={{ marginTop: 12 }}>
                  <StockSearchField
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Search ticker, store, network, or slug"
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
                      { key: "new", label: "New Launches", tone: "plain" },
                    ]}
                  />
                </View>
              </StockPanel>

              <View style={{ flexDirection: isWide ? "row" : "column", gap: 10 }}>
                <StockActionTile
                  icon="add-circle-outline"
                  label="Launch Stock"
                  caption="Create a store market"
                  tone="mint"
                  onPress={() => {
                    setToolsVisible(false);
                    router.push("/market/stock/create" as any);
                  }}
                />
                <StockActionTile
                  icon="wallet-outline"
                  label="Portfolio"
                  caption="Positions and PnL"
                  tone="cyan"
                  onPress={() => {
                    setToolsVisible(false);
                    router.push("/market/stock/portfolio" as any);
                  }}
                />
                <StockActionTile
                  icon="storefront-outline"
                  label="Marketplace"
                  caption="Back to listings"
                  tone="amber"
                  onPress={() => {
                    setToolsVisible(false);
                    router.push("/market" as any);
                  }}
                />
              </View>

              {renderWatchlist()}

              <StockPanel style={{ backgroundColor: "rgba(47,214,163,0.07)", borderColor: "rgba(47,214,163,0.22)" }}>
                <Text style={{ color: STOCK.ink, fontWeight: "900", fontSize: 13 }}>Market pulse</Text>
                <View style={{ marginTop: 12, flexDirection: isWide ? "row" : "column", gap: 10 }}>
                  <StockMetric label="Market Value" value={formatStockMoney(summary.marketCap)} tone="mint" />
                  <StockMetric label="24h Volume" value={formatStockMoney(summary.volume)} tone="cyan" />
                  <StockMetric label="Trades" value={String(summary.trades)} tone="amber" />
                  <StockMetric label="Networks" value={String(summary.chains.length)} />
                </View>
                {summary.leader ? (
                  <Pressable onPress={() => openStock(summary.leader!)} style={{ marginTop: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ color: STOCK.muted, fontSize: 10, fontWeight: "900" }}>MOST ACTIVE</Text>
                      <Text numberOfLines={1} style={{ marginTop: 3, color: STOCK.ink, fontWeight: "900" }}>
                        {summary.leader.token_symbol} - {summary.leader.token_name}
                      </Text>
                    </View>
                    <StockPill label={formatStockPct(finiteNumber(summary.leader.change_24h_pct))} tone={finiteNumber(summary.leader.change_24h_pct) >= 0 ? "mint" : "red"} compact />
                  </Pressable>
                ) : null}
              </StockPanel>

              {renderAssistant()}

              <View
                style={{
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: "rgba(247,250,252,0.12)",
                  backgroundColor: "rgba(247,250,252,0.035)",
                  paddingHorizontal: 12,
                  paddingBottom: 8,
                }}
              >
                <View style={{ paddingVertical: 13, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: STOCK.ink, fontWeight: "900", fontSize: 14 }}>Full stock board</Text>
                    <Text style={{ marginTop: 3, color: STOCK.muted, fontSize: 12 }}>
                      {filtered.length} result{filtered.length === 1 ? "" : "s"} with current filters.
                    </Text>
                  </View>
                  <StockPill label={sortMode.replace(/_/g, " ").toUpperCase()} tone="plain" compact />
                </View>
                {filtered.map((item, index) => renderStockRow(item, index, true))}
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    );
  }

  const pageMaxWidth = isWide ? 1160 : undefined;
  const visibleStockRows = filtered.slice(0, isWide ? 12 : 8);
  const hiddenStockRows = Math.max(0, filtered.length - visibleStockRows.length);

  return (
    <StockScreen style={{ paddingHorizontal: isWide ? 28 : 16 }}>
      <InAppTutorial enabled={!loading} flow={tutorialFlows.stockHome} />
      <StockToolsModal />
      <View style={{ alignSelf: "center", width: "100%", maxWidth: pageMaxWidth }}>
        <AppHeader title="Digital Stock" subtitle="Trading dashboard for store-backed markets." />
      </View>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 34, alignSelf: "center", width: "100%", maxWidth: pageMaxWidth }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      >
        {renderStockHero()}

        {loading ? <StockLoadingState label="Loading market" /> : null}

        {!!err ? <StockAlert>{err}</StockAlert> : null}

        {!loading && filtered.length === 0 ? (
          <View style={{ marginTop: 14 }}>
            <StockEmptyState
              icon="storefront-outline"
              title="No store stocks found"
              message="Try another ticker or wait for verified stores to launch a tradable market."
              actionLabel="Create Stock"
              onAction={() => router.push("/market/stock/create" as any)}
            />
          </View>
        ) : null}

        {!loading && filtered.length > 0 ? (
          <TutorialTarget id="stock.home.board">
            <View
              style={{
                marginTop: 14,
                borderRadius: 18,
                borderWidth: 1,
                borderColor: "rgba(247,250,252,0.12)",
                backgroundColor: "rgba(247,250,252,0.035)",
                paddingHorizontal: isWide ? 14 : 12,
                paddingBottom: 12,
              }}
            >
              <View
                style={{
                  paddingTop: 14,
                  paddingBottom: 4,
                  flexDirection: isWide ? "row" : "column",
                  alignItems: isWide ? "center" : "stretch",
                  justifyContent: "space-between",
                  gap: 10,
                }}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: STOCK.ink, fontWeight: "900", fontSize: 18 }}>Active stocks</Text>
                  <Text style={{ marginTop: 3, color: STOCK.muted, fontSize: 12 }}>
                    Showing {visibleStockRows.length} of {filtered.length}. Tools holds filters, analytics, watchlist, and the full board.
                  </Text>
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                  <StockPill label={sortMode.replace(/_/g, " ").toUpperCase()} tone="plain" compact />
                  <Pressable
                    onPress={() => setToolsVisible(true)}
                    style={{
                      minHeight: 34,
                      borderRadius: 10,
                      paddingHorizontal: 11,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                      backgroundColor: "rgba(98,168,255,0.14)",
                      borderWidth: 1,
                      borderColor: "rgba(98,168,255,0.34)",
                    }}
                  >
                    <Ionicons name="options-outline" size={15} color={STOCK.cyan} />
                    <Text style={{ color: STOCK.ink, fontWeight: "900", fontSize: 11 }}>Tools</Text>
                  </Pressable>
                </View>
              </View>

              {visibleStockRows.map((item, index) => renderStockRow(item, index))}

              {hiddenStockRows > 0 ? (
                <Pressable
                  onPress={() => setToolsVisible(true)}
                  style={{
                    marginTop: 12,
                    minHeight: 44,
                    borderRadius: 14,
                    alignItems: "center",
                    justifyContent: "center",
                    flexDirection: "row",
                    gap: 8,
                    backgroundColor: "rgba(247,250,252,0.06)",
                    borderWidth: 1,
                    borderColor: "rgba(247,250,252,0.13)",
                  }}
                >
                  <Ionicons name="albums-outline" size={17} color={STOCK.cyan} />
                  <Text style={{ color: STOCK.ink, fontWeight: "900" }}>Open {hiddenStockRows} more in tools</Text>
                </Pressable>
              ) : null}
            </View>
          </TutorialTarget>
        ) : null}
      </ScrollView>
    </StockScreen>
  );
}
