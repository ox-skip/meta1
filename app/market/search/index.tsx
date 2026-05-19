import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import ListingOriginBadge from "@/components/market/ListingOriginBadge";
import MarketMediaView from "@/components/market/MarketMediaView";
import { supabase } from "@/services/supabase";
import { listingMatchesCountry, resolveUserCountry } from "@/utils/country";
import { formatCountryLabel } from "@/utils/countryNames";
import { resolveMarketMediaSource, sortMarketMedia } from "@/utils/marketMedia";
import { formatCurrency, getListingPriceDisplay } from "@/utils/pricing";

const BG0 = "#060807";
const BG1 = "#10130E";
const BG2 = "#171A13";
const TEXT = "#FFFDF7";
const TEAL = "#2DD4BF";
const AMBER = "#F4B75D";
const BLUE = "#38BDF8";
const PURPLE = "#8B5CF6";
const CARD = "rgba(255,253,247,0.065)";
const CARD_STRONG = "rgba(255,253,247,0.10)";
const BORDER = "rgba(255,253,247,0.12)";
const BORDER_BRIGHT = "rgba(255,253,247,0.22)";
const MUTED = "rgba(255,253,247,0.68)";
const FAINT = "rgba(255,253,247,0.46)";
const INK = "#07110F";

const LISTINGS_TABLE = "market_listings";
const LISTING_IMAGES_BUCKET = "market-listings";
const LISTING_SELECT =
  "id,seller_id,title,description,price_amount,currency,delivery_type,category,sub_category,created_at,payment_options,availability,stock_qty,cover:market_listing_images!market_listings_cover_image_fk(public_url,storage_path,sort_order,meta),images:market_listing_images!market_listing_images_listing_id_fkey(id,public_url,storage_path,sort_order,meta)";

type SearchMode = "all" | "product" | "service" | "store";

type SellerRow = {
  user_id: string;
  market_username: string | null;
  display_name: string | null;
  business_name: string | null;
  bio: string | null;
  logo_path: string | null;
  is_verified: boolean | null;
  active?: boolean | null;
};

type Listing = {
  id: string;
  seller_id: string;
  title: string | null;
  description: string | null;
  price_amount: number | string | null;
  currency: string | null;
  payment_options?: any;
  delivery_type: string | null;
  category: string | null;
  sub_category: string | null;
  created_at?: string | null;
  availability?: any;
  stock_qty?: number | null;
  cover?: {
    public_url?: string | null;
    storage_path?: string | null;
    sort_order?: number | null;
    meta?: any;
    mime_type?: string | null;
  } | null;
  images?: Array<{
    id?: string;
    public_url?: string | null;
    storage_path?: string | null;
    sort_order?: number | null;
    meta?: any;
    mime_type?: string | null;
  }> | null;
};

const MODE_META: Record<SearchMode, { label: string; icon: keyof typeof Ionicons.glyphMap; tone: string }> = {
  all: { label: "All", icon: "grid-outline", tone: TEAL },
  product: { label: "Products", icon: "cube-outline", tone: BLUE },
  service: { label: "Services", icon: "briefcase-outline", tone: AMBER },
  store: { label: "Stores", icon: "storefront-outline", tone: PURPLE },
};

const SEARCH_SUGGESTIONS: Array<{ label: string; icon: keyof typeof Ionicons.glyphMap; mode: SearchMode }> = [
  { label: "Phones", icon: "phone-portrait-outline", mode: "product" },
  { label: "Fashion", icon: "shirt-outline", mode: "product" },
  { label: "Design", icon: "color-palette-outline", mode: "service" },
  { label: "Delivery", icon: "bicycle-outline", mode: "service" },
  { label: "@stores", icon: "at-outline", mode: "store" },
];

function FilterChip({
  label,
  icon,
  active,
  tone = TEAL,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  active: boolean;
  tone?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 13,
        paddingVertical: 9,
        borderRadius: 999,
        backgroundColor: active ? `${tone}24` : "rgba(255,253,247,0.06)",
        borderWidth: 1,
        borderColor: active ? `${tone}70` : BORDER,
        flexDirection: "row",
        alignItems: "center",
        gap: 7,
      }}
    >
      <Ionicons name={icon} size={14} color={active ? tone : MUTED} />
      <Text style={{ color: active ? TEXT : MUTED, fontWeight: "900", fontSize: 12 }}>{label}</Text>
    </Pressable>
  );
}

