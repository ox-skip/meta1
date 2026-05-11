import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import AppHeader from "@/components/common/AppHeader";
import { InAppTutorial } from "@/components/onboarding/InAppTutorial";
import { subscribeToAccountNotifications } from "@/services/market/notifications";
import { fetchMarketHistory, type MarketHistoryEntry } from "@/services/market/history";
import { tutorialFlows } from "@/services/onboarding/definitions";
import { supabase } from "@/services/supabase";
import { formatCurrency } from "@/utils/pricing";

const BG0 = "#060807";
const BG1 = "#10130E";
const BG2 = "#171A13";
const TEXT = "#FFFDF7";
const MUTED = "rgba(255,253,247,0.68)";
const FAINT = "rgba(255,253,247,0.44)";
const PANEL = "rgba(255,253,247,0.065)";
const PANEL_STRONG = "rgba(255,253,247,0.095)";
const BORDER = "rgba(255,253,247,0.12)";
const BORDER_TOP = "rgba(255,253,247,0.24)";
const TEAL = "#2DD4BF";
const AMBER = "#F4B75D";
const BLUE = "#38BDF8";
const ROSE = "#FB7185";
const LIME = "#A3E635";
const INK = "#07100D";

type GroupKey = "all" | "wallet" | "orders" | "crypto" | "stocks" | "events";
type RangeKey = "all" | "today" | "7d" | "30d";
type IconName = React.ComponentProps<typeof Ionicons>["name"];

const GROUPS: Array<{ key: GroupKey; label: string; icon: IconName; accent: string }> = [
  { key: "all", label: "All", icon: "albums-outline", accent: TEAL },
  { key: "wallet", label: "Wallet", icon: "wallet-outline", accent: LIME },
  { key: "orders", label: "Orders", icon: "receipt-outline", accent: AMBER },
  { key: "crypto", label: "Crypto", icon: "shield-checkmark-outline", accent: BLUE },
  { key: "stocks", label: "Stocks", icon: "trending-up-outline", accent: "#C084FC" },
  { key: "events", label: "Events", icon: "notifications-outline", accent: ROSE },
];

const RANGES: Array<{ key: RangeKey; label: string }> = [
  { key: "all", label: "All time" },
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
];

function toTimestamp(input: string) {
  const value = new Date(input).getTime();
  return Number.isFinite(value) ? value : 0;
}

