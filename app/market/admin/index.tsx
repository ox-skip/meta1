import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { supabase } from "@/services/supabase";
import {
  clearAdminSessionToken,
  hasStoredAdminSession,
  loadAdminOverview,
  loadAdminWorkspace,
  loginAdmin,
  logoutAdmin,
  runAdminAction,
  type MarketAdminOverview,
  type MarketAdminWorkspace,
} from "@/services/market/admin";

const BG0 = "#0A0F1A";
const BG1 = "#122033";
const PANEL = "rgba(12,18,30,0.92)";
const PANEL_ALT = "rgba(255,255,255,0.05)";
const BORDER = "rgba(96,165,250,0.24)";
const TEXT = "#EAF2FF";
const MUTED = "rgba(234,242,255,0.7)";
const ACCENT = "#60A5FA";
const SUCCESS = "#34D399";
const WARNING = "#FBBF24";
const DANGER = "#F87171";

type ModuleKey = "support" | "moderation" | "verification" | "escrow";

function shortId(value?: string | null) {
  const id = String(value ?? "");
  return id.length > 10 ? `${id.slice(0, 8)}...${id.slice(-4)}` : id || "n/a";
}

function formatDate(value?: string | null) {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function money(amount?: unknown, currency?: unknown) {
  const n = Number(amount ?? 0);
  const c = String(currency ?? "").trim() || "NGN";
  return `${Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 6 }) : "0"} ${c}`;
}

function labelFromKey(key: string) {
  return key.replace(/_/g, " ");
}

function personLabel(user: any) {
  return (
    user?.seller?.business_name ||
    user?.seller?.display_name ||
    user?.seller?.market_username ||
    user?.profile?.full_name ||
    user?.profile?.username ||
    user?.profile?.email ||
    shortId(user?.id)
  );
}

function statusTone(status?: unknown) {
  const s = String(status ?? "").toUpperCase();
  if (["ACTIVE", "VERIFIED", "RELEASED", "RESOLVED", "SETTLED", "CONFIRMED"].includes(s)) return SUCCESS;
  if (["PENDING", "IN_REVIEW", "UNDER_REVIEW", "IN_ESCROW", "PROCESSING", "SUBMITTED"].includes(s)) return WARNING;
  if (["REJECTED", "REFUNDED", "DISPUTED", "FAILED", "CANCELLED", "EXPIRED"].includes(s)) return DANGER;
  return ACCENT;
}

function ActionButton({
  icon,
  label,
  color,
  onPress,
  loading,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  const blocked = disabled || loading;
  return (
    <Pressable
      disabled={blocked}
      onPress={onPress}
      style={{
        opacity: blocked ? 0.55 : 1,
        borderRadius: 16,
        paddingHorizontal: 14,
        paddingVertical: 12,
        backgroundColor: `${color}18`,
        borderWidth: 1,
        borderColor: `${color}30`,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
      }}
    >
      {loading ? <ActivityIndicator color={color} /> : <Ionicons name={icon} size={16} color={color} />}
      <Text style={{ color, fontWeight: "900", fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <View style={{ borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: `${color}18`, borderWidth: 1, borderColor: `${color}35` }}>
      <Text style={{ color, fontWeight: "900", fontSize: 11 }}>{label}</Text>
    </View>
  );
}

function InfoLine({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <View style={{ flex: 1, minWidth: 150 }}>
      <Text style={{ color: "rgba(234,242,255,0.48)", fontSize: 11, fontWeight: "900", textTransform: "uppercase" }}>{label}</Text>
      <Text style={{ marginTop: 4, color: TEXT, fontSize: 13, fontWeight: "800" }}>{value}</Text>
    </View>
  );
}

function RecordCard({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ borderRadius: 20, padding: 16, backgroundColor: PANEL_ALT, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" }}>
      {children}
    </View>
  );
}

function EmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <View style={{ borderRadius: 20, padding: 18, backgroundColor: PANEL_ALT, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" }}>
      <Text style={{ color: TEXT, fontWeight: "900", fontSize: 16 }}>{title}</Text>
      <Text style={{ marginTop: 6, color: MUTED, fontSize: 13, lineHeight: 20 }}>{subtitle}</Text>
    </View>
  );
}

export default function MarketAdminIndex() {
  const insets = useSafeAreaInsets();
  const [booting, setBooting] = useState(true);
  const [checkingSession, setCheckingSession] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [membershipOk, setMembershipOk] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<MarketAdminOverview | null>(null);
  const [workspace, setWorkspace] = useState<MarketAdminWorkspace | null>(null);
  const [activeModule, setActiveModule] = useState<ModuleKey | null>(null);
  const [actionNote, setActionNote] = useState("");
  const [workingKey, setWorkingKey] = useState<string | null>(null);

  const visibleModules = useMemo(() => {
    const permissions = overview?.admin.permissions ?? [];
    return (overview?.modules ?? []).filter((module) => permissions.includes(module.permission) || overview?.admin.role_key === "super_admin");
  }, [overview]);

  const currentModule = (activeModule ?? visibleModules[0]?.key ?? "support") as ModuleKey;

  function hasPermission(permission: string) {
    const admin = overview?.admin;
    return Boolean(admin?.role_key === "super_admin" || admin?.permissions.includes("*") || admin?.permissions.includes(permission));
  }

  async function loadUnlockedDashboard() {
    setCheckingSession(true);
    const [nextOverview, nextWorkspace] = await Promise.all([loadAdminOverview(), loadAdminWorkspace()]);
    setOverview(nextOverview);
    setWorkspace(nextWorkspace);

    const permissions = nextOverview.admin.permissions ?? [];
    const nextVisible = nextOverview.modules.filter((module) => permissions.includes(module.permission) || nextOverview.admin.role_key === "super_admin");
    setActiveModule((prev) => (prev && nextVisible.some((module) => module.key === prev) ? prev : ((nextVisible[0]?.key ?? null) as ModuleKey | null)));
    setCheckingSession(false);
  }

  async function checkMembershipAndMaybeLoad() {
    setError(null);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user) {
        router.replace("/(auth)/login" as any);
        return;
      }

      const { data: member, error: memberErr } = await supabase
        .from("market_admin_users")
        .select("user_id,role_key,is_active")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .maybeSingle();

      if (memberErr || !member) {
        setMembershipOk(false);
        setOverview(null);
        setWorkspace(null);
        await clearAdminSessionToken();
        return;
      }

      setMembershipOk(true);
      if (!(await hasStoredAdminSession())) {
        setOverview(null);
        setWorkspace(null);
        return;
      }

      await loadUnlockedDashboard();
    } catch (e: any) {
      setError(String(e?.message || e || "Unable to load admin dashboard."));
      setOverview(null);
      setWorkspace(null);
    } finally {
      setCheckingSession(false);
      setBooting(false);
    }
  }

  useEffect(() => {
    checkMembershipAndMaybeLoad();
  }, []);

  async function onUnlock() {
    setSubmitting(true);
    setError(null);
    try {
      await loginAdmin(password);
      setPassword("");
      await loadUnlockedDashboard();
    } catch (e: any) {
      setError(String(e?.message || e || "Admin login failed."));
    } finally {
      setSubmitting(false);
      setCheckingSession(false);
    }
  }

  async function onLogout() {
    setCheckingSession(true);
    setError(null);
    try {
      await logoutAdmin();
      setOverview(null);
      setWorkspace(null);
    } catch (e: any) {
      setError(String(e?.message || e || "Admin logout failed."));
    } finally {
      setCheckingSession(false);
    }
  }

  async function performAction(actionKey: string, body: Record<string, unknown>, destructive = false) {
    const execute = async () => {
      setWorkingKey(actionKey);
      setError(null);
      try {
        await runAdminAction({ ...body, note: actionNote });
        setActionNote("");
        await loadUnlockedDashboard();
      } catch (e: any) {
        setError(String(e?.message || e || "Admin action failed."));
      } finally {
        setWorkingKey(null);
        setCheckingSession(false);
      }
    };

    if (!destructive) {
      await execute();
      return;
    }

    Alert.alert("Confirm admin action", "This will change live marketplace data.", [
      { text: "Cancel", style: "cancel" },
      { text: "Confirm", style: "destructive", onPress: execute },
    ]);
  }

  function renderModuleTabs() {
    return (
      <View style={{ marginTop: 18, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {visibleModules.map((module) => {
          const selected = currentModule === module.key;
          return (
            <Pressable
              key={module.key}
              onPress={() => setActiveModule(module.key as ModuleKey)}
              style={{
                borderRadius: 999,
                paddingHorizontal: 14,
                paddingVertical: 10,
                backgroundColor: selected ? "rgba(96,165,250,0.22)" : PANEL_ALT,
                borderWidth: 1,
                borderColor: selected ? "rgba(96,165,250,0.55)" : "rgba(255,255,255,0.08)",
              }}
            >
              <Text style={{ color: selected ? TEXT : MUTED, fontWeight: "900", fontSize: 12 }}>{module.title}</Text>
            </Pressable>
          );
        })}
      </View>
    );
  }

  function renderActionNote() {
    return (
      <View style={{ marginTop: 16 }}>
        <TextInput
          value={actionNote}
          onChangeText={setActionNote}
          placeholder="Optional admin note for the next action"
          placeholderTextColor="rgba(234,242,255,0.38)"
          multiline
          style={{
            minHeight: 74,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.12)",
            backgroundColor: PANEL_ALT,
            color: TEXT,
            paddingHorizontal: 14,
            paddingVertical: 12,
            fontSize: 14,
            textAlignVertical: "top",
          }}
        />
      </View>
    );
  }

  function renderSupport() {
    const disputes = workspace?.modules.support?.disputes ?? [];
    const canResolve = hasPermission("disputes.resolve");

    return (
      <View style={{ marginTop: 18, gap: 12 }}>
        {renderActionNote()}
        {disputes.length ? disputes.map((dispute: any) => {
          const order = dispute.order ?? {};
          const currency = String(order.currency ?? "").toUpperCase();
          const needsEscrowPower = ["USDC", "USDT"].includes(currency) && !hasPermission("escrow.settle");
          return (
            <RecordCard key={dispute.id}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <View style={{ flex: 1, minWidth: 220 }}>
                  <Text style={{ color: TEXT, fontWeight: "900", fontSize: 17 }}>{dispute.listing?.title ?? "Disputed order"}</Text>
                  <Text style={{ marginTop: 6, color: MUTED, fontSize: 13, lineHeight: 20 }}>{dispute.reason}</Text>
                </View>
                <Pill label={String(dispute.status ?? "OPEN")} color={statusTone(dispute.status)} />
              </View>

              <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                <InfoLine label="Order" value={`${shortId(dispute.order_id)} - ${order.status ?? "n/a"}`} />
                <InfoLine label="Amount" value={money(order.amount, order.currency)} />
                <InfoLine label="Buyer" value={personLabel(dispute.buyer)} />
                <InfoLine label="Seller" value={personLabel(dispute.seller)} />
                <InfoLine label="Opened" value={formatDate(dispute.created_at)} />
                <InfoLine label="Evidence" value={dispute.deliverable ? "Deliverable uploaded" : "No deliverable"} />
              </View>

              {needsEscrowPower ? (
                <Text style={{ marginTop: 12, color: WARNING, fontSize: 12, fontWeight: "800" }}>
                  Stablecoin settlement needs escrow.settle permission.
                </Text>
              ) : null}

              <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                <ActionButton
                  icon="eye-outline"
                  label="Under review"
                  color={ACCENT}
                  disabled={!canResolve || String(dispute.status).toUpperCase() === "UNDER_REVIEW"}
                  loading={workingKey === `dispute-review-${dispute.id}`}
                  onPress={() => performAction(`dispute-review-${dispute.id}`, { action: "mark_dispute_under_review", dispute_id: dispute.id })}
                />
                <ActionButton
                  icon="cash-outline"
                  label="Refund buyer"
                  color={DANGER}
                  disabled={!canResolve || needsEscrowPower}
                  loading={workingKey === `dispute-refund-${dispute.id}`}
                  onPress={() => performAction(`dispute-refund-${dispute.id}`, { action: "resolve_dispute", order_id: dispute.order_id, decision: "REFUND" }, true)}
                />
                <ActionButton
                  icon="checkmark-circle-outline"
                  label="Release seller"
                  color={SUCCESS}
                  disabled={!canResolve || needsEscrowPower}
                  loading={workingKey === `dispute-release-${dispute.id}`}
                  onPress={() => performAction(`dispute-release-${dispute.id}`, { action: "resolve_dispute", order_id: dispute.order_id, decision: "RELEASE" }, true)}
                />
              </View>
            </RecordCard>
          );
        }) : (
          <EmptyState title="No open disputes" subtitle="The support queue is clear for this role." />
        )}
      </View>
    );
  }

  function renderModeration() {
    const sellers = workspace?.modules.moderation?.sellers ?? [];
    const listings = workspace?.modules.moderation?.listings ?? [];
    const canModerateUsers = hasPermission("users.moderate");
    const canModerateListings = hasPermission("listings.moderate");
    const canBanUsers = hasPermission("users.delete");

    return (
      <View style={{ marginTop: 18, gap: 14 }}>
        {renderActionNote()}

        <Text style={{ color: TEXT, fontWeight: "900", fontSize: 18 }}>Seller accounts</Text>
        {sellers.length ? sellers.map((seller: any) => {
          const active = seller.active !== false;
          return (
            <RecordCard key={seller.user_id}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <View style={{ flex: 1, minWidth: 220 }}>
                  <Text style={{ color: TEXT, fontWeight: "900", fontSize: 17 }}>{seller.business_name || seller.display_name || seller.market_username || "Seller"}</Text>
                  <Text style={{ marginTop: 5, color: MUTED, fontSize: 13 }}>{seller.profile?.email ?? shortId(seller.user_id)}</Text>
                </View>
                <Pill label={active ? "ACTIVE" : "PAUSED"} color={active ? SUCCESS : DANGER} />
              </View>

              <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                <InfoLine label="Username" value={seller.market_username ? `@${seller.market_username}` : "n/a"} />
                <InfoLine label="Risk" value={String(seller.risk_score ?? 0)} />
                <InfoLine label="Verified" value={seller.is_verified ? "Yes" : "No"} />
                <InfoLine label="Payout" value={seller.payout_tier ?? "standard"} />
              </View>

              <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                <ActionButton
                  icon={active ? "pause-circle-outline" : "play-circle-outline"}
                  label={active ? "Pause store" : "Activate store"}
                  color={active ? DANGER : SUCCESS}
                  disabled={!canModerateUsers}
                  loading={workingKey === `seller-active-${seller.user_id}`}
                  onPress={() => performAction(`seller-active-${seller.user_id}`, { action: "set_seller_active", user_id: seller.user_id, active: !active }, active)}
                />
                {canBanUsers ? (
                  <ActionButton
                    icon="ban-outline"
                    label="Ban login"
                    color={DANGER}
                    loading={workingKey === `ban-${seller.user_id}`}
                    onPress={() => performAction(`ban-${seller.user_id}`, { action: "ban_user", user_id: seller.user_id }, true)}
                  />
                ) : null}
              </View>
            </RecordCard>
          );
        }) : (
          <EmptyState title="No seller profiles" subtitle="Seller moderation data will appear here once stores exist." />
        )}

        <Text style={{ marginTop: 8, color: TEXT, fontWeight: "900", fontSize: 18 }}>Listings</Text>
        {listings.length ? listings.map((listing: any) => {
          const active = listing.is_active !== false;
          return (
            <RecordCard key={listing.id}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <View style={{ flex: 1, minWidth: 220 }}>
                  <Text style={{ color: TEXT, fontWeight: "900", fontSize: 17 }}>{listing.title}</Text>
                  <Text style={{ marginTop: 5, color: MUTED, fontSize: 13 }}>{personLabel(listing.seller)}</Text>
                </View>
                <Pill label={active ? "LIVE" : "DISABLED"} color={active ? SUCCESS : DANGER} />
              </View>

              <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                <InfoLine label="Price" value={money(listing.price_amount, listing.currency)} />
                <InfoLine label="Category" value={`${listing.category ?? "n/a"} / ${listing.sub_category ?? "n/a"}`} />
                <InfoLine label="Delivery" value={listing.delivery_type ?? "n/a"} />
                <InfoLine label="Stock" value={listing.stock_qty ?? "n/a"} />
              </View>

              <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                <ActionButton
                  icon={active ? "eye-off-outline" : "eye-outline"}
                  label={active ? "Disable listing" : "Enable listing"}
                  color={active ? DANGER : SUCCESS}
                  disabled={!canModerateListings}
                  loading={workingKey === `listing-${listing.id}`}
                  onPress={() => performAction(`listing-${listing.id}`, { action: "set_listing_active", listing_id: listing.id, is_active: !active }, active)}
                />
              </View>
            </RecordCard>
          );
        }) : (
          <EmptyState title="No listings" subtitle="Listing moderation data will appear here once sellers publish inventory." />
        )}
      </View>
    );
  }

  function renderVerification() {
    const requests = workspace?.modules.verification?.requests ?? [];
    const canReview = hasPermission("verification.review");

    return (
      <View style={{ marginTop: 18, gap: 12 }}>
        {renderActionNote()}
        {requests.length ? requests.map((request: any) => (
          <RecordCard key={request.id}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <View style={{ flex: 1, minWidth: 220 }}>
                <Text style={{ color: TEXT, fontWeight: "900", fontSize: 17 }}>{personLabel(request.user)}</Text>
                <Text style={{ marginTop: 5, color: MUTED, fontSize: 13 }}>{request.user?.profile?.email ?? shortId(request.user_id)}</Text>
              </View>
              <Pill label={String(request.status ?? "PENDING")} color={statusTone(request.status)} />
            </View>

            <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
              <InfoLine label="Provider" value={request.provider ?? "manual"} />
              <InfoLine label="Provider status" value={request.provider_review_status ?? "n/a"} />
              <InfoLine label="Answer" value={request.provider_review_answer ?? "n/a"} />
              <InfoLine label="Country" value={request.country_code ?? "n/a"} />
              <InfoLine label="Updated" value={formatDate(request.updated_at)} />
            </View>

            {request.last_error ? <Text style={{ marginTop: 10, color: DANGER, fontSize: 12, fontWeight: "800" }}>{request.last_error}</Text> : null}
            {request.admin_note ? <Text style={{ marginTop: 10, color: MUTED, fontSize: 12, lineHeight: 18 }}>Admin note: {request.admin_note}</Text> : null}

            <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              <ActionButton
                icon="time-outline"
                label="In review"
                color={WARNING}
                disabled={!canReview}
                loading={workingKey === `verify-review-${request.id}`}
                onPress={() => performAction(`verify-review-${request.id}`, { action: "review_verification", request_id: request.id, status: "IN_REVIEW" })}
              />
              <ActionButton
                icon="shield-checkmark-outline"
                label="Verify"
                color={SUCCESS}
                disabled={!canReview}
                loading={workingKey === `verify-approve-${request.id}`}
                onPress={() => performAction(`verify-approve-${request.id}`, { action: "review_verification", request_id: request.id, status: "VERIFIED" }, true)}
              />
              <ActionButton
                icon="close-circle-outline"
                label="Reject"
                color={DANGER}
                disabled={!canReview}
                loading={workingKey === `verify-reject-${request.id}`}
                onPress={() => performAction(`verify-reject-${request.id}`, { action: "review_verification", request_id: request.id, status: "REJECTED" }, true)}
              />
              <ActionButton
                icon="refresh-circle-outline"
                label="Retry"
                color={ACCENT}
                disabled={!canReview}
                loading={workingKey === `verify-retry-${request.id}`}
                onPress={() => performAction(`verify-retry-${request.id}`, { action: "review_verification", request_id: request.id, status: "RESUBMISSION_REQUIRED" }, true)}
              />
            </View>
          </RecordCard>
        )) : (
          <EmptyState title="No verification requests" subtitle="Compliance review data will appear here when sellers submit verification." />
        )}
      </View>
    );
  }

  function renderEscrow() {
    const escrow = workspace?.modules.escrow;
    const orders = escrow?.orders ?? [];
    const chains = escrow?.chains ?? [];
    const stocks = escrow?.stocks ?? [];
    const audits = escrow?.audit_events ?? [];
    const canSettle = hasPermission("escrow.settle");
    const canChainAdmin = hasPermission("chain.admin");

    return (
      <View style={{ marginTop: 18, gap: 14 }}>
        {renderActionNote()}

        <Text style={{ color: TEXT, fontWeight: "900", fontSize: 18 }}>Escrow orders</Text>
        {orders.length ? orders.map((order: any) => {
          const currency = String(order.currency ?? "").toUpperCase();
          const stable = ["USDC", "USDT"].includes(currency);
          const pi = String(order.crypto_escrow?.chain ?? "").toLowerCase() === "pi_testnet" || (order.crypto_intents ?? []).some((intent: any) => String(intent.chain ?? "").toLowerCase() === "pi_testnet");
          const supported = stable || pi;
          return (
            <RecordCard key={order.id}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <View style={{ flex: 1, minWidth: 220 }}>
                  <Text style={{ color: TEXT, fontWeight: "900", fontSize: 17 }}>{order.listing?.title ?? "Escrow order"}</Text>
                  <Text style={{ marginTop: 5, color: MUTED, fontSize: 13 }}>{shortId(order.id)} - {money(order.amount, order.currency)}</Text>
                </View>
                <Pill label={String(order.status ?? "n/a")} color={statusTone(order.status)} />
              </View>

              <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                <InfoLine label="Buyer" value={personLabel(order.buyer)} />
                <InfoLine label="Seller" value={personLabel(order.seller)} />
                <InfoLine label="Rail" value={stable ? currency : pi ? "PI" : "NGN wallet"} />
                <InfoLine label="Dispute" value={order.dispute?.status ?? "none"} />
                <InfoLine label="Created" value={formatDate(order.created_at)} />
              </View>

              {!supported ? (
                <Text style={{ marginTop: 12, color: WARNING, fontSize: 12, fontWeight: "800" }}>
                  Wallet orders settle through dispute resolution.
                </Text>
              ) : null}

              <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                <ActionButton
                  icon="checkmark-circle-outline"
                  label="Release"
                  color={SUCCESS}
                  disabled={!canSettle || !supported}
                  loading={workingKey === `settle-release-${order.id}`}
                  onPress={() => performAction(`settle-release-${order.id}`, { action: "settle_order", order_id: order.id, decision: "RELEASE" }, true)}
                />
                <ActionButton
                  icon="cash-outline"
                  label="Refund"
                  color={DANGER}
                  disabled={!canSettle || !supported}
                  loading={workingKey === `settle-refund-${order.id}`}
                  onPress={() => performAction(`settle-refund-${order.id}`, { action: "settle_order", order_id: order.id, decision: "REFUND" }, true)}
                />
              </View>
            </RecordCard>
          );
        }) : (
          <EmptyState title="No escrow orders" subtitle="Orders requiring settlement attention will appear here." />
        )}

        <Text style={{ marginTop: 8, color: TEXT, fontWeight: "900", fontSize: 18 }}>Stock trading controls</Text>
        {stocks.length ? stocks.map((stock: any) => {
          const pausedUntil = stock.trading_paused_until ? new Date(stock.trading_paused_until) : null;
          const paused = Boolean(pausedUntil && pausedUntil.getTime() > Date.now());
          return (
            <RecordCard key={stock.id}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <View style={{ flex: 1, minWidth: 220 }}>
                  <Text style={{ color: TEXT, fontWeight: "900", fontSize: 17 }}>{stock.name} ({stock.symbol})</Text>
                  <Text style={{ marginTop: 5, color: MUTED, fontSize: 13 }}>{personLabel(stock.store)} - {stock.slug}</Text>
                </View>
                <Pill label={paused ? "TRADING PAUSED" : "TRADING OPEN"} color={paused ? DANGER : SUCCESS} />
              </View>

              <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                <InfoLine label="Chain" value={stock.chain ?? "n/a"} />
                <InfoLine label="Token" value={shortId(stock.token_address)} />
                <InfoLine label="Paused until" value={formatDate(stock.trading_paused_until)} />
              </View>

              <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                <ActionButton
                  icon="pause-circle-outline"
                  label="Pause 1h"
                  color={DANGER}
                  disabled={!canChainAdmin}
                  loading={workingKey === `stock-pause-${stock.id}`}
                  onPress={() => performAction(`stock-pause-${stock.id}`, { action: "set_stock_trading_pause", stock_id: stock.id, pause_minutes: 60 }, true)}
                />
                <ActionButton
                  icon="play-circle-outline"
                  label="Unpause"
                  color={SUCCESS}
                  disabled={!canChainAdmin}
                  loading={workingKey === `stock-unpause-${stock.id}`}
                  onPress={() => performAction(`stock-unpause-${stock.id}`, { action: "set_stock_trading_pause", stock_id: stock.id, pause_minutes: 0 }, true)}
                />
              </View>
            </RecordCard>
          );
        }) : (
          <EmptyState title="No stock identities" subtitle="Stock trading controls appear once seller stock identities exist." />
        )}

        <Text style={{ marginTop: 8, color: TEXT, fontWeight: "900", fontSize: 18 }}>Stable escrow contracts</Text>
        {chains.length ? chains.map((chain: any) => (
          <RecordCard key={String(chain.chain)}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <View style={{ flex: 1, minWidth: 220 }}>
                <Text style={{ color: TEXT, fontWeight: "900", fontSize: 17 }}>{String(chain.chain).replace(/_/g, " ")}</Text>
                <Text style={{ marginTop: 5, color: MUTED, fontSize: 13 }}>{shortId(chain.escrow_address)}</Text>
              </View>
              <Pill label={chain.active ? "ACTIVE" : "INACTIVE"} color={chain.active ? SUCCESS : DANGER} />
            </View>

            <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
              <InfoLine label="Chain ID" value={String(chain.chain_id ?? "n/a")} />
              <InfoLine label="Confirmations" value={String(chain.confirmations_required ?? "n/a")} />
              <InfoLine label="Updated" value={formatDate(chain.updated_at)} />
            </View>

            <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              <ActionButton
                icon="pause-circle-outline"
                label="Pause contract"
                color={DANGER}
                disabled={!canChainAdmin}
                loading={workingKey === `chain-pause-${chain.chain}`}
                onPress={() => performAction(`chain-pause-${chain.chain}`, { action: "stable_chain_action", chain: chain.chain, chain_action: "pause" }, true)}
              />
              <ActionButton
                icon="play-circle-outline"
                label="Unpause contract"
                color={SUCCESS}
                disabled={!canChainAdmin}
                loading={workingKey === `chain-unpause-${chain.chain}`}
                onPress={() => performAction(`chain-unpause-${chain.chain}`, { action: "stable_chain_action", chain: chain.chain, chain_action: "unpause" }, true)}
              />
            </View>
          </RecordCard>
        )) : (
          <EmptyState title="No chain config" subtitle="Stable escrow contract controls appear after chain config is seeded." />
        )}

        <Text style={{ marginTop: 8, color: TEXT, fontWeight: "900", fontSize: 18 }}>Latest audit</Text>
        {audits.length ? audits.slice(0, 12).map((event: any) => (
          <RecordCard key={event.id}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <Text style={{ color: TEXT, fontWeight: "900", fontSize: 15 }}>{event.action}</Text>
              <Text style={{ color: MUTED, fontSize: 12, fontWeight: "800" }}>{formatDate(event.created_at)}</Text>
            </View>
            <Text style={{ marginTop: 6, color: MUTED, fontSize: 12 }}>{event.entity_type} - {shortId(event.entity_id)}</Text>
          </RecordCard>
        )) : (
          <EmptyState title="No audit events" subtitle="Admin, order, and system events will appear here." />
        )}
      </View>
    );
  }

  function renderActiveModule() {
    const module = visibleModules.find((item) => item.key === currentModule);
    return (
      <View style={{ marginTop: 18, borderRadius: 28, padding: 20, backgroundColor: PANEL, borderWidth: 1, borderColor: BORDER }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <View style={{ flex: 1, minWidth: 230 }}>
            <Text style={{ color: TEXT, fontWeight: "900", fontSize: 22 }}>{module?.title ?? "Admin module"}</Text>
            <Text style={{ marginTop: 6, color: MUTED, fontSize: 13, lineHeight: 20 }}>{module?.description ?? "Live admin workspace."}</Text>
          </View>
          {module ? <Pill label={module.permission} color={WARNING} /> : null}
        </View>

        {currentModule === "support" ? renderSupport() : null}
        {currentModule === "moderation" ? renderModeration() : null}
        {currentModule === "verification" ? renderVerification() : null}
        {currentModule === "escrow" ? renderEscrow() : null}
      </View>
    );
  }

  if (booting) {
    return (
      <LinearGradient colors={[BG1, BG0]} style={{ flex: 1 }}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
          <ActivityIndicator color={ACCENT} />
          <Text style={{ marginTop: 14, color: TEXT, fontWeight: "900", fontSize: 18 }}>Loading admin</Text>
        </View>
      </LinearGradient>
    );
  }

  if (!membershipOk) {
    return (
      <LinearGradient colors={[BG1, BG0]} style={{ flex: 1 }}>
        <View style={{ flex: 1, paddingTop: insets.top + 22, paddingHorizontal: 18 }}>
          <Pressable onPress={() => router.back()} style={{ alignSelf: "flex-start", paddingVertical: 10 }}>
            <Text style={{ color: ACCENT, fontWeight: "900" }}>Back</Text>
          </Pressable>
          <View style={{ marginTop: 36, borderRadius: 28, padding: 22, backgroundColor: PANEL, borderWidth: 1, borderColor: BORDER }}>
            <Ionicons name="lock-closed-outline" size={28} color={DANGER} />
            <Text style={{ marginTop: 16, color: TEXT, fontWeight: "900", fontSize: 24 }}>Admin access blocked</Text>
            <Text style={{ marginTop: 8, color: MUTED, fontSize: 14, lineHeight: 22 }}>
              This route only opens for accounts added to market_admin_users in Supabase.
            </Text>
          </View>
        </View>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient colors={[BG1, BG0]} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 18, paddingHorizontal: 16, paddingBottom: 120 }}>
        <View style={{ maxWidth: 1180, width: "100%", alignSelf: "center" }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
            <View style={{ flex: 1, minWidth: 240 }}>
              <Text style={{ color: ACCENT, fontSize: 12, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.5 }}>Admin</Text>
              <Text style={{ marginTop: 10, color: TEXT, fontSize: 30, fontWeight: "900" }}>Marketplace control room</Text>
              <Text style={{ marginTop: 8, color: MUTED, fontSize: 13, lineHeight: 20 }}>
                Live moderation, disputes, escrow operations, verification, and audit review.
              </Text>
            </View>

            <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
              <ActionButton icon="refresh" label={checkingSession ? "Syncing" : "Refresh"} color={ACCENT} loading={checkingSession} onPress={checkMembershipAndMaybeLoad} />
              {overview ? <ActionButton icon="log-out-outline" label="Lock" color={DANGER} onPress={onLogout} /> : null}
            </View>
          </View>

          {error ? (
            <View style={{ marginTop: 18, borderRadius: 20, padding: 16, backgroundColor: "rgba(248,113,113,0.12)", borderWidth: 1, borderColor: "rgba(248,113,113,0.25)" }}>
              <Text style={{ color: "#FECACA", fontWeight: "800" }}>{error}</Text>
            </View>
          ) : null}

          {!overview ? (
            <View style={{ marginTop: 20, borderRadius: 28, padding: 22, backgroundColor: PANEL, borderWidth: 1, borderColor: BORDER }}>
              <Text style={{ color: TEXT, fontSize: 23, fontWeight: "900" }}>Unlock admin session</Text>
              <Text style={{ marginTop: 8, color: MUTED, fontSize: 14, lineHeight: 22 }}>
                Your Supabase sign-in proves who you are. The second admin password unlocks sensitive control actions.
              </Text>

              <View style={{ marginTop: 18, gap: 12 }}>
                <TextInput
                  secureTextEntry
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Enter admin password"
                  placeholderTextColor="rgba(234,242,255,0.38)"
                  style={{
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: "rgba(255,255,255,0.12)",
                    backgroundColor: PANEL_ALT,
                    color: TEXT,
                    paddingHorizontal: 14,
                    paddingVertical: 14,
                    fontSize: 15,
                  }}
                />
                <ActionButton icon="shield-checkmark-outline" label={submitting ? "Unlocking" : "Unlock admin"} color={SUCCESS} loading={submitting} onPress={onUnlock} />
              </View>
            </View>
          ) : (
            <>
              <View style={{ marginTop: 20, borderRadius: 28, padding: 20, backgroundColor: PANEL, borderWidth: 1, borderColor: BORDER }}>
                <Text style={{ color: TEXT, fontSize: 22, fontWeight: "900" }}>{overview.admin.role_name}</Text>
                <Text style={{ marginTop: 6, color: MUTED, fontSize: 13, lineHeight: 20 }}>
                  Role key: {overview.admin.role_key}. Server-side permission checks still run on every action.
                </Text>
              </View>

              <View style={{ marginTop: 16, flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                {Object.entries(overview.metrics).map(([key, value]) => (
                  <View
                    key={key}
                    style={{
                      minWidth: 160,
                      flexGrow: 1,
                      borderRadius: 20,
                      padding: 16,
                      backgroundColor: PANEL_ALT,
                      borderWidth: 1,
                      borderColor: "rgba(255,255,255,0.08)",
                    }}
                  >
                    <Text style={{ color: TEXT, fontWeight: "900", fontSize: 24 }}>{value}</Text>
                    <Text style={{ marginTop: 6, color: MUTED, fontSize: 12 }}>{labelFromKey(key)}</Text>
                  </View>
                ))}
              </View>

              {renderModuleTabs()}
              {workspace ? renderActiveModule() : (
                <View style={{ marginTop: 18, borderRadius: 28, padding: 24, backgroundColor: PANEL, borderWidth: 1, borderColor: BORDER, alignItems: "center" }}>
                  <ActivityIndicator color={ACCENT} />
                  <Text style={{ marginTop: 12, color: TEXT, fontWeight: "900" }}>Loading workspace</Text>
                </View>
              )}
            </>
          )}
        </View>
      </ScrollView>
    </LinearGradient>
  );
}
