import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import BalanceVisibilityToggle from "@/components/common/BalanceVisibilityToggle";
import { maskBalanceValue, useBalanceVisibility } from "@/hooks/useBalanceVisibility";
import { useUnifiedWallet } from "@/components/market/wallet/useUnifiedWallet";

type UnifiedWalletData = ReturnType<typeof useUnifiedWallet>;
type WalletMode = "base_smart" | "walletconnect";

type Props = {
  wallet: UnifiedWalletData;
  compact?: boolean;
  onOpenNgnWallet?: () => void;
  onOpenCryptoWallet?: () => void;
  onOpenHistory?: () => void;
};

const BG = "#07100D";
const PANEL = "rgba(255,253,247,0.07)";
const PANEL_ALT = "rgba(255,253,247,0.045)";
const BORDER = "rgba(255,253,247,0.12)";
const TEXT = "#FFFDF7";
const MUTED = "rgba(255,253,247,0.66)";
const FAINT = "rgba(255,253,247,0.42)";
const TEAL = "#2DD4BF";
const AMBER = "#F4B75D";
const BLUE = "#3B82F6";
const ROSE = "#FB7185";
const INK = "#061311";

function isAddress(value?: string | null) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || ""));
}

function shortAddress(value?: string | null) {
  const v = String(value || "").trim();
  if (!v) return "Not set";
  if (isAddress(v)) return `${v.slice(0, 6)}...${v.slice(-4)}`;
  if (v.length <= 16) return v;
  return `${v.slice(0, 8)}...${v.slice(-6)}`;
}

function shortValue(value?: string | null) {
  const v = String(value || "").trim();
  if (!v) return "Not set";
  if (v.length <= 16) return v;
  return `${v.slice(0, 8)}...${v.slice(-6)}`;
}

function fmt(value: number, digits = 2) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: digits }) : "0";
}

function chainLabel(v?: string | null) {
  return String(v || "").toUpperCase().replace(/_/g, " ");
}

function walletModeLabel(mode?: WalletMode | null) {
  if (mode === "base_smart") return "Coinbase Smart Wallet";
  if (mode === "walletconnect") return "WalletConnect";
  return "Wallet";
}

function firstValidAddress(...values: Array<string | null | undefined>) {
  for (const value of values) {
    if (isAddress(value)) return String(value);
  }
  return "";
}

function BrandMark({ mode, size = 44 }: { mode: WalletMode; size?: number }) {
  const base = mode === "base_smart";
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: base ? "#0052FF" : "rgba(59,130,246,0.16)",
        borderWidth: 1,
        borderColor: base ? "rgba(255,255,255,0.34)" : "rgba(59,130,246,0.55)",
      }}
    >
      {base ? (
        <Text style={{ color: "#fff", fontWeight: "900", fontSize: Math.max(16, size * 0.43) }}>B</Text>
      ) : (
        <Ionicons name="link-outline" size={Math.max(18, size * 0.46)} color="#93C5FD" />
      )}
    </View>
  );
}

function Pill({ label, tone = TEAL }: { label: string; tone?: string }) {
  return (
    <View style={[styles.pill, { backgroundColor: `${tone}18`, borderColor: `${tone}3A` }]}>
      <Text style={[styles.pillText, { color: tone }]}>{label}</Text>
    </View>
  );
}

function IconButton({
  icon,
  onPress,
  disabled,
  color = TEXT,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  disabled?: boolean;
  color?: string;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.iconButton, disabled ? styles.dimmed : undefined]}>
      <Ionicons name={icon} size={17} color={color} />
    </Pressable>
  );
}

function ProviderCard({
  mode,
  active,
  connected,
  disabled,
  supported,
  busy,
  onPress,
}: {
  mode: WalletMode;
  active: boolean;
  connected: boolean;
  disabled?: boolean;
  supported: boolean;
  busy?: boolean;
  onPress: () => void;
}) {
  const color = mode === "base_smart" ? BLUE : "#60A5FA";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={walletModeLabel(mode)}
      style={[
        styles.providerCard,
        active ? { borderColor: `${color}70`, backgroundColor: `${color}16` } : undefined,
        disabled || busy ? styles.dimmed : undefined,
      ]}
    >
      <View style={styles.providerTop}>
        <BrandMark mode={mode} size={46} />
        {active ? (
          <View style={[styles.providerStatus, connected ? styles.providerConnected : styles.providerSelected]}>
            {busy ? <ActivityIndicator size="small" color={connected ? "#BBF7D0" : color} /> : <Ionicons name={connected ? "checkmark" : "radio-button-on"} size={13} color={connected ? "#BBF7D0" : color} />}
          </View>
        ) : null}
      </View>
      <Text style={styles.providerTitle}>{mode === "base_smart" ? "Coinbase" : "WalletConnect"}</Text>
      <Text style={styles.providerSubtitle}>{mode === "base_smart" ? "Smart Wallet" : "Mobile and browser wallets"}</Text>
      {!supported ? <Text style={styles.providerUnavailable}>Web only</Text> : null}
    </Pressable>
  );
}

