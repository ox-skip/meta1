import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";

import AppHeader from "@/components/common/AppHeader";
import {
  fetchAccountNotificationById,
  markAccountNotificationRead,
  type AccountNotification,
} from "@/services/market/notifications";

const BG0 = "#05040B";
const BG1 = "#0A0620";
const CARD = "rgba(255,255,255,0.06)";
const BORDER = "rgba(255,255,255,0.10)";
const MUTED = "rgba(255,255,255,0.62)";
const PURPLE = "#7C3AED";

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

function formatTime(ts: string) {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

export default function MarketNotificationDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [row, setRow] = useState<AccountNotification | null>(null);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        setErr(null);
        const notification = await fetchAccountNotificationById(String(id || ""));
        if (!mounted) return;
        setRow(notification);
        if (notification && !notification.read_at) {
          await markAccountNotificationRead(notification.id).catch(() => undefined);
          if (!mounted) return;
          setRow({ ...notification, read_at: new Date().toISOString() });
        }
      } catch (error: any) {
        if (!mounted) return;
        setErr(String(error?.message || "Could not load notification."));
        setRow(null);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [id]);

  const tone = useMemo(() => toneForKind(row?.kind || ""), [row?.kind]);

  return (
    <LinearGradient colors={[BG1, BG0]} start={{ x: 0.15, y: 0 }} end={{ x: 0.9, y: 1 }} style={{ flex: 1 }}>
      <AppHeader title="Notification" subtitle="Notification details" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 28 }}>
        {loading ? (
          <View style={{ marginTop: 24, alignItems: "center" }}>
            <ActivityIndicator />
            <Text style={{ marginTop: 10, color: MUTED }}>Loading notification...</Text>
          </View>
        ) : err ? (
          <View style={{ marginTop: 14, borderRadius: 20, padding: 14, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
            <Text style={{ color: "#fff", fontWeight: "900" }}>Could not load notification</Text>
            <Text style={{ marginTop: 6, color: MUTED }}>{err}</Text>
          </View>
        ) : !row ? (
          <View style={{ marginTop: 14, borderRadius: 20, padding: 14, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
            <Text style={{ color: "#fff", fontWeight: "900" }}>Notification not found</Text>
            <Text style={{ marginTop: 6, color: MUTED }}>This notification may have been removed.</Text>
          </View>
        ) : (
          <>
            <View
              style={{
                marginTop: 14,
                borderRadius: 24,
                padding: 18,
                backgroundColor: CARD,
                borderWidth: 1,
                borderColor: BORDER,
              }}
            >
              <View
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 18,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: `${tone.color}22`,
                  borderWidth: 1,
                  borderColor: `${tone.color}55`,
                }}
              >
                <Ionicons name={tone.icon} size={24} color={tone.color} />
              </View>

              <Text style={{ marginTop: 16, color: "#fff", fontWeight: "900", fontSize: 24 }}>{row.title}</Text>
              <Text style={{ marginTop: 8, color: MUTED, lineHeight: 21 }}>
                {row.body || "No extra details were attached to this notification."}
              </Text>

              <View style={{ marginTop: 16, gap: 8 }}>
                <Text style={{ color: "rgba(255,255,255,0.46)", fontSize: 12 }}>Created</Text>
                <Text style={{ color: "#fff", fontWeight: "800" }}>{formatTime(row.created_at)}</Text>
              </View>

              <View style={{ marginTop: 16, gap: 8 }}>
                <Text style={{ color: "rgba(255,255,255,0.46)", fontSize: 12 }}>Status</Text>
                <Text style={{ color: row.read_at ? "rgba(255,255,255,0.72)" : "#C4B5FD", fontWeight: "800" }}>
                  {row.read_at ? "Read" : "Unread"}
                </Text>
              </View>

              {row.route ? (
                <Pressable
                  onPress={() => router.push(row.route as any)}
                  style={{
                    marginTop: 18,
                    borderRadius: 16,
                    paddingVertical: 14,
                    alignItems: "center",
                    backgroundColor: "rgba(124,58,237,0.28)",
                    borderWidth: 1,
                    borderColor: "rgba(124,58,237,0.55)",
                  }}
                >
                  <Text style={{ color: "#fff", fontWeight: "900" }}>Open source</Text>
                </Pressable>
              ) : null}

              <Pressable
                onPress={() => router.back()}
                style={{
                  marginTop: 10,
                  borderRadius: 16,
                  paddingVertical: 14,
                  alignItems: "center",
                  backgroundColor: "rgba(255,255,255,0.08)",
                  borderWidth: 1,
                  borderColor: BORDER,
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "900" }}>Back</Text>
              </Pressable>
            </View>

            <View
              style={{
                marginTop: 12,
                borderRadius: 20,
                padding: 14,
                backgroundColor: CARD,
                borderWidth: 1,
                borderColor: BORDER,
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "900", fontSize: 13 }}>Type</Text>
              <Text style={{ marginTop: 6, color: MUTED }}>{row.kind}</Text>
              {row.entity_type ? (
                <>
                  <Text style={{ marginTop: 12, color: "#fff", fontWeight: "900", fontSize: 13 }}>Entity</Text>
                  <Text style={{ marginTop: 6, color: MUTED }}>
                    {row.entity_type}
                    {row.entity_id ? ` • ${row.entity_id}` : ""}
                  </Text>
                </>
              ) : null}
            </View>
          </>
        )}
      </ScrollView>
    </LinearGradient>
  );
}
