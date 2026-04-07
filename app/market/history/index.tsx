import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import AppHeader from "@/components/common/AppHeader";
import { subscribeToAccountNotifications } from "@/services/market/notifications";
import { InAppTutorial } from "@/components/onboarding/InAppTutorial";
import { fetchMarketHistory, type MarketHistoryEntry } from "@/services/market/history";
import { tutorialFlows } from "@/services/onboarding/definitions";
import { supabase } from "@/services/supabase";
import { formatCurrency } from "@/utils/pricing";

const BG0 = "#05040B";
const BG1 = "#0A0620";
const CARD = "rgba(255,255,255,0.06)";
const BORDER = "rgba(255,255,255,0.10)";
const PURPLE = "#7C3AED";

const KINDS = [
  "all",
  "deposit",
  "market_buy",
  "market_sell",
  "market_crypto",
  "stock_buy",
  "stock_sell",
  "stock_profit",
  "event",
] as const;

function toNum(input: string) {
  const n = Number(input);
  return Number.isFinite(n) ? n : NaN;
}

function signAmount(entry: MarketHistoryEntry) {
  const k = String(entry.kind || "").toLowerCase();
  const amount = Number(entry.amount || 0);
  if (k === "stock_profit") return amount;
  if (
    [
      "market_buy",
      "stock_buy",
      "withdrawal",
      "transfer_out",
      "fee",
    ].includes(k)
  ) return -Math.abs(amount);
  return Math.abs(amount);
}

function isEventEntry(entry: MarketHistoryEntry) {
  return String(entry.kind || "").toLowerCase() === "event" || String(entry.source_table || "").toLowerCase() === "account_notifications";
}

function shortHash(v?: string | null) {
  const s = String(v || "");
  if (!s.startsWith("0x")) return "";
  if (s.length <= 14) return s;
  return `${s.slice(0, 8)}...${s.slice(-6)}`;
}

