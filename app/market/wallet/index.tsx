import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React from "react";
import { ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import AppHeader from "@/components/common/AppHeader";
import UnifiedWalletPanel from "@/components/market/wallet/UnifiedWalletPanel";
import { useUnifiedWallet } from "@/components/market/wallet/useUnifiedWallet";

export default function MarketWallet() {
  const wallet = useUnifiedWallet();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = width >= 860;

  return (
    <LinearGradient colors={["#07100D", "#08141A", "#160B06"]} start={{ x: 0.08, y: 0 }} end={{ x: 0.94, y: 1 }} style={styles.page}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + 12,
            paddingBottom: insets.bottom + 44,
            paddingHorizontal: wide ? 24 : 14,
          },
        ]}
      >
        <View style={[styles.inner, wide ? styles.innerWide : undefined]}>
          <AppHeader title="Wallet" subtitle="Dapp wallet, stable balances, and market portfolio" />
          <UnifiedWalletPanel
            wallet={wallet}
            onOpenNgnWallet={wallet.isNigeria ? () => router.push("/fintech/(tabs)/wallet?action=fund" as any) : undefined}
            onOpenHistory={() => router.push("/market/history" as any)}
          />
        </View>
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
  },
  inner: {
    width: "100%",
    alignSelf: "center",
    gap: 12,
  },
  innerWide: {
    maxWidth: 720,
  },
});
