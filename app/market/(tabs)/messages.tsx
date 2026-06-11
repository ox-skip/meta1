import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from "react-native";

import AppHeader from "@/components/common/AppHeader";
import { InboxThread, listInboxThreads } from "@/services/dm/dmService";
import { supabase } from "@/services/supabase";

const BG0 = "#060807";
const BG1 = "#10130E";
const BG2 = "#171A13";
const BRAND = "#2DD4BF";
const CARD = "rgba(255,253,247,0.065)";
const BORDER = "rgba(255,253,247,0.12)";
const MUTED = "rgba(255,253,247,0.68)";
const BUCKET_SELLERS = "market-sellers";

function timeLabel(ts: string | null) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60 * 1000) return "now";
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)}h`;
  return d.toLocaleDateString();
}

export default function MessagesTab() {
  const [loading, setLoading] = useState(true);
  const [threads, setThreads] = useState<InboxThread[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const supabaseUrl =
    (supabase as any)?.supabaseUrl ?? (process.env.EXPO_PUBLIC_SUPABASE_URL as string) ?? "";

  const load = useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {
      const rows = await listInboxThreads();
      setThreads(rows);
    } catch (e: any) {
      setErr(e?.message || "Failed to load inbox");
      setThreads([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const ch = supabase
      .channel("dm-inbox")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "dm_messages" }, () => {
        load();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [load]);

  const rows = useMemo(() => threads, [threads]);

  return (
    <LinearGradient colors={[BG2, BG1, BG0]} start={{ x: 0.15, y: 0 }} end={{ x: 0.9, y: 1 }} style={{ flex: 1, paddingHorizontal: 16, paddingTop: 14 }}>
      <AppHeader title="Messages" subtitle="Direct messages from buyers and sellers" />
      <ScrollView contentContainerStyle={{ paddingBottom: 28 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ color: "#fff", fontSize: 22, fontWeight: "900" }}>Inbox</Text>
          <Pressable
            onPress={load}
            style={{
              borderRadius: 14,
              paddingHorizontal: 12,
              paddingVertical: 8,
              backgroundColor: CARD,
              borderWidth: 1,
              borderColor: BORDER,
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Ionicons name="refresh-outline" size={16} color="#fff" />
            <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }}>Refresh</Text>
          </Pressable>
        </View>

        {loading ? (
          <View style={{ marginTop: 20, alignItems: "center" }}>
            <ActivityIndicator />
            <Text style={{ marginTop: 8, color: MUTED }}>Loading messagesâ€¦</Text>
          </View>
        ) : err ? (
          <View style={{ marginTop: 14, borderRadius: 22, padding: 16, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
            <Text style={{ color: "#fff", fontWeight: "900" }}>Could not load inbox</Text>
            <Text style={{ marginTop: 6, color: MUTED }}>{err}</Text>
            <Pressable
              onPress={load}
              style={{
                marginTop: 12,
                borderRadius: 18,
                paddingVertical: 12,
                alignItems: "center",
                backgroundColor: BRAND,
                borderWidth: 1,
                borderColor: BRAND,
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "900" }}>Retry</Text>
            </Pressable>
          </View>
        ) : rows.length === 0 ? (
          <View style={{ marginTop: 14, borderRadius: 22, padding: 16, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
            <Text style={{ color: "#fff", fontWeight: "900" }}>No messages yet</Text>
            <Text style={{ marginTop: 6, color: MUTED }}>Start a conversation from a listing or storefront.</Text>
            <Pressable
              onPress={() => router.push("/market/(tabs)" as any)}
              style={{
                marginTop: 12,
                borderRadius: 18,
                paddingVertical: 12,
                alignItems: "center",
                backgroundColor: BRAND,
                borderWidth: 1,
                borderColor: BRAND,
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "900" }}>Browse Market</Text>
            </Pressable>
          </View>
        ) : (
          <View style={{ marginTop: 12, gap: 10 }}>
            {rows.map((t) => {
              const other = t.other;
              const seller = other.seller_profile;
              const title = seller?.active
                ? seller.business_name || seller.market_username || "Business"
                : other.full_name || other.username || "User";
              const subtitle = seller?.active
                ? `@${seller.market_username ?? other.username ?? "seller"}`
                : `@${other.username ?? "user"}`;
              const preview = t.last_message_preview || "Sent an attachment";
              const routeUsername = seller?.market_username ?? other.username ?? null;
              const logoUrl = seller?.logo_path
                ? `${supabaseUrl}/storage/v1/object/public/${BUCKET_SELLERS}/${seller.logo_path}`
                : null;

              return (
                <Pressable
                  key={t.id}
                  onPress={() => {
                    if (routeUsername) {
                      router.push({
                        pathname: "/market/dm/[username]" as any,
                        params: { username: routeUsername },
                      });
                    }
                  }}
                  disabled={!routeUsername}
                  style={{
                    borderRadius: 20,
                    padding: 14,
                    backgroundColor: CARD,
                    borderWidth: 1,
                    borderColor: BORDER,
                    flexDirection: "row",
                    gap: 12,
                    alignItems: "center",
                    opacity: routeUsername ? 1 : 0.7,
                  }}
                >
                  <View
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: 16,
                      backgroundColor: "rgba(255,255,255,0.06)",
                      borderWidth: 1,
                      borderColor: "rgba(255,255,255,0.12)",
                      alignItems: "center",
                      justifyContent: "center",
                      overflow: "hidden",
                    }}
                  >
                    {logoUrl ? (
                      <Image source={{ uri: logoUrl }} style={{ width: 52, height: 52 }} />
                    ) : (
                      <Ionicons name="person-outline" size={22} color="rgba(255,255,255,0.65)" />
                    )}
                  </View>

                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                      <Text style={{ color: "#fff", fontWeight: "900" }}>{title}</Text>
                      <Text style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>{timeLabel(t.last_message_at)}</Text>
                    </View>
                    <Text style={{ marginTop: 4, color: "rgba(255,255,255,0.6)", fontSize: 12 }}>{subtitle}</Text>
                    <Text numberOfLines={1} style={{ marginTop: 6, color: MUTED, fontSize: 12 }}>
                      {preview}
                    </Text>
                  </View>

                  {t.unread ? (
                    <View style={{ width: 10, height: 10, borderRadius: 10, backgroundColor: BRAND }} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>
    </LinearGradient>
  );
}