function StatTile({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <View style={[styles.statTile, { borderColor: `${tone}42`, backgroundColor: `${tone}13` }]}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78} style={styles.statValue}>
        {value}
      </Text>
    </View>
  );
}

function TokenButton({
  label,
  active,
  disabled,
  onPress,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.tokenButton, active ? styles.tokenActive : undefined, disabled ? styles.dimmed : undefined]}
    >
      <Text style={styles.tokenText}>{label}</Text>
    </Pressable>
  );
}

function AddressRow({
  icon,
  label,
  value,
  onCopy,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  onCopy?: () => void;
}) {
  return (
    <View style={styles.addressRow}>
      <View style={styles.addressIcon}>
        <Ionicons name={icon} size={16} color={TEAL} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.addressLabel}>{label}</Text>
        <Text numberOfLines={1} style={styles.addressValue}>{value}</Text>
      </View>
      {onCopy ? <IconButton icon="copy-outline" onPress={onCopy} /> : null}
    </View>
  );
}

export default function UnifiedWalletPanel({
  wallet,
  compact = false,
  onOpenNgnWallet,
  onOpenCryptoWallet,
  onOpenHistory,
}: Props) {
  const { balancesHidden, toggleBalancesHidden } = useBalanceVisibility();
  const [sendTo, setSendTo] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [sendToken, setSendToken] = useState<"USDC" | "USDT">("USDC");
  const [piAddressInput, setPiAddressInput] = useState(wallet.savedPiAddress || "");

  useEffect(() => {
    setPiAddressInput(wallet.savedPiAddress || "");
  }, [wallet.savedPiAddress]);

  const connected = Boolean(wallet.connectedAddress);
  const activeWalletMode = wallet.connectedMode ?? wallet.walletMode;
  const activeWalletModeLabel = walletModeLabel(activeWalletMode);
  const copyAddress = firstValidAddress(wallet.connectedAddress, wallet.savedAddress);
  const portfolio = wallet.portfolioPositions.slice(0, compact ? 3 : 5);
  const walletConnectBlocked = Boolean(wallet.connectedMode && wallet.connectedMode !== "walletconnect");
  const baseSmartBlocked = Boolean(wallet.connectedMode && wallet.connectedMode !== "base_smart");
  const canSendUsdc = isAddress(wallet.chain?.usdc_address || "");
  const canSendUsdt = isAddress(wallet.chain?.usdt_address || "");
  const piChainSelected = String(wallet.chain?.chain || "").toLowerCase().includes("pi");
  const sendDisabled =
    wallet.sendBusy ||
    !wallet.chain?.active ||
    !sendTo.trim() ||
    !sendAmount.trim() ||
    (sendToken === "USDC" ? !canSendUsdc : !canSendUsdt);
  const piSaveDisabled =
    wallet.piSaving || piAddressInput.trim() === String(wallet.savedPiAddress || "").trim();

  const primaryCtaIcon = connected ? "power-outline" : activeWalletMode === "base_smart" ? "ellipse" : "link-outline";

  async function copyText(value: string, successMessage: string) {
    if (!value) return;
    try {
      await Clipboard.setStringAsync(value);
      Alert.alert("Copied", successMessage);
    } catch {
      Alert.alert("Copy failed", "Unable to copy right now.");
    }
  }

  async function handleProviderPress(mode: WalletMode) {
    if (mode === "base_smart" && !wallet.baseSmartSupported) return;
    if (mode === "walletconnect" && walletConnectBlocked) return;
    if (mode === "base_smart" && baseSmartBlocked) return;
    if (activeWalletMode !== mode) await wallet.setWalletMode(mode);
    if (!connected && !String(wallet.chain?.chain || "").toLowerCase().includes("pi")) {
      await wallet.connectWallet();
    }
  }

  async function doSend() {
    try {
      const out = await wallet.sendStableToken({
        symbol: sendToken,
        to: sendTo.trim(),
        amount: sendAmount.trim(),
      });
      setSendTo("");
      setSendAmount("");
      Alert.alert("Transfer submitted", `Tx: ${out.txHash}`);
    } catch (e: any) {
      Alert.alert("Transfer failed", String(e?.message || e || "Unable to send crypto right now."));
    }
  }

  async function savePiWallet() {
    try {
      const out = await wallet.savePiAddress(piAddressInput);
      setPiAddressInput(String(out?.address || ""));
      Alert.alert("Saved", out?.address ? "PI wallet address updated." : "PI wallet address cleared.");
    } catch (e: any) {
      Alert.alert("Save failed", String(e?.message || e || "Unable to save PI wallet address."));
    }
  }

  return (
    <View style={[styles.shell, compact ? styles.shellCompact : undefined]}>
      <LinearGradient
        colors={["rgba(45,212,191,0.18)", "rgba(59,130,246,0.10)", "rgba(244,183,93,0.12)"]}
        start={{ x: 0.05, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.hero}
      >
        <View style={styles.heroTop}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
            <BrandMark mode={activeWalletMode ?? "walletconnect"} size={52} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.heroKicker}>{connected ? "Connected" : "Wallet"}</Text>
              <Text numberOfLines={1} style={styles.heroTitle}>{activeWalletModeLabel}</Text>
            </View>
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <BalanceVisibilityToggle
              hidden={balancesHidden}
              onPress={() => {
                void toggleBalancesHidden();
              }}
              size={40}
            />
            <IconButton icon="refresh" onPress={wallet.refreshAll} disabled={wallet.busy} />
          </View>
        </View>

        <Text style={styles.balanceLabel}>Total value</Text>
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} style={styles.balanceValue}>
          {balancesHidden ? maskBalanceValue("$") : `$${fmt(wallet.overallUsdApprox)}`}
        </Text>
        <Text style={styles.balanceMeta}>
          {balancesHidden
            ? "Stable ****** / Stock ******"
            : `Stable $${fmt(wallet.stableTotalUsd)} / Stock $${fmt(wallet.portfolioTotalUsdc)}`}
        </Text>

        <View style={styles.statusRow}>
          <Pill label={wallet.chain ? chainLabel(wallet.chain.chain) : "No network"} tone={wallet.chain?.active ? TEAL : ROSE} />
          <Pill label={connected ? shortAddress(wallet.connectedAddress) : "No session"} tone={connected ? TEAL : AMBER} />
        </View>
      </LinearGradient>

      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Wallets</Text>
          {connected ? (
            <Pressable onPress={wallet.disconnectWallet} disabled={wallet.busy} style={[styles.inlineAction, wallet.busy ? styles.dimmed : undefined]}>
              <Ionicons name="power-outline" size={15} color={ROSE} />
            </Pressable>
          ) : null}
        </View>
        <View style={styles.providerGrid}>
          <ProviderCard
            mode="walletconnect"
            active={activeWalletMode === "walletconnect"}
            connected={wallet.connectedMode === "walletconnect"}
            disabled={walletConnectBlocked}
            supported
            busy={wallet.busy && activeWalletMode === "walletconnect"}
            onPress={() => {
              void handleProviderPress("walletconnect");
            }}
          />
          <ProviderCard
            mode="base_smart"
            active={activeWalletMode === "base_smart"}
            connected={wallet.connectedMode === "base_smart"}
            disabled={!wallet.baseSmartSupported || baseSmartBlocked}
            supported={wallet.baseSmartSupported}
            busy={wallet.busy && activeWalletMode === "base_smart"}
            onPress={() => {
              void handleProviderPress("base_smart");
            }}
          />
        </View>

        <Pressable
          onPress={connected ? wallet.disconnectWallet : wallet.connectWallet}
          disabled={wallet.busy || !wallet.chain?.active || (!connected && piChainSelected)}
          style={[styles.primaryAction, wallet.busy || !wallet.chain?.active || (!connected && piChainSelected) ? styles.dimmed : undefined]}
        >
          {wallet.busy ? (
            <ActivityIndicator color={connected ? ROSE : INK} />
          ) : (
            <Ionicons name={primaryCtaIcon as keyof typeof Ionicons.glyphMap} size={18} color={connected ? ROSE : INK} />
          )}
          <Text style={[styles.primaryActionText, connected ? { color: ROSE } : undefined]}>
            {connected ? "Disconnect" : activeWalletMode === "base_smart" ? "Coinbase" : "WalletConnect"}
          </Text>
        </Pressable>
      </View>

      <View style={styles.statGrid}>
        <StatTile label="USDC" value={balancesHidden ? "******" : fmt(wallet.usdcBalance, 6)} tone={TEAL} />
        <StatTile label="USDT" value={balancesHidden ? "******" : fmt(wallet.usdtBalance, 6)} tone={AMBER} />
        <StatTile
          label={wallet.isNigeria ? "NGN" : "Stocks"}
          value={balancesHidden ? "******" : wallet.isNigeria ? fmt(wallet.ngnBalance) : `$${fmt(wallet.portfolioTotalUsdc)}`}
          tone={BLUE}
        />
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Network</Text>
          <Text style={styles.sectionMeta}>{wallet.chains.length} available</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.networkStrip}>
          {wallet.chains.map((chain) => {
            const selected = wallet.chain?.chain === chain.chain;
            return (
              <Pressable
                key={chain.chain}
                onPress={() => wallet.selectChain(chain)}
                disabled={!chain.active}
                style={[styles.networkChip, selected ? styles.networkChipActive : undefined, !chain.active ? styles.dimmed : undefined]}
              >
                <Text style={styles.networkText}>{chainLabel(chain.chain)}</Text>
                {selected ? <Ionicons name="checkmark-circle" size={14} color={TEAL} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Identity</Text>
        <View style={styles.stack}>
          <AddressRow
            icon="wallet-outline"
            label="Market wallet"
            value={shortAddress(wallet.savedAddress)}
            onCopy={wallet.savedAddress ? () => copyText(wallet.savedAddress, "Wallet address copied.") : undefined}
          />
          <AddressRow
            icon="phone-portrait-outline"
            label="Device session"
            value={shortAddress(wallet.connectedAddress)}
            onCopy={wallet.connectedAddress ? () => copyText(wallet.connectedAddress, "Connected wallet copied.") : undefined}
          />
          <AddressRow
            icon="logo-usd"
            label="PI payout"
            value={shortValue(wallet.savedPiAddress)}
            onCopy={wallet.savedPiAddress ? () => copyText(wallet.savedPiAddress, "PI wallet address copied.") : undefined}
          />
        </View>

        <View style={styles.buttonRow}>
          <Pressable
            onPress={wallet.useConnectedWallet}
            disabled={wallet.busy || !wallet.chain?.active || !wallet.connectedAddress}
            style={[styles.secondaryAction, wallet.busy || !wallet.chain?.active || !wallet.connectedAddress ? styles.dimmed : undefined]}
          >
            <Ionicons name="swap-horizontal-outline" size={15} color={TEXT} />
            <Text style={styles.secondaryActionText}>Use session</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              if (copyAddress) void copyText(copyAddress, "Wallet address copied.");
            }}
            disabled={!copyAddress}
            style={[styles.secondaryAction, !copyAddress ? styles.dimmed : undefined]}
          >
            <Ionicons name="copy-outline" size={15} color={TEXT} />
            <Text style={styles.secondaryActionText}>Copy</Text>
          </Pressable>
        </View>
      </View>

      {!compact ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>PI payout</Text>
          <TextInput
            value={piAddressInput}
            onChangeText={setPiAddressInput}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="PI wallet address"
            placeholderTextColor={FAINT}
            style={styles.input}
          />
          <Pressable onPress={savePiWallet} disabled={piSaveDisabled} style={[styles.secondaryAction, piSaveDisabled ? styles.dimmed : undefined]}>
            <Ionicons name="save-outline" size={15} color={TEXT} />
            <Text style={styles.secondaryActionText}>{wallet.piSaving ? "Saving" : "Save PI wallet"}</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Transfer</Text>
        <View style={styles.tokenRow}>
          <TokenButton active={sendToken === "USDC"} label="USDC" disabled={!canSendUsdc} onPress={() => setSendToken("USDC")} />
          <TokenButton active={sendToken === "USDT"} label="USDT" disabled={!canSendUsdt} onPress={() => setSendToken("USDT")} />
        </View>
        <TextInput
          value={sendTo}
          onChangeText={setSendTo}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Recipient address"
          placeholderTextColor={FAINT}
          style={styles.input}
        />
        <TextInput
          value={sendAmount}
          onChangeText={setSendAmount}
          keyboardType="decimal-pad"
          placeholder={`Amount in ${sendToken}`}
          placeholderTextColor={FAINT}
          style={styles.input}
        />
        <Pressable onPress={doSend} disabled={sendDisabled} style={[styles.secondaryAction, styles.sendAction, sendDisabled ? styles.dimmed : undefined]}>
          {wallet.sendBusy ? <ActivityIndicator color={TEXT} /> : <Ionicons name="send" size={15} color={TEXT} />}
          <Text style={styles.secondaryActionText}>Send {sendToken}</Text>
        </Pressable>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Portfolio</Text>
          <Pill label={`$${fmt(wallet.portfolioTotalUsdc)}`} tone={AMBER} />
        </View>
        {portfolio.length ? (
          <View style={styles.stack}>
            {portfolio.map((row) => (
              <View key={`${row.stock_id}-${row.slug}`} style={styles.holdingRow}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={styles.holdingTitle}>{row.name}</Text>
                  <Text style={styles.holdingMeta}>{row.symbol || "STK"} - Qty {fmt(row.qty, 4)}</Text>
                </View>
                <Text style={styles.holdingValue}>{balancesHidden ? maskBalanceValue("$") : `$${fmt(row.value_usdc)}`}</Text>
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.emptyRow}>
            <Ionicons name="bar-chart-outline" size={17} color={FAINT} />
            <Text style={styles.emptyText}>No stock holdings yet.</Text>
          </View>
        )}
      </View>

      <View style={styles.footerActions}>
        {onOpenNgnWallet ? (
          <Pressable onPress={onOpenNgnWallet} style={styles.footerButton}>
            <Ionicons name="cash-outline" size={15} color={TEXT} />
            <Text style={styles.footerButtonText}>NGN</Text>
          </Pressable>
        ) : null}
        {onOpenCryptoWallet ? (
          <Pressable onPress={onOpenCryptoWallet} style={styles.footerButton}>
            <Ionicons name="open-outline" size={15} color={TEXT} />
            <Text style={styles.footerButtonText}>Wallet</Text>
          </Pressable>
        ) : null}
        {onOpenHistory ? (
          <Pressable onPress={onOpenHistory} style={styles.footerButton}>
            <Ionicons name="time-outline" size={15} color={TEXT} />
            <Text style={styles.footerButtonText}>History</Text>
          </Pressable>
        ) : null}
      </View>

      {!!wallet.error ? <Text style={styles.errorText}>{wallet.error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    borderRadius: 8,
    padding: 12,
    backgroundColor: "rgba(7,16,13,0.92)",
    borderWidth: 1,
    borderColor: BORDER,
    gap: 10,
  },
  shellCompact: {
    padding: 10,
  },
  hero: {
    borderRadius: 8,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(255,253,247,0.13)",
    backgroundColor: BG,
  },
  heroTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  heroKicker: {
    color: TEAL,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  heroTitle: {
    marginTop: 3,
    color: TEXT,
    fontSize: 18,
    fontWeight: "900",
  },
  balanceLabel: {
    marginTop: 18,
    color: FAINT,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  balanceValue: {
    marginTop: 4,
    color: TEXT,
    fontSize: 34,
    fontWeight: "900",
  },
  balanceMeta: {
    marginTop: 4,
    color: MUTED,
    fontSize: 12,
  },
  statusRow: {
    marginTop: 12,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  pill: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderWidth: 1,
  },
  pillText: {
    fontSize: 11,
    fontWeight: "900",
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: PANEL,
    borderWidth: 1,
    borderColor: BORDER,
  },
  section: {
    borderRadius: 8,
    padding: 12,
    backgroundColor: PANEL,
    borderWidth: 1,
    borderColor: BORDER,
    gap: 10,
  },
  sectionHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  sectionTitle: {
    color: TEXT,
    fontSize: 15,
    fontWeight: "900",
  },
  sectionMeta: {
    color: FAINT,
    fontSize: 11,
    fontWeight: "800",
  },
  providerGrid: {
    flexDirection: "row",
    gap: 10,
  },
  providerCard: {
    flex: 1,
    minHeight: 126,
    borderRadius: 8,
    padding: 12,
    backgroundColor: PANEL_ALT,
    borderWidth: 1,
    borderColor: BORDER,
  },
  providerTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 8,
  },
  providerStatus: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  providerConnected: {
    backgroundColor: "rgba(34,197,94,0.18)",
    borderColor: "rgba(34,197,94,0.38)",
  },
  providerSelected: {
    backgroundColor: "rgba(59,130,246,0.14)",
    borderColor: "rgba(59,130,246,0.35)",
  },
  providerTitle: {
    marginTop: 12,
    color: TEXT,
    fontSize: 14,
    fontWeight: "900",
  },
  providerSubtitle: {
    marginTop: 4,
    color: MUTED,
    fontSize: 11,
    lineHeight: 15,
  },
  providerUnavailable: {
    marginTop: 6,
    color: AMBER,
    fontSize: 10,
    fontWeight: "900",
  },
  primaryAction: {
    minHeight: 48,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    backgroundColor: AMBER,
    borderWidth: 1,
    borderColor: "rgba(255,253,247,0.18)",
  },
  primaryActionText: {
    color: INK,
    fontWeight: "900",
    fontSize: 14,
  },
  statGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  statTile: {
    flexGrow: 1,
    flexBasis: 96,
    borderRadius: 8,
    padding: 11,
    borderWidth: 1,
  },
  statLabel: {
    color: FAINT,
    fontSize: 10,
    fontWeight: "900",
  },
  statValue: {
    marginTop: 5,
    color: TEXT,
    fontSize: 15,
    fontWeight: "900",
  },
  networkStrip: {
    gap: 8,
    paddingRight: 2,
  },
  networkChip: {
    minHeight: 38,
    borderRadius: 999,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 7,
    backgroundColor: PANEL_ALT,
    borderWidth: 1,
    borderColor: BORDER,
  },
  networkChipActive: {
    backgroundColor: "rgba(45,212,191,0.14)",
    borderColor: "rgba(45,212,191,0.44)",
  },
  networkText: {
    color: TEXT,
    fontSize: 11,
    fontWeight: "900",
  },
  stack: {
    gap: 8,
  },
  addressRow: {
    minHeight: 58,
    borderRadius: 8,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: PANEL_ALT,
    borderWidth: 1,
    borderColor: BORDER,
  },
  addressIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(45,212,191,0.12)",
    borderWidth: 1,
    borderColor: "rgba(45,212,191,0.28)",
  },
  addressLabel: {
    color: FAINT,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  addressValue: {
    marginTop: 4,
    color: TEXT,
    fontSize: 13,
    fontWeight: "900",
  },
  buttonRow: {
    flexDirection: "row",
    gap: 8,
  },
  secondaryAction: {
    minHeight: 44,
    flex: 1,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    backgroundColor: PANEL_ALT,
    borderWidth: 1,
    borderColor: BORDER,
  },
  secondaryActionText: {
    color: TEXT,
    fontSize: 12,
    fontWeight: "900",
  },
  input: {
    minHeight: 46,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: PANEL_ALT,
    color: TEXT,
    paddingHorizontal: 12,
    fontSize: 13,
    fontWeight: "800",
  },
  tokenRow: {
    flexDirection: "row",
    gap: 8,
  },
  tokenButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: PANEL_ALT,
    borderWidth: 1,
    borderColor: BORDER,
  },
  tokenActive: {
    backgroundColor: "rgba(45,212,191,0.14)",
    borderColor: "rgba(45,212,191,0.42)",
  },
  tokenText: {
    color: TEXT,
    fontSize: 12,
    fontWeight: "900",
  },
  sendAction: {
    backgroundColor: "rgba(56,189,248,0.16)",
    borderColor: "rgba(56,189,248,0.36)",
  },
  holdingRow: {
    borderRadius: 8,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: PANEL_ALT,
    borderWidth: 1,
    borderColor: BORDER,
  },
  holdingTitle: {
    color: TEXT,
    fontSize: 13,
    fontWeight: "900",
  },
  holdingMeta: {
    marginTop: 3,
    color: MUTED,
    fontSize: 11,
  },
  holdingValue: {
    color: TEXT,
    fontSize: 13,
    fontWeight: "900",
  },
  emptyRow: {
    borderRadius: 8,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: PANEL_ALT,
    borderWidth: 1,
    borderColor: BORDER,
  },
  emptyText: {
    color: MUTED,
    fontSize: 12,
    fontWeight: "800",
  },
  inlineAction: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(251,113,133,0.12)",
    borderWidth: 1,
    borderColor: "rgba(251,113,133,0.28)",
  },
  footerActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  footerButton: {
    flexGrow: 1,
    minHeight: 40,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 7,
    backgroundColor: PANEL,
    borderWidth: 1,
    borderColor: BORDER,
  },
  footerButtonText: {
    color: TEXT,
    fontSize: 12,
    fontWeight: "900",
  },
  errorText: {
    color: "#FDA4AF",
    fontSize: 12,
    fontWeight: "900",
  },
  dimmed: {
    opacity: 0.52,
  },
});
