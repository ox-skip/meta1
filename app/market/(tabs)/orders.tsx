// app/market/(tabs)/order.tsx
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import AppHeader from "@/components/common/AppHeader";
import { InAppTutorial } from "@/components/onboarding/InAppTutorial";
import {
  fetchJsonWithTimeout,
  getSupabaseAnonKeyOrThrow,
  getSupabaseFunctionsBaseUrl,
  getSupabaseJwtOrThrow,
} from "@/services/net";
import { tutorialFlows } from "@/services/onboarding/definitions";
import { supabase } from "@/services/supabase";
import { friendlyMarketError } from "@/utils/marketUx";

const BG0 = "#05040B";
const BG1 = "#0A0620";
const PURPLE = "#7C3AED";

const FN_MARKET_ORDERS_LIST = "market-orders-list"; // GET ONLY

type StatusFilter = "all" | "pending" | "completed" | "cancelled" | "disputed";
type PendingStageFilter =
  | "all"
  | "created"
  | "in_escrow"
  | "out_for_delivery"
  | "deliverable_uploaded"
  | "delivered";

const STATUS_LABELS: Record<string, string> = {
  CREATED: "Created",
  IN_ESCROW: "In Escrow",
  OUT_FOR_DELIVERY: "Out for Delivery",
  DELIVERABLE_UPLOADED: "Deliverable Uploaded",
  DELIVERED: "Delivered",
  RELEASED: "Released",
  DISPUTED: "Disputed",
  REFUNDED: "Refunded",
  CANCELLED: "Cancelled",
};

const STATUS_GROUPS: Record<Exclude<StatusFilter, "all">, string[]> = {
  pending: ["CREATED", "IN_ESCROW", "OUT_FOR_DELIVERY", "DELIVERABLE_UPLOADED", "DELIVERED"],
  completed: ["RELEASED"],
  cancelled: ["CANCELLED", "REFUNDED"],
  disputed: ["DISPUTED"],
};

const PENDING_STAGE_STATUS_MAP: Record<Exclude<PendingStageFilter, "all">, string[]> = {
  created: ["CREATED"],
  in_escrow: ["IN_ESCROW"],
  out_for_delivery: ["OUT_FOR_DELIVERY"],
  deliverable_uploaded: ["DELIVERABLE_UPLOADED"],
  delivered: ["DELIVERED"],
};

type FnItem = {
  id: string;
  buyer_id: string;
  seller_id: string;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
  listing: {
    id: string;
    title: string | null;
    category: string | null;
    sub_category: string | null;
    delivery_type: string | null;
  } | null;
  cover_image: { public_url: string | null } | null;
};

type FnResponse = {
  items: FnItem[];
  count: number | null;
  limit: number;
  offset: number;
};

type RoleParam = "all" | "buyer" | "seller";

type OrderRow = {
  id: string;
  buyer_id: string;
  seller_id: string;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
  listing_id: string | null;
};

type ListingRow = {
  id: string;
  title: string | null;
  category: string | null;
  sub_category: string | null;
  delivery_type: string | null;
  cover_image_id: string | null;
};

type CoverRow = {
  id: string;
  public_url: string | null;
};

function canFallbackToDirectOrders(error: unknown) {
  const msg = String((error as any)?.message || error || "").toLowerCase();
  if (!msg) return false;
  if (msg.includes("jwt") || msg.includes("session") || msg.includes("not authenticated")) {
    return false;
  }
  return (
    msg.includes("network") ||
    msg.includes("failed to fetch") ||
    msg.includes("load failed") ||
    msg.includes("cors") ||
    msg.includes("preflight") ||
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("abort") ||
    msg.includes("edge function") ||
    msg.includes("405") ||
    msg.includes("method not allowed")
  );
}

