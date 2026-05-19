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

import BalanceVisibilityToggle from "@/components/common/BalanceVisibilityToggle";
import FundWallet from "@/components/wallet/fundwallet";
import ProfileModal from "@/components/wallet/profile";
import SendMoney from "@/components/wallet/send";
import { WALLET_THEME as T } from "@/components/wallet/theme";
import Withdraw from "@/components/wallet/withdraw";
import { maskBalanceValue, useBalanceVisibility } from "@/hooks/useBalanceVisibility";
import { useWalletSimple } from "@/hooks/wallet/useWalletSimple";
import { useWalletTxPaginated } from "@/hooks/wallet/useWalletTxPaginated";
import { isNigeriaCountry, resolveUserCountry, type UserCountry } from "@/utils/country";

type NgnSection = "fund" | "send" | "withdraw" | "history";
type IconName = React.ComponentProps<typeof Ionicons>["name"];

function toSection(action?: string | null): NgnSection {
  if (action === "send" || action === "withdraw" || action === "history" || action === "fund") {
    return action;
  }
  return "fund";
}

function formatNgn(value: unknown) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "0";
}

function TxBadge({ type }: { type: string }) {
  const map: Record<string, { label: string; bg: string; fg: string; icon: IconName }> = {
    deposit: { label: "Deposit", bg: T.primarySoft, fg: T.primary, icon: "arrow-down-circle-outline" },
    withdrawal: { label: "Withdraw", bg: T.accentSoft, fg: T.accent, icon: "business-outline" },
    transfer_in: { label: "Received", bg: "rgba(16,185,129,0.14)", fg: T.success, icon: "download-outline" },
    transfer_out: { label: "Sent", bg: "rgba(239,68,68,0.13)", fg: T.danger, icon: "send-outline" },
    fee: { label: "Fee", bg: T.goldSoft, fg: T.gold, icon: "receipt-outline" },
    bill: { label: "Bill", bg: T.goldSoft, fg: T.gold, icon: "flash-outline" },
  };
  const b = map[type] ?? { label: type, bg: T.cardStrong, fg: T.textMuted, icon: "swap-horizontal-outline" as IconName };
  return (
    <View style={[styles.badge, { backgroundColor: b.bg, borderColor: `${b.fg}55` }]}>
      <Ionicons name={b.icon} size={13} color={b.fg} />
      <Text style={[styles.badgeText, { color: b.fg }]}>{b.label}</Text>
    </View>
  );
}

function ActionCard({
  icon,
  title,
  caption,
  active,
  onPress,
}: {
  icon: IconName;
  title: string;
  caption: string;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.actionCard, active ? styles.actionCardActive : null]}>
      <View style={[styles.actionIcon, active ? styles.actionIconActive : null]}>
        <Ionicons name={icon} size={19} color={active ? T.ink : T.primary} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.actionTitle}>{title}</Text>
        <Text numberOfLines={1} style={styles.actionCaption}>{caption}</Text>
      </View>
    </Pressable>
  );
}

