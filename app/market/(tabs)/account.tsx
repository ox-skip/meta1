import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from "react-native";

import AppHeader from "@/components/common/AppHeader";
import { InAppTutorial } from "@/components/onboarding/InAppTutorial";
import UnifiedWalletPanel from "@/components/market/wallet/UnifiedWalletPanel";
import { useUnifiedWallet } from "@/components/market/wallet/useUnifiedWallet";
import { tutorialFlows } from "@/services/onboarding/definitions";
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

const BG0 = "#05040B";
const BG1 = "#101D31";
const CARD = "rgba(255,255,255,0.06)";
const BORDER = "rgba(255,255,255,0.11)";

function publicUrl(bucket: string, path?: string | null) {
  if (!path) return null;
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

function CommandTile({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        width: "48%",
        borderRadius: 16,
        padding: 12,
        backgroundColor: CARD,
        borderWidth: 1,
        borderColor: BORDER,
      }}
    >
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 12,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "rgba(56,189,248,0.2)",
          borderWidth: 1,
          borderColor: "rgba(56,189,248,0.35)",
        }}
      >
        <Ionicons name={icon} size={16} color="#E0F2FE" />
      </View>
      <Text style={{ marginTop: 10, color: "#fff", fontWeight: "900", fontSize: 13 }}>{title}</Text>
      <Text style={{ marginTop: 4, color: "rgba(255,255,255,0.6)", fontSize: 11 }}>{subtitle}</Text>
    </Pressable>
  );
}

function EnginePill({
  icon,
  label,
  active,
  accent,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active: boolean;
  accent: string;
}) {
  return (
    <View
      style={{
        flex: 1,
        borderRadius: 12,
        height: 40,
        borderWidth: 1,
        borderColor: active ? accent : "rgba(255,255,255,0.14)",
        backgroundColor: active ? `${accent}33` : "rgba(255,255,255,0.05)",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
      }}
    >
      <Ionicons name={icon} size={13} color={active ? accent : "#fff"} />
      <Text style={{ color: "#fff", fontWeight: "900", fontSize: 11 }}>{label}</Text>
    </View>
  );
}

