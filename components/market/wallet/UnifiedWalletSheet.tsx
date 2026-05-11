import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";

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
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.62)", justifyContent: "flex-end" }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <LinearGradient
          colors={["#171A13", "#10130E", "#060807"]}
          start={{ x: 0.08, y: 0 }}
          end={{ x: 0.94, y: 1 }}
          style={{
            maxHeight: "86%",
            borderTopLeftRadius: 18,
            borderTopRightRadius: 18,
            paddingHorizontal: 12,
            paddingTop: 10,
            borderTopWidth: 1,
            borderLeftWidth: 1,
            borderRightWidth: 1,
            borderColor: "rgba(255,253,247,0.12)",
          }}
        >
          <View
            style={{
              alignSelf: "center",
              width: 42,
              height: 4,
              borderRadius: 999,
              backgroundColor: "rgba(255,253,247,0.18)",
              marginBottom: 10,
            }}
          />
          <View style={{ flexDirection: "row", justifyContent: "flex-end", marginBottom: 8 }}>
            <Pressable
              onPress={onClose}
              style={{
                width: 34,
                height: 34,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: "rgba(255,253,247,0.12)",
                backgroundColor: "rgba(255,253,247,0.07)",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="close" size={18} color="#fff" />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
            <UnifiedWalletPanel
              wallet={wallet}
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
