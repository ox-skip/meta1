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
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import MarketMediaView from "@/components/market/MarketMediaView";
import { supabase } from "@/services/supabase";
import { listingMatchesCountry, resolveUserCountry } from "@/utils/country";
import { formatCountryLabel } from "@/utils/countryNames";
import { resolveMarketMediaSource, sortMarketMedia } from "@/utils/marketMedia";
import { formatCurrency, getListingPriceDisplay } from "@/utils/pricing";

const BG0 = "#05040B";
const BG1 = "#0A0620";
const PURPLE = "#7C3AED";
const CARD = "rgba(255,255,255,0.06)";
const BORDER = "rgba(255,255,255,0.10)";
const MUTED = "rgba(255,255,255,0.62)";

const LISTINGS_TABLE = "market_listings";
const LISTING_IMAGES_BUCKET = "market-listings";
const LISTING_SELECT =
  "id,seller_id,title,description,price_amount,currency,delivery_type,category,sub_category,created_at,payment_options,availability,stock_qty,cover:market_listing_images!market_listings_cover_image_fk(public_url,storage_path,sort_order,meta,mime_type),images:market_listing_images!market_listing_images_listing_id_fkey(id,public_url,storage_path,sort_order,meta,mime_type)";

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

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 999,
        backgroundColor: active ? PURPLE : "rgba(255,255,255,0.06)",
        borderWidth: 1,
        borderColor: active ? PURPLE : BORDER,
      }}
    >
      <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }}>{label}</Text>
    </Pressable>
  );
}

function VerifiedTick({ verified }: { verified?: boolean | null }) {
  if (!verified) return null;
  return <Ionicons name="checkmark-circle" size={16} color="#3B82F6" />;
}

