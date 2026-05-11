import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";

import AppHeader from "@/components/common/AppHeader";
import {
  AccountNotification,
  fetchAccountNotifications,
  markAccountNotificationRead,
  markAllAccountNotificationsRead,
  subscribeToAccountNotifications,
} from "@/services/market/notifications";

const BG0 = "#05040B";
const BG1 = "#0A0620";
const CARD = "rgba(255,255,255,0.06)";
const BORDER = "rgba(255,255,255,0.10)";
const MUTED = "rgba(255,255,255,0.62)";
const PURPLE = "#7C3AED";

type FilterMode = "all" | "unread";

function timeLabel(ts: string) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  if (diff < 60 * 1000) return "now";
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)}h`;
  if (diff < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / 86400000)}d`;
  return d.toLocaleDateString();
}

function toneForKind(kind: string) {
  const normalized = String(kind || "").toLowerCase();
  if (normalized.includes("dm")) return { icon: "chatbubble-ellipses-outline" as const, color: "#38BDF8" };
  if (normalized.includes("order")) return { icon: "receipt-outline" as const, color: "#A78BFA" };
  if (normalized.includes("wallet") || normalized.includes("deposit") || normalized.includes("withdrawal")) {
    return { icon: "wallet-outline" as const, color: "#2DD4BF" };
  }
  if (normalized.includes("stock")) return { icon: "trending-up-outline" as const, color: "#F59E0B" };
  if (normalized.includes("review") || normalized.includes("comment")) return { icon: "star-outline" as const, color: "#F97316" };
  if (normalized.includes("follow") || normalized.includes("social")) return { icon: "people-outline" as const, color: "#60A5FA" };
  if (normalized.includes("verification")) return { icon: "shield-checkmark-outline" as const, color: "#34D399" };
  if (normalized.includes("session")) return { icon: "desktop-outline" as const, color: "#E879F9" };
  if (normalized.includes("dispute")) return { icon: "alert-circle-outline" as const, color: "#F87171" };
  return { icon: "notifications-outline" as const, color: "#C4B5FD" };
}

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        borderRadius: 999,
        paddingHorizontal: 14,
        paddingVertical: 10,
        backgroundColor: active ? "rgba(124,58,237,0.22)" : "rgba(255,255,255,0.06)",
        borderWidth: 1,
        borderColor: active ? "rgba(124,58,237,0.52)" : BORDER,
      }}
    >
      <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }}>{label}</Text>
    </Pressable>
  );
}

