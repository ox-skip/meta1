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

const BG0 = "#0B0907";
const BG1 = "#22160D";
const PANEL = "rgba(24,18,14,0.9)";
const PANEL_ALT = "rgba(255,255,255,0.04)";
const BORDER = "rgba(245,158,11,0.16)";
const TEXT = "#FFF7ED";
const MUTED = "rgba(255,247,237,0.68)";
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
        borderRadius: 18,
        paddingHorizontal: 14,
        paddingVertical: 13,
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
        borderRadius: 18,
        padding: 14,
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
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <View
      style={{
        borderRadius: 28,
        padding: 18,
        backgroundColor: PANEL,
        borderWidth: 1,
        borderColor: BORDER,
      }}
    >
      <Text style={{ color: TEXT, fontWeight: "900", fontSize: 18 }}>{title}</Text>
      <Text style={{ marginTop: 6, color: MUTED, fontSize: 13, lineHeight: 20 }}>{subtitle}</Text>
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
        borderRadius: 18,
        padding: 14,
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
          borderRadius: 14,
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
        flex: 1,
        minWidth: 154,
        borderRadius: 22,
        overflow: "hidden",
        borderWidth: 1,
        borderColor: `${accent}35`,
        backgroundColor: "rgba(255,255,255,0.045)",
        transform: [{ translateY: pressed ? 1 : 0 }, { scale: pressed ? 0.985 : 1 }],
      })}
    >
      <LinearGradient
        colors={[`${accent}1F`, "rgba(255,255,255,0.035)", "rgba(11,9,7,0.34)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ minHeight: 124, padding: 14, justifyContent: "space-between" }}
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
          <View
            style={{
              width: 38,
              height: 38,
              borderRadius: 14,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: `${accent}22`,
              borderWidth: 1,
              borderColor: `${accent}45`,
            }}
          >
            <Ionicons name={icon} size={18} color={accent} />
          </View>
          {badge ? (
            <View style={{ borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5, backgroundColor: `${accent}18`, borderWidth: 1, borderColor: `${accent}38` }}>
              <Text style={{ color: accent, fontWeight: "900", fontSize: 10 }}>{badge}</Text>
            </View>
          ) : (
            <Ionicons name="arrow-forward" size={16} color={accent} />
          )}
        </View>
        <View>
          <Text style={{ color: TEXT, fontWeight: "900", fontSize: 14 }} numberOfLines={1}>{title}</Text>
          <Text style={{ marginTop: 5, color: MUTED, fontSize: 11, lineHeight: 16 }} numberOfLines={2}>{subtitle}</Text>
        </View>
      </LinearGradient>
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
        borderRadius: 22,
        padding: 14,
        backgroundColor: "rgba(255,255,255,0.045)",
        borderWidth: 1,
        borderColor: `${accent}30`,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
        <View style={{ width: 34, height: 34, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: `${accent}18` }}>
          <Ionicons name={icon} size={16} color={accent} />
        </View>
        <Text style={{ color: MUTED, fontWeight: "900", fontSize: 11, textTransform: "uppercase", flex: 1 }} numberOfLines={1}>{label}</Text>
      </View>
      <Text style={{ marginTop: 12, color: TEXT, fontWeight: "900", fontSize: 20 }} numberOfLines={1}>{value}</Text>
      <Text style={{ marginTop: 5, color: MUTED, fontSize: 12, lineHeight: 17 }} numberOfLines={2}>{detail}</Text>
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
        borderRadius: 15,
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
        <View style={{ alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: "rgba(245,158,11,0.14)", borderWidth: 1, borderColor: "rgba(245,158,11,0.26)" }}>
          <Text style={{ color: WARNING, fontSize: 11, fontWeight: "900", letterSpacing: 0.5, textTransform: "uppercase" }}>Account</Text>
        </View>
        <Text style={{ marginTop: 12, color: TEXT, fontSize: 30, fontWeight: "900" }}>Market command center</Text>
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
      <LinearGradient colors={[BG1, BG0]} start={{ x: 0.1, y: 0 }} end={{ x: 0.92, y: 1 }} style={{ flex: 1 }}>
        <View style={{ paddingTop: insets.top + 18, paddingHorizontal: 16 }}>
          <View style={{ maxWidth: 1280, width: "100%", alignSelf: "center" }}>
            {header}
            <View style={{ marginTop: 22, borderRadius: 32, padding: 28, alignItems: "center", backgroundColor: PANEL, borderWidth: 1, borderColor: BORDER }}>
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
    <LinearGradient colors={[BG1, BG0]} start={{ x: 0.1, y: 0 }} end={{ x: 0.92, y: 1 }} style={{ flex: 1 }}>
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

          {!!error ? (
            <View
              style={{
                marginTop: 18,
                borderRadius: 22,
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
                borderRadius: 34,
                overflow: "hidden",
                borderWidth: 1,
                borderColor: BORDER,
                backgroundColor: PANEL,
              }}
            >
              <LinearGradient
                colors={["rgba(245,158,11,0.18)", "rgba(0,0,0,0)"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
              />

              <View style={{ padding: 22 }}>
                <View
                  style={{
                    width: 72,
                    height: 72,
                    borderRadius: 24,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: "rgba(245,158,11,0.14)",
                    borderWidth: 1,
                    borderColor: "rgba(245,158,11,0.26)",
                  }}
                >
                  <Ionicons name="storefront-outline" size={30} color={WARNING} />
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
                borderRadius: 34,
                overflow: "hidden",
                borderWidth: 1,
                borderColor: BORDER,
                backgroundColor: PANEL,
              }}
            >
              <View style={{ height: isDesktop ? 220 : 188, backgroundColor: "#1A120C" }}>
                {banner ? (
                  <Image source={{ uri: banner }} style={{ width: "100%", height: "100%" }} />
                ) : (
                  <LinearGradient
                    colors={["#5B3A11", "#1A120D"]}
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
                      backgroundColor: "rgba(245,158,11,0.16)",
                      borderWidth: 1,
                      borderColor: "rgba(245,158,11,0.28)",
                    }}
                  >
                    <Text style={{ color: WARNING, fontWeight: "900", fontSize: 11 }}>
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
                      borderRadius: 28,
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

          <View style={{ marginTop: 18, gap: 16 }}>
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

            <TutorialTarget id="market.account.pulse">
              <SectionShell
                title="Account pulse"
                subtitle="A compact read on what your marketplace account can do right now."
              >
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                  <PulseCard
                    label="Health"
                    value={`${accountHealthScore}/4 ready`}
                    detail="Profile, wallet, listings, and verification."
                    icon="pulse-outline"
                    accent={accountHealthScore >= 3 ? SUCCESS : WARNING}
                  />
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

                <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 9 }}>
                  <InlineNavButton label="Open full menu" icon="grid-outline" accent={SUCCESS} onPress={() => setMenuOpen(true)} />
                  <InlineNavButton label="Create listing" icon="add-circle-outline" accent={TEAL} onPress={() => router.push("/market/(tabs)/sell" as any)} />
                  <InlineNavButton label="View rewards" icon="gift-outline" accent={WARNING} onPress={() => router.push("/market/(tabs)/rewards" as any)} />
                  <InlineNavButton label="Get support" icon="help-buoy-outline" accent={ROSE} onPress={() => router.push("/market/support" as any)} />
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
