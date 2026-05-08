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
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import AppHeader from "@/components/common/AppHeader";
import ListingOriginBadge from "@/components/market/ListingOriginBadge";
import MarketMediaView from "@/components/market/MarketMediaView";
import NotificationBell from "@/components/market/NotificationBell";
import { InAppTutorial } from "@/components/onboarding/InAppTutorial";
import OfficialMarketSocials from "@/components/market/OfficialMarketSocials";
import SocialFeed from "@/components/market/SocialFeed";
import { CategoryItem, getCategoriesByMain, MarketMainCategory } from "@/services/market/categories";
import { tutorialFlows } from "@/services/onboarding/definitions";
import { supabase } from "@/services/supabase";
import { friendlyMarketError } from "@/utils/marketUx";
import { resolveMarketMediaSource, sortMarketMedia } from "@/utils/marketMedia";
import { getCachedCountry, listingMatchesCountry, resolveUserCountry, type UserCountry } from "@/utils/country";
import { formatCurrency, getListingPriceDisplay } from "@/utils/pricing";
import { formatCountryLabel } from "@/utils/countryNames";

const BG0 = "#05040B";
const BG1 = "#0A0620";
const PURPLE = "#7C3AED";
const AMBER = "#F59E0B";
const TEAL = "#14B8A6";
const CARD = "rgba(255,255,255,0.06)";
const BORDER = "rgba(255,255,255,0.10)";
const MUTED = "rgba(255,255,255,0.65)";

const LISTINGS_TABLE = "market_listings";
const LISTING_IMAGES_BUCKET = "market-listings";

type SortBy = "newest" | "price_low" | "price_high";
type FeedSection = "all" | "product" | "service" | "social";
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
  cover?: { public_url?: string | null; storage_path?: string | null; meta?: any } | null;
  images?: { public_url?: string | null; storage_path?: string | null; sort_order?: number | null; meta?: any }[] | null;
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
  stretch = true,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  stretch?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: stretch ? 1 : undefined,
        minWidth: stretch ? undefined : 106,
        height: 46,
        borderRadius: 16,
        paddingHorizontal: stretch ? 8 : 14,
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

function QuickAction({
  label,
  subtitle,
  icon,
  onPress,
  accent = PURPLE,
}: {
  label: string;
  subtitle?: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  accent?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        minWidth: 132,
        borderRadius: 16,
        padding: 12,
        borderWidth: 1,
        borderColor: `${accent}66`,
        backgroundColor: `${accent}22`,
      }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 12,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: `${accent}33`,
          borderWidth: 1,
          borderColor: `${accent}66`,
        }}
      >
        <Ionicons name={icon} size={17} color="#fff" />
      </View>
      <Text style={{ marginTop: 10, color: "#fff", fontWeight: "900", fontSize: 13 }}>{label}</Text>
      {subtitle ? (
        <Text style={{ marginTop: 4, color: "rgba(255,255,255,0.68)", fontSize: 11 }}>{subtitle}</Text>
      ) : null}
    </Pressable>
  );
}

