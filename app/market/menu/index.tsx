import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { isNigeriaCountry, resolveUserCountry, type UserCountry } from "@/utils/country";

type MenuItem = {
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
  badge?: string;
  hideOutsideNigeria?: boolean;
};

type MenuSection = {
  key: string;
  title: string;
  subtitle: string;
  accent: string;
  items: MenuItem[];
};

const BG0 = "#0B0907";
const BG1 = "#22160D";
const PANEL = "rgba(24,18,14,0.88)";
const PANEL_ALT = "rgba(255,255,255,0.04)";
const BORDER = "rgba(245,158,11,0.16)";
const TEXT = "#FFF7ED";
const MUTED = "rgba(255,247,237,0.68)";

const MENU_SECTIONS: MenuSection[] = [
  {
    key: "discover",
    title: "Discover",
    subtitle: "Shortcuts for browsing, alerts, and live activity.",
    accent: "#F59E0B",
    items: [
      {
        title: "Market Home",
        description: "Featured listings, discovery lanes, and highlighted sellers.",
        icon: "storefront-outline",
        route: "/market/(tabs)",
      },
      {
        title: "Categories",
        description: "Browse product and service verticals without extra taps.",
        icon: "grid-outline",
        route: "/market/(tabs)/category",
      },
      {
        title: "Search",
        description: "Jump straight to listings, sellers, or specific demand.",
        icon: "search-outline",
        route: "/market/search",
      },
      {
        title: "Social Feed",
        description: "Follow seller updates, launches, and public activity.",
        icon: "newspaper-outline",
        route: "/market/social",
      },
      {
        title: "Notifications",
        description: "Track order events, account alerts, and market signals.",
        icon: "notifications-outline",
        route: "/market/notification",
      },
      {
        title: "Support",
        description: "Report order, payment, listing, or account issues.",
        icon: "help-buoy-outline",
        route: "/market/support",
      },
    ],
  },
  {
    key: "seller",
    title: "Sell And Operate",
    subtitle: "The routes used most often while running the store.",
    accent: "#FB923C",
    items: [
      {
        title: "Sell",
        description: "Publish a new product or service from the composer.",
        icon: "add-circle-outline",
        route: "/market/(tabs)/sell",
        badge: "Core",
      },
      {
        title: "My Listings",
        description: "Manage inventory, pricing, visibility, and coverage.",
        icon: "albums-outline",
        route: "/market/listings?mine=1",
      },
      {
        title: "Orders",
        description: "Review incoming and outgoing transactions in one place.",
        icon: "receipt-outline",
        route: "/market/(tabs)/orders",
      },
      {
        title: "History",
        description: "Inspect deposits, fills, payouts, and trade activity.",
        icon: "time-outline",
        route: "/market/history",
      },
      {
        title: "Messages",
        description: "Respond to buyers and sellers without leaving the market.",
        icon: "chatbubble-ellipses-outline",
        route: "/market/(tabs)/messages",
      },
    ],
  },
  {
    key: "identity",
    title: "Identity And Trust",
    subtitle: "Profile, verification, and public presence controls.",
    accent: "#FBBF24",
    items: [
      {
        title: "Account Hub",
        description: "Open your store profile, activity, and selling tools.",
        icon: "person-circle-outline",
        route: "/market/(tabs)/account",
      },
      {
        title: "Create Profile",
        description: "Initialize your public store identity and search presence.",
        icon: "person-add-outline",
        route: "/market/profile/create",
      },
      {
        title: "Edit Profile",
        description: "Update brand assets, bio, contact links, and storefront copy.",
        icon: "create-outline",
        route: "/market/profile/edit",
      },
      {
        title: "Verification Apply",
        description: "Submit government ID to strengthen buyer trust and access.",
        icon: "shield-checkmark-outline",
        route: "/market/verification/apply",
        badge: "Trust",
      },
      {
        title: "Verification Status",
        description: "Review your current verification decision and next step.",
        icon: "checkmark-done-outline",
        route: "/market/verification/status",
      },
    ],
  },
  {
    key: "capital",
    title: "Capital And Growth",
    subtitle: "Wallet, rewards, and stock-linked routes grouped together.",
    accent: "#F97316",
    items: [
      {
        title: "Wallet",
        description: "Manage balances, rails, and funding paths for supported users.",
        icon: "wallet-outline",
        route: "/market/wallet",
        hideOutsideNigeria: true,
      },
      {
        title: "Digital Stock",
        description: "Open the stock market view for brand-linked assets.",
        icon: "trending-up-outline",
        route: "/market/stock",
      },
      {
        title: "Stock Portfolio",
        description: "Track holdings and follow tokenized store exposure.",
        icon: "pie-chart-outline",
        route: "/market/stock/portfolio",
      },
      {
        title: "Rewards",
        description: "Check incentive routes that support seller momentum.",
        icon: "gift-outline",
        route: "/market/(tabs)/rewards",
      },
    ],
  },
];

