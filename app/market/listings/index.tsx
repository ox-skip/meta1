// app/market/listings/index.tsx
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import AppHeader from "@/components/common/AppHeader";
import MarketMediaView from "@/components/market/MarketMediaView";
import { InAppTutorial } from "@/components/onboarding/InAppTutorial";
import { tutorialFlows } from "@/services/onboarding/definitions";
import { supabase } from "@/services/supabase";
import { generateListingAiPerformance, type MarketListingAiPerformanceResult } from "@/services/market/ai";
import { resolveMarketMediaSource, sortMarketMedia } from "@/utils/marketMedia";
import { formatCurrency, getListingPriceDisplay } from "@/utils/pricing";

const BG0 = "#060807";
const BG1 = "#10130E";
const BG2 = "#171A13";
const BRAND = "#2DD4BF";
const CARD = "rgba(255,253,247,0.065)";
const BORDER = "rgba(255,253,247,0.12)";
const MUTED = "rgba(255,253,247,0.68)";

const LISTINGS_TABLE = "market_listings";
const IMAGES_TABLE = "market_listing_images";
const LISTING_IMAGES_BUCKET = "market-listings";

type ListingImage = {
  id: string;
  listing_id: string;
  storage_path: string;
  public_url: string | null;
  sort_order: number | null;
  meta: any;
  created_at: string;
};

type Listing = {
  id: string;
  seller_id: string;
  category: string;
  sub_category: string;
  title: string;
  description: string | null;
  price_amount: number | string;
  currency: string;
  payment_options?: any;
  delivery_type: string;
  stock_qty: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  cover_image_id: string | null;
  website_url: string | null;
  deleted_at: string | null;

  cover_image?: ListingImage | null;
  images?: ListingImage[] | null;
};

type FilterTab = "all" | "product" | "service";
type SortBy = "newest" | "price_low" | "price_high";
type ActiveFilter = "all" | "active" | "disabled";
type Mode = "mine" | "seller" | "invalid";

function sortImages(imgs: ListingImage[] | null | undefined) {
  if (!imgs?.length) return [];
  return [...imgs].sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0));
}

function sanitizeForOr(term: string) {
  return term.replace(/,/g, " ").trim();
}

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

function isMissingRpcError(error: unknown) {
  const msg = String((error as any)?.message || error || "").toLowerCase();
  return (
    msg.includes("could not find the function") ||
    msg.includes("pgrst202") ||
    msg.includes("42883") ||
    msg.includes("schema cache")
  );
}

function pickCoverUrl(listing: Listing, supabaseUrl: string) {
  return resolveMarketMediaSource(
    [listing.cover_image ?? null, ...sortMarketMedia(listing.images)],
    supabaseUrl,
    LISTING_IMAGES_BUCKET,
  );
}

function mediaCount(listing: Listing) {
  const imgs = listing.images ?? [];
  const cover = listing.cover_image;
  if (!cover) return imgs.length;
  const already = imgs.some((i) => i.id === cover.id);
  return imgs.length + (already ? 0 : 1);
}

