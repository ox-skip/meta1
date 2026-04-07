import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, usePathname } from "expo-router";
import React, { useMemo } from "react";
import { Platform, Pressable, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const ACCENT = "#F59E0B";
const TEXT = "#FFF7ED";
const MUTED = "rgba(255,247,237,0.7)";

export default function MarketMenuLauncher() {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const hidden = useMemo(() => {
    const p = String(pathname || "");
    if (!p.startsWith("/market")) return true;
    if (p.includes("/market/menu")) return true;
    if (p.includes("/market/checkout/")) return true;
    return false;
  }, [pathname]);

  const bottomOffset = useMemo(() => {
    const p = String(pathname || "");
    const base = Platform.OS === "ios" ? 94 : 82;
    const listingPad = p.includes("/market/listing/") ? 92 : 0;
    const sellPad = p.endsWith("/market/sell") || p.includes("/market/sell?") ? 124 : 0;
    return Math.max(insets.bottom, 10) + base + listingPad + sellPad;
  }, [insets.bottom, pathname]);

  if (hidden) return null;

  const compact = width < 390;

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: compact ? 12 : 16,
        bottom: bottomOffset,
        zIndex: 38,
      }}
    >
      <Pressable
        onPress={() => router.push("/market/menu" as any)}
        style={{
          borderRadius: compact ? 18 : 22,
          overflow: "hidden",
          shadowColor: "#000",
          shadowOpacity: 0.24,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 8 },
          elevation: 10,
        }}
      >
        <LinearGradient
          colors={["#342514", "#17120D"]}
          start={{ x: 0.12, y: 0 }}
          end={{ x: 0.92, y: 1 }}
          style={{
            minWidth: compact ? 116 : 132,
            height: compact ? 50 : 56,
            borderRadius: compact ? 18 : 22,
            borderWidth: 1,
            borderColor: "rgba(245,158,11,0.34)",
            paddingHorizontal: compact ? 12 : 14,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
          }}
        >
          <View
            style={{
              width: compact ? 28 : 32,
              height: compact ? 28 : 32,
              borderRadius: compact ? 10 : 12,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(245,158,11,0.16)",
              borderWidth: 1,
              borderColor: "rgba(245,158,11,0.24)",
            }}
          >
            <Ionicons name="grid-outline" size={compact ? 15 : 17} color={ACCENT} />
          </View>

          <View>
            <Text style={{ color: TEXT, fontSize: compact ? 11 : 12, fontWeight: "900" }}>Menu</Text>
            <Text style={{ color: MUTED, fontSize: compact ? 9 : 10, fontWeight: "700" }}>
              All market routes
            </Text>
          </View>
        </LinearGradient>
      </Pressable>
    </View>
  );
}
