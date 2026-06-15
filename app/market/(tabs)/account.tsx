import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { InAppTutorial, TutorialTarget } from "@/components/onboarding/InAppTutorial";
import MarketMenuModal from "@/components/market/MarketMenuModal";
import { useUnifiedWallet } from "@/components/market/wallet/useUnifiedWallet";
import { tutorialFlows } from "@/services/onboarding/definitions";
import { recordAuthSessionNotification } from "@/services/market/notifications";
import { supabase } from "@/services/supabase";
import { friendlyMarketError } from "@/utils/marketUx";

type SellerProfile = {
  user_id: string;
  market_username: string | null;
  display_name: string | null;
  business_name: string | null;
  is_verified: boolean;
  logo_path: string | null;
  banner_path: string | null;
  payout_tier: "standard" | "fast";
  active?: boolean;
};

type StatState = {
  activeListings: number;
  allListings: number;
  orders: number;
  completedOrders: number;
};

type AdminAccessState = {
  isAdmin: boolean;
  roleKey: string | null;
};

const BG0 = "#050706";
const BG1 = "#0B1210";
const PANEL = "rgba(247,250,252,0.065)";
const PANEL_ALT = "rgba(247,250,252,0.045)";
const BORDER = "rgba(247,250,252,0.12)";
const TEXT = "#FFFDF7";
const MUTED = "rgba(255,253,247,0.68)";
const SUCCESS = "#4ADE80";
const WARNING = "#F59E0B";
const DANGER = "#F87171";
const TEAL = "#2DD4BF";
const BLUE = "#38BDF8";
const ROSE = "#FB7185";

function publicUrl(bucket: string, path?: string | null) {
  if (!path) return null;
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

function HeaderButton({
  icon,
  label,
  accent,
  loading,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  accent: string;
  loading?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        minWidth: 126,
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingVertical: 11,
        backgroundColor: `${accent}18`,
        borderWidth: 1,
        borderColor: `${accent}2E`,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
      }}
    >
      {loading ? <ActivityIndicator color={accent} /> : <Ionicons name={icon} size={16} color={accent} />}
      <Text style={{ color: accent, fontWeight: "900", fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <View
      style={{
        flex: 1,
        minWidth: 90,
        borderRadius: 12,
        padding: 12,
        backgroundColor: PANEL_ALT,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.06)",
      }}
    >
      <Text style={{ color: TEXT, fontWeight: "900", fontSize: 20 }}>{value}</Text>
      <Text style={{ marginTop: 4, color: MUTED, fontSize: 12 }}>{label}</Text>
    </View>
  );
}

function SectionShell({
  title,
  subtitle,
  accent = TEAL,
  children,
}: {
  title: string;
  subtitle: string;
  accent?: string;
  children: React.ReactNode;
}) {
  return (
    <View
      style={{
        borderRadius: 10,
        padding: 16,
        backgroundColor: "rgba(247,250,252,0.045)",
        borderWidth: 1,
        borderColor: BORDER,
        borderLeftWidth: 4,
        borderLeftColor: `${accent}70`,
        shadowColor: "#000",
        shadowOpacity: 0.08,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 9 },
        elevation: 2,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
        <View style={{ width: 10, height: 10, borderRadius: 999, backgroundColor: accent }} />
        <Text style={{ color: TEXT, fontWeight: "900", fontSize: 18 }}>{title}</Text>
      </View>
      <Text style={{ marginTop: 7, color: MUTED, fontSize: 13, lineHeight: 20 }}>{subtitle}</Text>
      <View style={{ marginTop: 16 }}>{children}</View>
    </View>
  );
}

function ReadinessRow({
  icon,
  title,
  subtitle,
  done,
  optional,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  done: boolean;
  optional?: boolean;
}) {
  const tone = done ? SUCCESS : optional ? WARNING : MUTED;
  const label = done ? "Ready" : optional ? "Optional" : "Needed";
  const toneBg = done ? "rgba(74,222,128,0.14)" : optional ? "rgba(245,158,11,0.14)" : "rgba(255,255,255,0.08)";
  const toneBorder = done ? "rgba(74,222,128,0.24)" : optional ? "rgba(245,158,11,0.24)" : "rgba(255,255,255,0.08)";

  return (
    <View
      style={{
        borderRadius: 12,
        padding: 12,
        backgroundColor: PANEL_ALT,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.06)",
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
      }}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: done ? "rgba(74,222,128,0.14)" : optional ? "rgba(245,158,11,0.14)" : "rgba(255,255,255,0.08)",
          borderWidth: 1,
          borderColor: done ? "rgba(74,222,128,0.3)" : optional ? "rgba(245,158,11,0.3)" : "rgba(255,255,255,0.08)",
        }}
      >
        <Ionicons name={icon} size={18} color={done ? SUCCESS : optional ? WARNING : "#FDE68A"} />
      </View>

      <View style={{ flex: 1 }}>
        <Text style={{ color: TEXT, fontWeight: "800", fontSize: 14 }}>{title}</Text>
        <Text style={{ marginTop: 4, color: MUTED, fontSize: 12, lineHeight: 18 }}>{subtitle}</Text>
      </View>

      <View
        style={{
          borderRadius: 999,
          paddingHorizontal: 10,
          paddingVertical: 6,
          backgroundColor: toneBg,
          borderWidth: 1,
          borderColor: toneBorder,
        }}
      >
        <Text style={{ color: tone, fontWeight: "900", fontSize: 11 }}>{label}</Text>
      </View>
    </View>
  );
}

