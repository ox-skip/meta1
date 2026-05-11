import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Platform,
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
import { fetchJsonWithTimeout, getSupabaseAnonKeyOrThrow, getSupabaseFunctionsBaseUrl } from "@/services/net";
import { tutorialFlows } from "@/services/onboarding/definitions";
import { supabase } from "@/services/supabase";
import { friendlyMarketError } from "@/utils/marketUx";
import { resolveMarketMediaSource, sortMarketMedia } from "@/utils/marketMedia";
import { getCachedCountry, listingMatchesCountry, resolveUserCountry, type UserCountry } from "@/utils/country";
import { formatCurrency, getListingPriceDisplay } from "@/utils/pricing";
import { formatCountryLabel } from "@/utils/countryNames";

const BG0 = "#060807";
const BG1 = "#10130E";
const BG2 = "#171A13";
const INK = "#090D0B";
const PURPLE = "#8B5CF6";
const AMBER = "#F4B75D";
const TEAL = "#2DD4BF";
const BLUE = "#38BDF8";
const ROSE = "#FB7185";
const CARD = "rgba(255,253,247,0.065)";
const CARD_RAISED = "rgba(255,253,247,0.09)";
const BORDER = "rgba(255,253,247,0.12)";
const BORDER_TOP = "rgba(255,253,247,0.24)";
const TEXT = "#FFFDF7";
const MUTED = "rgba(255,253,247,0.68)";
const FAINT = "rgba(255,253,247,0.44)";

const LISTINGS_TABLE = "market_listings";
const LISTING_IMAGES_BUCKET = "market-listings";
const LISTING_FETCH_LIMIT = 500;
const LISTING_RICH_SELECT =
  "id,seller_id,title,description,price_amount,currency,delivery_type,category,sub_category,created_at,payment_options,availability,stock_qty,cover:market_listing_images!market_listings_cover_image_fk(public_url,storage_path,meta),images:market_listing_images!market_listing_images_listing_id_fkey(public_url,storage_path,sort_order,meta)";
const LISTING_BASIC_SELECT =
  "id,seller_id,title,description,price_amount,currency,delivery_type,category,sub_category,created_at,payment_options,availability,stock_qty";

type SortBy = "newest" | "price_low" | "price_high";
type FeedSection = "all" | "product" | "service" | "social";
type DirectoryMode = "listings" | "featured" | "verified";
type FeedScope = "country" | "global";

type ListingRow = {
  id: string;
  seller_id: string;
  title: string | null;
  description?: string | null;
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

function listingAvailability(row: ListingRow) {
  return row.availability ?? row.payment_options?.availability ?? null;
}

function listingExpiresAtMs(row: ListingRow) {
  const exp = row.payment_options?.expires_at;
  if (!exp) return null;

  const expMs = new Date(String(exp)).getTime();
  if (!Number.isFinite(expMs)) return null;

  const createdMs = new Date(String(row.created_at || "")).getTime();
  if (Number.isFinite(createdMs) && expMs <= createdMs) {
    return null;
  }

  return expMs;
}

function listingIsExpired(row: ListingRow) {
  const expMs = listingExpiresAtMs(row);
  return expMs !== null && expMs <= Date.now();
}

function cleanListingSearch(value: string) {
  return value.trim().replace(/[%,]/g, " ").replace(/\s+/g, " ").slice(0, 90);
}

function normalizeListingRow(row: any): ListingRow | null {
  const id = String(row?.id || "").trim();
  if (!id) return null;
  const cover = row?.cover ?? row?.cover_image ?? null;
  const images = Array.isArray(row?.images)
    ? row.images
    : Array.isArray(row?.market_listing_images)
    ? row.market_listing_images
    : null;

  return {
    id,
    seller_id: String(row?.seller_id || ""),
    title: row?.title ?? null,
    description: row?.description ?? null,
    price_amount: row?.price_amount ?? null,
    currency: row?.currency ?? null,
    delivery_type: row?.delivery_type ?? null,
    category: row?.category ?? null,
    sub_category: row?.sub_category ?? null,
    created_at: row?.created_at ?? null,
    payment_options: row?.payment_options ?? null,
    availability: row?.availability ?? row?.payment_options?.availability ?? null,
    stock_qty: typeof row?.stock_qty === "number" ? row.stock_qty : row?.stock_qty ?? null,
    cover,
    images,
  };
}

function normalizeListingRows(rows: any[]) {
  return rows.map(normalizeListingRow).filter(Boolean) as ListingRow[];
}

function publicSellerLogo(path?: string | null) {
  if (!path) return null;
  return supabase.storage.from("market-sellers").getPublicUrl(path).data.publicUrl;
}

function VerifiedTick({ verified }: { verified?: boolean | null }) {
  if (!verified) return null;
  return <Ionicons name="checkmark-circle" size={16} color={BLUE} />;
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
      style={({ pressed }) => ({
        paddingHorizontal: 12,
        paddingVertical: 9,
        borderRadius: 999,
        backgroundColor: active ? "rgba(244,183,93,0.16)" : "rgba(255,253,247,0.055)",
        borderWidth: 1,
        borderTopWidth: 1,
        borderColor: active ? "rgba(244,183,93,0.46)" : BORDER,
        borderTopColor: active ? "rgba(255,253,247,0.32)" : BORDER_TOP,
        shadowColor: active ? AMBER : "#000",
        shadowOpacity: active ? 0.18 : 0,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 7 },
        elevation: active ? 3 : 0,
        transform: [{ scale: pressed ? 0.97 : 1 }],
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        {icon ? <Ionicons name={icon} size={13} color={iconColor || (active ? AMBER : MUTED)} /> : null}
        <Text style={{ color: active ? TEXT : MUTED, fontWeight: "800", fontSize: 12 }}>{label}</Text>
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
      style={({ pressed }) => ({
        flex: stretch ? 1 : undefined,
        minWidth: stretch ? undefined : 106,
        height: 46,
        borderRadius: 16,
        paddingHorizontal: stretch ? 8 : 14,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: active ? "rgba(45,212,191,0.15)" : "rgba(255,253,247,0.055)",
        borderWidth: 1,
        borderTopWidth: 1,
        borderColor: active ? "rgba(45,212,191,0.46)" : BORDER,
        borderTopColor: active ? "rgba(255,253,247,0.30)" : BORDER_TOP,
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
        {icon ? <Ionicons name={icon} size={15} color={active ? TEAL : MUTED} /> : null}
        <Text style={{ color: active ? TEXT : MUTED, fontWeight: "800" }}>{label}</Text>
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
      style={({ pressed }) => ({
        flex: 1,
        minWidth: 132,
        borderRadius: 18,
        overflow: "hidden",
        borderWidth: 1,
        borderTopWidth: 1,
        borderColor: `${accent}4A`,
        borderTopColor: "rgba(255,253,247,0.24)",
        backgroundColor: INK,
        shadowColor: "#000",
        shadowOpacity: 0.18,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 10 },
        elevation: 5,
        transform: [{ translateY: pressed ? 1 : 0 }, { scale: pressed ? 0.985 : 1 }],
      })}
    >
      <LinearGradient
        colors={[`${accent}26`, "rgba(255,253,247,0.055)", "rgba(9,13,11,0.80)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          minHeight: 94,
          padding: 14,
          justifyContent: "space-between",
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 13,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: `${accent}2E`,
              borderWidth: 1,
              borderColor: `${accent}72`,
            }}
          >
            <Ionicons name={icon} size={17} color={TEXT} />
          </View>
          <Ionicons name="arrow-forward" size={16} color={accent} />
        </View>
        <View>
          <Text style={{ color: TEXT, fontWeight: "900", fontSize: 13 }}>{label}</Text>
          {subtitle ? (
            <Text style={{ marginTop: 4, color: MUTED, fontSize: 11, lineHeight: 15 }}>{subtitle}</Text>
          ) : null}
        </View>
      </LinearGradient>
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
        borderRadius: 18,
        padding: 12,
        borderWidth: 1,
        borderTopWidth: 1,
        borderColor: `${tone}42`,
        borderTopColor: BORDER_TOP,
        backgroundColor: "rgba(255,253,247,0.06)",
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 9,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: `${tone}22`,
          }}
        >
          <Ionicons name={icon} size={13} color={tone} />
        </View>
        <Text style={{ color: MUTED, fontWeight: "800", fontSize: 11 }}>{label}</Text>
      </View>
      <Text style={{ marginTop: 7, color: TEXT, fontWeight: "900", fontSize: 18 }} numberOfLines={1}>
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
          backgroundColor: "rgba(255,253,247,0.10)",
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1,
          borderColor: "rgba(255,253,247,0.12)",
        }}
      >
        {logo ? (
          <Image source={{ uri: logo }} style={{ width: avatarSize, height: avatarSize }} />
        ) : (
          <Ionicons name="person-outline" size={compact ? 10 : 12} color={TEXT} />
        )}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5, flex: 1 }}>
        <Text
          numberOfLines={1}
          style={{
            color: "rgba(255,253,247,0.80)",
            fontWeight: "800",
            fontSize: compact ? 10 : 11,
            flex: 1,
          }}
        >
          {secondaryLabel ? `${primaryLabel} - ${secondaryLabel}` : primaryLabel}
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
  tone?: "neutral" | "purple" | "gold" | "green" | "red" | "teal" | "blue";
}) {
  const tones = {
    neutral: {
      bg: "rgba(255,253,247,0.07)",
      border: "rgba(255,253,247,0.13)",
      fg: "rgba(255,253,247,0.82)",
    },
    purple: {
      bg: "rgba(139,92,246,0.18)",
      border: "rgba(196,181,253,0.36)",
      fg: "#EDE9FE",
    },
    gold: {
      bg: "rgba(244,183,93,0.18)",
      border: "rgba(244,183,93,0.38)",
      fg: "#FEF3C7",
    },
    green: {
      bg: "rgba(34,197,94,0.18)",
      border: "rgba(134,239,172,0.34)",
      fg: "#DCFCE7",
    },
    red: {
      bg: "rgba(251,113,133,0.20)",
      border: "rgba(253,164,175,0.36)",
      fg: "#FFE4E6",
    },
    teal: {
      bg: "rgba(45,212,191,0.17)",
      border: "rgba(94,234,212,0.34)",
      fg: "#CCFBF1",
    },
    blue: {
      bg: "rgba(56,189,248,0.17)",
      border: "rgba(125,211,252,0.34)",
      fg: "#E0F2FE",
    },
  } as const;

  const colors = tones[tone];
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingHorizontal: 8,
        paddingVertical: 5,
        borderRadius: 999,
        backgroundColor: colors.bg,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      {icon ? <Ionicons name={icon} size={12} color={colors.fg} /> : null}
      <Text style={{ color: colors.fg, fontWeight: "800", fontSize: 10 }}>{label}</Text>
    </View>
  );
}