export default function MarketNotificationInbox() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<AccountNotification[]>([]);
  const [filterMode, setFilterMode] = useState<FilterMode>("all");

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
  const filteredRows = useMemo(
    () => (filterMode === "unread" ? rows.filter((row) => !row.read_at) : rows),
    [filterMode, rows],
  );

  async function openNotification(row: AccountNotification) {
    if (!row.read_at) {
      await markAccountNotificationRead(row.id).catch(() => undefined);
      setRows((current) =>
        current.map((item) => (item.id === row.id ? { ...item, read_at: new Date().toISOString() } : item)),
      );
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
      await markAllAccountNotificationsRead();
      await load();
    } catch (error: any) {
      setErr(String(error?.message || "Could not mark notifications as read."));
      setBusy(false);
    }
  }

  return (
    <LinearGradient colors={[BG1, BG0]} start={{ x: 0.15, y: 0 }} end={{ x: 0.9, y: 1 }} style={{ flex: 1 }}>
      <AppHeader title="Notifications" subtitle="Important activity across your account" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 28 }}>
        <View
          style={{
            marginTop: 12,
            borderRadius: 22,
            padding: 16,
            backgroundColor: CARD,
            borderWidth: 1,
            borderColor: BORDER,
          }}
        >
          <Text style={{ color: "rgba(255,255,255,0.56)", fontWeight: "800", fontSize: 11 }}>INBOX</Text>
          <Text style={{ marginTop: 6, color: "#fff", fontWeight: "900", fontSize: 22 }}>
            {unreadCount ? `${unreadCount} unread alerts` : "All caught up"}
          </Text>
          <Text style={{ marginTop: 6, color: MUTED, lineHeight: 20 }}>
            Messages, orders, payments, reviews, disputes, verification, stock activity, and session events show up
            here.
          </Text>

          <View style={{ marginTop: 14, flexDirection: "row", gap: 10 }}>
            <FilterChip label="All" active={filterMode === "all"} onPress={() => setFilterMode("all")} />
            <FilterChip label="Unread" active={filterMode === "unread"} onPress={() => setFilterMode("unread")} />
          </View>

          <View style={{ marginTop: 14, flexDirection: "row", gap: 10 }}>
            <Pressable
              onPress={() => {
                setLoading(true);
                setBusy(true);
                void load();
              }}
              style={{
                flex: 1,
                borderRadius: 16,
                paddingVertical: 13,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "rgba(255,255,255,0.08)",
                borderWidth: 1,
                borderColor: BORDER,
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "900" }}>{busy && loading ? "Refreshing..." : "Refresh"}</Text>
            </Pressable>
            <Pressable
              disabled={!unreadCount || busy}
              onPress={() => void markAllRead()}
              style={{
                flex: 1,
                borderRadius: 16,
                paddingVertical: 13,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: unreadCount ? "rgba(124,58,237,0.28)" : "rgba(124,58,237,0.14)",
                borderWidth: 1,
                borderColor: unreadCount ? "rgba(124,58,237,0.55)" : "rgba(124,58,237,0.24)",
                opacity: !unreadCount || busy ? 0.6 : 1,
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "900" }}>{busy && !loading ? "Saving..." : "Mark all read"}</Text>
            </Pressable>
          </View>
        </View>

        {loading ? (
          <View style={{ marginTop: 22, alignItems: "center" }}>
            <ActivityIndicator />
            <Text style={{ marginTop: 10, color: MUTED }}>Loading notifications...</Text>
          </View>
        ) : err ? (
          <View style={{ marginTop: 14, borderRadius: 20, padding: 14, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
            <Text style={{ color: "#fff", fontWeight: "900" }}>Could not load notifications</Text>
            <Text style={{ marginTop: 6, color: MUTED }}>{err}</Text>
          </View>
        ) : filteredRows.length === 0 ? (
          <View style={{ marginTop: 14, borderRadius: 20, padding: 14, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
            <Text style={{ color: "#fff", fontWeight: "900" }}>No notifications here</Text>
            <Text style={{ marginTop: 6, color: MUTED }}>
              {filterMode === "unread" ? "There are no unread alerts right now." : "No account alerts available."}
            </Text>
          </View>
        ) : (
          <View style={{ marginTop: 14, gap: 10 }}>
            {filteredRows.map((row) => {
              const tone = toneForKind(row.kind);
              return (
                <Pressable
                  key={row.id}
                  onPress={() => void openNotification(row)}
                  style={{
                    borderRadius: 20,
                    padding: 14,
                    backgroundColor: row.read_at ? CARD : "rgba(124,58,237,0.10)",
                    borderWidth: 1,
                    borderColor: row.read_at ? BORDER : "rgba(124,58,237,0.35)",
                    flexDirection: "row",
                    gap: 12,
                  }}
                >
                  <View
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 14,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: `${tone.color}22`,
                      borderWidth: 1,
                      borderColor: `${tone.color}55`,
                    }}
                  >
                    <Ionicons name={tone.icon} size={20} color={tone.color} />
                  </View>

                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                      <Text style={{ color: "#fff", fontWeight: "900", flex: 1 }}>{row.title}</Text>
                      <Text style={{ color: "rgba(255,255,255,0.48)", fontSize: 12 }}>{timeLabel(row.created_at)}</Text>
                    </View>
                    {row.body ? (
                      <Text style={{ marginTop: 6, color: MUTED, lineHeight: 19 }} numberOfLines={2}>
                        {row.body}
                      </Text>
                    ) : null}
                    <View style={{ marginTop: 8, flexDirection: "row", alignItems: "center", gap: 8 }}>
                      {!row.read_at ? <View style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: PURPLE }} /> : null}
                      <Text style={{ color: row.read_at ? "rgba(255,255,255,0.44)" : "#C4B5FD", fontWeight: "800", fontSize: 11 }}>
                        {row.read_at ? "Read" : "Unread"}
                      </Text>
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>
    </LinearGradient>
  );
}
