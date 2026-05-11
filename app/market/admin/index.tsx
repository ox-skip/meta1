import { Ionicons } from "@expo/vector-icons";
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
  useWindowDimensions,
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

type ModuleKey = "support" | "moderation" | "verification" | "escrow" | "admins";
type ModerationTab = "sellers" | "listings";
type EscrowTab = "orders" | "stocks" | "chains" | "audit";
type AdminTab = "members" | "roles" | "invite";
type SupportStatusTab = "fresh" | "in_progress" | "resolved" | "closed" | "all";
type SupportPickedFile = SupportLocalFile & { id: string };

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

function openOrder(orderId?: string | null) {
  const id = String(orderId ?? "").trim();
  if (id) router.push(`/market/order/${encodeURIComponent(id)}` as any);
}

function dmSlugForUser(user: any) {
  return String(user?.seller?.market_username || user?.profile?.username || user?.id || "").trim();
}

function openDmSlug(slug?: string | null) {
  const clean = String(slug || "").trim();
  if (clean) router.push(`/market/dm/${encodeURIComponent(clean)}` as any);
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
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  secureTextEntry?: boolean;
  keyboardType?: "default" | "email-address";
  multiline?: boolean;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      secureTextEntry={secureTextEntry}
      keyboardType={keyboardType}
      autoCapitalize={keyboardType === "email-address" ? "none" : undefined}
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
  const [workingKey, setWorkingKey] = useState<string | null>(null);
  const [adminEmail, setAdminEmail] = useState("");
  const [adminDisplayName, setAdminDisplayName] = useState("");
  const [adminRoleKey, setAdminRoleKey] = useState("support_admin");
  const [adminPassword, setAdminPassword] = useState("");
  const [moduleSearch, setModuleSearch] = useState<Record<ModuleKey, string>>({
    support: "",
    moderation: "",
    verification: "",
    escrow: "",
    admins: "",
  });
  const [moderationTab, setModerationTab] = useState<ModerationTab>("sellers");
  const [escrowTab, setEscrowTab] = useState<EscrowTab>("orders");
  const [adminTab, setAdminTab] = useState<AdminTab>("members");
  const [supportStatusTab, setSupportStatusTab] = useState<SupportStatusTab>("fresh");
  const [supportFiles, setSupportFiles] = useState<Record<string, SupportPickedFile[]>>({});
  const [supportPickingId, setSupportPickingId] = useState<string | null>(null);
  const [selectedSupportTicketId, setSelectedSupportTicketId] = useState<string | null>(null);

  const visibleModules = useMemo(() => {
    const permissions = overview?.admin.permissions ?? [];
    return (overview?.modules ?? []).filter((module) => permissions.includes(module.permission) || overview?.admin.role_key === "super_admin");
  }, [overview]);

  const currentModule = (activeModule ?? visibleModules[0]?.key ?? "support") as ModuleKey;
  const currentModuleMeta = MODULE_META[currentModule] ?? MODULE_META.support;
  const currentModuleSearch = moduleSearch[currentModule] ?? "";

  useEffect(() => {
    const moduleParam = String(params.module || "").trim().toLowerCase();
    const ticketParam = String(params.ticket || "").trim();
    if (moduleParam === "support") setActiveModule("support");
    if (ticketParam) setSelectedSupportTicketId(ticketParam);
  }, [params.module, params.ticket]);

  function setCurrentModuleSearch(value: string) {
    setModuleSearch((prev) => ({ ...prev, [currentModule]: value }));
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
      case "admins":
        return (modules?.admins?.users?.length ?? 0) + (modules?.admins?.roles?.length ?? 0);
      default:
        return 0;
    }
  }

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
      let url = String(attachment?.public_url || "");
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
          subtitle="Review user tickets, answer marketplace reports, and keep open disputes in one role-bound workspace."
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
          <View style={{ flexDirection: isDesktop ? "row" : "column", gap: 12, alignItems: "flex-start" }}>
            <View style={{ width: isDesktop ? 430 : "100%", gap: 10 }}>
              {tickets.length ? tickets.map((ticket: any) => {
                const latest = latestSupportMessage(ticket);
                const status = String(ticket.status ?? "OPEN").toUpperCase();
                const selected = selectedTicket?.id === ticket.id;
                return (
                  <Pressable
                    key={ticket.id}
                    onPress={() => setSelectedSupportTicketId(ticket.id)}
                    style={{
                      borderRadius: 8,
                      padding: 12,
                      backgroundColor: selected ? "rgba(74,222,128,0.10)" : PANEL_ALT,
                      borderWidth: 1,
                      borderColor: selected ? "rgba(74,222,128,0.32)" : BORDER,
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
                        {latest?.attachments?.length ? <Ionicons name="document-attach-outline" size={14} color={FAINT} /> : null}
                      </View>
                    </View>
                  </Pressable>
                );
              }) : (
                <EmptyState title={allTickets.length ? "No matching support tickets" : "Support queue is clear"} subtitle={allTickets.length ? "Clear the search or try a subject, user, status, or order ID." : "No tickets require this view."} />
              )}
            </View>

            <View style={{ flex: 1, width: isDesktop ? undefined : "100%", minWidth: 0 }}>
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
                      <InfoLine label="DM slug" value={ticketDmSlug ? `@${ticketDmSlug}` : "n/a"} />
                      <InfoLine label="Order" value={selectedTicket.related_order_id ? shortId(selectedTicket.related_order_id) : "n/a"} />
                      <InfoLine label="Assigned" value={selectedTicket.assigned_admin ? personLabel(selectedTicket.assigned_admin) : "Unassigned"} />
                      <InfoLine label="Last message" value={formatDate(selectedTicket.last_message_at)} />
                    </View>

                    <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                      {ticketDmSlug ? (
                        <ActionButton icon="chatbubble-ellipses-outline" label="DM user" color={SUCCESS} onPress={() => openDmSlug(ticketDmSlug)} />
                      ) : null}
                      {selectedTicket.related_order_id ? (
                        <ActionButton icon="receipt-outline" label="Open order" color={WARNING} onPress={() => openOrder(selectedTicket.related_order_id)} />
                      ) : null}
                    </View>

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
                                <Pressable onPress={() => openDmSlug(message.message_slug)} hitSlop={8}>
                                  <Ionicons name="chatbubble-ellipses-outline" size={14} color={ACCENT} />
                                </Pressable>
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
                  icon="receipt-outline"
                  label="Open order"
                  color={WARNING}
                  onPress={() => openOrder(dispute.order_id)}
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
    ]));
    const listings = allListings.filter((listing: any) => matchesSearch(currentModuleSearch, [
      listing.id,
      listing.title,
      listing.category,
      listing.sub_category,
      listing.currency,
      listing.delivery_type,
      listing.is_active === false ? "disabled" : "live",
      personLabel(listing.seller),
    ]));
    const canModerateUsers = hasPermission("users.moderate");
    const canModerateListings = hasPermission("listings.moderate");
    const canBanUsers = hasPermission("users.delete");

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
                  icon="person-circle-outline"
                  label="View profile"
                  color={WARNING}
                  disabled={!canOpenSellerProfile(seller)}
                  onPress={() => openSellerProfile(seller)}
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
                  icon="open-outline"
                  label="Open listing"
                  color={WARNING}
                  onPress={() => openListing(listing.id)}
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
                  onPress={() => openOrder(order.id)}
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
          chains.length ? chains.map((chain: any) => (
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

  function renderAdmins() {
    const adminData = workspace?.modules.admins;
    const allAdminUsers = adminData?.users ?? [];
    const allRoles = adminData?.roles ?? [];
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
              ]}
            />
          </View>
        </SectionHeader>

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
