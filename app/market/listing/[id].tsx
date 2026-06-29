import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import AppHeader from "@/components/common/AppHeader";
import ListingOriginBadge from "@/components/market/ListingOriginBadge";
import MarketMediaView from "@/components/market/MarketMediaView";
import { InAppTutorial, TutorialTarget } from "@/components/onboarding/InAppTutorial";
import { callFn } from "@/services/functions";
import { tutorialFlows } from "@/services/onboarding/definitions";
import { supabase } from "@/services/supabase";
import {
  DeliveryGeo,
  formatAvailabilitySummary,
  getCurrentLocationWithGeocode,
  toDeliveryGeo,
} from "@/utils/location";
import {
  buildMarketMediaUrl,
  resolveMarketMediaKind,
  type MarketMediaKind,
  sortMarketMedia,
} from "@/utils/marketMedia";
import { friendlyMarketError } from "@/utils/marketUx";
import { OrderPreviewModal, PreviewPayload, MultiPreviewPayload } from "@/components/market/OrderPreviewModal";
import { formatCurrency, getListingPriceDisplay } from "@/utils/pricing";
import { resolveUserCountry, type UserCountry } from "@/utils/country";

// ─── Brand Color Tokens ────────────────────────────────────────────────────────
const BG0 = "#060807";
const BG1 = "#10130E";
const BG2 = "#171A13";
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
const BRAND = AMBER;

const AMBER_GLASS = "rgba(244,183,93,0.13)";
const AMBER_BORDER = "rgba(244,183,93,0.42)";
const TEAL_GLASS = "rgba(45,212,191,0.12)";
const TEAL_BORDER = "rgba(45,212,191,0.35)";
const GREEN_GLASS = "rgba(16,185,129,0.15)";
const GREEN_BORDER = "rgba(16,185,129,0.45)";
const RED_GLASS = "rgba(239,68,68,0.15)";
const RED_BORDER = "rgba(239,68,68,0.45)";

// ─── Table / Bucket Constants (unchanged) ─────────────────────────────────────
const LISTINGS_TABLE = "market_listings";
const IMAGES_TABLE = "market_listing_images";
const PREVIEWS_TABLE = "market_listing_previews";
const SELLERS_TABLE = "market_seller_profiles";
const LISTING_IMAGES_BUCKET = "market-listings";
const FN_CREATE_ORDER = "market-create-order";

// ─── Types (unchanged) ────────────────────────────────────────────────────────
type ListingImage = {
  id: string;
  public_url: string | null;
  storage_path: string;
  sort_order: number | null;
  meta?: any;
};

type Listing = {
  id: string;
  seller_id: string;
  title: string | null;
  description: string | null;
  price_amount: number | string | null;
  currency: string | null;
  delivery_type: string | null;
  category: string | null;
  sub_category: string | null;
  stock_qty: number | null;
  created_at?: string | null;
  availability?: any;
  payment_options?: any;
  website_url?: string | null;
};

type ListingComment = {
  id: string;
  body: string;
  created_at: string;
  user_id: string;
  profiles?: { username?: string | null; full_name?: string | null } | null;
};

type ListingReview = {
  id: string;
  listing_id: string;
  order_id: string;
  reviewer_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  profiles?: { username?: string | null; full_name?: string | null } | null;
};

type ListingPreview = {
  id: string;
  listing_id: string;
  kind: string;
  title: string | null;
  sort_order: number | null;
  storage_path: string | null;
  public_url: string | null;
  link_url: string | null;
  mime_type: string | null;
  duration_sec: number | null;
};

type Seller = {
  user_id: string;
  market_username: string | null;
  display_name: string | null;
  business_name: string | null;
  bio: string | null;
  logo_path: string | null;
  banner_path: string | null;
  is_verified: boolean | null;
};

// ─── Helper Functions (unchanged logic) ───────────────────────────────────────
function previewKind(k: string): "image" | "audio" | "video" | "file" | "link" {
  const v = String(k || "").toLowerCase();
  if (v === "image" || v === "audio" || v === "video" || v === "file" || v === "link")
    return v as any;
  return "file";
}

function previewIcon(kind: string) {
  const k = previewKind(kind);
  if (k === "image") return "image-outline";
  if (k === "video") return "videocam-outline";
  if (k === "audio") return "musical-notes-outline";
  if (k === "link") return "globe-outline";
  return "document-attach-outline";
}

function formatRating(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0.0";
  return value.toFixed(value % 1 === 0 ? 0 : 1);
}

function parseJsonObject(value: unknown) {
  if (!value) return null;
  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }
  return typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function getStableRouteFlags(paymentOptions: unknown, listingCurrency: unknown) {
  const options = parseJsonObject(paymentOptions) ?? {};
  const currency = String(listingCurrency ?? "").toUpperCase();
  const hasEnabledStableRoute =
    options.allow_usdc === true || options.allow_usdt === true;
  return {
    allowUsdc:
      options.allow_usdc === true ||
      (!hasEnabledStableRoute && currency === "USDC"),
    allowUsdt:
      options.allow_usdt === true ||
      (!hasEnabledStableRoute && currency === "USDT"),
  };
}

async function safeLoadListing(listingId: string) {
  const attempt1 = await supabase
    .from(LISTINGS_TABLE)
    .select(
      "id,seller_id,title,description,price_amount,currency,delivery_type,category,sub_category,stock_qty,created_at,availability,payment_options,website_url"
    )
    .eq("id", listingId)
    .maybeSingle();

  if (!attempt1.error) return attempt1.data as any;

  const msg = String(attempt1.error.message || "").toLowerCase();
  if (msg.includes("website_url") && msg.includes("does not exist")) {
    const attempt2 = await supabase
      .from(LISTINGS_TABLE)
      .select(
        "id,seller_id,title,description,price_amount,currency,delivery_type,category,sub_category,stock_qty,created_at,availability,payment_options"
      )
      .eq("id", listingId)
      .maybeSingle();
    if (attempt2.error) throw new Error(attempt2.error.message);
    return attempt2.data as any;
  }

  throw new Error(attempt1.error.message);
}

// ─── Small Reusable UI Components ─────────────────────────────────────────────

function RatingStars({
  value,
  size = 15,
  muted = false,
}: {
  value: number;
  size?: number;
  muted?: boolean;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Ionicons
          key={star}
          name={value >= star - 0.25 ? "star" : "star-outline"}
          size={size}
          color={muted ? FAINT : AMBER}
        />
      ))}
    </View>
  );
}

function SectionLabel({ text }: { text: string }) {
  return (
    <View style={styles.sectionLabelRow}>
      <View style={styles.sectionLabelBar} />
      <Text style={styles.sectionLabelText}>{text.toUpperCase()}</Text>
    </View>
  );
}

function Pill({ label }: { label: string }) {
  return (
    <View style={styles.pill}>
      <Text style={styles.pillText}>{label}</Text>
    </View>
  );
}