function GlassPanel({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: any;
}) {
  return (
    <View
      style={[
        {
          borderRadius: 20,
          borderWidth: 1,
          borderTopWidth: 1,
          borderColor: BORDER,
          borderTopColor: BORDER_TOP,
          backgroundColor: CARD,
          shadowColor: "#000",
          shadowOpacity: 0.12,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 10 },
          elevation: 3,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

function TrustTimeline({ compact = false }: { compact?: boolean }) {
  const steps = [
    { label: "Paid", icon: "card-outline" },
    { label: "In Escrow", icon: "shield-checkmark-outline" },
    { label: "Confirm Delivery", icon: "bag-check-outline" },
    { label: "Released", icon: "checkmark-done-outline" },
  ] as const;

  if (compact) {
    return (
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        {steps.map((step, index) => (
          <React.Fragment key={step.label}>
            <View style={{ alignItems: "center", flex: 1, minWidth: 0 }}>
              <View
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 13,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: index < 2 ? "rgba(45,212,191,0.18)" : "rgba(255,253,247,0.055)",
                  borderWidth: 1,
                  borderColor: index < 2 ? "rgba(94,234,212,0.36)" : "rgba(255,253,247,0.10)",
                }}
              >
                <Ionicons name={step.icon} size={12} color={index < 2 ? TEAL : MUTED} />
              </View>
            </View>
            {index < steps.length - 1 ? (
              <View
                style={{
                  width: 14,
                  height: 1,
                  backgroundColor: index === 0 ? "rgba(94,234,212,0.54)" : "rgba(255,253,247,0.12)",
                }}
              />
            ) : null}
          </React.Fragment>
        ))}
      </View>
    );
  }

  return (
    <GlassPanel style={{ padding: 14, backgroundColor: "rgba(45,212,191,0.07)" }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: TEXT, fontWeight: "900", fontSize: 14, letterSpacing: 0 }}>
            Trust timeline
          </Text>
          <Text style={{ marginTop: 4, color: MUTED, fontSize: 12 }}>
            Buyer funds move through escrow before seller release.
          </Text>
        </View>
        <Ionicons name="shield-checkmark" size={24} color={TEAL} />
      </View>

      <View style={{ marginTop: 14, flexDirection: "row", alignItems: "center" }}>
        {steps.map((step, index) => (
          <React.Fragment key={step.label}>
            <View style={{ alignItems: "center", flex: 1, minWidth: 0 }}>
              <View
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 17,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: index < 2 ? "rgba(45,212,191,0.20)" : "rgba(255,253,247,0.055)",
                  borderWidth: 1,
                  borderColor: index < 2 ? "rgba(94,234,212,0.42)" : BORDER,
                }}
              >
                <Ionicons name={step.icon} size={16} color={index < 2 ? TEAL : MUTED} />
              </View>
              <Text
                numberOfLines={1}
                style={{ marginTop: 6, color: index < 2 ? TEXT : MUTED, fontWeight: "800", fontSize: 10 }}
              >
                {step.label}
              </Text>
            </View>
            {index < steps.length - 1 ? (
              <View
                style={{
                  width: 24,
                  height: 1,
                  backgroundColor: index === 0 ? "rgba(94,234,212,0.58)" : "rgba(255,253,247,0.12)",
                }}
              />
            ) : null}
          </React.Fragment>
        ))}
      </View>
    </GlassPanel>
  );
}

