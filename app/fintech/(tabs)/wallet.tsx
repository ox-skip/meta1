import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Redirect, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import FundWallet from "@/components/wallet/fundwallet";
import ProfileModal from "@/components/wallet/profile";
import SendMoney from "@/components/wallet/send";
import { WALLET_THEME as T } from "@/components/wallet/theme";
import Withdraw from "@/components/wallet/withdraw";
import BalanceVisibilityToggle from "@/components/common/BalanceVisibilityToggle";
import { maskBalanceValue, useBalanceVisibility } from "@/hooks/useBalanceVisibility";
import { useWalletSimple } from "@/hooks/wallet/useWalletSimple";
import { useWalletTxPaginated } from "@/hooks/wallet/useWalletTxPaginated";
import { isNigeriaCountry, resolveUserCountry, type UserCountry } from "@/utils/country";

type NgnSection = "fund" | "send" | "withdraw" | "history";

function toSection(action?: string | null): NgnSection {
  if (action === "send" || action === "withdraw" || action === "history" || action === "fund") {
    return action;
  }
  return "fund";
}

function TxBadge({ type }: { type: string }) {
  const map: Record<string, { label: string; bg: string; fg: string }> = {
    deposit: { label: "Deposit", bg: "rgba(124,58,237,0.18)", fg: T.primary },
    withdrawal: { label: "Withdraw", bg: "rgba(255,255,255,0.08)", fg: "#E5E7EB" },
    transfer_in: { label: "Received", bg: "rgba(16,185,129,0.12)", fg: T.success },
    transfer_out: { label: "Sent", bg: "rgba(239,68,68,0.12)", fg: T.danger },
    fee: { label: "Fee", bg: "rgba(255,255,255,0.08)", fg: "#E5E7EB" },
    bill: { label: "Bill", bg: "rgba(255,255,255,0.08)", fg: "#E5E7EB" },
  };
  const b = map[type] ?? { label: type, bg: "rgba(255,255,255,0.08)", fg: "#E5E7EB" };
  return (
    <View style={[styles.badge, { backgroundColor: b.bg, borderColor: `${b.fg}55` }]}>
      <Text style={[styles.badgeText, { color: b.fg }]}>{b.label}</Text>
    </View>
  );
}

