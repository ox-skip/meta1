// app/market/(tabs)/sell.tsx
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Linking, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import AppHeader from "@/components/common/AppHeader";
import MarketMediaView from "@/components/market/MarketMediaView";
import { generateListingAiDraft, type MarketAiDraftResult } from "@/services/market/ai";
import { getAllCategories } from "@/services/market/categories";
import { createListing, getMySellerProfile, insertListingImages, uploadToBucket } from "@/services/market/marketService";
import { supabase } from "@/services/supabase";
import { isNigeriaCountry, resolveUserCountry, type UserCountry } from "@/utils/country";
import { normalizeCountryName } from "@/utils/countryNames";
import { getCountryFx } from "@/utils/fx";
import { formatAvailabilitySummary, getCurrentLocationWithGeocode, type LocationGeo } from "@/utils/location";
import { inferMarketMediaKind } from "@/utils/marketMedia";
import { friendlyMarketError } from "@/utils/marketUx";
import { formatCurrency } from "@/utils/pricing";

const BG0 = "#060807";
const BG1 = "#10130E";
const BG2 = "#171A13";
const INK = "#090D0B";
const PURPLE = "#8B5CF6";
const TEAL = "#2DD4BF";
const AMBER = "#F4B75D";
const BLUE = "#38BDF8";
const ROSE = "#FB7185";
const CARD = "rgba(255,253,247,0.065)";
const CARD_RAISED = "rgba(255,253,247,0.09)";
const BORDER = "rgba(255,253,247,0.12)";
const BORDER_TOP = "rgba(255,253,247,0.24)";
const TEXT = "#FFFDF7";
const MUTED = "rgba(255,253,247,0.68)";
const FAINT = "rgba(255,253,247,0.44)";

type ListingMediaAsset = {
  uri: string;
  contentType: string;
  fileName?: string | null;
  fileSize?: number | null;
  webFile?: Blob | null;
};

type ListingAiDraft = MarketAiDraftResult["draft"];

type DeliveryType = "physical" | "digital" | "in_person";
type Currency = "USDC";
type MainCategory = "product" | "service";
type AvailabilityScope = "global" | "continent" | "country" | "state" | "city" | "radius";
type DurationPreset = "none" | "24h" | "3d" | "7d" | "30d" | "90d" | "custom";
type AvailabilityGeoHints = Partial<LocationGeo> & {
  state?: string;
  county?: string;
  province?: string;
  municipality?: string;
  village?: string;
};

function safeNumber(input: string) {
  const n = Number(String(input).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : NaN;
}

function ensureExtFromMime(mime: string) {
  const m = mime.toLowerCase();
  if (m.includes("mp4")) return "mp4";
  if (m.includes("quicktime") || m.includes("mov")) return "mov";
  if (m.includes("webm")) return "webm";
  if (m.includes("m4v")) return "m4v";
  if (m.includes("avi")) return "avi";
  if (m.includes("mkv")) return "mkv";
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("heic")) return "heic";
  return "jpg";
}

function inferMediaContentType(input?: string | null) {
  const raw = String(input || "").trim().toLowerCase();
  if (!raw) return "image/jpeg";
  if (raw === "video") return "video/mp4";
  if (raw === "image") return "image/jpeg";
  if (raw.includes("video/")) return raw;
  if (raw.includes("image/")) return raw;
  if (raw.endsWith(".mp4")) return "video/mp4";
  if (raw.endsWith(".mov")) return "video/quicktime";
  if (raw.endsWith(".webm")) return "video/webm";
  if (raw.endsWith(".m4v")) return "video/x-m4v";
  if (raw.endsWith(".avi")) return "video/x-msvideo";
  if (raw.endsWith(".mkv")) return "video/x-matroska";
  if (raw.endsWith(".png")) return "image/png";
  if (raw.endsWith(".webp")) return "image/webp";
  if (raw.endsWith(".heic") || raw.endsWith(".heif")) return "image/heic";
  if (raw.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

function isVideoAsset(asset?: ListingMediaAsset | null) {
  return inferMarketMediaKind(asset?.contentType) === "video";
}

function prioritizeVideoCover(items: ListingMediaAsset[]) {
  const videoIndex = items.findIndex((asset) => isVideoAsset(asset));
  if (videoIndex <= 0) return items;
  return [items[videoIndex], ...items.slice(0, videoIndex), ...items.slice(videoIndex + 1)];
}

function isValidUrl(u: string) {
  return /^https?:\/\/.+/i.test(u.trim());
}

function isListingAlreadySavedMessage(input?: string | null) {
  const raw = String(input || "").trim().toLowerCase();
  if (!raw) return false;
  return (
    raw.includes("listing created") ||
    raw.includes("listing saved") ||
    raw.includes("listing is live") ||
    raw.includes("already live")
  );
}

const BANNED_KEYWORDS = [
  "cocaine",
  "heroin",
  "fentanyl",
  "meth",
  "methamphetamine",
  "lsd",
  "ecstasy",
  "mdma",
  "xanax",
  "oxycodone",
  "codeine",
  "opioid",
  "marijuana",
  "weed",
  "drug",
  "drugs",
  "pharmacy",
  "medicine",
  "medication",
  "prescription",
];

function containsBannedContent(text: string) {
  const t = String(text || "").toLowerCase();
  return BANNED_KEYWORDS.find((w) => t.includes(w)) || null;
}

function isoFromPreset(preset: DurationPreset) {
  const now = Date.now();
  if (preset === "24h") return new Date(now + 24 * 60 * 60 * 1000).toISOString();
  if (preset === "3d") return new Date(now + 3 * 24 * 60 * 60 * 1000).toISOString();
  if (preset === "7d") return new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();
  if (preset === "30d") return new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString();
  if (preset === "90d") return new Date(now + 90 * 24 * 60 * 60 * 1000).toISOString();
  return "";
}

function uniqueLocationParts(parts: Array<string | null | undefined>) {
  return Array.from(new Set(parts.map((part) => String(part || "").trim()).filter(Boolean)));
}

function resolveAvailabilityCountry(
  name?: string | null,
  code?: string | null,
  fallbackCountry?: UserCountry | null,
) {
  const rawCode = String(code || "").trim();
  const resolvedCode = (/^[A-Za-z]{2,3}$/.test(rawCode) ? rawCode : String(fallbackCountry?.code || ""))
    .trim()
    .toUpperCase();
  const resolvedName = normalizeCountryName(
    String(name || fallbackCountry?.name || "").trim(),
    resolvedCode,
  );
  return {
    code: resolvedCode,
    name: String(resolvedName || "").trim(),
  };
}

function trimAvailabilityGeo(geo: AvailabilityGeoHints | null) {
  if (!geo) return undefined;
  const next: AvailabilityGeoHints = {
    country: String(geo.country || "").trim(),
    countryCode: String(geo.countryCode || "").trim(),
    region: String(geo.region || "").trim(),
    city: String(geo.city || "").trim(),
    subregion: String(geo.subregion || "").trim(),
    district: String(geo.district || "").trim(),
    town: String(geo.town || "").trim(),
    locality: String(geo.locality || "").trim(),
    state: String(geo.state || "").trim(),
    county: String(geo.county || "").trim(),
    province: String(geo.province || "").trim(),
    municipality: String(geo.municipality || "").trim(),
    village: String(geo.village || "").trim(),
  };
  return Object.values(next).some(Boolean) ? next : undefined;
}

function CardBox({ children, style }: any) {
  return (
    <View
      style={[
        {
          marginTop: 14,
          borderRadius: 24,
          padding: 16,
          backgroundColor: CARD,
          borderWidth: 1,
          borderTopWidth: 1,
          borderColor: BORDER,
          borderTopColor: BORDER_TOP,
          shadowColor: "#000",
          shadowOpacity: 0.14,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 10 },
          elevation: 4,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

function Label({ children }: any) {
  return (
    <Text style={{ color: MUTED, fontWeight: "900", marginTop: 12, fontSize: 11, textTransform: "uppercase" }}>
      {children}
    </Text>
  );
}

function Row({ children, style }: any) {
  return <View style={[{ flexDirection: "row", gap: 10, marginTop: 10, flexWrap: "wrap" }, style]}>{children}</View>;
}

function Input(props: any) {
  return (
    <TextInput
      {...props}
      placeholderTextColor="rgba(255,253,247,0.42)"
      style={[
        {
          marginTop: 8,
          borderRadius: 18,
          paddingHorizontal: 14,
          paddingVertical: 13,
          color: TEXT,
          backgroundColor: "rgba(9,13,11,0.52)",
          borderWidth: 1,
          borderColor: "rgba(255,253,247,0.12)",
          minHeight: props.multiline ? 92 : undefined,
          textAlignVertical: props.multiline ? "top" : "auto",
          fontWeight: "700",
        },
        props.style,
      ]}
    />
  );
}

function Pill({
  active,
  label,
  icon,
  onPress,
  disabled,
}: {
  active: boolean;
  label: string;
  icon?: any;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        flexGrow: 1,
        flexBasis: 118,
        minHeight: 48,
        borderRadius: 17,
        paddingHorizontal: 12,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 8,
        backgroundColor: active ? "rgba(45,212,191,0.15)" : "rgba(255,253,247,0.06)",
        borderWidth: 1,
        borderColor: active ? "rgba(94,234,212,0.45)" : "rgba(255,253,247,0.12)",
        opacity: disabled ? 0.55 : 1,
        transform: [{ scale: pressed && !disabled ? 0.985 : 1 }],
      })}
    >
      {icon ? <Ionicons name={icon} size={16} color={active ? TEAL : MUTED} /> : null}
      <Text style={{ color: active ? TEXT : MUTED, fontWeight: "900", fontSize: 12 }}>{label}</Text>
    </Pressable>
  );
}

function Chip({ active, label, onPress, icon }: { active: boolean; label: string; onPress: () => void; icon?: any }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        paddingHorizontal: 12,
        paddingVertical: 9,
        borderRadius: 999,
        backgroundColor: active ? "rgba(244,183,93,0.16)" : "rgba(255,253,247,0.06)",
        borderWidth: 1,
        borderColor: active ? "rgba(244,183,93,0.44)" : "rgba(255,253,247,0.12)",
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        {icon ? <Ionicons name={icon} size={12} color={active ? AMBER : MUTED} /> : null}
        <Text style={{ color: active ? TEXT : MUTED, fontWeight: "900", fontSize: 12 }}>{label}</Text>
      </View>
    </Pressable>
  );
}

function CollapsibleCardBox({ title, children, defaultOpen = false }: any) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View style={{ marginTop: 12 }}>
      <Pressable
        onPress={() => setOpen(!open)}
        style={{
          borderRadius: 24,
          padding: 16,
          backgroundColor: CARD,
          borderWidth: 1,
          borderColor: BORDER,
          borderTopColor: BORDER_TOP,
          borderTopWidth: 1,
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          shadowColor: "#000",
          shadowOpacity: 0.12,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 8 },
          elevation: 3,
        }}
      >
        <Text style={{ color: TEXT, fontWeight: "900", fontSize: 16 }}>{title}</Text>
        <Ionicons
          name={open ? "chevron-up-outline" : "chevron-down-outline"}
          size={20}
          color={MUTED}
        />
      </Pressable>
      {open ? (
        <View style={{ marginTop: 8, borderRadius: 20, padding: 16, backgroundColor: "rgba(255,253,247,0.055)", borderWidth: 1, borderColor: BORDER }}>
          {children}
        </View>
      ) : null}
    </View>
  );
}

