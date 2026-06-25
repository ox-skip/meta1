import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
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
import { DeliveryGeo, availabilityMayMatch, formatAvailabilitySummary, getCurrentLocationWithGeocode, toDeliveryGeo } from "@/utils/location";
import { getMyWalletForChain, isWalletMismatchError, payUsdcForOrder, payUsdtForOrder, replaceSavedWalletWithDevice } from "@/services/market/usdcCheckout";
import { fetchMarketChains, getPreferredMarketChain, setPreferredMarketChain, type MarketChainConfig } from "@/services/market/chainConfig";
import { generateOrderAiRisk, type MarketOrderAiRiskResult } from "@/services/market/ai";
import { friendlyMarketError } from "@/utils/marketUx";
import { resolveUserCountry, type UserCountry } from "@/utils/country";
import { getRpcUrlForChain } from "@/utils/aaWallet";

const BG0 = "#060807";
const BG1 = "#10130E";
const BG2 = "#171A13";

function shouldExitCheckoutForStatus(status: unknown) {
  const s = String(status ?? "").trim().toUpperCase();
  if (!s) return false;
  return s !== "CREATED" && s !== "PENDING_PAYMENT";
}

const ERC20_ABI = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

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
  const mode = String((options as any)?.chain_mode ?? "").trim().toLowerCase();
  if (!mode || mode === "all") return "";
  return mode;
}

function chainSupportsCheckoutRoutes(
  chain: MarketChainConfig,
  allowUsdc: boolean,
  allowUsdt: boolean,
  requiredChain?: string | null,
) {
  if (!isConfiguredActiveChain(chain)) return false;
  const required = String(requiredChain || "").trim().toLowerCase();
  if (required && String(chain.chain || "").toLowerCase() !== required) return false;
  if (!allowUsdc && !allowUsdt) return true;
  return (allowUsdc && isUsableAddress(chain.usdc_address)) || (allowUsdt && isUsableAddress(chain.usdt_address));
}

function chainTokenLabels(chain: MarketChainConfig, allowUsdc: boolean, allowUsdt: boolean) {
  const labels: string[] = [];
  if (allowUsdc && isUsableAddress(chain.usdc_address)) labels.push("USDC");
  if (allowUsdt && isUsableAddress(chain.usdt_address)) labels.push("USDT");
  return labels;
}

