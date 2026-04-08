import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import MarketMediaView from "@/components/market/MarketMediaView";
import SocialFeed from "@/components/market/SocialFeed";
import { fetchStocksOverview } from "@/services/market/stocks";
import { supabase } from "@/services/supabase";
import { isNigeriaCountry, resolveUserCountry } from "@/utils/country";
import { inferMarketMediaKind } from "@/utils/marketMedia";
import { listingAllowsCrypto } from "@/utils/marketVisibility";
import { formatCurrency, getListingPriceDisplay } from "@/utils/pricing";

const BG0 = "#0B0907";
const BG1 = "#22160D";
const PANEL = "rgba(24,18,14,0.9)";
const PANEL_ALT = "rgba(255,255,255,0.04)";
const BORDER = "rgba(245,158,11,0.16)";
const TEXT = "#FFF7ED";
const MUTED = "rgba(255,247,237,0.68)";
const ACCENT = "#F59E0B";
const ACCENT_2 = "#FB923C";
const SUCCESS = "#4ADE80";
const BUCKET_SELLERS = "market-sellers";
const BUCKET_LISTINGS = "market-listings";
const COMPLETED_ORDER_STATUSES = ["DELIVERED", "RELEASED"] as const;
const CANCELLED_ORDER_STATUSES = ["CANCELLED"] as const;
const REFUNDED_ORDER_STATUSES = ["REFUNDED"] as const;

type SocialKey =
  | "x"
  | "instagram"
  | "facebook"
  | "tiktok"
  | "linkedin"
  | "telegram"
  | "youtube"
  | "github"
  | "whatsapp"
  | "website";

type SocialLinks = Record<SocialKey, { enabled?: boolean; handle?: string }>;

const SOCIALS: { key: SocialKey; label: string; prefix: string; icon: string }[] = [
  { key: "x", label: "X", prefix: "https://x.com/", icon: "twitter" },
  { key: "instagram", label: "Instagram", prefix: "https://instagram.com/", icon: "instagram" },
  { key: "facebook", label: "Facebook", prefix: "https://facebook.com/", icon: "facebook" },
  { key: "tiktok", label: "TikTok", prefix: "https://tiktok.com/@", icon: "tiktok" },
  { key: "linkedin", label: "LinkedIn", prefix: "https://linkedin.com/in/", icon: "linkedin" },
  { key: "telegram", label: "Telegram", prefix: "https://t.me/", icon: "telegram" },
  { key: "youtube", label: "YouTube", prefix: "https://youtube.com/@", icon: "youtube" },
  { key: "github", label: "GitHub", prefix: "https://github.com/", icon: "github" },
  { key: "whatsapp", label: "WhatsApp", prefix: "https://wa.me/", icon: "whatsapp" },
  { key: "website", label: "Website", prefix: "https://", icon: "web" },
];

type Seller = {
  user_id: string;
  market_username: string | null;
  display_name: string | null;
  business_name: string | null;
  bio: string | null;
  location_text: string | null;
  is_verified: boolean;
  logo_path: string | null;
  banner_path: string | null;
  offers_remote: boolean;
  offers_in_person: boolean;
  payout_tier: "standard" | "fast";
  active: boolean;
  social_links?: SocialLinks;
};

type Listing = {
  id: string;
  title: string | null;
  price_amount: number | string | null;
  currency: string | null;
  payment_options?: any;
  delivery_type: string | null;
  category: string | null;
  sub_category: string | null;
  created_at: string;
  cover_url?: string | null;
};

type StoreStock = {
  id: string;
  slug: string;
  name: string;
  symbol: string;
  chain: string;
  status: "ACTIVE" | "BOOTSTRAP" | "PAUSED";
  price_usdc: number;
  market_cap_usdc: number;
  volume_24h_usdc: number;
  trades_24h: number;
};

type Review = {
  id: string;
  seller_id: string;
  reviewer_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  profiles?: { username?: string | null; full_name?: string | null } | null;
};

type StoreOrderSignals = {
  total: number;
  completed: number;
  cancelled: number;
  refunded: number;
  fulfillmentRate: number;
};

const EMPTY_ORDER_SIGNALS: StoreOrderSignals = {
  total: 0,
  completed: 0,
  cancelled: 0,
  refunded: 0,
  fulfillmentRate: 0,
};

function publicUrl(bucket: string, path: string | null) {
  if (!path) return null;
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data?.publicUrl ?? null;
}

function buildSocialUrl(key: SocialKey, handle: string) {
  const raw = handle.trim();
  if (!raw) return null;
  if (key === "website") {
    if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
    return `https://${raw}`;
  }
  const cleaned = raw.replace(/^@/, "").replace(/\s+/g, "");
  const base = SOCIALS.find((s) => s.key === key)?.prefix ?? "";
  if (key === "whatsapp") {
    return `${base}${cleaned.replace(/\\+/g, "")}`;
  }
  return `${base}${cleaned}`;
}