function SectionTitle({
  title,
  subtitle,
  icon,
  tone = TEAL,
}: {
  title: string;
  subtitle?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  tone?: string;
}) {
  return (
    <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
      {icon ? (
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 14,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: `${tone}20`,
            borderWidth: 1,
            borderColor: `${tone}45`,
          }}
        >
          <Ionicons name={icon} size={17} color={tone} />
        </View>
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: TEXT, fontWeight: "900", fontSize: 16 }}>{title}</Text>
        {subtitle ? <Text style={{ marginTop: 4, color: MUTED, fontSize: 12, lineHeight: 18 }}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

function MetricTile({
  label,
  value,
  icon,
  tone = TEAL,
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
        minWidth: 108,
        borderRadius: 18,
        padding: 12,
        backgroundColor: "rgba(255,253,247,0.06)",
        borderWidth: 1,
        borderColor: `${tone}3D`,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
        <Ionicons name={icon} size={14} color={tone} />
        <Text style={{ color: MUTED, fontWeight: "900", fontSize: 11 }}>{label}</Text>
      </View>
      <Text numberOfLines={1} style={{ marginTop: 7, color: TEXT, fontWeight: "900", fontSize: 16 }}>
        {value}
      </Text>
    </View>
  );
}

function FeedbackBox({
  tone,
  title,
  message,
}: {
  tone: "error" | "success" | "info";
  title: string;
  message: string;
}) {
  const colors = {
    error: { bg: "rgba(251,113,133,0.12)", border: "rgba(251,113,133,0.36)", icon: "alert-circle-outline" as const, fg: "#FFE4E6" },
    success: { bg: "rgba(45,212,191,0.12)", border: "rgba(94,234,212,0.36)", icon: "checkmark-circle-outline" as const, fg: "#CCFBF1" },
    info: { bg: "rgba(56,189,248,0.12)", border: "rgba(125,211,252,0.36)", icon: "information-circle-outline" as const, fg: "#E0F2FE" },
  }[tone];

  return (
    <View
      style={{
        marginTop: 12,
        borderRadius: 18,
        borderWidth: 1,
        padding: 12,
        backgroundColor: colors.bg,
        borderColor: colors.border,
        flexDirection: "row",
        gap: 10,
        alignItems: "flex-start",
      }}
    >
      <Ionicons name={colors.icon} size={18} color={colors.fg} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: TEXT, fontWeight: "900" }}>{title}</Text>
        <Text style={{ marginTop: 5, color: MUTED, lineHeight: 18 }}>{message}</Text>
      </View>
    </View>
  );
}