function kindLabel(kind: string) {
  return String(kind || "activity")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDateLabel(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Date unavailable";

  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function statusTone(status: string) {
  const s = String(status || "").toUpperCase();
  if (["NEW", "UNREAD", "PENDING", "PROCESSING"].includes(s)) {
    return { bg: "rgba(244,183,93,0.15)", border: "rgba(244,183,93,0.35)", text: AMBER };
  }
  if (["SUCCESS", "CONFIRMED", "RELEASED", "READ", "COMPLETED", "PAID"].includes(s)) {
    return { bg: "rgba(45,212,191,0.13)", border: "rgba(45,212,191,0.34)", text: TEAL };
  }
  if (["REFUNDED", "REVERSED"].includes(s)) {
    return { bg: "rgba(56,189,248,0.14)", border: "rgba(56,189,248,0.34)", text: BLUE };
  }
  if (["FAILED", "CANCELLED", "CANCELED", "REJECTED"].includes(s)) {
    return { bg: "rgba(251,113,133,0.15)", border: "rgba(251,113,133,0.34)", text: ROSE };
  }
  return { bg: "rgba(255,253,247,0.08)", border: BORDER, text: MUTED };
}

function isEventEntry(entry: MarketHistoryEntry) {
  return String(entry.kind || "").toLowerCase() === "event" || String(entry.source_table || "").toLowerCase() === "account_notifications";
}

function groupFor(entry: MarketHistoryEntry): GroupKey {
  const kind = String(entry.kind || "").toLowerCase();
  const source = String(entry.source_table || "").toLowerCase();
  if (kind === "event" || source === "account_notifications") return "events";
  if (kind.includes("stock") || source.includes("stock")) return "stocks";
  if (kind.includes("crypto") || source.includes("chain") || source.includes("crypto")) return "crypto";
  if (kind.includes("market_") || source === "market_orders") return "orders";
  if (
    kind === "deposit" ||
    kind === "withdrawal" ||
    kind === "transfer_in" ||
    kind === "transfer_out" ||
    kind === "fee" ||
    source.includes("wallet") ||
    source.includes("withdrawal") ||
    source.includes("paystack")
  ) {
    return "wallet";
  }
  return "events";
}

function groupMeta(entry: MarketHistoryEntry) {
  return GROUPS.find((item) => item.key === groupFor(entry)) ?? GROUPS[0];
}

function signAmount(entry: MarketHistoryEntry) {
  if (isEventEntry(entry)) return 0;

  const kind = String(entry.kind || "").toLowerCase();
  const amount = Number(entry.amount || 0);
  const abs = Math.abs(Number.isFinite(amount) ? amount : 0);
  const details = (entry.details ?? {}) as Record<string, any>;
  const intentType = String(details.intent_type || details.event_type || "").toUpperCase();

  if (kind === "stock_profit") return amount;
  if (kind === "market_crypto") {
    if (intentType.includes("DEPOSIT")) return -abs;
    if (intentType.includes("REFUND") || intentType.includes("RELEASE")) return abs;
    return abs;
  }
  if (["market_buy", "stock_buy", "withdrawal", "transfer_out", "fee"].includes(kind)) return -abs;
  return abs;
}

function shortHash(value?: string | null) {
  const raw = String(value || "");
  if (!raw) return "";
  if (raw.length <= 14) return raw;
  return `${raw.slice(0, 8)}...${raw.slice(-6)}`;
}

function detailsText(entry: MarketHistoryEntry) {
  const details = (entry.details ?? {}) as Record<string, any>;
  const body = String(details.body || "").trim();
  if (body) return body;
  if (entry.tx_hash) return `Hash ${shortHash(entry.tx_hash)}`;
  if (details.reference) return `Reference ${String(details.reference)}`;
  if (details.stock_symbol) return `${String(details.stock_symbol).toUpperCase()} activity`;
  if (entry.order_id) return `Order ${String(entry.order_id).slice(0, 8)}`;
  return kindLabel(String(entry.kind || ""));
}

function rangeStart(range: RangeKey) {
  if (range === "all") return 0;
  const d = new Date();
  if (range === "today") {
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  if (range === "7d") return Date.now() - 7 * 24 * 60 * 60 * 1000;
  return Date.now() - 30 * 24 * 60 * 60 * 1000;
}

function SummaryCard({
  label,
  value,
  sub,
  icon,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: IconName;
  accent: string;
}) {
  return (
    <View
      style={{
        flex: 1,
        minWidth: 136,
        borderRadius: 20,
        padding: 14,
        backgroundColor: PANEL,
        borderWidth: 1,
        borderColor: BORDER,
      }}
    >
      <View
        style={{
          width: 38,
          height: 38,
          borderRadius: 15,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: `${accent}18`,
          borderWidth: 1,
          borderColor: `${accent}44`,
        }}
      >
        <Ionicons name={icon} size={18} color={accent} />
      </View>
      <Text style={{ marginTop: 11, color: MUTED, fontWeight: "900", fontSize: 11 }}>{label}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit style={{ marginTop: 4, color: TEXT, fontWeight: "900", fontSize: 18 }}>
        {value}
      </Text>
      {sub ? <Text numberOfLines={1} style={{ marginTop: 3, color: FAINT, fontSize: 11 }}>{sub}</Text> : null}
    </View>
  );
}

function FilterChip({
  active,
  label,
  icon,
  accent = TEAL,
  onPress,
}: {
  active: boolean;
  label: string;
  icon?: IconName;
  accent?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        height: 40,
        borderRadius: 999,
        paddingHorizontal: 13,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 7,
        borderWidth: 1,
        borderColor: active ? `${accent}55` : BORDER,
        backgroundColor: active ? `${accent}1D` : "rgba(255,253,247,0.055)",
        transform: [{ scale: pressed ? 0.97 : 1 }],
      })}
    >
      {icon ? <Ionicons name={icon} size={15} color={active ? accent : MUTED} /> : null}
      <Text style={{ color: active ? TEXT : MUTED, fontWeight: "900", fontSize: 12 }}>{label}</Text>
    </Pressable>
  );
}

