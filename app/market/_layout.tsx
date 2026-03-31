import { Stack } from "expo-router";
import React from "react";
import { View } from "react-native";

import MarketProfileCompletionPrompt from "@/components/market/MarketProfileCompletionPrompt";
import UnifiedWalletLauncher from "@/components/market/wallet/UnifiedWalletLauncher";

export default function MarketLayout() {
  return (
    <View style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="notification/index" />
        <Stack.Screen name="notification/[id]" />
        <Stack.Screen name="menu/index" />
        <Stack.Screen name="history/index" />
        <Stack.Screen name="history/[entryId]" />
        <Stack.Screen name="social/index" />
        <Stack.Screen name="dm/[username]" />
        <Stack.Screen name="stock/index" />
        <Stack.Screen name="stock/[slug]" />
        <Stack.Screen name="stock/create" />
        <Stack.Screen name="stock/portfolio" />
        <Stack.Screen name="stocks/index" />
      </Stack>
      <MarketProfileCompletionPrompt />
      <UnifiedWalletLauncher />
    </View>
  );
}
