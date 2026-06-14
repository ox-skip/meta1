import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    FlatList,
    Image,
    Modal,
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
import { MARKET_DESKTOP_BREAKPOINT, MARKET_DESKTOP_RAIL_WIDTH } from "@/components/market/MarketDesktopSidebar";
import MarketMediaView from "@/components/market/MarketMediaView";
import NotificationBell from "@/components/market/NotificationBell";
import OfficialMarketSocials from "@/components/market/OfficialMarketSocials";
import SocialFeed from "@/components/market/SocialFeed";
import { InAppTutorial, TutorialTarget } from "@/components/onboarding/InAppTutorial";
import { askBestCityMarketGuide, type BestCityMarketGuideContext } from "@/services/market/ai";
import { CategoryItem, getCategoriesByMain, MarketMainCategory } from "@/services/market/categories";
import { fetchJsonWithTimeout, getSupabaseAnonKeyOrThrow, getSupabaseFunctionsBaseUrl } from "@/services/net";
import { tutorialFlows } from "@/services/onboarding/definitions";
import { supabase } from "@/services/supabase";
import { getCachedCountry, listingMatchesCountry, resolveUserCountry, type UserCountry } from "@/utils/country";
import { formatCountryLabel } from "@/utils/countryNames";
import { resolveMarketMediaSource, sortMarketMedia } from "@/utils/marketMedia";
import { friendlyMarketError } from "@/utils/marketUx";
import { formatCurrency, getListingPriceDisplay } from "@/utils/pricing";

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
  "id,seller_id,title,description,price_amount,currency,delivery_type,category,sub_category,created_at,payment_options,availability,stock_qty,featured_enabled,featured_until,featured_priority,cover:market_listing_images!market_listings_cover_image_fk(public_url,storage_path,meta),images:market_listing_images!market_listing_images_listing_id_fkey(public_url,storage_path,sort_order,meta)";
const LISTING_BASIC_SELECT =
  "id,seller_id,title,description,price_amount,currency,delivery_type,category,sub_category,created_at,payment_options,availability,stock_qty";
const LISTING_FEATURE_SELECT =
  "id,seller_id,title,description,price_amount,currency,delivery_type,category,sub_category,created_at,payment_options,availability,stock_qty,featured_enabled,featured_until,featured_priority,cover:market_listing_images!market_listings_cover_image_fk(public_url,storage_path,meta),images:market_listing_images!market_listing_images_listing_id_fkey(public_url,storage_path,sort_order,meta)";
const LISTING_FEATURE_BASIC_SELECT =
  "id,seller_id,title,description,price_amount,currency,delivery_type,category,sub_category,created_at,payment_options,availability,stock_qty,featured_enabled,featured_until,featured_priority";

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
  featured_enabled?: boolean | null;
  featured_until?: string | null;
  featured_priority?: number | null;
  cover?: { public_url?: string | null; storage_path?: string | null; meta?: any } | null;
  images?: { public_url?: string | null; storage_path?: string | null; sort_order?: number | null; meta?: any }[] | null;
};

type ListingReviewStats = {
  avgRating: number;
  reviewCount: number;
};

type SellerCard = {
  user_id: string;
  market_username: string | null;
  display_name: string | null;
  business_name: string | null;
  bio: string | null;
  is_verified: boolean | null;
  logo_path: string | null;
  active?: boolean | null;
  featured_enabled?: boolean | null;
  featured_until?: string | null;
  featured_listing_limit?: number | null;
};

type FeaturedPreviewItem = {
  key: string;
  featureType: "listing" | "store";
  title: string;
  subtitle: string;
  meta: string;
  uri: string | null;
  mediaKind: "image" | "video";
  accent: string;
  route: any;
  disabled?: boolean;
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

function listingFeatureIsVisible(row: ListingRow) {
  if (!row.featured_enabled) return false;
  if (!row.featured_until) return true;
  const untilMs = new Date(String(row.featured_until)).getTime();
  return Number.isFinite(untilMs) && untilMs >= Date.now();
}

function listingFeaturePriority(row: ListingRow) {
  const priority = Math.trunc(Number(row.featured_priority ?? 100));
  return Number.isFinite(priority) ? priority : 100;
}

function cleanListingSearch(value: string) {
  return value.trim().replace(/[%,]/g, " ").replace(/\s+/g, " ").slice(0, 90);
}

function formatRating(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0.0";
  return value.toFixed(value % 1 === 0 ? 0 : 1);
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
    featured_enabled: row?.featured_enabled ?? false,
    featured_until: row?.featured_until ?? null,
    featured_priority: row?.featured_priority === null || row?.featured_priority === undefined ? null : Number(row.featured_priority),
    cover,
    images,
  };
}

function normalizeListingRows(rows: any[]) {
  return rows.map(normalizeListingRow).filter(Boolean) as ListingRow[];
}

async function fetchListingReviewStats(listingIds: string[]) {
  const ids = Array.from(new Set(listingIds.map((id) => String(id || "").trim()).filter(Boolean)));
  const empty = ids.reduce((acc: Record<string, ListingReviewStats>, id) => {
    acc[id] = { avgRating: 0, reviewCount: 0 };
    return acc;
  }, {});
  if (!ids.length) return empty;

  try {
    const { data, error } = await supabase
      .from("market_listing_review_summary")
      .select("listing_id,review_count,avg_rating")
      .in("listing_id", ids);
    if (error) throw error;

    return (data ?? []).reduce((acc: Record<string, ListingReviewStats>, row: any) => {
      const listingId = String(row?.listing_id || "");
      if (!listingId) return acc;
      acc[listingId] = {
        avgRating: Number(row?.avg_rating ?? 0),
        reviewCount: Number(row?.review_count ?? 0),
      };
      return acc;
    }, empty);
  } catch {
    return empty;
  }
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
        height: 48,
        borderRadius: 18,
        paddingHorizontal: stretch ? 12 : 14,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: active ? "rgba(45,212,191,0.18)" : "rgba(255,253,247,0.04)",
        borderWidth: 1,
        borderTopWidth: 1,
        borderColor: active ? "rgba(45,212,191,0.5)" : "rgba(255,253,247,0.12)",
        borderTopColor: active ? "rgba(255,253,247,0.28)" : BORDER_TOP,
        shadowColor: "#000",
        shadowOpacity: active ? 0.18 : 0.06,
        shadowRadius: active ? 14 : 5,
        shadowOffset: { width: 0, height: active ? 10 : 2 },
        elevation: active ? 4 : 0,
        transform: [{ scale: pressed ? 0.985 : 1 }],
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {icon ? <Ionicons name={icon} size={15} color={active ? TEAL : MUTED} /> : null}
        <Text style={{ color: active ? TEXT : MUTED, fontWeight: "900", fontSize: 13 }}>{label}</Text>
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

function CompactDisclosure({
  eyebrow,
  title,
  summary,
  icon,
  accent,
  expanded,
  onToggle,
  children,
  style,
}: {
  eyebrow: string;
  title: string;
  summary: string;
  icon: keyof typeof Ionicons.glyphMap;
  accent: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  style?: any;
}) {
  return (
    <GlassPanel style={[{ marginTop: 10, overflow: "hidden", backgroundColor: "rgba(255,253,247,0.055)" }, style]}>
      <Pressable
        onPress={onToggle}
        style={({ pressed }) => ({
          paddingHorizontal: 13,
          paddingVertical: 12,
          flexDirection: "row",
          alignItems: "center",
          gap: 11,
          opacity: pressed ? 0.86 : 1,
        })}
      >
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: 13,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: `${accent}18`,
            borderWidth: 1,
            borderColor: `${accent}3A`,
          }}
        >
          <Ionicons name={icon} size={16} color={accent} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: MUTED, fontSize: 10, fontWeight: "900", textTransform: "uppercase" }} numberOfLines={1}>
            {eyebrow}
          </Text>
          <Text style={{ marginTop: 2, color: TEXT, fontSize: 14, fontWeight: "900" }} numberOfLines={1}>
            {title}
          </Text>
          <Text style={{ marginTop: 2, color: MUTED, fontSize: 11, fontWeight: "800" }} numberOfLines={1}>
            {summary}
          </Text>
        </View>
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: 13,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(255,253,247,0.07)",
            borderWidth: 1,
            borderColor: "rgba(255,253,247,0.12)",
          }}
        >
          <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={17} color={TEXT} />
        </View>
      </Pressable>
      {expanded ? (
        <View style={{ borderTopWidth: 1, borderTopColor: "rgba(255,253,247,0.10)", padding: 13 }}>
          {children}
        </View>
      ) : null}
    </GlassPanel>
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

const DEFAULT_MARKET_GUIDE_PROMPTS = [
  "How do I buy safely?",
  "How do I sell on BestCity?",
  "Explain escrow",
  "What is the stock market?",
] as const;

type MarketGuideMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
  source?: "bestcity_ai" | "local";
};

function createGuideMessage(role: MarketGuideMessage["role"], text: string, source?: MarketGuideMessage["source"]): MarketGuideMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    text,
    source,
  };
}

