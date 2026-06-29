import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import MarketPolicyPanel from "@/components/policies/MarketPolicyPanel";
import { useMarketPolicyBlocks } from "@/hooks/policy/useMarketPolicyBlocks";
import { requireLocalAuth } from "@/utils/secureAuth";
import { supabase } from "@/services/supabase";
import { releaseUsdcForOrder } from "@/services/market/usdcCheckout";
import { releasePiForOrder } from "@/services/market/piCheckout";
import { generateOrderAiRisk, type MarketOrderAiRiskResult } from "@/services/market/ai";
import { friendlyMarketError } from "@/utils/marketUx";
import { OrderPreviewModal, PreviewPayload } from "@/components/market/OrderPreviewModal";
import {
  listOrderDeliverables,
  signedUrlForDeliverable,
  OrderDeliverable,
  insertFileDeliverable,
  guessKindFromMime,
} from "@/services/market/orderDeliverables";
import {
  fetchOrderDispute,
  openOrderDispute,
  sendDisputeMessage,
  type DisputeLocalFile,
  type DisputeMessage,
  type MarketDispute,
} from "@/services/market/disputes";
import { uploadToSupabaseStorage } from "@/services/market/storageUpload";

// ─── Brand Color Tokens ────────────────────────────────────────────────────────
const BG0 = "#060807";
const BG1 = "#10130E";
const BG2 = "#171A13";
const AMBER = "#F4B75D";
const TEAL = "#2DD4BF";
const BLUE = "#38BDF8";
const ROSE = "#FB7185";
const PURPLE = "#8B5CF6";
const GREEN = "#10B981";
const CARD = "rgba(255,253,247,0.065)";
const CARD_RAISED = "rgba(255,253,247,0.09)";
const BORDER = "rgba(255,253,247,0.12)";
const BORDER_TOP = "rgba(255,253,247,0.24)";
const TEXT = "#FFFDF7";
const MUTED = "rgba(255,253,247,0.68)";
const FAINT = "rgba(255,253,247,0.44)";

const AMBER_GLASS = "rgba(244,183,93,0.13)";
const AMBER_BORDER = "rgba(244,183,93,0.42)";
const TEAL_GLASS = "rgba(45,212,191,0.12)";
const TEAL_BORDER = "rgba(45,212,191,0.35)";
const GREEN_GLASS = "rgba(16,185,129,0.15)";
const GREEN_BORDER = "rgba(16,185,129,0.45)";
const RED_GLASS = "rgba(239,68,68,0.15)";
const RED_BORDER = "rgba(239,68,68,0.45)";
const PURPLE_GLASS = "rgba(139,92,246,0.15)";
const PURPLE_BORDER = "rgba(139,92,246,0.42)";
const BLUE_GLASS = "rgba(56,189,248,0.12)";
const BLUE_BORDER = "rgba(56,189,248,0.35)";

// ─── Constants ────────────────────────────────────────────────────────────────
const RPC_SELLER_OUT_FOR_DELIVERY = "market_seller_out_for_delivery_rpc";
const RPC_OTP_GENERATE = "market_otp_generate_rpc";
const RPC_OTP_VERIFY = "market_otp_verify_rpc";
const RPC_RELEASE_ESCROW = "market_release_escrow_rpc";
const RPC_BUYER_CANCEL = "market_buyer_cancel_order_rpc";
const RPC_CHAIN_TX_FINALIZE = "market_chain_tx_finalize_rpc";
const ORDERS_TABLE = "market_orders";
const LISTINGS_TABLE = "market_listings";
const SELLERS_TABLE = "market_seller_profiles";
const OTP_TABLE = "market_order_otps";
const CRYPTO_INTENTS_TABLE = "market_crypto_intents";
const OTP_REQUEST_COOLDOWN_SEC = 30;

// ─── Types ────────────────────────────────────────────────────────────────────
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