async function fetchOrdersFallback(roleParam: RoleParam): Promise<FnItem[]> {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  const me = auth?.user?.id;
  if (!me) throw new Error("No session. Please sign in again.");

  let q = supabase
    .from("market_orders")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  if (roleParam === "buyer") q = q.eq("buyer_id", me);
  else if (roleParam === "seller") q = q.eq("seller_id", me);
  else q = q.or(`buyer_id.eq.${me},seller_id.eq.${me}`);

  const { data: orders, error: ordersErr } = await q;
  if (ordersErr) throw new Error(ordersErr.message);

  const orderRows = ((orders ?? []) as any[]).map((row: any) => {
    const qty = Number(row.quantity ?? 1);
    const unit = Number(row.unit_price ?? 0);
    const amount =
      Number(row.amount ?? NaN) ||
      Number(row.amount_ngn ?? NaN) ||
      (Number.isFinite(unit) && Number.isFinite(qty) ? unit * qty : 0);

    return {
      id: String(row.id),
      buyer_id: String(row.buyer_id),
      seller_id: String(row.seller_id),
      amount: Number.isFinite(amount) ? amount : 0,
      currency: String(row.currency ?? (row.amount_ngn != null ? "NGN" : "")),
      status: String(row.status ?? ""),
      created_at: String(row.created_at ?? ""),
      listing_id: row.listing_id ? String(row.listing_id) : null,
    };
  }) as OrderRow[];

  const listingIds = Array.from(new Set(orderRows.map((row) => row.listing_id).filter(Boolean))) as string[];

  let listingMap = new Map<string, ListingRow>();
  let coverMap = new Map<string, CoverRow>();

  if (listingIds.length) {
    const { data: listings, error: listingsErr } = await supabase
      .from("market_listings")
      .select("*")
      .in("id", listingIds);
    if (listingsErr) throw new Error(listingsErr.message);

    const listingRows = ((listings ?? []) as any[]).map((row: any) => ({
      id: String(row.id),
      title: row.title == null ? null : String(row.title),
      category: row.category == null ? null : String(row.category),
      sub_category: row.sub_category == null ? null : String(row.sub_category),
      delivery_type: row.delivery_type == null ? null : String(row.delivery_type),
      cover_image_id:
        row.cover_image_id == null
          ? row.image_id == null
            ? null
            : String(row.image_id)
          : String(row.cover_image_id),
    })) as ListingRow[];
    listingMap = new Map<string, ListingRow>(listingRows.map((row) => [row.id, row]));

    const coverIds = Array.from(
      new Set(listingRows.map((row) => row.cover_image_id).filter(Boolean)),
    ) as string[];
    if (coverIds.length) {
      const { data: covers, error: coversErr } = await supabase
        .from("market_listing_images")
        .select("*")
        .in("id", coverIds);
      if (coversErr) throw new Error(coversErr.message);

      const coverRows = ((covers ?? []) as any[]).map((row: any) => ({
        id: String(row.id),
        public_url: row.public_url == null ? null : String(row.public_url),
      })) as CoverRow[];
      coverMap = new Map<string, CoverRow>(coverRows.map((row) => [row.id, row]));
    }
  }

  return orderRows.map((row) => {
    const listing = row.listing_id ? listingMap.get(row.listing_id) ?? null : null;
    const cover = listing?.cover_image_id ? coverMap.get(listing.cover_image_id) ?? null : null;

    return {
      id: row.id,
      buyer_id: row.buyer_id,
      seller_id: row.seller_id,
      amount: Number(row.amount ?? 0),
      currency: row.currency || "USD",
      status: row.status || "CREATED",
      created_at: row.created_at,
      listing: listing
        ? {
            id: listing.id,
            title: listing.title,
            category: listing.category,
            sub_category: listing.sub_category,
            delivery_type: listing.delivery_type,
          }
        : null,
      cover_image: cover ? { public_url: cover.public_url ?? null } : null,
    };
  });
}

