import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  type TextInputProps,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { supabase } from "@/services/supabase";
import {
  clearAdminSessionToken,
  generateDisputeAiReview,
  generateSupportAiTriage,
  hasStoredAdminSession,
  loadAdminOverview,
  loadAdminWorkspace,
  loginAdmin,
  logoutAdmin,
  runAdminAction,
  type MarketDisputeAiReviewResult,
  type MarketAdminOverview,
  type MarketAdminWorkspace,
  type MarketSupportAiTriageResult,
} from "@/services/market/admin";
import {
  uploadSupportFiles,
  type SupportLocalFile,
} from "@/services/market/support";

const BG0 = "#0B0907";
const BG1 = "#22160D";
const PANEL = "rgba(24,18,14,0.92)";
const PANEL_ALT = "rgba(255,255,255,0.045)";
const PANEL_SOFT = "rgba(245,158,11,0.07)";
const BORDER = "rgba(245,158,11,0.16)";
const TEXT = "#FFF7ED";
const MUTED = "rgba(255,247,237,0.68)";
const FAINT = "rgba(255,247,237,0.46)";
const ACCENT = "#F59E0B";
const SUCCESS = "#4ADE80";
const WARNING = "#F59E0B";
const DANGER = "#F87171";

type ModuleKey = "support" | "moderation" | "verification" | "escrow" | "rewards" | "admins";
type ModerationTab = "sellers" | "listings";
type EscrowTab = "orders" | "stocks" | "chains" | "audit";
type AdminTab = "members" | "roles" | "invite" | "system";
type RewardAdminTab = "tasks" | "promotions" | "referrals" | "reviews" | "accounts" | "ledger" | "build";
type SupportStatusTab = "fresh" | "in_progress" | "resolved" | "closed" | "all";
type SupportPickedFile = SupportLocalFile & { id: string };
type RewardRuleCheck =
  | "referral_count"
  | "purchase_count"
  | "purchase_volume"
  | "stock_trade_volume"
  | "stock_trade_count"
  | "active_listing_count"
  | "follow_count"
  | "social_post_count"
  | "seller_profile_exists"
  | "seller_profile_complete"
  | "admin_review";
type RewardWindowMode = "all_time" | "campaign" | "after_first_progress";
type RewardTimeUnit = "minutes" | "hours" | "days";

const REWARD_RULE_OPTIONS: Array<{ key: RewardRuleCheck; label: string; description: string; category: string }> = [
  { key: "referral_count", label: "Referrals", description: "Invite a number of people.", category: "social" },
  { key: "purchase_count", label: "Purchases", description: "Buy from the market, a store, or a listing.", category: "market" },
  { key: "purchase_volume", label: "Purchase value", description: "Spend a target amount in orders.", category: "market" },
  { key: "stock_trade_volume", label: "Stock volume", description: "Reach a total stock trade value.", category: "onchain" },
  { key: "stock_trade_count", label: "Stock trades", description: "Make a number of buy or sell trades.", category: "onchain" },
  { key: "active_listing_count", label: "Listings", description: "Publish active listings.", category: "market" },
  { key: "follow_count", label: "Follow stores", description: "Follow one or more stores.", category: "social" },
  { key: "social_post_count", label: "Market posts", description: "Post in the market feed.", category: "social" },
  { key: "seller_profile_exists", label: "Open store", description: "Create a store profile.", category: "market" },
  { key: "seller_profile_complete", label: "Complete store", description: "Fill out store details.", category: "market" },
  { key: "admin_review", label: "Manual proof", description: "User submits proof for admin review.", category: "custom" },
];

const REWARD_WINDOW_OPTIONS: Array<{ key: RewardWindowMode; label: string; description: string }> = [
  { key: "all_time", label: "Any time", description: "Count progress whenever it happens." },
  { key: "campaign", label: "Campaign dates", description: "Count progress during the task start and end dates." },
  { key: "after_first_progress", label: "Timed challenge", description: "Count progress inside a time limit after the first action." },
];

const MODULE_META: Record<ModuleKey, {
  icon: keyof typeof Ionicons.glyphMap;
  shortTitle: string;
  eyebrow: string;
  accent: string;
}> = {
  support: {
    icon: "chatbubbles-outline",
    shortTitle: "Support",
    eyebrow: "Tickets and disputes",
    accent: "#F59E0B",
  },
  moderation: {
    icon: "people-outline",
    shortTitle: "Moderation",
    eyebrow: "Users and listings",
    accent: "#FB923C",
  },
  verification: {
    icon: "shield-checkmark-outline",
    shortTitle: "Trust",
    eyebrow: "Verification",
    accent: "#FDE68A",
  },
  escrow: {
    icon: "wallet-outline",
    shortTitle: "Escrow",
    eyebrow: "Money movement",
    accent: "#4ADE80",
  },
  rewards: {
    icon: "gift-outline",
    shortTitle: "Rewards",
    eyebrow: "Noms economy",
    accent: "#2DD4BF",
  },
  admins: {
    icon: "id-card-outline",
    shortTitle: "Admins",
    eyebrow: "Team access",
    accent: "#FDBA74",
  },
};

const PERMISSION_LABELS: Record<string, string> = {
  "*": "All admin capabilities",
  "admin.members.manage": "Manage admin members",
  "admin.roles.read": "View role boundaries",
  "users.read": "View user records",
  "users.moderate": "Pause or reinstate stores",
  "users.delete": "Restrict account access",
  "listings.read": "View listings",
  "listings.moderate": "Pause or restore listings",
  "listings.delete": "Remove prohibited listings",
  "orders.read": "View order context",
  "orders.manage": "Manage order operations",
  "disputes.read": "View disputes",
  "disputes.resolve": "Resolve disputes",
  "evidence.read": "Review evidence",
  "complaints.read": "View complaints",
  "complaints.respond": "Respond to complaints",
  "verification.read": "View verification cases",
  "verification.review": "Approve or reject verification",
  "escrow.read": "View escrow state",
  "escrow.settle": "Release or refund escrow",
  "chain.read": "View chain configuration",
  "chain.admin": "Pause or resume chain controls",
  "rewards.read": "View rewards",
  "rewards.tasks.manage": "Manage reward tasks",
  "rewards.promotions.manage": "Manage promoted placements",
  "rewards.adjust": "Adjust Noms balances",
  "rewards.review": "Review reward submissions",
  "rewards.analytics": "View reward analytics",
  "audit.read": "View audit trail",
  "analytics.read": "View admin analytics",
};

const PERMISSION_GROUPS = [
  {
    title: "People",
    permissions: ["users.read", "users.moderate", "users.delete", "admin.members.manage", "admin.roles.read"],
    icon: "people-outline" as keyof typeof Ionicons.glyphMap,
  },
  {
    title: "Marketplace",
    permissions: ["listings.read", "listings.moderate", "listings.delete", "orders.read", "orders.manage"],
    icon: "storefront-outline" as keyof typeof Ionicons.glyphMap,
  },
  {
    title: "Support",
    permissions: ["disputes.read", "disputes.resolve", "evidence.read", "complaints.read", "complaints.respond"],
    icon: "chatbubbles-outline" as keyof typeof Ionicons.glyphMap,
  },
  {
    title: "Trust",
    permissions: ["verification.read", "verification.review"],
    icon: "shield-checkmark-outline" as keyof typeof Ionicons.glyphMap,
  },
  {
    title: "Escrow",
    permissions: ["escrow.read", "escrow.settle", "chain.read", "chain.admin"],
    icon: "wallet-outline" as keyof typeof Ionicons.glyphMap,
  },
  {
    title: "Rewards",
    permissions: ["rewards.read", "rewards.tasks.manage", "rewards.promotions.manage", "rewards.adjust", "rewards.review", "rewards.analytics"],
    icon: "gift-outline" as keyof typeof Ionicons.glyphMap,
  },
  {
    title: "Oversight",
    permissions: ["audit.read", "analytics.read"],
    icon: "stats-chart-outline" as keyof typeof Ionicons.glyphMap,
  },
];

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
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function permissionLabel(permission: string) {
  return PERMISSION_LABELS[permission] ?? labelFromKey(permission.replace(/\./g, " "));
}

function compactCount(value: number) {
  if (value > 999) return `${(value / 1000).toFixed(value > 9999 ? 0 : 1)}k`;
  return String(value);
}

function numericText(value: string, fallback = 1) {
  const n = Number(String(value || "").replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function timeUnitSeconds(unit: RewardTimeUnit) {
  if (unit === "minutes") return 60;
  if (unit === "days") return 86400;
  return 3600;
}

function splitSeconds(seconds: unknown): { amount: string; unit: RewardTimeUnit } {
  const value = Math.max(0, Math.trunc(Number(seconds ?? 0)));
  if (value > 0 && value % 86400 === 0) return { amount: String(value / 86400), unit: "days" };
  if (value > 0 && value % 3600 === 0) return { amount: String(value / 3600), unit: "hours" };
  if (value > 0 && value % 60 === 0) return { amount: String(value / 60), unit: "minutes" };
  return { amount: value ? String(Math.max(1, Math.round(value / 60))) : "0", unit: value ? "minutes" : "hours" };
}

function normalizeText(value: unknown) {
  return String(value ?? "").toLowerCase().trim();
}

function matchesSearch(query: string, values: unknown[]) {
  const q = normalizeText(query);
  if (!q) return true;
  return values.some((value) => normalizeText(value).includes(q));
}

function roleFocus(roleKey?: string | null) {
  switch (roleKey) {
    case "super_admin":
      return "Full control across every workspace";
    case "operations_admin":
      return "Marketplace operations and settlement";
    case "support_admin":
      return "Support queues, complaints, and evidence";
    case "compliance_admin":
      return "Verification and trust review";
    case "reward_admin":
      return "Noms tasks, reward reviews, promoted placements, and reward analytics";
    default:
      return "Assigned admin workspace";
  }
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

function sellerHandle(user: any) {
  return String(user?.seller?.market_username || user?.market_username || "").trim();
}

function openSellerProfile(user: any) {
  const handle = sellerHandle(user);
  if (handle) router.push(`/market/profile/${encodeURIComponent(handle)}` as any);
}

function canOpenSellerProfile(user: any) {
  return Boolean(sellerHandle(user));
}

function openListing(listingId?: string | null) {
  const id = String(listingId ?? "").trim();
  if (id) router.push(`/market/listing/${encodeURIComponent(id)}` as any);
}

function dmSlugForUser(user: any) {
  return String(user?.seller?.market_username || user?.profile?.username || user?.id || "").trim();
}

function openSupportTicket(ticketId?: string | null) {
  const clean = String(ticketId || "").trim();
  if (clean) router.push(`/market/support/${encodeURIComponent(clean)}?admin=1` as any);
}

function supportAttachmentIcon(kind?: string): keyof typeof Ionicons.glyphMap {
  const raw = String(kind || "").toLowerCase();
  if (raw === "image") return "image-outline";
  if (raw === "video") return "videocam-outline";
  if (raw === "audio") return "mic-outline";
  return "document-attach-outline";
}

function statusTone(status?: unknown) {
  const s = String(status ?? "").toUpperCase();
  if (["ACTIVE", "VERIFIED", "RELEASED", "RESOLVED", "SETTLED", "CONFIRMED"].includes(s)) return SUCCESS;
  if (["PENDING", "IN_REVIEW", "UNDER_REVIEW", "IN_ESCROW", "PROCESSING", "SUBMITTED"].includes(s)) return WARNING;
  if (["REJECTED", "REFUNDED", "DISPUTED", "FAILED", "CANCELLED", "EXPIRED"].includes(s)) return DANGER;
  return ACCENT;
}

function priorityTone(priority?: unknown) {
  const p = String(priority ?? "").toUpperCase();
  if (p === "URGENT") return DANGER;
  if (p === "HIGH") return WARNING;
  if (p === "LOW") return MUTED;
  return SUCCESS;
}

function confidenceTone(confidence?: unknown) {
  const c = String(confidence ?? "").toUpperCase();
  if (c === "HIGH") return SUCCESS;
  if (c === "MEDIUM") return WARNING;
  return MUTED;
}

function recommendationTone(recommendation?: unknown) {
  const r = String(recommendation ?? "").toUpperCase();
  if (r === "RELEASE_TO_SELLER") return SUCCESS;
  if (r === "REFUND_TO_BUYER") return DANGER;
  if (r === "REQUEST_MORE_EVIDENCE") return WARNING;
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
        borderRadius: 8,
        paddingHorizontal: 14,
        paddingVertical: 12,
        backgroundColor: `${color}18`,
        borderWidth: 1,
        borderColor: `${color}30`,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        minHeight: 42,
      }}
    >
      {loading ? <ActivityIndicator color={color} /> : <Ionicons name={icon} size={16} color={color} />}
      <Text numberOfLines={1} style={{ color, fontWeight: "900", fontSize: 13 }}>{label}</Text>
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
      <Text style={{ color: FAINT, fontSize: 11, fontWeight: "900", textTransform: "uppercase" }}>{label}</Text>
      <Text style={{ marginTop: 4, color: TEXT, fontSize: 13, fontWeight: "800" }}>{value}</Text>
    </View>
  );
}

async function copyTextValue(label: string, value?: string | null) {
  const text = String(value ?? "").trim();
  if (!text) return;
  try {
    await Clipboard.setStringAsync(text);
    Alert.alert("Copied", `${label} copied.`);
  } catch {
    Alert.alert("Copy failed", `Unable to copy ${label.toLowerCase()} right now.`);
  }
}