function AccountTile({
  title,
  subtitle,
  icon,
  accent,
  onPress,
  badge,
}: {
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  accent: string;
  onPress: () => void;
  badge?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexGrow: 1,
        flexBasis: 240,
        minWidth: 214,
        minHeight: 78,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: pressed ? `${accent}55` : "rgba(255,255,255,0.10)",
        borderLeftWidth: 4,
        borderLeftColor: `${accent}88`,
        backgroundColor: pressed ? `${accent}18` : "rgba(255,255,255,0.04)",
        transform: [{ translateY: pressed ? 1 : 0 }],
      })}
    >
      <View style={{ flex: 1, padding: 12, flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: `${accent}18`,
            borderWidth: 1,
            borderColor: `${accent}38`,
          }}
        >
          <Ionicons name={icon} size={18} color={accent} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ color: TEXT, fontWeight: "900", fontSize: 14, flexShrink: 1 }} numberOfLines={1}>{title}</Text>
            {badge ? (
              <View style={{ borderRadius: 999, paddingHorizontal: 7, paddingVertical: 4, backgroundColor: `${accent}18`, borderWidth: 1, borderColor: `${accent}35` }}>
                <Text style={{ color: accent, fontWeight: "900", fontSize: 9 }}>{badge}</Text>
              </View>
            ) : null}
          </View>
          <Text style={{ marginTop: 4, color: MUTED, fontSize: 11, lineHeight: 16 }} numberOfLines={2}>{subtitle}</Text>
        </View>
        <Ionicons name="arrow-forward" size={16} color={accent} />
      </View>
    </Pressable>
  );
}

