import { router } from "expo-router";
import React, { useEffect } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import AppHeader from "@/components/common/AppHeader";

export default function PiStockMarketRedirect() {
  useEffect(() => {
    router.replace("/market/stock" as any);
  }, []);

  return (
    <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 14, backgroundColor: "#071018" }}>
      <AppHeader title="Digital Stock" subtitle="Redirecting to unified market..." />
      <View style={{ marginTop: 24, alignItems: "center" }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 10, color: "rgba(255,255,255,0.72)" }}>Opening market...</Text>
      </View>
    </View>
  );
}
