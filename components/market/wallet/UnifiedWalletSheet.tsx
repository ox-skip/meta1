import { Ionicons } from "@expo/vector-icons";
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
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View
          style={{
            maxHeight: "86%",
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            padding: 14,
            backgroundColor: "#071018",
            borderTopWidth: 1,
            borderTopColor: "rgba(45,212,191,0.16)",
          }}
        >
          <View style={{ flexDirection: "row", justifyContent: "flex-end", marginBottom: 8 }}>
            <Pressable
              onPress={onClose}
              style={{
                width: 34,
                height: 34,
                borderRadius: 11,
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.12)",
                backgroundColor: "rgba(255,255,255,0.05)",
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
        </View>
      </View>
    </Modal>
  );
}