function PulseCard({
  label,
  value,
  detail,
  icon,
  accent,
}: {
  label: string;
  value: string;
  detail: string;
  icon: keyof typeof Ionicons.glyphMap;
  accent: string;
}) {
  return (
    <View
      style={{
        flex: 1,
        minWidth: 168,
        borderRadius: 12,
        padding: 12,
        backgroundColor: "rgba(255,255,255,0.045)",
        borderWidth: 1,
        borderColor: `${accent}30`,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
        <View style={{ width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: `${accent}18` }}>
          <Ionicons name={icon} size={16} color={accent} />
        </View>
        <Text style={{ color: MUTED, fontWeight: "900", fontSize: 11, textTransform: "uppercase", flex: 1 }} numberOfLines={1}>{label}</Text>
      </View>
      <Text style={{ marginTop: 10, color: TEXT, fontWeight: "900", fontSize: 18 }} numberOfLines={1}>{value}</Text>
      <Text style={{ marginTop: 5, color: MUTED, fontSize: 12, lineHeight: 17 }} numberOfLines={2}>{detail}</Text>
    </View>
  );
}

function HealthDial({
  score,
  total,
  accent,
}: {
  score: number;
  total: number;
  accent: string;
}) {
  const pct = Math.max(0, Math.min(1, total > 0 ? score / total : 0));
  return (
    <View
      style={{
        width: 112,
        height: 112,
        borderRadius: 56,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: `${accent}12`,
        borderWidth: 8,
        borderColor: pct >= 0.75 ? `${SUCCESS}88` : pct >= 0.5 ? `${WARNING}88` : `${ROSE}88`,
      }}
    >
      <Text style={{ color: TEXT, fontWeight: "900", fontSize: 26 }}>{score}/{total}</Text>
      <Text style={{ marginTop: 2, color: MUTED, fontWeight: "900", fontSize: 10, textTransform: "uppercase" }}>ready</Text>
    </View>
  );
}

function InlineNavButton({
  label,
  icon,
  accent,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  accent: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 42,
        borderRadius: 12,
        paddingHorizontal: 12,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
        backgroundColor: pressed ? `${accent}24` : `${accent}16`,
        borderWidth: 1,
        borderColor: `${accent}35`,
      })}
    >
      <Ionicons name={icon} size={15} color={accent} />
      <Text style={{ color: accent, fontWeight: "900", fontSize: 12 }}>{label}</Text>
    </Pressable>
  );
}