type PiPaymentRow = {
  id: string;
  status: string;
  quote_ref: string;
  payment_id: string | null;
  txid: string | null;
  quote_expires_at: string | null;
  topup_pi_required: number | null;
  shortfall_usd: number | null;
  updated_at: string | null;
  created_at: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
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

function fmtCountdown(totalSec: number) {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
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

// ─── Reusable UI Atoms ────────────────────────────────────────────────────────

function SectionLabel({ text, color = AMBER }: { text: string; color?: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <View style={{ width: 3, height: 14, borderRadius: 2, backgroundColor: color }} />
      <Text style={{ color, fontWeight: "900", fontSize: 11, letterSpacing: 1.2 }}>
        {text.toUpperCase()}
      </Text>
    </View>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    CREATED: { bg: CARD_RAISED, fg: MUTED, label: "Created" },
    IN_ESCROW: { bg: AMBER_GLASS, fg: AMBER, label: "In Escrow" },
    OUT_FOR_DELIVERY: { bg: BLUE_GLASS, fg: BLUE, label: "Out for Delivery" },
    DELIVERED: { bg: GREEN_GLASS, fg: TEAL, label: "Delivered" },
    RELEASED: { bg: GREEN_GLASS, fg: "#34D399", label: "Released" },
    REFUNDED: { bg: RED_GLASS, fg: ROSE, label: "Refunded" },
    CANCELLED: { bg: RED_GLASS, fg: ROSE, label: "Cancelled" },
    DISPUTED: { bg: "rgba(239,68,68,0.12)", fg: ROSE, label: "Disputed" },
    DELIVERABLE_UPLOADED: { bg: TEAL_GLASS, fg: TEAL, label: "Files Uploaded" },
  };
  const s = map[status] ?? { bg: CARD_RAISED, fg: MUTED, label: status };
  return (
    <View
      style={{
        alignSelf: "flex-start",
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 999,
        backgroundColor: s.bg,
        borderWidth: 1,
        borderColor: `${s.fg}55`,
      }}
    >
      <Text style={{ color: s.fg, fontWeight: "900", fontSize: 11, letterSpacing: 0.4 }}>
        {s.label}
      </Text>
    </View>
  );
}

function PanelCard({
  children,
  accent,
  style,
}: {
  children: React.ReactNode;
  accent?: "amber" | "teal" | "green" | "red" | "purple" | "blue";
  style?: any;
}) {
  const borderColors: Record<string, string> = {
    amber: AMBER_BORDER,
    teal: TEAL_BORDER,
    green: GREEN_BORDER,
    red: RED_BORDER,
    purple: PURPLE_BORDER,
    blue: BLUE_BORDER,
  };
  const bgColors: Record<string, string> = {
    amber: AMBER_GLASS,
    teal: TEAL_GLASS,
    green: GREEN_GLASS,
    red: RED_GLASS,
    purple: PURPLE_GLASS,
    blue: BLUE_GLASS,
  };
  return (
    <View
      style={[
        {
          borderRadius: 22,
          padding: 18,
          backgroundColor: accent ? bgColors[accent] : CARD,
          borderWidth: 1,
          borderColor: accent ? borderColors[accent] : BORDER,
          borderTopColor: accent ? borderColors[accent] : BORDER_TOP,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

function ActionBtn({
  label,
  sublabel,
  onPress,
  disabled,
  busy,
  color = "amber",
  icon,
}: {
  label: string;
  sublabel?: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  color?: "amber" | "teal" | "green" | "red" | "purple" | "blue" | "ghost";
  icon?: string;
}) {
  const bgMap: Record<string, string> = {
    amber: AMBER,
    teal: TEAL,
    green: GREEN,
    red: "#EF4444",
    purple: PURPLE,
    blue: BLUE,
    ghost: CARD_RAISED,
  };
  const isLight = ["amber", "teal", "green", "blue"].includes(color);
  const textColor = color === "ghost" ? TEXT : isLight ? BG0 : "#fff";
  const bg = disabled ? "rgba(255,253,247,0.07)" : bgMap[color];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={{
        borderRadius: 18,
        paddingVertical: 15,
        paddingHorizontal: 18,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: bg,
        borderWidth: 1,
        borderColor: disabled ? BORDER : bg,
        opacity: disabled ? 0.65 : 1,
        flexDirection: "row",
        gap: 8,
      }}
    >
      {busy ? (
        <ActivityIndicator color={textColor} size="small" />
      ) : icon ? (
        <Ionicons name={icon as any} size={16} color={textColor} />
      ) : null}
      <View style={{ alignItems: "center" }}>
        <Text style={{ color: textColor, fontWeight: "900", fontSize: 15 }}>{label}</Text>
        {sublabel ? (
          <Text style={{ color: `${textColor}99`, fontWeight: "700", fontSize: 11, marginTop: 2 }}>
            {sublabel}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function OutlineBtn({
  label,
  onPress,
  disabled,
  busy,
  color = "amber",
  icon,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  color?: "amber" | "teal" | "green" | "red" | "purple" | "blue" | "ghost";
  icon?: string;
}) {
  const fgMap: Record<string, string> = {
    amber: AMBER,
    teal: TEAL,
    green: "#34D399",
    red: ROSE,
    purple: "#A78BFA",
    blue: BLUE,
    ghost: MUTED,
  };
  const borderMap: Record<string, string> = {
    amber: AMBER_BORDER,
    teal: TEAL_BORDER,
    green: GREEN_BORDER,
    red: RED_BORDER,
    purple: PURPLE_BORDER,
    blue: BLUE_BORDER,
    ghost: BORDER,
  };
  const bgMap: Record<string, string> = {
    amber: AMBER_GLASS,
    teal: TEAL_GLASS,
    green: GREEN_GLASS,
    red: RED_GLASS,
    purple: PURPLE_GLASS,
    blue: BLUE_GLASS,
    ghost: CARD_RAISED,
  };
  const fg = fgMap[color];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={{
        borderRadius: 16,
        paddingVertical: 12,
        paddingHorizontal: 14,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 8,
        backgroundColor: bgMap[color],
        borderWidth: 1,
        borderColor: borderMap[color],
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {busy ? (
        <ActivityIndicator color={fg} size="small" />
      ) : icon ? (
        <Ionicons name={icon as any} size={15} color={fg} />
      ) : null}
      <Text style={{ color: fg, fontWeight: "800", fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

function ErrBanner({ message }: { message: string }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        padding: 13,
        borderRadius: 14,
        backgroundColor: RED_GLASS,
        borderWidth: 1,
        borderColor: RED_BORDER,
      }}
    >
      <Ionicons name="alert-circle-outline" size={16} color={ROSE} />
      <Text style={{ color: ROSE, fontWeight: "700", fontSize: 13, flex: 1, lineHeight: 18 }}>
        {message}
      </Text>
    </View>
  );
}

// ─── Order Status Timeline ─────────────────────────────────────────────────────
function OrderStatusTimeline({ order }: { order: OrderRow }) {
  const steps = [
    { key: "CREATED", label: "Order Created", icon: "receipt-outline", time: order.created_at },
    { key: "IN_ESCROW", label: "Payment in Escrow", icon: "lock-closed-outline", time: order.in_escrow_at },
    { key: "OUT_FOR_DELIVERY", label: "Out for Delivery", icon: "bicycle-outline", time: order.out_for_delivery_at },
    { key: "DELIVERED", label: "Delivered", icon: "checkmark-circle-outline", time: order.delivered_at },
    { key: "RELEASED", label: "Funds Released", icon: "shield-checkmark-outline", time: order.released_at },
  ];
  const refundedOrCancelled =
    order.status === "REFUNDED" || order.status === "CANCELLED";

  const statusOrder = ["CREATED", "IN_ESCROW", "OUT_FOR_DELIVERY", "DELIVERED", "RELEASED"];
  const currentIdx = statusOrder.indexOf(order.status);

  return (
    <View style={{ gap: 0 }}>
      {steps.map((step, idx) => {
        const isActive = statusOrder.indexOf(step.key) <= currentIdx;
        const isCurrent = step.key === order.status;
        const isLast = idx === steps.length - 1;

        let dotColor = FAINT;
        let lineColor = "rgba(255,253,247,0.08)";
        if (isActive && !refundedOrCancelled) {
          dotColor = isCurrent ? AMBER : TEAL;
          lineColor = idx < currentIdx ? "rgba(45,212,191,0.4)" : "rgba(255,253,247,0.08)";
        }

        return (
          <View key={step.key} style={{ flexDirection: "row", gap: 12 }}>
            {/* Spine */}
            <View style={{ alignItems: "center", width: 28 }}>
              <View
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 10,
                  backgroundColor: isActive && !refundedOrCancelled ? (isCurrent ? AMBER_GLASS : TEAL_GLASS) : CARD,
                  borderWidth: 1.5,
                  borderColor: dotColor,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons
                  name={step.icon as any}
                  size={13}
                  color={isActive && !refundedOrCancelled ? dotColor : FAINT}
                />
              </View>
              {!isLast && (
                <View
                  style={{
                    width: 1.5,
                    flex: 1,
                    minHeight: 20,
                    backgroundColor: lineColor,
                    marginVertical: 2,
                  }}
                />
              )}
            </View>

            {/* Content */}
            <View style={{ flex: 1, paddingBottom: isLast ? 0 : 14, paddingTop: 4 }}>
              <Text
                style={{
                  color: isActive && !refundedOrCancelled ? (isCurrent ? AMBER : TEXT) : FAINT,
                  fontWeight: isCurrent ? "900" : "700",
                  fontSize: 13,
                }}
              >
                {step.label}
              </Text>
              {step.time ? (
                <Text style={{ color: FAINT, fontSize: 11, marginTop: 2 }}>
                  {new Date(step.time).toLocaleString()}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}

      {refundedOrCancelled && (
        <View style={{ flexDirection: "row", gap: 12 }}>
          <View style={{ alignItems: "center", width: 28 }}>
            <View
              style={{
                width: 28,
                height: 28,
                borderRadius: 10,
                backgroundColor: RED_GLASS,
                borderWidth: 1.5,
                borderColor: ROSE,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="close-outline" size={13} color={ROSE} />
            </View>
          </View>
          <View style={{ flex: 1, paddingTop: 4 }}>
            <Text style={{ color: ROSE, fontWeight: "900", fontSize: 13 }}>
              {order.status === "REFUNDED" ? "Refunded" : "Cancelled"}
            </Text>
            {(order.refunded_at || order.cancelled_at) && (
              <Text style={{ color: FAINT, fontSize: 11, marginTop: 2 }}>
                {new Date(
                  (order.refunded_at || order.cancelled_at) as string,
                ).toLocaleString()}
              </Text>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

// ─── Order Summary Panel ───────────────────────────────────────────────────────
function OrderSummaryPanel({
  order,
  listing,
  seller,
  isBuyer,
  isSeller,
}: {
  order: OrderRow;
  listing: ListingRow | null;
  seller: SellerRow | null;
  isBuyer: boolean;
  isSeller: boolean;
}) {
  return (
    <PanelCard>
      <SectionLabel text="Order Summary" />
      <View style={{ marginTop: 14, gap: 12 }}>
        {/* Listing */}
        <View>
          <Text style={{ color: FAINT, fontSize: 11, fontWeight: "700", letterSpacing: 0.5 }}>
            ITEM
          </Text>
          <Text style={{ color: TEXT, fontWeight: "900", fontSize: 16, marginTop: 3 }}>
            {listing?.title ?? "Listing"}
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
            {listing?.category ? (
              <View
                style={{
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                  borderRadius: 999,
                  backgroundColor: CARD_RAISED,
                  borderWidth: 1,
                  borderColor: BORDER,
                }}
              >
                <Text style={{ color: MUTED, fontSize: 11, fontWeight: "700" }}>
                  {listing.category}
                </Text>
              </View>
            ) : null}
            {listing?.delivery_type ? (
              <View
                style={{
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                  borderRadius: 999,
                  backgroundColor: CARD_RAISED,
                  borderWidth: 1,
                  borderColor: BORDER,
                }}
              >
                <Text style={{ color: MUTED, fontSize: 11, fontWeight: "700" }}>
                  {listing.delivery_type}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Divider */}
        <View style={{ height: 1, backgroundColor: BORDER }} />

        {/* Amount */}
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
          <View>
            <Text style={{ color: FAINT, fontSize: 11, fontWeight: "700", letterSpacing: 0.5 }}>
              AMOUNT
            </Text>
            <Text style={{ color: AMBER, fontWeight: "900", fontSize: 26, marginTop: 3, letterSpacing: -0.5 }}>
              {money(order.currency, order.amount)}
            </Text>
            <Text style={{ color: MUTED, fontSize: 12, marginTop: 2 }}>
              {order.currency} · Qty {order.quantity}
            </Text>
          </View>
          <StatusBadge status={order.status} />
        </View>

        {/* Divider */}
        <View style={{ height: 1, backgroundColor: BORDER }} />

        {/* Seller info (shown to buyer) */}
        {isBuyer && seller ? (
          <View>
            <Text style={{ color: FAINT, fontSize: 11, fontWeight: "700", letterSpacing: 0.5 }}>
              SELLER
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 5 }}>
              <Text style={{ color: TEXT, fontWeight: "800", fontSize: 13 }}>
                {seller.business_name || seller.display_name || "Seller"}
              </Text>
              {seller.is_verified ? (
                <Ionicons name="checkmark-circle" size={14} color={BLUE} />
              ) : null}
            </View>
            <Text style={{ color: MUTED, fontSize: 12, marginTop: 2 }}>
              @{seller.market_username || "seller"}
            </Text>
          </View>
        ) : null}

        {/* Order ID */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ color: FAINT, fontSize: 11, flex: 1 }} numberOfLines={1}>
            ID: {order.id}
          </Text>
          <Pressable
            onPress={async () => {
              await Clipboard.setStringAsync(order.id);
              Alert.alert("Copied", "Order ID copied to clipboard.");
            }}
            style={{
              paddingHorizontal: 8,
              paddingVertical: 4,
              borderRadius: 8,
              backgroundColor: AMBER_GLASS,
              borderWidth: 1,
              borderColor: AMBER_BORDER,
            }}
          >
            <Text style={{ color: AMBER, fontWeight: "900", fontSize: 10 }}>COPY</Text>
          </Pressable>
        </View>
      </View>
    </PanelCard>
  );
}

// ─── Counterparty Panel ────────────────────────────────────────────────────────
function CounterpartyPanel({
  isBuyer,
  isSeller,
  seller,
  buyerProfile,
  order,
  counterpartyUsername,
  counterpartyName,
  counterpartyLabel,
  counterpartyHandleHint,
  canOrderChat,
  onChat,
}: {
  isBuyer: boolean;
  isSeller: boolean;
  seller: SellerRow | null;
  buyerProfile: BuyerProfileRow | null;
  order: OrderRow;
  counterpartyUsername: string | null;
  counterpartyName: string;
  counterpartyLabel: string;
  counterpartyHandleHint: string;
  canOrderChat: boolean;
  onChat: () => void;
}) {
  const hasDeliveryGeo = !!(order as any)?.delivery_address?.geo;
  const contact = (order as any)?.buyer_contact;
  const deliveryContact = (order as any)?.delivery_address?.contact;
  const phoneVal = contact?.phone || deliveryContact?.phone;
  const emailVal = contact?.email || deliveryContact?.email;
  const nameVal = contact?.name || deliveryContact?.name;
  const noteVal = contact?.note || deliveryContact?.note;

  return (
    <PanelCard>
      <SectionLabel text={isBuyer ? "Seller" : "Buyer"} color={TEAL} />
      <View style={{ marginTop: 14, gap: 12 }}>
        {/* Identity row */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            padding: 12,
            borderRadius: 16,
            backgroundColor: CARD_RAISED,
            borderWidth: 1,
            borderColor: BORDER,
          }}
        >
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 14,
              backgroundColor: TEAL_GLASS,
              borderWidth: 1,
              borderColor: TEAL_BORDER,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons
              name={isBuyer ? "storefront-outline" : "person-outline"}
              size={20}
              color={TEAL}
            />
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <Text style={{ color: TEXT, fontWeight: "900", fontSize: 14 }}>
                {counterpartyName}
              </Text>
              {isBuyer && seller?.is_verified ? (
                <Ionicons name="checkmark-circle" size={14} color={BLUE} />
              ) : null}
            </View>
            <Text style={{ color: MUTED, fontSize: 12, marginTop: 1 }}>
              {counterpartyHandleHint}
            </Text>
          </View>
          {canOrderChat ? (
            <Pressable
              onPress={onChat}
              style={{
                width: 36,
                height: 36,
                borderRadius: 11,
                backgroundColor: TEAL_GLASS,
                borderWidth: 1,
                borderColor: TEAL_BORDER,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="chatbubble-ellipses-outline" size={16} color={TEAL} />
            </Pressable>
          ) : null}
        </View>

        {/* Buyer contact (seller only) */}
        {isSeller && (nameVal || phoneVal || emailVal) ? (
          <View style={{ gap: 6, padding: 12, borderRadius: 14, backgroundColor: CARD_RAISED, borderWidth: 1, borderColor: BORDER }}>
            <Text style={{ color: FAINT, fontSize: 11, fontWeight: "700", letterSpacing: 0.5 }}>
              CONTACT DETAILS
            </Text>
            {nameVal ? <Text style={{ color: TEXT, fontWeight: "800", fontSize: 13 }}>{nameVal}</Text> : null}
            {phoneVal ? (
              <Text style={{ color: MUTED, fontSize: 13 }}>📞 {phoneVal}</Text>
            ) : null}
            {emailVal ? (
              <Text style={{ color: MUTED, fontSize: 13 }}>✉️ {emailVal}</Text>
            ) : null}
            {noteVal ? (
              <Text style={{ color: FAINT, fontSize: 12, lineHeight: 18 }}>Note: {noteVal}</Text>
            ) : null}
          </View>
        ) : null}

        {/* Delivery geo */}
        {hasDeliveryGeo ? (
          <View style={{ gap: 6 }}>
            <Text style={{ color: FAINT, fontSize: 11, fontWeight: "700", letterSpacing: 0.5 }}>
              {isSeller ? "DELIVERY LOCATION" : "YOUR LOCATION"}
            </Text>
            <Text style={{ color: TEXT, fontWeight: "800", fontSize: 13 }}>
              {(order as any).delivery_address?.geo?.label || "Location set"}
            </Text>
            <Text style={{ color: MUTED, fontSize: 12 }}>
              {(order as any).delivery_address?.geo?.city || "–"},{" "}
              {(order as any).delivery_address?.geo?.region || "–"},{" "}
              {(order as any).delivery_address?.geo?.country || "–"}
            </Text>
            {Number.isFinite(Number((order as any).delivery_address?.geo?.lat)) &&
            Number.isFinite(Number((order as any).delivery_address?.geo?.lng)) ? (
              <OutlineBtn
                label="Open in Maps"
                icon="map-outline"
                color="teal"
                onPress={() =>
                  Linking.openURL(
                    `https://maps.google.com/?q=${(order as any).delivery_address.geo.lat},${(order as any).delivery_address.geo.lng}`,
                  )
                }
              />
            ) : null}
          </View>
        ) : null}

        {/* Chat CTA */}
        {canOrderChat ? (
          <ActionBtn
            label={`Message ${counterpartyLabel}`}
            icon="chatbubble-ellipses-outline"
            color="teal"
            onPress={onChat}
            disabled={!counterpartyUsername}
          />
        ) : null}
      </View>
    </PanelCard>
  );
}

// ─── Crypto Activity Panel ─────────────────────────────────────────────────────
function CryptoActivityPanel({
  intents,
  piPayment,
  order,
  isBuyer,
  awaitingConfirmations,
  canResyncDeposit,
  pollRemainingSec,
  defaultDepositTx,
  defaultDepositRef,
  defaultDepositHash,
  busy,
  onResyncDeposit,
  onOpenResync,
}: {
  intents: CryptoIntent[];
  piPayment: PiPaymentRow | null;
  order: OrderRow;
  isBuyer: boolean;
  awaitingConfirmations: boolean;
  canResyncDeposit: boolean;
  pollRemainingSec: number;
  defaultDepositTx: string;
  defaultDepositRef: string;
  defaultDepositHash: string;
  busy: boolean;
  onResyncDeposit: () => void;
  onOpenResync: () => void;
}) {
  const intentTypeColor: Record<string, string> = {
    DEPOSIT: AMBER,
    RELEASE: TEAL,
    REFUND: ROSE,
    SETTLEMENT: "#34D399",
  };
  const statusColor: Record<string, string> = {
    SUBMITTED: BLUE,
    CONFIRMED: TEAL,
    FAILED: ROSE,
    PENDING: AMBER,
    CREATED: MUTED,
    PROCESSING: PURPLE,
  };

  return (
    <PanelCard>
      <SectionLabel text="Payment & Crypto" color={PURPLE} />
      <View style={{ marginTop: 14, gap: 12 }}>
        {/* Awaiting confirmations alert */}
        {awaitingConfirmations && (
          <View
            style={{
              padding: 14,
              borderRadius: 16,
              backgroundColor: PURPLE_GLASS,
              borderWidth: 1,
              borderColor: PURPLE_BORDER,
              gap: 8,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <ActivityIndicator size="small" color="#A78BFA" />
              <Text style={{ color: "#A78BFA", fontWeight: "900", fontSize: 13 }}>
                Awaiting blockchain confirmations
              </Text>
            </View>
            <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18 }}>
              Your deposit is submitted. We scan for confirmations every ~5 minutes.
            </Text>
            {pollRemainingSec > 0 ? (
              <Text style={{ color: FAINT, fontSize: 12 }}>
                Next auto-check: {fmtCountdown(pollRemainingSec)}
              </Text>
            ) : null}
            {defaultDepositTx ? (
              <Text style={{ color: FAINT, fontSize: 11 }} numberOfLines={1}>
                Tx: {defaultDepositTx}
              </Text>
            ) : defaultDepositRef ? (
              <Text style={{ color: FAINT, fontSize: 11 }} numberOfLines={1}>
                Ref: {defaultDepositRef}
              </Text>
            ) : null}
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              <OutlineBtn label="Refresh status" color="purple" icon="refresh-outline" onPress={onResyncDeposit} busy={busy} />
              <OutlineBtn label="Resync deposit" color="ghost" icon="sync-outline" onPress={onOpenResync} />
            </View>
          </View>
        )}

        {/* Resync available (not awaiting) */}
        {!awaitingConfirmations && canResyncDeposit && (
          <View
            style={{
              padding: 12,
              borderRadius: 14,
              backgroundColor: CARD_RAISED,
              borderWidth: 1,
              borderColor: BORDER,
              gap: 8,
            }}
          >
            <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18 }}>
              Deposit confirmed on-chain but order still shows Created?
            </Text>
            <OutlineBtn label="Resync deposit" color="ghost" icon="sync-outline" onPress={onOpenResync} />
          </View>
        )}

        {/* Pi payment */}
        {piPayment && (
          <View
            style={{
              padding: 12,
              borderRadius: 14,
              backgroundColor: AMBER_GLASS,
              borderWidth: 1,
              borderColor: AMBER_BORDER,
              gap: 6,
            }}
          >
            <Text style={{ color: AMBER, fontWeight: "900", fontSize: 12, letterSpacing: 0.5 }}>
              PI PAYMENT
            </Text>
            <Text style={{ color: TEXT, fontWeight: "800", fontSize: 13 }}>
              Status: {piPayment.status}
            </Text>
            {piPayment.payment_id ? (
              <Text style={{ color: FAINT, fontSize: 11 }} numberOfLines={1}>
                ID: {piPayment.payment_id}
              </Text>
            ) : null}
            {piPayment.topup_pi_required ? (
              <Text style={{ color: ROSE, fontSize: 12, fontWeight: "700" }}>
                Top-up required: {piPayment.topup_pi_required} Pi
                {piPayment.shortfall_usd ? ` (~$${piPayment.shortfall_usd})` : ""}
              </Text>
            ) : null}
          </View>
        )}

        {/* Intent list */}
        {intents.length === 0 ? (
          <Text style={{ color: FAINT, fontSize: 13 }}>No crypto intents recorded yet.</Text>
        ) : (
          <View style={{ gap: 8 }}>
            {intents.slice(0, 5).map((intent) => {
              const typeKey = String(intent.intent_type || "").toUpperCase();
              const statusKey = String(intent.status || "").toUpperCase();
              const fg = intentTypeColor[typeKey] ?? MUTED;
              const statusFg = statusColor[statusKey] ?? FAINT;
              return (
                <View
                  key={intent.id}
                  style={{
                    padding: 12,
                    borderRadius: 14,
                    backgroundColor: CARD_RAISED,
                    borderWidth: 1,
                    borderColor: BORDER,
                    gap: 4,
                  }}
                >
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={{ color: fg, fontWeight: "900", fontSize: 12 }}>
                      {typeKey} · {String(intent.chain).toUpperCase()}
                    </Text>
                    <Text style={{ color: statusFg, fontWeight: "800", fontSize: 11 }}>
                      {statusKey}
                    </Text>
                  </View>
                  {intent.tx_hash ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={{ color: FAINT, fontSize: 11, flex: 1 }} numberOfLines={1}>
                        {intent.tx_hash}
                      </Text>
                      <Pressable
                        onPress={() => Clipboard.setStringAsync(intent.tx_hash!)}
                        hitSlop={8}
                      >
                        <Ionicons name="copy-outline" size={13} color={FAINT} />
                      </Pressable>
                    </View>
                  ) : null}
<Text style={{ color: FAINT, fontSize: 10 }}>
                     {new Date(intent.created_at).toLocaleString()}
                   </Text>
                 </View>
               );
             })}
           </View>
         )}

         {/* End of section message */}
         <View style={{ marginTop: 12, padding: 10, borderRadius: 12, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
           <Text style={{ color: FAINT, fontSize: 11 }}>
             {isBuyer
               ? awaitingConfirmations
                 ? "Deposit processing — status updates in real-time. No need to refresh."
                 : intents.length === 0
                 ? "No payment activity yet. Complete checkout to fund escrow."
                 : "Payment activity updates in real-time when blockchain confirms."
               : "Monitor payment and escrow status here."}
           </Text>
         </View>
       </View>
     </PanelCard>
   );
 }

// ─── Deliverables Panel ────────────────────────────────────────────────────────
function DeliverablesPanel({
  isBuyer,
  isSeller,
  canSellerUpload,
  canDownloadFinal,
  deliverables,
  listing,
  uploadBusy,
  uploadErr,
  onPickUpload,
  onPreview,
  onDownload,
  orderStatus,
}: {
  isBuyer: boolean;
  isSeller: boolean;
  canSellerUpload: boolean;
  canDownloadFinal: boolean;
  deliverables: OrderDeliverable[];
  listing: ListingRow | null;
  uploadBusy: boolean;
  uploadErr: string | null;
  onPickUpload: (access: "preview" | "final") => void;
  onPreview: (d: OrderDeliverable) => void;
  onDownload: (d: OrderDeliverable) => void;
orderStatus?: string;
}) {
   const previewItems = deliverables.filter((d) => d.access === "preview");
  const finalItems = deliverables.filter((d) => d.access === "final");
  const isDigital = String(listing?.delivery_type ?? "").toLowerCase() === "digital";
  const hasWebsite = !!listing?.website_url;

  return (
    <PanelCard>
      <SectionLabel text="Files & Deliverables" color={TEAL} />
      <View style={{ marginTop: 14, gap: 14 }}>
        {/* Buyer view */}
        {isBuyer ? (
          <>
            {/* Website preview */}
            {hasWebsite ? (
              <Pressable
                onPress={() =>
                  onPreview({
                    id: "website",
                    kind: "link",
                    access: "preview",
                    title: "Website preview",
                    link_url: listing?.website_url ?? "",
                  } as any)
                }
                style={{
                  padding: 14,
                  borderRadius: 16,
                  backgroundColor: TEAL_GLASS,
                  borderWidth: 1,
                  borderColor: TEAL_BORDER,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    backgroundColor: "rgba(45,212,191,0.18)",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name="globe-outline" size={18} color={TEAL} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: TEXT, fontWeight: "800", fontSize: 13 }}>
                    Website preview
                  </Text>
                  <Text style={{ color: MUTED, fontSize: 11, marginTop: 2 }}>
                    Tap to open · Demo link
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={15} color={MUTED} />
              </Pressable>
            ) : null}

            {/* Preview files */}
            {previewItems.length === 0 && !hasWebsite ? (
              <View
                style={{
                  alignItems: "center",
                  paddingVertical: 20,
                  gap: 8,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: BORDER,
                  borderStyle: "dashed",
                }}
              >
                <Ionicons name="documents-outline" size={24} color={FAINT} />
                <Text style={{ color: FAINT, fontSize: 13 }}>
                  {isDigital ? "No preview files yet" : "Physical delivery — no file previews"}
                </Text>
              </View>
            ) : (
              <View style={{ gap: 8 }}>
                {previewItems.map((d) => (
                  <Pressable
                    key={d.id}
                    onPress={() => onPreview(d)}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 12,
                      padding: 12,
                      borderRadius: 14,
                      backgroundColor: CARD_RAISED,
                      borderWidth: 1,
                      borderColor: BORDER,
                    }}
                  >
                    <View
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 9,
                        backgroundColor: AMBER_GLASS,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Ionicons name="play-circle-outline" size={16} color={AMBER} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: TEXT, fontWeight: "800", fontSize: 13 }}>
                        {d.title ?? `${String(d.kind).toUpperCase()} preview`}
                      </Text>
                      <Text style={{ color: MUTED, fontSize: 11, marginTop: 1 }}>
                        Tap to preview · Watermarked
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={15} color={MUTED} />
                  </Pressable>
                ))}
              </View>
            )}

            {/* Full downloads (unlocked after OTP + delivered) */}
            {canDownloadFinal ? (
              <View style={{ gap: 8 }}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    borderRadius: 12,
                    backgroundColor: GREEN_GLASS,
                    borderWidth: 1,
                    borderColor: GREEN_BORDER,
                  }}
                >
                  <Ionicons name="lock-open-outline" size={14} color={TEAL} />
                  <Text style={{ color: TEAL, fontWeight: "800", fontSize: 12 }}>
                    Full quality unlocked · OTP verified
                  </Text>
                </View>
                {finalItems.length === 0 ? (
                  <Text style={{ color: FAINT, fontSize: 13 }}>
                    Seller hasn't uploaded full-quality files yet.
                  </Text>
                ) : (
                  finalItems.map((d) => (
                    <View
                      key={d.id}
                      style={{
                        padding: 12,
                        borderRadius: 14,
                        backgroundColor: CARD_RAISED,
                        borderWidth: 1,
                        borderColor: BORDER,
                        gap: 8,
                      }}
                    >
                      <Text style={{ color: TEXT, fontWeight: "800", fontSize: 13 }}>
                        {d.title ?? `${String(d.kind).toUpperCase()} full`}
                      </Text>
                      <View style={{ flexDirection: "row", gap: 8 }}>
                        <Pressable
                          onPress={() => onPreview(d)}
                          style={{
                            flex: 1,
                            borderRadius: 12,
                            paddingVertical: 10,
                            alignItems: "center",
                            backgroundColor: CARD_RAISED,
                            borderWidth: 1,
                            borderColor: BORDER,
                          }}
                        >
                          <Text style={{ color: MUTED, fontWeight: "800", fontSize: 12 }}>
                            View
                          </Text>
                        </Pressable>
                        <Pressable
                          onPress={() => onDownload(d)}
                          style={{
                            flex: 1,
                            borderRadius: 12,
                            paddingVertical: 10,
                            alignItems: "center",
                            backgroundColor: GREEN_GLASS,
                            borderWidth: 1,
                            borderColor: GREEN_BORDER,
                          }}
                        >
                          <Text style={{ color: "#34D399", fontWeight: "900", fontSize: 12 }}>
                            Download
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  ))
                )}
              </View>
            ) : finalItems.length === 0 ? null : (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  paddingVertical: 8,
                  paddingHorizontal: 12,
                  borderRadius: 12,
                  backgroundColor: CARD_RAISED,
                  borderWidth: 1,
                  borderColor: BORDER,
                }}
              >
                <Ionicons name="lock-closed-outline" size={14} color={FAINT} />
                <Text style={{ color: FAINT, fontSize: 12 }}>
                  Full quality locked · Requires OTP + Delivered status
                </Text>
              </View>
            )}
          </>
        ) : null}

        {/* Seller upload section */}
        {isSeller ? (
          <View style={{ gap: 10 }}>
            {uploadErr ? <ErrBanner message={uploadErr} /> : null}
            <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18 }}>
              Upload preview (watermarked) and full-quality files for the buyer.
            </Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable
                disabled={uploadBusy || !canSellerUpload}
                onPress={() => onPickUpload("preview")}
                style={{
                  flex: 1,
                  borderRadius: 16,
                  paddingVertical: 14,
                  alignItems: "center",
                  backgroundColor: uploadBusy || !canSellerUpload ? CARD_RAISED : AMBER_GLASS,
                  borderWidth: 1,
                  borderColor: uploadBusy || !canSellerUpload ? BORDER : AMBER_BORDER,
                  gap: 5,
                }}
              >
                <Ionicons
                  name="cloud-upload-outline"
                  size={18}
                  color={!canSellerUpload ? FAINT : AMBER}
                />
                <Text
                  style={{
                    color: !canSellerUpload ? FAINT : AMBER,
                    fontWeight: "900",
                    fontSize: 12,
                  }}
                >
                  {uploadBusy ? "Uploading…" : "Preview"}
                </Text>
              </Pressable>
              <Pressable
                disabled={uploadBusy || !canSellerUpload}
                onPress={() => onPickUpload("final")}
                style={{
                  flex: 1,
                  borderRadius: 16,
                  paddingVertical: 14,
                  alignItems: "center",
                  backgroundColor: uploadBusy || !canSellerUpload ? CARD_RAISED : TEAL_GLASS,
                  borderWidth: 1,
                  borderColor: uploadBusy || !canSellerUpload ? BORDER : TEAL_BORDER,
                  gap: 5,
                }}
              >
                <Ionicons
                  name="checkmark-circle-outline"
                  size={18}
                  color={!canSellerUpload ? FAINT : TEAL}
                />
                <Text
                  style={{
                    color: !canSellerUpload ? FAINT : TEAL,
                    fontWeight: "900",
                    fontSize: 12,
                  }}
                >
                  {uploadBusy ? "Uploading…" : "Full Quality"}
                </Text>
              </Pressable>
            </View>
{!canSellerUpload ? (
               <Text style={{ color: FAINT, fontSize: 11 }}>
                 Available when order is IN_ESCROW, OUT_FOR_DELIVERY, or DELIVERABLE_UPLOADED.
               </Text>
             ) : null}
             {deliverables.length > 0 ? (
               <Text style={{ color: MUTED, fontSize: 12 }}>
                 Uploaded: {previewItems.length} preview · {finalItems.length} full-quality
               </Text>
             ) : null}
           </View>
         ) : null}

         {/* End of section message */}
         <View style={{ marginTop: 12, padding: 10, borderRadius: 12, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
           <Text style={{ color: FAINT, fontSize: 11 }}>
             {isBuyer
               ? deliverables.length === 0
                 ? "No files uploaded yet. Check back when seller uploads deliverables."
                 : "Files update in real-time when seller uploads."
               : "Files will be visible to buyer once uploaded."}
           </Text>
         </View>
       </View>
     </PanelCard>
   );
 }

// ─── Dispute Panel ─────────────────────────────────────────────────────────────
function DisputePanel({
  dispute,
  disputeMessages,
  disputeText,
  disputeFiles,
  disputeBusy,
  disputeErr,
  canUseDisputeCenter,
  disputeClosed,
  disputeRoleLabel,
  me,
  onChangeText,
  onPickFiles,
  onRemoveFile,
  onSubmit,
  onOpenAttachment,
}: {
  dispute: MarketDispute | null;
  disputeMessages: DisputeMessage[];
  disputeText: string;
  disputeFiles: DisputeLocalFile[];
  disputeBusy: boolean;
  disputeErr: string | null;
  canUseDisputeCenter: boolean;
  disputeClosed: boolean;
  disputeRoleLabel: string;
  me: string | null;
  onChangeText: (v: string) => void;
  onPickFiles: () => void;
  onRemoveFile: (i: number) => void;
  onSubmit: () => void;
  onOpenAttachment: (a: any) => void;
}) {
  return (
    <PanelCard accent={dispute ? (disputeClosed ? "green" : "red") : undefined}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <SectionLabel text="Dispute Center" color={dispute ? (disputeClosed ? "#34D399" : ROSE) : MUTED} />
        <View
          style={{
            paddingHorizontal: 10,
            paddingVertical: 5,
            borderRadius: 999,
            backgroundColor: disputeClosed ? GREEN_GLASS : dispute ? RED_GLASS : CARD_RAISED,
            borderWidth: 1,
            borderColor: disputeClosed ? GREEN_BORDER : dispute ? RED_BORDER : BORDER,
          }}
        >
          <Text
            style={{
              color: disputeClosed ? "#34D399" : dispute ? ROSE : FAINT,
              fontWeight: "900",
              fontSize: 11,
            }}
          >
            {dispute ? dispute.status.replace(/_/g, " ") : "No dispute"}
          </Text>
        </View>
      </View>

      <View style={{ marginTop: 14, gap: 12 }}>
        {!dispute ? (
          <Text style={{ color: MUTED, fontSize: 13, lineHeight: 19 }}>
            If there's a problem with this order, describe what happened and attach proof before submitting to admin review.
          </Text>
        ) : null}

        {dispute?.resolution ? (
          <View style={{ padding: 12, borderRadius: 14, backgroundColor: GREEN_GLASS, borderWidth: 1, borderColor: GREEN_BORDER }}>
            <Text style={{ color: "#34D399", fontWeight: "900", fontSize: 12 }}>RESOLUTION</Text>
            <Text style={{ color: MUTED, fontSize: 13, marginTop: 4 }}>
              {String(dispute.resolution).replace(/_/g, " ").toLowerCase()}
            </Text>
          </View>
        ) : null}

        {/* Messages */}
        {disputeMessages.length > 0 ? (
          <View style={{ gap: 8 }}>
            {disputeMessages.map((msg) => {
              const mine = msg.sender_id === me;
              const speakerLabel =
                msg.sender_kind === "ADMIN"
                  ? "Admin"
                  : msg.sender_kind === "SELLER"
                  ? "Seller"
                  : "Buyer";
              return (
                <View
                  key={msg.id}
                  style={{
                    borderRadius: 16,
                    padding: 12,
                    backgroundColor: mine ? PURPLE_GLASS : CARD_RAISED,
                    borderWidth: 1,
                    borderColor: mine ? PURPLE_BORDER : BORDER,
                    gap: 8,
                  }}
                >
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={{ color: mine ? "#A78BFA" : MUTED, fontWeight: "900", fontSize: 12 }}>
                      {mine ? "You" : speakerLabel}
                    </Text>
                    <Text style={{ color: FAINT, fontSize: 10 }}>
                      {new Date(msg.created_at).toLocaleString()}
                    </Text>
                  </View>
                  {msg.body ? (
                    <Text style={{ color: MUTED, lineHeight: 19, fontSize: 13 }}>{msg.body}</Text>
                  ) : (
                    <Text style={{ color: FAINT, fontSize: 13 }}>Proof attached.</Text>
                  )}
                  {msg.attachments?.length ? (
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                      {msg.attachments.map((att: any) => (
                        <Pressable
                          key={att.id}
                          onPress={() => onOpenAttachment(att)}
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 6,
                            paddingHorizontal: 10,
                            paddingVertical: 6,
                            borderRadius: 999,
                            backgroundColor: BLUE_GLASS,
                            borderWidth: 1,
                            borderColor: BLUE_BORDER,
                          }}
                        >
                          <Ionicons name="document-attach-outline" size={13} color={BLUE} />
                          <Text
                            numberOfLines={1}
                            style={{ color: "#E0F2FE", fontWeight: "800", fontSize: 11, maxWidth: 160 }}
                          >
                            {att.file_name || "Proof"}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : null}

        {/* Compose form */}
        {!disputeClosed ? (
          <View style={{ gap: 10 }}>
            <TextInput
              value={disputeText}
              onChangeText={onChangeText}
              placeholder={`Write your ${disputeRoleLabel} statement…`}
              placeholderTextColor="rgba(255,253,247,0.32)"
              multiline
              textAlignVertical="top"
              style={{
                minHeight: 96,
                borderRadius: 16,
                paddingHorizontal: 14,
                paddingVertical: 12,
                borderWidth: 1,
                borderColor: BORDER,
                backgroundColor: CARD_RAISED,
                color: TEXT,
                fontSize: 14,
                lineHeight: 20,
              }}
            />

            {disputeFiles.length > 0 ? (
              <View style={{ gap: 6 }}>
                {disputeFiles.map((file, idx) => (
                  <View
                    key={`${file.uri}-${idx}`}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                      padding: 10,
                      borderRadius: 12,
                      backgroundColor: CARD_RAISED,
                      borderWidth: 1,
                      borderColor: BORDER,
                    }}
                  >
                    <Ionicons name="document-attach-outline" size={15} color={BLUE} />
                    <Text numberOfLines={1} style={{ flex: 1, color: MUTED, fontWeight: "700", fontSize: 12 }}>
                      {file.name || "Proof"}
                    </Text>
                    <Pressable onPress={() => onRemoveFile(idx)} hitSlop={8}>
                      <Ionicons name="close-circle-outline" size={18} color={ROSE} />
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : null}

            {disputeErr ? (
              <Text
                style={{
                  color: disputeErr.includes("Describe") ? AMBER : ROSE,
                  fontWeight: "700",
                  fontSize: 12,
                  lineHeight: 18,
                }}
              >
                {disputeErr}
              </Text>
            ) : null}

            <View style={{ flexDirection: "row", gap: 8 }}>
              <OutlineBtn
                label="Attach proof"
                icon="attach-outline"
                color="blue"
                disabled={!canUseDisputeCenter || disputeBusy}
                onPress={onPickFiles}
              />
              <View style={{ flex: 1 }}>
                <ActionBtn
                  label={dispute ? "Send update" : "Open dispute"}
                  icon="shield-outline"
                  color="red"
                  disabled={!canUseDisputeCenter}
                  busy={disputeBusy}
                  onPress={onSubmit}
                />
              </View>
            </View>
          </View>
        ) : null}
      </View>
    </PanelCard>
  );
}

// ─── AI Risk Panel ─────────────────────────────────────────────────────────────
function AiRiskPanel({
  riskResult,
  riskBusy,
  isBuyer,
  onRun,
}: {
  riskResult: MarketOrderAiRiskResult | null;
  riskBusy: boolean;
  isBuyer: boolean;
  onRun: () => void;
}) {
  function riskColor(level?: string) {
    const r = String(level || "").toUpperCase();
    if (r === "URGENT" || r === "HIGH") return ROSE;
    if (r === "MEDIUM") return AMBER;
    return TEAL;
  }

  return (
    <PanelCard>
      <SectionLabel text="AI Risk Check" color={TEAL} />
      <View style={{ marginTop: 14, gap: 12 }}>
        <Text style={{ color: MUTED, fontSize: 13, lineHeight: 19 }}>
          Scan payment, delivery, escrow, and dispute signals for this order.
        </Text>
        <ActionBtn
          label={riskBusy ? "Checking…" : "Run risk check"}
          icon="sparkles-outline"
          color="teal"
          busy={riskBusy}
          onPress={onRun}
        />
        {riskResult?.risk ? (
          <View
            style={{
              borderRadius: 16,
              padding: 14,
              backgroundColor: `${riskColor(riskResult.risk.risk_level)}18`,
              borderWidth: 1,
              borderColor: `${riskColor(riskResult.risk.risk_level)}55`,
              gap: 8,
            }}
          >
            <Text style={{ color: riskColor(riskResult.risk.risk_level), fontWeight: "900", fontSize: 13 }}>
              {riskResult.risk.risk_level} risk · {riskResult.risk.confidence} confidence
            </Text>
            {riskResult.risk.summary ? (
              <Text style={{ color: MUTED, lineHeight: 19, fontSize: 13 }}>
                {riskResult.risk.summary}
              </Text>
            ) : null}
            {[
              ...riskResult.risk.mismatch_flags,
              ...riskResult.risk.payment_flags,
              ...riskResult.risk.delivery_flags,
            ].length > 0 ? (
              <Text style={{ color: riskColor(riskResult.risk.risk_level), fontSize: 12, lineHeight: 18 }}>
                Flags:{" "}
                {[
                  ...riskResult.risk.mismatch_flags,
                  ...riskResult.risk.payment_flags,
                  ...riskResult.risk.delivery_flags,
                ].join(", ")}
              </Text>
            ) : null}
            {riskResult.risk.recommended_actions?.length ? (
              <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18 }}>
                Recommended: {riskResult.risk.recommended_actions.join(" ")}
              </Text>
            ) : null}
            {(isBuyer ? riskResult.risk.buyer_note : riskResult.risk.seller_note) ? (
              <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18, fontStyle: "italic" }}>
                {isBuyer ? riskResult.risk.buyer_note : riskResult.risk.seller_note}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
    </PanelCard>
  );
}

// ─── Buyer Order View ──────────────────────────────────────────────────────────
function BuyerOrderView({
  order,
  listing,
  seller,
  otp,
  otpVerified,
  otpExpiryRemainingSec,
  otpCooldownRemainingSec,
  hasPendingUnexpiredOtp,
  canGenerateOtpNow,
  canRelease,
  canGoCheckout,
  canCancel,
  canReviewListingFromOrder,
  isPiRailOrder,
  latestPiPaymentStatus,
  generatedOtpCode,
  busy,
  err,
  onRequestOTP,
  onReleaseFunds,
  onGoCheckout,
  onCancelOrder,
  onReviewListing,
  onPrepareDispute,
}: {
  order: OrderRow;
  listing: ListingRow | null;
  seller: SellerRow | null;
  otp: OtpRow | null;
  otpVerified: boolean;
  otpExpiryRemainingSec: number;
  otpCooldownRemainingSec: number;
  hasPendingUnexpiredOtp: boolean;
  canGenerateOtpNow: boolean;
  canRelease: boolean;
  canGoCheckout: boolean;
  canCancel: boolean;
  canReviewListingFromOrder: boolean;
  isPiRailOrder: boolean;
  latestPiPaymentStatus: string;
  generatedOtpCode: string | null;
  busy: boolean;
  err: string | null;
  onRequestOTP: () => void;
  onReleaseFunds: () => void;
  onGoCheckout: () => void;
  onCancelOrder: () => void;
  onReviewListing: () => void;
  onPrepareDispute: () => void;
}) {
  const orderStatus = String(order.status || "").toUpperCase();
  const isActive = !["CANCELLED", "REFUNDED", "RELEASED"].includes(orderStatus);

  return (
    <View style={{ gap: 12 }}>
      {/* Role badge */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderRadius: 12,
          backgroundColor: BLUE_GLASS,
          borderWidth: 1,
          borderColor: BLUE_BORDER,
          alignSelf: "flex-start",
        }}
      >
        <Ionicons name="bag-handle-outline" size={13} color={BLUE} />
        <Text style={{ color: BLUE, fontWeight: "900", fontSize: 11, letterSpacing: 0.5 }}>
          BUYER VIEW
        </Text>
      </View>

      {/* Primary action card */}
      {canGoCheckout ? (
        <PanelCard accent="amber">
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                backgroundColor: AMBER_GLASS,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="card-outline" size={20} color={AMBER} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: TEXT, fontWeight: "900", fontSize: 15 }}>Payment Required</Text>
              <Text style={{ color: MUTED, fontSize: 12, marginTop: 2 }}>
                Complete checkout to secure your order in escrow
              </Text>
            </View>
          </View>
          {seller?.market_username ? (
            <OutlineBtn
              label="Ask seller a question first"
              icon="chatbubble-ellipses-outline"
              color="ghost"
              onPress={() =>
                router.push({
                  pathname: "/market/dm/[username]" as any,
                  params: { username: seller.market_username },
                })
              }
            />
          ) : null}
          <View style={{ marginTop: 8 }}>
            <ActionBtn
              label={
                isPiRailOrder
                  ? latestPiPaymentStatus === "UNDERPAID"
                    ? "Retry Pi top-up"
                    : "Continue Pi checkout"
                  : "Continue to checkout"
              }
              sublabel={
                isPiRailOrder ? "Complete your Pi payment" : "Choose USDC, USDT, or Pi"
              }
              color="amber"
              icon="arrow-forward-outline"
              onPress={onGoCheckout}
            />
          </View>
          {canCancel ? (
            <View style={{ marginTop: 8 }}>
              <OutlineBtn
                label="Cancel this order"
                icon="close-outline"
                color="red"
                disabled={busy}
                busy={busy}
                onPress={onCancelOrder}
              />
            </View>
          ) : null}
        </PanelCard>
      ) : null}

      {/* OTP card — when order is out for delivery */}
      {orderStatus === "OUT_FOR_DELIVERY" && !otpVerified ? (
        <PanelCard accent="blue">
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                backgroundColor: BLUE_GLASS,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="key-outline" size={20} color={BLUE} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: TEXT, fontWeight: "900", fontSize: 15 }}>Delivery OTP</Text>
              <Text style={{ color: MUTED, fontSize: 12, marginTop: 2 }}>
                Generate your OTP and share it with the seller to confirm delivery
              </Text>
            </View>
          </View>

          {generatedOtpCode && !otpVerified ? (
            <View
              style={{
                padding: 16,
                borderRadius: 16,
                backgroundColor: PURPLE_GLASS,
                borderWidth: 1,
                borderColor: PURPLE_BORDER,
                alignItems: "center",
                gap: 10,
                marginBottom: 12,
              }}
            >
              <Text style={{ color: MUTED, fontWeight: "700", fontSize: 11, letterSpacing: 1 }}>
                YOUR OTP CODE
              </Text>
              <Text style={{ color: TEXT, fontWeight: "900", fontSize: 32, letterSpacing: 8 }}>
                {generatedOtpCode}
              </Text>
              <OutlineBtn
                label="Copy OTP"
                icon="copy-outline"
                color="purple"
                onPress={async () => {
                  await Clipboard.setStringAsync(generatedOtpCode);
                  Alert.alert("Copied", "OTP copied to clipboard.");
                }}
              />
            </View>
          ) : null}

          {hasPendingUnexpiredOtp && otpExpiryRemainingSec > 0 ? (
            <Text style={{ color: MUTED, fontSize: 12, marginBottom: 10 }}>
              OTP active · Expires in {fmtCountdown(otpExpiryRemainingSec)}
            </Text>
          ) : null}

          {otpCooldownRemainingSec > 0 ? (
            <Text style={{ color: FAINT, fontSize: 12, marginBottom: 10 }}>
              Cooldown: {fmtCountdown(otpCooldownRemainingSec)}
            </Text>
          ) : null}

          <ActionBtn
            label={hasPendingUnexpiredOtp ? "Resend OTP" : "Generate OTP"}
            icon="key-outline"
            color="blue"
            disabled={!canGenerateOtpNow}
            busy={busy}
            onPress={onRequestOTP}
          />
        </PanelCard>
      ) : null}

      {/* OTP verified badge */}
      {otpVerified ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            padding: 14,
            borderRadius: 16,
            backgroundColor: GREEN_GLASS,
            borderWidth: 1,
            borderColor: GREEN_BORDER,
          }}
        >
          <Ionicons name="checkmark-circle" size={22} color={TEAL} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: TEAL, fontWeight: "900", fontSize: 14 }}>OTP Verified</Text>
            <Text style={{ color: MUTED, fontSize: 12, marginTop: 2 }}>
              Delivery confirmed. Download files then release funds when satisfied.
            </Text>
          </View>
        </View>
      ) : null}

      {/* Release funds */}
      {isActive && !canGoCheckout ? (
        <PanelCard accent={canRelease ? "green" : undefined}>
          <SectionLabel text="Release Funds" color={canRelease ? "#34D399" : FAINT} />
          <View style={{ marginTop: 12, gap: 8 }}>
            <Text style={{ color: MUTED, fontSize: 13, lineHeight: 19 }}>
              {canRelease
                ? "OTP verified. Release payment to the seller after downloading and reviewing your files."
                : "Available after OTP is verified and order is marked Delivered."}
            </Text>
            <ActionBtn
              label={busy ? "Releasing…" : "Release funds to seller"}
              sublabel="Escrow protected · Requires OTP verified"
              color="green"
              icon="shield-checkmark-outline"
              disabled={!canRelease}
              busy={busy && canRelease}
              onPress={onReleaseFunds}
            />
          </View>
        </PanelCard>
      ) : null}

      {/* Review */}
      {canReviewListingFromOrder ? (
        <OutlineBtn
          label="Review this listing"
          icon="star-outline"
          color="amber"
          onPress={onReviewListing}
        />
      ) : null}

{/* Report issue */}
       {isActive ? (
         <OutlineBtn
           label="Report issue / request refund"
           icon="flag-outline"
           color="red"
           onPress={onPrepareDispute}
         />
       ) : null}

       {err ? <ErrBanner message={err} /> : null}

       {/* End of section status message */}
       <View style={{ marginTop: 12, padding: 10, borderRadius: 12, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
         <Text style={{ color: FAINT, fontSize: 11 }}>
           {orderStatus === "DELIVERED"
             ? "Order delivered. Verify OTP and release funds to complete the transaction."
             : orderStatus === "RELEASED"
             ? "Transaction complete. Funds have been released to seller."
             : orderStatus === "IN_ESCROW"
             ? "Payment secured in escrow. Seller will process your order."
             : "Check back for updates on this order."}
         </Text>
       </View>
     </View>
   );
}

// ─── Seller Order View ─────────────────────────────────────────────────────────
function SellerOrderView({
  order,
  otp,
  otpVerified,
  otpInput,
  setOtpInput,
  canOutForDelivery,
  canVerifyOtp,
  busy,
  err,
  onOutForDelivery,
  onVerifyOTP,
  onPrepareDispute,
}: {
  order: OrderRow;
  otp: OtpRow | null;
  otpVerified: boolean;
  otpInput: string;
  setOtpInput: (v: string) => void;
  canOutForDelivery: boolean;
  canVerifyOtp: boolean;
  busy: boolean;
  err: string | null;
  onOutForDelivery: () => void;
  onVerifyOTP: () => void;
  onPrepareDispute: () => void;
}) {
  const orderStatus = String(order.status || "").toUpperCase();
  const isActive = !["CANCELLED", "REFUNDED", "RELEASED"].includes(orderStatus);

  return (
    <View style={{ gap: 12 }}>
      {/* Role badge */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderRadius: 12,
          backgroundColor: AMBER_GLASS,
          borderWidth: 1,
          borderColor: AMBER_BORDER,
          alignSelf: "flex-start",
        }}
      >
        <Ionicons name="storefront-outline" size={13} color={AMBER} />
        <Text style={{ color: AMBER, fontWeight: "900", fontSize: 11, letterSpacing: 0.5 }}>
          SELLER VIEW
        </Text>
      </View>

      {/* Primary action — mark out for delivery */}
      {orderStatus === "IN_ESCROW" ? (
        <PanelCard accent="amber">
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                backgroundColor: AMBER_GLASS,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="bicycle-outline" size={20} color={AMBER} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: TEXT, fontWeight: "900", fontSize: 15 }}>Payment Secured</Text>
              <Text style={{ color: MUTED, fontSize: 12, marginTop: 2 }}>
                Funds are in escrow. Fulfill the order and mark it out for delivery.
              </Text>
            </View>
          </View>
          <ActionBtn
            label={busy ? "Working…" : "Mark out for delivery"}
            sublabel="Notify buyer the order is on its way"
            color="amber"
            icon="bicycle-outline"
            disabled={!canOutForDelivery}
            busy={busy}
            onPress={onOutForDelivery}
          />
        </PanelCard>
      ) : null}

      {/* OTP verification */}
      {orderStatus === "OUT_FOR_DELIVERY" ? (
        <PanelCard accent={otpVerified ? "green" : "blue"}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                backgroundColor: otpVerified ? GREEN_GLASS : BLUE_GLASS,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons
                name={otpVerified ? "checkmark-circle" : "key-outline"}
                size={20}
                color={otpVerified ? TEAL : BLUE}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: TEXT, fontWeight: "900", fontSize: 15 }}>
                {otpVerified ? "OTP Verified ✓" : "Enter Buyer OTP"}
              </Text>
              <Text style={{ color: MUTED, fontSize: 12, marginTop: 2 }}>
                {otpVerified
                  ? "Delivery confirmed. Ask buyer to release funds."
                  : "Ask the buyer for their OTP code and enter it here."}
              </Text>
            </View>
          </View>

          {!otpVerified ? (
            <>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  borderRadius: 16,
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  borderWidth: 1,
                  borderColor: BORDER,
                  backgroundColor: CARD_RAISED,
                  marginBottom: 10,
                }}
              >
                <Ionicons name="key-outline" size={18} color={MUTED} />
                <TextInput
                  value={otpInput}
                  onChangeText={setOtpInput}
                  placeholder="Enter buyer's OTP code"
                  placeholderTextColor="rgba(255,253,247,0.32)"
                  keyboardType="number-pad"
                  style={{ flex: 1, color: TEXT, fontWeight: "900", fontSize: 18, letterSpacing: 4 }}
                />
              </View>
              <ActionBtn
                label={busy ? "Verifying…" : "Verify OTP"}
                icon="checkmark-circle-outline"
                color="blue"
                disabled={!canVerifyOtp || otpInput.trim().length < 4}
                busy={busy}
                onPress={onVerifyOTP}
              />
              {otp ? (
                <Text style={{ color: FAINT, fontSize: 11, marginTop: 8 }}>
                  OTP attempts: {otp.attempts} · Expires: {new Date(otp.expires_at).toLocaleTimeString()}
                </Text>
              ) : (
                <Text style={{ color: FAINT, fontSize: 11, marginTop: 8 }}>
                  Waiting for buyer to generate OTP.
                </Text>
              )}
            </>
          ) : (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                padding: 12,
                borderRadius: 12,
                backgroundColor: GREEN_GLASS,
                borderWidth: 1,
                borderColor: GREEN_BORDER,
              }}
            >
              <Ionicons name="checkmark-circle" size={16} color={TEAL} />
              <Text style={{ color: TEAL, fontWeight: "800", fontSize: 13 }}>
                Delivery confirmed — awaiting buyer fund release.
              </Text>
            </View>
          )}
        </PanelCard>
      ) : null}

      {/* Awaiting escrow */}
      {orderStatus === "CREATED" ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            padding: 14,
            borderRadius: 16,
            backgroundColor: AMBER_GLASS,
            borderWidth: 1,
            borderColor: AMBER_BORDER,
          }}
        >
          <ActivityIndicator size="small" color={AMBER} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: AMBER, fontWeight: "900", fontSize: 13 }}>
              Awaiting buyer payment
            </Text>
            <Text style={{ color: MUTED, fontSize: 12, marginTop: 2 }}>
              The buyer needs to complete checkout before you can fulfill this order.
            </Text>
          </View>
        </View>
      ) : null}

{/* Report issue */}
       {isActive ? (
         <OutlineBtn
           label="Report issue / open complaint"
           icon="flag-outline"
           color="red"
           onPress={onPrepareDispute}
         />
       ) : null}

       {err ? <ErrBanner message={err} /> : null}

       {/* End of section status message */}
       <View style={{ marginTop: 12, padding: 10, borderRadius: 12, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
         <Text style={{ color: FAINT, fontSize: 11 }}>
           {orderStatus === "IN_ESCROW"
             ? "Payment secured. Mark as out for delivery when ready to fulfill."
             : orderStatus === "OUT_FOR_DELIVERY"
             ? "Order in delivery. Ask buyer for OTP to confirm delivery."
             : orderStatus === "DELIVERED" && otpVerified
             ? "Delivery confirmed. Awaiting buyer to release funds."
             : "Check back for updates on this order."}
         </Text>
       </View>
     </View>
   );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function OrderDetails() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { orderId, tx, uo } = useLocalSearchParams<{ orderId: string; tx?: string; uo?: string }>();
  const oid = useMemo(() => String(orderId || ""), [orderId]);
  const navTx = useMemo(() => String(tx || "").trim(), [tx]);
  const navUserOp = useMemo(() => String(uo || "").trim(), [uo]);

  // Responsive layout
  const isTablet = width >= 640;
  const isDesktop = width >= 1024;
  const contentMaxWidth = 1120;
  const sidePadding = isDesktop ? 40 : isTablet ? 24 : 16;

  // Tab navigation for desktop
  const TABS = ["Overview", "Payment", "Files", "Dispute", "Activity"] as const;
  type TabKey = typeof TABS[number];
  const [activeTab, setActiveTab] = useState<TabKey>("Overview");

  // ─── State ────────────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<string | null>(null);
  const [order, setOrder] = useState<OrderRow | null>(null);
  const [listing, setListing] = useState<ListingRow | null>(null);
  const [seller, setSeller] = useState<SellerRow | null>(null);
  const [buyerProfile, setBuyerProfile] = useState<BuyerProfileRow | null>(null);
  const [sellerProfileUsername, setSellerProfileUsername] = useState<string | null>(null);
  const [otp, setOtp] = useState<OtpRow | null>(null);
  const [intents, setIntents] = useState<CryptoIntent[]>([]);
  const [piPayment, setPiPayment] = useState<PiPaymentRow | null>(null);
  const [deliverables, setDeliverables] = useState<OrderDeliverable[]>([]);
  const [otpInput, setOtpInput] = useState("");
  const [generatedOtpCode, setGeneratedOtpCode] = useState<string | null>(null);
  const [otpCooldownUntilMs, setOtpCooldownUntilMs] = useState<number>(0);
  const [nowMs, setNowMs] = useState<number>(Date.now());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [riskBusy, setRiskBusy] = useState(false);
  const [riskResult, setRiskResult] = useState<MarketOrderAiRiskResult | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewPayload, setPreviewPayload] = useState<PreviewPayload | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [reindexOpen, setReindexOpen] = useState(false);
  const [reindexTx, setReindexTx] = useState("");
  const [dispute, setDispute] = useState<MarketDispute | null>(null);
  const [disputeMessages, setDisputeMessages] = useState<DisputeMessage[]>([]);
  const [disputeText, setDisputeText] = useState("");
  const [disputeFiles, setDisputeFiles] = useState<DisputeLocalFile[]>([]);
  const [disputeBusy, setDisputeBusy] = useState(false);
  const [disputeErr, setDisputeErr] = useState<string | null>(null);
  const autoReindexKeyRef = useRef<string>("");
  const autoSyncBusyRef = useRef(false);

  // ─── Derived ──────────────────────────────────────────────────────────────────
  const isBuyer = useMemo(() => !!me && !!order && order.buyer_id === me, [me, order]);
  const isSeller = useMemo(() => !!me && !!order && order.seller_id === me, [me, order]);

  const canOrderChat = useMemo(
    () =>
      !!order &&
      ["IN_ESCROW", "OUT_FOR_DELIVERY", "DELIVERED", "RELEASED"].includes(
        String(order.status || "").toUpperCase(),
      ) &&
      (isBuyer || isSeller),
    [order, isBuyer, isSeller],
  );

  const counterpartyUsername = useMemo(() => {
    if (!order) return null;
    if (isBuyer) {
      const sellerHandle = String(seller?.market_username || sellerProfileUsername || "")
        .trim()
        .toLowerCase();
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
  }, [order, isBuyer, isSeller, seller?.market_username, sellerProfileUsername, buyerProfile?.username]);

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
  }, [isBuyer, isSeller, seller, buyerProfile, order]);

  const disputeStatus = useMemo(
    () => String(dispute?.status || "").toUpperCase(),
    [dispute?.status],
  );
  const disputeClosed = disputeStatus === "RESOLVED";

  const canUseDisputeCenter = useMemo(() => {
    if (!order || (!isBuyer && !isSeller)) return false;
    if (dispute && !disputeClosed) return true;
    return ["IN_ESCROW", "OUT_FOR_DELIVERY", "DELIVERABLE_UPLOADED", "DELIVERED", "DISPUTED"].includes(
      String(order.status || "").toUpperCase(),
    );
  }, [order, isBuyer, isSeller, dispute, disputeClosed]);

  const disputeRoleLabel = isSeller ? "seller" : "buyer";

  const otpVerified = !!otp?.verified_at;

  const latestDepositIntent = useMemo(() => {
    const dep = intents.filter((i) => String(i.intent_type || "").toUpperCase() === "DEPOSIT");
    if (!dep.length) return null;
    return dep.sort((a, b) =>
      String(b.created_at || "").localeCompare(String(a.created_at || "")),
    )[0];
  }, [intents]);

  const latestReleaseIntent = useMemo(() => {
    const rel = intents.filter((i) => String(i.intent_type || "").toUpperCase() === "RELEASE");
    if (!rel.length) return null;
    return rel.sort((a, b) =>
      String(b.created_at || "").localeCompare(String(a.created_at || "")),
    )[0];
  }, [intents]);

  const latestRefundIntent = useMemo(() => {
    const ref = intents.filter((i) => String(i.intent_type || "").toUpperCase() === "REFUND");
    if (!ref.length) return null;
    return ref.sort((a, b) =>
      String(b.created_at || "").localeCompare(String(a.created_at || "")),
    )[0];
  }, [intents]);

  const latestSettlementIntent = useMemo(() => {
    const candidates = [latestReleaseIntent, latestRefundIntent].filter(
      Boolean,
    ) as CryptoIntent[];
    if (!candidates.length) return null;
    return candidates.sort((a, b) =>
      String(b.created_at || "").localeCompare(String(a.created_at || "")),
    )[0];
  }, [latestReleaseIntent, latestRefundIntent]);

  const latestPiPaymentStatus = useMemo(
    () => String(piPayment?.status || "").toUpperCase(),
    [piPayment?.status],
  );

  const isPiRailOrder = useMemo(
    () =>
      !!piPayment ||
      intents.some(
        (i) =>
          String(i.intent_type || "").toUpperCase() === "DEPOSIT" &&
          String(i.chain || "").toLowerCase() === "pi_testnet",
      ),
    [intents, piPayment],
  );

  const isStableOrder = useMemo(
    () => ["USDC", "USDT"].includes(String(order?.currency || "").toUpperCase()),
    [order?.currency],
  );

  const hasSubmittedCryptoDeposit = useMemo(() => {
    return (
      intents.some(
        (i) =>
          String(i.intent_type || "").toUpperCase() === "DEPOSIT" &&
          ["SUBMITTED", "CONFIRMED"].includes(String(i.status || "").toUpperCase()),
      ) ||
      isHexHash(latestDepositIntent?.tx_hash) ||
      isHexHash(latestDepositIntent?.client_reference) ||
      isHexHash(navTx) ||
      isHexHash(navUserOp)
    );
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
  }, [
    latestDepositIntent?.client_reference,
    latestDepositIntent?.tx_hash,
    navTx,
    navUserOp,
  ]);

  const defaultDepositHash = defaultDepositTx || defaultDepositRef;

  const awaitingConfirmations =
    !!order &&
    order.status === "CREATED" &&
    isStableOrder &&
    !isPiRailOrder &&
    hasSubmittedCryptoDeposit;

  const canResyncDeposit =
    !!order && order.status === "CREATED" && isStableOrder && !isPiRailOrder;

  const awaitingPiCompletion =
    !!order &&
    isBuyer &&
    String(order.status || "").toUpperCase() === "CREATED" &&
    isPiRailOrder &&
    latestPiPaymentStatus === "APPROVED";

  const pollIntervalMs = 5 * 60 * 1000;
  const depositCreatedAtMs = latestDepositIntent?.created_at
    ? new Date(latestDepositIntent.created_at).getTime()
    : 0;
  const nextPollAtMs = depositCreatedAtMs > 0 ? depositCreatedAtMs + pollIntervalMs : 0;
  const pollRemainingSec =
    nextPollAtMs > 0 ? Math.max(0, Math.ceil((nextPollAtMs - nowMs) / 1000)) : 0;

  const previewItems = useMemo(() => deliverables.filter((d) => d.access === "preview"), [deliverables]);
  const finalItems = useMemo(() => deliverables.filter((d) => d.access === "final"), [deliverables]);
  const isDigital = useMemo(
    () => String(listing?.delivery_type ?? "").toLowerCase() === "digital",
    [listing?.delivery_type],
  );

  const canDownloadFinal =
    !!order &&
    isBuyer &&
    otpVerified &&
    (order.status === "DELIVERED" || order.status === "RELEASED");

  const canGoCheckout =
    !!order &&
    order.status === "CREATED" &&
    isBuyer &&
    (isPiRailOrder
      ? ["", "QUOTED", "FAILED", "CANCELLED", "UNDERPAID"].includes(latestPiPaymentStatus)
      : !hasSubmittedCryptoDeposit);

  const canCancel =
    !!order && order.status === "CREATED" && isBuyer && !hasSubmittedCryptoDeposit;

  const canOutForDelivery = !!order && isSeller && order.status === "IN_ESCROW";
  const canRequestOtp = !!order && isBuyer && order.status === "OUT_FOR_DELIVERY";
  const canVerifyOtp = !!order && isSeller && order.status === "OUT_FOR_DELIVERY";
  const canRelease = !!order && isBuyer && otpVerified && order.status === "DELIVERED";
  const canReviewListingFromOrder =
    !!order &&
    isBuyer &&
    ["DELIVERED", "RELEASED"].includes(String(order.status || "").toUpperCase());
  const canSellerUpload =
    !!order &&
    isSeller &&
    ["IN_ESCROW", "OUT_FOR_DELIVERY", "DELIVERABLE_UPLOADED"].includes(
      String(order.status || "").toUpperCase(),
    );

  const otpExpiresAtMs = otp?.expires_at ? new Date(otp.expires_at).getTime() : 0;
  const otpExpiryRemainingSec =
    otpVerified || !otpExpiresAtMs
      ? 0
      : Math.max(0, Math.ceil((otpExpiresAtMs - nowMs) / 1000));
  const otpCooldownRemainingSec = Math.max(
    0,
    Math.ceil((otpCooldownUntilMs - nowMs) / 1000),
  );
  const hasPendingUnexpiredOtp = !!otp && !otpVerified && otpExpiryRemainingSec > 0;
  const canGenerateOtpNow =
    canRequestOtp && !busy && !otpVerified && otpCooldownRemainingSec === 0 && !hasPendingUnexpiredOtp;

  const orderStatus = String(order?.status || "").toUpperCase();
  const policyAudience = isSeller ? "seller" : isBuyer ? "buyer" : "both";
  const { bySection: orderPolicy, loading: orderPolicyLoading } = useMarketPolicyBlocks({
    surface: "order",
    audience: policyAudience,
    orderStatus,
  });

  // ─── Timers ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // ─── Load ──────────────────────────────────────────────────────────────────────
  async function load() {
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
            "id,buyer_id,seller_id,listing_id,quantity,unit_price,amount,currency,status,created_at,in_escrow_at,out_for_delivery_at,delivered_at,released_at,refunded_at,cancelled_at,delivery_address,buyer_contact",
          )
          .eq("id", oid)
          .maybeSingle();
        if (!first.error) {
          o = first.data;
        } else if (String(first.error.message || "").includes("buyer_contact")) {
          const fallback = await supabase
            .from(ORDERS_TABLE)
            .select(
              "id,buyer_id,seller_id,listing_id,quantity,unit_price,amount,currency,status,created_at,in_escrow_at,out_for_delivery_at,delivered_at,released_at,refunded_at,cancelled_at,delivery_address",
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
              bProf = { id: pid, username: p.username ?? null, full_name: p.full_name ?? null };
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

      let latestPiPayment: PiPaymentRow | null = null;
      if (String((o as any)?.buyer_id || "") === user.id) {
        const { data: piRows } = await supabase
          .from("market_pi_payments")
          .select(
            "id,status,quote_ref,payment_id,txid,quote_expires_at,topup_pi_required,shortfall_usd,updated_at,created_at",
          )
          .eq("order_id", oid)
          .order("created_at", { ascending: false })
          .limit(1);
        latestPiPayment = ((piRows ?? [])[0] as PiPaymentRow | undefined) ?? null;
      }

      try {
        const ds = await listOrderDeliverables(oid);
        setDeliverables(ds);
      } catch (e: any) {
        console.log("[OrderDetails] deliverables skipped:", e?.message ?? e);
        setDeliverables([]);
      }

      try {
        const disputeThread = await fetchOrderDispute(oid);
        setDispute(disputeThread?.dispute ?? null);
        setDisputeMessages(disputeThread?.messages ?? []);
      } catch (e: any) {
        console.log("[OrderDetails] dispute thread skipped:", e?.message ?? e);
        setDispute(null);
        setDisputeMessages([]);
      }

      setOrder(o as any);
      setListing((l as any) ?? null);
      setSeller((s as any) ?? null);
      setBuyerProfile(bProf);
      setSellerProfileUsername(sellerUsernameFallback);
      setOtp((otpRow as any) ?? null);
      setIntents(((ints as any) ?? []) as CryptoIntent[]);
      setPiPayment(latestPiPayment);
    } catch (e: any) {
      setErr(friendlyMarketError(e, "We couldn't load this order."));
      setOrder(null);
      setListing(null);
      setSeller(null);
      setBuyerProfile(null);
      setSellerProfileUsername(null);
      setOtp(null);
      setIntents([]);
      setPiPayment(null);
      setDeliverables([]);
      setDispute(null);
      setDisputeMessages([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oid]);

  // ─── Real-time status notifications ───────────────────────────────────────────
  const prevOrderStatusRef = useRef<string | null>(null);
  useEffect(() => {
    if (!oid) return;
    const channel = supabase
      .channel(`order-realtime-${oid}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: ORDERS_TABLE,
          filter: `id=eq.${oid}`,
        },
        (payload) => {
          const next = (payload.new ?? {}) as OrderRow;
          const prevStatus = prevOrderStatusRef.current;
          const newStatus = String(next?.status ?? "").toUpperCase();
          setOrder((prev: any) => ({ ...(prev ?? {}), ...next }));
          prevOrderStatusRef.current = newStatus;

          // Show notifications for key status changes
          if (prevStatus && prevStatus !== newStatus) {
            if (newStatus === "DELIVERED") {
              Alert.alert(
                "Order Delivered!",
                "The seller has marked this order as delivered. You can now verify OTP and release funds.",
                [{ text: "Continue", onPress: () => {} }]
              );
            } else if (newStatus === "RELEASED") {
              Alert.alert(
                "Funds Released!",
                "Payment has been released from escrow. Thank you for your purchase.",
                [{ text: "OK", onPress: () => {} }]
              );
            } else if (newStatus === "OUT_FOR_DELIVERY") {
              Alert.alert(
                "Out for Delivery",
                "The seller is now processing your order. You can generate an OTP to confirm delivery.",
                [{ text: "Continue", onPress: () => {} }]
              );
            }
          }
        }
      )
      .subscribe();
    // Set initial status
    prevOrderStatusRef.current = String(order?.status ?? "").toUpperCase() || null;
    return () => { void supabase.removeChannel(channel); };
  }, [oid, order?.status]);

// ─── Real-time crypto intent updates ────────────────────────────────────────────
   useEffect(() => {
     if (!oid) return;
     const channel = supabase
       .channel(`order-intents-${oid}`)
       .on(
         "postgres_changes",
         {
           event: "INSERT",
           schema: "public",
           table: CRYPTO_INTENTS_TABLE,
           filter: `order_id=eq.${oid}`,
         },
         async () => {
           const { data } = await supabase
             .from(CRYPTO_INTENTS_TABLE)
             .select("*")
             .eq("order_id", oid);
           setIntents((data as CryptoIntent[]) || []);
         }
       )
       .on(
         "postgres_changes",
         {
           event: "UPDATE",
           schema: "public",
           table: CRYPTO_INTENTS_TABLE,
           filter: `order_id=eq.${oid}`,
         },
         async () => {
           const { data } = await supabase
             .from(CRYPTO_INTENTS_TABLE)
             .select("*")
             .eq("order_id", oid);
           setIntents((data as CryptoIntent[]) || []);
         }
       )
       .subscribe();
     return () => { void supabase.removeChannel(channel); };
   }, [oid]);

   // ─── Real-time deliverables updates ──────────────────────────────────────────────
   useEffect(() => {
     if (!oid) return;
     const channel = supabase
       .channel(`order-deliverables-${oid}`)
       .on(
         "postgres_changes",
         {
           event: "INSERT",
           schema: "public",
           table: "market_deliverables",
           filter: `order_id=eq.${oid}`,
         },
         async () => {
           try {
             const ds = await listOrderDeliverables(oid);
             setDeliverables(ds);
             if (isBuyer) {
               Alert.alert(
                 "Files Uploaded",
                 "Seller has uploaded deliverables for this order.",
                 [{ text: "View", onPress: () => {} }]
               );
             }
           } catch (e: any) {
             console.log("[Order] deliverables realtime refresh failed:", e?.message ?? e);
           }
         }
       )
       .on(
         "postgres_changes",
         {
           event: "UPDATE",
           schema: "public",
           table: "market_deliverables",
           filter: `order_id=eq.${oid}`,
         },
         async () => {
           try {
             const ds = await listOrderDeliverables(oid);
             setDeliverables(ds);
           } catch (e: any) {
             console.log("[Order] deliverables realtime refresh failed:", e?.message ?? e);
           }
         }
       )
       .subscribe();
     return () => { void supabase.removeChannel(channel); };
   }, [oid, isBuyer]);

   // ─── Real-time OTP updates ───────────────────────────────────────────────────────
   useEffect(() => {
     if (!oid) return;
     const channel = supabase
       .channel(`order-otp-${oid}`)
       .on(
         "postgres_changes",
         {
           event: "INSERT",
           schema: "public",
           table: OTP_TABLE,
           filter: `order_id=eq.${oid}`,
         },
         async () => {
           const { data: otpRow } = await supabase
             .from(OTP_TABLE)
             .select("order_id,expires_at,attempts,verified_at")
             .eq("order_id", oid)
             .maybeSingle();
           setOtp((otpRow as any) ?? null);
         }
       )
       .on(
         "postgres_changes",
         {
           event: "UPDATE",
           schema: "public",
           table: OTP_TABLE,
           filter: `order_id=eq.${oid}`,
         },
         async () => {
           const { data: otpRow } = await supabase
             .from(OTP_TABLE)
             .select("order_id,expires_at,attempts,verified_at")
             .eq("order_id", oid)
             .maybeSingle();
           setOtp((otpRow as any) ?? null);
         }
       )
       .subscribe();
     return () => { void supabase.removeChannel(channel); };
   }, [oid]);

   // ─── Real-time dispute updates ───────────────────────────────────────────────────
   useEffect(() => {
     if (!oid) return;
     const channel = supabase
       .channel(`order-dispute-${oid}`)
       .on(
         "postgres_changes",
         {
           event: "INSERT",
           schema: "public",
           table: "market_disputes",
           filter: `order_id=eq.${oid}`,
         },
         async () => {
           try {
             const disputeThread = await fetchOrderDispute(oid);
             setDispute(disputeThread?.dispute ?? null);
             setDisputeMessages(disputeThread?.messages ?? []);
             if (isBuyer || isSeller) {
               Alert.alert(
                 "Dispute Opened",
                 "A dispute has been opened for this order. Please review the details.",
                 [{ text: "Continue", onPress: () => {} }]
               );
             }
           } catch (e: any) {
             console.log("[Order] dispute realtime refresh failed:", e?.message ?? e);
           }
         }
       )
       .on(
         "postgres_changes",
         {
           event: "UPDATE",
           schema: "public",
           table: "market_disputes",
           filter: `order_id=eq.${oid}`,
         },
         async () => {
           try {
             const disputeThread = await fetchOrderDispute(oid);
             setDispute(disputeThread?.dispute ?? null);
             setDisputeMessages(disputeThread?.messages ?? []);
           } catch (e: any) {
             console.log("[Order] dispute realtime refresh failed:", e?.message ?? e);
           }
         }
       )
       .subscribe();
     return () => { void supabase.removeChannel(channel); };
   }, [oid, isBuyer, isSeller]);

   // ─── Real-time dispute message updates ─────────────────────────────────────────────
   useEffect(() => {
     if (!oid || !dispute?.id) return;
     const channel = supabase
       .channel(`order-dispute-messages-${dispute.id}`)
       .on(
         "postgres_changes",
         {
           event: "*",
           schema: "public",
           table: "market_dispute_messages",
           filter: `dispute_id=eq.${dispute.id}`,
         },
         async () => {
           try {
             const disputeThread = await fetchOrderDispute(oid);
             setDisputeMessages(disputeThread?.messages ?? []);
           } catch (e: any) {
             console.log("[Order] dispute messages realtime refresh failed:", e?.message ?? e);
           }
         }
       )
       .subscribe();
     return () => { void supabase.removeChannel(channel); };
   }, [oid, dispute?.id]);

  // ─── Auto-reindex effects (unchanged logic) ────────────────────────────────────
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
        const first = await supabase.functions
          .invoke("market-escrow-reindex", { body })
          .catch(() => null);
        if ((first?.data as any)?.applied !== true) {
          await supabase.functions
            .invoke("market-escrow-reindex", { body: { order_id: order.id } })
            .catch(() => null);
        }
        await load();
      } finally {
        autoSyncBusyRef.current = false;
      }
    };
    void run();
    const timer = setInterval(() => { void run(); }, 15000);
    return () => { alive = false; clearInterval(timer); };
  }, [awaitingConfirmations, order?.id, defaultDepositHash]);

  useEffect(() => {
    if (!order?.id) return;
    if (!isStableOrder) return;
    if (isPiRailOrder) return;
    if (String(order.status || "").toUpperCase() === "RELEASED") return;
    if (String(order.status || "").toUpperCase() === "REFUNDED") return;
    const settlementType = String(latestSettlementIntent?.intent_type || "").toUpperCase();
    const settlementStatus = String(latestSettlementIntent?.status || "").toUpperCase();
    const settlementTx = String(latestSettlementIntent?.tx_hash || "").trim();
    const settlementChain = String(latestSettlementIntent?.chain || "").trim();
    if (!["RELEASE", "REFUND"].includes(settlementType)) return;
    if (!["SUBMITTED", "CONFIRMED", "PROCESSING", "CREATED"].includes(settlementStatus)) return;
    if (!isHexHash(settlementTx) || !settlementChain) return;
    let alive = true;
    const run = async () => {
      if (!alive || autoSyncBusyRef.current) return;
      autoSyncBusyRef.current = true;
      try {
        try {
          await supabase.rpc(RPC_CHAIN_TX_FINALIZE, {
            p_order_id: order.id,
            p_chain: settlementChain,
            p_tx_hash: settlementTx,
            p_event_type: settlementType,
          });
        } catch { /* ignore */ }
        await load();
      } finally {
        autoSyncBusyRef.current = false;
      }
    };
    void run();
    const timer = setInterval(() => { void run(); }, 15000);
    return () => { alive = false; clearInterval(timer); };
  }, [
    order?.id,
    order?.status,
    isStableOrder,
    isPiRailOrder,
    latestSettlementIntent?.intent_type,
    latestSettlementIntent?.status,
    latestSettlementIntent?.tx_hash,
    latestSettlementIntent?.chain,
  ]);

  // ─── Action handlers (all original logic preserved) ───────────────────────────
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
      const expiresAt = (data as any)?.expires_at
        ? new Date((data as any).expires_at).getTime()
        : 0;
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
        Alert.alert(
          "Delivery OTP",
          `Share this OTP with the seller when ready to confirm delivery:\n\n${otpCode}`,
        );
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
      const { error } = await supabase.rpc(RPC_OTP_VERIFY, {
        p_order_id: order.id,
        p_otp: code,
      });
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

  function prepareDispute() {
    if (!canUseDisputeCenter) {
      setDisputeErr("Disputes can be opened after payment enters escrow.");
      return;
    }
    setDisputeErr("Describe what happened in the Dispute center, then submit it to admin.");
    if (!disputeText.trim()) {
      setDisputeText(
        isSeller ? "I need admin review because " : "I need a refund/admin review because ",
      );
    }
    if (isDesktop) {
      setActiveTab("Dispute");
    }
  }

  async function pickDisputeFiles() {
    if (!order) return;
    setDisputeErr(null);
    try {
      const DocumentPicker = await import("expo-document-picker");
      const res = await DocumentPicker.getDocumentAsync({
        multiple: true,
        copyToCacheDirectory: true,
        type: "*/*",
      });
      if (res.canceled) return;
      const picked: DisputeLocalFile[] = (res.assets ?? [])
        .filter((asset: any) => !!asset?.uri)
        .slice(0, 8)
        .map((asset: any) => ({
          uri: asset.uri,
          name: asset.name ?? `dispute-proof-${Date.now()}`,
          mimeType: asset.mimeType ?? null,
          size: typeof asset.size === "number" ? asset.size : null,
          fileBody: asset.file ?? null,
        }));
      if (!picked.length) return;
      setDisputeFiles((prev) => [...prev, ...picked].slice(0, 8));
    } catch (e: any) {
      setDisputeErr(friendlyMarketError(e, "We couldn't attach that proof."));
    }
  }

  function removeDisputeFile(index: number) {
    setDisputeFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function openDisputeAttachment(attachment: any) {
    try {
      const bucket = String(attachment?.storage_bucket || "market-disputes");
      const path = String(attachment?.storage_path || "");
      let url = String(attachment?.signed_url || attachment?.public_url || "");
      if (!url && path) {
        const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
        if (error) throw error;
        url = String(data?.signedUrl || "");
      }
      if (url) await Linking.openURL(url);
    } catch (e: any) {
      setDisputeErr(friendlyMarketError(e, "We couldn't open this proof."));
    }
  }

  async function submitDisputeStatement() {
    if (!order || (!isBuyer && !isSeller)) return;
    if (!canUseDisputeCenter || disputeClosed) {
      setDisputeErr(
        disputeClosed
          ? "This dispute has already been resolved."
          : "Disputes can be opened after payment enters escrow.",
      );
      return;
    }
    const body = disputeText.trim();
    if (!body && !disputeFiles.length) {
      setDisputeErr("Explain what happened or attach proof before sending.");
      return;
    }
    setDisputeBusy(true);
    setDisputeErr(null);
    setErr(null);
    try {
      const senderKind = isSeller ? "SELLER" : "BUYER";
      if (dispute?.id) {
        const next = await sendDisputeMessage({
          disputeId: dispute.id,
          orderId: order.id,
          senderKind,
          body,
          attachments: disputeFiles,
        });
        setDispute(next?.dispute ?? dispute);
        setDisputeMessages(next?.messages ?? []);
      } else {
        const summary = `${isSeller ? "Seller" : "Buyer"} complaint: ${body || "Proof attached"}`;
        const next = await openOrderDispute({
          orderId: order.id,
          senderKind,
          reason: summary,
          body,
          attachments: disputeFiles,
        });
        setDispute(next?.dispute ?? null);
        setDisputeMessages(next?.messages ?? []);
      }
      setDisputeText("");
      setDisputeFiles([]);
      await load();
    } catch (e: any) {
      setDisputeErr(friendlyMarketError(e, "We couldn't send this dispute update."));
    } finally {
      setDisputeBusy(false);
    }
  }

  async function cancelOrder() {
    if (!order || busy) return;
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
      if (txHash && !isHexHash(txHash))
        throw new Error("Enter a valid transaction hash or UserOp hash.");

      const { data: esc } = await supabase
        .from("market_crypto_escrows")
        .select("chain")
        .eq("order_id", order.id)
        .maybeSingle();

      const chainName = String(
        (esc as any)?.chain || latestDepositIntent?.chain || "",
      ).trim();
      let finalizeData: any = null;

      if (chainName && txHash) {
        const { data, error } = await supabase.functions.invoke("market-chain-tx-finalize", {
          body: { order_id: order.id, chain: chainName, tx_hash: txHash, event_type: "DEPOSIT" },
        });
        if (error) {
          console.log("[Order] chain finalize function failed", String(error.message || error));
        } else {
          finalizeData = data;
          if ((data as any)?.finalized === true) {
            Alert.alert("Deposit confirmed", "Order moved to escrow.");
            await load();
            setReindexOpen(false);
            return;
          }
          const confirmations = Number((data as any)?.confirmations ?? NaN);
          const required = Number((data as any)?.required ?? NaN);
          if (
            Number.isFinite(confirmations) &&
            Number.isFinite(required) &&
            confirmations < required
          ) {
            Alert.alert(
              "Awaiting confirmations",
              `Confirmations: ${confirmations}/${required}\n\nTry again in a few minutes.`,
            );
            return;
          }
        }
      }

      let { data: reindexData, error: reindexErr } = await supabase.functions.invoke(
        "market-escrow-reindex",
        { body: { order_id: order.id, ...(txHash ? { tx_hash: txHash } : {}) } },
      );
      if (reindexErr) throw new Error(reindexErr.message || "Deposit resync failed.");
      if ((reindexData as any)?.applied !== true) {
        const retry = await supabase.functions.invoke("market-escrow-reindex", {
          body: { order_id: order.id },
        });
        if (!retry.error && retry.data) {
          reindexData = retry.data;
        }
      }

      await load();
      const { data: fresh } = await supabase
        .from(ORDERS_TABLE)
        .select("status")
        .eq("id", order.id)
        .maybeSingle();
      if (
        String((fresh as any)?.status || "").toUpperCase() === "IN_ESCROW" ||
        (reindexData as any)?.applied === true
      ) {
        Alert.alert("Deposit confirmed", "Order moved to escrow.");
        setReindexOpen(false);
        return;
      }

      const pending = String(
        (reindexData as any)?.pending || (finalizeData as any)?.reason || "",
      ).trim();
      if (pending === "event_not_found_yet") {
        throw new Error(
          "Deposit was not found yet. If you pasted the approval transaction, wait for the escrow deposit transaction and retry.",
        );
      }
      if (pending === "receipt") {
        throw new Error("Transaction receipt is not ready yet. Wait a minute and retry.");
      }
      throw new Error("Deposit is not finalized yet. Wait a minute and retry resync.");
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
      openPreview({
        kind: "link",
        access: d.access,
        title: d.title ?? "Website preview",
        url,
      });
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
      const rawName = String(
        (d.meta as any)?.originalName || d.title || `deliverable-${d.id}` || "",
      ).trim();
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
      prepareDispute();
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

  async function runOrderRiskCheck() {
    if (!order?.id) return;
    setRiskBusy(true);
    setErr(null);
    try {
      const result = await generateOrderAiRisk(order.id);
      setRiskResult(result);
    } catch (e: any) {
      setErr(friendlyMarketError(e, "We couldn't run the order risk check."));
    } finally {
      setRiskBusy(false);
    }
  }

  async function pickAndUpload(access: "preview" | "final") {
    if (!order) return;
    if (!isSeller) {
      setUploadErr("Only the seller can upload deliverables for this order.");
      return;
    }
    if (!canSellerUpload) {
      setUploadErr(
        `Upload is only allowed while order is in escrow/delivery. Current status: ${order.status}`,
      );
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
      const kind = guessKindFromMime(mime, name);
      const bucket = "market-deliverables";
      const safeName = name.replace(/[^\w.\-]+/g, "_");
      const path = `orders/${order.id}/${access}/${Date.now()}-${safeName}`;
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
      try {
        await insertFileDeliverable({
          orderId: order.id,
          access,
          kind,
          title: access === "preview" ? `Preview: ${name}` : `Full: ${name}`,
          sortOrder: access === "preview" ? previewItems.length : finalItems.length,
          bucket,
          storagePath: uploaded.storagePath,
          mimeType: mime,
          meta: {
            note:
              access === "preview"
                ? "Low quality / watermarked recommended"
                : "Full quality",
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

  // ─── Layout helpers ───────────────────────────────────────────────────────────
  const showTabs = isDesktop && !!order;

  // ─── Shared panel components ──────────────────────────────────────────────────
  const summaryPanel = order ? (
    <OrderSummaryPanel
      order={order}
      listing={listing}
      seller={seller}
      isBuyer={isBuyer}
      isSeller={isSeller}
    />
  ) : null;

  const timelinePanel = order ? (
    <PanelCard>
      <SectionLabel text="Order Timeline" />
      <View style={{ marginTop: 14 }}>
        <OrderStatusTimeline order={order} />
      </View>
    </PanelCard>
  ) : null;

  const counterpartyPanel = order ? (
    <CounterpartyPanel
      isBuyer={isBuyer}
      isSeller={isSeller}
      seller={seller}
      buyerProfile={buyerProfile}
      order={order}
      counterpartyUsername={counterpartyUsername}
      counterpartyName={counterpartyName}
      counterpartyLabel={counterpartyLabel}
      counterpartyHandleHint={counterpartyHandleHint}
      canOrderChat={canOrderChat}
      onChat={openOrderChat}
    />
  ) : null;

  const cryptoPanel = order ? (
    <CryptoActivityPanel
      intents={intents}
      piPayment={piPayment}
      order={order}
      isBuyer={isBuyer}
      awaitingConfirmations={awaitingConfirmations}
      canResyncDeposit={canResyncDeposit}
      pollRemainingSec={pollRemainingSec}
      defaultDepositTx={defaultDepositTx}
      defaultDepositRef={defaultDepositRef}
      defaultDepositHash={defaultDepositHash}
      busy={busy}
      onResyncDeposit={() => {
        if (defaultDepositHash) {
          setReindexTx(defaultDepositHash);
          void reindexDeposit();
        } else {
          void load();
        }
      }}
      onOpenResync={() => {
        setReindexTx(defaultDepositHash);
        setReindexOpen(true);
      }}
    />
  ) : null;

  const deliverablesPanel = order ? (
    <DeliverablesPanel
      isBuyer={isBuyer}
      isSeller={isSeller}
      canSellerUpload={canSellerUpload}
      canDownloadFinal={canDownloadFinal}
      deliverables={deliverables}
      listing={listing}
      uploadBusy={uploadBusy}
      uploadErr={uploadErr}
      onPickUpload={pickAndUpload}
      onPreview={previewDeliverable}
      onDownload={downloadDeliverable}
      orderStatus={order?.status}
    />
  ) : null;

  const disputePanel = order ? (
    <DisputePanel
      dispute={dispute}
      disputeMessages={disputeMessages}
      disputeText={disputeText}
      disputeFiles={disputeFiles}
      disputeBusy={disputeBusy}
      disputeErr={disputeErr}
      canUseDisputeCenter={canUseDisputeCenter}
      disputeClosed={disputeClosed}
      disputeRoleLabel={disputeRoleLabel}
      me={me}
      onChangeText={setDisputeText}
      onPickFiles={pickDisputeFiles}
      onRemoveFile={removeDisputeFile}
      onSubmit={submitDisputeStatement}
      onOpenAttachment={openDisputeAttachment}
    />
  ) : null;

  const aiRiskPanel = order ? (
    <AiRiskPanel
      riskResult={riskResult}
      riskBusy={riskBusy}
      isBuyer={isBuyer}
      onRun={runOrderRiskCheck}
    />
  ) : null;

  const policyPanels = order ? (
    <>
      <MarketPolicyPanel
        title="Order guidance"
        blocks={orderPolicy.status_guidance}
        emptyText={orderPolicyLoading ? "Loading policy…" : ""}
        onAction={(action) => { void onPolicyAction(action); }}
      />
      <MarketPolicyPanel
        title="Progress"
        blocks={orderPolicy.progress}
        emptyText={orderPolicyLoading ? "Loading policy…" : ""}
      />
      <MarketPolicyPanel
        title="Safety and complaints"
        blocks={orderPolicy.safety}
        emptyText={orderPolicyLoading ? "Loading policy…" : ""}
        onAction={(action) => { void onPolicyAction(action); }}
      />
    </>
  ) : null;

  const buyerView = order && isBuyer ? (
    <BuyerOrderView
      order={order}
      listing={listing}
      seller={seller}
      otp={otp}
      otpVerified={otpVerified}
      otpExpiryRemainingSec={otpExpiryRemainingSec}
      otpCooldownRemainingSec={otpCooldownRemainingSec}
      hasPendingUnexpiredOtp={hasPendingUnexpiredOtp}
      canGenerateOtpNow={canGenerateOtpNow}
      canRelease={canRelease}
      canGoCheckout={canGoCheckout}
      canCancel={canCancel}
      canReviewListingFromOrder={canReviewListingFromOrder}
      isPiRailOrder={isPiRailOrder}
      latestPiPaymentStatus={latestPiPaymentStatus}
      generatedOtpCode={generatedOtpCode}
      busy={busy}
      err={err}
      onRequestOTP={requestOTP}
      onReleaseFunds={releaseFunds}
      onGoCheckout={() => router.push(`/market/checkout/${order.id}` as any)}
      onCancelOrder={cancelOrder}
      onReviewListing={() => router.push(`/market/listing/${order.listing_id}` as any)}
      onPrepareDispute={prepareDispute}
    />
  ) : null;

  const sellerView = order && isSeller ? (
    <SellerOrderView
      order={order}
      otp={otp}
      otpVerified={otpVerified}
      otpInput={otpInput}
      setOtpInput={setOtpInput}
      canOutForDelivery={canOutForDelivery}
      canVerifyOtp={canVerifyOtp}
      busy={busy}
      err={err}
      onOutForDelivery={doOutForDelivery}
      onVerifyOTP={verifyOTP}
      onPrepareDispute={prepareDispute}
    />
  ) : null;

  // Pi completion alert (buyer)
  const piCompletionAlert = awaitingPiCompletion && order ? (
    <PanelCard accent="amber">
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <ActivityIndicator size="small" color={AMBER} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: AMBER, fontWeight: "900", fontSize: 13 }}>
            Waiting for Pi payment completion
          </Text>
          <Text style={{ color: MUTED, fontSize: 12, marginTop: 2 }}>
            Pi Browser finished the payment? Refresh to sync.
          </Text>
        </View>
      </View>
      {piPayment?.payment_id ? (
        <Text style={{ color: FAINT, fontSize: 11, marginTop: 8 }}>
          ID: {piPayment.payment_id}
        </Text>
      ) : null}
      <View style={{ marginTop: 12 }}>
        <OutlineBtn label="Refresh status" icon="refresh-outline" color="amber" busy={busy} onPress={() => void load()} />
      </View>
    </PanelCard>
  ) : null;

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <LinearGradient
      colors={[BG2, BG1, BG0]}
      start={{ x: 0.15, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={{ flex: 1, paddingTop: Math.max(insets.top, 14) }}
    >
      {/* ── Header ────────────────────────────────────────────────────────────── */}
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
            style={{
              width: 42,
              height: 42,
              borderRadius: 14,
              backgroundColor: CARD,
              borderWidth: 1,
              borderColor: BORDER,
              borderTopColor: BORDER_TOP,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="arrow-back" size={20} color={TEXT} />
          </Pressable>

          <View style={{ flex: 1 }}>
            <Text
              style={{
                color: TEXT,
                fontSize: isTablet ? 22 : 18,
                fontWeight: "900",
                letterSpacing: -0.3,
              }}
            >
              Order details
            </Text>
            <Text style={{ color: MUTED, fontSize: 12, fontWeight: "700", marginTop: 2 }}>
              {isBuyer ? "Buyer" : isSeller ? "Seller" : "Loading"} · Escrow-protected
            </Text>
          </View>

          {order ? (
            <View style={{ alignItems: "flex-end", gap: 6 }}>
              <StatusBadge status={order.status} />
              <Text style={{ color: AMBER, fontWeight: "900", fontSize: 14 }}>
                {money(order.currency, order.amount)}
              </Text>
            </View>
          ) : null}
        </View>

        {/* ── Desktop tab bar ─────────────────────────────────────────────────── */}
        {showTabs ? (
          <View
            style={{
              flexDirection: "row",
              gap: 4,
              marginTop: 14,
              maxWidth: contentMaxWidth,
              alignSelf: "center",
              width: "100%",
              borderBottomWidth: 1,
              borderBottomColor: BORDER,
              paddingBottom: 0,
            }}
          >
            {TABS.map((tab) => {
              const isActive = activeTab === tab;
              return (
                <Pressable
                  key={tab}
                  onPress={() => setActiveTab(tab)}
                  style={{
                    paddingHorizontal: 16,
                    paddingVertical: 10,
                    borderBottomWidth: 2,
                    borderBottomColor: isActive ? AMBER : "transparent",
                    marginBottom: -1,
                  }}
                >
                  <Text
                    style={{
                      color: isActive ? AMBER : MUTED,
                      fontWeight: isActive ? "900" : "700",
                      fontSize: 13,
                    }}
                  >
                    {tab}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </View>

      {/* ── Body ──────────────────────────────────────────────────────────────── */}
      <ScrollView
        contentContainerStyle={{
          paddingBottom: 120,
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
          {/* Loading */}
          {loading ? (
            <View
              style={{
                marginTop: 60,
                alignItems: "center",
                gap: 16,
              }}
            >
              <View
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 20,
                  backgroundColor: CARD_RAISED,
                  borderWidth: 1,
                  borderColor: BORDER,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <ActivityIndicator color={AMBER} size="large" />
              </View>
              <Text style={{ color: MUTED, fontWeight: "700", fontSize: 14, letterSpacing: 0.4 }}>
                Loading order…
              </Text>
            </View>
          ) : !order ? (
            <PanelCard style={{ marginTop: 18 }}>
              <Text style={{ color: TEXT, fontWeight: "900", fontSize: 17 }}>Order not found</Text>
              {!!err && (
                <Text style={{ marginTop: 8, color: MUTED, lineHeight: 20 }}>{err}</Text>
              )}
              <View style={{ marginTop: 18 }}>
                <ActionBtn
                  label="Go back"
                  color="ghost"
                  onPress={() => router.back()}
                  icon="arrow-back-outline"
                />
              </View>
            </PanelCard>
          ) : (
            <>
              {/* ─── DESKTOP TWO-COLUMN LAYOUT ──────────────────────────────── */}
              {isDesktop ? (
                <View style={{ flexDirection: "row", gap: 20, marginTop: 10, alignItems: "flex-start" }}>
                  {/* ── Left / main column ────────────────────────────────────── */}
                  <View style={{ flex: 1.5, gap: 14 }}>
                    {/* Tab content */}
                    {activeTab === "Overview" ? (
                      <>
                        {isBuyer ? buyerView : null}
                        {isSeller ? sellerView : null}
                        {piCompletionAlert}
                        {policyPanels}
                      </>
                    ) : null}

                    {activeTab === "Payment" ? (
                      <>
                        {cryptoPanel}
                      </>
                    ) : null}

                    {activeTab === "Files" ? (
                      <>
                        {deliverablesPanel}
                      </>
                    ) : null}

                    {activeTab === "Dispute" ? (
                      <>
                        {disputePanel}
                      </>
                    ) : null}

                    {activeTab === "Activity" ? (
                      <>
                        {timelinePanel}
                        {aiRiskPanel}
                      </>
                    ) : null}

                    {/* Refresh */}
                    <OutlineBtn
                      label="Refresh order"
                      icon="refresh-outline"
                      color="ghost"
                      busy={busy}
                      onPress={() => void load()}
                    />
                  </View>

                  {/* ── Right sidebar ─────────────────────────────────────────── */}
                  <View style={{ width: 340, gap: 14 }}>
                    {summaryPanel}
                    {counterpartyPanel}
                    {/* Quick links to other tabs */}
                    <PanelCard>
                      <SectionLabel text="Quick Actions" color={FAINT} />
                      <View style={{ marginTop: 12, gap: 8 }}>
                        {["Payment", "Files", "Dispute", "Activity"].map((tab) => (
                          <Pressable
                            key={tab}
                            onPress={() => setActiveTab(tab as TabKey)}
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              justifyContent: "space-between",
                              paddingVertical: 10,
                              paddingHorizontal: 12,
                              borderRadius: 12,
                              backgroundColor: activeTab === tab ? AMBER_GLASS : CARD_RAISED,
                              borderWidth: 1,
                              borderColor: activeTab === tab ? AMBER_BORDER : BORDER,
                            }}
                          >
                            <Text
                              style={{
                                color: activeTab === tab ? AMBER : MUTED,
                                fontWeight: "800",
                                fontSize: 13,
                              }}
                            >
                              {tab}
                            </Text>
                            <Ionicons
                              name="chevron-forward"
                              size={14}
                              color={activeTab === tab ? AMBER : FAINT}
                            />
                          </Pressable>
                        ))}
                      </View>
                    </PanelCard>
                  </View>
                </View>
              ) : (
                // ─── MOBILE / TABLET SINGLE-COLUMN LAYOUT ──────────────────────
                <View style={{ marginTop: 10, gap: 12 }}>
                  {summaryPanel}

                  {/* Role-specific primary action */}
                  {isBuyer ? buyerView : null}
                  {isSeller ? sellerView : null}

                  {piCompletionAlert}

                  {/* Timeline */}
                  {timelinePanel}

                  {/* Policy */}
                  {policyPanels}

                  {/* Counterparty */}
                  {counterpartyPanel}

                  {/* Crypto */}
                  {cryptoPanel}

                  {/* Deliverables */}
                  {deliverablesPanel}

                  {/* AI Risk */}
                  {aiRiskPanel}

                  {/* Dispute */}
                  {disputePanel}

                  {/* Refresh */}
                  <OutlineBtn
                    label="Refresh order"
                    icon="refresh-outline"
                    color="ghost"
                    busy={busy}
                    onPress={() => void load()}
                  />
                </View>
              )}
            </>
          )}
        </View>
      </ScrollView>

      {/* ── Sticky checkout bar (mobile buyer only) ───────────────────────────── */}
      {!isDesktop && order && isBuyer && canGoCheckout ? (
        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            paddingBottom: Math.max(insets.bottom, 16),
            paddingTop: 12,
            paddingHorizontal: sidePadding,
            backgroundColor: "rgba(6,8,7,0.96)",
            borderTopWidth: 1,
            borderTopColor: BORDER,
          }}
        >
          <ActionBtn
            label={
              isPiRailOrder
                ? latestPiPaymentStatus === "UNDERPAID"
                  ? "Retry Pi top-up"
                  : "Continue Pi checkout"
                : "Continue to checkout"
            }
            sublabel="Escrow protected · Complete payment"
            color="amber"
            icon="arrow-forward-outline"
            onPress={() => router.push(`/market/checkout/${order.id}` as any)}
          />
        </View>
      ) : null}

      {/* ── Sticky release bar (mobile buyer only) ────────────────────────────── */}
      {!isDesktop && order && isBuyer && canRelease && !canGoCheckout ? (
        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            paddingBottom: Math.max(insets.bottom, 16),
            paddingTop: 12,
            paddingHorizontal: sidePadding,
            backgroundColor: "rgba(6,8,7,0.96)",
            borderTopWidth: 1,
            borderTopColor: BORDER,
          }}
        >
          <ActionBtn
            label={busy ? "Releasing…" : "Release funds to seller"}
            sublabel="OTP verified · Escrow release"
            color="green"
            icon="shield-checkmark-outline"
            disabled={!canRelease}
            busy={busy}
            onPress={releaseFunds}
          />
        </View>
      ) : null}

      {/* ── Reindex modal ─────────────────────────────────────────────────────── */}
      <Modal
        visible={reindexOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setReindexOpen(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.7)",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <View
            style={{
              width: "100%",
              maxWidth: 520,
              alignSelf: "center",
              borderRadius: 24,
              padding: 20,
              backgroundColor: BG1,
              borderWidth: 1,
              borderColor: BORDER,
              borderTopColor: BORDER_TOP,
            }}
          >
            <Text style={{ color: TEXT, fontWeight: "900", fontSize: 17 }}>Resync deposit</Text>
            <Text style={{ marginTop: 6, color: MUTED, fontSize: 13, lineHeight: 19 }}>
              Paste the deposit transaction hash or leave blank to scan this order on-chain.
            </Text>
            <TextInput
              value={reindexTx}
              onChangeText={setReindexTx}
              placeholder="0x… (optional)"
              placeholderTextColor="rgba(255,253,247,0.32)"
              autoCapitalize="none"
              style={{
                marginTop: 14,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: BORDER,
                color: TEXT,
                backgroundColor: CARD_RAISED,
                paddingHorizontal: 14,
                paddingVertical: 12,
                fontSize: 14,
              }}
            />
            <View style={{ marginTop: 16, flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <OutlineBtn
                  label="Cancel"
                  color="ghost"
                  onPress={() => setReindexOpen(false)}
                />
              </View>
              <View style={{ flex: 1 }}>
                <ActionBtn
                  label={busy ? "Working…" : "Resync"}
                  color="amber"
                  busy={busy}
                  onPress={reindexDeposit}
                />
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Preview modal ─────────────────────────────────────────────────────── */}
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