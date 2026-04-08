import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";

import AppHeader from "@/components/common/AppHeader";
import BalanceVisibilityToggle from "@/components/common/BalanceVisibilityToggle";
import { useUnifiedWallet } from "@/components/market/wallet/useUnifiedWallet";
import { maskBalanceValue, useBalanceVisibility } from "@/hooks/useBalanceVisibility";
import { supabase } from "@/services/supabase";
import { formatCountryLabel } from "@/utils/countryNames";

type TxRow = {
  id: string;
  created_at: string;
  intent_type: string;
  status: string;
  chain: string;
  tx_hash: string | null;
  from_wallet?: string | null;
  to_wallet?: string | null;
};

function isAddress(v?: string | null) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(v || ""));
}

function lowerHex(v?: string | null) {
  return String(v || "").trim().toLowerCase();
}

function shouldShowTxForAddress(tx: TxRow, addr: string) {
  const who = lowerHex(addr);
  if (!who) return false;
  const from = lowerHex(tx.from_wallet);
  const to = lowerHex(tx.to_wallet);
  const mineFrom = from === who;
  const mineTo = to === who;
  const kind = String(tx.intent_type || "").toUpperCase();
  if (kind === "DEPOSIT") return mineFrom;
  return mineFrom || mineTo;
}

function fmt(value: number, digits = 2) {
  const n = Number(value || 0);
  return Number.isFinite(n)
    ? n.toLocaleString(undefined, { maximumFractionDigits: digits })
    : "0";
}

function shortAddr(value?: string | null) {
  const v = String(value || "").trim();
  if (!v) return "Not connected";
  if (isAddress(v)) return `${v.slice(0, 6)}...${v.slice(-4)}`;
  if (v.length <= 18) return v;
  return `${v.slice(0, 10)}...${v.slice(-6)}`;
}

function shortValue(value?: string | null) {
  const v = String(value || "").trim();
  if (!v) return "Not set";
  if (v.length <= 18) return v;
  return `${v.slice(0, 10)}...${v.slice(-6)}`;
}

function chainLabel(raw?: string | null) {
  return String(raw || "").toUpperCase().replace(/_/g, " ");
}

function walletModeLabel(mode?: "base_smart" | "walletconnect" | null) {
  if (mode === "base_smart") return "Base wallet";
  if (mode === "walletconnect") return "WalletConnect";
  return "Wallet";
}

function statusTone(status?: string | null) {
  const s = String(status || "").toUpperCase();
  if (["COMPLETED", "SUCCESS", "CONFIRMED", "FINALIZED"].includes(s)) {
    return { bg: "rgba(16,185,129,0.18)", border: "rgba(16,185,129,0.35)", text: "#A7F3D0" };
  }
  if (["FAILED", "REVERTED", "ERROR", "CANCELLED"].includes(s)) {
    return { bg: "rgba(239,68,68,0.16)", border: "rgba(239,68,68,0.35)", text: "#FECACA" };
  }
  return { bg: "rgba(255,255,255,0.06)", border: "rgba(255,255,255,0.12)", text: "#E5E7EB" };
}

function firstValidAddress(...values: Array<string | null | undefined>) {
  for (const value of values) {
    if (isAddress(value)) return String(value);
  }
  return "";
}

function MetricCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint: string;
  accent: string;
}) {
  return (
    <View style={[styles.metricCard, { borderColor: `${accent}55`, backgroundColor: `${accent}18` }]}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricHint}>{hint}</Text>
    </View>
  );
}

function ActionTile({
  icon,
  title,
  subtitle,
  onPress,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.actionTile, disabled ? styles.dimmed : undefined]}>
      <View style={styles.actionIcon}>
        <Ionicons name={icon} size={18} color="#F8FAFC" />
      </View>
      <Text style={styles.actionTitle}>{title}</Text>
      <Text style={styles.actionSubtitle}>{subtitle}</Text>
    </Pressable>
  );
}

