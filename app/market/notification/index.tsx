import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";

import AppHeader from "@/components/common/AppHeader";
import {
  fetchAccountNotifications,
  markAccountNotificationRead,
  markAllAccountNotificationsRead,
  subscribeToAccountNotifications,
  type AccountNotification,
} from "@/services/market/notifications";

const BG0 = "#07110F";
const BG1 = "#17120A";
const PANEL = "rgba(255,253,247,0.075)";
const PANEL_STRONG = "rgba(9,14,12,0.94)";
const BORDER = "rgba(255,253,247,0.13)";
const TEXT = "#FFFDF7";
const MUTED = "rgba(255,253,247,0.66)";
const FAINT = "rgba(255,253,247,0.42)";
const TEAL = "#2DD4BF";
const AMBER = "#F4B75D";
const BLUE = "#38BDF8";
const ROSE = "#FB7185";
const LIME = "#A3E635";
const VIOLET = "#A78BFA";

type FilterMode = "all" | "unread" | "orders" | "money" | "support" | "stock" | "social" | "security";

type Tone = {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  label: string;
  filter: FilterMode;
};

const FILTERS: Array<{ key: FilterMode; label: string }> = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "orders", label: "Orders" },
  { key: "money", label: "Money" },
  { key: "support", label: "Support" },
  { key: "stock", label: "Stock" },
  { key: "social", label: "Social" },
  { key: "security", label: "Security" },
];

function timeLabel(ts: string) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  if (diff < 60 * 1000) return "Now";
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)}h`;
  if (diff < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / 86400000)}d`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function sectionLabel(ts: string) {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "Earlier";
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startYesterday = startToday - 24 * 60 * 60 * 1000;
  const time = date.getTime();
  if (time >= startToday) return "Today";
  if (time >= startYesterday) return "Yesterday";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function toneForKind(kind: string): Tone {
  const normalized = String(kind || "").toLowerCase();
  if (normalized.includes("support")) return { icon: "chatbubbles-outline", color: TEAL, label: "Support", filter: "support" };
  if (normalized.includes("dm")) return { icon: "chatbubble-ellipses-outline", color: BLUE, label: "Message", filter: "social" };
  if (normalized.includes("order") || normalized.includes("delivery")) return { icon: "receipt-outline", color: VIOLET, label: "Order", filter: "orders" };
  if (normalized.includes("wallet") || normalized.includes("deposit") || normalized.includes("withdrawal") || normalized.includes("payment")) {
    return { icon: "wallet-outline", color: TEAL, label: "Money", filter: "money" };
  }
  if (normalized.includes("stock") || normalized.includes("trade")) return { icon: "trending-up-outline", color: AMBER, label: "Stock", filter: "stock" };
  if (normalized.includes("review") || normalized.includes("comment")) return { icon: "star-outline", color: "#FB923C", label: "Social", filter: "social" };
  if (normalized.includes("follow") || normalized.includes("social")) return { icon: "people-outline", color: BLUE, label: "Social", filter: "social" };
  if (normalized.includes("verification")) return { icon: "shield-checkmark-outline", color: LIME, label: "Trust", filter: "security" };
  if (normalized.includes("session") || normalized.includes("auth")) return { icon: "lock-closed-outline", color: VIOLET, label: "Security", filter: "security" };
  if (normalized.includes("dispute") || normalized.includes("failed") || normalized.includes("refund")) {
    return { icon: "alert-circle-outline", color: ROSE, label: "Issue", filter: "support" };
  }
  return { icon: "notifications-outline", color: AMBER, label: "Alert", filter: "all" };
}

function matchesFilter(row: AccountNotification, filter: FilterMode) {
  if (filter === "all") return true;
  if (filter === "unread") return !row.read_at;
  return toneForKind(row.kind).filter === filter;
}

function matchesSearch(row: AccountNotification, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [row.title, row.body, row.kind, row.entity_type, row.entity_id]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(q));
}