function ListingReviewCard({ review }: { review: ListingReview }) {
  return (
    <View style={styles.reviewCard}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={styles.reviewAvatar}>
            <Ionicons name="person-outline" size={13} color={FAINT} />
          </View>
          <Text style={{ color: TEXT, fontWeight: "800", fontSize: 13 }}>
            @{review.profiles?.username || "buyer"}
          </Text>
        </View>
        <Text style={{ color: FAINT, fontSize: 11, fontWeight: "600" }}>
          {new Date(review.created_at).toLocaleDateString()}
        </Text>
      </View>
      <View
        style={{
          marginTop: 8,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
        }}
      >
        <RatingStars value={Number(review.rating || 0)} size={13} />
        <Text style={{ color: AMBER, fontWeight: "900", fontSize: 12 }}>
          {Number(review.rating || 0).toFixed(1)}
        </Text>
      </View>
      {review.comment ? (
        <Text style={{ marginTop: 8, color: MUTED, lineHeight: 19, fontSize: 13 }}>
          {review.comment}
        </Text>
      ) : null}
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function ListingDetails() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { id } = useLocalSearchParams<{ id: string }>();

  const listingId = useMemo(() => String(id || ""), [id]);

  // Responsive breakpoints
  const isTablet = width >= 640;
  const isDesktop = width >= 1024;
  const contentMaxWidth = 1120;
  const sidePadding = isDesktop ? 40 : isTablet ? 24 : 16;

  // Media card sizing
  const mediaCardWidth = isDesktop
    ? Math.min(480, (width - 80) / 2.5)
    : isTablet
    ? Math.min(380, width * 0.55)
    : Math.min(320, width - 52);
  const mediaCardHeight = isDesktop ? 300 : isTablet ? 260 : 210;

  // ─── State (all unchanged) ───────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [listing, setListing] = useState<Listing | null>(null);
  const [images, setImages] = useState<ListingImage[]>([]);
  const [seller, setSeller] = useState<Seller | null>(null);
  const [listingPreviews, setListingPreviews] = useState<ListingPreview[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [deliveryGeo, setDeliveryGeo] = useState<DeliveryGeo | null>(null);
  const [deliveryLabel, setDeliveryLabel] = useState("");
  const [locatingDelivery, setLocatingDelivery] = useState(false);
  const [buyBusy, setBuyBusy] = useState(false);
  const [orderQtyInput, setOrderQtyInput] = useState("1");
  const [meId, setMeId] = useState<string | null>(null);
  const [likes, setLikes] = useState(0);
  const [dislikes, setDislikes] = useState(0);
  const [myReaction, setMyReaction] = useState<"like" | "dislike" | null>(null);
  const [comments, setComments] = useState<ListingComment[]>([]);
  const [commentCount, setCommentCount] = useState(0);
  const [commentInput, setCommentInput] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  const [showAllComments, setShowAllComments] = useState(false);
  const [listingReviews, setListingReviews] = useState<ListingReview[]>([]);
  const [listingAvgRating, setListingAvgRating] = useState(0);
  const [listingReviewCount, setListingReviewCount] = useState(0);
  const [canReviewListing, setCanReviewListing] = useState(false);
  const [reviewOrderId, setReviewOrderId] = useState<string | null>(null);
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewBusy, setReviewBusy] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewPayload, setPreviewPayload] = useState<PreviewPayload | MultiPreviewPayload | null>(null);
  const [userCountry, setUserCountry] = useState<UserCountry | undefined>(undefined);

  const supabaseUrl =
    (supabase as any)?.supabaseUrl ??
    (process.env.EXPO_PUBLIC_SUPABASE_URL as string) ??
    "";

  // ─── Effects (all unchanged) ─────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      setMeId(data?.user?.id ?? null);
    })();
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const c = await resolveUserCountry({ prompt: true });
        if (mounted) setUserCountry(c);
      } catch {
        if (mounted) setUserCountry(null);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    (async () => {
      setLoading(true);
      setErr(null);

      try {
        if (!listingId) {
          setErr("Missing listing id");
          return;
        }

        const l = await safeLoadListing(listingId);
        if (!l) {
          setErr("Listing not found");
          return;
        }

        const { data: imgs, error: iErr } = await supabase
          .from(IMAGES_TABLE)
          .select("id,public_url,storage_path,sort_order,meta")
          .eq("listing_id", listingId)
          .order("sort_order", { ascending: true });

        if (iErr) throw new Error(iErr.message);

        const { data: s, error: sErr } = await supabase
          .from(SELLERS_TABLE)
          .select(
            "user_id,market_username,display_name,business_name,bio,logo_path,banner_path,is_verified"
          )
          .eq("user_id", (l as any).seller_id)
          .maybeSingle();

        if (sErr) throw new Error(sErr.message);

        const { data: pv, error: pErr } = await supabase
          .from(PREVIEWS_TABLE)
          .select(
            "id,listing_id,kind,title,sort_order,storage_path,public_url,link_url,mime_type,duration_sec"
          )
          .eq("listing_id", listingId)
          .order("sort_order", { ascending: true });

        if (pErr) throw new Error(pErr.message);

        if (mounted) {
          setListing(l as any);
          setImages((imgs as any) ?? []);
          setSeller((s as any) ?? null);
          setListingPreviews((pv as any) ?? []);
        }
      } catch (e: any) {
        if (mounted) {
          setErr(friendlyMarketError(e, "We couldn't load this listing."));
          setListing(null);
          setImages([]);
          setSeller(null);
          setListingPreviews([]);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [listingId]);

  useEffect(() => {
    const stockQty = Number((listing as any)?.stock_qty);
    const hasStockCap =
      String((listing as any)?.category || "").toLowerCase() === "product" &&
      Number.isFinite(stockQty) &&
      stockQty > 0;
    const maxQty = hasStockCap ? Math.max(1, Math.floor(stockQty)) : 1;

    setOrderQtyInput((prev) => {
      const parsed = Number.parseInt(String(prev || "").trim(), 10);
      const safe = Number.isFinite(parsed)
        ? Math.max(1, Math.min(maxQty, parsed))
        : 1;
      return String(safe);
    });
  }, [listing?.id, listing?.category, listing?.stock_qty]);

// ─── Preview Handlers ───────────────────────────────────────────────────────────

function openListingPreview(item: ListingPreview, index: number = 0, allItems: ListingPreview[] = []) {
  const kind = previewKind(item.kind);
  
  const buildPayload = (i: ListingPreview): PreviewPayload => {
    if (kind === "link") {
      const url = String(i.link_url || i.public_url || "");
      if (!url) return null as any;
      return {
        kind: "link",
        access: "preview",
        title: i.title || "Website preview",
        url,
      };
    }

    const direct = i.public_url
      ? String(i.public_url)
      : i.storage_path
      ? `${supabaseUrl}/storage/v1/object/public/${LISTING_IMAGES_BUCKET}/${i.storage_path}`
      : "";

    const seconds = typeof i.duration_sec === "number" ? i.duration_sec : 20;
    return {
      kind: kind as "image" | "audio" | "video" | "file",
      access: "preview",
      title: i.title || `${kind.toUpperCase()} preview`,
      previewSeconds: seconds,
      mimeType: i.mime_type || undefined,
      urlPromise: async () => direct || null,
    } as PreviewPayload;
  };

  const payloadOrLink = buildPayload(item);
  if (!payloadOrLink) return setErr("Preview is unavailable.");

  // If multiple previews exist, open multi-preview modal
  if (allItems.length > 1 && kind !== "link") {
    const payloads = allItems.map(buildPayload).filter(Boolean) as PreviewPayload[];
    if (payloads.length > 0) {
      setPreviewPayload({ items: payloads, startIndex: index });
      setPreviewOpen(true);
      return;
    }
  }

  setPreviewPayload(payloadOrLink);
  setPreviewOpen(true);
}

function openListingMediaPreview(
  url: string,
  kind: MarketMediaKind,
  index: number
) {
  if (!url) return;
  setPreviewPayload({
    kind,
    access: "final",
    title: `${listing?.title || "Listing"} - ${kind} ${index + 1}`,
    urlPromise: async () => url,
  });
  setPreviewOpen(true);
}

function openWebsitePreview(url: string) {
  const cleanUrl = String(url || "").trim();
  if (!cleanUrl) return;
  setPreviewPayload({
    kind: "link",
    access: "preview",
    title: "Website preview",
    url: cleanUrl,
  });
  setPreviewOpen(true);
}

  // ─── Data Loaders (unchanged) ─────────────────────────────────────────────────

  async function loadReactions() {
    if (!listingId) return;
    const { count: likeCount } = await supabase
      .from("market_listing_reactions")
      .select("id", { count: "exact", head: true })
      .eq("listing_id", listingId)
      .eq("reaction", "like");
    const { count: dislikeCount } = await supabase
      .from("market_listing_reactions")
      .select("id", { count: "exact", head: true })
      .eq("listing_id", listingId)
      .eq("reaction", "dislike");
    setLikes(likeCount ?? 0);
    setDislikes(dislikeCount ?? 0);

    if (meId) {
      const { data: mine } = await supabase
        .from("market_listing_reactions")
        .select("reaction")
        .eq("listing_id", listingId)
        .eq("user_id", meId)
        .maybeSingle();
      setMyReaction((mine as any)?.reaction ?? null);
    } else {
      setMyReaction(null);
    }
  }

  async function loadComments() {
    if (!listingId) return;
    const { data, count } = await supabase
      .from("market_listing_comments")
      .select("id,body,created_at,user_id,profiles(username,full_name)", {
        count: "exact",
      })
      .eq("listing_id", listingId)
      .order("created_at", { ascending: false })
      .limit(50);
    setComments((data as any) ?? []);
    setCommentCount(count ?? 0);
  }

  async function loadListingReviews() {
    if (!listingId) return;

    try {
      const { data, count, error } = await supabase
        .from("market_listing_reviews")
        .select(
          "id,listing_id,order_id,reviewer_id,rating,comment,created_at",
          { count: "exact" }
        )
        .eq("listing_id", listingId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;

      const rows = ((data ?? []) as any[]).map((row) => ({
        ...row,
        rating: Number(row.rating ?? 0),
      })) as ListingReview[];

      const reviewerIds = Array.from(
        new Set(rows.map((row) => row.reviewer_id).filter(Boolean))
      );
      let profileMap: Record<
        string,
        { username?: string | null; full_name?: string | null }
      > = {};

      if (reviewerIds.length) {
        const { data: profileRows, error: profileError } = await supabase
          .from("profiles")
          .select("id,username,full_name")
          .in("id", reviewerIds);
        if (profileError) throw profileError;
        profileMap = (profileRows ?? []).reduce(
          (
            acc: Record<
              string,
              { username?: string | null; full_name?: string | null }
            >,
            profile: any
          ) => {
            acc[String(profile.id)] = {
              username: profile.username ?? null,
              full_name: profile.full_name ?? null,
            };
            return acc;
          },
          {}
        );
      }

      const hydrated = rows.map((row) => ({
        ...row,
        profiles: profileMap[row.reviewer_id] ?? null,
      }));
      setListingReviews(hydrated);

      const summary = await supabase
        .from("market_listing_review_summary")
        .select("review_count,avg_rating")
        .eq("listing_id", listingId)
        .maybeSingle();

      if (!summary.error && summary.data) {
        setListingReviewCount(
          Number((summary.data as any).review_count ?? 0)
        );
        setListingAvgRating(Number((summary.data as any).avg_rating ?? 0));
      } else {
        const avg = rows.length
          ? rows.reduce(
              (total, row) => total + Number(row.rating || 0),
              0
            ) / rows.length
          : 0;
        setListingReviewCount(Number(count ?? rows.length));
        setListingAvgRating(Math.round(avg * 10) / 10);
      }
    } catch (e: any) {
      console.log(
        "[ListingDetails] listing reviews skipped:",
        e?.message ?? e
      );
      setListingReviews([]);
      setListingReviewCount(0);
      setListingAvgRating(0);
    }
  }

  async function loadReviewEligibility() {
    if (
      !listingId ||
      !listing?.seller_id ||
      !meId ||
      meId === listing.seller_id
    ) {
      setCanReviewListing(false);
      setReviewOrderId(null);
      return;
    }

    try {
      const [existingReview, eligibleOrders] = await Promise.all([
        supabase
          .from("market_listing_reviews")
          .select("id,order_id,rating,comment")
          .eq("listing_id", listingId)
          .eq("reviewer_id", meId)
          .maybeSingle(),
        supabase
          .from("market_orders")
          .select("id,status,created_at")
          .eq("buyer_id", meId)
          .eq("seller_id", listing.seller_id)
          .eq("listing_id", listingId)
          .in("status", ["DELIVERED", "RELEASED"])
          .order("created_at", { ascending: false })
          .limit(1),
      ]);

      const existing = existingReview.data as any;
      const eligible = (eligibleOrders.data ?? [])[0] as any;
      const orderId = String(
        existing?.order_id || eligible?.id || ""
      ).trim();

      setCanReviewListing(Boolean(orderId));
      setReviewOrderId(orderId || null);
      if (existing?.id) {
        setReviewRating(Number(existing.rating ?? 0));
        setReviewComment(String(existing.comment ?? ""));
      }
    } catch (e: any) {
      console.log(
        "[ListingDetails] review eligibility skipped:",
        e?.message ?? e
      );
      setCanReviewListing(false);
      setReviewOrderId(null);
    }
  }

  useEffect(() => {
    if (!listingId) return;
    loadReactions();
    loadComments();
    loadListingReviews();

    const ch = supabase
      .channel(`listing-social-${listingId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "market_listing_reactions",
          filter: `listing_id=eq.${listingId}`,
        },
        () => {
          loadReactions();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "market_listing_comments",
          filter: `listing_id=eq.${listingId}`,
        },
        () => {
          loadComments();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "market_listing_reviews",
          filter: `listing_id=eq.${listingId}`,
        },
        () => {
          loadListingReviews();
          loadReviewEligibility();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [listingId, listing?.seller_id, meId]);

  useEffect(() => {
    loadReviewEligibility();
  }, [listingId, listing?.seller_id, meId]);

  // ─── Actions (all unchanged) ──────────────────────────────────────────────────

  async function toggleReaction(next: "like" | "dislike") {
    if (!meId) {
      Alert.alert("Sign in required", "Please sign in to react to listings.");
      return;
    }
    if (!listingId) return;
    try {
      if (myReaction === next) {
        await supabase
          .from("market_listing_reactions")
          .delete()
          .eq("listing_id", listingId)
          .eq("user_id", meId);
      } else {
        await supabase
          .from("market_listing_reactions")
          .upsert(
            { listing_id: listingId, user_id: meId, reaction: next },
            { onConflict: "listing_id,user_id" }
          );
      }
      await loadReactions();
    } catch (e: any) {
      Alert.alert(
        "Try again",
        friendlyMarketError(e, "We couldn't save your reaction.")
      );
    }
  }

  async function submitComment() {
    if (!meId) {
      Alert.alert("Sign in required", "Please sign in to comment.");
      return;
    }
    if (!listingId) return;
    const body = commentInput.trim();
    if (body.length < 2) return;
    setCommentBusy(true);
    try {
      await supabase
        .from("market_listing_comments")
        .insert({ listing_id: listingId, user_id: meId, body });
      setCommentInput("");
      await loadComments();
    } catch (e: any) {
      Alert.alert(
        "Try again",
        friendlyMarketError(e, "We couldn't post your comment.")
      );
    } finally {
      setCommentBusy(false);
    }
  }

  async function submitListingReview() {
    if (!meId) {
      Alert.alert(
        "Sign in required",
        "Please sign in to review this listing."
      );
      return;
    }
    if (!listing || !reviewOrderId || !canReviewListing) {
      setErr(
        "Only buyers who completed an order for this listing can review it."
      );
      return;
    }
    if (reviewRating < 1) {
      setErr(
        "Select a star rating before submitting your listing review."
      );
      return;
    }

    setReviewBusy(true);
    setErr(null);
    try {
      const { error } = await supabase
        .from("market_listing_reviews")
        .upsert(
          {
            listing_id: listing.id,
            order_id: reviewOrderId,
            seller_id: listing.seller_id,
            reviewer_id: meId,
            rating: reviewRating,
            comment: reviewComment.trim() || null,
          },
          { onConflict: "listing_id,reviewer_id" }
        );
      if (error) throw error;
      await loadListingReviews();
      await loadReviewEligibility();
    } catch (e: any) {
      setErr(
        friendlyMarketError(
          e,
          "We couldn't submit your listing review."
        )
      );
    } finally {
      setReviewBusy(false);
    }
  }

  async function buyNow() {
    if (buyBusy) return;
    setBuyBusy(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user) {
        router.push("/(auth)/login" as any);
        return;
      }
      if (!listing) {
        const msg =
          "This listing is not ready yet. Please refresh and try again.";
        if (Platform.OS === "web" && typeof window !== "undefined")
          window.alert(msg);
        else Alert.alert("Listing unavailable", msg);
        return;
      }
      const outOfStock =
        listing.category === "product" &&
        listing.stock_qty !== null &&
        Number(listing.stock_qty) <= 0;
      if (outOfStock) {
        const msg =
          "This listing is sold out. The seller needs to restock or relist.";
        if (Platform.OS === "web" && typeof window !== "undefined")
          window.alert(msg);
        else Alert.alert("Out of stock", msg);
        return;
      }
      const listingCurrency = String(listing.currency ?? "").toUpperCase();
      const { allowUsdc, allowUsdt } = getStableRouteFlags(
        listing.payment_options,
        listingCurrency
      );
      const allowPi =
        parseJsonObject(listing.payment_options)?.allow_pi === true;
      const hasStableCheckout = allowUsdc || allowUsdt;
      if (!hasStableCheckout && !allowPi) {
        const msg =
          "This listing does not have an active crypto checkout route right now.";
        if (Platform.OS === "web" && typeof window !== "undefined")
          window.alert(msg);
        else Alert.alert("Checkout unavailable", msg);
        return;
      }

      const finalDeliveryGeo = deliveryGeo
        ? {
            ...deliveryGeo,
            label: deliveryLabel.trim() || deliveryGeo.label,
          }
        : null;

      const stockQty = Number((listing as any)?.stock_qty);
      const hasStockCap =
        String((listing as any)?.category || "").toLowerCase() ===
          "product" &&
        Number.isFinite(stockQty) &&
        stockQty > 0;
      const maxQty = hasStockCap ? Math.max(1, Math.floor(stockQty)) : 1;
      const parsedQty = Number.parseInt(
        String(orderQtyInput || "").trim(),
        10
      );
      const qty = Number.isFinite(parsedQty) ? Math.max(1, parsedQty) : 1;
      if (qty > maxQty) {
        const msg = `Only ${maxQty} item(s) are currently available for this listing.`;
        if (Platform.OS === "web" && typeof window !== "undefined")
          window.alert(msg);
        else Alert.alert("Quantity adjusted", msg);
        setOrderQtyInput(String(maxQty));
        return;
      }

      const payload = {
        listing_id: listing.id,
        quantity: qty,
        delivery_address: finalDeliveryGeo
          ? { geo: finalDeliveryGeo }
          : null,
      };
      const out = await callFn<{ order?: { id?: string } }>(
        FN_CREATE_ORDER,
        payload,
        15000
      );
      const nextOrderId = String(
        (out as any)?.order?.id || ""
      ).trim();
      if (!nextOrderId)
        throw new Error(
          "Order creation did not return an order id."
        );

      if (allowPi && !hasStableCheckout) {
        router.push(`/market/order/${nextOrderId}` as any);
      } else {
        router.push(`/market/checkout/${nextOrderId}` as any);
      }
    } catch (e: any) {
      const message = friendlyMarketError(
        e,
        "We couldn't start checkout for this listing."
      );
      setErr(message);
      const details = e?.details;
      if (Platform.OS === "web" && typeof window !== "undefined") {
        const debugParts: string[] = [];
        if (details?.status) debugParts.push(`HTTP ${details.status}`);
        if (details?.text)
          debugParts.push(String(details.text).slice(0, 280));
        if (details?.json && !details?.text)
          debugParts.push(
            JSON.stringify(details.json).slice(0, 280)
          );
        const debug = debugParts.length
          ? `\n\nDebug: ${debugParts.join(" | ")}`
          : "";
        window.alert(`${message}${debug}`);
      } else {
        Alert.alert("Checkout failed", message);
      }
    } finally {
      setBuyBusy(false);
    }
  }

  async function useCurrentLocationForDelivery() {
    setLocatingDelivery(true);
    try {
      const res = await getCurrentLocationWithGeocode();
      const geo: DeliveryGeo = toDeliveryGeo({
        coords: res.coords,
        geo: res.geo,
        label: res.label,
        continent: userCountry?.continent,
      });
      setDeliveryGeo(geo);
      setDeliveryLabel(res.label);
    } catch (e: any) {
      Alert.alert(
        "Location issue",
        friendlyMarketError(e, "We couldn't access your location.")
      );
    } finally {
      setLocatingDelivery(false);
    }
  }

  // ─── Derived Display Values ───────────────────────────────────────────────────

  const listingMedia = listing
    ? sortMarketMedia(images).reduce<
        Array<ListingImage & { url: string; kind: MarketMediaKind }>
      >((acc, item) => {
        const url = buildMarketMediaUrl(
          item,
          supabaseUrl,
          LISTING_IMAGES_BUCKET
        );
        if (!url) return acc;
        acc.push({
          ...item,
          url,
          kind: resolveMarketMediaKind(item),
        });
        return acc;
      }, [])
    : [];

  const availabilitySummary = listing
    ? formatAvailabilitySummary((listing as any)?.availability)
    : "";
  const recentComments = comments.slice(0, 4);
  const showSeeMore = commentCount > 4;
  const displayPrice = listing
    ? getListingPriceDisplay(listing as any)
    : null;
  const showDiscount = displayPrice?.hasDiscount ?? false;
  const isOutOfStock =
    listing?.category === "product" &&
    listing?.stock_qty !== null &&
    Number(listing?.stock_qty) <= 0;
  const stockQtyNum = Number(listing?.stock_qty);
  const hasStockCap =
    String(listing?.category || "").toLowerCase() === "product" &&
    Number.isFinite(stockQtyNum) &&
    stockQtyNum > 0;
  const maxOrderQty = hasStockCap
    ? Math.max(1, Math.floor(stockQtyNum))
    : 1;
  const parsedQty = Number.parseInt(
    String(orderQtyInput || "").trim(),
    10
  );
  const orderQty = Number.isFinite(parsedQty)
    ? Math.max(1, Math.min(maxOrderQty, parsedQty))
    : 1;
  const unitLocal = Number(displayPrice?.localNow ?? 0);
  const unitUsd = Number(displayPrice?.usdNow ?? 0);
  const totalLocal = Number((unitLocal * orderQty).toFixed(2));
  const totalUsd = Number((unitUsd * orderQty).toFixed(2));

  function adjustOrderQty(delta: number) {
    const next = Math.max(
      1,
      Math.min(maxOrderQty, orderQty + delta)
    );
    setOrderQtyInput(String(next));
  }

  function onChangeOrderQty(text: string) {
    const digits = String(text || "").replace(/[^\d]/g, "");
    if (!digits) {
      setOrderQtyInput("");
      return;
    }
    const n = Number.parseInt(digits, 10);
    if (!Number.isFinite(n)) {
      setOrderQtyInput("1");
      return;
    }
    setOrderQtyInput(
      String(Math.max(1, Math.min(maxOrderQty, n)))
    );
  }

  // ─── Loading Screen ───────────────────────────────────────────────────────────

  if (loading) {
    return (
      <LinearGradient
        colors={[BG2, BG1, BG0]}
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={{ flex: 1 }}
      >
        <View
          style={{
            paddingTop: Math.max(insets.top, 14),
            paddingHorizontal: sidePadding,
          }}
        >
          <AppHeader title="Listing" />
        </View>
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
          }}
        >
          <View style={styles.loadingSpinner}>
            <ActivityIndicator color={AMBER} size="large" />
          </View>
          <Text
            style={{
              color: MUTED,
              fontWeight: "700",
              fontSize: 14,
              letterSpacing: 0.4,
            }}
          >
            Loading listing…
          </Text>
        </View>
      </LinearGradient>
    );
  }

  // ─── Not Found Screen ─────────────────────────────────────────────────────────

  if (!listing) {
    return (
      <LinearGradient
        colors={[BG2, BG1, BG0]}
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={{
          flex: 1,
          paddingTop: Math.max(insets.top, 14),
          paddingHorizontal: sidePadding,
        }}
      >
        <AppHeader title="Listing" />
        <View
          style={[
            styles.card,
            { marginTop: 18 },
          ]}
        >
          <Text
            style={{
              color: TEXT,
              fontWeight: "900",
              fontSize: 17,
            }}
          >
            Listing not found
          </Text>
          {!!err && (
            <Text
              style={{
                marginTop: 8,
                color: MUTED,
                lineHeight: 20,
              }}
            >
              {err}
            </Text>
          )}
          <Pressable
            onPress={() => router.back()}
            style={[styles.btnPrimary, { marginTop: 18 }]}
          >
            <Text style={styles.btnPrimaryText}>Go back</Text>
          </Pressable>
        </View>
      </LinearGradient>
    );
  }

  // ─── Two-column layout on desktop ────────────────────────────────────────────
  const twoCol = isDesktop;

  // ─── Main Render ──────────────────────────────────────────────────────────────

  return (
    <LinearGradient
      colors={[BG2, BG1, BG0]}
      start={{ x: 0.15, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={{ flex: 1, paddingTop: Math.max(insets.top, 14) }}
    >
      <InAppTutorial
        enabled={!loading && !!listing}
        flow={tutorialFlows.listingDetail}
      />

      {/* ── Header bar ────────────────────────────────────────────────────────── */}
      <View
        style={{
          paddingHorizontal: sidePadding,
          marginBottom: 6,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            maxWidth: contentMaxWidth,
            alignSelf: "center",
            width: "100%",
          }}
        >
          <Pressable
            onPress={() => router.back()}
            style={styles.backBtn}
          >
            <Ionicons name="arrow-back" size={20} color={TEXT} />
          </Pressable>

          <View style={{ flex: 1 }}>
            <Text
              numberOfLines={1}
              style={{
                color: TEXT,
                fontSize: isTablet ? 22 : 18,
                fontWeight: "900",
                letterSpacing: -0.3,
              }}
            >
              {listing.title ?? "Listing"}
            </Text>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                marginTop: 4,
                flexWrap: "wrap",
              }}
            >
              {listing.category ? (
                <Pill label={listing.category} />
              ) : null}
              {listing.delivery_type ? (
                <Pill label={listing.delivery_type} />
              ) : null}
              {listing.sub_category ? (
                <Pill label={listing.sub_category} />
              ) : null}
            </View>
          </View>
        </View>
      </View>

      {/* ── Scrollable body ───────────────────────────────────────────────────── */}
      <ScrollView
        contentContainerStyle={{
          paddingBottom: 140,
          paddingHorizontal: sidePadding,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={{
            maxWidth: contentMaxWidth,
            width: "100%",
            alignSelf: "center",
          }}
        >

          {/* ── Media Strip ─────────────────────────────────────────────────────── */}
          <TutorialTarget id="market.listing.media">
            <View style={{ marginTop: 10 }}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
              >
                <View style={{ flexDirection: "row", gap: 12 }}>
                  {(listingMedia.length ? listingMedia : [null]).map(
                    (media, idx) => (
                      <Pressable
                        key={
                          media
                            ? `${media.id}-${idx}`
                            : `none-${idx}`
                        }
                        onPress={() =>
                          media
                            ? openListingMediaPreview(
                                media.url,
                                media.kind,
                                idx
                              )
                            : null
                        }
                        disabled={!media}
                        style={[
                          styles.mediaCard,
                          {
                            width: mediaCardWidth,
                            height: mediaCardHeight,
                          },
                        ]}
                      >
                        {media ? (
                          <>
                            <MarketMediaView
                              uri={media.url}
                              kind={media.kind}
                              style={{
                                width: "100%",
                                height: "100%",
                              }}
                              resizeMode="cover"
                              autoplay={media.kind === "video"}
                              muted
                              loop={media.kind === "video"}
                              disablePointerEvents
                            />
                            {media.kind === "video" ? (
                              <View style={styles.videoTag}>
                                <Ionicons
                                  name="videocam-outline"
                                  size={12}
                                  color={TEXT}
                                />
                                <Text
                                  style={{
                                    color: TEXT,
                                    fontWeight: "800",
                                    fontSize: 11,
                                  }}
                                >
                                  Tap to preview
                                </Text>
                              </View>
                            ) : null}
                            <View style={styles.mediaTapOverlay}>
                              <Ionicons
                                name="expand-outline"
                                size={15}
                                color="rgba(255,253,247,0.75)"
                              />
                            </View>
                          </>
                        ) : (
                          <View
                            style={{
                              flex: 1,
                              alignItems: "center",
                              justifyContent: "center",
                              gap: 10,
                            }}
                          >
                            <Ionicons
                              name="images-outline"
                              size={34}
                              color={FAINT}
                            />
                            <Text
                              style={{
                                color: MUTED,
                                fontWeight: "700",
                                fontSize: 13,
                              }}
                            >
                              No media yet
                            </Text>
                          </View>
                        )}
                      </Pressable>
                    )
                  )}
                </View>
              </ScrollView>
              {listingMedia.length > 0 ? (
                <Text
                  style={{
                    marginTop: 7,
                    color: FAINT,
                    fontSize: 11,
                    letterSpacing: 0.2,
                  }}
                >
                  {listingMedia.length}{" "}
                  {listingMedia.length === 1 ? "item" : "items"} · Tap to view
                  full preview
                </Text>
              ) : null}
            </View>
          </TutorialTarget>

          {/* ── Two-col or single-col body ───────────────────────────────────────── */}
          <View
            style={
              twoCol
                ? {
                    flexDirection: "row",
                    gap: 20,
                    marginTop: 18,
                    alignItems: "flex-start",
                  }
                : { marginTop: 14 }
            }
          >

            {/* ════ LEFT / MAIN column ════════════════════════════════════════════ */}
            <View
              style={
                twoCol
                  ? { flex: 1.6, gap: 14 }
                  : { gap: 12 }
              }
            >

              {/* ── Price Card ────────────────────────────────────────────────────── */}
              <View style={[styles.card, styles.cardAmber]}>
                <SectionLabel text="Price" />

                {showDiscount ? (
                  <View style={{ marginTop: 10, gap: 2 }}>
                    <Text
                      style={{
                        color: FAINT,
                        fontWeight: "700",
                        fontSize: 13,
                        textDecorationLine: "line-through",
                      }}
                    >
                      {formatCurrency(
                        displayPrice!.localCurrency,
                        displayPrice!.localWas
                      )}
                    </Text>
                    <Text
                      style={{
                        color: FAINT,
                        fontWeight: "700",
                        fontSize: 12,
                        textDecorationLine: "line-through",
                      }}
                    >
                      USD{" "}
                      {formatCurrency(
                        "USD",
                        displayPrice!.usdWas
                      )}
                    </Text>
                  </View>
                ) : null}

                <Text
                  style={{
                    marginTop: showDiscount ? 6 : 14,
                    color: AMBER,
                    fontWeight: "900",
                    fontSize: isTablet ? 40 : 34,
                    letterSpacing: -1,
                  }}
                >
                  {formatCurrency(
                    displayPrice!.localCurrency,
                    displayPrice!.localNow
                  )}
                </Text>

                <Text
                  style={{
                    marginTop: 4,
                    color: MUTED,
                    fontWeight: "700",
                    fontSize: 13,
                  }}
                >
                  ≈ USD{" "}
                  {formatCurrency("USD", displayPrice!.usdNow)}
                </Text>

                {listing.stock_qty !== null &&
                listing.category === "product" ? (
                  <View style={styles.stockBadge}>
                    <Ionicons
                      name="cube-outline"
                      size={13}
                      color={isOutOfStock ? ROSE : TEAL}
                    />
                    <Text
                      style={{
                        color: isOutOfStock ? ROSE : TEAL,
                        fontWeight: "800",
                        fontSize: 12,
                      }}
                    >
                      {isOutOfStock
                        ? "Out of stock"
                        : `${listing.stock_qty} in stock`}
                    </Text>
                  </View>
                ) : null}

                {/* Quantity selector */}
                {hasStockCap ? (
                  <View style={styles.qtyContainer}>
                    <Text
                      style={{
                        color: MUTED,
                        fontWeight: "700",
                        fontSize: 12,
                        marginBottom: 10,
                      }}
                    >
                      Quantity
                    </Text>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 10,
                      }}
                    >
                      <Pressable
                        onPress={() => adjustOrderQty(-1)}
                        disabled={orderQty <= 1}
                        style={[
                          styles.qtyBtn,
                          orderQty <= 1 && { opacity: 0.4 },
                        ]}
                      >
                        <Ionicons
                          name="remove"
                          size={18}
                          color={TEXT}
                        />
                      </Pressable>

                      <TextInput
                        value={String(orderQtyInput)}
                        onChangeText={onChangeOrderQty}
                        keyboardType="number-pad"
                        style={styles.qtyInput}
                      />

                      <Pressable
                        onPress={() => adjustOrderQty(1)}
                        disabled={orderQty >= maxOrderQty}
                        style={[
                          styles.qtyBtn,
                          orderQty >= maxOrderQty && {
                            opacity: 0.4,
                          },
                        ]}
                      >
                        <Ionicons
                          name="add"
                          size={18}
                          color={TEXT}
                        />
                      </Pressable>

                      <Text
                        style={{
                          color: FAINT,
                          fontSize: 12,
                          marginLeft: "auto",
                        }}
                      >
                        Max {maxOrderQty}
                      </Text>
                    </View>

                    <View style={styles.totalRow}>
                      <Text
                        style={{
                          color: MUTED,
                          fontSize: 12,
                          fontWeight: "700",
                        }}
                      >
                        Total
                      </Text>
                      <Text
                        style={{
                          color: TEXT,
                          fontSize: 15,
                          fontWeight: "900",
                        }}
                      >
                        {formatCurrency(
                          displayPrice!.localCurrency,
                          totalLocal
                        )}{" "}
                        <Text
                          style={{
                            color: MUTED,
                            fontWeight: "700",
                            fontSize: 12,
                          }}
                        >
                          (USD{" "}
                          {formatCurrency("USD", totalUsd)})
                        </Text>
                      </Text>
                    </View>
                  </View>
                ) : null}
              </View>

              {/* ── Details / Description Card ────────────────────────────────────── */}
              <View style={styles.card}>
                <SectionLabel text="Details" />
                <Text
                  style={{
                    marginTop: 12,
                    color: MUTED,
                    lineHeight: 22,
                    fontSize: 14,
                  }}
                >
                  {listing.description ?? "No description provided."}
                </Text>
              </View>

              {/* ── Availability Card ─────────────────────────────────────────────── */}
              <View style={styles.card}>
                <SectionLabel text="Available in" />
                <View style={{ marginTop: 12 }}>
                  <ListingOriginBadge
                    availability={listing?.availability}
                    paymentOptions={listing?.payment_options}
                  />
                </View>
                <Text
                  style={{
                    marginTop: 10,
                    color: MUTED,
                    lineHeight: 20,
                    fontSize: 13,
                  }}
                >
                  {availabilitySummary}
                </Text>
                {listing?.availability?.scope === "radius" &&
                listing?.availability?.center?.lat ? (
                  <Pressable
                    onPress={() =>
                      Linking.openURL(
                        `https://maps.google.com/?q=${listing.availability.center.lat},${listing.availability.center.lng}`
                      )
                    }
                    style={styles.mapBtn}
                  >
                    <Ionicons
                      name="map-outline"
                      size={14}
                      color={TEAL}
                    />
                    <Text
                      style={{
                        color: TEAL,
                        fontWeight: "800",
                        fontSize: 12,
                      }}
                    >
                      Open in Google Maps
                    </Text>
                  </Pressable>
                ) : null}
              </View>

              {/* ── Service Previews Card ─────────────────────────────────────────── */}
              {listingPreviews.length > 0 ||
              String(listing.delivery_type || "").toLowerCase() ===
                "digital" ? (
                <View style={styles.card}>
                  <SectionLabel text="Service previews" />
                  <Text
                    style={{
                      marginTop: 8,
                      color: MUTED,
                      fontSize: 12,
                      lineHeight: 18,
                    }}
                  >
                    Tap any preview to view before purchase.
                  </Text>

                  {String(listing.website_url || "").trim() ? (
                    <Pressable
                      onPress={() =>
                        openWebsitePreview(
                          String(listing.website_url || "")
                        )
                      }
                      style={[
                        styles.previewRow,
                        {
                          borderColor: TEAL_BORDER,
                          backgroundColor: TEAL_GLASS,
                          marginTop: 12,
                        },
                      ]}
                    >
                      <View
                        style={[
                          styles.previewIcon,
                          {
                            backgroundColor:
                              "rgba(45,212,191,0.18)",
                          },
                        ]}
                      >
                        <Ionicons
                          name="globe-outline"
                          size={16}
                          color={TEAL}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={{
                            color: TEXT,
                            fontWeight: "800",
                            fontSize: 13,
                          }}
                        >
                          Website preview
                        </Text>
                        <Text
                          style={{
                            color: MUTED,
                            fontSize: 11,
                            marginTop: 2,
                          }}
                        >
                          DEMO LINK
                        </Text>
                      </View>
                      <Ionicons
                        name="chevron-forward"
                        size={16}
                        color={MUTED}
                      />
                    </Pressable>
                  ) : null}

{listingPreviews.length === 0 &&
                   !String(listing.website_url || "").trim() ? (
                     <Text
                       style={{
                         marginTop: 10,
                         color: FAINT,
                         fontSize: 13,
                       }}
                     >
                       No preview assets yet.
                     </Text>
                   ) : (
                     <View style={{ marginTop: 10, gap: 8 }}>
                       {listingPreviews.map((pv, idx) => (
                         <Pressable
                           key={pv.id}
                           onPress={() => openListingPreview(pv, idx, listingPreviews)}
                           style={styles.previewRow}
                         >
                          <View style={styles.previewIcon}>
                            <Ionicons
                              name={
                                previewIcon(pv.kind) as any
                              }
                              size={16}
                              color={AMBER}
                            />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text
                              style={{
                                color: TEXT,
                                fontWeight: "800",
                                fontSize: 13,
                              }}
                            >
                              {pv.title ||
                                `Preview ${pv.id.slice(0, 6)}`}
                            </Text>
                            <Text
                              style={{
                                color: MUTED,
                                fontSize: 11,
                                marginTop: 2,
                              }}
                            >
                              {previewKind(
                                pv.kind
                              ).toUpperCase()}
                            </Text>
                          </View>
                          <Ionicons
                            name="chevron-forward"
                            size={16}
                            color={MUTED}
                          />
                        </Pressable>
                      ))}
                    </View>
                  )}
                </View>
              ) : null}

            </View>
            {/* ════ END LEFT column ═══════════════════════════════════════════════ */}

            {/* ════ RIGHT / SIDEBAR column ════════════════════════════════════════ */}
            <View
              style={
                twoCol
                  ? { width: 330, gap: 14 }
                  : { gap: 12, marginTop: 12 }
              }
            >

              {/* ── Community reactions ───────────────────────────────────────────── */}
              <TutorialTarget id="market.listing.community">
                <View style={styles.card}>
                  <SectionLabel text="Community" />
                  <View
                    style={{
                      marginTop: 12,
                      flexDirection: "row",
                      gap: 10,
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    <Pressable
                      onPress={() => toggleReaction("like")}
                      style={[
                        styles.reactionBtn,
                        myReaction === "like" && {
                          borderColor: GREEN_BORDER,
                          backgroundColor: GREEN_GLASS,
                        },
                      ]}
                    >
                      <Ionicons
                        name={
                          myReaction === "like"
                            ? "thumbs-up"
                            : "thumbs-up-outline"
                        }
                        size={16}
                        color={
                          myReaction === "like"
                            ? "#10B981"
                            : TEXT
                        }
                      />
                      <Text
                        style={{
                          color:
                            myReaction === "like"
                              ? "#10B981"
                              : TEXT,
                          fontWeight: "900",
                          fontSize: 13,
                        }}
                      >
                        {likes}
                      </Text>
                    </Pressable>

                    <Pressable
                      onPress={() => toggleReaction("dislike")}
                      style={[
                        styles.reactionBtn,
                        myReaction === "dislike" && {
                          borderColor: RED_BORDER,
                          backgroundColor: RED_GLASS,
                        },
                      ]}
                    >
                      <Ionicons
                        name={
                          myReaction === "dislike"
                            ? "thumbs-down"
                            : "thumbs-down-outline"
                        }
                        size={16}
                        color={
                          myReaction === "dislike" ? ROSE : TEXT
                        }
                      />
                      <Text
                        style={{
                          color:
                            myReaction === "dislike"
                              ? ROSE
                              : TEXT,
                          fontWeight: "900",
                          fontSize: 13,
                        }}
                      >
                        {dislikes}
                      </Text>
                    </Pressable>

                    <View style={styles.reactionBtn}>
                      <Ionicons
                        name="chatbubble-ellipses-outline"
                        size={16}
                        color={MUTED}
                      />
                      <Text
                        style={{
                          color: MUTED,
                          fontWeight: "900",
                          fontSize: 13,
                        }}
                      >
                        {commentCount}
                      </Text>
                    </View>
                  </View>
                </View>
              </TutorialTarget>

              {/* ── Seller Card ───────────────────────────────────────────────────── */}
              <TutorialTarget id="market.listing.seller">
                <View style={styles.card}>
                  <SectionLabel text="Seller" />

                  <View
                    style={{
                      marginTop: 12,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <View style={styles.sellerAvatar}>
                      {seller?.logo_path ? (
                        <Image
                          source={{
                            uri: `${supabaseUrl}/storage/v1/object/public/market-sellers/${seller.logo_path}`,
                          }}
                          style={{ width: 52, height: 52 }}
                        />
                      ) : (
                        <View
                          style={{
                            flex: 1,
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Ionicons
                            name="storefront-outline"
                            size={22}
                            color={FAINT}
                          />
                        </View>
                      )}
                    </View>

                    <View style={{ flex: 1 }}>
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 5,
                        }}
                      >
                        <Text
                          style={{
                            color: TEXT,
                            fontWeight: "900",
                            fontSize: 14,
                          }}
                          numberOfLines={1}
                        >
                          {seller?.business_name ||
                            seller?.display_name ||
                            "Seller"}
                        </Text>
                        {seller?.is_verified ? (
                          <Ionicons
                            name="checkmark-circle"
                            size={15}
                            color={BLUE}
                          />
                        ) : null}
                      </View>
                      <Text
                        style={{
                          marginTop: 2,
                          color: MUTED,
                          fontSize: 12,
                        }}
                      >
                        @{seller?.market_username || "seller"}
                      </Text>
                    </View>

                    <Pressable
                      onPress={() => {
                        const u = seller?.market_username;
                        if (u)
                          router.push(
                            `/market/profile/${u}` as any
                          );
                      }}
                      style={styles.viewBtn}
                    >
                      <Text
                        style={{
                          color: TEXT,
                          fontWeight: "800",
                          fontSize: 12,
                        }}
                      >
                        Profile
                      </Text>
                    </Pressable>
                  </View>

                  {seller?.bio ? (
                    <Text
                      style={{
                        marginTop: 10,
                        color: MUTED,
                        lineHeight: 19,
                        fontSize: 13,
                      }}
                    >
                      {seller.bio}
                    </Text>
                  ) : null}

                  {seller?.market_username ? (
                    <Pressable
                      onPress={() =>
                        router.push({
                          pathname:
                            "/market/dm/[username]" as any,
                          params: {
                            username: seller.market_username,
                          },
                        })
                      }
                      style={[
                        styles.btnOutline,
                        {
                          marginTop: 12,
                          borderColor: TEAL_BORDER,
                          backgroundColor: TEAL_GLASS,
                        },
                      ]}
                    >
                      <Ionicons
                        name="chatbubble-ellipses-outline"
                        size={16}
                        color={TEAL}
                      />
                      <Text
                        style={{
                          color: TEAL,
                          fontWeight: "800",
                          fontSize: 13,
                        }}
                      >
                        Message seller
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              </TutorialTarget>

              {/* ── Delivery Location Card ────────────────────────────────────────── */}
              <View style={styles.card}>
                <SectionLabel text="Delivery location" />
                <Text
                  style={{
                    marginTop: 8,
                    color: MUTED,
                    fontSize: 12,
                    lineHeight: 18,
                  }}
                >
                  Set your delivery or service location before
                  checkout.
                </Text>

                <Pressable
                  onPress={useCurrentLocationForDelivery}
                  disabled={locatingDelivery}
                  style={[
                    styles.btnOutline,
                    {
                      marginTop: 12,
                      opacity: locatingDelivery ? 0.7 : 1,
                    },
                  ]}
                >
                  {locatingDelivery ? (
                    <ActivityIndicator
                      color={AMBER}
                      size="small"
                    />
                  ) : (
                    <Ionicons
                      name="locate-outline"
                      size={16}
                      color={AMBER}
                    />
                  )}
                  <Text
                    style={{
                      color: AMBER,
                      fontWeight: "800",
                      fontSize: 13,
                    }}
                  >
                    Use current location
                  </Text>
                </Pressable>

                <TextInput
                  value={deliveryLabel}
                  onChangeText={setDeliveryLabel}
                  placeholder="Location label (optional)"
                  placeholderTextColor="rgba(255,255,255,0.32)"
                  style={styles.textInput}
                />

                {deliveryGeo ? (
                  <View style={styles.geoTag}>
                    <Ionicons
                      name="checkmark-circle-outline"
                      size={13}
                      color={TEAL}
                    />
                    <Text
                      style={{
                        color: TEAL,
                        fontSize: 11,
                        fontWeight: "700",
                        flex: 1,
                      }}
                      numberOfLines={1}
                    >
                      {deliveryGeo.label ||
                        deliveryLabel ||
                        "Location set"}{" "}
                      · {deliveryGeo.lat.toFixed(4)},{" "}
                      {deliveryGeo.lng.toFixed(4)}
                    </Text>
                  </View>
                ) : null}
              </View>

              {/* ── Reviews Card ──────────────────────────────────────────────────── */}
              <View style={styles.card}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 10,
                  }}
                >
                  <SectionLabel text="Reviews" />
                  <View
                    style={{ alignItems: "flex-end", gap: 4 }}
                  >
                    <RatingStars
                      value={listingAvgRating}
                      muted={!listingReviewCount}
                      size={13}
                    />
                    <Text
                      style={{
                        color: listingReviewCount
                          ? AMBER
                          : FAINT,
                        fontWeight: "900",
                        fontSize: 12,
                      }}
                    >
                      {listingReviewCount
                        ? `${formatRating(listingAvgRating)} · ${listingReviewCount} review${listingReviewCount !== 1 ? "s" : ""}`
                        : "No reviews yet"}
                    </Text>
                  </View>
                </View>

                <Text
                  style={{
                    marginTop: 8,
                    color: MUTED,
                    fontSize: 12,
                    lineHeight: 18,
                  }}
                >
                  Buyer feedback from completed orders for this
                  listing.
                </Text>

                {canReviewListing ? (
                  <View style={styles.reviewFormBox}>
                    <Text
                      style={{
                        color: TEXT,
                        fontWeight: "900",
                        fontSize: 13,
                        marginBottom: 10,
                      }}
                    >
                      Your review
                    </Text>
                    <View
                      style={{
                        flexDirection: "row",
                        gap: 4,
                      }}
                    >
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Pressable
                          key={star}
                          onPress={() =>
                            setReviewRating(star)
                          }
                          hitSlop={8}
                          style={{ padding: 3 }}
                        >
                          <Ionicons
                            name={
                              reviewRating >= star
                                ? "star"
                                : "star-outline"
                            }
                            size={24}
                            color={AMBER}
                          />
                        </Pressable>
                      ))}
                    </View>
                    <TextInput
                      value={reviewComment}
                      onChangeText={setReviewComment}
                      placeholder="Share your experience (optional)"
                      placeholderTextColor="rgba(255,253,247,0.32)"
                      multiline
                      style={[
                        styles.textInput,
                        {
                          minHeight: 76,
                          textAlignVertical: "top",
                        },
                      ]}
                    />
                    <Pressable
                      onPress={submitListingReview}
                      disabled={reviewBusy}
                      style={[
                        styles.btnOutline,
                        {
                          marginTop: 10,
                          opacity: reviewBusy ? 0.7 : 1,
                          borderColor: AMBER_BORDER,
                          backgroundColor: AMBER_GLASS,
                        },
                      ]}
                    >
                      <Text
                        style={{
                          color: AMBER,
                          fontWeight: "900",
                          fontSize: 13,
                        }}
                      >
                        {reviewBusy
                          ? "Submitting…"
                          : "Submit review"}
                      </Text>
                    </Pressable>
                  </View>
                ) : (
                  <Text
                    style={{
                      marginTop: 10,
                      color: FAINT,
                      fontSize: 12,
                      lineHeight: 18,
                    }}
                  >
                    Only buyers with a delivered or released order
                    may leave a review.
                  </Text>
                )}

                <View style={{ marginTop: 14, gap: 10 }}>
                  {listingReviews.length ? (
                    listingReviews
                      .slice(0, 6)
                      .map((review) => (
                        <ListingReviewCard
                          key={review.id}
                          review={review}
                        />
                      ))
                  ) : (
                    <View style={styles.emptyState}>
                      <Ionicons
                        name="star-outline"
                        size={22}
                        color={FAINT}
                      />
                      <Text
                        style={{
                          color: FAINT,
                          fontSize: 13,
                        }}
                      >
                        No reviews yet
                      </Text>
                    </View>
                  )}
                </View>
              </View>

              {/* ── Comments Card ─────────────────────────────────────────────────── */}
              <View style={styles.card}>
                <SectionLabel text="Comments" />

                <View
                  style={{
                    marginTop: 12,
                    flexDirection: "row",
                    gap: 8,
                    alignItems: "flex-end",
                  }}
                >
                  <TextInput
                    value={commentInput}
                    onChangeText={setCommentInput}
                    placeholder="Write a public comment…"
                    placeholderTextColor="rgba(255,255,255,0.32)"
                    style={[
                      styles.textInput,
                      { flex: 1, marginTop: 0 },
                    ]}
                  />
                  <Pressable
                    onPress={submitComment}
                    disabled={
                      commentBusy ||
                      commentInput.trim().length < 2
                    }
                    style={[
                      styles.sendBtn,
                      (commentBusy ||
                        commentInput.trim().length < 2) && {
                        opacity: 0.45,
                      },
                    ]}
                  >
                    {commentBusy ? (
                      <ActivityIndicator
                        color={BG0}
                        size="small"
                      />
                    ) : (
                      <Ionicons
                        name="send"
                        size={16}
                        color={BG0}
                      />
                    )}
                  </Pressable>
                </View>

                <View style={{ marginTop: 12, gap: 8 }}>
                  {recentComments.length === 0 ? (
                    <View style={styles.emptyState}>
                      <Ionicons
                        name="chatbubble-outline"
                        size={22}
                        color={FAINT}
                      />
                      <Text
                        style={{
                          color: FAINT,
                          fontSize: 13,
                        }}
                      >
                        No comments yet
                      </Text>
                    </View>
                  ) : (
                    recentComments.map((c) => (
                      <View
                        key={c.id}
                        style={styles.commentCard}
                      >
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 8,
                            marginBottom: 6,
                          }}
                        >
                          <View
                            style={styles.commentAvatar}
                          >
                            <Text
                              style={{
                                color: AMBER,
                                fontWeight: "900",
                                fontSize: 11,
                              }}
                            >
                              {(
                                c.profiles?.username || "U"
                              )[0].toUpperCase()}
                            </Text>
                          </View>
                          <Text
                            style={{
                              color: TEXT,
                              fontWeight: "800",
                              fontSize: 12,
                              flex: 1,
                            }}
                          >
                            @
                            {c.profiles?.username ||
                              "user"}
                          </Text>
                          <Text
                            style={{
                              color: FAINT,
                              fontSize: 10,
                            }}
                          >
                            {new Date(
                              c.created_at
                            ).toLocaleDateString()}
                          </Text>
                        </View>
                        <Text
                          style={{
                            color: MUTED,
                            fontSize: 13,
                            lineHeight: 19,
                          }}
                        >
                          {c.body}
                        </Text>
                      </View>
                    ))
                  )}
                </View>

                {showSeeMore ? (
                  <Pressable
                    onPress={() => setShowAllComments(true)}
                    style={[
                      styles.btnOutline,
                      { marginTop: 10 },
                    ]}
                  >
                    <Ionicons
                      name="chatbubbles-outline"
                      size={15}
                      color={MUTED}
                    />
                    <Text
                      style={{
                        color: MUTED,
                        fontWeight: "800",
                        fontSize: 13,
                      }}
                    >
                      See all {commentCount} comments
                    </Text>
                  </Pressable>
                ) : null}
              </View>

            </View>
            {/* ════ END RIGHT column ══════════════════════════════════════════════ */}

          </View>
          {/* ══ END two-col wrapper ══════════════════════════════════════════════ */}

          {/* ── Error banner ──────────────────────────────────────────────────────── */}
          {!!err ? (
            <View style={styles.errBanner}>
              <Ionicons
                name="alert-circle-outline"
                size={16}
                color={ROSE}
              />
              <Text
                style={{
                  color: ROSE,
                  fontWeight: "700",
                  fontSize: 13,
                  flex: 1,
                }}
              >
                {err}
              </Text>
            </View>
          ) : null}

        </View>
      </ScrollView>

      {/* ── Sticky checkout bar ───────────────────────────────────────────────── */}
      <View
        style={[
          styles.checkoutBar,
          {
            paddingBottom: Math.max(insets.bottom, 16),
            paddingHorizontal: sidePadding,
          },
        ]}
      >
        <View
          style={{
            maxWidth: contentMaxWidth,
            width: "100%",
            alignSelf: "center",
          }}
        >
          <TutorialTarget id="market.listing.checkout">
            <Pressable
              onPress={buyNow}
              disabled={isOutOfStock || buyBusy}
              style={[
                styles.checkoutBtn,
                isOutOfStock && styles.checkoutBtnDisabled,
                (isOutOfStock || buyBusy) && { opacity: 0.85 },
              ]}
            >
              {buyBusy ? (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <ActivityIndicator color={BG0} />
                  <Text style={styles.checkoutBtnLabel}>
                    Starting checkout…
                  </Text>
                </View>
              ) : (
                <View style={{ alignItems: "center" }}>
                  <Text
                    style={[
                      styles.checkoutBtnLabel,
                      isOutOfStock && { color: TEXT },
                    ]}
                  >
                    {isOutOfStock
                      ? "Out of stock"
                      : hasStockCap
                      ? `Buy ${orderQty} item${orderQty > 1 ? "s" : ""}`
                      : "Buy now"}
                  </Text>
                  <Text
                    style={[
                      styles.checkoutBtnSub,
                      isOutOfStock && { color: MUTED },
                    ]}
                  >
                    {isOutOfStock
                      ? "Seller must restock before new orders."
                      : hasStockCap
                      ? `Total ${formatCurrency(displayPrice!.localCurrency, totalLocal)} (USD ${formatCurrency("USD", totalUsd)}) · Escrow protected`
                      : "Escrow protected · Continue to payment"}
                  </Text>
                </View>
              )}
            </Pressable>
          </TutorialTarget>
        </View>
      </View>

      {/* ── Modals ────────────────────────────────────────────────────────────── */}
      <OrderPreviewModal
        open={previewOpen}
        onClose={() => {
          setPreviewOpen(false);
          setPreviewPayload(null);
        }}
        payload={previewPayload}
      />

      <Modal
        visible={showAllComments}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAllComments(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.72)",
            justifyContent: "flex-end",
          }}
        >
          <View style={styles.commentsSheet}>
            <View style={styles.commentsSheetHandle} />

            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 6,
              }}
            >
              <Text
                style={{
                  color: TEXT,
                  fontWeight: "900",
                  fontSize: 17,
                }}
              >
                All comments
              </Text>
              <Pressable
                onPress={() => setShowAllComments(false)}
                style={styles.closeBtn}
              >
                <Ionicons name="close" size={18} color={TEXT} />
              </Pressable>
            </View>

            <Text
              style={{
                color: MUTED,
                fontSize: 12,
                marginBottom: 14,
              }}
            >
              {commentCount} total
            </Text>

            <ScrollView
              contentContainerStyle={{
                gap: 10,
                paddingBottom: 20,
              }}
            >
              {comments.length === 0 ? (
                <Text style={{ color: MUTED }}>
                  No comments yet.
                </Text>
              ) : (
                comments.map((c) => (
                  <View
                    key={c.id}
                    style={styles.commentCard}
                  >
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 6,
                      }}
                    >
                      <View style={styles.commentAvatar}>
                        <Text
                          style={{
                            color: AMBER,
                            fontWeight: "900",
                            fontSize: 11,
                          }}
                        >
                          {(
                            c.profiles?.username || "U"
                          )[0].toUpperCase()}
                        </Text>
                      </View>
                      <Text
                        style={{
                          color: TEXT,
                          fontWeight: "800",
                          fontSize: 12,
                          flex: 1,
                        }}
                      >
                        @{c.profiles?.username || "user"}
                      </Text>
                      <Text
                        style={{
                          color: FAINT,
                          fontSize: 10,
                        }}
                      >
                        {new Date(
                          c.created_at
                        ).toLocaleDateString()}
                      </Text>
                    </View>
                    <Text
                      style={{
                        color: MUTED,
                        fontSize: 13,
                        lineHeight: 19,
                      }}
                    >
                      {c.body}
                    </Text>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

    </LinearGradient>
  );
}

