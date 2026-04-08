import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { InAppTutorial } from "@/components/onboarding/InAppTutorial";
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

export default function MarketAccountTab() {
  const wallet = useUnifiedWallet();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<SellerProfile | null>(null);
  const [stats, setStats] = useState<StatState>({ activeListings: 0, allListings: 0, orders: 0 });

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

  async function load() {
    setError(null);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user) {
        setProfile(null);
        setStats({ activeListings: 0, allListings: 0, orders: 0 });
        return;
      }

      const [profileRes, activeListingsRes, allListingsRes, ordersRes] = await Promise.all([
        supabase
          .from("market_seller_profiles")
          .select("user_id,market_username,display_name,business_name,is_verified,logo_path,banner_path,payout_tier,active")
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase.from("market_listings").select("id", { count: "exact", head: true }).eq("seller_id", user.id).eq("is_active", true),
        supabase.from("market_listings").select("id", { count: "exact", head: true }).eq("seller_id", user.id),
        supabase.from("market_orders").select("id", { count: "exact", head: true }).or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`),
      ]);

      setProfile((profileRes.data as SellerProfile | null) ?? null);
      setStats({
        activeListings: Number(activeListingsRes.count ?? 0),
        allListings: Number(allListingsRes.count ?? 0),
        orders: Number(ordersRes.count ?? 0),
      });
    } catch (e: any) {
      setError(friendlyMarketError(e, "Unable to load account."));
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
          <Text style={{ color: WARNING, fontSize: 11, fontWeight: "900", letterSpacing: 0.5, textTransform: "uppercase" }}>Seller Control</Text>
        </View>
        <Text style={{ marginTop: 12, color: TEXT, fontSize: 30, fontWeight: "900" }}>Command deck</Text>
        <Text style={{ marginTop: 6, color: MUTED, fontSize: 13, lineHeight: 20 }}>
          A cleaner workspace for store identity, seller posture, and launch readiness. Wallet and menu access now stay in floating controls.
        </Text>
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
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
              <Text style={{ marginTop: 14, color: TEXT, fontWeight: "900", fontSize: 18 }}>Loading seller workspace</Text>
              <Text style={{ marginTop: 6, color: MUTED, fontSize: 13, textAlign: "center", lineHeight: 20 }}>
                Pulling profile, order, and wallet state into the new dashboard.
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
          {header}

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
                  Build the store before the sales flow
                </Text>
                <Text style={{ marginTop: 8, color: MUTED, fontSize: 14, lineHeight: 22 }}>
                  Setup now stays focused on the store itself. Use the floating menu and wallet controls for quick actions
                  while this screen stays dedicated to seller state.
                </Text>

                <View style={{ marginTop: 18, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                  <StatCard value="0" label="Active listings" />
                  <StatCard value="0" label="Total listings" />
                  <StatCard value="0" label="Orders" />
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
                    </View>
                  </View>
                </View>

                <View
                  style={{
                    marginTop: 18,
                    borderRadius: 22,
                    padding: 16,
                    backgroundColor: PANEL_ALT,
                    borderWidth: 1,
                    borderColor: "rgba(255,255,255,0.06)",
                    gap: 8,
                  }}
                >
                  <Text style={{ color: TEXT, fontWeight: "900", fontSize: 14 }}>Floating controls are now primary</Text>
                  <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18 }}>
                    Store actions, menu access, and wallet tools were removed from this panel so they stay one tap away
                    in the floating launchers across market screens.
                  </Text>
                </View>
              </View>
            </View>
          )}

          <View style={{ marginTop: 18, gap: 16 }}>
            <SectionShell
              title="Seller posture"
              subtitle="This screen now stays focused on store health while the floating wallet and menu handle quick actions."
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
                      : "Payout preferences appear once the seller profile exists."
                  }
                  done={Boolean(profile)}
                  optional
                />
                <ReadinessRow
                  icon="grid-outline"
                  title="Floating control access"
                  subtitle="Menu and wallet shortcuts now float over this screen so navigation stays one tap away."
                  done
                />
                <ReadinessRow
                  icon="storefront-outline"
                  title="Store visibility"
                  subtitle={
                    profile
                      ? profile.active === false
                        ? "The store profile exists but is currently paused."
                        : "The store profile is active and ready for buyer traffic."
                      : "The store is not visible until the seller profile is created."
                  }
                  done={Boolean(profile && profile.active !== false)}
                  optional={!profile}
                />
              </View>
            </SectionShell>

            <SectionShell
              title="Launch readiness"
              subtitle="The setup state is preserved, but the checklist now reads like a real dashboard."
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
    </LinearGradient>
  );
}
