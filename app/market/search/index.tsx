import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    Text,
    TextInput,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import MarketMediaView from "@/components/market/MarketMediaView";
import { supabase } from "@/services/supabase";
import { isNigeriaCountry, listingMatchesCountry, resolveUserCountry } from "@/utils/country";
import { buildMarketMediaUrl, resolveMarketMediaKind, sortMarketMedia } from "@/utils/marketMedia";
import { listingAllowsCrypto } from "@/utils/marketVisibility";
import { formatCurrency, getListingPriceDisplay } from "@/utils/pricing";

const BG0 = "#05040B";
const BG1 = "#0A0620";
const PURPLE = "#7C3AED";

const LISTINGS_TABLE = "market_listings";
const IMAGES_TABLE = "market_listing_images";

// IMPORTANT: set your bucket name here (the bucket where listing images are stored)
const LISTING_IMAGES_BUCKET = "market-listings";

type Listing = {
  id: string;
  title: string | null;
  price_amount: number | string | null;
  currency: string | null;
  payment_options?: any;
  delivery_type: string | null;
  category: string | null;
  sub_category: string | null;
  created_at?: string | null;
  availability?: any;

  market_listing_images?: Array<{
    id: string;
    public_url: string | null;
    storage_path: string;
    sort_order: number | null;
  }> | null;
};

function pickCoverMedia(
  imgs: Listing["market_listing_images"],
) {
  if (!imgs || imgs.length === 0) return null;
  return sortMarketMedia(imgs)[0] ?? null;
}

export default function MarketSearchScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ q?: string }>();

  const initialQ = useMemo(() => String(params?.q ?? "").trim(), [params?.q]);
  const [q, setQ] = useState(initialQ);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Listing[]>([]);
  const [err, setErr] = useState<string | null>(null);

  async function runSearch(term: string) {
    const t = term.trim();
    console.log("[MarketSearch] load start", { term: t });
    setLoading(true);
    setErr(null);

    try {
      if (!t) {
        setRows([]);
        return;
      }

      const userCountry = await resolveUserCountry({ prompt: true, refresh: true, ipOnly: true });
      const restrictToCrypto = !isNigeriaCountry(userCountry?.code || userCountry?.name);
      // ✅ Search by title / description / sub_category
      // If you later add FTS, we replace this with a proper text search.
      const { data, error } = await supabase
        .from(LISTINGS_TABLE)
        .select(
          `
          id,title,price_amount,currency,payment_options,delivery_type,category,sub_category,created_at,availability,
          market_listing_images:${IMAGES_TABLE}(id,public_url,storage_path,sort_order)
        `,
        )
        .eq("is_active", true)
        .or(
          [
            `title.ilike.%${t}%`,
            `description.ilike.%${t}%`,
            `sub_category.ilike.%${t}%`,
          ].join(","),
        )
        .order("created_at", { ascending: false })
        .limit(60);

      if (error) throw new Error(error.message);

      const items = ((data as any) ?? []) as Listing[];
      const scoped = userCountry
        ? items.filter((r) => listingMatchesCountry((r as any).availability, userCountry, false))
        : items;
      const filtered = restrictToCrypto ? scoped.filter((r) => listingAllowsCrypto(r)) : scoped;
      setRows(filtered);
    } catch (e: any) {
      setErr(e?.message || "Search failed");
      setRows([]);
    } finally {
      setLoading(false);
      console.log("[MarketSearch] load end");
    }
  }

  useEffect(() => {
    runSearch(initialQ);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQ]);

  function onSubmit() {
    const term = q.trim();
    router.setParams({ q: term } as any); // update URL
    runSearch(term);
  }

  const supabaseUrl = (supabase as any)?.supabaseUrl ?? (process.env.EXPO_PUBLIC_SUPABASE_URL as string) ?? "";

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
        {/* Header */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 }}>
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
            <Text style={{ color: "#fff", fontSize: 22, fontWeight: "900" }}>Search</Text>
            <Text style={{ marginTop: 4, color: "rgba(255,255,255,0.6)", fontSize: 12 }}>
              Find products and services
            </Text>
          </View>
        </View>

        {/* Search input */}
        <View
          style={{
            flexDirection: "row",
            gap: 10,
            borderRadius: 20,
            padding: 12,
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.10)",
            backgroundColor: "rgba(255,255,255,0.06)",
            alignItems: "center",
            marginBottom: 10,
          }}
        >
          <Ionicons name="search-outline" size={18} color="rgba(255,255,255,0.75)" />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search e.g. iPhone, shoes, barber..."
            placeholderTextColor="rgba(255,255,255,0.45)"
            style={{ flex: 1, color: "#fff", fontWeight: "700" }}
            returnKeyType="search"
            onSubmitEditing={onSubmit}
          />
          <Pressable
            onPress={onSubmit}
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

        {loading ? (
          <View style={{ marginTop: 40, alignItems: "center" }}>
            <ActivityIndicator />
            <Text style={{ marginTop: 10, color: "rgba(255,255,255,0.7)" }}>Searching…</Text>
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
            <Text style={{ color: "#fff", fontWeight: "900" }}>Search failed</Text>
            <Text style={{ marginTop: 6, color: "rgba(255,255,255,0.65)" }}>{err}</Text>
            <Text style={{ marginTop: 10, color: "rgba(255,255,255,0.65)" }}>
              Check your table names:{" "}
              <Text style={{ color: "#C4B5FD", fontWeight: "900" }}>{LISTINGS_TABLE}</Text> and{" "}
              <Text style={{ color: "#C4B5FD", fontWeight: "900" }}>{IMAGES_TABLE}</Text>
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
            <Text style={{ color: "#fff", fontWeight: "900" }}>No results</Text>
            <Text style={{ marginTop: 6, color: "rgba(255,255,255,0.65)" }}>
              Try a different keyword, or browse categories.
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
                borderColor: "rgba(255,255,255,0.10)",
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "900" }}>Browse Categories</Text>
            </Pressable>
          </View>
        ) : (
          <View style={{ marginTop: 8, flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            {rows.map((r) => {
              const coverMedia = pickCoverMedia(r.market_listing_images ?? null);
              const cover = buildMarketMediaUrl(coverMedia, supabaseUrl, LISTING_IMAGES_BUCKET);
              const coverKind = resolveMarketMediaKind(coverMedia);
              const dp = getListingPriceDisplay(r as any);
              return (
                <Pressable
                  key={r.id}
                  onPress={() => router.push(`/market/listing/${r.id}` as any)}
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
                    {cover ? (
                      <MarketMediaView
                        uri={cover}
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
                    <Text numberOfLines={1} style={{ color: "#fff", fontWeight: "900" }}>
                      {r.title ?? "Untitled"}
                    </Text>

                    <Text style={{ marginTop: 6, color: "rgba(255,255,255,0.65)", fontSize: 12 }}>
                      <Text style={{ color: "#fff", fontWeight: "900" }}>
                        {formatCurrency(dp.localCurrency, dp.localNow)}
                      </Text>
                      {"  "}
                      <Text style={{ color: "rgba(255,255,255,0.55)" }}>
                        USD {formatCurrency("USD", dp.usdNow)} - {r.delivery_type ?? "-"}
                      </Text>
                    </Text>
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
