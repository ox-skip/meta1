import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import AppHeader from "@/components/common/AppHeader";
import { InAppTutorial } from "@/components/onboarding/InAppTutorial";
import OfficialMarketSocials from "@/components/market/OfficialMarketSocials";
import SocialFeed from "@/components/market/SocialFeed";
import { CategoryItem, getCategoriesByMain, MarketMainCategory } from "@/services/market/categories";
import { tutorialFlows } from "@/services/onboarding/definitions";
import { supabase } from "@/services/supabase";
import { friendlyMarketError } from "@/utils/marketUx";
import { getCachedCountry, isNigeriaCountry, listingMatchesCountry, resolveUserCountry, type UserCountry } from "@/utils/country";
import { listingAllowsCrypto } from "@/utils/marketVisibility";
import { formatCurrency, getListingPriceDisplay } from "@/utils/pricing";
import { formatCountryLabel } from "@/utils/countryNames";

const BG0 = "#05040B";
const BG1 = "#0A0620";
const PURPLE = "#7C3AED";
const CARD = "rgba(255,255,255,0.06)";
const BORDER = "rgba(255,255,255,0.10)";
const MUTED = "rgba(255,255,255,0.65)";

const LISTINGS_TABLE = "market_listings";
const LISTING_IMAGES_BUCKET = "market-listings";

type SortBy = "newest" | "price_low" | "price_high";
type FeedSection = "product" | "service" | "social";
type DirectoryMode = "listings" | "featured" | "verified";
type FeedScope = "country" | "global";

type ListingRow = {
  id: string;
  seller_id: string;
  title: string | null;
  price_amount: number | string | null;
  currency: string | null;
  delivery_type: string | null;
  category: string | null;
  sub_category: string | null;
  created_at: string | null;
  payment_options?: any;
  availability?: any;
  stock_qty?: number | null;
  cover?: { public_url?: string | null; storage_path?: string | null } | null;
  images?: { public_url?: string | null; storage_path?: string | null; sort_order?: number | null }[] | null;
};

type SellerCard = {
  user_id: string;
  market_username: string | null;
  display_name: string | null;
  business_name: string | null;
  bio: string | null;
  is_verified: boolean | null;
  logo_path: string | null;
  featured_enabled?: boolean | null;
  featured_until?: string | null;
};

function publicSellerLogo(path?: string | null) {
  if (!path) return null;
  return supabase.storage.from("market-sellers").getPublicUrl(path).data.publicUrl;
}

function buildPublicFromStorage(supabaseUrl: string, storagePath?: string | null) {
  if (!storagePath) return null;
  return `${supabaseUrl}/storage/v1/object/public/${LISTING_IMAGES_BUCKET}/${storagePath}`;
}

function VerifiedTick({ verified }: { verified?: boolean | null }) {
  if (!verified) return null;
  return <Ionicons name="checkmark-circle" size={16} color="#3B82F6" />;
}

function Chip({
  label,
  active,
  onPress,
  icon,
  iconColor,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 999,
        backgroundColor: active ? PURPLE : "rgba(255,255,255,0.06)",
        borderWidth: 1,
        borderColor: active ? PURPLE : BORDER,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        {icon ? <Ionicons name={icon} size={13} color={iconColor || "#fff"} /> : null}
        <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }}>{label}</Text>
      </View>
    </Pressable>
  );
}

function SectionPill({
  label,
  active,
  onPress,
  icon,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        height: 46,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: active ? "rgba(124,58,237,0.22)" : "rgba(255,255,255,0.06)",
        borderWidth: 1,
        borderColor: active ? "rgba(124,58,237,0.55)" : BORDER,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
        {icon ? <Ionicons name={icon} size={15} color="#fff" /> : null}
        <Text style={{ color: "#fff", fontWeight: "900" }}>{label}</Text>
      </View>
    </Pressable>
  );
}

function SellerMini({ seller }: { seller?: SellerCard | null }) {
  if (!seller) return null;
  const logo = publicSellerLogo(seller.logo_path);
  return (
    <View style={{ marginTop: 10, flexDirection: "row", alignItems: "center", gap: 8 }}>
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 11,
          overflow: "hidden",
          backgroundColor: "rgba(255,255,255,0.08)",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {logo ? <Image source={{ uri: logo }} style={{ width: 22, height: 22 }} /> : <Ionicons name="person-outline" size={12} color="#fff" />}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5, flex: 1 }}>
        <Text numberOfLines={1} style={{ color: "rgba(255,255,255,0.78)", fontWeight: "800", fontSize: 11, flex: 1 }}>
          @{seller.market_username || "store"} - {seller.display_name || seller.business_name || "Business"}
        </Text>
        <VerifiedTick verified={seller.is_verified} />
      </View>
    </View>
  );
}