function money(currency: string | null, amt: any) {
  const n = Number(amt ?? 0);
  const c = String(currency || "").toUpperCase();
  if (c === "USDC" || c === "USDT" || c === "USD") return `$${n.toLocaleString()}`;
  if (c === "NGN") return `NGN ${n.toLocaleString()}`;
  return `${c || "AMOUNT"} ${n.toLocaleString()}`;
}

function normalizeStatus(status: string | null | undefined) {
  return String(status || "").trim().toUpperCase();
}

function formatStatusLabel(status: string) {
  const s = normalizeStatus(status);
  if (STATUS_LABELS[s]) return STATUS_LABELS[s];
  return s
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function isRetryableNetworkError(error: unknown) {
  const msg = String((error as any)?.message || error || "").toLowerCase();
  return (
    msg.includes("network") ||
    msg.includes("failed to fetch") ||
    msg.includes("request failed") ||
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("abort")
  );
}

function StatusDot({ status }: { status: string }) {
  const map: Record<string, string> = {
    CREATED: "rgba(255,255,255,0.55)",
    IN_ESCROW: "rgba(124,58,237,0.9)",
    OUT_FOR_DELIVERY: "rgba(59,130,246,0.9)",
    DELIVERABLE_UPLOADED: "rgba(14,165,233,0.9)",
    DELIVERED: "rgba(16,185,129,0.9)",
    RELEASED: "rgba(16,185,129,0.9)",
    DISPUTED: "rgba(251,146,60,0.9)",
    REFUNDED: "rgba(239,68,68,0.9)",
    CANCELLED: "rgba(239,68,68,0.9)",
  };
  const c = map[normalizeStatus(status)] ?? "rgba(255,255,255,0.55)";
  return (
    <View
      style={{
        width: 10,
        height: 10,
        borderRadius: 99,
        backgroundColor: c,
      }}
    />
  );
}

function SegButton({
  label,
  active,
  onPress,
  compact = false,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  compact?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={{
        flex: compact ? undefined : 1,
        minWidth: compact ? 92 : undefined,
        paddingHorizontal: compact ? 14 : 0,
        paddingVertical: 12,
        borderRadius: 16,
        alignItems: "center",
        backgroundColor: active ? "rgba(124,58,237,0.25)" : "rgba(255,255,255,0.06)",
        borderWidth: 1,
        borderColor: active ? "rgba(124,58,237,0.40)" : "rgba(255,255,255,0.10)",
      }}
    >
      <Text style={{ color: "#fff", fontWeight: "900" }}>{label}</Text>
    </Pressable>
  );
}

function ErrorCard({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <View
      style={{
        marginTop: 14,
        borderRadius: 22,
        padding: 16,
        backgroundColor: "rgba(239,68,68,0.10)",
        borderWidth: 1,
        borderColor: "rgba(239,68,68,0.22)",
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: 14,
            backgroundColor: "rgba(239,68,68,0.18)",
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: "rgba(239,68,68,0.25)",
          }}
        >
          <Ionicons name="alert-circle-outline" size={20} color="#FCA5A5" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: "#fff", fontWeight: "900" }}>{title}</Text>
          <Text style={{ marginTop: 4, color: "rgba(255,255,255,0.75)", fontSize: 12 }}>
            {message}
          </Text>
        </View>
      </View>

      <Pressable
        onPress={onRetry}
        style={{
          marginTop: 14,
          borderRadius: 18,
          paddingVertical: 12,
          alignItems: "center",
          backgroundColor: "rgba(255,255,255,0.08)",
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.12)",
        }}
      >
        <Text style={{ color: "#fff", fontWeight: "900" }}>Try again</Text>
      </Pressable>
    </View>
  );
}

