// app/market/(tabs)/sell.tsx
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Linking, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import AppHeader from "@/components/common/AppHeader";
import MarketMediaView from "@/components/market/MarketMediaView";
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

const BG0 = "#05040B";
const BG1 = "#0A0620";
const PURPLE = "#7C3AED";
const CARD = "rgba(255,255,255,0.05)";
const BORDER = "rgba(255,255,255,0.09)";
const MUTED = "rgba(255,255,255,0.62)";

type ListingMediaAsset = { uri: string; contentType: string; fileName?: string | null };

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

function CardBox({ children }: any) {
  return (
    <View style={{ marginTop: 12, borderRadius: 22, padding: 14, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
      {children}
    </View>
  );
}

function Label({ children }: any) {
  return <Text style={{ color: "rgba(255,255,255,0.72)", fontWeight: "800", marginTop: 10, fontSize: 12 }}>{children}</Text>;
}

function Row({ children, style }: any) {
  return <View style={[{ flexDirection: "row", gap: 10, marginTop: 10 }, style]}>{children}</View>;
}

function Input(props: any) {
  return (
    <TextInput
      {...props}
      placeholderTextColor="rgba(255,255,255,0.35)"
      style={[
        {
          marginTop: 8,
          borderRadius: 16,
          paddingHorizontal: 12,
          paddingVertical: 12,
          color: "#fff",
          backgroundColor: "rgba(255,255,255,0.06)",
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.10)",
          minHeight: props.multiline ? 92 : undefined,
          textAlignVertical: props.multiline ? "top" : "auto",
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
      style={{
        flex: 1,
        height: 48,
        borderRadius: 16,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 8,
        backgroundColor: active ? "rgba(124,58,237,0.25)" : "rgba(255,255,255,0.06)",
        borderWidth: 1,
        borderColor: active ? "rgba(124,58,237,0.45)" : "rgba(255,255,255,0.10)",
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {icon ? <Ionicons name={icon} size={16} color="#fff" /> : null}
      <Text style={{ color: "#fff", fontWeight: "900" }}>{label}</Text>
    </Pressable>
  );
}

function Chip({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 999,
        backgroundColor: active ? "rgba(124,58,237,0.25)" : "rgba(255,255,255,0.06)",
        borderWidth: 1,
        borderColor: active ? "rgba(124,58,237,0.45)" : "rgba(255,255,255,0.10)",
      }}
    >
      <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }}>{label}</Text>
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
          borderRadius: 22,
          padding: 14,
          backgroundColor: CARD,
          borderWidth: 1,
          borderColor: BORDER,
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Text style={{ color: "#fff", fontWeight: "900", fontSize: 16 }}>{title}</Text>
        <Ionicons
          name={open ? "chevron-up-outline" : "chevron-down-outline"}
          size={20}
          color="rgba(255,255,255,0.6)"
        />
      </Pressable>
      {open ? (
        <View style={{ marginTop: 8, borderRadius: 16, padding: 14, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
          {children}
        </View>
      ) : null}
    </View>
  );
}

export default function SellTab() {
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

  const mountedRef = useRef(true);
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const publishAttemptRef = useRef(0);

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
            const key = `${img.uri}|${img.fileName || ""}`;
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
      const msg = friendlyMarketError(e, "We couldn't complete this request right now.");
      const errStr = String(msg || e?.message || "").toLowerCase();
      
      // Check if listing was created but images failed
      if (errStr.includes("listing created") || errStr.includes("saved") || errStr.includes("draft") || errStr.includes("already live")) {
        showFeedback("info", "Listing saved", msg);
      } else if (errStr.includes("row-level security") || errStr.includes("permission")) {
        showFeedback("error", "Permission issue", "Your database permissions blocked this listing insert.");
      } else if (errStr.includes("network") || errStr.includes("timeout")) {
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
    // Put website URL into description for now (until you add a DB column later)
    // This keeps you moving without migrations.
    const descBase = description.trim() || "";
    const extra =
      category === "service" && deliveryType === "digital" && websiteUrl.trim()
        ? `\n\n---\nWebsite preview link: ${websiteUrl.trim()}\n(Note: preview/watermark coming soon.)`
        : "";
    const finalDesc = (descBase + extra).trim() || null;
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
      try {
        console.log("[SellTab] upload media -> start", { count: mediaAssets.length });
        setStage("Uploading media...");
        const inserts: any[] = [];

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
              contentType: img.contentType,
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
            throw new Error(
              `Media item ${i + 1} upload failed: ${imgUploadErr?.message || "Unknown error"}. Listing is already live without this file.`,
            );
          }
        }

        console.log("[SellTab] insertListingImages -> start", { count: inserts.length });
        setStage("Saving media...");
        const rows = await insertListingImages(inserts, { activateListing: false });
        console.log("[SellTab] insertListingImages -> ok", { count: rows?.length ?? 0 });

        if (!rows?.length) {
          imageWarning = "Your listing is live, but the uploaded media was not attached yet.";
        }
      } catch (imageErr: any) {
        const partialRows = Array.isArray(imageErr?.partialRows) ? imageErr.partialRows : [];
        setStage("Finalizing listing...");
        const errMsg = String(imageErr?.message || imageErr || "");
        if (partialRows.length > 0) {
          throw new Error(
            `Listing created, but only ${partialRows.length}/${mediaAssets.length} media item${partialRows.length === 1 ? "" : "s"} uploaded. Open My Listings to re-upload the remaining files.`,
          );
        }
        throw new Error(
          `Listing created, but media failed to upload. Error: ${errMsg}. Open My Listings to try uploading media again.`,
        );
      }
    }

    const successMsg = mediaAssets.length > 0 ? "Your listing is live with all media!" : "Your listing is live!";
    showFeedback("success", "Posted", successMsg);
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

  if (checkingSeller) {
    return (
      <LinearGradient colors={[BG1, BG0]} style={{ flex: 1, paddingHorizontal: 16, paddingTop: 14 }}>
        <AppHeader title="Sell" subtitle="Products are physical. Services can be digital (remote) or in-person." />
        <View style={{ marginTop: 60, alignItems: "center" }}>
          <ActivityIndicator />
          <Text style={{ marginTop: 10, color: "rgba(255,255,255,0.7)", fontWeight: "800" }}>Checking seller profile…</Text>
        </View>
      </LinearGradient>
    );
  }

  if (!hasSellerProfile) {
    return (
      <LinearGradient colors={[BG1, BG0]} style={{ flex: 1, paddingHorizontal: 16, paddingTop: 14 }}>
        <AppHeader title="Sell" subtitle="Products are physical. Services can be digital (remote) or in-person." />
        <View style={{ marginTop: 40 }}>
          <Text style={{ color: "#fff", fontSize: 22, fontWeight: "900" }}>Start selling</Text>
          <Text style={{ marginTop: 6, color: "rgba(255,255,255,0.65)" }}>You need a Market Profile before you can post listings.</Text>

          <Pressable
            onPress={() => router.push("/market/profile/create" as any)}
            style={{ marginTop: 14, borderRadius: 18, paddingVertical: 14, alignItems: "center", backgroundColor: PURPLE, borderWidth: 1, borderColor: "rgba(124,58,237,0.8)" }}
          >
            <Text style={{ color: "#fff", fontWeight: "900" }}>Create Market Profile</Text>
          </Pressable>
        </View>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient colors={[BG1, BG0]} start={{ x: 0.15, y: 0 }} end={{ x: 0.9, y: 1 }} style={{ flex: 1, paddingHorizontal: 16, paddingTop: 14 }}>
      <AppHeader title="Sell" subtitle="Products are physical. Services can be digital (remote) or in-person." />
      <ScrollView
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingBottom: 240 }}
      >
        <Text style={{ color: "#fff", fontSize: 22, fontWeight: "900" }}>Create Listing</Text>
        <Text style={{ marginTop: 6, color: "rgba(255,255,255,0.65)" }}>
          Products are physical. Services can be digital (remote) or in-person.
        </Text>

        <CardBox>
          <Text style={{ color: "#fff", fontWeight: "900" }}>What are you listing?</Text>
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
              <Label>Website URL (optional)</Label>
              <Input value={websiteUrl} onChangeText={setWebsiteUrl} placeholder="https://example.com" autoCapitalize="none" />
              <Text style={{ marginTop: 8, color: MUTED, fontSize: 12, lineHeight: 18 }}>
                Later you can add “preview + watermark” and partial audio/file previews. For now, we store the link in the description.
              </Text>
            </>
          ) : null}
        </CardBox>

        <CollapsibleCardBox title="📂 Category (optional)" defaultOpen={true}>

          <Label>Search sub-categories</Label>
          <Input value={subSearch} onChangeText={setSubSearch} placeholder="Search… (e.g. phones, design)" />

          <Row style={{ flexWrap: "wrap" }}>
            {visibleSubs.slice(0, 8).map((c: any) => (
              <Chip key={`${c.main}:${c.slug}`} active={!useCustomSub && subCategory === c.slug} label={c.title} onPress={() => { setUseCustomSub(false); setSubCategory(c.slug); }} />
            ))}
            {visibleSubs.length > 8 ? (
              <Chip active={false} label={`+${visibleSubs.length - 8} more`} onPress={() => setSubSearch("*")} />
            ) : null}
            <Chip
              active={useCustomSub}
              label="Other…"
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
              <Text style={{ marginTop: 8, color: MUTED, fontSize: 12 }}>We’ll save it as a searchable sub-category.</Text>
            </>
          ) : null}
        </CollapsibleCardBox>

        <CardBox>
          <Text style={{ color: "#fff", fontWeight: "900" }}>Availability</Text>
          <Text style={{ marginTop: 6, color: MUTED, fontSize: 12 }}>Choose where this listing is available.</Text>

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
              backgroundColor: "rgba(255,255,255,0.06)",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.12)",
              opacity: locatingAvailability ? 0.7 : 1,
              flexDirection: "row",
              gap: 8,
              justifyContent: "center",
            }}
          >
            {locatingAvailability ? <ActivityIndicator /> : <Ionicons name="locate-outline" size={18} color="#fff" />}
            <Text style={{ color: "#fff", fontWeight: "900" }}>Use my current location</Text>
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
              <View style={{ marginTop: 8, borderRadius: 16, padding: 12, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)" }}>
                <Text style={{ color: "#fff", fontWeight: "800" }}>
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
                    borderColor: "rgba(255,255,255,0.12)",
                    backgroundColor: "rgba(255,255,255,0.06)",
                    alignSelf: "flex-start",
                  }}
                >
                  <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }}>Open in Google Maps</Text>
                </Pressable>
              ) : null}
            </>
          ) : null}

          <Label>Note (optional)</Label>
          <Input value={availabilityNote} onChangeText={setAvailabilityNote} placeholder="e.g. Weekdays only" />

          <Text style={{ marginTop: 10, color: MUTED, fontSize: 12 }}>
            Summary: <Text style={{ color: "#fff", fontWeight: "900" }}>{formatAvailabilitySummary(buildAvailability())}</Text>
          </Text>
        </CardBox>

        <CardBox>
          <Label>Title *</Label>
          <Input value={title} onChangeText={setTitle} placeholder={category === "product" ? "e.g. iPhone 12 Pro Max" : "e.g. Landing page design"} />

          <Label>Description</Label>
          <Input value={description} onChangeText={setDescription} placeholder="What the buyer gets, requirements, timeline..." multiline />
        </CardBox>

        <CardBox>
          <Text style={{ color: "#fff", fontWeight: "900" }}>💰 Pricing & Payment</Text>

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
            ✓ Listings settle in stablecoins (USDC/USDT). Buyers choose their preferred network.
          </Text>
        </CardBox>

        <CollapsibleCardBox title="🎁 Discount (optional)" defaultOpen={false}>
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
                    <Text style={{ marginTop: 4, color: "#10B981", fontSize: 12, fontWeight: "600" }}>
                      💚 Saves {formatCurrency(localCurrency, liveOriginalLocal - liveDiscountedLocal)} ({(((liveOriginalLocal - liveDiscountedLocal) / liveOriginalLocal) * 100).toFixed(0)}% off)
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

        <CollapsibleCardBox title="♻️ Listing auto-delete (optional)" defaultOpen={false}>
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
            <Text style={{ color: "#fff", fontWeight: "900" }}>Stock (for products)</Text>
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
          <Text style={{ color: "#fff", fontWeight: "900" }}>Media</Text>
          <Text style={{ marginTop: 6, color: MUTED, fontSize: 12 }}>
            {category === "product"
              ? "Add at least 1 image or video. If you upload a video, it becomes the cover automatically."
              : deliveryType === "digital"
              ? "Add an image or video OR provide a website URL. Videos automatically become the cover."
              : "Add at least 1 image or video. Videos automatically become the cover."}
          </Text>

          <Pressable
            onPress={pickMedia}
            style={{
              marginTop: 12,
              height: 50,
              borderRadius: 18,
              backgroundColor: "rgba(255,255,255,0.06)",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.12)",
              flexDirection: "row",
              gap: 10,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="images-outline" size={18} color="#fff" />
            <Text style={{ color: "#fff", fontWeight: "900" }}>{mediaAssets.length ? "Add more media" : "Pick image or video"}</Text>
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
                      borderColor: "rgba(255,255,255,0.12)",
                      backgroundColor: "rgba(255,255,255,0.06)",
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
                      <Text style={{ color: "#fff", fontWeight: "900", fontSize: 11 }}>{idx === 0 ? "Cover" : `#${idx + 1}`}</Text>
                    </View>
                    {isVideo ? (
                      <View style={{ position: "absolute", left: 8, bottom: 8, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 999, backgroundColor: "rgba(0,0,0,0.55)", flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <Ionicons name="videocam-outline" size={12} color="#fff" />
                        <Text style={{ color: "#fff", fontWeight: "900", fontSize: 11 }}>Video</Text>
                      </View>
                    ) : null}
                    <View style={{ position: "absolute", right: 8, top: 8, width: 28, height: 28, borderRadius: 999, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" }}>
                      <Ionicons name="close" size={16} color="#fff" />
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </CardBox>

        {stage ? (
          <View style={{ marginTop: 12, borderRadius: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.10)", backgroundColor: "rgba(255,255,255,0.06)", padding: 12, flexDirection: "row", gap: 10, alignItems: "center" }}>
            <ActivityIndicator color="#fff" />
            <Text style={{ color: "rgba(255,255,255,0.85)", fontWeight: "900" }}>{stage}</Text>
          </View>
        ) : null}
        {submitFeedback ? (
          <View
            style={{
              marginTop: 12,
              borderRadius: 16,
              borderWidth: 1,
              padding: 12,
              backgroundColor:
                submitFeedback.tone === "error"
                  ? "rgba(239,68,68,0.12)"
                  : submitFeedback.tone === "success"
                  ? "rgba(16,185,129,0.12)"
                  : "rgba(59,130,246,0.12)",
              borderColor:
                submitFeedback.tone === "error"
                  ? "rgba(239,68,68,0.35)"
                  : submitFeedback.tone === "success"
                  ? "rgba(16,185,129,0.35)"
                  : "rgba(59,130,246,0.35)",
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "900" }}>{submitFeedback.title}</Text>
            <Text style={{ marginTop: 6, color: "rgba(255,255,255,0.82)" }}>{submitFeedback.message}</Text>
          </View>
        ) : null}
      </ScrollView>

      <View
        pointerEvents="box-none"
        style={{
          position: "absolute",
          left: 16,
          right: 16,
          bottom: Platform.OS === "web" ? 18 : 84,
        }}
      >
        <View
          style={{
            borderRadius: 22,
            padding: 10,
            backgroundColor: "rgba(5,4,11,0.94)",
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.08)",
          }}
        >
          <Pressable
            disabled={submitting}
            onPress={() => triggerPublish("press")}
            onPressIn={Platform.OS === "web" ? () => triggerPublish("pressIn") : undefined}
            style={{
              borderRadius: 18,
              paddingVertical: 14,
              alignItems: "center",
              backgroundColor: PURPLE,
              borderWidth: 1,
              borderColor: "rgba(124,58,237,0.8)",
              opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting ? <ActivityIndicator /> : <Text style={{ color: "#fff", fontWeight: "900" }}>Publish listing</Text>}
          </Pressable>
        </View>
      </View>
    </LinearGradient>
  );
}
