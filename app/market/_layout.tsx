import { Stack } from "expo-router";
import React from "react";
import { Platform, useWindowDimensions, View } from "react-native";

import MarketDesktopSidebar, {
  MARKET_DESKTOP_BREAKPOINT,
  MARKET_DESKTOP_RAIL_WIDTH,
} from "@/components/market/MarketDesktopSidebar";
import MarketProfileCompletionPrompt from "@/components/market/MarketProfileCompletionPrompt";
import MarketRadialLauncher from "@/components/market/MarketRadialLauncher";

export default function MarketLayout() {
  const { width } = useWindowDimensions();
  const isWebDesktop = Platform.OS === "web" && width >= MARKET_DESKTOP_BREAKPOINT;

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1, paddingLeft: isWebDesktop ? MARKET_DESKTOP_RAIL_WIDTH : 0 }}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="notification/index" />
          <Stack.Screen name="notification/[id]" />
          <Stack.Screen name="menu/index" />
          <Stack.Screen name="history/index" />
          <Stack.Screen name="history/[entryId]" />
          <Stack.Screen name="support/index" />
          <Stack.Screen name="support/[ticketId]" />
          <Stack.Screen name="social/index" />
          <Stack.Screen name="social/[postId]" />
          <Stack.Screen name="dm/[username]" />
          <Stack.Screen name="admin/index" />
          <Stack.Screen name="stock/index" />
          <Stack.Screen name="stock/[slug]" />
          <Stack.Screen name="stock/create" />
          <Stack.Screen name="stock/portfolio" />
          <Stack.Screen name="stocks/index" />
        </Stack>
      </View>
      <MarketDesktopSidebar />
      <MarketProfileCompletionPrompt />
      <MarketRadialLauncher />
    </View>
  );
}
