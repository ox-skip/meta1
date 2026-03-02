import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import AppHeader from "@/components/common/AppHeader";
import { isNigeriaCountry, resolveUserCountry, type UserCountry } from "@/utils/country";

const BG0 = "#05040B";
const BG1 = "#0A0620";
const CARD = "rgba(255,255,255,0.05)";
const BORDER = "rgba(255,255,255,0.10)";

const MENU_ITEMS: Array<{
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
}> = [
  { title: "Market Home", icon: "storefront-outline", route: "/market/(tabs)" },
  { title: "Digital Stock", icon: "trending-up-outline", route: "/market/stock" },
  { title: "Pi Stock", icon: "logo-bitcoin", route: "/pi/stock/market" },
  { title: "Sell", icon: "add-circle-outline", route: "/market/(tabs)/sell" },
  { title: "Orders", icon: "receipt-outline", route: "/market/(tabs)/orders" },
  { title: "Category", icon: "grid-outline", route: "/market/(tabs)/category" },
  { title: "Social Feed", icon: "newspaper-outline", route: "/market/social" },
  { title: "Rewards", icon: "gift-outline", route: "/market/(tabs)/rewards" },
  { title: "Messages", icon: "chatbubble-ellipses-outline", route: "/market/(tabs)/messages" },
  { title: "Wallet", icon: "wallet-outline", route: "/market/wallet" },
  { title: "Transaction History", icon: "time-outline", route: "/market/history" },
  { title: "Listings", icon: "albums-outline", route: "/market/listings" },
  { title: "My Listing", icon: "clipboard-outline", route: "/market/mylisting" },
  { title: "Search", icon: "search-outline", route: "/market/search" },
  { title: "Create Profile", icon: "person-add-outline", route: "/market/profile/create" },
  { title: "Edit Profile", icon: "create-outline", route: "/market/profile/edit" },
  { title: "Verification Apply", icon: "shield-checkmark-outline", route: "/market/verification/apply" },
  { title: "Verification Status", icon: "checkmark-done-outline", route: "/market/verification/status" },
];

export default function MarketMenuScreen() {
  const [userCountry, setUserCountry] = useState<UserCountry | null>(null);
  const isNigeria = isNigeriaCountry(userCountry?.code || userCountry?.name);

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

  const items = useMemo(() => {
    if (isNigeria) return MENU_ITEMS;
    return MENU_ITEMS.filter((i) => i.title !== "Wallet");
  }, [isNigeria]);

  return (
    <LinearGradient colors={[BG1, BG0]} style={{ flex: 1, paddingHorizontal: 16, paddingTop: 14 }}>
      <AppHeader title="Menu" subtitle="Quick access to all market screens." />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 6 }}>
          {items.map((item) => (
            <Pressable
              key={item.title}
              onPress={() => router.push(item.route as any)}
              style={{
                width: "48%",
                minHeight: 94,
                borderRadius: 18,
                padding: 12,
                backgroundColor: CARD,
                borderWidth: 1,
                borderColor: BORDER,
                justifyContent: "space-between",
              }}
            >
              <View
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 12,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "rgba(124,58,237,0.22)",
                  borderWidth: 1,
                  borderColor: "rgba(124,58,237,0.35)",
                }}
              >
                <Ionicons name={item.icon} size={18} color="#fff" />
              </View>
              <Text style={{ color: "#fff", fontWeight: "900", fontSize: 13 }}>{item.title}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </LinearGradient>
  );
}
