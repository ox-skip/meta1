import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Redirect, router } from "expo-router";
import React, { memo, useCallback, useEffect, useMemo } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import BalanceVisibilityToggle from "@/components/common/BalanceVisibilityToggle";
import { useAuth } from "@/hooks/authentication/useAuth";
import { maskBalanceValue, useBalanceVisibility } from "@/hooks/useBalanceVisibility";
import { useWalletSimple } from "@/hooks/wallet/useWalletSimple";
import { isNigeriaCountry, resolveUserCountry, type UserCountry } from "@/utils/country";

const ROUTES = {
  crypto: "/market/wallet",
  market: "/market",
  airtime: "./airtime",
  data: "./data",
  electricity: "./electricity",
  betting: "./betting",
  wallet: "./wallet",
  profile: "./profile",
} as const;

type RoutePath = (typeof ROUTES)[keyof typeof ROUTES];

const THEME = {
  PURPLE: "#7C3AED",
  BG0: "#05040B",
  BG1: "#0A0620",
  WHITE: "#FFFFFF",
  MUTED: "rgba(255,255,255,0.65)",
  CARD: "rgba(255,255,255,0.05)",
  CARD_BORDER: "rgba(255,255,255,0.08)",
};

function go(to: RoutePath) {
  router.push(to);
}

function goWallet(action: "fund" | "send" | "withdraw") {
  router.push({ pathname: "./wallet", params: { action } });
}

type TxItem = {
  id: string | number;
  type: string;
  amount: number | string;
  created_at: string | number | Date;
  reference?: string | null;
  counterpartyName?: string;
};

function safeNumber(v: unknown) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function formatNGN(value: unknown) {
  const n = safeNumber(value);
  // Intl is supported in modern Expo/Hermes, but keep a safe fallback.
  try {
    return new Intl.NumberFormat(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return n.toLocaleString();
  }
}

function formatDateTime(value: unknown) {
  const d = value instanceof Date ? value : new Date(value as any);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return d.toLocaleString();
  }
}