function EmptyState({ onGoMarket }: { onGoMarket: () => void }) {
  return (
    <View
      style={{
        marginTop: 14,
        borderRadius: 22,
        padding: 16,
        backgroundColor: "rgba(255,255,255,0.05)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
      }}
    >
      <Text style={{ color: "#fff", fontWeight: "900" }}>No orders yet</Text>
      <Text style={{ marginTop: 6, color: "rgba(255,255,255,0.65)" }}>
        When you buy or sell, it will show here.
      </Text>

      <Pressable
        onPress={onGoMarket}
        style={{
          marginTop: 14,
          borderRadius: 18,
          paddingVertical: 14,
          alignItems: "center",
          backgroundColor: PURPLE,
          borderWidth: 1,
          borderColor: PURPLE,
        }}
      >
        <Text style={{ color: "#fff", fontWeight: "900" }}>Go to marketplace</Text>
      </Pressable>
    </View>
  );
}

export default function MarketOrdersTab() {
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [mode, setMode] = useState<"all" | "buying" | "selling">("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [pendingStageFilter, setPendingStageFilter] = useState<PendingStageFilter>("all");
  const [items, setItems] = useState<FnItem[]>([]);

  // Prevent state updates after unmount
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const roleParam = useMemo<RoleParam>(() => {
    if (mode === "buying") return "buyer";
    if (mode === "selling") return "seller";
    return "all";
  }, [mode]);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = !!opts?.silent;

      if (!silent) {
        setErr(null);
        setLoading(true);
      }

      try {
        console.log("[MarketOrdersTab] load start", { role: roleParam, silent });

        const applyDirectFallback = async () => {
          const nextItems = await fetchOrdersFallback(roleParam);
          if (!aliveRef.current) return true;
          setItems(nextItems);
          setErr(null);
          console.log("[MarketOrdersTab] direct fallback -> ok", { count: nextItems.length });
          return true;
        };

        if (Platform.OS === "web") {
          try {
            const done = await applyDirectFallback();
            if (done) return;
          } catch (fallbackErr) {
            console.log("[MarketOrdersTab] direct fallback -> failed", String((fallbackErr as any)?.message || fallbackErr));
          }
        }

        const maxAttempts = 2;
        let lastError: unknown = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          try {
            let token = "";
            try {
              token = await getSupabaseJwtOrThrow();
            } catch (e) {
              router.replace("/(auth)/login" as any);
              throw e;
            }

            const base = getSupabaseFunctionsBaseUrl();
            const url = new URL(`${base}/${FN_MARKET_ORDERS_LIST}`);
            url.searchParams.set("role", roleParam);
            url.searchParams.set("limit", "50");
            url.searchParams.set("offset", "0");

            console.log("[MarketOrdersTab] edge call -> start", { attempt, url: url.toString() });
            const { res, text, json } = await fetchJsonWithTimeout(
              url.toString(),
              {
                method: "GET",
                headers: {
                  Authorization: `Bearer ${token}`,
                  apikey: getSupabaseAnonKeyOrThrow(),
                  Accept: "application/json",
                },
              },
              20000,
            );

            if (!res.ok) {
              console.log("[MarketOrdersTab] edge call -> HTTP", res.status, text);
              const msg =
                (json as any)?.message ||
                (json as any)?.error ||
                (typeof json === "string" ? json : null) ||
                (text && text.length < 400 ? text : null) ||
                `Failed to load orders (HTTP ${res.status})`;

              if (res.status === 401) {
                router.replace("/(auth)/login" as any);
                return;
              }

              throw new Error(friendlyMarketError({ message: msg }, "We couldn't load orders right now."));
            }

            const payload = json as FnResponse;
            const nextItems = Array.isArray(payload?.items) ? payload.items : [];

            if (!aliveRef.current) return;
            setItems(nextItems);
            setErr(null);
            console.log("[MarketOrdersTab] edge call -> ok", { status: res.status, attempt });
            return;
          } catch (e: any) {
            lastError = e;
            const retryable = isRetryableNetworkError(e);
            if (attempt < maxAttempts && retryable) {
              await sleep(550 * attempt);
              continue;
            }
            break;
          }
        }

        if (canFallbackToDirectOrders(lastError)) {
          try {
            const done = await applyDirectFallback();
            if (done) return;
          } catch (fallbackErr) {
            lastError = fallbackErr;
          }
        }

        throw lastError ?? new Error("Unknown orders load error.");
      } catch (e: any) {
        if (!aliveRef.current) return;
        setErr(friendlyMarketError(e, "We couldn't load orders right now."));
        if (!items.length) setItems([]);
      } finally {
        if (!aliveRef.current) return;
        if (!silent) {
          setLoading(false);
          console.log("[MarketOrdersTab] load end");
        }
      }
    },
    [items.length, roleParam],
  );

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleParam]);

  const onRefresh = useCallback(async () => {
    console.log("[MarketOrdersTab] refresh start");
    setRefreshing(true);
    try {
      await load({ silent: true });
    } finally {
      if (aliveRef.current) {
        setRefreshing(false);
        console.log("[MarketOrdersTab] refresh end");
      }
    }
  }, [load]);

  function openOrder(id: string) {
    router.push(`/market/order/${id}` as any);
  }

  function selectStatusFilter(next: StatusFilter) {
    setStatusFilter(next);
    if (next !== "pending") setPendingStageFilter("all");
  }

  const visibleItems = useMemo(() => {
    if (statusFilter === "all") return items;

    if (statusFilter === "pending") {
      return items.filter((o) => {
        const status = normalizeStatus(o.status);
        if (!STATUS_GROUPS.pending.includes(status)) return false;
        if (pendingStageFilter === "all") return true;
        return PENDING_STAGE_STATUS_MAP[pendingStageFilter].includes(status);
      });
    }

    const groupedStatuses = STATUS_GROUPS[statusFilter];
    return items.filter((o) => groupedStatuses.includes(normalizeStatus(o.status)));
  }, [items, pendingStageFilter, statusFilter]);

  return (
    <LinearGradient
      colors={[BG1, BG0]}
      start={{ x: 0.15, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={{
        flex: 1,
        paddingTop: Math.max(insets.top, 14),
        paddingHorizontal: 16,
      }}
    >
      <InAppTutorial enabled={!loading} flow={tutorialFlows.marketOrders} />
      <AppHeader title="Orders" subtitle="Buying & selling history" />
      <ScrollView
        contentContainerStyle={{ paddingBottom: 28 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />
        }
      >
        {/* Header */}
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            paddingBottom: 12,
          }}
        >
          <View>
            <Text style={{ color: "#fff", fontSize: 24, fontWeight: "900" }}>Orders</Text>
            <Text style={{ color: "rgba(255,255,255,0.65)", marginTop: 6, fontSize: 13 }}>
              Buying &amp; selling history
            </Text>
          </View>

          <Pressable
            onPress={() => load()}
            accessibilityRole="button"
            style={{
              width: 44,
              height: 44,
              borderRadius: 16,
              backgroundColor: "rgba(255,255,255,0.06)",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.08)",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="refresh" size={20} color="#fff" />
          </Pressable>
        </View>

        {/* Segmented */}
        <View style={{ flexDirection: "row", gap: 10 }}>
          <SegButton label="All" active={mode === "all"} onPress={() => setMode("all")} />
          <SegButton label="Buying" active={mode === "buying"} onPress={() => setMode("buying")} />
          <SegButton label="Selling" active={mode === "selling"} onPress={() => setMode("selling")} />
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 10 }}>
          <SegButton label="All" active={statusFilter === "all"} onPress={() => selectStatusFilter("all")} compact />
          <SegButton label="Pending" active={statusFilter === "pending"} onPress={() => selectStatusFilter("pending")} compact />
          <SegButton label="Completed" active={statusFilter === "completed"} onPress={() => selectStatusFilter("completed")} compact />
          <SegButton label="Cancelled" active={statusFilter === "cancelled"} onPress={() => selectStatusFilter("cancelled")} compact />
          <SegButton label="Disputed" active={statusFilter === "disputed"} onPress={() => selectStatusFilter("disputed")} compact />
        </View>

        {statusFilter === "pending" ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 10 }}>
            <SegButton
              label="All"
              active={pendingStageFilter === "all"}
              onPress={() => setPendingStageFilter("all")}
              compact
            />
            <SegButton
              label="Created"
              active={pendingStageFilter === "created"}
              onPress={() => setPendingStageFilter("created")}
              compact
            />
            <SegButton
              label="In Escrow"
              active={pendingStageFilter === "in_escrow"}
              onPress={() => setPendingStageFilter("in_escrow")}
              compact
            />
            <SegButton
              label="Out for Delivery"
              active={pendingStageFilter === "out_for_delivery"}
              onPress={() => setPendingStageFilter("out_for_delivery")}
              compact
            />
            <SegButton
              label="Uploaded"
              active={pendingStageFilter === "deliverable_uploaded"}
              onPress={() => setPendingStageFilter("deliverable_uploaded")}
              compact
            />
            <SegButton
              label="Delivered"
              active={pendingStageFilter === "delivered"}
              onPress={() => setPendingStageFilter("delivered")}
              compact
            />
          </View>
        ) : null}

        {!!err ? <ErrorCard title="Couldn't load orders" message={err} onRetry={() => load()} /> : null}

        {loading ? (
          <View style={{ marginTop: 44, alignItems: "center" }}>
            <ActivityIndicator />
            <Text style={{ marginTop: 10, color: "rgba(255,255,255,0.7)" }}>Loading...</Text>
          </View>
        ) : visibleItems.length === 0 ? (
          <EmptyState onGoMarket={() => router.push("/market/(tabs)" as any)} />
        ) : (
          <View style={{ marginTop: 12, gap: 10 }}>
            {visibleItems.map((o) => {
              const title = o.listing?.title ?? "Order";
              const meta = `${o.listing?.category ?? "-"} - ${o.listing?.delivery_type ?? "-"}`;
              const img = o.cover_image?.public_url ?? null;

              return (
                <Pressable
                  key={o.id}
                  onPress={() => openOrder(o.id)}
                  accessibilityRole="button"
                  style={{
                    borderRadius: 22,
                    padding: 14,
                    backgroundColor: "rgba(255,255,255,0.05)",
                    borderWidth: 1,
                    borderColor: "rgba(255,255,255,0.08)",
                  }}
                >
                  <View style={{ flexDirection: "row", gap: 12 }}>
                    <View
                      style={{
                        width: 54,
                        height: 54,
                        borderRadius: 18,
                        overflow: "hidden",
                        backgroundColor: "rgba(255,255,255,0.06)",
                        borderWidth: 1,
                        borderColor: "rgba(255,255,255,0.10)",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {img ? (
                        <Image source={{ uri: img }} style={{ width: 54, height: 54 }} />
                      ) : (
                        <Ionicons name="cube-outline" size={22} color="rgba(255,255,255,0.75)" />
                      )}
                    </View>

                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <StatusDot status={o.status} />
                        <Text style={{ color: "#fff", fontWeight: "900", flex: 1 }} numberOfLines={1}>
                          {title}
                        </Text>
                        <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.75)" />
                      </View>

                      <Text
                        style={{ marginTop: 6, color: "rgba(255,255,255,0.6)", fontSize: 12 }}
                        numberOfLines={1}
                      >
                        {meta}
                      </Text>

                      <View
                        style={{
                          marginTop: 10,
                          flexDirection: "row",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                          <Text style={{ color: "rgba(255,255,255,0.65)", fontSize: 12 }}>
                            {formatStatusLabel(o.status)}
                          </Text>
                        </View>
                        <Text style={{ color: "#fff", fontWeight: "900" }}>
                          {money(o.currency, o.amount)}
                        </Text>
                      </View>

                      <Text style={{ marginTop: 6, color: "rgba(255,255,255,0.55)", fontSize: 12 }}>
                        {new Date(o.created_at).toLocaleString()}
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