export default function MarketAccountTab() {
  const wallet = useUnifiedWallet();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<SellerProfile | null>(null);
  const [stats, setStats] = useState<StatState>({ activeListings: 0, allListings: 0, orders: 0, completedOrders: 0 });
  const [adminAccess, setAdminAccess] = useState<AdminAccessState>({ isAdmin: false, roleKey: null });
  const [menuOpen, setMenuOpen] = useState(false);

  const logo = publicUrl("market-sellers", profile?.logo_path);
  const banner = publicUrl("market-sellers", profile?.banner_path);
  const handle = profile?.market_username ? `@${profile.market_username}` : "@new-seller";
  const storeName = profile?.business_name || profile?.display_name || "Your Store";
  const verified = Boolean(profile?.is_verified);
  const isDesktop = width >= 1080;

  const launchReady = useMemo(() => {
    return {
      profile: Boolean(profile),
      wallet: Boolean(wallet.savedAddress || wallet.connectedAddress),
      listings: Number(stats.allListings) > 0,
      verification: verified,
    };
  }, [profile, stats.allListings, verified, wallet.connectedAddress, wallet.savedAddress]);
  const accountHealthScore = [launchReady.profile, launchReady.wallet, launchReady.listings, launchReady.verification].filter(Boolean).length;
  const walletLabel = wallet.savedAddress || wallet.connectedAddress ? "Connected" : "Not connected";
  const navTiles = [
    {
      title: "Sell",
      subtitle: "Create a product or service listing.",
      icon: "add-circle-outline" as const,
      accent: TEAL,
      route: "/market/(tabs)/sell",
      badge: "Core",
    },
    {
      title: "My Listings",
      subtitle: "Manage inventory, pricing, and visibility.",
      icon: "albums-outline" as const,
      accent: WARNING,
      route: "/market/listings?mine=1",
    },
    {
      title: "Orders",
      subtitle: "Buying and selling history in one place.",
      icon: "receipt-outline" as const,
      accent: BLUE,
      route: "/market/(tabs)/orders",
    },
    {
      title: "Messages",
      subtitle: "Open buyer and seller conversations.",
      icon: "chatbubble-ellipses-outline" as const,
      accent: ROSE,
      route: "/market/(tabs)/messages",
    },
    {
      title: "Wallet",
      subtitle: "Balances, payout readiness, and addresses.",
      icon: "wallet-outline" as const,
      accent: SUCCESS,
      route: "/market/wallet",
    },
    {
      title: "Rewards",
      subtitle: "Noms tasks, perks, and referral invites.",
      icon: "gift-outline" as const,
      accent: WARNING,
      route: "/market/(tabs)/rewards",
    },
    {
      title: "Stock",
      subtitle: "Digital stock identity and portfolio.",
      icon: "trending-up-outline" as const,
      accent: TEAL,
      route: "/market/stock",
    },
    {
      title: "Support",
      subtitle: "Cases, proof, marketplace help.",
      icon: "help-buoy-outline" as const,
      accent: ROSE,
      route: "/market/support",
    },
  ];

  function renderCommandStrip() {
    const primary = navTiles.slice(0, isDesktop ? 6 : 5);
    const items = primary.map((tile) => (
      <Pressable
        key={`strip-${tile.route}`}
        onPress={() => router.push(tile.route as any)}
        style={({ pressed }) => ({
          minWidth: isDesktop ? 184 : 168,
          minHeight: 54,
          borderRadius: 10,
          paddingHorizontal: 12,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          backgroundColor: pressed ? `${tile.accent}20` : "rgba(255,255,255,0.045)",
          borderWidth: 1,
          borderColor: `${tile.accent}34`,
        })}
      >
        <Ionicons name={tile.icon} size={18} color={tile.accent} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: TEXT, fontWeight: "900", fontSize: 12 }}>{tile.title}</Text>
          <Text numberOfLines={1} style={{ marginTop: 2, color: MUTED, fontSize: 10, fontWeight: "800" }}>{tile.subtitle}</Text>
        </View>
      </Pressable>
    ));

    if (isDesktop) {
      return <View style={{ marginTop: 18, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>{items}</View>;
    }

    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginTop: 18, marginHorizontal: -16 }}
        contentContainerStyle={{
          paddingHorizontal: 16,
          gap: 10,
          flexDirection: "row",
          flexWrap: "nowrap",
        }}
      >
        {items}
      </ScrollView>
    );
  }

  async function load() {
    setError(null);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user) {
        setProfile(null);
        setStats({ activeListings: 0, allListings: 0, orders: 0, completedOrders: 0 });
        setAdminAccess({ isAdmin: false, roleKey: null });
        return;
      }

      const [profileRes, activeListingsRes, allListingsRes, ordersRes, completedOrdersRes, adminRes] = await Promise.all([
        supabase
          .from("market_seller_profiles")
          .select("user_id,market_username,display_name,business_name,is_verified,logo_path,banner_path,payout_tier,active")
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase.from("market_listings").select("id", { count: "exact", head: true }).eq("seller_id", user.id).eq("is_active", true),
        supabase.from("market_listings").select("id", { count: "exact", head: true }).eq("seller_id", user.id),
        supabase.from("market_orders").select("id", { count: "exact", head: true }).or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`),
        supabase.from("market_orders").select("id", { count: "exact", head: true }).eq("seller_id", user.id).in("status", ["DELIVERED", "RELEASED"]),
        supabase.from("market_admin_users").select("role_key,is_active").eq("user_id", user.id).eq("is_active", true).maybeSingle(),
      ]);

      setProfile((profileRes.data as SellerProfile | null) ?? null);
      setStats({
        activeListings: Number(activeListingsRes.count ?? 0),
        allListings: Number(allListingsRes.count ?? 0),
        orders: Number(ordersRes.count ?? 0),
        completedOrders: Number(completedOrdersRes.count ?? 0),
      });
      setAdminAccess({
        isAdmin: Boolean(adminRes.data?.is_active),
        roleKey: adminRes.data?.role_key ? String(adminRes.data.role_key) : null,
      });
    } catch (e: any) {
      setError(friendlyMarketError(e, "Unable to load account."));
      setAdminAccess({ isAdmin: false, roleKey: null });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onRefresh() {
    setRefreshing(true);
    await Promise.allSettled([load(), wallet.refreshAll()]);
    setRefreshing(false);
  }

  async function onSignOut() {
    await recordAuthSessionNotification("signed_out").catch(() => undefined);
    await supabase.auth.signOut().catch(() => undefined);
    router.replace("/(auth)/login" as any);
  }

  const header = (
    <View
      style={{
        flexDirection: isDesktop ? "row" : "column",
        alignItems: isDesktop ? "center" : "flex-start",
        justifyContent: "space-between",
        gap: 14,
      }}
    >
      <View style={{ flex: 1 }}>
        <View style={{ alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: "rgba(45,212,191,0.12)", borderWidth: 1, borderColor: "rgba(94,234,212,0.24)" }}>
          <Text style={{ color: TEAL, fontSize: 11, fontWeight: "900", textTransform: "uppercase" }}>Account</Text>
        </View>
        <Text style={{ marginTop: 10, color: TEXT, fontSize: isDesktop ? 28 : 24, fontWeight: "900" }}>Market command center</Text>
        <Text style={{ marginTop: 6, color: MUTED, fontSize: 13, lineHeight: 20 }}>
          Store identity, selling tools, rewards, wallet, support, and growth shortcuts.
        </Text>
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <HeaderButton
          icon="grid-outline"
          label="Menu"
          accent={SUCCESS}
          onPress={() => setMenuOpen(true)}
        />
        {adminAccess.isAdmin ? (
          <HeaderButton
            icon="shield-checkmark-outline"
            label="Admin"
            accent="#FBBF24"
            onPress={() => router.push("/market/admin" as any)}
          />
        ) : null}
        <HeaderButton icon="refresh" label={refreshing ? "Syncing" : "Refresh"} accent={WARNING} loading={refreshing} onPress={onRefresh} />
        <HeaderButton icon="log-out-outline" label="Sign out" accent={DANGER} onPress={onSignOut} />
      </View>
    </View>
  );

  if (loading) {
    return (
      <LinearGradient colors={[BG1, "#07100C", BG0]} start={{ x: 0.1, y: 0 }} end={{ x: 0.92, y: 1 }} style={{ flex: 1 }}>
        <View style={{ paddingTop: insets.top + 18, paddingHorizontal: 16 }}>
          <View style={{ maxWidth: 1280, width: "100%", alignSelf: "center" }}>
            {header}
            <View style={{ marginTop: 22, borderRadius: 14, padding: 28, alignItems: "center", backgroundColor: PANEL, borderWidth: 1, borderColor: BORDER }}>
              <ActivityIndicator color={WARNING} />
              <Text style={{ marginTop: 14, color: TEXT, fontWeight: "900", fontSize: 18 }}>Loading account</Text>
              <Text style={{ marginTop: 6, color: MUTED, fontSize: 13, textAlign: "center", lineHeight: 20 }}>
                Fetching your store profile and activity.
              </Text>
            </View>
          </View>
        </View>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient colors={[BG1, "#07100C", BG0]} start={{ x: 0.1, y: 0 }} end={{ x: 0.92, y: 1 }} style={{ flex: 1 }}>
      <InAppTutorial enabled={!loading} flow={tutorialFlows.marketAccount} />
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 18,
          paddingHorizontal: 16,
          paddingBottom: 172,
        }}
      >
        <View style={{ maxWidth: 1280, width: "100%", alignSelf: "center" }}>
          <TutorialTarget id="market.account.header">{header}</TutorialTarget>
          {renderCommandStrip()}

          {!!error ? (
            <View
              style={{
                marginTop: 18,
                borderRadius: 14,
                padding: 16,
                backgroundColor: "rgba(248,113,113,0.12)",
                borderWidth: 1,
                borderColor: "rgba(248,113,113,0.22)",
                flexDirection: "row",
                alignItems: "flex-start",
                gap: 12,
              }}
            >
              <View
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 14,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "rgba(248,113,113,0.16)",
                }}
              >
                <Ionicons name="alert-circle-outline" size={20} color={DANGER} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: "#FECACA", fontWeight: "900", fontSize: 14 }}>Data sync warning</Text>
                <Text style={{ marginTop: 5, color: "#FECACA", fontSize: 12, lineHeight: 18 }}>{error}</Text>
              </View>
            </View>
          ) : null}

          {!profile ? (
            <View
              style={{
                marginTop: 20,
                borderRadius: 16,
                overflow: "hidden",
                borderWidth: 1,
                borderColor: BORDER,
                backgroundColor: "rgba(247,250,252,0.06)",
              }}
            >
              <LinearGradient
                colors={["rgba(45,212,191,0.16)", "rgba(56,189,248,0.08)", "rgba(0,0,0,0)"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
              />

              <View style={{ padding: 22 }}>
                <View
                  style={{
                    width: 72,
                    height: 72,
                    borderRadius: 16,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: "rgba(45,212,191,0.14)",
                    borderWidth: 1,
                    borderColor: "rgba(94,234,212,0.26)",
                  }}
                >
                  <Ionicons name="storefront-outline" size={30} color={TEAL} />
                </View>

                <Text style={{ marginTop: 18, color: TEXT, fontWeight: "900", fontSize: 26 }}>
                  Build your market account
                </Text>
                <Text style={{ marginTop: 8, color: MUTED, fontSize: 14, lineHeight: 22 }}>
                  Start with a public store profile, then connect wallet, list inventory, and unlock buyer trust.
                </Text>

                <View style={{ marginTop: 18, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                  <HeaderButton
                    icon="create-outline"
                    label="Set up storefront"
                    accent={WARNING}
                    onPress={() => router.push("/market/profile/create" as any)}
                  />
                </View>

                <View style={{ marginTop: 18, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                  <StatCard value="0" label="Active listings" />
                  <StatCard value="0" label="Total listings" />
                  <StatCard value="0" label="Orders" />
                  <StatCard value="0" label="Completed orders" />
                </View>
              </View>
            </View>
          ) : (
            <View
              style={{
                marginTop: 20,
                borderRadius: 16,
                overflow: "hidden",
                borderWidth: 1,
                borderColor: BORDER,
                backgroundColor: "rgba(247,250,252,0.06)",
              }}
            >
              <View style={{ height: isDesktop ? 190 : 166, backgroundColor: "#07100C" }}>
                {banner ? (
                  <Image source={{ uri: banner }} style={{ width: "100%", height: "100%" }} />
                ) : (
                  <LinearGradient
                    colors={["#123C35", "#07100C"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={{ width: "100%", height: "100%" }}
                  />
                )}

                <LinearGradient
                  colors={["rgba(0,0,0,0.05)", "rgba(11,9,7,0.86)"]}
                  start={{ x: 0.5, y: 0 }}
                  end={{ x: 0.5, y: 1 }}
                  style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
                />

                <View
                  style={{
                    position: "absolute",
                    top: 18,
                    left: 18,
                    right: 18,
                    flexDirection: "row",
                    flexWrap: "wrap",
                    gap: 8,
                  }}
                >
                  <View
                    style={{
                      borderRadius: 999,
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      backgroundColor: verified ? "rgba(74,222,128,0.16)" : "rgba(255,255,255,0.12)",
                      borderWidth: 1,
                      borderColor: verified ? "rgba(74,222,128,0.3)" : "rgba(255,255,255,0.18)",
                    }}
                  >
                    <Text style={{ color: verified ? SUCCESS : TEXT, fontWeight: "900", fontSize: 11 }}>
                      {verified ? "Verified seller" : "Unverified seller"}
                    </Text>
                  </View>

                  <View
                    style={{
                      borderRadius: 999,
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      backgroundColor: "rgba(56,189,248,0.14)",
                      borderWidth: 1,
                      borderColor: "rgba(125,211,252,0.26)",
                    }}
                  >
                    <Text style={{ color: BLUE, fontWeight: "900", fontSize: 11 }}>
                      {profile.payout_tier === "fast" ? "Fast payouts" : "Standard payouts"}
                    </Text>
                  </View>

                  <View
                    style={{
                      borderRadius: 999,
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      backgroundColor: profile.active === false ? "rgba(248,113,113,0.16)" : "rgba(251,146,60,0.16)",
                      borderWidth: 1,
                      borderColor: profile.active === false ? "rgba(248,113,113,0.28)" : "rgba(251,146,60,0.28)",
                    }}
                  >
                    <Text style={{ color: profile.active === false ? DANGER : "#FB923C", fontWeight: "900", fontSize: 11 }}>
                      {profile.active === false ? "Store paused" : "Store active"}
                    </Text>
                  </View>
                </View>
              </View>

              <View style={{ padding: 22, marginTop: -44 }}>
                <View
                  style={{
                    flexDirection: isDesktop ? "row" : "column",
                    gap: 16,
                    alignItems: isDesktop ? "flex-end" : "flex-start",
                  }}
                >
                  <View
                    style={{
                      width: 92,
                      height: 92,
                    borderRadius: 18,
                      overflow: "hidden",
                      borderWidth: 2,
                      borderColor: "rgba(255,247,237,0.22)",
                      backgroundColor: "rgba(255,255,255,0.08)",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {logo ? (
                      <Image source={{ uri: logo }} style={{ width: 92, height: 92 }} />
                    ) : (
                      <Ionicons name="person-outline" size={30} color={TEXT} />
                    )}
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text style={{ color: TEXT, fontWeight: "900", fontSize: 28 }}>{storeName}</Text>
                    <View style={{ marginTop: 8, flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <Text style={{ color: MUTED, fontWeight: "800", fontSize: 13 }}>{handle}</Text>
                      {verified ? <Ionicons name="checkmark-circle" size={16} color={SUCCESS} /> : null}
                    </View>

                    <View style={{ marginTop: 18, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                      <StatCard value={String(stats.activeListings)} label="Active listings" />
                      <StatCard value={String(stats.allListings)} label="Total listings" />
                      <StatCard value={String(stats.orders)} label="Orders" />
                      <StatCard value={String(stats.completedOrders)} label="Completed orders" />
                    </View>

                    <View style={{ marginTop: 16, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                      <HeaderButton
                        icon="create-outline"
                        label="Edit profile"
                        accent={WARNING}
                        onPress={() => router.push("/market/profile/edit" as any)}
                      />
                      {adminAccess.isAdmin ? (
                        <HeaderButton
                          icon="shield-checkmark-outline"
                          label={adminAccess.roleKey === "super_admin" ? "Admin HQ" : "Admin"}
                          accent="#FBBF24"
                          onPress={() => router.push("/market/admin" as any)}
                        />
                      ) : null}
                      {profile.market_username ? (
                        <HeaderButton
                          icon="eye-outline"
                          label="View store"
                          accent="#FBBF24"
                          onPress={() => router.push(`/market/profile/${profile.market_username}` as any)}
                        />
                      ) : null}
                    </View>
                  </View>
                </View>
              </View>
            </View>
          )}

          <View style={{ marginTop: 18, flexDirection: isDesktop ? "row" : "column", alignItems: "flex-start", gap: 16 }}>
            <View style={{ flex: 1, minWidth: 0, width: isDesktop ? undefined : "100%", gap: 16 }}>
              <TutorialTarget id="market.account.commands">
                <SectionShell
                  title="Command center"
                  subtitle="Fast paths for the things sellers and buyers use most."
                >
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                    {navTiles.map((tile) => (
                      <AccountTile
                        key={tile.route}
                        title={tile.title}
                        subtitle={tile.subtitle}
                        icon={tile.icon}
                        accent={tile.accent}
                        badge={tile.badge}
                        onPress={() => router.push(tile.route as any)}
                      />
                    ))}
                  </View>
                </SectionShell>
              </TutorialTarget>

              <SectionShell
                title="Store summary"
                subtitle="Public visibility, payouts, and seller status."
              >
                <View style={{ gap: 10 }}>
                  <ReadinessRow
                    icon="eye-outline"
                    title="Public storefront"
                    subtitle={
                      profile?.market_username
                        ? `Your public store is available at @${profile.market_username}.`
                        : "Create the public storefront handle to expose the seller page."
                    }
                    done={Boolean(profile?.market_username)}
                  />
                  <ReadinessRow
                    icon="cash-outline"
                    title="Payout configuration"
                    subtitle={
                      profile
                        ? `Store payouts are set to the ${profile.payout_tier === "fast" ? "fast" : "standard"} lane.`
                        : "Payout preferences appear once your store profile exists."
                    }
                    done={Boolean(profile)}
                    optional
                  />
                  <ReadinessRow
                    icon="storefront-outline"
                    title="Store visibility"
                    subtitle={
                      profile
                        ? profile.active === false
                          ? "The store profile exists but is currently paused."
                          : "The store profile is active and ready for buyer traffic."
                        : "The store is not visible until the store profile is created."
                    }
                    done={Boolean(profile && profile.active !== false)}
                    optional={!profile}
                  />
                </View>
              </SectionShell>
            </View>

            <View style={{ width: isDesktop ? 390 : "100%", gap: 16 }}>
              <TutorialTarget id="market.account.pulse">
                <SectionShell
                  title="Account pulse"
                  subtitle="A compact read on what your marketplace account can do right now."
                  accent={WARNING}
                >
                  <View style={{ flexDirection: isDesktop ? "row" : "column", gap: 14, alignItems: isDesktop ? "center" : "stretch" }}>
                    <View style={{ alignItems: isDesktop ? "center" : "flex-start" }}>
                      <HealthDial score={accountHealthScore} total={4} accent={accountHealthScore >= 3 ? SUCCESS : WARNING} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                      <TutorialTarget id="market.account.wallet" style={{ flex: 1, minWidth: 168 }}>
                        <PulseCard
                          label="Wallet"
                          value={walletLabel}
                          detail={wallet.savedAddress || wallet.connectedAddress ? "Address available for market actions." : "Connect or save an address before payouts."}
                          icon="wallet-outline"
                          accent={launchReady.wallet ? SUCCESS : WARNING}
                        />
                      </TutorialTarget>
                      <PulseCard
                        label="Inventory"
                        value={`${stats.activeListings}/${stats.allListings}`}
                        detail="Active listings compared with total listings."
                        icon="albums-outline"
                        accent={stats.activeListings > 0 ? TEAL : WARNING}
                      />
                      <PulseCard
                        label="Sales"
                        value={String(stats.completedOrders)}
                        detail={`${stats.orders} total order${stats.orders === 1 ? "" : "s"} across buying and selling.`}
                        icon="receipt-outline"
                        accent={stats.completedOrders > 0 ? BLUE : ROSE}
                      />
                    </View>
                  </View>

                  <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 9 }}>
                    <InlineNavButton label="Open full menu" icon="grid-outline" accent={SUCCESS} onPress={() => setMenuOpen(true)} />
                    <InlineNavButton label="Create listing" icon="add-circle-outline" accent={TEAL} onPress={() => router.push("/market/(tabs)/sell" as any)} />
                    <InlineNavButton label="View rewards" icon="gift-outline" accent={WARNING} onPress={() => router.push("/market/(tabs)/rewards" as any)} />
                    <InlineNavButton label="Get support" icon="help-buoy-outline" accent={ROSE} onPress={() => router.push("/market/support" as any)} />
                  </View>
                </SectionShell>
              </TutorialTarget>

              <SectionShell
                title="Checklist"
                subtitle="Important items for selling and payouts."
              >
                <View style={{ gap: 10 }}>
                  <ReadinessRow icon="person-circle-outline" title="Seller profile" subtitle="A public seller identity exists and can be used for listings and discovery." done={launchReady.profile} />
                  <ReadinessRow icon="wallet-outline" title="Wallet connection" subtitle="A wallet address is connected or saved for payments and transfers." done={launchReady.wallet} />
                  <ReadinessRow icon="albums-outline" title="Live inventory" subtitle="At least one listing has been created to activate the selling flow." done={launchReady.listings} />
                  <ReadinessRow icon="shield-checkmark-outline" title="Verification" subtitle="Optional trust layer for stronger buyer confidence and profile credibility." done={launchReady.verification} optional />
                </View>
              </SectionShell>
            </View>
          </View>
        </View>
      </ScrollView>
      <MarketMenuModal
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        onNavigate={(route) => router.push(route as any)}
        profile={{
          name: storeName,
          handle,
          logoUri: logo,
          verified,
          roleLabel: adminAccess.isAdmin ? (adminAccess.roleKey === "super_admin" ? "Super admin" : "Admin") : undefined,
        }}
      />
    </LinearGradient>
  );
}