const PressableCard = memo(function PressableCard({
  onPress,
  style,
  children,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: {
  onPress: () => void;
  style?: any;
  children: React.ReactNode;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      android_ripple={Platform.OS === "android" ? { color: "rgba(255,255,255,0.10)" } : undefined}
      style={({ pressed }) => [
        style,
        pressed && Platform.OS === "ios" ? { opacity: 0.85, transform: [{ scale: 0.99 }] } : null,
      ]}
    >
      {children}
    </Pressable>
  );
});

const TxBadge = memo(function TxBadge({ type }: { type: string }) {
  const map: Record<string, { label: string; bg: string; fg: string }> = {
    deposit: { label: "Deposit", bg: "rgba(124,58,237,0.18)", fg: THEME.PURPLE },
    withdrawal: { label: "Withdraw", bg: "rgba(255,255,255,0.08)", fg: "#E5E7EB" },
    transfer_in: { label: "Received", bg: "rgba(16,185,129,0.12)", fg: "#10B981" },
    transfer_out: { label: "Sent", bg: "rgba(239,68,68,0.12)", fg: "#EF4444" },
    fee: { label: "Fee", bg: "rgba(255,255,255,0.08)", fg: "#E5E7EB" },
    bill: { label: "Bill", bg: "rgba(255,255,255,0.08)", fg: "#E5E7EB" },
  };
  const b = map[type] ?? { label: type, bg: "rgba(255,255,255,0.08)", fg: "#E5E7EB" };

  return (
    <View style={[styles.badge, { backgroundColor: b.bg, borderColor: `${b.fg}55` }]}>
      <Text style={[styles.badgeText, { color: b.fg }]} numberOfLines={1}>
        {b.label}
      </Text>
    </View>
  );
});

const SectionHeader = memo(function SectionHeader({
  title,
  hint,
  right,
}: {
  title: string;
  hint?: string;
  right?: React.ReactNode;
}) {
  return (
    <View style={[styles.sectionRowBetween, !right && styles.sectionRow]}>
      <View>
        <Text style={styles.sectionTitle}>{title}</Text>
        {!!hint && <Text style={styles.sectionHint}>{hint}</Text>}
      </View>
      {right ? <View style={styles.sectionRight}>{right}</View> : null}
    </View>
  );
});

const ActionButton = memo(function ActionButton({
  label,
  icon,
  onPress,
  variant = "ghost",
}: {
  label: string;
  icon: React.ReactNode;
  onPress: () => void;
  variant?: "primary" | "ghost";
}) {
  return (
    <PressableCard
      onPress={onPress}
      accessibilityLabel={label}
      accessibilityHint={`Open ${label}`}
      style={[styles.actionBtn, variant === "primary" && styles.primaryBtn]}
    >
      {icon}
      <Text style={styles.actionText}>{label}</Text>
    </PressableCard>
  );
});

const UtilityCard = memo(function UtilityCard({
  title,
  icon,
  onPress,
}: {
  title: string;
  icon: React.ReactNode;
  onPress: () => void;
}) {
  return (
    <PressableCard
      onPress={onPress}
      accessibilityLabel={title}
      accessibilityHint={`Open ${title}`}
      style={styles.utilCard}
    >
      <View style={styles.utilIcon}>{icon}</View>
      <Text style={styles.utilTitle}>{title}</Text>
      <Text style={styles.utilSub}>Fast checkout</Text>
    </PressableCard>
  );
});

const BigCard = memo(function BigCard({
  title,
  sub,
  icon,
  onPress,
}: {
  title: string;
  sub: string;
  icon: React.ReactNode;
  onPress: () => void;
}) {
  return (
    <PressableCard
      onPress={onPress}
      accessibilityLabel={title}
      accessibilityHint={`Open ${title}`}
      style={styles.bigCard}
    >
      <View style={styles.bigIconPurple}>{icon}</View>
      <Text style={styles.bigTitle}>{title}</Text>
      <Text style={styles.bigSub}>{sub}</Text>
    </PressableCard>
  );
});

export default function Dashboard() {
  const { balancesHidden, toggleBalancesHidden } = useBalanceVisibility();
  const insets = useSafeAreaInsets();
  const { user, loading: authLoading } = useAuth();
  const { balance, tx, loading: walletLoading, error, reload } = useWalletSimple();
  const [userCountry, setUserCountry] = React.useState<UserCountry | null>(null);
  const isNigeria = isNigeriaCountry(userCountry?.code || userCountry?.name);

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

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/(auth)/login");
    }
  }, [authLoading, user]);

  const refreshing = useMemo(() => authLoading || walletLoading, [authLoading, walletLoading]);
  const txPreview = useMemo(() => ((tx ?? []) as TxItem[]).slice(0, 6), [tx]);

  const utilities = useMemo(
    () => [
      { key: "airtime", title: "Airtime", icon: <Ionicons name="call" size={20} color="#fff" />, to: ROUTES.airtime },
      {
        key: "data",
        title: "Data",
        icon: <MaterialCommunityIcons name="access-point-network" size={20} color="#fff" />,
        to: ROUTES.data,
      },
      { key: "electricity", title: "Electricity", icon: <Ionicons name="flash" size={20} color="#fff" />, to: ROUTES.electricity },
      { key: "betting", title: "Betting", icon: <MaterialCommunityIcons name="soccer" size={20} color="#fff" />, to: ROUTES.betting },
    ],
    []
  );

  const onGoProfile = useCallback(() => go(ROUTES.profile), []);
  const onGoWallet = useCallback(() => {
    if (isNigeria) {
      go(ROUTES.wallet);
      return;
    }
    router.push({ pathname: ROUTES.wallet, params: { action: "crypto" } });
  }, [isNigeria]);
  const onGoCrypto = useCallback(() => go(ROUTES.crypto), []);
  const onGoMarket = useCallback(() => go(ROUTES.market), []);
  const onFund = useCallback(() => {
    if (!isNigeria) return;
    goWallet("fund");
  }, [isNigeria]);
  const onSend = useCallback(() => {
    if (!isNigeria) return;
    goWallet("send");
  }, [isNigeria]);
  const onWithdraw = useCallback(() => {
    if (!isNigeria) return;
    goWallet("withdraw");
  }, [isNigeria]);
  const onRefresh = useCallback(() => reload(), [reload]);

  // Prevent UI flicker while redirecting.
  if (!authLoading && !user) return null;
  if (userCountry !== undefined && !isNigeria) {
    return <Redirect href="/market/wallet" />;
  }

  return (
    <LinearGradient
      colors={[THEME.BG1, THEME.BG0]}
      start={{ x: 0.15, y: 0.0 }}
      end={{ x: 0.9, y: 1.0 }}
      style={[styles.screen, { paddingTop: Math.max(insets.top, 14) }]}
    >
      <StatusBar barStyle="light-content" />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Dashboard</Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {user?.email ? `Welcome back - ${user.email}` : "Welcome back"}
            </Text>
          </View>

          <PressableCard
            onPress={onGoProfile}
            accessibilityLabel="Profile"
            accessibilityHint="Open your profile"
            style={styles.iconBtn}
          >
            <Ionicons name="person-circle-outline" size={22} color="#fff" />
          </PressableCard>
        </View>

        {/* Wallet Card */}
        {isNigeria ? (
          <View style={styles.walletCard}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <Text style={styles.walletLabel}>Wallet Balance</Text>
                <BalanceVisibilityToggle
                  hidden={balancesHidden}
                  onPress={() => {
                    void toggleBalancesHidden();
                  }}
                  size={34}
                />
              </View>

              {walletLoading ? (
                <View style={{ marginTop: 10 }}>
                  <ActivityIndicator color="#fff" />
                </View>
              ) : (
                <Text style={styles.walletBalance} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                  {balancesHidden ? maskBalanceValue("NGN") : `NGN ${formatNGN(balance ?? 0)}`}
                </Text>
              )}

              {!!error && (
                <View style={styles.errorRow}>
                  <Text style={styles.err} numberOfLines={2}>
                    {error}
                  </Text>
                  <PressableCard
                    onPress={onRefresh}
                    accessibilityLabel="Retry"
                    accessibilityHint="Try reloading your wallet data"
                    style={styles.retryBtn}
                  >
                    <Text style={styles.retryText}>Retry</Text>
                  </PressableCard>
                </View>
              )}
            </View>

            <PressableCard
              onPress={onGoWallet}
              accessibilityLabel="Wallet"
              accessibilityHint="Open wallet"
              style={styles.pillBtn}
            >
              <Ionicons name="wallet-outline" size={16} color="#fff" />
              <Text style={styles.pillText}>Wallet</Text>
            </PressableCard>
          </View>
        ) : (
          <View style={styles.walletCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.walletLabel}>Crypto Wallet</Text>
              <Text style={styles.walletBalance} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                USDC / USDT
              </Text>
              <Text style={[styles.err, { marginTop: 6 }]}>NGN features are available only in Nigeria.</Text>
            </View>
            <PressableCard
              onPress={onGoWallet}
              accessibilityLabel="Crypto wallet"
              accessibilityHint="Open crypto wallet"
              style={styles.pillBtn}
            >
              <Ionicons name="wallet-outline" size={16} color="#fff" />
              <Text style={styles.pillText}>Crypto</Text>
            </PressableCard>
          </View>
        )}

        {/* Actions */}
        {isNigeria ? (
          <View style={styles.actions}>
            <ActionButton
              variant="primary"
              label="Fund"
              onPress={onFund}
              icon={<MaterialCommunityIcons name="cash-plus" size={18} color="#fff" />}
            />
            <ActionButton
              label="Send"
              onPress={onSend}
              icon={<Ionicons name="send-outline" size={18} color="#fff" />}
            />
            <ActionButton
              label="Withdraw"
              onPress={onWithdraw}
              icon={<MaterialCommunityIcons name="bank-transfer-out" size={18} color="#fff" />}
            />
          </View>
        ) : null}

        {/* Security */}
        <View style={styles.securityCard} accessibilityRole="summary" accessibilityLabel="Security notice">
          <View style={styles.securityIcon}>
            <Ionicons name="shield-checkmark-outline" size={18} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.securityTitle}>Secure actions</Text>
            <Text style={styles.securitySub}>Transfers and withdrawals require biometric or passcode.</Text>
          </View>
        </View>

        {/* Explore */}
        <SectionHeader title="Explore" hint="Wallet and marketplace" />

        <View style={styles.bigRow}>
          <BigCard
            title="Crypto"
            sub="Smart Account / WalletConnect"
            onPress={onGoCrypto}
            icon={<MaterialCommunityIcons name="bitcoin" size={34} color="#fff" />}
          />
          <BigCard
            title="Marketplace"
            sub="Buy - Sell - Escrow"
            onPress={onGoMarket}
            icon={<MaterialCommunityIcons name="storefront-outline" size={34} color="#fff" />}
          />
        </View>

        {/* Utilities */}
        {isNigeria ? (
          <>
            <SectionHeader title="Utilities" hint="Bills and payments" />

            <View style={styles.utilWrap}>
              {utilities.map((u) => (
                <UtilityCard key={u.key} title={u.title} icon={u.icon} onPress={() => go(u.to)} />
              ))}
            </View>
          </>
        ) : null}

        {/* History */}
        {isNigeria ? (
          <>
            <SectionHeader
              title="History"
              right={
                <PressableCard
                  onPress={onGoWallet}
                  accessibilityLabel="View all transactions"
                  accessibilityHint="Open wallet transaction history"
                  style={styles.linkBtn}
                >
                  <Text style={styles.link}>View all</Text>
                </PressableCard>
              }
            />

            <View style={styles.txCard}>
              <FlatList
                data={txPreview}
                keyExtractor={(i) => String(i.id)}
                scrollEnabled={false}
                removeClippedSubviews={Platform.OS === "android"}
                initialNumToRender={6}
                ListEmptyComponent={<Text style={styles.empty}>No transactions yet.</Text>}
                renderItem={({ item }) => (
                  <View style={styles.txRow}>
                    <TxBadge type={item.type} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.txAmount} numberOfLines={1}>
                        NGN {formatNGN(item.amount)}
                      </Text>
                      <Text style={styles.txMeta} numberOfLines={1}>
                        {item.counterpartyName ? `${item.counterpartyName} - ` : ""}
                        {formatDateTime(item.created_at)}
                        {item.reference ? ` - ${item.reference}` : ""}
                      </Text>
                    </View>
                  </View>
                )}
              />
            </View>
          </>
        ) : null}
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 16 },
  content: { paddingBottom: 24 },

  header: {
    paddingBottom: 14,
    flexDirection: "row",
    alignItems: "center",
  },
  title: { color: "#fff", fontSize: 24, fontWeight: "900" },
  subtitle: { color: THEME.MUTED, marginTop: 6, fontSize: 13 },
  iconBtn: {
    marginLeft: 12,
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },

  walletCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(124,58,237,0.40)",
    backgroundColor: "rgba(124,58,237,0.12)",
  },
  walletLabel: { color: "rgba(255,255,255,0.75)", fontWeight: "800", fontSize: 12 },
  walletBalance: { color: "#fff", fontWeight: "900", fontSize: 30, marginTop: 8 },
  errorRow: { marginTop: 10, flexDirection: "row", alignItems: "center" },
  err: { color: "#FCA5A5", fontSize: 12, flex: 1 },
  retryBtn: {
    marginLeft: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  retryText: { color: "#fff", fontWeight: "900", fontSize: 12 },

  pillBtn: {
    height: 46,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: THEME.PURPLE,
    borderWidth: 1,
    borderColor: THEME.PURPLE,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 12,
  },
  pillText: { color: "#fff", fontWeight: "900", marginLeft: 8 },

  actions: { marginTop: 12, flexDirection: "row" },
  actionBtn: {
    flex: 1,
    height: 56,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtn: { backgroundColor: THEME.PURPLE, borderColor: THEME.PURPLE },
  actionText: { color: "#fff", fontWeight: "900", marginLeft: 8 },

  securityCard: {
    marginTop: 12,
    borderRadius: 18,
    padding: 12,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    flexDirection: "row",
    alignItems: "center",
  },
  securityIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: "rgba(124,58,237,0.25)",
    borderWidth: 1,
    borderColor: "rgba(124,58,237,0.35)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  securityTitle: { color: "#fff", fontWeight: "900" },
  securitySub: { marginTop: 4, color: "rgba(255,255,255,0.6)", fontSize: 12 },

  sectionRow: { marginTop: 18, marginBottom: 10 },
  sectionRowBetween: {
    marginTop: 18,
    marginBottom: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionRight: { marginLeft: 10 },
  sectionTitle: { color: "#fff", fontWeight: "900", fontSize: 16 },
  sectionHint: { color: "rgba(255,255,255,0.55)", marginTop: 4, fontSize: 12 },
  linkBtn: { paddingVertical: 6, paddingHorizontal: 6, borderRadius: 10 },
  link: { color: "#C4B5FD", fontWeight: "900" },

  bigRow: { flexDirection: "row" },
  bigCard: {
    flex: 1,
    minHeight: 170,
    borderRadius: 22,
    padding: 16,
    backgroundColor: THEME.CARD,
    borderWidth: 1,
    borderColor: THEME.CARD_BORDER,
  },
  bigIconPurple: {
    width: 54,
    height: 54,
    borderRadius: 18,
    backgroundColor: "rgba(124,58,237,0.25)",
    borderWidth: 1,
    borderColor: "rgba(124,58,237,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  bigTitle: { marginTop: 12, color: "#fff", fontWeight: "900", fontSize: 15 },
  bigSub: { marginTop: 6, color: "rgba(255,255,255,0.65)", fontSize: 12 },

  utilWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  utilCard: {
    width: "48%",
    minHeight: 128,
    borderRadius: 22,
    padding: 16,
    backgroundColor: THEME.CARD,
    borderWidth: 1,
    borderColor: THEME.CARD_BORDER,
    marginBottom: 12,
  },
  utilIcon: {
    width: 46,
    height: 46,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  utilTitle: { marginTop: 12, color: "#fff", fontWeight: "900", fontSize: 14 },
  utilSub: { marginTop: 6, color: "rgba(255,255,255,0.6)", fontSize: 12 },

  txCard: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: THEME.CARD_BORDER,
    backgroundColor: THEME.CARD,
    overflow: "hidden",
  },
  txRow: {
    flexDirection: "row",
    padding: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.10)",
    alignItems: "center",
  },
  txAmount: { color: "#fff", fontWeight: "900" },
  txMeta: { color: "rgba(255,255,255,0.6)", fontSize: 12, marginTop: 4 },
  empty: { color: "rgba(255,255,255,0.65)", padding: 14 },

  badge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    alignSelf: "flex-start",
    marginRight: 12,
    maxWidth: 110,
  },
  badgeText: { fontWeight: "900", fontSize: 12 },
});

// Manual spacing for rows where we previously used `gap` (more RN-version safe)
const _orig = styles.bigCard;
styles.bigCard = [styles.bigCard, { marginRight: 12 } as any] as any;
// Fix last card margin in bigRow at runtime via style override in JSX if you prefer.
// Keeping it simple: you can remove this and set marginRight in JSX if desired.