export default function MarketAccountTab() {
  const wallet = useUnifiedWallet();
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
        supabase
          .from("market_listings")
          .select("id", { count: "exact", head: true })
          .eq("seller_id", user.id)
          .eq("is_active", true),
        supabase
          .from("market_listings")
          .select("id", { count: "exact", head: true })
          .eq("seller_id", user.id),
        supabase
          .from("market_orders")
          .select("id", { count: "exact", head: true })
          .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`),
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
    await supabase.auth.signOut().catch(() => undefined);
    router.replace("/(auth)/login" as any);
  }

  if (loading) {
    return (
      <LinearGradient colors={[BG1, BG0]} style={{ flex: 1, paddingHorizontal: 16, paddingTop: 14 }}>
        <AppHeader title="Account" subtitle="Seller profile, wallet, and controls" />
        <View style={{ marginTop: 80, alignItems: "center" }}>
          <ActivityIndicator />
          <Text style={{ marginTop: 8, color: "rgba(255,255,255,0.7)", fontWeight: "800" }}>Loading account...</Text>
        </View>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient colors={[BG1, BG0]} start={{ x: 0.15, y: 0 }} end={{ x: 0.9, y: 1 }} style={{ flex: 1 }}>
      <InAppTutorial enabled={!loading} flow={tutorialFlows.marketAccount} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 34 }}>
        <AppHeader title="Account Hub" subtitle="Command center for your marketplace operations" />

        <View style={{ marginTop: 10, flexDirection: "row", gap: 10 }}>
          <Pressable
            onPress={onRefresh}
            style={{
              flex: 1,
              borderRadius: 14,
              height: 44,
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "row",
              gap: 8,
              backgroundColor: "rgba(255,255,255,0.07)",
              borderWidth: 1,
              borderColor: BORDER,
            }}
          >
            {refreshing ? <ActivityIndicator /> : <Ionicons name="refresh" size={16} color="#fff" />}
            <Text style={{ color: "#fff", fontWeight: "900" }}>Refresh</Text>
          </Pressable>
          <Pressable
            onPress={onSignOut}
            style={{
              flex: 1,
              borderRadius: 14,
              height: 44,
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "row",
              gap: 8,
              backgroundColor: "rgba(239,68,68,0.2)",
              borderWidth: 1,
              borderColor: "rgba(239,68,68,0.35)",
            }}
          >
            <Ionicons name="log-out-outline" size={16} color="#FECACA" />
            <Text style={{ color: "#FECACA", fontWeight: "900" }}>Sign out</Text>
          </Pressable>
        </View>

        {!profile ? (
          <View
            style={{
              marginTop: 12,
              borderRadius: 20,
              padding: 16,
              backgroundColor: CARD,
              borderWidth: 1,
              borderColor: BORDER,
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "900", fontSize: 16 }}>Create your seller profile</Text>
            <Text style={{ marginTop: 6, color: "rgba(255,255,255,0.65)" }}>
              Set up your account to start listing, trading, and receiving orders.
            </Text>
            <Pressable
              onPress={() => router.push("/market/profile/create" as any)}
              style={{
                marginTop: 12,
                borderRadius: 16,
                height: 46,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "rgba(56,189,248,0.22)",
                borderWidth: 1,
                borderColor: "rgba(56,189,248,0.45)",
              }}
            >
              <Text style={{ color: "#E0F2FE", fontWeight: "900" }}>Create Profile</Text>
            </Pressable>
          </View>
        ) : (
          <View
            style={{
              marginTop: 12,
              borderRadius: 22,
              overflow: "hidden",
              borderWidth: 1,
              borderColor: BORDER,
              backgroundColor: CARD,
            }}
          >
            <View style={{ height: 156, backgroundColor: "rgba(255,255,255,0.08)" }}>
              {banner ? <Image source={{ uri: banner }} style={{ width: "100%", height: "100%" }} /> : null}
            </View>
            <View style={{ padding: 14, marginTop: -34, flexDirection: "row", gap: 12 }}>
              <View
                style={{
                  width: 78,
                  height: 78,
                  borderRadius: 22,
                  overflow: "hidden",
                  borderWidth: 2,
                  borderColor: "rgba(255,255,255,0.25)",
                  backgroundColor: "rgba(255,255,255,0.08)",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {logo ? <Image source={{ uri: logo }} style={{ width: 78, height: 78 }} /> : <Ionicons name="person-outline" size={26} color="#fff" />}
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <Text style={{ color: "#fff", fontWeight: "900", fontSize: 18 }}>{handle}</Text>
                  {verified ? <Ionicons name="checkmark-circle" size={16} color="#60A5FA" /> : null}
                  <View style={{ borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: "rgba(56,189,248,0.2)", borderWidth: 1, borderColor: "rgba(56,189,248,0.35)" }}>
                    <Text style={{ color: "#E0F2FE", fontWeight: "900", fontSize: 11 }}>
                      {profile.payout_tier === "fast" ? "Fast payouts" : "Standard payouts"}
                    </Text>
                  </View>
                </View>
                <Text style={{ marginTop: 5, color: "rgba(255,255,255,0.75)", fontWeight: "800" }}>{storeName}</Text>

                <View style={{ marginTop: 9, flexDirection: "row", gap: 8 }}>
                  <View style={{ borderRadius: 12, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: BORDER }}>
                    <Text style={{ color: "#fff", fontWeight: "900", fontSize: 11 }}>{stats.activeListings} active</Text>
                  </View>
                  <View style={{ borderRadius: 12, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: BORDER }}>
                    <Text style={{ color: "#fff", fontWeight: "900", fontSize: 11 }}>{stats.orders} orders</Text>
                  </View>
                </View>
              </View>
            </View>
          </View>
        )}

        <View style={{ marginTop: 12, flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "space-between" }}>
          <CommandTile icon="create-outline" title="Edit Profile" subtitle="Update store identity" onPress={() => router.push("/market/profile/edit" as any)} />
          <CommandTile icon="eye-outline" title="Public Store" subtitle="View live seller page" onPress={() => router.push(profile?.market_username ? `/market/profile/${profile.market_username}` as any : "/market/profile/create" as any)} />
          <CommandTile icon="albums-outline" title="My Listings" subtitle="Manage products & services" onPress={() => router.push("/market/listings?mine=1" as any)} />
          <CommandTile icon="receipt-outline" title="Orders" subtitle="Track incoming/outgoing orders" onPress={() => router.push("/market/(tabs)/orders" as any)} />
          <CommandTile icon="time-outline" title="History" subtitle="Deposits, buys, sells, profits" onPress={() => router.push("/market/history" as any)} />
          <CommandTile icon="shield-checkmark-outline" title="Verification" subtitle="Apply or check status" onPress={() => router.push("/market/verification/status" as any)} />
          <CommandTile icon="menu-outline" title="More Menu" subtitle="Open extended navigation" onPress={() => router.push("/market/menu" as any)} />
        </View>

        <View style={{ marginTop: 12 }}>
          <UnifiedWalletPanel
            wallet={wallet}
            compact
            onOpenNgnWallet={() => router.push("/fintech/(tabs)/wallet?action=fund" as any)}
            onOpenCryptoWallet={() => router.push("/market/wallet" as any)}
            onOpenHistory={() => router.push("/market/history" as any)}
          />
        </View>

        <View
          style={{
            marginTop: 10,
            borderRadius: 16,
            padding: 12,
            backgroundColor: CARD,
            borderWidth: 1,
            borderColor: BORDER,
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "900", fontSize: 13 }}>Wallet Engine</Text>
          <View style={{ marginTop: 8, flexDirection: "row", gap: 8 }}>
            <EnginePill
              icon="link-outline"
              label="WalletConnect"
              active={wallet.walletMode === "walletconnect"}
              accent="#60A5FA"
            />
            <EnginePill
              icon="sparkles-outline"
              label="Base Wallet"
              active={wallet.walletMode === "base_smart"}
              accent="#2DD4BF"
            />
          </View>
        </View>

        <View
          style={{
            marginTop: 12,
            borderRadius: 20,
            padding: 14,
            backgroundColor: CARD,
            borderWidth: 1,
            borderColor: BORDER,
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "900", fontSize: 15 }}>Launch Readiness</Text>
          <View style={{ marginTop: 10, gap: 7 }}>
            <Text style={{ color: launchReady.profile ? "#86EFAC" : "rgba(255,255,255,0.72)", fontWeight: "800", fontSize: 12 }}>
              {launchReady.profile ? "DONE" : "TODO"} Seller profile setup
            </Text>
            <Text style={{ color: launchReady.wallet ? "#86EFAC" : "rgba(255,255,255,0.72)", fontWeight: "800", fontSize: 12 }}>
              {launchReady.wallet ? "DONE" : "TODO"} Wallet connected and synced
            </Text>
            <Text style={{ color: launchReady.listings ? "#86EFAC" : "rgba(255,255,255,0.72)", fontWeight: "800", fontSize: 12 }}>
              {launchReady.listings ? "DONE" : "TODO"} At least one listing published
            </Text>
            <Text style={{ color: launchReady.verification ? "#86EFAC" : "rgba(255,255,255,0.72)", fontWeight: "800", fontSize: 12 }}>
              {launchReady.verification ? "DONE" : "OPTIONAL"} Seller verification
            </Text>
          </View>
        </View>

        {!!error ? (
          <Text style={{ marginTop: 12, color: "#FCA5A5", fontWeight: "800" }}>{error}</Text>
        ) : null}
      </ScrollView>
    </LinearGradient>
  );
}
