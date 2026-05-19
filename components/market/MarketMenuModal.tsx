import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useMemo, useState } from "react";
import { Image, Modal, Platform, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { isNigeriaCountry, resolveUserCountry, type UserCountry } from "@/utils/country";

export type MarketMenuItem = {
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
  badge?: string;
  hideOutsideNigeria?: boolean;
};

export type MarketMenuSection = {
  key: string;
  title: string;
  accent: string;
  items: MarketMenuItem[];
};

export type MarketMenuProfile = {
  name?: string | null;
  handle?: string | null;
  logoUri?: string | null;
  verified?: boolean | null;
  roleLabel?: string | null;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  onNavigate: (route: string) => void;
  profile?: MarketMenuProfile;
  presentation?: "modal" | "screen";
};

const BG0 = "#060807";
const BG1 = "#10130E";
const PANEL = "rgba(8,13,11,0.96)";
const PANEL_ALT = "rgba(255,253,247,0.055)";
const BORDER = "rgba(255,253,247,0.13)";
const TEXT = "#FFFDF7";
const MUTED = "rgba(255,253,247,0.67)";
const FAINT = "rgba(255,253,247,0.43)";
const TEAL = "#2DD4BF";
const AMBER = "#F4B75D";
const BLUE = "#38BDF8";
const ROSE = "#FB7185";

export const MARKET_MENU_SECTIONS: MarketMenuSection[] = [
  {
    key: "markets",
    title: "Markets",
    accent: TEAL,
    items: [
      {
        title: "Marketplace",
        description: "Home, featured projects, and live discovery.",
        icon: "storefront-outline",
        route: "/market/(tabs)",
      },
      {
        title: "Categories",
        description: "Products and services by vertical.",
        icon: "grid-outline",
        route: "/market/(tabs)/category",
      },
      {
        title: "Search",
        description: "Find listings, stores, and demand.",
        icon: "search-outline",
        route: "/market/search",
      },
      {
        title: "Social Feed",
        description: "Seller posts, launches, and updates.",
        icon: "newspaper-outline",
        route: "/market/social",
      },
    ],
  },
  {
    key: "trade",
    title: "Trading",
    accent: BLUE,
    items: [
      {
        title: "Orders",
        description: "Buying and selling activity.",
        icon: "receipt-outline",
        route: "/market/(tabs)/orders",
      },
      {
        title: "Messages",
        description: "Buyer and seller conversations.",
        icon: "chatbubble-ellipses-outline",
        route: "/market/(tabs)/messages",
      },
      {
        title: "History",
        description: "Deposits, fills, payouts, and events.",
        icon: "time-outline",
        route: "/market/history",
      },
      {
        title: "Support",
        description: "Cases, proof, and marketplace help.",
        icon: "help-buoy-outline",
        route: "/market/support",
      },
    ],
  },
  {
    key: "store",
    title: "Store",
    accent: AMBER,
    items: [
      {
        title: "Sell",
        description: "Create a product or service listing.",
        icon: "add-circle-outline",
        route: "/market/(tabs)/sell",
        badge: "Core",
      },
      {
        title: "My Listings",
        description: "Inventory, pricing, and visibility.",
        icon: "albums-outline",
        route: "/market/listings?mine=1",
      },
      {
        title: "Create Profile",
        description: "Open your public store identity.",
        icon: "person-add-outline",
        route: "/market/profile/create",
      },
      {
        title: "Edit Profile",
        description: "Brand assets, bio, and contact details.",
        icon: "create-outline",
        route: "/market/profile/edit",
      },
    ],
  },
  {
    key: "growth",
    title: "Growth",
    accent: ROSE,
    items: [
      {
        title: "Wallet",
        description: "Balances, networks, and portfolio.",
        icon: "wallet-outline",
        route: "/market/wallet",
        hideOutsideNigeria: true,
      },
      {
        title: "Digital Stock",
        description: "Store-backed market identities.",
        icon: "trending-up-outline",
        route: "/market/stock",
      },
      {
        title: "Portfolio",
        description: "Positions and stock exposure.",
        icon: "pie-chart-outline",
        route: "/market/stock/portfolio",
      },
      {
        title: "Rewards",
        description: "Noms, boosts, and tasks.",
        icon: "gift-outline",
        route: "/market/(tabs)/rewards",
      },
      {
        title: "Verification",
        description: "Trust status and application.",
        icon: "shield-checkmark-outline",
        route: "/market/verification/status",
      },
    ],
  },
];

const QUICK_LINKS = [
  { label: "Sell", icon: "add-circle-outline" as const, route: "/market/(tabs)/sell", color: TEAL },
  { label: "Orders", icon: "receipt-outline" as const, route: "/market/(tabs)/orders", color: BLUE },
  { label: "Wallet", icon: "wallet-outline" as const, route: "/market/wallet", color: AMBER, hideOutsideNigeria: true },
  { label: "Support", icon: "help-buoy-outline" as const, route: "/market/support", color: ROSE },
];

function MenuRow({ item, accent, onPress }: { item: MarketMenuItem; accent: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 62,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        backgroundColor: pressed ? "rgba(255,253,247,0.08)" : "transparent",
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
      })}
    >
      <View
        style={{
          width: 38,
          height: 38,
          borderRadius: 8,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: `${accent}18`,
          borderWidth: 1,
          borderColor: `${accent}3A`,
        }}
      >
        <Ionicons name={item.icon} size={18} color={accent} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text numberOfLines={1} style={{ color: TEXT, fontWeight: "900", fontSize: 14, flexShrink: 1 }}>
            {item.title}
          </Text>
          {item.badge ? (
            <View
              style={{
                borderRadius: 999,
                paddingHorizontal: 7,
                paddingVertical: 3,
                backgroundColor: `${accent}18`,
                borderWidth: 1,
                borderColor: `${accent}36`,
              }}
            >
              <Text style={{ color: accent, fontSize: 9, fontWeight: "900" }}>{item.badge}</Text>
            </View>
          ) : null}
        </View>
        <Text numberOfLines={1} style={{ marginTop: 3, color: MUTED, fontSize: 12 }}>
          {item.description}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={FAINT} />
    </Pressable>
  );
}

