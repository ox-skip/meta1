import type { WalletTx } from "@/hooks/wallet/useWalletTxPaginated";
import React from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";

import { WALLET_THEME as T } from "@/components/wallet/theme";

function badge(type: WalletTx["type"]) {
  switch (type) {
    case "deposit":
      return { t: "Deposit", c: T.primary };
    case "withdrawal":
      return { t: "Withdraw", c: T.accent };
    case "transfer_in":
      return { t: "Received", c: "#22C55E" };
    case "transfer_out":
      return { t: "Sent", c: "#EF4444" };
    case "fee":
      return { t: "Fee", c: T.gold };
    default:
      return { t: type, c: T.accent };
  }
}

export default function WalletActivity({ items, loading }: { items: WalletTx[]; loading?: boolean }) {
  return (
    <View style={styles.section}>
      <View style={styles.headRow}>
        <Text style={styles.h}>Activity</Text>
        <View style={styles.countPill}>
          <Text style={styles.countText}>{items.length}</Text>
        </View>
      </View>

      <View style={styles.card}>
        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={T.primary} />
            <Text style={styles.loadingText}>Loading activity...</Text>
          </View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(i) => i.id}
            ListEmptyComponent={<Text style={styles.empty}>No activity yet.</Text>}
            renderItem={({ item }) => {
              const b = badge(item.type);
              return (
                <View style={styles.row}>
                  <View style={[styles.pill, { backgroundColor: `${b.c}22`, borderColor: `${b.c}55` }]}>
                    <Text style={[styles.pillText, { color: b.c }]}>{b.t}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.amount}>NGN {Number(item.amount).toLocaleString()}</Text>
                    <Text style={styles.meta}>
                      {item.counterpartyName ? `${item.counterpartyName} - ` : ""}
                      {new Date(item.created_at).toLocaleString()}
                    </Text>
                  </View>
                </View>
              );
            }}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 20 },
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  h: { color: T.text, fontWeight: "900", fontSize: 16, marginBottom: 10 },
  countPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: T.primarySoft,
    borderWidth: 1,
    borderColor: T.border,
  },
  countText: { color: T.primary, fontWeight: "900", fontSize: 11 },
  card: {
    backgroundColor: T.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: T.border,
    overflow: "hidden",
  },
  row: { flexDirection: "row", gap: 12, padding: 14, borderBottomWidth: 1, borderBottomColor: "rgba(255,253,247,0.08)" },
  pill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, alignSelf: "flex-start" },
  pillText: { fontWeight: "900", fontSize: 12 },
  amount: { color: T.text, fontWeight: "900" },
  meta: { color: T.textMuted, marginTop: 3, fontSize: 12 },
  empty: { color: T.textMuted, padding: 14 },
  loading: { padding: 16, alignItems: "center", gap: 8 },
  loadingText: { color: T.textMuted, fontSize: 12 },
});