export default function MarketHistoryScreen() {
  const params = useLocalSearchParams<{ q?: string }>();
  const initialSearch = String(params?.q ?? "").trim();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isWide = width >= 760;
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<MarketHistoryEntry[]>([]);
  const [group, setGroup] = useState<GroupKey>("all");
  const [range, setRange] = useState<RangeKey>("all");
  const [search, setSearch] = useState(initialSearch);
  const [currency, setCurrency] = useState("all");

  const load = useCallback(async (silent?: boolean) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const items = await fetchMarketHistory(500);
      setRows(items);
    } catch (e: any) {
      setError(String(e?.message || "Unable to load account activity."));
      setRows([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const scheduleReload = useCallback(() => {
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    reloadTimerRef.current = setTimeout(() => {
      void load(true);
    }, 350);
  }, [load]);

  useEffect(() => {
    void load();
    return () => {
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    };
  }, [load]);

  useEffect(() => {
    let active = true;
    let removeNotifications: undefined | (() => void);
    const channels: any[] = [];

    (async () => {
      const { data } = await supabase.auth.getUser();
      const userId = data?.user?.id;
      if (!active || !userId) return;

      removeNotifications = await subscribeToAccountNotifications(scheduleReload);
      if (!active) {
        removeNotifications?.();
        return;
      }

      const attach = (name: string, table: string, filter?: string) => {
        const channel = supabase
          .channel(`market-history-${name}-${userId}`)
          .on("postgres_changes", { event: "*", schema: "public", table, filter }, scheduleReload)
          .subscribe();
        channels.push(channel);
      };

      attach("history", "market_transaction_history", `user_id=eq.${userId}`);
      attach("wallet", "app_wallet_tx_simple", `user_id=eq.${userId}`);
      attach("withdrawals", "withdrawals_simple", `user_id=eq.${userId}`);
      attach("paystack", "paystack_events_simple", `user_id=eq.${userId}`);
      attach("stock-trades", "market_stock_trades", `user_id=eq.${userId}`);
      attach("stock-positions", "market_stock_positions", `user_id=eq.${userId}`);
      attach("orders-buyer", "market_orders", `buyer_id=eq.${userId}`);
      attach("orders-seller", "market_orders", `seller_id=eq.${userId}`);
    })();

    return () => {
      active = false;
      removeNotifications?.();
      channels.forEach((channel) => supabase.removeChannel(channel));
    };
  }, [scheduleReload]);

  useEffect(() => {
    setSearch(initialSearch);
  }, [initialSearch]);

  const currencies = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((row) => {
      if (!isEventEntry(row)) set.add(String(row.currency || "USD").toUpperCase());
    });
    return ["all", ...Array.from(set).sort()];
  }, [rows]);

  const filtered = useMemo(() => {
    const start = rangeStart(range);
    const q = search.trim().toLowerCase();

    return rows.filter((row) => {
      if (group !== "all" && groupFor(row) !== group) return false;
      if (currency !== "all" && String(row.currency || "").toUpperCase() !== currency) return false;
      if (start && toTimestamp(row.occurred_at) < start) return false;

      if (!q) return true;
      const details = row.details ?? {};
      const hay = [
        row.title,
        row.kind,
        row.status,
        row.currency,
        row.source_table,
        row.source_id,
        row.tx_hash || "",
        row.order_id || "",
        row.stock_id || "",
        JSON.stringify(details),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, group, currency, range, search]);

  const summary = useMemo(() => {
    const totals = new Map<string, { inflow: number; outflow: number; count: number }>();

    filtered.forEach((row) => {
      if (isEventEntry(row)) return;
      const code = String(row.currency || "USD").toUpperCase();
      const signed = signAmount(row);
      const current = totals.get(code) ?? { inflow: 0, outflow: 0, count: 0 };
      if (signed >= 0) current.inflow += signed;
      else current.outflow += Math.abs(signed);
      current.count += 1;
      totals.set(code, current);
    });

    const entries = Array.from(totals.entries()).sort((a, b) => {
      const av = a[1].inflow + a[1].outflow;
      const bv = b[1].inflow + b[1].outflow;
      return bv - av;
    });
    const selected = currency !== "all" ? currency : entries[0]?.[0] ?? "USD";
    const current = totals.get(selected) ?? { inflow: 0, outflow: 0, count: 0 };
    return {
      currency: selected,
      inflow: current.inflow,
      outflow: current.outflow,
      net: current.inflow - current.outflow,
      transactionCount: filtered.filter((row) => !isEventEntry(row)).length,
      eventCount: filtered.filter(isEventEntry).length,
      currencyCount: totals.size,
    };
  }, [currency, filtered]);

  const clearFilters = () => {
    setGroup("all");
    setRange("all");
    setCurrency("all");
    setSearch("");
  };

  function openEntry(item: MarketHistoryEntry) {
    router.push({ pathname: "/market/history/[entryId]" as any, params: { entryId: item.id } });
  }

  function renderActivity(item: MarketHistoryEntry, index: number) {
    const prev = index > 0 ? filtered[index - 1] : null;
    const showDate = !prev || formatDateLabel(prev.occurred_at) !== formatDateLabel(item.occurred_at);
    const event = isEventEntry(item);
    const signed = signAmount(item);
    const positive = signed >= 0;
    const meta = groupMeta(item);
    const tone = statusTone(item.status);

    return (
      <View>
        {showDate ? (
          <Text style={{ marginTop: index === 0 ? 14 : 22, marginBottom: 8, color: FAINT, fontWeight: "900", fontSize: 12 }}>
            {formatDateLabel(item.occurred_at)}
          </Text>
        ) : null}

        <Pressable
          onPress={() => openEntry(item)}
          style={({ pressed }) => ({
            borderRadius: 22,
            padding: 14,
            backgroundColor: pressed ? PANEL_STRONG : PANEL,
            borderWidth: 1,
            borderColor: BORDER,
            transform: [{ translateY: pressed ? 1 : 0 }],
          })}
        >
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 18,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: `${meta.accent}18`,
                borderWidth: 1,
                borderColor: `${meta.accent}42`,
              }}
            >
              <Ionicons name={meta.icon} size={20} color={meta.accent} />
            </View>

            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ color: TEXT, fontWeight: "900", fontSize: 15 }}>
                    {item.title}
                  </Text>
                  <Text numberOfLines={1} style={{ marginTop: 3, color: MUTED, fontSize: 12 }}>
                    {kindLabel(String(item.kind))} - {formatTime(item.occurred_at)}
                  </Text>
                </View>

                <View style={{ alignItems: "flex-end", gap: 6 }}>
                  {event ? (
                    <Text style={{ color: meta.accent, fontWeight: "900", fontSize: 12 }}>{meta.label}</Text>
                  ) : (
                    <Text
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      style={{
                        color: positive ? TEAL : ROSE,
                        fontWeight: "900",
                        fontSize: 14,
                        maxWidth: isWide ? 180 : 124,
                      }}
                    >
                      {positive ? "+" : "-"}
                      {formatCurrency(item.currency, Math.abs(signed), item.currency === "USDC" || item.currency === "USDT" ? 6 : 2)}
                    </Text>
                  )}

                  <View
                    style={{
                      borderRadius: 999,
                      paddingHorizontal: 8,
                      paddingVertical: 4,
                      borderWidth: 1,
                      borderColor: tone.border,
                      backgroundColor: tone.bg,
                    }}
                  >
                    <Text style={{ color: tone.text, fontWeight: "900", fontSize: 10 }}>{String(item.status || "STATUS")}</Text>
                  </View>
                </View>
              </View>

              <Text numberOfLines={2} style={{ marginTop: 9, color: MUTED, lineHeight: 18, fontSize: 12 }}>
                {detailsText(item)}
              </Text>

              <View style={{ marginTop: 11, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <Text numberOfLines={1} style={{ flex: 1, color: FAINT, fontSize: 11, fontWeight: "800" }}>
                  {item.source_table.replace(/_/g, " ")}
                </Text>
                <Ionicons name="chevron-forward" size={17} color={MUTED} />
              </View>
            </View>
          </View>
        </Pressable>
      </View>
    );
  }

  const hasActiveFilters = group !== "all" || range !== "all" || currency !== "all" || !!search.trim();

  return (
    <LinearGradient colors={[BG2, BG1, BG0]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={{ flex: 1 }}>
      <InAppTutorial enabled={!loading} flow={tutorialFlows.marketHistory} />
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => renderActivity(item, index)}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: Math.max(12, insets.top ? 6 : 12),
          paddingBottom: Math.max(insets.bottom + 108, 132),
          alignSelf: "center",
          width: "100%",
          maxWidth: 980,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load(true);
            }}
            tintColor={TEAL}
          />
        }
        ListHeaderComponent={
          <View>
            <AppHeader title="History" subtitle="Wallet, orders, crypto, stocks, and account activity" bordered={false} style={{ paddingHorizontal: 0, backgroundColor: "transparent" }} />

            <View
              style={{
                marginTop: 8,
                borderRadius: 28,
                overflow: "hidden",
                borderWidth: 1,
                borderColor: BORDER_TOP,
                backgroundColor: "rgba(9,13,11,0.72)",
              }}
            >
              <LinearGradient
                colors={["rgba(45,212,191,0.16)", "rgba(255,253,247,0.06)", "rgba(244,183,93,0.10)"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ padding: 16 }}
              >
                <View style={{ flexDirection: isWide ? "row" : "column", gap: 12 }}>
                  <SummaryCard
                    label="Net"
                    value={`${summary.net >= 0 ? "+" : "-"}${formatCurrency(summary.currency, Math.abs(summary.net), summary.currency === "USDC" || summary.currency === "USDT" ? 6 : 2)}`}
                    sub={`${summary.net >= 0 ? "Positive" : "Negative"} in ${summary.currency}`}
                    icon={summary.net >= 0 ? "trending-up-outline" : "trending-down-outline"}
                    accent={summary.net >= 0 ? TEAL : ROSE}
                  />
                  <SummaryCard
                    label="Inflow"
                    value={formatCurrency(summary.currency, summary.inflow, summary.currency === "USDC" || summary.currency === "USDT" ? 6 : 2)}
                    sub={summary.currencyCount > 1 ? "Primary currency" : "Received"}
                    icon="arrow-down-circle-outline"
                    accent={LIME}
                  />
                  <SummaryCard
                    label="Outflow"
                    value={formatCurrency(summary.currency, summary.outflow, summary.currency === "USDC" || summary.currency === "USDT" ? 6 : 2)}
                    sub="Spent or sent"
                    icon="arrow-up-circle-outline"
                    accent={AMBER}
                  />
                  <SummaryCard
                    label="Records"
                    value={filtered.length.toLocaleString()}
                    sub={`${summary.transactionCount} financial, ${summary.eventCount} events`}
                    icon="list-outline"
                    accent={BLUE}
                  />
                </View>
              </LinearGradient>
            </View>

            <View
              style={{
                marginTop: 12,
                borderRadius: 24,
                padding: 12,
                backgroundColor: PANEL,
                borderWidth: 1,
                borderColor: BORDER,
              }}
            >
              <View
                style={{
                  minHeight: 48,
                  borderRadius: 18,
                  borderWidth: 1,
                  borderColor: BORDER,
                  backgroundColor: "rgba(255,253,247,0.06)",
                  flexDirection: "row",
                  alignItems: "center",
                  paddingHorizontal: 13,
                  gap: 10,
                }}
              >
                <Ionicons name="search-outline" size={18} color={MUTED} />
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search title, order, reference, hash"
                  placeholderTextColor={FAINT}
                  style={{ flex: 1, minHeight: 46, color: TEXT, fontWeight: "800" }}
                  returnKeyType="search"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {search ? (
                  <Pressable onPress={() => setSearch("")} style={{ padding: 6 }}>
                    <Ionicons name="close-circle" size={18} color={MUTED} />
                  </Pressable>
                ) : null}
              </View>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12 }}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {GROUPS.map((item) => (
                    <FilterChip
                      key={item.key}
                      active={group === item.key}
                      label={item.label}
                      icon={item.icon}
                      accent={item.accent}
                      onPress={() => setGroup(item.key)}
                    />
                  ))}
                </View>
              </ScrollView>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {RANGES.map((item) => (
                    <FilterChip
                      key={item.key}
                      active={range === item.key}
                      label={item.label}
                      onPress={() => setRange(item.key)}
                    />
                  ))}
                </View>
              </ScrollView>

              {currencies.length > 2 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }}>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    {currencies.map((code) => (
                      <FilterChip
                        key={code}
                        active={currency === code}
                        label={code === "all" ? "All currency" : code}
                        accent={code === "all" ? TEAL : AMBER}
                        onPress={() => setCurrency(code)}
                      />
                    ))}
                  </View>
                </ScrollView>
              ) : null}

              {hasActiveFilters ? (
                <Pressable
                  onPress={clearFilters}
                  style={({ pressed }) => ({
                    marginTop: 12,
                    height: 42,
                    borderRadius: 16,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: "rgba(255,253,247,0.08)",
                    borderWidth: 1,
                    borderColor: BORDER,
                    transform: [{ scale: pressed ? 0.99 : 1 }],
                  })}
                >
                  <Text style={{ color: TEXT, fontWeight: "900" }}>Clear filters</Text>
                </Pressable>
              ) : null}
            </View>

            <View style={{ marginTop: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <View>
                <Text style={{ color: TEXT, fontWeight: "900", fontSize: 16 }}>Activity ledger</Text>
                <Text style={{ marginTop: 3, color: MUTED, fontSize: 12 }}>
                  {filtered.length.toLocaleString()} of {rows.length.toLocaleString()} records
                </Text>
              </View>
              <Pressable
                onPress={() => void load(true)}
                style={({ pressed }) => ({
                  width: 42,
                  height: 42,
                  borderRadius: 16,
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: 1,
                  borderColor: BORDER,
                  backgroundColor: "rgba(255,253,247,0.07)",
                  transform: [{ rotate: pressed ? "12deg" : "0deg" }],
                })}
              >
                <Ionicons name="refresh" size={18} color={TEXT} />
              </Pressable>
            </View>

            {error ? (
              <View
                style={{
                  marginTop: 12,
                  borderRadius: 18,
                  padding: 13,
                  backgroundColor: "rgba(251,113,133,0.14)",
                  borderWidth: 1,
                  borderColor: "rgba(251,113,133,0.32)",
                }}
              >
                <Text style={{ color: "#FFE4E6", fontWeight: "900" }}>{error}</Text>
              </View>
            ) : null}

            {loading ? (
              <View style={{ marginTop: 22, alignItems: "center" }}>
                <ActivityIndicator color={TEAL} />
                <Text style={{ marginTop: 10, color: MUTED, fontWeight: "800" }}>Loading activity</Text>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          !loading ? (
            <View
              style={{
                marginTop: 14,
                borderRadius: 22,
                padding: 16,
                backgroundColor: PANEL,
                borderWidth: 1,
                borderColor: BORDER,
              }}
            >
              <Ionicons name={rows.length ? "filter-outline" : "file-tray-outline"} size={24} color={TEAL} />
              <Text style={{ marginTop: 10, color: TEXT, fontWeight: "900", fontSize: 17 }}>
                {rows.length ? "No matching activity" : "No account activity found"}
              </Text>
              <Text style={{ marginTop: 6, color: MUTED, lineHeight: 20 }}>
                {rows.length ? "Adjust the filters or search terms." : "This account has no recorded marketplace activity."}
              </Text>
            </View>
          ) : null
        }
        showsVerticalScrollIndicator={false}
      />
    </LinearGradient>
  );
}