export default function MarketHome() {
  const insets = useSafeAreaInsets();
  const [section, setSection] = useState<FeedSection>("product");
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>("newest");
  const [directoryMode, setDirectoryMode] = useState<DirectoryMode>("listings");
  const [feedScope, setFeedScope] = useState<FeedScope>("country");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<ListingRow[]>([]);
  const [sellersMap, setSellersMap] = useState<Record<string, SellerCard>>({});
  const [statsMap, setStatsMap] = useState<Record<string, { completed: number; cancelled: number; failed: number }>>({});
  const [featuredSellers, setFeaturedSellers] = useState<SellerCard[]>([]);
  const [verifiedSellers, setVerifiedSellers] = useState<SellerCard[]>([]);
  const [userCountry, setUserCountry] = useState<UserCountry | null>(null);
  const [countryErr, setCountryErr] = useState<string | null>(null);
  const [locatingCountry, setLocatingCountry] = useState(false);

  const main = section === "service" ? "service" : "product";
  const categories = useMemo<CategoryItem[]>(() => getCategoriesByMain(main as MarketMainCategory), [main]);
  const supabaseUrl = (supabase as any)?.supabaseUrl ?? (process.env.EXPO_PUBLIC_SUPABASE_URL as string) ?? "";
  const locationLabel = useMemo(() => {
    if (!userCountry) return "Location unavailable";
    return formatCountryLabel(userCountry.name, userCountry.code) || "Unknown location";
  }, [userCountry]);

  async function refreshCountry() {
    setLocatingCountry(true);
    setCountryErr(null);
    try {
      const c = await resolveUserCountry({ prompt: true, refresh: true, ipOnly: true });
      if (c) {
        setUserCountry(c);
        return c;
      }

      const cached = await getCachedCountry();
      if (cached) {
        setUserCountry(cached);
        setCountryErr("Live IP location not detected. Showing last known location.");
        return cached;
      }

      setCountryErr("Location not detected. Use Global to view all listings.");
      return null;
    } catch (e: any) {
      const cached = await getCachedCountry();
      if (cached) {
        setUserCountry(cached);
        setCountryErr("Could not refresh live location. Showing last known location.");
        return cached;
      }

      setUserCountry(null);
      setCountryErr(String(e?.message || "We couldn't read your location."));
      return null;
    } finally {
      setLocatingCountry(false);
    }
  }

  async function loadDirectory() {
    const nowIso = new Date().toISOString();
    const selectCols = "user_id,market_username,display_name,business_name,bio,is_verified,logo_path,featured_enabled,featured_until,active";

    const fetchRows = async (table: string) => {
      const res = await supabase.from(table).select(selectCols).order("updated_at", { ascending: false }).limit(400);
      return (res.data ?? []) as SellerCard[];
    };

    let rows = await fetchRows("market_seller_public_profiles");
    if (!rows.length) rows = await fetchRows("market_seller_profiles");

    const featured = rows.filter((r: any) => {
      if (r?.active === false) return false;
      if (!r?.featured_enabled) return false;
      if (!r?.featured_until) return true;
      const until = new Date(String(r.featured_until)).toISOString();
      return until >= nowIso;
    });
    const verified = rows.filter((r: any) => r?.active !== false && !!r?.is_verified);

    setFeaturedSellers(featured);
    setVerifiedSellers(verified);
  }

  async function loadListings(countryOverride?: UserCountry | null) {
    setLoading(true);
    setErr(null);
    try {
      const effectiveCountry = countryOverride === undefined ? userCountry : countryOverride;
      const restrictToCrypto = !isNigeriaCountry(effectiveCountry?.code || effectiveCountry?.name);
      let query = supabase
        .from(LISTINGS_TABLE)
        .select(
          "id,seller_id,title,price_amount,currency,delivery_type,category,sub_category,created_at,payment_options,availability,stock_qty,cover:market_listing_images!market_listings_cover_image_fk(public_url,storage_path),images:market_listing_images!market_listing_images_listing_id_fkey(public_url,storage_path,sort_order)"
        )
        .eq("is_active", true)
        .eq("category", main)
        .order(sortBy === "newest" ? "created_at" : "price_amount", { ascending: sortBy === "price_low" })
        .limit(120);

      if (selectedSlug) query = query.eq("sub_category", selectedSlug);
      if (q.trim() && directoryMode === "listings") {
        query = query.or(`title.ilike.%${q.trim()}%,description.ilike.%${q.trim()}%`);
      }

      const { data, error } = await query;
      if (error) throw error;

      const items = ((data ?? []) as ListingRow[]).filter((r) => {
        const exp = r.payment_options?.expires_at;
        if (!exp) return true;
        const t = new Date(exp).getTime();
        return Number.isFinite(t) ? t > Date.now() : true;
      });
      const scopedBase =
        feedScope === "global"
          ? items
          : effectiveCountry
          ? items.filter((r) =>
              listingMatchesCountry(r.availability ?? r.payment_options?.availability, effectiveCountry, false),
            )
          : [];
      const scoped = restrictToCrypto ? scopedBase.filter((r) => listingAllowsCrypto(r)) : scopedBase;
      const uniq = new Map<string, ListingRow>();
      scoped.forEach((r) => {
        if (!uniq.has(r.id)) uniq.set(r.id, r);
      });
      setRows(Array.from(uniq.values()));

      const sellerIds = Array.from(new Set(scoped.map((r) => r.seller_id)));
      const listingIds = scoped.map((r) => r.id);

      const [sellerRes, ordersRes] = await Promise.all([
        sellerIds.length
          ? supabase
              .from("market_seller_public_profiles")
              .select("user_id,market_username,display_name,business_name,bio,is_verified,logo_path")
              .in("user_id", sellerIds)
          : Promise.resolve({ data: [] } as any),
        listingIds.length
          ? supabase
              .from("market_orders")
              .select("listing_id,status")
              .in("listing_id", listingIds)
              .in("status", ["DELIVERED", "RELEASED", "CANCELLED", "REFUNDED"])
          : Promise.resolve({ data: [] } as any),
      ]);

      const sellerMap: Record<string, SellerCard> = {};
      (sellerRes.data ?? []).forEach((s: any) => {
        sellerMap[String(s.user_id)] = s;
      });
      setSellersMap(sellerMap);

      const stats: Record<string, { completed: number; cancelled: number; failed: number }> = {};
      for (const id of listingIds) stats[id] = { completed: 0, cancelled: 0, failed: 0 };
      (ordersRes.data ?? []).forEach((o: any) => {
        const id = String(o.listing_id);
        if (!stats[id]) stats[id] = { completed: 0, cancelled: 0, failed: 0 };
        if (o.status === "DELIVERED" || o.status === "RELEASED") stats[id].completed += 1;
        else if (o.status === "CANCELLED") stats[id].cancelled += 1;
        else if (o.status === "REFUNDED") stats[id].failed += 1;
      });
      setStatsMap(stats);
    } catch (e: any) {
      setErr(friendlyMarketError(e, "We couldn't load marketplace listings."));
      setRows([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadDirectory();
  }, []);

  useEffect(() => {
    if (feedScope === "country") {
      refreshCountry();
    }
  }, [feedScope]);

  useEffect(() => {
    if (section !== "social") loadListings();
  }, [
    section,
    selectedSlug,
    sortBy,
    q,
    directoryMode,
    feedScope,
    userCountry?.code,
    userCountry?.name,
    userCountry?.region,
    userCountry?.city,
    userCountry?.lat,
    userCountry?.lng,
  ]);

  const directoryRows = useMemo(() => {
    const source = directoryMode === "featured" ? featuredSellers : verifiedSellers;
    const query = q.trim().toLowerCase();
    if (!query) return source;
    return source.filter((s) => {
      const text = `${s.market_username || ""} ${s.display_name || ""} ${s.business_name || ""} ${s.bio || ""}`.toLowerCase();
      if (query.startsWith("@")) {
        return (s.market_username || "").toLowerCase().includes(query.slice(1));
      }
      return text.includes(query);
    });
  }, [directoryMode, featuredSellers, verifiedSellers, q]);

  const renderListing = ({ item }: { item: ListingRow }) => {
    const firstImage = (item.images ?? [])
      .slice()
      .sort((a, b) => Number(a?.sort_order ?? 0) - Number(b?.sort_order ?? 0))[0];
    const coverUrl =
      item.cover?.public_url ??
      buildPublicFromStorage(supabaseUrl, item.cover?.storage_path ?? null) ??
      firstImage?.public_url ??
      buildPublicFromStorage(supabaseUrl, firstImage?.storage_path ?? null);
    const seller = sellersMap[item.seller_id];
    const stats = statsMap[item.id] ?? { completed: 0, cancelled: 0, failed: 0 };
    const displayPrice = getListingPriceDisplay(item as any);
    const showDiscount = displayPrice.hasDiscount;

    const isOutOfStock = item.category === "product" && typeof item.stock_qty === "number" && item.stock_qty <= 0;

    return (
      <Pressable
        onPress={() => router.push({ pathname: "/market/listing/[id]" as any, params: { id: item.id } })}
        style={{ width: "48%", borderRadius: 22, overflow: "hidden", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", backgroundColor: CARD }}
      >
        <View style={{ height: 180, backgroundColor: "rgba(255,255,255,0.06)" }}>
          {coverUrl ? <Image source={{ uri: coverUrl }} style={{ width: "100%", height: "100%" }} resizeMode="cover" /> : null}
          <View style={{ position: "absolute", bottom: 10, left: 10 }}>
            <View style={{ paddingHorizontal: 10, paddingVertical: 8, borderRadius: 14, backgroundColor: "rgba(0,0,0,0.6)", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)" }}>
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
          {isOutOfStock ? (
            <View style={{ position: "absolute", top: 10, right: 10, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: "rgba(239,68,68,0.75)" }}>
              <Text style={{ color: "#fff", fontWeight: "900", fontSize: 11 }}>Out of stock</Text>
            </View>
          ) : null}
        </View>

        <View style={{ padding: 12 }}>
          <Text numberOfLines={1} style={{ color: "#fff", fontWeight: "900", fontSize: 13 }}>{item.title ?? "Untitled"}</Text>
          {item.category === "product" && typeof item.stock_qty === "number" ? (
            <Text style={{ marginTop: 6, color: "rgba(255,255,255,0.7)", fontSize: 11 }}>
              Stock left: {Math.max(0, item.stock_qty)}
            </Text>
          ) : null}
          <Text style={{ marginTop: 8, color: "rgba(255,255,255,0.75)", fontSize: 11 }}>
            Sales {stats.completed} - Cancelled {stats.cancelled} - Failed {stats.failed}
          </Text>
          <SellerMini seller={seller} />
        </View>
      </Pressable>
    );
  };

  const renderSellerCard = ({ item }: { item: SellerCard }) => {
    const logo = publicSellerLogo(item.logo_path);
    return (
      <Pressable
        onPress={() => router.push(`/market/profile/${item.market_username}` as any)}
        style={{ borderRadius: 18, padding: 12, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, marginTop: 10 }}
      >
        <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
          <View style={{ width: 46, height: 46, borderRadius: 23, overflow: "hidden", backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" }}>
            {logo ? <Image source={{ uri: logo }} style={{ width: 46, height: 46 }} /> : <Ionicons name="person-outline" size={22} color="#fff" />}
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={{ color: "#fff", fontWeight: "900", flexShrink: 1 }} numberOfLines={1}>{item.business_name || item.display_name || "Business"}</Text>
              <VerifiedTick verified={item.is_verified} />
            </View>
            <Text style={{ color: "rgba(255,255,255,0.65)", fontSize: 12 }}>@{item.market_username || "profile"}</Text>
            <Text style={{ marginTop: 4, color: "rgba(255,255,255,0.55)", fontSize: 12 }} numberOfLines={2}>{item.bio || "No description yet."}</Text>
          </View>
        </View>
      </Pressable>
    );
  };

  return (
    <LinearGradient colors={[BG1, BG0]} start={{ x: 0.15, y: 0 }} end={{ x: 0.9, y: 1 }} style={{ flex: 1 }}>
      <InAppTutorial enabled={!loading} flow={tutorialFlows.marketHome} />
      <FlatList
        data={section === "social" ? [] : (directoryMode === "listings" ? rows : (directoryRows as any))}
        key={section === "social" ? "social" : directoryMode}
        keyExtractor={(it: any, idx) => String((it as any)?.id || (it as any)?.user_id || idx)}
        numColumns={section === "social" || directoryMode !== "listings" ? 1 : 2}
        columnWrapperStyle={section === "social" || directoryMode !== "listings" ? undefined : { paddingHorizontal: 16, justifyContent: "space-between", marginTop: 12 }}
        contentContainerStyle={{ paddingBottom: 28 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              if (section === "social") {
                setRefreshing(false);
                return;
              }
              if (directoryMode === "listings") {
                const c = feedScope === "country" ? await refreshCountry() : userCountry;
                await loadListings(c);
              }
              else await loadDirectory();
              setRefreshing(false);
            }}
          />
        }
        renderItem={section === "social" ? undefined : directoryMode === "listings" ? renderListing : (renderSellerCard as any)}
        ListHeaderComponent={
          <View style={{ paddingTop: Math.max(insets.top, 14), paddingHorizontal: 16 }}>
            <AppHeader title="Marketplace" subtitle="Products, services, and social feed" />

            <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
              <SectionPill
                icon="storefront-outline"
                label="Products"
                active={section === "product"}
                onPress={() => {
                  setSection("product");
                  setDirectoryMode("listings");
                  setSelectedSlug(null);
                }}
              />
              <SectionPill
                icon="construct-outline"
                label="Services"
                active={section === "service"}
                onPress={() => {
                  setSection("service");
                  setDirectoryMode("listings");
                  setSelectedSlug(null);
                }}
              />
              <SectionPill
                icon="people-outline"
                label="Social Feed"
                active={section === "social"}
                onPress={() => setSection("social")}
              />
            </View>

            <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
              <Pressable
                onPress={() => router.push("/market/search" as any)}
                style={{
                  flex: 1,
                  borderRadius: 14,
                  paddingVertical: 11,
                  alignItems: "center",
                  justifyContent: "center",
                  flexDirection: "row",
                  gap: 7,
                  backgroundColor: "rgba(255,255,255,0.07)",
                  borderWidth: 1,
                  borderColor: BORDER,
                }}
              >
                <Ionicons name="search-outline" size={16} color="#fff" />
                <Text style={{ color: "#fff", fontWeight: "900" }}>Search</Text>
              </Pressable>
              <Pressable
                onPress={() => router.push("/market/stock" as any)}
                style={{
                  flex: 1,
                  borderRadius: 14,
                  paddingVertical: 11,
                  alignItems: "center",
                  justifyContent: "center",
                  flexDirection: "row",
                  gap: 7,
                  backgroundColor: "rgba(45,212,191,0.20)",
                  borderWidth: 1,
                  borderColor: "rgba(45,212,191,0.50)",
                }}
              >
                <Ionicons name="trending-up-outline" size={16} color="#ECFEFF" />
                <Text style={{ color: "#ECFEFF", fontWeight: "900" }}>Digital Stock</Text>
              </Pressable>
            </View>

            <OfficialMarketSocials />

            {section === "social" ? (
              <View style={{ marginTop: 12, marginHorizontal: -16, backgroundColor: "#000", borderTopWidth: 1, borderBottomWidth: 1, borderColor: "rgba(255,255,255,0.08)" }}>
                <View
                  style={{
                    paddingHorizontal: 16,
                    paddingVertical: 14,
                    borderBottomWidth: 1,
                    borderBottomColor: "rgba(255,255,255,0.08)",
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: "#fff", fontWeight: "900", fontSize: 18 }}>Following timeline</Text>
                    <Text style={{ marginTop: 4, color: MUTED, fontSize: 12 }}>
                      Posts from accounts you follow and your own updates, styled like a real social feed.
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => router.push("/market/social" as any)}
                    style={{
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: "rgba(29,155,240,0.35)",
                      backgroundColor: "rgba(29,155,240,0.16)",
                      paddingHorizontal: 14,
                      paddingVertical: 10,
                    }}
                  >
                    <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }}>Open full feed</Text>
                  </Pressable>
                </View>

                <SocialFeed />
              </View>
            ) : (
              <>
                {directoryMode === "listings" ? (
                  <>
                    <View style={{ marginTop: 12, flexDirection: "row", gap: 10 }}>
                      <SectionPill
                        icon="location-outline"
                        label="My Country"
                        active={feedScope === "country"}
                        onPress={() => setFeedScope("country")}
                      />
                      <SectionPill
                        icon="earth-outline"
                        label="Global"
                        active={feedScope === "global"}
                        onPress={() => setFeedScope("global")}
                      />
                    </View>
                    <View style={{ marginTop: 10, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: BORDER, backgroundColor: CARD, flexDirection: "row", alignItems: "center", gap: 10 }}>
                      <Ionicons name="location-outline" size={18} color="rgba(255,255,255,0.78)" />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }}>{locationLabel}</Text>
                        <Text style={{ marginTop: 2, color: MUTED, fontSize: 11 }}>
                          {feedScope === "country"
                            ? "Country feed: local listings only, shown in local currency + USD approx."
                            : "Global feed: all available listings."}
                        </Text>
                      </View>
                      <Pressable
                        disabled={locatingCountry}
                        onPress={async () => {
                          const c = await refreshCountry();
                          if (feedScope === "country") await loadListings(c);
                        }}
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 12,
                          alignItems: "center",
                          justifyContent: "center",
                          backgroundColor: "rgba(255,255,255,0.08)",
                          borderWidth: 1,
                          borderColor: "rgba(255,255,255,0.12)",
                          opacity: locatingCountry ? 0.6 : 1,
                        }}
                      >
                        {locatingCountry ? <ActivityIndicator size="small" /> : <Ionicons name="refresh" size={15} color="#fff" />}
                      </Pressable>
                    </View>
                    {feedScope === "country" && !userCountry ? (
                      <View style={{ marginTop: 10, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: BORDER, backgroundColor: CARD }}>
                        <Text style={{ color: MUTED }}>
                          Enable location to see listings near you. You can still use the Global feed.
                        </Text>
                        {countryErr ? (
                          <Text style={{ marginTop: 6, color: "rgba(255,255,255,0.55)", fontSize: 12 }}>{countryErr}</Text>
                        ) : null}
                      </View>
                    ) : null}
                  </>
                ) : null}
                <View style={{ marginTop: 12, flexDirection: "row", gap: 10, alignItems: "center", borderRadius: 20, padding: 12, borderWidth: 1, borderColor: BORDER, backgroundColor: CARD }}>
                  <Ionicons name="search-outline" size={18} color="rgba(255,255,255,0.75)" />
                  <TextInput
                    value={q}
                    onChangeText={setQ}
                    placeholder="Search listings or @username"
                    placeholderTextColor="rgba(255,255,255,0.45)"
                    style={{ flex: 1, color: "#fff", fontWeight: "700" }}
                  />
                </View>

                <View style={{ marginTop: 12, flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
                  <Chip
                    label="Listings"
                    icon="grid-outline"
                    active={directoryMode === "listings"}
                    onPress={() => setDirectoryMode("listings")}
                  />
                  <Chip
                    label="🔥 Featured"
                    icon="flame"
                    iconColor="#FDBA74"
                    active={directoryMode === "featured"}
                    onPress={() => setDirectoryMode("featured")}
                  />
                  <Chip
                    label="Verified"
                    icon="checkmark-circle"
                    iconColor="#60A5FA"
                    active={directoryMode === "verified"}
                    onPress={() => setDirectoryMode("verified")}
                  />
                </View>

                {directoryMode === "listings" ? (
                  <>
                    <View style={{ marginTop: 12 }}>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                        <Chip label="All" active={!selectedSlug} onPress={() => setSelectedSlug(null)} />
                        {categories.map((c) => (
                          <View key={c.slug} style={{ marginLeft: 10 }}>
                            <Chip label={c.title} active={selectedSlug === c.slug} onPress={() => setSelectedSlug(c.slug)} />
                          </View>
                        ))}
                      </ScrollView>
                    </View>

                    <View style={{ marginTop: 10, flexDirection: "row", gap: 10 }}>
                      <Chip label="Newest" active={sortBy === "newest"} onPress={() => setSortBy("newest")} />
                      <Chip label="Price Low" active={sortBy === "price_low"} onPress={() => setSortBy("price_low")} />
                      <Chip label="Price High" active={sortBy === "price_high"} onPress={() => setSortBy("price_high")} />
                    </View>
                  </>
                ) : null}

                {loading ? (
                  <View style={{ paddingVertical: 18, alignItems: "center" }}>
                    <ActivityIndicator />
                    <Text style={{ marginTop: 10, color: "rgba(255,255,255,0.7)", fontWeight: "800" }}>Loading...</Text>
                  </View>
                ) : err ? (
                  <View style={{ marginTop: 14, borderRadius: 16, padding: 12, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
                    <Text style={{ color: "#fff", fontWeight: "900" }}>Couldn&apos;t load data</Text>
                    <Text style={{ marginTop: 6, color: MUTED }}>{err}</Text>
                  </View>
                ) : null}
              </>
            )}
          </View>
        }
        ListEmptyComponent={
          !loading && section !== "social" ? (
            <View style={{ marginTop: 14, marginHorizontal: 16, borderRadius: 16, padding: 12, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
              <Text style={{ color: "#fff", fontWeight: "900" }}>No results</Text>
              <Text style={{ marginTop: 6, color: MUTED }}>Try another filter or search.</Text>
            </View>
          ) : null
        }
      />
    </LinearGradient>
  );
}
