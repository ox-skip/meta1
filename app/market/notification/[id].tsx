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

type Tone = {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  label: string;
};

function toneForKind(kind: string): Tone {
  const normalized = String(kind || "").toLowerCase();
  if (normalized.includes("support")) return { icon: "chatbubbles-outline", color: TEAL, label: "Support" };
  if (normalized.includes("dm")) return { icon: "chatbubble-ellipses-outline", color: BLUE, label: "Message" };
  if (normalized.includes("order") || normalized.includes("delivery")) return { icon: "receipt-outline", color: VIOLET, label: "Order" };
  if (normalized.includes("wallet") || normalized.includes("deposit") || normalized.includes("withdrawal") || normalized.includes("payment")) {
    return { icon: "wallet-outline", color: TEAL, label: "Money" };
  }
  if (normalized.includes("stock") || normalized.includes("trade")) return { icon: "trending-up-outline", color: AMBER, label: "Stock" };
  if (normalized.includes("review") || normalized.includes("comment")) return { icon: "star-outline", color: "#FB923C", label: "Social" };
  if (normalized.includes("follow") || normalized.includes("social")) return { icon: "people-outline", color: BLUE, label: "Social" };
  if (normalized.includes("verification")) return { icon: "shield-checkmark-outline", color: LIME, label: "Trust" };
  if (normalized.includes("session") || normalized.includes("auth")) return { icon: "lock-closed-outline", color: VIOLET, label: "Security" };
  if (normalized.includes("dispute") || normalized.includes("failed") || normalized.includes("refund")) {
    return { icon: "alert-circle-outline", color: ROSE, label: "Issue" };
  }
  return { icon: "notifications-outline", color: AMBER, label: "Alert" };
}

function formatTime(ts?: string | null) {
  if (!ts) return "n/a";
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "n/a";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function cleanLabel(value?: string | null) {
  return String(value || "n/a")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function DetailLine({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <View style={{ flex: 1, minWidth: 150 }}>
      <Text style={{ color: FAINT, fontSize: 10, fontWeight: "900", textTransform: "uppercase" }}>{label}</Text>
      <Text selectable style={{ marginTop: 5, color: TEXT, fontSize: 13, fontWeight: "800", lineHeight: 19 }}>
        {value}
      </Text>
    </View>
  );
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
          const readAt = new Date().toISOString();
          await markAccountNotificationRead(notification.id).catch(() => undefined);
          if (!mounted) return;
          setRow({ ...notification, read_at: readAt });
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
  const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : null;
  const metadataRows = metadata
    ? Object.entries(metadata)
        .filter(([, value]) => value !== null && value !== undefined && typeof value !== "object")
        .slice(0, 6)
    : [];

  return (
    <LinearGradient colors={[BG1, BG0]} start={{ x: 0.12, y: 0 }} end={{ x: 0.9, y: 1 }} style={{ flex: 1 }}>
      <AppHeader title="Notification" subtitle="Activity detail" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 34 }}>
        <View style={{ width: "100%", maxWidth: 860, alignSelf: "center" }}>
          {loading ? (
            <View style={{ marginTop: 28, alignItems: "center", paddingVertical: 34 }}>
              <ActivityIndicator color={TEAL} />
            </View>
          ) : err ? (
            <View style={{ marginTop: 14, borderRadius: 8, padding: 14, backgroundColor: "rgba(251,113,133,0.12)", borderWidth: 1, borderColor: "rgba(251,113,133,0.35)" }}>
              <Text style={{ color: "#FDA4AF", fontWeight: "900" }}>Could not load notification</Text>
              <Text style={{ marginTop: 6, color: MUTED }}>{err}</Text>
            </View>
          ) : !row ? (
            <View style={{ marginTop: 14, borderRadius: 8, padding: 14, backgroundColor: PANEL, borderWidth: 1, borderColor: BORDER }}>
              <Text style={{ color: TEXT, fontWeight: "900" }}>Notification not found</Text>
            </View>
          ) : (
            <>
              <View
                style={{
                  marginTop: 14,
                  borderRadius: 8,
                  padding: 16,
                  backgroundColor: PANEL_STRONG,
                  borderWidth: 1,
                  borderColor: BORDER,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 14 }}>
                  <View
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: 8,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: `${tone.color}18`,
                      borderWidth: 1,
                      borderColor: `${tone.color}42`,
                    }}
                  >
                    <Ionicons name={tone.icon} size={25} color={tone.color} />
                  </View>

                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
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
                      <Text style={{ color: row.read_at ? FAINT : TEAL, fontSize: 11, fontWeight: "900" }}>
                        {row.read_at ? "Read" : "Unread"}
                      </Text>
                    </View>
                    <Text style={{ marginTop: 10, color: TEXT, fontWeight: "900", fontSize: 24, lineHeight: 30 }}>
                      {row.title}
                    </Text>
                    {row.body ? (
                      <Text style={{ marginTop: 9, color: MUTED, fontSize: 14, lineHeight: 21 }}>{row.body}</Text>
                    ) : null}
                  </View>
                </View>

                <View style={{ marginTop: 18, flexDirection: "row", flexWrap: "wrap", gap: 14 }}>
                  <DetailLine label="Created" value={formatTime(row.created_at)} />
                  <DetailLine label="Updated" value={formatTime(row.updated_at)} />
                  <DetailLine label="Type" value={cleanLabel(row.kind)} />
                  {row.entity_type ? <DetailLine label="Entity" value={cleanLabel(row.entity_type)} /> : null}
                  {row.entity_id ? <DetailLine label="Reference" value={row.entity_id} /> : null}
                </View>

                <View style={{ marginTop: 18, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                  {row.route ? (
                    <Pressable
                      onPress={() => router.push(row.route as any)}
                      style={{
                        minHeight: 44,
                        borderRadius: 8,
                        paddingHorizontal: 14,
                        alignItems: "center",
                        justifyContent: "center",
                        flexDirection: "row",
                        gap: 8,
                        backgroundColor: "rgba(45,212,191,0.15)",
                        borderWidth: 1,
                        borderColor: "rgba(45,212,191,0.42)",
                      }}
                    >
                      <Ionicons name="open-outline" size={17} color={TEAL} />
                      <Text style={{ color: TEAL, fontWeight: "900" }}>Open</Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    onPress={() => router.back()}
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
                    }}
                  >
                    <Ionicons name="chevron-back" size={17} color={TEXT} />
                    <Text style={{ color: TEXT, fontWeight: "900" }}>Back</Text>
                  </Pressable>
                </View>
              </View>

              {metadataRows.length ? (
                <View
                  style={{
                    marginTop: 12,
                    borderRadius: 8,
                    padding: 14,
                    backgroundColor: PANEL,
                    borderWidth: 1,
                    borderColor: BORDER,
                  }}
                >
                  <Text style={{ color: TEXT, fontWeight: "900", fontSize: 15 }}>Details</Text>
                  <View style={{ marginTop: 12, gap: 10 }}>
                    {metadataRows.map(([key, value]) => (
                      <View key={key} style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
                        <Text style={{ width: 120, color: FAINT, fontSize: 11, fontWeight: "900", textTransform: "uppercase" }}>
                          {cleanLabel(key)}
                        </Text>
                        <Text selectable style={{ flex: 1, color: MUTED, fontSize: 12, lineHeight: 18 }}>
                          {String(value)}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}
            </>
          )}
        </View>
      </ScrollView>
    </LinearGradient>
  );
}
