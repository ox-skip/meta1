import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";

import AppHeader from "@/components/common/AppHeader";
import ListingOriginBadge from "@/components/market/ListingOriginBadge";
import MarketMediaView from "@/components/market/MarketMediaView";
import { getCategoryBySlug } from "@/services/market/categories";
import { supabase } from "@/services/supabase";
import { isNigeriaCountry, listingMatchesCountry, resolveUserCountry } from "@/utils/country";
import { resolveMarketMediaSource, sortMarketMedia } from "@/utils/marketMedia";
import { listingAllowsCrypto } from "@/utils/marketVisibility";
import { formatCurrency, getListingPriceDisplay } from "@/utils/pricing";

const BG0 = "#05040B";
const BG1 = "#0A0620";
const PURPLE = "#7C3AED";

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

export default function CategoryFeed() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const cat = useMemo(() => getCategoryBySlug(String(slug || "")), [slug]);

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ListingRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const supabaseUrl =
    (supabase as any)?.supabaseUrl ?? (process.env.EXPO_PUBLIC_SUPABASE_URL as string) ?? "";

  useEffect(() => {
    let mounted = true;

    (async () => {
      console.log("[CategoryFeed] load start");
      setLoading(true);
      setErr(null);

      try {
        if (!cat) {
          if (mounted) {
            setRows([]);
          }
          return;
        }

        // ✅ Correct: join cover image via FK:
        // market_listings.cover_image_id -> market_listing_images.id
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
            `
          )
          .eq("sub_category", cat.slug)
          .eq("is_active", true)
          .order("created_at", { ascending: false })
          .limit(60);

        if (error) throw new Error(error.message);

        if (mounted) {
          const items = ((data as any) ?? []) as ListingRow[];
          const scoped = userCountry
            ? items.filter((r) => listingMatchesCountry(r.availability, userCountry, false))
            : items;
          const filtered = restrictToCrypto ? scoped.filter((r) => listingAllowsCrypto(r)) : scoped;
          setRows(filtered);
        }
      } catch (e: any) {
        if (mounted) {
          setErr(e?.message || "Failed to load listings");
          setRows([]);
        }
      } finally {
        if (mounted) {
          setLoading(false);
          console.log("[CategoryFeed] load end");
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [slug, cat?.slug]);

  return (
    <LinearGradient
      colors={[BG1, BG0]}
      start={{ x: 0.15, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={{ flex: 1, paddingHorizontal: 16, paddingTop: 14 }}
    >
      <AppHeader title={cat?.title ?? "Category"} subtitle={cat?.subtitle ?? "Browse listings"} />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        {/* Header */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 }}>
          <Pressable
            onPress={() => router.back()}
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
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </Pressable>

          <View style={{ flex: 1 }}>
            <Text style={{ color: "#fff", fontSize: 22, fontWeight: "900" }}>{cat?.title ?? "Category"}</Text>
            <Text style={{ color: "rgba(255,255,255,0.6)", marginTop: 4, fontSize: 12 }}>
              {cat?.subtitle ?? "Browse listings"}
            </Text>
          </View>

          <Pressable
            onPress={() => router.push("/market/category")}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 10,
              borderRadius: 16,
              backgroundColor: "rgba(255,255,255,0.06)",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.10)",
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "900" }}>All</Text>
          </Pressable>
        </View>

        {loading ? (
          <View style={{ marginTop: 40, alignItems: "center" }}>
            <ActivityIndicator />
            <Text style={{ marginTop: 10, color: "rgba(255,255,255,0.7)" }}>Loading listings…</Text>
          </View>
        ) : err ? (
          <View
            style={{
              marginTop: 18,
              borderRadius: 22,
              padding: 16,
              backgroundColor: "rgba(255,255,255,0.05)",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.08)",
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "900" }}>Could not load listings</Text>
            <Text style={{ marginTop: 6, color: "rgba(255,255,255,0.65)" }}>{err}</Text>
            <Text style={{ marginTop: 10, color: "rgba(255,255,255,0.65)" }}>
              Confirm the table name is: <Text style={{ color: "#C4B5FD", fontWeight: "900" }}>{LISTINGS_TABLE}</Text>
            </Text>
          </View>
        ) : rows.length === 0 ? (
          <View
            style={{
              marginTop: 18,
              borderRadius: 22,
              padding: 16,
              backgroundColor: "rgba(255,255,255,0.05)",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.08)",
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "900" }}>No listings yet</Text>
            <Text style={{ marginTop: 6, color: "rgba(255,255,255,0.65)" }}>Be the first to post in this category.</Text>

            <Pressable
              onPress={() => router.push("/market/(tabs)/sell")}
              style={{
                marginTop: 12,
                borderRadius: 18,
                paddingVertical: 12,
                alignItems: "center",
                backgroundColor: PURPLE,
                borderWidth: 1,
                borderColor: PURPLE,
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "900" }}>Sell in this category</Text>
            </Pressable>
          </View>
        ) : (
          <View style={{ marginTop: 8, flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            {rows.map((r) => {
              const mediaSource = resolveMarketMediaSource(
                [r.market_listing_images ?? null, ...sortMarketMedia(r.images ?? [])],
                supabaseUrl,
                LISTING_IMAGES_BUCKET,
              );
              const img = mediaSource?.url ?? null;
              const coverKind = mediaSource?.kind ?? "image";

              return (
                <Pressable
                  key={r.id}
                  onPress={() => router.push(`/market/listing/${r.id}`)}
                  style={{
                    width: "48%",
                    borderRadius: 22,
                    overflow: "hidden",
                    backgroundColor: "rgba(255,255,255,0.05)",
                    borderWidth: 1,
                    borderColor: "rgba(255,255,255,0.08)",
                  }}
                >
                  <View style={{ height: 110, backgroundColor: "rgba(255,255,255,0.06)" }}>
                    {img ? (
                      <MarketMediaView
                        uri={img}
                        kind={coverKind}
                        style={{ width: "100%", height: 110 }}
                        resizeMode="cover"
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
                    {(() => {
                      const dp = getListingPriceDisplay(r as any);
                      return (
                        <>
                    <Text numberOfLines={1} style={{ color: "#fff", fontWeight: "900" }}>
                      {r.title ?? "Untitled"}
                    </Text>

                    <Text style={{ marginTop: 6, color: "rgba(255,255,255,0.65)", fontSize: 12 }}>
                      {formatCurrency(dp.localCurrency, dp.localNow)}
                    </Text>
                    <Text style={{ marginTop: 4, color: "rgba(255,255,255,0.55)", fontSize: 11 }}>
                      USD {formatCurrency("USD", dp.usdNow)}
                    </Text>
                    <View style={{ marginTop: 8 }}>
                      <ListingOriginBadge availability={r.availability} compact />
                    </View>
                        </>
                      );
                    })()}
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