function MetricTile({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <View style={[styles.metricTile, { borderColor: `${tone}44`, backgroundColor: `${tone}12` }]}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78} style={styles.metricValue}>
        {value}
      </Text>
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
  const [userCountry, setUserCountry] = useState<UserCountry | null | undefined>(undefined);

  const isNigeria = isNigeriaCountry(userCountry?.code || userCountry?.name);

  const { balance, error: walletSimpleErr, loading: walletLoading, reload: reloadWallet } = useWalletSimple();
  const tx = useWalletTxPaginated();

  const tabs: { key: NgnSection; label: string; icon: IconName; caption: string }[] = useMemo(
    () => [
      { key: "fund", label: "Fund", icon: "add-circle-outline", caption: "Top up" },
      { key: "send", label: "Send", icon: "send-outline", caption: "UID transfer" },
      { key: "withdraw", label: "Withdraw", icon: "business-outline", caption: "Bank payout" },
      { key: "history", label: "History", icon: "time-outline", caption: "Ledger" },
    ],
    [],
  );

  const txCount = tx.items.length;

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
          <ActivityIndicator color={T.primary} />
          <Text style={styles.loaderText}>Checking wallet region...</Text>
        </View>
      </LinearGradient>
    );
  }

  if (params.action === "crypto" || !isNigeria) {
    return <Redirect href="/market/wallet" />;
  }

  return (
    <LinearGradient colors={["#07100D", "#08141A", "#160B06"]} start={{ x: 0.08, y: 0 }} end={{ x: 0.94, y: 1 }} style={styles.screen}>
      <View style={[styles.container, isWide && styles.containerWide]}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.headerWrap}>
            <View style={styles.topRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.kicker}>Nigeria rail</Text>
                <Text style={styles.title}>NGN Wallet</Text>
                <Text style={styles.subTitle}>Bank-ready balance for local payments, bills, and transfers.</Text>
              </View>

              <View style={styles.topActions}>
                <Pressable style={styles.smallBtn} onPress={refreshAll}>
                  {walletLoading || tx.loading ? (
                    <ActivityIndicator color={T.primary} size="small" />
                  ) : (
                    <Ionicons name="refresh" size={18} color={T.text} />
                  )}
                </Pressable>

                <Pressable style={styles.smallBtn} onPress={() => setShowProfile(true)}>
                  <Ionicons name="person-circle-outline" size={19} color={T.text} />
                </Pressable>
              </View>
            </View>

            <LinearGradient
              colors={["rgba(45,212,191,0.2)", "rgba(56,189,248,0.12)", "rgba(244,183,93,0.16)"]}
              start={{ x: 0.05, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.heroCard}
            >
              <View style={styles.heroTop}>
                <View style={styles.brandMark}>
                  <Ionicons name="cash-outline" size={24} color={T.primary} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.heroKicker}>Available balance</Text>
                  <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={styles.balance}>
                    {balancesHidden ? maskBalanceValue("NGN") : `NGN ${formatNgn(balance)}`}
                  </Text>
                </View>
                <BalanceVisibilityToggle
                  hidden={balancesHidden}
                  onPress={() => {
                    void toggleBalancesHidden();
                  }}
                  size={42}
                />
              </View>

              <View style={styles.statusRow}>
                <View style={styles.statusPill}>
                  <Ionicons name="shield-checkmark-outline" size={13} color={T.primary} />
                  <Text style={styles.statusText}>Nigeria only</Text>
                </View>
                <View style={[styles.statusPill, styles.statusPillGold]}>
                  <Ionicons name="lock-closed-outline" size={13} color={T.gold} />
                  <Text style={[styles.statusText, { color: T.gold }]}>Biometric protected</Text>
                </View>
              </View>
            </LinearGradient>

            <View style={styles.metricGrid}>
              <MetricTile label="Rail" value="NGN" tone={T.primary} />
              <MetricTile label="Ledger" value={`${txCount} shown`} tone={T.accent} />
              <MetricTile label="Region" value="Nigeria" tone={T.gold} />
            </View>
          </View>

          {!!walletSimpleErr ? <Text style={styles.err}>{walletSimpleErr}</Text> : null}

          <View style={styles.actionGrid}>
            {tabs.map((t) => (
              <ActionCard
                key={t.key}
                icon={t.icon}
                title={t.label}
                caption={t.caption}
                active={section === t.key}
                onPress={() => setSection(t.key)}
              />
            ))}
          </View>

          {section === "fund" ? <FundWallet onSuccess={refreshAll} /> : null}
          {section === "send" ? <SendMoney onSuccess={refreshAll} /> : null}
          {section === "withdraw" ? <Withdraw onSuccess={refreshAll} /> : null}

          {section === "history" ? (
            <View style={styles.historyCard}>
              <View style={styles.historyHead}>
                <View>
                  <Text style={styles.hTitle}>Transaction ledger</Text>
                  <Text style={styles.hSub}>Deposits, withdrawals, transfers, bills, and fees.</Text>
                </View>
                <Pressable style={styles.refreshPill} onPress={tx.refresh}>
                  <Ionicons name="refresh" size={14} color={T.primary} />
                </Pressable>
              </View>

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
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.txAmount}>NGN {formatNgn(item.amount)}</Text>
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
  content: { paddingBottom: 26 },

  loaderWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  loaderText: { marginTop: 10, color: T.textMuted, fontWeight: "800" },

  err: { color: "#FCA5A5", paddingHorizontal: 16, marginTop: 8, fontWeight: "800" },
  dim: { color: T.textMuted, paddingHorizontal: 16, marginTop: 8 },

  headerWrap: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 },
  kicker: { color: T.primary, fontSize: 11, fontWeight: "900", textTransform: "uppercase" },
  title: { color: T.text, fontSize: 25, fontWeight: "900", marginTop: 2 },
  subTitle: { color: T.textMuted, fontSize: 12, marginTop: 5, lineHeight: 17 },
  topActions: { flexDirection: "row", gap: 10 },
  smallBtn: {
    width: 42,
    height: 42,
    borderRadius: 8,
    backgroundColor: T.card,
    borderWidth: 1,
    borderColor: T.border,
    alignItems: "center",
    justifyContent: "center",
  },

  heroCard: {
    marginTop: 14,
    borderRadius: 8,
    padding: 15,
    borderWidth: 1,
    borderColor: "rgba(255,253,247,0.14)",
    backgroundColor: "#090D0B",
  },
  heroTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  brandMark: {
    width: 52,
    height: 52,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: T.primarySoft,
    borderWidth: 1,
    borderColor: "rgba(45,212,191,0.36)",
  },
  heroKicker: {
    color: T.textDim,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  balance: { color: T.text, marginTop: 3, fontSize: 32, fontWeight: "900" },
  statusRow: {
    marginTop: 14,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: T.primarySoft,
    borderWidth: 1,
    borderColor: "rgba(45,212,191,0.32)",
  },
  statusPillGold: {
    backgroundColor: T.goldSoft,
    borderColor: "rgba(244,183,93,0.32)",
  },
  statusText: { color: T.primary, fontSize: 11, fontWeight: "900" },
  metricGrid: {
    flexDirection: "row",
    gap: 10,
    marginTop: 10,
  },
  metricTile: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    padding: 11,
  },
  metricLabel: { color: T.textDim, fontSize: 10, fontWeight: "900", textTransform: "uppercase" },
  metricValue: { color: T.text, fontSize: 14, fontWeight: "900", marginTop: 5 },

  actionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    paddingHorizontal: 16,
    marginTop: 10,
  },
  actionCard: {
    flexGrow: 1,
    flexBasis: 154,
    minHeight: 68,
    borderRadius: 8,
    padding: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: T.card,
    borderWidth: 1,
    borderColor: T.border,
  },
  actionCardActive: {
    backgroundColor: "rgba(45,212,191,0.15)",
    borderColor: "rgba(45,212,191,0.46)",
  },
  actionIcon: {
    width: 38,
    height: 38,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: T.primarySoft,
    borderWidth: 1,
    borderColor: "rgba(45,212,191,0.28)",
  },
  actionIconActive: {
    backgroundColor: T.primary,
    borderColor: T.primary,
  },
  actionTitle: { color: T.text, fontSize: 13, fontWeight: "900" },
  actionCaption: { color: T.textMuted, fontSize: 11, fontWeight: "700", marginTop: 3 },

  historyCard: {
    marginHorizontal: 16,
    marginTop: 12,
    backgroundColor: T.card,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 8,
    overflow: "hidden",
    paddingBottom: 10,
  },
  historyHead: {
    padding: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
    alignItems: "center",
  },
  hTitle: { color: T.text, fontWeight: "900", fontSize: 16 },
  hSub: { color: T.textMuted, fontSize: 12, marginTop: 4 },
  refreshPill: {
    width: 38,
    height: 38,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: T.primarySoft,
    borderWidth: 1,
    borderColor: "rgba(45,212,191,0.26)",
  },
  txRow: { flexDirection: "row", gap: 12, padding: 14, borderTopWidth: 1, borderTopColor: "rgba(255,253,247,0.08)" },
  txAmount: { color: T.text, fontWeight: "900" },
  txMeta: { color: T.textMuted, fontSize: 12, marginTop: 4 },
  txRef: { color: T.textDim, fontSize: 11, marginTop: 2 },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  badgeText: { fontWeight: "900", fontSize: 12 },
  loadMoreBtn: {
    marginTop: 10,
    marginHorizontal: 14,
    height: 46,
    borderRadius: 8,
    backgroundColor: T.primarySoft,
    borderWidth: 1,
    borderColor: "rgba(45,212,191,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  loadMoreText: { color: T.text, fontWeight: "900" },
});
