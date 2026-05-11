import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import AppHeader from "@/components/common/AppHeader";
import { fetchMarketHistoryDetail, type MarketHistoryEntry } from "@/services/market/history";
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

type IconName = React.ComponentProps<typeof Ionicons>["name"];

function kindLabel(kind: string) {
  return String(kind || "activity")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function isEventEntry(entry: MarketHistoryEntry) {
  return String(entry.kind || "").toLowerCase() === "event" || String(entry.source_table || "").toLowerCase() === "account_notifications";
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

function groupMeta(entry: MarketHistoryEntry): { label: string; icon: IconName; accent: string } {
  const kind = String(entry.kind || "").toLowerCase();
  const source = String(entry.source_table || "").toLowerCase();
  if (kind === "event" || source === "account_notifications") return { label: "Event", icon: "notifications-outline", accent: ROSE };
  if (kind.includes("stock") || source.includes("stock")) return { label: "Stock", icon: "trending-up-outline", accent: "#C084FC" };
  if (kind.includes("crypto") || source.includes("chain") || source.includes("crypto")) return { label: "Crypto", icon: "shield-checkmark-outline", accent: BLUE };
  if (kind.includes("market_") || source === "market_orders") return { label: "Order", icon: "receipt-outline", accent: AMBER };
  return { label: "Wallet", icon: "wallet-outline", accent: LIME };
}

function asDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unavailable";
  return date.toLocaleString();
}

function shortValue(value?: string | null) {
  const raw = String(value || "");
  if (!raw) return "";
  if (raw.length <= 22) return raw;
  return `${raw.slice(0, 10)}...${raw.slice(-8)}`;
}

function detailBody(entry: MarketHistoryEntry | null) {
  const details = (entry?.details ?? {}) as Record<string, any>;
  return String(details.body || "").trim();
}

async function copyValue(label: string, value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return;
  try {
    await Clipboard.setStringAsync(raw);
    Alert.alert("Copied", `${label} copied.`);
  } catch {
    Alert.alert("Copy failed", `Unable to copy ${label.toLowerCase()}.`);
  }
}

function Field({ label, value, copyable }: { label: string; value?: string | null; copyable?: boolean }) {
  const display = String(value || "").trim() || "-";
  return (
    <View
      style={{
        borderRadius: 17,
        padding: 12,
        backgroundColor: "rgba(255,253,247,0.055)",
        borderWidth: 1,
        borderColor: BORDER,
      }}
    >
      <Text style={{ color: FAINT, fontWeight: "900", fontSize: 11 }}>{label}</Text>
      <View style={{ marginTop: 5, flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text selectable numberOfLines={copyable ? 1 : 2} style={{ flex: 1, color: TEXT, fontWeight: "800", fontSize: 13 }}>
          {copyable ? shortValue(display) || "-" : display}
        </Text>
        {copyable && display !== "-" ? (
          <Pressable onPress={() => copyValue(label, value)} style={{ padding: 5 }}>
            <Ionicons name="copy-outline" size={16} color={TEAL} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function ActionButton({
  label,
  icon,
  accent,
  onPress,
}: {
  label: string;
  icon: IconName;
  accent: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minWidth: 148,
        height: 46,
        borderRadius: 17,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 8,
        backgroundColor: `${accent}19`,
        borderWidth: 1,
        borderColor: `${accent}48`,
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}
    >
      <Ionicons name={icon} size={17} color={accent} />
      <Text style={{ color: TEXT, fontWeight: "900" }}>{label}</Text>
    </Pressable>
  );
}

export default function MarketHistoryDetailScreen() {
  const { entryId } = useLocalSearchParams<{ entryId: string }>();
  const insets = useSafeAreaInsets();
  const id = String(entryId || "").trim();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [item, setItem] = useState<MarketHistoryEntry | null>(null);

  const load = useCallback(async () => {
    if (!id) {
      setError("Missing activity record.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const row = await fetchMarketHistoryDetail(id);
      if (!row) throw new Error("Activity record not found.");
      setItem(row);
    } catch (e: any) {
      setItem(null);
      setError(String(e?.message || "Unable to load activity record."));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const signed = item ? signAmount(item) : 0;
  const positive = signed >= 0;
  const event = item ? isEventEntry(item) : false;
  const tone = statusTone(String(item?.status || ""));
  const meta = item ? groupMeta(item) : { label: "Activity", icon: "list-outline" as IconName, accent: TEAL };
  const details = (item?.details ?? {}) as Record<string, any>;
  const route = String(details.route || "").trim();
  const detailsText = useMemo(() => JSON.stringify(item?.details ?? {}, null, 2), [item?.details]);

  return (
    <LinearGradient colors={[BG2, BG1, BG0]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: Math.max(insets.top, 12),
          paddingBottom: Math.max(insets.bottom + 30, 46),
          alignSelf: "center",
          width: "100%",
          maxWidth: 860,
        }}
      >
        <AppHeader title="Activity detail" subtitle="Record, references, and related actions" bordered={false} style={{ paddingHorizontal: 0, backgroundColor: "transparent" }} />

        <View style={{ marginTop: 8, flexDirection: "row", gap: 10 }}>
          <ActionButton label="All history" icon="list-outline" accent={TEAL} onPress={() => router.push("/market/history" as any)} />
          <Pressable
            onPress={() => void load()}
            style={({ pressed }) => ({
              width: 46,
              height: 46,
              borderRadius: 17,
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

        {loading ? (
          <View style={{ marginTop: 30, alignItems: "center" }}>
            <ActivityIndicator color={TEAL} />
            <Text style={{ marginTop: 10, color: MUTED, fontWeight: "800" }}>Loading record</Text>
          </View>
        ) : null}

        {error ? (
          <View
            style={{
              marginTop: 14,
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

        {!loading && item ? (
          <>
            <View
              style={{
                marginTop: 12,
                borderRadius: 28,
                overflow: "hidden",
                borderWidth: 1,
                borderColor: BORDER_TOP,
                backgroundColor: "rgba(9,13,11,0.72)",
              }}
            >
              <LinearGradient
                colors={[`${meta.accent}1F`, "rgba(255,253,247,0.06)", "rgba(9,13,11,0.84)"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ padding: 16 }}
              >
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 13 }}>
                  <View
                    style={{
                      width: 54,
                      height: 54,
                      borderRadius: 22,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: `${meta.accent}18`,
                      borderWidth: 1,
                      borderColor: `${meta.accent}48`,
                    }}
                  >
                    <Ionicons name={meta.icon} size={24} color={meta.accent} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <Text style={{ color: meta.accent, fontWeight: "900", fontSize: 12 }}>{meta.label}</Text>
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
                        <Text style={{ color: tone.text, fontWeight: "900", fontSize: 10 }}>{item.status}</Text>
                      </View>
                    </View>
                    <Text style={{ marginTop: 8, color: TEXT, fontWeight: "900", fontSize: 20, lineHeight: 25 }}>
                      {item.title}
                    </Text>
                    <Text style={{ marginTop: 5, color: MUTED, fontWeight: "800" }}>
                      {kindLabel(item.kind)} - {asDate(item.occurred_at)}
                    </Text>
                  </View>
                </View>

                <View
                  style={{
                    marginTop: 16,
                    borderRadius: 22,
                    padding: 14,
                    backgroundColor: "rgba(7,16,13,0.46)",
                    borderWidth: 1,
                    borderColor: BORDER,
                  }}
                >
                  <Text style={{ color: FAINT, fontWeight: "900", fontSize: 11 }}>{event ? "Record type" : "Amount"}</Text>
                  {event ? (
                    <Text style={{ marginTop: 5, color: TEXT, fontWeight: "900", fontSize: 22 }}>Account event</Text>
                  ) : (
                    <Text style={{ marginTop: 5, color: positive ? TEAL : ROSE, fontWeight: "900", fontSize: 24 }}>
                      {positive ? "+" : "-"}
                      {formatCurrency(item.currency, Math.abs(signed), item.currency === "USDC" || item.currency === "USDT" ? 6 : 2)}
                    </Text>
                  )}
                  {detailBody(item) ? (
                    <Text style={{ marginTop: 9, color: MUTED, lineHeight: 20 }}>{detailBody(item)}</Text>
                  ) : null}
                </View>
              </LinearGradient>
            </View>

            <View style={{ marginTop: 12, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              {route ? (
                <ActionButton label="Open related screen" icon="open-outline" accent={TEAL} onPress={() => router.push(route as any)} />
              ) : null}
              {item.order_id ? (
                <ActionButton
                  label="Open order"
                  icon="receipt-outline"
                  accent={AMBER}
                  onPress={() => router.push(`/market/order/${item.order_id}` as any)}
                />
              ) : null}
              {item.tx_hash ? (
                <ActionButton label="Copy hash" icon="copy-outline" accent={BLUE} onPress={() => copyValue("Transaction hash", item.tx_hash)} />
              ) : null}
            </View>

            <View
              style={{
                marginTop: 12,
                borderRadius: 24,
                padding: 14,
                backgroundColor: PANEL,
                borderWidth: 1,
                borderColor: BORDER,
                gap: 10,
              }}
            >
              <Text style={{ color: TEXT, fontWeight: "900", fontSize: 16 }}>References</Text>
              <Field label="Record ID" value={item.id} copyable />
              <Field label="Source" value={item.source_table.replace(/_/g, " ")} />
              <Field label="Source ID" value={item.source_id} copyable />
              <Field label="Currency" value={item.currency} />
              <Field label="Occurred" value={asDate(item.occurred_at)} />
              <Field label="Created" value={asDate(item.created_at)} />
              <Field label="Order ID" value={item.order_id || "-"} copyable={!!item.order_id} />
              <Field label="Stock ID" value={item.stock_id || "-"} copyable={!!item.stock_id} />
              <Field label="Transaction hash" value={item.tx_hash || "-"} copyable={!!item.tx_hash} />
              <Field label="Route" value={route || "-"} copyable={!!route} />
            </View>

            <View
              style={{
                marginTop: 12,
                borderRadius: 24,
                padding: 14,
                backgroundColor: PANEL,
                borderWidth: 1,
                borderColor: BORDER,
              }}
            >
              <Text style={{ color: TEXT, fontWeight: "900", fontSize: 16 }}>Metadata</Text>
              <Text selectable style={{ marginTop: 10, color: MUTED, fontSize: 12, lineHeight: 19 }}>
                {detailsText}
              </Text>
            </View>

            <Pressable
              onPress={() => copyValue("Record metadata", detailsText)}
              style={({ pressed }) => ({
                marginTop: 12,
                height: 46,
                borderRadius: 17,
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "row",
                gap: 8,
                backgroundColor: TEAL,
                transform: [{ scale: pressed ? 0.99 : 1 }],
              })}
            >
              <Ionicons name="copy-outline" size={17} color={INK} />
              <Text style={{ color: INK, fontWeight: "900" }}>Copy metadata</Text>
            </Pressable>
          </>
        ) : null}
      </ScrollView>
    </LinearGradient>
  );
}