function MenuSurface({ onClose, onNavigate, profile, presentation = "modal" }: Omit<Props, "visible">) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [userCountry, setUserCountry] = useState<UserCountry | null>(null);
  const isNigeria = isNigeriaCountry(userCountry?.code || userCountry?.name);
  const wide = width >= 900;
  const maxPanelHeight = presentation === "screen" ? height - Math.max(insets.top + insets.bottom + 28, 40) : height - Math.max(insets.top + insets.bottom + 52, 64);
  const profileName = profile?.name || "BestCity Market";
  const profileHandle = profile?.handle || "@market";

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

  const sections = useMemo(() => {
    return MARKET_MENU_SECTIONS.map((section) => ({
      ...section,
      items: section.items.filter((item) => !item.hideOutsideNigeria || isNigeria),
    })).filter((section) => section.items.length > 0);
  }, [isNigeria]);

  const quickLinks = useMemo(
    () => QUICK_LINKS.filter((item) => !item.hideOutsideNigeria || isNigeria),
    [isNigeria],
  );

  const open = (route: string) => {
    onClose();
    onNavigate(route);
  };

  return (
    <View
      style={{
        flex: 1,
        justifyContent: presentation === "screen" || wide ? "center" : "flex-end",
        paddingTop: presentation === "screen" ? Math.max(insets.top + 12, 18) : insets.top + 12,
        paddingBottom: presentation === "screen" ? Math.max(insets.bottom + 12, 18) : Platform.OS === "ios" ? Math.max(insets.bottom, 12) : 12,
        paddingHorizontal: wide ? 24 : 10,
      }}
    >
      <Pressable
        onPress={onClose}
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
        }}
      />

      <View
        style={{
          width: "100%",
          maxWidth: wide ? 760 : 540,
          maxHeight: maxPanelHeight,
          alignSelf: "center",
          borderRadius: presentation === "screen" || wide ? 8 : 10,
          overflow: "hidden",
          backgroundColor: PANEL,
          borderWidth: 1,
          borderColor: "rgba(255,253,247,0.16)",
          shadowColor: "#000",
          shadowOpacity: 0.34,
          shadowRadius: 26,
          shadowOffset: { width: 0, height: 16 },
          elevation: 16,
        }}
      >
        <LinearGradient
          colors={["rgba(45,212,191,0.18)", "rgba(56,189,248,0.10)", "rgba(244,183,93,0.08)"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            padding: 16,
            borderBottomWidth: 1,
            borderBottomColor: BORDER,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View
              style={{
                width: 54,
                height: 54,
                borderRadius: 8,
                overflow: "hidden",
                backgroundColor: "rgba(255,253,247,0.09)",
                borderWidth: 1,
                borderColor: "rgba(255,253,247,0.22)",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {profile?.logoUri ? (
                <Image source={{ uri: profile.logoUri }} style={{ width: 54, height: 54 }} />
              ) : (
                <Ionicons name="person-circle-outline" size={30} color={TEXT} />
              )}
            </View>

            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
                <Text numberOfLines={1} style={{ color: TEXT, fontWeight: "900", fontSize: 18, flexShrink: 1 }}>
                  {profileName}
                </Text>
                {profile?.verified ? <Ionicons name="checkmark-circle" size={16} color={TEAL} /> : null}
              </View>
              <Text numberOfLines={1} style={{ marginTop: 3, color: MUTED, fontSize: 12, fontWeight: "800" }}>
                {profileHandle}
              </Text>
              <View style={{ marginTop: 8, flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <Text style={{ color: TEAL, fontWeight: "900", fontSize: 11, textTransform: "uppercase" }}>Market menu</Text>
                {profile?.roleLabel ? <Text style={{ color: FAINT, fontSize: 11, fontWeight: "800" }}>{profile.roleLabel}</Text> : null}
              </View>
            </View>

            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close menu"
              style={{
                width: 40,
                height: 40,
                borderRadius: 8,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "rgba(255,253,247,0.08)",
                borderWidth: 1,
                borderColor: BORDER,
              }}
            >
              <Ionicons name="close" size={19} color={TEXT} />
            </Pressable>
          </View>

          <View style={{ marginTop: 14, flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {quickLinks.map((item) => (
              <Pressable
                key={item.route}
                onPress={() => open(item.route)}
                style={({ pressed }) => ({
                  flexGrow: 1,
                  flexBasis: wide ? "23%" : "47%",
                  minHeight: 48,
                  borderRadius: 8,
                  paddingHorizontal: 10,
                  paddingVertical: 9,
                  backgroundColor: pressed ? `${item.color}22` : "rgba(6,8,7,0.42)",
                  borderWidth: 1,
                  borderColor: `${item.color}36`,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                })}
              >
                <Ionicons name={item.icon} size={17} color={item.color} />
                <Text numberOfLines={1} style={{ color: TEXT, fontWeight: "900", fontSize: 12 }}>
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </LinearGradient>

        <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 14 }} showsVerticalScrollIndicator={false}>
          <View style={{ flexDirection: wide ? "row" : "column", flexWrap: "wrap", gap: 10 }}>
            {sections.map((section) => (
              <View
                key={section.key}
                style={{
                  width: wide ? "49.2%" : "100%",
                  borderRadius: 8,
                  paddingVertical: 8,
                  backgroundColor: PANEL_ALT,
                  borderWidth: 1,
                  borderColor: BORDER,
                }}
              >
                <View style={{ paddingHorizontal: 12, paddingBottom: 5, flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <View style={{ width: 7, height: 7, borderRadius: 99, backgroundColor: section.accent }} />
                  <Text style={{ color: section.accent, fontSize: 11, fontWeight: "900", textTransform: "uppercase" }}>
                    {section.title}
                  </Text>
                </View>
                {section.items.map((item) => (
                  <MenuRow key={`${section.key}-${item.route}`} item={item} accent={section.accent} onPress={() => open(item.route)} />
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

export default function MarketMenuModal({ visible, presentation = "modal", ...props }: Props) {
  if (presentation === "screen") {
    return (
      <LinearGradient colors={[BG1, BG0]} start={{ x: 0.08, y: 0 }} end={{ x: 0.94, y: 1 }} style={{ flex: 1 }}>
        <MenuSurface presentation="screen" {...props} />
      </LinearGradient>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={props.onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.62)" }}>
        <MenuSurface presentation="modal" {...props} />
      </View>
    </Modal>
  );
}
