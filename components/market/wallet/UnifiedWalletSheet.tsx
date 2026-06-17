import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";

import UnifiedWalletPanel from "@/components/market/wallet/UnifiedWalletPanel";
import { useUnifiedWallet } from "@/components/market/wallet/useUnifiedWallet";

type UnifiedWalletData = ReturnType<typeof useUnifiedWallet>;

type Props = {
  visible: boolean;
  onClose: () => void;
  wallet: UnifiedWalletData;
  onOpenNgnWallet?: () => void;
  onOpenCryptoWallet?: () => void;
  onOpenHistory?: () => void;
};

export default function UnifiedWalletSheet({
  visible,
  onClose,
  wallet,
  onOpenNgnWallet,
  onOpenCryptoWallet,
  onOpenHistory,
}: Props) {
  const { width } = useWindowDimensions();
  const desktop = Platform.OS === "web" && width >= 900;

  return (
    <Modal visible={visible} transparent animationType={desktop ? "fade" : "slide"} onRequestClose={onClose}>
      <View style={[styles.backdrop, desktop ? styles.backdropDesktop : styles.backdropMobile]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <LinearGradient
          colors={["#171A13", "#10130E", "#060807"]}
          start={{ x: 0.08, y: 0 }}
          end={{ x: 0.94, y: 1 }}
          style={[styles.surface, desktop ? styles.surfaceDesktop : styles.surfaceMobile]}
        >
          {!desktop ? <View style={styles.handle} /> : null}
          <View style={styles.closeRow}>
            <Pressable onPress={onClose} style={styles.closeButton}>
              <Ionicons name="close" size={18} color="#fff" />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={desktop}>
            <UnifiedWalletPanel
              wallet={wallet}
              presentation={desktop ? "desktop" : "mobile"}
              onOpenNgnWallet={onOpenNgnWallet}
              onOpenCryptoWallet={onOpenCryptoWallet}
              onOpenHistory={onOpenHistory}
            />
          </ScrollView>
        </LinearGradient>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.62)",
  },
  backdropMobile: {
    justifyContent: "flex-end",
  },
  backdropDesktop: {
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
  },
  surface: {
    borderWidth: 1,
    borderColor: "rgba(255,253,247,0.12)",
    overflow: "hidden",
  },
  surfaceMobile: {
    maxHeight: "86%",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 12,
    paddingTop: 10,
    borderBottomWidth: 0,
  },
  surfaceDesktop: {
    width: "100%",
    maxWidth: 920,
    maxHeight: "88%",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingTop: 12,
  },
  handle: {
    alignSelf: "center",
    width: 42,
    height: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,253,247,0.18)",
    marginBottom: 10,
  },
  closeRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginBottom: 8,
  },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,253,247,0.12)",
    backgroundColor: "rgba(255,253,247,0.07)",
    alignItems: "center",
    justifyContent: "center",
  },
  scrollContent: {
    paddingBottom: 24,
  },
});
