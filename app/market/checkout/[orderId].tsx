import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import { createPublicClient, formatUnits, http } from "viem";

import AppHeader from "@/components/common/AppHeader";
import BalanceVisibilityToggle from "@/components/common/BalanceVisibilityToggle";
import ListingOriginBadge from "@/components/market/ListingOriginBadge";
import { useBalanceVisibility } from "@/hooks/useBalanceVisibility";
import MarketPolicyPanel from "@/components/policies/MarketPolicyPanel";
import { useMarketPolicyBlocks } from "@/hooks/policy/useMarketPolicyBlocks";
import { supabase } from "@/services/supabase";
import {
  DeliveryGeo,
  availabilityMayMatch,
  formatAvailabilitySummary,
  getCurrentLocationWithGeocode,
  toDeliveryGeo,
} from "@/utils/location";
import {
  getMyWalletForChain,
  isWalletMismatchError,
  payUsdcForOrder,
  payUsdtForOrder,
  replaceSavedWalletWithDevice,
} from "@/services/market/usdcCheckout";
import {
  fetchMarketChains,
  getPreferredMarketChain,
  setPreferredMarketChain,
  type MarketChainConfig,
} from "@/services/market/chainConfig";
import {
  generateOrderAiRisk,
  type MarketOrderAiRiskResult,
} from "@/services/market/ai";
import { friendlyMarketError } from "@/utils/marketUx";
import { resolveUserCountry, type UserCountry } from "@/utils/country";
import { getRpcUrlForChain } from "@/utils/aaWallet";

// ─── Brand Tokens ─────────────────────────────────────────────────────────────
const BG0 = "#060807";
const BG1 = "#10130E";
const BG2 = "#171A13";
const AMBER = "#F4B75D";
const TEAL = "#2DD4BF";
const BLUE = "#38BDF8";
const ROSE = "#FB7185";
const GOLD = "#FDE68A";

const TEXT = "#FFFDF7";
const MUTED = "rgba(255,253,247,0.68)";
const FAINT = "rgba(255,253,247,0.44)";
const CARD = "rgba(255,253,247,0.065)";
const CARD_RAISED = "rgba(255,253,247,0.09)";
const BORDER = "rgba(255,253,247,0.12)";
const BORDER_TOP = "rgba(255,253,247,0.24)";

const AMBER_GLASS = "rgba(244,183,93,0.13)";
const AMBER_BORDER = "rgba(244,183,93,0.42)";
const TEAL_GLASS = "rgba(45,212,191,0.12)";
const TEAL_BORDER = "rgba(45,212,191,0.35)";
const ROSE_GLASS = "rgba(251,113,133,0.12)";
const ROSE_BORDER = "rgba(251,113,133,0.35)";
const GOLD_GLASS = "rgba(251,191,36,0.12)";
const GOLD_BORDER = "rgba(251,191,36,0.40)";

// ─── ERC20 ABI (unchanged) ────────────────────────────────────────────────────
const ERC20_ABI = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// ─── Helpers (all logic unchanged) ───────────────────────────────────────────

function shouldExitCheckoutForStatus(status: unknown) {
  const s = String(status ?? "").trim().toUpperCase();
  if (!s) return false;
  return s !== "CREATED" && s !== "PENDING_PAYMENT";
}

function isAddress(v?: string | null) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(v || ""));
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function isUsableAddress(value?: string | null) {
  const raw = String(value || "").trim();
  return isAddress(raw) && raw.toLowerCase() !== ZERO_ADDRESS;
}