function isHexHash(v?: string | null) {
  return /^0x[a-fA-F0-9]{64}$/.test(String(v || "").trim());
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(id);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(id);
        reject(error);
      });
  });
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
  const hasEnabledStableRoute = options.allow_usdc === true || options.allow_usdt === true;

  return {
    allowUsdc: options.allow_usdc === true || (!hasEnabledStableRoute && currency === "USDC"),
    allowUsdt: options.allow_usdt === true || (!hasEnabledStableRoute && currency === "USDT"),
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

function Pill({
  icon,
  title,
  subtitle,
  onPress,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      disabled={!!disabled}
      onPress={onPress}
      style={{
        marginTop: 12,
        borderRadius: 22,
        padding: 16,
        backgroundColor: disabled ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.06)",
        borderWidth: 1,
        borderColor: disabled ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.12)",
        opacity: disabled ? 0.7 : 1,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View
          style={{
            width: 46,
            height: 46,
            borderRadius: 18,
            backgroundColor: "rgba(45,212,191,0.25)",
            borderWidth: 1,
            borderColor: "rgba(45,212,191,0.35)",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name={icon} size={22} color="#fff" />
        </View>

        <View style={{ flex: 1 }}>
          <Text style={{ color: "#fff", fontWeight: "900", fontSize: 15 }}>{title}</Text>
          <Text style={{ marginTop: 6, color: "rgba(255,255,255,0.65)", fontSize: 12 }}>{subtitle}</Text>
        </View>

        <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.75)" />
      </View>
    </Pressable>
  );
}

export default function Checkout() {
  const insets = useSafeAreaInsets();
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const oid = useMemo(() => String(orderId || ""), [orderId]);
  const { balancesHidden, toggleBalancesHidden } = useBalanceVisibility();

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
  const [riskResult, setRiskResult] = useState<MarketOrderAiRiskResult | null>(null);
  const autoRoutedRef = useRef(false);
  const paymentResultShownRef = useRef(false);
  const listingCurrency = String((listing as any)?.currency ?? "").toUpperCase();
  const orderCurrency = String((order as any)?.currency ?? listingCurrency).toUpperCase();
  const orderAmount = Number((order as any)?.amount ?? 0);
  const orderStatus = String((order as any)?.status ?? "").toUpperCase();
  const orderQty = Math.max(1, Number((order as any)?.quantity ?? 1));
  const orderUnitPrice = Number(
    (order as any)?.unit_price ?? (orderQty > 0 ? orderAmount / orderQty : orderAmount),
  );
  const paymentOptions = ((listing as any)?.payment_options ?? {}) as any;
  const { bySection: checkoutPolicy, loading: checkoutPolicyLoading } = useMarketPolicyBlocks({
    surface: "checkout",
    audience: "buyer",
    orderStatus,
  });

  const { allowUsdc, allowUsdt } = getStableRouteFlags(paymentOptions, listingCurrency);
  const requiredChain = selectedListingChain(paymentOptions);
  const enabledRoutes = [
    allowUsdc ? "USDC" : null,
    allowUsdt ? "USDT" : null,
  ].filter(Boolean) as string[];
  const usdcRequired = allowUsdc ? orderAmount : 0;
  const usdtRequired = allowUsdt ? orderAmount : 0;
  const availableChains = useMemo(
    () => chains.filter((c) => chainSupportsCheckoutRoutes(c, allowUsdc, allowUsdt, requiredChain)),
    [allowUsdc, allowUsdt, chains, requiredChain],
  );
  const selectedChainStillAvailable = !!chain && availableChains.some((c) => c.chain === chain.chain);
  const selectedChainLabels = chain ? chainTokenLabels(chain, allowUsdc, allowUsdt) : [];
  const canPayUsdc = !!chain && allowUsdc && isUsableAddress(chain.usdc_address);
  const canPayUsdt = !!chain && allowUsdt && isUsableAddress(chain.usdt_address);
  const usdcShortfall = canPayUsdc && usdcRequired > 0 ? Math.max(0, usdcRequired - usdcBalance) : 0;
  const usdtShortfall = canPayUsdt && usdtRequired > 0 ? Math.max(0, usdtRequired - usdtBalance) : 0;
  const noActiveCheckoutNetwork = enabledRoutes.length > 0 && availableChains.length === 0;
  const deliveryLat = Number(deliveryGeo?.lat);
  const deliveryLng = Number(deliveryGeo?.lng);
  const hasDeliveryCoords = Number.isFinite(deliveryLat) && Number.isFinite(deliveryLng);

  async function requireAuth() {
    const { data } = await supabase.auth.getUser();
    const user = data?.user;
    if (!user) {
      router.replace("/(auth)/login" as any);
      return null;
    }
    return user;
  }

  async function refreshFunding(selectedChain?: MarketChainConfig | null) {
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

      const wallet = await getMyWalletForChain(active.chain).catch(() => null);
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
          const d = Number(await client.readContract({ address: active.usdc_address as `0x${string}`, abi: ERC20_ABI, functionName: "decimals" }));
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
          const d = Number(await client.readContract({ address: active.usdt_address as `0x${string}`, abi: ERC20_ABI, functionName: "decimals" }));
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
            .select("id,listing_id,status,quantity,unit_price,amount,currency,delivery_address,buyer_contact")
            .eq("id", oid)
            .maybeSingle();
          if (!first.error) {
            o = first.data;
          } else if (String(first.error.message || "").includes("buyer_contact")) {
            const fallback = await supabase
              .from("market_orders")
              .select("id,listing_id,status,quantity,unit_price,amount,currency,delivery_address")
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
            .select("id,title,delivery_type,availability,currency,payment_options")
            .eq("id", listingId)
            .maybeSingle();
          if (lErr) throw lErr;
          l = lRow;
        }

        if (mounted) {
          const parsedOrder = o
            ? {
              ...o,
              delivery_address: parseJsonObject((o as any)?.delivery_address) ?? {},
              buyer_contact: normalizeBuyerContact((o as any)?.buyer_contact),
            }
            : null;
          const parsedListing = l
            ? {
              ...l,
              availability: parseJsonObject((l as any)?.availability) ?? (l as any)?.availability ?? {},
              payment_options: parseJsonObject((l as any)?.payment_options) ?? (l as any)?.payment_options ?? {},
            }
            : null;
          const geo = normalizeDeliveryGeo((parsedOrder as any)?.delivery_address?.geo);
          const contact = normalizeBuyerContact(
            (parsedOrder as any)?.buyer_contact ?? (parsedOrder as any)?.delivery_address?.contact,
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
        if (mounted) setErr(friendlyMarketError(e, "We couldn't load this checkout right now."));
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    (async () => {
      const all = (await fetchMarketChains().catch(() => [])) as MarketChainConfig[];
      const activeConfigured = all.filter(isConfiguredActiveChain);
      const preferred = await getPreferredMarketChain().catch(() => null);
      const preferredActive = preferred && activeConfigured.find((c) => c.chain === preferred.chain);
      if (!mounted) return;
      setChains(activeConfigured);
      setChain(preferredActive ?? (activeConfigured[0] ?? null));
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
  }, [chain?.chain, order?.id, order?.amount, order?.currency, userCountry?.code, userCountry?.name]);

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
  }, [availableChains, chains.length, enabledRoutes.length, selectedChainStillAvailable]);

  useEffect(() => {
    if (!oid) return;
    const channel = supabase
      .channel(`checkout-order-${oid}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "market_orders", filter: `id=eq.${oid}` },
        (payload) => {
          const next = (payload.new ?? {}) as any;
          setOrder((prev: any) => ({ ...(prev ?? {}), ...next }));
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [oid]);

  useEffect(() => {
    if (!oid || autoRoutedRef.current) return;
    if (busy || paymentResultShownRef.current) return;
    if (!shouldExitCheckoutForStatus(orderStatus)) return;
    autoRoutedRef.current = true;
    router.replace(`/market/order/${oid}` as any);
  }, [busy, oid, orderStatus]);

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
      setOrder((prev: any) => ({ ...(prev ?? {}), delivery_address: next }));
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
      setErr(friendlyMarketError(e, "We couldn't access your location."));
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
      if (primary.error && String(primary.error.message || "").includes("buyer_contact")) {
        const nextDelivery = { ...(order?.delivery_address ?? {}), contact: payload };
        const fallback = await supabase
          .from("market_orders")
          .update({ delivery_address: nextDelivery })
          .eq("id", oid);
        if (fallback.error) throw fallback.error;
      } else if (primary.error) {
        throw primary.error;
      }
      setOrder((prev: any) => ({ ...(prev ?? {}), buyer_contact: payload }));
    } catch (e: any) {
      setErr(friendlyMarketError(e, "We couldn't save your contact details."));
    } finally {
      setSavingContact(false);
    }
  }

  async function payWithUsdc() {
    if (busy) return;
    setErr(null);
    if (!oid) return setErr("Missing orderId");
    if (!allowUsdc) return setErr("This listing does not accept USDC payments.");
    if (!chain) return setErr("No active checkout network is configured for this order.");
    if (!selectedChainStillAvailable) return setErr("Selected network is not available for this listing.");
    if (!canPayUsdc) return setErr(`${titleCaseChain(chain.chain)} is not configured for USDC checkout.`);
    if (usdcShortfall > 0) {
      return setErr(`Insufficient USDC on selected network. Add ${usdcShortfall.toLocaleString(undefined, { maximumFractionDigits: 6 })} USDC and retry.`);
    }
    const user = await requireAuth();
    if (!user) return;

    console.log("[Checkout] payWithUsdc start", { orderId: oid });
    setBusy(true);
    try {
      const res: any = await payUsdcForOrder(oid, chain);
      await showStableDepositResult("USDC", res);
    } catch (e: any) {
      console.log("[Checkout] payWithUsdc error", { message: String(e?.message || e) });
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
                    if (!activeChain) throw new Error("No active chain configuration found.");
                    await replaceSavedWalletWithDevice(activeChain as any);
                    const retried: any = await payUsdcForOrder(oid, activeChain);
                    await showStableDepositResult("USDC", retried);
                  } catch (retryErr: any) {
                    setErr(friendlyMarketError(retryErr, "Wallet was updated but retry failed."));
                  } finally {
                    setBusy(false);
                  }
                })();
              },
            },
            {
              text: "Open Wallet",
              onPress: () => router.push("/market/wallet" as any),
            },
          ],
        );
        return;
      }
      setErr(friendlyMarketError(e, "We couldn't start crypto checkout."));
    } finally {
      setBusy(false);
      console.log("[Checkout] payWithUsdc end");
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
      setErr(friendlyMarketError(e, "We couldn't run the order risk check."));
    } finally {
      setRiskBusy(false);
    }
  }

  function riskColor(level?: string) {
    const risk = String(level || "").toUpperCase();
    if (risk === "URGENT" || risk === "HIGH") return "#FCA5A5";
    if (risk === "MEDIUM") return "#FDE68A";
    return "#2DD4BF";
  }


  async function payWithUsdt() {
    if (busy) return;
    setErr(null);
    if (!oid) return setErr("Missing orderId");
    if (!allowUsdt) return setErr("This listing does not accept USDT payments.");
    if (!chain) return setErr("No active checkout network is configured for this order.");
    if (!selectedChainStillAvailable) return setErr("Selected network is not available for this listing.");
    if (!canPayUsdt) return setErr(`${titleCaseChain(chain.chain)} is not configured for USDT checkout.`);
    if (usdtShortfall > 0) {
      return setErr(`Insufficient USDT on selected network. Add ${usdtShortfall.toLocaleString(undefined, { maximumFractionDigits: 6 })} USDT and retry.`);
    }
    const user = await requireAuth();
    if (!user) return;

    console.log("[Checkout] payWithUsdt start", { orderId: oid });
    setBusy(true);
    try {
      const res: any = await payUsdtForOrder(oid, chain);
      await showStableDepositResult("USDT", res);
    } catch (e: any) {
      console.log("[Checkout] payWithUsdt error", { message: String(e?.message || e) });
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
                    if (!activeChain) throw new Error("No active chain configuration found.");
                    await replaceSavedWalletWithDevice(activeChain as any);
                    const retried: any = await payUsdtForOrder(oid, activeChain);
                    await showStableDepositResult("USDT", retried);
                  } catch (retryErr: any) {
                    setErr(friendlyMarketError(retryErr, "Wallet was updated but retry failed."));
                  } finally {
                    setBusy(false);
                  }
                })();
              },
            },
            {
              text: "Open Wallet",
              onPress: () => router.push("/market/wallet" as any),
            },
          ],
        );
        return;
      }
      setErr(friendlyMarketError(e, "We couldn't start USDT checkout."));
    } finally {
      setBusy(false);
      console.log("[Checkout] payWithUsdt end");
    }
  }

  async function showStableDepositResult(symbol: "USDC" | "USDT", res: any) {
    const txHash = String(res?.tx_hash || "").trim();
    const userOpHash = String(res?.user_op_hash || "").trim();
    if (isHexHash(txHash)) {
      paymentResultShownRef.current = true;
      Alert.alert(
        "Transaction successful",
        `Your ${symbol} deposit was sent on-chain. We'll move the order into escrow after confirmations.\n\nTransaction hash:\n${txHash}`,
        [
          { text: "Copy tx hash", onPress: () => Clipboard.setStringAsync(txHash) },
          {
            text: "View history",
            onPress: () => router.push((`/market/history?q=${encodeURIComponent(txHash)}` as any) as any),
          },
          {
            text: "Continue",
            onPress: () => router.replace((`/market/order/${oid}?tx=${encodeURIComponent(txHash)}` as any) as any),
          },
        ],
      );
      return;
    }
    if (isHexHash(userOpHash)) {
      paymentResultShownRef.current = true;
      Alert.alert(
        "Transaction submitted",
        `Your ${symbol} deposit was submitted. Confirmation may take a few minutes.\n\nUserOp:\n${userOpHash}\n\nWe'll move the order into escrow after confirmations.`,
        [
          { text: "Copy UserOp", onPress: () => Clipboard.setStringAsync(userOpHash) },
          {
            text: "View history",
            onPress: () => router.push((`/market/history?q=${encodeURIComponent(userOpHash)}` as any) as any),
          },
          {
            text: "Continue",
            onPress: () => router.replace((`/market/order/${oid}?uo=${encodeURIComponent(userOpHash)}` as any) as any),
          },
        ],
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
            onPress: () => router.replace(`/market/order/${oid}` as any),
          },
        ],
      );
      return;
    }
    router.replace(`/market/order/${oid}` as any);
  }

  return (
    <LinearGradient
      colors={[BG2, BG1, BG0]}
      start={{ x: 0.15, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={{ flex: 1, paddingTop: Math.max(insets.top, 14), paddingHorizontal: 16 }}
    >
      <AppHeader title="Checkout" subtitle="Choose how you want to pay for this order" />
      <ScrollView contentContainerStyle={{ paddingBottom: 28 }}>
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
            <Text style={{ color: "#fff", fontSize: 22, fontWeight: "900" }}>Checkout</Text>
            <Text style={{ marginTop: 4, color: "rgba(255,255,255,0.6)", fontSize: 12 }}>
              Choose how you want to pay for this order
            </Text>
          </View>
        </View>

        <View
          style={{
            borderRadius: 20,
            padding: 14,
            backgroundColor: "rgba(45,212,191,0.14)",
            borderWidth: 1,
            borderColor: "rgba(45,212,191,0.35)",
          }}
        >
          <Text style={{ color: "rgba(255,255,255,0.75)", fontWeight: "800", fontSize: 11 }}>ORDER AMOUNT</Text>
          <Text style={{ marginTop: 4, color: "#fff", fontWeight: "900", fontSize: 22 }}>
            {Number(orderAmount || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} {orderCurrency || listingCurrency || "USDC"}
          </Text>
          <Text style={{ marginTop: 4, color: "rgba(255,255,255,0.72)", fontSize: 12 }}>
            Qty {orderQty} x {Number(orderUnitPrice || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
            {orderCurrency || listingCurrency || "USDC"}
          </Text>
          <Text style={{ marginTop: 4, color: "rgba(255,255,255,0.65)", fontSize: 12 }}>
            
          </Text>
        </View>

        <View
          style={{
            marginTop: 12,
            borderRadius: 22,
            padding: 16,
            backgroundColor: "rgba(255,255,255,0.05)",
            borderWidth: 1,
            borderColor: riskResult?.risk ? `${riskColor(riskResult.risk.risk_level)}55` : "rgba(255,255,255,0.08)",
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: "#fff", fontWeight: "900", fontSize: 14 }}>BestCity Ai order risk</Text>
              <Text style={{ marginTop: 6, color: "rgba(255,255,255,0.65)", fontSize: 12 }}>
                Check payment, delivery, escrow, and dispute signals before you pay.
              </Text>
            </View>
            <Pressable
              onPress={runOrderRiskCheck}
              disabled={riskBusy || loading || !oid}
              style={{
                borderRadius: 14,
                paddingHorizontal: 12,
                paddingVertical: 10,
                backgroundColor: "rgba(45,212,191,0.18)",
                borderWidth: 1,
                borderColor: "rgba(45,212,191,0.4)",
                opacity: riskBusy || loading || !oid ? 0.6 : 1,
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
              }}
            >
              {riskBusy ? <ActivityIndicator size="small" /> : <Ionicons name="sparkles-outline" size={16} color="#fff" />}
              <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }}>{riskBusy ? "Checking" : "Check"}</Text>
            </Pressable>
          </View>
          {riskResult?.risk ? (
            <View style={{ marginTop: 12, gap: 8 }}>
              <Text style={{ color: riskColor(riskResult.risk.risk_level), fontWeight: "900", fontSize: 12 }}>
                {riskResult.risk.risk_level} risk - {riskResult.risk.confidence} confidence
              </Text>
              {riskResult.risk.summary ? (
                <Text style={{ color: "rgba(255,255,255,0.72)", lineHeight: 20 }}>{riskResult.risk.summary}</Text>
              ) : null}
              {[...riskResult.risk.mismatch_flags, ...riskResult.risk.payment_flags, ...riskResult.risk.delivery_flags].length ? (
                <Text style={{ color: riskColor(riskResult.risk.risk_level), fontSize: 12, lineHeight: 18 }}>
                  Flags: {[...riskResult.risk.mismatch_flags, ...riskResult.risk.payment_flags, ...riskResult.risk.delivery_flags].join(", ")}
                </Text>
              ) : null}
              {riskResult.risk.recommended_actions?.length ? (
                <Text style={{ color: "rgba(255,255,255,0.72)", fontSize: 12, lineHeight: 18 }}>
                  Next: {riskResult.risk.recommended_actions.join(" ")}
                </Text>
              ) : null}
              {riskResult.risk.buyer_note ? (
                <Text style={{ color: "rgba(255,255,255,0.72)", fontSize: 12, lineHeight: 18 }}>{riskResult.risk.buyer_note}</Text>
              ) : null}
            </View>
          ) : null}
        </View>

        <MarketPolicyPanel
          title="Checkout flow"
          blocks={checkoutPolicy.flow}
          emptyText={checkoutPolicyLoading ? "Loading policy..." : "Policy unavailable."}
        />
        <MarketPolicyPanel
          title="Safety and complaints"
          blocks={checkoutPolicy.safety}
          emptyText={checkoutPolicyLoading ? "Loading policy..." : "Policy unavailable."}
        />

        <View
          style={{
            borderRadius: 22,
            padding: 16,
            backgroundColor: "rgba(255,255,255,0.05)",
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.08)",
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "900", fontSize: 14 }}>Availability</Text>
          <Text style={{ marginTop: 10, color: "rgba(255,255,255,0.58)", fontWeight: "800", fontSize: 11 }}>
            Seller country
          </Text>
          <View style={{ marginTop: 8 }}>
            <ListingOriginBadge availability={listing?.availability} paymentOptions={listing?.payment_options} />
          </View>
          <Text style={{ marginTop: 8, color: "rgba(255,255,255,0.7)", lineHeight: 20 }}>
            {formatAvailabilitySummary(listing?.availability)}
          </Text>

          {deliveryGeo &&
          !availabilityMayMatch(listing?.availability, {
            ...deliveryGeo,
            continent: deliveryGeo.continent || userCountry?.continent,
          }) ? (
            <View
              style={{
                marginTop: 10,
                borderRadius: 14,
                padding: 10,
                borderWidth: 1,
                borderColor: "rgba(251,191,36,0.55)",
                backgroundColor: "rgba(251,191,36,0.10)",
              }}
            >
              <Text style={{ color: "rgba(254,243,199,0.95)", fontWeight: "900", fontSize: 12 }}>
                Warning: your delivery location may be outside the seller&apos;s availability. You can still continue.
              </Text>
            </View>
          ) : null}

          <Pressable
            onPress={useCurrentLocation}
            disabled={savingGeo}
            style={{
              marginTop: 12,
              borderRadius: 16,
              paddingVertical: 12,
              alignItems: "center",
              backgroundColor: "rgba(255,255,255,0.06)",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.12)",
              flexDirection: "row",
              gap: 8,
              justifyContent: "center",
              opacity: savingGeo ? 0.7 : 1,
            }}
          >
            {savingGeo ? <ActivityIndicator /> : <Ionicons name="locate-outline" size={18} color="#fff" />}
            <Text style={{ color: "#fff", fontWeight: "900" }}>Use my current location</Text>
          </Pressable>

          {loading ? (
            <Text style={{ marginTop: 8, color: "rgba(255,255,255,0.55)", fontSize: 12 }}>Loading order details...</Text>
          ) : deliveryGeo ? (
            <Text style={{ marginTop: 8, color: "rgba(255,255,255,0.7)", fontSize: 12 }}>
              Delivery location: {deliveryGeo.label || "Saved"}
              {hasDeliveryCoords ? ` | ${deliveryLat.toFixed(5)}, ${deliveryLng.toFixed(5)}` : ""}
            </Text>
          ) : (
            <Text style={{ marginTop: 8, color: "rgba(255,255,255,0.55)", fontSize: 12 }}>
              No delivery location selected.
            </Text>
          )}
        </View>

        <View
          style={{
            marginTop: 12,
            borderRadius: 22,
            padding: 16,
            backgroundColor: "rgba(255,255,255,0.05)",
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.08)",
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "900", fontSize: 14 }}>Buyer contact for seller</Text>
          <Text style={{ marginTop: 8, color: "rgba(255,255,255,0.65)", lineHeight: 20 }}>
            - USDC/USDT: uses your connected wallet and deposits into escrow on-chain.
          </Text>

          <View
            style={{
              marginTop: 10,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.12)",
              backgroundColor: "rgba(255,255,255,0.04)",
              paddingHorizontal: 12,
            }}
          >
            <TextInput
              value={contactName}
              onChangeText={setContactName}
              placeholder="Full name (optional)"
              placeholderTextColor="rgba(255,255,255,0.4)"
              style={{ color: "#fff", paddingVertical: 12 }}
            />
          </View>

          <View
            style={{
              marginTop: 8,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.12)",
              backgroundColor: "rgba(255,255,255,0.04)",
              paddingHorizontal: 12,
            }}
          >
            <TextInput
              value={contactPhone}
              onChangeText={setContactPhone}
              placeholder="Phone number"
              placeholderTextColor="rgba(255,255,255,0.4)"
              keyboardType="phone-pad"
              style={{ color: "#fff", paddingVertical: 12 }}
            />
          </View>

          <View
            style={{
              marginTop: 8,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.12)",
              backgroundColor: "rgba(255,255,255,0.04)",
              paddingHorizontal: 12,
            }}
          >
            <TextInput
              value={contactEmail}
              onChangeText={setContactEmail}
              placeholder="Email address"
              placeholderTextColor="rgba(255,255,255,0.4)"
              keyboardType="email-address"
              autoCapitalize="none"
              style={{ color: "#fff", paddingVertical: 12 }}
            />
          </View>

          <View
            style={{
              marginTop: 8,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.12)",
              backgroundColor: "rgba(255,255,255,0.04)",
              paddingHorizontal: 12,
            }}
          >
            <TextInput
              value={contactNote}
              onChangeText={setContactNote}
              placeholder="Extra note (optional)"
              placeholderTextColor="rgba(255,255,255,0.4)"
              style={{ color: "#fff", paddingVertical: 12 }}
            />
          </View>

          <Pressable
            onPress={saveBuyerContact}
            disabled={savingContact}
            style={{
              marginTop: 10,
              borderRadius: 16,
              paddingVertical: 12,
              alignItems: "center",
              backgroundColor: "rgba(255,255,255,0.06)",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.12)",
              opacity: savingContact ? 0.7 : 1,
            }}
          >
            {savingContact ? <ActivityIndicator /> : <Text style={{ color: "#fff", fontWeight: "900" }}>Save contact</Text>}
          </Pressable>
        </View>

        <View
          style={{
            marginTop: 12,
            borderRadius: 22,
            padding: 16,
            backgroundColor: "rgba(255,255,255,0.05)",
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.08)",
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "900", fontSize: 14 }}>Payment options</Text>
          <Text style={{ marginTop: 8, color: "rgba(255,255,255,0.65)", lineHeight: 20 }}>
            Choose your prefered payment route.
          </Text>
          {!enabledRoutes.length ? (
            <Text style={{ marginTop: 8, color: "#FCA5A5", fontSize: 12 }}>
              This listing does not have an active crypto checkout route. Ask the seller to republish it with USDC or USDT enabled.
            </Text>
          ) : null}
          {noActiveCheckoutNetwork ? (
            <View
              style={{
                marginTop: 10,
                borderRadius: 16,
                padding: 12,
                borderWidth: 1,
                borderColor: "rgba(251,113,133,0.44)",
                backgroundColor: "rgba(251,113,133,0.10)",
              }}
            >
              <Text style={{ color: "#FCA5A5", fontWeight: "900", fontSize: 12 }}>
                No active configured network can accept {enabledRoutes.join(" or ")}
                {requiredChain ? ` on ${titleCaseChain(requiredChain)}` : ""} for this order.
              </Text>
              <Text style={{ marginTop: 4, color: "rgba(255,255,255,0.66)", fontSize: 12, lineHeight: 18 }}>
                Activate the chain in market_chain_config with a valid token address and escrow address.
              </Text>
            </View>
          ) : null}

          <View
            style={{
              marginTop: 10,
              borderRadius: 18,
              padding: 12,
              backgroundColor: chain ? `${chainAccent(chain.chain)}14` : "rgba(255,255,255,0.04)",
              borderWidth: 1,
              borderColor: chain ? `${chainAccent(chain.chain)}55` : "rgba(255,255,255,0.1)",
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }}>
                  {chain ? `${titleCaseChain(chain.chain)} balances` : "Available balances"}
                </Text>
                <Text style={{ marginTop: 3, color: "rgba(255,255,255,0.58)", fontSize: 11 }} numberOfLines={1}>
                  {chain
                    ? `Chain ID ${chain.chain_id}${selectedChainLabels.length ? ` - ${selectedChainLabels.join(" + ")}` : ""}`
                    : "Choose an active network below"}
                </Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <BalanceVisibilityToggle
                  hidden={balancesHidden}
                  onPress={() => {
                    void toggleBalancesHidden();
                  }}
                  size={30}
                />
                <Pressable
                  onPress={() => refreshFunding()}
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 10,
                    alignItems: "center",
                    justifyContent: "center",
                    borderWidth: 1,
                    borderColor: "rgba(255,255,255,0.12)",
                    backgroundColor: "rgba(255,255,255,0.05)",
                  }}
                >
                  <Ionicons name="refresh" size={14} color="#fff" />
                </Pressable>
              </View>
            </View>
            <Text style={{ marginTop: 6, color: "rgba(255,255,255,0.72)", fontSize: 12 }}>
              USDC {balancesHidden ? "******" : usdcBalance.toLocaleString(undefined, { maximumFractionDigits: 6 })}
            </Text>
            <Text style={{ marginTop: 2, color: "rgba(255,255,255,0.72)", fontSize: 12 }}>
              USDT {balancesHidden ? "******" : usdtBalance.toLocaleString(undefined, { maximumFractionDigits: 6 })}
            </Text>
            {walletAddress ? (
              <Text style={{ marginTop: 6, color: "rgba(255,255,255,0.55)", fontSize: 11 }}>
                Saved wallet: {compactAddress(walletAddress)}
              </Text>
            ) : null}
            {fundingLoading ? (
              <View style={{ marginTop: 8, flexDirection: "row", alignItems: "center", gap: 8 }}>
                <ActivityIndicator size="small" />
                <Text style={{ color: "rgba(255,255,255,0.65)", fontSize: 11 }}>Refreshing balances...</Text>
              </View>
            ) : null}
          </View>

          <View style={{ marginTop: 10 }}>
            <Text style={{ color: "rgba(255,255,255,0.75)", fontWeight: "800", fontSize: 12 }}>Select Network</Text>
            {requiredChain ? (
              <Text style={{ marginTop: 4, color: "rgba(255,255,255,0.58)", fontSize: 11 }}>
                This listing is restricted to {titleCaseChain(requiredChain)}.
              </Text>
            ) : null}
            {availableChains.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                {availableChains.map((c) => {
                  const selected = chain?.chain === c.chain;
                  const accent = chainAccent(c.chain);
                  const tokenLabels = chainTokenLabels(c, allowUsdc, allowUsdt);
                  return (
                    <Pressable
                      key={c.chain}
                      onPress={async () => {
                        try {
                          setErr(null);
                          setChain(c);
                          await setPreferredMarketChain(c.chain);
                          await refreshFunding(c);
                        } catch (e: any) {
                          setErr(friendlyMarketError(e, "Unable to switch network."));
                        }
                      }}
                      style={{
                        marginRight: 10,
                        minWidth: 132,
                        borderRadius: 18,
                        paddingHorizontal: 12,
                        paddingVertical: 10,
                        borderWidth: 1,
                        borderColor: selected ? `${accent}AA` : "rgba(255,255,255,0.12)",
                        backgroundColor: selected ? `${accent}26` : "rgba(255,255,255,0.05)",
                      }}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }} numberOfLines={1}>
                          {titleCaseChain(c.chain)}
                        </Text>
                        {selected ? <Ionicons name="checkmark-circle" size={16} color={accent} /> : null}
                      </View>
                      <Text style={{ marginTop: 4, color: "rgba(255,255,255,0.58)", fontSize: 10, fontWeight: "800" }}>
                        Chain {c.chain_id}
                      </Text>
                      <View style={{ marginTop: 7, flexDirection: "row", gap: 5, flexWrap: "wrap" }}>
                        {c.is_testnet ? (
                          <View style={{ borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3, backgroundColor: "rgba(251,191,36,0.16)" }}>
                            <Text style={{ color: "#FDE68A", fontSize: 9, fontWeight: "900" }}>TESTNET</Text>
                          </View>
                        ) : null}
                        {tokenLabels.map((label) => (
                          <View key={label} style={{ borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3, backgroundColor: `${accent}22` }}>
                            <Text style={{ color: accent, fontSize: 9, fontWeight: "900" }}>{label}</Text>
                          </View>
                        ))}
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : (
              <View
                style={{
                  marginTop: 8,
                  borderRadius: 16,
                  padding: 12,
                  backgroundColor: "rgba(255,255,255,0.04)",
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.10)",
                }}
              >
                <Text style={{ color: "rgba(255,255,255,0.68)", fontSize: 12, lineHeight: 18 }}>
                  No active checkout network is available from chain config.
                </Text>
              </View>
            )}
            {chain ? (
              <Text style={{ marginTop: 6, color: "rgba(255,255,255,0.6)", fontSize: 11 }}>
                Active network: {titleCaseChain(chain.chain)}
              </Text>
            ) : null}
          </View>

          {allowUsdc && usdcRequired > 0 && usdcShortfall > 0 ? (
            <View
              style={{
                marginTop: 12,
                borderRadius: 16,
                padding: 12,
                backgroundColor: "rgba(251,191,36,0.12)",
                borderWidth: 1,
                borderColor: "rgba(251,191,36,0.4)",
              }}
            >
              <Text style={{ color: "#FDE68A", fontWeight: "900", fontSize: 12 }}>
                Insufficient USDC on selected network. Add {usdcShortfall.toLocaleString(undefined, { maximumFractionDigits: 6 })} USDC.
              </Text>
              <Pressable
                onPress={() => router.push("/market/wallet" as any)}
                style={{
                  marginTop: 10,
                  borderRadius: 12,
                  height: 40,
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: 1,
                  borderColor: "rgba(45,212,191,0.5)",
                  backgroundColor: "rgba(45,212,191,0.2)",
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "900" }}>Open Crypto Wallet</Text>
              </Pressable>
            </View>
          ) : null}

          {allowUsdt && usdtRequired > 0 && usdtShortfall > 0 ? (
            <View
              style={{
                marginTop: 12,
                borderRadius: 16,
                padding: 12,
                backgroundColor: "rgba(251,191,36,0.12)",
                borderWidth: 1,
                borderColor: "rgba(251,191,36,0.4)",
              }}
            >
              <Text style={{ color: "#FDE68A", fontWeight: "900", fontSize: 12 }}>
                Insufficient USDT on selected network. Add {usdtShortfall.toLocaleString(undefined, { maximumFractionDigits: 6 })} USDT.
              </Text>
              <Pressable
                onPress={() => router.push("/market/wallet" as any)}
                style={{
                  marginTop: 10,
                  borderRadius: 12,
                  height: 40,
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: 1,
                  borderColor: "rgba(45,212,191,0.5)",
                  backgroundColor: "rgba(45,212,191,0.2)",
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "900" }}>Open Crypto Wallet</Text>
              </Pressable>
            </View>
          ) : null}

          <Pill
            icon="logo-bitcoin"
            title="Pay with USDC"
            subtitle={chain ? `Approve + deposit on ${titleCaseChain(chain.chain)}` : "Select an active network first"}
            onPress={payWithUsdc}
            disabled={busy || fundingLoading || !selectedChainStillAvailable || !canPayUsdc || usdcShortfall > 0}
          />

          <Pill
            icon="cash-outline"
            title="Pay with USDT"
            subtitle={chain ? `Approve + deposit on ${titleCaseChain(chain.chain)}` : "Select an active network first"}
            onPress={payWithUsdt}
            disabled={busy || fundingLoading || !selectedChainStillAvailable || !canPayUsdt || usdtShortfall > 0}
          />

          {enabledRoutes.length < 2 ? (
            <Text style={{ marginTop: 10, color: "rgba(255,255,255,0.7)", fontSize: 12 }}>
              Seller payment setting: {enabledRoutes.length ? enabledRoutes.join(" + ") : "No payment route enabled"}.
            </Text>
          ) : null}

          {busy ? (
            <View style={{ marginTop: 14, flexDirection: "row", alignItems: "center", gap: 10 }}>
              <ActivityIndicator />
              <Text style={{ color: "rgba(255,255,255,0.7)", fontWeight: "800" }}>Processing...</Text>
            </View>
          ) : null}

          {!!err ? (
            <Text style={{ marginTop: 12, color: "#FCA5A5", fontWeight: "800" }}>
              {err}
            </Text>
          ) : null}

          <Pressable
            onPress={() => router.replace(`/market/order/${oid}` as any)}
            style={{
              marginTop: 14,
              borderRadius: 20,
              paddingVertical: 14,
              alignItems: "center",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.14)",
              backgroundColor: "rgba(255,255,255,0.06)",
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "900" }}>Back to order</Text>
          </Pressable>
        </View>

        <View style={{ marginTop: 14, alignItems: "center" }}>
          <Text style={{ color: "rgba(255,255,255,0.55)", fontSize: 12 }}>
            Order ID: {oid}
          </Text>
        </View>
      </ScrollView>
    </LinearGradient>
  );
}



