import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import AppHeader from "@/components/common/AppHeader";

export default function PiStockDetailRedirect() {
  const params = useLocalSearchParams<{ slug?: string }>();
  const slug = String(params.slug || "").trim().toLowerCase();

  useEffect(() => {
    if (!slug) {
      router.replace("/market/stock" as any);
      return;
    }
    router.replace((`/market/stock/${slug}` as any) as any);
  }, [slug]);

  return (
    <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 14, backgroundColor: "#071018" }}>
      <AppHeader title="Stock Detail" subtitle="Redirecting to unified market view..." />
      <View style={{ marginTop: 24, alignItems: "center" }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 10, color: "rgba(255,255,255,0.72)" }}>Opening stock...</Text>
      </View>
    </View>
  );
}