function SurfaceSection({
  title,
  subtitle,
  children,
  style,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  style?: any;
}) {
  return (
    <View
      style={[
        {
          borderRadius: 28,
          padding: 18,
          backgroundColor: PANEL,
          borderWidth: 1,
          borderColor: BORDER,
        },
        style,
      ]}
    >
      <Text style={{ color: TEXT, fontWeight: "900", fontSize: 18 }}>{title}</Text>
      <Text style={{ marginTop: 6, color: MUTED, fontSize: 13, lineHeight: 20 }}>{subtitle}</Text>
      <View style={{ marginTop: 16 }}>{children}</View>
    </View>
  );
}

function ActionButton({
  icon,
  label,
  accent,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  accent: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        minWidth: 126,
        borderRadius: 18,
        paddingHorizontal: 14,
        paddingVertical: 13,
        backgroundColor: `${accent}18`,
        borderWidth: 1,
        borderColor: `${accent}2E`,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
      }}
    >
      <Ionicons name={icon} size={16} color={accent} />
      <Text style={{ color: accent, fontWeight: "900", fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

function MetricCard({
  value,
  label,
}: {
  value: string;
  label: string;
}) {
  return (
    <View
      style={{
        flex: 1,
        minWidth: 94,
        borderRadius: 18,
        padding: 14,
        backgroundColor: PANEL_ALT,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.06)",
      }}
    >
      <Text style={{ color: TEXT, fontWeight: "900", fontSize: 20 }}>{value}</Text>
      <Text style={{ marginTop: 4, color: MUTED, fontSize: 12 }}>{label}</Text>
    </View>
  );
}

function SignalCard({
  icon,
  value,
  label,
  hint,
  tone,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
  label: string;
  hint: string;
  tone: string;
}) {
  return (
    <View
      style={{
        flex: 1,
        minWidth: 150,
        borderRadius: 22,
        padding: 14,
        backgroundColor: PANEL_ALT,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.06)",
      }}
    >
      <View
        style={{
          width: 42,
          height: 42,
          borderRadius: 15,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: `${tone}18`,
          borderWidth: 1,
          borderColor: `${tone}30`,
        }}
      >
        <Ionicons name={icon} size={18} color={tone} />
      </View>
      <Text style={{ marginTop: 12, color: TEXT, fontWeight: "900", fontSize: 21 }}>{value}</Text>
      <Text style={{ marginTop: 5, color: TEXT, fontWeight: "800", fontSize: 13 }}>{label}</Text>
      <Text style={{ marginTop: 5, color: MUTED, fontSize: 11, lineHeight: 17 }}>{hint}</Text>
    </View>
  );
}

function StoreTag({
  icon,
  label,
  tone = ACCENT,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  tone?: string;
}) {
  return (
    <View
      style={{
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 8,
        backgroundColor: `${tone}18`,
        borderWidth: 1,
        borderColor: `${tone}30`,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
      }}
    >
      <Ionicons name={icon} size={14} color={tone} />
      <Text style={{ color: tone, fontWeight: "900", fontSize: 12 }}>{label}</Text>
    </View>
  );
}

function SegmentButton({
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
        flex: 1,
        minHeight: 46,
        borderRadius: 16,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: active ? "rgba(245,158,11,0.18)" : PANEL_ALT,
        borderWidth: 1,
        borderColor: active ? "rgba(245,158,11,0.34)" : "rgba(255,255,255,0.08)",
      }}
    >
      <Text style={{ color: TEXT, fontWeight: "900", fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

function ReviewCard({ review }: { review: Review }) {
  return (
    <View
      style={{
        borderRadius: 18,
        padding: 14,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.06)",
        backgroundColor: PANEL_ALT,
      }}
    >
      <Text style={{ color: TEXT, fontWeight: "800" }}>
        @{review.profiles?.username || "user"}{" "}
        <Text style={{ color: MUTED, fontWeight: "600", fontSize: 11 }}>
          • {new Date(review.created_at).toLocaleString()}
        </Text>
      </Text>
      <View style={{ marginTop: 6, flexDirection: "row", gap: 4 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Ionicons key={n} name={review.rating >= n ? "star" : "star-outline"} size={14} color="#FBBF24" />
        ))}
      </View>
      {review.comment ? <Text style={{ marginTop: 8, color: MUTED, lineHeight: 19 }}>{review.comment}</Text> : null}
    </View>
  );
}