function sanitizeSearchTerm(value: string) {
  return String(value || "")
    .replace(/[%(),]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

  if (handle === t) return 6;
  if (handle.startsWith(t)) return 5;
  if (business === t || display === t) return 4;
  if (business.startsWith(t) || display.startsWith(t)) return 3;
  if (handle.includes(t)) return 2;
  return 1;
}

function searchModeLabel(mode: SearchMode) {
  if (mode === "product") return "products";
  if (mode === "service") return "services";
  if (mode === "store") return "stores";
  return "results";
}

export default function MarketSearchScreen() {
  const insets = useSafeAreaInsets();
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
      const userCountry = await resolveUserCountry({ prompt: true, refresh: true, ipOnly: true }).catch(() => null);
      if (requestId !== requestIdRef.current) return;

      const shouldShowStoreCards = nextMode === "all" || nextMode === "store";
      const shouldSearchStores = !!sellerTerm;
      const shouldSearchListings = nextMode !== "store";

      setScopeLabel(
        shouldSearchListings && userCountry
          ? `Listings matched for ${formatCountryLabel(userCountry.name, userCountry.code) || "your location"}.`
          : null,
      );

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
          .limit(24);

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
          .limit(80);

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
          .limit(80);

        if (nextMode === "product" || nextMode === "service") {
          sellerListingsQuery = sellerListingsQuery.eq("category", nextMode);
        }

        const { data, error } = await sellerListingsQuery;
        if (error) throw error;
        listingBatches.push((data ?? []) as Listing[]);
      }

      const combinedListings = listingBatches.flat();
      const scopedListings = userCountry
        ? combinedListings.filter((item) =>
            listingMatchesCountry(item.availability ?? item.payment_options?.availability, userCountry, false),
          )
        : combinedListings;

      const listingMap = new Map<string, Listing>();
      scopedListings.forEach((item) => {
        if (!item?.id || listingMap.has(item.id)) return;
        listingMap.set(item.id, item);
      });

      const nextListings = Array.from(listingMap.values()).sort((a, b) => {
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

  const resultCount = stores.length + listings.length;
  const hasResults = stores.length > 0 || listings.length > 0;

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
      <ScrollView contentContainerStyle={{ paddingBottom: 28 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <Pressable
            onPress={() => router.back()}
            style={{
              width: 44,
              height: 44,
              borderRadius: 16,
              backgroundColor: "rgba(255,255,255,0.06)",
              borderWidth: 1,
              borderColor: BORDER,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </Pressable>

          <View style={{ flex: 1 }}>
            <Text style={{ color: "#fff", fontSize: 22, fontWeight: "900" }}>Search</Text>
            <Text style={{ marginTop: 4, color: MUTED, fontSize: 12 }}>
              Products, services, stores, and @username
            </Text>
          </View>
        </View>

        <View
          style={{
            borderRadius: 22,
            padding: 14,
            borderWidth: 1,
            borderColor: BORDER,
            backgroundColor: CARD,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              gap: 10,
              borderRadius: 18,
              padding: 12,
              borderWidth: 1,
              borderColor: BORDER,
              backgroundColor: "rgba(255,255,255,0.04)",
              alignItems: "center",
            }}
          >
            <Ionicons name="search-outline" size={18} color="rgba(255,255,255,0.75)" />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Search products, services, @username, or store"
              placeholderTextColor="rgba(255,255,255,0.45)"
              style={{ flex: 1, color: "#fff", fontWeight: "700" }}
              returnKeyType="search"
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={() => onSubmit()}
            />
            <Pressable
              onPress={() => onSubmit()}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 10,
                borderRadius: 16,
                backgroundColor: PURPLE,
                borderWidth: 1,
                borderColor: PURPLE,
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "900" }}>Go</Text>
            </Pressable>
          </View>

          <View style={{ marginTop: 12, flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
            <FilterChip label="All" active={mode === "all"} onPress={() => onSelectMode("all")} />
            <FilterChip label="Products" active={mode === "product"} onPress={() => onSelectMode("product")} />
            <FilterChip label="Services" active={mode === "service"} onPress={() => onSelectMode("service")} />
            <FilterChip label="Stores" active={mode === "store"} onPress={() => onSelectMode("store")} />
          </View>

          <View style={{ marginTop: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: "#fff", fontWeight: "900", fontSize: 15 }}>
                {loading ? "Searching..." : `${resultCount} ${searchModeLabel(mode)} in view`}
              </Text>
              <Text style={{ marginTop: 4, color: MUTED, fontSize: 12 }}>
                {scopeLabel || "Search matches titles, descriptions, store names, and @username handles."}
              </Text>
            </View>
          </View>
        </View>

        {loading ? (
          <View style={{ marginTop: 40, alignItems: "center" }}>
            <ActivityIndicator />
            <Text style={{ marginTop: 10, color: "rgba(255,255,255,0.7)" }}>Searching...</Text>
          </View>
        ) : err ? (
          <View
            style={{
              marginTop: 18,
              borderRadius: 22,
              padding: 16,
              backgroundColor: CARD,
              borderWidth: 1,
              borderColor: BORDER,
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "900" }}>Search failed</Text>
            <Text style={{ marginTop: 6, color: MUTED }}>{err}</Text>
          </View>
        ) : !hasResults ? (
          <View
            style={{
              marginTop: 18,
              borderRadius: 22,
              padding: 16,
              backgroundColor: CARD,
              borderWidth: 1,
              borderColor: BORDER,
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "900" }}>No results</Text>
            <Text style={{ marginTop: 6, color: MUTED }}>
              Try a product keyword, a store name, or search directly with @username.
            </Text>

            <Pressable
              onPress={() => router.push("/market/category" as any)}
              style={{
                marginTop: 12,
                borderRadius: 18,
                paddingVertical: 12,
                alignItems: "center",
                backgroundColor: "rgba(255,255,255,0.06)",
                borderWidth: 1,
                borderColor: BORDER,
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "900" }}>Browse Categories</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {stores.length ? (
              <View style={{ marginTop: 18 }}>
                <Text style={{ color: "#fff", fontWeight: "900", fontSize: 16 }}>Stores</Text>
                <View style={{ marginTop: 10, gap: 12 }}>
                  {stores.map((seller) => {
                    const logo = publicSellerLogo(seller.logo_path);
                    const sellerName = seller.business_name || seller.display_name || `@${seller.market_username || "store"}`;
                    return (
                      <Pressable
                        key={seller.user_id}
                        disabled={!seller.market_username}
                        onPress={() => seller.market_username && router.push(`/market/profile/${seller.market_username}` as any)}
                        style={{
                          borderRadius: 20,
                          padding: 14,
                          backgroundColor: CARD,
                          borderWidth: 1,
                          borderColor: BORDER,
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 12,
                        }}
                      >
                        <View
                          style={{
                            width: 54,
                            height: 54,
                            borderRadius: 27,
                            overflow: "hidden",
                            backgroundColor: "rgba(255,255,255,0.08)",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {logo ? (
                            <Image source={{ uri: logo }} style={{ width: 54, height: 54 }} />
                          ) : (
                            <Ionicons name="storefront-outline" size={22} color="#fff" />
                          )}
                        </View>

                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                            <Text numberOfLines={1} style={{ color: "#fff", fontWeight: "900", fontSize: 15, flex: 1 }}>
                              {sellerName}
                            </Text>
                            <VerifiedTick verified={seller.is_verified} />
                          </View>
                          <Text style={{ marginTop: 4, color: MUTED, fontSize: 12 }}>
                            @{seller.market_username || "store"}
                          </Text>
                          <Text numberOfLines={2} style={{ marginTop: 6, color: "rgba(255,255,255,0.7)", fontSize: 12 }}>
                            {seller.bio || "Open storefront"}
                          </Text>
                        </View>

                        <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.6)" />
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {listings.length ? (
              <View style={{ marginTop: 18 }}>
                <Text style={{ color: "#fff", fontWeight: "900", fontSize: 16 }}>Listings</Text>
                <View style={{ marginTop: 10, flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
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

                    return (
                      <Pressable
                        key={listing.id}
                        onPress={() => router.push(`/market/listing/${listing.id}` as any)}
                        style={{
                          width: "48%",
                          borderRadius: 22,
                          overflow: "hidden",
                          backgroundColor: CARD,
                          borderWidth: 1,
                          borderColor: BORDER,
                        }}
                      >
                        <View style={{ height: 116, backgroundColor: "rgba(255,255,255,0.04)" }}>
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
                              <Ionicons name="image-outline" size={26} color="rgba(255,255,255,0.55)" />
                            </View>
                          )}
                        </View>

                        <View style={{ padding: 12 }}>
                          <Text numberOfLines={2} style={{ color: "#fff", fontWeight: "900", minHeight: 38 }}>
                            {listing.title ?? "Untitled"}
                          </Text>

                          <Text numberOfLines={1} style={{ marginTop: 6, color: MUTED, fontSize: 12 }}>
                            {listing.category === "service" ? "Service" : "Product"} - {sellerLabel}
                          </Text>

                          <Text numberOfLines={1} style={{ marginTop: 4, color: "rgba(255,255,255,0.52)", fontSize: 11 }}>
                            {listing.sub_category || listing.delivery_type || "-"}
                          </Text>

                          <Text style={{ marginTop: 10, color: "#fff", fontWeight: "900", fontSize: 15 }}>
                            {formatCurrency(dp.localCurrency, dp.localNow)}
                          </Text>
                          <Text style={{ marginTop: 3, color: "rgba(255,255,255,0.55)", fontSize: 11 }}>
                            USD {formatCurrency("USD", dp.usdNow)}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </LinearGradient>
  );
}