export default function ListingsFeed() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    category?: string;
    q?: string;
    seller_id?: string; // profile uuid
    mine?: string; // "1"
  }>();

  const [viewerUid, setViewerUid] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    let alive = true;
    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (!alive) return;
        setViewerUid(data?.user?.id ?? null);
        setAuthChecked(true);
      })
      .catch(() => {
        if (!alive) return;
        setViewerUid(null);
        setAuthChecked(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const sellerIdParam = useMemo(() => (params?.seller_id ?? "").trim() || null, [params?.seller_id]);
  const mineParam = useMemo(
    () => ["1", "true", "yes"].includes(String(params?.mine ?? "").toLowerCase()),
    [params?.mine],
  );

  const mode: Mode = useMemo(() => {
    if (mineParam) return "mine";
    if (sellerIdParam) return "seller";
    return "invalid";
  }, [mineParam, sellerIdParam]);

  // HARD SEPARATION:
  // This screen is ONLY "mine" or "seller". If no params, bounce to public market feed.
  useEffect(() => {
    if (mode === "invalid") {
      router.replace("/market/(tabs)" as any);
    }
  }, [mode]);

  const resolvedSellerId = mode === "mine" ? viewerUid : sellerIdParam;

  const isMineView = useMemo(() => {
    if (mode === "mine") return true;
    if (!resolvedSellerId || !viewerUid) return false;
    return resolvedSellerId === viewerUid;
  }, [mode, resolvedSellerId, viewerUid]);

  const initialCategory = useMemo(() => String(params?.category ?? "all"), [params?.category]);
  const initialQ = useMemo(() => String(params?.q ?? "").trim(), [params?.q]);

  const [tab, setTab] = useState<FilterTab>(
    initialCategory === "product" || initialCategory === "service" ? (initialCategory as any) : "all",
  );
  const [sortBy, setSortBy] = useState<SortBy>("newest");
  const [q, setQ] = useState(initialQ);
  const debouncedQ = useDebouncedValue(q.trim(), 350);

  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("all");

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rows, setRows] = useState<Listing[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const pageSize = 20;
  const [page, setPage] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [listingAiBusyId, setListingAiBusyId] = useState<string | null>(null);
  const [listingAiResults, setListingAiResults] = useState<Record<string, MarketListingAiPerformanceResult>>({});

  const supabaseUrl =
    (supabase as any)?.supabaseUrl ?? (process.env.EXPO_PUBLIC_SUPABASE_URL as string) ?? "";

  const listRef = useRef<FlatList<Listing>>(null);

  const title = useMemo(() => {
    if (mode === "mine") return "My Listings";
    if (mode === "seller") return isMineView ? "My Listings" : "Store Listings";
    return "Listings";
  }, [mode, isMineView]);

  const subtitle = useMemo(() => {
    if (mode === "mine" || (mode === "seller" && isMineView)) {
      return "Manage your listings (enable/disable or delete)";
    }
    return "Browsing this seller’s active listings";
  }, [mode, isMineView]);

  const buildSort = useCallback(
    (query: any) => {
      if (sortBy === "price_low") return query.order("price_amount", { ascending: true });
      if (sortBy === "price_high") return query.order("price_amount", { ascending: false });
      return query.order("created_at", { ascending: false });
    },
    [sortBy],
  );

  const fetchPage = useCallback(
    async (reset: boolean) => {
      // don’t do anything while we’re redirecting
      if (mode === "invalid") return;

      // Mine view needs auth check to finish first
      if (mode === "mine" && !authChecked) {
        setLoading(true);
        return;
      }

      // Mine view but signed out
      if (mode === "mine" && authChecked && !viewerUid) {
        setErr("Please sign in to view your listings.");
        setLoading(false);
        setRows([]);
        return;
      }

      if (reset) {
        setErr(null);
        setHasMore(true);
        setPage(0);
        setLoading(true);
      } else {
        if (loadingMore || !hasMore) return;
        setLoadingMore(true);
      }

      try {
        if (!resolvedSellerId) throw new Error("Seller not found.");

        const currentPage = reset ? 0 : page;
        const from = currentPage * pageSize;
        const to = from + pageSize - 1;

        let query = supabase
          .from(LISTINGS_TABLE)
          .select(
            `
            id,seller_id,category,sub_category,title,description,price_amount,currency,payment_options,delivery_type,stock_qty,is_active,created_at,updated_at,cover_image_id,website_url,deleted_at,
            cover_image:${IMAGES_TABLE}!market_listings_cover_image_fk(*),
            images:${IMAGES_TABLE}!market_listing_images_listing_id_fkey(*)
          `,
          )
          .is("deleted_at", null)
          .eq("seller_id", resolvedSellerId);

        // if not my view, show active only
        if (!isMineView) query = query.eq("is_active", true);

        // extra filters for mine view
        if (isMineView) {
          if (activeFilter === "active") query = query.eq("is_active", true);
          if (activeFilter === "disabled") query = query.eq("is_active", false);
        }

        if (tab !== "all") query = query.eq("category", tab);

        const term = sanitizeForOr(debouncedQ);
        if (term) {
          query = query.or(
            [`title.ilike.%${term}%`, `description.ilike.%${term}%`, `sub_category.ilike.%${term}%`].join(","),
          );
        }

        query = buildSort(query).range(from, to);

        const { data, error } = await query;
        if (error) throw new Error(error.message);

        const batch = ((data ?? []) as unknown as Listing[]).map((l) => ({
          ...l,
          images: sortImages(l.images ?? []),
        }));

        if (reset) setRows(batch);
        else setRows((prev) => [...prev, ...batch]);

        setHasMore(batch.length === pageSize);
        setPage((prev) => (reset ? 1 : prev + 1));
      } catch (e: any) {
        setErr(e?.message || "Failed to load listings");
        if (reset) setRows([]);
      } finally {
        if (reset) {
          setLoading(false);
          setRefreshing(false);
        } else {
          setLoadingMore(false);
        }
      }
    },
    [
      mode,
      authChecked,
      viewerUid,
      loadingMore,
      hasMore,
      page,
      buildSort,
      resolvedSellerId,
      isMineView,
      activeFilter,
      tab,
      debouncedQ,
    ],
  );

  // reload when filters or mode changes
  useEffect(() => {
    if (mode === "invalid") return;
    listRef.current?.scrollToOffset?.({ offset: 0, animated: true });
    fetchPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, resolvedSellerId, tab, sortBy, debouncedQ, activeFilter]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchPage(true);
    } finally {
      setRefreshing(false);
    }
  }, [fetchPage]);

  const onEndReached = useCallback(() => {
    if (!loading && !err) fetchPage(false);
  }, [fetchPage, loading, err]);

  const onSearchSubmit = useCallback(() => {
    router.setParams({ q: q.trim() } as any);
  }, [q]);

  const runToggleActive = useCallback(
    async (listing: Listing, nextActive: boolean) => {
      setBusyId(listing.id);
      try {
        if (
          nextActive &&
          listing.category === "product" &&
          typeof listing.stock_qty === "number" &&
          listing.stock_qty <= 0
        ) {
          throw new Error("Cannot enable a product listing with zero stock. Restock or create a new listing.");
        }

        let resolvedNext = nextActive;
        try {
          const { data, error } = await supabase.rpc("market_set_listing_active", {
            p_listing_id: listing.id,
            p_is_active: nextActive,
          });
          if (error) throw error;
          if (typeof (data as any)?.is_active === "boolean") {
            resolvedNext = Boolean((data as any).is_active);
          }
        } catch (rpcError: any) {
          if (!isMissingRpcError(rpcError)) throw new Error(rpcError?.message || "Failed to update listing.");

          if (!nextActive) {
            const { count, error: countErr } = await supabase
              .from("market_orders")
              .select("id", { count: "exact", head: true })
              .eq("listing_id", listing.id)
              .in("status", ["CREATED", "IN_ESCROW", "OUT_FOR_DELIVERY", "DELIVERED"]);
            if (countErr) throw new Error(countErr.message);
            if (Number(count || 0) > 0) {
              throw new Error("Cannot disable listing with pending or active orders.");
            }
          }

          let updateQuery = supabase
            .from(LISTINGS_TABLE)
            .update({ is_active: nextActive, updated_at: new Date().toISOString() })
            .eq("id", listing.id);
          if (viewerUid) updateQuery = updateQuery.eq("seller_id", viewerUid);

          const { data: updated, error: updateErr } = await updateQuery.select("id,is_active").maybeSingle();
          if (updateErr) throw new Error(updateErr.message);
          if (!updated) throw new Error("Listing not found or you no longer have permission.");
          resolvedNext = Boolean((updated as any).is_active);
        }

        setRows((prev) => {
          const next = prev.map((r) => (r.id === listing.id ? { ...r, is_active: resolvedNext } : r));
          if (activeFilter === "active" && !resolvedNext) return next.filter((r) => r.id !== listing.id);
          if (activeFilter === "disabled" && resolvedNext) return next.filter((r) => r.id !== listing.id);
          return next;
        });
      } catch (e: any) {
        Alert.alert("Action blocked", e?.message ?? "Failed");
      } finally {
        setBusyId(null);
      }
    },
    [activeFilter, viewerUid],
  );

  const runDelete = useCallback(
    async (listing: Listing) => {
      setBusyId(listing.id);
      try {
        try {
          const { error } = await supabase.rpc("market_delete_listing", {
            p_listing_id: listing.id,
          });
          if (error) throw error;
        } catch (rpcError: any) {
          if (!isMissingRpcError(rpcError)) throw new Error(rpcError?.message || "Failed to delete listing.");

          const { count, error: countErr } = await supabase
            .from("market_orders")
            .select("id", { count: "exact", head: true })
            .eq("listing_id", listing.id);
          if (countErr) throw new Error(countErr.message);
          if (Number(count || 0) > 0) {
            throw new Error("Cannot delete listing that already has orders.");
          }

          let updateQuery = supabase
            .from(LISTINGS_TABLE)
            .update({
              is_active: false,
              deleted_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", listing.id);
          if (viewerUid) updateQuery = updateQuery.eq("seller_id", viewerUid);

          const { data: updated, error: updateErr } = await updateQuery.select("id").maybeSingle();
          if (updateErr) throw new Error(updateErr.message);
          if (!updated) throw new Error("Listing not found or you no longer have permission.");
        }

        setRows((prev) => prev.filter((r) => r.id !== listing.id));
      } catch (e: any) {
        Alert.alert("Action blocked", e?.message ?? "Failed");
      } finally {
        setBusyId(null);
      }
    },
    [viewerUid],
  );

  const rpcToggleActive = useCallback(
    async (listing: Listing, nextActive: boolean) => {
      if (!isMineView) return;

      const title = nextActive ? "Enable listing?" : "Disable listing?";
      const msg = nextActive
        ? "This will make your listing visible to buyers again."
        : "This will hide your listing from buyers. This is blocked if there are pending/active orders.";

      if (Platform.OS === "web") {
        const confirmFn = (globalThis as any)?.confirm;
        const ok = typeof confirmFn === "function" ? confirmFn(`${title}\n\n${msg}`) : true;
        if (!ok) return;
        await runToggleActive(listing, nextActive);
        return;
      }

      Alert.alert(title, msg, [
        { text: "Cancel", style: "cancel" },
        {
          text: nextActive ? "Enable" : "Disable",
          style: "default",
          onPress: async () => {
            await runToggleActive(listing, nextActive);
          },
        },
      ]);
    },
    [isMineView, runToggleActive],
  );

  const rpcDelete = useCallback(
    async (listing: Listing) => {
      if (!isMineView) return;

      const title = "Delete listing?";
      const msg = "Allowed only if there are NO orders ever on this listing.";

      if (Platform.OS === "web") {
        const confirmFn = (globalThis as any)?.confirm;
        const ok = typeof confirmFn === "function" ? confirmFn(`${title}\n\n${msg}`) : true;
        if (!ok) return;
        await runDelete(listing);
        return;
      }

      Alert.alert(title, msg, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            await runDelete(listing);
          },
        },
      ]);
    },
    [isMineView, runDelete],
  );

  const runListingAiPerformance = useCallback(async (listing: Listing) => {
    if (!isMineView) return;
    setListingAiBusyId(listing.id);
    setErr(null);
    try {
      const result = await generateListingAiPerformance(listing.id);
      setListingAiResults((prev) => ({ ...prev, [listing.id]: result }));
    } catch (e: any) {
      Alert.alert("Gemini unavailable", e?.message ?? "Could not analyze this listing.");
    } finally {
      setListingAiBusyId(null);
    }
  }, [isMineView]);

  const Header = useMemo(() => {
    const Chip = ({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) => (
      <Pressable
        onPress={onPress}
        style={{
          paddingHorizontal: 12,
          paddingVertical: 10,
          borderRadius: 999,
          backgroundColor: active ? "rgba(45,212,191,0.18)" : "rgba(255,255,255,0.06)",
          borderWidth: 1,
          borderColor: active ? "rgba(45,212,191,0.40)" : BORDER,
        }}
      >
        <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }}>{label}</Text>
      </Pressable>
    );

    const Pill = ({
      active,
      label,
      onPress,
      tone = "purple",
    }: {
      active: boolean;
      label: string;
      onPress: () => void;
      tone?: "purple" | "neutral";
    }) => {
      const bg = tone === "purple" ? (active ? BRAND : "rgba(255,255,255,0.06)") : active ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.06)";
      const bd =
        tone === "purple" ? (active ? BRAND : BORDER) : active ? "rgba(255,255,255,0.22)" : BORDER;
      return (
        <Pressable
          onPress={onPress}
          style={{
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderRadius: 16,
            backgroundColor: bg,
            borderWidth: 1,
            borderColor: bd,
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }}>{label}</Text>
        </Pressable>
      );
    };

    return (
      <View style={{ paddingTop: Math.max(insets.top, 14), paddingHorizontal: 16 }}>
        <AppHeader title={title} subtitle={subtitle} />

        {/* Title row */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={{ color: "#fff", fontSize: 28, fontWeight: "900" }}>{title}</Text>
            <Text style={{ marginTop: 6, color: MUTED, fontSize: 13 }}>{subtitle}</Text>
          </View>

          <Pressable
            onPress={() => router.push("/market/(tabs)/account" as any)}
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
            <Ionicons name="person-circle-outline" size={22} color="#fff" />
          </Pressable>
        </View>

        {/* Search */}
        <View
          style={{
            marginTop: 12,
            flexDirection: "row",
            gap: 10,
            borderRadius: 20,
            padding: 12,
            borderWidth: 1,
            borderColor: BORDER,
            backgroundColor: "rgba(255,255,255,0.06)",
            alignItems: "center",
          }}
        >
          <Ionicons name="search-outline" size={18} color="rgba(255,255,255,0.75)" />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search in this store…"
            placeholderTextColor="rgba(255,255,255,0.45)"
            style={{ flex: 1, color: "#fff", fontWeight: "700" }}
            returnKeyType="search"
            onSubmitEditing={onSearchSubmit}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {!!q && (
            <Pressable
              onPress={() => setQ("")}
              style={{
                width: 34,
                height: 34,
                borderRadius: 12,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "rgba(255,255,255,0.08)",
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.10)",
              }}
            >
              <Ionicons name="close" size={16} color="#fff" />
            </Pressable>
          )}
        </View>

        {/* Filters */}
        <View style={{ marginTop: 12, flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
          <Chip active={tab === "all"} label="All" onPress={() => setTab("all")} />
          <Chip active={tab === "product"} label="Products" onPress={() => setTab("product")} />
          <Chip active={tab === "service"} label="Services" onPress={() => setTab("service")} />
        </View>

        <View style={{ marginTop: 12, flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
          <Pill active={sortBy === "newest"} label="Newest" onPress={() => setSortBy("newest")} />
          <Pill active={sortBy === "price_low"} label="Price ↑" onPress={() => setSortBy("price_low")} />
          <Pill active={sortBy === "price_high"} label="Price ↓" onPress={() => setSortBy("price_high")} />
        </View>

        {isMineView ? (
          <View style={{ marginTop: 12, flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
            <Pill tone="neutral" active={activeFilter === "all"} label="All" onPress={() => setActiveFilter("all")} />
            <Pill tone="neutral" active={activeFilter === "active"} label="Active" onPress={() => setActiveFilter("active")} />
            <Pill tone="neutral" active={activeFilter === "disabled"} label="Disabled" onPress={() => setActiveFilter("disabled")} />
          </View>
        ) : null}

        {/* Error box */}
        {err ? (
          <View
            style={{
              marginTop: 14,
              borderRadius: 18,
              padding: 14,
              backgroundColor: "rgba(255,255,255,0.05)",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.08)",
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "900" }}>Could not load listings</Text>
            <Text style={{ marginTop: 6, color: MUTED }}>{err}</Text>

            <Pressable
              onPress={() => fetchPage(true)}
              style={{
                marginTop: 12,
                borderRadius: 14,
                paddingVertical: 10,
                alignItems: "center",
                backgroundColor: BRAND,
                borderWidth: 1,
                borderColor: BRAND,
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "900" }}>Retry</Text>
            </Pressable>
          </View>
        ) : null}

        {/* Count row */}
        {!err ? (
          <View style={{ marginTop: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ color: MUTED, fontWeight: "900", fontSize: 12 }}>
              {rows.length} item{rows.length === 1 ? "" : "s"}
            </Text>
            {refreshing ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <ActivityIndicator />
                <Text style={{ color: MUTED, fontWeight: "900", fontSize: 12 }}>Refreshing…</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    );
  }, [
    insets.top,
    title,
    subtitle,
    q,
    tab,
    sortBy,
    activeFilter,
    err,
    fetchPage,
    onSearchSubmit,
    isMineView,
    rows.length,
    refreshing,
  ]);

  const EmptyState = useMemo(() => {
    if (loading || err) return null;

    return (
      <View style={{ paddingHorizontal: 16, marginTop: 14 }}>
        <View
          style={{
            borderRadius: 22,
            padding: 16,
            backgroundColor: "rgba(255,255,255,0.05)",
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.08)",
            alignItems: "center",
          }}
        >
          <Ionicons name="albums-outline" size={26} color="rgba(255,255,255,0.65)" />
          <Text style={{ marginTop: 10, color: "#fff", fontWeight: "900", fontSize: 16 }}>No listings found</Text>
          <Text style={{ marginTop: 6, color: MUTED, textAlign: "center" }}>
            Try changing filters or clearing your search.
          </Text>

          <Pressable
            onPress={() => {
              setQ("");
              setTab("all");
              setSortBy("newest");
              setActiveFilter("all");
              router.setParams({ q: "" } as any);
            }}
            style={{
              marginTop: 12,
              borderRadius: 18,
              paddingVertical: 12,
              paddingHorizontal: 16,
              alignItems: "center",
              backgroundColor: BRAND,
              borderWidth: 1,
              borderColor: BRAND,
              alignSelf: "stretch",
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "900" }}>Reset filters</Text>
          </Pressable>

          <Pressable onPress={() => router.push("/market/(tabs)" as any)} style={{ marginTop: 12 }}>
            <Text style={{ color: "#CCFBF1", fontWeight: "900" }}>Back to Marketplace</Text>
          </Pressable>
        </View>
      </View>
    );
  }, [loading, err]);

  const renderItem = useCallback(
    ({ item }: { item: Listing }) => {
      const cover = pickCoverUrl(item, supabaseUrl);
      const coverUrl = cover?.url ?? null;
      const coverKind = cover?.kind ?? "image";
      const busy = busyId === item.id;
      const aiBusy = listingAiBusyId === item.id;
      const aiResult = listingAiResults[item.id]?.performance ?? null;
      const displayPrice = getListingPriceDisplay(item as any);
      const showDiscount = displayPrice.hasDiscount;
      const isOutOfStock = item.category === "product" && typeof item.stock_qty === "number" && item.stock_qty <= 0;
      const cannotEnableOutOfStock = isOutOfStock && !item.is_active;

      const statusBg = isOutOfStock
        ? "rgba(239,68,68,0.20)"
        : item.is_active
        ? "rgba(16,185,129,0.18)"
        : "rgba(148,163,184,0.18)";
      const statusBd = isOutOfStock
        ? "rgba(239,68,68,0.40)"
        : item.is_active
        ? "rgba(16,185,129,0.35)"
        : "rgba(148,163,184,0.35)";
      const statusTxt = isOutOfStock ? "Out of stock" : item.is_active ? "Active" : "Disabled";

      return (
        <View
          style={{
            width: "48%",
            borderRadius: 22,
            overflow: "hidden",
            backgroundColor: CARD,
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.08)",
          }}
        >
          <Pressable onPress={() => router.push(`/market/listing/${item.id}` as any)}>
            <View style={{ height: 130, backgroundColor: "rgba(255,255,255,0.08)" }}>
              {coverUrl ? (
                <MarketMediaView
                  uri={coverUrl}
                  kind={coverKind}
                  style={{ width: "100%", height: "100%" }}
                  resizeMode="cover"
                  autoplay={coverKind === "video"}
                  muted
                  loop={coverKind === "video"}
                  disablePointerEvents
                />
              ) : (
                <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="image-outline" size={28} color="rgba(255,255,255,0.55)" />
                </View>
              )}

              <View style={{ position: "absolute", bottom: 10, left: 10 }}>
                <View
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 8,
                    borderRadius: 14,
                    backgroundColor: "rgba(0,0,0,0.55)",
                    borderWidth: 1,
                    borderColor: "rgba(255,255,255,0.10)",
                  }}
                >
                  {showDiscount ? (
                    <>
                      <Text style={{ color: "rgba(255,255,255,0.65)", textDecorationLine: "line-through", fontWeight: "800", fontSize: 11 }}>
                        {formatCurrency(displayPrice.localCurrency, displayPrice.localWas)}
                      </Text>
                      <Text style={{ color: "rgba(255,255,255,0.65)", textDecorationLine: "line-through", fontWeight: "800", fontSize: 10 }}>
                        USD {formatCurrency("USD", displayPrice.usdWas)}
                      </Text>
                      <Text style={{ color: "#FCA5A5", fontWeight: "900", fontSize: 12 }}>
                        {formatCurrency(displayPrice.localCurrency, displayPrice.localNow)}
                      </Text>
                      <Text style={{ marginTop: 2, color: "rgba(255,255,255,0.7)", fontWeight: "800", fontSize: 10 }}>
                        USD {formatCurrency("USD", displayPrice.usdNow)}
                      </Text>
                    </>
                  ) : (
                    <>
                      <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }}>
                        {formatCurrency(displayPrice.localCurrency, displayPrice.localNow)}
                      </Text>
                      <Text style={{ marginTop: 2, color: "rgba(255,255,255,0.7)", fontWeight: "800", fontSize: 10 }}>
                        USD {formatCurrency("USD", displayPrice.usdNow)}
                      </Text>
                    </>
                  )}
                </View>
              </View>

              {isMineView ? (
                <View style={{ position: "absolute", top: 10, right: 10 }}>
                  <View
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      borderRadius: 999,
                      backgroundColor: statusBg,
                      borderWidth: 1,
                      borderColor: statusBd,
                    }}
                  >
                    <Text style={{ color: "#fff", fontWeight: "900", fontSize: 11 }}>{statusTxt}</Text>
                  </View>
                </View>
              ) : null}
            </View>

            <View style={{ padding: 12 }}>
              <Text numberOfLines={1} style={{ color: "#fff", fontWeight: "900", fontSize: 13 }}>
                {item.title ?? "Untitled"}
              </Text>

              <Text numberOfLines={1} style={{ marginTop: 6, color: MUTED, fontSize: 12 }}>
                {item.sub_category ?? "-"}
                {item.delivery_type ? ` - ${item.delivery_type}` : ""}
              </Text>

              <View style={{ marginTop: 8, flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Ionicons name="images-outline" size={14} color={MUTED} />
                <Text style={{ color: MUTED, fontSize: 11, fontWeight: "800" }}>
                  {mediaCount(item)} media
                </Text>
              </View>
            </View>
          </Pressable>

          {isMineView ? (
            <View style={{ flexDirection: "row", gap: 10, padding: 12, paddingTop: 0 }}>
              <Pressable
                disabled={busy || cannotEnableOutOfStock}
                onPress={() => rpcToggleActive(item, !item.is_active)}
                style={{
                  flex: 1,
                  borderRadius: 14,
                  paddingVertical: 10,
                  alignItems: "center",
                  backgroundColor: cannotEnableOutOfStock
                    ? "rgba(239,68,68,0.18)"
                    : item.is_active
                    ? "rgba(255,255,255,0.08)"
                    : BRAND,
                  borderWidth: 1,
                  borderColor: cannotEnableOutOfStock
                    ? "rgba(239,68,68,0.38)"
                    : item.is_active
                    ? "rgba(255,255,255,0.12)"
                    : BRAND,
                  opacity: busy || cannotEnableOutOfStock ? 0.6 : 1,
                }}
              >
                {busy ? (
                  <ActivityIndicator />
                ) : (
                  <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }}>
                    {cannotEnableOutOfStock ? "Restock first" : item.is_active ? "Disable" : "Enable"}
                  </Text>
                )}
              </Pressable>

              <Pressable
                disabled={aiBusy}
                onPress={() => runListingAiPerformance(item)}
                style={{
                  width: 44,
                  borderRadius: 14,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "rgba(45,212,191,0.16)",
                  borderWidth: 1,
                  borderColor: "rgba(45,212,191,0.38)",
                  opacity: aiBusy ? 0.6 : 1,
                }}
              >
                {aiBusy ? <ActivityIndicator /> : <Ionicons name="sparkles-outline" size={18} color="#fff" />}
              </Pressable>

              <Pressable
                disabled={busy}
                onPress={() => rpcDelete(item)}
                style={{
                  width: 44,
                  borderRadius: 14,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "rgba(255,255,255,0.06)",
                  borderWidth: 1,
                  borderColor: "rgba(255,80,80,0.35)",
                  opacity: busy ? 0.6 : 1,
                }}
              >
                <Ionicons name="trash-outline" size={18} color="#fff" />
              </Pressable>
            </View>
          ) : null}

          {isMineView && aiResult ? (
            <View style={{ marginHorizontal: 12, marginBottom: 12, borderRadius: 16, padding: 12, backgroundColor: "rgba(45,212,191,0.10)", borderWidth: 1, borderColor: "rgba(45,212,191,0.25)", gap: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }}>Gemini score</Text>
                <Text style={{ color: "#CCFBF1", fontWeight: "900", fontSize: 12 }}>{aiResult.performance_score}/100</Text>
              </View>
              {aiResult.summary ? (
                <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18 }}>{aiResult.summary}</Text>
              ) : null}
              {aiResult.issue_flags?.length ? (
                <Text style={{ color: "#FDE68A", fontSize: 12, lineHeight: 18 }}>Fix: {aiResult.issue_flags.join(", ")}</Text>
              ) : null}
              {aiResult.action_items?.length ? (
                <Text style={{ color: "#CCFBF1", fontSize: 12, lineHeight: 18 }}>Next: {aiResult.action_items.slice(0, 3).join(" ")}</Text>
              ) : null}
              {aiResult.suggested_title ? (
                <Text style={{ color: "#fff", fontSize: 12, lineHeight: 18 }}>Title: {aiResult.suggested_title}</Text>
              ) : null}
            </View>
          ) : null}
        </View>
      );
    },
    [supabaseUrl, isMineView, rpcToggleActive, rpcDelete, busyId, listingAiBusyId, listingAiResults, runListingAiPerformance],
  );

  // While redirecting away, avoid flicker
  if (mode === "invalid") {
    return (
      <LinearGradient colors={[BG2, BG1, BG0]} style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </LinearGradient>
    );
  }

  return (
    <LinearGradient colors={[BG2, BG1, BG0]} start={{ x: 0.15, y: 0 }} end={{ x: 0.9, y: 1 }} style={{ flex: 1 }}>
      <InAppTutorial enabled={!loading} flow={tutorialFlows.marketListings} />
      {loading ? (
        <View style={{ flex: 1, paddingTop: Math.max(insets.top, 14), paddingHorizontal: 16 }}>
          <AppHeader title={title} subtitle="Loading…" />
          <View style={{ marginTop: 40, alignItems: "center" }}>
            <ActivityIndicator />
            <Text style={{ marginTop: 10, color: MUTED, fontWeight: "800" }}>Loading…</Text>
          </View>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={rows}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          numColumns={2}
          columnWrapperStyle={{ paddingHorizontal: 16, justifyContent: "space-between", marginTop: 12 }}
          contentContainerStyle={{ paddingBottom: 28 }}
          ListHeaderComponent={Header}
          ListEmptyComponent={EmptyState}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          onEndReachedThreshold={0.45}
          onEndReached={onEndReached}
          ListFooterComponent={
            <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 24 }}>
              {loadingMore ? (
                <View style={{ flexDirection: "row", gap: 10, alignItems: "center", justifyContent: "center" }}>
                  <ActivityIndicator />
                  <Text style={{ color: "#fff", fontWeight: "900" }}>Loading more…</Text>
                </View>
              ) : !hasMore && rows.length > 0 ? (
                <Text style={{ color: "rgba(255,255,255,0.60)", fontWeight: "900", textAlign: "center" }}>
                  End of results
                </Text>
              ) : null}
            </View>
          }
        />
      )}
    </LinearGradient>
  );
}