function MarketMetric({
  label,
  value,
  icon,
  tone = PURPLE,
}: {
  label: string;
  value: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone?: string;
}) {
  return (
    <View
      style={{
        flex: 1,
        minWidth: 104,
        borderRadius: 14,
        padding: 12,
        borderWidth: 1,
        borderColor: `${tone}38`,
        backgroundColor: "rgba(255,255,255,0.045)",
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
        <Ionicons name={icon} size={14} color={tone} />
        <Text style={{ color: "rgba(255,255,255,0.62)", fontWeight: "800", fontSize: 11 }}>{label}</Text>
      </View>
      <Text style={{ marginTop: 7, color: "#fff", fontWeight: "900", fontSize: 18 }} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function SellerMini({ seller, compact = false }: { seller?: SellerCard | null; compact?: boolean }) {
  if (!seller) return null;
  const logo = publicSellerLogo(seller.logo_path);
  const primaryLabel = seller.market_username
    ? `@${seller.market_username}`
    : seller.display_name || seller.business_name || "Store";
  const secondaryLabel =
    seller.market_username && !compact ? seller.display_name || seller.business_name || null : null;
  const avatarSize = compact ? 18 : 22;
  return (
    <View style={{ marginTop: compact ? 10 : 12, flexDirection: "row", alignItems: "center", gap: compact ? 6 : 8 }}>
      <View
        style={{
          width: avatarSize,
          height: avatarSize,
          borderRadius: avatarSize / 2,
          overflow: "hidden",
          backgroundColor: "rgba(255,255,255,0.08)",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {logo ? (
          <Image source={{ uri: logo }} style={{ width: avatarSize, height: avatarSize }} />
        ) : (
          <Ionicons name="person-outline" size={compact ? 10 : 12} color="#fff" />
        )}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5, flex: 1 }}>
        <Text
          numberOfLines={1}
          style={{
            color: "rgba(255,255,255,0.78)",
            fontWeight: "800",
            fontSize: compact ? 10 : 11,
            flex: 1,
          }}
        >
          {secondaryLabel ? `${primaryLabel} • ${secondaryLabel}` : primaryLabel}
        </Text>
        <VerifiedTick verified={seller.is_verified} />
      </View>
    </View>
  );
}

function CardBadge({
  label,
  icon,
  tone = "neutral",
}: {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  tone?: "neutral" | "purple" | "gold" | "green" | "red";
}) {
  const tones = {
    neutral: {
      bg: "rgba(8,11,24,0.62)",
      border: "rgba(255,255,255,0.14)",
    },
    purple: {
      bg: "rgba(124,58,237,0.22)",
      border: "rgba(196,181,253,0.38)",
    },
    gold: {
      bg: "rgba(245,158,11,0.20)",
      border: "rgba(253,186,116,0.35)",
    },
    green: {
      bg: "rgba(16,185,129,0.20)",
      border: "rgba(52,211,153,0.35)",
    },
    red: {
      bg: "rgba(239,68,68,0.22)",
      border: "rgba(252,165,165,0.35)",
    },
  } as const;

  const colors = tones[tone];
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 999,
        backgroundColor: colors.bg,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      {icon ? <Ionicons name={icon} size={12} color="#fff" /> : null}
      <Text style={{ color: "#fff", fontWeight: "900", fontSize: 11 }}>{label}</Text>
    </View>
  );
}

export default function MarketHome() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [section, setSection] = useState<FeedSection>("all");
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

  const main = section === "service" ? "service" : section === "product" ? "product" : null;
  const isDesktop = width >= 980;
  const pagePadding = width >= 820 ? 24 : 16;
  const contentMaxWidth = width >= 1240 ? 1120 : undefined;
  const mobileActionStack = width < 390;
  const categories = useMemo<CategoryItem[]>(
    () => (main ? getCategoriesByMain(main as MarketMainCategory) : []),
    [main],
  );
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
      let query = supabase
        .from(LISTINGS_TABLE)
        .select(
          "id,seller_id,title,price_amount,currency,delivery_type,category,sub_category,created_at,payment_options,availability,stock_qty,cover:market_listing_images!market_listings_cover_image_fk(public_url,storage_path,meta),images:market_listing_images!market_listing_images_listing_id_fkey(public_url,storage_path,sort_order,meta)"
        )
        .eq("is_active", true)
        .order(sortBy === "newest" ? "created_at" : "price_amount", { ascending: sortBy === "price_low" })
        .limit(120);

      if (main) query = query.eq("category", main);
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
      const scoped = scopedBase;
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
  const isListingDirectory = section !== "social" && directoryMode === "listings";
  const responsiveListingColumns = width >= 1120 ? 3 : width >= 700 ? 2 : 1;
  const listingColumns = isListingDirectory ? responsiveListingColumns : 1;
  const listingCardWidth = listingColumns === 1 ? undefined : listingColumns === 2 ? "48.6%" : "31.7%";
  const listingMediaHeight =
    listingColumns === 1
      ? Math.min(280, Math.max(210, Math.round(width * 0.58)))
      : listingColumns === 2
      ? 194
      : 178;
  const contentBottomPadding = isDesktop ? 38 : Math.max(122, insets.bottom + 102);
  const resultCount = directoryMode === "listings" ? rows.length : directoryRows.length;
  const feedLabel = section === "service" ? "services" : section === "product" ? "products" : "listings";
  const searchPlaceholder =
    directoryMode === "listings"
      ? `Filter ${feedLabel} in this feed`
      : "Search stores or @username";
  const heroTitle =
    section === "social"
      ? "Stay close to marketplace activity"
      : section === "service"
      ? "Hire trusted services"
      : section === "product"
      ? "Shop trusted products"
      : "Discover trusted listings";
  const heroSubtitle =
    section === "social"
      ? "Follow updates, discover official channels, and jump into the full social feed when you need it."
      : section === "service"
      ? "Browse service providers, compare offers, and move into escrow-backed checkout when you're ready."
      : section === "product"
      ? "Discover local and global listings, compare prices quickly, and buy through escrow-backed checkout."
      : "Browse products and services together, compare prices fast, and move into escrow-backed checkout when you're ready.";
  const resultTitle =
    directoryMode === "listings"
      ? `${resultCount} ${feedLabel} in view`
      : directoryMode === "featured"
      ? `${resultCount} featured stores`
      : `${resultCount} verified stores`;
  const resultSubtitle =
    directoryMode === "listings"
      ? feedScope === "country"
        ? userCountry
          ? `Showing ${feedLabel} matched to ${locationLabel}.`
          : `Waiting for your location before showing ${feedLabel} for your country.`
        : `Showing ${feedLabel} from every country in the marketplace.`
      : directoryMode === "featured"
      ? "Browse promoted storefronts first."
      : "Browse stores with verified seller profiles.";

  const renderListing = ({ item }: { item: ListingRow }) => {
    const mediaSource = resolveMarketMediaSource(
      [item.cover ?? null, ...sortMarketMedia(item.images ?? [])],
      supabaseUrl,
      LISTING_IMAGES_BUCKET,
    );
    const coverUrl = mediaSource?.url ?? null;
    const coverKind = mediaSource?.kind ?? "image";
    const seller = sellersMap[item.seller_id];
    const stats = statsMap[item.id] ?? { completed: 0, cancelled: 0, failed: 0 };
    const displayPrice = getListingPriceDisplay(item as any);
    const showDiscount = displayPrice.hasDiscount;

    const isOutOfStock = item.category === "product" && typeof item.stock_qty === "number" && item.stock_qty <= 0;
    const categoryLabel = item.category === "service" ? "Service" : "Product";
    const deliveryLabel = String(item.delivery_type || "delivery").replace(/_/g, " ");
    const freshnessLabel = stats.completed > 0 ? `${stats.completed} sold` : "Fresh";

    return (
      <Pressable
        onPress={() => router.push({ pathname: "/market/listing/[id]" as any, params: { id: item.id } })}
        style={{
          width: listingCardWidth as any,
          marginHorizontal: listingColumns === 1 ? pagePadding : 0,
          marginTop: 12,
          borderRadius: 18,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.08)",
          backgroundColor: "rgba(11,10,24,0.96)",
          shadowColor: "#000",
          shadowOpacity: 0.18,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 10 },
          elevation: 6,
        }}
      >
        <View style={{ height: listingMediaHeight, backgroundColor: "rgba(255,255,255,0.06)" }}>
          {coverUrl ? (
            <MarketMediaView
              uri={coverUrl}
              kind={coverKind}
              style={{ width: "100%", height: "100%" }}
              resizeMode={coverKind === "video" ? "contain" : "cover"}
              autoplay={coverKind === "video"}
              muted
              loop={coverKind === "video"}
              disablePointerEvents
            />
          ) : (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 10 }}>
              <Ionicons name={coverKind === "video" ? "videocam-outline" : "image-outline"} size={30} color="rgba(255,255,255,0.55)" />
              <Text style={{ color: "rgba(255,255,255,0.58)", fontWeight: "800", fontSize: 12 }}>
                Preview unavailable
              </Text>
            </View>
          )}

          <LinearGradient
            colors={["rgba(5,4,11,0.08)", "rgba(5,4,11,0.12)", "rgba(5,4,11,0.30)"]}
            locations={[0, 0.35, 1]}
            style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
          />

          <View
            style={{
              position: "absolute",
              top: 12,
              left: 12,
              right: 12,
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 8,
            }}
          >
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, flex: 1 }}>
              <CardBadge
                label={categoryLabel}
                icon={item.category === "service" ? "construct-outline" : "cube-outline"}
                tone="purple"
              />
              <ListingOriginBadge
                availability={item.availability}
                paymentOptions={item.payment_options}
                compact
                tone="overlay"
              />
            </View>
            {isOutOfStock ? (
              <CardBadge label="Out" icon="alert-circle-outline" tone="red" />
            ) : (
              <CardBadge
                label={freshnessLabel}
                icon={stats.completed > 0 ? "trending-up-outline" : "time-outline"}
                tone={stats.completed > 0 ? "green" : "neutral"}
              />
            )}
          </View>

          {coverKind === "video" ? (
            <View
              style={{
                position: "absolute",
                right: 14,
                bottom: 14,
                width: 42,
                height: 42,
                borderRadius: 21,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "rgba(0,0,0,0.54)",
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.12)",
              }}
            >
              <Ionicons name="play" size={18} color="#fff" />
            </View>
          ) : null}
        </View>

        <View
          style={{
            paddingHorizontal: 12,
            paddingTop: 12,
            paddingBottom: 12,
            backgroundColor: "rgba(14,12,28,0.94)",
          }}
        >
          <View style={{ minHeight: 58 }}>
            <Text numberOfLines={2} style={{ color: "#fff", fontWeight: "900", fontSize: 14, lineHeight: 19 }}>
              {item.title ?? "Untitled"}
            </Text>
            <Text style={{ marginTop: 4, color: "rgba(255,255,255,0.66)", fontSize: 11 }} numberOfLines={1}>
              {item.sub_category || categoryLabel} • {deliveryLabel}
            </Text>
          </View>

          <View style={{ marginTop: 10, minHeight: showDiscount ? 48 : 38 }}>
            {showDiscount ? (
              <Text
                style={{
                  color: "rgba(255,255,255,0.45)",
                  textDecorationLine: "line-through",
                  fontWeight: "800",
                  fontSize: 10,
                }}
              >
                {formatCurrency(displayPrice.localCurrency, displayPrice.localWas)}
              </Text>
            ) : null}
            <Text style={{ marginTop: showDiscount ? 2 : 0, color: "#fff", fontWeight: "900", fontSize: 18 }}>
              {formatCurrency(displayPrice.localCurrency, displayPrice.localNow)}
            </Text>
            <Text style={{ marginTop: 2, color: showDiscount ? "#FCA5A5" : "rgba(255,255,255,0.66)", fontWeight: "800", fontSize: 11 }}>
              USD {formatCurrency("USD", displayPrice.usdNow)}
            </Text>
          </View>

          <View style={{ marginTop: 10, flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {item.category === "product" && typeof item.stock_qty === "number" ? (
              <CardBadge
                label={`Stock ${Math.max(0, item.stock_qty)}`}
                icon="layers-outline"
                tone={isOutOfStock ? "red" : "neutral"}
              />
            ) : (
              <CardBadge
                label={deliveryLabel}
                icon={item.category === "service" ? "flash-outline" : "cube-outline"}
              />
            )}
            <CardBadge
              label={coverKind === "video" ? "Video" : "Image"}
              icon={coverKind === "video" ? "videocam-outline" : "image-outline"}
            />
            {showDiscount ? <CardBadge label="Sale" icon="pricetag-outline" tone="gold" /> : null}
          </View>
          <SellerMini seller={seller} compact />
        </View>
      </Pressable>
    );
  };

  const renderSellerCard = ({ item }: { item: SellerCard }) => {
    const logo = publicSellerLogo(item.logo_path);
    return (
      <Pressable
        onPress={() => router.push(`/market/profile/${item.market_username}` as any)}
        style={{
          marginHorizontal: pagePadding,
          borderRadius: 16,
          padding: 12,
          backgroundColor: CARD,
          borderWidth: 1,
          borderColor: BORDER,
          marginTop: 10,
        }}
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
        key={section === "social" ? "social" : `${directoryMode}-${listingColumns}`}
        keyExtractor={(it: any, idx) => String((it as any)?.id || (it as any)?.user_id || idx)}
        numColumns={listingColumns}
        columnWrapperStyle={
          listingColumns > 1
            ? {
                paddingHorizontal: pagePadding,
                justifyContent: "space-between",
                alignSelf: "center",
                width: "100%",
                maxWidth: contentMaxWidth,
              }
            : undefined
        }
        contentContainerStyle={{ paddingBottom: contentBottomPadding, paddingTop: 2 }}
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
          <View style={{ paddingHorizontal: pagePadding, alignSelf: "center", width: "100%", maxWidth: contentMaxWidth }}>
            <AppHeader
              title="Marketplace"
              subtitle={section === "social" ? "Community, official channels, and marketplace updates" : "Escrow-protected buying and selling"}
              showAccount={false}
              rightSlot={<NotificationBell />}
            />

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginTop: 10, marginHorizontal: -pagePadding }}
              contentContainerStyle={{ paddingHorizontal: pagePadding, gap: 10 }}
            >
              <SectionPill
                icon="apps-outline"
                label="All"
                active={section === "all"}
                stretch={false}
                onPress={() => {
                  setSection("all");
                  setDirectoryMode("listings");
                  setSelectedSlug(null);
                }}
              />
              <SectionPill
                icon="storefront-outline"
                label="Products"
                active={section === "product"}
                stretch={false}
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
                stretch={false}
                onPress={() => {
                  setSection("service");
                  setDirectoryMode("listings");
                  setSelectedSlug(null);
                }}
              />
              <SectionPill
                icon="people-outline"
                label="Social"
                active={section === "social"}
                stretch={false}
                onPress={() => setSection("social")}
              />
            </ScrollView>

            {section !== "social" ? (
              <View
                style={{
                  marginTop: 12,
                  flexDirection: "row",
                  gap: 10,
                  alignItems: "center",
                  borderRadius: 18,
                  padding: 12,
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.12)",
                  backgroundColor: "rgba(255,255,255,0.07)",
                }}
              >
                <Ionicons name="search-outline" size={19} color="rgba(255,255,255,0.78)" />
                <TextInput
                  value={q}
                  onChangeText={setQ}
                  placeholder={searchPlaceholder}
                  placeholderTextColor="rgba(255,255,255,0.45)"
                  returnKeyType="search"
                  onSubmitEditing={() =>
                    router.push({ pathname: "/market/search" as any, params: q.trim() ? { q: q.trim() } : {} })
                  }
                  style={{ flex: 1, minWidth: 0, color: "#fff", fontWeight: "800", fontSize: 14 }}
                />
                {q.trim() ? (
                  <Pressable
                    onPress={() => setQ("")}
                    hitSlop={8}
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 12,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: "rgba(255,255,255,0.08)",
                    }}
                  >
                    <Ionicons name="close" size={17} color="#fff" />
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={() => router.push({ pathname: "/market/search" as any, params: q.trim() ? { q: q.trim() } : {} })}
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 13,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: "rgba(124,58,237,0.28)",
                    borderWidth: 1,
                    borderColor: "rgba(124,58,237,0.45)",
                  }}
                >
                  <Ionicons name="arrow-forward" size={17} color="#fff" />
                </Pressable>
              </View>
            ) : null}

            {section === "social" ? (
              <>
                <View
                  style={{
                    marginTop: 12,
                    borderRadius: 18,
                    padding: 16,
                    backgroundColor: CARD,
                    borderWidth: 1,
                    borderColor: BORDER,
                  }}
                >
                  <Text style={{ color: "rgba(255,255,255,0.56)", fontWeight: "800", fontSize: 11 }}>SELLER BOARD</Text>
                  <Text style={{ marginTop: 6, color: "#fff", fontWeight: "900", fontSize: 22 }}>{heroTitle}</Text>
                  <Text style={{ marginTop: 6, color: MUTED, lineHeight: 20 }} numberOfLines={2}>
                    {heroSubtitle}
                  </Text>
                </View>

                <View
                  style={{
                    marginTop: 10,
                    flexDirection: mobileActionStack ? "column" : "row",
                    gap: 10,
                  }}
                >
                  <QuickAction
                    label="Seller Board"
                    icon="chatbubbles-outline"
                    accent={AMBER}
                    onPress={() => router.push("/market/social" as any)}
                  />
                  <QuickAction
                    label="Shopping"
                    icon="storefront-outline"
                    accent="#0EA5E9"
                    onPress={() => {
                      setSection("all");
                      setDirectoryMode("listings");
                      setSelectedSlug(null);
                    }}
                  />
                </View>

                <OfficialMarketSocials />

                <View style={{ marginTop: 12, marginHorizontal: -pagePadding, backgroundColor: "#120E0C", borderTopWidth: 1, borderBottomWidth: 1, borderColor: "rgba(255,255,255,0.08)" }}>
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
                      <Text style={{ color: "#fff", fontWeight: "900", fontSize: 18 }}>Seller board</Text>
                      <Text style={{ marginTop: 4, color: MUTED, fontSize: 12 }}>
                        Storefront updates, launches, and media from sellers you follow.
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => router.push("/market/social" as any)}
                      style={{
                        borderRadius: 999,
                        borderWidth: 1,
                        borderColor: "rgba(245,158,11,0.35)",
                        backgroundColor: "rgba(245,158,11,0.16)",
                        paddingHorizontal: 14,
                        paddingVertical: 10,
                      }}
                    >
                      <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }}>Open seller board</Text>
                    </Pressable>
                  </View>

                  <SocialFeed />
                </View>
              </>
            ) : (
              <>
                <View
                  style={{
                    marginTop: 12,
                    borderRadius: 18,
                    padding: 16,
                    backgroundColor: CARD,
                    borderWidth: 1,
                    borderColor: BORDER,
                  }}
                >
                  <Text style={{ color: "rgba(255,255,255,0.56)", fontWeight: "800", fontSize: 11 }}>
                    {section === "service" ? "SERVICES" : "PRODUCTS"}
                  </Text>
                  <Text style={{ marginTop: 6, color: "#fff", fontWeight: "900", fontSize: 22 }}>{heroTitle}</Text>
                  <Text style={{ marginTop: 6, color: MUTED, lineHeight: 20 }} numberOfLines={2}>
                    {heroSubtitle}
                  </Text>

                  <View
                    style={{
                      marginTop: 14,
                      flexDirection: mobileActionStack ? "column" : "row",
                      gap: 10,
                      flexWrap: "wrap",
                    }}
                  >
                    <MarketMetric
                      label="In view"
                      value={String(resultCount)}
                      icon={directoryMode === "listings" ? "grid-outline" : "people-outline"}
                    />
                    <MarketMetric
                      label="Scope"
                      value={directoryMode === "listings" ? (feedScope === "country" ? "Local" : "Global") : "Stores"}
                      icon={feedScope === "country" ? "location-outline" : "earth-outline"}
                      tone={AMBER}
                    />
                    <MarketMetric
                      label="Verified"
                      value={String(verifiedSellers.length)}
                      icon="checkmark-circle-outline"
                      tone="#60A5FA"
                    />
                  </View>
                </View>

                <View
                  style={{
                    marginTop: 10,
                    flexDirection: mobileActionStack ? "column" : "row",
                    gap: 10,
                  }}
                >
                  <QuickAction
                    label={section === "all" ? "Products" : "Categories"}
                    icon={section === "all" ? "storefront-outline" : "grid-outline"}
                    onPress={() => {
                      if (section === "all") {
                        setSection("product");
                        setDirectoryMode("listings");
                        setSelectedSlug(null);
                        return;
                      }
                      router.push({
                        pathname: "/market/category" as any,
                        params: { mode: section === "service" ? "service" : "product" },
                      });
                    }}
                  />
                  <QuickAction
                    label="Stock Market"
                    icon="trending-up-outline"
                    accent={TEAL}
                    onPress={() => router.push("/market/stock" as any)}
                  />
                </View>

                <View
                  style={{
                    marginTop: 12,
                    borderRadius: 18,
                    padding: 14,
                    borderWidth: 1,
                    borderColor: BORDER,
                    backgroundColor: CARD,
                  }}
                >
                  <Text style={{ color: "rgba(255,255,255,0.56)", fontWeight: "800", fontSize: 11 }}>
                    {directoryMode === "listings" ? "DISCOVERY" : "SELLER DIRECTORY"}
                  </Text>

                  <View style={{ marginTop: 6, flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: "#fff", fontWeight: "900", fontSize: 18 }}>{resultTitle}</Text>
                      <Text style={{ marginTop: 4, color: MUTED, fontSize: 12 }}>{resultSubtitle}</Text>
                    </View>
                    <View
                      style={{
                        minWidth: 48,
                        borderRadius: 999,
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: "rgba(124,58,237,0.18)",
                        borderWidth: 1,
                        borderColor: "rgba(124,58,237,0.38)",
                      }}
                    >
                      <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }}>{resultCount}</Text>
                    </View>
                  </View>

                  <View style={{ marginTop: 12, flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
                    <Chip
                      label="Listings"
                      icon="grid-outline"
                      active={directoryMode === "listings"}
                      onPress={() => setDirectoryMode("listings")}
                    />
                    <Chip
                      label="Featured Stores"
                      icon="flame"
                      iconColor="#FDBA74"
                      active={directoryMode === "featured"}
                      onPress={() => setDirectoryMode("featured")}
                    />
                    <Chip
                      label="Verified Stores"
                      icon="checkmark-circle"
                      iconColor="#60A5FA"
                      active={directoryMode === "verified"}
                      onPress={() => setDirectoryMode("verified")}
                    />
                  </View>
                </View>

                {isListingDirectory ? (
                  <View
                    style={{
                      marginTop: 12,
                      borderRadius: 18,
                      padding: 14,
                      borderWidth: 1,
                      borderColor: BORDER,
                      backgroundColor: CARD,
                    }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: "#fff", fontWeight: "900", fontSize: 14 }}>Feed scope</Text>
                        <Text style={{ marginTop: 4, color: MUTED, fontSize: 12 }}>
                          {feedScope === "country"
                            ? "Showing only listings matched to your current country."
                            : "Showing every listing currently available in the marketplace."}
                        </Text>
                      </View>
                      <Pressable
                        disabled={locatingCountry}
                        onPress={async () => {
                          const c = await refreshCountry();
                          if (feedScope === "country") await loadListings(c);
                        }}
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: 14,
                          alignItems: "center",
                          justifyContent: "center",
                          backgroundColor: "rgba(255,255,255,0.08)",
                          borderWidth: 1,
                          borderColor: "rgba(255,255,255,0.12)",
                          opacity: locatingCountry ? 0.6 : 1,
                        }}
                      >
                        {locatingCountry ? <ActivityIndicator size="small" /> : <Ionicons name="refresh" size={16} color="#fff" />}
                      </Pressable>
                    </View>

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

                    <View style={{ marginTop: 10, borderRadius: 16, padding: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.10)", backgroundColor: "rgba(255,255,255,0.04)", flexDirection: "row", alignItems: "center", gap: 10 }}>
                      <Ionicons name="location-outline" size={18} color="rgba(255,255,255,0.78)" />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }}>{locationLabel}</Text>
                        <Text style={{ marginTop: 2, color: MUTED, fontSize: 11 }}>
                          {feedScope === "country"
                            ? "Local listings show local currency plus USD reference."
                            : "Global feed shows listings from every country."}
                        </Text>
                      </View>
                    </View>

                    {feedScope === "country" && !userCountry ? (
                      <View style={{ marginTop: 10, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: BORDER, backgroundColor: "rgba(255,255,255,0.04)" }}>
                        <Text style={{ color: MUTED }}>
                          Enable location to see listings near you. You can still use the Global feed.
                        </Text>
                        {countryErr ? (
                          <Text style={{ marginTop: 6, color: "rgba(255,255,255,0.55)", fontSize: 12 }}>{countryErr}</Text>
                        ) : null}
                      </View>
                    ) : null}

                    {categories.length ? (
                      <>
                        <Text style={{ marginTop: 14, color: "#fff", fontWeight: "900", fontSize: 13 }}>Categories</Text>
                        <View style={{ marginTop: 8 }}>
                          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                            <Chip label="All" active={!selectedSlug} onPress={() => setSelectedSlug(null)} />
                            {categories.map((c) => (
                              <View key={c.slug} style={{ marginLeft: 10 }}>
                                <Chip label={c.title} active={selectedSlug === c.slug} onPress={() => setSelectedSlug(c.slug)} />
                              </View>
                            ))}
                          </ScrollView>
                        </View>
                      </>
                    ) : (
                      <View style={{ marginTop: 14, borderRadius: 16, padding: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.10)", backgroundColor: "rgba(255,255,255,0.04)" }}>
                        <Text style={{ color: "#fff", fontWeight: "900", fontSize: 13 }}>All listing types</Text>
                        <Text style={{ marginTop: 4, color: MUTED, fontSize: 12 }}>
                          This view mixes products and services together. Switch above when you want category-specific browsing.
                        </Text>
                      </View>
                    )}

                    <Text style={{ marginTop: 14, color: "#fff", fontWeight: "900", fontSize: 13 }}>Sort</Text>
                    <View style={{ marginTop: 8, flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
                      <Chip label="Newest" active={sortBy === "newest"} onPress={() => setSortBy("newest")} />
                      <Chip label="Price Low" active={sortBy === "price_low"} onPress={() => setSortBy("price_low")} />
                      <Chip label="Price High" active={sortBy === "price_high"} onPress={() => setSortBy("price_high")} />
                    </View>
                  </View>
                ) : (
                  <View
                    style={{
                      marginTop: 12,
                      borderRadius: 18,
                      padding: 14,
                      borderWidth: 1,
                      borderColor: BORDER,
                      backgroundColor: CARD,
                    }}
                  >
                    <Text style={{ color: "#fff", fontWeight: "900", fontSize: 13 }}>Store discovery</Text>
                    <Text style={{ marginTop: 6, color: MUTED, fontSize: 12 }}>
                      Featured and verified directories help buyers assess a store before opening the full profile.
                    </Text>
                  </View>
                )}

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
              <Text style={{ marginTop: 6, color: MUTED }}>
                Try another filter, switch listing type, or use the Global feed.
              </Text>
            </View>
          ) : null
        }
      />
    </LinearGradient>
  );
}