function TokenChip({
  active,
  label,
  disabled,
  onPress,
}: {
  active: boolean;
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.tokenChip,
        active ? styles.tokenChipActive : undefined,
        disabled ? styles.dimmed : undefined,
      ]}
    >
      <Text style={styles.tokenChipText}>{label}</Text>
    </Pressable>
  );
}

function AddressCard({
  label,
  value,
  note,
  actionLabel,
  onAction,
}: {
  label: string;
  value: string;
  note: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.addressCard}>
      <View style={{ flex: 1 }}>
        <Text style={styles.addressLabel}>{label}</Text>
        <Text style={styles.addressValue}>{value}</Text>
        <Text style={styles.addressNote}>{note}</Text>
      </View>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} style={styles.inlineButton}>
          <Text style={styles.inlineButtonText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export default function MarketWallet() {
  const { width } = useWindowDimensions();
  const wide = width >= 980;
  const wallet = useUnifiedWallet();
  const { balancesHidden, toggleBalancesHidden } = useBalanceVisibility();

  const [piInput, setPiInput] = useState("");
  const [sendTo, setSendTo] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [sendToken, setSendToken] = useState<"USDC" | "USDT">("USDC");
  const [txs, setTxs] = useState<TxRow[]>([]);
  const [txLoading, setTxLoading] = useState(false);
  const [netOpen, setNetOpen] = useState(false);

  useEffect(() => {
    setPiInput(wallet.savedPiAddress || "");
  }, [wallet.savedPiAddress]);

  const loadTx = useCallback(
    async (addrInput?: string) => {
      const addr = String(addrInput || wallet.connectedAddress || wallet.savedAddress || "").trim();
      if (!isAddress(addr)) {
        setTxs([]);
        return;
      }
      try {
        setTxLoading(true);
        const { data, error } = await supabase
          .from("market_crypto_intents")
          .select("id,created_at,intent_type,status,chain,tx_hash,from_wallet,to_wallet")
          .or(`from_wallet.eq.${addr},to_wallet.eq.${addr}`)
          .order("created_at", { ascending: false })
          .limit(12);
        if (error) throw error;
        const rows = ((data as TxRow[]) || []).filter((row) => shouldShowTxForAddress(row, addr));
        setTxs(rows);
      } catch {
        setTxs([]);
      } finally {
        setTxLoading(false);
      }
    },
    [wallet.connectedAddress, wallet.savedAddress],
  );

  useEffect(() => {
    void loadTx();
  }, [loadTx, wallet.chain?.chain, wallet.connectedAddress, wallet.savedAddress]);

  async function copyText(value: string, successMessage: string) {
    if (!value) return;
    try {
      await Clipboard.setStringAsync(value);
      Alert.alert("Copied", successMessage);
    } catch {
      Alert.alert("Copy failed", "Unable to copy right now.");
    }
  }

  async function onSavePiWallet() {
    try {
      const out = await wallet.savePiAddress(piInput);
      const next = String((out as any)?.address || "").trim();
      setPiInput(next);
      Alert.alert("Saved", next ? "PI wallet address updated." : "PI wallet address cleared.");
    } catch (e: any) {
      Alert.alert("Save failed", String(e?.message || e || "Unable to save PI wallet address."));
    }
  }

  async function onConnect() {
    await wallet.connectWallet();
    await loadTx();
  }

  async function onUseConnected() {
    await wallet.useConnectedWallet();
    await loadTx();
  }

  async function onDisconnect() {
    await wallet.disconnectWallet();
    await loadTx();
  }

  async function onSend() {
    try {
      const out = await wallet.sendStableToken({
        symbol: sendToken,
        to: sendTo.trim(),
        amount: sendAmount.trim(),
      });
      setSendTo("");
      setSendAmount("");
      Alert.alert("Transfer submitted", `Tx: ${String((out as any)?.txHash || "")}`);
      await wallet.refreshAll();
      await loadTx();
    } catch (e: any) {
      Alert.alert("Transfer failed", String(e?.message || e || "Unable to send crypto right now."));
    }
  }

  const locationText = useMemo(() => {
    if (!wallet.country) return "Location unavailable";
    return [wallet.country.city, wallet.country.region, formatCountryLabel(wallet.country.name, wallet.country.code)]
      .filter(Boolean)
      .join(", ");
  }, [wallet.country]);

  const connected = Boolean(wallet.connectedAddress);
  const activeWalletMode = wallet.connectedMode ?? wallet.walletMode;
  const activeWalletModeLabel = walletModeLabel(activeWalletMode);
  const walletConnectBlocked = Boolean(wallet.connectedMode && wallet.connectedMode !== "walletconnect");
  const baseSmartBlocked = Boolean(wallet.connectedMode && wallet.connectedMode !== "base_smart");
  const primaryAddress = useMemo(
    () => firstValidAddress(wallet.connectedAddress, wallet.savedAddress),
    [wallet.connectedAddress, wallet.savedAddress],
  );
  const usingPiChain = String(wallet.chain?.chain || "").toLowerCase().includes("pi");
  const canSendUsdc = isAddress(wallet.chain?.usdc_address || "");
  const canSendUsdt = isAddress(wallet.chain?.usdt_address || "");
  const canSend =
    !wallet.sendBusy &&
    !!wallet.chain?.active &&
    !!sendTo.trim() &&
    !!sendAmount.trim() &&
    (sendToken === "USDC" ? canSendUsdc : canSendUsdt);
  const portfolioRows = wallet.portfolioPositions.slice(0, 6);

  return (
    <LinearGradient colors={["#041815", "#071018", "#160B06"]} style={{ flex: 1 }}>
      <View style={[styles.page, wide ? styles.pageWide : undefined]}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 30 }}>
          <AppHeader title="Wallet Hub" subtitle="Stablecoins, payouts, and market portfolio" />
          <LinearGradient colors={["rgba(13,148,136,0.22)", "rgba(245,158,11,0.18)"]} style={styles.hero}>
            <View style={styles.heroTop}>
              <View style={[styles.statusPill, connected ? styles.connectedPill : styles.idlePill]}>
                <Text style={styles.statusPillText}>{connected ? `Connected via ${activeWalletModeLabel}` : "Not connected"}</Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <BalanceVisibilityToggle
                  hidden={balancesHidden}
                  onPress={() => {
                    void toggleBalancesHidden();
                  }}
                />
                {connected ? (
                  <Pressable onPress={onDisconnect} disabled={wallet.busy} style={[styles.iconButton, wallet.busy ? styles.dimmed : undefined]}>
                    <Ionicons name="power-outline" size={16} color="#F8FAFC" />
                  </Pressable>
                ) : null}
                <Pressable onPress={() => router.push("/market/history" as any)} style={styles.heroGhostButton}>
                  <Ionicons name="time-outline" size={16} color="#F8FAFC" />
                  <Text style={styles.heroGhostText}>History</Text>
                </Pressable>
              </View>
            </View>

            <Text style={styles.heroEyebrow}>TOTAL VALUE</Text>
            <Text style={styles.heroAmount}>
              {balancesHidden ? maskBalanceValue("$") : `$${fmt(wallet.overallUsdApprox)}`}
            </Text>
            <Text style={styles.heroSubtext}>
              {balancesHidden
                ? "Stable $****** / Stock $******"
                : `Stable $${fmt(wallet.stableTotalUsd)} / Stock $${fmt(wallet.portfolioTotalUsdc)}`}
            </Text>
            <Text style={styles.heroLocation}>{locationText}</Text>

            <View style={styles.metricGrid}>
              <MetricCard label="USDC" value={balancesHidden ? "******" : fmt(wallet.usdcBalance, 6)} hint="Available now" accent="#0EA5A4" />
              <MetricCard label="USDT" value={balancesHidden ? "******" : fmt(wallet.usdtBalance, 6)} hint="Cross-chain stable" accent="#F59E0B" />
              <MetricCard
                label={wallet.isNigeria ? "NGN" : "Stocks"}
                value={balancesHidden ? (wallet.isNigeria ? "******" : maskBalanceValue("$")) : wallet.isNigeria ? fmt(wallet.ngnBalance) : `$${fmt(wallet.portfolioTotalUsdc)}`}
                hint={wallet.isNigeria ? "Local wallet balance" : `${wallet.portfolioPositions.length} holdings`}
                accent="#60A5FA"
              />
            </View>

            <View style={styles.heroFooter}>
              <Text style={styles.heroFooterText}>Network: {wallet.chain ? chainLabel(wallet.chain.chain) : "Select network"}</Text>
              <Text style={styles.heroFooterText}>Mode: {activeWalletModeLabel}</Text>
            </View>
          </LinearGradient>

          {!!wallet.error ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{wallet.error}</Text>
            </View>
          ) : null}

          <View style={[styles.layout, wide ? styles.layoutWide : undefined]}>
            <View style={styles.mainCol}>
              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>Actions</Text>
                <View style={styles.actionsGrid}>
                  <ActionTile
                    icon="refresh-outline"
                    title="Refresh"
                    subtitle="Reload balances and wallet state"
                    onPress={async () => {
                      await wallet.refreshAll();
                      await loadTx();
                    }}
                    disabled={wallet.busy}
                  />
                  <ActionTile
                    icon="git-network-outline"
                    title="Network"
                    subtitle={wallet.chain ? chainLabel(wallet.chain.chain) : "Choose active network"}
                    onPress={() => setNetOpen(true)}
                  />
                  <ActionTile
                    icon={usingPiChain ? "logo-usd" : connected ? "power-outline" : "wallet-outline"}
                    title={usingPiChain ? "PI mode" : connected ? "Disconnect" : "Connect"}
                    subtitle={
                      usingPiChain
                        ? "PI uses saved payout address"
                        : connected
                          ? `End the ${activeWalletModeLabel} session before switching engines`
                          : "Open wallet connection flow"
                    }
                    onPress={connected ? onDisconnect : onConnect}
                    disabled={usingPiChain || !wallet.chain?.active || wallet.busy}
                  />
                  <ActionTile
                    icon="swap-horizontal-outline"
                    title="Use device"
                    subtitle="Replace saved wallet with connected device"
                    onPress={onUseConnected}
                    disabled={!wallet.chain?.active || wallet.busy || !wallet.connectedAddress}
                  />
                </View>

                <View style={{ marginTop: 12, gap: 8 }}>
                  <Text style={styles.helperText}>Wallet engine</Text>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Pressable
                      onPress={() => {
                        void wallet.setWalletMode("walletconnect");
                      }}
                      disabled={walletConnectBlocked}
                      style={[
                        styles.secondaryButton,
                        {
                          flex: 1,
                          borderColor: activeWalletMode === "walletconnect" ? "rgba(96,165,250,0.38)" : "rgba(255,255,255,0.10)",
                          backgroundColor: activeWalletMode === "walletconnect" ? "rgba(59,130,246,0.14)" : "rgba(255,255,255,0.05)",
                        },
                        walletConnectBlocked ? styles.dimmed : undefined,
                      ]}
                    >
                      <Text style={styles.secondaryButtonText}>WalletConnect</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        void wallet.setWalletMode("base_smart");
                      }}
                      disabled={!wallet.baseSmartSupported || baseSmartBlocked}
                      style={[
                        styles.secondaryButton,
                        {
                          flex: 1,
                          borderColor: activeWalletMode === "base_smart" ? "rgba(45,212,191,0.38)" : "rgba(255,255,255,0.10)",
                          backgroundColor: activeWalletMode === "base_smart" ? "rgba(13,148,136,0.14)" : "rgba(255,255,255,0.05)",
                        },
                        !wallet.baseSmartSupported || baseSmartBlocked ? styles.dimmed : undefined,
                      ]}
                    >
                      <Text style={styles.secondaryButtonText}>Base wallet</Text>
                    </Pressable>
                  </View>
                </View>

                {!wallet.baseSmartSupported ? (
                  <Text style={styles.helperText}>Base smart mode is currently available on web.</Text>
                ) : null}
                {connected ? (
                  <Text style={styles.helperText}>Disconnect {activeWalletModeLabel} before switching wallet engines.</Text>
                ) : null}
              </View>

              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>Transfer</Text>
                <Text style={styles.sectionCopy}>
                  Send market stablecoins directly from this wallet without leaving the app.
                </Text>

                <View style={styles.tokenRow}>
                  <TokenChip
                    active={sendToken === "USDC"}
                    label="USDC"
                    disabled={!canSendUsdc}
                    onPress={() => setSendToken("USDC")}
                  />
                  <TokenChip
                    active={sendToken === "USDT"}
                    label="USDT"
                    disabled={!canSendUsdt}
                    onPress={() => setSendToken("USDT")}
                  />
                </View>

                <TextInput
                  value={sendTo}
                  onChangeText={setSendTo}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="Recipient wallet address"
                  placeholderTextColor="rgba(255,255,255,0.38)"
                  style={styles.input}
                />
                <TextInput
                  value={sendAmount}
                  onChangeText={setSendAmount}
                  keyboardType="decimal-pad"
                  placeholder={`Amount in ${sendToken}`}
                  placeholderTextColor="rgba(255,255,255,0.38)"
                  style={[styles.input, { marginTop: 10 }]}
                />

                <View style={styles.transferMetaRow}>
                  <Text style={styles.transferMetaText}>
                    Balance: {balancesHidden ? "******" : sendToken === "USDT" ? fmt(wallet.usdtBalance, 6) : fmt(wallet.usdcBalance, 6)} {sendToken}
                  </Text>
                  {sendToken === "USDC" && !canSendUsdc ? (
                    <Text style={styles.transferMetaText}>USDC is not configured on this network.</Text>
                  ) : null}
                  {sendToken === "USDT" && !canSendUsdt ? (
                    <Text style={styles.transferMetaText}>USDT is not configured on this network.</Text>
                  ) : null}
                </View>

                <Pressable onPress={onSend} disabled={!canSend} style={[styles.primaryButton, !canSend ? styles.dimmed : undefined]}>
                  {wallet.sendBusy ? <ActivityIndicator color="#061311" /> : null}
                  <Text style={styles.primaryButtonText}>{wallet.sendBusy ? "Sending..." : `Send ${sendToken}`}</Text>
                </Pressable>
              </View>

              <View style={styles.sectionCard}>
                <View style={styles.sectionRow}>
                  <Text style={styles.sectionTitle}>Recent chain activity</Text>
                  <Pressable
                    onPress={() => loadTx()}
                    disabled={wallet.busy || txLoading}
                    style={styles.iconButton}
                  >
                    {txLoading ? <ActivityIndicator size="small" /> : <Ionicons name="refresh" size={15} color="#F8FAFC" />}
                  </Pressable>
                </View>

                {txs.length === 0 ? (
                  <View style={styles.emptyState}>
                    <Ionicons name="hourglass-outline" size={18} color="rgba(255,255,255,0.52)" />
                    <Text style={styles.emptyStateText}>No crypto activity for this wallet yet.</Text>
                  </View>
                ) : (
                  <View style={{ gap: 10 }}>
                    {txs.map((item) => {
                      const tone = statusTone(item.status);
                      return (
                        <View key={item.id} style={styles.activityCard}>
                          <View style={styles.sectionRow}>
                            <Text style={styles.activityTitle}>{item.intent_type || "Intent"}</Text>
                            <View style={[styles.activityStatus, { backgroundColor: tone.bg, borderColor: tone.border }]}>
                              <Text style={[styles.activityStatusText, { color: tone.text }]}>{item.status || "PENDING"}</Text>
                            </View>
                          </View>
                          <Text style={styles.activityMeta}>{new Date(item.created_at).toLocaleString()}</Text>
                          <Text style={styles.activityMeta}>{chainLabel(item.chain)}</Text>
                          {!!item.tx_hash ? (
                            <Text numberOfLines={1} style={styles.activityMeta}>
                              Tx: {item.tx_hash}
                            </Text>
                          ) : null}
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            </View>

            <View style={styles.sideCol}>
              <View style={styles.sectionCard}>
                <View style={styles.sectionRow}>
                  <Text style={styles.sectionTitle}>Wallet identity</Text>
                  <Pressable onPress={() => setNetOpen(true)} style={styles.inlineButton}>
                    <Text style={styles.inlineButtonText}>Switch</Text>
                  </Pressable>
                </View>
                <Text style={styles.sectionCopy}>
                  Your market wallet is used for stored checkout settings. The active device session is locked to one wallet engine at a time.
                </Text>

                <AddressCard
                  label="Market wallet"
                  value={shortAddr(wallet.savedAddress)}
                  note={wallet.chain ? chainLabel(wallet.chain.chain) : "No network selected"}
                  actionLabel={primaryAddress ? "Copy" : undefined}
                  onAction={primaryAddress ? () => copyText(primaryAddress, "Wallet address copied.") : undefined}
                />
                <AddressCard
                  label="Device session"
                  value={shortAddr(wallet.connectedAddress)}
                  note={wallet.connectedAddress ? `${activeWalletModeLabel} is currently connected` : "No device wallet session"}
                />
                <AddressCard
                  label="PI payout"
                  value={shortValue(wallet.savedPiAddress)}
                  note="Used for PI settlements when needed"
                  actionLabel={wallet.savedPiAddress ? "Copy" : undefined}
                  onAction={
                    wallet.savedPiAddress
                      ? () => copyText(wallet.savedPiAddress, "PI wallet address copied.")
                      : undefined
                  }
                />

                <TextInput
                  value={piInput}
                  onChangeText={setPiInput}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="Save or update PI wallet address"
                  placeholderTextColor="rgba(255,255,255,0.38)"
                  style={[styles.input, { marginTop: 12 }]}
                />
                <Pressable
                  onPress={onSavePiWallet}
                  disabled={wallet.piSaving || piInput.trim() === String(wallet.savedPiAddress || "").trim()}
                  style={[styles.secondaryButton, wallet.piSaving ? styles.dimmed : undefined]}
                >
                  <Text style={styles.secondaryButtonText}>{wallet.piSaving ? "Saving..." : "Save PI wallet"}</Text>
                </Pressable>
              </View>

              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>Portfolio snapshot</Text>
                <Text style={styles.sectionCopy}>
                  Stocks and wallet balances shown together so you can judge usable buying power quickly.
                </Text>

                <View style={styles.portfolioSummary}>
                  <View style={styles.portfolioPill}>
                    <Text style={styles.portfolioPillLabel}>Stable</Text>
                    <Text style={styles.portfolioPillValue}>
                      {balancesHidden ? maskBalanceValue("$") : `$${fmt(wallet.stableTotalUsd)}`}
                    </Text>
                  </View>
                  <View style={styles.portfolioPill}>
                    <Text style={styles.portfolioPillLabel}>Stocks</Text>
                    <Text style={styles.portfolioPillValue}>
                      {balancesHidden ? maskBalanceValue("$") : `$${fmt(wallet.portfolioTotalUsdc)}`}
                    </Text>
                  </View>
                </View>

                {portfolioRows.length === 0 ? (
                  <View style={styles.emptyState}>
                    <Ionicons name="bar-chart-outline" size={18} color="rgba(255,255,255,0.52)" />
                    <Text style={styles.emptyStateText}>No stock holdings yet.</Text>
                  </View>
                ) : (
                  <View style={{ gap: 10 }}>
                    {portfolioRows.map((row) => (
                      <View key={`${row.stock_id}-${row.slug}`} style={styles.holdingRow}>
                        <View style={{ flex: 1 }}>
                          <Text numberOfLines={1} style={styles.holdingTitle}>
                            {row.name}
                          </Text>
                          <Text style={styles.holdingMeta}>
                            {row.symbol || "STK"} · Qty {fmt(row.qty, 4)}
                          </Text>
                        </View>
                        <Text style={styles.holdingValue}>
                          {balancesHidden ? maskBalanceValue("$") : `$${fmt(row.value_usdc)}`}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            </View>
          </View>
        </ScrollView>
      </View>

      <Modal visible={netOpen} transparent animationType="fade" onRequestClose={() => setNetOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionTitle}>Select network</Text>
              <Pressable onPress={() => setNetOpen(false)} style={styles.iconButton}>
                <Ionicons name="close" size={18} color="#F8FAFC" />
              </Pressable>
            </View>
            {wallet.chains.map((chain) => (
              <Pressable
                key={chain.chain}
                disabled={!chain.active}
                onPress={async () => {
                  setNetOpen(false);
                  await wallet.selectChain(chain);
                  await loadTx();
                }}
                style={[styles.networkRow, !chain.active ? styles.dimmed : undefined]}
              >
                <View>
                  <Text style={styles.networkTitle}>{chainLabel(chain.chain)}</Text>
                  <Text style={styles.networkMeta}>{chain.active ? "Ready" : "Inactive"}</Text>
                </View>
                {wallet.chain?.chain === chain.chain ? (
                  <Ionicons name="checkmark-circle" size={18} color="#2DD4BF" />
                ) : null}
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    width: "100%",
    alignSelf: "center",
  },
  pageWide: {
    maxWidth: 1180,
  },
  hero: {
    marginTop: 12,
    borderRadius: 28,
    padding: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(7,18,24,0.86)",
  },
  heroTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  statusPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  connectedPill: {
    backgroundColor: "rgba(16,185,129,0.16)",
    borderColor: "rgba(16,185,129,0.35)",
  },
  idlePill: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderColor: "rgba(255,255,255,0.12)",
  },
  statusPillText: {
    color: "#F8FAFC",
    fontWeight: "900",
    fontSize: 11,
  },
  heroGhostButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  heroGhostText: {
    color: "#F8FAFC",
    fontWeight: "900",
    fontSize: 12,
  },
  heroEyebrow: {
    marginTop: 18,
    color: "rgba(248,250,252,0.62)",
    fontWeight: "800",
    fontSize: 11,
    letterSpacing: 1,
  },
  heroAmount: {
    marginTop: 8,
    color: "#F8FAFC",
    fontWeight: "900",
    fontSize: 34,
  },
  heroSubtext: {
    marginTop: 6,
    color: "rgba(248,250,252,0.72)",
    fontSize: 13,
  },
  heroLocation: {
    marginTop: 12,
    color: "rgba(248,250,252,0.58)",
    fontSize: 12,
  },
  metricGrid: {
    marginTop: 16,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  metricCard: {
    flexGrow: 1,
    minWidth: 96,
    borderRadius: 18,
    padding: 12,
    borderWidth: 1,
  },
  metricLabel: {
    color: "rgba(248,250,252,0.62)",
    fontWeight: "800",
    fontSize: 10,
  },
  metricValue: {
    marginTop: 6,
    color: "#F8FAFC",
    fontWeight: "900",
    fontSize: 17,
  },
  metricHint: {
    marginTop: 4,
    color: "rgba(248,250,252,0.58)",
    fontSize: 11,
  },
  heroFooter: {
    marginTop: 14,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 8,
  },
  heroFooterText: {
    color: "rgba(248,250,252,0.72)",
    fontWeight: "700",
    fontSize: 12,
  },
  errorCard: {
    marginTop: 12,
    borderRadius: 18,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.35)",
    backgroundColor: "rgba(239,68,68,0.16)",
  },
  errorText: {
    color: "#FECACA",
    fontWeight: "800",
    fontSize: 12,
  },
  layout: {
    marginTop: 14,
    gap: 14,
  },
  layoutWide: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  mainCol: {
    flex: 1.35,
    gap: 14,
  },
  sideCol: {
    flex: 1,
    gap: 14,
  },
  sectionCard: {
    borderRadius: 24,
    padding: 16,
    backgroundColor: "rgba(6,16,20,0.82)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    gap: 12,
  },
  sectionTitle: {
    color: "#F8FAFC",
    fontWeight: "900",
    fontSize: 16,
  },
  sectionCopy: {
    color: "rgba(248,250,252,0.64)",
    fontSize: 12,
    lineHeight: 18,
  },
  sectionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  actionsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  actionTile: {
    width: "48%",
    borderRadius: 18,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  actionIcon: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(13,148,136,0.20)",
    borderWidth: 1,
    borderColor: "rgba(45,212,191,0.30)",
  },
  actionTitle: {
    marginTop: 12,
    color: "#F8FAFC",
    fontWeight: "900",
    fontSize: 13,
  },
  actionSubtitle: {
    marginTop: 5,
    color: "rgba(248,250,252,0.58)",
    fontSize: 11,
    lineHeight: 16,
  },
  helperText: {
    color: "rgba(248,250,252,0.54)",
    fontSize: 11,
  },
  tokenRow: {
    flexDirection: "row",
    gap: 8,
  },
  tokenChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  tokenChipActive: {
    borderColor: "rgba(45,212,191,0.42)",
    backgroundColor: "rgba(13,148,136,0.18)",
  },
  tokenChipText: {
    color: "#F8FAFC",
    fontWeight: "900",
    fontSize: 12,
  },
  input: {
    height: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.04)",
    color: "#F8FAFC",
    paddingHorizontal: 14,
    fontWeight: "700",
  },
  transferMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 8,
  },
  transferMetaText: {
    color: "rgba(248,250,252,0.56)",
    fontSize: 11,
  },
  primaryButton: {
    height: 46,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    backgroundColor: "#F59E0B",
    borderWidth: 1,
    borderColor: "#F59E0B",
  },
  primaryButtonText: {
    color: "#061311",
    fontWeight: "900",
    fontSize: 14,
  },
  secondaryButton: {
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  secondaryButtonText: {
    color: "#F8FAFC",
    fontWeight: "900",
    fontSize: 13,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  emptyState: {
    borderRadius: 18,
    padding: 14,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  emptyStateText: {
    color: "rgba(248,250,252,0.60)",
    fontSize: 12,
  },
  activityCard: {
    borderRadius: 16,
    padding: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  activityTitle: {
    color: "#F8FAFC",
    fontWeight: "900",
    fontSize: 13,
  },
  activityStatus: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  activityStatusText: {
    fontWeight: "900",
    fontSize: 10,
  },
  activityMeta: {
    marginTop: 4,
    color: "rgba(248,250,252,0.56)",
    fontSize: 11,
  },
  addressCard: {
    borderRadius: 18,
    padding: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  addressLabel: {
    color: "rgba(248,250,252,0.56)",
    fontWeight: "800",
    fontSize: 11,
  },
  addressValue: {
    marginTop: 6,
    color: "#F8FAFC",
    fontWeight: "900",
    fontSize: 13,
  },
  addressNote: {
    marginTop: 6,
    color: "rgba(248,250,252,0.54)",
    fontSize: 11,
  },
  inlineButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  inlineButtonText: {
    color: "#F8FAFC",
    fontWeight: "900",
    fontSize: 11,
  },
  portfolioSummary: {
    flexDirection: "row",
    gap: 10,
  },
  portfolioPill: {
    flex: 1,
    borderRadius: 18,
    padding: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  portfolioPillLabel: {
    color: "rgba(248,250,252,0.56)",
    fontWeight: "800",
    fontSize: 11,
  },
  portfolioPillValue: {
    marginTop: 6,
    color: "#F8FAFC",
    fontWeight: "900",
    fontSize: 15,
  },
  holdingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 16,
    padding: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  holdingTitle: {
    color: "#F8FAFC",
    fontWeight: "900",
    fontSize: 13,
  },
  holdingMeta: {
    marginTop: 4,
    color: "rgba(248,250,252,0.56)",
    fontSize: 11,
  },
  holdingValue: {
    color: "#F8FAFC",
    fontWeight: "900",
    fontSize: 14,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.52)",
    justifyContent: "center",
    padding: 16,
  },
  modalCard: {
    borderRadius: 22,
    padding: 16,
    backgroundColor: "#08141A",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    gap: 10,
  },
  networkRow: {
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.04)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  networkTitle: {
    color: "#F8FAFC",
    fontWeight: "900",
    fontSize: 13,
  },
  networkMeta: {
    marginTop: 4,
    color: "rgba(248,250,252,0.56)",
    fontSize: 11,
  },
  dimmed: {
    opacity: 0.5,
  },
});