function QuickLaunch({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        minWidth: 110,
        borderRadius: 18,
        paddingHorizontal: 14,
        paddingVertical: 14,
        backgroundColor: "rgba(255,255,255,0.05)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
      }}
    >
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 12,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "rgba(245,158,11,0.14)",
          borderWidth: 1,
          borderColor: "rgba(245,158,11,0.24)",
        }}
      >
        <Ionicons name={icon} size={17} color="#F59E0B" />
      </View>
      <Text style={{ color: TEXT, fontWeight: "900", fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

function SectionCard({
  section,
  onPress,
}: {
  section: MenuSection;
  onPress: (route: string) => void;
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
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <View style={{ flex: 1 }}>
          <View
            style={{
              alignSelf: "flex-start",
              borderRadius: 999,
              paddingHorizontal: 10,
              paddingVertical: 5,
              backgroundColor: `${section.accent}18`,
              borderWidth: 1,
              borderColor: `${section.accent}36`,
            }}
          >
            <Text
              style={{
                color: section.accent,
                fontWeight: "900",
                fontSize: 11,
                letterSpacing: 0.5,
                textTransform: "uppercase",
              }}
            >
              {section.title}
            </Text>
          </View>
          <Text style={{ marginTop: 12, color: MUTED, fontSize: 13, lineHeight: 20 }}>
            {section.subtitle}
          </Text>
        </View>

        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: 16,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: `${section.accent}16`,
            borderWidth: 1,
            borderColor: `${section.accent}28`,
          }}
        >
          <Ionicons name="apps-outline" size={22} color={section.accent} />
        </View>
      </View>

      <View style={{ marginTop: 16, gap: 10 }}>
        {section.items.map((item) => (
          <Pressable
            key={item.title}
            onPress={() => onPress(item.route)}
            style={{
              borderRadius: 20,
              padding: 14,
              backgroundColor: PANEL_ALT,
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.06)",
              flexDirection: "row",
              alignItems: "flex-start",
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
                backgroundColor: `${section.accent}16`,
                borderWidth: 1,
                borderColor: `${section.accent}2A`,
              }}
            >
              <Ionicons name={item.icon} size={18} color={section.accent} />
            </View>

            <View style={{ flex: 1 }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <Text style={{ color: TEXT, fontWeight: "900", fontSize: 14, flex: 1 }}>
                  {item.title}
                </Text>

                {item.badge ? (
                  <View
                    style={{
                      borderRadius: 999,
                      paddingHorizontal: 8,
                      paddingVertical: 4,
                      backgroundColor: `${section.accent}16`,
                      borderWidth: 1,
                      borderColor: `${section.accent}2A`,
                    }}
                  >
                    <Text style={{ color: section.accent, fontSize: 10, fontWeight: "900" }}>
                      {item.badge}
                    </Text>
                  </View>
                ) : (
                  <Ionicons name="chevron-forward" size={16} color={MUTED} />
                )}
              </View>

              <Text style={{ marginTop: 5, color: MUTED, fontSize: 12, lineHeight: 18 }}>
                {item.description}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export default function MarketMenuScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [userCountry, setUserCountry] = useState<UserCountry | null>(null);
  const isNigeria = isNigeriaCountry(userCountry?.code || userCountry?.name);
  const isWide = width >= 1040;

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const c = await resolveUserCountry({ prompt: true });
        if (mounted) setUserCountry(c);
      } catch {
        if (mounted) setUserCountry(null);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const canGoBack = useMemo(() => {
    try {
      // @ts-ignore
      return navigation?.canGoBack?.() ?? false;
    } catch {
      return false;
    }
  }, [navigation]);

  const sections = useMemo(() => {
    return MENU_SECTIONS.map((section) => ({
      ...section,
      items: section.items.filter((item) => !item.hideOutsideNigeria || isNigeria),
    })).filter((section) => section.items.length > 0);
  }, [isNigeria]);

  function handleBack() {
    if (canGoBack) {
      // @ts-ignore
      navigation.goBack();
      return;
    }
    router.replace("/market/(tabs)/account" as any);
  }

  function open(route: string) {
    router.push(route as any);
  }

  return (
    <LinearGradient colors={[BG1, BG0]} start={{ x: 0.08, y: 0 }} end={{ x: 0.92, y: 1 }} style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 12,
          paddingHorizontal: 16,
          paddingBottom: 164,
        }}
      >
        <View style={{ width: "100%", maxWidth: 1280, alignSelf: "center" }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
            }}
          >
            <Pressable
              onPress={handleBack}
              style={{
                width: 46,
                height: 46,
                borderRadius: 18,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "rgba(255,255,255,0.05)",
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.08)",
              }}
            >
              <Ionicons name="chevron-back" size={22} color={TEXT} />
            </Pressable>

            <View style={{ flex: 1 }}>
              <View
                style={{
                  alignSelf: "flex-start",
                  borderRadius: 999,
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  backgroundColor: "rgba(245,158,11,0.14)",
                  borderWidth: 1,
                  borderColor: "rgba(245,158,11,0.26)",
                }}
              >
                <Text
                  style={{
                    color: "#F59E0B",
                    fontSize: 11,
                    fontWeight: "900",
                    letterSpacing: 0.5,
                    textTransform: "uppercase",
                  }}
                >
                  Market Navigation
                </Text>
              </View>
              <Text style={{ marginTop: 10, color: TEXT, fontSize: 28, fontWeight: "900" }}>
                Navigation deck
              </Text>
              <Text style={{ marginTop: 6, color: MUTED, fontSize: 13, lineHeight: 20 }}>
                Every major route grouped by how people actually use the market, so movement feels faster and
                more intentional.
              </Text>
            </View>

            <Pressable
              onPress={() => router.push("/market/(tabs)/account" as any)}
              style={{
                width: 46,
                height: 46,
                borderRadius: 18,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "rgba(245,158,11,0.14)",
                borderWidth: 1,
                borderColor: "rgba(245,158,11,0.26)",
              }}
            >
              <Ionicons name="person-circle-outline" size={23} color="#FCD34D" />
            </Pressable>
          </View>

          <View
            style={{
              marginTop: 20,
              borderRadius: 32,
              overflow: "hidden",
              borderWidth: 1,
              borderColor: BORDER,
              backgroundColor: PANEL,
            }}
          >
            <LinearGradient
              colors={["rgba(245,158,11,0.14)", "rgba(0,0,0,0)"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
            />

            <View style={{ padding: 22 }}>
              <Text style={{ color: TEXT, fontWeight: "900", fontSize: 20 }}>Pinned shortcuts</Text>
              <Text style={{ marginTop: 6, color: MUTED, fontSize: 13, lineHeight: 20 }}>
                These are the routes most likely to cut down extra taps during normal market use.
              </Text>

              <View style={{ marginTop: 18, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                <QuickLaunch
                  label="Account"
                  icon="person-circle-outline"
                  onPress={() => open("/market/(tabs)/account")}
                />
                <QuickLaunch
                  label="Sell"
                  icon="add-circle-outline"
                  onPress={() => open("/market/(tabs)/sell")}
                />
                <QuickLaunch
                  label="Orders"
                  icon="receipt-outline"
                  onPress={() => open("/market/(tabs)/orders")}
                />
                <QuickLaunch
                  label="Support"
                  icon="help-buoy-outline"
                  onPress={() => open("/market/support")}
                />
              </View>

              <View
                style={{
                  marginTop: 16,
                  borderRadius: 20,
                  padding: 14,
                  backgroundColor: "rgba(255,255,255,0.04)",
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.08)",
                }}
              >
                <Text style={{ color: TEXT, fontWeight: "800", fontSize: 12 }}>
                  {isNigeria
                    ? "Wallet routes are available for your current market region."
                    : "Wallet is hidden here when the current market region does not support it."}
                </Text>
              </View>
            </View>
          </View>

          <View
            style={{
              marginTop: 18,
              flexDirection: isWide ? "row" : "column",
              flexWrap: "wrap",
              gap: 14,
            }}
          >
            {sections.map((section) => (
              <View key={section.key} style={{ width: isWide ? "49.4%" : "100%" }}>
                <SectionCard section={section} onPress={open} />
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </LinearGradient>
  );
}
