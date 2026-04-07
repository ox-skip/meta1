import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import BalanceVisibilityToggle from "@/components/common/BalanceVisibilityToggle";
import { maskBalanceValue, useBalanceVisibility } from "@/hooks/useBalanceVisibility";
import { WALLET_THEME as T } from "@/components/wallet/theme";

type Props = {
  balance: number;
  onRefresh: () => void;
  onOpenProfile: () => void;
  refreshing?: boolean;
};

function fmt(value: number) {
  return Number(value || 0).toLocaleString();
}

export default function WalletHeader({ balance, onRefresh, onOpenProfile, refreshing }: Props) {
  const { balancesHidden, toggleBalancesHidden } = useBalanceVisibility();
  return (
    <View style={styles.wrap}>
      <View style={styles.topRow}>
        <View>
          <Text style={styles.title}>Wallet</Text>
          <Text style={styles.subTitle}>Fast wallet operations with secure confirmation</Text>
        </View>

        <View style={styles.topActions}>
          <Pressable style={styles.smallBtn} onPress={onRefresh}>
            {refreshing ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="refresh" size={18} color="#fff" />}
          </Pressable>
          <Pressable style={styles.smallBtn} onPress={onOpenProfile}>
            <Ionicons name="menu" size={18} color="#fff" />
          </Pressable>
        </View>
      </View>

      <View style={styles.card}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>NGN WALLET</Text>
          </View>
          <BalanceVisibilityToggle
            hidden={balancesHidden}
            onPress={() => {
              void toggleBalancesHidden();
            }}
          />
        </View>
        <Text style={styles.label}>Available balance</Text>
        <Text style={styles.balance}>{balancesHidden ? maskBalanceValue("NGN") : `NGN ${fmt(balance)}`}</Text>
        <Text style={styles.foot}>Ledger-backed balance with audit trail</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 },
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  title: { color: T.text, fontSize: 24, fontWeight: "900" },
  subTitle: { color: T.textMuted, fontSize: 12, marginTop: 4 },
  topActions: { flexDirection: "row", gap: 10 },
  smallBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: T.card,
    borderWidth: 1,
    borderColor: T.border,
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    marginTop: 12,
    borderRadius: 22,
    padding: 16,
    backgroundColor: T.card,
    borderWidth: 1,
    borderColor: T.border,
  },
  badge: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: T.primarySoft,
    borderWidth: 1,
    borderColor: "rgba(124,58,237,0.45)",
  },
  badgeText: { color: "#DDD6FE", fontSize: 10, fontWeight: "900" },
  label: { color: T.textMuted, marginTop: 10, fontWeight: "700" },
  balance: { color: T.text, marginTop: 8, fontSize: 30, fontWeight: "900" },
  foot: { color: T.textDim, marginTop: 6, fontSize: 12 },
});
