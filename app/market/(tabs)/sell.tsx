// app/market/(tabs)/sell.tsx
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, Linking, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import AppHeader from "@/components/common/AppHeader";
import { getAllCategories } from "@/services/market/categories";
import { createListing, getMySellerProfile, insertListingImages, rollbackListingDraft, uploadToBucket } from "@/services/market/marketService";
import { supabase } from "@/services/supabase";
import { formatAvailabilitySummary, getCurrentLocationWithGeocode } from "@/utils/location";
import { friendlyMarketError } from "@/utils/marketUx";
import { isNigeriaCountry, resolveUserCountry, type UserCountry } from "@/utils/country";
import { normalizeCountryName } from "@/utils/countryNames";
import { getCountryFx } from "@/utils/fx";
import { formatCurrency } from "@/utils/pricing";

const BG0 = "#05040B";
const BG1 = "#0A0620";
const PURPLE = "#7C3AED";
const CARD = "rgba(255,255,255,0.05)";
const BORDER = "rgba(255,255,255,0.09)";
const MUTED = "rgba(255,255,255,0.62)";

type Img = { uri: string; contentType: string };

type DeliveryType = "physical" | "digital" | "in_person";
type Currency = "NGN" | "USDC";
type MainCategory = "product" | "service";
type AvailabilityScope = "global" | "continent" | "country" | "state" | "city" | "radius";
type DurationPreset = "none" | "24h" | "3d" | "7d" | "30d" | "90d" | "custom";

