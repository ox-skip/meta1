import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ImageBackground,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import AppHeader from "@/components/common/AppHeader";
import {
  claimRewardTask,
  fetchRewardsHome,
  recordRewardPromotionEvent,
  watchRewardedAdForNoms,
  type RewardCategory,
  type RewardPromotion,
  type RewardTask,
  type RewardsHome,
} from "@/services/market/rewards";

const BG = "#080B0A";
const PANEL = "rgba(255,253,247,0.07)";
const PANEL_STRONG = "rgba(14,19,17,0.94)";
const BORDER = "rgba(255,253,247,0.12)";
const TEXT = "#FFFDF7";
const MUTED = "rgba(255,253,247,0.66)";
const TEAL = "#2DD4BF";
const GOLD = "#F4B75D";
const GREEN = "#4ADE80";
const RED = "#F87171";
const BLUE = "#60A5FA";

type TabKey = "earn" | "watch" | "market" | "social" | "onchain" | "redeem" | "history";

type TabDef = {
  key: TabKey;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
};

const TABS: TabDef[] = [
  { key: "earn", label: "Earn", icon: "sparkles-outline" },
  { key: "watch", label: "Watch", icon: "play-circle-outline" },
  { key: "market", label: "Market", icon: "storefront-outline" },
  { key: "social", label: "Social", icon: "people-outline" },
  { key: "onchain", label: "Stocks", icon: "trending-up-outline" },
  { key: "redeem", label: "Redeem", icon: "ticket-outline" },
  { key: "history", label: "History", icon: "time-outline" },
];

const CATEGORY_COPY: Record<RewardCategory, { label: string; color: string; icon: keyof typeof Ionicons.glyphMap }> = {
  watch: { label: "Watch", color: GOLD, icon: "play-circle-outline" },
  market: { label: "Market", color: TEAL, icon: "storefront-outline" },
  social: { label: "Social", color: BLUE, icon: "people-outline" },
  onchain: { label: "Stock", color: "#A78BFA", icon: "trending-up-outline" },
  custom: { label: "Bonus", color: "#FB7185", icon: "flash-outline" },
};

const DEFAULT_REDEMPTIONS = [
  {
    key: "listing_boost",
    title: "Listing Boost",
    subtitle: "Give one listing a stronger spotlight in buyer discovery.",
    cost_noms: 750,
    icon: "rocket-outline" as keyof typeof Ionicons.glyphMap,
    accent: TEAL,
  },
  {
    key: "sponsored_top_display",
    title: "Sponsored Top Display",
    subtitle: "Put your store in a premium rewards placement for shoppers to notice.",
    cost_noms: 2500,
    icon: "megaphone-outline" as keyof typeof Ionicons.glyphMap,
    accent: GOLD,
  },
  {
    key: "profile_glow",
    title: "Profile Glow",
    subtitle: "Add a premium look to your store profile when this reward opens.",
    cost_noms: 1200,
    icon: "diamond-outline" as keyof typeof Ionicons.glyphMap,
    accent: "#A78BFA",
  },
];

function formatNoms(value: number | null | undefined) {
  return `${Number(value ?? 0).toLocaleString()} noms`;
}