function FilterChip({
  label,
  count,
  active,
  onPress,
}: {
  label: string;
  count: number;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 9,
        backgroundColor: active ? "rgba(45,212,191,0.15)" : "rgba(255,255,255,0.045)",
        borderWidth: 1,
        borderColor: active ? "rgba(45,212,191,0.45)" : BORDER,
        flexDirection: "row",
        gap: 7,
        alignItems: "center",
      }}
    >
      <Text style={{ color: active ? TEAL : MUTED, fontWeight: "900", fontSize: 12 }}>{label}</Text>
      <Text style={{ color: active ? TEAL : FAINT, fontWeight: "900", fontSize: 12 }}>{count}</Text>
    </Pressable>
  );
}

function StatBlock({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <View
      style={{
        flex: 1,
        minWidth: 96,
        borderRadius: 8,
        padding: 12,
        backgroundColor: `${color}14`,
        borderWidth: 1,
        borderColor: `${color}36`,
      }}
    >
      <Text style={{ color: FAINT, fontSize: 10, fontWeight: "900", textTransform: "uppercase" }}>{label}</Text>
      <Text style={{ marginTop: 7, color, fontSize: 20, fontWeight: "900" }}>{value}</Text>
    </View>
  );
}

function NotificationRow({
  row,
  onPress,
}: {
  row: AccountNotification;
  onPress: () => void;
}) {
  const tone = toneForKind(row.kind);
  const unread = !row.read_at;
  return (
    <Pressable
      onPress={onPress}
      style={{
        borderRadius: 8,
        padding: 12,
        backgroundColor: unread ? "rgba(45,212,191,0.10)" : PANEL,
        borderWidth: 1,
        borderColor: unread ? "rgba(45,212,191,0.32)" : BORDER,
        flexDirection: "row",
        gap: 12,
        alignItems: "flex-start",
      }}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 8,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: `${tone.color}18`,
          borderWidth: 1,
          borderColor: `${tone.color}42`,
        }}
      >
        <Ionicons name={tone.icon} size={20} color={tone.color} />
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={2} style={{ color: TEXT, fontSize: 14, fontWeight: "900", lineHeight: 19 }}>
              {row.title}
            </Text>
            {row.body ? (
              <Text numberOfLines={2} style={{ marginTop: 5, color: MUTED, fontSize: 12, lineHeight: 18 }}>
                {row.body}
              </Text>
            ) : null}
          </View>
          <Text style={{ color: FAINT, fontSize: 11, fontWeight: "800" }}>{timeLabel(row.created_at)}</Text>
        </View>

        <View style={{ marginTop: 10, flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <View
            style={{
              borderRadius: 999,
              paddingHorizontal: 8,
              paddingVertical: 4,
              backgroundColor: `${tone.color}14`,
              borderWidth: 1,
              borderColor: `${tone.color}32`,
            }}
          >
            <Text style={{ color: tone.color, fontSize: 10, fontWeight: "900" }}>{tone.label}</Text>
          </View>
          {unread ? <View style={{ width: 7, height: 7, borderRadius: 999, backgroundColor: TEAL }} /> : null}
          <Text style={{ color: unread ? TEAL : FAINT, fontSize: 10, fontWeight: "900" }}>
            {unread ? "Unread" : "Read"}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

export default function MarketNotificationInbox() {
  const { width } = useWindowDimensions();
  const wide = width >= 920;
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<AccountNotification[]>([]);
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setErr(null);
    try {
      const next = await fetchAccountNotifications(150);
      setRows(next);
    } catch (error: any) {
      setErr(String(error?.message || "Could not load notifications."));
      setRows([]);
    } finally {
      setLoading(false);
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;

    void subscribeToAccountNotifications(() => {
      void load();
    }).then((fn) => {
      unsubscribe = fn;
    });

    return () => {
      unsubscribe?.();
    };
  }, [load]);

  const unreadCount = useMemo(() => rows.filter((row) => !row.read_at).length, [rows]);
  const todayCount = useMemo(() => rows.filter((row) => sectionLabel(row.created_at) === "Today").length, [rows]);
  const counts = useMemo(() => {
    const next: Record<FilterMode, number> = {
      all: rows.length,
      unread: unreadCount,
      orders: 0,
      money: 0,
      support: 0,
      stock: 0,
      social: 0,
      security: 0,
    };
    rows.forEach((row) => {
      const filter = toneForKind(row.kind).filter;
      if (filter !== "all") next[filter] += 1;
    });
    return next;
  }, [rows, unreadCount]);

  const filteredRows = useMemo(
    () => rows.filter((row) => matchesFilter(row, filterMode) && matchesSearch(row, query)),
    [filterMode, query, rows],
  );

  const sections = useMemo(() => {
    const grouped: Array<{ title: string; data: AccountNotification[] }> = [];
    filteredRows.forEach((row) => {
      const title = sectionLabel(row.created_at);
      const existing = grouped.find((group) => group.title === title);
      if (existing) existing.data.push(row);
      else grouped.push({ title, data: [row] });
    });
    return grouped;
  }, [filteredRows]);

  async function openNotification(row: AccountNotification) {
    if (!row.read_at) {
      const readAt = new Date().toISOString();
      await markAccountNotificationRead(row.id).catch(() => undefined);
      setRows((current) => current.map((item) => (item.id === row.id ? { ...item, read_at: readAt } : item)));
    }

    router.push({
      pathname: "/market/notification/[id]" as any,
      params: { id: row.id },
    });
  }

  async function markAllRead() {
    if (!unreadCount) return;
    setBusy(true);
    try {
      const readAt = new Date().toISOString();
      await markAllAccountNotificationsRead();
      setRows((current) => current.map((row) => ({ ...row, read_at: row.read_at ?? readAt })));
    } catch (error: any) {
      setErr(String(error?.message || "Could not mark notifications as read."));
    } finally {
      setBusy(false);
    }
  }

  function refresh() {
    setLoading(rows.length === 0);
    setBusy(true);
    void load();
  }

  return (
    <LinearGradient colors={[BG1, BG0]} start={{ x: 0.12, y: 0 }} end={{ x: 0.9, y: 1 }} style={{ flex: 1 }}>
      <AppHeader title="Activity" subtitle="Notifications" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 34 }}>
        <View style={{ width: "100%", maxWidth: 1120, alignSelf: "center" }}>
          <View
            style={{
              marginTop: 12,
              borderRadius: 8,
              padding: 16,
              backgroundColor: PANEL_STRONG,
              borderWidth: 1,
              borderColor: BORDER,
            }}
          >
            <View style={{ flexDirection: wide ? "row" : "column", gap: 14, alignItems: wide ? "center" : "stretch" }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: TEAL, fontWeight: "900", fontSize: 11, textTransform: "uppercase" }}>Notification center</Text>
                <Text style={{ marginTop: 7, color: TEXT, fontWeight: "900", fontSize: wide ? 28 : 24 }}>
                  {unreadCount ? `${unreadCount} unread` : "All clear"}
                </Text>
              </View>
              <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
                <Pressable
                  onPress={refresh}
                  disabled={busy}
                  style={{
                    minHeight: 44,
                    borderRadius: 8,
                    paddingHorizontal: 14,
                    alignItems: "center",
                    justifyContent: "center",
                    flexDirection: "row",
                    gap: 8,
                    backgroundColor: "rgba(255,255,255,0.06)",
                    borderWidth: 1,
                    borderColor: BORDER,
                    opacity: busy ? 0.62 : 1,
                  }}
                >
                  {busy ? <ActivityIndicator color={TEXT} /> : <Ionicons name="refresh" size={17} color={TEXT} />}
                  <Text style={{ color: TEXT, fontWeight: "900" }}>Refresh</Text>
                </Pressable>
                <Pressable
                  disabled={!unreadCount || busy}
                  onPress={() => void markAllRead()}
                  style={{
                    minHeight: 44,
                    borderRadius: 8,
                    paddingHorizontal: 14,
                    alignItems: "center",
                    justifyContent: "center",
                    flexDirection: "row",
                    gap: 8,
                    backgroundColor: unreadCount ? "rgba(45,212,191,0.15)" : "rgba(255,255,255,0.045)",
                    borderWidth: 1,
                    borderColor: unreadCount ? "rgba(45,212,191,0.42)" : BORDER,
                    opacity: !unreadCount || busy ? 0.58 : 1,
                  }}
                >
                  <Ionicons name="checkmark-done-outline" size={17} color={unreadCount ? TEAL : FAINT} />
                  <Text style={{ color: unreadCount ? TEAL : FAINT, fontWeight: "900" }}>Mark all read</Text>
                </Pressable>
              </View>
            </View>

            <View style={{ marginTop: 15, flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
              <StatBlock label="Unread" value={unreadCount} color={TEAL} />
              <StatBlock label="Today" value={todayCount} color={AMBER} />
              <StatBlock label="Total" value={rows.length} color={BLUE} />
            </View>

            <View
              style={{
                marginTop: 15,
                minHeight: 46,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: BORDER,
                backgroundColor: "rgba(255,255,255,0.055)",
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                paddingHorizontal: 12,
              }}
            >
              <Ionicons name="search-outline" size={17} color={FAINT} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search activity"
                placeholderTextColor="rgba(255,253,247,0.35)"
                autoCapitalize="none"
                style={{ flex: 1, color: TEXT, fontSize: 14, minHeight: 44 }}
              />
              {query ? (
                <Pressable onPress={() => setQuery("")} hitSlop={8}>
                  <Ionicons name="close" size={17} color={FAINT} />
                </Pressable>
              ) : null}
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ marginTop: 13, gap: 8, paddingRight: 4 }}>
              {FILTERS.map((item) => (
                <FilterChip
                  key={item.key}
                  label={item.label}
                  count={counts[item.key]}
                  active={filterMode === item.key}
                  onPress={() => setFilterMode(item.key)}
                />
              ))}
            </ScrollView>
          </View>

          {loading ? (
            <View style={{ marginTop: 22, alignItems: "center", paddingVertical: 30 }}>
              <ActivityIndicator color={TEAL} />
            </View>
          ) : err ? (
            <View style={{ marginTop: 14, borderRadius: 8, padding: 14, backgroundColor: "rgba(251,113,133,0.12)", borderWidth: 1, borderColor: "rgba(251,113,133,0.35)" }}>
              <Text style={{ color: "#FDA4AF", fontWeight: "900" }}>Could not load notifications</Text>
              <Text style={{ marginTop: 6, color: MUTED }}>{err}</Text>
            </View>
          ) : sections.length === 0 ? (
            <View style={{ marginTop: 14, borderRadius: 8, padding: 18, backgroundColor: PANEL, borderWidth: 1, borderColor: BORDER }}>
              <Text style={{ color: TEXT, fontWeight: "900", fontSize: 16 }}>
                {filterMode === "unread" ? "No unread notifications" : "No notifications"}
              </Text>
              <Text style={{ marginTop: 6, color: MUTED }}>{query ? "No matches for this search." : "You are up to date."}</Text>
            </View>
          ) : (
            <View style={{ marginTop: 16, gap: 16 }}>
              {sections.map((section) => (
                <View key={section.title} style={{ gap: 9 }}>
                  <Text style={{ color: FAINT, fontSize: 11, fontWeight: "900", textTransform: "uppercase" }}>
                    {section.title}
                  </Text>
                  {section.data.map((row) => (
                    <NotificationRow key={row.id} row={row} onPress={() => void openNotification(row)} />
                  ))}
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </LinearGradient>
  );
}