function MiniPill({
  label,
  icon,
  tone = TEAL,
  onPress,
}: {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  tone?: string;
  onPress?: () => void;
}) {
  const content = (
    <>
      {icon ? <Ionicons name={icon} size={13} color={tone} /> : null}
      <Text numberOfLines={1} style={{ color: TEXT, fontSize: 11, fontWeight: "900" }}>
        {label}
      </Text>
    </>
  );

  const style = {
    minHeight: 32,
    paddingHorizontal: 11,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: `${tone}44`,
    backgroundColor: `${tone}14`,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
  };

  if (onPress) {
    return (
      <Pressable onPress={onPress} style={style}>
        {content}
      </Pressable>
    );
  }

  return <View style={style}>{content}</View>;
}

function VerifiedTick({ verified }: { verified?: boolean | null }) {
  if (!verified) return null;
  return <Ionicons name="checkmark-circle" size={16} color={BLUE} />;
}

function sanitizeSearchTerm(value: string) {
  return String(value || "")
    .replace(/[%'"(),;]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function publicSellerLogo(path?: string | null) {
  if (!path) return null;
  return supabase.storage.from("market-sellers").getPublicUrl(path).data.publicUrl;
}

function sellerSearchScore(seller: SellerRow, term: string) {
  const t = term.toLowerCase();
  const handle = String(seller.market_username || "").toLowerCase();
  const business = String(seller.business_name || "").toLowerCase();
  const display = String(seller.display_name || "").toLowerCase();
  const bio = String(seller.bio || "").toLowerCase();

  if (handle === t) return 90;
  if (handle.startsWith(t)) return 70;
  if (business === t || display === t) return 60;
  if (business.startsWith(t) || display.startsWith(t)) return 45;
  if (handle.includes(t)) return 34;
  if (business.includes(t) || display.includes(t)) return 25;
  if (bio.includes(t)) return 10;
  return 1;
}

function listingSearchScore(listing: Listing, term: string) {
  const t = term.toLowerCase();
  const title = String(listing.title || "").toLowerCase();
  const sub = String(listing.sub_category || "").toLowerCase();
  const description = String(listing.description || "").toLowerCase();
  const category = String(listing.category || "").toLowerCase();
  let score = 0;

  if (title === t) score += 90;
  else if (title.startsWith(t)) score += 65;
  else if (title.includes(t)) score += 42;

  if (sub === t) score += 38;
  else if (sub.includes(t)) score += 24;

  if (category === t) score += 16;
  if (description.includes(t)) score += 10;

  const created = new Date(String(listing.created_at || "")).getTime();
  if (Number.isFinite(created)) {
    const ageDays = Math.max(0, (Date.now() - created) / 86_400_000);
    score += Math.max(0, 12 - Math.min(12, ageDays / 6));
  }

  return score;
}

function searchModeLabel(mode: SearchMode) {
  if (mode === "product") return "products";
  if (mode === "service") return "services";
  if (mode === "store") return "stores";
  return "matches";
}

export default function MarketSearchScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ q?: string }>();
  const requestIdRef = useRef(0);

  const initialQ = useMemo(() => String(params?.q ?? "").trim(), [params?.q]);
  const [q, setQ] = useState(initialQ);
  const [mode, setMode] = useState<SearchMode>("all");
  const [loading, setLoading] = useState(false);
  const [listings, setListings] = useState<Listing[]>([]);
  const [stores, setStores] = useState<SellerRow[]>([]);
  const [sellerMap, setSellerMap] = useState<Record<string, SellerRow>>({});
  const [scopeLabel, setScopeLabel] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [recentTerms, setRecentTerms] = useState<string[]>([]);

  const isDesktop = width >= 900;
  const pagePadding = isDesktop ? 26 : 14;
  const listingColumns = width >= 1120 ? 3 : width >= 720 ? 2 : 1;
  const listingCardWidth = listingColumns === 1 ? ("100%" as const) : listingColumns === 2 ? ("48.5%" as const) : ("31.8%" as const);
  const storeCardWidth = isDesktop ? ("48.5%" as const) : ("100%" as const);

  const supabaseUrl = (supabase as any)?.supabaseUrl ?? (process.env.EXPO_PUBLIC_SUPABASE_URL as string) ?? "";

  async function runSearch(term: string, nextMode: SearchMode = mode) {
    const requestId = ++requestIdRef.current;
    const rawTerm = String(term || "").trim();
    const safeTerm = sanitizeSearchTerm(rawTerm);
    const sellerTerm = sanitizeSearchTerm(rawTerm.replace(/^@+/, ""));

    setLoading(true);
    setErr(null);

    if (!safeTerm) {
      if (requestId !== requestIdRef.current) return;
      setListings([]);
      setStores([]);
      setSellerMap({});
      setScopeLabel(null);
      setLoading(false);
      return;
    }

    try {
      const userCountry = await resolveUserCountry({ ipOnly: true }).catch(() => null);
      if (requestId !== requestIdRef.current) return;

      const shouldShowStoreCards = nextMode === "all" || nextMode === "store";
      const shouldSearchStores = !!sellerTerm;
      const shouldSearchListings = nextMode !== "store";

      let storeMatches: SellerRow[] = [];

      if (shouldSearchStores && sellerTerm) {
        const { data, error } = await supabase
          .from("market_seller_public_profiles")
          .select("user_id,market_username,display_name,business_name,bio,logo_path,is_verified,active")
          .eq("active", true)
          .or(
            [
              `market_username.ilike.%${sellerTerm}%`,
              `display_name.ilike.%${safeTerm}%`,
              `business_name.ilike.%${safeTerm}%`,
              `bio.ilike.%${safeTerm}%`,
            ].join(","),
          )
          .limit(30);

        if (error) throw error;

        storeMatches = ((data ?? []) as SellerRow[]).sort(
          (a, b) => sellerSearchScore(b, sellerTerm) - sellerSearchScore(a, sellerTerm),
        );
      }

      const matchedSellerIds = Array.from(new Set(storeMatches.map((seller) => String(seller.user_id || "")).filter(Boolean)));
      const listingBatches: Listing[][] = [];

      if (shouldSearchListings && !rawTerm.startsWith("@")) {
        let listingTextQuery = supabase
          .from(LISTINGS_TABLE)
          .select(LISTING_SELECT)
          .eq("is_active", true)
          .order("created_at", { ascending: false })
          .limit(90);

        if (nextMode === "product" || nextMode === "service") {
          listingTextQuery = listingTextQuery.eq("category", nextMode);
        }

        const { data, error } = await listingTextQuery.or(
          [`title.ilike.%${safeTerm}%`, `description.ilike.%${safeTerm}%`, `sub_category.ilike.%${safeTerm}%`].join(","),
        );

        if (error) throw error;
        listingBatches.push((data ?? []) as Listing[]);
      }

      if (shouldSearchListings && matchedSellerIds.length) {
        let sellerListingsQuery = supabase
          .from(LISTINGS_TABLE)
          .select(LISTING_SELECT)
          .eq("is_active", true)
          .in("seller_id", matchedSellerIds)
          .order("created_at", { ascending: false })
          .limit(90);

        if (nextMode === "product" || nextMode === "service") {
          sellerListingsQuery = sellerListingsQuery.eq("category", nextMode);
        }

        const { data, error } = await sellerListingsQuery;
        if (error) throw error;
        listingBatches.push((data ?? []) as Listing[]);
      }

      const combinedListings = listingBatches.flat();
      const localListings = userCountry
        ? combinedListings.filter((item) =>
            listingMatchesCountry(item.availability ?? item.payment_options?.availability, userCountry, false),
          )
        : combinedListings;
      const globalFallbackListings = userCountry
        ? combinedListings.filter((item) =>
            listingMatchesCountry(item.availability ?? item.payment_options?.availability, userCountry, true),
          )
        : combinedListings;
      const scopedListings = localListings.length ? localListings : globalFallbackListings;

      if (shouldSearchListings && userCountry) {
        const countryLabel = formatCountryLabel(userCountry.name, userCountry.code) || "your location";
        setScopeLabel(
          localListings.length
            ? `Prioritising listings available in ${countryLabel}.`
            : `No local-only match yet, showing global listings available to ${countryLabel}.`,
        );
      } else {
        setScopeLabel("Search ranks exact titles, store handles, categories, and fresh listings first.");
      }

      const listingMap = new Map<string, Listing>();
      scopedListings.forEach((item) => {
        if (!item?.id || listingMap.has(item.id)) return;
        listingMap.set(item.id, item);
      });

      const nextListings = Array.from(listingMap.values()).sort((a, b) => {
        const scoreDiff = listingSearchScore(b, safeTerm) - listingSearchScore(a, safeTerm);
        if (scoreDiff) return scoreDiff;

        const aTime = new Date(String(a.created_at || "")).getTime();
        const bTime = new Date(String(b.created_at || "")).getTime();
        return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
      });

      const nextSellerMap: Record<string, SellerRow> = {};
      storeMatches.forEach((seller) => {
        nextSellerMap[String(seller.user_id)] = seller;
      });

      const listingSellerIds = Array.from(new Set(nextListings.map((item) => String(item.seller_id || "")).filter(Boolean)));
      const missingSellerIds = listingSellerIds.filter((id) => !nextSellerMap[id]);

      if (missingSellerIds.length) {
        const { data, error } = await supabase
          .from("market_seller_public_profiles")
          .select("user_id,market_username,display_name,business_name,bio,logo_path,is_verified,active")
          .in("user_id", missingSellerIds);

        if (error) throw error;

        ((data ?? []) as SellerRow[]).forEach((seller) => {
          nextSellerMap[String(seller.user_id)] = seller;
        });
      }

      if (requestId !== requestIdRef.current) return;

      setStores(shouldShowStoreCards ? storeMatches : []);
      setListings(nextListings);
      setSellerMap(nextSellerMap);
      setRecentTerms((current) => [safeTerm, ...current.filter((item) => item.toLowerCase() !== safeTerm.toLowerCase())].slice(0, 6));
    } catch (e: any) {
      if (requestId !== requestIdRef.current) return;
      setErr(e?.message || "Search failed");
      setStores([]);
      setListings([]);
      setSellerMap({});
      setScopeLabel(null);
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    setQ(initialQ);
    void runSearch(initialQ, mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQ]);

  function onSubmit(nextMode: SearchMode = mode) {
    const term = q.trim();
    router.setParams({ q: term } as any);
    void runSearch(term, nextMode);
  }

  function onSelectMode(nextMode: SearchMode) {
    setMode(nextMode);
    void runSearch(q.trim(), nextMode);
  }

  function applySuggestion(label: string, nextMode: SearchMode) {
    setMode(nextMode);
    setQ(label);
    router.setParams({ q: label } as any);
    void runSearch(label, nextMode);
  }

  function clearSearch() {
    requestIdRef.current += 1;
    setQ("");
    setListings([]);
    setStores([]);
    setSellerMap({});
    setErr(null);
    setScopeLabel(null);
    setLoading(false);
    router.setParams({ q: "" } as any);
  }

  const resultCount = stores.length + listings.length;
  const hasResults = stores.length > 0 || listings.length > 0;
  const activeMeta = MODE_META[mode];
  const hasQuery = q.trim().length > 0;
  const showDiscovery = !loading && !hasResults && !err;

  return (
    <LinearGradient
      colors={[BG2, BG1, BG0]}
      start={{ x: 0.05, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={{
        flex: 1,
        paddingTop: Math.max(insets.top, 14),
        paddingHorizontal: pagePadding,
      }}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingBottom: Math.max(insets.bottom, 18) + 26,
          alignItems: "center",
        }}
      >
        <View style={{ width: "100%", maxWidth: 1120 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 }}>
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => ({
                width: 44,
                height: 44,
                borderRadius: 16,
                backgroundColor: pressed ? "rgba(45,212,191,0.18)" : CARD,
                borderWidth: 1,
                borderColor: BORDER,
                alignItems: "center",
                justifyContent: "center",
              })}
            >
              <Ionicons name="arrow-back" size={20} color={TEXT} />
            </Pressable>

            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 9,
                    backgroundColor: `${TEAL}18`,
                    borderWidth: 1,
                    borderColor: `${TEAL}55`,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name="search-outline" size={14} color={TEAL} />
                </View>
                <Text style={{ color: TEAL, fontSize: 11, fontWeight: "900", textTransform: "uppercase" }}>
                  Market search
                </Text>
              </View>
              <Text numberOfLines={1} style={{ marginTop: 3, color: TEXT, fontSize: isDesktop ? 25 : 22, fontWeight: "900" }}>
                Find anything in BestCity Market
              </Text>
            </View>
          </View>

          <LinearGradient
            colors={["rgba(45,212,191,0.16)", "rgba(244,183,93,0.09)", CARD]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              borderRadius: 26,
              borderWidth: 1,
              borderColor: BORDER_BRIGHT,
              padding: isDesktop ? 18 : 14,
              shadowColor: TEAL,
              shadowOpacity: 0.16,
              shadowRadius: 22,
              shadowOffset: { width: 0, height: 14 },
            }}
          >
            <View
              style={{
                flexDirection: isDesktop ? "row" : "column",
                alignItems: isDesktop ? "center" : "stretch",
                gap: 12,
              }}
            >
              <View
                style={{
                  flex: 1,
                  minHeight: 58,
                  flexDirection: "row",
                  gap: 10,
                  borderRadius: 20,
                  paddingHorizontal: 14,
                  borderWidth: 1,
                  borderColor: BORDER_BRIGHT,
                  backgroundColor: "rgba(6,8,7,0.55)",
                  alignItems: "center",
                }}
              >
                <Ionicons name="search-outline" size={20} color={TEAL} />
                <TextInput
                  value={q}
                  onChangeText={setQ}
                  placeholder="Search products, services, @username, or store"
                  placeholderTextColor={FAINT}
                  style={{ flex: 1, minHeight: 54, color: TEXT, fontWeight: "800", fontSize: 15 }}
                  returnKeyType="search"
                  autoCapitalize="none"
                  autoCorrect={false}
                  onSubmitEditing={() => onSubmit()}
                />
                {q.trim() ? (
                  <Pressable onPress={clearSearch} style={{ padding: 7 }}>
                    <Ionicons name="close" size={18} color={MUTED} />
                  </Pressable>
                ) : null}
              </View>

              <Pressable
                onPress={() => onSubmit()}
                style={({ pressed }) => ({
                  minHeight: 56,
                  paddingHorizontal: 18,
                  borderRadius: 20,
                  backgroundColor: pressed ? "rgba(94,234,212,0.82)" : TEAL,
                  borderWidth: 1,
                  borderColor: "rgba(255,253,247,0.22)",
                  alignItems: "center",
                  justifyContent: "center",
                  flexDirection: "row",
                  gap: 8,
                })}
              >
                {loading ? <ActivityIndicator color={INK} /> : <Ionicons name="arrow-forward" size={17} color={INK} />}
                <Text style={{ color: INK, fontWeight: "900" }}>{loading ? "Searching" : "Search"}</Text>
              </Pressable>
            </View>

            <View style={{ marginTop: 13, flexDirection: "row", gap: 9, flexWrap: "wrap" }}>
              {(Object.keys(MODE_META) as SearchMode[]).map((key) => {
                const item = MODE_META[key];
                return (
                  <FilterChip
                    key={key}
                    label={item.label}
                    icon={item.icon}
                    tone={item.tone}
                    active={mode === key}
                    onPress={() => onSelectMode(key)}
                  />
                );
              })}
            </View>

            <View style={{ marginTop: 13, flexDirection: "row", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <Text style={{ color: FAINT, fontWeight: "900", fontSize: 11, textTransform: "uppercase" }}>Try</Text>
              {SEARCH_SUGGESTIONS.map((item) => (
                <MiniPill
                  key={item.label}
                  label={item.label}
                  icon={item.icon}
                  tone={MODE_META[item.mode].tone}
                  onPress={() => applySuggestion(item.label, item.mode)}
                />
              ))}
            </View>

            {recentTerms.length ? (
              <View style={{ marginTop: 10, flexDirection: "row", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <Text style={{ color: FAINT, fontWeight: "900", fontSize: 11, textTransform: "uppercase" }}>Recent</Text>
                {recentTerms.map((item) => (
                  <MiniPill key={item} label={item} icon="time-outline" tone={AMBER} onPress={() => applySuggestion(item, mode)} />
                ))}
              </View>
            ) : null}
          </LinearGradient>

          <View
            style={{
              marginTop: 14,
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 10,
            }}
          >
            <View
              style={{
                flexGrow: 1,
                flexBasis: isDesktop ? "32%" : "100%",
                borderRadius: 18,
                padding: 13,
                backgroundColor: CARD,
                borderWidth: 1,
                borderColor: BORDER,
              }}
            >
              <Text style={{ color: FAINT, fontSize: 10, fontWeight: "900", textTransform: "uppercase" }}>Results</Text>
              <Text style={{ marginTop: 5, color: TEXT, fontSize: 22, fontWeight: "900" }}>{resultCount}</Text>
              <Text style={{ marginTop: 2, color: MUTED, fontSize: 12 }}>{searchModeLabel(mode)} in view</Text>
            </View>

            <View
              style={{
                flexGrow: 1,
                flexBasis: isDesktop ? "32%" : "100%",
                borderRadius: 18,
                padding: 13,
                backgroundColor: CARD,
                borderWidth: 1,
                borderColor: BORDER,
              }}
            >
              <Text style={{ color: FAINT, fontSize: 10, fontWeight: "900", textTransform: "uppercase" }}>Mode</Text>
              <View style={{ marginTop: 7, flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name={activeMeta.icon} size={18} color={activeMeta.tone} />
                <Text style={{ color: TEXT, fontSize: 18, fontWeight: "900" }}>{activeMeta.label}</Text>
              </View>
            </View>

            <View
              style={{
                flexGrow: 1,
                flexBasis: isDesktop ? "32%" : "100%",
                borderRadius: 18,
                padding: 13,
                backgroundColor: CARD,
                borderWidth: 1,
                borderColor: BORDER,
              }}
            >
              <Text style={{ color: FAINT, fontSize: 10, fontWeight: "900", textTransform: "uppercase" }}>Ranking</Text>
              <Text numberOfLines={2} style={{ marginTop: 7, color: MUTED, fontSize: 12, fontWeight: "700", lineHeight: 17 }}>
                {scopeLabel || "Search exact names, store handles, categories, and fresh listings first."}
              </Text>
            </View>
          </View>

          {loading ? (
            <View
              style={{
                marginTop: 18,
                borderRadius: 24,
                padding: 22,
                backgroundColor: CARD,
                borderWidth: 1,
                borderColor: BORDER,
                alignItems: "center",
              }}
            >
              <ActivityIndicator color={TEAL} />
              <Text style={{ marginTop: 10, color: TEXT, fontWeight: "900" }}>Searching BestCity Market</Text>
              <Text style={{ marginTop: 5, color: MUTED, textAlign: "center" }}>
                Checking listings, store names, handles, and available markets.
              </Text>
            </View>
          ) : err ? (
            <View
              style={{
                marginTop: 18,
                borderRadius: 24,
                padding: 18,
                backgroundColor: "rgba(239,68,68,0.10)",
                borderWidth: 1,
                borderColor: "rgba(239,68,68,0.32)",
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Ionicons name="alert-circle-outline" size={22} color="#F87171" />
                <Text style={{ color: TEXT, fontWeight: "900", fontSize: 16 }}>Search failed</Text>
              </View>
              <Text style={{ marginTop: 8, color: MUTED }}>{err}</Text>
            </View>
          ) : showDiscovery ? (
            <View
              style={{
                marginTop: 18,
                borderRadius: 26,
                padding: isDesktop ? 22 : 17,
                backgroundColor: CARD,
                borderWidth: 1,
                borderColor: BORDER,
                overflow: "hidden",
              }}
            >
              <View
                style={{
                  position: "absolute",
                  right: -28,
                  top: -28,
                  width: 110,
                  height: 110,
                  borderRadius: 55,
                  backgroundColor: "rgba(45,212,191,0.12)",
                }}
              />
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <View
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 18,
                    backgroundColor: `${TEAL}16`,
                    borderWidth: 1,
                    borderColor: `${TEAL}55`,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name="compass-outline" size={24} color={TEAL} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: TEXT, fontWeight: "900", fontSize: 18 }}>
                    {hasQuery ? "No strong matches yet" : "Start with a sharp search"}
                  </Text>
                  <Text style={{ marginTop: 5, color: MUTED, lineHeight: 18 }}>
                    {hasQuery
                      ? "Try another keyword, switch search mode, or search a direct @username."
                      : "Try a product, service, category, store name, or a direct @username."}
                  </Text>
                </View>
              </View>

              <View style={{ marginTop: 14, flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                {SEARCH_SUGGESTIONS.map((item) => (
                  <MiniPill
                    key={`empty-${item.label}`}
                    label={item.label}
                    icon={item.icon}
                    tone={MODE_META[item.mode].tone}
                    onPress={() => applySuggestion(item.label, item.mode)}
                  />
                ))}
              </View>

              <Pressable
                onPress={() => router.push("/market/category" as any)}
                style={({ pressed }) => ({
                  marginTop: 14,
                  borderRadius: 18,
                  paddingVertical: 13,
                  paddingHorizontal: 14,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: pressed ? "rgba(45,212,191,0.20)" : "rgba(45,212,191,0.12)",
                  borderWidth: 1,
                  borderColor: `${TEAL}55`,
                  flexDirection: "row",
                  gap: 8,
                })}
              >
                <Ionicons name="albums-outline" size={17} color={TEAL} />
                <Text style={{ color: TEXT, fontWeight: "900" }}>Browse categories</Text>
              </Pressable>
            </View>
          ) : (
            <>
              {stores.length ? (
                <View style={{ marginTop: 20 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <View>
                      <Text style={{ color: TEXT, fontWeight: "900", fontSize: 18 }}>Stores</Text>
                      <Text style={{ marginTop: 3, color: MUTED, fontSize: 12 }}>Matching accounts and storefronts</Text>
                    </View>
                    <MiniPill label={String(stores.length)} icon="storefront-outline" tone={PURPLE} />
                  </View>

                  <View style={{ marginTop: 11, flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                    {stores.map((seller) => {
                      const logo = publicSellerLogo(seller.logo_path);
                      const sellerName = seller.business_name || seller.display_name || `@${seller.market_username || "store"}`;
                      return (
                        <Pressable
                          key={seller.user_id}
                          disabled={!seller.market_username}
                          onPress={() => seller.market_username && router.push(`/market/profile/${seller.market_username}` as any)}
                          style={({ pressed }) => ({
                            width: storeCardWidth,
                            borderRadius: 22,
                            padding: 14,
                            backgroundColor: pressed ? CARD_STRONG : CARD,
                            borderWidth: 1,
                            borderColor: seller.is_verified ? `${BLUE}55` : BORDER,
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 12,
                          })}
                        >
                          <View
                            style={{
                              width: 56,
                              height: 56,
                              borderRadius: 20,
                              overflow: "hidden",
                              backgroundColor: `${PURPLE}15`,
                              borderWidth: 1,
                              borderColor: `${PURPLE}35`,
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            {logo ? (
                              <Image source={{ uri: logo }} style={{ width: 56, height: 56 }} />
                            ) : (
                              <Ionicons name="storefront-outline" size={22} color={PURPLE} />
                            )}
                          </View>

                          <View style={{ flex: 1, minWidth: 0 }}>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                              <Text numberOfLines={1} style={{ color: TEXT, fontWeight: "900", fontSize: 15, flex: 1 }}>
                                {sellerName}
                              </Text>
                              <VerifiedTick verified={seller.is_verified} />
                            </View>
                            <Text numberOfLines={1} style={{ marginTop: 4, color: PURPLE, fontSize: 12, fontWeight: "900" }}>
                              @{seller.market_username || "store"}
                            </Text>
                            <Text numberOfLines={2} style={{ marginTop: 6, color: MUTED, fontSize: 12, lineHeight: 16 }}>
                              {seller.bio || "Open storefront"}
                            </Text>
                          </View>

                          <Ionicons name="chevron-forward" size={18} color={MUTED} />
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ) : null}

              {listings.length ? (
                <View style={{ marginTop: 22 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <View>
                      <Text style={{ color: TEXT, fontWeight: "900", fontSize: 18 }}>Listings</Text>
                      <Text style={{ marginTop: 3, color: MUTED, fontSize: 12 }}>Ranked by relevance and availability</Text>
                    </View>
                    <MiniPill label={String(listings.length)} icon="pulse-outline" tone={TEAL} />
                  </View>

                  <View style={{ marginTop: 11, flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                    {listings.map((listing) => {
                      const mediaSource = resolveMarketMediaSource(
                        [listing.cover ?? null, ...sortMarketMedia(listing.images ?? [])],
                        supabaseUrl,
                        LISTING_IMAGES_BUCKET,
                      );
                      const coverUrl = mediaSource?.url ?? null;
                      const coverKind = mediaSource?.kind ?? "image";
                      const seller = sellerMap[listing.seller_id];
                      const sellerLabel =
                        seller?.market_username ? `@${seller.market_username}` : seller?.business_name || seller?.display_name || "Store";
                      const dp = getListingPriceDisplay(listing as any);
                      const isService = listing.category === "service";
                      const tone = isService ? AMBER : BLUE;

                      return (
                        <Pressable
                          key={listing.id}
                          onPress={() => router.push(`/market/listing/${listing.id}` as any)}
                          style={({ pressed }) => ({
                            width: listingCardWidth,
                            borderRadius: 24,
                            overflow: "hidden",
                            backgroundColor: pressed ? CARD_STRONG : CARD,
                            borderWidth: 1,
                            borderColor: BORDER,
                          })}
                        >
                          <View style={{ height: listingColumns === 1 ? 190 : 148, backgroundColor: "rgba(6,8,7,0.55)" }}>
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
                              <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                                <Ionicons name="image-outline" size={28} color={FAINT} />
                                <Text style={{ marginTop: 6, color: FAINT, fontSize: 11, fontWeight: "800" }}>
                                  Preview unavailable
                                </Text>
                              </View>
                            )}

                            <View
                              style={{
                                position: "absolute",
                                top: 10,
                                left: 10,
                                borderRadius: 999,
                                paddingHorizontal: 10,
                                paddingVertical: 6,
                                backgroundColor: "rgba(6,8,7,0.72)",
                                borderWidth: 1,
                                borderColor: `${tone}55`,
                                flexDirection: "row",
                                alignItems: "center",
                                gap: 6,
                              }}
                            >
                              <Ionicons name={isService ? "briefcase-outline" : "cube-outline"} size={12} color={tone} />
                              <Text style={{ color: TEXT, fontSize: 10, fontWeight: "900" }}>
                                {isService ? "Service" : "Product"}
                              </Text>
                            </View>
                          </View>

                          <View style={{ padding: 13 }}>
                            <Text numberOfLines={2} style={{ color: TEXT, fontWeight: "900", fontSize: 15, minHeight: 39, lineHeight: 19 }}>
                              {listing.title ?? "Untitled listing"}
                            </Text>

                            <View style={{ marginTop: 7, flexDirection: "row", alignItems: "center", gap: 7 }}>
                              <Ionicons name="storefront-outline" size={13} color={MUTED} />
                              <Text numberOfLines={1} style={{ flex: 1, color: MUTED, fontSize: 12, fontWeight: "800" }}>
                                {sellerLabel}
                              </Text>
                              <VerifiedTick verified={seller?.is_verified} />
                            </View>

                            <Text numberOfLines={1} style={{ marginTop: 6, color: FAINT, fontSize: 11, fontWeight: "800" }}>
                              {listing.sub_category || listing.delivery_type || "Marketplace listing"}
                            </Text>

                            <View style={{ marginTop: 9 }}>
                              <ListingOriginBadge availability={listing.availability} paymentOptions={listing.payment_options} compact />
                            </View>

                            <View
                              style={{
                                marginTop: 12,
                                paddingTop: 11,
                                borderTopWidth: 1,
                                borderTopColor: BORDER,
                                flexDirection: "row",
                                alignItems: "flex-end",
                                justifyContent: "space-between",
                                gap: 10,
                              }}
                            >
                              <View style={{ flex: 1, minWidth: 0 }}>
                                <Text numberOfLines={1} style={{ color: TEXT, fontWeight: "900", fontSize: 16 }}>
                                  {formatCurrency(dp.localCurrency, dp.localNow)}
                                </Text>
                                <Text style={{ marginTop: 3, color: FAINT, fontSize: 11, fontWeight: "800" }}>
                                  USD {formatCurrency("USD", dp.usdNow)}
                                </Text>
                              </View>
                              <View
                                style={{
                                  width: 36,
                                  height: 36,
                                  borderRadius: 14,
                                  backgroundColor: `${TEAL}16`,
                                  borderWidth: 1,
                                  borderColor: `${TEAL}45`,
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                              >
                                <Ionicons name="arrow-forward" size={16} color={TEAL} />
                              </View>
                            </View>
                          </View>
                        </Pressable>
                      );
                    })}
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