function ListingCard({
  listing,
  width,
}: {
  listing: Listing;
  width: string;
}) {
  const display = getListingPriceDisplay(listing as any);
  const coverKind = inferMarketMediaKind(listing.cover_url);

  return (
    <Pressable
      onPress={() => router.push(`/market/listing/${listing.id}` as any)}
      style={{
        width,
        borderRadius: 24,
        overflow: "hidden",
        backgroundColor: PANEL_ALT,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.06)",
      }}
    >
      <View style={{ height: 156, backgroundColor: "rgba(255,255,255,0.06)" }}>
        {listing.cover_url ? (
          <MarketMediaView
            uri={listing.cover_url}
            kind={coverKind}
            style={{ width: "100%", height: 156 }}
            resizeMode="cover"
            autoplay={coverKind === "video"}
            muted
            loop={coverKind === "video"}
            disablePointerEvents
          />
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="image-outline" size={28} color={MUTED} />
          </View>
        )}
      </View>

      <View style={{ padding: 14 }}>
        <Text numberOfLines={1} style={{ color: TEXT, fontWeight: "900", fontSize: 14 }}>
          {listing.title || "Untitled"}
        </Text>

        <Text style={{ marginTop: 8, color: TEXT, fontWeight: "900", fontSize: 14 }}>
          {formatCurrency(display.localCurrency, display.localNow)}
        </Text>
        <Text style={{ marginTop: 4, color: MUTED, fontSize: 11 }}>
          USD {formatCurrency("USD", display.usdNow)}
        </Text>

        <View style={{ marginTop: 10, flexDirection: "row", alignItems: "center", gap: 6 }}>
          <MaterialCommunityIcons
            name={listing.category === "service" ? "briefcase-outline" : "shopping-outline"}
            size={14}
            color={MUTED}
          />
          <Text style={{ color: MUTED, fontSize: 12 }}>
            {listing.category === "service" ? "Service" : "Product"} • {listing.delivery_type || "N/A"}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

export default function PublicSellerProfile() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const handle = useMemo(() => String(username || "").trim().toLowerCase(), [username]);
  const isDesktop = width >= 1080;
  const isTablet = width >= 700;
  const listingCardWidth = isDesktop ? "31.8%" : isTablet ? "48.8%" : "100%";

  const [loading, setLoading] = useState(true);
  const [seller, setSeller] = useState<Seller | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [storeStock, setStoreStock] = useState<StoreStock | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);

  const [followersCount, setFollowersCount] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);

  const [reviews, setReviews] = useState<Review[]>([]);
  const [avgRating, setAvgRating] = useState(0);
  const [reviewCount, setReviewCount] = useState(0);
  const [orderSignals, setOrderSignals] = useState<StoreOrderSignals>(EMPTY_ORDER_SIGNALS);
  const [myRating, setMyRating] = useState<number>(0);
  const [myComment, setMyComment] = useState("");
  const [reviewBusy, setReviewBusy] = useState(false);
  const [canReview, setCanReview] = useState(false);
  const [contentTab, setContentTab] = useState<"listings" | "social">("listings");

  useEffect(() => {
    let mounted = true;

    (async () => {
      console.log("[PublicSellerProfile] load start", { handle });
      setLoading(true);
      setErr(null);

      try {
        if (!handle) throw new Error("Missing username");

        // 1) Seller public profile (view)
        const { data: sp, error: spErr } = await supabase
          .from("market_seller_public_profiles")
          .select(
            "user_id,market_username,display_name,business_name,bio,location_text,is_verified,logo_path,banner_path,offers_remote,offers_in_person,payout_tier,active,social_links"
          )
          .eq("market_username", handle)
          .eq("active", true)
          .maybeSingle();

        if (spErr) throw new Error(spErr.message);
        if (!sp) {
          if (mounted) {
            setSeller(null);
            setListings([]);
          }
          return;
        }

        // 2) Active listings (RLS policy allows)
        const userCountry = await resolveUserCountry({ prompt: true });
        const restrictToCrypto = !isNigeriaCountry(userCountry?.code || userCountry?.name);

        const { data: ls, error: lsErr } = await supabase
          .from("market_listings")
          .select("id,title,price_amount,currency,payment_options,delivery_type,category,sub_category,created_at")
          .eq("seller_id", (sp as any).user_id)
          .eq("is_active", true)
          .order("created_at", { ascending: false })
          .limit(60);

        if (lsErr) throw new Error(lsErr.message);

        // 3) Cover images (view)
        let rows = ((ls as any) ?? []) as Listing[];
        if (restrictToCrypto) {
          rows = rows.filter((r) => listingAllowsCrypto(r));
        }
        const listingIds = rows.map((r) => r.id);

        const coverMap: Record<string, string | null> = {};
        if (listingIds.length) {
          const { data: imgs, error: imgErr } = await supabase
            .from("market_listing_images_public")
            .select("listing_id,storage_path,sort_order")
            .in("listing_id", listingIds)
            .order("sort_order", { ascending: true });

          if (imgErr) throw new Error(imgErr.message);

          (imgs ?? []).forEach((img: any) => {
            if (!coverMap[img.listing_id]) {
              coverMap[img.listing_id] = publicUrl(BUCKET_LISTINGS, img.storage_path) ?? null;
            }
          });
        }

        const rowsWithCovers = rows.map((r) => ({ ...r, cover_url: coverMap[r.id] ?? null }));

        if (mounted) {
          setSeller(sp as any);
          setListings(rowsWithCovers);
        }
      } catch (e: any) {
        if (mounted) {
          setErr(e?.message || "Failed to load seller");
          setSeller(null);
          setListings([]);
        }
      } finally {
        if (mounted) {
          setLoading(false);
          console.log("[PublicSellerProfile] load end");
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [handle]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      setMeId(data?.user?.id ?? null);
    })();
  }, []);

  async function loadFollowers() {
    if (!seller?.user_id) return;
    const { count } = await supabase
      .from("market_profile_follows")
      .select("id", { count: "exact", head: true })
      .eq("followed_id", seller.user_id);
    setFollowersCount(count ?? 0);

    if (meId) {
      const { data } = await supabase
        .from("market_profile_follows")
        .select("id")
        .eq("followed_id", seller.user_id)
        .eq("follower_id", meId)
        .maybeSingle();
      setIsFollowing(!!data?.id);
    } else {
      setIsFollowing(false);
    }
  }

  async function loadReviews() {
    if (!seller?.user_id) return;
    const { data, error } = await supabase
      .from("market_seller_reviews")
      .select("id,seller_id,reviewer_id,rating,comment,created_at")
      .eq("seller_id", seller.user_id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    const rows = (data as any as Review[]) ?? [];

    const reviewerIds = Array.from(new Set(rows.map((r) => r.reviewer_id).filter(Boolean)));
    let profileMap: Record<string, { username?: string | null; full_name?: string | null }> = {};
    if (reviewerIds.length) {
      const { data: profileRows, error: pErr } = await supabase
        .from("profiles")
        .select("id,username,full_name")
        .in("id", reviewerIds);
      if (pErr) throw new Error(pErr.message);
      profileMap = (profileRows ?? []).reduce((acc: any, p: any) => {
        acc[p.id] = { username: p.username ?? null, full_name: p.full_name ?? null };
        return acc;
      }, {});
    }

    const hydrated = rows.map((r) => ({ ...r, profiles: profileMap[r.reviewer_id] ?? null }));
    setReviews(hydrated);
    setReviewCount(rows.length);
    if (rows.length) {
      const avg = rows.reduce((a, b) => a + Number(b.rating || 0), 0) / rows.length;
      setAvgRating(Math.round(avg * 10) / 10);
    } else {
      setAvgRating(0);
    }
  }

  async function loadCanReview() {
    if (!seller?.user_id || !meId) {
      setCanReview(false);
      return;
    }
    if (meId === seller.user_id) {
      setCanReview(false);
      return;
    }
    const { data } = await supabase
      .from("market_orders")
      .select("id,status")
      .eq("buyer_id", meId)
      .eq("seller_id", seller.user_id)
      .in("status", ["DELIVERED", "RELEASED"])
      .limit(1);
    setCanReview(!!data?.length);
  }

  async function loadOrderSignals() {
    if (!seller?.user_id) {
      setOrderSignals(EMPTY_ORDER_SIGNALS);
      return;
    }

    const [totalRes, completedRes, cancelledRes, refundedRes] = await Promise.all([
      supabase.from("market_orders").select("id", { count: "exact", head: true }).eq("seller_id", seller.user_id),
      supabase
        .from("market_orders")
        .select("id", { count: "exact", head: true })
        .eq("seller_id", seller.user_id)
        .in("status", [...COMPLETED_ORDER_STATUSES]),
      supabase
        .from("market_orders")
        .select("id", { count: "exact", head: true })
        .eq("seller_id", seller.user_id)
        .in("status", [...CANCELLED_ORDER_STATUSES]),
      supabase
        .from("market_orders")
        .select("id", { count: "exact", head: true })
        .eq("seller_id", seller.user_id)
        .in("status", [...REFUNDED_ORDER_STATUSES]),
    ]);

    if (totalRes.error || completedRes.error || cancelledRes.error || refundedRes.error) {
      setOrderSignals(EMPTY_ORDER_SIGNALS);
      return;
    }

    const total = Number(totalRes.count ?? 0);
    const completed = Number(completedRes.count ?? 0);
    const cancelled = Number(cancelledRes.count ?? 0);
    const refunded = Number(refundedRes.count ?? 0);
    const resolved = completed + cancelled + refunded;
    const fulfillmentRate = resolved ? Math.round((completed / resolved) * 1000) / 10 : 0;

    setOrderSignals({
      total,
      completed,
      cancelled,
      refunded,
      fulfillmentRate,
    });
  }

  async function loadStoreStock(storeId: string) {
    const feed = await fetchStocksOverview(100, 0);
    const row = (feed.items ?? []).find((i) => String(i.store_id) === storeId);
    if (!row) {
      setStoreStock(null);
      return;
    }

    const status = String(row.status || "ACTIVE").toUpperCase();

    setStoreStock({
      id: String(row.identity_id),
      slug: String(row.slug),
      name: String(row.token_name),
      symbol: String(row.token_symbol),
      chain: String(row.chain),
      status: status === "PAUSED" || status === "BOOTSTRAP" ? status : "ACTIVE",
      price_usdc: Number(row.price || 0),
      market_cap_usdc: Number(row.market_cap || 0),
      volume_24h_usdc: Number(row.volume_24h_quote || 0),
      trades_24h: Number(row.trades_24h || 0),
    });
  }

  useEffect(() => {
    if (!seller?.user_id) {
      setOrderSignals(EMPTY_ORDER_SIGNALS);
      return;
    }
    loadFollowers();
    loadReviews();
    loadCanReview();
    loadOrderSignals();

    const ch = supabase
      .channel(`seller-social-${seller.user_id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "market_profile_follows", filter: `followed_id=eq.${seller.user_id}` }, () => {
        loadFollowers();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "market_seller_reviews", filter: `seller_id=eq.${seller.user_id}` }, () => {
        loadReviews();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "market_orders", filter: `seller_id=eq.${seller.user_id}` }, () => {
        loadOrderSignals();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [seller?.user_id, meId]);

  useEffect(() => {
    let mounted = true;
    if (!seller?.user_id) {
      setStoreStock(null);
      return;
    }
    (async () => {
      try {
        await loadStoreStock(seller.user_id);
      } catch {
        if (mounted) setStoreStock(null);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [seller?.user_id]);

  async function toggleFollow() {
    if (!meId) {
      setErr("Please sign in to follow stores.");
      return;
    }
    if (!seller?.user_id) return;
    if (meId === seller.user_id) return;
    try {
      if (isFollowing) {
        await supabase.from("market_profile_follows").delete().eq("follower_id", meId).eq("followed_id", seller.user_id);
      } else {
        await supabase.from("market_profile_follows").insert({ follower_id: meId, followed_id: seller.user_id });
      }
      await loadFollowers();
    } catch (e: any) {
      setErr(e?.message || "Could not update follow");
    }
  }

  async function submitReview() {
    if (!seller?.user_id || !meId) return;
    if (meId === seller.user_id) return;
    if (!canReview) {
      setErr("Only buyers who completed an order can review this store.");
      return;
    }
    if (myRating < 1) {
      setErr("Select a star rating.");
      return;
    }
    setReviewBusy(true);
    setErr(null);
    try {
      const { error } = await supabase
        .from("market_seller_reviews")
        .upsert(
          {
            seller_id: seller.user_id,
            reviewer_id: meId,
            rating: myRating,
            comment: myComment.trim() || null,
          },
          { onConflict: "seller_id,reviewer_id" }
        );
      if (error) throw new Error(error.message);
      setMyComment("");
      setMyRating(0);
      await loadReviews();
    } catch (e: any) {
      setErr(e?.message || "Could not submit review");
    } finally {
      setReviewBusy(false);
    }
  }

  const bannerUrl = useMemo(() => publicUrl(BUCKET_SELLERS, seller?.banner_path ?? null), [seller?.banner_path]);
  const logoUrl = useMemo(() => publicUrl(BUCKET_SELLERS, seller?.logo_path ?? null), [seller?.logo_path]);
  const socialItems = useMemo(() => {
    const links = (seller?.social_links ?? {}) as SocialLinks;
    return SOCIALS.map((s) => {
      const item = (links as any)[s.key] ?? {};
      const enabled = !!item.enabled;
      const handle = String(item.handle ?? "").trim();
      const url = enabled ? buildSocialUrl(s.key, handle) : null;
      return { ...s, enabled, handle, url };
    }).filter((s) => !!s.url);
  }, [seller?.social_links]);
  const storeName = seller?.business_name || seller?.display_name || "Store";
  const ratingLabel = reviewCount ? `${avgRating}★` : "New";
  const resolvedOrders = orderSignals.completed + orderSignals.cancelled + orderSignals.refunded;
  const fulfillmentLabel = resolvedOrders ? `${orderSignals.fulfillmentRate.toFixed(1)}%` : "New";
  const trustSummary = resolvedOrders
    ? `This store has completed ${orderSignals.completed} of ${resolvedOrders} publicly resolved orders. Cancelled: ${orderSignals.cancelled}. Refunded: ${orderSignals.refunded}.`
    : "No resolved orders yet. Buyers can still use reviews, verification, and live listings to judge this store.";

  if (loading) {
    return (
      <LinearGradient colors={[BG1, BG0]} start={{ x: 0.1, y: 0 }} end={{ x: 0.92, y: 1 }} style={{ flex: 1 }}>
        <View style={{ paddingTop: insets.top + 18, paddingHorizontal: 16 }}>
          <View style={{ maxWidth: 1280, width: "100%", alignSelf: "center" }}>
            <View
              style={{
                alignSelf: "flex-start",
                borderRadius: 999,
                paddingHorizontal: 10,
                paddingVertical: 5,
                backgroundColor: "rgba(245,158,11,0.14)",
                borderWidth: 1,
                borderColor: "rgba(245,158,11,0.26)",
              }}
            >
              <Text style={{ color: ACCENT, fontSize: 11, fontWeight: "900", letterSpacing: 0.5, textTransform: "uppercase" }}>
                Public Store
              </Text>
            </View>
            <Text style={{ marginTop: 12, color: TEXT, fontSize: 30, fontWeight: "900" }}>Storefront profile</Text>
            <Text style={{ marginTop: 6, color: MUTED, fontSize: 13, lineHeight: 20 }}>
              Loading the public-facing storefront, seller trust signals, and live catalog.
            </Text>

            <View
              style={{
                marginTop: 22,
                borderRadius: 32,
                padding: 28,
                alignItems: "center",
                backgroundColor: PANEL,
                borderWidth: 1,
                borderColor: BORDER,
              }}
            >
              <ActivityIndicator color={ACCENT} />
              <Text style={{ marginTop: 14, color: TEXT, fontWeight: "900", fontSize: 18 }}>Loading store profile</Text>
              <Text style={{ marginTop: 6, color: MUTED, fontSize: 13, textAlign: "center", lineHeight: 20 }}>
                Fetching seller details, followers, ratings, and active listings.
              </Text>
            </View>
          </View>
        </View>
      </LinearGradient>
    );
  }

  if (err) {
    return (
      <LinearGradient colors={[BG1, BG0]} start={{ x: 0.1, y: 0 }} end={{ x: 0.92, y: 1 }} style={{ flex: 1 }}>
        <View style={{ paddingTop: insets.top + 18, paddingHorizontal: 16 }}>
          <View style={{ maxWidth: 1280, width: "100%", alignSelf: "center" }}>
            <SurfaceSection title="Could not load store" subtitle={err}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                <ActionButton icon="arrow-back" label="Go back" accent={ACCENT} onPress={() => router.back()} />
                <ActionButton icon="storefront-outline" label="Open market" accent={ACCENT_2} onPress={() => router.push("/market/(tabs)" as any)} />
              </View>
            </SurfaceSection>
          </View>
        </View>
      </LinearGradient>
    );
  }

  if (!seller) {
    return (
      <LinearGradient colors={[BG1, BG0]} start={{ x: 0.1, y: 0 }} end={{ x: 0.92, y: 1 }} style={{ flex: 1 }}>
        <View style={{ paddingTop: insets.top + 18, paddingHorizontal: 16 }}>
          <View style={{ maxWidth: 1280, width: "100%", alignSelf: "center" }}>
            <SurfaceSection title="Store not found" subtitle={`No active public storefront was found for @${handle}.`}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                <ActionButton icon="storefront-outline" label="Back to Market" accent={ACCENT} onPress={() => router.push("/market/(tabs)" as any)} />
                <ActionButton icon="arrow-back" label="Go back" accent={ACCENT_2} onPress={() => router.back()} />
              </View>
            </SurfaceSection>
          </View>
        </View>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient colors={[BG1, BG0]} start={{ x: 0.1, y: 0 }} end={{ x: 0.92, y: 1 }} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 18, paddingHorizontal: 16, paddingBottom: 168 }}>
        <View style={{ maxWidth: 1280, width: "100%", alignSelf: "center" }}>
          <View style={{ flexDirection: isDesktop ? "row" : "column", alignItems: isDesktop ? "center" : "flex-start", justifyContent: "space-between", gap: 14 }}>
            <View style={{ flex: 1 }}>
              <View style={{ alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: "rgba(245,158,11,0.14)", borderWidth: 1, borderColor: "rgba(245,158,11,0.26)" }}>
                <Text style={{ color: ACCENT, fontSize: 11, fontWeight: "900", letterSpacing: 0.5, textTransform: "uppercase" }}>Public Store</Text>
              </View>
              <Text style={{ marginTop: 12, color: TEXT, fontSize: 30, fontWeight: "900" }}>Storefront profile</Text>
              <Text style={{ marginTop: 6, color: MUTED, fontSize: 13, lineHeight: 20 }}>Browse store details, seller trust signals, reviews, and active listings.</Text>
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              <ActionButton icon="arrow-back" label="Go back" accent={ACCENT} onPress={() => router.back()} />
              <ActionButton icon="storefront-outline" label="Open market" accent={ACCENT_2} onPress={() => router.push("/market/(tabs)" as any)} />
            </View>
          </View>

          <View style={{ marginTop: 20, borderRadius: 34, overflow: "hidden", borderWidth: 1, borderColor: BORDER, backgroundColor: PANEL }}>
            <View style={{ height: isDesktop ? 240 : 196, backgroundColor: "#1A120C" }}>
              {bannerUrl ? <Image source={{ uri: bannerUrl }} style={{ width: "100%", height: "100%" }} /> : <LinearGradient colors={["#5B3A11", "#1A120D"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: "100%", height: "100%" }} />}
              <LinearGradient colors={["rgba(0,0,0,0.06)", "rgba(11,9,7,0.88)"]} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }} />
              <View style={{ position: "absolute", top: 18, left: 18, right: 18, flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                <StoreTag icon="shield-checkmark-outline" label={seller.is_verified ? "Verified seller" : "Public seller"} tone={seller.is_verified ? SUCCESS : ACCENT} />
                <StoreTag icon="wallet-outline" label={seller.payout_tier === "fast" ? "Fast payouts" : "Standard payouts"} tone={ACCENT_2} />
                {storeStock ? <StoreTag icon="trending-up-outline" label={`${storeStock.symbol} live`} tone="#2DD4BF" /> : null}
              </View>
            </View>

            <View style={{ padding: 22, marginTop: -44 }}>
              <View style={{ flexDirection: isDesktop ? "row" : "column", gap: 16, alignItems: isDesktop ? "flex-end" : "flex-start" }}>
                <View style={{ width: 92, height: 92, borderRadius: 28, overflow: "hidden", borderWidth: 2, borderColor: "rgba(255,247,237,0.22)", backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" }}>
                  {logoUrl ? <Image source={{ uri: logoUrl }} style={{ width: 92, height: 92 }} /> : <Ionicons name="person-outline" size={30} color={TEXT} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: TEXT, fontWeight: "900", fontSize: 28 }}>{storeName}</Text>
                  <View style={{ marginTop: 8, flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <Text style={{ color: MUTED, fontWeight: "800", fontSize: 13 }}>@{seller.market_username}</Text>
                    {seller.is_verified ? <Ionicons name="checkmark-circle" size={16} color={SUCCESS} /> : null}
                    {!!seller.location_text ? <Text style={{ color: MUTED, fontSize: 12 }}>• {seller.location_text}</Text> : null}
                  </View>
                  <View style={{ marginTop: 18, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                    <MetricCard value={String(followersCount)} label="Followers" />
                    <MetricCard value={ratingLabel} label={`${reviewCount} reviews`} />
                    <MetricCard value={String(listings.length)} label="Live listings" />
                    <MetricCard value={String(orderSignals.completed)} label="Completed orders" />
                    <MetricCard value={String(orderSignals.cancelled)} label="Cancelled orders" />
                  </View>
                </View>
              </View>

              <View style={{ marginTop: 18, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                <ActionButton icon={isFollowing ? "remove-circle-outline" : "add-circle-outline"} label={isFollowing ? "Unfollow" : "Follow"} accent={isFollowing ? "#F87171" : ACCENT} onPress={toggleFollow} />
                <ActionButton icon="chatbubble-ellipses-outline" label="Message" accent={ACCENT_2} onPress={() => router.push({ pathname: "/market/dm/[username]" as any, params: { username: seller.market_username } })} />
                {storeStock ? <ActionButton icon="trending-up-outline" label="Open stock" accent="#2DD4BF" onPress={() => router.push(`/market/stock/${storeStock.slug}` as any)} /> : null}
              </View>
            </View>
          </View>

          <SurfaceSection style={{ marginTop: 16 }} title="Store overview" subtitle="Brand story, service modes, and key store details." >
            <Text style={{ color: MUTED, lineHeight: 22 }}>{seller.bio || "No store bio has been published yet."}</Text>
            <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              {seller.offers_remote ? <StoreTag icon="laptop-outline" label="Remote service" tone={ACCENT} /> : null}
              {seller.offers_in_person ? <StoreTag icon="walk-outline" label="In-person service" tone={ACCENT_2} /> : null}
              <StoreTag icon="shield-checkmark-outline" label={`Payout: ${seller.payout_tier}`} tone="#FBBF24" />
            </View>
            {socialItems.length ? <View style={{ marginTop: 16, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>{socialItems.map((s) => <Pressable key={s.key} onPress={() => s.url && Linking.openURL(s.url)} style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: PANEL_ALT, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" }}><MaterialCommunityIcons name={s.icon as any} size={18} color={TEXT} /></Pressable>)}</View> : null}
            {storeStock ? <Pressable onPress={() => router.push(`/market/stock/${storeStock.slug}` as any)} style={{ marginTop: 16, borderRadius: 22, padding: 16, borderWidth: 1, borderColor: "rgba(45,212,191,0.30)", backgroundColor: "rgba(45,212,191,0.10)" }}><View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}><View style={{ flex: 1 }}><Text style={{ color: "#ECFEFF", fontWeight: "900", fontSize: 15 }}>{storeStock.name} ({storeStock.symbol})</Text><Text style={{ marginTop: 4, color: "rgba(236,254,255,0.78)", fontSize: 11 }}>{String(storeStock.chain).toUpperCase().replace("_", " ")} • {storeStock.status}</Text></View><Ionicons name="trending-up-outline" size={20} color="#99F6E4" /></View><View style={{ marginTop: 10, flexDirection: "row", flexWrap: "wrap", gap: 12 }}><Text style={{ color: TEXT, fontSize: 12, fontWeight: "800" }}>Price ${storeStock.price_usdc.toFixed(6)}</Text><Text style={{ color: MUTED, fontSize: 12, fontWeight: "800" }}>MCap ${storeStock.market_cap_usdc.toFixed(2)}</Text><Text style={{ color: MUTED, fontSize: 12, fontWeight: "800" }}>24h ${storeStock.volume_24h_usdc.toFixed(2)}</Text><Text style={{ color: MUTED, fontSize: 12, fontWeight: "800" }}>Trades {storeStock.trades_24h}</Text></View></Pressable> : null}
          </SurfaceSection>

          <SurfaceSection
            style={{ marginTop: 16 }}
            title="Trust and fulfillment"
            subtitle="Public order outcomes help buyers judge seller reliability before starting checkout."
          >
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
              <SignalCard icon="checkmark-circle-outline" value={String(orderSignals.completed)} label="Completed orders" hint="Closed successfully" tone={SUCCESS} />
              <SignalCard icon="close-circle-outline" value={String(orderSignals.cancelled)} label="Cancelled orders" hint="Cancelled before completion" tone="#F97316" />
              <SignalCard icon="refresh-circle-outline" value={String(orderSignals.refunded)} label="Refunded orders" hint="Closed with buyer recovery" tone="#F87171" />
              <SignalCard icon="pulse-outline" value={fulfillmentLabel} label="Fulfillment rate" hint={resolvedOrders ? `${resolvedOrders} resolved orders tracked publicly` : "Awaiting first resolved order"} tone="#FBBF24" />
            </View>

            <View
              style={{
                marginTop: 16,
                borderRadius: 22,
                padding: 16,
                backgroundColor: PANEL_ALT,
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.06)",
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <Text style={{ color: TEXT, fontWeight: "900", fontSize: 15 }}>Buyer safety snapshot</Text>
                <Text style={{ color: MUTED, fontWeight: "800", fontSize: 12 }}>{orderSignals.total} total orders</Text>
              </View>
              <View style={{ marginTop: 12, height: 10, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                <View
                  style={{
                    width: resolvedOrders ? `${Math.max(6, Math.min(100, orderSignals.fulfillmentRate))}%` : "0%",
                    height: "100%",
                    borderRadius: 999,
                    backgroundColor: SUCCESS,
                  }}
                />
              </View>
              <Text style={{ marginTop: 12, color: MUTED, fontSize: 12, lineHeight: 20 }}>{trustSummary}</Text>
              <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                <StoreTag icon="shield-checkmark-outline" label={seller.is_verified ? "Verified identity" : "Identity not verified"} tone={seller.is_verified ? SUCCESS : "#FBBF24"} />
                <StoreTag icon="document-text-outline" label={`${reviewCount} buyer reviews`} tone={ACCENT} />
                <StoreTag icon="people-outline" label={`${followersCount} followers`} tone={ACCENT_2} />
              </View>
            </View>
          </SurfaceSection>

          <SurfaceSection style={{ marginTop: 16 }} title="Buyer reviews" subtitle={reviewCount ? `${reviewCount} reviews • ${avgRating}★ average` : "No reviews yet"}>
            {canReview ? (
              <View style={{ borderRadius: 20, padding: 14, backgroundColor: PANEL_ALT, borderWidth: 1, borderColor: "rgba(255,255,255,0.06)" }}>
                <View style={{ flexDirection: "row", gap: 6 }}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Pressable key={n} onPress={() => setMyRating(n)} style={{ padding: 6 }}>
                      <Ionicons name={myRating >= n ? "star" : "star-outline"} size={20} color="#FBBF24" />
                    </Pressable>
                  ))}
                </View>
                <TextInput value={myComment} onChangeText={setMyComment} placeholder="Write a short review (optional)" placeholderTextColor="rgba(255,247,237,0.35)" style={{ marginTop: 10, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 11, color: TEXT, backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" }} />
                <Pressable onPress={submitReview} disabled={reviewBusy} style={{ marginTop: 10, borderRadius: 16, paddingVertical: 12, alignItems: "center", backgroundColor: "rgba(245,158,11,0.18)", borderWidth: 1, borderColor: "rgba(245,158,11,0.30)", opacity: reviewBusy ? 0.7 : 1 }}>
                  <Text style={{ color: TEXT, fontWeight: "900" }}>{reviewBusy ? "Submitting…" : "Submit review"}</Text>
                </Pressable>
              </View>
            ) : (
              <Text style={{ color: MUTED }}>Only buyers who completed an order can review this store.</Text>
            )}

            <View style={{ marginTop: 14, gap: 10 }}>
              {reviews.length === 0 ? (
                <View style={{ borderRadius: 18, padding: 14, backgroundColor: PANEL_ALT, borderWidth: 1, borderColor: "rgba(255,255,255,0.06)" }}>
                  <Text style={{ color: MUTED }}>No reviews yet.</Text>
                </View>
              ) : (
                reviews.map((review) => <ReviewCard key={review.id} review={review} />)
              )}
            </View>
          </SurfaceSection>

          <SurfaceSection style={{ marginTop: 16 }} title={contentTab === "social" ? "Social feed" : "Storefront listings"} subtitle={contentTab === "social" ? "Public posts from this seller stay in the same premium storefront layout." : "Live products and services published by this seller."}>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <SegmentButton label="Listings" active={contentTab === "listings"} onPress={() => setContentTab("listings")} />
              <SegmentButton label="Social Feed" active={contentTab === "social"} onPress={() => setContentTab("social")} />
            </View>

            {contentTab === "social" ? (
              <View style={{ marginTop: 14 }}>
                <SocialFeed profileUserId={seller.user_id} hideComposer={meId !== seller.user_id} />
              </View>
            ) : (
              <View style={{ marginTop: 14 }}>
                <View style={{ flexDirection: isTablet ? "row" : "column", alignItems: isTablet ? "center" : "flex-start", justifyContent: "space-between", gap: 10 }}>
                  <Text style={{ color: TEXT, fontWeight: "900", fontSize: 15 }}>{listings.length} live {listings.length === 1 ? "listing" : "listings"}</Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14 }}>
                    <Pressable onPress={() => router.push(`/market/listings?seller_id=${seller.user_id}` as any)}>
                      <Text style={{ color: "#FCD34D", fontWeight: "900" }}>See all</Text>
                    </Pressable>
                    <Pressable onPress={() => router.push("/market/(tabs)" as any)}>
                      <Text style={{ color: "#FCD34D", fontWeight: "900" }}>Back to Market</Text>
                    </Pressable>
                  </View>
                </View>

                {listings.length === 0 ? (
                  <View style={{ marginTop: 14, borderRadius: 22, padding: 16, backgroundColor: PANEL_ALT, borderWidth: 1, borderColor: "rgba(255,255,255,0.06)" }}>
                    <Text style={{ color: TEXT, fontWeight: "900" }}>No listings yet</Text>
                    <Text style={{ marginTop: 6, color: MUTED }}>This seller has not published anything yet.</Text>
                  </View>
                ) : (
                  <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                    {listings.map((listing) => (
                      <ListingCard key={listing.id} listing={listing} width={listingCardWidth} />
                    ))}
                  </View>
                )}
              </View>
            )}
          </SurfaceSection>
        </View>
      </ScrollView>
    </LinearGradient>
  );
}

