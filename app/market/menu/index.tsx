import { router } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import React, { useMemo } from "react";

import MarketMenuModal from "@/components/market/MarketMenuModal";

export default function MarketMenuScreen() {
  const navigation = useNavigation();

  const canGoBack = useMemo(() => {
    try {
      // @ts-ignore React Navigation's typed route union is narrower than Expo Router here.
      return navigation?.canGoBack?.() ?? false;
    } catch {
      return false;
    }
  }, [navigation]);

  function close() {
    if (canGoBack) {
      // @ts-ignore React Navigation's typed route union is narrower than Expo Router here.
      navigation.goBack();
      return;
    }
    router.replace("/market/(tabs)/account" as any);
  }

  return (
    <MarketMenuModal
      visible
      presentation="screen"
      onClose={close}
      onNavigate={(route) => router.replace(route as any)}
    />
  );
}