function titleCaseChain(chain?: string | null) {
  const raw = String(chain || "").trim();
  if (!raw) return "Network";
  if (raw.toLowerCase() === "bnb") return "BNB";
  return raw
    .split("_")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function compactAddress(value?: string | null) {
  const raw = String(value || "").trim();
  if (!isAddress(raw)) return "";
  return `${raw.slice(0, 6)}...${raw.slice(-4)}`;
}

function chainAccent(chain?: string | null) {
  const raw = String(chain || "").toLowerCase();
  if (raw.includes("arc")) return "#22D3EE";
  if (raw.includes("base")) return "#60A5FA";
  if (raw.includes("polygon")) return "#A78BFA";
  if (raw.includes("bnb")) return "#FDE68A";
  return "#2DD4BF";
}

function isConfiguredActiveChain(chain: MarketChainConfig) {
  return (
    chain.active === true &&
    Number(chain.chain_id || 0) > 0 &&
    isUsableAddress(chain.usdc_address) &&
    isUsableAddress(chain.escrow_address)
  );
}

function selectedListingChain(paymentOptions: unknown) {
  const options = parseJsonObject(paymentOptions) ?? {};
  const mode = String((options as any)?.chain_mode ?? "")
    .trim()
    .toLowerCase();
  if (!mode || mode === "all") return "";
  return mode;
}

function chainSupportsCheckoutRoutes(
  chain: MarketChainConfig,
  allowUsdc: boolean,
  allowUsdt: boolean,
  requiredChain?: string | null
) {
  if (!isConfiguredActiveChain(chain)) return false;
  const required = String(requiredChain || "").trim().toLowerCase();
  if (required && String(chain.chain || "").toLowerCase() !== required)
    return false;
  if (!allowUsdc && !allowUsdt) return true;
  return (
    (allowUsdc && isUsableAddress(chain.usdc_address)) ||
    (allowUsdt && isUsableAddress(chain.usdt_address))
  );
}

function chainTokenLabels(
  chain: MarketChainConfig,
  allowUsdc: boolean,
  allowUsdt: boolean
) {
  const labels: string[] = [];
  if (allowUsdc && isUsableAddress(chain.usdc_address)) labels.push("USDC");
  if (allowUsdt && isUsableAddress(chain.usdt_address)) labels.push("USDT");
  return labels;
}

function isHexHash(v?: string | null) {
  return /^0x[a-fA-F0-9]{64}$/.test(String(v || "").trim());
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
  return typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function getStableRouteFlags(
  paymentOptions: unknown,
  listingCurrency: unknown
) {
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

function normalizeDeliveryGeo(value: unknown): DeliveryGeo | null {
  const raw = parseJsonObject(value) as any;
  if (!raw) return null;
  const next = toDeliveryGeo({
    coords: { lat: raw?.lat ?? raw?.latitude, lng: raw?.lng ?? raw?.longitude },
    geo: {
      city: raw?.city,
      region: raw?.region ?? raw?.state,
      country: raw?.country,
      countryCode: raw?.countryCode ?? raw?.country_code,
      subregion: raw?.subregion,
      district: raw?.district,
      town: raw?.town,
      locality: raw?.locality,
    },
    label: raw?.label,
    continent: raw?.continent,
  });
  const hasContent =
    Number.isFinite(next.lat) ||
    Number.isFinite(next.lng) ||
    !!next.city ||
    !!next.region ||
    !!next.country ||
    !!next.countryCode ||
    !!next.label;
  return hasContent ? next : null;
}

function normalizeBuyerContact(value: unknown) {
  const raw = parseJsonObject(value) as any;
  return {
    name: String(raw?.name ?? "").trim(),
    phone: String(raw?.phone ?? "").trim(),
    email: String(raw?.email ?? "").trim(),
    note: String(raw?.note ?? "").trim(),
  };
}

function riskColor(level?: string) {
  const risk = String(level || "").toUpperCase();
  if (risk === "URGENT" || risk === "HIGH") return ROSE;
  if (risk === "MEDIUM") return GOLD;
  return TEAL;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionLabel({ text }: { text: string }) {
  return (
    <View style={styles.sectionLabelRow}>
      <View style={styles.sectionLabelBar} />
      <Text style={styles.sectionLabelText}>{text.toUpperCase()}</Text>
    </View>
  );
}

function Card({
  children,
  style,
  teal,
  amber,
  rose,
}: {
  children: React.ReactNode;
  style?: any;
  teal?: boolean;
  amber?: boolean;
  rose?: boolean;
}) {
  return (
    <View
      style={[
        styles.card,
        teal && styles.cardTeal,
        amber && styles.cardAmber,
        rose && styles.cardRose,
        style,
      ]}
    >
      {children}
    </View>
  );
}

function InputField({
  value,
  onChangeText,
  placeholder,
  keyboardType,
  autoCapitalize,
  label,
}: {
  value: string;
  onChangeText: (t: string) => void;
  placeholder: string;
  keyboardType?: any;
  autoCapitalize?: any;
  label?: string;
}) {
  return (
    <View style={{ marginTop: 10 }}>
      {label ? (
        <Text style={styles.inputLabel}>{label}</Text>
      ) : null}
      <View style={styles.inputBox}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={FAINT}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          style={styles.inputText}
        />
      </View>
    </View>
  );
}

function PaymentPill({
  icon,
  title,
  subtitle,
  onPress,
  disabled,
  accent,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
  disabled?: boolean;
  accent?: string;
}) {
  const color = accent ?? TEAL;
  return (
    <Pressable
      disabled={!!disabled}
      onPress={onPress}
      style={[
        styles.paymentPill,
        {
          borderColor: disabled ? BORDER : `${color}55`,
          backgroundColor: disabled ? CARD : `${color}14`,
          opacity: disabled ? 0.65 : 1,
        },
      ]}
    >
      <View
        style={[
          styles.paymentPillIcon,
          { backgroundColor: `${color}28`, borderColor: `${color}44` },
        ]}
      >
        <Ionicons name={icon} size={22} color={disabled ? FAINT : color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={[
            styles.paymentPillTitle,
            { color: disabled ? MUTED : TEXT },
          ]}
        >
          {title}
        </Text>
        <Text style={styles.paymentPillSub}>{subtitle}</Text>
      </View>
      <Ionicons
        name="chevron-forward"
        size={18}
        color={disabled ? FAINT : MUTED}
      />
    </Pressable>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function Checkout() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const oid = useMemo(() => String(orderId || ""), [orderId]);
  const { balancesHidden, toggleBalancesHidden } = useBalanceVisibility();

  // Responsive layout
  const isTablet = width >= 640;
  const isDesktop = width >= 1024;
  const sidePadding = isDesktop ? 40 : isTablet ? 24 : 16;
  const contentMaxWidth = 860;

  // ─── State (all unchanged) ───────────────────────────────────────────────────
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<any>(null);
  const [listing, setListing] = useState<any>(null);
  const [deliveryGeo, setDeliveryGeo] = useState<DeliveryGeo | null>(null);
  const [savingGeo, setSavingGeo] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactNote, setContactNote] = useState("");
  const [savingContact, setSavingContact] = useState(false);
  const [chains, setChains] = useState<MarketChainConfig[]>([]);
  const [chain, setChain] = useState<MarketChainConfig | null>(null);
  const [walletAddress, setWalletAddress] = useState("");
  const [usdcBalance, setUsdcBalance] = useState(0);
  const [usdtBalance, setUsdtBalance] = useState(0);
  const [fundingLoading, setFundingLoading] = useState(false);
  const [userCountry, setUserCountry] = useState<UserCountry | null>(null);
  const [riskBusy, setRiskBusy] = useState(false);
  const [riskResult, setRiskResult] =
    useState<MarketOrderAiRiskResult | null>(null);

  const autoRoutedRef = useRef(false);
  const paymentResultShownRef = useRef(false);

  // ─── Derived values (all unchanged) ──────────────────────────────────────────
  const listingCurrency = String(
    (listing as any)?.currency ?? ""
  ).toUpperCase();
  const orderCurrency = String(
    (order as any)?.currency ?? listingCurrency
  ).toUpperCase();
  const orderAmount = Number((order as any)?.amount ?? 0);
  const orderStatus = String((order as any)?.status ?? "").toUpperCase();
  const orderQty = Math.max(1, Number((order as any)?.quantity ?? 1));
  const orderUnitPrice = Number(
    (order as any)?.unit_price ??
      (orderQty > 0 ? orderAmount / orderQty : orderAmount)
  );
  const paymentOptions = ((listing as any)?.payment_options ?? {}) as any;

  const { bySection: checkoutPolicy, loading: checkoutPolicyLoading } =
    useMarketPolicyBlocks({
      surface: "checkout",
      audience: "buyer",
      orderStatus,
    });

  const { allowUsdc, allowUsdt } = getStableRouteFlags(
    paymentOptions,
    listingCurrency
  );
  const requiredChain = selectedListingChain(paymentOptions);
  const enabledRoutes = [
    allowUsdc ? "USDC" : null,
    allowUsdt ? "USDT" : null,
  ].filter(Boolean) as string[];
  const usdcRequired = allowUsdc ? orderAmount : 0;
  const usdtRequired = allowUsdt ? orderAmount : 0;

  const availableChains = useMemo(
    () =>
      chains.filter((c) =>
        chainSupportsCheckoutRoutes(c, allowUsdc, allowUsdt, requiredChain)
      ),
    [allowUsdc, allowUsdt, chains, requiredChain]
  );

  const selectedChainStillAvailable =
    !!chain && availableChains.some((c) => c.chain === chain.chain);
  const selectedChainLabels = chain
    ? chainTokenLabels(chain, allowUsdc, allowUsdt)
    : [];
  const canPayUsdc =
    !!chain && allowUsdc && isUsableAddress(chain.usdc_address);
  const canPayUsdt =
    !!chain && allowUsdt && isUsableAddress(chain.usdt_address);
  const usdcShortfall =
    canPayUsdc && usdcRequired > 0
      ? Math.max(0, usdcRequired - usdcBalance)
      : 0;
  const usdtShortfall =
    canPayUsdt && usdtRequired > 0
      ? Math.max(0, usdtRequired - usdtBalance)
      : 0;
  const noActiveCheckoutNetwork =
    enabledRoutes.length > 0 && availableChains.length === 0;
  const deliveryLat = Number(deliveryGeo?.lat);
  const deliveryLng = Number(deliveryGeo?.lng);
  const hasDeliveryCoords =
    Number.isFinite(deliveryLat) && Number.isFinite(deliveryLng);

  // ─── Auth helper (unchanged) ──────────────────────────────────────────────────
  async function requireAuth() {
    const { data } = await supabase.auth.getUser();
    const user = data?.user;
    if (!user) {
      router.replace("/(auth)/login" as any);
      return null;
    }
    return user;
  }

  // ─── refreshFunding (unchanged logic) ────────────────────────────────────────
  async function refreshFunding(
    selectedChain?: MarketChainConfig | null
  ) {
    const active = selectedChain ?? chain;
    setFundingLoading(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user) {
        setUsdcBalance(0);
        setUsdtBalance(0);
        setWalletAddress("");
        return;
      }
      if (!active) {
        setUsdcBalance(0);
        setUsdtBalance(0);
        setWalletAddress("");
        return;
      }
      const wallet = await getMyWalletForChain(active.chain).catch(
        () => null
      );
      const addr = String((wallet as any)?.address || "").trim();
      setWalletAddress(addr);
      if (!isAddress(addr)) {
        setUsdcBalance(0);
        setUsdtBalance(0);
        return;
      }
      const rpc = getRpcUrlForChain(active);
      if (!rpc) {
        setUsdcBalance(0);
        setUsdtBalance(0);
        return;
      }
      const client = createPublicClient({ transport: http(rpc) });
      try {
        if (isAddress(active.usdc_address)) {
          const d = Number(
            await client.readContract({
              address: active.usdc_address as `0x${string}`,
              abi: ERC20_ABI,
              functionName: "decimals",
            })
          );
          const raw = await client.readContract({
            address: active.usdc_address as `0x${string}`,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [addr as `0x${string}`],
          });
          setUsdcBalance(Number(formatUnits(raw as bigint, d)));
        } else {
          setUsdcBalance(0);
        }
      } catch {
        setUsdcBalance(0);
      }
      try {
        if (isAddress(active.usdt_address)) {
          const d = Number(
            await client.readContract({
              address: active.usdt_address as `0x${string}`,
              abi: ERC20_ABI,
              functionName: "decimals",
            })
          );
          const raw = await client.readContract({
            address: active.usdt_address as `0x${string}`,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [addr as `0x${string}`],
          });
          setUsdtBalance(Number(formatUnits(raw as bigint, d)));
        } else {
          setUsdtBalance(0);
        }
      } catch {
        setUsdtBalance(0);
      }
    } finally {
      setFundingLoading(false);
    }
  }

  // ─── Effects (all unchanged) ──────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!oid) return;
      setLoading(true);
      try {
        let o: any = null;
        {
          const first = await supabase
            .from("market_orders")
            .select(
              "id,listing_id,status,quantity,unit_price,amount,currency,delivery_address,buyer_contact"
            )
            .eq("id", oid)
            .maybeSingle();
          if (!first.error) {
            o = first.data;
          } else if (
            String(first.error.message || "").includes("buyer_contact")
          ) {
            const fallback = await supabase
              .from("market_orders")
              .select(
                "id,listing_id,status,quantity,unit_price,amount,currency,delivery_address"
              )
              .eq("id", oid)
              .maybeSingle();
            if (fallback.error) throw fallback.error;
            o = fallback.data;
          } else {
            throw first.error;
          }
        }

        const listingId = (o as any)?.listing_id;
        let l: any = null;
        if (listingId) {
          const { data: lRow, error: lErr } = await supabase
            .from("market_listings")
            .select(
              "id,title,delivery_type,availability,currency,payment_options"
            )
            .eq("id", listingId)
            .maybeSingle();
          if (lErr) throw lErr;
          l = lRow;
        }

        if (mounted) {
          const parsedOrder = o
            ? {
                ...o,
                delivery_address:
                  parseJsonObject((o as any)?.delivery_address) ?? {},
                buyer_contact: normalizeBuyerContact(
                  (o as any)?.buyer_contact
                ),
              }
            : null;
          const parsedListing = l
            ? {
                ...l,
                availability:
                  parseJsonObject((l as any)?.availability) ??
                  (l as any)?.availability ??
                  {},
                payment_options:
                  parseJsonObject((l as any)?.payment_options) ??
                  (l as any)?.payment_options ??
                  {},
              }
            : null;
          const geo = normalizeDeliveryGeo(
            (parsedOrder as any)?.delivery_address?.geo
          );
          const contact = normalizeBuyerContact(
            (parsedOrder as any)?.buyer_contact ??
              (parsedOrder as any)?.delivery_address?.contact
          );
          setOrder(parsedOrder);
          setListing(parsedListing);
          setDeliveryGeo(geo);
          setContactName(String(contact?.name ?? ""));
          setContactPhone(String(contact?.phone ?? ""));
          setContactEmail(String(contact?.email ?? ""));
          setContactNote(String(contact?.note ?? ""));
        }
      } catch (e: any) {
        if (mounted)
          setErr(
            friendlyMarketError(
              e,
              "We couldn't load this checkout right now."
            )
          );
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    (async () => {
      const all = (await fetchMarketChains().catch(
        () => []
      )) as MarketChainConfig[];
      const activeConfigured = all.filter(isConfiguredActiveChain);
      const preferred = await getPreferredMarketChain().catch(() => null);
      const preferredActive =
        preferred &&
        activeConfigured.find((c) => c.chain === preferred.chain);
      if (!mounted) return;
      setChains(activeConfigured);
      setChain(preferredActive ?? activeConfigured[0] ?? null);
    })();

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
  }, [oid]);

  useEffect(() => {
    refreshFunding();
  }, [
    chain?.chain,
    order?.id,
    order?.amount,
    order?.currency,
    userCountry?.code,
    userCountry?.name,
  ]);

  useEffect(() => {
    if (!chains.length) {
      setChain(null);
      return;
    }
    if (!enabledRoutes.length) return;
    if (selectedChainStillAvailable) return;
    const next = availableChains[0] ?? null;
    setChain(next);
    if (next) void setPreferredMarketChain(next.chain);
  }, [
    availableChains,
    chains.length,
    enabledRoutes.length,
    selectedChainStillAvailable,
  ]);

// ─── Real-time crypto intent tracking for deposit confirmation ────────────────────
   useEffect(() => {
     if (!oid) return;
     const channel = supabase
       .channel(`checkout-intents-${oid}`)
       .on(
         "postgres_changes",
         {
           event: "INSERT",
           schema: "public",
           table: "market_crypto_intents",
           filter: `order_id=eq.${oid}`,
         },
         async (payload) => {
           const intent = (payload.new ?? {}) as any;
           const intentType = String(intent?.intent_type ?? "").toUpperCase();
           const intentStatus = String(intent?.status ?? "").toUpperCase();
           if (intentType === "DEPOSIT") {
             if (intentStatus === "CONFIRMED") {
               Alert.alert(
                 "Deposit Confirmed!",
                 "Your transaction was confirmed. The order status will update when escrow is funded.",
                 [{ text: "OK", onPress: () => {} }]
               );
             }
           }
         }
       )
       .on(
         "postgres_changes",
         {
           event: "UPDATE",
           schema: "public",
           table: "market_crypto_intents",
           filter: `order_id=eq.${oid}`,
         },
         async (payload) => {
           const intent = (payload.new ?? {}) as any;
           const intentType = String(intent?.intent_type ?? "").toUpperCase();
           const intentStatus = String(intent?.status ?? "").toUpperCase();
           const prevStatus = String(intent?._prev_status ?? intent?.status ?? "").toUpperCase();
           if (intentType === "DEPOSIT" && prevStatus !== "CONFIRMED" && intentStatus === "CONFIRMED") {
             Alert.alert(
               "Deposit Confirmed!",
               "Your transaction was confirmed. The order status will update when escrow is funded.",
               [{ text: "OK", onPress: () => {} }]
             );
           }
         }
       )
       .subscribe();
     return () => {
       void supabase.removeChannel(channel);
     };
   }, [oid]);

   // ─── Real-time order status (auto-redirect when escrow funded) ───────────────────────
   useEffect(() => {
     if (!oid) return;
     const channel = supabase
       .channel(`checkout-order-${oid}`)
       .on(
         "postgres_changes",
         {
           event: "UPDATE",
           schema: "public",
           table: "market_orders",
           filter: `id=eq.${oid}`,
         },
         (payload) => {
           const next = (payload.new ?? {}) as any;
           const prevStatus = String(order?.status ?? "").toUpperCase();
           const newStatus = String(next?.status ?? "").toUpperCase();
           setOrder((prev: any) => ({ ...(prev ?? {}), ...next }));
           if (prevStatus !== "IN_ESCROW" && newStatus === "IN_ESCROW") {
             // Escrow funded - show notification and auto-redirect
             Alert.alert(
               "Escrow Funded!",
               "Your payment has been confirmed and is now secured in escrow. You'll be redirected to track your order.",
               [
                 {
                   text: "View Order",
                   onPress: () => router.replace(`/market/order/${oid}` as any),
                 },
               ]
             );
           }
         }
       )
       .subscribe();
     return () => {
       void supabase.removeChannel(channel);
     };
   }, [oid, order?.status]);

  useEffect(() => {
    if (!oid || autoRoutedRef.current) return;
    if (busy || paymentResultShownRef.current) return;
    if (!shouldExitCheckoutForStatus(orderStatus)) return;
    autoRoutedRef.current = true;
    router.replace(`/market/order/${oid}` as any);
  }, [busy, oid, orderStatus]);

  // ─── Actions (all unchanged logic) ───────────────────────────────────────────
  async function saveDeliveryGeo(geo: DeliveryGeo) {
    if (!oid) return;
    setSavingGeo(true);
    try {
      const next = { ...(order?.delivery_address ?? {}), geo };
      const { error } = await supabase
        .from("market_orders")
        .update({ delivery_address: next })
        .eq("id", oid);
      if (error) throw error;
      setOrder((prev: any) => ({
        ...(prev ?? {}),
        delivery_address: next,
      }));
      setDeliveryGeo(geo);
    } catch (e: any) {
      setErr(friendlyMarketError(e, "We couldn't save your location."));
    } finally {
      setSavingGeo(false);
    }
  }

  async function useCurrentLocation() {
    setErr(null);
    setSavingGeo(true);
    try {
      const res = await getCurrentLocationWithGeocode();
      const geo: DeliveryGeo = toDeliveryGeo({
        coords: res.coords,
        geo: res.geo,
        label: res.label,
        continent: userCountry?.continent,
      });
      await saveDeliveryGeo(geo);
    } catch (e: any) {
      setErr(
        friendlyMarketError(e, "We couldn't access your location.")
      );
    } finally {
      setSavingGeo(false);
    }
  }

  async function saveBuyerContact() {
    if (!oid) return;
    setErr(null);
    setSavingContact(true);
    try {
      const payload = {
        name: contactName.trim(),
        phone: contactPhone.trim(),
        email: contactEmail.trim(),
        note: contactNote.trim(),
      };
      if (!payload.phone && !payload.email) {
        throw new Error("Please add at least phone or email.");
      }
      const primary = await supabase
        .from("market_orders")
        .update({ buyer_contact: payload })
        .eq("id", oid);
      if (
        primary.error &&
        String(primary.error.message || "").includes("buyer_contact")
      ) {
        const nextDelivery = {
          ...(order?.delivery_address ?? {}),
          contact: payload,
        };
        const fallback = await supabase
          .from("market_orders")
          .update({ delivery_address: nextDelivery })
          .eq("id", oid);
        if (fallback.error) throw fallback.error;
      } else if (primary.error) {
        throw primary.error;
      }
      setOrder((prev: any) => ({
        ...(prev ?? {}),
        buyer_contact: payload,
      }));
    } catch (e: any) {
      setErr(
        friendlyMarketError(
          e,
          "We couldn't save your contact details."
        )
      );
    } finally {
      setSavingContact(false);
    }
  }

  async function showStableDepositResult(
    symbol: "USDC" | "USDT",
    res: any
  ) {
    const txHash = String(res?.tx_hash || "").trim();
    const userOpHash = String(res?.user_op_hash || "").trim();
    if (isHexHash(txHash)) {
      paymentResultShownRef.current = true;
      Alert.alert(
        "Transaction successful",
        `Your ${symbol} deposit was sent on-chain. We'll move the order into escrow after confirmations.\n\nTransaction hash:\n${txHash}`,
        [
          {
            text: "Copy tx hash",
            onPress: () => Clipboard.setStringAsync(txHash),
          },
          {
            text: "View history",
            onPress: () =>
              router.push(
                `/market/history?q=${encodeURIComponent(
                  txHash
                )}` as any
              ),
          },
          {
            text: "Continue",
            onPress: () =>
              router.replace(
                `/market/order/${oid}?tx=${encodeURIComponent(
                  txHash
                )}` as any
              ),
          },
        ]
      );
      return;
    }
    if (isHexHash(userOpHash)) {
      paymentResultShownRef.current = true;
      Alert.alert(
        "Transaction submitted",
        `Your ${symbol} deposit was submitted. Confirmation may take a few minutes.\n\nUserOp:\n${userOpHash}\n\nWe'll move the order into escrow after confirmations.`,
        [
          {
            text: "Copy UserOp",
            onPress: () => Clipboard.setStringAsync(userOpHash),
          },
          {
            text: "View history",
            onPress: () =>
              router.push(
                `/market/history?q=${encodeURIComponent(
                  userOpHash
                )}` as any
              ),
          },
          {
            text: "Continue",
            onPress: () =>
              router.replace(
                `/market/order/${oid}?uo=${encodeURIComponent(
                  userOpHash
                )}` as any
              ),
          },
        ]
      );
      return;
    }
    if (!txHash && !userOpHash && res?.pending_index) {
      paymentResultShownRef.current = true;
      Alert.alert(
        "Transaction pending",
        `Your ${symbol} deposit was submitted but the transaction reference is still processing. The order will sync when the on-chain transaction is detected.\n\nCheck your wallet activity and wait a few minutes before refreshing.`,
        [
          {
            text: "Continue",
            onPress: () =>
              router.replace(`/market/order/${oid}` as any),
          },
        ]
      );
      return;
    }
    router.replace(`/market/order/${oid}` as any);
  }

  async function payWithUsdc() {
    if (busy) return;
    setErr(null);
    if (!oid) return setErr("Missing orderId");
    if (!allowUsdc)
      return setErr(
        "This listing does not accept USDC payments."
      );
    if (!chain)
      return setErr(
        "No active checkout network is configured for this order."
      );
    if (!selectedChainStillAvailable)
      return setErr(
        "Selected network is not available for this listing."
      );
    if (!canPayUsdc)
      return setErr(
        `${titleCaseChain(
          chain.chain
        )} is not configured for USDC checkout.`
      );
    if (usdcShortfall > 0) {
      return setErr(
        `Insufficient USDC on selected network. Add ${usdcShortfall.toLocaleString(
          undefined,
          { maximumFractionDigits: 6 }
        )} USDC and retry.`
      );
    }
    const user = await requireAuth();
    if (!user) return;
    console.log("[Checkout] payWithUsdc start", { orderId: oid });
    setBusy(true);
    try {
      const res: any = await payUsdcForOrder(oid, chain);
      await showStableDepositResult("USDC", res);
    } catch (e: any) {
      console.log("[Checkout] payWithUsdc error", {
        message: String(e?.message || e),
      });
      if (isWalletMismatchError(e)) {
        Alert.alert(
          "Wallet mismatch detected",
          "Your saved wallet address does not match your connected wallet. Use connected wallet now and retry?",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Use connected wallet",
              onPress: () => {
                void (async () => {
                  try {
                    setBusy(true);
                    const activeChain = chain;
                    if (!activeChain)
                      throw new Error(
                        "No active chain configuration found."
                      );
                    await replaceSavedWalletWithDevice(
                      activeChain as any
                    );
                    const retried: any = await payUsdcForOrder(
                      oid,
                      activeChain
                    );
                    await showStableDepositResult(
                      "USDC",
                      retried
                    );
                  } catch (retryErr: any) {
                    setErr(
                      friendlyMarketError(
                        retryErr,
                        "Wallet was updated but retry failed."
                      )
                    );
                  } finally {
                    setBusy(false);
                  }
                })();
              },
            },
            {
              text: "Open Wallet",
              onPress: () =>
                router.push("/market/wallet" as any),
            },
          ]
        );
        return;
      }
      setErr(
        friendlyMarketError(
          e,
          "We couldn't start crypto checkout."
        )
      );
    } finally {
      setBusy(false);
      console.log("[Checkout] payWithUsdc end");
    }
  }

  async function payWithUsdt() {
    if (busy) return;
    setErr(null);
    if (!oid) return setErr("Missing orderId");
    if (!allowUsdt)
      return setErr(
        "This listing does not accept USDT payments."
      );
    if (!chain)
      return setErr(
        "No active checkout network is configured for this order."
      );
    if (!selectedChainStillAvailable)
      return setErr(
        "Selected network is not available for this listing."
      );
    if (!canPayUsdt)
      return setErr(
        `${titleCaseChain(
          chain.chain
        )} is not configured for USDT checkout.`
      );
    if (usdtShortfall > 0) {
      return setErr(
        `Insufficient USDT on selected network. Add ${usdtShortfall.toLocaleString(
          undefined,
          { maximumFractionDigits: 6 }
        )} USDT and retry.`
      );
    }
    const user = await requireAuth();
    if (!user) return;
    console.log("[Checkout] payWithUsdt start", { orderId: oid });
    setBusy(true);
    try {
      const res: any = await payUsdtForOrder(oid, chain);
      await showStableDepositResult("USDT", res);
    } catch (e: any) {
      console.log("[Checkout] payWithUsdt error", {
        message: String(e?.message || e),
      });
      if (isWalletMismatchError(e)) {
        Alert.alert(
          "Wallet mismatch detected",
          "Your saved wallet address does not match your connected wallet. Use connected wallet now and retry?",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Use connected wallet",
              onPress: () => {
                void (async () => {
                  try {
                    setBusy(true);
                    const activeChain = chain;
                    if (!activeChain)
                      throw new Error(
                        "No active chain configuration found."
                      );
                    await replaceSavedWalletWithDevice(
                      activeChain as any
                    );
                    const retried: any = await payUsdtForOrder(
                      oid,
                      activeChain
                    );
                    await showStableDepositResult(
                      "USDT",
                      retried
                    );
                  } catch (retryErr: any) {
                    setErr(
                      friendlyMarketError(
                        retryErr,
                        "Wallet was updated but retry failed."
                      )
                    );
                  } finally {
                    setBusy(false);
                  }
                })();
              },
            },
            {
              text: "Open Wallet",
              onPress: () =>
                router.push("/market/wallet" as any),
            },
          ]
        );
        return;
      }
      setErr(
        friendlyMarketError(
          e,
          "We couldn't start USDT checkout."
        )
      );
    } finally {
      setBusy(false);
      console.log("[Checkout] payWithUsdt end");
    }
  }

  async function runOrderRiskCheck() {
    if (!oid) return;
    setRiskBusy(true);
    setErr(null);
    try {
      const result = await generateOrderAiRisk(oid);
      setRiskResult(result);
    } catch (e: any) {
      setErr(
        friendlyMarketError(
          e,
          "We couldn't run the order risk check."
        )
      );
    } finally {
      setRiskBusy(false);
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <LinearGradient
      colors={[BG2, BG1, BG0]}
      start={{ x: 0.15, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={{ flex: 1, paddingTop: Math.max(insets.top, 14) }}
    >
      <AppHeader
        title="Checkout"
        subtitle="Choose how you want to pay for this order"
      />

      <ScrollView
        contentContainerStyle={{
          paddingBottom: 40,
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
          {/* ── Header row ────────────────────────────────────────────────────── */}
          <View style={styles.headerRow}>
            <Pressable
              onPress={() => router.back()}
              style={styles.backBtn}
            >
              <Ionicons name="arrow-back" size={20} color={TEXT} />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  styles.pageTitle,
                  { fontSize: isTablet ? 24 : 20 },
                ]}
              >
                Checkout
              </Text>
              <Text style={styles.pageSubtitle}>
                Escrow-protected · Crypto payment
              </Text>
            </View>
          </View>

          {/* ── Order amount card ─────────────────────────────────────────────── */}
          <Card teal style={{ marginTop: 6 }}>
            <SectionLabel text="Order amount" />
            <Text
              style={[
                styles.amountText,
                { fontSize: isTablet ? 38 : 32 },
              ]}
            >
              {Number(orderAmount || 0).toLocaleString(undefined, {
                maximumFractionDigits: 2,
              })}{" "}
              <Text style={styles.amountCurrency}>
                {orderCurrency || listingCurrency || "USDC"}
              </Text>
            </Text>
            <View style={styles.amountMeta}>
              <View style={styles.amountMetaItem}>
                <Ionicons
                  name="layers-outline"
                  size={13}
                  color={TEAL}
                />
                <Text style={styles.amountMetaText}>
                  Qty {orderQty} ×{" "}
                  {Number(orderUnitPrice || 0).toLocaleString(
                    undefined,
                    { maximumFractionDigits: 2 }
                  )}{" "}
                  {orderCurrency || listingCurrency || "USDC"}
                </Text>
              </View>
              <View style={styles.amountMetaItem}>
                <Ionicons
                  name="shield-checkmark-outline"
                  size={13}
                  color={TEAL}
                />
                <Text style={styles.amountMetaText}>
                  Escrow protected
                </Text>
              </View>
            </View>
            <Text
              style={{
                marginTop: 6,
                color: FAINT,
                fontSize: 11,
              }}
            >
              Order ID: {oid}
            </Text>
          </Card>

          {/* ── AI Risk card ──────────────────────────────────────────────────── */}
          <Card
            style={{
              marginTop: 12,
              borderColor: riskResult?.risk
                ? `${riskColor(riskResult.risk.risk_level)}55`
                : BORDER,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <View style={{ flex: 1 }}>
                <SectionLabel text="AI Order Risk" />
                <Text
                  style={{
                    marginTop: 8,
                    color: MUTED,
                    fontSize: 12,
                    lineHeight: 18,
                  }}
                >
                  Checks payment, delivery, escrow, and dispute
                  signals before you pay.
                </Text>
              </View>
              <Pressable
                onPress={runOrderRiskCheck}
                disabled={riskBusy || loading || !oid}
                style={[
                  styles.riskCheckBtn,
                  (riskBusy || loading || !oid) && {
                    opacity: 0.55,
                  },
                ]}
              >
                {riskBusy ? (
                  <ActivityIndicator size="small" color={TEXT} />
                ) : (
                  <Ionicons
                    name="sparkles-outline"
                    size={15}
                    color={TEXT}
                  />
                )}
                <Text style={styles.riskCheckBtnText}>
                  {riskBusy ? "Checking…" : "Check"}
                </Text>
              </Pressable>
            </View>

            {riskResult?.risk ? (
              <View style={{ marginTop: 14, gap: 8 }}>
                <View
                  style={[
                    styles.riskLevelBadge,
                    {
                      backgroundColor: `${riskColor(
                        riskResult.risk.risk_level
                      )}18`,
                      borderColor: `${riskColor(
                        riskResult.risk.risk_level
                      )}44`,
                    },
                  ]}
                >
                  <Ionicons
                    name="alert-circle-outline"
                    size={14}
                    color={riskColor(riskResult.risk.risk_level)}
                  />
                  <Text
                    style={{
                      color: riskColor(
                        riskResult.risk.risk_level
                      ),
                      fontWeight: "900",
                      fontSize: 12,
                    }}
                  >
                    {riskResult.risk.risk_level} risk ·{" "}
                    {riskResult.risk.confidence} confidence
                  </Text>
                </View>
                {riskResult.risk.summary ? (
                  <Text
                    style={{
                      color: MUTED,
                      lineHeight: 20,
                      fontSize: 13,
                    }}
                  >
                    {riskResult.risk.summary}
                  </Text>
                ) : null}
                {[
                  ...riskResult.risk.mismatch_flags,
                  ...riskResult.risk.payment_flags,
                  ...riskResult.risk.delivery_flags,
                ].length ? (
                  <Text
                    style={{
                      color: riskColor(
                        riskResult.risk.risk_level
                      ),
                      fontSize: 12,
                      lineHeight: 18,
                    }}
                  >
                    Flags:{" "}
                    {[
                      ...riskResult.risk.mismatch_flags,
                      ...riskResult.risk.payment_flags,
                      ...riskResult.risk.delivery_flags,
                    ].join(", ")}
                  </Text>
                ) : null}
                {riskResult.risk.recommended_actions?.length ? (
                  <Text
                    style={{
                      color: MUTED,
                      fontSize: 12,
                      lineHeight: 18,
                    }}
                  >
                    Next:{" "}
                    {riskResult.risk.recommended_actions.join(
                      " "
                    )}
                  </Text>
                ) : null}
                {riskResult.risk.buyer_note ? (
                  <Text
                    style={{
                      color: MUTED,
                      fontSize: 12,
                      lineHeight: 18,
                    }}
                  >
                    {riskResult.risk.buyer_note}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </Card>

          {/* ── Policy panels ─────────────────────────────────────────────────── */}
          <Card style={{ marginTop: 12 }}>
            <SectionLabel text="Checkout policy" />
            <View style={{ marginTop: 10 }}>
              <MarketPolicyPanel
                title="Checkout flow"
                blocks={checkoutPolicy.flow}
                emptyText={
                  checkoutPolicyLoading
                    ? "Loading policy..."
                    : "Policy unavailable."
                }
              />
              <MarketPolicyPanel
                title="Safety and complaints"
                blocks={checkoutPolicy.safety}
                emptyText={
                  checkoutPolicyLoading
                    ? "Loading policy..."
                    : "Policy unavailable."
                }
              />
            </View>
          </Card>

          {/* ── Availability / Delivery ───────────────────────────────────────── */}
          <Card style={{ marginTop: 12 }}>
            <SectionLabel text="Delivery location" />

            <View style={{ marginTop: 12 }}>
              <ListingOriginBadge
                availability={listing?.availability}
                paymentOptions={listing?.payment_options}
              />
            </View>

            <Text
              style={{
                marginTop: 8,
                color: MUTED,
                lineHeight: 20,
                fontSize: 13,
              }}
            >
              {formatAvailabilitySummary(listing?.availability)}
            </Text>

            {deliveryGeo &&
            !availabilityMayMatch(listing?.availability, {
              ...deliveryGeo,
              continent:
                deliveryGeo.continent || userCountry?.continent,
            }) ? (
              <View style={[styles.warningBanner, { marginTop: 10 }]}>
                <Ionicons
                  name="warning-outline"
                  size={14}
                  color={GOLD}
                />
                <Text style={styles.warningText}>
                  Your delivery location may be outside the
                  seller&apos;s availability. You can still
                  continue.
                </Text>
              </View>
            ) : null}

            <Pressable
              onPress={useCurrentLocation}
              disabled={savingGeo}
              style={[
                styles.outlineBtn,
                {
                  marginTop: 12,
                  opacity: savingGeo ? 0.7 : 1,
                },
              ]}
            >
              {savingGeo ? (
                <ActivityIndicator color={AMBER} size="small" />
              ) : (
                <Ionicons
                  name="locate-outline"
                  size={17}
                  color={AMBER}
                />
              )}
              <Text
                style={[styles.outlineBtnText, { color: AMBER }]}
              >
                Use my current location
              </Text>
            </Pressable>

            {loading ? (
              <Text style={styles.locationStatus}>
                Loading order details…
              </Text>
            ) : deliveryGeo ? (
              <View style={styles.geoTag}>
                <Ionicons
                  name="checkmark-circle-outline"
                  size={13}
                  color={TEAL}
                />
                <Text
                  style={styles.geoTagText}
                  numberOfLines={1}
                >
                  {deliveryGeo.label || "Saved"}
                  {hasDeliveryCoords
                    ? ` · ${deliveryLat.toFixed(5)}, ${deliveryLng.toFixed(5)}`
                    : ""}
                </Text>
              </View>
            ) : (
              <Text style={styles.locationStatus}>
                No delivery location selected.
              </Text>
            )}
          </Card>

          {/* ── Buyer contact ─────────────────────────────────────────────────── */}
          <Card style={{ marginTop: 12 }}>
            <SectionLabel text="Buyer contact" />
            <Text
              style={{
                marginTop: 8,
                color: MUTED,
                fontSize: 12,
                lineHeight: 18,
              }}
            >
              Your contact details will be shared with the seller
              to coordinate delivery or service.
            </Text>

            <InputField
              value={contactName}
              onChangeText={setContactName}
              placeholder="Full name (optional)"
              label="Name"
            />
            <InputField
              value={contactPhone}
              onChangeText={setContactPhone}
              placeholder="Phone number"
              keyboardType="phone-pad"
              label="Phone"
            />
            <InputField
              value={contactEmail}
              onChangeText={setContactEmail}
              placeholder="Email address"
              keyboardType="email-address"
              autoCapitalize="none"
              label="Email"
            />
            <InputField
              value={contactNote}
              onChangeText={setContactNote}
              placeholder="Extra note (optional)"
              label="Note"
            />

            <Pressable
              onPress={saveBuyerContact}
              disabled={savingContact}
              style={[
                styles.outlineBtn,
                {
                  marginTop: 14,
                  opacity: savingContact ? 0.7 : 1,
                },
              ]}
            >
              {savingContact ? (
                <ActivityIndicator color={TEAL} size="small" />
              ) : (
                <Ionicons
                  name="save-outline"
                  size={16}
                  color={TEAL}
                />
              )}
              <Text
                style={[styles.outlineBtnText, { color: TEAL }]}
              >
                Save contact
              </Text>
            </Pressable>
          </Card>

          {/* ── Payment options ───────────────────────────────────────────────── */}
          <Card style={{ marginTop: 12 }}>
            <SectionLabel text="Payment" />

            {!enabledRoutes.length ? (
              <View style={[styles.errorBanner, { marginTop: 12 }]}>
                <Ionicons
                  name="alert-circle-outline"
                  size={14}
                  color={ROSE}
                />
                <Text style={styles.errorText}>
                  This listing has no active crypto checkout route.
                  Ask the seller to republish with USDC or USDT
                  enabled.
                </Text>
              </View>
            ) : null}

            {noActiveCheckoutNetwork ? (
              <View style={[styles.errorBanner, { marginTop: 12 }]}>
                <Ionicons
                  name="alert-circle-outline"
                  size={14}
                  color={ROSE}
                />
                <Text style={styles.errorText}>
                  No active network can accept{" "}
                  {enabledRoutes.join(" or ")}
                  {requiredChain
                    ? ` on ${titleCaseChain(requiredChain)}`
                    : ""}{" "}
                  for this order. Activate the chain in
                  market_chain_config.
                </Text>
              </View>
            ) : null}

            {/* Balances panel */}
            <View
              style={[
                styles.balancePanel,
                {
                  borderColor: chain
                    ? `${chainAccent(chain.chain)}55`
                    : BORDER,
                  backgroundColor: chain
                    ? `${chainAccent(chain.chain)}0E`
                    : CARD,
                },
              ]}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                }}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.balancePanelTitle}>
                    {chain
                      ? `${titleCaseChain(chain.chain)} balances`
                      : "Available balances"}
                  </Text>
                  <Text
                    style={styles.balancePanelSub}
                    numberOfLines={1}
                  >
                    {chain
                      ? `Chain ID ${chain.chain_id}${
                          selectedChainLabels.length
                            ? ` · ${selectedChainLabels.join(
                                " + "
                              )}`
                            : ""
                        }`
                      : "Choose an active network below"}
                  </Text>
                </View>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <BalanceVisibilityToggle
                    hidden={balancesHidden}
                    onPress={() => void toggleBalancesHidden()}
                    size={30}
                  />
                  <Pressable
                    onPress={() => refreshFunding()}
                    style={styles.refreshBtn}
                  >
                    <Ionicons
                      name="refresh"
                      size={14}
                      color={TEXT}
                    />
                  </Pressable>
                </View>
              </View>

              <View style={{ marginTop: 12, gap: 6 }}>
                <View style={styles.balanceRow}>
                  <View style={styles.balanceTokenDot} />
                  <Text style={styles.balanceLabel}>USDC</Text>
                  <Text style={styles.balanceValue}>
                    {balancesHidden
                      ? "••••••"
                      : usdcBalance.toLocaleString(undefined, {
                          maximumFractionDigits: 6,
                        })}
                  </Text>
                </View>
                <View style={styles.balanceRow}>
                  <View
                    style={[
                      styles.balanceTokenDot,
                      { backgroundColor: GOLD },
                    ]}
                  />
                  <Text style={styles.balanceLabel}>USDT</Text>
                  <Text style={styles.balanceValue}>
                    {balancesHidden
                      ? "••••••"
                      : usdtBalance.toLocaleString(undefined, {
                          maximumFractionDigits: 6,
                        })}
                  </Text>
                </View>
              </View>

              {walletAddress ? (
                <Text style={styles.walletAddress}>
                  Wallet: {compactAddress(walletAddress)}
                </Text>
              ) : null}

              {fundingLoading ? (
                <View
                  style={{
                    marginTop: 8,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <ActivityIndicator size="small" color={TEAL} />
                  <Text
                    style={{ color: MUTED, fontSize: 11 }}
                  >
                    Refreshing balances…
                  </Text>
                </View>
              ) : null}
            </View>

            {/* Network selector */}
            <View style={{ marginTop: 14 }}>
              <Text style={styles.networkLabel}>
                Select Network
              </Text>
              {requiredChain ? (
                <Text style={styles.networkRestriction}>
                  This listing is restricted to{" "}
                  {titleCaseChain(requiredChain)}.
                </Text>
              ) : null}

              {availableChains.length ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={{ marginTop: 10 }}
                >
                  {availableChains.map((c) => {
                    const selected = chain?.chain === c.chain;
                    const accent = chainAccent(c.chain);
                    const tokenLabels = chainTokenLabels(
                      c,
                      allowUsdc,
                      allowUsdt
                    );
                    return (
                      <Pressable
                        key={c.chain}
                        onPress={async () => {
                          try {
                            setErr(null);
                            setChain(c);
                            await setPreferredMarketChain(
                              c.chain
                            );
                            await refreshFunding(c);
                          } catch (e: any) {
                            setErr(
                              friendlyMarketError(
                                e,
                                "Unable to switch network."
                              )
                            );
                          }
                        }}
                        style={[
                          styles.networkChip,
                          {
                            borderColor: selected
                              ? `${accent}AA`
                              : BORDER,
                            backgroundColor: selected
                              ? `${accent}26`
                              : CARD,
                          },
                        ]}
                      >
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 8,
                          }}
                        >
                          <Text
                            style={[
                              styles.networkChipName,
                              selected && { color: accent },
                            ]}
                            numberOfLines={1}
                          >
                            {titleCaseChain(c.chain)}
                          </Text>
                          {selected ? (
                            <Ionicons
                              name="checkmark-circle"
                              size={15}
                              color={accent}
                            />
                          ) : null}
                        </View>
                        <Text style={styles.networkChipId}>
                          Chain {c.chain_id}
                        </Text>
                        <View
                          style={{
                            marginTop: 8,
                            flexDirection: "row",
                            gap: 5,
                            flexWrap: "wrap",
                          }}
                        >
                          {c.is_testnet ? (
                            <View
                              style={styles.testnetBadge}
                            >
                              <Text
                                style={
                                  styles.testnetBadgeText
                                }
                              >
                                TESTNET
                              </Text>
                            </View>
                          ) : null}
                          {tokenLabels.map((label) => (
                            <View
                              key={label}
                              style={[
                                styles.tokenBadge,
                                {
                                  backgroundColor: `${accent}22`,
                                },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.tokenBadgeText,
                                  { color: accent },
                                ]}
                              >
                                {label}
                              </Text>
                            </View>
                          ))}
                        </View>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              ) : (
                <View style={styles.noNetworkBox}>
                  <Ionicons
                    name="wifi-outline"
                    size={20}
                    color={FAINT}
                  />
                  <Text style={styles.noNetworkText}>
                    No active checkout network available from
                    chain config.
                  </Text>
                </View>
              )}

              {chain ? (
                <Text style={styles.activeNetworkLabel}>
                  Active: {titleCaseChain(chain.chain)}
                </Text>
              ) : null}
            </View>

            {/* USDC shortfall warning */}
            {allowUsdc &&
            usdcRequired > 0 &&
            usdcShortfall > 0 ? (
              <View style={[styles.warningBanner, { marginTop: 14 }]}>
                <Ionicons
                  name="warning-outline"
                  size={14}
                  color={GOLD}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.warningText}>
                    Insufficient USDC. Add{" "}
                    {usdcShortfall.toLocaleString(undefined, {
                      maximumFractionDigits: 6,
                    })}{" "}
                    USDC to continue.
                  </Text>
                  <Pressable
                    onPress={() =>
                      router.push("/market/wallet" as any)
                    }
                    style={[
                      styles.outlineBtn,
                      { marginTop: 8 },
                    ]}
                  >
                    <Ionicons
                      name="wallet-outline"
                      size={15}
                      color={TEAL}
                    />
                    <Text
                      style={[
                        styles.outlineBtnText,
                        { color: TEAL },
                      ]}
                    >
                      Open Crypto Wallet
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            {/* USDT shortfall warning */}
            {allowUsdt &&
            usdtRequired > 0 &&
            usdtShortfall > 0 ? (
              <View style={[styles.warningBanner, { marginTop: 12 }]}>
                <Ionicons
                  name="warning-outline"
                  size={14}
                  color={GOLD}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.warningText}>
                    Insufficient USDT. Add{" "}
                    {usdtShortfall.toLocaleString(undefined, {
                      maximumFractionDigits: 6,
                    })}{" "}
                    USDT to continue.
                  </Text>
                  <Pressable
                    onPress={() =>
                      router.push("/market/wallet" as any)
                    }
                    style={[
                      styles.outlineBtn,
                      { marginTop: 8 },
                    ]}
                  >
                    <Ionicons
                      name="wallet-outline"
                      size={15}
                      color={TEAL}
                    />
                    <Text
                      style={[
                        styles.outlineBtnText,
                        { color: TEAL },
                      ]}
                    >
                      Open Crypto Wallet
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            {/* Pay buttons */}
            <PaymentPill
              icon="logo-bitcoin"
              title="Pay with USDC"
              subtitle={
                chain
                  ? `Approve + deposit on ${titleCaseChain(
                      chain.chain
                    )}`
                  : "Select an active network first"
              }
              onPress={payWithUsdc}
              disabled={
                busy ||
                fundingLoading ||
                !selectedChainStillAvailable ||
                !canPayUsdc ||
                usdcShortfall > 0
              }
              accent={TEAL}
            />

            <PaymentPill
              icon="cash-outline"
              title="Pay with USDT"
              subtitle={
                chain
                  ? `Approve + deposit on ${titleCaseChain(
                      chain.chain
                    )}`
                  : "Select an active network first"
              }
              onPress={payWithUsdt}
              disabled={
                busy ||
                fundingLoading ||
                !selectedChainStillAvailable ||
                !canPayUsdt ||
                usdtShortfall > 0
              }
              accent={GOLD}
            />

            {enabledRoutes.length < 2 ? (
              <Text style={styles.routeNote}>
                Seller payment setting:{" "}
                {enabledRoutes.length
                  ? enabledRoutes.join(" + ")
                  : "No payment route enabled"}
                .
              </Text>
            ) : null}

            {/* Processing indicator */}
            {busy ? (
              <View style={styles.processingRow}>
                <ActivityIndicator color={TEAL} />
                <Text style={styles.processingText}>
                  Processing payment…
                </Text>
              </View>
            ) : null}

            {/* Error */}
            {!!err ? (
              <View
                style={[styles.errorBanner, { marginTop: 12 }]}
              >
                <Ionicons
                  name="alert-circle-outline"
                  size={14}
                  color={ROSE}
                />
                <Text style={styles.errorText}>{err}</Text>
              </View>
            ) : null}

            {/* Back to order */}
            <Pressable
              onPress={() =>
                router.replace(`/market/order/${oid}` as any)
              }
              style={[styles.outlineBtn, { marginTop: 16 }]}
            >
              <Ionicons
                name="arrow-back-outline"
                size={16}
                color={MUTED}
              />
              <Text
                style={[styles.outlineBtnText, { color: MUTED }]}
              >
                Back to order
              </Text>
            </Pressable>
          </Card>
        </View>
      </ScrollView>
    </LinearGradient>
  );
}

// ─── StyleSheet ───────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  // Section label
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

  // Cards
  card: {
    borderRadius: 20,
    padding: 18,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderTopColor: BORDER_TOP,
  },
  cardTeal: {
    backgroundColor: TEAL_GLASS,
    borderColor: TEAL_BORDER,
  },
  cardAmber: {
    backgroundColor: AMBER_GLASS,
    borderColor: AMBER_BORDER,
  },
  cardRose: {
    backgroundColor: ROSE_GLASS,
    borderColor: ROSE_BORDER,
  },

  // Header
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 14,
  },
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
  pageTitle: {
    color: TEXT,
    fontWeight: "900",
    letterSpacing: -0.3,
  },
  pageSubtitle: {
    color: MUTED,
    fontSize: 12,
    fontWeight: "600",
    marginTop: 2,
  },

  // Amount
  amountText: {
    marginTop: 12,
    color: TEAL,
    fontWeight: "900",
    letterSpacing: -1,
  },
  amountCurrency: {
    fontSize: 18,
    color: MUTED,
    fontWeight: "700",
    letterSpacing: 0,
  },
  amountMeta: {
    marginTop: 10,
    gap: 5,
  },
  amountMetaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  amountMetaText: {
    color: MUTED,
    fontSize: 12,
    fontWeight: "600",
  },

  // Risk check
  riskCheckBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderRadius: 13,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: TEAL_GLASS,
    borderWidth: 1,
    borderColor: TEAL_BORDER,
  },
  riskCheckBtnText: {
    color: TEXT,
    fontWeight: "900",
    fontSize: 12,
  },
  riskLevelBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
    alignSelf: "flex-start",
  },

  // Input fields
  inputLabel: {
    color: FAINT,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    marginBottom: 4,
    textTransform: "uppercase",
  },
  inputBox: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD_RAISED,
    paddingHorizontal: 13,
  },
  inputText: {
    color: TEXT,
    paddingVertical: 12,
    fontSize: 14,
  },

  // Outline button
  outlineBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD_RAISED,
  },
  outlineBtnText: {
    fontWeight: "800",
    fontSize: 13,
  },

  // Geo tag
  geoTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    padding: 8,
    borderRadius: 10,
    backgroundColor: TEAL_GLASS,
    borderWidth: 1,
    borderColor: TEAL_BORDER,
  },
  geoTagText: {
    color: TEAL,
    fontSize: 11,
    fontWeight: "700",
    flex: 1,
  },
  locationStatus: {
    marginTop: 8,
    color: FAINT,
    fontSize: 12,
  },

  // Balance panel
  balancePanel: {
    marginTop: 14,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
  },
  balancePanelTitle: {
    color: TEXT,
    fontWeight: "900",
    fontSize: 13,
  },
  balancePanelSub: {
    color: FAINT,
    fontSize: 11,
    marginTop: 2,
  },
  balanceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  balanceTokenDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: TEAL,
  },
  balanceLabel: {
    color: MUTED,
    fontSize: 12,
    fontWeight: "700",
    width: 42,
  },
  balanceValue: {
    color: TEXT,
    fontSize: 13,
    fontWeight: "900",
    flex: 1,
    textAlign: "right",
  },
  walletAddress: {
    marginTop: 8,
    color: FAINT,
    fontSize: 11,
  },
  refreshBtn: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD_RAISED,
  },

  // Network selector
  networkLabel: {
    color: MUTED,
    fontWeight: "800",
    fontSize: 12,
  },
  networkRestriction: {
    marginTop: 4,
    color: FAINT,
    fontSize: 11,
  },
  networkChip: {
    marginRight: 10,
    minWidth: 136,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
  },
  networkChipName: {
    color: TEXT,
    fontWeight: "900",
    fontSize: 13,
    flex: 1,
  },
  networkChipId: {
    color: FAINT,
    fontSize: 10,
    fontWeight: "700",
    marginTop: 3,
  },
  activeNetworkLabel: {
    marginTop: 8,
    color: FAINT,
    fontSize: 11,
  },
  noNetworkBox: {
    marginTop: 10,
    borderRadius: 14,
    padding: 14,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    gap: 8,
  },
  noNetworkText: {
    color: MUTED,
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
  },

  // Token / testnet badges
  testnetBadge: {
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
    backgroundColor: GOLD_GLASS,
  },
  testnetBadgeText: {
    color: GOLD,
    fontSize: 9,
    fontWeight: "900",
  },
  tokenBadge: {
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  tokenBadgeText: {
    fontSize: 9,
    fontWeight: "900",
  },

  // Payment pill
  paymentPill: {
    marginTop: 12,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  paymentPillIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  paymentPillTitle: {
    fontWeight: "900",
    fontSize: 15,
  },
  paymentPillSub: {
    marginTop: 4,
    color: MUTED,
    fontSize: 12,
  },

  // Status / notes
  routeNote: {
    marginTop: 10,
    color: MUTED,
    fontSize: 12,
    lineHeight: 18,
  },
  processingRow: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  processingText: {
    color: MUTED,
    fontWeight: "700",
    fontSize: 13,
  },

  // Warning banner
  warningBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
    backgroundColor: GOLD_GLASS,
  },
  warningText: {
    color: GOLD,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
    flex: 1,
  },

  // Error banner
  errorBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: ROSE_BORDER,
    backgroundColor: ROSE_GLASS,
  },
  errorText: {
    color: ROSE,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
    flex: 1,
  },
});