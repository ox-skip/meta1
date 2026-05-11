import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import AppHeader from "@/components/common/AppHeader";
import ListingOriginBadge from "@/components/market/ListingOriginBadge";
import MarketMediaView from "@/components/market/MarketMediaView";
import { getCategoryBySlug } from "@/services/market/categories";
import { supabase } from "@/services/supabase";
import { isNigeriaCountry, listingMatchesCountry, resolveUserCountry } from "@/utils/country";
import { resolveMarketMediaSource, sortMarketMedia } from "@/utils/marketMedia";
import { listingAllowsCrypto } from "@/utils/marketVisibility";
import { formatCurrency, getListingPriceDisplay } from "@/utils/pricing";

const BG0 = "#060807";
const BG1 = "#10130E";
const BG2 = "#171A13";
const INK = "#090D0B";
const TEAL = "#2DD4BF";
const BLUE = "#38BDF8";
const AMBER = "#F4B75D";
const ROSE = "#FB7185";
const TEXT = "#FFFDF7";
const MUTED = "rgba(255,253,247,0.68)";
const FAINT = "rgba(255,253,247,0.44)";
const CARD = "rgba(255,253,247,0.065)";
const BORDER = "rgba(255,253,247,0.12)";
const BORDER_TOP = "rgba(255,253,247,0.24)";

const LISTINGS_TABLE = "market_listings";
const LISTING_IMAGES_BUCKET = "market-listings";

type ListingRow = {
  id: string;
  title: string | null;
  price_amount: number | string | null;
  currency: string | null;
  payment_options?: any;
  delivery_type: string | null;
  category: string | null;
  sub_category: string | null;
  cover_image_id: string | null;
  availability?: any;
  market_listing_images?: { id: string; public_url: string | null; storage_path: string | null; meta?: any } | null;
  images?: { id: string; public_url: string | null; storage_path: string | null; sort_order: number | null; meta?: any }[] | null;
};

function StatePanel({
  icon,
  title,
  message,
  tone = TEAL,
  actionLabel,
  onAction,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  message: string;
  tone?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View
      style={{
        marginTop: 14,
        borderRadius: 24,
        padding: 18,
        backgroundColor: CARD,
        borderWidth: 1,
        borderColor: BORDER,
      }}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 16,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: `${tone}20`,
          borderWidth: 1,
          borderColor: `${tone}46`,
        }}
      >
        <Ionicons name={icon} size={20} color={tone} />
      </View>
      <Text style={{ marginTop: 12, color: TEXT, fontWeight: "900", fontSize: 18 }}>{title}</Text>
      <Text style={{ marginTop: 6, color: MUTED, lineHeight: 20 }}>{message}</Text>

      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          style={({ pressed }) => ({
            marginTop: 14,
            borderRadius: 18,
            paddingVertical: 13,
            alignItems: "center",
            backgroundColor: pressed ? "rgba(94,234,212,0.82)" : TEAL,
            borderWidth: 1,
            borderColor: "rgba(94,234,212,0.70)",
            transform: [{ translateY: pressed ? 1 : 0 }],
          })}
        >
          <Text style={{ color: INK, fontWeight: "900" }}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function ListingCard({
  item,
  width,
  supabaseUrl,
}: {
  item: ListingRow;
  width: `${number}%`;
  supabaseUrl: string;
}) {
  const mediaSource = resolveMarketMediaSource(
    [item.market_listing_images ?? null, ...sortMarketMedia(item.images ?? [])],
    supabaseUrl,
    LISTING_IMAGES_BUCKET,
  );
  const img = mediaSource?.url ?? null;
  const coverKind = mediaSource?.kind ?? "image";
  const display = getListingPriceDisplay(item as any);
  const isService = String(item.category || "").toLowerCase() === "service";
  const tone = isService ? BLUE : TEAL;
  const delivery = String(item.delivery_type || (isService ? "service" : "delivery")).replace(/_/g, " ");

  return (
    <Pressable
      onPress={() => router.push(`/market/listing/${item.id}` as any)}
      accessibilityRole="button"
      style={({ pressed }) => ({
        width,
        borderRadius: 22,
        overflow: "hidden",
        backgroundColor: pressed ? "rgba(255,253,247,0.09)" : CARD,
        borderWidth: 1,
        borderColor: pressed ? BORDER_TOP : BORDER,
        transform: [{ translateY: pressed ? 1 : 0 }],
      })}
    >
      <View style={{ aspectRatio: 1.08, backgroundColor: "rgba(255,253,247,0.07)" }}>
        {img ? (
          <MarketMediaView
            uri={img}
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
            <Ionicons name="image-outline" size={26} color={FAINT} />
          </View>
        )}

        <View
          style={{
            position: "absolute",
            left: 8,
            top: 8,
            borderRadius: 999,
            paddingHorizontal: 8,
            paddingVertical: 5,
            backgroundColor: "rgba(9,13,11,0.72)",
            borderWidth: 1,
            borderColor: `${tone}55`,
          }}
        >
          <Text style={{ color: tone, fontWeight: "900", fontSize: 10 }}>{isService ? "SERVICE" : "PRODUCT"}</Text>
        </View>
      </View>

      <View style={{ padding: 12 }}>
        <Text numberOfLines={2} style={{ color: TEXT, fontWeight: "900", minHeight: 38, lineHeight: 19 }}>
          {item.title ?? "Untitled listing"}
        </Text>
        <Text numberOfLines={1} style={{ marginTop: 6, color: MUTED, fontSize: 12, textTransform: "capitalize" }}>
          {delivery}
        </Text>

        <View style={{ marginTop: 8 }}>
          <ListingOriginBadge availability={item.availability} paymentOptions={item.payment_options} compact />
        </View>

        <Text numberOfLines={1} style={{ marginTop: 10, color: TEXT, fontWeight: "900", fontSize: 15 }}>
          {formatCurrency(display.localCurrency, display.localNow)}
        </Text>
        <Text numberOfLines={1} style={{ marginTop: 3, color: FAINT, fontSize: 11 }}>
          USD {formatCurrency("USD", display.usdNow)}
        </Text>
      </View>
    </Pressable>
  );
}

