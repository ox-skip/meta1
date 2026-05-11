import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect } from "react";
import { View } from "react-native";

import AppHeader from "@/components/common/AppHeader";
import { StockLoadingState, StockScreen } from "@/components/market/stock/StockUi";

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
    <StockScreen>
      <AppHeader title="Stock Detail" subtitle="Opening market detail." />
      <View style={{ marginTop: 10 }}>
        <StockLoadingState label="Opening stock" />
      </View>
    </StockScreen>
  );
}
