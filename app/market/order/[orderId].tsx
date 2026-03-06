import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View, Linking, Alert, Modal } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { createPublicClient, http, keccak256, toHex } from "viem";

import MarketPolicyPanel from "@/components/policies/MarketPolicyPanel";
import { useMarketPolicyBlocks } from "@/hooks/policy/useMarketPolicyBlocks";
import { requireLocalAuth } from "@/utils/secureAuth";
import { supabase } from "@/services/supabase";
import { releaseUsdcForOrder } from "@/services/market/usdcCheckout";
import { releasePiForOrder } from "@/services/market/piCheckout";
import { getPreferredMarketChain } from "@/services/market/chainConfig";
import { friendlyMarketError } from "@/utils/marketUx";

import { OrderPreviewModal, PreviewPayload } from "@/components/market/OrderPreviewModal";
import {
  listOrderDeliverables,
  signedUrlForDeliverable,
  OrderDeliverable,
  insertFileDeliverable,
  guessKindFromMime,
} from "@/services/market/orderDeliverables";

import { uploadToSupabaseStorage } from "@/services/market/storageUpload";


const BG0 = "#05040B";
const BG1 = "#0A0620";
const PURPLE = "#7C3AED";

// ✅ Real function names in your repo
const RPC_SELLER_OUT_FOR_DELIVERY = "market_seller_out_for_delivery_rpc";
const RPC_OTP_GENERATE = "market_otp_generate_rpc";
const RPC_OTP_VERIFY = "market_otp_verify_rpc";

const RPC_RELEASE_ESCROW = "market_release_escrow_rpc";
const RPC_OPEN_DISPUTE = "market_open_dispute_rpc";
const RPC_BUYER_CANCEL = "market_buyer_cancel_order_rpc";
const RPC_CHAIN_TX_FINALIZE = "market_chain_tx_finalize_rpc";
// Tables
const ORDERS_TABLE = "market_orders";
const LISTINGS_TABLE = "market_listings";
const SELLERS_TABLE = "market_seller_profiles";
const OTP_TABLE = "market_order_otps";
const CRYPTO_INTENTS_TABLE = "market_crypto_intents";

const OTP_REQUEST_COOLDOWN_SEC = 30;

const ESCROW_DEPOSIT_SIG_MULTI = keccak256(toHex("EscrowDeposited(bytes32,address,address,address,uint256)"));
const ESCROW_DEPOSIT_SIG_SINGLE = keccak256(toHex("EscrowDeposited(bytes32,address,address,uint256)"));

function normalizeOrderKey(key: string | null | undefined) {
  const raw = String(key ?? "").toLowerCase().replace(/^0x/, "");
  return raw.padStart(64, "0");
}

function hexToAddress(topicHex?: string): string | null {
  if (!topicHex || !topicHex.startsWith("0x")) return null;
  return `0x${topicHex.slice(-40)}`.toLowerCase();
}

function decodeDepositData(dataHex?: string) {
  const data = String(dataHex ?? "");
  if (!data.startsWith("0x")) return { token: null, amountRaw: 0n };
  const payload = data.slice(2);
  if (payload.length >= 64 * 2) {
    const tokenSlot = payload.slice(0, 64);
    const amountSlot = payload.slice(64, 128);
    const token = `0x${tokenSlot.slice(24 * 2)}`.toLowerCase();
    const amountRaw = BigInt(`0x${amountSlot}`);
    return { token, amountRaw };
  }
  if (payload.length >= 64) {
    const amountRaw = BigInt(`0x${payload.slice(0, 64)}`);
    return { token: null, amountRaw };
  }
  return { token: null, amountRaw: 0n };
}

function orderKeyFromId(orderId: string) {
  return keccak256(toHex(String(orderId || "")));
}

type OrderRow = {
  id: string;
  buyer_id: string;
  seller_id: string;
  listing_id: string;
  quantity: number;
  unit_price: number;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
  in_escrow_at: string | null;
  out_for_delivery_at: string | null;
  delivered_at: string | null;
  released_at: string | null;
  refunded_at: string | null;
  cancelled_at: string | null;
  delivery_address?: { geo?: any } | null;
  buyer_contact?: {
    name?: string;
    phone?: string;
    email?: string;
    note?: string;
  } | null;
};

type ListingRow = {
  id: string;
  title: string | null;
  delivery_type: string | null;
  category: string | null;
  sub_category: string | null;
  stock_qty?: number | null;
  website_url?: string | null;
};

type SellerRow = {
  user_id: string;
  market_username: string | null;
  display_name: string | null;
  business_name: string | null;
  is_verified: boolean | null;
};

type BuyerProfileRow = {
  id: string;
  username: string | null;
  full_name: string | null;
};

type OtpRow = {
  order_id: string;
  expires_at: string;
  attempts: number;
  verified_at: string | null;
};

type CryptoIntent = {
  id: string;
  intent_type: string;
  status: string;
  chain: string;
  tx_hash: string | null;
  client_reference?: string | null;
  created_at: string;
};

function money(currency: string | null, amt: any) {
  const n = Number(amt ?? 0);
  if (currency?.toUpperCase() === "USDC") return `$${n.toLocaleString()}`;
  return `₦${n.toLocaleString()}`;
}

function isHexHash(v?: string | null) {
  return /^0x[a-fA-F0-9]{64}$/.test(String(v || "").trim());
}

function isUuid(v?: string | null) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(v || "").trim(),
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    CREATED: { bg: "rgba(255,255,255,0.08)", fg: "#E5E7EB", label: "Created" },
    IN_ESCROW: { bg: "rgba(124,58,237,0.18)", fg: "#C4B5FD", label: "In Escrow" },
    OUT_FOR_DELIVERY: { bg: "rgba(59,130,246,0.14)", fg: "#93C5FD", label: "Out for delivery" },
    DELIVERED: { bg: "rgba(16,185,129,0.14)", fg: "#6EE7B7", label: "Delivered" },
    RELEASED: { bg: "rgba(16,185,129,0.14)", fg: "#34D399", label: "Released" },
    REFUNDED: { bg: "rgba(239,68,68,0.14)", fg: "#FCA5A5", label: "Refunded" },
    CANCELLED: { bg: "rgba(239,68,68,0.14)", fg: "#FCA5A5", label: "Cancelled" },
  };

  const s = map[status] ?? { bg: "rgba(255,255,255,0.08)", fg: "#E5E7EB", label: status };

  return (
    <View
      style={{
        alignSelf: "flex-start",
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 999,
        backgroundColor: s.bg,
        borderWidth: 1,
        borderColor: `${s.fg}55`,
      }}
    >
      <Text style={{ color: s.fg, fontWeight: "900", fontSize: 12 }}>{s.label}</Text>
    </View>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
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
      <Text style={{ color: "#fff", fontWeight: "900", fontSize: 14 }}>{title}</Text>
      <View style={{ marginTop: 10 }}>{children}</View>
    </View>
  );
}

async function safeLoadListing(listingId: string) {
  const attempt1 = await supabase
    .from(LISTINGS_TABLE)
    .select("id,title,delivery_type,category,sub_category,website_url,stock_qty")
    .eq("id", listingId)
    .maybeSingle();

  if (!attempt1.error) return attempt1.data as any;

  const msg = String(attempt1.error.message || "").toLowerCase();
  if (msg.includes("website_url") && msg.includes("does not exist")) {
    const attempt2 = await supabase
      .from(LISTINGS_TABLE)
      .select("id,title,delivery_type,category,sub_category,stock_qty")
      .eq("id", listingId)
      .maybeSingle();
    if (attempt2.error) throw new Error(attempt2.error.message);
    return attempt2.data as any;
  }

  throw new Error(attempt1.error.message);
}