function kindLabel(kind: string) {
  return String(kind || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusTone(status: string) {
  const s = String(status || "").toUpperCase();
  if (["NEW", "UNREAD"].includes(s)) {
    return { bg: "rgba(124,58,237,0.22)", border: "rgba(167,139,250,0.45)", text: "#E9D5FF" };
  }
  if (["SUCCESS", "CONFIRMED", "RELEASED"].includes(s)) {
    return { bg: "rgba(16,185,129,0.20)", border: "rgba(16,185,129,0.42)", text: "#A7F3D0" };
  }
  if (["FAILED", "CANCELLED", "REFUNDED"].includes(s)) {
    return { bg: "rgba(239,68,68,0.20)", border: "rgba(239,68,68,0.42)", text: "#FECACA" };
  }
  return { bg: "rgba(255,255,255,0.08)", border: "rgba(255,255,255,0.16)", text: "#E5E7EB" };
}

export default function MarketHistoryScreen() {
  const params = useLocalSearchParams<{ q?: string }>();
  const initialSearch = String(params?.q ?? "").trim();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<MarketHistoryEntry[]>([]);

  const [kind, setKind] = useState<(typeof KINDS)[number]>("all");
  const [search, setSearch] = useState(initialSearch);
  const [year, setYear] = useState("");
  const [month, setMonth] = useState("");
  const [day, setDay] = useState("");
  const [hour, setHour] = useState("");
  const [currency, setCurrency] = useState("all");

  const load = useCallback(async (silent?: boolean) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const items = await fetchMarketHistory(350);
      setRows(items);
    } catch (e: any) {
      setError(String(e?.message || "Unable to load transaction history."));
      setRows([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let active = true;
    let removeNotifications: undefined | (() => void);
    let historyChannel: any = null;

    (async () => {
      const { data } = await supabase.auth.getUser();
      const userId = data?.user?.id;
      if (!active || !userId) return;

      removeNotifications = await subscribeToAccountNotifications(() => {
        void load(true);
      });

      if (!active) {
        removeNotifications?.();
        return;
      }

      historyChannel = supabase
        .channel(`market-history-live-${userId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "market_transaction_history",
            filter: `user_id=eq.${userId}`,
          },
          () => {
            void load(true);
          },
        )
        .subscribe();
    })();

    return () => {
      active = false;
      removeNotifications?.();
      if (historyChannel) {
        supabase.removeChannel(historyChannel);
      }
    };
  }, [load]);

  useEffect(() => {
    setSearch(initialSearch);
  }, [initialSearch]);

  const currencies = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows) set.add(String(row.currency || "USD").toUpperCase());
    return ["all", ...Array.from(set).sort()];
  }, [rows]);

  const filtered = useMemo(() => {
    const y = toNum(year);
    const m = toNum(month);
    const d = toNum(day);
    const h = toNum(hour);
    const q = search.trim().toLowerCase();

    return rows.filter((row) => {
      if (kind !== "all" && String(row.kind || "") !== kind) return false;
      if (currency !== "all" && String(row.currency || "").toUpperCase() !== currency) return false;

      const dt = new Date(row.occurred_at);
      if (Number.isFinite(y) && dt.getFullYear() !== y) return false;
      if (Number.isFinite(m) && dt.getMonth() + 1 !== m) return false;
      if (Number.isFinite(d) && dt.getDate() !== d) return false;
      if (Number.isFinite(h) && dt.getHours() !== h) return false;

      if (!q) return true;
      const hay = [
        row.title,
        row.kind,
        row.status,
        row.currency,
        row.tx_hash || "",
        row.order_id || "",
        row.source_id,
        JSON.stringify(row.details || {}),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, kind, currency, year, month, day, hour, search]);

  const summary = useMemo(() => {
    let inflow = 0;
    let outflow = 0;
    for (const row of filtered) {
      const signed = signAmount(row);
      if (signed >= 0) inflow += signed;
      else outflow += Math.abs(signed);
    }
    return { inflow, outflow, net: inflow - outflow };
  }, [filtered]);

  return (
    <LinearGradient colors={[BG1, BG0]} style={{ flex: 1 }}>
      <InAppTutorial enabled={!loading} flow={tutorialFlows.marketHistory} />
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 28 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load(true);
            }}
          />
        }
        ListHeaderComponent={
          <View style={{ paddingTop: 14 }}>
            <AppHeader title="History" subtitle="Deposits, orders, crypto, stock activity, and account events." />

            <View style={{ marginTop: 10, borderRadius: 18, padding: 12, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
              <Text style={{ color: "rgba(255,255,255,0.7)", fontWeight: "800", fontSize: 11 }}>SUMMARY (FILTERED)</Text>
              <Text style={{ marginTop: 6, color: "#86EFAC", fontWeight: "900", fontSize: 13 }}>Inflow: ${summary.inflow.toLocaleString(undefined, { maximumFractionDigits: 2 })}</Text>
              <Text style={{ marginTop: 4, color: "#FCA5A5", fontWeight: "900", fontSize: 13 }}>Outflow: ${summary.outflow.toLocaleString(undefined, { maximumFractionDigits: 2 })}</Text>
              <Text style={{ marginTop: 4, color: "#fff", fontWeight: "900", fontSize: 14 }}>
                Net: ${summary.net.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </Text>
            </View>

            <View style={{ marginTop: 10, borderRadius: 16, padding: 12, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
              <Text style={{ color: "rgba(255,255,255,0.74)", fontWeight: "800", fontSize: 11 }}>Search</Text>
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search by title, route, hash, order id..."
                placeholderTextColor="rgba(255,255,255,0.4)"
                style={{
                  marginTop: 8,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.12)",
                  backgroundColor: "rgba(255,255,255,0.05)",
                  color: "#fff",
                  paddingHorizontal: 11,
                  paddingVertical: 10,
                }}
              />

              <Text style={{ marginTop: 10, color: "rgba(255,255,255,0.74)", fontWeight: "800", fontSize: 11 }}>
                Filters (Year / Month / Day / Hour)
              </Text>
              <View style={{ marginTop: 8, flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                <TextInput
                  value={year}
                  onChangeText={setYear}
                  keyboardType="numeric"
                  placeholder="Year"
                  placeholderTextColor="rgba(255,255,255,0.4)"
                  style={{ width: 80, borderRadius: 10, borderWidth: 1, borderColor: BORDER, backgroundColor: "rgba(255,255,255,0.05)", color: "#fff", paddingHorizontal: 10, paddingVertical: 8 }}
                />
                <TextInput
                  value={month}
                  onChangeText={setMonth}
                  keyboardType="numeric"
                  placeholder="Month"
                  placeholderTextColor="rgba(255,255,255,0.4)"
                  style={{ width: 80, borderRadius: 10, borderWidth: 1, borderColor: BORDER, backgroundColor: "rgba(255,255,255,0.05)", color: "#fff", paddingHorizontal: 10, paddingVertical: 8 }}
                />
                <TextInput
                  value={day}
                  onChangeText={setDay}
                  keyboardType="numeric"
                  placeholder="Day"
                  placeholderTextColor="rgba(255,255,255,0.4)"
                  style={{ width: 80, borderRadius: 10, borderWidth: 1, borderColor: BORDER, backgroundColor: "rgba(255,255,255,0.05)", color: "#fff", paddingHorizontal: 10, paddingVertical: 8 }}
                />
                <TextInput
                  value={hour}
                  onChangeText={setHour}
                  keyboardType="numeric"
                  placeholder="Hour"
                  placeholderTextColor="rgba(255,255,255,0.4)"
                  style={{ width: 80, borderRadius: 10, borderWidth: 1, borderColor: BORDER, backgroundColor: "rgba(255,255,255,0.05)", color: "#fff", paddingHorizontal: 10, paddingVertical: 8 }}
                />
              </View>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {KINDS.map((k) => {
                    const active = kind === k;
                    return (
                      <Pressable
                        key={k}
                        onPress={() => setKind(k)}
                        style={{
                          paddingHorizontal: 11,
                          paddingVertical: 8,
                          borderRadius: 999,
                          borderWidth: 1,
                          borderColor: active ? PURPLE : BORDER,
                          backgroundColor: active ? "rgba(124,58,237,0.22)" : "rgba(255,255,255,0.05)",
                        }}
                      >
                        <Text style={{ color: "#fff", fontWeight: "900", fontSize: 11 }}>{k === "all" ? "All kinds" : kindLabel(k)}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {currencies.map((c) => {
                    const active = currency === c;
                    return (
                      <Pressable
                        key={c}
                        onPress={() => setCurrency(c)}
                        style={{
                          paddingHorizontal: 11,
                          paddingVertical: 8,
                          borderRadius: 999,
                          borderWidth: 1,
                          borderColor: active ? "rgba(45,212,191,0.55)" : BORDER,
                          backgroundColor: active ? "rgba(45,212,191,0.18)" : "rgba(255,255,255,0.05)",
                        }}
                      >
                        <Text style={{ color: "#fff", fontWeight: "900", fontSize: 11 }}>{c === "all" ? "All currency" : c}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>
            </View>

            <View style={{ marginTop: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ color: "#fff", fontWeight: "900", fontSize: 14 }}>
                {filtered.length.toLocaleString()} activity records
              </Text>
              <Pressable
                onPress={() => load(true)}
                style={{ width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: BORDER, backgroundColor: "rgba(255,255,255,0.05)" }}
              >
                <Ionicons name="refresh" size={16} color="#fff" />
              </Pressable>
            </View>

            {!!error ? (
              <View style={{ marginTop: 10, borderRadius: 14, padding: 10, backgroundColor: "rgba(239,68,68,0.18)", borderWidth: 1, borderColor: "rgba(239,68,68,0.35)" }}>
                <Text style={{ color: "#FECACA", fontWeight: "800" }}>{error}</Text>
              </View>
            ) : null}
            {loading ? (
              <View style={{ marginTop: 18, alignItems: "center" }}>
                <ActivityIndicator />
                <Text style={{ marginTop: 8, color: "rgba(255,255,255,0.7)" }}>Loading history...</Text>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          !loading ? (
            <View style={{ marginTop: 12, borderRadius: 14, padding: 12, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
              <Text style={{ color: "#fff", fontWeight: "900" }}>No history records match your filter.</Text>
              <Text style={{ marginTop: 6, color: "rgba(255,255,255,0.65)" }}>
                Try clearing year/month/day/hour or search text.
              </Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const signed = signAmount(item);
          const positive = signed >= 0;
          const tone = statusTone(item.status);
          const eventEntry = isEventEntry(item);
          const eventBody = String((item.details as any)?.body || "").trim();
          return (
            <Pressable
              onPress={() => router.push(`/market/history/${encodeURIComponent(item.id)}` as any)}
              style={{
                marginTop: 10,
                borderRadius: 16,
                padding: 12,
                backgroundColor: CARD,
                borderWidth: 1,
                borderColor: BORDER,
              }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
                <Text style={{ color: "#fff", fontWeight: "900", flex: 1 }}>{item.title}</Text>
                <View style={{ borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: tone.border, backgroundColor: tone.bg }}>
                  <Text style={{ color: tone.text, fontWeight: "900", fontSize: 10 }}>{item.status}</Text>
                </View>
              </View>

              <Text style={{ marginTop: 5, color: "rgba(255,255,255,0.66)", fontSize: 12 }}>
                {kindLabel(String(item.kind))} - {new Date(item.occurred_at).toLocaleString()}
              </Text>

              {eventBody ? (
                <Text numberOfLines={2} style={{ marginTop: 5, color: "rgba(255,255,255,0.62)", fontSize: 11, lineHeight: 16 }}>
                  {eventBody}
                </Text>
              ) : !!item.tx_hash ? (
                <Text style={{ marginTop: 3, color: "rgba(255,255,255,0.58)", fontSize: 11 }}>
                  Hash: {shortHash(item.tx_hash)}
                </Text>
              ) : null}

              <View style={{ marginTop: 8, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                {eventEntry ? (
                  <Text style={{ color: "#DDD6FE", fontWeight: "900", fontSize: 13 }}>
                    {(item.details as any)?.route ? "Open event details" : "Event note"}
                  </Text>
                ) : (
                  <Text style={{ color: positive ? "#86EFAC" : "#FCA5A5", fontWeight: "900", fontSize: 14 }}>
                    {positive ? "+" : "-"}
                    {formatCurrency(item.currency, Math.abs(signed), item.currency === "USDC" ? 6 : 2)}
                  </Text>
                )}
                <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.7)" />
              </View>
            </Pressable>
          );
        }}
      />
    </LinearGradient>
  );
}