function BestCityMarketGuideSheet({
  visible,
  onClose,
  context,
  isDesktop,
  bottomInset,
  onStartTour,
  onOpenSearch,
  onOpenStock,
}: {
  visible: boolean;
  onClose: () => void;
  context: BestCityMarketGuideContext;
  isDesktop: boolean;
  bottomInset: number;
  onStartTour: () => void;
  onOpenSearch: () => void;
  onOpenStock: () => void;
}) {
  const [messages, setMessages] = useState<MarketGuideMessage[]>(() => [
    createGuideMessage(
      "assistant",
      "Hi, I can explain BestCity Market from end to end: buying, selling, escrow, orders, seller trust, local and global feeds, search, social updates, wallets, rewards, and stock market tools. Ask me anything about how to use it.",
    ),
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [followUps, setFollowUps] = useState<string[]>([...DEFAULT_MARKET_GUIDE_PROMPTS]);

  async function submitGuideQuestion(value?: string) {
    const question = String(value ?? input).trim();
    if (!question || loading) return;

    setInput("");
    setLoading(true);
    setMessages((current) => [...current, createGuideMessage("user", question)]);

    const result = await askBestCityMarketGuide(question, context);
    setMessages((current) => [...current, createGuideMessage("assistant", result.answer, result.source)]);
    setFollowUps(result.followUps.length ? result.followUps : [...DEFAULT_MARKET_GUIDE_PROMPTS]);
    setLoading(false);
  }

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <View
        style={{
          flex: 1,
          justifyContent: isDesktop ? "center" : "flex-end",
          alignItems: "center",
          padding: isDesktop ? 24 : 0,
          backgroundColor: "rgba(2,6,8,0.72)",
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close BestCity AI guide"
          onPress={onClose}
          style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
        />

        <View
          style={{
            width: "100%",
            maxWidth: isDesktop ? 620 : undefined,
            maxHeight: isDesktop ? 680 : "90%",
            borderTopLeftRadius: isDesktop ? 24 : 24,
            borderTopRightRadius: isDesktop ? 24 : 24,
            borderBottomLeftRadius: isDesktop ? 24 : 0,
            borderBottomRightRadius: isDesktop ? 24 : 0,
            overflow: "hidden",
            borderWidth: 1,
            borderColor: "rgba(255,253,247,0.15)",
            backgroundColor: "#07100F",
            shadowColor: "#000",
            shadowOpacity: 0.36,
            shadowRadius: 24,
            shadowOffset: { width: 0, height: 18 },
            elevation: 16,
          }}
        >
          <LinearGradient
            colors={["rgba(45,212,191,0.20)", "rgba(139,92,246,0.14)", "rgba(7,16,15,0.98)"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: "rgba(255,253,247,0.10)" }}
          >
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
              <View
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 16,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "rgba(45,212,191,0.20)",
                  borderWidth: 1,
                  borderColor: "rgba(94,234,212,0.42)",
                }}
              >
                <Ionicons name="sparkles-outline" size={20} color={TEXT} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: "#CCFBF1", fontWeight: "900", fontSize: 11 }}>BESTCITY AI GUIDE</Text>
                <Text style={{ marginTop: 3, color: TEXT, fontWeight: "900", fontSize: 19, lineHeight: 23 }}>
                  Ask how the market works
                </Text>
                <Text style={{ marginTop: 4, color: "rgba(255,253,247,0.72)", fontSize: 12, lineHeight: 17 }}>
                  Get help with buying, selling, escrow, orders, search, trust, social, wallets, rewards, and stocks.
                </Text>
              </View>
              <Pressable
                onPress={onClose}
                hitSlop={8}
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
                <Ionicons name="close" size={18} color={TEXT} />
              </Pressable>
            </View>

            <View style={{ marginTop: 13, flexDirection: "row", gap: 8 }}>
              <Pressable
                onPress={onStartTour}
                style={({ pressed }) => ({
                  flex: 1,
                  minHeight: 42,
                  borderRadius: 14,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 7,
                  backgroundColor: "rgba(244,183,93,0.17)",
                  borderWidth: 1,
                  borderColor: "rgba(244,183,93,0.34)",
                  transform: [{ scale: pressed ? 0.98 : 1 }],
                })}
              >
                <Ionicons name="navigate-circle-outline" size={16} color={AMBER} />
                <Text numberOfLines={1} style={{ color: TEXT, fontWeight: "900", fontSize: 12 }}>Tour</Text>
              </Pressable>
              <Pressable
                onPress={onOpenSearch}
                style={({ pressed }) => ({
                  flex: 1,
                  minHeight: 42,
                  borderRadius: 14,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 7,
                  backgroundColor: "rgba(56,189,248,0.15)",
                  borderWidth: 1,
                  borderColor: "rgba(125,211,252,0.30)",
                  transform: [{ scale: pressed ? 0.98 : 1 }],
                })}
              >
                <Ionicons name="search-outline" size={16} color={BLUE} />
                <Text numberOfLines={1} style={{ color: TEXT, fontWeight: "900", fontSize: 12 }}>Search</Text>
              </Pressable>
              <Pressable
                onPress={onOpenStock}
                style={({ pressed }) => ({
                  flex: 1,
                  minHeight: 42,
                  borderRadius: 14,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 7,
                  backgroundColor: "rgba(45,212,191,0.15)",
                  borderWidth: 1,
                  borderColor: "rgba(94,234,212,0.30)",
                  transform: [{ scale: pressed ? 0.98 : 1 }],
                })}
              >
                <Ionicons name="trending-up-outline" size={16} color={TEAL} />
                <Text numberOfLines={1} style={{ color: TEXT, fontWeight: "900", fontSize: 12 }}>Stocks</Text>
              </Pressable>
            </View>
          </LinearGradient>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={{ flexGrow: 0 }}
            contentContainerStyle={{ padding: 14, gap: 10 }}
          >
            {messages.map((message) => {
              const isUser = message.role === "user";
              return (
                <View
                  key={message.id}
                  style={{
                    alignSelf: isUser ? "flex-end" : "flex-start",
                    maxWidth: "88%",
                    borderRadius: 18,
                    borderTopRightRadius: isUser ? 6 : 18,
                    borderTopLeftRadius: isUser ? 18 : 6,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    backgroundColor: isUser ? "rgba(45,212,191,0.18)" : "rgba(255,253,247,0.07)",
                    borderWidth: 1,
                    borderColor: isUser ? "rgba(94,234,212,0.34)" : "rgba(255,253,247,0.11)",
                  }}
                >
                  <Text style={{ color: TEXT, fontSize: 12, lineHeight: 18, fontWeight: isUser ? "800" : "700" }}>
                    {message.text}
                  </Text>
                  {message.source === "local" ? (
                    <Text style={{ marginTop: 7, color: "rgba(244,183,93,0.82)", fontSize: 10, fontWeight: "800" }}>
                      Instant guide shown. Full AI response is unavailable right now.
                    </Text>
                  ) : null}
                </View>
              );
            })}

            {loading ? (
              <View style={{ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 }}>
                <ActivityIndicator color={TEAL} size="small" />
                <Text style={{ color: MUTED, fontWeight: "800", fontSize: 12 }}>BestCity AI is thinking...</Text>
              </View>
            ) : null}
          </ScrollView>

          <View
            style={{
              borderTopWidth: 1,
              borderTopColor: "rgba(255,253,247,0.10)",
              paddingHorizontal: 14,
              paddingTop: 10,
              paddingBottom: Math.max(bottomInset, 10) + 4,
              backgroundColor: "rgba(6,11,10,0.98)",
            }}
          >
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {followUps.map((prompt) => (
                <Pressable
                  key={prompt}
                  disabled={loading}
                  onPress={() => void submitGuideQuestion(prompt)}
                  style={({ pressed }) => ({
                    borderRadius: 999,
                    paddingHorizontal: 11,
                    paddingVertical: 8,
                    backgroundColor: "rgba(255,253,247,0.065)",
                    borderWidth: 1,
                    borderColor: "rgba(255,253,247,0.12)",
                    opacity: loading ? 0.55 : 1,
                    transform: [{ scale: pressed ? 0.98 : 1 }],
                  })}
                >
                  <Text style={{ color: MUTED, fontWeight: "900", fontSize: 11 }}>{prompt}</Text>
                </Pressable>
              ))}
            </ScrollView>

            <View
              style={{
                marginTop: 10,
                minHeight: 48,
                borderRadius: 17,
                paddingLeft: 12,
                paddingRight: 6,
                paddingVertical: 6,
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                backgroundColor: "rgba(255,253,247,0.07)",
                borderWidth: 1,
                borderColor: "rgba(255,253,247,0.13)",
              }}
            >
              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder="Ask about buying, selling, escrow..."
                placeholderTextColor={FAINT}
                multiline
                style={{ flex: 1, maxHeight: 78, color: TEXT, fontWeight: "800", fontSize: 13, paddingVertical: 8 }}
              />
              <Pressable
                disabled={loading || !input.trim()}
                onPress={() => void submitGuideQuestion()}
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 14,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: input.trim() && !loading ? "rgba(45,212,191,0.22)" : "rgba(255,253,247,0.07)",
                  borderWidth: 1,
                  borderColor: input.trim() && !loading ? "rgba(94,234,212,0.42)" : "rgba(255,253,247,0.12)",
                }}
              >
                <Ionicons name="send" size={16} color={input.trim() && !loading ? TEXT : FAINT} />
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
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
  const [reviewStatsMap, setReviewStatsMap] = useState<Record<string, ListingReviewStats>>({});
  const [featuredSellers, setFeaturedSellers] = useState<SellerCard[]>([]);
  const [featuredListings, setFeaturedListings] = useState<ListingRow[]>([]);
  const [verifiedSellers, setVerifiedSellers] = useState<SellerCard[]>([]);
  const [userCountry, setUserCountry] = useState<UserCountry | null>(null);
  const [countryErr, setCountryErr] = useState<string | null>(null);
  const [locatingCountry, setLocatingCountry] = useState(false);
  const [guideVisible, setGuideVisible] = useState(false);
  const [toolsVisible, setToolsVisible] = useState(false);
  const [tutorialStartSignal, setTutorialStartSignal] = useState(0);
  const [expandedCards, setExpandedCards] = useState<Record<"featured" | "discovery" | "filters", boolean>>({
    featured: false,
    discovery: false,
    filters: false,
  });
  

  const main = section === "service" ? "service" : section === "product" ? "product" : null;
  const usableWidth = Math.max(320, width);
  const isDesktop = usableWidth >= 900;
  const pagePadding = isDesktop ? 24 : width >= 820 ? 24 : 16;
  const hasDesktopRail = Platform.OS === "web" && usableWidth >= MARKET_DESKTOP_BREAKPOINT;
  const reservedDesktopRailWidth = hasDesktopRail ? MARKET_DESKTOP_RAIL_WIDTH : 0;
  const layoutWidth = Math.max(320, usableWidth - reservedDesktopRailWidth);
  const contentMaxWidth = isDesktop ? 1240 : width >= 1240 ? 1120 : undefined;
  const contentOuterWidth = Math.min(contentMaxWidth ?? layoutWidth, layoutWidth);
  const contentInnerWidth = contentOuterWidth - pagePadding * 2;
  const desktopListInset = isDesktop ? Math.max(0, (layoutWidth - contentOuterWidth) / 2) + pagePadding : 0;
  const desktopSidePanelWidth = 298;
  const desktopContentGap = 14;
  const resultsInnerWidth = isDesktop
    ? Math.max(320, contentInnerWidth - desktopSidePanelWidth - desktopContentGap)
    : contentInnerWidth;
  const gridGap = isDesktop ? 14 : 12;
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

  useEffect(() => {
    if (isDesktop && directoryMode === "featured") {
      setDirectoryMode("listings");
    }
  }, [directoryMode, isDesktop]);

  function toggleExpandedCard(key: "featured" | "discovery" | "filters") {
    setExpandedCards((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function startMarketTour() {
    setGuideVisible(false);
    setTutorialStartSignal(Date.now());
  }

  function openMarketSearchFromGuide() {
    setGuideVisible(false);
    router.push({ pathname: "/market/search" as any, params: q.trim() ? { q: q.trim() } : {} });
  }

  function openStockMarketFromGuide() {
    setGuideVisible(false);
    router.push("/market/stock" as any);
  }

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
    const selectCols =
      "user_id,market_username,display_name,business_name,bio,is_verified,logo_path,featured_enabled,featured_until,featured_listing_limit,active";
    const legacySelectCols =
      "user_id,market_username,display_name,business_name,bio,is_verified,logo_path,featured_enabled,featured_until,active";

    const fetchRows = async (table: string) => {
      const res = await supabase.from(table).select(selectCols).order("updated_at", { ascending: false }).limit(400);
      if (!res.error) return (res.data ?? []) as SellerCard[];

      const fallback = await supabase.from(table).select(legacySelectCols).order("updated_at", { ascending: false }).limit(400);
      return (fallback.data ?? []) as SellerCard[];
    };

    let rows = await fetchRows("market_seller_public_profiles");
    if (!rows.length) rows = await fetchRows("market_seller_profiles");

    const featured = rows.filter((r: any) => {
      if (r?.active === false) return false;
      if (!r?.featured_enabled) return false;
      if (!r?.featured_until) return true;
      const untilMs = new Date(String(r.featured_until)).getTime();
      if (!Number.isFinite(untilMs)) return false;
      return new Date(untilMs).toISOString() >= nowIso;
    });
    const verified = rows.filter((r: any) => r?.active !== false && !!r?.is_verified);

    setFeaturedSellers(featured);
    setVerifiedSellers(verified);
    await loadFeaturedListings(featured);
  }

  async function loadFeaturedListings(sellers: SellerCard[]) {
    const sellerIds = sellers.map((seller) => String(seller.user_id || "").trim()).filter(Boolean);
    const fetchStoreFeaturedRows = async (selectClause: string, useDeletedFilter: boolean) => {
      if (!sellerIds.length) return [] as ListingRow[];
      let query = supabase
        .from(LISTINGS_TABLE)
        .select(selectClause)
        .eq("is_active", true)
        .in("seller_id", sellerIds)
        .order("created_at", { ascending: false })
        .limit(36);

      if (useDeletedFilter) query = query.is("deleted_at", null);

      const { data, error } = await query;
      if (error) throw error;
      return normalizeListingRows((data ?? []) as any[]);
    };

    const storeAttempts: Array<[string, boolean]> = [
      [LISTING_RICH_SELECT, true],
      [LISTING_RICH_SELECT, false],
      [LISTING_BASIC_SELECT, false],
    ];

    let storeRows: ListingRow[] = [];
    for (const [selectClause, useDeletedFilter] of storeAttempts) {
      try {
        const fetched = await fetchStoreFeaturedRows(selectClause, useDeletedFilter);
        storeRows = selectClause === LISTING_BASIC_SELECT ? await fetchListingImagesFor(fetched) : fetched;
        break;
      } catch {
        storeRows = [];
      }
    }

    const fetchDirectFeaturedRows = async (selectClause: string, useDeletedFilter: boolean) => {
      let query = supabase
        .from(LISTINGS_TABLE)
        .select(selectClause)
        .eq("is_active", true)
        .eq("featured_enabled", true)
        .order("featured_priority", { ascending: true })
        .order("created_at", { ascending: false })
        .limit(36);

      if (useDeletedFilter) query = query.is("deleted_at", null);

      const { data, error } = await query;
      if (error) throw error;
      return normalizeListingRows((data ?? []) as any[]);
    };

    const directAttempts: Array<[string, boolean]> = [
      [LISTING_FEATURE_SELECT, true],
      [LISTING_FEATURE_SELECT, false],
      [LISTING_FEATURE_BASIC_SELECT, false],
    ];

    let directRows: ListingRow[] = [];
    for (const [selectClause, useDeletedFilter] of directAttempts) {
      try {
        const fetched = await fetchDirectFeaturedRows(selectClause, useDeletedFilter);
        directRows = selectClause === LISTING_FEATURE_BASIC_SELECT ? await fetchListingImagesFor(fetched) : fetched;
        break;
      } catch {
        directRows = [];
      }
    }

    const sellerRank = new Map(sellerIds.map((id, index) => [id, index]));
    const sellerLimits = new Map(
      sellers.map((seller) => [
        seller.user_id,
        Math.min(100, Math.max(1, Math.trunc(Number(seller.featured_listing_limit ?? 12) || 12))),
      ]),
    );
    const perSellerCounts = new Map<string, number>();
    const storeVisible = storeRows
      .filter((row) => !listingIsExpired(row))
      .sort((a, b) => {
        const rankA = sellerRank.get(a.seller_id) ?? 9999;
        const rankB = sellerRank.get(b.seller_id) ?? 9999;
        if (rankA !== rankB) return rankA - rankB;
        return new Date(String(b.created_at || 0)).getTime() - new Date(String(a.created_at || 0)).getTime();
      })
      .filter((row) => {
        const current = perSellerCounts.get(row.seller_id) ?? 0;
        const limit = sellerLimits.get(row.seller_id) ?? 12;
        if (current >= limit) return false;
        perSellerCounts.set(row.seller_id, current + 1);
        return true;
      });

    const directVisible = directRows
      .filter((row) => !listingIsExpired(row) && listingFeatureIsVisible(row))
      .sort((a, b) => {
        const priority = listingFeaturePriority(a) - listingFeaturePriority(b);
        if (priority !== 0) return priority;
        return new Date(String(b.created_at || 0)).getTime() - new Date(String(a.created_at || 0)).getTime();
      });

    const unique = new Map<string, ListingRow>();
    [...directVisible, ...storeVisible].forEach((row) => {
      if (row.id && !unique.has(row.id)) unique.set(row.id, row);
    });

    setFeaturedListings(Array.from(unique.values()).slice(0, 12));
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

      const [sellerRes, ordersRes, listingReviewStats] = await Promise.all([
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
        fetchListingReviewStats(listingIds),
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
      setReviewStatsMap(listingReviewStats);
    } catch (e: any) {
      setErr(friendlyMarketError(e, "We couldn't load marketplace listings."));
      setRows([]);
      setReviewStatsMap({});
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
  const responsiveListingColumns = resultsInnerWidth >= 1100 ? 3 : resultsInnerWidth >= 620 ? 2 : 1;
  const sellerDirectoryColumns = isDesktop && resultsInnerWidth >= 760 ? 2 : 1;
  const listingColumns = isListingDirectory ? responsiveListingColumns : sellerDirectoryColumns;
  const desktopCardWidth =
    listingColumns === 1
      ? resultsInnerWidth
      : (resultsInnerWidth - gridGap * (listingColumns - 1)) / listingColumns;
  const listingCardWidth =
    isDesktop ? desktopCardWidth : listingColumns === 1 ? undefined : listingColumns === 2 ? "48.7%" : "31.9%";
  const listingMediaAspectRatio = listingColumns === 1 ? 4 / 3 : isDesktop ? 1.12 : 1;
  const sellerCardWidth =
    isDesktop ? desktopCardWidth : listingColumns === 1 ? undefined : listingColumns === 2 ? "48.7%" : "31.9%";
  const contentBottomPadding = isDesktop ? 38 : Math.max(122, insets.bottom + 102);
  const resultCount = directoryMode === "listings" ? rows.length : directoryRows.length;
  const selectedCategoryTitle = selectedSlug
    ? categories.find((item) => item.slug === selectedSlug)?.title ?? selectedSlug
    : null;
  const marketGuideContext = useMemo<BestCityMarketGuideContext>(
    () => ({
      section,
      directoryMode,
      feedScope,
      resultCount,
      locationLabel,
      selectedCategory: selectedCategoryTitle,
      query: q.trim(),
      sortBy,
    }),
    [directoryMode, feedScope, locationLabel, q, resultCount, section, selectedCategoryTitle, sortBy],
  );
  const feedLabel = section === "service" ? "services" : section === "product" ? "products" : "listings";
  const searchPlaceholder =
    directoryMode === "listings"
      ? `Filter ${feedLabel} in this feed`
      : "Search stores or @username";
  const heroTitle =
    section === "social"
      ? "Stay close to marketplace activity"
      : section === "service"
      ? "Find services with proof and escrow"
      : section === "product"
      ? "Shop products with cleaner signals"
      : "Discover trusted products and services";
  const heroSubtitle =
    section === "social"
      ? "Browse fresh seller updates, launches, and media from the marketplace."
      : section === "service"
      ? "Search by need, compare sellers, and check availability before starting the order flow."
      : section === "product"
      ? "Use featured picks, local/global scope, ratings, and escrow signals to choose faster."
      : "A buyer-first marketplace home with search, category discovery, featured listings, and trust cues in one place.";
  const resultTitle =
    directoryMode === "listings"
      ? `${resultCount} ${feedLabel} in view`
      : directoryMode === "featured"
      ? `${resultCount} featured stores`
      : `${resultCount} verified stores`;
  const visibleListingIdsKey = useMemo(
    () => rows.map((row) => row.id).filter(Boolean).sort().join(","),
    [rows],
  );

  useEffect(() => {
    const listingIds = visibleListingIdsKey
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    if (!listingIds.length) return;

    let alive = true;
    const listingIdSet = new Set(listingIds);
    const refresh = async () => {
      const next = await fetchListingReviewStats(listingIds);
      if (alive) setReviewStatsMap((current) => ({ ...current, ...next }));
    };

    void refresh();

    const channel = supabase
      .channel("market-home-listing-reviews")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "market_listing_reviews" },
        (payload: any) => {
          const changedListingId = String(payload?.new?.listing_id ?? payload?.old?.listing_id ?? "");
          if (listingIdSet.has(changedListingId)) void refresh();
        },
      )
      .subscribe();

    return () => {
      alive = false;
      supabase.removeChannel(channel);
    };
  }, [visibleListingIdsKey]);

  const resultSubtitle =
    directoryMode === "listings"
      ? feedScope === "country"
        ? userCountry
          ? `Showing ${feedLabel} matched to ${locationLabel}.`
          : `Showing Global ${feedLabel} while your country is being detected.`
        : `Showing ${feedLabel} from every country in the marketplace.`
      : directoryMode === "featured"
      ? "Browse promoted storefronts first."
      : "Browse stores with verified storefronts.";
  const heroAccent =
    section === "service" ? TEAL : section === "product" ? BLUE : section === "social" ? AMBER : PURPLE;
  const heroFeaturedItems = useMemo<FeaturedPreviewItem[]>(() => {
    const maxItems = isDesktop ? 5 : 4;
    const listingItems = featuredListings
      .filter((item) => !main || item.category === main)
      .slice(0, maxItems)
      .map((item, index) => {
        const mediaSource = resolveMarketMediaSource(
          [item.cover ?? null, ...sortMarketMedia(item.images ?? [])],
          supabaseUrl,
          LISTING_IMAGES_BUCKET,
        );
        const displayPrice = getListingPriceDisplay(item as any);
        const seller = featuredSellers.find((s) => s.user_id === item.seller_id) ?? sellersMap[item.seller_id];
        return {
          key: `listing-${item.id}`,
          featureType: "listing" as const,
          title: item.title || "Untitled listing",
          subtitle: seller?.business_name || seller?.display_name || (seller?.market_username ? `@${seller.market_username}` : "Featured store"),
          meta: formatCurrency(displayPrice.localCurrency, displayPrice.localNow),
          uri: mediaSource?.url ?? null,
          mediaKind: (mediaSource?.kind ?? "image") as "image" | "video",
          accent: [TEAL, AMBER, BLUE][index % 3],
          route: { pathname: "/market/listing/[id]" as any, params: { id: item.id } },
        };
      });

    const storeItems = featuredSellers
      .slice(0, maxItems)
      .map((store, index) => {
        const logo = publicSellerLogo(store.logo_path);
        const name = store.business_name || store.display_name || "Featured store";
        return {
          key: `store-${store.user_id}`,
          featureType: "store" as const,
          title: name,
          subtitle: store.market_username ? `@${store.market_username}` : "Store profile",
          meta: "Storefront",
          uri: logo,
          mediaKind: "image" as const,
          accent: [AMBER, TEAL, BLUE][index % 3],
          route: store.market_username ? (`/market/profile/${store.market_username}` as any) : null,
          disabled: !store.market_username,
        };
      });

    const items: FeaturedPreviewItem[] = [];
    for (let index = 0; items.length < maxItems && (index < listingItems.length || index < storeItems.length); index += 1) {
      if (listingItems[index]) items.push(listingItems[index]);
      if (items.length < maxItems && storeItems[index]) items.push(storeItems[index]);
    }
    return items;
  }, [featuredListings, featuredSellers, isDesktop, main, sellersMap, supabaseUrl]);

  const discoveryCategoryTiles = useMemo<CategoryItem[]>(() => {
    if (main) return getCategoriesByMain(main as MarketMainCategory).slice(0, isDesktop ? 10 : 8);
    return [
      ...getCategoriesByMain("product").slice(0, isDesktop ? 5 : 4),
      ...getCategoriesByMain("service").slice(0, isDesktop ? 5 : 4),
    ];
  }, [isDesktop, main]);

  const renderListing = ({ item, index = 0 }: { item: ListingRow; index?: number }) => {
    const mediaSource = resolveMarketMediaSource(
      [item.cover ?? null, ...sortMarketMedia(item.images ?? [])],
      supabaseUrl,
      LISTING_IMAGES_BUCKET,
    );
    const coverUrl = mediaSource?.url ?? null;
    const coverKind = mediaSource?.kind ?? "image";
    const seller = sellersMap[item.seller_id];
    const stats = statsMap[item.id] ?? { completed: 0, cancelled: 0, failed: 0 };
    const reviewStats = reviewStatsMap[item.id] ?? { avgRating: 0, reviewCount: 0 };
    const displayPrice = getListingPriceDisplay(item as any);
    const showDiscount = displayPrice.hasDiscount;

    const isOutOfStock = item.category === "product" && typeof item.stock_qty === "number" && item.stock_qty <= 0;
    const categoryLabel = item.category === "service" ? "Service" : "Product";
    const deliveryLabel = String(item.delivery_type || "delivery").replace(/_/g, " ");
    const freshnessLabel = stats.completed > 0 ? `${stats.completed} sold` : "Fresh";

    const card = (
      <Pressable
        onPress={() => router.push({ pathname: "/market/listing/[id]" as any, params: { id: item.id } })}
        style={({ pressed }) => ({
          width: listingCardWidth as any,
          marginHorizontal: listingColumns === 1 && !isDesktop ? pagePadding : 0,
          marginLeft: listingColumns === 1 && isDesktop ? desktopListInset : undefined,
          marginTop: isDesktop ? 7 : 16,
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

          <View style={{ marginTop: 9, flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
              {[1, 2, 3, 4, 5].map((star) => (
                <Ionicons
                  key={star}
                  name={reviewStats.avgRating >= star - 0.25 ? "star" : "star-outline"}
                  size={13}
                  color={reviewStats.reviewCount ? AMBER : FAINT}
                />
              ))}
            </View>
            <Text numberOfLines={1} style={{ color: MUTED, fontWeight: "900", fontSize: 11, flexShrink: 1 }}>
              {reviewStats.reviewCount
                ? `${formatRating(reviewStats.avgRating)} (${reviewStats.reviewCount})`
                : "No listing reviews yet"}
            </Text>
          </View>

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

    return index === 0 ? <TutorialTarget id="market.home.cards">{card}</TutorialTarget> : card;
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
          marginLeft: listingColumns === 1 && isDesktop ? desktopListInset : undefined,
          borderRadius: 22,
          overflow: "hidden",
          backgroundColor: INK,
          borderWidth: 1,
          borderTopWidth: 1,
          borderColor: "rgba(255,253,247,0.13)",
          borderTopColor: BORDER_TOP,
          marginTop: isDesktop ? 8 : 12,
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
        <TutorialTarget id="market.home.sections">
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
        </TutorialTarget>
      );
    }

    return (
      <TutorialTarget id="market.home.sections">
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
      </TutorialTarget>
    );
  }

  function renderSearchBar(prominent = false) {
    return section !== "social" ? (
      <TutorialTarget id="market.home.search">
        <View
          style={{
            marginTop: prominent ? 18 : 12,
            minHeight: prominent ? 58 : 0,
            flexDirection: "row",
            gap: 10,
            alignItems: "center",
            borderRadius: prominent ? 24 : 20,
            padding: prominent ? 16 : 13,
            borderWidth: 1,
            borderTopWidth: 1,
            borderColor: prominent ? "rgba(45,212,191,0.26)" : "rgba(255,253,247,0.15)",
            borderTopColor: prominent ? "rgba(255,253,247,0.28)" : "rgba(255,253,247,0.2)",
            backgroundColor: prominent ? "rgba(9,13,11,0.74)" : "rgba(255,253,247,0.05)",
            shadowColor: "#000",
            shadowOpacity: prominent ? 0.14 : 0,
            shadowRadius: prominent ? 18 : 0,
            shadowOffset: { width: 0, height: 8 },
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
      </TutorialTarget>
    ) : null;
  }

  function renderStockMarketShortcut(prominent = false) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open Stock Market"
        onPress={() => router.push("/market/stock" as any)}
        style={({ pressed }) => ({
          marginTop: prominent ? 18 : 10,
          width: prominent ? 164 : "100%",
          minHeight: prominent ? 58 : 46,
          borderRadius: prominent ? 22 : 16,
          overflow: "hidden",
          borderWidth: 1,
          borderTopWidth: 1,
          borderColor: "rgba(45,212,191,0.36)",
          borderTopColor: "rgba(255,253,247,0.22)",
          backgroundColor: "rgba(45,212,191,0.10)",
          transform: [{ translateY: pressed ? 1 : 0 }, { scale: pressed ? 0.985 : 1 }],
        })}
      >
        <LinearGradient
          colors={["rgba(45,212,191,0.24)", "rgba(56,189,248,0.12)", "rgba(9,13,11,0.72)"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            flex: 1,
            minHeight: prominent ? 58 : 46,
            paddingHorizontal: prominent ? 13 : 12,
            paddingVertical: prominent ? 9 : 8,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
          }}
        >
          <View
            style={{
              width: prominent ? 36 : 30,
              height: prominent ? 36 : 30,
              borderRadius: prominent ? 13 : 11,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(45,212,191,0.20)",
              borderWidth: 1,
              borderColor: "rgba(94,234,212,0.38)",
            }}
          >
            <Ionicons name="trending-up-outline" size={prominent ? 17 : 15} color={TEXT} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ color: TEXT, fontWeight: "900", fontSize: prominent ? 13 : 12 }}>
              Stock Market
            </Text>
            {prominent ? (
              <Text numberOfLines={1} style={{ marginTop: 2, color: "rgba(255,253,247,0.62)", fontWeight: "800", fontSize: 10 }}>
                Trade seller stock
              </Text>
            ) : null}
          </View>
          <Ionicons name="chevron-forward" size={16} color={TEAL} />
        </LinearGradient>
      </Pressable>
    );
  }

  function renderHeroPreviewRail(compact = false) {
    if (!heroFeaturedItems.length) {
      return (
        <GlassPanel
          style={{
            marginTop: compact ? 14 : 0,
            borderRadius: compact ? 18 : 24,
            padding: compact ? 14 : 18,
            borderColor: "rgba(255,253,247,0.14)",
            backgroundColor: "rgba(255,253,247,0.05)",
            minHeight: compact ? 118 : 190,
            justifyContent: "center",
            gap: 10,
          }}
        >
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 16,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(45,212,191,0.18)",
              borderWidth: 1,
              borderColor: "rgba(94,234,212,0.36)",
            }}
          >
            <Ionicons name="sparkles-outline" size={18} color={TEAL} />
          </View>
          <Text style={{ color: TEXT, fontWeight: "900", fontSize: compact ? 13 : 15 }}>
            Featured
          </Text>
          <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18 }}>
            Promoted listings and storefronts will appear here when available.
          </Text>
        </GlassPanel>
      );
    }

    if (compact) {
      return (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginTop: 14, marginHorizontal: -16 }}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
        >
          {heroFeaturedItems.map((item) => (
            <Pressable
              key={item.key}
              disabled={item.disabled}
              onPress={() => item.route && router.push(item.route)}
              style={({ pressed }) => ({
                width: 178,
                borderRadius: 20,
                overflow: "hidden",
                borderWidth: 1,
                borderColor: "rgba(255,253,247,0.16)",
                backgroundColor: pressed ? "rgba(45,212,191,0.12)" : "rgba(255,253,247,0.06)",
                transform: [{ scale: pressed ? 0.985 : 1 }],
              })}
            >
              <LinearGradient
                colors={["rgba(45,212,191,0.14)", "rgba(255,253,247,0.04)", "rgba(9,13,11,0.88)"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ paddingBottom: 12 }}
              >
                <View style={{ height: 92, backgroundColor: "rgba(255,253,247,0.08)", overflow: "hidden" }}>
                  {item.uri ? (
                    item.featureType === "store" ? (
                      <Image source={{ uri: item.uri }} style={{ width: "100%", height: "100%" }} />
                    ) : (
                      <MarketMediaView
                        uri={item.uri}
                        kind={item.mediaKind}
                        style={{ width: "100%", height: "100%" }}
                        resizeMode={item.mediaKind === "video" ? "contain" : "cover"}
                        muted
                        disablePointerEvents
                      />
                    )
                  ) : (
                    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                      <Ionicons name={item.featureType === "store" ? "storefront-outline" : "image-outline"} size={20} color={MUTED} />
                    </View>
                  )}
                </View>
                <View style={{ paddingHorizontal: 12, paddingTop: 10 }}>
                  <Text numberOfLines={1} style={{ color: TEXT, fontWeight: "900", fontSize: 12 }}>
                    {item.title}
                  </Text>
                  <Text numberOfLines={1} style={{ marginTop: 4, color: MUTED, fontWeight: "800", fontSize: 10 }}>
                    {item.subtitle}
                  </Text>
                </View>
              </LinearGradient>
              <View style={{ paddingHorizontal: 12, paddingBottom: 12 }}>
                <Text numberOfLines={1} style={{ marginTop: 6, color: item.accent, fontWeight: "900", fontSize: 12 }}>
                  {item.meta}
                </Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      );
    }

    return (
      <View style={{ gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <Text style={{ color: MUTED, fontWeight: "900", fontSize: 11 }}>FEATURED</Text>
          <View
            style={{
              borderRadius: 999,
              paddingHorizontal: 10,
              paddingVertical: 5,
              backgroundColor: "rgba(45,212,191,0.16)",
              borderWidth: 1,
              borderColor: "rgba(94,234,212,0.30)",
            }}
          >
            <Text style={{ color: TEXT, fontWeight: "900", fontSize: 10 }}>{heroFeaturedItems.length} active</Text>
          </View>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 260 }} contentContainerStyle={{ gap: 12 }}>
          {heroFeaturedItems.map((item) => (
            <Pressable
              key={item.key}
              disabled={item.disabled}
              onPress={() => item.route && router.push(item.route)}
              style={({ pressed }) => ({
                borderRadius: 20,
                overflow: "hidden",
                borderWidth: 1,
                borderColor: pressed ? "rgba(244,183,93,0.34)" : "rgba(255,253,247,0.14)",
                backgroundColor: pressed ? "rgba(255,253,247,0.10)" : "rgba(9,13,11,0.64)",
                flexDirection: "row",
                alignItems: "center",
                opacity: item.disabled ? 0.62 : 1,
                transform: [{ translateY: pressed ? 1 : 0 }],
              })}
            >
              <View style={{ width: 76, height: 76, backgroundColor: "rgba(255,253,247,0.08)", overflow: "hidden" }}>
                {item.uri ? (
                  item.featureType === "store" ? (
                    <Image source={{ uri: item.uri }} style={{ width: "100%", height: "100%" }} />
                  ) : (
                    <MarketMediaView
                      uri={item.uri}
                      kind={item.mediaKind}
                      style={{ width: "100%", height: "100%" }}
                      resizeMode={item.mediaKind === "video" ? "contain" : "cover"}
                      muted
                      disablePointerEvents
                    />
                  )
                ) : (
                  <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name={item.featureType === "store" ? "storefront-outline" : "image-outline"} size={21} color={MUTED} />
                  </View>
                )}
              </View>
              <View style={{ flex: 1, minWidth: 0, paddingHorizontal: 14, paddingVertical: 12 }}>
                <Text
                  numberOfLines={1}
                  style={{
                    color: item.accent,
                    fontWeight: "900",
                    fontSize: 10,
                  }}
                >
                  {item.featureType === "store" ? "STORE" : "LISTING"}
                </Text>
                <Text numberOfLines={1} style={{ color: TEXT, fontWeight: "900", fontSize: 14, marginTop: 6 }}>
                  {item.title}
                </Text>
                <Text numberOfLines={1} style={{ marginTop: 4, color: MUTED, fontWeight: "800", fontSize: 11 }}>
                  {item.subtitle}
                </Text>
                <Text numberOfLines={1} style={{ marginTop: 6, color: item.accent, fontWeight: "900", fontSize: 12 }}>
                  {item.meta}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={MUTED} style={{ marginRight: 14 }} />
            </Pressable>
          ))}
        </ScrollView>
      </View>
    );
  }

  function renderHeroPanel(desktop = false) {
    const showPreviewShelf = desktop && resultsInnerWidth >= 760 && section !== "social";
    const kicker = section === "social" ? "SELLER BOARD" : section === "service" ? "SERVICES" : section === "product" ? "PRODUCTS" : "MARKETPLACE";

    if (desktop) {
      return (
        <View style={{ position: "relative", marginTop: 12 }}>
          <LinearGradient
            colors={[`${heroAccent}22`, "rgba(255,253,247,0.06)", "rgba(9,13,11,0.76)"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              flex: 1,
              minHeight: 292,
              borderRadius: 26,
              padding: 24,
              borderWidth: 1,
              borderColor: "rgba(255,253,247,0.17)",
              overflow: "hidden",
              shadowColor: "#000",
              shadowOpacity: 0.28,
              shadowRadius: 30,
              shadowOffset: { width: 0, height: 18 },
              elevation: 10,
            }}
          >
            <View
              style={{
                position: "absolute",
                top: -32,
                right: -20,
                width: 180,
                height: 180,
                borderRadius: 90,
                backgroundColor: `${heroAccent}18`,
                opacity: 0.55,
              }}
            />
            <View
              style={{
                position: "absolute",
                bottom: -38,
                left: -28,
                width: 152,
                height: 152,
                borderRadius: 76,
                backgroundColor: "rgba(255,253,247,0.06)",
              }}
            />
            <View style={{ flex: 1, flexDirection: showPreviewShelf ? "row" : "column", gap: 18 }}>
              <View style={{ flex: 1, minWidth: 0, justifyContent: "space-between" }}>
                <View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <CardBadge label={kicker} icon={section === "social" ? "people-outline" : "shield-checkmark-outline"} tone={section === "social" ? "gold" : "teal"} />
                    {section !== "social" ? (
                      <CardBadge label={feedScope === "country" ? "Local first" : "Global feed"} icon={feedScope === "country" ? "location-outline" : "earth-outline"} tone="blue" />
                    ) : null}
                  </View>
                  <Text style={{ marginTop: 14, color: TEXT, fontWeight: "900", fontSize: showPreviewShelf ? 36 : 32, lineHeight: showPreviewShelf ? 42 : 38 }}>
                    {heroTitle}
                  </Text>
                  <Text style={{ marginTop: 10, color: "rgba(255,253,247,0.76)", lineHeight: 22, fontSize: 14, maxWidth: 650 }}>
                    {heroSubtitle}
                  </Text>
                </View>

                <View style={{ marginTop: 18 }}>
                  {section === "social" ? (
                    <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap", maxWidth: 620 }}>
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
                    <View style={{ flexDirection: "row", alignItems: "stretch", gap: 12 }}>
                      <View style={{ flex: 1, minWidth: 0 }}>{renderSearchBar(true)}</View>
                      {renderStockMarketShortcut(true)}
                    </View>
                  )}

                  {renderSectionTabs("desktop")}
                </View>
              </View>

              {showPreviewShelf ? (
                <View style={{ width: 296, justifyContent: "center" }}>
                  {renderHeroPreviewRail(false)}
                </View>
              ) : null}
            </View>
          </LinearGradient>
        </View>
      );
    }

    return (
      <CompactDisclosure
        eyebrow={kicker}
        title={heroTitle}
        summary={section === "social" ? "Seller activity and marketplace media" : `${resultCount} in view - ${feedScope === "country" ? "Local" : "Global"}`}
        icon={section === "social" ? "people-outline" : "sparkles-outline"}
        accent={heroAccent}
        expanded={expandedCards.featured}
        onToggle={() => toggleExpandedCard("featured")}
        style={{ marginTop: 12 }}
      >
        <LinearGradient
          colors={[`${heroAccent}18`, "rgba(244,183,93,0.08)", "rgba(255,253,247,0.04)"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            borderRadius: 18,
            padding: 14,
            borderWidth: 1,
            borderColor: "rgba(255,253,247,0.14)",
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <CardBadge label={kicker} icon={section === "social" ? "people-outline" : "shield-checkmark-outline"} tone={section === "social" ? "gold" : "teal"} />
            {section !== "social" ? (
              <CardBadge label={feedScope === "country" ? "Local first" : "Global feed"} icon={feedScope === "country" ? "location-outline" : "earth-outline"} tone="blue" />
            ) : null}
          </View>
          <Text style={{ marginTop: 12, color: TEXT, fontWeight: "900", fontSize: 22, lineHeight: 28 }}>{heroTitle}</Text>
          <Text style={{ marginTop: 7, color: MUTED, lineHeight: 19, fontSize: 12 }} numberOfLines={2}>
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
      </CompactDisclosure>
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

  function selectDiscoveryCategory(item: CategoryItem) {
    setSection(item.main);
    setDirectoryMode("listings");
    setSelectedSlug(item.slug);
    setQ("");
  }

  function renderCategoryDiscovery(desktop = false) {
    if (section === "social") return null;

    return (
      <GlassPanel style={{ marginTop: 12, padding: desktop ? 15 : 13, backgroundColor: "rgba(255,253,247,0.055)" }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: MUTED, fontWeight: "900", fontSize: 11 }}>DISCOVER BY CATEGORY</Text>
            <Text style={{ marginTop: 4, color: TEXT, fontWeight: "900", fontSize: desktop ? 18 : 15 }}>
              {main ? `${main === "product" ? "Product" : "Service"} categories` : "Popular product and service lanes"}
            </Text>
          </View>
          <Pressable
            onPress={() =>
              router.push({
                pathname: "/market/category" as any,
                params: main ? { mode: main } : undefined,
              })
            }
            style={({ pressed }) => ({
              width: 38,
              height: 38,
              borderRadius: 14,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(255,253,247,0.075)",
              borderWidth: 1,
              borderColor: "rgba(255,253,247,0.13)",
              transform: [{ scale: pressed ? 0.97 : 1 }],
            })}
          >
            <Ionicons name="grid-outline" size={17} color={TEXT} />
          </Pressable>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginTop: 12, marginHorizontal: -4 }}
          contentContainerStyle={{ paddingHorizontal: 4, gap: 10 }}
        >
          {discoveryCategoryTiles.map((item) => {
            const active = item.main === main && selectedSlug === item.slug;
            const tone = item.main === "product" ? BLUE : TEAL;
            return (
              <Pressable
                key={`${item.main}:${item.slug}`}
                onPress={() => selectDiscoveryCategory(item)}
                style={({ pressed }) => ({
                  width: desktop ? 166 : 142,
                  minHeight: 98,
                  borderRadius: 18,
                  padding: 12,
                  justifyContent: "space-between",
                  backgroundColor: active ? `${tone}1F` : "rgba(9,13,11,0.42)",
                  borderWidth: 1,
                  borderColor: active ? `${tone}66` : "rgba(255,253,247,0.12)",
                  transform: [{ translateY: pressed ? 1 : 0 }, { scale: pressed ? 0.985 : 1 }],
                })}
              >
                <View
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 13,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: `${tone}1F`,
                    borderWidth: 1,
                    borderColor: `${tone}45`,
                  }}
                >
                  <Ionicons name={item.icon as keyof typeof Ionicons.glyphMap} size={16} color={tone} />
                </View>
                <View>
                  <Text numberOfLines={1} style={{ color: TEXT, fontWeight: "900", fontSize: 13 }}>
                    {item.title}
                  </Text>
                  <Text numberOfLines={1} style={{ marginTop: 3, color: MUTED, fontWeight: "800", fontSize: 10 }}>
                    {item.main === "product" ? "Products" : "Services"}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      </GlassPanel>
    );
  }

  function renderBuyerAssistantPanel(desktop = false) {
    if (section === "social") return null;
    const hasQuery = !!q.trim();
    const localReady = feedScope === "country" && !!userCountry;
    const actionBaseStyle = {
      flexGrow: 1,
      flexBasis: desktop ? 124 : mobileActionStack ? "100%" : 132,
      minHeight: 74,
      borderRadius: 18,
      padding: 12,
      borderWidth: 1,
    } as const;
    const actions: Array<{
      label: string;
      detail: string;
      icon: keyof typeof Ionicons.glyphMap;
      accent: string;
      onPress: () => void;
    }> = [
      {
        label: hasQuery ? "Search it" : "Find products",
        detail: hasQuery ? `"${q.trim().slice(0, 24)}"` : "Use guided search",
        icon: "search-outline",
        accent: TEAL,
        onPress: () => router.push({ pathname: "/market/search" as any, params: hasQuery ? { q: q.trim() } : {} }),
      },
      {
        label: "Check trust",
        detail: "Verified stores",
        icon: "shield-checkmark-outline",
        accent: BLUE,
        onPress: () => {
          setDirectoryMode("verified");
          setSelectedSlug(null);
        },
      },
      {
        label: "Compare",
        detail: "Sort by price",
        icon: "git-compare-outline",
        accent: AMBER,
        onPress: () => {
          setDirectoryMode("listings");
          setSortBy("price_low");
        },
      },
      {
        label: localReady ? "Nearby" : "Locate",
        detail: localReady ? locationLabel : "Local feed",
        icon: "location-outline",
        accent: TEAL,
        onPress: async () => {
          setDirectoryMode("listings");
          setFeedScope("country");
          if (!userCountry) await refreshCountry();
        },
      },
    ];

    if (!desktop) {
      return (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open BestCity AI guide"
          onPress={() => setGuideVisible(true)}
          style={({ pressed }) => ({
            marginTop: 10,
            borderRadius: 18,
            overflow: "hidden",
            borderWidth: 1,
            borderTopWidth: 1,
            borderColor: "rgba(196,181,253,0.36)",
            borderTopColor: "rgba(255,253,247,0.24)",
            backgroundColor: "rgba(139,92,246,0.11)",
            transform: [{ translateY: pressed ? 1 : 0 }, { scale: pressed ? 0.985 : 1 }],
          })}
        >
          <LinearGradient
            colors={["rgba(139,92,246,0.22)", "rgba(45,212,191,0.12)", "rgba(9,13,11,0.72)"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              minHeight: 58,
              paddingHorizontal: 13,
              paddingVertical: 10,
              flexDirection: "row",
              alignItems: "center",
              gap: 11,
            }}
          >
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: 14,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "rgba(139,92,246,0.24)",
                borderWidth: 1,
                borderColor: "rgba(196,181,253,0.42)",
              }}
            >
              <Ionicons name="sparkles-outline" size={17} color={TEXT} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ color: TEXT, fontWeight: "900", fontSize: 13 }}>
                BestCity AI Guide
              </Text>
              <Text numberOfLines={1} style={{ marginTop: 2, color: "rgba(255,253,247,0.64)", fontWeight: "800", fontSize: 10 }}>
                Ask about buying, selling, escrow, orders, search, or stocks
              </Text>
            </View>
            <Ionicons name="chatbubble-ellipses-outline" size={17} color="#DDD6FE" />
          </LinearGradient>
        </Pressable>
      );
    }

    return (
      <GlassPanel style={{ marginTop: 12, padding: desktop ? 15 : 13, backgroundColor: "rgba(139,92,246,0.09)" }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 11 }}>
          <View
            style={{
              width: 38,
              height: 38,
              borderRadius: 15,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(139,92,246,0.20)",
              borderWidth: 1,
              borderColor: "rgba(196,181,253,0.42)",
            }}
          >
            <Ionicons name="sparkles-outline" size={18} color="#DDD6FE" />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: "#DDD6FE", fontWeight: "900", fontSize: 11 }}>BESTCITY AI GUIDE</Text>
            <Text style={{ marginTop: 4, color: TEXT, fontWeight: "900", fontSize: desktop ? 16 : 14 }}>
              Ask how BestCity Market works.
            </Text>
            <Text style={{ marginTop: 5, color: MUTED, fontSize: 12, lineHeight: 18 }}>
              Get guided answers about buying, selling, escrow, orders, search, trust, and stock market tools.
            </Text>
          </View>
        </View>

        <Pressable
          onPress={() => setGuideVisible(true)}
          style={({ pressed }) => ({
            marginTop: 12,
            minHeight: 46,
            borderRadius: 15,
            paddingHorizontal: 12,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            backgroundColor: "rgba(139,92,246,0.16)",
            borderWidth: 1,
            borderColor: "rgba(196,181,253,0.34)",
            transform: [{ translateY: pressed ? 1 : 0 }, { scale: pressed ? 0.985 : 1 }],
          })}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 9, flex: 1, minWidth: 0 }}>
            <Ionicons name="chatbubble-ellipses-outline" size={17} color="#DDD6FE" />
            <Text numberOfLines={1} style={{ color: TEXT, fontWeight: "900", fontSize: 12 }}>
              Open AI guide
            </Text>
          </View>
          <Ionicons name="arrow-forward" size={15} color="#DDD6FE" />
        </Pressable>

        <View style={{ marginTop: 12, flexDirection: "row", gap: 9, flexWrap: "wrap" }}>
          {actions.map((action) => (
            <Pressable
              key={action.label}
              onPress={action.onPress}
              style={({ pressed }) => ({
                ...actionBaseStyle,
                backgroundColor: `${action.accent}14`,
                borderColor: `${action.accent}38`,
                transform: [{ translateY: pressed ? 1 : 0 }, { scale: pressed ? 0.985 : 1 }],
              })}
            >
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <Ionicons name={action.icon} size={17} color={action.accent} />
                <Ionicons name="arrow-forward" size={14} color={action.accent} />
              </View>
              <Text numberOfLines={1} style={{ marginTop: 10, color: TEXT, fontWeight: "900", fontSize: 12 }}>
                {action.label}
              </Text>
              <Text numberOfLines={1} style={{ marginTop: 3, color: MUTED, fontWeight: "800", fontSize: 10 }}>
                {action.detail}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={{ marginTop: 12, flexDirection: "row", alignItems: "center" }}>
          {[
            { label: "Search", icon: "search-outline" as const },
            { label: "Validate", icon: "shield-checkmark-outline" as const },
            { label: "Escrow", icon: "lock-closed-outline" as const },
            { label: "Confirm", icon: "checkmark-done-outline" as const },
          ].map((step, index, all) => (
            <React.Fragment key={step.label}>
              <View style={{ flex: 1, minWidth: 0, alignItems: "center" }}>
                <View
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: index < 2 ? "rgba(45,212,191,0.18)" : "rgba(255,253,247,0.06)",
                    borderWidth: 1,
                    borderColor: index < 2 ? "rgba(94,234,212,0.38)" : BORDER,
                  }}
                >
                  <Ionicons name={step.icon} size={13} color={index < 2 ? TEAL : MUTED} />
                </View>
                <Text numberOfLines={1} style={{ marginTop: 5, color: index < 2 ? TEXT : MUTED, fontWeight: "800", fontSize: 10 }}>
                  {step.label}
                </Text>
              </View>
              {index < all.length - 1 ? (
                <View style={{ width: 15, height: 1, backgroundColor: index === 0 ? "rgba(94,234,212,0.58)" : "rgba(255,253,247,0.13)" }} />
              ) : null}
            </React.Fragment>
          ))}
        </View>
      </GlassPanel>
    );
  }


  function renderDirectoryChooser(desktop = false) {
    const label = directoryMode === "listings" ? "DISCOVERY" : "SELLER DIRECTORY";
    const subtitle = directoryMode === "listings" ? `${feedLabel} - ${feedScope === "country" ? "Local" : "Global"}` : "Featured and verified stores";

    return (
      <GlassPanel style={{ marginTop: desktop ? 0 : 12, padding: desktop ? 16 : 14, backgroundColor: "rgba(255,253,247,0.05)" }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: MUTED, fontWeight: "900", fontSize: 11 }}>{label}</Text>
            <Text style={{ marginTop: 6, color: TEXT, fontWeight: "900", fontSize: desktop ? 20 : 18 }}>{resultTitle}</Text>
            <Text style={{ marginTop: 4, color: MUTED, fontSize: 12 }}>{subtitle}</Text>
          </View>
          <View
            style={{
              minWidth: 52,
              borderRadius: 999,
              paddingHorizontal: 12,
              paddingVertical: 8,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(45,212,191,0.18)",
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

        <View style={{ marginTop: 14, flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <SectionPill
            icon="earth-outline"
            label="Global"
            active={feedScope === "global"}
            onPress={() => setFeedScope("global")}
            stretch={false}
          />
          <SectionPill
            icon="location-outline"
            label="Local"
            active={feedScope === "country"}
            onPress={() => setFeedScope("country")}
            stretch={false}
          />
        </View>
      </GlassPanel>
    );
  }

  function renderScopeAndFilters(desktop = false) {
    if (!isListingDirectory) {
      if (!desktop) {
        return (
          <TutorialTarget id="market.home.filters">
            <CompactDisclosure
              eyebrow="Store mode"
              title="Store discovery"
              summary={directoryMode === "featured" ? "Featured stores" : "Verified stores"}
              icon="storefront-outline"
              accent={TEAL}
              expanded={expandedCards.filters}
              onToggle={() => toggleExpandedCard("filters")}
            >
              <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18 }}>
                Featured and verified directories help buyers assess a store before opening the full profile.
              </Text>
            </CompactDisclosure>
          </TutorialTarget>
        );
      }

      return (
        <TutorialTarget id="market.home.filters">
          <GlassPanel style={{ marginTop: desktop ? 0 : 12, padding: desktop ? 16 : 14, width: desktop ? "100%" : undefined, backgroundColor: "rgba(255,253,247,0.06)" }}>
            <Text style={{ color: TEXT, fontWeight: "900", fontSize: 13 }}>Store discovery</Text>
            <Text style={{ marginTop: 6, color: MUTED, fontSize: 12, lineHeight: 18 }}>
              Featured and verified directories help buyers assess a store before opening the full profile.
            </Text>
          </GlassPanel>
        </TutorialTarget>
      );
    }

    if (!desktop) {
      const categoryLabel = selectedSlug
        ? categories.find((item) => item.slug === selectedSlug)?.title || "Filtered"
        : main
        ? "All related"
        : "All listings";
      return (
        <TutorialTarget id="market.home.filters">
          <CompactDisclosure
            eyebrow="Nearby and global"
            title={`${feedScope === "country" ? "Local" : "Global"} feed`}
            summary={`${locationLabel} - ${categoryLabel} - ${sortBy.replace(/_/g, " ")}`}
            icon={feedScope === "country" ? "location-outline" : "earth-outline"}
            accent={feedScope === "country" ? TEAL : BLUE}
            expanded={expandedCards.filters}
            onToggle={() => toggleExpandedCard("filters")}
          >
            <GlassPanel style={{ padding: 16, backgroundColor: "rgba(255,253,247,0.04)", marginTop: 6 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: TEXT, fontWeight: "900", fontSize: 14 }}>Nearby and global</Text>
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
                  style={({ pressed }) => ({
                    width: 40,
                    height: 40,
                    borderRadius: 14,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: pressed ? "rgba(45,212,191,0.16)" : "rgba(255,253,247,0.10)",
                    borderWidth: 1,
                    borderColor: "rgba(255,253,247,0.14)",
                    opacity: locatingCountry ? 0.6 : 1,
                    transform: [{ scale: pressed ? 0.96 : 1 }],
                  })}
                >
                  {locatingCountry ? <ActivityIndicator size="small" color={TEXT} /> : <Ionicons name="refresh" size={16} color={TEXT} />}
                </Pressable>
              </View>

              <View style={{ marginTop: 14, flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
                <SectionPill
                  icon="location-outline"
                  label="Local"
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
                  marginTop: 12,
                  borderRadius: 18,
                  padding: 14,
                  borderWidth: 1,
                  borderColor: "rgba(255,253,247,0.12)",
                  backgroundColor: "rgba(9,13,11,0.42)",
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Ionicons name="location-outline" size={18} color={TEAL} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: TEXT, fontWeight: "900", fontSize: 12 }}>{locationLabel}</Text>
                    <Text style={{ marginTop: 2, color: MUTED, fontSize: 11, lineHeight: 16 }} numberOfLines={2}>
                      {feedScope === "country"
                        ? userCountry
                          ? "Only listings matched to your country are shown here."
                          : "Showing Global while your country is being detected."
                        : "Global feed shows listings from every country."}
                    </Text>
                  </View>
                </View>
              </View>

              {feedScope === "country" && !userCountry ? (
                <View
                  style={{
                    marginTop: 12,
                    borderRadius: 15,
                    padding: 13,
                    borderWidth: 1,
                    borderColor: BORDER,
                    backgroundColor: "rgba(255,253,247,0.05)",
                  }}
                >
                  <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18 }}>
                    Enable location to filter to your country. Until then, the feed stays visible with Global listings.
                  </Text>
                  {countryErr ? (
                    <Text style={{ marginTop: 6, color: "rgba(255,253,247,0.55)", fontSize: 12 }}>{countryErr}</Text>
                  ) : null}
                </View>
              ) : null}

              <View style={{ marginTop: 14 }}>
                <Text style={{ color: TEXT, fontWeight: "900", fontSize: 13 }}>Related categories</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }} contentContainerStyle={{ gap: 10 }}>
                  <Chip label="All" active={!selectedSlug} onPress={() => setSelectedSlug(null)} />
                  {categories.map((c) => (
                    <Chip key={c.slug} label={c.title} active={selectedSlug === c.slug} onPress={() => setSelectedSlug(c.slug)} />
                  ))}
                </ScrollView>
              </View>

              <View style={{ marginTop: 14 }}>
                <Text style={{ color: TEXT, fontWeight: "900", fontSize: 13 }}>Sort</Text>
                <View style={{ marginTop: 10, flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
                  <Chip label="Newest" active={sortBy === "newest"} onPress={() => setSortBy("newest")} />
                  <Chip label="Price Low" active={sortBy === "price_low"} onPress={() => setSortBy("price_low")} />
                  <Chip label="Price High" active={sortBy === "price_high"} onPress={() => setSortBy("price_high")} />
                </View>
              </View>
            </GlassPanel>
          </CompactDisclosure>
        </TutorialTarget>
      );
    }

    return (
      <TutorialTarget id="market.home.filters">
        <GlassPanel style={{ marginTop: desktop ? 0 : 12, padding: desktop ? 16 : 14, width: desktop ? "100%" : undefined, backgroundColor: "rgba(255,253,247,0.06)" }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: TEXT, fontWeight: "900", fontSize: 14 }}>Nearby and global</Text>
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
            label="Local"
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
            <Text style={{ marginTop: 14, color: TEXT, fontWeight: "900", fontSize: 13 }}>Related categories</Text>
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
      </TutorialTarget>
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

  function renderFeedScopePills(desktop = false) {
    return (
      <View style={{ marginTop: 10, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <SectionPill
          icon="earth-outline"
          label="Global"
          active={feedScope === "global"}
          onPress={() => setFeedScope("global")}
        />
        <SectionPill
          icon="location-outline"
          label="Local"
          active={feedScope === "country"}
          onPress={() => setFeedScope("country")}
        />
      </View>
    );
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
            alignItems: "center",
          }}
        >
          <GlassPanel
            style={{
              width: "100%",
              maxWidth: desktop ? 760 : undefined,
              backgroundColor: "rgba(9,13,11,0.96)",
              borderRadius: desktop ? 24 : 20,
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

            <View style={{ padding: desktop ? 14 : 0 }}>
              <SocialFeed />
            </View>
          </View>
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
          rightSlot={
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <NotificationBell />
              <Pressable
                onPress={() => setToolsVisible(true)}
                style={({ pressed }) => ({
                  width: 36,
                  height: 36,
                  borderRadius: 12,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: pressed ? "rgba(255,253,247,0.06)" : "rgba(255,253,247,0.03)",
                })}
              >
                <Ionicons name="ellipsis-vertical" size={18} color={TEXT} />
              </Pressable>
            </View>
          }
          bordered={false}
          style={{ backgroundColor: "transparent", paddingHorizontal: 0 }}
        />

        {renderSearchBar(false)}
        {renderFeedScopePills(false)}
        {renderSectionTabs("mobile")}
        {renderHeroPanel(false)}

        {section === "social" ? (
          renderSocialPanel(false)
        ) : (
          <>
            {renderDirectoryChooser(false)}
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
          rightSlot={
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <NotificationBell />
              <Pressable
                onPress={() => setToolsVisible(true)}
                style={({ pressed }) => ({
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: pressed ? "rgba(255,253,247,0.06)" : "rgba(255,253,247,0.03)",
                })}
              >
                <Ionicons name="ellipsis-vertical" size={18} color={TEXT} />
              </Pressable>
            </View>
          }
          bordered={false}
          style={{ backgroundColor: "transparent", paddingHorizontal: 0, paddingTop: Math.max(insets.top + 18, 24), paddingBottom: 8 }}
        />

        <View
          style={
            section === "social"
              ? { marginTop: 4, flexDirection: "row", alignItems: "flex-start", gap: desktopContentGap }
              : { marginTop: 4, position: "relative", zIndex: 2 }
          }
        >
          <View
            style={
              section === "social"
                ? { flex: 1, minWidth: 0, gap: 10 }
                : { width: resultsInnerWidth, maxWidth: "100%", gap: 10 }
            }
          >
            {renderHeroPanel(true)}
            {renderFeedScopePills(true)}
            {section === "social" ? null : renderCategoryDiscovery(true)}
            {section === "social" ? null : renderDirectoryChooser(true)}
          </View>

          <View
            style={
              section === "social"
                ? { width: desktopSidePanelWidth, gap: 12 }
                : {
                    position: "absolute",
                    top: 0,
                    right: 0,
                    width: desktopSidePanelWidth,
                    gap: 12,
                    zIndex: 3,
                  }
            }
          >
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

            <Pressable onPress={() => setToolsVisible(true)} style={{ padding: 6, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,253,247,0.03)' }}>
              <Ionicons name="layers-outline" size={20} color={TEAL} />
            </Pressable>
          </View>
        </View>

        {section === "social" ? (
          renderSocialPanel(true)
        ) : (
          <>
            {renderStatusBlock()}
          </>
        )}
      </>
    );
  }

  function MarketToolsModal() {
    const toolCards = [
      {
        label: "Open AI guide",
        body: "Ask about buying, selling, escrow, orders, and search.",
        icon: "sparkles-outline",
        onPress: () => {
          setToolsVisible(false);
          setGuideVisible(true);
        },
      },
      {
        label: "Browse categories",
        body: main ? `${main === "product" ? "Products" : "Services"} categories` : "Popular lanes",
        icon: "grid-outline",
        onPress: () => {
          setToolsVisible(false);
          router.push({ pathname: "/market/category" as any, params: main ? { mode: main } : undefined });
        },
      },
      {
        label: "Filters & scope",
        body: "Local/global and sort controls",
        icon: "filter-outline",
        onPress: () => {
          setToolsVisible(false);
          setExpandedCards((prev) => ({ ...prev, filters: true }));
        },
      },
      {
        label: "Stock Market",
        body: "Open seller stock tools",
        icon: "trending-up-outline",
        onPress: () => {
          setToolsVisible(false);
          router.push("/market/stock" as any);
        },
      },
    ];

    return (
      <Modal visible={toolsVisible} animationType="slide" transparent onRequestClose={() => setToolsVisible(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.72)", justifyContent: "flex-end" }}>
          <Pressable style={{ flex: 1 }} onPress={() => setToolsVisible(false)} />
          <View
            style={{
              maxHeight: "86%",
              paddingTop: 0,
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              backgroundColor: BG0,
              borderWidth: 1,
              borderColor: "rgba(255,253,247,0.08)",
              overflow: "hidden",
            }}
          >
            <View style={{ alignItems: "center", paddingTop: 10, paddingBottom: 8 }}>
              <View
                style={{
                  width: 56,
                  height: 5,
                  borderRadius: 999,
                  backgroundColor: "rgba(255,253,247,0.12)",
                }}
              />
            </View>

            <LinearGradient
              colors={["rgba(45,212,191,0.18)", "rgba(56,189,248,0.12)", "rgba(9,13,11,0.96)"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ paddingHorizontal: 20, paddingTop: 22, paddingBottom: 18, gap: 14 }}
            >
              <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: TEXT, fontWeight: "900", fontSize: 22 }}>Marketplace toolkit</Text>
                  <Text style={{ marginTop: 6, color: "rgba(255,253,247,0.78)", fontSize: 13, lineHeight: 19 }}>
                    High-impact controls for feed scope, discovery, and built-in AI guidance.
                  </Text>
                </View>
                <Pressable
                  onPress={() => setToolsVisible(false)}
                  style={({ pressed }) => ({
                    width: 40,
                    height: 40,
                    borderRadius: 14,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: pressed ? "rgba(255,253,247,0.12)" : "rgba(255,253,247,0.08)",
                  })}
                >
                  <Ionicons name="close" size={20} color={TEXT} />
                </Pressable>
              </View>

              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                <CardBadge label={feedScope === "country" ? "Local feed" : "Global feed"} tone={feedScope === "country" ? "teal" : "blue"} icon={feedScope === "country" ? "location-outline" : "earth-outline"} />
                <CardBadge label={directoryMode === "listings" ? "Listings" : "Stores"} tone="purple" icon="options-outline" />
              </View>
            </LinearGradient>

            <View style={{ paddingHorizontal: 20, gap: 16, paddingBottom: 18 }}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                {toolCards.map((card) => (
                  <Pressable
                    key={card.label}
                    onPress={card.onPress}
                    style={({ pressed }) => ({
                      flex: 1,
                      minWidth: 148,
                      borderRadius: 22,
                      padding: 16,
                      backgroundColor: pressed ? "rgba(45,212,191,0.16)" : "rgba(255,253,247,0.035)",
                      borderWidth: 1,
                      borderColor: "rgba(255,253,247,0.12)",
                      shadowColor: "#000",
                      shadowOpacity: pressed ? 0.18 : 0.08,
                      shadowRadius: pressed ? 20 : 12,
                      shadowOffset: { width: 0, height: 10 },
                      elevation: pressed ? 6 : 3,
                    })}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                      <View
                        style={{
                          width: 38,
                          height: 38,
                          borderRadius: 14,
                          alignItems: "center",
                          justifyContent: "center",
                          backgroundColor: "rgba(45,212,191,0.16)",
                          borderWidth: 1,
                          borderColor: "rgba(94,234,212,0.35)",
                        }}
                      >
                        <Ionicons name={card.icon as any} size={18} color={TEAL} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={{ color: TEXT, fontWeight: "900", fontSize: 14 }} numberOfLines={1}>{card.label}</Text>
                        <Text style={{ marginTop: 4, color: MUTED, fontSize: 12, lineHeight: 17 }} numberOfLines={2}>{card.body}</Text>
                      </View>
                    </View>
                  </Pressable>
                ))}
              </View>

              <GlassPanel style={{ padding: 18, borderRadius: 24, backgroundColor: "rgba(255,253,247,0.04)", borderColor: "rgba(255,253,247,0.12)" }}>
                <Text style={{ color: TEXT, fontWeight: "900", fontSize: 13 }}>Feed controls</Text>
                <Text style={{ marginTop: 6, color: MUTED, fontSize: 12, lineHeight: 18 }}>
                  Lock your marketplace view to local or global listings, and toggle between listings and store discovery.
                </Text>
                <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                  <SectionPill
                    icon="earth-outline"
                    label="Global"
                    active={feedScope === "global"}
                    onPress={() => setFeedScope("global")}
                  />
                  <SectionPill
                    icon="location-outline"
                    label="Local"
                    active={feedScope === "country"}
                    onPress={() => setFeedScope("country")}
                  />
                </View>
                <View style={{ marginTop: 10, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                  <SectionPill
                    icon="grid-outline"
                    label="Listings"
                    active={directoryMode === "listings"}
                    onPress={() => setDirectoryMode("listings")}
                    stretch={false}
                  />
                  <SectionPill
                    icon="storefront-outline"
                    label="Stores"
                    active={directoryMode !== "listings"}
                    onPress={() => setDirectoryMode("featured")}
                    stretch={false}
                  />
                </View>
              </GlassPanel>

              {section !== "social" ? (
                <View style={{ padding: 16, borderRadius: 22, borderWidth: 1, borderColor: "rgba(255,253,247,0.12)", backgroundColor: "rgba(255,253,247,0.03)" }}>
                  <Text style={{ color: MUTED, fontWeight: "900", fontSize: 11 }}>FEATURED PREVIEW</Text>
                  {heroFeaturedItems.length ? (
                    <View style={{ marginTop: 12 }}>{renderHeroPreviewRail(true)}</View>
                  ) : (
                    <Text style={{ marginTop: 10, color: MUTED, fontSize: 12 }}>Featured listings and storefronts appear here once active.</Text>
                  )}
                </View>
              ) : null}
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <LinearGradient colors={[BG2, BG1, BG0]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={{ flex: 1 }}>
      <InAppTutorial
        autoStart={false}
        enabled={!loading}
        flow={tutorialFlows.marketHome}
        startSignal={tutorialStartSignal}
      />
      <BestCityMarketGuideSheet
        bottomInset={insets.bottom}
        context={marketGuideContext}
        isDesktop={isDesktop}
        onClose={() => setGuideVisible(false)}
        onOpenSearch={openMarketSearchFromGuide}
        onOpenStock={openStockMarketFromGuide}
        onStartTour={startMarketTour}
        visible={guideVisible}
      />
      <MarketToolsModal />
      <FlatList
        data={section === "social" ? [] : (directoryMode === "listings" ? rows : (directoryRows as any))}
        key={section === "social" ? "social" : `${directoryMode}-${listingColumns}`}
        keyExtractor={(it: any, idx) => String((it as any)?.id || (it as any)?.user_id || idx)}
        numColumns={listingColumns}
        columnWrapperStyle={
          listingColumns > 1
            ? {
                paddingHorizontal: pagePadding,
                justifyContent: isDesktop ? "flex-start" : "space-between",
                alignSelf: "center",
                width: "100%",
                maxWidth: contentMaxWidth,
                gap: isDesktop ? gridGap : undefined,
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
            <View
              style={{
                marginTop: 14,
                marginHorizontal: isDesktop ? 0 : 16,
                alignSelf: "center",
                width: isDesktop ? "100%" : undefined,
                maxWidth: contentMaxWidth,
                borderRadius: 20,
                padding: 14,
                backgroundColor: CARD,
                borderWidth: 1,
                borderColor: BORDER,
              }}
            >
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
