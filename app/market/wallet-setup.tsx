import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import UnifiedWalletPanel from "@/components/market/wallet/UnifiedWalletPanel";
import { useUnifiedWallet } from "@/components/market/wallet/useUnifiedWallet";

const TEXT = "#FFFDF7";
const MUTED = "rgba(255,253,247,0.68)";
const BORDER = "rgba(255,253,247,0.12)";
const PANEL = "rgba(255,253,247,0.07)";
const TEAL = "#2DD4BF";
const INK = "#061311";

export default function MarketWalletSetup() {
  const wallet = useUnifiedWallet();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const desktop = width >= 900;

  const goHome = () => router.replace("/market/(tabs)" as any);

  async function createWallet() {
    const ok = await wallet.createMarketWallet();
    if (ok) goHome();
  }

  return (
    <LinearGradient colors={["#07100D", "#08141A", "#160B06"]} start={{ x: 0.08, y: 0 }} end={{ x: 0.94, y: 1 }} style={styles.page}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + 18,
            paddingBottom: insets.bottom + 38,
            paddingHorizontal: desktop ? 28 : 14,
          },
        ]}
      >
        <View style={[styles.inner, desktop ? styles.innerDesktop : undefined]}>
          <View style={styles.header}>
            <View style={styles.headerIcon}>
              <Ionicons name="mail-outline" size={24} color={TEAL} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.kicker}>Market Wallet!</Text>
              <Text style={styles.title}>Connect your wallet with email or social login</Text>
              <Text style={styles.subtitle}>
                Use WalletConnect to connect your wallet with email, social, or any mobile/browser wallet.
              </Text>
            </View>
          </View>

          <View style={[styles.layout, desktop ? styles.layoutDesktop : undefined]}>
            <View style={styles.setupPanel}>
              <Text style={styles.panelTitle}>Connect now or skip</Text>
              <Text style={styles.panelText}>
                Choose Market Wallet! to connect with email/social login, or use WalletConnect for traditional wallets. You can skip for now and connect later.
              </Text>

              <View style={styles.actionStack}>
                <Pressable onPress={createWallet} disabled={wallet.busy} style={[styles.primary, wallet.busy ? styles.dimmed : undefined]}>
                  {wallet.busy ? <ActivityIndicator color={INK} /> : <Ionicons name="mail-outline" size={18} color={INK} />}
                  <Text style={styles.primaryText}>Market Wallet!</Text>
                </Pressable>

                <Pressable onPress={goHome} style={styles.secondary}>
                  <Ionicons name="arrow-forward-outline" size={17} color={TEXT} />
                  <Text style={styles.secondaryText}>Skip for now</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.walletPreview}>
              <UnifiedWalletPanel wallet={wallet} compact={!desktop} presentation={desktop ? "desktop" : "mobile"} />
            </View>
          </View>
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
    gap: 14,
  },
  innerDesktop: {
    maxWidth: 1160,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerIcon: {
    width: 50,
    height: 50,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(45,212,191,0.12)",
    borderWidth: 1,
    borderColor: "rgba(45,212,191,0.28)",
  },
  kicker: {
    color: TEAL,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  title: {
    marginTop: 3,
    color: TEXT,
    fontSize: 25,
    fontWeight: "900",
  },
  subtitle: {
    marginTop: 5,
    color: MUTED,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
  },
  layout: {
    gap: 12,
  },
  layoutDesktop: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  setupPanel: {
    borderRadius: 8,
    padding: 14,
    backgroundColor: PANEL,
    borderWidth: 1,
    borderColor: BORDER,
    gap: 12,
    flex: 1,
    minWidth: 0,
  },
  panelTitle: {
    color: TEXT,
    fontSize: 17,
    fontWeight: "900",
  },
  panelText: {
    color: MUTED,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "700",
  },
  actionStack: {
    gap: 9,
  },
  primary: {
    minHeight: 48,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    backgroundColor: TEAL,
  },
  primaryText: {
    color: INK,
    fontWeight: "900",
    fontSize: 14,
  },
  secondary: {
    minHeight: 46,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    backgroundColor: "rgba(255,253,247,0.055)",
    borderWidth: 1,
    borderColor: BORDER,
  },
  secondaryText: {
    color: TEXT,
    fontWeight: "900",
    fontSize: 13,
  },
  walletPreview: {
    flex: 1.5,
    minWidth: 0,
  },
  dimmed: {
    opacity: 0.55,
  },
});