export default function OrderDetails() {
  const insets = useSafeAreaInsets();
  const { orderId, tx, uo } = useLocalSearchParams<{ orderId: string; tx?: string; uo?: string }>();
  const oid = useMemo(() => String(orderId || ""), [orderId]);
  const navTx = useMemo(() => String(tx || "").trim(), [tx]);
  const navUserOp = useMemo(() => String(uo || "").trim(), [uo]);

  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<string | null>(null);

  const [order, setOrder] = useState<OrderRow | null>(null);
  const [listing, setListing] = useState<ListingRow | null>(null);
  const [seller, setSeller] = useState<SellerRow | null>(null);
  const [buyerProfile, setBuyerProfile] = useState<BuyerProfileRow | null>(null);
  const [sellerProfileUsername, setSellerProfileUsername] = useState<string | null>(null);

  const [otp, setOtp] = useState<OtpRow | null>(null);
  const [intents, setIntents] = useState<CryptoIntent[]>([]);

  const [deliverables, setDeliverables] = useState<OrderDeliverable[]>([]);

  const [otpInput, setOtpInput] = useState("");
  const [generatedOtpCode, setGeneratedOtpCode] = useState<string | null>(null);
  const [otpCooldownUntilMs, setOtpCooldownUntilMs] = useState<number>(0);
  const [nowMs, setNowMs] = useState<number>(Date.now());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Preview modal
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewPayload, setPreviewPayload] = useState<PreviewPayload | null>(null);

  // Upload (seller)
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [reindexOpen, setReindexOpen] = useState(false);
  const [reindexTx, setReindexTx] = useState("");
  const autoReindexKeyRef = useRef<string>("");
  const autoSyncBusyRef = useRef(false);

  const isBuyer = useMemo(() => !!me && !!order && order.buyer_id === me, [me, order]);
  const isSeller = useMemo(() => !!me && !!order && order.seller_id === me, [me, order]);
  const canOrderChat = useMemo(
    () =>
      !!order &&
      ["IN_ESCROW", "OUT_FOR_DELIVERY", "DELIVERED", "RELEASED"].includes(String(order.status || "").toUpperCase()) &&
      (isBuyer || isSeller),
    [order, isBuyer, isSeller],
  );
  const counterpartyUsername = useMemo(() => {
    if (!order) return null;
    if (isBuyer) {
      const sellerHandle = String(seller?.market_username || sellerProfileUsername || "").trim().toLowerCase();
      if (sellerHandle) return sellerHandle;
      const sellerId = String((order as any)?.seller_id || "").trim().toLowerCase();
      return isUuid(sellerId) ? sellerId : null;
    }
    if (isSeller) {
      const buyerHandle = String(buyerProfile?.username || "").trim().toLowerCase();
      if (buyerHandle) return buyerHandle;
      const buyerId = String((order as any)?.buyer_id || "").trim().toLowerCase();
      return isUuid(buyerId) ? buyerId : null;
    }
    return null;
  }, [
    order,
    isBuyer,
    isSeller,
    seller?.market_username,
    sellerProfileUsername,
    buyerProfile?.username,
  ]);
  const counterpartyHandleHint = useMemo(() => {
    if (!counterpartyUsername) return "Username not set yet";
    if (isUuid(counterpartyUsername)) return "Direct chat link ready";
    return `@${counterpartyUsername}`;
  }, [counterpartyUsername]);
  const counterpartyLabel = useMemo(() => {
    if (isBuyer) return "seller";
    if (isSeller) return "buyer";
    return "user";
  }, [isBuyer, isSeller]);
  const counterpartyName = useMemo(() => {
    if (isBuyer) {
      return (
        seller?.business_name ||
        seller?.display_name ||
        seller?.market_username ||
        "Seller"
      );
    }
    if (isSeller) {
      return (
        buyerProfile?.full_name ||
        buyerProfile?.username ||
        (order as any)?.buyer_contact?.name ||
        "Buyer"
      );
    }
    return "User";
  }, [
    isBuyer,
    isSeller,
    seller?.business_name,
    seller?.display_name,
    seller?.market_username,
    buyerProfile?.full_name,
    buyerProfile?.username,
    order,
  ]);

  const otpVerified = !!otp?.verified_at;
  const latestDepositIntent = useMemo(() => {
    const dep = intents.filter((i) => String(i.intent_type || "").toUpperCase() === "DEPOSIT");
    if (!dep.length) return null;
    return dep.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))[0];
  }, [intents]);
  const latestReleaseIntent = useMemo(() => {
    const rel = intents.filter((i) => String(i.intent_type || "").toUpperCase() === "RELEASE");
    if (!rel.length) return null;
    return rel.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))[0];
  }, [intents]);
  const isPiRailOrder = useMemo(
    () =>
      intents.some(
        (i) =>
          String(i.intent_type || "").toUpperCase() === "DEPOSIT" &&
          String(i.chain || "").toLowerCase() === "pi_testnet",
      ),
    [intents],
  );
  const isStableOrder = useMemo(
    () => ["USDC", "USDT"].includes(String(order?.currency || "").toUpperCase()),
    [order?.currency],
  );
  const hasSubmittedCryptoDeposit = useMemo(() => {
    return intents.some(
      (i) =>
        String(i.intent_type || "").toUpperCase() === "DEPOSIT" &&
        ["SUBMITTED", "CONFIRMED"].includes(String(i.status || "").toUpperCase()),
    ) || isHexHash(latestDepositIntent?.tx_hash) || isHexHash(latestDepositIntent?.client_reference) || isHexHash(navTx) || isHexHash(navUserOp);
  }, [intents, latestDepositIntent?.tx_hash, latestDepositIntent?.client_reference, navTx, navUserOp]);
  const defaultDepositTx = useMemo(() => {
    const v = String(latestDepositIntent?.tx_hash || navTx || "").trim();
    return isHexHash(v) ? v : "";
  }, [latestDepositIntent?.tx_hash, navTx]);
  const defaultDepositRef = useMemo(() => {
    const v = String(latestDepositIntent?.client_reference || navUserOp || "").trim();
    if (isHexHash(v)) return v;
    if (!latestDepositIntent?.tx_hash && isHexHash(navTx)) return navTx;
    return "";
  }, [latestDepositIntent?.client_reference, latestDepositIntent?.tx_hash, navTx, navUserOp]);
  const defaultDepositHash = defaultDepositTx || defaultDepositRef;
  // Note: `market_crypto_intents` can be temporarily empty (RLS, RPC not writing tx_hash, etc).
  // Resync must still be available for strict on-chain confirmation.
  const awaitingConfirmations =
    !!order &&
    order.status === "CREATED" &&
    isStableOrder &&
    !isPiRailOrder &&
    hasSubmittedCryptoDeposit;
  const canResyncDeposit = !!order && order.status === "CREATED" && isStableOrder && !isPiRailOrder;
  const pollIntervalMs = 5 * 60 * 1000;
  const depositCreatedAtMs = latestDepositIntent?.created_at ? new Date(latestDepositIntent.created_at).getTime() : 0;
  const nextPollAtMs = depositCreatedAtMs > 0 ? depositCreatedAtMs + pollIntervalMs : 0;
  const pollRemainingSec = nextPollAtMs > 0 ? Math.max(0, Math.ceil((nextPollAtMs - nowMs) / 1000)) : 0;

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);


  const previewItems = useMemo(() => deliverables.filter((d) => d.access === "preview"), [deliverables]);
  const finalItems = useMemo(() => deliverables.filter((d) => d.access === "final"), [deliverables]);

  const isDigital = useMemo(() => String(listing?.delivery_type ?? "").toLowerCase() === "digital", [listing?.delivery_type]);
  const hasWebsite = useMemo(() => !!listing?.website_url, [listing?.website_url]);

  // Buyer can download full-quality after OTP verified + delivered/released
  const canDownloadFinal =
    !!order &&
    isBuyer &&
    otpVerified &&
    (order.status === "DELIVERED" || order.status === "RELEASED");

  async function load() {
    console.log("[OrderDetails] load start", { oid });
    setLoading(true);
    setErr(null);

    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user) {
        router.replace("/(auth)/login" as any);
        return;
      }
      setMe(user.id);

      let o: any = null;
      {
        const first = await supabase
          .from(ORDERS_TABLE)
          .select(
            "id,buyer_id,seller_id,listing_id,quantity,unit_price,amount,currency,status,created_at,in_escrow_at,out_for_delivery_at,delivered_at,released_at,refunded_at,cancelled_at,delivery_address,buyer_contact"
          )
          .eq("id", oid)
          .maybeSingle();
        if (!first.error) {
          o = first.data;
        } else if (String(first.error.message || "").includes("buyer_contact")) {
          const fallback = await supabase
            .from(ORDERS_TABLE)
            .select(
              "id,buyer_id,seller_id,listing_id,quantity,unit_price,amount,currency,status,created_at,in_escrow_at,out_for_delivery_at,delivered_at,released_at,refunded_at,cancelled_at,delivery_address"
            )
            .eq("id", oid)
            .maybeSingle();
          if (fallback.error) throw new Error(fallback.error.message);
          o = fallback.data;
        } else {
          throw new Error(first.error.message);
        }
      }

      if (!o) throw new Error("Order not found");

      if ((o as any).buyer_id !== user.id && (o as any).seller_id !== user.id) {
        throw new Error("You are not allowed to view this order.");
      }

      const l = await safeLoadListing((o as any).listing_id);

      const { data: s, error: sErr } = await supabase
        .from(SELLERS_TABLE)
        .select("user_id,market_username,display_name,business_name,is_verified")
        .eq("user_id", (o as any).seller_id)
        .maybeSingle();
      if (sErr) throw new Error(sErr.message);

      let bProf: BuyerProfileRow | null = null;
      let sellerUsernameFallback: string | null = null;
      try {
        const { data: pData, error: pErr } = await supabase
          .from("profiles")
          .select("id,username,full_name")
          .in("id", [(o as any).buyer_id, (o as any).seller_id]);
        if (!pErr) {
          for (const p of (pData ?? []) as any[]) {
            const pid = String(p.id || "");
            if (pid === String((o as any).buyer_id)) {
              bProf = {
                id: pid,
                username: p.username ?? null,
                full_name: p.full_name ?? null,
              };
            }
            if (pid === String((o as any).seller_id)) {
              const handle = String(p.username || "").trim().toLowerCase();
              sellerUsernameFallback = handle || null;
            }
          }
        }
      } catch {
        bProf = null;
        sellerUsernameFallback = null;
      }

      const { data: otpRow } = await supabase
        .from(OTP_TABLE)
        .select("order_id,expires_at,attempts,verified_at")
        .eq("order_id", oid)
        .maybeSingle();

      const { data: ints } = await supabase
        .from(CRYPTO_INTENTS_TABLE)
        .select("id,intent_type,status,chain,tx_hash,client_reference,created_at")
        .eq("order_id", oid)
        .order("created_at", { ascending: false });

      // deliverables (safe)
      try {
        const ds = await listOrderDeliverables(oid);
        setDeliverables(ds);
      } catch (e: any) {
        console.log("[OrderDetails] deliverables skipped:", e?.message ?? e);
        setDeliverables([]);
      }

      setOrder(o as any);
      setListing((l as any) ?? null);
      setSeller((s as any) ?? null);
      setBuyerProfile(bProf);
      setSellerProfileUsername(sellerUsernameFallback);
      setOtp((otpRow as any) ?? null);
      setIntents(((ints as any) ?? []) as any);
    } catch (e: any) {
      setErr(friendlyMarketError(e, "We couldn't load this order."));
      setOrder(null);
      setListing(null);
      setSeller(null);
      setBuyerProfile(null);
      setSellerProfileUsername(null);
      setOtp(null);
      setIntents([]);
      setDeliverables([]);
    } finally {
      setLoading(false);
      console.log("[OrderDetails] load end");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oid]);

  useEffect(() => {
    if (!awaitingConfirmations) return;
    if (!defaultDepositHash) return;

    const key = `${order?.id || ""}:${defaultDepositHash}`;
    if (autoReindexKeyRef.current === key) return;
    autoReindexKeyRef.current = key;

    const timer = setTimeout(() => {
      void reindexDeposit();
    }, 1200);

    return () => clearTimeout(timer);
  }, [awaitingConfirmations, defaultDepositHash, order?.id]);

  useEffect(() => {
    if (!awaitingConfirmations || !order?.id) return;

    let alive = true;
    const run = async () => {
      if (!alive || autoSyncBusyRef.current) return;
      autoSyncBusyRef.current = true;
      try {
        const body: Record<string, unknown> = { order_id: order.id };
        if (isHexHash(defaultDepositHash)) body.tx_hash = defaultDepositHash;
        await supabase.functions.invoke("market-escrow-reindex", { body }).catch(() => null);
        await load();
      } finally {
        autoSyncBusyRef.current = false;
      }
    };

    void run();
    const timer = setInterval(() => {
      void run();
    }, 15000);

    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [awaitingConfirmations, order?.id, defaultDepositHash]);

  useEffect(() => {
    if (!order?.id) return;
    if (!isStableOrder) return;
    if (isPiRailOrder) return;
    if (String(order.status || "").toUpperCase() === "RELEASED") return;
    if (String(order.status || "").toUpperCase() === "REFUNDED") return;

    const releaseStatus = String(latestReleaseIntent?.status || "").toUpperCase();
    const releaseTx = String(latestReleaseIntent?.tx_hash || "").trim();
    const releaseChain = String(latestReleaseIntent?.chain || "").trim();
    if (!["SUBMITTED", "CONFIRMED", "PROCESSING", "CREATED"].includes(releaseStatus)) return;
    if (!isHexHash(releaseTx) || !releaseChain) return;

    let alive = true;
    const run = async () => {
      if (!alive || autoSyncBusyRef.current) return;
      autoSyncBusyRef.current = true;
      try {
        try {
          await supabase.rpc(RPC_CHAIN_TX_FINALIZE, {
            p_order_id: order.id,
            p_chain: releaseChain,
            p_tx_hash: releaseTx,
            p_event_type: "RELEASE",
          });
        } catch {
          // ignore; next loop/poller can settle
        }
        await load();
      } finally {
        autoSyncBusyRef.current = false;
      }
    };

    void run();
    const timer = setInterval(() => {
      void run();
    }, 15000);

    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [order?.id, order?.status, isStableOrder, isPiRailOrder, latestReleaseIntent?.status, latestReleaseIntent?.tx_hash, latestReleaseIntent?.chain]);

  // Buttons conditions (your existing logic)
  const canGoCheckout = !!order && order.status === "CREATED" && isBuyer && !hasSubmittedCryptoDeposit;
  const canCancel = !!order && order.status === "CREATED" && isBuyer && !hasSubmittedCryptoDeposit;

  const canOutForDelivery = !!order && isSeller && order.status === "IN_ESCROW";
  const canRequestOtp = !!order && isBuyer && order.status === "OUT_FOR_DELIVERY";
  const canVerifyOtp = !!order && isSeller && order.status === "OUT_FOR_DELIVERY";

  // Buyer releases only after OTP verified + delivered
  const canRelease = !!order && isBuyer && otpVerified && order.status === "DELIVERED";
  const canSellerUpload =
    !!order &&
    isSeller &&
    ["IN_ESCROW", "OUT_FOR_DELIVERY", "DELIVERABLE_UPLOADED"].includes(String(order.status || "").toUpperCase());

  const otpExpiresAtMs = otp?.expires_at ? new Date(otp.expires_at).getTime() : 0;
  const otpExpiryRemainingSec = otpVerified || !otpExpiresAtMs ? 0 : Math.max(0, Math.ceil((otpExpiresAtMs - nowMs) / 1000));
  const otpCooldownRemainingSec = Math.max(0, Math.ceil((otpCooldownUntilMs - nowMs) / 1000));
  const hasPendingUnexpiredOtp = !!otp && !otpVerified && otpExpiryRemainingSec > 0;
  const canGenerateOtpNow = canRequestOtp && !busy && !otpVerified && otpCooldownRemainingSec === 0 && !hasPendingUnexpiredOtp;
  const orderStatus = String(order?.status || "").toUpperCase();
  const policyAudience = isSeller ? "seller" : isBuyer ? "buyer" : "both";
  const { bySection: orderPolicy, loading: orderPolicyLoading } = useMarketPolicyBlocks({
    surface: "order",
    audience: policyAudience,
    orderStatus,
  });

  function fmtCountdown(totalSec: number) {
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }


  async function doOutForDelivery() {
    if (!order) return;
    setBusy(true);
    setErr(null);
    try {
      const { error } = await supabase.rpc(RPC_SELLER_OUT_FOR_DELIVERY, { p_order_id: order.id });
      if (error) throw error;
      await load();
    } catch (e: any) {
      setErr(friendlyMarketError(e, "We couldn't update delivery status."));
    } finally {
      setBusy(false);
    }
  }

  async function requestOTP() {
    if (!order) return;
    setBusy(true);
    setErr(null);
    try {
      const { data, error } = await supabase.rpc(RPC_OTP_GENERATE, { p_order_id: order.id });
      if (error) throw error;

      const otpCode = (data as any)?.otp_code ? String((data as any).otp_code) : null;
      const expiresAt = (data as any)?.expires_at ? new Date((data as any).expires_at).getTime() : 0;
      setGeneratedOtpCode(otpCode);
      setOtpCooldownUntilMs(Date.now() + OTP_REQUEST_COOLDOWN_SEC * 1000);
      if (expiresAt > 0) {
        setOtp((prev) => ({
          order_id: order.id,
          expires_at: new Date(expiresAt).toISOString(),
          attempts: prev?.attempts ?? 0,
          verified_at: null,
        }));
      }

      if (otpCode) {
        Alert.alert("Delivery OTP", `Share this OTP with the seller when you are ready to confirm delivery:

${otpCode}`);
      }

      await load();
    } catch (e: any) {
      setErr(friendlyMarketError(e, "We couldn't send OTP yet. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  async function verifyOTP() {
    if (!order) return;
    const code = otpInput.trim();
    if (code.length < 4) return setErr("Enter the OTP");

    setBusy(true);
    setErr(null);
    try {
      const { error } = await supabase.rpc(RPC_OTP_VERIFY, { p_order_id: order.id, p_otp: code });
      if (error) throw error;
      setOtpInput("");
      await load();
    } catch (e: any) {
      setErr(friendlyMarketError(e, "OTP verification failed. Please check the code and try again."));
    } finally {
      setBusy(false);
    }
  }

async function releaseFunds() {
  if (!order) return;
  setBusy(true);
  setErr(null);
  try {
    if (isPiRailOrder) {
      await releasePiForOrder(order.id);
    } else if (["USDC", "USDT"].includes(String(order.currency || "").toUpperCase())) {
      await releaseUsdcForOrder(order.id);
    } else {
      const auth = await requireLocalAuth("Release escrow to seller");
      if (!auth.ok) throw new Error(auth.message || "Authentication required");
      const { error } = await supabase.rpc(RPC_RELEASE_ESCROW, { p_order_id: order.id });
      if (error) throw error;
    }
    await load();
  } catch (e: any) {
    setErr(friendlyMarketError(e, "We couldn't release funds yet."));
  } finally {
      setBusy(false);
    }
  }

  async function openDispute() {
    if (!order) return;
    setBusy(true);
    setErr(null);
    try {
      const reason = isSeller
        ? "Seller reported buyer manipulation / policy violation"
        : "Buyer requested refund / issue with delivery";
      const { error } = await supabase.rpc(RPC_OPEN_DISPUTE, {
        p_order_id: order.id,
        p_reason: reason,
      });
      if (error) throw error;
      await load();
    } catch (e: any) {
      setErr(friendlyMarketError(e, "We couldn't open a dispute right now."));
    } finally {
      setBusy(false);
    }
  }

  async function cancelOrder() {
    if (!order) return;
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const { error } = await supabase.rpc(RPC_BUYER_CANCEL, { p_order_id: order.id });
      if (error) throw error;
      await load();
    } catch (e: any) {
      setErr(friendlyMarketError(e, "We couldn't cancel this order right now."));
    } finally {
      setBusy(false);
    }
  }

  async function reindexDeposit() {
    if (!order || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const txHash = (reindexTx || defaultDepositHash || "").trim();
      if (!txHash) throw new Error("Enter a transaction hash or UserOp hash.");
      if (!isHexHash(txHash)) throw new Error("Enter a valid transaction hash or UserOp hash.");
      // Client-side reindex: read tx receipt + logs directly, then apply via RPC.
      let { data: esc, error: escErr } = await supabase
        .from("market_crypto_escrows")
        .select("order_id,order_key,chain,escrow_address,token_address")
        .eq("order_id", order.id)
        .maybeSingle();

      let orderKey = esc?.order_key as string | undefined;
      let chainName = esc?.chain as string | undefined;
      let escrowAddress = esc?.escrow_address as string | undefined;
      let tokenAddress = esc?.token_address as string | undefined;

      if (escErr || !orderKey) {
        // Fallback: compute order key locally and read active chain config (no RPC needed).
        const token = String(order.currency || "USDC").toUpperCase();
        const { data: cfgRow, error: cfgRowErr } = await supabase
          .from("market_chain_config")
          .select("chain,rpc_url,escrow_address,usdc_address,usdt_address,confirmations_required")
          .eq("active", true)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (cfgRowErr || !cfgRow?.chain) throw new Error("Escrow mapping missing.");
        orderKey = orderKeyFromId(order.id);
        chainName = String(cfgRow.chain || "");
        escrowAddress = String(cfgRow.escrow_address || "");
        tokenAddress =
          token === "USDT"
            ? String(cfgRow.usdt_address || "")
            : String(cfgRow.usdc_address || "");
      }
      if (!orderKey || !chainName || !escrowAddress) throw new Error("Escrow mapping missing.");

      const { data: cfg, error: cfgErr } = await supabase
        .from("market_chain_config")
        .select("chain,rpc_url,escrow_address,confirmations_required")
        .eq("chain", chainName)
        .eq("active", true)
        .maybeSingle();
      if (cfgErr || !cfg?.rpc_url) throw new Error("Chain config missing.");

      const client = createPublicClient({ transport: http(cfg.rpc_url) });
      const requestCustomRpc = async (method: string, params: unknown[]) => {
        const req = client.request as unknown as (args: { method: string; params?: unknown[] }) => Promise<any>;
        return req({ method, params });
      };
      let finalTxHash = txHash as `0x${string}`;
      let receipt: any = null;
      try {
        receipt = await client.getTransactionReceipt({ hash: finalTxHash });
      } catch {
        // If user pasted a UserOp hash, try to resolve it to a tx hash.
        try {
          const uo: any =
            (await requestCustomRpc("eth_getUserOperationReceipt", [finalTxHash])) ??
            (await requestCustomRpc("alchemy_getUserOperationReceipt", [finalTxHash]));
          const opTx = String(uo?.receipt?.transactionHash || uo?.transactionHash || "");
          if (opTx.startsWith("0x")) {
            finalTxHash = opTx as `0x${string}`;
            receipt = await client.getTransactionReceipt({ hash: finalTxHash });
          }
        } catch {
          // ignore
        }
      }
      if (!receipt) {
        throw new Error("Transaction receipt not found yet.");
      }
      if (!receipt?.blockNumber) throw new Error("Transaction receipt not found yet.");
      if (receipt.status && String(receipt.status).toLowerCase() === "reverted") {
        throw new Error("Transaction reverted.");
      }

      const latest = await client.getBlockNumber();
      const required = Math.max(1, Number(cfg.confirmations_required ?? 1));
      const confirmations = Number(latest - receipt.blockNumber + 1n);
      if (confirmations < required) {
        Alert.alert(
          "Awaiting confirmations",
          `Confirmations: ${confirmations}/${required}\n\nTry again in a few minutes.`,
        );
        return;
      }

      const wantKey = normalizeOrderKey(orderKey);
      const escrowAddr = String(cfg.escrow_address || escrowAddress || "").toLowerCase();
      const logs = receipt.logs || [];
      const hit = logs.find((log: any) => {
        const addr = String(log.address || "").toLowerCase();
        const topic0 = String(log.topics?.[0] || "").toLowerCase();
        const topic1 = normalizeOrderKey(String(log.topics?.[1] || ""));
        const isDeposit = topic0 === ESCROW_DEPOSIT_SIG_MULTI || topic0 === ESCROW_DEPOSIT_SIG_SINGLE;
        return addr === escrowAddr && isDeposit && topic1 === wantKey;
      });
      if (!hit) throw new Error("Deposit event not found in tx logs.");

      const buyer = hexToAddress(hit.topics?.[2]);
      const seller = hexToAddress(hit.topics?.[3]);
      const { token, amountRaw } = decodeDepositData(hit.data);
      const tokenAddr = (token || tokenAddress || "").toLowerCase();
      const amountUnits = Number(amountRaw) / 1_000_000;

      const baseArgs: any = {
        p_order_id: order.id,
        p_buyer_wallet: buyer,
        p_seller_wallet: seller,
        p_amount_raw: amountRaw ? amountRaw.toString() : null,
        p_amount_units: amountUnits,
        p_tx_hash: String(hit.transactionHash ?? finalTxHash),
        p_log_index: Number(hit.logIndex ?? 0),
        p_block_number: Number(hit.blockNumber ?? 0),
        p_block_time: null,
        p_raw: hit,
      };
      let rpcErr = null as any;
      const { error: applyErr } = await supabase.rpc("market_apply_chain_deposit", {
        ...baseArgs,
        p_token_address: tokenAddr,
      });
      rpcErr = applyErr;
      if (applyErr) {
        const msg = String(applyErr.message || "");
        if (/function.+does not exist|p_token_address/i.test(msg)) {
          const { error: retryErr } = await supabase.rpc("market_apply_chain_deposit", baseArgs);
          rpcErr = retryErr;
        }
      }
      if (rpcErr) throw rpcErr;

      Alert.alert("Deposit confirmed", "Order moved to escrow.");
      await load();
      setReindexOpen(false);
    } catch (e: any) {
      setErr(friendlyMarketError(e, "We couldn't resync the deposit yet."));
    } finally {
      setBusy(false);
    }
  }

  function openPreview(payload: PreviewPayload) {
    setPreviewPayload(payload);
    setPreviewOpen(true);
  }

  async function previewDeliverable(d: OrderDeliverable) {
    if (d.kind === "link") {
      const url = d.link_url ?? listing?.website_url ?? "";
      if (!url) return setErr("No website link available.");
      openPreview({ kind: "link", access: d.access, title: d.title ?? "Website preview", url });
      return;
    }

    openPreview({
      kind: d.kind as any,
      access: d.access,
      title: d.title ?? `${d.kind.toUpperCase()} ${d.access === "preview" ? "preview" : "full"}`,
      previewSeconds: d.preview_seconds ?? 20,
      mimeType: d.mime_type,
      urlPromise: async () => signedUrlForDeliverable(d, 900),
    });
  }

  async function downloadDeliverable(d: OrderDeliverable) {
    try {
      const rawName = String((d.meta as any)?.originalName || d.title || `deliverable-${d.id}` || "").trim();
      const safeName = rawName ? rawName.replace(/[^\w.\-]+/g, "_") : `deliverable-${d.id}`;
      const url = await signedUrlForDeliverable(d, 900, { download: safeName });
      if (!url) throw new Error("No download URL");
      await Linking.openURL(url);
    } catch (e: any) {
      setErr(friendlyMarketError(e, "We couldn't open this file right now."));
    }
  }

  async function onPolicyAction(action: string) {
    const next = String(action || "").trim().toLowerCase();
    if (!next) return;
    if (next === "open_dispute") {
      await openDispute();
      return;
    }
    if (next === "go_checkout" && canGoCheckout && order?.id) {
      router.push(`/market/checkout/${order.id}` as any);
    }
  }

  function openOrderChat() {
    if (!counterpartyUsername) {
      Alert.alert(
        "Chat unavailable",
        `No chat handle found for this ${counterpartyLabel} yet. Ask them to complete profile setup.`,
      );
      return;
    }
    router.push({
      pathname: "/market/dm/[username]" as any,
      params: { username: counterpartyUsername },
    });
  }

  // Seller upload preview/final (safe + production)
async function pickAndUpload(access: "preview" | "final") {
  if (!order) return;

  // extra safety: only seller should upload
  if (!isSeller) {
    setUploadErr("Only the seller can upload deliverables for this order.");
    return;
  }
  if (!canSellerUpload) {
    setUploadErr(`Upload is only allowed while order is in escrow/delivery. Current status: ${order.status}`);
    return;
  }

  setUploadBusy(true);
  setUploadErr(null);

  try {
    const DocumentPicker = await import("expo-document-picker");

    const res = await DocumentPicker.getDocumentAsync({
      multiple: false,
      copyToCacheDirectory: true,
      type: "*/*",
    });

    if (res.canceled) return;

    const asset = res.assets?.[0];
    if (!asset?.uri) throw new Error("No file selected");

    const name = asset.name ?? `file-${Date.now()}`;
    const mime = asset.mimeType ?? null;

    // keep your existing kind guessing logic
    const kind = guessKindFromMime(mime, name);

    const bucket = "market-deliverables";
    const safeName = name.replace(/[^\w.\-]+/g, "_");
    const path = `orders/${order.id}/${access}/${Date.now()}-${safeName}`;

    // ✅ Upload (no expo-file-system EncodingType / bytes here)
    let uploaded: { publicUrl: string | null; storagePath: string };
    try {
      uploaded = await uploadToSupabaseStorage({
        bucket,
        path,
        localUri: asset.uri,
        contentType: mime ?? "application/octet-stream",
        upsert: false,
      });
    } catch (storageErr: any) {
      throw new Error(`[storage] ${String(storageErr?.message || storageErr)}`);
    }

    // ✅ Save DB row
    try {
      await insertFileDeliverable({
        orderId: order.id,
        access, // "preview" | "final" (matches your current UI & filters)
        kind,
        title: access === "preview" ? `Preview: ${name}` : `Full: ${name}`,
        sortOrder: access === "preview" ? previewItems.length : finalItems.length,
        bucket,
        storagePath: uploaded.storagePath,
        mimeType: mime,
        meta: {
          note: access === "preview" ? "Low quality / watermarked recommended" : "Full quality",
          originalName: name,
          size: asset.size ?? null,
        },
      });
    } catch (dbErr: any) {
      throw new Error(`[db] ${String(dbErr?.message || dbErr)}`);
    }

    await load();
  } catch (e: any) {
    const msg = String(e?.message || "Upload failed");
    if (msg.toLowerCase().includes("[storage]")) {
      setUploadErr(`Storage upload failed: ${msg.replace(/^\[storage\]\s*/i, "")}`);
    } else if (msg.toLowerCase().includes("[db]")) {
      setUploadErr(`Deliverable save failed: ${msg.replace(/^\[db\]\s*/i, "")}`);
    } else if (msg.toLowerCase().includes("row-level security")) {
      setUploadErr(
        "Upload blocked by RLS policy. Apply the latest market deliverables RLS migration, then retry.",
      );
    } else {
      setUploadErr(msg);
    }
  } finally {
    setUploadBusy(false);
  }
}


  return (
    <LinearGradient
      colors={[BG1, BG0]}
      start={{ x: 0.15, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={{ flex: 1, paddingTop: Math.max(insets.top, 14), paddingHorizontal: 16 }}
    >
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
            <Text style={{ color: "#fff", fontSize: 22, fontWeight: "900" }}>Order</Text>
            <Text style={{ marginTop: 4, color: "rgba(255,255,255,0.6)", fontSize: 12 }}>
              Escrow + OTP delivery protection
            </Text>
          </View>
        </View>

        {loading ? (
          <View style={{ marginTop: 40, alignItems: "center" }}>
            <ActivityIndicator />
            <Text style={{ marginTop: 10, color: "rgba(255,255,255,0.7)" }}>Loading…</Text>
          </View>
        ) : !order ? (
          <View style={{ marginTop: 18, borderRadius: 22, padding: 16, backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" }}>
            <Text style={{ color: "#fff", fontWeight: "900" }}>Order not found</Text>
            {!!err && <Text style={{ marginTop: 6, color: "rgba(255,255,255,0.65)" }}>{err}</Text>}
          </View>
        ) : (
          <>
            {/* Summary */}
            <View style={{ marginTop: 6, borderRadius: 22, padding: 16, backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={{ color: "rgba(255,255,255,0.65)", fontSize: 12 }}>Item</Text>
                  <Text style={{ marginTop: 4, color: "#fff", fontWeight: "900" }}>
                    {listing?.title ?? "Listing"}
                  </Text>
                  <Text style={{ marginTop: 6, color: "rgba(255,255,255,0.55)", fontSize: 12 }}>
                    {listing?.category ?? "—"} • {listing?.delivery_type ?? "—"} • {listing?.sub_category ?? "—"}
                  </Text>
                  {listing?.category === "product" && typeof listing?.stock_qty === "number" ? (
                    <Text style={{ marginTop: 6, color: "rgba(255,255,255,0.6)", fontSize: 12 }}>
                      Stock left: {Math.max(0, listing.stock_qty)}
                    </Text>
                  ) : null}
                  <Text style={{ marginTop: 6, color: "rgba(255,255,255,0.55)", fontSize: 12 }}>
                    <Text style={{ color: "#fff", fontWeight: "900" }}>
                      Seller: {seller?.business_name || seller?.display_name || "Seller"}{" "}
                      {seller?.is_verified ? <Ionicons name="checkmark-circle" size={14} color="#3B82F6" /> : null} @{seller?.market_username || "seller"}
                    </Text>
                  </Text>
                </View>

                <View style={{ alignItems: "flex-end" }}>
                  <StatusBadge status={order.status} />
                  <Text style={{ marginTop: 10, color: "#fff", fontWeight: "900", fontSize: 18 }}>
                    {money(order.currency, order.amount)}
                  </Text>
                  <Text style={{ marginTop: 4, color: "rgba(255,255,255,0.55)", fontSize: 12 }}>
                    Qty: {order.quantity}
                  </Text>
                  <Pressable
                    onPress={async () => {
                      await Clipboard.setStringAsync(order.id);
                      Alert.alert("Copied", "Order ID copied. Share it with support/admin when needed.");
                    }}
                    style={{
                      marginTop: 8,
                      borderRadius: 10,
                      paddingVertical: 6,
                      paddingHorizontal: 10,
                      backgroundColor: "rgba(124,58,237,0.18)",
                      borderWidth: 1,
                      borderColor: "rgba(124,58,237,0.35)",
                    }}
                  >
                    <Text style={{ color: "#fff", fontWeight: "900", fontSize: 11 }}>Copy Order ID</Text>
                  </Pressable>
                </View>
              </View>
              <Text style={{ marginTop: 8, color: "rgba(255,255,255,0.6)", fontSize: 11 }}>
                Order ID: {order.id}
              </Text>
            </View>

            <MarketPolicyPanel
              title="Order guidance"
              blocks={orderPolicy.status_guidance}
              emptyText={orderPolicyLoading ? "Loading live policy..." : "Policy will appear here."}
              onAction={(action) => {
                void onPolicyAction(action);
              }}
            />

            {awaitingConfirmations ? (
              <Card title="Waiting for blockchain confirmations">
                <Text style={{ color: "rgba(255,255,255,0.7)", lineHeight: 20 }}>
                  Your deposit is submitted. We&apos;re waiting for on-chain confirmations before moving the order
                  into escrow. We check every ~5 minutes plus chain confirmations.
                </Text>
                {pollRemainingSec > 0 ? (
                  <Text style={{ marginTop: 8, color: "rgba(255,255,255,0.7)", fontSize: 12 }}>
                    Next automatic check in {fmtCountdown(pollRemainingSec)}.
                  </Text>
                ) : null}
                {defaultDepositTx ? (
                  <Text style={{ marginTop: 10, color: "rgba(255,255,255,0.7)", fontSize: 12 }}>
                    Tx: {defaultDepositTx}
                  </Text>
                ) : null}
                {!defaultDepositTx && defaultDepositRef ? (
                  <Text style={{ marginTop: 10, color: "rgba(255,255,255,0.7)", fontSize: 12 }}>
                    Reference: {defaultDepositRef}
                  </Text>
                ) : null}
                <Pressable
                  onPress={() => {
                    if (awaitingConfirmations || canResyncDeposit) {
                      if (!defaultDepositHash) {
                        setReindexOpen(true);
                        return;
                      }
                      setReindexTx(defaultDepositHash);
                      reindexDeposit();
                    } else {
                      load();
                    }
                  }}
                  style={{
                    marginTop: 10,
                    alignSelf: "flex-start",
                    borderRadius: 12,
                    paddingVertical: 10,
                    paddingHorizontal: 12,
                    backgroundColor: "rgba(124,58,237,0.18)",
                    borderWidth: 1,
                    borderColor: "rgba(124,58,237,0.35)",
                  }}
                >
                  <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }}>Refresh status</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setReindexTx(defaultDepositHash);
                    setReindexOpen(true);
                  }}
                  disabled={busy}
                  style={{
                    marginTop: 10,
                    alignSelf: "flex-start",
                    borderRadius: 12,
                    paddingVertical: 10,
                    paddingHorizontal: 12,
                    backgroundColor: busy ? "rgba(255,255,255,0.08)" : "rgba(124,58,237,0.25)",
                    borderWidth: 1,
                    borderColor: "rgba(124,58,237,0.45)",
                  }}
                >
                  <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }}>
                    Resync deposit now
                  </Text>
                </Pressable>
              </Card>
            ) : null}

            {!awaitingConfirmations && canResyncDeposit ? (
              <Card title="Resync deposit">
                <Text style={{ color: "rgba(255,255,255,0.7)", lineHeight: 20 }}>
                  If your deposit is confirmed on-chain but the order is still Created, resync using the transaction hash.
                </Text>
                {defaultDepositTx ? (
                  <View style={{ marginTop: 10 }}>
                    <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 12 }}>
                      Tx: {defaultDepositTx}
                    </Text>
                    <Pressable
                      onPress={() => Clipboard.setStringAsync(defaultDepositTx)}
                      style={{
                        marginTop: 8,
                        alignSelf: "flex-start",
                        borderRadius: 10,
                        paddingVertical: 8,
                        paddingHorizontal: 10,
                        backgroundColor: "rgba(255,255,255,0.08)",
                        borderWidth: 1,
                        borderColor: "rgba(255,255,255,0.12)",
                      }}
                    >
                      <Text style={{ color: "#fff", fontWeight: "800", fontSize: 11 }}>Copy hash</Text>
                    </Pressable>
                  </View>
                ) : null}
                {!defaultDepositTx && defaultDepositRef ? (
                  <View style={{ marginTop: 10 }}>
                    <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 12 }}>
                      Reference: {defaultDepositRef}
                    </Text>
                    <Pressable
                      onPress={() => Clipboard.setStringAsync(defaultDepositRef)}
                      style={{
                        marginTop: 8,
                        alignSelf: "flex-start",
                        borderRadius: 10,
                        paddingVertical: 8,
                        paddingHorizontal: 10,
                        backgroundColor: "rgba(255,255,255,0.08)",
                        borderWidth: 1,
                        borderColor: "rgba(255,255,255,0.12)",
                      }}
                    >
                      <Text style={{ color: "#fff", fontWeight: "800", fontSize: 11 }}>Copy hash</Text>
                    </Pressable>
                  </View>
                ) : null}
                <Pressable
                  onPress={() => {
                    setReindexTx(defaultDepositHash);
                    setReindexOpen(true);
                  }}
                  disabled={busy}
                  style={{
                    marginTop: 10,
                    alignSelf: "flex-start",
                    borderRadius: 12,
                    paddingVertical: 10,
                    paddingHorizontal: 12,
                    backgroundColor: busy ? "rgba(255,255,255,0.08)" : "rgba(124,58,237,0.25)",
                    borderWidth: 1,
                    borderColor: "rgba(124,58,237,0.45)",
                  }}
                >
                  <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }}>Resync deposit now</Text>
                </Pressable>
              </Card>
            ) : null}

            {(isSeller || isBuyer) && (order as any)?.delivery_address?.geo ? (
              <Card title={isSeller ? "Buyer delivery location" : "Your delivery location"}>
                <Text style={{ color: "#fff", fontWeight: "900" }}>
                  {(order as any)?.delivery_address?.geo?.label || "Location set"}
                </Text>
                <Text style={{ marginTop: 6, color: "rgba(255,255,255,0.65)", fontSize: 12 }}>
                  {(order as any)?.delivery_address?.geo?.city || "-"},{" "}
                  {(order as any)?.delivery_address?.geo?.region || "-"},{" "}
                  {(order as any)?.delivery_address?.geo?.country || "-"}
                </Text>
                {Number.isFinite(Number((order as any)?.delivery_address?.geo?.lat)) &&
                Number.isFinite(Number((order as any)?.delivery_address?.geo?.lng)) ? (
                  <Pressable
                    onPress={() =>
                      Linking.openURL(
                        `https://maps.google.com/?q=${(order as any).delivery_address.geo.lat},${(order as any).delivery_address.geo.lng}`,
                      )
                    }
                    style={{
                      marginTop: 10,
                      alignSelf: "flex-start",
                      borderRadius: 12,
                      paddingVertical: 10,
                      paddingHorizontal: 12,
                      backgroundColor: "rgba(255,255,255,0.06)",
                      borderWidth: 1,
                      borderColor: "rgba(255,255,255,0.12)",
                    }}
                  >
                    <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }}>Open in Maps</Text>
                  </Pressable>
                ) : null}
              </Card>
            ) : null}

            {(isSeller || isBuyer) &&
            (((order as any)?.buyer_contact?.phone || (order as any)?.buyer_contact?.email) ||
              ((order as any)?.delivery_address?.contact?.phone || (order as any)?.delivery_address?.contact?.email)) ? (
              <Card title={isSeller ? "Buyer contact" : "Your contact for seller"}>
                {((order as any)?.buyer_contact?.name || (order as any)?.delivery_address?.contact?.name) ? (
                  <Text style={{ color: "#fff", fontWeight: "900" }}>
                    {(order as any)?.buyer_contact?.name || (order as any)?.delivery_address?.contact?.name}
                  </Text>
                ) : null}
                {((order as any)?.buyer_contact?.phone || (order as any)?.delivery_address?.contact?.phone) ? (
                  <Text style={{ marginTop: 6, color: "rgba(255,255,255,0.75)", fontSize: 13 }}>
                    Phone: {(order as any)?.buyer_contact?.phone || (order as any)?.delivery_address?.contact?.phone}
                  </Text>
                ) : null}
                {((order as any)?.buyer_contact?.email || (order as any)?.delivery_address?.contact?.email) ? (
                  <Text style={{ marginTop: 4, color: "rgba(255,255,255,0.75)", fontSize: 13 }}>
                    Email: {(order as any)?.buyer_contact?.email || (order as any)?.delivery_address?.contact?.email}
                  </Text>
                ) : null}
                {((order as any)?.buyer_contact?.note || (order as any)?.delivery_address?.contact?.note) ? (
                  <Text style={{ marginTop: 8, color: "rgba(255,255,255,0.65)", fontSize: 12 }}>
                    Note: {(order as any)?.buyer_contact?.note || (order as any)?.delivery_address?.contact?.note}
                  </Text>
                ) : null}
              </Card>
            ) : null}

            {canOrderChat ? (
              <Card title={isBuyer ? "Message seller" : "Message buyer"}>
                <Text style={{ color: "rgba(255,255,255,0.72)", lineHeight: 20 }}>
                  Chat directly with {counterpartyName}. Keep all order updates in one thread.
                </Text>
                <Pressable
                  disabled={!counterpartyUsername}
                  onPress={openOrderChat}
                  style={{
                    marginTop: 12,
                    borderRadius: 14,
                    paddingVertical: 12,
                    alignItems: "center",
                    justifyContent: "center",
                    flexDirection: "row",
                    gap: 8,
                    backgroundColor: "rgba(124,58,237,0.20)",
                    borderWidth: 1,
                    borderColor: "rgba(124,58,237,0.45)",
                    opacity: counterpartyUsername ? 1 : 0.65,
                  }}
                >
                  <Ionicons name="chatbubble-ellipses-outline" size={16} color="#fff" />
                  <Text style={{ color: "#fff", fontWeight: "900" }}>
                    Open chat with {counterpartyLabel}
                  </Text>
                </Pressable>
                <Text style={{ marginTop: 8, color: "rgba(255,255,255,0.6)", fontSize: 12 }}>
                  {counterpartyHandleHint}
                </Text>
              </Card>
            ) : null}

            {/* Deliverables & Previews (works for digital + physical; message adapts) */}
            <Card title="Deliverables & previews">
              {isBuyer ? (
                <>
                  {!isDigital && previewItems.length === 0 && !hasWebsite ? (
                    <Text style={{ color: "rgba(255,255,255,0.65)", lineHeight: 20 }}>
                      This looks like a physical / non-digital delivery. No previews required. Track delivery using the timeline below.
                    </Text>
                  ) : (
                    <Text style={{ color: "rgba(255,255,255,0.65)", lineHeight: 20 }}>
                      Preview the work (low quality / watermarked). After OTP is verified and marked delivered, full-quality downloads unlock.
                    </Text>
                  )}

                  {hasWebsite ? (
                    <Pressable
                      onPress={() =>
                        openPreview({
                          kind: "link",
                          access: "preview",
                          title: "Website preview",
                          url: String(listing?.website_url ?? ""),
                        })
                      }
                      style={{
                        marginTop: 12,
                        borderRadius: 18,
                        paddingVertical: 14,
                        alignItems: "center",
                        backgroundColor: "rgba(124,58,237,0.20)",
                        borderWidth: 1,
                        borderColor: "rgba(124,58,237,0.35)",
                      }}
                    >
                      <Text style={{ color: "#fff", fontWeight: "900" }}>Open website preview</Text>
                      <Text style={{ marginTop: 4, color: "rgba(255,255,255,0.65)", fontSize: 12 }}>
                        Embedded preview • Watermarked
                      </Text>
                    </Pressable>
                  ) : null}

                  {previewItems.length === 0 ? (
                    <Text style={{ marginTop: 12, color: "rgba(255,255,255,0.60)" }}>No preview files uploaded yet.</Text>
                  ) : (
                    <View style={{ marginTop: 12, gap: 10 }}>
                      {previewItems.map((d) => (
                        <Pressable
                          key={d.id}
                          onPress={() => previewDeliverable(d)}
                          style={{
                            padding: 12,
                            borderRadius: 16,
                            backgroundColor: "rgba(255,255,255,0.06)",
                            borderWidth: 1,
                            borderColor: "rgba(255,255,255,0.10)",
                          }}
                        >
                          <Text style={{ color: "#fff", fontWeight: "900" }}>
                            {d.title ?? `${String(d.kind).toUpperCase()} preview`}
                          </Text>
                          <Text style={{ marginTop: 4, color: "rgba(255,255,255,0.65)", fontSize: 12 }}>
                            Tap to open • Watermarked / low quality recommended
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  )}

                  {canDownloadFinal ? (
                    <View style={{ marginTop: 14 }}>
                      <Text style={{ color: "#fff", fontWeight: "900" }}>Full quality downloads</Text>
                      <Text style={{ marginTop: 4, color: "rgba(255,255,255,0.65)", fontSize: 12 }}>
                        Unlocked (OTP verified + delivered). Download and then release funds when satisfied.
                      </Text>

                      {finalItems.length === 0 ? (
                        <Text style={{ marginTop: 10, color: "rgba(255,255,255,0.60)" }}>
                          Seller has not uploaded full-quality files yet.
                        </Text>
                      ) : (
                        <View style={{ marginTop: 10, gap: 10 }}>
                          {finalItems.map((d) => (
                            <View
                              key={d.id}
                              style={{
                                padding: 12,
                                borderRadius: 16,
                                backgroundColor: "rgba(255,255,255,0.06)",
                                borderWidth: 1,
                                borderColor: "rgba(255,255,255,0.10)",
                              }}
                            >
                              <Text style={{ color: "#fff", fontWeight: "900" }}>
                                {d.title ?? `${String(d.kind).toUpperCase()} full`}
                              </Text>

                              <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
                                <Pressable
                                  onPress={() => previewDeliverable(d)}
                                  style={{
                                    flex: 1,
                                    borderRadius: 14,
                                    paddingVertical: 12,
                                    alignItems: "center",
                                    backgroundColor: "rgba(255,255,255,0.08)",
                                    borderWidth: 1,
                                    borderColor: "rgba(255,255,255,0.10)",
                                  }}
                                >
                                  <Text style={{ color: "#fff", fontWeight: "900" }}>View</Text>
                                </Pressable>

                                <Pressable
                                  onPress={() => downloadDeliverable(d)}
                                  style={{
                                    flex: 1,
                                    borderRadius: 14,
                                    paddingVertical: 12,
                                    alignItems: "center",
                                    backgroundColor: "rgba(16,185,129,0.22)",
                                    borderWidth: 1,
                                    borderColor: "rgba(16,185,129,0.35)",
                                  }}
                                >
                                  <Text style={{ color: "#fff", fontWeight: "900" }}>Download</Text>
                                </Pressable>
                              </View>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  ) : null}
                </>
              ) : null}

              {isSeller ? (
                <View style={{ marginTop: isBuyer ? 16 : 0 }}>
                  <Text style={{ color: "#fff", fontWeight: "900" }}>Seller upload</Text>
                  <Text style={{ marginTop: 4, color: "rgba(255,255,255,0.65)", fontSize: 12 }}>
                    Upload preview (low quality / watermarked) and then full-quality deliverables.
                  </Text>

                  {!!uploadErr ? <Text style={{ marginTop: 10, color: "#FCA5A5", fontWeight: "800" }}>{uploadErr}</Text> : null}

                  <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
                    <Pressable
                      disabled={uploadBusy || !canSellerUpload}
                      onPress={() => pickAndUpload("preview")}
                      style={{
                        flex: 1,
                        borderRadius: 16,
                        paddingVertical: 14,
                        alignItems: "center",
                        backgroundColor: "rgba(124,58,237,0.20)",
                        borderWidth: 1,
                        borderColor: "rgba(124,58,237,0.35)",
                        opacity: uploadBusy || !canSellerUpload ? 0.7 : 1,
                      }}
                    >
                      <Text style={{ color: "#fff", fontWeight: "900" }}>{uploadBusy ? "Uploading…" : "Upload preview"}</Text>
                    </Pressable>

                    <Pressable
                      disabled={uploadBusy || !canSellerUpload}
                      onPress={() => pickAndUpload("final")}
                      style={{
                        flex: 1,
                        borderRadius: 16,
                        paddingVertical: 14,
                        alignItems: "center",
                        backgroundColor: "rgba(16,185,129,0.20)",
                        borderWidth: 1,
                        borderColor: "rgba(16,185,129,0.35)",
                        opacity: uploadBusy || !canSellerUpload ? 0.7 : 1,
                      }}
                    >
                      <Text style={{ color: "#fff", fontWeight: "900" }}>{uploadBusy ? "Uploading…" : "Upload full"}</Text>
                    </Pressable>
                  </View>

                  {!canSellerUpload ? (
                    <Text style={{ marginTop: 10, color: "rgba(255,255,255,0.6)", fontSize: 12 }}>
                      Upload is available when order is IN_ESCROW, OUT_FOR_DELIVERY, or DELIVERABLE_UPLOADED.
                    </Text>
                  ) : null}

                  {deliverables.length ? (
                    <Text style={{ marginTop: 10, color: "rgba(255,255,255,0.60)", fontSize: 12 }}>
                      Uploaded: {previewItems.length} preview • {finalItems.length} full
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </Card>

            {/* Buyer checkout */}
            {canGoCheckout ? (
              <>
                {isBuyer && seller?.market_username ? (
                  <Pressable
                    onPress={() =>
                      router.push({
                        pathname: "/market/dm/[username]" as any,
                        params: { username: seller.market_username },
                      })
                    }
                    style={{
                      marginTop: 12,
                      borderRadius: 18,
                      paddingVertical: 14,
                      alignItems: "center",
                      backgroundColor: "rgba(124,58,237,0.20)",
                      borderWidth: 1,
                      borderColor: "rgba(124,58,237,0.45)",
                      flexDirection: "row",
                      gap: 8,
                      justifyContent: "center",
                    }}
                  >
                    <Text style={{ color: "#fff", fontWeight: "900" }}>Message seller</Text>
                    <Text style={{ color: "rgba(255,255,255,0.65)", fontSize: 12 }}>Ask questions before you pay</Text>
                  </Pressable>
                ) : null}

                <Pressable
                  onPress={() => router.push(`/market/checkout/${order.id}` as any)}
                  style={{
                    marginTop: 12,
                    borderRadius: 22,
                    paddingVertical: 16,
                    alignItems: "center",
                    backgroundColor: PURPLE,
                    borderWidth: 1,
                    borderColor: PURPLE,
                  }}
                >
                  <Text style={{ color: "#fff", fontWeight: "900", fontSize: 16 }}>Continue to checkout</Text>
                  <Text style={{ marginTop: 4, color: "rgba(255,255,255,0.8)", fontWeight: "800", fontSize: 12 }}>
                    Choose NGN wallet, USDC/USDT, or PI
                  </Text>
                </Pressable>
              </>
            ) : null}

            {canCancel ? (
              <Pressable
                disabled={busy}
                onPress={cancelOrder}
                style={{
                  marginTop: 10,
                  borderRadius: 18,
                  paddingVertical: 14,
                  alignItems: "center",
                  backgroundColor: "rgba(239,68,68,0.12)",
                  borderWidth: 1,
                  borderColor: "rgba(239,68,68,0.25)",
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "900" }}>{busy ? "Working…" : "Cancel order"}</Text>
              </Pressable>
            ) : null}

            {!!err ? (
              <View style={{ marginTop: 10 }}>
                <Text style={{ color: "#FCA5A5", fontWeight: "800" }}>{err}</Text>
              </View>
            ) : null}

            <MarketPolicyPanel
              title="Progress"
              blocks={orderPolicy.progress}
              emptyText={orderPolicyLoading ? "Loading live policy..." : "Policy will appear here."}
            />
            <MarketPolicyPanel
              title="Safety and complaints"
              blocks={orderPolicy.safety}
              emptyText={orderPolicyLoading ? "Loading live policy..." : "Policy will appear here."}
              onAction={(action) => {
                void onPolicyAction(action);
              }}
            />

            {/* Crypto intents */}
            <Card title="Crypto activity (USDC / USDT / PI)">
              {intents.length === 0 ? (
                <Text style={{ color: "rgba(255,255,255,0.65)" }}>No crypto intents yet.</Text>
              ) : (
                <View style={{ gap: 10 }}>
                  {intents.slice(0, 4).map((i) => (
                    <View
                      key={i.id}
                      style={{
                        padding: 12,
                        borderRadius: 16,
                        backgroundColor: "rgba(255,255,255,0.06)",
                        borderWidth: 1,
                        borderColor: "rgba(255,255,255,0.10)",
                      }}
                    >
                      <Text style={{ color: "#fff", fontWeight: "900" }}>
                        {i.intent_type} • {String(i.chain).toUpperCase()}
                      </Text>
                      <Text style={{ marginTop: 4, color: "rgba(255,255,255,0.65)", fontSize: 12 }}>
                        Status: {i.status}
                        {i.tx_hash ? ` • tx: ${i.tx_hash.slice(0, 10)}…` : ""}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </Card>

            {/* Seller actions */}
            {isSeller ? (
              <Card title="Seller actions">
                <Pressable
                  disabled={!canOutForDelivery || busy}
                  onPress={doOutForDelivery}
                  style={{
                    marginTop: 12,
                    borderRadius: 18,
                    paddingVertical: 14,
                    alignItems: "center",
                    backgroundColor: canOutForDelivery && !busy ? PURPLE : "rgba(124,58,237,0.35)",
                    borderWidth: 1,
                    borderColor: canOutForDelivery && !busy ? PURPLE : "rgba(124,58,237,0.35)",
                  }}
                >
                  <Text style={{ color: "#fff", fontWeight: "900" }}>{busy ? "Working…" : "Mark out for delivery"}</Text>
                </Pressable>

                {otpVerified ? (
                  <View
                    style={{
                      marginTop: 14,
                      borderRadius: 14,
                      padding: 12,
                      backgroundColor: "rgba(16,185,129,0.14)",
                      borderWidth: 1,
                      borderColor: "rgba(16,185,129,0.35)",
                    }}
                  >
                    <Text style={{ color: "#fff", fontWeight: "900" }}>OTP verified</Text>
                    <Text style={{ marginTop: 4, color: "rgba(255,255,255,0.72)", fontSize: 12 }}>
                      OTP verification is complete. Ask buyer to release funds.
                    </Text>
                  </View>
                ) : (
                  <View style={{ marginTop: 14 }}>
                    <Text style={{ color: "#fff", fontWeight: "900" }}>Enter OTP</Text>
                  <Text style={{ marginTop: 4, color: "rgba(255,255,255,0.6)", fontSize: 12 }}>
                    Buyer provides OTP to complete server verification.
                  </Text>

                  <View
                    style={{
                      marginTop: 10,
                      borderRadius: 18,
                      paddingHorizontal: 14,
                      paddingVertical: 12,
                      borderWidth: 1,
                      borderColor: "rgba(255,255,255,0.10)",
                      backgroundColor: "rgba(255,255,255,0.06)",
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <Ionicons name="key-outline" size={18} color="rgba(255,255,255,0.75)" />
                    <TextInput
                      value={otpInput}
                      onChangeText={setOtpInput}
                      placeholder="Enter OTP"
                      placeholderTextColor="rgba(255,255,255,0.45)"
                      style={{ flex: 1, color: "#fff", fontWeight: "900" }}
                      keyboardType="number-pad"
                    />
                  </View>

                  <Pressable
                    disabled={!canVerifyOtp || busy}
                    onPress={verifyOTP}
                    style={{
                      marginTop: 10,
                      borderRadius: 18,
                      paddingVertical: 14,
                      alignItems: "center",
                      backgroundColor: canVerifyOtp && !busy ? "rgba(16,185,129,0.25)" : "rgba(255,255,255,0.06)",
                      borderWidth: 1,
                      borderColor: canVerifyOtp && !busy ? "rgba(16,185,129,0.40)" : "rgba(255,255,255,0.10)",
                    }}
                  >
                    <Text style={{ color: "#fff", fontWeight: "900" }}>{otpVerified ? "OTP verified ✅" : busy ? "Verifying…" : "Verify OTP"}</Text>
                  </Pressable>

                  {otp ? (
                    <Text style={{ marginTop: 10, color: "rgba(255,255,255,0.65)", fontSize: 12 }}>
                      OTP status: {otp.verified_at ? "Verified" : "Pending"} • attempts: {otp.attempts}
                    </Text>
                  ) : (
                    <Text style={{ marginTop: 10, color: "rgba(255,255,255,0.65)", fontSize: 12 }}>OTP not created yet.</Text>
                  )}
                  </View>
                )}

                <Pressable
                  disabled={busy}
                  onPress={openDispute}
                  style={{
                    marginTop: 10,
                    borderRadius: 18,
                    paddingVertical: 14,
                    alignItems: "center",
                    backgroundColor: "rgba(239,68,68,0.12)",
                    borderWidth: 1,
                    borderColor: "rgba(239,68,68,0.25)",
                  }}
                >
                  <Text style={{ color: "#fff", fontWeight: "900" }}>{busy ? "Working…" : "Report issue / open complaint"}</Text>
                </Pressable>
              </Card>
            ) : null}

            {/* Buyer actions */}
            {isBuyer ? (
              <Card title="Buyer actions">
                <Pressable
                  disabled={!canGenerateOtpNow}
                  onPress={requestOTP}
                  style={{
                    marginTop: 12,
                    borderRadius: 18,
                    paddingVertical: 14,
                    alignItems: "center",
                    backgroundColor: canGenerateOtpNow ? "rgba(59,130,246,0.22)" : "rgba(255,255,255,0.06)",
                    borderWidth: 1,
                    borderColor: canGenerateOtpNow ? "rgba(59,130,246,0.35)" : "rgba(255,255,255,0.10)",
                  }}
                >
                  <Text style={{ color: "#fff", fontWeight: "900" }}>{busy ? "Working…" : "Generate delivery OTP"}</Text>
                </Pressable>

                {generatedOtpCode && !otpVerified ? (
                  <View
                    style={{
                      marginTop: 10,
                      borderRadius: 14,
                      padding: 12,
                      backgroundColor: "rgba(124,58,237,0.12)",
                      borderWidth: 1,
                      borderColor: "rgba(124,58,237,0.35)",
                    }}
                  >
                    <Text style={{ color: "rgba(255,255,255,0.75)", fontWeight: "800", fontSize: 12 }}>
                      Your OTP code
                    </Text>
                    <Text style={{ marginTop: 6, color: "#fff", fontWeight: "900", fontSize: 24, letterSpacing: 3 }}>
                      {generatedOtpCode}
                    </Text>
                    <Pressable
                      onPress={async () => {
                        await Clipboard.setStringAsync(generatedOtpCode);
                        Alert.alert("Copied", "OTP copied to clipboard");
                      }}
                      style={{
                        marginTop: 8,
                        alignSelf: "flex-start",
                        paddingVertical: 8,
                        paddingHorizontal: 10,
                        borderRadius: 10,
                        backgroundColor: "rgba(255,255,255,0.10)",
                        borderWidth: 1,
                        borderColor: "rgba(255,255,255,0.16)",
                      }}
                    >
                      <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }}>Copy OTP</Text>
                    </Pressable>
                  </View>
                ) : null}

                <Pressable
                  disabled={!canRelease || busy}
                  onPress={releaseFunds}
                  style={{
                    marginTop: 10,
                    borderRadius: 18,
                    paddingVertical: 14,
                    alignItems: "center",
                    backgroundColor: canRelease && !busy ? "rgba(16,185,129,0.25)" : "rgba(16,185,129,0.10)",
                    borderWidth: 1,
                    borderColor: canRelease && !busy ? "rgba(16,185,129,0.40)" : "rgba(16,185,129,0.18)",
                    opacity: canRelease ? 1 : 0.7,
                  }}
                >
                  <Text style={{ color: "#fff", fontWeight: "900" }}>{busy ? "Releasing…" : "Release funds to seller"}</Text>
                  <Text style={{ marginTop: 4, color: "rgba(255,255,255,0.8)", fontWeight: "800", fontSize: 12 }}>
                    Requires OTP verified
                  </Text>
                </Pressable>

                <Pressable
                  disabled={busy}
                  onPress={openDispute}
                  style={{
                    marginTop: 10,
                    borderRadius: 18,
                    paddingVertical: 14,
                    alignItems: "center",
                    backgroundColor: "rgba(239,68,68,0.12)",
                    borderWidth: 1,
                    borderColor: "rgba(239,68,68,0.25)",
                  }}
                >
                  <Text style={{ color: "#fff", fontWeight: "900" }}>{busy ? "Working…" : "Report issue / request refund"}</Text>
                </Pressable>

                {otp ? (
                  <Text style={{ marginTop: 10, color: "rgba(255,255,255,0.65)", fontSize: 12 }}>
                    OTP status: {otp.verified_at ? "Verified ✅" : "Pending"} • expires: {new Date(otp.expires_at).toLocaleString()}
                  </Text>
                ) : null}
              </Card>
            ) : null}

            <Pressable
              onPress={load}
              disabled={busy}
              style={{
                marginTop: 14,
                borderRadius: 22,
                paddingVertical: 14,
                alignItems: "center",
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.14)",
                backgroundColor: "rgba(255,255,255,0.06)",
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "900" }}>Refresh</Text>
            </Pressable>
          </>
        )}
      </ScrollView>

      <Modal visible={reindexOpen} transparent animationType="slide" onRequestClose={() => setReindexOpen(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", padding: 20 }}>
          <View style={{ borderRadius: 20, padding: 16, backgroundColor: "#0F0B1D", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)" }}>
            <Text style={{ color: "#fff", fontWeight: "900", fontSize: 16 }}>Resync deposit</Text>
            <Text style={{ marginTop: 6, color: "rgba(255,255,255,0.65)", fontSize: 12 }}>
              Paste the deposit transaction hash (or UserOp hash) to force a resync.
            </Text>
            <TextInput
              value={reindexTx}
              onChangeText={setReindexTx}
              placeholder="0x..."
              placeholderTextColor="rgba(255,255,255,0.45)"
              autoCapitalize="none"
              style={{
                marginTop: 12,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.12)",
                color: "#fff",
                paddingHorizontal: 12,
                paddingVertical: 10,
              }}
            />
            <View style={{ marginTop: 14, flexDirection: "row", gap: 10 }}>
              <Pressable
                onPress={() => setReindexOpen(false)}
                style={{ flex: 1, borderRadius: 14, paddingVertical: 12, alignItems: "center", backgroundColor: "rgba(255,255,255,0.08)" }}
              >
                <Text style={{ color: "#fff", fontWeight: "900" }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={reindexDeposit}
                disabled={busy}
                style={{ flex: 1, borderRadius: 14, paddingVertical: 12, alignItems: "center", backgroundColor: "rgba(124,58,237,0.30)" }}
              >
                <Text style={{ color: "#fff", fontWeight: "900" }}>{busy ? "Working..." : "Resync"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <OrderPreviewModal
        open={previewOpen}
        onClose={() => {
          setPreviewOpen(false);
          setPreviewPayload(null);
        }}
        payload={previewPayload}
      />
    </LinearGradient>
  );
}