// ─── StyleSheet ───────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  // ── Cards
  card: {
    borderRadius: 20,
    padding: 18,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderTopColor: BORDER_TOP,
  },
  cardAmber: {
    backgroundColor: AMBER_GLASS,
    borderColor: AMBER_BORDER,
    borderTopColor: "rgba(255,253,247,0.26)",
  },

  // ── Section label
  sectionLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sectionLabelBar: {
    width: 3,
    height: 14,
    borderRadius: 2,
    backgroundColor: AMBER,
  },
  sectionLabelText: {
    color: AMBER,
    fontWeight: "900",
    fontSize: 11,
    letterSpacing: 1.2,
  },

  // ── Pill badge
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
    backgroundColor: "rgba(255,253,247,0.08)",
    borderWidth: 1,
    borderColor: BORDER,
  },
  pillText: {
    color: MUTED,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "capitalize",
  },

  // ── Back button
  backBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderTopColor: BORDER_TOP,
    alignItems: "center",
    justifyContent: "center",
  },

  // ── Media card
  mediaCard: {
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderTopColor: BORDER_TOP,
  },
  videoTag: {
    position: "absolute",
    left: 10,
    bottom: 10,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(6,8,7,0.78)",
    borderWidth: 1,
    borderColor: BORDER,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  mediaTapOverlay: {
    position: "absolute",
    right: 10,
    top: 10,
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: "rgba(6,8,7,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },

  // ── Loading spinner box
  loadingSpinner: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: CARD_RAISED,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
  },

  // ── Stock badge
  stockBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(255,253,247,0.07)",
    borderWidth: 1,
    borderColor: BORDER,
  },

  // ── Quantity selector
  qtyContainer: {
    marginTop: 16,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "rgba(255,253,247,0.05)",
  },
  qtyBtn: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD_RAISED,
  },
  qtyInput: {
    minWidth: 54,
    borderRadius: 11,
    paddingVertical: 8,
    paddingHorizontal: 10,
    textAlign: "center",
    color: TEXT,
    fontWeight: "900",
    fontSize: 16,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },

  // ── Map button
  mapBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
    alignSelf: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: TEAL_BORDER,
    backgroundColor: TEAL_GLASS,
  },

  // ── Preview rows
  previewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD_RAISED,
  },
  previewIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,183,93,0.15)",
  },

  // ── Reaction buttons
  reactionBtn: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "rgba(255,255,255,0.04)",
  },

  // ── Seller avatar
  sellerAvatar: {
    width: 52,
    height: 52,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: CARD_RAISED,
    borderWidth: 1,
    borderColor: BORDER,
  },

  // ── View profile button
  viewBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: CARD_RAISED,
    borderWidth: 1,
    borderColor: BORDER,
  },

  // ── Primary button
  btnPrimary: {
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: BRAND,
    borderWidth: 1,
    borderColor: BRAND,
  },
  btnPrimaryText: {
    color: BG0,
    fontWeight: "900",
    fontSize: 15,
  },

  // ── Outline / ghost button
  btnOutline: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD_RAISED,
  },

  // ── Text input
  textInput: {
    marginTop: 10,
    borderRadius: 14,
    paddingHorizontal: 13,
    paddingVertical: 11,
    color: TEXT,
    backgroundColor: CARD_RAISED,
    borderWidth: 1,
    borderColor: BORDER,
    fontSize: 14,
  },

  // ── Geo confirmed tag
  geoTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    padding: 8,
    borderRadius: 10,
    backgroundColor: "rgba(45,212,191,0.08)",
    borderWidth: 1,
    borderColor: "rgba(45,212,191,0.22)",
  },

  // ── Review card
  reviewCard: {
    borderRadius: 14,
    padding: 13,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD_RAISED,
  },
  reviewAvatar: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: "rgba(255,253,247,0.07)",
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
  },
  reviewFormBox: {
    marginTop: 14,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: AMBER_BORDER,
    backgroundColor: AMBER_GLASS,
  },

  // ── Comment card
  commentCard: {
    borderRadius: 14,
    padding: 13,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD_RAISED,
  },
  commentAvatar: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: "rgba(244,183,93,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 13,
    backgroundColor: TEAL,
    alignItems: "center",
    justifyContent: "center",
  },

  // ── Empty state
  emptyState: {
    alignItems: "center",
    paddingVertical: 22,
    gap: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    borderStyle: "dashed",
  },

  // ── Error banner
  errBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 14,
    padding: 13,
    borderRadius: 14,
    backgroundColor: "rgba(251,113,133,0.12)",
    borderWidth: 1,
    borderColor: "rgba(251,113,133,0.32)",
  },

  // ── Checkout bar
  checkoutBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 12,
    backgroundColor: "rgba(6,8,7,0.96)",
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  checkoutBtn: {
    borderRadius: 20,
    paddingVertical: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BRAND,
    borderWidth: 1,
    borderColor: BRAND,
  },
  checkoutBtnDisabled: {
    backgroundColor: "rgba(255,253,247,0.13)",
    borderColor: BORDER_TOP,
  },
  checkoutBtnLabel: {
    color: BG0,
    fontWeight: "900",
    fontSize: 16,
    letterSpacing: 0.2,
  },
  checkoutBtnSub: {
    color: "rgba(6,8,7,0.65)",
    fontWeight: "700",
    fontSize: 12,
    marginTop: 3,
  },

  // ── Comments bottom sheet
  commentsSheet: {
    maxHeight: "82%",
    backgroundColor: BG1,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: BORDER,
    borderBottomWidth: 0,
  },
  commentsSheetHandle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: BORDER_TOP,
    alignSelf: "center",
    marginBottom: 16,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: CARD_RAISED,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
  },
});