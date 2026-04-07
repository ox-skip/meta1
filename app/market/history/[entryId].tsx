import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";

import AppHeader from "@/components/common/AppHeader";
import { fetchMarketHistoryDetail, type MarketHistoryEntry } from "@/services/market/history";
import { formatCurrency } from "@/utils/pricing";

const BG0 = "#05040B";
const BG1 = "#0A0620";
const CARD = "rgba(255,255,255,0.06)";
const BORDER = "rgba(255,255,255,0.10)";
const PURPLE = "#7C3AED";

function kindLabel(kind: string) {
  return String(kind || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function signedAmount(entry: MarketHistoryEntry) {
  const k = String(entry.kind || "").toLowerCase();
  const amount = Number(entry.amount || 0);
  if (k === "stock_profit") return amount;
  if (["market_buy", "stock_buy", "withdrawal", "transfer_out", "fee"].includes(k)) {
    return -Math.abs(amount);
  }
  return Math.abs(amount);
}

function isEventEntry(entry: MarketHistoryEntry) {
  return String(entry.kind || "").toLowerCase() === "event" || String(entry.source_table || "").toLowerCase() === "account_notifications";
}

function statusTone(status: string) {
  const s = String(status || "").toUpperCase();
  if (["NEW", "UNREAD"].includes(s)) {
    return { bg: "rgba(124,58,237,0.20)", border: "rgba(167,139,250,0.42)", text: "#E9D5FF" };
  }
  if (["SUCCESS", "CONFIRMED", "RELEASED"].includes(s)) {
    return { bg: "rgba(16,185,129,0.20)", border: "rgba(16,185,129,0.42)", text: "#A7F3D0" };
  }
  if (["FAILED", "CANCELLED", "REFUNDED"].includes(s)) {
    return { bg: "rgba(239,68,68,0.20)", border: "rgba(239,68,68,0.42)", text: "#FECACA" };
  }
  return { bg: "rgba(255,255,255,0.08)", border: "rgba(255,255,255,0.16)", text: "#E5E7EB" };
}

function Row({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View style={{ marginTop: 8 }}>
      <Text style={{ color: "rgba(255,255,255,0.58)", fontWeight: "800", fontSize: 11 }}>{label}</Text>
      <Text selectable style={{ marginTop: 3, color: "#fff", fontWeight: "700", fontSize: 13 }}>
        {value || "-"}
      </Text>
    </View>
  );
}

export default function MarketHistoryDetailScreen() {
  const { entryId } = useLocalSearchParams<{ entryId: string }>();
  const id = String(entryId || "").trim();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [item, setItem] = useState<MarketHistoryEntry | null>(null);

  const load = useCallback(async () => {
    if (!id) {
      setError("Missing history id.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const row = await fetchMarketHistoryDetail(id);
      if (!row) throw new Error("Transaction record not found.");
      setItem(row);
    } catch (e: any) {
      setItem(null);
      setError(String(e?.message || "Unable to load transaction detail."));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const amount = item ? signedAmount(item) : 0;
  const positive = amount >= 0;
  const tone = statusTone(String(item?.status || ""));
  const eventEntry = item ? isEventEntry(item) : false;
  const detailBody = String((item?.details as any)?.body || "").trim();
  const detailRoute = String((item?.details as any)?.route || "").trim();
  const detailsText = useMemo(
    () => JSON.stringify(item?.details ?? {}, null, 2),
    [item?.details],
  );

  return (
    <LinearGradient colors={[BG1, BG0]} style={{ flex: 1, paddingHorizontal: 16, paddingTop: 14 }}>
      <AppHeader title="History Detail" subtitle="Full record, route, source, and metadata." />

      <ScrollView contentContainerStyle={{ paddingBottom: 26 }}>
        <View style={{ marginTop: 8, flexDirection: "row", gap: 10 }}>
          <Pressable
            onPress={() => router.push("/market/history" as any)}
            style={{
              flex: 1,
              borderRadius: 14,
              height: 42,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderColor: BORDER,
              backgroundColor: "rgba(255,255,255,0.06)",
              flexDirection: "row",
              gap: 8,
            }}
          >
            <Ionicons name="list-outline" size={16} color="#fff" />
            <Text style={{ color: "#fff", fontWeight: "900" }}>All history</Text>
          </Pressable>
          <Pressable
            onPress={load}
            style={{
              width: 42,
              height: 42,
              borderRadius: 14,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderColor: BORDER,
              backgroundColor: "rgba(255,255,255,0.06)",
            }}
          >
            <Ionicons name="refresh" size={16} color="#fff" />
          </Pressable>
        </View>

        {loading ? (
          <View style={{ marginTop: 28, alignItems: "center" }}>
            <ActivityIndicator />
            <Text style={{ marginTop: 8, color: "rgba(255,255,255,0.72)" }}>Loading transaction...</Text>
          </View>
        ) : null}

        {!!error ? (
          <View style={{ marginTop: 14, borderRadius: 14, padding: 12, backgroundColor: "rgba(239,68,68,0.18)", borderWidth: 1, borderColor: "rgba(239,68,68,0.35)" }}>
            <Text style={{ color: "#FECACA", fontWeight: "800" }}>{error}</Text>
          </View>
        ) : null}

        {!loading && item ? (
          <>
            <View style={{ marginTop: 12, borderRadius: 18, padding: 14, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                <Text style={{ color: "#fff", fontWeight: "900", fontSize: 16, flex: 1 }}>{item.title}</Text>
                <View style={{ borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: tone.border, backgroundColor: tone.bg }}>
                  <Text style={{ color: tone.text, fontWeight: "900", fontSize: 10 }}>{item.status}</Text>
                </View>
              </View>
              {eventEntry ? (
                <Text style={{ marginTop: 8, color: "#DDD6FE", fontWeight: "900", fontSize: 19 }}>Account event</Text>
              ) : (
                <Text style={{ marginTop: 8, color: positive ? "#86EFAC" : "#FCA5A5", fontWeight: "900", fontSize: 19 }}>
                  {positive ? "+" : "-"}
                  {formatCurrency(item.currency, Math.abs(amount), item.currency === "USDC" ? 6 : 2)}
                </Text>
              )}
              <Text style={{ marginTop: 4, color: "rgba(255,255,255,0.65)", fontSize: 12 }}>
                {kindLabel(item.kind)} - {new Date(item.occurred_at).toLocaleString()}
              </Text>
              {detailBody ? (
                <Text style={{ marginTop: 8, color: "rgba(255,255,255,0.74)", fontSize: 12, lineHeight: 18 }}>
                  {detailBody}
                </Text>
              ) : null}
            </View>

            <View style={{ marginTop: 10, borderRadius: 18, padding: 14, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
              <Row label="History ID" value={item.id} />
              <Row label="Source Table" value={item.source_table} />
              <Row label="Source ID" value={item.source_id} />
              <Row label="Currency" value={item.currency} />
              <Row label="Occurred At" value={new Date(item.occurred_at).toISOString()} />
              <Row label="Created At" value={new Date(item.created_at).toISOString()} />
              <Row label="Order ID" value={item.order_id || "-"} />
              <Row label="Stock ID" value={item.stock_id || "-"} />
              <Row label="Transaction Hash" value={item.tx_hash || "-"} />
              <Row label="Route" value={detailRoute || "-"} />

              {!!item.tx_hash ? (
                <Pressable
                  onPress={async () => {
                    try {
                      await Clipboard.setStringAsync(item.tx_hash || "");
                      Alert.alert("Copied", "Transaction hash copied.");
                    } catch {
                      Alert.alert("Copy failed", "Unable to copy transaction hash.");
                    }
                  }}
                  style={{
                    marginTop: 10,
                    borderRadius: 12,
                    height: 38,
                    alignItems: "center",
                    justifyContent: "center",
                    borderWidth: 1,
                    borderColor: "rgba(45,212,191,0.45)",
                    backgroundColor: "rgba(45,212,191,0.18)",
                  }}
                >
                  <Text style={{ color: "#ECFEFF", fontWeight: "900" }}>Copy tx hash</Text>
                </Pressable>
              ) : null}

              {!!detailRoute ? (
                <Pressable
                  onPress={() => router.push(detailRoute as any)}
                  style={{
                    marginTop: 10,
                    borderRadius: 12,
                    height: 40,
                    alignItems: "center",
                    justifyContent: "center",
                    borderWidth: 1,
                    borderColor: "rgba(45,212,191,0.45)",
                    backgroundColor: "rgba(45,212,191,0.18)",
                  }}
                >
                  <Text style={{ color: "#ECFEFF", fontWeight: "900" }}>Open related screen</Text>
                </Pressable>
              ) : null}

              {!!item.order_id ? (
                <Pressable
                  onPress={() => router.push(`/market/order/${item.order_id}` as any)}
                  style={{
                    marginTop: 10,
                    borderRadius: 12,
                    height: 40,
                    alignItems: "center",
                    justifyContent: "center",
                    borderWidth: 1,
                    borderColor: "rgba(124,58,237,0.55)",
                    backgroundColor: "rgba(124,58,237,0.20)",
                  }}
                >
                  <Text style={{ color: "#fff", fontWeight: "900" }}>Open related order</Text>
                </Pressable>
              ) : null}
            </View>

            <View style={{ marginTop: 10, borderRadius: 18, padding: 14, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
              <Text style={{ color: "#fff", fontWeight: "900", fontSize: 14 }}>Details</Text>
              <Text selectable style={{ marginTop: 8, color: "rgba(255,255,255,0.78)", fontSize: 12, lineHeight: 18 }}>
                {detailsText}
              </Text>
            </View>

            <Pressable
              onPress={() => router.push("/market/history" as any)}
              style={{
                marginTop: 12,
                borderRadius: 14,
                height: 44,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderColor: PURPLE,
                backgroundColor: "rgba(124,58,237,0.28)",
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "900" }}>Back to transaction history</Text>
            </Pressable>
          </>
        ) : null}
      </ScrollView>
    </LinearGradient>
  );
}