export default function MarketHome() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [section, setSection] = useState<FeedSection>("all");
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>("newest");
  const [directoryMode, setDirectoryMode] = useState<DirectoryMode>("listings");
  const [feedScope, setFeedScope] = useState<FeedScope>("global");
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
  const hasDesktopTabs = Platform.OS === "web" && width >= 980;
  const desktopRailWidth = hasDesktopTabs ? 228 : 0;
  const usableWidth = Math.max(320, width - desktopRailWidth);
  const isDesktop = usableWidth >= 900;
  const pagePadding = isDesktop ? 28 : width >= 820 ? 24 : 16;
  const contentMaxWidth = isDesktop ? 1220 : width >= 1240 ? 1120 : undefined;
  const contentInnerWidth = Math.min(
    contentMaxWidth ?? usableWidth,
    Math.max(320, usableWidth),
  ) - pagePadding * 2;
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
      const c = await resolveUserCountry({ prompt: true, refresh: true });
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

      setCountryErr("Location not detected. Showing Global until your country is available.");
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

  async function fetchListingImagesFor(rows: ListingRow[]) {
    const listingIds = Array.from(new Set(rows.map((row) => row.id).filter(Boolean)));
    if (!listingIds.length) return rows;

    const readImages = async (source: "market_listing_images_public" | "market_listing_images") => {
      const { data, error } = await supabase
        .from(source)
        .select("listing_id,public_url,storage_path,sort_order,meta")
        .in("listing_id", listingIds)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data ?? [];
    };

    try {
      let imageRows: any[] = [];
      try {
        imageRows = await readImages("market_listing_images_public");
      } catch {
        imageRows = await readImages("market_listing_images");
      }

      const imagesByListing = new Map<string, any[]>();
      imageRows.forEach((image) => {
        const listingId = String(image?.listing_id || "");
        if (!listingId) return;
        imagesByListing.set(listingId, [...(imagesByListing.get(listingId) ?? []), image]);
      });

      return rows.map((row) => {
        const images = imagesByListing.get(row.id) ?? [];
        return {
          ...row,
          cover: row.cover ?? images[0] ?? null,
          images: row.images?.length ? row.images : images,
        };
      });
    } catch {
      return rows;
    }
  }

  async function fetchListingsDirect() {
    const term = cleanListingSearch(q);

    const runQuery = async (selectClause: string, useDeletedFilter: boolean) => {
      let query = supabase
        .from(LISTINGS_TABLE)
        .select(selectClause)
        .eq("is_active", true)
        .order(sortBy === "newest" ? "created_at" : "price_amount", { ascending: sortBy === "price_low" })
        .limit(LISTING_FETCH_LIMIT);

      if (useDeletedFilter) query = query.is("deleted_at", null);
      if (main) query = query.eq("category", main);
      if (selectedSlug) query = query.eq("sub_category", selectedSlug);
      if (term && directoryMode === "listings") {
        query = query.or(`title.ilike.%${term}%,description.ilike.%${term}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return normalizeListingRows((data ?? []) as any[]);
    };

    const attempts: Array<[string, boolean]> = [
      [LISTING_RICH_SELECT, true],
      [LISTING_RICH_SELECT, false],
      [LISTING_BASIC_SELECT, false],
    ];
    let lastError: any = null;
    for (const [selectClause, useDeletedFilter] of attempts) {
      try {
        const rows = await runQuery(selectClause, useDeletedFilter);
        return selectClause === LISTING_BASIC_SELECT ? await fetchListingImagesFor(rows) : rows;
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError;
  }

  async function fetchListingsFromFeedFunction() {
    const url = new URL(`${getSupabaseFunctionsBaseUrl()}/market-listings-feed`);
    const term = cleanListingSearch(q);
    url.searchParams.set("limit", String(LISTING_FETCH_LIMIT));
    url.searchParams.set("sort", sortBy);
    if (main) url.searchParams.set("category", main);
    if (selectedSlug) url.searchParams.set("sub_category", selectedSlug);
    if (term && directoryMode === "listings") url.searchParams.set("q", term);

    const headers: Record<string, string> = {
      apikey: getSupabaseAnonKeyOrThrow(),
    };
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (token) headers.Authorization = `Bearer ${token}`;

    const { res, json, text } = await fetchJsonWithTimeout(url.toString(), { method: "GET", headers }, 20000);
    if (!res.ok || (json as any)?.error) {
      throw new Error(String((json as any)?.error || text || "Listings feed failed"));
    }
    return normalizeListingRows(((json as any)?.items ?? []) as any[]);
  }

  async function loadListings(countryOverride?: UserCountry | null) {
    setLoading(true);
    setErr(null);
    try {
      const effectiveCountry = countryOverride === undefined ? userCountry : countryOverride;
      let fetched: ListingRow[] = [];
      try {
        fetched = await fetchListingsFromFeedFunction();
        const needsCountryFields =
          feedScope === "country" &&
          effectiveCountry &&
          fetched.length > 0 &&
          fetched.every((row) => row.availability == null && row.payment_options == null);
        if (needsCountryFields) {
          const directRows = await fetchListingsDirect();
          if (directRows.length) fetched = directRows;
        }
      } catch {
        fetched = await fetchListingsDirect();
      }

      const items = fetched.filter((r) => !listingIsExpired(r));
      const scopedBase =
        feedScope === "global"
          ? items
          : effectiveCountry
          ? items.filter((r) =>
              listingMatchesCountry(listingAvailability(r), effectiveCountry, false),
            )
          : items;
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
    let mounted = true;

    (async () => {
      try {
        const c = await resolveUserCountry();
        if (mounted && c) setUserCountry(c);
      } catch {
        // Country is optional for the Global feed.
      }
    })();

    return () => {
      mounted = false;
    };
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
  const responsiveListingColumns = contentInnerWidth >= 980 ? 3 : contentInnerWidth >= 620 ? 2 : 1;
  const sellerDirectoryColumns = isDesktop && contentInnerWidth >= 760 ? 2 : 1;
  const listingColumns = isListingDirectory ? responsiveListingColumns : sellerDirectoryColumns;
  const listingCardWidth =
    listingColumns === 1 ? undefined : listingColumns === 2 ? "48.7%" : "31.9%";
  const listingMediaAspectRatio = listingColumns === 1 ? 4 / 3 : isDesktop ? 1.12 : 1;
  const sellerCardWidth = listingColumns === 1 ? undefined : listingColumns === 2 ? "48.7%" : "31.9%";
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
      ? "Browse fresh seller updates, launches, and media from the marketplace."
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
          : `Showing Global ${feedLabel} while your country is being detected.`
        : `Showing ${feedLabel} from every country in the marketplace.`
      : directoryMode === "featured"
      ? "Browse promoted storefronts first."
      : "Browse stores with verified seller profiles.";
  const heroAccent =
    section === "service" ? TEAL : section === "product" ? BLUE : section === "social" ? AMBER : PURPLE;
  const heroPreviewListings = useMemo(
    () =>
      rows.slice(0, 3).map((item, index) => {
        const mediaSource = resolveMarketMediaSource(
          [item.cover ?? null, ...sortMarketMedia(item.images ?? [])],
          supabaseUrl,
          LISTING_IMAGES_BUCKET,
        );
        const displayPrice = getListingPriceDisplay(item as any);
        return {
          id: item.id,
          title: item.title || "Untitled listing",
          price: formatCurrency(displayPrice.localCurrency, displayPrice.localNow),
          uri: mediaSource?.url ?? null,
          kind: mediaSource?.kind ?? "image",
          accent: [TEAL, AMBER, BLUE][index % 3],
        };
      }),
    [rows, supabaseUrl],
  );

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
        style={({ pressed }) => ({
          width: listingCardWidth as any,
          marginHorizontal: listingColumns === 1 && !isDesktop ? pagePadding : 0,
          marginTop: isDesktop ? 18 : 16,
          borderRadius: 22,
          overflow: "hidden",
          borderWidth: 1,
          borderTopWidth: 1,
          borderColor: "rgba(255,253,247,0.13)",
          borderTopColor: BORDER_TOP,
          backgroundColor: isDesktop ? "rgba(10,13,11,0.96)" : CARD_RAISED,
          shadowColor: "#000",
          shadowOpacity: isDesktop ? 0.34 : 0.25,
          shadowRadius: isDesktop ? 28 : 20,
          shadowOffset: { width: 0, height: isDesktop ? 18 : 12 },
          elevation: 7,
          transform: [{ translateY: pressed ? 1 : 0 }, { scale: pressed ? 0.985 : 1 }],
        })}
      >
        <View style={{ aspectRatio: listingMediaAspectRatio, backgroundColor: "rgba(255,253,247,0.07)" }}>
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
              <Ionicons name={coverKind === "video" ? "videocam-outline" : "image-outline"} size={30} color="rgba(255,253,247,0.55)" />
              <Text style={{ color: "rgba(255,253,247,0.58)", fontWeight: "800", fontSize: 12 }}>
                Preview unavailable
              </Text>
            </View>
          )}

          <LinearGradient
            colors={["rgba(6,8,7,0.02)", "rgba(6,8,7,0.16)", "rgba(6,8,7,0.56)"]}
            locations={[0, 0.42, 1]}
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
                tone={item.category === "service" ? "teal" : "blue"}
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
                borderColor: "rgba(255,253,247,0.12)",
              }}
            >
              <Ionicons name="play" size={18} color={TEXT} />
            </View>
          ) : null}
        </View>

        <View
          style={{
            minHeight: isDesktop ? 220 : undefined,
            paddingHorizontal: isDesktop ? 16 : 14,
            paddingTop: isDesktop ? 16 : 14,
            paddingBottom: isDesktop ? 16 : 14,
            backgroundColor: "rgba(9,13,11,0.92)",
          }}
        >
          <View style={{ minHeight: showDiscount ? 58 : 46 }}>
            {showDiscount ? (
              <Text
                style={{
                  color: FAINT,
                  textDecorationLine: "line-through",
                  fontWeight: "800",
                  fontSize: 11,
                }}
              >
                {formatCurrency(displayPrice.localCurrency, displayPrice.localWas)}
              </Text>
            ) : null}
            <Text
              numberOfLines={1}
              style={{
                marginTop: showDiscount ? 2 : 0,
                color: TEXT,
                fontWeight: "900",
                fontSize: listingColumns === 1 ? 24 : 21,
                letterSpacing: 0,
              }}
            >
              {formatCurrency(displayPrice.localCurrency, displayPrice.localNow)}
            </Text>
            <Text
              style={{
                marginTop: 2,
                color: showDiscount ? ROSE : MUTED,
                fontWeight: "800",
                fontSize: 11,
              }}
            >
              USD {formatCurrency("USD", displayPrice.usdNow)}
            </Text>
          </View>

          <Text
            numberOfLines={2}
            style={{ marginTop: 10, color: TEXT, fontWeight: "800", fontSize: 14, lineHeight: 19 }}
          >
            {item.title ?? "Untitled"}
          </Text>

          <View style={{ marginTop: 10, flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            <CardBadge
              label={item.sub_category || categoryLabel}
              icon={item.category === "service" ? "construct-outline" : "cube-outline"}
              tone={item.category === "service" ? "teal" : "blue"}
            />
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
            {showDiscount ? <CardBadge label="Sale" icon="pricetag-outline" tone="gold" /> : null}
          </View>
          <View style={{ marginTop: 10 }}>
            <TrustTimeline compact />
          </View>
          <SellerMini seller={seller} compact />
          <View
            style={{
              marginTop: 12,
              paddingTop: 12,
              borderTopWidth: 1,
              borderTopColor: "rgba(255,253,247,0.10)",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Ionicons name="shield-checkmark-outline" size={14} color={TEAL} />
              <Text style={{ color: MUTED, fontWeight: "800", fontSize: 11 }}>Escrow ready</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={{ color: TEXT, fontWeight: "900", fontSize: 12 }}>Open</Text>
              <Ionicons name="arrow-forward" size={14} color={TEXT} />
            </View>
          </View>
        </View>
      </Pressable>
    );
  };

  const renderSellerCard = ({ item }: { item: SellerCard }) => {
    const logo = publicSellerLogo(item.logo_path);
    const name = item.business_name || item.display_name || "Business";
    return (
      <Pressable
        onPress={() => router.push(`/market/profile/${item.market_username}` as any)}
        style={({ pressed }) => ({
          width: sellerCardWidth as any,
          marginHorizontal: !isDesktop ? pagePadding : 0,
          borderRadius: 22,
          overflow: "hidden",
          backgroundColor: INK,
          borderWidth: 1,
          borderTopWidth: 1,
          borderColor: "rgba(255,253,247,0.13)",
          borderTopColor: BORDER_TOP,
          marginTop: 12,
          shadowColor: "#000",
          shadowOpacity: 0.18,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 10 },
          elevation: 4,
          transform: [{ translateY: pressed ? 1 : 0 }, { scale: pressed ? 0.985 : 1 }],
        })}
      >
        <LinearGradient
          colors={["rgba(56,189,248,0.15)", "rgba(244,183,93,0.08)", "rgba(9,13,11,0.88)"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ minHeight: 154, padding: 16 }}
        >
          <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
            <View
              style={{
                width: 54,
                height: 54,
                borderRadius: 20,
                overflow: "hidden",
                backgroundColor: "rgba(255,253,247,0.10)",
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderColor: "rgba(255,253,247,0.16)",
              }}
            >
              {logo ? <Image source={{ uri: logo }} style={{ width: 54, height: 54 }} /> : <Ionicons name="storefront-outline" size={24} color={TEXT} />}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={{ color: TEXT, fontWeight: "900", flexShrink: 1, letterSpacing: 0, fontSize: 15 }} numberOfLines={1}>
                  {name}
                </Text>
                <VerifiedTick verified={item.is_verified} />
              </View>
              <Text style={{ color: MUTED, fontSize: 12, marginTop: 3 }} numberOfLines={1}>
                @{item.market_username || "profile"}
              </Text>
            </View>
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: 14,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "rgba(255,253,247,0.08)",
                borderWidth: 1,
                borderColor: "rgba(255,253,247,0.13)",
              }}
            >
              <Ionicons name="arrow-forward" size={16} color={TEXT} />
            </View>
          </View>

          <Text style={{ marginTop: 12, color: MUTED, fontSize: 12, lineHeight: 18 }} numberOfLines={2}>
            {item.bio || "No description yet."}
          </Text>

          <View style={{ marginTop: 12, flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {item.is_verified ? <CardBadge label="Verified seller" icon="checkmark-circle-outline" tone="blue" /> : null}
            {item.featured_enabled ? <CardBadge label="Featured" icon="flame-outline" tone="gold" /> : null}
            <CardBadge label="Store profile" icon="storefront-outline" tone="neutral" />
          </View>
        </LinearGradient>
      </Pressable>
    );
  };

  function switchSection(next: FeedSection) {
    setSection(next);
    if (next !== "social") {
      setDirectoryMode("listings");
      setSelectedSlug(null);
    }
  }

  function renderSectionTabs(mode: "mobile" | "desktop") {
    const tabs: Array<{ key: FeedSection; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
      { key: "all", label: "All", icon: "apps-outline" },
      { key: "product", label: "Products", icon: "storefront-outline" },
      { key: "service", label: "Services", icon: "construct-outline" },
      { key: "social", label: "Social", icon: "people-outline" },
    ];

    if (mode === "desktop") {
      return (
        <View
          style={{
            marginTop: 20,
            borderRadius: 20,
            padding: 6,
            borderWidth: 1,
            borderColor: "rgba(255,253,247,0.13)",
            backgroundColor: "rgba(9,13,11,0.50)",
            flexDirection: "row",
            gap: 6,
          }}
        >
          {tabs.map((tab) => (
            <SectionPill
              key={tab.key}
              icon={tab.icon}
              label={tab.label}
              active={section === tab.key}
              onPress={() => switchSection(tab.key)}
            />
          ))}
        </View>
      );
    }

    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginTop: 10, marginHorizontal: -pagePadding }}
        contentContainerStyle={{ paddingHorizontal: pagePadding, gap: 10 }}
      >
        {tabs.map((tab) => (
          <SectionPill
            key={tab.key}
            icon={tab.icon}
            label={tab.label}
            active={section === tab.key}
            stretch={false}
            onPress={() => switchSection(tab.key)}
          />
        ))}
      </ScrollView>
    );
  }

  function renderSearchBar(prominent = false) {
    return section !== "social" ? (
      <View
        style={{
          marginTop: prominent ? 18 : 12,
          minHeight: prominent ? 58 : 0,
          flexDirection: "row",
          gap: 10,
          alignItems: "center",
          borderRadius: prominent ? 22 : 18,
          padding: prominent ? 14 : 12,
          borderWidth: 1,
          borderTopWidth: 1,
          borderColor: prominent ? "rgba(255,253,247,0.18)" : "rgba(255,253,247,0.13)",
          borderTopColor: "rgba(255,253,247,0.26)",
          backgroundColor: prominent ? "rgba(9,13,11,0.58)" : "rgba(255,253,247,0.07)",
        }}
      >
        <Ionicons name="search-outline" size={19} color={prominent ? TEAL : MUTED} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder={searchPlaceholder}
          placeholderTextColor="rgba(255,253,247,0.45)"
          returnKeyType="search"
          onSubmitEditing={() =>
            router.push({ pathname: "/market/search" as any, params: q.trim() ? { q: q.trim() } : {} })
          }
          style={{ flex: 1, minWidth: 0, color: TEXT, fontWeight: "800", fontSize: prominent ? 15 : 14 }}
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
              backgroundColor: "rgba(255,253,247,0.08)",
            }}
          >
            <Ionicons name="close" size={17} color={TEXT} />
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => router.push({ pathname: "/market/search" as any, params: q.trim() ? { q: q.trim() } : {} })}
          style={{
            width: prominent ? 44 : 38,
            height: prominent ? 44 : 38,
            borderRadius: prominent ? 15 : 13,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(45,212,191,0.20)",
            borderWidth: 1,
            borderColor: "rgba(94,234,212,0.42)",
          }}
        >
          <Ionicons name="arrow-forward" size={17} color={TEXT} />
        </Pressable>
      </View>
    ) : null;
  }

  function renderHeroPreviewRail(compact = false) {
    if (!heroPreviewListings.length) {
      return (
        <View
          style={{
            marginTop: compact ? 14 : 0,
            borderRadius: compact ? 18 : 22,
            padding: compact ? 12 : 16,
            borderWidth: 1,
            borderColor: "rgba(255,253,247,0.13)",
            backgroundColor: "rgba(255,253,247,0.065)",
            minHeight: compact ? 104 : 180,
            justifyContent: "center",
            gap: 10,
          }}
        >
          <View
            style={{
              width: 42,
              height: 42,
              borderRadius: 15,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(45,212,191,0.16)",
              borderWidth: 1,
              borderColor: "rgba(94,234,212,0.34)",
            }}
          >
            <Ionicons name="sparkles-outline" size={18} color={TEAL} />
          </View>
          <Text style={{ color: TEXT, fontWeight: "900", fontSize: compact ? 13 : 15 }}>
            Featured media listings
          </Text>
          <Text style={{ color: MUTED, fontSize: 12, lineHeight: 17 }}>
            No media listings available for this view.
          </Text>
        </View>
      );
    }

    if (compact) {
      return (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginTop: 14, marginHorizontal: -16 }}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
        >
          {heroPreviewListings.map((item) => (
            <Pressable
              key={item.id}
              onPress={() => router.push({ pathname: "/market/listing/[id]" as any, params: { id: item.id } })}
              style={({ pressed }) => ({
                width: 176,
                borderRadius: 18,
                overflow: "hidden",
                borderWidth: 1,
                borderColor: "rgba(255,253,247,0.13)",
                backgroundColor: "rgba(255,253,247,0.07)",
                transform: [{ scale: pressed ? 0.985 : 1 }],
              })}
            >
              <View style={{ height: 86, backgroundColor: "rgba(255,253,247,0.07)" }}>
                {item.uri ? (
                  <MarketMediaView
                    uri={item.uri}
                    kind={item.kind}
                    style={{ width: "100%", height: "100%" }}
                    resizeMode={item.kind === "video" ? "contain" : "cover"}
                    muted
                    disablePointerEvents
                  />
                ) : (
                  <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="image-outline" size={20} color={MUTED} />
                  </View>
                )}
              </View>
              <View style={{ padding: 10 }}>
                <Text numberOfLines={1} style={{ color: TEXT, fontWeight: "900", fontSize: 12 }}>
                  {item.title}
                </Text>
                <Text numberOfLines={1} style={{ marginTop: 4, color: item.accent, fontWeight: "900", fontSize: 12 }}>
                  {item.price}
                </Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      );
    }

    return (
      <View style={{ gap: 10 }}>
        <Text style={{ color: MUTED, fontWeight: "900", fontSize: 11 }}>LIVE SHELF</Text>
        {heroPreviewListings.map((item) => (
          <Pressable
            key={item.id}
            onPress={() => router.push({ pathname: "/market/listing/[id]" as any, params: { id: item.id } })}
            style={({ pressed }) => ({
              borderRadius: 18,
              overflow: "hidden",
              borderWidth: 1,
              borderColor: "rgba(255,253,247,0.13)",
              backgroundColor: "rgba(9,13,11,0.62)",
              flexDirection: "row",
              alignItems: "center",
              transform: [{ translateY: pressed ? 1 : 0 }],
            })}
          >
            <View style={{ width: 76, height: 76, backgroundColor: "rgba(255,253,247,0.07)" }}>
              {item.uri ? (
                <MarketMediaView
                  uri={item.uri}
                  kind={item.kind}
                  style={{ width: "100%", height: "100%" }}
                  resizeMode={item.kind === "video" ? "contain" : "cover"}
                  muted
                  disablePointerEvents
                />
              ) : (
                <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="image-outline" size={20} color={MUTED} />
                </View>
              )}
            </View>
            <View style={{ flex: 1, minWidth: 0, paddingHorizontal: 12, paddingVertical: 10 }}>
              <Text numberOfLines={1} style={{ color: TEXT, fontWeight: "900", fontSize: 13 }}>
                {item.title}
              </Text>
              <Text numberOfLines={1} style={{ marginTop: 5, color: item.accent, fontWeight: "900", fontSize: 12 }}>
                {item.price}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={MUTED} style={{ marginRight: 12 }} />
          </Pressable>
        ))}
      </View>
    );
  }

  function renderHeroPanel(desktop = false) {
    const showPreviewShelf = desktop && contentInnerWidth >= 1120 && section !== "social";
    const kicker = section === "social" ? "SELLER BOARD" : section === "service" ? "SERVICES" : section === "product" ? "PRODUCTS" : "MARKETPLACE";

    if (desktop) {
      return (
        <LinearGradient
          colors={[`${heroAccent}24`, "rgba(244,183,93,0.10)", "rgba(255,253,247,0.055)"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            flex: 1,
            minHeight: 356,
            borderRadius: 30,
            padding: 26,
            borderWidth: 1,
            borderColor: "rgba(255,253,247,0.17)",
            overflow: "hidden",
            shadowColor: "#000",
            shadowOpacity: 0.24,
            shadowRadius: 26,
            shadowOffset: { width: 0, height: 18 },
            elevation: 8,
          }}
        >
          <View style={{ flex: 1, flexDirection: showPreviewShelf ? "row" : "column", gap: 22 }}>
            <View style={{ flex: 1, minWidth: 0, justifyContent: "space-between" }}>
              <View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <CardBadge label={kicker} icon={section === "social" ? "people-outline" : "shield-checkmark-outline"} tone={section === "social" ? "gold" : "teal"} />
                  {section !== "social" ? (
                    <CardBadge label={feedScope === "country" ? "Local first" : "Global feed"} icon={feedScope === "country" ? "location-outline" : "earth-outline"} tone="blue" />
                  ) : null}
                </View>
                <Text style={{ marginTop: 16, color: TEXT, fontWeight: "900", fontSize: showPreviewShelf ? 38 : 36, lineHeight: showPreviewShelf ? 43 : 41 }}>
                  {heroTitle}
                </Text>
                <Text style={{ marginTop: 12, color: "rgba(255,253,247,0.76)", lineHeight: 22, fontSize: 14, maxWidth: 650 }}>
                  {heroSubtitle}
                </Text>
              </View>

              <View style={{ marginTop: 18 }}>
                {section === "social" ? (
                  <View style={{ flexDirection: "row", gap: 12, maxWidth: 600 }}>
                    <QuickAction
                      label="Seller Board"
                      subtitle="Open full feed"
                      icon="chatbubbles-outline"
                      accent={AMBER}
                      onPress={() => router.push("/market/social" as any)}
                    />
                    <QuickAction
                      label="Shopping"
                      subtitle="Return to listings"
                      icon="storefront-outline"
                      accent={BLUE}
                      onPress={() => switchSection("all")}
                    />
                  </View>
                ) : (
                  renderSearchBar(true)
                )}

                {renderSectionTabs("desktop")}
              </View>
            </View>

            {showPreviewShelf ? (
              <View style={{ width: 286, justifyContent: "center" }}>
                {renderHeroPreviewRail(false)}
              </View>
            ) : null}
          </View>
        </LinearGradient>
      );
    }

    return (
      <LinearGradient
        colors={[`${heroAccent}20`, "rgba(244,183,93,0.08)", "rgba(255,253,247,0.06)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          marginTop: 12,
          padding: 16,
          borderRadius: 24,
          borderWidth: 1,
          borderColor: "rgba(255,253,247,0.15)",
          overflow: "hidden",
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <CardBadge label={kicker} icon={section === "social" ? "people-outline" : "shield-checkmark-outline"} tone={section === "social" ? "gold" : "teal"} />
          {section !== "social" ? (
            <CardBadge label={feedScope === "country" ? "Local first" : "Global feed"} icon={feedScope === "country" ? "location-outline" : "earth-outline"} tone="blue" />
          ) : null}
        </View>
        <Text style={{ marginTop: 12, color: TEXT, fontWeight: "900", fontSize: 25, lineHeight: 31 }}>{heroTitle}</Text>
        <Text style={{ marginTop: 8, color: MUTED, lineHeight: 20 }} numberOfLines={3}>
          {heroSubtitle}
        </Text>

        {section !== "social" ? renderHeroPreviewRail(true) : null}

        {section !== "social" ? (
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
              tone={heroAccent}
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
              tone={BLUE}
            />
          </View>
        ) : null}
      </LinearGradient>
    );
  }

  function renderQuickActions() {
    return (
      <View
        style={{
          marginTop: 10,
          flexDirection: mobileActionStack ? "column" : "row",
          gap: 10,
        }}
      >
        <QuickAction
          label={section === "all" ? "Products" : section === "social" ? "Seller Board" : "Categories"}
          subtitle={section === "all" ? "Shop curated items" : section === "social" ? "Open full feed" : "Browse by type"}
          icon={section === "all" ? "storefront-outline" : section === "social" ? "chatbubbles-outline" : "grid-outline"}
          accent={section === "social" ? AMBER : heroAccent}
          onPress={() => {
            if (section === "social") {
              router.push("/market/social" as any);
              return;
            }
            if (section === "all") {
              switchSection("product");
              return;
            }
            router.push({
              pathname: "/market/category" as any,
              params: { mode: section === "service" ? "service" : "product" },
            });
          }}
        />
        <QuickAction
          label={section === "social" ? "Shopping" : "Stock Market"}
          subtitle={section === "social" ? "Back to listings" : "Trade seller stock"}
          icon={section === "social" ? "storefront-outline" : "trending-up-outline"}
          accent={section === "social" ? BLUE : TEAL}
          onPress={() => {
            if (section === "social") {
              switchSection("all");
              return;
            }
            router.push("/market/stock" as any);
          }}
        />
      </View>
    );
  }

  function renderDirectoryChooser(desktop = false) {
    return (
      <GlassPanel style={{ marginTop: desktop ? 0 : 12, padding: desktop ? 18 : 14, flex: desktop ? 1 : undefined, backgroundColor: "rgba(255,253,247,0.06)" }}>
        <Text style={{ color: MUTED, fontWeight: "800", fontSize: 11 }}>
          {directoryMode === "listings" ? "DISCOVERY" : "SELLER DIRECTORY"}
        </Text>

        <View style={{ marginTop: 6, flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: TEXT, fontWeight: "900", fontSize: desktop ? 20 : 18 }}>{resultTitle}</Text>
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
              backgroundColor: "rgba(45,212,191,0.16)",
              borderWidth: 1,
              borderColor: "rgba(94,234,212,0.38)",
            }}
          >
            <Text style={{ color: TEXT, fontWeight: "900", fontSize: 12 }}>{resultCount}</Text>
          </View>
        </View>

        <View style={{ marginTop: 14, flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
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
            iconColor={BLUE}
            active={directoryMode === "verified"}
            onPress={() => setDirectoryMode("verified")}
          />
        </View>
      </GlassPanel>
    );
  }

  function renderScopeAndFilters(desktop = false) {
    if (!isListingDirectory) {
      return (
        <GlassPanel style={{ marginTop: desktop ? 0 : 12, padding: desktop ? 18 : 14, width: desktop ? 372 : undefined, backgroundColor: "rgba(255,253,247,0.06)" }}>
          <Text style={{ color: TEXT, fontWeight: "900", fontSize: 13 }}>Store discovery</Text>
          <Text style={{ marginTop: 6, color: MUTED, fontSize: 12, lineHeight: 18 }}>
            Featured and verified directories help buyers assess a store before opening the full profile.
          </Text>
        </GlassPanel>
      );
    }

    return (
      <GlassPanel style={{ marginTop: desktop ? 0 : 12, padding: desktop ? 18 : 14, width: desktop ? 372 : undefined, backgroundColor: "rgba(255,253,247,0.06)" }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: TEXT, fontWeight: "900", fontSize: 14 }}>Feed scope</Text>
            <Text style={{ marginTop: 4, color: MUTED, fontSize: 12, lineHeight: 18 }}>
              {feedScope === "country"
                ? "Showing listings specifically available in your current country."
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
              backgroundColor: "rgba(255,253,247,0.08)",
              borderWidth: 1,
              borderColor: "rgba(255,253,247,0.12)",
              opacity: locatingCountry ? 0.6 : 1,
            }}
          >
            {locatingCountry ? <ActivityIndicator size="small" /> : <Ionicons name="refresh" size={16} color={TEXT} />}
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

        <View
          style={{
            marginTop: 10,
            borderRadius: 16,
            padding: 12,
            borderWidth: 1,
            borderColor: "rgba(255,253,247,0.12)",
            backgroundColor: "rgba(9,13,11,0.42)",
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
          }}
        >
          <Ionicons name="location-outline" size={18} color={TEAL} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: TEXT, fontWeight: "900", fontSize: 12 }}>{locationLabel}</Text>
            <Text style={{ marginTop: 2, color: MUTED, fontSize: 11, lineHeight: 16 }}>
              {feedScope === "country"
                ? userCountry
                  ? "Only listings matched to your country are shown here."
                  : "Showing Global while your country is being detected."
                : "Global feed shows listings from every country."}
            </Text>
          </View>
        </View>

        {feedScope === "country" && !userCountry ? (
          <View
            style={{
              marginTop: 10,
              borderRadius: 14,
              padding: 12,
              borderWidth: 1,
              borderColor: BORDER,
              backgroundColor: "rgba(255,253,247,0.055)",
            }}
          >
            <Text style={{ color: MUTED }}>Enable location to filter to your country. Until then, the feed stays visible with Global listings.</Text>
            {countryErr ? (
              <Text style={{ marginTop: 6, color: "rgba(255,253,247,0.55)", fontSize: 12 }}>{countryErr}</Text>
            ) : null}
          </View>
        ) : null}

        {categories.length ? (
          <>
            <Text style={{ marginTop: 14, color: TEXT, fontWeight: "900", fontSize: 13 }}>Categories</Text>
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
          <View
            style={{
              marginTop: 14,
              borderRadius: 16,
              padding: 12,
              borderWidth: 1,
              borderColor: "rgba(255,253,247,0.12)",
              backgroundColor: "rgba(255,253,247,0.055)",
            }}
          >
            <Text style={{ color: TEXT, fontWeight: "900", fontSize: 13 }}>All listing types</Text>
            <Text style={{ marginTop: 4, color: MUTED, fontSize: 12, lineHeight: 18 }}>
              This view mixes products and services together. Switch above when you want category-specific browsing.
            </Text>
          </View>
        )}

        <Text style={{ marginTop: 14, color: TEXT, fontWeight: "900", fontSize: 13 }}>Sort</Text>
        <View style={{ marginTop: 8, flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
          <Chip label="Newest" active={sortBy === "newest"} onPress={() => setSortBy("newest")} />
          <Chip label="Price Low" active={sortBy === "price_low"} onPress={() => setSortBy("price_low")} />
          <Chip label="Price High" active={sortBy === "price_high"} onPress={() => setSortBy("price_high")} />
        </View>
      </GlassPanel>
    );
  }

  function renderStatusBlock() {
    if (loading) {
      return (
        <View style={{ paddingVertical: 18, alignItems: "center" }}>
          <ActivityIndicator />
          <Text style={{ marginTop: 10, color: MUTED, fontWeight: "800" }}>Loading...</Text>
        </View>
      );
    }

    if (err) {
      return (
        <GlassPanel style={{ marginTop: 14, padding: 12 }}>
          <Text style={{ color: TEXT, fontWeight: "900" }}>Couldn't load data</Text>
          <Text style={{ marginTop: 6, color: MUTED }}>{err}</Text>
        </GlassPanel>
      );
    }

    return null;
  }

  function renderSocialPanel(desktop = false) {
    return (
      <>
        {desktop ? (
          <View style={{ marginTop: 16, flexDirection: "row", alignItems: "flex-start", gap: 16 }}>
            <View style={{ flex: 1 }}>
              <OfficialMarketSocials />
            </View>
            <View style={{ width: 340 }}>{renderQuickActions()}</View>
          </View>
        ) : (
          <>
            {renderQuickActions()}
            <OfficialMarketSocials />
          </>
        )}

        <View
          style={{
            marginTop: 12,
            marginHorizontal: desktop ? 0 : -pagePadding,
            backgroundColor: "rgba(9,13,11,0.96)",
            borderTopWidth: 1,
            borderBottomWidth: 1,
            borderColor: "rgba(255,253,247,0.10)",
            borderRadius: desktop ? 24 : 0,
            overflow: "hidden",
          }}
        >
          <View
            style={{
              paddingHorizontal: desktop ? 18 : 16,
              paddingVertical: 14,
              borderBottomWidth: 1,
              borderBottomColor: "rgba(255,253,247,0.10)",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: TEXT, fontWeight: "900", fontSize: 18 }}>Social feed</Text>
              <Text style={{ marginTop: 4, color: MUTED, fontSize: 12 }}>
                Storefront updates, launches, and media from marketplace sellers.
              </Text>
            </View>
            <Pressable
              onPress={() => router.push("/market/social" as any)}
              style={{
                borderRadius: 999,
                borderWidth: 1,
                borderColor: "rgba(244,183,93,0.35)",
                backgroundColor: "rgba(244,183,93,0.16)",
                paddingHorizontal: 14,
                paddingVertical: 10,
              }}
            >
              <Text style={{ color: TEXT, fontWeight: "900", fontSize: 12 }}>Open feed</Text>
            </Pressable>
          </View>

          <SocialFeed />
        </View>
      </>
    );
  }

  function renderMobileHeader() {
    return (
      <>
        <AppHeader
          title="Marketplace"
          subtitle={section === "social" ? "Seller updates and marketplace media" : "Escrow-protected buying and selling"}
          showAccount={false}
          rightSlot={<NotificationBell />}
          bordered={false}
          style={{ backgroundColor: "transparent", paddingHorizontal: 0 }}
        />

        {renderSectionTabs("mobile")}
        {renderSearchBar(false)}
        {renderHeroPanel(false)}

        {section === "social" ? (
          renderSocialPanel(false)
        ) : (
          <>
            {renderQuickActions()}
            {renderDirectoryChooser(false)}
            {renderScopeAndFilters(false)}
            {renderStatusBlock()}
          </>
        )}
      </>
    );
  }

  function renderDesktopHeader() {
    return (
      <>
        <AppHeader
          title="Marketplace"
          subtitle={section === "social" ? "Seller updates and marketplace media" : "Escrow-protected buying and selling"}
          showAccount={false}
          rightSlot={<NotificationBell />}
          bordered={false}
          style={{ backgroundColor: "transparent", paddingHorizontal: 0, paddingTop: Math.max(insets.top + 18, 24) }}
        />

        <View style={{ marginTop: 6, flexDirection: "row", alignItems: "stretch", gap: 16 }}>
          {renderHeroPanel(true)}

          <View style={{ width: 340, gap: 12 }}>
            <GlassPanel style={{ padding: 16, backgroundColor: "rgba(255,253,247,0.06)" }}>
              <Text style={{ color: MUTED, fontWeight: "900", fontSize: 11 }}>MARKET PULSE</Text>
              <View style={{ marginTop: 12, flexDirection: "row", gap: 10 }}>
                <MarketMetric
                  label="In view"
                  value={String(resultCount)}
                  icon={directoryMode === "listings" ? "grid-outline" : "people-outline"}
                />
                <MarketMetric
                  label="Verified"
                  value={String(verifiedSellers.length)}
                  icon="checkmark-circle-outline"
                  tone={BLUE}
                />
              </View>
              <View style={{ marginTop: 10, flexDirection: "row", gap: 10 }}>
                <MarketMetric
                  label="Scope"
                  value={directoryMode === "listings" ? (feedScope === "country" ? "Local" : "Global") : "Stores"}
                  icon={feedScope === "country" ? "location-outline" : "earth-outline"}
                  tone={AMBER}
                />
                <MarketMetric
                  label="Mode"
                  value={directoryMode === "listings" ? "Listings" : "Stores"}
                  icon="options-outline"
                  tone={TEAL}
                />
              </View>
            </GlassPanel>

            <TrustTimeline />
          </View>
        </View>

        {section === "social" ? (
          renderSocialPanel(true)
        ) : (
          <>
            <View style={{ marginTop: 16, flexDirection: "row", alignItems: "flex-start", gap: 16 }}>
              {renderDirectoryChooser(true)}
              {renderScopeAndFilters(true)}
            </View>
            {renderStatusBlock()}
          </>
        )}
      </>
    );
  }

  return (
    <LinearGradient colors={[BG2, BG1, BG0]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={{ flex: 1 }}>
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
            {isDesktop ? renderDesktopHeader() : renderMobileHeader()}
          </View>
        }
        ListEmptyComponent={
          !loading && section !== "social" ? (
            <View style={{ marginTop: 14, marginHorizontal: 16, borderRadius: 20, padding: 14, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
              <Text style={{ color: TEXT, fontWeight: "900" }}>No results</Text>
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