function shortDate(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function shortTime(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function taskIcon(task: RewardTask): keyof typeof Ionicons.glyphMap {
  const raw = String(task.icon || "");
  if (raw && raw in Ionicons.glyphMap) return raw as keyof typeof Ionicons.glyphMap;
  return CATEGORY_COPY[task.category]?.icon ?? "gift-outline";
}

function taskAccent(task: RewardTask) {
  return task.accent || CATEGORY_COPY[task.category]?.color || TEAL;
}

function statusLabel(task: RewardTask) {
  const availability = task.availability;
  if (!availability) return "Ready when eligible";
  if (availability.status === "available") return "Ready to claim";
  if (availability.status === "completed") return "Completed";
  if (availability.status === "review_pending") return "Pending review";
  if (availability.status === "cooldown") return availability.next_available_at ? `Next: ${shortTime(availability.next_available_at)}` : "Cooling down";
  if (availability.status === "capped") return "Limit reached";
  if (availability.status === "inactive") return "Inactive";
  return availability.reason || "Locked";
}

function actionLabel(task: RewardTask) {
  if (task.availability?.status === "completed") return "Earned";
  if (task.availability?.status === "review_pending") return "In review";
  if (task.availability?.available && task.trigger_type === "client_claim") return "Claim noms";
  if (task.trigger_type === "ad_reward") return "Watch";
  if (task.trigger_type === "admin_review") return "Submit proof";
  if (task.availability?.available) return "Claim noms";
  const custom = typeof task.ui?.primaryLabel === "string" ? task.ui.primaryLabel : null;
  if (custom) return custom;
  if (task.action_route) return "Open";
  return "Locked";
}

function taskDiagnostic(task: RewardTask) {
  const availability = task.availability;
  if (!availability) return "Checking this reward against your account.";
  if (availability.status === "available") {
    if (task.trigger_type === "ad_reward") return "Ready. Watch the full ad to earn this reward.";
    if (task.trigger_type === "admin_review") return "Ready. Submit proof and a reward reviewer will check it.";
    return "Requirement met. Tap Claim noms to add this reward.";
  }
  if (availability.status === "completed") return "Already added to your Noms balance.";
  if (availability.status === "review_pending") return "Submitted. A reward reviewer will check it.";
  if (availability.status === "cooldown") {
    return availability.next_available_at
      ? `You can earn this again ${shortTime(availability.next_available_at)}.`
      : "This reward is cooling down.";
  }
  if (availability.status === "capped") return availability.reason || "You reached the limit for this reward.";
  if (availability.status === "inactive") return "This reward is paused right now.";
  return availability.reason || "Finish the requirement to unlock this reward.";
}

function taskDiagnosticIcon(task: RewardTask): keyof typeof Ionicons.glyphMap {
  const status = task.availability?.status;
  if (status === "available") return "checkmark-circle-outline";
  if (status === "completed") return "ribbon-outline";
  if (status === "review_pending") return "hourglass-outline";
  if (status === "cooldown" || status === "capped") return "time-outline";
  return "information-circle-outline";
}

function taskDiagnosticColor(task: RewardTask) {
  const status = task.availability?.status;
  if (status === "available" || status === "completed") return GREEN;
  if (status === "review_pending" || status === "cooldown" || status === "capped") return GOLD;
  return MUTED;
}

function taskPrimaryEnabled(task: RewardTask) {
  const availability = task.availability;
  if (availability?.status === "completed" || availability?.status === "review_pending") return false;
  if (availability?.available) return true;
  return Boolean(task.action_route && availability?.status === "locked");
}

function StatPill({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
}) {
  return (
    <View
      style={{
        flex: 1,
        minWidth: 112,
        borderRadius: 18,
        padding: 14,
        backgroundColor: PANEL,
        borderWidth: 1,
        borderColor: BORDER,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Ionicons name={icon} size={16} color={color} />
        <Text numberOfLines={1} style={{ color: MUTED, fontSize: 12, fontWeight: "800" }}>
          {label}
        </Text>
      </View>
      <Text numberOfLines={1} adjustsFontSizeToFit style={{ marginTop: 8, color: TEXT, fontSize: 19, fontWeight: "900" }}>
        {value}
      </Text>
    </View>
  );
}

function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
}) {
  return (
    <View
      style={{
        borderRadius: 24,
        padding: 22,
        alignItems: "center",
        backgroundColor: "rgba(255,253,247,0.05)",
        borderWidth: 1,
        borderColor: BORDER,
      }}
    >
      <View
        style={{
          width: 54,
          height: 54,
          borderRadius: 18,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "rgba(45,212,191,0.14)",
          borderWidth: 1,
          borderColor: "rgba(45,212,191,0.34)",
        }}
      >
        <Ionicons name={icon} size={24} color={TEAL} />
      </View>
      <Text style={{ marginTop: 14, color: TEXT, fontSize: 16, fontWeight: "900", textAlign: "center" }}>{title}</Text>
      <Text style={{ marginTop: 6, color: MUTED, fontSize: 13, lineHeight: 19, textAlign: "center" }}>{subtitle}</Text>
    </View>
  );
}

function TaskCard({
  task,
  busy,
  onPress,
}: {
  task: RewardTask;
  busy: boolean;
  onPress: () => void;
}) {
  const accent = taskAccent(task);
  const category = CATEGORY_COPY[task.category] ?? CATEGORY_COPY.custom;
  const availability = task.availability;
  const target = Math.max(1, availability?.progress_target ?? 1);
  const current = Math.max(0, availability?.progress_current ?? 0);
  const pct = Math.max(0, Math.min(1, current / target));
  const completed = availability?.status === "completed";
  const pending = availability?.status === "review_pending";
  const disabled = busy || !taskPrimaryEnabled(task);
  const diagnostic = taskDiagnostic(task);
  const diagnosticColor = taskDiagnosticColor(task);

  return (
    <View
      style={{
        borderRadius: 22,
        padding: 16,
        backgroundColor: PANEL_STRONG,
        borderWidth: 1,
        borderColor: completed ? "rgba(74,222,128,0.22)" : BORDER,
        overflow: "hidden",
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: 17,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: `${accent}1F`,
            borderWidth: 1,
            borderColor: `${accent}42`,
          }}
        >
          <Ionicons name={taskIcon(task)} size={23} color={accent} />
        </View>

        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <View
              style={{
                borderRadius: 999,
                paddingHorizontal: 9,
                paddingVertical: 5,
                flexDirection: "row",
                alignItems: "center",
                gap: 5,
                backgroundColor: `${category.color}18`,
                borderWidth: 1,
                borderColor: `${category.color}34`,
              }}
            >
              <Ionicons name={category.icon} size={12} color={category.color} />
              <Text style={{ color: category.color, fontSize: 11, fontWeight: "900" }}>{category.label}</Text>
            </View>
            {pending ? (
              <View
                style={{
                  borderRadius: 999,
                  paddingHorizontal: 9,
                  paddingVertical: 5,
                  backgroundColor: "rgba(244,183,93,0.14)",
                  borderWidth: 1,
                  borderColor: "rgba(244,183,93,0.28)",
                }}
              >
                <Text style={{ color: GOLD, fontSize: 11, fontWeight: "900" }}>Review</Text>
              </View>
            ) : null}
          </View>

          <Text style={{ marginTop: 10, color: TEXT, fontSize: 16, fontWeight: "900", lineHeight: 21 }}>
            {task.title}
          </Text>
          {task.description ? (
            <Text style={{ marginTop: 5, color: MUTED, fontSize: 13, lineHeight: 19 }}>{task.description}</Text>
          ) : null}
        </View>
      </View>

      <View style={{ marginTop: 15, flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
            <Text numberOfLines={1} style={{ color: MUTED, fontSize: 12, fontWeight: "800" }}>
              {statusLabel(task)}
            </Text>
            <Text style={{ color: TEXT, fontSize: 12, fontWeight: "900" }}>
              {current}/{target}
            </Text>
          </View>
          <View
            style={{
              marginTop: 8,
              height: 7,
              borderRadius: 999,
              overflow: "hidden",
              backgroundColor: "rgba(255,253,247,0.08)",
            }}
          >
            <View style={{ width: `${pct * 100}%`, height: "100%", backgroundColor: completed ? GREEN : accent }} />
          </View>
          <View style={{ marginTop: 9, flexDirection: "row", alignItems: "flex-start", gap: 6 }}>
            <Ionicons name={taskDiagnosticIcon(task)} size={13} color={diagnosticColor} style={{ marginTop: 2 }} />
            <Text style={{ flex: 1, color: diagnosticColor, fontSize: 11.5, lineHeight: 16, fontWeight: "800" }}>
              {diagnostic}
            </Text>
          </View>
        </View>

        <View style={{ alignItems: "flex-end", gap: 8 }}>
          <Text style={{ color: GOLD, fontSize: 14, fontWeight: "900" }}>+{formatNoms(task.reward_noms)}</Text>
          <Pressable
            disabled={disabled}
            onPress={onPress}
            style={({ pressed }) => ({
              minWidth: 94,
              height: 38,
              borderRadius: 14,
              paddingHorizontal: 13,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: disabled ? "rgba(255,253,247,0.08)" : pressed ? `${accent}CC` : accent,
            })}
          >
            {busy ? (
              <ActivityIndicator color={BG} />
            ) : (
              <Text style={{ color: disabled ? MUTED : BG, fontSize: 12, fontWeight: "900" }}>{actionLabel(task)}</Text>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function PromotionHero({
  promotion,
  fallbackTitle,
  fallbackSubtitle,
  onPress,
}: {
  promotion: RewardPromotion | null;
  fallbackTitle: string;
  fallbackSubtitle: string;
  onPress: () => void;
}) {
  const title = promotion?.title || fallbackTitle;
  const subtitle = promotion?.subtitle || fallbackSubtitle;
  const sponsor = promotion?.sponsor_label || "Sponsored";

  const content = (
    <View style={{ minHeight: 168, justifyContent: "space-between", padding: 18 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <View
          style={{
            alignSelf: "flex-start",
            borderRadius: 999,
            paddingHorizontal: 10,
            paddingVertical: 6,
            backgroundColor: "rgba(8,11,10,0.54)",
            borderWidth: 1,
            borderColor: "rgba(255,253,247,0.22)",
          }}
        >
          <Text style={{ color: TEXT, fontSize: 11, fontWeight: "900" }}>{sponsor}</Text>
        </View>
        {promotion ? (
          <View
            style={{
              width: 38,
              height: 38,
              borderRadius: 14,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(244,183,93,0.18)",
              borderWidth: 1,
              borderColor: "rgba(244,183,93,0.34)",
            }}
          >
            <Ionicons name="megaphone-outline" size={18} color={GOLD} />
          </View>
        ) : null}
      </View>

      <View>
        <Text style={{ color: TEXT, fontSize: 24, fontWeight: "900", lineHeight: 29 }}>{title}</Text>
        <Text style={{ marginTop: 7, color: "rgba(255,253,247,0.78)", fontSize: 13, lineHeight: 19 }}>
          {subtitle}
        </Text>
        <Pressable
          onPress={onPress}
          style={({ pressed }) => ({
            marginTop: 13,
            alignSelf: "flex-start",
            minHeight: 40,
            borderRadius: 14,
            paddingHorizontal: 14,
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "row",
            gap: 7,
            backgroundColor: pressed ? "rgba(255,253,247,0.86)" : TEXT,
          })}
        >
          <Text style={{ color: BG, fontSize: 12, fontWeight: "900" }}>{promotion?.cta_label || "View placement"}</Text>
          <Ionicons name="arrow-forward" size={14} color={BG} />
        </Pressable>
      </View>
    </View>
  );

  return (
    <Pressable onPress={onPress} style={{ borderRadius: 28, overflow: "hidden", borderWidth: 1, borderColor: BORDER }}>
      {promotion?.media_url ? (
        <ImageBackground source={{ uri: promotion.media_url }} resizeMode="cover" style={{ minHeight: 168 }}>
          <LinearGradient colors={["rgba(8,11,10,0.36)", "rgba(8,11,10,0.86)"]} style={{ flex: 1 }}>
            {content}
          </LinearGradient>
        </ImageBackground>
      ) : (
        <LinearGradient colors={["#1D3B35", "#101714", "#2B1F12"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
          {content}
        </LinearGradient>
      )}
    </Pressable>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={{ marginBottom: 13 }}>
      <Text style={{ color: TEXT, fontSize: 18, fontWeight: "900" }}>{title}</Text>
      {subtitle ? <Text style={{ marginTop: 5, color: MUTED, fontSize: 13, lineHeight: 19 }}>{subtitle}</Text> : null}
    </View>
  );
}

function RedemptionShelf({ home }: { home: RewardsHome }) {
  const catalog = Array.isArray(home.config?.noms_economy?.redemption_catalog)
    ? home.config.noms_economy.redemption_catalog
    : DEFAULT_REDEMPTIONS;
  const balance = home.account.balance ?? 0;

  return (
    <View style={{ gap: 12 }}>
      <SectionTitle
        title="Redeem noms"
        subtitle="Use your noms for marketplace perks as new offers open."
      />
      {catalog.map((item: any) => {
        const cost = Number(item.cost_noms ?? item.cost ?? 0);
        const accent = item.accent || TEAL;
        const affordable = balance >= cost;
        const icon = item.icon && item.icon in Ionicons.glyphMap ? item.icon : "ticket-outline";
        return (
          <View
            key={String(item.key || item.title)}
            style={{
              borderRadius: 22,
              padding: 16,
              backgroundColor: PANEL_STRONG,
              borderWidth: 1,
              borderColor: BORDER,
              flexDirection: "row",
              gap: 13,
              alignItems: "center",
            }}
          >
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: 17,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: `${accent}18`,
                borderWidth: 1,
                borderColor: `${accent}36`,
              }}
            >
              <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={22} color={accent} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: TEXT, fontSize: 15, fontWeight: "900" }}>{String(item.title || "Reward")}</Text>
              <Text style={{ marginTop: 4, color: MUTED, fontSize: 12, lineHeight: 18 }}>
                {String(item.subtitle || item.description || "Marketplace perk.")}
              </Text>
            </View>
            <View style={{ alignItems: "flex-end", gap: 8 }}>
              <Text style={{ color: GOLD, fontSize: 12, fontWeight: "900" }}>{formatNoms(cost)}</Text>
              <View
                style={{
                  borderRadius: 13,
                  paddingHorizontal: 11,
                  paddingVertical: 9,
                  backgroundColor: affordable ? "rgba(45,212,191,0.14)" : "rgba(255,253,247,0.07)",
                  borderWidth: 1,
                  borderColor: affordable ? "rgba(45,212,191,0.32)" : BORDER,
                }}
              >
                <Text style={{ color: affordable ? TEAL : MUTED, fontSize: 12, fontWeight: "900" }}>
                  {affordable ? "Request" : "Save up"}
                </Text>
              </View>
            </View>
          </View>
        );
      })}
      {home.redemptions.length ? (
        <View style={{ marginTop: 4, gap: 8 }}>
          <Text style={{ color: MUTED, fontSize: 12, fontWeight: "900" }}>Recent redemption requests</Text>
          {home.redemptions.slice(0, 5).map((row: any) => (
            <View
              key={row.id}
              style={{
                borderRadius: 17,
                padding: 13,
                backgroundColor: "rgba(255,253,247,0.05)",
                borderWidth: 1,
                borderColor: BORDER,
                flexDirection: "row",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: TEXT, fontSize: 13, fontWeight: "900" }}>{row.title || row.redemption_key}</Text>
                <Text style={{ marginTop: 3, color: MUTED, fontSize: 12 }}>{shortTime(row.created_at)}</Text>
              </View>
              <Text style={{ color: row.status === "fulfilled" ? GREEN : GOLD, fontSize: 12, fontWeight: "900" }}>
                {String(row.status || "pending").replace(/_/g, " ")}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function LedgerList({ home }: { home: RewardsHome }) {
  if (!home.ledger.length) {
    return <EmptyState icon="receipt-outline" title="No Noms history yet" subtitle="Complete tasks and your ledger will appear here." />;
  }

  return (
    <View style={{ gap: 10 }}>
      <SectionTitle title="Noms history" subtitle="Every nom you earn or spend appears here." />
      {home.ledger.map((entry) => {
        const positive = entry.delta >= 0;
        return (
          <View
            key={entry.id}
            style={{
              borderRadius: 18,
              padding: 14,
              backgroundColor: PANEL_STRONG,
              borderWidth: 1,
              borderColor: BORDER,
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
            }}
          >
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 15,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: positive ? "rgba(74,222,128,0.12)" : "rgba(248,113,113,0.12)",
              }}
            >
              <Ionicons name={positive ? "add-circle-outline" : "remove-circle-outline"} size={20} color={positive ? GREEN : RED} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ color: TEXT, fontSize: 13, fontWeight: "900" }}>
                {entry.reason || entry.source}
              </Text>
              <Text style={{ marginTop: 3, color: MUTED, fontSize: 12 }}>
                {shortTime(entry.created_at)} - balance {formatNoms(entry.balance_after)}
              </Text>
            </View>
            <Text style={{ color: positive ? GREEN : RED, fontSize: 14, fontWeight: "900" }}>
              {positive ? "+" : ""}
              {Number(entry.delta).toLocaleString()}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export default function RewardsScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isWide = width >= 920;
  const [home, setHome] = useState<RewardsHome | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("earn");
  const [error, setError] = useState<string | null>(null);
  const impressions = useRef(new Set<string>());

  const load = useCallback(async (mode: "initial" | "refresh" = "initial") => {
    if (mode === "initial") setLoading(true);
    if (mode === "refresh") setRefreshing(true);
    setError(null);
    try {
      const next = await fetchRewardsHome();
      setHome(next);
    } catch (e) {
      const message = String((e as any)?.message || e || "Unable to load rewards");
      setError(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!home?.promotions?.length) return;
    for (const promo of home.promotions.slice(0, 4)) {
      if (impressions.current.has(promo.id)) continue;
      impressions.current.add(promo.id);
      void recordRewardPromotionEvent({
        promotion_id: promo.id,
        placement_key: promo.placement_key,
        event_type: "impression",
        metadata: { surface: "rewards", tab },
      });
    }
  }, [home?.generated_at, home?.promotions, tab]);

  const topPromotion = useMemo(() => {
    if (!home) return null;
    return home.promotions.find((promo) => promo.placement_key === "rewards_top") ?? home.promotions[0] ?? null;
  }, [home]);

  const groupedCounts = useMemo(() => {
    const counts: Record<RewardCategory, number> = { watch: 0, market: 0, social: 0, onchain: 0, custom: 0 };
    for (const task of home?.tasks ?? []) counts[task.category] = (counts[task.category] ?? 0) + 1;
    return counts;
  }, [home?.tasks]);

  const visibleTasks = useMemo(() => {
    const tasks = home?.tasks ?? [];
    if (tab === "earn") return tasks;
    if (tab === "redeem" || tab === "history") return [];
    const category = tab === "onchain" ? "onchain" : tab;
    return tasks.filter((task) => task.category === category);
  }, [home?.tasks, tab]);

  const redemptionCount = Array.isArray(home?.config?.noms_economy?.redemption_catalog)
    ? home?.config?.noms_economy?.redemption_catalog.length
    : DEFAULT_REDEMPTIONS.length;

  const uiConfig = home?.config?.rewards_ui ?? {};
  const heroTitle = String(uiConfig.hero_title || "Noms Rewards");
  const heroSubtitle = String(uiConfig.hero_subtitle || "Earn noms for videos, store activity, shopping, social actions, and stock milestones.");

  async function handlePromotionPress(promotion: RewardPromotion | null) {
    if (!promotion) {
      Alert.alert("Featured stores", "Sponsored stores and special offers can appear here.");
      return;
    }
    await recordRewardPromotionEvent({
      promotion_id: promotion.id,
      placement_key: promotion.placement_key,
      event_type: "click",
      metadata: { surface: "rewards", tab },
    });
    if (promotion.cta_route) {
      router.push(promotion.cta_route as any);
      return;
    }
    if (promotion.listing_id) {
      router.push(`/market/listing/${promotion.listing_id}` as any);
      return;
    }
    if (promotion.store_id) {
      router.push(`/market/store/${promotion.store_id}` as any);
      return;
    }
  }

  async function handleTask(task: RewardTask) {
    if (busyKey) return;
    setBusyKey(task.id);
    try {
      if (task.availability?.status === "completed") {
        Alert.alert("Already earned", "This reward has already been added to your Noms balance.");
        return;
      }

      if (task.availability?.status === "review_pending") {
        Alert.alert("Review in progress", taskDiagnostic(task));
        return;
      }

      if (task.trigger_type === "ad_reward") {
        if (!task.availability?.available) {
          Alert.alert("Reward not ready", taskDiagnostic(task));
          return;
        }
        const result = await watchRewardedAdForNoms(task.task_key);
        if (result.result.earned) {
          Alert.alert("Ad completed", "If the reward was granted, your Noms balance will update after refresh.");
        } else {
          Alert.alert("Ad not completed", result.result.error || "Watch the full rewarded video to earn noms.");
        }
        await load("refresh");
        return;
      }

      if (task.availability?.available) {
        const claim = await claimRewardTask({ task_id: task.id });
        if (claim.status === "pending_review") {
          Alert.alert("Submitted", "Your proof is in review. You will see the reward here once it is approved.");
        } else {
          Alert.alert("Noms added", `You earned ${formatNoms(task.reward_noms)}.`);
        }
        await load("refresh");
        return;
      }

      if (task.action_route) {
        router.push(task.action_route as any);
        return;
      }

      Alert.alert("Not ready yet", taskDiagnostic(task));
    } catch (e) {
      Alert.alert("Reward action failed", String((e as any)?.message || e || "Please try again."));
    } finally {
      setBusyKey(null);
    }
  }

  const renderMainContent = () => {
    if (!home && loading) {
      return (
        <View style={{ padding: 22, alignItems: "center" }}>
          <ActivityIndicator color={TEAL} />
          <Text style={{ marginTop: 12, color: MUTED, fontSize: 13 }}>Loading rewards...</Text>
        </View>
      );
    }

    if (!home) {
      return (
        <EmptyState
          icon="warning-outline"
          title="Rewards are not available"
          subtitle={error || "The rewards service could not load. Pull to refresh or try again later."}
        />
      );
    }

    if (tab === "redeem") return <RedemptionShelf home={home} />;
    if (tab === "history") return <LedgerList home={home} />;

    return (
      <View style={{ gap: 12 }}>
        <SectionTitle
          title={tab === "earn" ? "Earn noms" : `${TABS.find((item) => item.key === tab)?.label || "Reward"} rewards`}
          subtitle="Complete eligible actions, then claim your noms."
        />
        {visibleTasks.length ? (
          visibleTasks.map((task) => (
            <TaskCard key={task.id} task={task} busy={busyKey === task.id} onPress={() => handleTask(task)} />
          ))
        ) : (
          <EmptyState
            icon="gift-outline"
            title="More rewards coming"
            subtitle="New earning chances will appear here."
          />
        )}
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <AppHeader
        title="Rewards"
        subtitle="Earn Noms across the marketplace"
        fallbackBackHref="/market/(tabs)"
        rightSlot={
          <Pressable
            onPress={() => load("refresh")}
            disabled={refreshing}
            hitSlop={12}
            style={{
              width: 42,
              height: 42,
              borderRadius: 16,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(45,212,191,0.15)",
              borderWidth: 1,
              borderColor: "rgba(45,212,191,0.38)",
            }}
          >
            {refreshing ? <ActivityIndicator color={TEXT} /> : <Ionicons name="refresh" size={20} color={TEXT} />}
          </Pressable>
        }
      />

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load("refresh")} tintColor={TEAL} />}
        contentContainerStyle={{ padding: 14, paddingBottom: insets.bottom + 110, gap: 16 }}
      >
        <LinearGradient
          colors={["#133C36", "#101714", "#2B1D0F"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            borderRadius: 30,
            padding: 18,
            borderWidth: 1,
            borderColor: "rgba(244,183,93,0.24)",
            overflow: "hidden",
          }}
        >
          <View style={{ flexDirection: isWide ? "row" : "column", gap: 18 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View
                style={{
                  alignSelf: "flex-start",
                  borderRadius: 999,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  backgroundColor: "rgba(255,253,247,0.09)",
                  borderWidth: 1,
                  borderColor: "rgba(255,253,247,0.16)",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Ionicons name="shield-outline" size={13} color={TEAL} />
                <Text style={{ color: TEXT, fontSize: 11, fontWeight: "900" }}>Marketplace loyalty points</Text>
              </View>
              <Text style={{ marginTop: 16, color: TEXT, fontSize: 31, lineHeight: 36, fontWeight: "900" }}>{heroTitle}</Text>
              <Text style={{ marginTop: 8, maxWidth: 560, color: "rgba(255,253,247,0.74)", fontSize: 14, lineHeight: 21 }}>
                {heroSubtitle}
              </Text>
            </View>

            <View
              style={{
                minWidth: isWide ? 320 : undefined,
                borderRadius: 24,
                padding: 16,
                backgroundColor: "rgba(8,11,10,0.44)",
                borderWidth: 1,
                borderColor: "rgba(255,253,247,0.14)",
              }}
            >
              <Text style={{ color: MUTED, fontSize: 12, fontWeight: "900" }}>Current balance</Text>
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                style={{ marginTop: 6, color: GOLD, fontSize: 35, fontWeight: "900" }}
              >
                {formatNoms(home?.account.balance)}
              </Text>
              <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                <StatPill label="Earned" value={formatNoms(home?.account.lifetime_earned)} icon="arrow-up-circle-outline" color={GREEN} />
                <StatPill label="Spent" value={formatNoms(home?.account.lifetime_spent)} icon="arrow-down-circle-outline" color={RED} />
                <StatPill label="Streak" value={`${home?.account.daily_streak ?? 0} days`} icon="flame-outline" color={GOLD} />
                <StatPill label="Tier" value={String(home?.account.tier_key || "starter")} icon="ribbon-outline" color={TEAL} />
              </View>
            </View>
          </View>
        </LinearGradient>

        <PromotionHero
          promotion={topPromotion}
          fallbackTitle={String(uiConfig.empty_promotion_title || "Promote a store here")}
          fallbackSubtitle={String(
            uiConfig.empty_promotion_subtitle || "Featured stores and special offers can appear here.",
          )}
          onPress={() => handlePromotionPress(topPromotion)}
        />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingRight: 4 }}>
          {TABS.map((item) => {
            const active = tab === item.key;
            const count =
              item.key === "earn"
                ? home?.tasks.length ?? 0
                : item.key === "redeem"
                  ? redemptionCount
                  : item.key === "history"
                    ? home?.ledger.length ?? 0
                    : groupedCounts[(item.key === "onchain" ? "onchain" : item.key) as RewardCategory] ?? 0;
            return (
              <Pressable
                key={item.key}
                onPress={() => setTab(item.key)}
                style={{
                  minHeight: 44,
                  borderRadius: 16,
                  paddingHorizontal: 13,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  backgroundColor: active ? "rgba(45,212,191,0.17)" : PANEL,
                  borderWidth: 1,
                  borderColor: active ? "rgba(45,212,191,0.42)" : BORDER,
                }}
              >
                <Ionicons name={item.icon} size={16} color={active ? TEAL : MUTED} />
                <Text style={{ color: active ? TEXT : MUTED, fontSize: 13, fontWeight: "900" }}>{item.label}</Text>
                <View
                  style={{
                    minWidth: 22,
                    height: 22,
                    borderRadius: 11,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: active ? "rgba(45,212,191,0.22)" : "rgba(255,253,247,0.08)",
                  }}
                >
                  <Text style={{ color: active ? TEAL : MUTED, fontSize: 11, fontWeight: "900" }}>{count}</Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>

        {renderMainContent()}

        {home ? (
          <View
            style={{
              borderRadius: 24,
              padding: 16,
              backgroundColor: "rgba(45,212,191,0.08)",
              borderWidth: 1,
              borderColor: "rgba(45,212,191,0.18)",
              flexDirection: isWide ? "row" : "column",
              gap: 12,
              alignItems: isWide ? "center" : "flex-start",
              justifyContent: "space-between",
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: TEXT, fontSize: 15, fontWeight: "900" }}>Your rewards</Text>
              <Text style={{ marginTop: 5, color: MUTED, fontSize: 12, lineHeight: 18 }}>
                Noms are BestCity loyalty points. Earn them for useful marketplace actions and spend them on perks as new offers open.
              </Text>
            </View>
            <Text style={{ color: MUTED, fontSize: 12, fontWeight: "800" }}>Updated {shortDate(home.generated_at)}</Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