export default function SellTab() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [checkingSeller, setCheckingSeller] = useState(true);
  const [hasSellerProfile, setHasSellerProfile] = useState(false);

  const [category, setCategory] = useState<MainCategory>("product");
  const [deliveryType, setDeliveryType] = useState<DeliveryType>("physical");

  const [subCategory, setSubCategory] = useState<string>("");
  const [subSearch, setSubSearch] = useState("");
  const [useCustomSub, setUseCustomSub] = useState(false);
  const [customSub, setCustomSub] = useState("");

  const [websiteUrl, setWebsiteUrl] = useState("");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [cryptoCoinMode, setCryptoCoinMode] = useState<"all" | "usdc" | "usdt">("all");
  const [cryptoNetworkMode, setCryptoNetworkMode] = useState<string>("all");
  const [availableNetworks, setAvailableNetworks] = useState<Array<{ chain: string; chain_id: number }>>([]);
  const [price, setPrice] = useState("");
  const [localCurrency, setLocalCurrency] = useState("NGN");
  const [fxUsdToLocal, setFxUsdToLocal] = useState<number | null>(null);
  const [fxUsdToNgn, setFxUsdToNgn] = useState<number | null>(null);
  const [fxFetchedAt, setFxFetchedAt] = useState<string | null>(null);
  const [stockMode, setStockMode] = useState<"limited" | "unlimited">("limited");
  const [stockQty, setStockQty] = useState("");
  const [discountEnabled, setDiscountEnabled] = useState(false);
  const [discountOriginalPrice, setDiscountOriginalPrice] = useState("");
  const [discountPrice, setDiscountPrice] = useState("");
  const [discountEndsAt, setDiscountEndsAt] = useState("");
  const [discountPreset, setDiscountPreset] = useState<DurationPreset>("none");
  const [autoDeleteAt, setAutoDeleteAt] = useState("");
  const [autoDeletePreset, setAutoDeletePreset] = useState<DurationPreset>("none");

  const [availabilityScope, setAvailabilityScope] = useState<AvailabilityScope>("country");
  const [availabilityContinents, setAvailabilityContinents] = useState<string[]>([]);
  const [availabilityCountryName, setAvailabilityCountryName] = useState("");
  const [availabilityCountryCode, setAvailabilityCountryCode] = useState("");
  const [availabilityState, setAvailabilityState] = useState("");
  const [availabilityCity, setAvailabilityCity] = useState("");
  const [availabilityGeoHints, setAvailabilityGeoHints] = useState<AvailabilityGeoHints | null>(null);
  const [availabilityRadiusKm, setAvailabilityRadiusKm] = useState("");
  const [availabilityCenter, setAvailabilityCenter] = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [availabilityNote, setAvailabilityNote] = useState("");
  const [userCountry, setUserCountry] = useState<UserCountry | null>(null);
  const [locatingAvailability, setLocatingAvailability] = useState(false);

  const [mediaAssets, setMediaAssets] = useState<ListingMediaAsset[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [submitFeedback, setSubmitFeedback] = useState<{ tone: "error" | "success" | "info"; title: string; message: string } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiDebug, setAiDebug] = useState<string | null>(null);
  const [aiDraft, setAiDraft] = useState<ListingAiDraft | null>(null);
  const [aiModel, setAiModel] = useState("");

  const mountedRef = useRef(true);
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const publishAttemptRef = useRef(0);
  const isWebDesktop = Platform.OS === "web" && width >= 980;
  const bottomPad = isWebDesktop ? 0 : Math.max(insets.bottom, 10);
  const floatingTabBarHeight = isWebDesktop ? 0 : 72 + bottomPad;
  const stickyPublishBottom = isWebDesktop ? Math.max(insets.bottom, 18) : floatingTabBarHeight + 22;
  const scrollBottomPadding = stickyPublishBottom + 132;
  const pagePadding = isWebDesktop ? 28 : 16;
  const contentMaxWidth = isWebDesktop ? 1120 : undefined;

  // LocalStorage key for draft
  const DRAFT_KEY = "sell_listing_draft_v1";

  // Fetch active networks from Supabase
  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase
          .from("market_chain_config")
          .select("chain, chain_id")
          .eq("active", true)
          .order("chain");
        
        if (error) throw error;
        if (data) {
          setAvailableNetworks(data);
        }
      } catch (e) {
        console.log("[SellTab] Failed to fetch networks:", e);
        // Fallback to base and arbitrum if fetch fails
        setAvailableNetworks([{ chain: "base", chain_id: 8453 }, { chain: "arbitrum", chain_id: 42161 }]);
      }
    })();
  }, []);

  // Load draft from localStorage/AsyncStorage on mount
  useEffect(() => {
    (async () => {
      try {
        let saved: string | null = null;
        
        // Try AsyncStorage first (React Native)
        if (typeof AsyncStorage !== "undefined") {
          saved = await AsyncStorage.getItem(DRAFT_KEY);
        }
        // Fallback to localStorage (web)
        else if (typeof localStorage !== "undefined") {
          saved = localStorage.getItem(DRAFT_KEY);
        }
        
        if (saved) {
          const draft = JSON.parse(saved);
          // Restore all form state
          if (draft.category) setCategory(draft.category);
          if (draft.deliveryType) setDeliveryType(draft.deliveryType);
          if (draft.subCategory) setSubCategory(draft.subCategory);
          if (draft.useCustomSub) setUseCustomSub(draft.useCustomSub);
          if (draft.customSub) setCustomSub(draft.customSub);
          if (draft.websiteUrl) setWebsiteUrl(draft.websiteUrl);
          if (draft.title) setTitle(draft.title);
          if (draft.description) setDescription(draft.description);
          if (draft.cryptoCoinMode) setCryptoCoinMode(draft.cryptoCoinMode);
          if (draft.cryptoNetworkMode) setCryptoNetworkMode(draft.cryptoNetworkMode);
          if (draft.price) setPrice(draft.price);
          if (draft.localCurrency) setLocalCurrency(draft.localCurrency);
          if (draft.stockMode) setStockMode(draft.stockMode);
          if (draft.stockQty) setStockQty(draft.stockQty);
          if (draft.discountEnabled !== undefined) setDiscountEnabled(draft.discountEnabled);
          if (draft.discountOriginalPrice) setDiscountOriginalPrice(draft.discountOriginalPrice);
          if (draft.discountPrice) setDiscountPrice(draft.discountPrice);
          if (draft.discountEndsAt) setDiscountEndsAt(draft.discountEndsAt);
          if (draft.discountPreset) setDiscountPreset(draft.discountPreset);
          if (draft.autoDeleteAt) setAutoDeleteAt(draft.autoDeleteAt);
          if (draft.autoDeletePreset) setAutoDeletePreset(draft.autoDeletePreset);
          if (draft.availabilityScope) setAvailabilityScope(draft.availabilityScope);
          if (draft.availabilityContinents) setAvailabilityContinents(draft.availabilityContinents);
          if (draft.availabilityCountryName) setAvailabilityCountryName(draft.availabilityCountryName);
          if (draft.availabilityCountryCode) setAvailabilityCountryCode(draft.availabilityCountryCode);
          if (draft.availabilityState) setAvailabilityState(draft.availabilityState);
          if (draft.availabilityCity) setAvailabilityCity(draft.availabilityCity);
          if (draft.availabilityRadiusKm) setAvailabilityRadiusKm(draft.availabilityRadiusKm);
          if (draft.availabilityNote) setAvailabilityNote(draft.availabilityNote);
          console.log("[SellTab] Restored draft from storage");
        }
      } catch (e) {
        console.log("[SellTab] Failed to restore draft:", e);
      }
    })();
  }, []);

  // Auto-save draft to AsyncStorage/localStorage (debounced)
  useEffect(() => {
    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    
    draftSaveTimerRef.current = setTimeout(() => {
      (async () => {
        try {
          const draft = {
            category,
            deliveryType,
            subCategory,
            useCustomSub,
            customSub,
            websiteUrl,
            title,
            description,
            cryptoCoinMode,
            cryptoNetworkMode,
            price,
            localCurrency,
            stockMode,
            stockQty,
            discountEnabled,
            discountOriginalPrice,
            discountPrice,
            discountEndsAt,
            discountPreset,
            autoDeleteAt,
            autoDeletePreset,
            availabilityScope,
            availabilityContinents,
            availabilityCountryName,
            availabilityCountryCode,
            availabilityState,
            availabilityCity,
            availabilityRadiusKm,
            availabilityNote,
            savedAt: new Date().toISOString(),
          };
          const draftJson = JSON.stringify(draft);
          
          // Try AsyncStorage first (React Native)
          if (typeof AsyncStorage !== "undefined") {
            await AsyncStorage.setItem(DRAFT_KEY, draftJson);
          }
          // Fallback to localStorage (web)
          else if (typeof localStorage !== "undefined") {
            localStorage.setItem(DRAFT_KEY, draftJson);
          }
        } catch (e) {
          console.log("[SellTab] Failed to save draft:", e);
        }
      })();
    }, 1000); // Save 1 second after last change

    return () => {
      if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    };
  }, [
    category, deliveryType, subCategory, useCustomSub, customSub, websiteUrl, title, description,
    cryptoCoinMode, cryptoNetworkMode, price, localCurrency, stockMode, stockQty,
    discountEnabled, discountOriginalPrice, discountPrice, discountEndsAt, discountPreset,
    autoDeleteAt, autoDeletePreset, availabilityScope, availabilityContinents,
    availabilityCountryName, availabilityCountryCode, availabilityState, availabilityCity,
    availabilityRadiusKm, availabilityNote,
  ]);

  // merge your categories + extras
  const categories = useMemo(() => {
    const base = getAllCategories();

    const extras = [
      // Products
      { main: "product", slug: "phones", title: "Phones" },
      { main: "product", slug: "computers", title: "Computers" },
      { main: "product", slug: "electronics", title: "Electronics" },
      { main: "product", slug: "fashion", title: "Fashion" },
      { main: "product", slug: "beauty", title: "Beauty" },
      { main: "product", slug: "home_kitchen", title: "Home & Kitchen" },
      { main: "product", slug: "gaming", title: "Gaming" },
      { main: "product", slug: "books", title: "Books" },
      { main: "product", slug: "sports", title: "Sports" },
      // Services
      { main: "service", slug: "web_dev", title: "Web Development" },
      { main: "service", slug: "ui_ux", title: "UI/UX Design" },
      { main: "service", slug: "graphics", title: "Graphic Design" },
      { main: "service", slug: "video_editing", title: "Video Editing" },
      { main: "service", slug: "music_audio", title: "Music / Audio" },
      { main: "service", slug: "writing", title: "Writing" },
      { main: "service", slug: "marketing", title: "Marketing" },
      { main: "service", slug: "tutoring", title: "Tutoring" },
      { main: "service", slug: "photography", title: "Photography" },
      { main: "service", slug: "consulting", title: "Consulting" },
    ] as any[];

    const merged = [...base, ...extras];

    // unique by slug+main
    const map = new Map<string, any>();
    for (const c of merged) map.set(`${c.main}:${c.slug}`, c);
    return Array.from(map.values());
  }, []);

  const availabilityContinentsList = ["Africa", "Europe", "Asia", "North America", "South America", "Oceania"];

  const visibleSubs = useMemo(() => {
    const list = categories.filter((c: any) => c.main === category);
    const q = subSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter((c: any) => (c.title || c.slug).toLowerCase().includes(q));
  }, [categories, category, subSearch]);

  const availableSubCategories = useMemo(
    () =>
      categories
        .filter((c: any) => c.main === category)
        .map((c: any) => ({ slug: String(c.slug || "").trim(), title: String(c.title || c.slug || "").trim() }))
        .filter((c: any) => c.slug && c.title),
    [categories, category],
  );

  useEffect(() => {
    setAiDraft(null);
    setAiError(null);
    setAiDebug(null);
    setAiModel("");
  }, [category, deliveryType]);

  function normalizeSubCategoryValue(value: string) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[_\s-]+/g, "");
  }

  function applyAiSubCategorySuggestion(value: string) {
    const nextValue = String(value || "").trim();
    if (!nextValue) return false;

    const normalized = normalizeSubCategoryValue(nextValue);
    const match = availableSubCategories.find((item) => {
      return (
        normalizeSubCategoryValue(item.slug) === normalized ||
        normalizeSubCategoryValue(item.title) === normalized
      );
    });

    if (match) {
      setUseCustomSub(false);
      setSubCategory(match.slug);
      setCustomSub("");
      return true;
    }

    setUseCustomSub(true);
    setSubCategory("");
    setCustomSub(nextValue);
    return true;
  }

  function applyAiDraftSuggestions() {
    if (!aiDraft) return;
    if (aiDraft.suggested_title) setTitle(aiDraft.suggested_title);
    if (aiDraft.suggested_description) setDescription(aiDraft.suggested_description);
    if (aiDraft.suggested_sub_category) applyAiSubCategorySuggestion(aiDraft.suggested_sub_category);
  }

  async function runAiListingAssistant() {
    if (aiBusy) return;

    const hasMeaningfulInput =
      !!title.trim() ||
      !!description.trim() ||
      !!websiteUrl.trim() ||
      mediaAssets.length > 0;

    if (!hasMeaningfulInput) {
      setAiError("Add at least a title, description, website URL, or media before using AI.");
      setAiDebug("AI input validation failed: no title, description, website URL, or media.");
      return;
    }

    setAiBusy(true);
    setAiError(null);
    setAiDebug(null);

    try {
      const priceValue = safeNumber(price);
      const result = await generateListingAiDraft({
        category,
        delivery_type: deliveryType,
        sub_category: finalSubCategory(),
        title: title.trim(),
        description: description.trim(),
        website_url: websiteUrl.trim(),
        price: Number.isFinite(priceValue) && priceValue > 0 ? priceValue : null,
        local_currency: localCurrency,
        media_summary: mediaAssets.map((asset) => ({
          kind: isVideoAsset(asset) ? "video" as const : "image" as const,
          content_type: asset.contentType,
          file_name: asset.fileName ?? null,
          file_size: asset.fileSize ?? null,
        })),
        available_sub_categories: availableSubCategories,
      });
      setAiDraft(result.draft);
      setAiModel(String(result.model || ""));
    } catch (error) {
      console.log("[SellTab] AI listing assistant failed", error);
      const rawMessage = String((error as any)?.message || error || "").trim();
      const status = Number((error as any)?.details?.status || 0);
      setAiDebug(rawMessage ? `status=${status || "n/a"} message=${rawMessage}` : `status=${status || "n/a"}`);
      const friendly = friendlyMarketError(error, "AI could not prepare listing suggestions right now.");

      if (status === 404 || rawMessage.toLowerCase().includes("function market-ai-draft-listing failed")) {
        setAiError("AI function is not deployed yet. Deploy the market-ai-draft-listing Supabase function first.");
      } else if (
        rawMessage &&
        (
          rawMessage.toLowerCase().includes("gemini") ||
          rawMessage.toLowerCase().includes("api key") ||
          rawMessage.toLowerCase().includes("billing") ||
          rawMessage.toLowerCase().includes("quota") ||
          rawMessage.toLowerCase().includes("rate limit") ||
          rawMessage.toLowerCase().includes("model") ||
          rawMessage.toLowerCase().includes("configured") ||
          rawMessage.toLowerCase().includes("deploy")
        )
      ) {
        setAiError(rawMessage);
      } else {
        setAiError(friendly);
      }
    } finally {
      setAiBusy(false);
    }
  }

  // Defaults when switching type
  useEffect(() => {
    if (category === "product") {
      setDeliveryType("physical");
      setStockMode((prev) => (prev === "unlimited" ? "unlimited" : "limited"));
    } else {
      // services: default digital
      setDeliveryType("digital");
      setStockMode("unlimited");
    }

    setUseCustomSub(false);
    setCustomSub("");
    setSubSearch("");

    const first = categories.filter((c: any) => c.main === category)[0]?.slug ?? "";
    setSubCategory(first);
  }, [category]); // eslint-disable-line

  // ✅ seller check
  useEffect(() => {
    mountedRef.current = true;

    (async () => {
      setCheckingSeller(true);
      try {
        const { data: auth } = await supabase.auth.getUser();
        const user = auth?.user;
        if (!user) {
          if (mountedRef.current) {
            setHasSellerProfile(false);
            setCheckingSeller(false);
          }
          router.replace("/(auth)/login" as any);
          return;
        }

        try {
          const prof = await getMySellerProfile();
          if (mountedRef.current) setHasSellerProfile(!!prof?.user_id);
        } catch {
          const { data } = await supabase.from("market_seller_profiles").select("user_id,active").eq("user_id", user.id).maybeSingle();
          if (mountedRef.current) setHasSellerProfile(!!data && (data as any)?.active !== false);
        }
      } catch {
        if (mountedRef.current) {
          setHasSellerProfile(false);
        }
      } finally {
        if (mountedRef.current) setCheckingSeller(false);
      }
    })();

    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const c = await resolveUserCountry({ prompt: true });
        if (!mounted) return;
        setUserCountry(c);
        
        // Always populate availability fields if country is resolved, 
        // even if FX fails - this fixes the issue for non-Nigeria countries
        if (c) {
          if (!availabilityCountryName && !availabilityCountryCode) {
            setAvailabilityCountryName(normalizeCountryName(c.name, c.code));
            setAvailabilityCountryCode(String(c.code || ""));
          }
        }

        try {
          const fx = await getCountryFx(c);
          if (!mounted) return;
          setLocalCurrency(String(fx.localCurrency || "USD").toUpperCase());
          setFxUsdToLocal(fx.usdToLocal);
          setFxUsdToNgn(fx.usdToNgn);
          setFxFetchedAt(fx.fetchedAt);

          if (c) {
            // Set currency to NGN for Nigeria users
            if (isNigeriaCountry(c.code || c.name)) {
              setLocalCurrency("NGN");
            }
          }
        } catch (fxError) {
          // If FX fetch fails, fallback to USD - but keep the country info intact
          if (mounted) {
            setLocalCurrency("USD");
            setFxUsdToLocal(1);
            setFxUsdToNgn(null);
            setFxFetchedAt(null);
          }
          console.log("[SellTab] FX fetch failed, using fallback values:", fxError);
        }
      } catch (countryError) {
        if (mounted) {
          setUserCountry(null);
          setLocalCurrency("USD");
          setFxUsdToLocal(1);
          setFxUsdToNgn(null);
          setFxFetchedAt(null);
        }
        console.log("[SellTab] Country resolution failed:", countryError);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  async function pickMedia() {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return Alert.alert("Permission needed", "Allow photo/video access to upload listing media.");

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.All,
        allowsMultipleSelection: true,
        selectionLimit: 8,
        quality: 0.85,
      });

      if (result.canceled) return;

      const picked = (result.assets ?? [])
        .filter((a: any) => !!a?.uri)
        .map((a: any) => {
          const contentType = inferMediaContentType(
            a.mimeType || (a as any).type || (a as any).fileName || a.uri,
          );
          return {
            uri: a.uri,
            contentType,
            fileName: String((a as any).fileName || "").trim() || null,
            fileSize: Number((a as any).fileSize ?? (a as any).file?.size ?? 0) || null,
            webFile: Platform.OS === "web" ? ((a as any).file ?? null) : null,
          };
        })
        .filter((asset: ListingMediaAsset) => {
          const kind = inferMarketMediaKind(asset.contentType);
          return kind === "image" || kind === "video";
        });

      if (!picked.length) return;

      setMediaAssets((prev) => {
        const merged = [...prev, ...picked];
        const seen = new Set<string>();
        const deduped = merged
          .filter((img) => {
            const key = `${img.uri}|${img.fileName || ""}|${img.fileSize || 0}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        return prioritizeVideoCover(deduped).slice(0, 8);
      });
    } catch (e: any) {
      Alert.alert("Try again", friendlyMarketError(e, "We couldn't add your selected media."));
    }
  }

  function removeMedia(idx: number) {
    setMediaAssets((prev) => prioritizeVideoCover(prev.filter((_, i) => i !== idx)));
  }

  function finalSubCategory() {
    if (useCustomSub) return customSub.trim().toLowerCase().replace(/\s+/g, "_").slice(0, 40);
    return subCategory;
  }

  function clearAvailabilityGeoHints() {
    setAvailabilityGeoHints(null);
  }

  function onAvailabilityCountryNameChange(value: string) {
    clearAvailabilityGeoHints();
    setAvailabilityCountryName(value);
  }

  function onAvailabilityCountryCodeChange(value: string) {
    clearAvailabilityGeoHints();
    setAvailabilityCountryCode(value);
  }

  function onAvailabilityStateChange(value: string) {
    clearAvailabilityGeoHints();
    setAvailabilityState(value);
  }

  function onAvailabilityCityChange(value: string) {
    clearAvailabilityGeoHints();
    setAvailabilityCity(value);
  }

  async function fillAvailabilityFromLocation() {
    setLocatingAvailability(true);
    try {
      const res = await getCurrentLocationWithGeocode();
      const normalizedCountryName = normalizeCountryName(res.geo.country || "", res.geo.countryCode || "");
      const nextGeo: AvailabilityGeoHints = {
        country: normalizedCountryName,
        countryCode: res.geo.countryCode || "",
        region: res.geo.region || "",
        city: res.geo.city || "",
        subregion: res.geo.subregion || "",
        district: res.geo.district || "",
        town: res.geo.town || "",
        locality: res.geo.locality || "",
      };
      setAvailabilityCenter({ lat: res.coords.lat, lng: res.coords.lng, label: res.label });
      setAvailabilityCountryName(normalizedCountryName);
      setAvailabilityCountryCode(res.geo.countryCode || "");
      setAvailabilityState(nextGeo.region || nextGeo.subregion || nextGeo.district || "");
      setAvailabilityCity(nextGeo.city || nextGeo.town || nextGeo.locality || nextGeo.district || nextGeo.subregion || "");
      setAvailabilityGeoHints(nextGeo);
      if (availabilityScope === "radius" && !availabilityRadiusKm.trim()) {
        setAvailabilityRadiusKm("10");
      }
    } catch (e: any) {
      const msg = friendlyMarketError(e, "We couldn't access your location.");
      Alert.alert("Location error", msg);
    } finally {
      setLocatingAvailability(false);
    }
  }

  function applyDiscountPreset(preset: DurationPreset) {
    setDiscountPreset(preset);
    setDiscountEndsAt(preset === "custom" ? discountEndsAt : isoFromPreset(preset));
  }

  function applyAutoDeletePreset(preset: DurationPreset) {
    setAutoDeletePreset(preset);
    setAutoDeleteAt(preset === "custom" ? autoDeleteAt : isoFromPreset(preset));
  }

  // Calculate discount percentage
  function getDiscountPercent(): number {
    if (!discountEnabled) return 0;
    const op = safeNumber(discountOriginalPrice);
    const dp = safeNumber(discountPrice);
    if (!Number.isFinite(op) || op <= 0 || !Number.isFinite(dp) || dp <= 0) return 0;
    return (op - dp) / op * 100;
  }

  function buildAvailability() {
    const resolvedCountry = resolveAvailabilityCountry(
      availabilityCountryName,
      availabilityCountryCode,
      userCountry,
    );
    const radius = availabilityScope === "radius" ? safeNumber(availabilityRadiusKm) : NaN;
    const center = availabilityCenter ?? { lat: 0, lng: 0, label: "" };
    const geo = trimAvailabilityGeo(availabilityGeoHints);
    const stateAliases = uniqueLocationParts([
      availabilityState,
      geo?.region,
      geo?.state,
      geo?.province,
      geo?.county,
      geo?.subregion,
      geo?.district,
      geo?.municipality,
    ]);
    const cityAliases = uniqueLocationParts([
      availabilityCity,
      geo?.city,
      geo?.town,
      geo?.locality,
      geo?.village,
      geo?.municipality,
      geo?.district,
      geo?.subregion,
    ]);
    const out: any = {
      scope: availabilityScope,
      continents: availabilityContinents,
      country: { name: resolvedCountry.name, code: resolvedCountry.code },
      state: availabilityState.trim(),
      city: availabilityCity.trim(),
      radiusKm: Number.isFinite(radius) ? radius : 0,
      center,
      note: availabilityNote.trim(),
    };
    if (stateAliases.length > 0) out.stateAliases = stateAliases;
    if (cityAliases.length > 0) out.cityAliases = cityAliases;
    if (geo) out.geo = geo;
    return out;
  }

  function validate(): string | null {
    const resolvedCountry = resolveAvailabilityCountry(
      availabilityCountryName,
      availabilityCountryCode,
      userCountry,
    );
    const t = title.trim();
    if (!t) return "Title is required";
    const bad = containsBannedContent(`${title} ${description}`);
    if (bad) return `This marketplace does not allow drugs or medical products. Remove: ${bad}`;

    const sc = finalSubCategory();
    if (!sc) return "Pick a sub-category (or type one in Other)";

    const p = safeNumber(price);
    if (!Number.isFinite(p) || p <= 0) return "Enter a valid price";
    if (discountEnabled) {
      const dp = safeNumber(discountPrice);
      if (!Number.isFinite(dp) || dp <= 0) return "Discounted price (final selling price) must be valid";
      
      // Original price is optional - only validate if provided
      const op = safeNumber(discountOriginalPrice);
      if (discountOriginalPrice.trim()) {
        if (!Number.isFinite(op) || op <= 0) return "Original price must be valid";
        if (dp >= op) return "Discounted price must be strictly lower than original price";
        const discountPercent = ((op - dp) / op * 100).toFixed(1);
        // Warn if discount is unusually high (>90%)
        if (Number(discountPercent) > 90) {
          return `Discount is very high (${discountPercent}%). Reduce discount or increase original price.`;
        }
      }
      // Validate discount end time if custom preset
      if (discountPreset === "custom" && discountEndsAt.trim()) {
        const endDate = new Date(discountEndsAt.trim());
        if (isNaN(endDate.getTime())) {
          return "Invalid discount end date format. Use ISO format (e.g., 2026-12-31T23:59:59Z)";
        }
        if (endDate <= new Date()) {
          return "Discount end date must be in the future";
        }
      }
    }

    if (category === "product") {
      if (stockMode === "limited") {
        const q = safeNumber(stockQty);
        if (!Number.isFinite(q) || q <= 0) return "Stock is required and must be at least 1";
      }
    }

    // media requirements:
    // - product: require at least 1 image/video
    // - service: require either at least 1 image/video OR website URL (for digital)
    if (category === "product" && mediaAssets.length === 0) return "Add at least 1 image or video";
    if (category === "service") {
      if (deliveryType === "digital") {
        if (mediaAssets.length === 0 && !websiteUrl.trim()) return "Add an image or video OR provide a website URL";
        if (websiteUrl.trim() && !isValidUrl(websiteUrl)) return "Website URL must start with https://";
      } else {
        if (mediaAssets.length === 0) return "Add at least 1 image or video";
      }
    }

    if (availabilityScope === "continent" && availabilityContinents.length === 0) return "Pick at least one continent";
    if (availabilityScope === "country" && !resolvedCountry.name && !resolvedCountry.code) return "Country is required";
    if (availabilityScope === "state" && (!availabilityState.trim() || (!resolvedCountry.name && !resolvedCountry.code))) {
      return "Area and country are required";
    }
    if (availabilityScope === "city" && (!availabilityCity.trim() || (!resolvedCountry.name && !resolvedCountry.code))) {
      return "Local area and country are required";
    }
    if (availabilityScope === "radius") {
      const r = safeNumber(availabilityRadiusKm);
      if (!availabilityCenter) return "Pick a center location for your radius";
      if (!Number.isFinite(r) || r <= 0) return "Radius must be greater than 0 km";
    }

    return null;
  }

  function showFeedback(tone: "error" | "success" | "info", title: string, message: string) {
    setSubmitFeedback({ tone, title, message });
    if (Platform.OS !== "web") {
      Alert.alert(title, message);
    }
  }

  function triggerPublish(source: "press" | "pressIn") {
    const now = Date.now();
    if (submitting) return;
    if (Platform.OS === "web" && source === "press" && now - publishAttemptRef.current < 800) {
      return;
    }
    publishAttemptRef.current = now;
    void onSubmit();
  }

  async function onSubmit() {
    if (submitting) return;
    setSubmitFeedback(null);
    const err = validate();
    if (err) {
      showFeedback("error", "Fix this", err);
      return;
    }

    console.log("[SellTab] submit start");
    setSubmitting(true);
    setStage(null);

    try {
      const { data: auth, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw authErr;
      const user = auth?.user;
      if (!user) return router.replace("/(auth)/login" as any);

      const enteredPriceLocal = safeNumber(price);
      if (!Number.isFinite(enteredPriceLocal) || enteredPriceLocal <= 0) {
        throw new Error("Enter a valid price.");
      }
      if (!fxUsdToLocal || fxUsdToLocal <= 0) {
        throw new Error("FX is not ready. Please wait and try again.");
      }
      const qty =
        category === "product" && stockMode === "limited" && stockQty.trim()
          ? Math.max(0, Math.floor(safeNumber(stockQty)))
          : null;
      
      // Determine base currency and listing price based on location
      const isNigeria = userCountry && isNigeriaCountry(userCountry.code || userCountry.name);
      const baseCurrency: "NGN" | "USD" = isNigeria ? "NGN" : "USD";
      const listingCurrency: Currency = "USDC";
      
      const toUsd = (valueLocal: number) => valueLocal / fxUsdToLocal;
      const toNgn = (valueLocal: number) => {
        if (!isNigeria) return NaN; // Only calculate NGN for Nigeria users
        return valueLocal;
      };

      // If discount is enabled, use discounted price as the main price
      const effectivePrice = discountEnabled ? safeNumber(discountPrice) : enteredPriceLocal;
      const finalPrice = effectivePrice;
      const finalPriceUsd = toUsd(finalPrice);
      const finalPriceNgn = isNigeria ? finalPrice : null;
      const originalLocalPrice =
        discountEnabled && discountOriginalPrice.trim() && Number.isFinite(safeNumber(discountOriginalPrice))
          ? safeNumber(discountOriginalPrice)
          : finalPrice;
      const originalPriceUsd = toUsd(originalLocalPrice);
      const originalPriceNgn = isNigeria ? originalLocalPrice : null;
      
      const safeFinalPriceLocal = Number(finalPrice.toFixed(2));
      const safeFinalPriceNgn = Number.isFinite(Number(finalPriceNgn))
        ? Number(Number(finalPriceNgn).toFixed(2))
        : null;
      const safeFinalPriceUsd = Number.isFinite(finalPriceUsd) ? Number(finalPriceUsd.toFixed(6)) : null;
      const safeOriginalPriceLocal = Number.isFinite(originalLocalPrice) ? Number(originalLocalPrice.toFixed(2)) : safeFinalPriceLocal;
      const safeOriginalPriceUsd = Number.isFinite(originalPriceUsd) ? Number(originalPriceUsd.toFixed(6)) : safeFinalPriceUsd;
      const safeOriginalPriceNgn = Number.isFinite(Number(originalPriceNgn))
        ? Number(Number(originalPriceNgn).toFixed(2))
        : safeFinalPriceNgn;
      let unitPrice = finalPriceUsd;

      const paymentOptions = {
        allow_crypto: true,
        allow_usdc: cryptoCoinMode === "all" || cryptoCoinMode === "usdc",
        allow_usdt: cryptoCoinMode === "all" || cryptoCoinMode === "usdt",
        allow_pi: false,
        chain_mode: cryptoNetworkMode,
        coin_mode: cryptoCoinMode,
        pi_mode: "off",
        stock_mode: category === "product" ? stockMode : "unlimited",
        out_of_stock: false,
        base_currency: baseCurrency,
        fx_rate_ngn_per_usd: isNigeria && fxUsdToNgn ? fxUsdToNgn : null,
        fx: {
          source: "open.er-api.com",
          fetched_at: fxFetchedAt,
          local_currency: localCurrency,
          country_code: userCountry?.code ?? null,
          usd_to_local: fxUsdToLocal,
          local_to_usd: 1 / fxUsdToLocal,
          usd_to_ngn: isNigeria && fxUsdToNgn ? fxUsdToNgn : null,
        },
        price_book: {
          local_currency: localCurrency,
          local: safeFinalPriceLocal,
          ngn: safeFinalPriceNgn,
          usd: safeFinalPriceUsd,
        },
        discount: {
          enabled: discountEnabled,
          originalPrice: safeOriginalPriceUsd,
          discountedPrice: unitPrice,
          baseCurrency,
          localCurrency,
          originalPriceLocal: safeOriginalPriceLocal,
          discountedPriceLocal: safeFinalPriceLocal,
          originalPriceNgn: safeOriginalPriceNgn,
          discountedPriceNgn: safeFinalPriceNgn,
          originalPriceUsd: safeOriginalPriceUsd,
          discountedPriceUsd: safeFinalPriceUsd,
          startsAt: new Date().toISOString(),
          endsAt: discountEnabled && discountEndsAt.trim() ? new Date(discountEndsAt.trim()).toISOString() : null,
        },
        expires_at: autoDeleteAt.trim() ? new Date(autoDeleteAt.trim()).toISOString() : null,
      };
      await submitListing({
        user,
        listingCurrency,
        qty,
        unitPrice,
        paymentOptions,
      });
      return;
    } catch (e: any) {
      const rawMsg = String(e?.message || e || "").trim();
      const msg = friendlyMarketError(e, "We couldn't complete this request right now.");
      const errStr = rawMsg.toLowerCase();

      if (isListingAlreadySavedMessage(rawMsg)) {
        showFeedback("info", "Listing saved", rawMsg || msg);
      } else if (errStr.includes("row-level security") || errStr.includes("permission")) {
        showFeedback("error", "Permission issue", "Your database permissions blocked this listing insert.");
      } else if (
        errStr.includes("network request failed") ||
        errStr.includes("failed to fetch") ||
        errStr.includes("network") ||
        errStr.includes("timeout")
      ) {
        showFeedback("error", "Connection issue", "Please check your internet connection and try again.");
      } else {
        showFeedback("error", "Failed to create listing", msg);
      }
    } finally {
      setSubmitting(false);
      setStage(null);
      console.log("[SellTab] submit end");
    }
  }

  async function submitListing({
    user,
    listingCurrency,
    qty,
    unitPrice,
    paymentOptions,
  }: {
    user: any;
    listingCurrency: Currency;
    qty: number | null;
    unitPrice: number;
    paymentOptions: any;
  }) {
    const finalDesc = description.trim() || null;
    const availability = buildAvailability();
    let imageWarning: string | null = null;

    // Step 1: Create the listing first (always allow this to succeed)
    console.log("[SellTab] createListing -> start");
    setStage("Creating listing...");
    let listing: any;
    try {
      listing = await createListing({
        seller_id: user.id,
        category,
        sub_category: finalSubCategory(),
        delivery_type: deliveryType,
        title: title.trim(),
        description: finalDesc,
        price_amount: unitPrice,
        currency: listingCurrency,
        stock_qty: category === "product" ? qty : null,
        availability,
        payment_options: paymentOptions,
        ...(category === "service" && deliveryType === "digital" && websiteUrl.trim()
          ? { website_url: websiteUrl.trim() }
          : {}),
        is_active: true,
      } as any);
      console.log("[SellTab] createListing -> ok", listing?.id ?? "no-id");

      if (!listing?.id) throw new Error("Listing creation failed (missing id)");
    } catch (listingErr: any) {
      console.error("[SellTab] createListing failed", listingErr);
      throw new Error(`Failed to create listing: ${listingErr?.message || "Unknown error"}`);
    }

    // Step 2: Upload media if present (failures here don't prevent listing creation)
    if (mediaAssets.length > 0) {
      console.log("[SellTab] upload media -> start", { count: mediaAssets.length });
      setStage("Uploading media...");
      const inserts: any[] = [];
      const mediaIssues: string[] = [];
      let attachedCount = 0;

      for (let i = 0; i < mediaAssets.length; i++) {
        const img = mediaAssets[i];
        const ext = ensureExtFromMime(img.contentType);
        const random =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? (crypto as any).randomUUID()
            : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

        const path = `${user.id}/listings/${listing.id}/${i + 1}-${random}.${ext}`;

        try {
          console.log("[SellTab] upload media -> start", { index: i, path });
          const up = await uploadToBucket({
            bucket: "market-listings",
            path,
            uri: img.uri,
            fileBody: img.webFile ?? null,
            contentType: img.contentType,
            upsert: false,
          });
          console.log("[SellTab] upload media -> ok", { index: i, storagePath: up.storagePath });

          inserts.push({
            listing_id: listing.id,
            storage_path: up.storagePath,
            public_url: up.publicUrl ?? null,
            sort_order: i,
            meta: { content_type: img.contentType },
          });
        } catch (imgUploadErr: any) {
          console.error("[SellTab] single media upload failed", { index: i, error: imgUploadErr });
          mediaIssues.push(
            `Media item ${i + 1} failed: ${friendlyMarketError(
              imgUploadErr,
              "We couldn't upload that file.",
            )}`,
          );
        }
      }

      if (inserts.length > 0) {
        try {
          console.log("[SellTab] insertListingImages -> start", { count: inserts.length });
          setStage("Saving media...");
          const rows = await insertListingImages(inserts, { activateListing: false });
          attachedCount = rows?.length ?? 0;
          console.log("[SellTab] insertListingImages -> ok", { count: attachedCount });

          const unattachedCount = Math.max(inserts.length - attachedCount, 0);
          if (unattachedCount > 0) {
            mediaIssues.push(
              `${unattachedCount} uploaded media item${unattachedCount === 1 ? "" : "s"} could not be attached to the listing.`,
            );
          }
        } catch (imageErr: any) {
          const partialRows = Array.isArray(imageErr?.partialRows) ? imageErr.partialRows : [];
          attachedCount = partialRows.length;
          setStage("Finalizing listing...");

          const failedAttachCount = Math.max(inserts.length - attachedCount, 0);
          const attachMessage = friendlyMarketError(
            imageErr,
            "Uploaded media could not be attached to the listing.",
          );

          if (failedAttachCount > 0) {
            mediaIssues.push(
              failedAttachCount === inserts.length
                ? `Uploaded media could not be attached to the listing. ${attachMessage}`
                : `${failedAttachCount} uploaded media item${failedAttachCount === 1 ? "" : "s"} could not be attached to the listing. ${attachMessage}`,
            );
          } else {
            mediaIssues.push(attachMessage);
          }
        }
      }

      if (mediaIssues.length > 0) {
        const firstIssue = mediaIssues[0];
        if (attachedCount > 0) {
          imageWarning =
            `Your listing is live, and ${attachedCount}/${mediaAssets.length} media item${attachedCount === 1 ? "" : "s"} ` +
            `${attachedCount === 1 ? "is" : "are"} attached. Open My Listings to add the rest.\n\nFirst issue: ${firstIssue}`;
        } else {
          imageWarning =
            "Your listing is live, but none of the selected media are attached yet. Open My Listings to try again." +
            `\n\nFirst issue: ${firstIssue}`;
        }
      }
    }

    const successMsg = imageWarning || (mediaAssets.length > 0 ? "Your listing is live with all media!" : "Your listing is live!");
    showFeedback(imageWarning ? "info" : "success", imageWarning ? "Listing saved" : "Posted", successMsg);
    const nextCountry = resolveAvailabilityCountry("", "", userCountry);
    
    // Clear form state
    setTitle("");
    setDescription("");
    setWebsiteUrl("");
    setPrice("");
    setStockMode("limited");
    setStockQty("");
    setMediaAssets([]);
    setUseCustomSub(false);
    setCustomSub("");
    setAvailabilityScope("country");
    setAvailabilityContinents([]);
    setAvailabilityCountryName(nextCountry.name);
    setAvailabilityCountryCode(nextCountry.code);
    setAvailabilityState("");
    setAvailabilityCity("");
    setAvailabilityGeoHints(null);
    setAvailabilityRadiusKm("");
    setAvailabilityCenter(null);
    setAvailabilityNote("");
    setStage(null);
    
    // Clear localStorage draft
    try {
      if (typeof AsyncStorage !== "undefined") {
        await AsyncStorage.removeItem(DRAFT_KEY);
      } else if (typeof localStorage !== "undefined") {
        localStorage.removeItem(DRAFT_KEY);
      }
      console.log("[SellTab] Draft cleared after successful publish");
    } catch (e) {
      console.log("[SellTab] Failed to clear draft:", e);
    }

    router.push("/market/(tabs)" as any);
  }

  const liveLocalInput = safeNumber(price);
  const liveUsdApprox =
    Number.isFinite(liveLocalInput) && liveLocalInput > 0 && fxUsdToLocal && fxUsdToLocal > 0
      ? liveLocalInput / fxUsdToLocal
      : NaN;
  const liveOriginalLocal = safeNumber(discountOriginalPrice);
  const liveDiscountedLocal = safeNumber(discountPrice);
  const liveOriginalUsd =
    Number.isFinite(liveOriginalLocal) && liveOriginalLocal > 0 && fxUsdToLocal && fxUsdToLocal > 0
      ? liveOriginalLocal / fxUsdToLocal
      : NaN;
  const liveDiscountedUsd =
    Number.isFinite(liveDiscountedLocal) && liveDiscountedLocal > 0 && fxUsdToLocal && fxUsdToLocal > 0
      ? liveDiscountedLocal / fxUsdToLocal
      : NaN;
  const selectedSubCategory = finalSubCategory();
  const selectedSubCategoryTitle =
    categories.find((c: any) => c.main === category && String(c.slug) === selectedSubCategory)?.title ||
    selectedSubCategory ||
    "Not selected";
  const mediaRequirementMet =
    mediaAssets.length > 0 || (category === "service" && deliveryType === "digital" && isValidUrl(websiteUrl));
  const readyChecks = [
    !!title.trim(),
    !!selectedSubCategory,
    Number.isFinite(liveLocalInput) && liveLocalInput > 0,
    mediaRequirementMet,
  ];
  const readyCount = readyChecks.filter(Boolean).length;
  const readinessPercent = Math.round((readyCount / readyChecks.length) * 100);
  const listingModeLabel =
    category === "product"
      ? "Physical product"
      : deliveryType === "digital"
      ? "Digital service"
      : "In-person service";
  const pricePreview =
    Number.isFinite(liveLocalInput) && liveLocalInput > 0
      ? formatCurrency(localCurrency, liveLocalInput)
      : "No price";

  function renderSellHero() {
    return (
      <LinearGradient
        colors={[`${category === "product" ? BLUE : TEAL}22`, "rgba(244,183,93,0.08)", "rgba(255,253,247,0.055)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          marginTop: 12,
          borderRadius: 28,
          padding: isWebDesktop ? 24 : 16,
          borderWidth: 1,
          borderColor: "rgba(255,253,247,0.16)",
          overflow: "hidden",
          shadowColor: "#000",
          shadowOpacity: 0.22,
          shadowRadius: 24,
          shadowOffset: { width: 0, height: 16 },
          elevation: 7,
        }}
      >
        <View style={{ flexDirection: isWebDesktop ? "row" : "column", gap: 18, alignItems: "stretch" }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              <Chip
                active
                label={listingModeLabel}
                icon={category === "product" ? "cube-outline" : deliveryType === "digital" ? "cloud-outline" : "walk-outline"}
                onPress={() => {}}
              />
              <Chip
                active={mediaRequirementMet}
                label={mediaRequirementMet ? "Media ready" : "Needs media"}
                icon={mediaRequirementMet ? "checkmark-circle-outline" : "images-outline"}
                onPress={() => {}}
              />
            </View>

            <Text style={{ marginTop: 14, color: TEXT, fontWeight: "900", fontSize: isWebDesktop ? 34 : 26, lineHeight: isWebDesktop ? 40 : 32 }}>
              Build a listing buyers can trust.
            </Text>
            <Text style={{ marginTop: 8, color: MUTED, lineHeight: 21, maxWidth: 680 }}>
              Add clear details, set where buyers can purchase, attach proof media, and publish through escrow-backed checkout.
            </Text>

            <View style={{ marginTop: 16, height: 8, borderRadius: 999, backgroundColor: "rgba(255,253,247,0.10)", overflow: "hidden" }}>
              <View style={{ width: `${readinessPercent}%`, height: "100%", borderRadius: 999, backgroundColor: readyCount === readyChecks.length ? TEAL : AMBER }} />
            </View>
            <Text style={{ marginTop: 8, color: MUTED, fontSize: 12, fontWeight: "800" }}>
              {readyCount}/{readyChecks.length} publish basics complete
            </Text>
          </View>

          <View style={{ width: isWebDesktop ? 360 : undefined, gap: 10 }}>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <MetricTile label="Type" value={category === "product" ? "Product" : "Service"} icon="storefront-outline" tone={category === "product" ? BLUE : TEAL} />
              <MetricTile label="Price" value={pricePreview} icon="pricetag-outline" tone={AMBER} />
            </View>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <MetricTile label="Category" value={selectedSubCategoryTitle} icon="grid-outline" tone={PURPLE} />
              <MetricTile label="Media" value={mediaAssets.length ? `${mediaAssets.length} items` : "Empty"} icon="images-outline" tone={TEAL} />
            </View>
          </View>
        </View>
      </LinearGradient>
    );
  }

  if (checkingSeller) {
    return (
      <LinearGradient colors={[BG2, BG1, BG0]} style={{ flex: 1, paddingHorizontal: pagePadding, paddingTop: 14 }}>
        <View style={{ alignSelf: "center", width: "100%", maxWidth: contentMaxWidth }}>
          <AppHeader
            title="Sell"
            subtitle="Products, services, escrow, and media in one flow"
            bordered={false}
            style={{ backgroundColor: "transparent", paddingHorizontal: 0 }}
          />
          <CardBox style={{ marginTop: 60, alignItems: "center", paddingVertical: 28 }}>
            <ActivityIndicator color={TEAL} />
            <Text style={{ marginTop: 12, color: MUTED, fontWeight: "900" }}>Checking seller profile...</Text>
          </CardBox>
        </View>
      </LinearGradient>
    );
  }

  if (!hasSellerProfile) {
    return (
      <LinearGradient colors={[BG2, BG1, BG0]} style={{ flex: 1, paddingHorizontal: pagePadding, paddingTop: 14 }}>
        <View style={{ alignSelf: "center", width: "100%", maxWidth: contentMaxWidth }}>
          <AppHeader
            title="Sell"
            subtitle="Create your seller identity before publishing"
            bordered={false}
            style={{ backgroundColor: "transparent", paddingHorizontal: 0 }}
          />
          <LinearGradient
            colors={["rgba(45,212,191,0.18)", "rgba(244,183,93,0.08)", "rgba(255,253,247,0.055)"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ marginTop: 34, borderRadius: 28, padding: 20, borderWidth: 1, borderColor: "rgba(255,253,247,0.16)" }}
          >
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: 18,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "rgba(45,212,191,0.16)",
                borderWidth: 1,
                borderColor: "rgba(94,234,212,0.36)",
              }}
            >
              <Ionicons name="storefront-outline" size={22} color={TEAL} />
            </View>
            <Text style={{ marginTop: 14, color: TEXT, fontSize: 26, lineHeight: 32, fontWeight: "900" }}>Start selling with a public profile</Text>
            <Text style={{ marginTop: 8, color: MUTED, lineHeight: 21 }}>
              You need a Market Profile before posting listings. It gives buyers a storefront, username, verification context, and a place to inspect your business.
            </Text>

            <Pressable
              onPress={() => router.push("/market/profile/create" as any)}
              style={({ pressed }) => ({
                marginTop: 18,
                borderRadius: 18,
                paddingVertical: 14,
                alignItems: "center",
                backgroundColor: TEAL,
                borderWidth: 1,
                borderColor: "rgba(94,234,212,0.8)",
                transform: [{ scale: pressed ? 0.985 : 1 }],
              })}
            >
              <Text style={{ color: INK, fontWeight: "900" }}>Create Market Profile</Text>
            </Pressable>
          </LinearGradient>
        </View>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient colors={[BG2, BG1, BG0]} start={{ x: 0.15, y: 0 }} end={{ x: 0.9, y: 1 }} style={{ flex: 1, paddingHorizontal: pagePadding, paddingTop: 14 }}>
      <View style={{ alignSelf: "center", width: "100%", maxWidth: contentMaxWidth }}>
        <AppHeader
          title="Sell"
          subtitle="Create escrow-ready products and services"
          bordered={false}
          style={{ backgroundColor: "transparent", paddingHorizontal: 0 }}
        />
      </View>
      <ScrollView
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingBottom: scrollBottomPadding, alignSelf: "center", width: "100%", maxWidth: contentMaxWidth }}
      >
        {renderSellHero()}

        <CardBox>
          <SectionTitle
            title="Listing setup"
            subtitle="Choose the selling mode first. The rest of the form adapts to products, digital work, or in-person services."
            icon="options-outline"
            tone={category === "product" ? BLUE : TEAL}
          />
          <Row>
            <Pill active={category === "product"} label="Product" icon="cube-outline" onPress={() => setCategory("product")} />
            <Pill active={category === "service"} label="Service" icon="sparkles-outline" onPress={() => setCategory("service")} />
          </Row>

          <Label>Delivery</Label>
          <Row>
            <Pill active={deliveryType === "physical"} label="Physical" icon="car-outline" disabled={category !== "product"} onPress={() => setDeliveryType("physical")} />
            <Pill active={deliveryType === "digital"} label="Digital" icon="cloud-outline" disabled={category !== "service"} onPress={() => setDeliveryType("digital")} />
            <Pill active={deliveryType === "in_person"} label="In-person" icon="walk-outline" disabled={category !== "service"} onPress={() => setDeliveryType("in_person")} />
          </Row>

          {category === "service" && deliveryType === "digital" ? (
            <>
              <Label>Portfolio / demo URL (optional)</Label>
              <Input value={websiteUrl} onChangeText={setWebsiteUrl} placeholder="https://example.com" autoCapitalize="none" />
              <Text style={{ marginTop: 8, color: MUTED, fontSize: 12, lineHeight: 18 }}>
                Optional public website, product demo, portfolio, or prototype link buyers can preview before purchase.
              </Text>
            </>
          ) : null}
        </CardBox>

        <CollapsibleCardBox title="Category" defaultOpen={true}>

          <Label>Search sub-categories</Label>
          <Input value={subSearch} onChangeText={setSubSearch} placeholder="Search... (e.g. phones, design)" />

          <Row style={{ flexWrap: "wrap" }}>
            {visibleSubs.slice(0, 8).map((c: any) => (
              <Chip key={`${c.main}:${c.slug}`} active={!useCustomSub && subCategory === c.slug} label={c.title} onPress={() => { setUseCustomSub(false); setSubCategory(c.slug); }} />
            ))}
            {visibleSubs.length > 8 ? (
              <Chip active={false} label={`+${visibleSubs.length - 8} more`} onPress={() => setSubSearch("*")} />
            ) : null}
            <Chip
              active={useCustomSub}
              label="Other..."
              onPress={() => {
                setUseCustomSub(true);
                setSubCategory("");
                if (!customSub) setCustomSub("");
              }}
            />
          </Row>

          {useCustomSub ? (
            <>
              <Label>Type your category</Label>
              <Input value={customSub} onChangeText={setCustomSub} placeholder="e.g. Website sales / SaaS / Music production" />
              <Text style={{ marginTop: 8, color: MUTED, fontSize: 12 }}>We'll save it as a searchable sub-category.</Text>
            </>
          ) : null}
        </CollapsibleCardBox>

        <CardBox>
          <SectionTitle
            title="Availability"
            subtitle="Choose the exact market reach for this listing, from global visibility to a local service radius."
            icon="location-outline"
            tone={AMBER}
          />

          <Label>Scope</Label>
          <Row style={{ flexWrap: "wrap" }}>
            {["global", "continent", "country", "state", "city", "radius"].map((s) => (
              <Chip key={s} active={availabilityScope === s} label={s} onPress={() => setAvailabilityScope(s as AvailabilityScope)} />
            ))}
          </Row>

          <Pressable
            onPress={fillAvailabilityFromLocation}
            disabled={locatingAvailability}
            style={{
              marginTop: 12,
              borderRadius: 16,
              paddingVertical: 12,
              alignItems: "center",
              backgroundColor: "rgba(45,212,191,0.10)",
              borderWidth: 1,
              borderColor: "rgba(94,234,212,0.32)",
              opacity: locatingAvailability ? 0.7 : 1,
              flexDirection: "row",
              gap: 8,
              justifyContent: "center",
            }}
          >
            {locatingAvailability ? <ActivityIndicator color={TEAL} /> : <Ionicons name="locate-outline" size={18} color={TEAL} />}
            <Text style={{ color: TEXT, fontWeight: "900" }}>Use my current location</Text>
          </Pressable>

          {availabilityScope === "continent" ? (
            <>
              <Label>Continents</Label>
              <Row style={{ flexWrap: "wrap" }}>
                {availabilityContinentsList.map((c) => {
                  const active = availabilityContinents.includes(c);
                  return (
                    <Chip
                      key={c}
                      active={active}
                      label={c}
                      onPress={() =>
                        setAvailabilityContinents((prev) =>
                          active ? prev.filter((v) => v !== c) : [...prev, c]
                        )
                      }
                    />
                  );
                })}
              </Row>
            </>
          ) : null}

          {["country", "state", "city", "radius"].includes(availabilityScope) ? (
            <>
              <Label>Country name</Label>
              <Input value={availabilityCountryName} onChangeText={onAvailabilityCountryNameChange} placeholder="e.g. Nigeria" />
              <Label>Country code (optional)</Label>
              <Input value={availabilityCountryCode} onChangeText={onAvailabilityCountryCodeChange} placeholder="e.g. NG" autoCapitalize="characters" />
            </>
          ) : null}

          {["state", "city", "radius"].includes(availabilityScope) ? (
            <>
              <Label>State / Region</Label>
              <Input value={availabilityState} onChangeText={onAvailabilityStateChange} placeholder="e.g. Lagos" />
            </>
          ) : null}

          {["city", "radius"].includes(availabilityScope) ? (
            <>
              <Label>City</Label>
              <Input value={availabilityCity} onChangeText={onAvailabilityCityChange} placeholder="e.g. Ikeja" />
            </>
          ) : null}

          {availabilityScope === "radius" ? (
            <>
              <Label>Radius (km)</Label>
              <Input value={availabilityRadiusKm} onChangeText={setAvailabilityRadiusKm} placeholder="e.g. 10" keyboardType="numeric" />

              <Label>Center</Label>
              <View style={{ marginTop: 8, borderRadius: 18, padding: 12, backgroundColor: "rgba(9,13,11,0.48)", borderWidth: 1, borderColor: BORDER }}>
                <Text style={{ color: TEXT, fontWeight: "800" }}>
                  {availabilityCenter?.label || "No center set yet"}
                </Text>
                {availabilityCenter ? (
                  <Text style={{ marginTop: 6, color: MUTED, fontSize: 12 }}>
                    {availabilityCenter.lat.toFixed(5)}, {availabilityCenter.lng.toFixed(5)}
                  </Text>
                ) : null}
              </View>

              {availabilityCenter ? (
                <Pressable
                  onPress={() => Linking.openURL(`https://maps.google.com/?q=${availabilityCenter.lat},${availabilityCenter.lng}`)}
                  style={{
                    marginTop: 10,
                    paddingVertical: 10,
                    paddingHorizontal: 12,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: BORDER,
                    backgroundColor: "rgba(255,253,247,0.06)",
                    alignSelf: "flex-start",
                  }}
                >
                  <Text style={{ color: TEXT, fontWeight: "900", fontSize: 12 }}>Open in Google Maps</Text>
                </Pressable>
              ) : null}
            </>
          ) : null}

          <Label>Note (optional)</Label>
          <Input value={availabilityNote} onChangeText={setAvailabilityNote} placeholder="e.g. Weekdays only" />

          <Text style={{ marginTop: 10, color: MUTED, fontSize: 12 }}>
            Summary: <Text style={{ color: TEXT, fontWeight: "900" }}>{formatAvailabilitySummary(buildAvailability())}</Text>
          </Text>
        </CardBox>

        <CardBox>
          <SectionTitle
            title="Listing story"
            subtitle="Write the buyer-facing promise. AI can help polish the wording after you add a few details."
            icon="create-outline"
            tone={PURPLE}
          />
          <Label>Title *</Label>
          <Input value={title} onChangeText={setTitle} placeholder={category === "product" ? "e.g. iPhone 12 Pro Max" : "e.g. Landing page design"} />

          <Label>Description</Label>
          <Input value={description} onChangeText={setDescription} placeholder="What the buyer gets, requirements, timeline..." multiline />

          <View
            style={{
              marginTop: 14,
              borderRadius: 22,
              padding: 14,
              backgroundColor: "rgba(139,92,246,0.10)",
              borderWidth: 1,
              borderColor: "rgba(196,181,253,0.28)",
            }}
          >
            <SectionTitle
              title="AI listing assistant"
              subtitle="Improve the title, description, sub-category hints, and buyer-facing details. This does not publish or overwrite anything unless you apply it."
              icon="sparkles-outline"
              tone={PURPLE}
            />
            <Pressable
              onPress={runAiListingAssistant}
              disabled={aiBusy || submitting}
              style={{
                marginTop: 12,
                minHeight: 46,
                borderRadius: 16,
                paddingHorizontal: 14,
                paddingVertical: 12,
                backgroundColor: aiBusy ? "rgba(139,92,246,0.58)" : PURPLE,
                borderWidth: 1,
                borderColor: "rgba(196,181,253,0.55)",
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                opacity: submitting ? 0.7 : 1,
              }}
            >
              {aiBusy ? <ActivityIndicator color={TEXT} /> : <Ionicons name="sparkles-outline" size={18} color={TEXT} />}
              <Text style={{ color: TEXT, fontWeight: "900" }}>
                {aiBusy ? "Generating AI suggestions..." : "Generate with AI"}
              </Text>
            </Pressable>

            {aiError ? <FeedbackBox tone="error" title="AI could not generate suggestions" message={aiError} /> : null}

            {__DEV__ && aiDebug ? (
              <Text style={{ marginTop: 10, color: FAINT, fontSize: 11, lineHeight: 16 }}>
                Debug: {aiDebug}
              </Text>
            ) : null}

            {aiDraft ? (
              <View
                style={{
                  marginTop: 12,
                  borderRadius: 16,
                  padding: 12,
                  backgroundColor: "rgba(255,253,247,0.06)",
                  borderWidth: 1,
                  borderColor: BORDER,
                  gap: 12,
                }}
              >
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
                  <View style={{ flex: 1, minWidth: 180 }}>
                    <Text style={{ color: TEXT, fontWeight: "900" }}>AI suggestions</Text>
                    {aiModel ? (
                      <Text style={{ marginTop: 4, color: MUTED, fontSize: 11 }}>Model: {aiModel}</Text>
                    ) : null}
                  </View>
                  <Pressable
                    onPress={applyAiDraftSuggestions}
                    style={{
                      borderRadius: 999,
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderWidth: 1,
                      borderColor: "rgba(196,181,253,0.45)",
                      backgroundColor: "rgba(139,92,246,0.18)",
                    }}
                  >
                    <Text style={{ color: TEXT, fontWeight: "900", fontSize: 12 }}>Apply main suggestions</Text>
                  </Pressable>
                </View>

                {aiDraft.suggested_title ? (
                  <View>
                    <Text style={{ color: MUTED, fontSize: 11, fontWeight: "800", textTransform: "uppercase" }}>Title</Text>
                    <Text style={{ marginTop: 6, color: TEXT, fontWeight: "800" }}>{aiDraft.suggested_title}</Text>
                    <Pressable onPress={() => setTitle(aiDraft.suggested_title)} style={{ marginTop: 8, alignSelf: "flex-start" }}>
                      <Text style={{ color: "#DDD6FE", fontWeight: "900", fontSize: 12 }}>Use title</Text>
                    </Pressable>
                  </View>
                ) : null}

                {aiDraft.suggested_description ? (
                  <View>
                    <Text style={{ color: MUTED, fontSize: 11, fontWeight: "800", textTransform: "uppercase" }}>Description</Text>
                    <Text style={{ marginTop: 6, color: "rgba(255,253,247,0.86)", lineHeight: 20 }}>{aiDraft.suggested_description}</Text>
                    <Pressable onPress={() => setDescription(aiDraft.suggested_description)} style={{ marginTop: 8, alignSelf: "flex-start" }}>
                      <Text style={{ color: "#DDD6FE", fontWeight: "900", fontSize: 12 }}>Use description</Text>
                    </Pressable>
                  </View>
                ) : null}

                {aiDraft.suggested_sub_category ? (
                  <View>
                    <Text style={{ color: MUTED, fontSize: 11, fontWeight: "800", textTransform: "uppercase" }}>Sub-category</Text>
                    <Text style={{ marginTop: 6, color: TEXT, fontWeight: "800" }}>{aiDraft.suggested_sub_category}</Text>
                    <Pressable onPress={() => applyAiSubCategorySuggestion(aiDraft.suggested_sub_category)} style={{ marginTop: 8, alignSelf: "flex-start" }}>
                      <Text style={{ color: "#DDD6FE", fontWeight: "900", fontSize: 12 }}>Use sub-category</Text>
                    </Pressable>
                  </View>
                ) : null}

                {aiDraft.tags.length ? (
                  <View>
                    <Text style={{ color: MUTED, fontSize: 11, fontWeight: "800", textTransform: "uppercase" }}>Search keywords</Text>
                    <Text style={{ marginTop: 6, color: "rgba(255,253,247,0.86)", lineHeight: 20 }}>{aiDraft.tags.join(", ")}</Text>
                  </View>
                ) : null}

                {aiDraft.warnings.length ? (
                  <View>
                    <Text style={{ color: MUTED, fontSize: 11, fontWeight: "800", textTransform: "uppercase" }}>Missing details to tighten up</Text>
                    {aiDraft.warnings.map((warning, index) => (
                      <Text key={`${warning}-${index}`} style={{ marginTop: index === 0 ? 6 : 4, color: "rgba(255,253,247,0.86)", lineHeight: 19 }}>
                        - {warning}
                      </Text>
                    ))}
                  </View>
                ) : null}

                {aiDraft.price_hint_low > 0 || aiDraft.price_hint_high > 0 ? (
                  <View>
                    <Text style={{ color: MUTED, fontSize: 11, fontWeight: "800", textTransform: "uppercase" }}>Price hint</Text>
                    <Text style={{ marginTop: 6, color: TEXT, fontWeight: "800" }}>
                      {aiDraft.price_hint_high > 0
                        ? `${formatCurrency(aiDraft.price_hint_currency || localCurrency, aiDraft.price_hint_low)} - ${formatCurrency(aiDraft.price_hint_currency || localCurrency, aiDraft.price_hint_high)}`
                        : formatCurrency(aiDraft.price_hint_currency || localCurrency, aiDraft.price_hint_low)}
                    </Text>
                    {aiDraft.price_hint_reason ? (
                      <Text style={{ marginTop: 4, color: MUTED, lineHeight: 18 }}>{aiDraft.price_hint_reason}</Text>
                    ) : null}
                  </View>
                ) : null}

                {aiDraft.media_notes.length ? (
                  <View>
                    <Text style={{ color: MUTED, fontSize: 11, fontWeight: "800", textTransform: "uppercase" }}>Media notes</Text>
                    {aiDraft.media_notes.map((note, index) => (
                      <Text key={`${note}-${index}`} style={{ marginTop: index === 0 ? 6 : 4, color: "rgba(255,253,247,0.86)", lineHeight: 19 }}>
                        - {note}
                      </Text>
                    ))}
                  </View>
                ) : null}

                {aiDraft.confidence_note ? (
                  <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18 }}>{aiDraft.confidence_note}</Text>
                ) : null}
              </View>
            ) : null}
          </View>
        </CardBox>

        <CardBox>
          <SectionTitle
            title="Pricing and payment"
            subtitle="Enter the buyer-facing local price. Checkout settles in supported stablecoins."
            icon="card-outline"
            tone={AMBER}
          />

          <Label>Price *</Label>
          <Row>
            <Pill active label={`I enter ${localCurrency}`} onPress={() => {}} disabled />
          </Row>
          <Input value={price} onChangeText={setPrice} placeholder="e.g. 250000" keyboardType="numeric" />
          {Number.isFinite(liveLocalInput) && liveLocalInput > 0 ? (
            <Text style={{ marginTop: 8, color: MUTED, fontSize: 12 }}>
              {`Display: ${formatCurrency(localCurrency, liveLocalInput)} | Approx USD: ${formatCurrency("USD", liveUsdApprox)}`}
            </Text>
          ) : null}
          {fxFetchedAt ? (
            <Text style={{ marginTop: 6, color: MUTED, fontSize: 11 }}>
              FX source: open.er-api.com ({new Date(fxFetchedAt).toLocaleString()})
            </Text>
          ) : null}

          <Label>Crypto coin</Label>
          <Row>
            <Pill active={cryptoCoinMode === "all"} label="All (USDC/USDT)" onPress={() => setCryptoCoinMode("all")} />
            <Pill active={cryptoCoinMode === "usdc"} label="USDC only" onPress={() => setCryptoCoinMode("usdc")} />
            <Pill active={cryptoCoinMode === "usdt"} label="USDT only" onPress={() => setCryptoCoinMode("usdt")} />
          </Row>

          <Label>Network</Label>
          <Row>
            <Pill active={cryptoNetworkMode === "all"} label="All active networks" onPress={() => setCryptoNetworkMode("all")} />
            {availableNetworks.map((net) => (
              <Pill
                key={net.chain_id}
                active={cryptoNetworkMode === net.chain}
                label={`${net.chain.charAt(0).toUpperCase() + net.chain.slice(1)} only`}
                onPress={() => setCryptoNetworkMode(net.chain)}
              />
            ))}
          </Row>

          <Text style={{ marginTop: 12, color: MUTED, fontSize: 12 }}>
            Listings settle in stablecoins (USDC/USDT). Buyers choose their preferred network.
          </Text>
        </CardBox>

        <CollapsibleCardBox title="Discount (optional)" defaultOpen={false}>
          <Label>Enable discount</Label>
          <Row>
            <Pill active={discountEnabled} label="On" onPress={() => setDiscountEnabled(true)} />
            <Pill active={!discountEnabled} label="Off" onPress={() => setDiscountEnabled(false)} />
          </Row>
          {discountEnabled ? (
            <>
              <Label>Discounted price (final selling price) *</Label>
              <Input value={discountPrice} onChangeText={setDiscountPrice} placeholder="e.g. 35000" keyboardType="numeric" />
              {Number.isFinite(liveDiscountedLocal) && liveDiscountedLocal > 0 ? (
                <Text style={{ marginTop: 6, color: MUTED, fontSize: 12 }}>
                  Display: {formatCurrency(localCurrency, liveDiscountedLocal)} | USD: {formatCurrency("USD", liveDiscountedUsd)}
                </Text>
              ) : null}
              
              <Label>Original price (optional - to show discount %)</Label>
              <Input value={discountOriginalPrice} onChangeText={setDiscountOriginalPrice} placeholder="e.g. 50000 (leave blank if no discount to show)" keyboardType="numeric" />
              {discountOriginalPrice.trim() && Number.isFinite(liveOriginalLocal) && liveOriginalLocal > 0 ? (
                <>
                  <Text style={{ marginTop: 6, color: MUTED, fontSize: 12 }}>
                    Original: {formatCurrency(localCurrency, liveOriginalLocal)} | USD: {formatCurrency("USD", liveOriginalUsd)}
                  </Text>
                  {Number.isFinite(liveDiscountedLocal) && liveDiscountedLocal > 0 ? (
                    <Text style={{ marginTop: 4, color: TEAL, fontSize: 12, fontWeight: "700" }}>
                      Saves {formatCurrency(localCurrency, liveOriginalLocal - liveDiscountedLocal)} ({(((liveOriginalLocal - liveDiscountedLocal) / liveOriginalLocal) * 100).toFixed(0)}% off)
                    </Text>
                  ) : null}
                </>
              ) : null}
              <Label>Discount duration</Label>
              <View style={{ marginTop: 8, flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                <Chip label="No end" active={discountPreset === "none"} onPress={() => applyDiscountPreset("none")} />
                <Chip label="24h" active={discountPreset === "24h"} onPress={() => applyDiscountPreset("24h")} />
                <Chip label="3d" active={discountPreset === "3d"} onPress={() => applyDiscountPreset("3d")} />
                <Chip label="7d" active={discountPreset === "7d"} onPress={() => applyDiscountPreset("7d")} />
                <Chip label="30d" active={discountPreset === "30d"} onPress={() => applyDiscountPreset("30d")} />
                <Chip label="Custom" active={discountPreset === "custom"} onPress={() => applyDiscountPreset("custom")} />
              </View>
              {discountPreset === "custom" ? (
                <Input value={discountEndsAt} onChangeText={setDiscountEndsAt} placeholder="2026-12-31T23:59:59Z" autoCapitalize="none" />
              ) : discountEndsAt ? (
                <Text style={{ marginTop: 8, color: MUTED, fontSize: 12 }}>Ends: {new Date(discountEndsAt).toLocaleString()}</Text>
              ) : (
                <Text style={{ marginTop: 8, color: MUTED, fontSize: 12 }}>No discount end time.</Text>
              )}
            </>
          ) : null}
        </CollapsibleCardBox>

        <CollapsibleCardBox title="Listing auto-delete (optional)" defaultOpen={false}>
          <Label>Listing auto-delete</Label>
          <View style={{ marginTop: 8, flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <Chip label="No auto-delete" active={autoDeletePreset === "none"} onPress={() => applyAutoDeletePreset("none")} />
            <Chip label="7d" active={autoDeletePreset === "7d"} onPress={() => applyAutoDeletePreset("7d")} />
            <Chip label="30d" active={autoDeletePreset === "30d"} onPress={() => applyAutoDeletePreset("30d")} />
            <Chip label="90d" active={autoDeletePreset === "90d"} onPress={() => applyAutoDeletePreset("90d")} />
            <Chip label="Custom" active={autoDeletePreset === "custom"} onPress={() => applyAutoDeletePreset("custom")} />
          </View>
          {autoDeletePreset === "custom" ? (
            <Input value={autoDeleteAt} onChangeText={setAutoDeleteAt} placeholder="2026-12-31T23:59:59Z" autoCapitalize="none" />
          ) : autoDeleteAt ? (
            <Text style={{ marginTop: 8, color: MUTED, fontSize: 12 }}>Deletes at: {new Date(autoDeleteAt).toLocaleString()}</Text>
          ) : (
            <Text style={{ marginTop: 8, color: MUTED, fontSize: 12 }}>Listing stays active until you disable it.</Text>
          )}
        </CollapsibleCardBox>

        {category === "product" ? (
          <CardBox>
            <SectionTitle
              title="Stock"
              subtitle="Control whether buyers see a finite quantity or a continuously available product."
              icon="layers-outline"
              tone={BLUE}
            />
            <Label>Stock mode</Label>
            <Row>
              <Pill
                active={stockMode === "limited"}
                label="Limited"
                icon="layers-outline"
                onPress={() => setStockMode("limited")}
              />
              <Pill
                active={stockMode === "unlimited"}
                label="Unlimited"
                icon="infinite-outline"
                onPress={() => setStockMode("unlimited")}
              />
            </Row>
            {stockMode === "limited" ? (
              <>
                <Label>Stock qty</Label>
                <Input value={stockQty} onChangeText={setStockQty} placeholder="e.g. 5" keyboardType="numeric" />
              </>
            ) : (
              <Text style={{ marginTop: 10, color: MUTED, fontSize: 12 }}>
                Unlimited stock keeps this product visible until you disable or delete it.
              </Text>
            )}
          </CardBox>
        ) : null}

        <CardBox>
          <SectionTitle
            title="Media"
            subtitle={
              category === "product"
                ? "Add at least one image or video. If you upload a video, it becomes the cover automatically."
                : deliveryType === "digital"
                ? "Add media or provide a website URL. Videos automatically become the cover."
                : "Add at least one image or video. Videos automatically become the cover."
            }
            icon="images-outline"
            tone={TEAL}
          />
          <Pressable
            onPress={pickMedia}
            style={{
              marginTop: 12,
              height: 50,
              borderRadius: 18,
              backgroundColor: "rgba(45,212,191,0.12)",
              borderWidth: 1,
              borderColor: "rgba(94,234,212,0.34)",
              flexDirection: "row",
              gap: 10,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="images-outline" size={18} color={TEAL} />
            <Text style={{ color: TEXT, fontWeight: "900" }}>{mediaAssets.length ? "Add more media" : "Pick image or video"}</Text>
          </Pressable>

          {mediaAssets.length > 0 ? (
            <View style={{ marginTop: 12, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              {mediaAssets.map((img, idx) => {
                const isVideo = isVideoAsset(img);
                return (
                  <Pressable
                    key={`${img.uri}-${idx}`}
                    onPress={() => removeMedia(idx)}
                    style={{
                      width: "31%",
                      aspectRatio: 1,
                      borderRadius: 16,
                      overflow: "hidden",
                      borderWidth: 1,
                      borderColor: "rgba(255,253,247,0.14)",
                      backgroundColor: "rgba(255,253,247,0.06)",
                    }}
                  >
                    <MarketMediaView
                      uri={img.uri}
                      kind={isVideo ? "video" : "image"}
                      style={{ width: "100%", height: "100%" }}
                      resizeMode="cover"
                      autoplay={isVideo}
                      muted
                      loop={isVideo}
                      disablePointerEvents
                    />
                    <View style={{ position: "absolute", left: 8, top: 8, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 999, backgroundColor: "rgba(0,0,0,0.55)" }}>
                      <Text style={{ color: TEXT, fontWeight: "900", fontSize: 11 }}>{idx === 0 ? "Cover" : `#${idx + 1}`}</Text>
                    </View>
                    {isVideo ? (
                      <View style={{ position: "absolute", left: 8, bottom: 8, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 999, backgroundColor: "rgba(0,0,0,0.55)", flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <Ionicons name="videocam-outline" size={12} color={TEXT} />
                        <Text style={{ color: TEXT, fontWeight: "900", fontSize: 11 }}>Video</Text>
                      </View>
                    ) : null}
                    <View style={{ position: "absolute", right: 8, top: 8, width: 28, height: 28, borderRadius: 999, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" }}>
                      <Ionicons name="close" size={16} color={TEXT} />
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </CardBox>

        {stage ? (
          <View style={{ marginTop: 12, borderRadius: 18, borderWidth: 1, borderColor: "rgba(94,234,212,0.28)", backgroundColor: "rgba(45,212,191,0.10)", padding: 12, flexDirection: "row", gap: 10, alignItems: "center" }}>
            <ActivityIndicator color={TEAL} />
            <Text style={{ color: TEXT, fontWeight: "900" }}>{stage}</Text>
          </View>
        ) : null}
        {submitFeedback ? (
          <FeedbackBox tone={submitFeedback.tone} title={submitFeedback.title} message={submitFeedback.message} />
        ) : null}
      </ScrollView>

      <View
        pointerEvents="box-none"
        style={{
          position: "absolute",
          left: pagePadding,
          right: pagePadding,
          bottom: stickyPublishBottom,
          alignItems: "center",
        }}
      >
        <View
          style={{
            width: "100%",
            maxWidth: isWebDesktop ? 720 : contentMaxWidth,
            borderRadius: 24,
            padding: 10,
            backgroundColor: "rgba(9,13,11,0.94)",
            borderWidth: 1,
            borderColor: "rgba(255,253,247,0.12)",
            shadowColor: "#000",
            shadowOpacity: 0.28,
            shadowRadius: 22,
            shadowOffset: { width: 0, height: 12 },
            elevation: 12,
          }}
        >
          <Pressable
            disabled={submitting}
            onPress={() => triggerPublish("press")}
            onPressIn={Platform.OS === "web" ? () => triggerPublish("pressIn") : undefined}
            style={({ pressed }) => ({
              borderRadius: 18,
              paddingVertical: 14,
              alignItems: "center",
              backgroundColor: submitting ? "rgba(45,212,191,0.52)" : TEAL,
              borderWidth: 1,
              borderColor: "rgba(94,234,212,0.72)",
              opacity: submitting ? 0.7 : 1,
              transform: [{ scale: pressed && !submitting ? 0.99 : 1 }],
            })}
          >
            {submitting ? (
              <View style={{ alignItems: "center", justifyContent: "center", gap: 6 }}>
                <ActivityIndicator color={TEXT} />
                <Text style={{ color: TEXT, fontWeight: "900", fontSize: 12 }}>
                  {stage || "Publishing..."}
                </Text>
              </View>
            ) : <Text style={{ color: INK, fontWeight: "900" }}>Publish listing</Text>}
          </Pressable>
        </View>
      </View>
    </LinearGradient>
  );
}
