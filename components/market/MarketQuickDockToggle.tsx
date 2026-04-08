import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { usePathname } from "expo-router";
import React, { useMemo } from "react";
import { Platform, Pressable, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { toggleMarketQuickDockExpanded, useMarketQuickDockExpanded } from "@/components/market/quickDockState";

export default function MarketQuickDockToggle() {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const expanded = useMarketQuickDockExpanded();
  const { width: viewportWidth } = useWindowDimensions();

  const hidden = useMemo(() => {
    const p = String(pathname || "");
    if (!p.startsWith("/market")) return true;
    if (p.includes("/market/menu")) return true;
    if (p.includes("/market/wallet")) return true;
    if (p.includes("/market/checkout/")) return true;
    if (Platform.OS === "web" && (p.endsWith("/market/sell") || p.includes("/market/sell?"))) return true;
    return false;
  }, [pathname]);

  const bottomOffset = useMemo(() => {
    const p = String(pathname || "");
    const listingPad = p.includes("/market/listing/") ? 92 : 0;
    const sellPad = p.endsWith("/market/sell") || p.includes("/market/sell?") ? 124 : 0;
    const base = Platform.OS === "ios" ? 24 : 18;
    return Math.max(insets.bottom, 10) + base + listingPad + sellPad;
  }, [insets.bottom, pathname]);

  const compact = viewportWidth < 390;
  const toggleWidth = compact ? 64 : 72;

  if (hidden) return null;

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: Math.max(16, viewportWidth / 2 - toggleWidth / 2),
        bottom: bottomOffset,
        zIndex: 39,
      }}
    >
      <Pressable
        onPress={() => toggleMarketQuickDockExpanded()}
        style={{
          borderRadius: 999,
          overflow: "hidden",
          shadowColor: "#000",
          shadowOpacity: 0.24,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 6 },
          elevation: 10,
        }}
      >
        <LinearGradient
          colors={expanded ? ["#2B1D10", "#15110C"] : ["#1A120D", "#2C2118"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            width: toggleWidth,
            height: compact ? 42 : 46,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: "rgba(245,158,11,0.28)",
            paddingHorizontal: 10,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Ionicons name="grid-outline" size={compact ? 13 : 14} color="#F59E0B" />
            <Ionicons name="wallet-outline" size={compact ? 13 : 14} color="#F8FAFC" />
          </View>
          <Ionicons name={expanded ? "chevron-down" : "chevron-up"} size={compact ? 14 : 16} color="#FFF7ED" />
        </LinearGradient>
      </Pressable>
      <Text
        style={{
          marginTop: 6,
          textAlign: "center",
          color: "rgba(255,247,237,0.72)",
          fontSize: 10,
          fontWeight: "800",
        }}
      >
        {expanded ? "Hide" : "Show"}
      </Text>
    </View>
  );
}