export default function CategoryFeed() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const cat = useMemo(() => getCategoryBySlug(String(slug || "")), [slug]);
  const { width } = useWindowDimensions();
  const isWebDesktop = Platform.OS === "web" && width >= 980;
  const contentMaxWidth = isWebDesktop ? 1120 : undefined;
  const pagePadding = isWebDesktop ? 28 : 16;
  const tileWidth = (width >= 900 ? "31.8%" : "48%") as `${number}%`;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rows, setRows] = useState<ListingRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const supabaseUrl =
    (supabase as any)?.supabaseUrl ?? (process.env.EXPO_PUBLIC_SUPABASE_URL as string) ?? "";

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = !!opts?.silent;
      if (!silent) setLoading(true);
      setErr(null);

      try {
        if (!cat) {
          setRows([]);
          setErr("Category not found.");
          return;
        }

        const userCountry = await resolveUserCountry({ prompt: true, refresh: true, ipOnly: true });
        const restrictToCrypto = !isNigeriaCountry(userCountry?.code || userCountry?.name);
        const { data, error } = await supabase
          .from(LISTINGS_TABLE)
          .select(
            `
              id,
              title,
              price_amount,
              currency,
              payment_options,
              delivery_type,
              category,
              sub_category,
              cover_image_id,
              availability,
              market_listing_images!market_listings_cover_image_fk (
                id,
                public_url,
                storage_path,
                meta
              ),
              images:market_listing_images!market_listing_images_listing_id_fkey (
                id,
                public_url,
                storage_path,
                sort_order,
                meta
              )
            `,
          )
          .eq("sub_category", cat.slug)
          .eq("is_active", true)
          .order("created_at", { ascending: false })
          .limit(60);

        if (error) throw new Error(error.message);

        const items = ((data as any) ?? []) as ListingRow[];
        const scoped = userCountry
          ? items.filter((row) => listingMatchesCountry(row.availability, userCountry, false))
          : items;
        const filtered = restrictToCrypto ? scoped.filter((row) => listingAllowsCrypto(row)) : scoped;
        setRows(filtered);
      } catch (e: any) {
        setErr(e?.message || "Failed to load listings");
        setRows([]);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [cat],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load({ silent: true });
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const tone = cat?.main === "service" ? BLUE : TEAL;
  const modeLabel = cat?.main === "service" ? "Service lane" : "Product lane";

  return (
    <LinearGradient
      colors={[BG2, BG1, BG0]}
      start={{ x: 0.15, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={{ flex: 1, paddingHorizontal: pagePadding, paddingTop: 14 }}
    >
      <View style={{ alignSelf: "center", width: "100%", maxWidth: contentMaxWidth }}>
        <AppHeader
          title={cat?.title ?? "Category"}
          subtitle={cat?.subtitle ?? "Browse listings"}
          bordered={false}
          style={{ backgroundColor: "transparent", paddingHorizontal: 0 }}
        />
      </View>

      <ScrollView
        contentContainerStyle={{
          alignSelf: "center",
          width: "100%",
          maxWidth: contentMaxWidth,
          paddingBottom: 44,
        }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={TEXT} />}
      >
        <LinearGradient
          colors={[`${tone}24`, "rgba(244,183,93,0.08)", "rgba(255,253,247,0.055)"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            marginTop: 8,
            borderRadius: 28,
            padding: 18,
            borderWidth: 1,
            borderColor: BORDER_TOP,
            overflow: "hidden",
          }}
        >
          <View style={{ flexDirection: isWebDesktop ? "row" : "column", gap: 16, alignItems: "stretch" }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <View
                  style={{
                    borderRadius: 999,
                    paddingHorizontal: 10,
                    paddingVertical: 7,
                    backgroundColor: "rgba(9,13,11,0.50)",
                    borderWidth: 1,
                    borderColor: `${tone}44`,
                  }}
                >
                  <Text style={{ color: tone, fontWeight: "900", fontSize: 12 }}>{modeLabel}</Text>
                </View>
                <View
                  style={{
                    borderRadius: 999,
                    paddingHorizontal: 10,
                    paddingVertical: 7,
                    backgroundColor: "rgba(9,13,11,0.42)",
                    borderWidth: 1,
                    borderColor: "rgba(244,183,93,0.28)",
                  }}
                >
                  <Text style={{ color: AMBER, fontWeight: "900", fontSize: 12 }}>Escrow ready</Text>
                </View>
              </View>

              <Text
                style={{
                  marginTop: 14,
                  color: TEXT,
                  fontWeight: "900",
                  fontSize: isWebDesktop ? 34 : 28,
                  lineHeight: isWebDesktop ? 40 : 34,
                  maxWidth: 640,
                }}
              >
                {cat?.title ?? "Category"}
              </Text>
              <Text style={{ marginTop: 8, color: MUTED, lineHeight: 21, maxWidth: 680 }}>
                {cat?.subtitle ?? "Browse listings"} across marketplace offers matched to your availability and payment scope.
              </Text>
            </View>

            <View style={{ width: isWebDesktop ? 300 : undefined, justifyContent: "center", gap: 10 }}>
              <View
                style={{
                  borderRadius: 22,
                  padding: 14,
                  backgroundColor: "rgba(9,13,11,0.44)",
                  borderWidth: 1,
                  borderColor: BORDER,
                }}
              >
                <Text style={{ color: MUTED, fontWeight: "900", fontSize: 11 }}>LISTINGS IN VIEW</Text>
                <Text style={{ marginTop: 6, color: TEXT, fontWeight: "900", fontSize: 24 }}>
                  {loading ? "-" : rows.length}
                </Text>
                <Text style={{ marginTop: 4, color: FAINT, fontSize: 12 }}>Pull to refresh this lane.</Text>
              </View>

              <Pressable
                onPress={() => router.push("/market/category" as any)}
                style={({ pressed }) => ({
                  borderRadius: 18,
                  paddingVertical: 13,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: pressed ? "rgba(255,253,247,0.12)" : "rgba(255,253,247,0.07)",
                  borderWidth: 1,
                  borderColor: BORDER,
                  flexDirection: "row",
                  gap: 8,
                  transform: [{ translateY: pressed ? 1 : 0 }],
                })}
              >
                <Ionicons name="grid-outline" size={17} color={TEXT} />
                <Text style={{ color: TEXT, fontWeight: "900" }}>All categories</Text>
              </Pressable>
            </View>
          </View>
        </LinearGradient>

        {loading ? (
          <View
            style={{
              marginTop: 14,
              borderRadius: 24,
              padding: 24,
              alignItems: "center",
              backgroundColor: CARD,
              borderWidth: 1,
              borderColor: BORDER,
            }}
          >
            <ActivityIndicator color={TEAL} />
            <Text style={{ marginTop: 10, color: MUTED, fontWeight: "800" }}>Loading listings...</Text>
          </View>
        ) : err ? (
          <StatePanel
            icon="alert-circle-outline"
            title="Could not load listings"
            message={err}
            tone={ROSE}
            actionLabel="Try again"
            onAction={() => load()}
          />
        ) : rows.length === 0 ? (
          <StatePanel
            icon="albums-outline"
            title="No listings yet"
            message="Be the first to post in this category and give buyers a fresh option to discover."
            tone={AMBER}
            actionLabel="Sell in this category"
            onAction={() => router.push("/market/(tabs)/sell" as any)}
          />
        ) : (
          <>
            <View style={{ marginTop: 18, marginBottom: 10 }}>
              <Text style={{ color: TEXT, fontWeight: "900", fontSize: 17 }}>Listings</Text>
              <Text style={{ marginTop: 4, color: MUTED, fontSize: 12 }}>
                {rows.length} result{rows.length === 1 ? "" : "s"} in this lane
              </Text>
            </View>

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
              {rows.map((item) => (
                <ListingCard key={item.id} item={item} width={tileWidth} supabaseUrl={supabaseUrl} />
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </LinearGradient>
  );
}
