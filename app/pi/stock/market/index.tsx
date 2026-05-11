import { router } from "expo-router";
import React, { useEffect } from "react";
import { View } from "react-native";

import AppHeader from "@/components/common/AppHeader";
import { StockLoadingState, StockScreen } from "@/components/market/stock/StockUi";

export default function PiStockMarketRedirect() {
  useEffect(() => {
    router.replace("/market/stock" as any);
  }, []);

  return (
    <StockScreen>
      <AppHeader title="Digital Stock" subtitle="Opening the market." />
      <View style={{ marginTop: 10 }}>
        <StockLoadingState label="Opening market" />
      </View>
    </StockScreen>
  );
}