export default function WalletRoute() {
  const params = useLocalSearchParams<{ action?: string }>();
  const { width } = useWindowDimensions();
  const isWide = width >= 980;
  const { balancesHidden, toggleBalancesHidden } = useBalanceVisibility();

  const [section, setSection] = useState<NgnSection>(toSection(params.action));
  const [showProfile, setShowProfile] = useState(false);
  const [userCountry, setUserCountry] = useState<UserCountry | undefined>(undefined);

  const isNigeria = isNigeriaCountry(userCountry?.code || userCountry?.name);

  const { balance, error: walletSimpleErr, loading: walletLoading, reload: reloadWallet } = useWalletSimple();
  const tx = useWalletTxPaginated();

  const tabs: { key: NgnSection; label: string }[] = useMemo(
    () => [
      { key: "fund", label: "Fund" },
      { key: "send", label: "Send" },
      { key: "withdraw", label: "Withdraw" },
      { key: "history", label: "History" },
    ],
    [],
  );

  useEffect(() => {
    setSection(toSection(params.action));
  }, [params.action]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const c = await resolveUserCountry({ prompt: true });
        if (mounted) setUserCountry(c);
      } catch {
        if (mounted) setUserCountry(null);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  async function refreshAll() {
    await Promise.allSettled([reloadWallet(), tx.refresh()]);
  }

  if (userCountry === undefined) {
    return (
      <LinearGradient colors={[T.bg1, T.bg0]} style={styles.screen}>
        <View style={styles.loaderWrap}>
          <ActivityIndicator color="#fff" />
          <Text style={styles.loaderText}>Loading wallet...</Text>
        </View>
      </LinearGradient>
    );
  }

  if (params.action === "crypto" || !isNigeria) {
    return <Redirect href="/market/wallet" />;
  }

  return (
    <LinearGradient colors={[T.bg1, T.bg0]} start={{ x: 0.15, y: 0 }} end={{ x: 0.9, y: 1 }} style={styles.screen}>
      <View style={[styles.container, isWide && styles.containerWide]}>
        <View style={styles.headerWrap}>
          <View style={styles.topRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>NGN Wallet</Text>
              <Text style={styles.subTitle}>Utility wallet for bills, transfers, and withdrawals.</Text>
            </View>

            <View style={styles.topActions}>
              <Pressable style={styles.smallBtn} onPress={refreshAll}>
                {walletLoading || tx.loading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Ionicons name="refresh" size={18} color="#fff" />
                )}
              </Pressable>

              <Pressable style={styles.smallBtn} onPress={() => setShowProfile(true)}>
                <Ionicons name="menu" size={18} color="#fff" />
              </Pressable>
            </View>
          </View>

          <View style={styles.card}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <View style={styles.pill}>
                <Text style={styles.pillText}>FINTECH</Text>
              </View>
              <BalanceVisibilityToggle
                hidden={balancesHidden}
                onPress={() => {
                  void toggleBalancesHidden();
                }}
              />
            </View>
            <Text style={styles.label}>Available balance</Text>
            <Text style={styles.balance}>
              {balancesHidden ? maskBalanceValue("NGN") : `NGN ${Number(balance || 0).toLocaleString()}`}
            </Text>
            <Text style={styles.foot}>Funds are tracked in your wallet ledger with transaction history.</Text>
          </View>
        </View>

        {!!walletSimpleErr ? <Text style={styles.err}>{walletSimpleErr}</Text> : null}

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
          <View style={styles.tabRow}>
            {tabs.map((t) => (
              <Pressable
                key={t.key}
                onPress={() => setSection(t.key)}
                style={[styles.tab, section === t.key ? styles.tabActive : styles.tabIdle]}
              >
                <Text style={[styles.tabText, section === t.key ? styles.tabTextActive : styles.tabTextIdle]}>{t.label}</Text>
              </Pressable>
            ))}
          </View>

          {section === "fund" ? <FundWallet onSuccess={refreshAll} /> : null}
          {section === "send" ? <SendMoney onSuccess={refreshAll} /> : null}
          {section === "withdraw" ? <Withdraw onSuccess={refreshAll} /> : null}

          {section === "history" ? (
            <View style={styles.historyCard}>
              <Text style={styles.hTitle}>Transactions</Text>
              {!!tx.error ? <Text style={styles.err}>{tx.error}</Text> : null}
              {tx.loading ? <Text style={styles.dim}>Loading history...</Text> : null}

              <FlatList
                data={tx.items}
                keyExtractor={(i) => i.id}
                scrollEnabled={false}
                ListEmptyComponent={<Text style={styles.dim}>No transactions yet.</Text>}
                renderItem={({ item }) => (
                  <View style={styles.txRow}>
                    <TxBadge type={item.type} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.txAmount}>NGN {Number(item.amount).toLocaleString()}</Text>
                      <Text style={styles.txMeta}>
                        {item.counterpartyName ? `${item.counterpartyName} - ` : ""}
                        {new Date(item.created_at).toLocaleString()}
                      </Text>
                      {!!item.reference ? <Text style={styles.txRef}>Ref: {item.reference}</Text> : null}
                    </View>
                  </View>
                )}
              />

              {tx.hasMore ? (
                <Pressable style={styles.loadMoreBtn} onPress={tx.loadMore} disabled={tx.loadingMore}>
                  <Text style={styles.loadMoreText}>{tx.loadingMore ? "Loading..." : "Load more"}</Text>
                </Pressable>
              ) : (
                <Text style={[styles.dim, { textAlign: "center", marginTop: 10 }]}>End of history</Text>
              )}
            </View>
          ) : null}
        </ScrollView>
      </View>

      <ProfileModal visible={showProfile} onClose={() => setShowProfile(false)} />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: T.bg0 },
  container: { flex: 1, width: "100%", alignSelf: "center" },
  containerWide: { maxWidth: 980 },

  loaderWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  loaderText: { marginTop: 10, color: "rgba(255,255,255,0.7)", fontWeight: "800" },

  err: { color: "#FCA5A5", paddingHorizontal: 16, marginTop: 8 },
  dim: { color: T.textMuted, paddingHorizontal: 16, marginTop: 8 },

  headerWrap: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 },
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 },
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
  pill: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: T.primarySoft,
    borderWidth: 1,
    borderColor: "rgba(124,58,237,0.45)",
  },
  pillText: { color: "#DDD6FE", fontSize: 10, fontWeight: "900" },
  label: { color: T.textMuted, marginTop: 10, fontWeight: "700" },
  balance: { color: T.text, marginTop: 8, fontSize: 30, fontWeight: "900" },
  foot: { color: T.textDim, marginTop: 6, fontSize: 12 },

  tabRow: { flexDirection: "row", gap: 10, paddingHorizontal: 16, marginTop: 10 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 16, borderWidth: 1, alignItems: "center" },
  tabIdle: { backgroundColor: T.card, borderColor: T.border },
  tabActive: { backgroundColor: T.primary, borderColor: T.primary },
  tabText: { fontWeight: "900", fontSize: 12 },
  tabTextIdle: { color: "rgba(255,255,255,0.85)" },
  tabTextActive: { color: "#fff" },

  historyCard: {
    marginHorizontal: 16,
    marginTop: 12,
    backgroundColor: T.card,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 22,
    overflow: "hidden",
    paddingBottom: 10,
  },
  hTitle: { color: "#fff", fontWeight: "900", fontSize: 16, padding: 14 },
  txRow: { flexDirection: "row", gap: 12, padding: 14, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.06)" },
  txAmount: { color: "#fff", fontWeight: "900" },
  txMeta: { color: T.textMuted, fontSize: 12, marginTop: 4 },
  txRef: { color: T.textDim, fontSize: 11, marginTop: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, alignSelf: "flex-start" },
  badgeText: { fontWeight: "900", fontSize: 12 },
  loadMoreBtn: {
    marginTop: 10,
    marginHorizontal: 14,
    height: 48,
    borderRadius: 18,
    backgroundColor: T.primarySoft,
    borderWidth: 1,
    borderColor: "rgba(124,58,237,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  loadMoreText: { color: "#fff", fontWeight: "900" },
});