function CopyableIdLine({ label, value }: { label: string; value?: string | null }) {
  const text = String(value ?? "").trim();
  return (
    <View style={{ flex: 1, minWidth: 260 }}>
      <Text style={{ color: FAINT, fontSize: 11, fontWeight: "900", textTransform: "uppercase" }}>{label}</Text>
      <View style={{ marginTop: 4, flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text selectable numberOfLines={2} style={{ flex: 1, color: TEXT, fontSize: 12, fontWeight: "800" }}>{text || "n/a"}</Text>
        {text ? (
          <Pressable onPress={() => void copyTextValue(label, text)} hitSlop={10} style={{ padding: 4 }}>
            <Ionicons name="copy-outline" size={16} color={ACCENT} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function RecordCard({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ borderRadius: 8, padding: 16, backgroundColor: PANEL_ALT, borderWidth: 1, borderColor: BORDER }}>
      {children}
    </View>
  );
}

function EmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <View style={{ borderRadius: 8, padding: 18, backgroundColor: PANEL_SOFT, borderWidth: 1, borderColor: BORDER }}>
      <Text style={{ color: TEXT, fontWeight: "900", fontSize: 16 }}>{title}</Text>
      <Text style={{ marginTop: 6, color: MUTED, fontSize: 13, lineHeight: 20 }}>{subtitle}</Text>
    </View>
  );
}

function SearchBox({
  value,
  onChangeText,
  placeholder,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
}) {
  return (
    <View
      style={{
        minHeight: 44,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: BORDER,
        backgroundColor: "rgba(255,255,255,0.06)",
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 12,
        flex: 1,
        minWidth: 220,
      }}
    >
      <Ionicons name="search-outline" size={17} color={FAINT} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        autoCapitalize="none"
        placeholder={placeholder}
        placeholderTextColor="rgba(248,250,252,0.36)"
        style={{ flex: 1, minWidth: 0, color: TEXT, fontSize: 14, paddingVertical: 10 }}
      />
      {value ? (
        <Pressable onPress={() => onChangeText("")} hitSlop={10} style={{ padding: 2 }}>
          <Ionicons name="close-circle" size={18} color={FAINT} />
        </Pressable>
      ) : null}
    </View>
  );
}

function AdminTextInput({
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  keyboardType,
  multiline,
  autoCapitalize,
  editable,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  secureTextEntry?: boolean;
  keyboardType?: "default" | "email-address";
  multiline?: boolean;
  autoCapitalize?: TextInputProps["autoCapitalize"];
  editable?: boolean;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      editable={editable}
      secureTextEntry={secureTextEntry}
      keyboardType={keyboardType}
      autoCapitalize={autoCapitalize ?? (keyboardType === "email-address" ? "none" : undefined)}
      multiline={multiline}
      placeholder={placeholder}
      placeholderTextColor="rgba(248,250,252,0.36)"
      style={{
        minHeight: multiline ? 76 : 44,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: BORDER,
        backgroundColor: "rgba(255,255,255,0.06)",
        color: TEXT,
        paddingHorizontal: 12,
        paddingVertical: 11,
        fontSize: 14,
        textAlignVertical: multiline ? "top" : "center",
        opacity: editable === false ? 0.72 : 1,
      }}
    />
  );
}

function SectionHeader({
  icon,
  title,
  subtitle,
  count,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  count?: number;
  children?: React.ReactNode;
}) {
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <View style={{ flex: 1, minWidth: 240, flexDirection: "row", gap: 12 }}>
          <View
            style={{
              width: 38,
              height: 38,
              borderRadius: 8,
              backgroundColor: "rgba(245,158,11,0.12)",
              borderWidth: 1,
              borderColor: "rgba(245,158,11,0.24)",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name={icon} size={18} color={ACCENT} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: TEXT, fontWeight: "900", fontSize: 18 }}>{title}</Text>
            <Text style={{ marginTop: 4, color: MUTED, fontSize: 13, lineHeight: 19 }}>{subtitle}</Text>
          </View>
        </View>
        {typeof count === "number" ? <Pill label={`${compactCount(count)} shown`} color={ACCENT} /> : null}
      </View>
      {children}
    </View>
  );
}

function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ key: T; label: string; count?: number }>;
}) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {options.map((option) => {
        const selected = option.key === value;
        return (
          <Pressable
            key={option.key}
            onPress={() => onChange(option.key)}
            style={{
              borderRadius: 8,
              paddingHorizontal: 12,
              paddingVertical: 10,
              borderWidth: 1,
              borderColor: selected ? "rgba(245,158,11,0.5)" : BORDER,
              backgroundColor: selected ? "rgba(245,158,11,0.14)" : "rgba(255,255,255,0.04)",
              flexDirection: "row",
              gap: 8,
              alignItems: "center",
            }}
          >
            <Text style={{ color: selected ? TEXT : MUTED, fontWeight: "900", fontSize: 12 }}>{option.label}</Text>
            {typeof option.count === "number" ? (
              <Text style={{ color: selected ? ACCENT : FAINT, fontWeight: "900", fontSize: 12 }}>{compactCount(option.count)}</Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function PermissionGroups({ permissions }: { permissions: string[] }) {
  const hasWildcard = permissions.includes("*");
  return (
    <View style={{ gap: 10 }}>
      {PERMISSION_GROUPS.map((group) => {
        const labels = group.permissions.filter((permission) => hasWildcard || permissions.includes(permission)).map(permissionLabel);
        if (!labels.length) return null;
        return (
          <View key={group.title} style={{ gap: 8 }}>
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <Ionicons name={group.icon} size={15} color={ACCENT} />
              <Text style={{ color: TEXT, fontWeight: "900", fontSize: 13 }}>{group.title}</Text>
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {labels.map((label) => <Pill key={`${group.title}-${label}`} label={label} color={ACCENT} />)}
            </View>
          </View>
        );
      })}
    </View>
  );
}

export default function MarketAdminIndex() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ module?: string; ticket?: string }>();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 920;
  const isCompact = width < 720;
  const [booting, setBooting] = useState(true);
  const [checkingSession, setCheckingSession] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [membershipOk, setMembershipOk] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [overview, setOverview] = useState<MarketAdminOverview | null>(null);
  const [workspace, setWorkspace] = useState<MarketAdminWorkspace | null>(null);
  const [activeModule, setActiveModule] = useState<ModuleKey | null>(null);
  const [actionNote, setActionNote] = useState("");
  const [supportReplies, setSupportReplies] = useState<Record<string, string>>({});
  const [supportAiResults, setSupportAiResults] = useState<Record<string, MarketSupportAiTriageResult>>({});
  const [disputeAiResults, setDisputeAiResults] = useState<Record<string, MarketDisputeAiReviewResult>>({});
  const [workingKey, setWorkingKey] = useState<string | null>(null);
  const [adminEmail, setAdminEmail] = useState("");
  const [adminDisplayName, setAdminDisplayName] = useState("");
  const [adminRoleKey, setAdminRoleKey] = useState("support_admin");
  const [adminPassword, setAdminPassword] = useState("");
  const [systemMaintenanceEnabled, setSystemMaintenanceEnabled] = useState(false);
  const [systemMaintenanceMessage, setSystemMaintenanceMessage] = useState("BestCity Market is receiving a scheduled upgrade. Please check back soon.");
  const [systemMaintenanceEta, setSystemMaintenanceEta] = useState("");
  const [systemForceUpdate, setSystemForceUpdate] = useState(false);
  const [systemMinVersion, setSystemMinVersion] = useState("0.0.0");
  const [systemUpdateMessage, setSystemUpdateMessage] = useState("A newer BestCity app version is required to continue.");
  const [systemApkUrl, setSystemApkUrl] = useState("");
  const [moduleSearch, setModuleSearch] = useState<Record<ModuleKey, string>>({
    support: "",
    moderation: "",
    verification: "",
    escrow: "",
    rewards: "",
    admins: "",
  });
  const [moderationTab, setModerationTab] = useState<ModerationTab>("sellers");
  const [escrowTab, setEscrowTab] = useState<EscrowTab>("orders");
  const [adminTab, setAdminTab] = useState<AdminTab>("members");
  const [rewardTab, setRewardTab] = useState<RewardAdminTab>("tasks");
  const [rewardTaskKey, setRewardTaskKey] = useState("custom_reward_task");
  const [rewardTaskTitle, setRewardTaskTitle] = useState("");
  const [rewardTaskDescription, setRewardTaskDescription] = useState("");
  const [rewardTaskCategory, setRewardTaskCategory] = useState("custom");
  const [rewardTaskTrigger, setRewardTaskTrigger] = useState("client_claim");
  const [rewardTaskNoms, setRewardTaskNoms] = useState("100");
  const [rewardTaskRoute, setRewardTaskRoute] = useState("");
  const [rewardTaskCooldownAmount, setRewardTaskCooldownAmount] = useState("0");
  const [rewardTaskCooldownUnit, setRewardTaskCooldownUnit] = useState<RewardTimeUnit>("hours");
  const [rewardTaskDailyCap, setRewardTaskDailyCap] = useState("");
  const [rewardTaskWeeklyCap, setRewardTaskWeeklyCap] = useState("");
  const [rewardTaskLifetimeCap, setRewardTaskLifetimeCap] = useState("1");
  const [rewardTaskStartsAt, setRewardTaskStartsAt] = useState("");
  const [rewardTaskEndsAt, setRewardTaskEndsAt] = useState("");
  const [rewardTaskRules, setRewardTaskRules] = useState("");
  const [rewardRuleCheck, setRewardRuleCheck] = useState<RewardRuleCheck>("referral_count");
  const [rewardRuleMin, setRewardRuleMin] = useState("2");
  const [rewardRuleValue, setRewardRuleValue] = useState("40");
  const [rewardRuleWindowMode, setRewardRuleWindowMode] = useState<RewardWindowMode>("all_time");
  const [rewardRuleWindowAmount, setRewardRuleWindowAmount] = useState("5");
  const [rewardRuleWindowUnit, setRewardRuleWindowUnit] = useState<RewardTimeUnit>("hours");
  const [rewardRuleStoreId, setRewardRuleStoreId] = useState("");
  const [rewardRuleListingId, setRewardRuleListingId] = useState("");
  const [rewardRuleStockId, setRewardRuleStockId] = useState("");
  const [rewardRuleSide, setRewardRuleSide] = useState("any");
  const [rewardRulePurchaseRole, setRewardRulePurchaseRole] = useState("buyer");
  const [rewardPromotionId, setRewardPromotionId] = useState("");
  const [rewardPromotionPlacement, setRewardPromotionPlacement] = useState("rewards_top");
  const [rewardPromotionTitle, setRewardPromotionTitle] = useState("");
  const [rewardPromotionSubtitle, setRewardPromotionSubtitle] = useState("");
  const [rewardPromotionMediaUrl, setRewardPromotionMediaUrl] = useState("");
  const [rewardPromotionSponsorLabel, setRewardPromotionSponsorLabel] = useState("Featured");
  const [rewardPromotionCtaLabel, setRewardPromotionCtaLabel] = useState("View store");
  const [rewardPromotionCtaRoute, setRewardPromotionCtaRoute] = useState("");
  const [rewardPromotionStoreId, setRewardPromotionStoreId] = useState("");
  const [rewardPromotionListingId, setRewardPromotionListingId] = useState("");
  const [rewardPromotionPriority, setRewardPromotionPriority] = useState("100");
  const [rewardPromotionStartsAt, setRewardPromotionStartsAt] = useState("");
  const [rewardPromotionEndsAt, setRewardPromotionEndsAt] = useState("");
  const [rewardPromotionMetadata, setRewardPromotionMetadata] = useState("{\"source\":\"admin_dashboard\"}");
  const [marketStoreFeatureDrafts, setMarketStoreFeatureDrafts] = useState<Record<string, { until: string; limit: string }>>({});
  const [marketListingFeatureDrafts, setMarketListingFeatureDrafts] = useState<Record<string, { until: string; priority: string }>>({});
  const [rewardAdjustUserId, setRewardAdjustUserId] = useState("");
  const [rewardAdjustAmount, setRewardAdjustAmount] = useState("");
  const [rewardReferralEnabled, setRewardReferralEnabled] = useState(true);
  const [rewardReferralBotFilterEnabled, setRewardReferralBotFilterEnabled] = useState(true);
  const [rewardReferralJoinerNoms, setRewardReferralJoinerNoms] = useState("25");
  const [rewardReferralReferrerNoms, setRewardReferralReferrerNoms] = useState("5");
  const [rewardReferralMaxIp, setRewardReferralMaxIp] = useState("5");
  const [rewardReferralMaxUserAgent, setRewardReferralMaxUserAgent] = useState("10");
  const [rewardReferralShareBaseUrl, setRewardReferralShareBaseUrl] = useState("https://bestcity-amber.vercel.app/register");
  const [supportStatusTab, setSupportStatusTab] = useState<SupportStatusTab>("fresh");
  const [supportFiles, setSupportFiles] = useState<Record<string, SupportPickedFile[]>>({});
  const [supportPickingId, setSupportPickingId] = useState<string | null>(null);
  const [selectedSupportTicketId, setSelectedSupportTicketId] = useState<string | null>(null);
  const [chainArbiterAddresses, setChainArbiterAddresses] = useState<Record<string, string>>({});
  const [chainRescueRecipients, setChainRescueRecipients] = useState<Record<string, string>>({});
  const [chainRescueOrderKeys, setChainRescueOrderKeys] = useState<Record<string, string>>({});
  const [chainRescueTxHashes, setChainRescueTxHashes] = useState<Record<string, string>>({});

  function canSeeOverviewModule(module: MarketAdminOverview["modules"][number], permissions: string[], roleKey?: string | null) {
    if (roleKey === "super_admin" || permissions.includes("*") || permissions.includes(module.permission)) return true;
    if (module.key === "moderation") {
      return permissions.some((permission) => ["users.moderate", "users.delete", "listings.moderate", "listings.delete"].includes(permission));
    }
    return false;
  }

  const visibleModules = useMemo(() => {
    const permissions = overview?.admin.permissions ?? [];
    return (overview?.modules ?? []).filter((module) => canSeeOverviewModule(module, permissions, overview?.admin.role_key));
  }, [overview]);

  const currentModule = (activeModule ?? visibleModules[0]?.key ?? "support") as ModuleKey;
  const currentModuleMeta = MODULE_META[currentModule] ?? MODULE_META.support;
  const currentModuleSearch = moduleSearch[currentModule] ?? "";
  const rewardRuleDraft = useMemo(() => {
    const addWindow = (rule: Record<string, unknown>) => {
      if (rewardRuleWindowMode === "after_first_progress") {
        return {
          ...rule,
          window: {
            mode: "after_first_progress",
            seconds: Math.max(60, Math.trunc(numericText(rewardRuleWindowAmount, 1) * timeUnitSeconds(rewardRuleWindowUnit))),
          },
        };
      }
      if (rewardRuleWindowMode === "campaign") {
        return { ...rule, window: { mode: "campaign" } };
      }
      return rule;
    };
    const min = Math.max(1, Math.trunc(numericText(rewardRuleMin, 1)));
    const value = numericText(rewardRuleValue, 1);
    const storeId = rewardRuleStoreId.trim();
    const listingId = rewardRuleListingId.trim();
    const stockId = rewardRuleStockId.trim();
    const side = rewardRuleSide === "any" ? "" : rewardRuleSide;

    if (rewardRuleCheck === "seller_profile_exists") return { check: "seller_profile_exists" };
    if (rewardRuleCheck === "seller_profile_complete") return { check: "seller_profile_complete", min_fields: min };
    if (rewardRuleCheck === "admin_review") return { check: "admin_review" };
    if (rewardRuleCheck === "referral_count") {
      return addWindow({ check: "referral_count", min, statuses: ["qualified", "rewarded"] });
    }
    if (rewardRuleCheck === "purchase_count") {
      return addWindow({
        check: "purchase_count",
        min,
        role: rewardRulePurchaseRole,
        ...(storeId ? { store_id: storeId } : {}),
        ...(listingId ? { listing_id: listingId } : {}),
      });
    }
    if (rewardRuleCheck === "purchase_volume") {
      return addWindow({
        check: "purchase_volume",
        min_amount: value,
        role: rewardRulePurchaseRole,
        ...(storeId ? { store_id: storeId } : {}),
        ...(listingId ? { listing_id: listingId } : {}),
      });
    }
    if (rewardRuleCheck === "stock_trade_volume") {
      return addWindow({
        check: "stock_trade_volume",
        min_volume_usd: value,
        ...(side ? { side } : {}),
        ...(stockId ? { stock_id: stockId } : {}),
      });
    }
    if (rewardRuleCheck === "stock_trade_count") {
      return addWindow({
        check: "stock_trade_count",
        min,
        ...(side ? { side } : {}),
        ...(stockId ? { stock_id: stockId } : {}),
      });
    }
    if (rewardRuleCheck === "follow_count") {
      return addWindow({
        check: "follow_count",
        min,
        ...(storeId ? { store_id: storeId } : {}),
      });
    }
    if (rewardRuleCheck === "social_post_count") return addWindow({ check: "social_post_count", min });
    return addWindow({ check: "active_listing_count", min });
  }, [
    rewardRuleCheck,
    rewardRuleListingId,
    rewardRuleMin,
    rewardRulePurchaseRole,
    rewardRuleSide,
    rewardRuleStockId,
    rewardRuleStoreId,
    rewardRuleValue,
    rewardRuleWindowAmount,
    rewardRuleWindowMode,
    rewardRuleWindowUnit,
  ]);

  useEffect(() => {
    setRewardTaskRules(JSON.stringify(rewardRuleDraft, null, 2));
  }, [rewardRuleDraft]);

  useEffect(() => {
    const moduleParam = String(params.module || "").trim().toLowerCase();
    const ticketParam = String(params.ticket || "").trim();
    if (moduleParam && moduleParam in MODULE_META) setActiveModule(moduleParam as ModuleKey);
    if (ticketParam) openSupportTicket(ticketParam);
  }, [params.module, params.ticket]);

  useEffect(() => {
    const config = workspace?.modules.rewards?.config?.referrals;
    if (!config) return;
    const botFilter = config.bot_filter ?? {};
    setRewardReferralEnabled(config.enabled !== false);
    setRewardReferralBotFilterEnabled(botFilter.enabled !== false);
    setRewardReferralJoinerNoms(String(config.joiner_reward_noms ?? 25));
    setRewardReferralReferrerNoms(String(config.referrer_reward_noms ?? 5));
    setRewardReferralMaxIp(String(botFilter.max_referrals_per_ip_hash ?? 5));
    setRewardReferralMaxUserAgent(String(botFilter.max_referrals_per_user_agent_hash ?? 10));
    setRewardReferralShareBaseUrl(String(config.share_base_url || "https://bestcity-amber.vercel.app/register"));
  }, [workspace?.generated_at]);

  useEffect(() => {
    const control = workspace?.modules.admins?.system_control;
    if (!control) return;
    setSystemMaintenanceEnabled(control.maintenance_enabled === true);
    setSystemMaintenanceMessage(String(control.maintenance_message || "BestCity Market is receiving a scheduled upgrade. Please check back soon."));
    setSystemMaintenanceEta(String(control.maintenance_eta || ""));
    setSystemForceUpdate(control.force_update === true);
    setSystemMinVersion(String(control.min_version || "0.0.0"));
    setSystemUpdateMessage(String(control.update_message || "A newer BestCity app version is required to continue."));
    setSystemApkUrl(String(control.apk_url || ""));
  }, [workspace?.generated_at]);

  function setCurrentModuleSearch(value: string) {
    setModuleSearch((prev) => ({ ...prev, [currentModule]: value }));
  }

  function setChainArbiterAddress(chain: string, value: string) {
    setChainArbiterAddresses((prev) => ({ ...prev, [chain]: value }));
  }

  function setChainRescueRecipient(chain: string, value: string) {
    setChainRescueRecipients((prev) => ({ ...prev, [chain]: value }));
  }

  function setChainRescueOrderKey(chain: string, value: string) {
    setChainRescueOrderKeys((prev) => ({ ...prev, [chain]: value }));
  }

  function setChainRescueTxHash(chain: string, value: string) {
    setChainRescueTxHashes((prev) => ({ ...prev, [chain]: value }));
  }

  function moduleItemCount(key: string) {
    const modules = workspace?.modules;
    switch (key) {
      case "support":
        return (modules?.support?.disputes?.length ?? 0) + (modules?.support?.tickets?.length ?? 0);
      case "moderation":
        return (modules?.moderation?.sellers?.length ?? 0) + (modules?.moderation?.listings?.length ?? 0);
      case "verification":
        return modules?.verification?.requests?.length ?? 0;
      case "escrow":
        return (modules?.escrow?.orders?.length ?? 0) + (modules?.escrow?.stocks?.length ?? 0) + (modules?.escrow?.chains?.length ?? 0);
      case "rewards":
        return (
          (modules?.rewards?.tasks?.length ?? 0) +
          (modules?.rewards?.promotions?.length ?? 0) +
          (modules?.rewards?.stores?.length ?? 0) +
          (modules?.rewards?.listings?.length ?? 0) +
          (modules?.rewards?.pending_reviews?.length ?? 0) +
          (modules?.rewards?.accounts?.length ?? 0)
        );
      case "admins":
        return (modules?.admins?.users?.length ?? 0) + (modules?.admins?.roles?.length ?? 0) + (modules?.admins?.system_control ? 1 : 0);
      default:
        return 0;
    }
  }

  function hasPermission(permission: string) {
    const admin = overview?.admin;
    return Boolean(admin?.role_key === "super_admin" || admin?.permissions.includes("*") || admin?.permissions.includes(permission));
  }

  function storeFeatureDraft(seller: any) {
    const storeId = String(seller?.user_id ?? seller?.id ?? "").trim();
    const name = String(seller?.business_name || seller?.display_name || seller?.market_username || seller?.profile?.full_name || seller?.profile?.username || "Featured store");
    return {
      storeId,
      title: name,
      subtitle: seller?.market_username ? `Shop @${seller.market_username} and discover their latest offers.` : "Shop this featured store and discover their latest offers.",
      metadata: { source: "admin_dashboard", feature_type: "store", store_id: storeId },
    };
  }

  function listingFeatureDraft(listing: any) {
    const listingId = String(listing?.id ?? "").trim();
    const storeId = String(listing?.seller_id ?? listing?.seller?.id ?? "").trim();
    const title = String(listing?.title || "Featured listing");
    return {
      listingId,
      storeId,
      title,
      subtitle: "Feature this listing for shoppers looking at rewards.",
      metadata: { source: "admin_dashboard", feature_type: "listing", listing_id: listingId, store_id: storeId || undefined },
    };
  }

  function useStoreForRewardFeature(seller: any) {
    const draft = storeFeatureDraft(seller);
    if (!draft.storeId) return;
    setRewardPromotionId("");
    setRewardPromotionPlacement("rewards_top");
    setRewardPromotionTitle(draft.title);
    setRewardPromotionSubtitle(draft.subtitle);
    setRewardPromotionMediaUrl("");
    setRewardPromotionSponsorLabel("Featured");
    setRewardPromotionCtaLabel("View store");
    setRewardPromotionCtaRoute("");
    setRewardPromotionStoreId(draft.storeId);
    setRewardPromotionListingId("");
    setRewardPromotionPriority("100");
    setRewardPromotionStartsAt("");
    setRewardPromotionEndsAt("");
    setRewardPromotionMetadata(JSON.stringify(draft.metadata, null, 2));
    setActiveModule("rewards");
    setRewardTab("build");
    setNotice("Store UUID added to the rewards feature builder.");
  }

  function useListingForRewardFeature(listing: any) {
    const draft = listingFeatureDraft(listing);
    if (!draft.listingId) return;
    setRewardPromotionId("");
    setRewardPromotionPlacement("rewards_top");
    setRewardPromotionTitle(draft.title);
    setRewardPromotionSubtitle(draft.subtitle);
    setRewardPromotionMediaUrl("");
    setRewardPromotionSponsorLabel("Featured");
    setRewardPromotionCtaLabel("View listing");
    setRewardPromotionCtaRoute("");
    setRewardPromotionStoreId(draft.storeId);
    setRewardPromotionListingId(draft.listingId);
    setRewardPromotionPriority("100");
    setRewardPromotionStartsAt("");
    setRewardPromotionEndsAt("");
    setRewardPromotionMetadata(JSON.stringify(draft.metadata, null, 2));
    setActiveModule("rewards");
    setRewardTab("build");
    setNotice("Listing UUID added to the rewards feature builder.");
  }

  function useCampaignForRewardFeature() {
    setRewardPromotionId("");
    setRewardPromotionPlacement("rewards_top");
    setRewardPromotionTitle("");
    setRewardPromotionSubtitle("");
    setRewardPromotionMediaUrl("");
    setRewardPromotionSponsorLabel("Campaign");
    setRewardPromotionCtaLabel("View offer");
    setRewardPromotionCtaRoute("/market/(tabs)");
    setRewardPromotionStoreId("");
    setRewardPromotionListingId("");
    setRewardPromotionPriority("100");
    setRewardPromotionStartsAt("");
    setRewardPromotionEndsAt("");
    setRewardPromotionMetadata(JSON.stringify({ source: "admin_dashboard", feature_type: "campaign" }, null, 2));
    setActiveModule("rewards");
    setRewardTab("build");
    setNotice("Campaign feature builder is ready.");
  }

  function featureDateInput(value?: string | null) {
    if (!value) return "";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return String(value);
    return date.toISOString();
  }

  function marketStoreFeatureDraft(seller: any) {
    const storeId = String(seller?.user_id ?? seller?.id ?? "").trim();
    const draft = marketStoreFeatureDrafts[storeId];
    return {
      until: draft?.until ?? featureDateInput(seller?.featured_until),
      limit: draft?.limit ?? String(Math.max(1, Number(seller?.featured_listing_limit ?? 12) || 12)),
    };
  }

  function updateMarketStoreFeatureDraft(storeId: string, patch: Partial<{ until: string; limit: string }>) {
    setMarketStoreFeatureDrafts((current) => ({
      ...current,
      [storeId]: {
        until: current[storeId]?.until ?? "",
        limit: current[storeId]?.limit ?? "12",
        ...patch,
      },
    }));
  }

  function setMarketStoreFeatureExpiry(storeId: string, days: number | null, limit = "12") {
    updateMarketStoreFeatureDraft(storeId, {
      until: days === null ? "" : new Date(Date.now() + days * 86_400_000).toISOString(),
      limit,
    });
  }

  async function saveMarketStoreFeature(seller: any, featured: boolean) {
    const storeId = String(seller?.user_id ?? "").trim();
    if (!storeId) return;
    const draft = marketStoreFeatureDraft(seller);
    await performAction(
      `market-store-feature-${storeId}-${featured ? "on" : "off"}`,
      {
        action: "set_market_store_feature",
        user_id: storeId,
        featured_enabled: featured,
        featured_until: featured ? draft.until.trim() : "",
        featured_listing_limit: featured ? draft.limit.trim() || "12" : "12",
      },
      false,
    );
  }

  function marketListingFeatureDraft(listing: any) {
    const listingId = String(listing?.id ?? "").trim();
    const draft = marketListingFeatureDrafts[listingId];
    const priorityValue = Number(listing?.featured_priority ?? 100);
    return {
      until: draft?.until ?? featureDateInput(listing?.featured_until),
      priority: draft?.priority ?? String(Math.max(0, Math.trunc(Number.isFinite(priorityValue) ? priorityValue : 100))),
    };
  }

  function updateMarketListingFeatureDraft(listingId: string, patch: Partial<{ until: string; priority: string }>) {
    setMarketListingFeatureDrafts((current) => ({
      ...current,
      [listingId]: {
        until: current[listingId]?.until ?? "",
        priority: current[listingId]?.priority ?? "100",
        ...patch,
      },
    }));
  }

  function setMarketListingFeatureExpiry(listingId: string, days: number | null, priority = "100") {
    updateMarketListingFeatureDraft(listingId, {
      until: days === null ? "" : new Date(Date.now() + days * 86_400_000).toISOString(),
      priority,
    });
  }

  async function saveMarketListingFeature(listing: any, featured: boolean) {
    const listingId = String(listing?.id ?? "").trim();
    if (!listingId) return;
    const draft = marketListingFeatureDraft(listing);
    await performAction(
      `market-listing-feature-${listingId}-${featured ? "on" : "off"}`,
      {
        action: "set_market_listing_feature",
        listing_id: listingId,
        featured_enabled: featured,
        featured_until: featured ? draft.until.trim() : "",
        featured_priority: featured ? draft.priority.trim() || "100" : "100",
      },
      false,
    );
  }

  async function createStoreFeatureNow(seller: any) {
    const draft = storeFeatureDraft(seller);
    if (!draft.storeId) return;
    await performAction(
      `reward-feature-store-${draft.storeId}`,
      {
        action: "upsert_reward_promotion",
        placement_key: "rewards_top",
        title: draft.title,
        subtitle: draft.subtitle,
        media_url: "",
        sponsor_label: "Featured",
        cta_label: "View store",
        cta_route: "",
        store_id: draft.storeId,
        listing_id: "",
        priority: "100",
        metadata: draft.metadata,
        active: true,
      },
      false,
    );
  }

  async function createListingFeatureNow(listing: any) {
    const draft = listingFeatureDraft(listing);
    if (!draft.listingId) return;
    await performAction(
      `reward-feature-listing-${draft.listingId}`,
      {
        action: "upsert_reward_promotion",
        placement_key: "rewards_top",
        title: draft.title,
        subtitle: draft.subtitle,
        media_url: "",
        sponsor_label: "Featured",
        cta_label: "View listing",
        cta_route: "",
        store_id: draft.storeId,
        listing_id: draft.listingId,
        priority: "100",
        metadata: draft.metadata,
        active: true,
      },
      false,
    );
  }

  function openAdminOrder(orderId?: string | null) {
    const id = String(orderId ?? "").trim();
    if (!id) return;
    setActiveModule("escrow");
    setEscrowTab("orders");
    setModuleSearch((prev) => ({ ...prev, escrow: id }));
    setNotice("Order opened in the admin escrow workspace.");
  }

  async function loadUnlockedDashboard() {
    setCheckingSession(true);
    const [nextOverview, nextWorkspace] = await Promise.all([loadAdminOverview(), loadAdminWorkspace()]);
    setOverview(nextOverview);
    setWorkspace(nextWorkspace);

    const permissions = nextOverview.admin.permissions ?? [];
    const nextVisible = nextOverview.modules.filter((module) => canSeeOverviewModule(module, permissions, nextOverview.admin.role_key));
    setActiveModule((prev) => (prev && nextVisible.some((module) => module.key === prev) ? prev : ((nextVisible[0]?.key ?? null) as ModuleKey | null)));
    setCheckingSession(false);
  }

  async function checkMembershipAndMaybeLoad() {
    setError(null);
    setNotice(null);
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
    setNotice(null);
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
    setNotice(null);
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
      setNotice(null);
      try {
        const result = await runAdminAction({ ...body, note: actionNote });
        if ((result as any)?.warning) setNotice(String((result as any).warning));
        setActionNote("");
        try {
          await loadUnlockedDashboard();
        } catch (e: any) {
          setError(String(e?.message || e || "Action saved. Refresh the workspace to view the latest status."));
        }
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

    const confirmed = await new Promise<boolean>((resolve) => {
      const browserConfirm = (globalThis as any)?.confirm;
      const message = "This action changes marketplace access and activity.";
      if (typeof browserConfirm === "function") {
        resolve(Boolean(browserConfirm(message)));
        return;
      }

      Alert.alert("Confirm action", message, [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        { text: "Confirm", style: "destructive", onPress: () => resolve(true) },
      ], { cancelable: true, onDismiss: () => resolve(false) });
    });

    if (confirmed) await execute();
  }

  function renderModuleNavItem(module: MarketAdminOverview["modules"][number], compact = false) {
    const key = module.key as ModuleKey;
    const meta = MODULE_META[key] ?? MODULE_META.support;
    const selected = currentModule === key;
    const count = moduleItemCount(key);
    return (
      <Pressable
        key={module.key}
        onPress={() => setActiveModule(key)}
        style={{
          borderRadius: 8,
          padding: compact ? 8 : 12,
          backgroundColor: selected ? `${meta.accent}18` : "transparent",
          borderWidth: 1,
          borderColor: selected ? `${meta.accent}55` : "transparent",
          flexDirection: compact ? "column" : "row",
          alignItems: "center",
          gap: compact ? 4 : 10,
          flex: compact ? 1 : undefined,
          minWidth: compact ? 0 : undefined,
        }}
      >
        <View
          style={{
            width: compact ? (isDesktop ? 30 : 26) : 32,
            height: compact ? (isDesktop ? 30 : 26) : 32,
            borderRadius: 8,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: selected ? `${meta.accent}22` : "rgba(255,255,255,0.06)",
          }}
        >
          <Ionicons name={meta.icon} size={compact ? (isDesktop ? 17 : 16) : 17} color={selected ? meta.accent : MUTED} />
        </View>
        <View style={{ flex: compact ? undefined : 1, minWidth: 0, alignItems: compact ? "center" : "flex-start" }}>
          <Text numberOfLines={1} style={{ color: selected ? TEXT : MUTED, fontWeight: "900", fontSize: compact ? (isDesktop ? 12 : 10) : 13 }}>
            {compact ? meta.shortTitle : module.title}
          </Text>
          {!compact ? (
            <Text numberOfLines={1} style={{ marginTop: 2, color: FAINT, fontWeight: "800", fontSize: 11 }}>
              {compactCount(count)} records
            </Text>
          ) : null}
        </View>
      </Pressable>
    );
  }

  function renderBottomNav() {
    if (!overview) return null;
    return (
      <View
        style={{
          position: "absolute",
          left: isDesktop ? 24 : 12,
          right: isDesktop ? 24 : 12,
          bottom: Math.max(insets.bottom, isDesktop ? 18 : 10),
          alignItems: "center",
        }}
      >
        <View
          style={{
          width: "100%",
          maxWidth: isDesktop ? 980 : undefined,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: BORDER,
          backgroundColor: "rgba(24,18,14,0.97)",
          padding: isDesktop ? 8 : 6,
          flexDirection: "row",
          justifyContent: "space-between",
          gap: isDesktop ? 8 : 4,
        }}
      >
        {visibleModules.map((module) => renderModuleNavItem(module, true))}
        </View>
      </View>
    );
  }

  function renderActionNote() {
    return (
      <View style={{ marginTop: 4 }}>
        <Text style={{ color: FAINT, fontSize: 11, fontWeight: "900", textTransform: "uppercase", marginBottom: 8 }}>
          Decision note
        </Text>
        <AdminTextInput
          value={actionNote}
          onChangeText={setActionNote}
          placeholder="Optional admin note for the next action"
          multiline
        />
      </View>
    );
  }

  async function pickSupportFiles(ticketId: string) {
    setSupportPickingId(ticketId);
    setError(null);
    setNotice(null);
    try {
      const DocumentPicker = require("expo-document-picker");
      const res = await DocumentPicker.getDocumentAsync({
        multiple: true,
        copyToCacheDirectory: true,
        type: "*/*",
      });
      if (res.canceled) return;
      const picked: SupportPickedFile[] = (res.assets ?? [])
        .filter((asset: any) => !!asset?.uri)
        .slice(0, 8)
        .map((asset: any) => ({
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          uri: asset.uri,
          name: asset.name ?? `support-proof-${Date.now()}`,
          mimeType: asset.mimeType ?? null,
          size: typeof asset.size === "number" ? asset.size : null,
          fileBody: asset.file ?? null,
        }));
      if (!picked.length) return;
      setSupportFiles((prev) => ({ ...prev, [ticketId]: [...(prev[ticketId] ?? []), ...picked].slice(0, 8) }));
    } catch (e: any) {
      setError(String(e?.message || e || "Could not attach proof."));
    } finally {
      setSupportPickingId(null);
    }
  }

  function removeSupportFile(ticketId: string, fileId: string) {
    setSupportFiles((prev) => ({
      ...prev,
      [ticketId]: (prev[ticketId] ?? []).filter((file) => file.id !== fileId),
    }));
  }

  async function openSupportAttachment(attachment: any) {
    try {
      const bucket = String(attachment?.storage_bucket || "market-support");
      const path = String(attachment?.storage_path || "");
      let url = String(attachment?.signed_url || attachment?.public_url || "");
      if (!url && path) {
        const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
        if (error) throw error;
        url = String(data?.signedUrl || "");
      }
      if (url) await Linking.openURL(url);
    } catch (e: any) {
      setError(String(e?.message || e || "Could not open proof."));
    }
  }

  async function submitSupportReply(ticket: any, body: string) {
    const ticketId = String(ticket?.id || "");
    const cleanBody = body.trim();
    const files = supportFiles[ticketId] ?? [];
    if (!ticketId || (!cleanBody && !files.length)) return;
    setWorkingKey(`support-reply-${ticketId}`);
    setError(null);
    setNotice(null);
    try {
      const uploadBatch = files.length ? await uploadSupportFiles(ticketId, `admin-${Date.now()}`, files) : [];
      await runAdminAction({
        action: "support_reply",
        ticket_id: ticketId,
        body: cleanBody,
        attachments: uploadBatch,
        note: actionNote,
      });
      setSupportReplies((prev) => ({ ...prev, [ticketId]: "" }));
      setSupportFiles((prev) => ({ ...prev, [ticketId]: [] }));
      setActionNote("");
      await loadUnlockedDashboard();
    } catch (e: any) {
      setError(String(e?.message || e || "Could not send support reply."));
    } finally {
      setWorkingKey(null);
      setCheckingSession(false);
    }
  }

  async function runSupportAiTriage(ticket: any, force = false) {
    const ticketId = String(ticket?.id || "");
    if (!ticketId) return;
    setWorkingKey(`support-ai-${ticketId}`);
    setError(null);
    setNotice(null);
    try {
      const result = await generateSupportAiTriage(ticketId, { force });
      setSupportAiResults((prev) => ({ ...prev, [ticketId]: result }));
      const suggestedReply = String(result.triage?.suggested_admin_reply || "").trim();
      setSupportReplies((prev) => (
        suggestedReply && !String(prev[ticketId] || "").trim()
          ? { ...prev, [ticketId]: suggestedReply }
          : prev
      ));
      setNotice(result.cached ? "Cached BestCity Ai triage loaded." : "BestCity Ai triage is ready. Review it before sending or changing priority.");
    } catch (e: any) {
      setError(String(e?.message || e || "Could not generate BestCity Ai triage."));
    } finally {
      setWorkingKey(null);
      setCheckingSession(false);
    }
  }

  async function runDisputeAiReview(dispute: any) {
    const disputeId = String(dispute?.id || "").trim();
    const orderId = String(dispute?.order_id || "").trim();
    const resultKey = disputeId || orderId;
    if (!resultKey) return;
    setWorkingKey(`dispute-ai-${resultKey}`);
    setError(null);
    setNotice(null);
    try {
      const result = await generateDisputeAiReview(disputeId, orderId);
      setDisputeAiResults((prev) => ({ ...prev, [resultKey]: result, [result.dispute_id]: result }));
      setNotice("BestCity Ai dispute review is ready. Use it as guidance, then make the admin decision.");
    } catch (e: any) {
      setError(String(e?.message || e || "Could not generate BestCity Ai dispute review."));
    } finally {
      setWorkingKey(null);
      setCheckingSession(false);
    }
  }

  function renderSupportPendingFiles(ticketId: string) {
    const files = supportFiles[ticketId] ?? [];
    if (!files.length) return null;
    return (
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {files.map((file) => (
          <View
            key={file.id}
            style={{
              borderRadius: 8,
              paddingHorizontal: 10,
              paddingVertical: 8,
              backgroundColor: "rgba(255,255,255,0.06)",
              borderWidth: 1,
              borderColor: BORDER,
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              maxWidth: 230,
            }}
          >
            <Ionicons name="document-attach-outline" size={15} color={ACCENT} />
            <Text numberOfLines={1} style={{ color: TEXT, fontSize: 12, fontWeight: "800", flex: 1 }}>
              {file.name || "Proof"}
            </Text>
            <Pressable onPress={() => removeSupportFile(ticketId, file.id)} hitSlop={8}>
              <Ionicons name="close" size={15} color={FAINT} />
            </Pressable>
          </View>
        ))}
      </View>
    );
  }

  function renderSupportAttachments(attachments?: any[]) {
    if (!attachments?.length) return null;
    return (
      <View style={{ marginTop: 8, flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {attachments.map((attachment: any) => (
          <Pressable
            key={String(attachment.id)}
            onPress={() => void openSupportAttachment(attachment)}
            style={{
              borderRadius: 8,
              paddingHorizontal: 10,
              paddingVertical: 8,
              backgroundColor: "rgba(255,255,255,0.06)",
              borderWidth: 1,
              borderColor: BORDER,
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              maxWidth: 240,
            }}
          >
            <Ionicons name={supportAttachmentIcon(attachment.kind)} size={15} color={ACCENT} />
            <Text numberOfLines={1} style={{ color: TEXT, fontSize: 12, fontWeight: "800", flex: 1 }}>
              {attachment.file_name || labelFromKey(String(attachment.kind || "proof"))}
            </Text>
            <Ionicons name="open-outline" size={14} color={FAINT} />
          </Pressable>
        ))}
      </View>
    );
  }

  function renderSupportAiTriage(ticket: any, canRespond: boolean) {
    const ticketId = String(ticket?.id || "");
    const result = supportAiResults[ticketId];
    const triage = result?.triage;
    if (!triage) return null;

    const currentPriority = String(ticket?.priority ?? "NORMAL").toUpperCase();
    const currentStatus = String(ticket?.status ?? "OPEN").toUpperCase();
    const suggestedReply = String(triage.suggested_admin_reply || "").trim();
    const suggestedPriority = String(triage.priority || "NORMAL").toUpperCase();
    const canApplyPriority = canRespond && suggestedPriority.length > 0 && suggestedPriority !== currentPriority;

    const renderList = (title: string, values: string[], color: string) => {
      const clean = values.map((value) => String(value || "").trim()).filter(Boolean);
      if (!clean.length) return null;
      return (
        <View style={{ flex: 1, minWidth: 220, gap: 6 }}>
          <Text style={{ color: FAINT, fontSize: 11, fontWeight: "900", textTransform: "uppercase" }}>{title}</Text>
          {clean.map((value, index) => (
            <View key={`${title}-${index}`} style={{ flexDirection: "row", gap: 7, alignItems: "flex-start" }}>
              <View style={{ width: 5, height: 5, borderRadius: 99, backgroundColor: color, marginTop: 7 }} />
              <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18, flex: 1 }}>{value}</Text>
            </View>
          ))}
        </View>
      );
    };

    return (
      <View style={{ marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: BORDER, gap: 12 }}>
        <View style={{ borderLeftWidth: 3, borderLeftColor: SUCCESS, paddingLeft: 12, gap: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <View style={{ flex: 1, minWidth: 220 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="sparkles-outline" size={16} color={SUCCESS} />
                <Text style={{ color: TEXT, fontWeight: "900", fontSize: 15 }}>BestCity Ai triage</Text>
              </View>
              <Text style={{ marginTop: 5, color: FAINT, fontSize: 11, fontWeight: "800" }}>
                {result.cached ? "Cached - " : ""}{result.model ? `${result.model} - ` : ""}{formatDate(result.generated_at)}
              </Text>
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
              <Pill label={labelFromKey(triage.category)} color={ACCENT} />
              <Pill label={suggestedPriority} color={priorityTone(suggestedPriority)} />
              <Pill label={`${triage.confidence} confidence`} color={confidenceTone(triage.confidence)} />
            </View>
          </View>

          {triage.summary ? (
            <Text style={{ color: TEXT, fontSize: 13, lineHeight: 20 }}>{triage.summary}</Text>
          ) : null}

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            {triage.customer_goal ? <InfoLine label="Customer wants" value={triage.customer_goal} /> : null}
            {triage.urgency_reason ? <InfoLine label="Urgency" value={triage.urgency_reason} /> : null}
            {triage.recommended_next_action ? <InfoLine label="Next action" value={triage.recommended_next_action} /> : null}
          </View>

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14 }}>
            {renderList("Key facts", triage.key_facts ?? [], SUCCESS)}
            {renderList("Missing evidence", triage.missing_evidence ?? [], WARNING)}
            {renderList("Risk flags", triage.risk_flags ?? [], DANGER)}
          </View>

          {suggestedReply ? (
            <View style={{ gap: 7 }}>
              <Text style={{ color: FAINT, fontSize: 11, fontWeight: "900", textTransform: "uppercase" }}>Suggested reply</Text>
              <Text style={{ color: MUTED, fontSize: 13, lineHeight: 20 }}>{suggestedReply}</Text>
            </View>
          ) : null}

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            <ActionButton
              icon="refresh-outline"
              label="Refresh BestCity Ai"
              color={ACCENT}
              disabled={!canRespond}
              loading={workingKey === `support-ai-${ticketId}`}
              onPress={() => void runSupportAiTriage(ticket, true)}
            />
            <ActionButton
              icon="create-outline"
              label="Use reply"
              color={SUCCESS}
              disabled={!canRespond || !suggestedReply}
              onPress={() => {
                setSupportReplies((prev) => ({ ...prev, [ticketId]: suggestedReply }));
                setNotice("Suggested reply copied into the support composer.");
              }}
            />
            <ActionButton
              icon="flag-outline"
              label={`Set ${suggestedPriority}`}
              color={priorityTone(suggestedPriority)}
              disabled={!canApplyPriority}
              loading={workingKey === `support-priority-${ticketId}`}
              onPress={() => performAction(`support-priority-${ticketId}`, {
                action: "support_update_status",
                ticket_id: ticketId,
                status: currentStatus,
                priority: suggestedPriority,
              })}
            />
          </View>
        </View>
      </View>
    );
  }

  function renderDisputeAiReview(dispute: any, canResolve: boolean) {
    const disputeId = String(dispute?.id || "").trim();
    const orderId = String(dispute?.order_id || "").trim();
    const resultKey = disputeId || orderId;
    const result = disputeAiResults[disputeId] ?? disputeAiResults[orderId] ?? disputeAiResults[resultKey];
    const review = result?.review;
    if (!review) return null;

    const recommendation = String(review.recommendation || "REQUEST_MORE_EVIDENCE").toUpperCase();
    const note = String(review.suggested_resolution_note || "").trim();
    const renderList = (title: string, values: string[], color: string) => {
      const clean = values.map((value) => String(value || "").trim()).filter(Boolean);
      if (!clean.length) return null;
      return (
        <View style={{ flex: 1, minWidth: 220, gap: 6 }}>
          <Text style={{ color: FAINT, fontSize: 11, fontWeight: "900", textTransform: "uppercase" }}>{title}</Text>
          {clean.map((value, index) => (
            <View key={`${disputeId}-${title}-${index}`} style={{ flexDirection: "row", gap: 7, alignItems: "flex-start" }}>
              <View style={{ width: 5, height: 5, borderRadius: 99, backgroundColor: color, marginTop: 7 }} />
              <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18, flex: 1 }}>{value}</Text>
            </View>
          ))}
        </View>
      );
    };

    return (
      <View style={{ marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: BORDER, gap: 12 }}>
        <View style={{ borderLeftWidth: 3, borderLeftColor: recommendationTone(recommendation), paddingLeft: 12, gap: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <View style={{ flex: 1, minWidth: 220 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="sparkles-outline" size={16} color={recommendationTone(recommendation)} />
                <Text style={{ color: TEXT, fontWeight: "900", fontSize: 15 }}>BestCity Ai dispute review</Text>
              </View>
              <Text style={{ marginTop: 5, color: FAINT, fontSize: 11, fontWeight: "800" }}>
                Admin only - {result.model ? `${result.model} - ` : ""}{formatDate(result.generated_at)}
              </Text>
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
              <Pill label={labelFromKey(recommendation.toLowerCase())} color={recommendationTone(recommendation)} />
              <Pill label={`${review.confidence} confidence`} color={confidenceTone(review.confidence)} />
              <Pill label={`${result.image_count || 0} image${result.image_count === 1 ? "" : "s"} read`} color={ACCENT} />
            </View>
          </View>

          {review.summary ? (
            <Text style={{ color: TEXT, fontSize: 13, lineHeight: 20 }}>{review.summary}</Text>
          ) : null}

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            {review.buyer_claim ? <InfoLine label="Buyer claim" value={review.buyer_claim} /> : null}
            {review.seller_claim ? <InfoLine label="Seller claim" value={review.seller_claim} /> : null}
            {review.recommended_admin_action ? <InfoLine label="Admin next step" value={review.recommended_admin_action} /> : null}
          </View>

          {review.evidence_assessment ? (
            <View style={{ gap: 7 }}>
              <Text style={{ color: FAINT, fontSize: 11, fontWeight: "900", textTransform: "uppercase" }}>Evidence assessment</Text>
              <Text style={{ color: MUTED, fontSize: 13, lineHeight: 20 }}>{review.evidence_assessment}</Text>
            </View>
          ) : null}

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14 }}>
            {renderList("Image observations", review.image_observations ?? [], ACCENT)}
            {renderList("Key facts", review.key_facts ?? [], SUCCESS)}
            {renderList("Contradictions", review.contradictions ?? [], WARNING)}
            {renderList("Missing evidence", review.missing_evidence ?? [], WARNING)}
            {renderList("Risk flags", review.risk_flags ?? [], DANGER)}
          </View>

          {result.skipped_images?.length ? (
            <Text style={{ color: FAINT, fontSize: 12, lineHeight: 18 }}>
              Some images were not read: {result.skipped_images.join("; ")}
            </Text>
          ) : null}

          {note ? (
            <View style={{ gap: 7 }}>
              <Text style={{ color: FAINT, fontSize: 11, fontWeight: "900", textTransform: "uppercase" }}>Suggested internal note</Text>
              <Text style={{ color: MUTED, fontSize: 13, lineHeight: 20 }}>{note}</Text>
            </View>
          ) : null}

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            <ActionButton
              icon="refresh-outline"
              label="Refresh BestCity Ai"
              color={ACCENT}
              disabled={!canResolve}
              loading={workingKey === `dispute-ai-${resultKey}`}
              onPress={() => void runDisputeAiReview(dispute)}
            />
            <ActionButton
              icon="create-outline"
              label="Use note"
              color={SUCCESS}
              disabled={!canResolve || !note}
              onPress={() => {
                setActionNote(note);
                setNotice("Suggested dispute note copied into the decision note box.");
              }}
            />
          </View>
        </View>
      </View>
    );
  }

  function renderSupport() {
    const allTickets = workspace?.modules.support?.tickets ?? [];
    const allDisputes = workspace?.modules.support?.disputes ?? [];
    const supportTicketRole = overview?.admin.role_key === "super_admin" || overview?.admin.role_key === "support_admin";
    const canRespond = supportTicketRole && hasPermission("complaints.respond");
    const searchedTickets = allTickets.filter((ticket: any) => matchesSearch(currentModuleSearch, [
      ticket.id,
      ticket.subject,
      ticket.category,
      ticket.priority,
      ticket.status,
      ticket.related_order_id,
      ticket.message_slug,
      personLabel(ticket.user),
      personLabel(ticket.assigned_admin),
      ...(ticket.messages ?? []).map((message: any) => message.body),
      ...(ticket.messages ?? []).map((message: any) => message.message_slug),
    ]));
    const supportCounts: Record<SupportStatusTab, number> = {
      fresh: searchedTickets.filter((ticket: any) => String(ticket.status).toUpperCase() === "OPEN").length,
      in_progress: searchedTickets.filter((ticket: any) => String(ticket.status).toUpperCase() === "IN_PROGRESS").length,
      resolved: searchedTickets.filter((ticket: any) => String(ticket.status).toUpperCase() === "RESOLVED").length,
      closed: searchedTickets.filter((ticket: any) => String(ticket.status).toUpperCase() === "CLOSED").length,
      all: searchedTickets.length,
    };
    const tickets = supportStatusTab === "all"
      ? searchedTickets
      : searchedTickets.filter((ticket: any) => {
        const status = String(ticket.status ?? "").toUpperCase();
        if (supportStatusTab === "fresh") return status === "OPEN";
        if (supportStatusTab === "in_progress") return status === "IN_PROGRESS";
        if (supportStatusTab === "resolved") return status === "RESOLVED";
        return status === "CLOSED";
      });
    const latestSupportMessage = (ticket: any) => {
      const messages = Array.isArray(ticket?.messages) ? ticket.messages : [];
      return messages.length ? messages[messages.length - 1] : null;
    };
    const supportMessagePreview = (ticket: any) => {
      const latest = latestSupportMessage(ticket);
      const text = String(latest?.body || "").replace(/\s+/g, " ").trim();
      if (text) return text;
      if (latest?.attachments?.length) return "[Attachment]";
      return "Conversation is empty";
    };
    const selectedTicket = tickets.find((ticket: any) => String(ticket.id) === String(selectedSupportTicketId)) ?? null;
    const disputes = allDisputes.filter((dispute: any) => matchesSearch(currentModuleSearch, [
      dispute.id,
      dispute.order_id,
      dispute.reason,
      dispute.status,
      dispute.listing?.title,
      dispute.order?.status,
      personLabel(dispute.buyer),
      personLabel(dispute.seller),
    ]));
    const canResolve = hasPermission("disputes.resolve");

    return (
      <View style={{ marginTop: 18, gap: 12 }}>
        <SectionHeader
          icon="chatbubbles-outline"
          title="Support queue"
          subtitle="Review case slugs, then open the dedicated support-admin chat for replies and status updates."
          count={tickets.length + disputes.length}
        >
          <View style={{ gap: 10 }}>
            <SearchBox value={currentModuleSearch} onChangeText={setCurrentModuleSearch} placeholder="Search support by user, subject, order, status, or reason" />
            <SegmentedControl
              value={supportStatusTab}
              onChange={setSupportStatusTab}
              options={[
                { key: "fresh", label: "Fresh", count: supportCounts.fresh },
                { key: "in_progress", label: "In progress", count: supportCounts.in_progress },
                { key: "resolved", label: "Resolved", count: supportCounts.resolved },
                { key: "closed", label: "Closed", count: supportCounts.closed },
                { key: "all", label: "All", count: supportCounts.all },
              ]}
            />
          </View>
        </SectionHeader>

        {supportTicketRole ? (
          <View style={{ gap: 10 }}>
            <View style={{ width: "100%", gap: 10 }}>
              {tickets.length ? tickets.map((ticket: any) => {
                const latest = latestSupportMessage(ticket);
                const status = String(ticket.status ?? "OPEN").toUpperCase();
                return (
                  <Pressable
                    key={ticket.id}
                    onPress={() => openSupportTicket(ticket.id)}
                    style={{
                      borderRadius: 8,
                      padding: 12,
                      backgroundColor: PANEL_ALT,
                      borderWidth: 1,
                      borderColor: BORDER,
                      flexDirection: "row",
                      gap: 11,
                      alignItems: "flex-start",
                    }}
                  >
                    <View
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 8,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: "rgba(245,158,11,0.12)",
                        borderWidth: 1,
                        borderColor: "rgba(245,158,11,0.28)",
                      }}
                    >
                      <Ionicons name="chatbubble-ellipses-outline" size={19} color={ACCENT} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text numberOfLines={1} style={{ color: SUCCESS, fontSize: 12, fontWeight: "900" }}>
                            support-{shortId(ticket.id).toLowerCase()}
                          </Text>
                          <Text numberOfLines={1} style={{ color: TEXT, fontSize: 15, fontWeight: "900" }}>{ticket.subject}</Text>
                          <Text numberOfLines={1} style={{ marginTop: 3, color: MUTED, fontSize: 12, fontWeight: "800" }}>
                            {personLabel(ticket.user)}
                          </Text>
                        </View>
                        <Text style={{ color: FAINT, fontSize: 11, fontWeight: "800" }}>{formatDate(latest?.created_at ?? ticket.last_message_at)}</Text>
                      </View>
                      <Text numberOfLines={1} style={{ marginTop: 6, color: MUTED, fontSize: 12, lineHeight: 18 }}>
                        {supportMessagePreview(ticket)}
                      </Text>
                      <View style={{ marginTop: 9, flexDirection: "row", flexWrap: "wrap", gap: 7, alignItems: "center" }}>
                        <Pill label={status} color={statusTone(status)} />
                        <Pill label={String(ticket.priority ?? "NORMAL")} color={String(ticket.priority).toUpperCase() === "URGENT" ? DANGER : ACCENT} />
                        {ticket.message_slug ? <Text style={{ color: ACCENT, fontSize: 10, fontWeight: "900" }}>@{ticket.message_slug}</Text> : null}
                        {latest?.attachments?.length ? <Ionicons name="document-attach-outline" size={14} color={FAINT} /> : null}
                      </View>
                    </View>
                  </Pressable>
                );
              }) : (
                <EmptyState title={allTickets.length ? "No matching support tickets" : "Support queue is clear"} subtitle={allTickets.length ? "Clear the search or try a subject, user, status, or order ID." : "No tickets require this view."} />
              )}
            </View>

            <View style={{ display: "none" }}>
              {selectedTicket ? (() => {
                const messages = selectedTicket.messages ?? [];
                const draft = supportReplies[selectedTicket.id] ?? "";
                const pendingFiles = supportFiles[selectedTicket.id] ?? [];
                const status = String(selectedTicket.status ?? "OPEN").toUpperCase();
                const ticketDmSlug = selectedTicket.message_slug || dmSlugForUser(selectedTicket.user);
                return (
                  <RecordCard>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                      <View style={{ flex: 1, minWidth: 220 }}>
                        <Text style={{ color: TEXT, fontWeight: "900", fontSize: 18 }}>{selectedTicket.subject}</Text>
                        <Text style={{ marginTop: 6, color: MUTED, fontSize: 13, lineHeight: 20 }}>
                          {personLabel(selectedTicket.user)} - {labelFromKey(String(selectedTicket.category ?? "general"))}
                        </Text>
                      </View>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
                        <Pill label={status} color={statusTone(status)} />
                        <Pill label={String(selectedTicket.priority ?? "NORMAL")} color={String(selectedTicket.priority).toUpperCase() === "URGENT" ? DANGER : ACCENT} />
                      </View>
                    </View>

                    <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                      <InfoLine label="User" value={personLabel(selectedTicket.user)} />
                      <InfoLine label="User slug" value={ticketDmSlug ? `@${ticketDmSlug}` : "n/a"} />
                      <CopyableIdLine label="User UUID" value={selectedTicket.user_id ?? selectedTicket.user?.id} />
                      {selectedTicket.user?.seller ? <CopyableIdLine label="Store UUID" value={selectedTicket.user?.seller?.user_id ?? selectedTicket.user_id ?? selectedTicket.user?.id} /> : null}
                      <InfoLine label="Order" value={selectedTicket.related_order_id ? shortId(selectedTicket.related_order_id) : "n/a"} />
                      <InfoLine label="Assigned" value={selectedTicket.assigned_admin ? personLabel(selectedTicket.assigned_admin) : "Unassigned"} />
                      <InfoLine label="Last message" value={formatDate(selectedTicket.last_message_at)} />
                    </View>

                    <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                      {selectedTicket.related_order_id ? (
                        <ActionButton icon="receipt-outline" label="Open order" color={WARNING} onPress={() => openAdminOrder(selectedTicket.related_order_id)} />
                      ) : null}
                      <ActionButton
                        icon="sparkles-outline"
                        label="BestCity Ai triage"
                        color={SUCCESS}
                        disabled={!canRespond}
                        loading={workingKey === `support-ai-${selectedTicket.id}`}
                        onPress={() => void runSupportAiTriage(selectedTicket)}
                      />
                    </View>

                    {renderSupportAiTriage(selectedTicket, canRespond)}

                    <View style={{ marginTop: 14, gap: 8 }}>
                      {messages.length ? messages.map((message: any) => {
                        const fromAdmin = String(message.sender_kind ?? "").toUpperCase() === "ADMIN";
                        return (
                          <View
                            key={message.id}
                            style={{
                              alignSelf: fromAdmin ? "flex-start" : "flex-end",
                              maxWidth: "92%",
                              borderRadius: 8,
                              padding: 10,
                              backgroundColor: fromAdmin ? "rgba(74,222,128,0.10)" : "rgba(245,158,11,0.11)",
                              borderWidth: 1,
                              borderColor: fromAdmin ? "rgba(74,222,128,0.22)" : "rgba(245,158,11,0.24)",
                            }}
                          >
                            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                              <Text style={{ color: fromAdmin ? SUCCESS : ACCENT, fontSize: 11, fontWeight: "900", textTransform: "uppercase" }}>
                                {fromAdmin ? "Support" : "User"} - {formatDate(message.created_at)}
                              </Text>
                              {!fromAdmin && message.message_slug ? (
                                <Text style={{ color: ACCENT, fontSize: 11, fontWeight: "900" }}>@{message.message_slug}</Text>
                              ) : null}
                            </View>
                            {message.body ? <Text style={{ marginTop: 5, color: TEXT, fontSize: 13, lineHeight: 19 }}>{message.body}</Text> : null}
                            {renderSupportAttachments(message.attachments)}
                          </View>
                        );
                      }) : (
                        <Text style={{ color: MUTED, fontSize: 13 }}>Conversation is empty.</Text>
                      )}
                    </View>

                    <View style={{ marginTop: 14, gap: 10 }}>
                      <AdminTextInput
                        value={draft}
                        onChangeText={(value) => setSupportReplies((prev) => ({ ...prev, [selectedTicket.id]: value }))}
                        placeholder="Reply to the user"
                        multiline
                      />
                      {renderSupportPendingFiles(selectedTicket.id)}
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                        <ActionButton
                          icon="document-attach-outline"
                          label="Attach proof"
                          color={ACCENT}
                          disabled={!canRespond}
                          loading={supportPickingId === selectedTicket.id}
                          onPress={() => void pickSupportFiles(selectedTicket.id)}
                        />
                        <ActionButton
                          icon="send-outline"
                          label="Send reply"
                          color={SUCCESS}
                          disabled={!canRespond || (!draft.trim() && !pendingFiles.length)}
                          loading={workingKey === `support-reply-${selectedTicket.id}`}
                          onPress={() => void submitSupportReply(selectedTicket, draft)}
                        />
                        <ActionButton
                          icon="eye-outline"
                          label="In progress"
                          color={ACCENT}
                          disabled={!canRespond || status === "IN_PROGRESS"}
                          loading={workingKey === `support-progress-${selectedTicket.id}`}
                          onPress={() => performAction(`support-progress-${selectedTicket.id}`, { action: "support_update_status", ticket_id: selectedTicket.id, status: "IN_PROGRESS" })}
                        />
                        <ActionButton
                          icon="checkmark-circle-outline"
                          label="Resolve"
                          color={SUCCESS}
                          disabled={!canRespond || status === "RESOLVED"}
                          loading={workingKey === `support-resolve-${selectedTicket.id}`}
                          onPress={() => performAction(`support-resolve-${selectedTicket.id}`, { action: "support_update_status", ticket_id: selectedTicket.id, status: "RESOLVED" }, true)}
                        />
                        <ActionButton
                          icon="refresh-outline"
                          label="Reopen"
                          color={WARNING}
                          disabled={!canRespond || status === "OPEN"}
                          loading={workingKey === `support-reopen-${selectedTicket.id}`}
                          onPress={() => performAction(`support-reopen-${selectedTicket.id}`, { action: "support_update_status", ticket_id: selectedTicket.id, status: "OPEN" })}
                        />
                      </View>
                    </View>
                  </RecordCard>
                );
              })() : (
                <EmptyState title="Select a support ticket" subtitle="Choose a case to read the thread and respond." />
              )}
            </View>
          </View>
        ) : null}

        <View style={{ marginTop: 8, gap: 12 }}>
          <SectionHeader
            icon="alert-circle-outline"
            title="Dispute queue"
            subtitle="Review active order disputes, evidence, buyer context, and seller context."
            count={disputes.length}
          />
          {renderActionNote()}
        {disputes.length ? disputes.map((dispute: any) => {
          const order = dispute.order ?? {};
          const currency = String(order.currency ?? "").toUpperCase();
          const disputeKey = String(dispute.id || dispute.order_id || "");
          const needsEscrowPower = ["USDC", "USDT"].includes(currency) && !hasPermission("escrow.settle");
          const messages = Array.isArray(dispute.messages) ? dispute.messages : [];
          const evidenceCount = messages.reduce((sum: number, message: any) => sum + (message.attachments?.length ?? 0), 0);
          const evidenceText = [
            evidenceCount ? `${evidenceCount} proof file${evidenceCount === 1 ? "" : "s"}` : "No party proof",
            dispute.deliverable ? "seller deliverable" : null,
          ].filter(Boolean).join(" + ");
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
                <InfoLine label="Evidence" value={evidenceText} />
              </View>

              {needsEscrowPower ? (
                <Text style={{ marginTop: 12, color: WARNING, fontSize: 12, fontWeight: "800" }}>
                  Stablecoin settlement needs escrow.settle permission.
                </Text>
              ) : null}

              {renderDisputeAiReview(dispute, canResolve)}

              <View style={{ marginTop: 14, gap: 10 }}>
                <Text style={{ color: TEXT, fontWeight: "900", fontSize: 13 }}>Party statements</Text>
                {messages.length ? messages.map((message: any) => (
                  <View
                    key={message.id}
                    style={{
                      borderRadius: 8,
                      padding: 12,
                      backgroundColor: "rgba(255,255,255,0.045)",
                      borderWidth: 1,
                      borderColor: BORDER,
                      gap: 8,
                    }}
                  >
                    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <Text style={{ color: TEXT, fontWeight: "900", fontSize: 13 }}>
                        {message.sender_kind === "ADMIN" ? "Admin" : `${labelFromKey(String(message.sender_kind || "party").toLowerCase())}: ${personLabel(message.sender)}`}
                      </Text>
                      <Text style={{ color: FAINT, fontSize: 11, fontWeight: "800" }}>{formatDate(message.created_at)}</Text>
                    </View>
                    {message.body ? (
                      <Text style={{ color: MUTED, lineHeight: 20, fontSize: 13 }}>{message.body}</Text>
                    ) : (
                      <Text style={{ color: FAINT, lineHeight: 20, fontSize: 13 }}>Proof attached.</Text>
                    )}
                    {message.attachments?.length ? (
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                        {message.attachments.map((attachment: any) => (
                          <Pressable
                            key={attachment.id}
                            onPress={() => openSupportAttachment(attachment)}
                            style={{
                              borderRadius: 8,
                              paddingHorizontal: 10,
                              paddingVertical: 8,
                              borderWidth: 1,
                              borderColor: "rgba(56,189,248,0.28)",
                              backgroundColor: "rgba(56,189,248,0.10)",
                              flexDirection: "row",
                              gap: 7,
                              alignItems: "center",
                              maxWidth: "100%",
                            }}
                          >
                            <Ionicons name={supportAttachmentIcon(attachment.kind)} size={15} color={ACCENT} />
                            <Text numberOfLines={1} style={{ color: TEXT, fontWeight: "900", fontSize: 12, maxWidth: 220 }}>
                              {attachment.file_name || "Open proof"}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                  </View>
                )) : (
                  <Text style={{ color: MUTED, lineHeight: 20, fontSize: 13 }}>
                    No buyer or seller statement yet. Ask both parties to add their side from the order page.
                  </Text>
                )}
              </View>

              <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                <ActionButton
                  icon="receipt-outline"
                  label="Open order"
                  color={WARNING}
                  onPress={() => openAdminOrder(dispute.order_id)}
                />
                <ActionButton
                  icon="person-circle-outline"
                  label="Buyer profile"
                  color={ACCENT}
                  disabled={!canOpenSellerProfile(dispute.buyer)}
                  onPress={() => openSellerProfile(dispute.buyer)}
                />
                <ActionButton
                  icon="storefront-outline"
                  label="Seller profile"
                  color={ACCENT}
                  disabled={!canOpenSellerProfile(dispute.seller)}
                  onPress={() => openSellerProfile(dispute.seller)}
                />
                {dispute.listing?.id ? (
                  <ActionButton
                    icon="open-outline"
                    label="Open listing"
                    color={WARNING}
                    onPress={() => openListing(dispute.listing.id)}
                  />
                ) : null}
                <ActionButton
                  icon="sparkles-outline"
                  label="BestCity Ai review"
                  color={SUCCESS}
                  disabled={!canResolve}
                  loading={workingKey === `dispute-ai-${disputeKey}`}
                  onPress={() => void runDisputeAiReview(dispute)}
                />
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
          <EmptyState title={allDisputes.length ? "No matching disputes" : "No open disputes"} subtitle={allDisputes.length ? "Clear the search or try a buyer, seller, order ID, or status." : "The support queue is clear for this role."} />
        )}
        </View>
      </View>
    );
  }

  function renderModeration() {
    const allSellers = workspace?.modules.moderation?.sellers ?? [];
    const allListings = workspace?.modules.moderation?.listings ?? [];
    const sellers = allSellers.filter((seller: any) => matchesSearch(currentModuleSearch, [
      seller.user_id,
      seller.business_name,
      seller.display_name,
      seller.market_username,
      seller.profile?.email,
      seller.profile?.full_name,
      seller.payout_tier,
      seller.is_verified ? "verified" : "unverified",
      seller.active === false ? "paused" : "active",
      seller.featured_enabled ? "featured market home" : "not featured",
    ]));
    const listings = allListings.filter((listing: any) => matchesSearch(currentModuleSearch, [
      listing.id,
      listing.title,
      listing.category,
      listing.sub_category,
      listing.currency,
      listing.delivery_type,
      listing.is_active === false ? "disabled" : "live",
      listing.featured_enabled ? "featured market home" : "not featured",
      personLabel(listing.seller),
    ]));
    const canModerateUsers = hasPermission("users.moderate");
    const canModerateListings = hasPermission("listings.moderate");
    const canBanUsers = hasPermission("users.delete");
    const canFeaturePromotions = hasPermission("rewards.promotions.manage");
    const canFeatureMarketHome = canModerateUsers || canModerateListings || canFeaturePromotions;
    const canFeatureMarketStores = canFeatureMarketHome;

    return (
      <View style={{ marginTop: 18, gap: 14 }}>
        <SectionHeader
          icon="people-outline"
          title="Users and listings"
          subtitle="Separate views keep account moderation and listing moderation from becoming one noisy pile."
          count={moderationTab === "sellers" ? sellers.length : listings.length}
        >
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <SearchBox
              value={currentModuleSearch}
              onChangeText={setCurrentModuleSearch}
              placeholder={moderationTab === "sellers" ? "Search sellers by email, username, status, or risk" : "Search listings by title, seller, category, status, or currency"}
            />
            <SegmentedControl
              value={moderationTab}
              onChange={setModerationTab}
              options={[
                { key: "sellers", label: "Sellers", count: sellers.length },
                { key: "listings", label: "Listings", count: listings.length },
              ]}
            />
          </View>
        </SectionHeader>
        {renderActionNote()}

        {moderationTab === "sellers" ? (
          sellers.length ? sellers.map((seller: any) => {
          const active = seller.active !== false;
          const featuredUntilMs = seller.featured_until ? new Date(String(seller.featured_until)).getTime() : null;
          const marketFeatured = seller.featured_enabled === true && (!featuredUntilMs || featuredUntilMs >= Date.now());
          const marketFeatureExpired = seller.featured_enabled === true && !!featuredUntilMs && featuredUntilMs < Date.now();
          const featureDraft = marketStoreFeatureDraft(seller);
          return (
            <RecordCard key={seller.user_id}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <View style={{ flex: 1, minWidth: 220 }}>
                  <Pressable disabled={!canOpenSellerProfile(seller)} onPress={() => openSellerProfile(seller)} style={{ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start" }}>
                    <Text style={{ color: TEXT, fontWeight: "900", fontSize: 17 }}>{seller.business_name || seller.display_name || seller.market_username || "Seller"}</Text>
                    {canOpenSellerProfile(seller) ? <Ionicons name="open-outline" size={14} color={WARNING} /> : null}
                  </Pressable>
                  <Text style={{ marginTop: 5, color: MUTED, fontSize: 13 }}>{seller.profile?.email ?? shortId(seller.user_id)}</Text>
                </View>
                <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <Pill label={active ? "ACTIVE" : "PAUSED"} color={active ? SUCCESS : DANGER} />
                  {marketFeatured ? <Pill label="MARKET FEATURED" color={WARNING} /> : null}
                  {marketFeatureExpired ? <Pill label="FEATURE EXPIRED" color={DANGER} /> : null}
                </View>
              </View>

              <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                <CopyableIdLine label="Store UUID" value={seller.user_id} />
                <InfoLine label="Username" value={seller.market_username ? `@${seller.market_username}` : "n/a"} />
                <InfoLine label="Risk" value={String(seller.risk_score ?? 0)} />
                <InfoLine label="Verified" value={seller.is_verified ? "Yes" : "No"} />
                <InfoLine label="Payout" value={seller.payout_tier ?? "standard"} />
                <InfoLine
                  label="Home feature"
                  value={
                    seller.featured_enabled
                      ? `${marketFeatureExpired ? "Expired" : "On"} - ${seller.featured_until ? formatDate(seller.featured_until) : "No expiry"}`
                      : "Off"
                  }
                />
                <InfoLine label="Listing limit" value={String(seller.featured_listing_limit ?? 12)} />
              </View>

              <View
                style={{
                  marginTop: 14,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: "rgba(245,158,11,0.22)",
                  backgroundColor: "rgba(245,158,11,0.07)",
                  padding: 12,
                  gap: 10,
                }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                  <View style={{ flex: 1, minWidth: 220 }}>
                    <Text style={{ color: TEXT, fontWeight: "900", fontSize: 14 }}>Market home feature</Text>
                    <Text style={{ marginTop: 4, color: MUTED, fontSize: 12, lineHeight: 18 }}>
                      Featured stores feed listings into Market Home. The Featured Stores filter still opens store profiles.
                    </Text>
                  </View>
                  <Pill label={marketFeatured ? "VISIBLE ON HOME" : marketFeatureExpired ? "EXPIRED" : "NOT FEATURED"} color={marketFeatured ? SUCCESS : marketFeatureExpired ? DANGER : MUTED} />
                </View>

                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                  <View style={{ flex: 1, minWidth: 180 }}>
                    <Text style={{ color: FAINT, fontSize: 11, fontWeight: "900", textTransform: "uppercase", marginBottom: 6 }}>
                      Listing limit
                    </Text>
                    <AdminTextInput
                      value={featureDraft.limit}
                      onChangeText={(value) => updateMarketStoreFeatureDraft(seller.user_id, { limit: value.replace(/[^\d]/g, "").slice(0, 3), until: featureDraft.until })}
                      placeholder="12"
                      autoCapitalize="none"
                      editable={canFeatureMarketStores}
                    />
                  </View>
                  <View style={{ flex: 2, minWidth: 260 }}>
                    <Text style={{ color: FAINT, fontSize: 11, fontWeight: "900", textTransform: "uppercase", marginBottom: 6 }}>
                      Expiry date
                    </Text>
                    <AdminTextInput
                      value={featureDraft.until}
                      onChangeText={(value) => updateMarketStoreFeatureDraft(seller.user_id, { until: value, limit: featureDraft.limit })}
                      placeholder="Optional ISO date, for example 2026-06-01T12:00:00Z"
                      autoCapitalize="none"
                      editable={canFeatureMarketStores}
                    />
                  </View>
                </View>

                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  <ActionButton icon="time-outline" label="7 days" color={ACCENT} disabled={!canFeatureMarketStores} onPress={() => setMarketStoreFeatureExpiry(seller.user_id, 7, featureDraft.limit)} />
                  <ActionButton icon="calendar-outline" label="30 days" color={ACCENT} disabled={!canFeatureMarketStores} onPress={() => setMarketStoreFeatureExpiry(seller.user_id, 30, featureDraft.limit)} />
                  <ActionButton icon="infinite-outline" label="No expiry" color={ACCENT} disabled={!canFeatureMarketStores} onPress={() => setMarketStoreFeatureExpiry(seller.user_id, null, featureDraft.limit)} />
                  <ActionButton
                    icon="sparkles-outline"
                    label="Save home feature"
                    color={SUCCESS}
                    disabled={!canFeatureMarketStores}
                    loading={workingKey === `market-store-feature-${seller.user_id}-on`}
                    onPress={() => void saveMarketStoreFeature(seller, true)}
                  />
                  <ActionButton
                    icon="remove-circle-outline"
                    label="Remove from home"
                    color={DANGER}
                    disabled={!canFeatureMarketStores || !seller.featured_enabled}
                    loading={workingKey === `market-store-feature-${seller.user_id}-off`}
                    onPress={() => void saveMarketStoreFeature(seller, false)}
                  />
                </View>
              </View>

              <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                <ActionButton
                  icon="person-circle-outline"
                  label="View profile"
                  color={WARNING}
                  disabled={!canOpenSellerProfile(seller)}
                  onPress={() => openSellerProfile(seller)}
                />
                <ActionButton
                  icon="copy-outline"
                  label="Copy store UUID"
                  color={ACCENT}
                  onPress={() => void copyTextValue("Store UUID", seller.user_id)}
                />
                <ActionButton
                  icon="megaphone-outline"
                  label="Use in rewards"
                  color={SUCCESS}
                  disabled={!canFeaturePromotions}
                  onPress={() => useStoreForRewardFeature(seller)}
                />
                <ActionButton
                  icon="flash-outline"
                  label="Reward feature now"
                  color={SUCCESS}
                  disabled={!canFeaturePromotions}
                  loading={workingKey === `reward-feature-store-${seller.user_id}`}
                  onPress={() => void createStoreFeatureNow(seller)}
                />
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
                    label="Ban profile"
                    color={DANGER}
                    loading={workingKey === `ban-${seller.user_id}`}
                    onPress={() => performAction(`ban-${seller.user_id}`, { action: "ban_user", user_id: seller.user_id }, true)}
                  />
                ) : null}
              </View>
            </RecordCard>
          );
        }) : (
          <EmptyState title={allSellers.length ? "No matching sellers" : "No seller profiles"} subtitle={allSellers.length ? "Try an email, username, active status, or payout tier." : "There are no seller profiles in the current queue."} />
        )) : (
          listings.length ? listings.map((listing: any) => {
          const active = listing.is_active !== false;
          const featuredUntilMs = listing.featured_until ? new Date(String(listing.featured_until)).getTime() : null;
          const marketFeatured = listing.featured_enabled === true && (!featuredUntilMs || featuredUntilMs >= Date.now());
          const marketFeatureExpired = listing.featured_enabled === true && !!featuredUntilMs && featuredUntilMs < Date.now();
          const featureDraft = marketListingFeatureDraft(listing);
          return (
            <RecordCard key={listing.id}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <View style={{ flex: 1, minWidth: 220 }}>
                  <Pressable onPress={() => openListing(listing.id)} style={{ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start" }}>
                    <Text style={{ color: TEXT, fontWeight: "900", fontSize: 17 }}>{listing.title}</Text>
                    <Ionicons name="open-outline" size={14} color={WARNING} />
                  </Pressable>
                  <Pressable disabled={!canOpenSellerProfile(listing.seller)} onPress={() => openSellerProfile(listing.seller)} style={{ marginTop: 5, flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start" }}>
                    <Text style={{ color: MUTED, fontSize: 13 }}>{personLabel(listing.seller)}</Text>
                    {canOpenSellerProfile(listing.seller) ? <Ionicons name="person-circle-outline" size={13} color={WARNING} /> : null}
                  </Pressable>
                </View>
                <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <Pill label={active ? "LIVE" : "DISABLED"} color={active ? SUCCESS : DANGER} />
                  {marketFeatured ? <Pill label="MARKET FEATURED" color={WARNING} /> : null}
                  {marketFeatureExpired ? <Pill label="FEATURE EXPIRED" color={DANGER} /> : null}
                </View>
              </View>

              <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                <CopyableIdLine label="Listing UUID" value={listing.id} />
                <CopyableIdLine label="Store UUID" value={listing.seller_id} />
                <InfoLine label="Price" value={money(listing.price_amount, listing.currency)} />
                <InfoLine label="Category" value={`${listing.category ?? "n/a"} / ${listing.sub_category ?? "n/a"}`} />
                <InfoLine label="Delivery" value={listing.delivery_type ?? "n/a"} />
                <InfoLine label="Stock" value={listing.stock_qty ?? "n/a"} />
                <InfoLine
                  label="Home feature"
                  value={
                    listing.featured_enabled
                      ? `${marketFeatureExpired ? "Expired" : "On"} - ${listing.featured_until ? formatDate(listing.featured_until) : "No expiry"}`
                      : "Off"
                  }
                />
                <InfoLine label="Home priority" value={String(listing.featured_priority ?? 100)} />
              </View>

              <View
                style={{
                  marginTop: 14,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: "rgba(45,212,191,0.24)",
                  backgroundColor: "rgba(45,212,191,0.07)",
                  padding: 12,
                  gap: 10,
                }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                  <View style={{ flex: 1, minWidth: 220 }}>
                    <Text style={{ color: TEXT, fontWeight: "900", fontSize: 14 }}>Market home listing feature</Text>
                    <Text style={{ marginTop: 4, color: MUTED, fontSize: 12, lineHeight: 18 }}>
                      Pins this listing directly into Market Home. This is separate from reward-page promotions.
                    </Text>
                  </View>
                  <Pill label={marketFeatured ? "VISIBLE ON HOME" : marketFeatureExpired ? "EXPIRED" : "NOT FEATURED"} color={marketFeatured ? SUCCESS : marketFeatureExpired ? DANGER : MUTED} />
                </View>

                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                  <View style={{ flex: 1, minWidth: 180 }}>
                    <Text style={{ color: FAINT, fontSize: 11, fontWeight: "900", textTransform: "uppercase", marginBottom: 6 }}>
                      Priority
                    </Text>
                    <AdminTextInput
                      value={featureDraft.priority}
                      onChangeText={(value) => updateMarketListingFeatureDraft(listing.id, { priority: value.replace(/[^\d]/g, "").slice(0, 6), until: featureDraft.until })}
                      placeholder="100"
                      autoCapitalize="none"
                      editable={canFeatureMarketHome}
                    />
                  </View>
                  <View style={{ flex: 2, minWidth: 260 }}>
                    <Text style={{ color: FAINT, fontSize: 11, fontWeight: "900", textTransform: "uppercase", marginBottom: 6 }}>
                      Expiry date
                    </Text>
                    <AdminTextInput
                      value={featureDraft.until}
                      onChangeText={(value) => updateMarketListingFeatureDraft(listing.id, { until: value, priority: featureDraft.priority })}
                      placeholder="Optional ISO date, for example 2026-06-01T12:00:00Z"
                      autoCapitalize="none"
                      editable={canFeatureMarketHome}
                    />
                  </View>
                </View>

                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  <ActionButton icon="time-outline" label="7 days" color={ACCENT} disabled={!canFeatureMarketHome} onPress={() => setMarketListingFeatureExpiry(listing.id, 7, featureDraft.priority)} />
                  <ActionButton icon="calendar-outline" label="30 days" color={ACCENT} disabled={!canFeatureMarketHome} onPress={() => setMarketListingFeatureExpiry(listing.id, 30, featureDraft.priority)} />
                  <ActionButton icon="infinite-outline" label="No expiry" color={ACCENT} disabled={!canFeatureMarketHome} onPress={() => setMarketListingFeatureExpiry(listing.id, null, featureDraft.priority)} />
                  <ActionButton
                    icon="sparkles-outline"
                    label="Save home listing"
                    color={SUCCESS}
                    disabled={!canFeatureMarketHome}
                    loading={workingKey === `market-listing-feature-${listing.id}-on`}
                    onPress={() => void saveMarketListingFeature(listing, true)}
                  />
                  <ActionButton
                    icon="remove-circle-outline"
                    label="Remove from home"
                    color={DANGER}
                    disabled={!canFeatureMarketHome || !listing.featured_enabled}
                    loading={workingKey === `market-listing-feature-${listing.id}-off`}
                    onPress={() => void saveMarketListingFeature(listing, false)}
                  />
                </View>
              </View>

              <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                <ActionButton
                  icon="open-outline"
                  label="Open listing"
                  color={WARNING}
                  onPress={() => openListing(listing.id)}
                />
                <ActionButton
                  icon="copy-outline"
                  label="Copy listing UUID"
                  color={ACCENT}
                  onPress={() => void copyTextValue("Listing UUID", listing.id)}
                />
                <ActionButton
                  icon="megaphone-outline"
                  label="Use in rewards"
                  color={SUCCESS}
                  disabled={!canFeaturePromotions}
                  onPress={() => useListingForRewardFeature(listing)}
                />
                <ActionButton
                  icon="flash-outline"
                  label="Reward feature now"
                  color={SUCCESS}
                  disabled={!canFeaturePromotions}
                  loading={workingKey === `reward-feature-listing-${listing.id}`}
                  onPress={() => void createListingFeatureNow(listing)}
                />
                <ActionButton
                  icon="person-circle-outline"
                  label="Seller profile"
                  color={ACCENT}
                  disabled={!canOpenSellerProfile(listing.seller)}
                  onPress={() => openSellerProfile(listing.seller)}
                />
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
          <EmptyState title={allListings.length ? "No matching listings" : "No listings"} subtitle={allListings.length ? "Try a title, seller, category, currency, or live/disabled status." : "There are no listings in the current queue."} />
        ))}
      </View>
    );
  }

  function renderVerification() {
    const allRequests = workspace?.modules.verification?.requests ?? [];
    const requests = allRequests.filter((request: any) => matchesSearch(currentModuleSearch, [
      request.id,
      request.status,
      request.provider,
      request.provider_review_status,
      request.provider_review_answer,
      request.country_code,
      request.document_type,
      request.last_error,
      personLabel(request.user),
      request.user?.profile?.email,
    ]));
    const canReview = hasPermission("verification.review");

    return (
      <View style={{ marginTop: 18, gap: 12 }}>
        <SectionHeader
          icon="shield-checkmark-outline"
          title="Verification reviews"
          subtitle="Compliance admins can focus on identity cases without moderation or settlement controls in the way."
          count={requests.length}
        >
          <SearchBox value={currentModuleSearch} onChangeText={setCurrentModuleSearch} placeholder="Search verification by user, email, provider, country, status, or error" />
        </SectionHeader>
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
                icon="person-circle-outline"
                label="View profile"
                color={WARNING}
                disabled={!canOpenSellerProfile(request.user)}
                onPress={() => openSellerProfile(request.user)}
              />
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
          <EmptyState title={allRequests.length ? "No matching verification requests" : "No verification requests"} subtitle={allRequests.length ? "Try user details, provider status, country, or error text." : "There are no verification cases waiting for review."} />
        )}
      </View>
    );
  }

  function renderEscrow() {
    const escrow = workspace?.modules.escrow;
    const allOrders = escrow?.orders ?? [];
    const allChains = escrow?.chains ?? [];
    const allStocks = escrow?.stocks ?? [];
    const allAudits = escrow?.audit_events ?? [];
    const orders = allOrders.filter((order: any) => matchesSearch(currentModuleSearch, [
      order.id,
      order.status,
      order.currency,
      order.listing?.title,
      order.dispute?.status,
      personLabel(order.buyer),
      personLabel(order.seller),
      order.crypto_escrow?.chain,
      ...(order.crypto_intents ?? []).map((intent: any) => `${intent.chain} ${intent.status} ${intent.tx_hash}`),
    ]));
    const chains = allChains.filter((chain: any) => matchesSearch(currentModuleSearch, [
      chain.chain,
      chain.chain_id,
      chain.escrow_address,
      chain.active ? "active" : "inactive",
    ]));
    const stocks = allStocks.filter((stock: any) => matchesSearch(currentModuleSearch, [
      stock.id,
      stock.name,
      stock.symbol,
      stock.slug,
      stock.chain,
      stock.token_address,
      stock.trading_paused_until ? "paused" : "open",
      personLabel(stock.store),
    ]));
    const audits = allAudits.filter((event: any) => matchesSearch(currentModuleSearch, [
      event.id,
      event.action,
      event.entity_type,
      event.entity_id,
      event.actor_type,
      event.actor_id,
    ]));
    const canSettle = hasPermission("escrow.settle");
    const canChainAdmin = hasPermission("chain.admin");
    const isSuperAdmin = Boolean(overview?.admin.role_key === "super_admin" || overview?.admin.permissions?.includes("*"));

    return (
      <View style={{ marginTop: 18, gap: 14 }}>
        <SectionHeader
          icon="wallet-outline"
          title="Escrow and chain operations"
          subtitle="Settlement, contract controls, stock trading pauses, and audit review stay separated by task."
          count={escrowTab === "orders" ? orders.length : escrowTab === "stocks" ? stocks.length : escrowTab === "chains" ? chains.length : audits.length}
        >
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <SearchBox
              value={currentModuleSearch}
              onChangeText={setCurrentModuleSearch}
              placeholder={
                escrowTab === "orders"
                  ? "Search escrow orders by buyer, seller, rail, status, or order ID"
                  : escrowTab === "stocks"
                    ? "Search stock controls by symbol, chain, store, or token"
                    : escrowTab === "chains"
                      ? "Search chain config by chain, address, status, or ID"
                      : "Search audit events by action, entity, actor, or ID"
              }
            />
            <SegmentedControl
              value={escrowTab}
              onChange={setEscrowTab}
              options={[
                { key: "orders", label: "Orders", count: orders.length },
                { key: "stocks", label: "Stocks", count: stocks.length },
                { key: "chains", label: "Chains", count: chains.length },
                { key: "audit", label: "Audit", count: audits.length },
              ]}
            />
          </View>
        </SectionHeader>
        {renderActionNote()}

        {escrowTab === "orders" ? (
          orders.length ? orders.map((order: any) => {
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
                  icon="receipt-outline"
                  label="Open order"
                  color={WARNING}
                  onPress={() => openAdminOrder(order.id)}
                />
                <ActionButton
                  icon="person-circle-outline"
                  label="Buyer profile"
                  color={ACCENT}
                  disabled={!canOpenSellerProfile(order.buyer)}
                  onPress={() => openSellerProfile(order.buyer)}
                />
                <ActionButton
                  icon="storefront-outline"
                  label="Seller profile"
                  color={ACCENT}
                  disabled={!canOpenSellerProfile(order.seller)}
                  onPress={() => openSellerProfile(order.seller)}
                />
                {order.listing?.id ? (
                  <ActionButton
                    icon="open-outline"
                    label="Open listing"
                    color={WARNING}
                    onPress={() => openListing(order.listing.id)}
                  />
                ) : null}
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
          <EmptyState title={allOrders.length ? "No matching escrow orders" : "No escrow orders"} subtitle={allOrders.length ? "Try an order ID, buyer, seller, currency, rail, or status." : "There are no escrow orders requiring action."} />
        )) : null}

        {escrowTab === "stocks" ? (
          stocks.length ? stocks.map((stock: any) => {
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
                  icon="person-circle-outline"
                  label="Store profile"
                  color={WARNING}
                  disabled={!canOpenSellerProfile(stock.store)}
                  onPress={() => openSellerProfile(stock.store)}
                />
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
          <EmptyState title={allStocks.length ? "No matching stock controls" : "No stock identities"} subtitle={allStocks.length ? "Try a symbol, chain, store, token, or paused/open state." : "There are no stock trading controls in this workspace."} />
        )) : null}

        {escrowTab === "chains" ? (
          chains.length ? chains.map((chain: any) => {
          const chainKey = String(chain.chain);
          const arbiterAddress = chainArbiterAddresses[chainKey] ?? "";
          const rescueRecipient = chainRescueRecipients[chainKey] ?? "";
          const rescueOrderKey = chainRescueOrderKeys[chainKey] ?? "";
          const rescueTxHash = chainRescueTxHashes[chainKey] ?? "";
          const canReturnMissedDeposit = isSuperAdmin && rescueTxHash.trim().length > 0;
          const canManualRescue = isSuperAdmin && rescueRecipient.trim().length > 0 && rescueOrderKey.trim().length > 0;
          return (
          <RecordCard key={chainKey}>
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

            <View style={{ marginTop: 16, borderRadius: 8, padding: 12, backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: BORDER, gap: 10 }}>
              <View>
                <Text style={{ color: TEXT, fontWeight: "900", fontSize: 14 }}>Arbiter signer</Text>
                <Text style={{ marginTop: 5, color: MUTED, fontSize: 12, lineHeight: 18 }}>
                  Set the wallet allowed to run admin release and refund transactions for disputes.
                </Text>
              </View>
              <View style={{ flexDirection: isDesktop ? "row" : "column", gap: 10, alignItems: isDesktop ? "center" : "stretch" }}>
                <View style={{ flex: 1 }}>
                  <AdminTextInput
                    value={arbiterAddress}
                    onChangeText={(value) => setChainArbiterAddress(chainKey, value)}
                    autoCapitalize="none"
                    placeholder="Arbiter wallet address"
                  />
                </View>
                <ActionButton
                  icon="key-outline"
                  label="Set arbiter"
                  color={WARNING}
                  disabled={!canChainAdmin || !arbiterAddress.trim()}
                  loading={workingKey === `chain-arbiter-${chainKey}`}
                  onPress={() =>
                    performAction(
                      `chain-arbiter-${chainKey}`,
                      {
                        action: "stable_chain_action",
                        chain: chain.chain,
                        chain_action: "update_arbiter",
                        arbiter: arbiterAddress.trim(),
                      },
                      true,
                    )
                  }
                />
              </View>
            </View>

            <View style={{ marginTop: 16, borderRadius: 8, padding: 12, backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: BORDER, gap: 10 }}>
              <View>
                <Text style={{ color: TEXT, fontWeight: "900", fontSize: 14 }}>Return missed deposit</Text>
                <Text style={{ marginTop: 5, color: MUTED, fontSize: 12, lineHeight: 18 }}>
                  Super admin only. Paste the original deposit transaction hash; the system reads the escrow event, finds the depositor, allowlists that wallet if needed, and returns the locked funds to them.
                </Text>
              </View>

              <View style={{ flexDirection: isDesktop ? "row" : "column", gap: 10, alignItems: isDesktop ? "center" : "stretch" }}>
                <View style={{ flex: 1 }}>
                  <AdminTextInput
                    value={rescueTxHash}
                    onChangeText={(value) => setChainRescueTxHash(chainKey, value)}
                    autoCapitalize="none"
                    placeholder="Deposit tx hash 0x..."
                  />
                </View>
                <ActionButton
                  icon="return-up-back-outline"
                  label="Return to depositor"
                  color={DANGER}
                  disabled={!canReturnMissedDeposit}
                  loading={workingKey === `chain-rescue-deposit-${chainKey}`}
                  onPress={() =>
                    performAction(
                      `chain-rescue-deposit-${chainKey}`,
                      {
                        action: "stable_chain_action",
                        chain: chain.chain,
                        chain_action: "rescue_deposit_tx",
                        tx_hash: rescueTxHash.trim(),
                      },
                      true,
                    )
                  }
                />
              </View>
            </View>

            <View style={{ marginTop: 16, borderRadius: 8, padding: 12, backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: BORDER, gap: 10 }}>
              <View>
                <Text style={{ color: TEXT, fontWeight: "900", fontSize: 14 }}>Manual rescue by order key</Text>
                <Text style={{ marginTop: 5, color: MUTED, fontSize: 12, lineHeight: 18 }}>
                  Super admin only. Use this only when you already know the exact bytes32 order key and the wallet that must receive the funds.
                </Text>
              </View>

              <View style={{ flexDirection: isDesktop ? "row" : "column", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <AdminTextInput
                    value={rescueRecipient}
                    onChangeText={(value) => setChainRescueRecipient(chainKey, value)}
                    autoCapitalize="none"
                    placeholder="Recipient wallet to receive rescued funds"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <AdminTextInput
                    value={rescueOrderKey}
                    onChangeText={(value) => setChainRescueOrderKey(chainKey, value)}
                    autoCapitalize="none"
                    placeholder="Order ID or order key 0x..."
                  />
                </View>
              </View>

              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                <ActionButton
                  icon="shield-checkmark-outline"
                  label="Allow rescue wallet"
                  color={WARNING}
                  disabled={!isSuperAdmin || !rescueRecipient.trim()}
                  loading={workingKey === `chain-allow-wallet-${chainKey}`}
                  onPress={() =>
                    performAction(
                      `chain-allow-wallet-${chainKey}`,
                      {
                        action: "stable_chain_action",
                        chain: chain.chain,
                        chain_action: "allow_wallet",
                        wallet: rescueRecipient.trim(),
                        allowed: true,
                      },
                      true,
                    )
                  }
                />
                <ActionButton
                  icon="download-outline"
                  label="Withdraw escrow"
                  color={DANGER}
                  disabled={!canManualRescue}
                  loading={workingKey === `chain-emergency-withdraw-${chainKey}`}
                  onPress={() =>
                    performAction(
                      `chain-emergency-withdraw-${chainKey}`,
                      {
                        action: "stable_chain_action",
                        chain: chain.chain,
                        chain_action: "emergency_withdraw",
                        order_key: rescueOrderKey.trim(),
                        recipient: rescueRecipient.trim(),
                      },
                      true,
                    )
                  }
                />
              </View>
            </View>
          </RecordCard>
          );
        }) : (
          <EmptyState title={allChains.length ? "No matching chains" : "No chain config"} subtitle={allChains.length ? "Try chain name, chain ID, escrow address, active, or inactive." : "Stable escrow contract controls appear after chain config is seeded."} />
        )) : null}

        {escrowTab === "audit" ? (
          audits.length ? audits.slice(0, 12).map((event: any) => (
          <RecordCard key={event.id}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <Text style={{ color: TEXT, fontWeight: "900", fontSize: 15 }}>{event.action}</Text>
              <Text style={{ color: MUTED, fontSize: 12, fontWeight: "800" }}>{formatDate(event.created_at)}</Text>
            </View>
            <Text style={{ marginTop: 6, color: MUTED, fontSize: 12 }}>{event.entity_type} - {shortId(event.entity_id)}</Text>
          </RecordCard>
        )) : (
          <EmptyState title={allAudits.length ? "No matching audit events" : "No audit events"} subtitle={allAudits.length ? "Try action name, entity type, entity ID, or actor ID." : "There are no audit events in the current feed."} />
        )) : null}
      </View>
    );
  }

  function renderRewards() {
    const rewards = workspace?.modules.rewards;
    if (!rewards) {
      return (
        <View style={{ marginTop: 18 }}>
          <EmptyState title="Rewards workspace unavailable" subtitle="This admin session does not include reward permissions." />
        </View>
      );
    }

    const tasks = (rewards.tasks ?? []).filter((task: any) => matchesSearch(currentModuleSearch, [
      task.task_key,
      task.title,
      task.description,
      task.category,
      task.trigger_type,
      task.active ? "active" : "paused",
    ]));
    const promotions = (rewards.promotions ?? []).filter((promo: any) => matchesSearch(currentModuleSearch, [
      promo.placement_key,
      promo.title,
      promo.subtitle,
      promo.sponsor_label,
      promo.active ? "active" : "paused",
    ]));
    const reviews = (rewards.pending_reviews ?? []).filter((review: any) => matchesSearch(currentModuleSearch, [
      review.id,
      review.task?.title,
      review.task?.task_key,
      personLabel(review.user),
      review.status,
      JSON.stringify(review.evidence ?? {}),
    ]));
    const accounts = (rewards.accounts ?? []).filter((account: any) => matchesSearch(currentModuleSearch, [
      account.user_id,
      personLabel(account.user),
      account.tier_key,
      account.balance,
    ]));
    const ledger = (rewards.ledger ?? []).filter((entry: any) => matchesSearch(currentModuleSearch, [
      entry.id,
      entry.source,
      entry.reason,
      entry.delta,
      personLabel(entry.user),
      entry.task?.title,
    ]));
    const referrals = (rewards.referrals ?? []).filter((referral: any) => matchesSearch(currentModuleSearch, [
      referral.id,
      referral.referral_code,
      referral.status,
      referral.bot_score,
      personLabel(referral.referrer),
      personLabel(referral.referred_user),
      referral.referrer_id,
      referral.referred_user_id,
    ]));
    const referralLeaderboard = (rewards.referral_leaderboard ?? []).filter((entry: any) => matchesSearch(currentModuleSearch, [
      entry.code,
      entry.username,
      entry.full_name,
      entry.market_username,
      entry.display_name,
      entry.business_name,
      entry.balance,
      entry.successful_referrals,
    ]));
    const rewardStores = (rewards.stores ?? []).filter((seller: any) => matchesSearch(currentModuleSearch, [
      seller.user_id,
      seller.business_name,
      seller.display_name,
      seller.market_username,
      seller.profile?.email,
      seller.profile?.full_name,
      seller.active === false ? "paused" : "active",
      seller.is_verified ? "verified" : "unverified",
      seller.featured_enabled ? "featured market home" : "not featured",
    ]));
    const rewardListings = (rewards.listings ?? []).filter((listing: any) => matchesSearch(currentModuleSearch, [
      listing.id,
      listing.seller_id,
      listing.title,
      listing.category,
      listing.sub_category,
      listing.currency,
      listing.delivery_type,
      listing.is_active === false ? "disabled" : "live",
      listing.featured_enabled ? "featured market home" : "not featured",
      personLabel(listing.seller),
    ]));
    const adSessions = rewards.ad_sessions ?? [];
    const canManageTasks = hasPermission("rewards.tasks.manage");
    const canManagePromotions = hasPermission("rewards.promotions.manage");
    const canReview = hasPermission("rewards.review");
    const canAdjust = hasPermission("rewards.adjust");
    const canManageReferrals = canManageTasks;
    const canFeatureMarketHome = canManagePromotions || hasPermission("users.moderate") || hasPermission("listings.moderate");

    function selectRewardRule(check: RewardRuleCheck) {
      const option = REWARD_RULE_OPTIONS.find((item) => item.key === check);
      setRewardRuleCheck(check);
      if (option?.category) setRewardTaskCategory(option.category);
      if (check === "admin_review") {
        setRewardTaskTrigger("admin_review");
      } else if (rewardTaskTrigger === "admin_review") {
        setRewardTaskTrigger("client_claim");
      }
    }

    function hydrateRewardRuleBuilder(rawRules: Record<string, unknown>) {
      const check = String(rawRules?.check ?? "referral_count") as RewardRuleCheck;
      const validCheck = REWARD_RULE_OPTIONS.some((option) => option.key === check) ? check : "referral_count";
      const window = rawRules?.window && typeof rawRules.window === "object" && !Array.isArray(rawRules.window)
        ? (rawRules.window as Record<string, unknown>)
        : {};
      const seconds = Number(window.seconds ?? 0);

      setRewardRuleCheck(validCheck);
      setRewardRuleMin(String(rawRules.min_fields ?? rawRules.min ?? 1));
      setRewardRuleValue(String(rawRules.min_volume_usd ?? rawRules.min_amount ?? rawRules.min_volume ?? rawRules.min ?? 40));
      setRewardRuleStoreId(String(rawRules.store_id ?? ""));
      setRewardRuleListingId(String(rawRules.listing_id ?? ""));
      setRewardRuleStockId(String(rawRules.stock_id ?? ""));
      setRewardRuleSide(String(rawRules.side ?? "any") || "any");
      setRewardRulePurchaseRole(String(rawRules.role ?? "buyer") || "buyer");
      const mode = String(window.mode ?? "all_time") as RewardWindowMode;
      setRewardRuleWindowMode(REWARD_WINDOW_OPTIONS.some((option) => option.key === mode) ? mode : "all_time");
      if (Number.isFinite(seconds) && seconds > 0) {
        if (seconds % 86400 === 0) {
          setRewardRuleWindowAmount(String(seconds / 86400));
          setRewardRuleWindowUnit("days");
        } else if (seconds % 3600 === 0) {
          setRewardRuleWindowAmount(String(seconds / 3600));
          setRewardRuleWindowUnit("hours");
        } else {
          setRewardRuleWindowAmount(String(Math.max(1, Math.round(seconds / 60))));
          setRewardRuleWindowUnit("minutes");
        }
      }
    }

    async function submitRewardTask() {
      const rules = rewardRuleDraft;
      const triggerType = rewardRuleCheck === "admin_review"
        ? "admin_review"
        : rewardTaskTrigger === "admin_review"
          ? "client_claim"
          : rewardTaskTrigger;
      await performAction(
        `reward-task-${rewardTaskKey.trim()}`,
        {
          action: "upsert_reward_task",
          task_key: rewardTaskKey.trim(),
          title: rewardTaskTitle.trim(),
          description: rewardTaskDescription.trim(),
          category: rewardTaskCategory,
          trigger_type: triggerType,
          reward_noms: rewardTaskNoms.trim(),
          cooldown_seconds: String(Math.max(0, Math.trunc(numericText(rewardTaskCooldownAmount, 0) * timeUnitSeconds(rewardTaskCooldownUnit)))),
          daily_cap: rewardTaskDailyCap.trim(),
          weekly_cap: rewardTaskWeeklyCap.trim(),
          lifetime_cap: rewardTaskLifetimeCap.trim(),
          starts_at: rewardTaskStartsAt.trim(),
          ends_at: rewardTaskEndsAt.trim(),
          action_route: rewardTaskRoute.trim(),
          requires_review: triggerType === "admin_review",
          rules,
          ui: { badge: rewardTaskCategory, primaryLabel: triggerType === "ad_reward" ? "Watch" : triggerType === "admin_review" ? "Submit proof" : "Claim" },
          active: true,
        },
        false,
      );
    }

    async function submitRewardPromotion() {
      let metadata: Record<string, unknown> = {};
      try {
        metadata = rewardPromotionMetadata.trim() ? JSON.parse(rewardPromotionMetadata) : {};
      } catch {
        setError("Promotion metadata must be valid JSON.");
        return;
      }
      await performAction(
        `reward-promo-${rewardPromotionPlacement.trim()}-${rewardPromotionTitle.trim()}`,
        {
          action: "upsert_reward_promotion",
          promotion_id: rewardPromotionId.trim(),
          placement_key: rewardPromotionPlacement.trim(),
          title: rewardPromotionTitle.trim(),
          subtitle: rewardPromotionSubtitle.trim(),
          media_url: rewardPromotionMediaUrl.trim(),
          sponsor_label: rewardPromotionSponsorLabel.trim(),
          cta_label: rewardPromotionCtaLabel.trim(),
          cta_route: rewardPromotionCtaRoute.trim(),
          store_id: rewardPromotionStoreId.trim(),
          listing_id: rewardPromotionListingId.trim(),
          priority: rewardPromotionPriority.trim(),
          starts_at: rewardPromotionStartsAt.trim(),
          ends_at: rewardPromotionEndsAt.trim(),
          metadata,
          active: true,
        },
        false,
      );
    }

    async function submitRewardAdjustment() {
      await performAction(
        `reward-adjust-${rewardAdjustUserId.trim()}`,
        {
          action: "adjust_reward_balance",
          user_id: rewardAdjustUserId.trim(),
          amount: rewardAdjustAmount.trim(),
        },
        true,
      );
      setRewardAdjustAmount("");
    }

    async function submitReferralConfig() {
      await performAction(
        "reward-referral-config",
        {
          action: "update_reward_referral_config",
          enabled: rewardReferralEnabled,
          joiner_reward_noms: rewardReferralJoinerNoms.trim(),
          referrer_reward_noms: rewardReferralReferrerNoms.trim(),
          bot_filter_enabled: rewardReferralBotFilterEnabled,
          max_referrals_per_ip_hash: rewardReferralMaxIp.trim(),
          max_referrals_per_user_agent_hash: rewardReferralMaxUserAgent.trim(),
          share_base_url: rewardReferralShareBaseUrl.trim(),
        },
        false,
      );
    }

    function loadTaskIntoBuilder(task: any) {
      setRewardTaskKey(String(task.task_key ?? ""));
      setRewardTaskTitle(String(task.title ?? ""));
      setRewardTaskDescription(String(task.description ?? ""));
      setRewardTaskCategory(String(task.category ?? "custom"));
      setRewardTaskTrigger(String(task.trigger_type ?? "client_claim"));
      setRewardTaskNoms(String(task.reward_noms ?? 0));
      setRewardTaskRoute(String(task.action_route ?? ""));
      const cooldown = splitSeconds(task.cooldown_seconds ?? 0);
      setRewardTaskCooldownAmount(cooldown.amount);
      setRewardTaskCooldownUnit(cooldown.unit);
      setRewardTaskDailyCap(task.daily_cap === null || task.daily_cap === undefined ? "" : String(task.daily_cap));
      setRewardTaskWeeklyCap(task.weekly_cap === null || task.weekly_cap === undefined ? "" : String(task.weekly_cap));
      setRewardTaskLifetimeCap(task.lifetime_cap === null || task.lifetime_cap === undefined ? "" : String(task.lifetime_cap));
      setRewardTaskStartsAt(String(task.starts_at ?? ""));
      setRewardTaskEndsAt(String(task.ends_at ?? ""));
      hydrateRewardRuleBuilder((task.rules ?? {}) as Record<string, unknown>);
      setRewardTaskRules(JSON.stringify(task.rules ?? {}, null, 2));
      setRewardTab("build");
    }

    function resetPromotionBuilder() {
      setRewardPromotionId("");
      setRewardPromotionPlacement("rewards_top");
      setRewardPromotionTitle("");
      setRewardPromotionSubtitle("");
      setRewardPromotionMediaUrl("");
      setRewardPromotionSponsorLabel("Featured");
      setRewardPromotionCtaLabel("View store");
      setRewardPromotionCtaRoute("");
      setRewardPromotionStoreId("");
      setRewardPromotionListingId("");
      setRewardPromotionPriority("100");
      setRewardPromotionStartsAt("");
      setRewardPromotionEndsAt("");
      setRewardPromotionMetadata("{\"source\":\"admin_dashboard\"}");
    }

    function loadPromotionIntoBuilder(promo: any) {
      setRewardPromotionId(String(promo.id ?? ""));
      setRewardPromotionPlacement(String(promo.placement_key ?? "rewards_top"));
      setRewardPromotionTitle(String(promo.title ?? ""));
      setRewardPromotionSubtitle(String(promo.subtitle ?? ""));
      setRewardPromotionMediaUrl(String(promo.media_url ?? ""));
      setRewardPromotionSponsorLabel(String(promo.sponsor_label ?? "Featured"));
      setRewardPromotionCtaLabel(String(promo.cta_label ?? "View store"));
      setRewardPromotionCtaRoute(String(promo.cta_route ?? ""));
      setRewardPromotionStoreId(String(promo.store_id ?? ""));
      setRewardPromotionListingId(String(promo.listing_id ?? ""));
      setRewardPromotionPriority(String(promo.priority ?? 100));
      setRewardPromotionStartsAt(String(promo.starts_at ?? ""));
      setRewardPromotionEndsAt(String(promo.ends_at ?? ""));
      setRewardPromotionMetadata(JSON.stringify(promo.metadata ?? { source: "admin_dashboard" }, null, 2));
      setRewardTab("build");
    }

    return (
      <View style={{ marginTop: 18, gap: 14 }}>
        <SectionHeader
          icon="gift-outline"
          title="Noms rewards and promoted placements"
          subtitle="Manage noms, reward tasks, featured stores, sponsored videos, reviews, and balance adjustments in one place."
          count={
            rewardTab === "tasks" ? tasks.length :
            rewardTab === "promotions" ? promotions.length :
            rewardTab === "referrals" ? referrals.length :
            rewardTab === "reviews" ? reviews.length :
            rewardTab === "accounts" ? accounts.length :
            rewardTab === "ledger" ? ledger.length :
            (rewards.tasks?.length ?? 0) + (rewards.promotions?.length ?? 0) + (rewards.stores?.length ?? 0) + (rewards.listings?.length ?? 0)
          }
        >
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <SearchBox
              value={currentModuleSearch}
              onChangeText={setCurrentModuleSearch}
              placeholder="Search rewards, stores, listings, UUIDs, accounts, reviews, or ledger"
            />
            <SegmentedControl
              value={rewardTab}
              onChange={setRewardTab}
              options={[
                { key: "tasks", label: "Tasks", count: tasks.length },
                { key: "promotions", label: "Promotions", count: promotions.length },
                { key: "referrals", label: "Referrals", count: referrals.length },
                { key: "reviews", label: "Reviews", count: reviews.length },
                { key: "accounts", label: "Accounts", count: accounts.length },
                { key: "ledger", label: "Ledger", count: ledger.length },
                { key: "build", label: "Build" },
              ]}
            />
          </View>
        </SectionHeader>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          <View style={{ flex: 1, minWidth: 150 }}>
            <RecordCard>
              <Text style={{ color: TEXT, fontWeight: "900", fontSize: 22 }}>{compactCount(rewards.tasks?.length ?? 0)}</Text>
              <Text style={{ marginTop: 6, color: MUTED, fontSize: 12 }}>Task definitions</Text>
            </RecordCard>
          </View>
          <View style={{ flex: 1, minWidth: 150 }}>
            <RecordCard>
              <Text style={{ color: TEXT, fontWeight: "900", fontSize: 22 }}>{compactCount((rewards.promotions ?? []).filter((p: any) => p.active !== false).length)}</Text>
              <Text style={{ marginTop: 6, color: MUTED, fontSize: 12 }}>Active promotions</Text>
            </RecordCard>
          </View>
          <View style={{ flex: 1, minWidth: 150 }}>
            <RecordCard>
              <Text style={{ color: TEXT, fontWeight: "900", fontSize: 22 }}>{compactCount((rewards.referrals ?? []).filter((r: any) => r.status === "rewarded").length)}</Text>
              <Text style={{ marginTop: 6, color: MUTED, fontSize: 12 }}>Successful referrals</Text>
            </RecordCard>
          </View>
          <View style={{ flex: 1, minWidth: 150 }}>
            <RecordCard>
              <Text style={{ color: TEXT, fontWeight: "900", fontSize: 22 }}>{compactCount(reviews.length)}</Text>
              <Text style={{ marginTop: 6, color: MUTED, fontSize: 12 }}>Pending reviews</Text>
            </RecordCard>
          </View>
          <View style={{ flex: 1, minWidth: 150 }}>
            <RecordCard>
              <Text style={{ color: TEXT, fontWeight: "900", fontSize: 22 }}>{compactCount(adSessions.length)}</Text>
              <Text style={{ marginTop: 6, color: MUTED, fontSize: 12 }}>Recent ad sessions</Text>
            </RecordCard>
          </View>
        </View>

        {rewardTab === "referrals" ? (
          <View style={{ gap: 14 }}>
            <RecordCard>
              <View style={{ gap: 14 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
                  <View style={{ flex: 1, minWidth: 240 }}>
                    <Text style={{ color: TEXT, fontWeight: "900", fontSize: 18 }}>Referral program</Text>
                    <Text style={{ marginTop: 6, color: MUTED, fontSize: 13, lineHeight: 20 }}>
                      Configure signup rewards, inviter rewards, share links, and bot filters without redeploying the app.
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
                    <Pressable
                      onPress={() => setRewardReferralEnabled((value) => !value)}
                      style={{
                        borderRadius: 8,
                        paddingHorizontal: 12,
                        paddingVertical: 10,
                        backgroundColor: rewardReferralEnabled ? "rgba(74,222,128,0.14)" : "rgba(248,113,113,0.12)",
                        borderWidth: 1,
                        borderColor: rewardReferralEnabled ? "rgba(74,222,128,0.34)" : "rgba(248,113,113,0.32)",
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 7,
                      }}
                    >
                      <Ionicons name={rewardReferralEnabled ? "checkmark-circle-outline" : "pause-circle-outline"} size={16} color={rewardReferralEnabled ? SUCCESS : DANGER} />
                      <Text style={{ color: rewardReferralEnabled ? SUCCESS : DANGER, fontWeight: "900", fontSize: 12 }}>
                        {rewardReferralEnabled ? "Live" : "Paused"}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setRewardReferralBotFilterEnabled((value) => !value)}
                      style={{
                        borderRadius: 8,
                        paddingHorizontal: 12,
                        paddingVertical: 10,
                        backgroundColor: rewardReferralBotFilterEnabled ? "rgba(45,212,191,0.14)" : "rgba(255,255,255,0.04)",
                        borderWidth: 1,
                        borderColor: rewardReferralBotFilterEnabled ? "rgba(45,212,191,0.34)" : BORDER,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 7,
                      }}
                    >
                      <Ionicons name="shield-checkmark-outline" size={16} color={rewardReferralBotFilterEnabled ? ACCENT : MUTED} />
                      <Text style={{ color: rewardReferralBotFilterEnabled ? TEXT : MUTED, fontWeight: "900", fontSize: 12 }}>
                        Bot filter {rewardReferralBotFilterEnabled ? "on" : "off"}
                      </Text>
                    </Pressable>
                  </View>
                </View>

                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                  <View style={{ flex: 1, minWidth: 190 }}>
                    <Text style={{ marginBottom: 6, color: FAINT, fontSize: 11, fontWeight: "900", textTransform: "uppercase" }}>New user reward</Text>
                    <AdminTextInput value={rewardReferralJoinerNoms} onChangeText={setRewardReferralJoinerNoms} placeholder="25" />
                  </View>
                  <View style={{ flex: 1, minWidth: 190 }}>
                    <Text style={{ marginBottom: 6, color: FAINT, fontSize: 11, fontWeight: "900", textTransform: "uppercase" }}>Inviter reward</Text>
                    <AdminTextInput value={rewardReferralReferrerNoms} onChangeText={setRewardReferralReferrerNoms} placeholder="5" />
                  </View>
                  <View style={{ flex: 2, minWidth: 240 }}>
                    <Text style={{ marginBottom: 6, color: FAINT, fontSize: 11, fontWeight: "900", textTransform: "uppercase" }}>Share base URL</Text>
                    <AdminTextInput value={rewardReferralShareBaseUrl} onChangeText={setRewardReferralShareBaseUrl} placeholder="https://bestcity-amber.vercel.app/register" autoCapitalize="none" />
                  </View>
                </View>

                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                  <View style={{ flex: 1, minWidth: 220 }}>
                    <Text style={{ marginBottom: 6, color: FAINT, fontSize: 11, fontWeight: "900", textTransform: "uppercase" }}>Max referrals per IP hash</Text>
                    <AdminTextInput value={rewardReferralMaxIp} onChangeText={setRewardReferralMaxIp} placeholder="5" />
                  </View>
                  <View style={{ flex: 1, minWidth: 220 }}>
                    <Text style={{ marginBottom: 6, color: FAINT, fontSize: 11, fontWeight: "900", textTransform: "uppercase" }}>Max referrals per device signature</Text>
                    <AdminTextInput value={rewardReferralMaxUserAgent} onChangeText={setRewardReferralMaxUserAgent} placeholder="10" />
                  </View>
                </View>

                <View style={{ borderRadius: 8, padding: 12, backgroundColor: "rgba(45,212,191,0.08)", borderWidth: 1, borderColor: "rgba(45,212,191,0.2)" }}>
                  <Text style={{ color: TEXT, fontWeight: "900", fontSize: 13 }}>Bot filtering</Text>
                  <Text style={{ marginTop: 5, color: MUTED, fontSize: 12, lineHeight: 18 }}>
                    The app hashes IP and device signature before storage. Referrals over these limits are rejected before noms are paid.
                  </Text>
                </View>

                {renderActionNote()}
                <ActionButton
                  icon="save-outline"
                  label="Save referral settings"
                  color={SUCCESS}
                  disabled={!canManageReferrals}
                  loading={workingKey === "reward-referral-config"}
                  onPress={submitReferralConfig}
                />
              </View>
            </RecordCard>

            <RecordCard>
              <View style={{ gap: 12 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                  <View style={{ flex: 1, minWidth: 220 }}>
                    <Text style={{ color: TEXT, fontWeight: "900", fontSize: 18 }}>Lifetime referral leaderboard</Text>
                    <Text style={{ marginTop: 6, color: MUTED, fontSize: 13, lineHeight: 20 }}>
                      Ranked by successful referrals, then current noms balance.
                    </Text>
                  </View>
                  <Pill label={`${referralLeaderboard.length} ranked`} color={ACCENT} />
                </View>

                {referralLeaderboard.length ? referralLeaderboard.slice(0, 12).map((entry: any, index: number) => {
                  const label = entry.business_name || entry.display_name || (entry.market_username ? `@${entry.market_username}` : "") || entry.full_name || entry.username || shortId(entry.user_id);
                  return (
                    <View key={`${entry.user_id}-${index}`} style={{ borderRadius: 8, padding: 12, borderWidth: 1, borderColor: BORDER, backgroundColor: index < 3 ? "rgba(245,158,11,0.10)" : "rgba(255,255,255,0.035)", flexDirection: "row", alignItems: "center", gap: 12 }}>
                      <View style={{ width: 34, height: 34, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: index < 3 ? "rgba(245,158,11,0.18)" : "rgba(255,255,255,0.06)" }}>
                        <Text style={{ color: index < 3 ? WARNING : MUTED, fontWeight: "900", fontSize: 12 }}>#{index + 1}</Text>
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text numberOfLines={1} style={{ color: TEXT, fontWeight: "900", fontSize: 14 }}>{label}</Text>
                        <Text style={{ marginTop: 3, color: MUTED, fontSize: 12 }}>{shortId(entry.user_id)} - code {entry.code}</Text>
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={{ color: SUCCESS, fontWeight: "900", fontSize: 13 }}>{Number(entry.successful_referrals ?? 0).toLocaleString()} referrals</Text>
                        <Text style={{ marginTop: 3, color: WARNING, fontWeight: "900", fontSize: 12 }}>{Number(entry.balance ?? 0).toLocaleString()} noms</Text>
                      </View>
                    </View>
                  );
                }) : (
                  <EmptyState title="No referral leaders yet" subtitle="Successful referrals will populate the lifetime board automatically." />
                )}
              </View>
            </RecordCard>

            {referrals.length ? referrals.map((referral: any) => (
              <RecordCard key={referral.id}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <View style={{ flex: 1, minWidth: 220 }}>
                    <Text style={{ color: TEXT, fontWeight: "900", fontSize: 17 }}>{personLabel(referral.referrer)} invited {personLabel(referral.referred_user)}</Text>
                    <Text style={{ marginTop: 5, color: MUTED, fontSize: 13 }}>{referral.referral_code} - {formatDate(referral.created_at)}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 8 }}>
                    <Pill label={String(referral.status || "pending").toUpperCase()} color={statusTone(referral.status)} />
                    {Number(referral.bot_score ?? 0) > 0 ? <Pill label={`BOT ${referral.bot_score}`} color={Number(referral.bot_score) >= 70 ? DANGER : WARNING} /> : null}
                  </View>
                </View>
                <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                  <InfoLine label="New user reward" value={`${Number(referral.joiner_reward_noms ?? 0).toLocaleString()} noms`} />
                  <InfoLine label="Inviter reward" value={`${Number(referral.referrer_reward_noms ?? 0).toLocaleString()} noms`} />
                  <InfoLine label="Rewarded" value={formatDate(referral.rewarded_at)} />
                  <InfoLine label="Rejected" value={formatDate(referral.rejected_at)} />
                </View>
                {Number(referral.bot_score ?? 0) > 0 ? (
                  <Text style={{ marginTop: 10, color: MUTED, fontSize: 12, lineHeight: 18 }} numberOfLines={3}>
                    {JSON.stringify(referral.bot_signals ?? {})}
                  </Text>
                ) : null}
              </RecordCard>
            )) : (
              <EmptyState title="No referral records" subtitle="Referral attempts and successful signups will appear here." />
            )}
          </View>
        ) : null}

        {rewardTab === "build" ? (
          <View style={{ gap: 14 }}>
            <RecordCard>
              <View style={{ gap: 12 }}>
                <View>
                  <Text style={{ color: TEXT, fontWeight: "900", fontSize: 18 }}>Create or update reward task</Text>
                  <Text style={{ marginTop: 6, color: MUTED, fontSize: 13, lineHeight: 20 }}>
                    Use review tasks for proof-based challenges, ad rewards for sponsored videos, and claim tasks for marketplace milestones.
                  </Text>
                </View>
                <AdminTextInput value={rewardTaskKey} onChangeText={setRewardTaskKey} placeholder="task_key, for example follow_campaign_01" autoCapitalize="none" />
                <AdminTextInput value={rewardTaskTitle} onChangeText={setRewardTaskTitle} placeholder="Task title shown to users" />
                <AdminTextInput value={rewardTaskDescription} onChangeText={setRewardTaskDescription} placeholder="Task description" multiline />
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                  {["watch", "market", "social", "onchain", "custom"].map((category) => (
                    <Pressable
                      key={category}
                      onPress={() => setRewardTaskCategory(category)}
                      style={{
                        borderRadius: 8,
                        paddingHorizontal: 12,
                        paddingVertical: 10,
                        backgroundColor: rewardTaskCategory === category ? "rgba(45,212,191,0.16)" : "rgba(255,255,255,0.04)",
                        borderWidth: 1,
                        borderColor: rewardTaskCategory === category ? "rgba(45,212,191,0.42)" : BORDER,
                      }}
                    >
                      <Text style={{ color: rewardTaskCategory === category ? "#2DD4BF" : MUTED, fontWeight: "900", fontSize: 12 }}>{labelFromKey(category)}</Text>
                    </Pressable>
                  ))}
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                  {["client_claim", "admin_review", "ad_reward", "system_event"].map((trigger) => (
                    <Pressable
                      key={trigger}
                      onPress={() => setRewardTaskTrigger(trigger)}
                      style={{
                        borderRadius: 8,
                        paddingHorizontal: 12,
                        paddingVertical: 10,
                        backgroundColor: rewardTaskTrigger === trigger ? "rgba(245,158,11,0.16)" : "rgba(255,255,255,0.04)",
                        borderWidth: 1,
                        borderColor: rewardTaskTrigger === trigger ? "rgba(245,158,11,0.42)" : BORDER,
                      }}
                    >
                      <Text style={{ color: rewardTaskTrigger === trigger ? WARNING : MUTED, fontWeight: "900", fontSize: 12 }}>{labelFromKey(trigger)}</Text>
                    </Pressable>
                  ))}
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                  <View style={{ flex: 1, minWidth: 180 }}>
                    <AdminTextInput value={rewardTaskNoms} onChangeText={setRewardTaskNoms} placeholder="Reward noms, for example 100" />
                  </View>
                  <View style={{ flex: 2, minWidth: 220 }}>
                    <AdminTextInput value={rewardTaskRoute} onChangeText={setRewardTaskRoute} placeholder="Optional action route, for example /market/social" autoCapitalize="none" />
                  </View>
                </View>
                <View style={{ borderRadius: 8, borderWidth: 1, borderColor: BORDER, backgroundColor: "rgba(255,255,255,0.035)", padding: 12, gap: 10 }}>
                  <Text style={{ color: TEXT, fontWeight: "900", fontSize: 13 }}>Limits and timing</Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                    <View style={{ width: 150 }}>
                      <AdminTextInput value={rewardTaskCooldownAmount} onChangeText={setRewardTaskCooldownAmount} placeholder="Cooldown" />
                    </View>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                      {(["minutes", "hours", "days"] as RewardTimeUnit[]).map((unit) => (
                        <Pressable
                          key={`cooldown-${unit}`}
                          onPress={() => setRewardTaskCooldownUnit(unit)}
                          style={{
                            borderRadius: 8,
                            paddingHorizontal: 12,
                            paddingVertical: 10,
                            backgroundColor: rewardTaskCooldownUnit === unit ? "rgba(45,212,191,0.16)" : "rgba(255,255,255,0.04)",
                            borderWidth: 1,
                            borderColor: rewardTaskCooldownUnit === unit ? "rgba(45,212,191,0.42)" : BORDER,
                          }}
                        >
                          <Text style={{ color: rewardTaskCooldownUnit === unit ? "#2DD4BF" : MUTED, fontWeight: "900", fontSize: 12 }}>{labelFromKey(unit)}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                    <View style={{ flex: 1, minWidth: 160 }}>
                      <AdminTextInput value={rewardTaskDailyCap} onChangeText={setRewardTaskDailyCap} placeholder="Daily cap, blank for none" />
                    </View>
                    <View style={{ flex: 1, minWidth: 160 }}>
                      <AdminTextInput value={rewardTaskWeeklyCap} onChangeText={setRewardTaskWeeklyCap} placeholder="Weekly cap, blank for none" />
                    </View>
                    <View style={{ flex: 1, minWidth: 160 }}>
                      <AdminTextInput value={rewardTaskLifetimeCap} onChangeText={setRewardTaskLifetimeCap} placeholder="Lifetime cap, for example 1" />
                    </View>
                  </View>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                    <View style={{ flex: 1, minWidth: 220 }}>
                      <AdminTextInput value={rewardTaskStartsAt} onChangeText={setRewardTaskStartsAt} placeholder="Optional start date, ISO format" autoCapitalize="none" />
                    </View>
                    <View style={{ flex: 1, minWidth: 220 }}>
                      <AdminTextInput value={rewardTaskEndsAt} onChangeText={setRewardTaskEndsAt} placeholder="Optional end date, ISO format" autoCapitalize="none" />
                    </View>
                  </View>
                </View>
                <View style={{ borderRadius: 8, borderWidth: 1, borderColor: "rgba(45,212,191,0.22)", backgroundColor: "rgba(45,212,191,0.07)", padding: 12, gap: 12 }}>
                  <View>
                    <Text style={{ color: TEXT, fontWeight: "900", fontSize: 15 }}>How users earn this</Text>
                    <Text style={{ marginTop: 5, color: MUTED, fontSize: 12, lineHeight: 18 }}>
                      Pick the condition in plain words. The saved rule preview updates for you.
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                    {REWARD_RULE_OPTIONS.map((option) => {
                      const selected = rewardRuleCheck === option.key;
                      return (
                        <Pressable
                          key={option.key}
                          onPress={() => selectRewardRule(option.key)}
                          style={{
                            width: isCompact ? "100%" : "31.5%",
                            minWidth: 190,
                            borderRadius: 8,
                            padding: 12,
                            backgroundColor: selected ? "rgba(45,212,191,0.16)" : "rgba(255,255,255,0.045)",
                            borderWidth: 1,
                            borderColor: selected ? "rgba(45,212,191,0.5)" : BORDER,
                          }}
                        >
                          <Text style={{ color: selected ? "#2DD4BF" : TEXT, fontWeight: "900", fontSize: 13 }}>{option.label}</Text>
                          <Text style={{ marginTop: 4, color: MUTED, fontSize: 11, lineHeight: 16 }}>{option.description}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {rewardRuleCheck === "seller_profile_complete" ? (
                    <AdminTextInput value={rewardRuleMin} onChangeText={setRewardRuleMin} placeholder="Required profile details, for example 6" />
                  ) : null}
                  {["referral_count", "purchase_count", "stock_trade_count", "active_listing_count", "follow_count", "social_post_count"].includes(rewardRuleCheck) ? (
                    <AdminTextInput value={rewardRuleMin} onChangeText={setRewardRuleMin} placeholder="How many actions are required, for example 2" />
                  ) : null}
                  {["purchase_volume", "stock_trade_volume"].includes(rewardRuleCheck) ? (
                    <AdminTextInput value={rewardRuleValue} onChangeText={setRewardRuleValue} placeholder={rewardRuleCheck === "stock_trade_volume" ? "Target stock volume in USDC, for example 40" : "Target purchase value, for example 40"} />
                  ) : null}
                  {["purchase_count", "purchase_volume"].includes(rewardRuleCheck) ? (
                    <View style={{ gap: 10 }}>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                        {["buyer", "seller"].map((role) => (
                          <Pressable
                            key={role}
                            onPress={() => setRewardRulePurchaseRole(role)}
                            style={{
                              borderRadius: 8,
                              paddingHorizontal: 12,
                              paddingVertical: 10,
                              backgroundColor: rewardRulePurchaseRole === role ? "rgba(245,158,11,0.16)" : "rgba(255,255,255,0.04)",
                              borderWidth: 1,
                              borderColor: rewardRulePurchaseRole === role ? "rgba(245,158,11,0.42)" : BORDER,
                            }}
                          >
                            <Text style={{ color: rewardRulePurchaseRole === role ? WARNING : MUTED, fontWeight: "900", fontSize: 12 }}>{role === "buyer" ? "Buyer action" : "Seller action"}</Text>
                          </Pressable>
                        ))}
                      </View>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                        <View style={{ flex: 1, minWidth: 220 }}>
                          <AdminTextInput value={rewardRuleStoreId} onChangeText={setRewardRuleStoreId} placeholder="Optional store UUID" autoCapitalize="none" />
                        </View>
                        <View style={{ flex: 1, minWidth: 220 }}>
                          <AdminTextInput value={rewardRuleListingId} onChangeText={setRewardRuleListingId} placeholder="Optional listing UUID" autoCapitalize="none" />
                        </View>
                      </View>
                    </View>
                  ) : null}
                  {["stock_trade_volume", "stock_trade_count"].includes(rewardRuleCheck) ? (
                    <View style={{ gap: 10 }}>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                        {["any", "buy", "sell"].map((side) => (
                          <Pressable
                            key={side}
                            onPress={() => setRewardRuleSide(side)}
                            style={{
                              borderRadius: 8,
                              paddingHorizontal: 12,
                              paddingVertical: 10,
                              backgroundColor: rewardRuleSide === side ? "rgba(20,184,166,0.16)" : "rgba(255,255,255,0.04)",
                              borderWidth: 1,
                              borderColor: rewardRuleSide === side ? "rgba(20,184,166,0.42)" : BORDER,
                            }}
                          >
                            <Text style={{ color: rewardRuleSide === side ? "#2DD4BF" : MUTED, fontWeight: "900", fontSize: 12 }}>{labelFromKey(side)}</Text>
                          </Pressable>
                        ))}
                      </View>
                      <AdminTextInput value={rewardRuleStockId} onChangeText={setRewardRuleStockId} placeholder="Optional stock UUID" autoCapitalize="none" />
                    </View>
                  ) : null}
                  {rewardRuleCheck === "follow_count" ? (
                    <AdminTextInput value={rewardRuleStoreId} onChangeText={setRewardRuleStoreId} placeholder="Optional store UUID to follow" autoCapitalize="none" />
                  ) : null}
                  {!["seller_profile_exists", "seller_profile_complete", "admin_review"].includes(rewardRuleCheck) ? (
                    <View style={{ gap: 10 }}>
                      <Text style={{ color: TEXT, fontWeight: "900", fontSize: 13 }}>When progress counts</Text>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                        {REWARD_WINDOW_OPTIONS.map((option) => {
                          const selected = rewardRuleWindowMode === option.key;
                          return (
                            <Pressable
                              key={option.key}
                              onPress={() => setRewardRuleWindowMode(option.key)}
                              style={{
                                flex: 1,
                                minWidth: 180,
                                borderRadius: 8,
                                padding: 12,
                                backgroundColor: selected ? "rgba(245,158,11,0.16)" : "rgba(255,255,255,0.04)",
                                borderWidth: 1,
                                borderColor: selected ? "rgba(245,158,11,0.42)" : BORDER,
                              }}
                            >
                              <Text style={{ color: selected ? WARNING : TEXT, fontWeight: "900", fontSize: 12 }}>{option.label}</Text>
                              <Text style={{ marginTop: 4, color: MUTED, fontSize: 11, lineHeight: 16 }}>{option.description}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                      {rewardRuleWindowMode === "after_first_progress" ? (
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                          <View style={{ width: 160 }}>
                            <AdminTextInput value={rewardRuleWindowAmount} onChangeText={setRewardRuleWindowAmount} placeholder="Time limit" />
                          </View>
                          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                            {(["minutes", "hours", "days"] as RewardTimeUnit[]).map((unit) => (
                              <Pressable
                                key={unit}
                                onPress={() => setRewardRuleWindowUnit(unit)}
                                style={{
                                  borderRadius: 8,
                                  paddingHorizontal: 12,
                                  paddingVertical: 10,
                                  backgroundColor: rewardRuleWindowUnit === unit ? "rgba(45,212,191,0.16)" : "rgba(255,255,255,0.04)",
                                  borderWidth: 1,
                                  borderColor: rewardRuleWindowUnit === unit ? "rgba(45,212,191,0.42)" : BORDER,
                                }}
                              >
                                <Text style={{ color: rewardRuleWindowUnit === unit ? "#2DD4BF" : MUTED, fontWeight: "900", fontSize: 12 }}>{labelFromKey(unit)}</Text>
                              </Pressable>
                            ))}
                          </View>
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                  <View style={{ gap: 8 }}>
                    <Text style={{ color: TEXT, fontWeight: "900", fontSize: 13 }}>Saved rule preview</Text>
                    <AdminTextInput value={rewardTaskRules} onChangeText={setRewardTaskRules} placeholder="Generated rule" multiline autoCapitalize="none" editable={false} />
                    <ActionButton icon="copy-outline" label="Copy saved rule" color={ACCENT} onPress={() => void copyTextValue("Reward rule", rewardTaskRules)} />
                  </View>
                </View>
                {renderActionNote()}
                <ActionButton
                  icon="save-outline"
                  label="Save reward task"
                  color={SUCCESS}
                  disabled={!canManageTasks}
                  loading={workingKey === `reward-task-${rewardTaskKey.trim()}`}
                  onPress={submitRewardTask}
                />
              </View>
            </RecordCard>

            <RecordCard>
              <View style={{ gap: 12 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
                  <View style={{ flex: 1, minWidth: 240 }}>
                    <Text style={{ color: TEXT, fontWeight: "900", fontSize: 18 }}>Feature a store or campaign</Text>
                    <Text style={{ marginTop: 6, color: MUTED, fontSize: 13, lineHeight: 20 }}>
                      Show a store, listing, or seasonal campaign at the top of the rewards page.
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
                    <ActionButton icon="add-circle-outline" label="New feature" color={ACCENT} disabled={!canManagePromotions} onPress={resetPromotionBuilder} />
                    <ActionButton icon="sparkles-outline" label="New campaign" color={WARNING} disabled={!canManagePromotions} onPress={useCampaignForRewardFeature} />
                  </View>
                </View>
                {rewardPromotionId ? <Pill label={`EDITING ${shortId(rewardPromotionId)}`} color={ACCENT} /> : null}
                <View style={{ borderRadius: 8, padding: 12, backgroundColor: "rgba(45,212,191,0.08)", borderWidth: 1, borderColor: "rgba(45,212,191,0.2)", gap: 8 }}>
                  <Text style={{ color: TEXT, fontWeight: "900", fontSize: 13 }}>Quick guide</Text>
                  <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18 }}>
                    Use rewards_top for the rewards page banner. For a store feature, paste the store user UUID. For a listing feature, paste the listing UUID. For a campaign, leave both IDs blank and add the route shoppers should open.
                  </Text>
                  <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18 }}>
                    Lower priority numbers appear first. Leave dates blank to show it whenever Active is on.
                  </Text>
                  <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18 }}>
                    Market Home features are controlled from the finder below and are separate from these reward placements.
                  </Text>
                </View>
                <AdminTextInput value={rewardPromotionPlacement} onChangeText={setRewardPromotionPlacement} placeholder="placement_key, for example rewards_top" autoCapitalize="none" />
                <AdminTextInput value={rewardPromotionTitle} onChangeText={setRewardPromotionTitle} placeholder="Promotion title" />
                <AdminTextInput value={rewardPromotionSubtitle} onChangeText={setRewardPromotionSubtitle} placeholder="Promotion subtitle" multiline />
                <AdminTextInput value={rewardPromotionMediaUrl} onChangeText={setRewardPromotionMediaUrl} placeholder="Optional media URL" autoCapitalize="none" />
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                  <View style={{ flex: 1, minWidth: 180 }}>
                    <AdminTextInput value={rewardPromotionSponsorLabel} onChangeText={setRewardPromotionSponsorLabel} placeholder="Sponsor label, for example Featured" />
                  </View>
                  <View style={{ flex: 1, minWidth: 180 }}>
                    <AdminTextInput value={rewardPromotionCtaLabel} onChangeText={setRewardPromotionCtaLabel} placeholder="Button text, for example View store" />
                  </View>
                </View>
                <AdminTextInput value={rewardPromotionCtaRoute} onChangeText={setRewardPromotionCtaRoute} placeholder="Optional app route, for example /market/profile/store" autoCapitalize="none" />
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                  <View style={{ flex: 1, minWidth: 220 }}>
                    <AdminTextInput value={rewardPromotionStoreId} onChangeText={setRewardPromotionStoreId} placeholder="Optional store user UUID" autoCapitalize="none" />
                  </View>
                  <View style={{ flex: 1, minWidth: 220 }}>
                    <AdminTextInput value={rewardPromotionListingId} onChangeText={setRewardPromotionListingId} placeholder="Optional listing UUID" autoCapitalize="none" />
                  </View>
                  <View style={{ width: 130 }}>
                    <AdminTextInput value={rewardPromotionPriority} onChangeText={setRewardPromotionPriority} placeholder="Priority" />
                  </View>
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                  <View style={{ flex: 1, minWidth: 220 }}>
                    <AdminTextInput value={rewardPromotionStartsAt} onChangeText={setRewardPromotionStartsAt} placeholder="Optional starts_at, ISO time" autoCapitalize="none" />
                  </View>
                  <View style={{ flex: 1, minWidth: 220 }}>
                    <AdminTextInput value={rewardPromotionEndsAt} onChangeText={setRewardPromotionEndsAt} placeholder="Optional ends_at, ISO time" autoCapitalize="none" />
                  </View>
                </View>
                <AdminTextInput value={rewardPromotionMetadata} onChangeText={setRewardPromotionMetadata} placeholder={'{"campaign":"summer_drop"}'} multiline autoCapitalize="none" />
                {renderActionNote()}
                <ActionButton
                  icon="megaphone-outline"
                  label={rewardPromotionId ? "Update feature" : "Save feature"}
                  color={SUCCESS}
                  disabled={!canManagePromotions}
                  loading={workingKey === `reward-promo-${rewardPromotionPlacement.trim()}-${rewardPromotionTitle.trim()}`}
                  onPress={submitRewardPromotion}
                />
              </View>
            </RecordCard>

            <RecordCard>
              <View style={{ gap: 12 }}>
                <View>
                  <Text style={{ color: TEXT, fontWeight: "900", fontSize: 18 }}>Store and listing UUID finder</Text>
                  <Text style={{ marginTop: 6, color: MUTED, fontSize: 13, lineHeight: 20 }}>
                    Search above by store name, username, email, listing title, or UUID. Copy an ID, send it into rewards, or feature it on Market Home without mixing the two systems.
                  </Text>
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                  <View style={{ flex: 1, minWidth: 280, gap: 10 }}>
                    <Text style={{ color: TEXT, fontWeight: "900", fontSize: 14 }}>Stores</Text>
                    {rewardStores.slice(0, 6).length ? rewardStores.slice(0, 6).map((seller: any) => {
                      const featuredUntilMs = seller.featured_until ? new Date(String(seller.featured_until)).getTime() : null;
                      const marketFeatured = seller.featured_enabled === true && (!featuredUntilMs || featuredUntilMs >= Date.now());
                      const marketFeatureExpired = seller.featured_enabled === true && !!featuredUntilMs && featuredUntilMs < Date.now();
                      const featureDraft = marketStoreFeatureDraft(seller);
                      return (
                      <View key={seller.user_id} style={{ borderRadius: 8, borderWidth: 1, borderColor: BORDER, backgroundColor: "rgba(255,255,255,0.035)", padding: 12, gap: 8 }}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                          <View style={{ flex: 1, minWidth: 180 }}>
                            <Text style={{ color: TEXT, fontWeight: "900", fontSize: 14 }}>{seller.business_name || seller.display_name || seller.market_username || "Store"}</Text>
                            <Text style={{ marginTop: 4, color: MUTED, fontSize: 12 }}>{seller.market_username ? `@${seller.market_username}` : seller.profile?.email ?? "No username"}</Text>
                          </View>
                          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                            <Pill label={seller.active === false ? "PAUSED" : "ACTIVE"} color={seller.active === false ? DANGER : SUCCESS} />
                            <Pill label={marketFeatured ? "HOME" : marketFeatureExpired ? "EXPIRED" : "NO HOME"} color={marketFeatured ? SUCCESS : marketFeatureExpired ? DANGER : MUTED} />
                          </View>
                        </View>
                        <CopyableIdLine label="Store UUID" value={seller.user_id} />
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                          <View style={{ flex: 1, minWidth: 120 }}>
                            <AdminTextInput
                              value={featureDraft.limit}
                              onChangeText={(value) => updateMarketStoreFeatureDraft(seller.user_id, { limit: value.replace(/[^\d]/g, "").slice(0, 3), until: featureDraft.until })}
                              placeholder="Home listing limit"
                              editable={canFeatureMarketHome}
                            />
                          </View>
                          <View style={{ flex: 2, minWidth: 180 }}>
                            <AdminTextInput
                              value={featureDraft.until}
                              onChangeText={(value) => updateMarketStoreFeatureDraft(seller.user_id, { until: value, limit: featureDraft.limit })}
                              placeholder="Home expiry ISO date"
                              autoCapitalize="none"
                              editable={canFeatureMarketHome}
                            />
                          </View>
                        </View>
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                          <ActionButton icon="copy-outline" label="Copy ID" color={ACCENT} onPress={() => void copyTextValue("Store UUID", seller.user_id)} />
                          <ActionButton icon="sparkles-outline" label="Save home" color={WARNING} disabled={!canFeatureMarketHome} loading={workingKey === `market-store-feature-${seller.user_id}-on`} onPress={() => void saveMarketStoreFeature(seller, true)} />
                          <ActionButton icon="remove-circle-outline" label="Remove home" color={DANGER} disabled={!canFeatureMarketHome || !seller.featured_enabled} loading={workingKey === `market-store-feature-${seller.user_id}-off`} onPress={() => void saveMarketStoreFeature(seller, false)} />
                          <ActionButton icon="megaphone-outline" label="Use store" color={SUCCESS} disabled={!canManagePromotions} onPress={() => useStoreForRewardFeature(seller)} />
                          <ActionButton
                            icon="flash-outline"
                            label="Reward feature"
                            color={SUCCESS}
                            disabled={!canManagePromotions}
                            loading={workingKey === `reward-feature-store-${seller.user_id}`}
                            onPress={() => void createStoreFeatureNow(seller)}
                          />
                        </View>
                      </View>
                    );
                    }) : (
                      <View style={{ paddingVertical: 8 }}>
                        <Text style={{ color: TEXT, fontWeight: "900", fontSize: 13 }}>No stores found</Text>
                        <Text style={{ marginTop: 4, color: MUTED, fontSize: 12, lineHeight: 18 }}>Try a store name, username, email, or UUID in the rewards search box.</Text>
                      </View>
                    )}
                  </View>
                  <View style={{ flex: 1, minWidth: 280, gap: 10 }}>
                    <Text style={{ color: TEXT, fontWeight: "900", fontSize: 14 }}>Listings</Text>
                    {rewardListings.slice(0, 6).length ? rewardListings.slice(0, 6).map((listing: any) => {
                      const featuredUntilMs = listing.featured_until ? new Date(String(listing.featured_until)).getTime() : null;
                      const marketFeatured = listing.featured_enabled === true && (!featuredUntilMs || featuredUntilMs >= Date.now());
                      const marketFeatureExpired = listing.featured_enabled === true && !!featuredUntilMs && featuredUntilMs < Date.now();
                      const featureDraft = marketListingFeatureDraft(listing);
                      return (
                      <View key={listing.id} style={{ borderRadius: 8, borderWidth: 1, borderColor: BORDER, backgroundColor: "rgba(255,255,255,0.035)", padding: 12, gap: 8 }}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                          <View style={{ flex: 1, minWidth: 180 }}>
                            <Text style={{ color: TEXT, fontWeight: "900", fontSize: 14 }}>{listing.title || "Listing"}</Text>
                            <Text style={{ marginTop: 4, color: MUTED, fontSize: 12 }}>{personLabel(listing.seller)}</Text>
                          </View>
                          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                            <Pill label={listing.is_active === false ? "DISABLED" : "LIVE"} color={listing.is_active === false ? DANGER : SUCCESS} />
                            <Pill label={marketFeatured ? "HOME" : marketFeatureExpired ? "EXPIRED" : "NO HOME"} color={marketFeatured ? SUCCESS : marketFeatureExpired ? DANGER : MUTED} />
                          </View>
                        </View>
                        <CopyableIdLine label="Listing UUID" value={listing.id} />
                        <CopyableIdLine label="Store UUID" value={listing.seller_id} />
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                          <View style={{ flex: 1, minWidth: 120 }}>
                            <AdminTextInput
                              value={featureDraft.priority}
                              onChangeText={(value) => updateMarketListingFeatureDraft(listing.id, { priority: value.replace(/[^\d]/g, "").slice(0, 6), until: featureDraft.until })}
                              placeholder="Home priority"
                              editable={canFeatureMarketHome}
                            />
                          </View>
                          <View style={{ flex: 2, minWidth: 180 }}>
                            <AdminTextInput
                              value={featureDraft.until}
                              onChangeText={(value) => updateMarketListingFeatureDraft(listing.id, { until: value, priority: featureDraft.priority })}
                              placeholder="Home expiry ISO date"
                              autoCapitalize="none"
                              editable={canFeatureMarketHome}
                            />
                          </View>
                        </View>
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                          <ActionButton icon="copy-outline" label="Copy ID" color={ACCENT} onPress={() => void copyTextValue("Listing UUID", listing.id)} />
                          <ActionButton icon="sparkles-outline" label="Save home" color={WARNING} disabled={!canFeatureMarketHome} loading={workingKey === `market-listing-feature-${listing.id}-on`} onPress={() => void saveMarketListingFeature(listing, true)} />
                          <ActionButton icon="remove-circle-outline" label="Remove home" color={DANGER} disabled={!canFeatureMarketHome || !listing.featured_enabled} loading={workingKey === `market-listing-feature-${listing.id}-off`} onPress={() => void saveMarketListingFeature(listing, false)} />
                          <ActionButton icon="megaphone-outline" label="Use listing" color={SUCCESS} disabled={!canManagePromotions} onPress={() => useListingForRewardFeature(listing)} />
                          <ActionButton
                            icon="flash-outline"
                            label="Reward feature"
                            color={SUCCESS}
                            disabled={!canManagePromotions}
                            loading={workingKey === `reward-feature-listing-${listing.id}`}
                            onPress={() => void createListingFeatureNow(listing)}
                          />
                        </View>
                      </View>
                    );
                    }) : (
                      <View style={{ paddingVertical: 8 }}>
                        <Text style={{ color: TEXT, fontWeight: "900", fontSize: 13 }}>No listings found</Text>
                        <Text style={{ marginTop: 4, color: MUTED, fontSize: 12, lineHeight: 18 }}>Try a listing title, seller, category, or UUID in the rewards search box.</Text>
                      </View>
                    )}
                  </View>
                </View>
              </View>
            </RecordCard>

            <RecordCard>
              <View style={{ gap: 12 }}>
                <View>
                  <Text style={{ color: TEXT, fontWeight: "900", fontSize: 18 }}>Manual Noms adjustment</Text>
                  <Text style={{ marginTop: 6, color: MUTED, fontSize: 13, lineHeight: 20 }}>
                    Positive numbers credit. Negative numbers debit. Every change writes to the reward ledger.
                  </Text>
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                  <View style={{ flex: 2, minWidth: 250 }}>
                    <AdminTextInput value={rewardAdjustUserId} onChangeText={setRewardAdjustUserId} placeholder="User UUID" autoCapitalize="none" />
                  </View>
                  <View style={{ flex: 1, minWidth: 160 }}>
                    <AdminTextInput value={rewardAdjustAmount} onChangeText={setRewardAdjustAmount} placeholder="Amount, for example 250 or -50" />
                  </View>
                </View>
                {renderActionNote()}
                <ActionButton
                  icon="cash-outline"
                  label="Adjust balance"
                  color={WARNING}
                  disabled={!canAdjust}
                  loading={workingKey === `reward-adjust-${rewardAdjustUserId.trim()}`}
                  onPress={submitRewardAdjustment}
                />
              </View>
            </RecordCard>
          </View>
        ) : null}

        {rewardTab === "tasks" ? (
          tasks.length ? tasks.map((task: any) => {
            const active = task.active !== false;
            return (
              <RecordCard key={task.id}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <View style={{ flex: 1, minWidth: 220 }}>
                    <Text style={{ color: TEXT, fontWeight: "900", fontSize: 17 }}>{task.title}</Text>
                    <Text style={{ marginTop: 5, color: MUTED, fontSize: 13 }}>{task.task_key}</Text>
                    <Text style={{ marginTop: 7, color: MUTED, fontSize: 12, lineHeight: 18 }}>{task.description || "No description"}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 8 }}>
                    <Pill label={active ? "ACTIVE" : "PAUSED"} color={active ? SUCCESS : DANGER} />
                    <Text style={{ color: WARNING, fontWeight: "900", fontSize: 14 }}>+{Number(task.reward_noms ?? 0).toLocaleString()} noms</Text>
                  </View>
                </View>
                <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                  <InfoLine label="Category" value={labelFromKey(task.category)} />
                  <InfoLine label="Trigger" value={labelFromKey(task.trigger_type)} />
                  <InfoLine label="Daily cap" value={task.daily_cap ?? "none"} />
                  <InfoLine label="Cooldown" value={`${task.cooldown_seconds ?? 0}s`} />
                </View>
                <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                  <ActionButton icon="create-outline" label="Edit in builder" color={ACCENT} disabled={!canManageTasks} onPress={() => loadTaskIntoBuilder(task)} />
                  <ActionButton
                    icon={active ? "pause-circle-outline" : "play-circle-outline"}
                    label={active ? "Pause task" : "Activate task"}
                    color={active ? DANGER : SUCCESS}
                    disabled={!canManageTasks}
                    loading={workingKey === `reward-task-active-${task.id}`}
                    onPress={() => performAction(`reward-task-active-${task.id}`, { action: "set_reward_task_active", task_id: task.id, active: !active }, true)}
                  />
                </View>
              </RecordCard>
            );
          }) : (
            <EmptyState title="No reward tasks" subtitle="Create a task from the build panel. It will appear in the rewards tab without a redeploy." />
          )
        ) : null}

        {rewardTab === "promotions" ? (
          promotions.length ? promotions.map((promo: any) => {
            const active = promo.active !== false;
            return (
              <RecordCard key={promo.id}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <View style={{ flex: 1, minWidth: 220 }}>
                    <Text style={{ color: TEXT, fontWeight: "900", fontSize: 17 }}>{promo.title}</Text>
                    <Text style={{ marginTop: 5, color: MUTED, fontSize: 13 }}>{promo.placement_key}</Text>
                    <Text style={{ marginTop: 7, color: MUTED, fontSize: 12, lineHeight: 18 }}>{promo.subtitle || "No subtitle"}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 8 }}>
                    <Pill label={active ? "ACTIVE" : "PAUSED"} color={active ? SUCCESS : DANGER} />
                    {promo.sponsor_label ? <Pill label={String(promo.sponsor_label).toUpperCase()} color={ACCENT} /> : null}
                  </View>
                </View>
                <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                  <InfoLine label="Priority" value={promo.priority ?? 100} />
                  <InfoLine label="Store" value={shortId(promo.store_id)} />
                  <InfoLine label="Listing" value={shortId(promo.listing_id)} />
                  <InfoLine label="CTA" value={promo.cta_label || "View"} />
                  <InfoLine label="Route" value={promo.cta_route || "auto"} />
                  <InfoLine label="Starts" value={formatDate(promo.starts_at)} />
                  <InfoLine label="Ends" value={formatDate(promo.ends_at)} />
                </View>
                <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                  <ActionButton icon="create-outline" label="Edit in builder" color={ACCENT} disabled={!canManagePromotions} onPress={() => loadPromotionIntoBuilder(promo)} />
                  <ActionButton
                    icon={active ? "pause-circle-outline" : "play-circle-outline"}
                    label={active ? "Pause promo" : "Activate promo"}
                    color={active ? DANGER : SUCCESS}
                    disabled={!canManagePromotions}
                    loading={workingKey === `reward-promo-active-${promo.id}`}
                    onPress={() => performAction(`reward-promo-active-${promo.id}`, { action: "set_reward_promotion_active", promotion_id: promo.id, active: !active }, true)}
                  />
                </View>
              </RecordCard>
            );
          }) : (
            <EmptyState title="No promoted placements" subtitle="Create a rewards_top placement from the build panel to advertise a store in the rewards tab." />
          )
        ) : null}

        {rewardTab === "reviews" ? (
          reviews.length ? reviews.map((review: any) => (
            <RecordCard key={review.id}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <View style={{ flex: 1, minWidth: 220 }}>
                  <Text style={{ color: TEXT, fontWeight: "900", fontSize: 17 }}>{review.task?.title ?? "Reward review"}</Text>
                  <Text style={{ marginTop: 5, color: MUTED, fontSize: 13 }}>{personLabel(review.user)} - {shortId(review.user_id)}</Text>
                  <Text style={{ marginTop: 7, color: MUTED, fontSize: 12, lineHeight: 18 }} numberOfLines={4}>
                    {JSON.stringify(review.evidence ?? {})}
                  </Text>
                </View>
                <Pill label={String(review.status || "pending").toUpperCase()} color={statusTone(review.status)} />
              </View>
              {renderActionNote()}
              <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                <ActionButton
                  icon="checkmark-circle-outline"
                  label="Approve and reward"
                  color={SUCCESS}
                  disabled={!canReview}
                  loading={workingKey === `reward-review-approve-${review.id}`}
                  onPress={() => performAction(`reward-review-approve-${review.id}`, { action: "review_reward_completion", completion_id: review.id, decision: "approve" }, false)}
                />
                <ActionButton
                  icon="close-circle-outline"
                  label="Reject"
                  color={DANGER}
                  disabled={!canReview}
                  loading={workingKey === `reward-review-reject-${review.id}`}
                  onPress={() => performAction(`reward-review-reject-${review.id}`, { action: "review_reward_completion", completion_id: review.id, decision: "reject" }, true)}
                />
              </View>
            </RecordCard>
          )) : (
            <EmptyState title="No pending reward reviews" subtitle="Admin-review tasks submitted by users will appear here." />
          )
        ) : null}

        {rewardTab === "accounts" ? (
          accounts.length ? accounts.map((account: any) => (
            <RecordCard key={account.user_id}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <View style={{ flex: 1, minWidth: 220 }}>
                  <Text style={{ color: TEXT, fontWeight: "900", fontSize: 17 }}>{personLabel(account.user)}</Text>
                  <Text style={{ marginTop: 5, color: MUTED, fontSize: 13 }}>{shortId(account.user_id)}</Text>
                </View>
                <Text style={{ color: WARNING, fontWeight: "900", fontSize: 18 }}>{Number(account.balance ?? 0).toLocaleString()} noms</Text>
              </View>
              <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                <InfoLine label="Lifetime earned" value={Number(account.lifetime_earned ?? 0).toLocaleString()} />
                <InfoLine label="Lifetime spent" value={Number(account.lifetime_spent ?? 0).toLocaleString()} />
                <InfoLine label="Tier" value={account.tier_key ?? "starter"} />
                <InfoLine label="Updated" value={formatDate(account.updated_at)} />
              </View>
              <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                <ActionButton
                  icon="cash-outline"
                  label="Adjust this account"
                  color={WARNING}
                  disabled={!canAdjust}
                  onPress={() => {
                    setRewardAdjustUserId(account.user_id);
                    setRewardTab("build");
                  }}
                />
              </View>
            </RecordCard>
          )) : (
            <EmptyState title="No reward accounts" subtitle="Accounts are created automatically when users open rewards or earn noms." />
          )
        ) : null}

        {rewardTab === "ledger" ? (
          ledger.length ? ledger.map((entry: any) => {
            const positive = Number(entry.delta ?? 0) >= 0;
            return (
              <RecordCard key={entry.id}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <View style={{ flex: 1, minWidth: 220 }}>
                    <Text style={{ color: TEXT, fontWeight: "900", fontSize: 17 }}>{entry.reason || entry.source}</Text>
                    <Text style={{ marginTop: 5, color: MUTED, fontSize: 13 }}>{personLabel(entry.user)} - {formatDate(entry.created_at)}</Text>
                  </View>
                  <Text style={{ color: positive ? SUCCESS : DANGER, fontWeight: "900", fontSize: 17 }}>
                    {positive ? "+" : ""}{Number(entry.delta ?? 0).toLocaleString()}
                  </Text>
                </View>
                <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                  <InfoLine label="Balance after" value={Number(entry.balance_after ?? 0).toLocaleString()} />
                  <InfoLine label="Source" value={labelFromKey(entry.source)} />
                  <InfoLine label="Task" value={entry.task?.title ?? "n/a"} />
                  <InfoLine label="Status" value={entry.status ?? "settled"} />
                </View>
              </RecordCard>
            );
          }) : (
            <EmptyState title="No ledger events" subtitle="Reward credits, debits, ad earnings, and admin adjustments will appear here." />
          )
        ) : null}
      </View>
    );
  }

  function renderAdmins() {
    const adminData = workspace?.modules.admins;
    const allAdminUsers = adminData?.users ?? [];
    const allRoles = adminData?.roles ?? [];
    const systemControl = adminData?.system_control;
    const isSuperAdmin = overview?.admin.role_key === "super_admin";
    const adminUsers = allAdminUsers.filter((adminUser: any) => matchesSearch(currentModuleSearch, [
      adminUser.user_id,
      adminUser.role_key,
      adminUser.display_name,
      adminUser.profile?.email,
      adminUser.profile?.full_name,
      adminUser.profile?.username,
      adminUser.is_active === false ? "removed" : "active",
    ]));
    const roles = allRoles.filter((role: any) => matchesSearch(currentModuleSearch, [
      role.key,
      role.name,
      role.description,
      ...(role.permissions ?? []).map(permissionLabel),
    ]));
    const canManage = hasPermission("admin.members.manage");

    async function submitAdminUser() {
      const email = adminEmail.trim();
      if (!email) {
        setError("Enter the user's account email.");
        return;
      }
      if (!adminRoleKey) {
        setError("Choose an admin role.");
        return;
      }

      await performAction(
        `admin-upsert-${email}`,
        {
          action: "upsert_admin_user",
          email,
          role_key: adminRoleKey,
          display_name: adminDisplayName,
          password: adminPassword,
          is_active: true,
        },
        true,
      );
      setAdminPassword("");
    }

    function loadAdminIntoForm(row: any) {
      setAdminEmail(row.profile?.email ?? "");
      setAdminDisplayName(row.display_name ?? row.profile?.full_name ?? row.profile?.username ?? "");
      setAdminRoleKey(row.role_key ?? "support_admin");
      setAdminPassword("");
      setAdminTab("invite");
    }

    async function submitSystemControl(nextMaintenanceEnabled = systemMaintenanceEnabled) {
      await performAction(
        `system-control-${nextMaintenanceEnabled ? "pause" : "resume"}`,
        {
          action: "set_app_system_control",
          maintenance_enabled: nextMaintenanceEnabled,
          maintenance_message: systemMaintenanceMessage,
          maintenance_eta: systemMaintenanceEta,
          force_update: systemForceUpdate,
          min_version: systemMinVersion,
          update_message: systemUpdateMessage,
          apk_url: systemApkUrl,
        },
        true,
      );
    }

    return (
      <View style={{ marginTop: 18, gap: 14 }}>
        <SectionHeader
          icon="id-card-outline"
          title="Admin members and roles"
          subtitle="Manage access separately from daily queues, with readable role boundaries instead of raw permission keys."
          count={adminTab === "members" ? adminUsers.length : adminTab === "roles" ? roles.length : allRoles.length}
        >
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <SearchBox
              value={currentModuleSearch}
              onChangeText={setCurrentModuleSearch}
              placeholder={adminTab === "roles" ? "Search roles by name, purpose, or capability" : "Search admins by name, email, role, or status"}
            />
            <SegmentedControl
              value={adminTab}
              onChange={setAdminTab}
              options={[
                { key: "members", label: "Members", count: adminUsers.length },
                { key: "roles", label: "Roles", count: roles.length },
                { key: "invite", label: "Add or edit" },
                ...(isSuperAdmin ? [{ key: "system" as const, label: "System" }] : []),
              ]}
            />
          </View>
        </SectionHeader>

        {adminTab === "system" && isSuperAdmin ? (
          <View style={{ borderRadius: 8, padding: 16, backgroundColor: PANEL_ALT, borderWidth: 1, borderColor: systemMaintenanceEnabled ? "rgba(248,113,113,0.42)" : BORDER, gap: 14 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
              <View style={{ flex: 1, minWidth: 240 }}>
                <Text style={{ color: TEXT, fontWeight: "900", fontSize: 18 }}>Project pause control</Text>
                <Text style={{ marginTop: 6, color: MUTED, fontSize: 13, lineHeight: 20 }}>
                  Super admin only. When paused, normal user routes show the maintenance screen while auth and admin access remain available.
                </Text>
              </View>
              <Pill label={systemMaintenanceEnabled ? "MAINTENANCE ACTIVE" : "LIVE"} color={systemMaintenanceEnabled ? DANGER : SUCCESS} />
            </View>

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              <Pressable
                onPress={() => setSystemMaintenanceEnabled((value) => !value)}
                style={{
                  flex: 1,
                  minWidth: 220,
                  borderRadius: 8,
                  padding: 13,
                  backgroundColor: systemMaintenanceEnabled ? "rgba(248,113,113,0.13)" : "rgba(74,222,128,0.10)",
                  borderWidth: 1,
                  borderColor: systemMaintenanceEnabled ? "rgba(248,113,113,0.34)" : "rgba(74,222,128,0.28)",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <Ionicons name={systemMaintenanceEnabled ? "pause-circle" : "play-circle"} size={20} color={systemMaintenanceEnabled ? DANGER : SUCCESS} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: TEXT, fontWeight: "900" }}>{systemMaintenanceEnabled ? "Project is paused" : "Project is live"}</Text>
                  <Text style={{ marginTop: 3, color: MUTED, fontSize: 12 }}>{systemMaintenanceEnabled ? "Users see maintenance messaging." : "Users can access the app normally."}</Text>
                </View>
              </Pressable>

              <Pressable
                onPress={() => setSystemForceUpdate((value) => !value)}
                style={{
                  flex: 1,
                  minWidth: 220,
                  borderRadius: 8,
                  padding: 13,
                  backgroundColor: systemForceUpdate ? "rgba(245,158,11,0.14)" : "rgba(255,255,255,0.045)",
                  borderWidth: 1,
                  borderColor: systemForceUpdate ? "rgba(245,158,11,0.36)" : BORDER,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <Ionicons name={systemForceUpdate ? "cloud-download" : "cloud-download-outline"} size={20} color={systemForceUpdate ? WARNING : FAINT} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: TEXT, fontWeight: "900" }}>{systemForceUpdate ? "Force update enabled" : "Force update off"}</Text>
                  <Text style={{ marginTop: 3, color: MUTED, fontSize: 12 }}>Optional version gate for production releases.</Text>
                </View>
              </Pressable>
            </View>

            <View style={{ gap: 8 }}>
              <Text style={{ color: FAINT, fontSize: 11, fontWeight: "900", textTransform: "uppercase" }}>Maintenance message</Text>
              <AdminTextInput value={systemMaintenanceMessage} onChangeText={setSystemMaintenanceMessage} placeholder="Message shown to users during maintenance" multiline />
            </View>

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              <View style={{ flex: 1, minWidth: 220, gap: 8 }}>
                <Text style={{ color: FAINT, fontSize: 11, fontWeight: "900", textTransform: "uppercase" }}>Estimated return</Text>
                <AdminTextInput value={systemMaintenanceEta} onChangeText={setSystemMaintenanceEta} placeholder="Optional, for example Today 8 PM WAT" />
              </View>
              <View style={{ flex: 1, minWidth: 220, gap: 8 }}>
                <Text style={{ color: FAINT, fontSize: 11, fontWeight: "900", textTransform: "uppercase" }}>Minimum app version</Text>
                <AdminTextInput value={systemMinVersion} onChangeText={setSystemMinVersion} placeholder="0.0.0" autoCapitalize="none" />
              </View>
            </View>

            <View style={{ gap: 8 }}>
              <Text style={{ color: FAINT, fontSize: 11, fontWeight: "900", textTransform: "uppercase" }}>Update message</Text>
              <AdminTextInput value={systemUpdateMessage} onChangeText={setSystemUpdateMessage} placeholder="Message shown when an update is required" multiline />
            </View>
            <View style={{ gap: 8 }}>
              <Text style={{ color: FAINT, fontSize: 11, fontWeight: "900", textTransform: "uppercase" }}>Update URL</Text>
              <AdminTextInput value={systemApkUrl} onChangeText={setSystemApkUrl} placeholder="https://bestcity.app/download" autoCapitalize="none" />
            </View>

            {systemControl ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                <InfoLine label="Last updated" value={formatDate(systemControl.updated_at)} />
                <InfoLine label="Created" value={formatDate(systemControl.created_at)} />
              </View>
            ) : null}

            {renderActionNote()}

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              <ActionButton
                icon={systemMaintenanceEnabled ? "play-outline" : "pause-outline"}
                label={systemMaintenanceEnabled ? "Resume project" : "Pause project"}
                color={systemMaintenanceEnabled ? SUCCESS : DANGER}
                loading={String(workingKey ?? "").startsWith("system-control-")}
                onPress={() => {
                  const nextEnabled = !systemMaintenanceEnabled;
                  void submitSystemControl(nextEnabled);
                }}
              />
              <ActionButton
                icon="save-outline"
                label="Save system settings"
                color={ACCENT}
                loading={String(workingKey ?? "").startsWith("system-control-")}
                onPress={() => void submitSystemControl(systemMaintenanceEnabled)}
              />
            </View>
          </View>
        ) : null}

        {adminTab === "invite" ? (
          <View style={{ borderRadius: 8, padding: 16, backgroundColor: PANEL_ALT, borderWidth: 1, borderColor: BORDER, gap: 12 }}>
            <View>
              <Text style={{ color: TEXT, fontWeight: "900", fontSize: 18 }}>Add or edit admin</Text>
              <Text style={{ marginTop: 6, color: MUTED, fontSize: 13, lineHeight: 20 }}>
                Admin passwords are separate from normal Supabase login passwords. Leave password blank when only changing role or display name.
              </Text>
            </View>

            <AdminTextInput
              value={adminEmail}
              onChangeText={setAdminEmail}
              keyboardType="email-address"
              placeholder="Existing user email"
            />
            <AdminTextInput
              value={adminDisplayName}
              onChangeText={setAdminDisplayName}
              placeholder="Admin display name"
            />
            <AdminTextInput
              value={adminPassword}
              onChangeText={setAdminPassword}
              secureTextEntry
              placeholder="Admin password, required for new admin"
            />

            <View style={{ gap: 8 }}>
              <Text style={{ color: FAINT, fontSize: 11, fontWeight: "900", textTransform: "uppercase" }}>Role assignment</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                {allRoles.map((role: any) => {
                  const selected = adminRoleKey === role.key;
                  return (
                    <Pressable
                      key={role.key}
                      onPress={() => setAdminRoleKey(role.key)}
                      style={{
                        borderRadius: 8,
                        paddingHorizontal: 12,
                        paddingVertical: 10,
                        backgroundColor: selected ? "rgba(251,191,36,0.16)" : "rgba(255,255,255,0.04)",
                        borderWidth: 1,
                        borderColor: selected ? "rgba(251,191,36,0.5)" : BORDER,
                        maxWidth: 260,
                      }}
                    >
                      <Text style={{ color: selected ? WARNING : TEXT, fontWeight: "900", fontSize: 12 }}>{role.name ?? role.key}</Text>
                      <Text numberOfLines={2} style={{ marginTop: 4, color: MUTED, fontSize: 11, lineHeight: 16 }}>{role.description ?? roleFocus(role.key)}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {renderActionNote()}

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              <ActionButton
                icon="person-add-outline"
                label="Save admin"
                color={SUCCESS}
                disabled={!canManage}
                loading={workingKey === `admin-upsert-${adminEmail.trim()}`}
                onPress={submitAdminUser}
              />
              <ActionButton
                icon="refresh-outline"
                label="Clear form"
                color={ACCENT}
                onPress={() => {
                  setAdminEmail("");
                  setAdminDisplayName("");
                  setAdminRoleKey("support_admin");
                  setAdminPassword("");
                }}
              />
            </View>
          </View>
        ) : null}

        {adminTab === "members" ? (
          adminUsers.length ? adminUsers.map((adminUser: any) => {
          const active = adminUser.is_active !== false;
          const role = allRoles.find((item: any) => item.key === adminUser.role_key);
          return (
            <RecordCard key={adminUser.user_id}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <View style={{ flex: 1, minWidth: 220 }}>
                  <Text style={{ color: TEXT, fontWeight: "900", fontSize: 17 }}>
                    {adminUser.display_name || adminUser.profile?.full_name || adminUser.profile?.username || adminUser.profile?.email || shortId(adminUser.user_id)}
                  </Text>
                  <Text style={{ marginTop: 5, color: MUTED, fontSize: 13 }}>{adminUser.profile?.email ?? shortId(adminUser.user_id)}</Text>
                </View>
                <Pill label={active ? "ACTIVE" : "REMOVED"} color={active ? SUCCESS : DANGER} />
              </View>

              <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                <InfoLine label="Role" value={role?.name ?? adminUser.role_key} />
                <InfoLine label="Last login" value={formatDate(adminUser.last_login_at)} />
                <InfoLine label="Password changed" value={formatDate(adminUser.last_password_change_at)} />
                <InfoLine label="Updated" value={formatDate(adminUser.updated_at)} />
              </View>

              <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                <ActionButton
                  icon="create-outline"
                  label="Edit in form"
                  color={ACCENT}
                  disabled={!canManage}
                  onPress={() => loadAdminIntoForm(adminUser)}
                />
                <ActionButton
                  icon={active ? "person-remove-outline" : "person-add-outline"}
                  label={active ? "Remove access" : "Reactivate"}
                  color={active ? DANGER : SUCCESS}
                  disabled={!canManage}
                  loading={workingKey === `admin-active-${adminUser.user_id}`}
                  onPress={() => performAction(`admin-active-${adminUser.user_id}`, { action: "set_admin_active", user_id: adminUser.user_id, is_active: !active }, true)}
                />
              </View>
            </RecordCard>
          );
        }) : (
          <EmptyState title={allAdminUsers.length ? "No matching admin members" : "No admin members"} subtitle={allAdminUsers.length ? "Try a name, email, role, active, or removed status." : "Add an existing signed-up user as an admin from the add/edit tab."} />
        )) : null}

        {adminTab === "roles" ? (
          roles.length ? roles.map((role: any) => (
          <RecordCard key={role.key}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <View style={{ flex: 1, minWidth: 220 }}>
                <Text style={{ color: TEXT, fontWeight: "900", fontSize: 17 }}>{role.name ?? role.key}</Text>
                <Text style={{ marginTop: 5, color: MUTED, fontSize: 13, lineHeight: 20 }}>{role.description ?? "No description"}</Text>
              </View>
              <Pill label={`rank ${role.rank ?? 0}`} color={ACCENT} />
            </View>
            <View style={{ marginTop: 12 }}>
              <PermissionGroups permissions={role.permissions ?? []} />
            </View>
          </RecordCard>
        )) : (
          <EmptyState title={allRoles.length ? "No matching roles" : "No roles"} subtitle={allRoles.length ? "Try a role name, purpose, or capability such as escrow, support, verification, or listings." : "Role definitions are not available."} />
        )) : null}
      </View>
    );
  }

  function renderActiveModule() {
    const module = visibleModules.find((item) => item.key === currentModule);
    return (
      <View style={{ marginTop: 18, gap: 16 }}>
        <View style={{ borderRadius: 8, padding: 16, backgroundColor: PANEL, borderWidth: 1, borderColor: BORDER }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <View style={{ flex: 1, minWidth: 230, flexDirection: "row", gap: 12, alignItems: "center" }}>
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 8,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: `${currentModuleMeta.accent}18`,
                  borderWidth: 1,
                  borderColor: `${currentModuleMeta.accent}42`,
                }}
              >
                <Ionicons name={currentModuleMeta.icon} size={21} color={currentModuleMeta.accent} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: currentModuleMeta.accent, fontSize: 11, fontWeight: "900", textTransform: "uppercase" }}>{currentModuleMeta.eyebrow}</Text>
                <Text style={{ marginTop: 4, color: TEXT, fontWeight: "900", fontSize: isDesktop ? 24 : 21 }}>{module?.title ?? "Admin module"}</Text>
                <Text style={{ marginTop: 6, color: MUTED, fontSize: 13, lineHeight: 20 }}>{module?.description ?? "Admin workspace"}</Text>
              </View>
            </View>
            {module ? <Pill label={permissionLabel(module.permission)} color={currentModuleMeta.accent} /> : null}
          </View>
        </View>

        {currentModule === "support" ? renderSupport() : null}
        {currentModule === "moderation" ? renderModeration() : null}
        {currentModule === "verification" ? renderVerification() : null}
        {currentModule === "escrow" ? renderEscrow() : null}
        {currentModule === "rewards" ? renderRewards() : null}
        {currentModule === "admins" ? renderAdmins() : null}
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
          <View style={{ marginTop: 36, borderRadius: 8, padding: 22, backgroundColor: PANEL, borderWidth: 1, borderColor: BORDER }}>
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
      <View style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{
            paddingTop: insets.top + (isDesktop ? 24 : 16),
            paddingHorizontal: isDesktop ? 24 : 14,
            paddingBottom: insets.bottom + (isDesktop ? 44 : 112),
          }}
        >
          <View
            style={{
              maxWidth: 1280,
              width: "100%",
              alignSelf: "center",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: 18,
            }}
          >
            <View style={{ flex: 1, width: "100%", minWidth: 0 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                <View style={{ flex: 1, minWidth: 240 }}>
                  <Text style={{ color: ACCENT, fontSize: 12, fontWeight: "900", textTransform: "uppercase" }}>Marketplace admin</Text>
                  <Text style={{ marginTop: 8, color: TEXT, fontSize: isDesktop ? 34 : 28, fontWeight: "900" }}>Operations control room</Text>
                  <Text style={{ marginTop: 8, color: MUTED, fontSize: 13, lineHeight: 20, maxWidth: 680 }}>
                    Support, moderation, verification, escrow, and admin access in one professional console.
                  </Text>
                </View>

                {!isDesktop ? (
                  <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
                    <ActionButton icon="refresh" label={checkingSession ? "Syncing" : "Refresh"} color={ACCENT} loading={checkingSession} onPress={checkMembershipAndMaybeLoad} />
                    {overview ? <ActionButton icon="log-out-outline" label="Lock" color={DANGER} onPress={onLogout} /> : null}
                  </View>
                ) : null}
              </View>

              {error ? (
                <View style={{ marginTop: 18, borderRadius: 8, padding: 16, backgroundColor: "rgba(248,113,113,0.12)", borderWidth: 1, borderColor: "rgba(248,113,113,0.25)" }}>
                  <Text style={{ color: "#FECACA", fontWeight: "800" }}>{error}</Text>
                </View>
              ) : null}
              {notice ? (
                <View style={{ marginTop: 18, borderRadius: 8, padding: 16, backgroundColor: "rgba(245,158,11,0.12)", borderWidth: 1, borderColor: "rgba(245,158,11,0.25)" }}>
                  <Text style={{ color: "#FDE68A", fontWeight: "800" }}>{notice}</Text>
                </View>
              ) : null}

              {!overview ? (
                <View style={{ marginTop: 20, borderRadius: 8, padding: 22, backgroundColor: PANEL, borderWidth: 1, borderColor: BORDER, maxWidth: 620 }}>
                  <Text style={{ color: TEXT, fontSize: 23, fontWeight: "900" }}>Unlock admin session</Text>
                  <Text style={{ marginTop: 8, color: MUTED, fontSize: 14, lineHeight: 22 }}>
                    Your Supabase sign-in proves who you are. The second admin password unlocks sensitive control actions.
                  </Text>

                  <View style={{ marginTop: 18, gap: 12 }}>
                    <AdminTextInput
                      secureTextEntry
                      value={password}
                      onChangeText={setPassword}
                      placeholder="Enter admin password"
                    />
                    <ActionButton icon="shield-checkmark-outline" label={submitting ? "Unlocking" : "Unlock admin"} color={SUCCESS} loading={submitting} onPress={onUnlock} />
                  </View>
                </View>
              ) : (
                <>
                  <View style={{ marginTop: 20, borderRadius: 8, padding: 16, backgroundColor: PANEL, borderWidth: 1, borderColor: BORDER }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                      <View style={{ flex: 1, minWidth: 240 }}>
                        <Text style={{ color: TEXT, fontSize: 20, fontWeight: "900" }}>{overview.admin.role_name}</Text>
                        <Text style={{ marginTop: 6, color: MUTED, fontSize: 13, lineHeight: 20 }}>
                          {roleFocus(overview.admin.role_key)}.
                        </Text>
                      </View>
                      <Pill label={`${visibleModules.length} workspaces`} color={ACCENT} />
                    </View>
                  </View>

                  <View style={{ marginTop: 16, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                    {Object.entries(overview.metrics).map(([key, value]) => (
                      <View
                        key={key}
                        style={{
                          minWidth: isDesktop ? 152 : 132,
                          flexGrow: 1,
                          flexBasis: isDesktop ? 152 : 132,
                          borderRadius: 8,
                          padding: 14,
                          backgroundColor: PANEL_ALT,
                          borderWidth: 1,
                          borderColor: BORDER,
                        }}
                      >
                        <Text style={{ color: TEXT, fontWeight: "900", fontSize: 23 }}>{value}</Text>
                        <Text style={{ marginTop: 6, color: MUTED, fontSize: 12 }}>{labelFromKey(key)}</Text>
                      </View>
                    ))}
                  </View>

                  {workspace ? renderActiveModule() : (
                    <View style={{ marginTop: 18, borderRadius: 8, padding: 24, backgroundColor: PANEL, borderWidth: 1, borderColor: BORDER, alignItems: "center" }}>
                      <ActivityIndicator color={ACCENT} />
                      <Text style={{ marginTop: 12, color: TEXT, fontWeight: "900" }}>Opening workspace</Text>
                    </View>
                  )}
                </>
              )}
            </View>
          </View>
        </ScrollView>
        {renderBottomNav()}
      </View>
    </LinearGradient>
  );
}
