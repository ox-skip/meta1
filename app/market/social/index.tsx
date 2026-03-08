import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import AppHeader from "@/components/common/AppHeader";
import SocialFeed from "@/components/market/SocialFeed";

const BG_TOP = "#091426";
const BG_BOTTOM = "#030712";
const SHELL_BORDER = "rgba(148,163,184,0.18)";

export default function SocialFeedScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const isTablet = width >= 768;
  const sidePadding = width >= 1200 ? 26 : isTablet ? 18 : 0;

  return (
    <LinearGradient colors={[BG_TOP, BG_BOTTOM]} style={{ flex: 1 }}>
      <View
        style={{
          position: "absolute",
          top: -120,
          right: -60,
          width: 280,
          height: 280,
          borderRadius: 140,
          backgroundColor: "rgba(29,155,240,0.14)",
        }}
      />
      <View
        style={{
          position: "absolute",
          bottom: -110,
          left: -80,
          width: 260,
          height: 260,
          borderRadius: 130,
          backgroundColor: "rgba(34,197,94,0.10)",
        }}
      />

      <View style={{ flex: 1, paddingHorizontal: sidePadding, paddingBottom: Math.max(insets.bottom, 14) }}>
        <View style={{ flex: 1, width: "100%", maxWidth: 1380, alignSelf: "center" }}>
          <AppHeader
            title="Social"
            subtitle="Live marketplace timeline"
            bordered={false}
            style={{
              backgroundColor: "transparent",
              paddingHorizontal: isTablet ? 8 : 12,
              paddingBottom: 16,
            }}
          />

          <View
            style={{
              flex: 1,
              minHeight: 0,
              borderRadius: isTablet ? 32 : 0,
              overflow: "hidden",
              borderWidth: isTablet ? 1 : 0,
              borderColor: SHELL_BORDER,
              backgroundColor: "rgba(3,7,18,0.56)",
            }}
          >
            <SocialFeed mode="contained" />
          </View>
        </View>
      </View>
    </LinearGradient>
  );
}