function safeNumber(input: string) {
  const n = Number(String(input).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : NaN;
}

function ensureExtFromMime(mime: string) {
  const m = mime.toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("heic")) return "heic";
  return "jpg";
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
  const [payMode, setPayMode] = useState<"ngn" | "crypto" | "all">("ngn");
  const [cryptoCoinMode, setCryptoCoinMode] = useState<"all" | "usdc" | "usdt">("all");
  const [cryptoNetworkMode, setCryptoNetworkMode] = useState<"all" | "base" | "arbitrum">("all");
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
  const [availabilityRadiusKm, setAvailabilityRadiusKm] = useState("");
  const [availabilityCenter, setAvailabilityCenter] = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [availabilityNote, setAvailabilityNote] = useState("");
  const [userCountry, setUserCountry] = useState<UserCountry | null>(null);
  const isNigeria = isNigeriaCountry(userCountry?.code || userCountry?.name);
  const [locatingAvailability, setLocatingAvailability] = useState(false);

  const [images, setImages] = useState<Img[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [stage, setStage] = useState<string | null>(null);

  const mountedRef = useRef(true);

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
        const fx = await getCountryFx(c);
        if (!mounted) return;
        setLocalCurrency(String(fx.localCurrency || "USD").toUpperCase());
        setFxUsdToLocal(fx.usdToLocal);
        setFxUsdToNgn(fx.usdToNgn);
        setFxFetchedAt(fx.fetchedAt);

        if (c) {
          if (!availabilityCountryName && !availabilityCountryCode) {
            setAvailabilityCountryName(normalizeCountryName(c.name, c.code));
            setAvailabilityCountryCode(String(c.code || ""));
          }
          if (availabilityScope === "global") {
            setAvailabilityScope("country");
          }
          if (!isNigeriaCountry(c.code || c.name)) {
            setPayMode("crypto");
          } else {
            setLocalCurrency("NGN");
          }
        }
      } catch {
        if (mounted) {
          setUserCountry(null);
          setLocalCurrency("USD");
          setFxUsdToLocal(1);
          setFxUsdToNgn(null);
          setFxFetchedAt(null);
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  async function pickImages() {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return Alert.alert("Permission needed", "Allow photo access to upload images.");

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        selectionLimit: 8,
        quality: 0.85,
      });

      if (result.canceled) return;

      const picked = (result.assets ?? [])
        .filter((a: ImagePicker.ImagePickerAsset) => !!a.uri)
        .map((a: ImagePicker.ImagePickerAsset) => ({ uri: a.uri, contentType: a.mimeType ?? "image/jpeg" }));

      if (!picked.length) return;

      setImages((prev) => [...prev, ...picked].slice(0, 8));
    } catch (e: any) {
      Alert.alert("Try again", friendlyMarketError(e, "We couldn't add your selected images."));
    }
  }

  function removeImage(idx: number) {
    setImages((prev) => prev.filter((_, i) => i !== idx));
  }

  function finalSubCategory() {
    if (useCustomSub) return customSub.trim().toLowerCase().replace(/\s+/g, "_").slice(0, 40);
    return subCategory;
  }

  async function fillAvailabilityFromLocation() {
    setLocatingAvailability(true);
    try {
      const res = await getCurrentLocationWithGeocode();
      const normalizedCountryName = normalizeCountryName(res.geo.country || "", res.geo.countryCode || "");
      setAvailabilityCenter({ lat: res.coords.lat, lng: res.coords.lng, label: res.label });
      setAvailabilityCountryName(normalizedCountryName);
      setAvailabilityCountryCode(res.geo.countryCode || "");
      setAvailabilityState(res.geo.region || res.geo.subregion || res.geo.district || "");
      setAvailabilityCity(res.geo.city || res.geo.town || res.geo.locality || res.geo.district || "");
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

  function buildAvailability() {
    const radius = availabilityScope === "radius" ? safeNumber(availabilityRadiusKm) : NaN;
    const center = availabilityCenter ?? { lat: 0, lng: 0, label: "" };
    return {
      scope: availabilityScope,
      continents: availabilityContinents,
      country: { name: availabilityCountryName.trim(), code: availabilityCountryCode.trim() },
      state: availabilityState.trim(),
      city: availabilityCity.trim(),
      radiusKm: Number.isFinite(radius) ? radius : 0,
      center,
      note: availabilityNote.trim(),
    };
  }

  function validate(): string | null {
    const t = title.trim();
    if (!t) return "Title is required";
    const bad = containsBannedContent(`${title} ${description}`);
    if (bad) return `This marketplace does not allow drugs or medical products. Remove: ${bad}`;

    const sc = finalSubCategory();
    if (!sc) return "Pick a sub-category (or type one in Other)";

    const p = safeNumber(price);
    if (!Number.isFinite(p) || p <= 0) return "Enter a valid price";
    if (discountEnabled) {
      const op = safeNumber(discountOriginalPrice);
      const dp = safeNumber(discountPrice);
      if (!Number.isFinite(op) || op <= 0) return "Discount original price must be valid";
      if (!Number.isFinite(dp) || dp <= 0) return "Discounted price must be valid";
      if (dp >= op) return "Discounted price must be lower than original price";
    }

    if (category === "product") {
      if (stockMode === "limited") {
        const q = safeNumber(stockQty);
        if (!Number.isFinite(q) || q <= 0) return "Stock is required and must be at least 1";
      }
    }

    // media requirements:
    // - product: require at least 1 image
    // - service: require either at least 1 image OR website URL (for digital)
    if (category === "product" && images.length === 0) return "Add at least 1 image";
    if (category === "service") {
      if (deliveryType === "digital") {
        if (images.length === 0 && !websiteUrl.trim()) return "Add an image OR provide a website URL";
        if (websiteUrl.trim() && !isValidUrl(websiteUrl)) return "Website URL must start with https://";
      } else {
        if (images.length === 0) return "Add at least 1 image";
      }
    }

    if (availabilityScope === "continent" && availabilityContinents.length === 0) return "Pick at least one continent";
    if (availabilityScope === "country" && !availabilityCountryName.trim() && !availabilityCountryCode.trim()) return "Country is required";
    if (availabilityScope === "state" && (!availabilityState.trim() || (!availabilityCountryName.trim() && !availabilityCountryCode.trim()))) {
      return "State and country are required";
    }
    if (availabilityScope === "city" && (!availabilityCity.trim() || (!availabilityCountryName.trim() && !availabilityCountryCode.trim()))) {
      return "City and country are required";
    }
    if (availabilityScope === "radius") {
      const r = safeNumber(availabilityRadiusKm);
      if (!availabilityCenter) return "Pick a center location for your radius";
      if (!Number.isFinite(r) || r <= 0) return "Radius must be greater than 0 km";
    }

    return null;
  }

  async function onSubmit() {
    if (submitting) return;
    const err = validate();
    if (err) return Alert.alert("Fix this", err);

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
      const effectivePayMode = isNigeria ? payMode : "crypto";
      const baseCurrency: "NGN" | "USD" = localCurrency === "NGN" ? "NGN" : "USD";
      const listingCurrency: Currency = effectivePayMode === "ngn" ? "NGN" : "USDC";
      const toUsd = (valueLocal: number) => valueLocal / fxUsdToLocal;
      const toNgn = (valueLocal: number) => {
        if (localCurrency === "NGN") return valueLocal;
        const usd = toUsd(valueLocal);
        if (!fxUsdToNgn || fxUsdToNgn <= 0) return NaN;
        return usd * fxUsdToNgn;
      };

      const enteredPriceUsd = toUsd(enteredPriceLocal);
      const enteredPriceNgn = toNgn(enteredPriceLocal);
      const safeEnteredPriceLocal = Number(enteredPriceLocal.toFixed(2));
      const safeEnteredPriceNgn = Number.isFinite(enteredPriceNgn) ? Number(enteredPriceNgn.toFixed(2)) : null;
      const safeEnteredPriceUsd = Number.isFinite(enteredPriceUsd) ? Number(enteredPriceUsd.toFixed(6)) : null;
      let unitPrice = listingCurrency === "NGN" ? enteredPriceNgn : enteredPriceUsd;
      if (discountEnabled) {
        const opLocal = safeNumber(discountOriginalPrice);
        const dpLocal = safeNumber(discountPrice);
        const effectiveDiscountedNgn = toNgn(dpLocal);
        const effectiveDiscountedUsd = toUsd(dpLocal);
        const effectiveDiscounted = listingCurrency === "NGN" ? effectiveDiscountedNgn : effectiveDiscountedUsd;
        unitPrice = effectiveDiscounted;
        const effectiveOriginalNgn = toNgn(opLocal);
        const effectiveOriginalUsd = toUsd(opLocal);
        const effectiveOriginal = listingCurrency === "NGN" ? effectiveOriginalNgn : effectiveOriginalUsd;

        const safeDiscountedNgn = Number.isFinite(effectiveDiscountedNgn) ? Number(effectiveDiscountedNgn.toFixed(2)) : null;
        const safeOriginalNgn = Number.isFinite(effectiveOriginalNgn) ? Number(effectiveOriginalNgn.toFixed(2)) : null;
        const safeDiscountedLocal = Number.isFinite(dpLocal) ? Number(dpLocal.toFixed(2)) : null;
        const safeOriginalLocal = Number.isFinite(opLocal) ? Number(opLocal.toFixed(2)) : null;
        const paymentOptions = {
          allow_ngn: isNigeria && (effectivePayMode === "ngn" || effectivePayMode === "all"),
          allow_crypto: effectivePayMode === "crypto" || effectivePayMode === "all",
          allow_usdc: (effectivePayMode === "crypto" || effectivePayMode === "all") && (cryptoCoinMode === "all" || cryptoCoinMode === "usdc"),
          allow_usdt: (effectivePayMode === "crypto" || effectivePayMode === "all") && (cryptoCoinMode === "all" || cryptoCoinMode === "usdt"),
          allow_pi: false,
          chain_mode: cryptoNetworkMode,
          coin_mode: cryptoCoinMode,
          pi_mode: "off",
          stock_mode: category === "product" ? stockMode : "unlimited",
          out_of_stock: false,
          base_currency: baseCurrency,
          fx_rate_ngn_per_usd: fxUsdToNgn ?? null,
          fx: {
            source: "open.er-api.com",
            fetched_at: fxFetchedAt,
            local_currency: localCurrency,
            country_code: userCountry?.code ?? null,
            usd_to_local: fxUsdToLocal,
            local_to_usd: 1 / fxUsdToLocal,
            usd_to_ngn: fxUsdToNgn ?? null,
          },
          price_book: {
            local_currency: localCurrency,
            local: safeEnteredPriceLocal,
            ngn: safeEnteredPriceNgn,
            usd: safeEnteredPriceUsd,
          },
          discount: {
            enabled: true,
            // canonical values for checkout math (same unit as listing currency)
            originalPrice: Number(effectiveOriginal.toFixed(6)),
            discountedPrice: Number(effectiveDiscounted.toFixed(6)),
            // display + analytics
            baseCurrency,
            localCurrency,
            originalPriceLocal: safeOriginalLocal,
            discountedPriceLocal: safeDiscountedLocal,
            originalPriceNgn: safeOriginalNgn,
            discountedPriceNgn: safeDiscountedNgn,
            originalPriceUsd: Number(effectiveOriginalUsd.toFixed(6)),
            discountedPriceUsd: Number(effectiveDiscountedUsd.toFixed(6)),
            startsAt: new Date().toISOString(),
            endsAt: discountEndsAt.trim() ? new Date(discountEndsAt.trim()).toISOString() : null,
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
      }
      const paymentOptions = {
        allow_ngn: isNigeria && (effectivePayMode === "ngn" || effectivePayMode === "all"),
        allow_crypto: effectivePayMode === "crypto" || effectivePayMode === "all",
        allow_usdc: (effectivePayMode === "crypto" || effectivePayMode === "all") && (cryptoCoinMode === "all" || cryptoCoinMode === "usdc"),
        allow_usdt: (effectivePayMode === "crypto" || effectivePayMode === "all") && (cryptoCoinMode === "all" || cryptoCoinMode === "usdt"),
        allow_pi: false,
        chain_mode: cryptoNetworkMode,
        coin_mode: cryptoCoinMode,
        pi_mode: "off",
        stock_mode: category === "product" ? stockMode : "unlimited",
        out_of_stock: false,
        base_currency: baseCurrency,
        fx_rate_ngn_per_usd: fxUsdToNgn ?? null,
        fx: {
          source: "open.er-api.com",
          fetched_at: fxFetchedAt,
          local_currency: localCurrency,
          country_code: userCountry?.code ?? null,
          usd_to_local: fxUsdToLocal,
          local_to_usd: 1 / fxUsdToLocal,
          usd_to_ngn: fxUsdToNgn ?? null,
        },
        price_book: {
          local_currency: localCurrency,
          local: safeEnteredPriceLocal,
          ngn: safeEnteredPriceNgn,
          usd: safeEnteredPriceUsd,
        },
        discount: { enabled: false },
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
      const msg = friendlyMarketError(e, "We couldn't publish your listing right now.");
      // Helpful hint for the exact error you're seeing
      if (String(msg).toLowerCase().includes("row-level security")) {
        Alert.alert("RLS blocked", "Your RLS policies for market_listings or market_listing_images are blocking inserts.\n\nRun the SQL policy fix I sent and try again.");
      } else {
        Alert.alert("Failed", msg);
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
    const shouldActivateAfterImages = images.length > 0;

    console.log("[SellTab] createListing -> start");
    setStage("Creating listing...");
    const listing = await createListing({
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
      // keep listings with selected media hidden until image rows are persisted
      is_active: shouldActivateAfterImages ? false : true,
    } as any);
      console.log("[SellTab] createListing -> ok", listing?.id ?? "no-id");

      if (!listing?.id) throw new Error("Listing creation failed (missing id)");

      // If no images (allowed for digital service with website URL), skip images flow
      if (images.length > 0) {
        const uploadedPaths: string[] = [];
        try {
          console.log("[SellTab] upload images -> start", { count: images.length });
          setStage("Uploading images...");
          const inserts: any[] = [];

          for (let i = 0; i < images.length; i++) {
            const img = images[i];
            const ext = ensureExtFromMime(img.contentType);
            const random =
              typeof crypto !== "undefined" && "randomUUID" in crypto
                ? (crypto as any).randomUUID()
                : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

            const path = `${user.id}/listings/${listing.id}/${i + 1}-${random}.${ext}`;

            console.log("[SellTab] upload image -> start", { index: i, path });
            const up = await uploadToBucket({
              bucket: "market-listings",
              path,
              uri: img.uri,
              contentType: img.contentType,
            });
            console.log("[SellTab] upload image -> ok", { index: i, storagePath: up.storagePath });
            uploadedPaths.push(String(up.storagePath || ""));

            inserts.push({
              listing_id: listing.id,
              storage_path: up.storagePath,
              public_url: up.publicUrl ?? null,
              sort_order: i,
              meta: { content_type: img.contentType },
            });
          }

          console.log("[SellTab] insertListingImages -> start", { count: inserts.length });
          setStage("Saving images...");
          const rows = await insertListingImages(inserts, { activateListing: shouldActivateAfterImages });
          console.log("[SellTab] insertListingImages -> ok", { count: rows?.length ?? 0 });

          if (!rows?.length) {
            throw new Error("Upload finished but image rows were not saved. Please retry.");
          }
        } catch (imageErr) {
          setStage("Reverting draft listing...");
          await rollbackListingDraft(listing.id, uploadedPaths);
          throw imageErr;
        }
      }

    Alert.alert("Posted", "Your listing is live.");
    setTitle("");
    setDescription("");
    setWebsiteUrl("");
    setPrice("");
    setStockMode("limited");
    setStockQty("");
    setImages([]);
    setUseCustomSub(false);
    setCustomSub("");
    setAvailabilityScope("country");
    setAvailabilityContinents([]);
    setAvailabilityCountryName("");
    setAvailabilityCountryCode("");
    setAvailabilityState("");
    setAvailabilityCity("");
    setAvailabilityRadiusKm("");
    setAvailabilityCenter(null);
    setAvailabilityNote("");
    setStage(null);

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
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
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

        <CardBox>
          <Text style={{ color: "#fff", fontWeight: "900" }}>Category</Text>
          <Text style={{ marginTop: 6, color: MUTED, fontSize: 12 }}>Pick a sub-category so buyers can find you faster.</Text>

          <Label>Search sub-categories</Label>
          <Input value={subSearch} onChangeText={setSubSearch} placeholder="Search… (e.g. phones, design)" />

          <Row style={{ flexWrap: "wrap" }}>
            {visibleSubs.slice(0, 18).map((c: any) => (
              <Chip key={`${c.main}:${c.slug}`} active={!useCustomSub && subCategory === c.slug} label={c.title} onPress={() => { setUseCustomSub(false); setSubCategory(c.slug); }} />
            ))}
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
        </CardBox>

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
              <Input value={availabilityCountryName} onChangeText={setAvailabilityCountryName} placeholder="e.g. Nigeria" />
              <Label>Country code (optional)</Label>
              <Input value={availabilityCountryCode} onChangeText={setAvailabilityCountryCode} placeholder="e.g. NG" autoCapitalize="characters" />
            </>
          ) : null}

          {["state", "city", "radius"].includes(availabilityScope) ? (
            <>
              <Label>State / Region</Label>
              <Input value={availabilityState} onChangeText={setAvailabilityState} placeholder="e.g. Lagos" />
            </>
          ) : null}

          {["city", "radius"].includes(availabilityScope) ? (
            <>
              <Label>City</Label>
              <Input value={availabilityCity} onChangeText={setAvailabilityCity} placeholder="e.g. Ikeja" />
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

          <Label>Payment route</Label>
          {isNigeria ? (
            <Row>
              <Pill active={payMode === "ngn"} label="NGN only" onPress={() => setPayMode("ngn")} />
              <Pill active={payMode === "crypto"} label="Crypto only" onPress={() => setPayMode("crypto")} />
              <Pill active={payMode === "all"} label="All" onPress={() => setPayMode("all")} />
            </Row>
          ) : (
            <Row>
              <Pill active label="Crypto only" onPress={() => setPayMode("crypto")} disabled />
            </Row>
          )}
          {!isNigeria ? (
            <Text style={{ marginTop: 8, color: MUTED, fontSize: 12 }}>
              NGN checkout is available only for Nigeria-based accounts.
            </Text>
          ) : null}

          {(payMode === "crypto" || payMode === "all") ? (
            <>
              <Label>Crypto coin</Label>
              <Row>
                <Pill active={cryptoCoinMode === "all"} label="All (USDC/USDT)" onPress={() => setCryptoCoinMode("all")} />
                <Pill active={cryptoCoinMode === "usdc"} label="USDC only" onPress={() => setCryptoCoinMode("usdc")} />
                <Pill active={cryptoCoinMode === "usdt"} label="USDT only" onPress={() => setCryptoCoinMode("usdt")} />
              </Row>

              <Label>Network</Label>
              <Row>
                <Pill active={cryptoNetworkMode === "all"} label="All active networks" onPress={() => setCryptoNetworkMode("all")} />
                <Pill active={cryptoNetworkMode === "base"} label="Base only" onPress={() => setCryptoNetworkMode("base")} />
                <Pill active={cryptoNetworkMode === "arbitrum"} label="Arbitrum only" onPress={() => setCryptoNetworkMode("arbitrum")} />
              </Row>
            </>
          ) : null}

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

          <Label>Enable discount</Label>
          <Row>
            <Pill active={discountEnabled} label="On" onPress={() => setDiscountEnabled(true)} />
            <Pill active={!discountEnabled} label="Off" onPress={() => setDiscountEnabled(false)} />
          </Row>
          {discountEnabled ? (
            <>
              <Label>Original price</Label>
              <Input value={discountOriginalPrice} onChangeText={setDiscountOriginalPrice} placeholder="e.g. 50000" keyboardType="numeric" />
              <Label>Discounted price</Label>
              <Input value={discountPrice} onChangeText={setDiscountPrice} placeholder="e.g. 35000" keyboardType="numeric" />
              {Number.isFinite(liveOriginalLocal) && liveOriginalLocal > 0 ? (
                <Text style={{ marginTop: 8, color: MUTED, fontSize: 12 }}>
                  Before: {formatCurrency(localCurrency, liveOriginalLocal)} | USD: {formatCurrency("USD", liveOriginalUsd)}
                </Text>
              ) : null}
              {Number.isFinite(liveDiscountedLocal) && liveDiscountedLocal > 0 ? (
                <Text style={{ marginTop: 4, color: MUTED, fontSize: 12 }}>
                  After: {formatCurrency(localCurrency, liveDiscountedLocal)} | USD: {formatCurrency("USD", liveDiscountedUsd)}
                </Text>
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

          {category === "product" ? (
            <>
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
            </>
          ) : null}
        </CardBox>

        <CardBox>
          <Text style={{ color: "#fff", fontWeight: "900" }}>Media</Text>
          <Text style={{ marginTop: 6, color: MUTED, fontSize: 12 }}>
            {category === "product"
              ? "Add at least 1 image. The first image becomes the cover."
              : deliveryType === "digital"
              ? "Add an image OR provide a website URL. Images make your listing look more trusted."
              : "Add at least 1 image."}
          </Text>

          <Pressable
            onPress={pickImages}
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
            <Text style={{ color: "#fff", fontWeight: "900" }}>{images.length ? "Add more images" : "Pick images"}</Text>
          </Pressable>

          {images.length > 0 ? (
            <View style={{ marginTop: 12, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              {images.map((img, idx) => (
                <Pressable
                  key={`${img.uri}-${idx}`}
                  onPress={() => removeImage(idx)}
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
                  <Image source={{ uri: img.uri }} style={{ width: "100%", height: "100%" }} />
                  <View style={{ position: "absolute", left: 8, top: 8, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 999, backgroundColor: "rgba(0,0,0,0.55)" }}>
                    <Text style={{ color: "#fff", fontWeight: "900", fontSize: 11 }}>{idx === 0 ? "Cover" : `#${idx + 1}`}</Text>
                  </View>
                  <View style={{ position: "absolute", right: 8, top: 8, width: 28, height: 28, borderRadius: 999, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="close" size={16} color="#fff" />
                  </View>
                </Pressable>
              ))}
            </View>
          ) : null}
        </CardBox>

        {stage ? (
          <View style={{ marginTop: 12, borderRadius: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.10)", backgroundColor: "rgba(255,255,255,0.06)", padding: 12, flexDirection: "row", gap: 10, alignItems: "center" }}>
            <ActivityIndicator color="#fff" />
            <Text style={{ color: "rgba(255,255,255,0.85)", fontWeight: "900" }}>{stage}</Text>
          </View>
        ) : null}

        <Pressable
          disabled={submitting}
          onPress={onSubmit}
          style={{
            marginTop: 14,
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
      </ScrollView>
    </LinearGradient>
  );
}
