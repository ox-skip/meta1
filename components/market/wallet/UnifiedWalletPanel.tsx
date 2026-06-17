import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { LinearGradient } from "expo-linear-gradient";
import React, { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import BalanceVisibilityToggle from "@/components/common/BalanceVisibilityToggle";
import { maskBalanceValue, useBalanceVisibility } from "@/hooks/useBalanceVisibility";
import { useUnifiedWallet } from "@/components/market/wallet/useUnifiedWallet";

type UnifiedWalletData = ReturnType<typeof useUnifiedWallet>;
type WalletMode = "circle_market" | "base_smart" | "walletconnect";

type Props = {
  wallet: UnifiedWalletData;
  compact?: boolean;
  presentation?: "mobile" | "desktop";
  onOpenNgnWallet?: () => void;
  onOpenCryptoWallet?: () => void;
  onOpenHistory?: () => void;
};

const BG = "#090D0B";
const PANEL = "rgba(255,253,247,0.07)";
const PANEL_ALT = "rgba(255,253,247,0.045)";
const BORDER = "rgba(255,253,247,0.12)";
const TEXT = "#FFFDF7";
const MUTED = "rgba(255,253,247,0.66)";
const FAINT = "rgba(255,253,247,0.42)";
const TEAL = "#2DD4BF";
const AMBER = "#F4B75D";
const BLUE = "#38BDF8";
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

function fmt(value: number, digits = 2) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: digits }) : "0";
}

function chainLabel(v?: string | null) {
  return String(v || "").toUpperCase().replace(/_/g, " ");
}

function walletModeLabel(mode?: WalletMode | null) {
  if (mode === "circle_market") return "Market Wallet";
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
  if (mode === "circle_market") {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "rgba(45,212,191,0.18)",
          borderWidth: 1,
          borderColor: "rgba(45,212,191,0.55)",
        }}
      >
        <Ionicons name="shield-checkmark-outline" size={Math.max(18, size * 0.46)} color={TEAL} />
      </View>
    );
  }

  const base = mode === "base_smart";
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: base ? "#0052FF" : "rgba(56,189,248,0.16)",
        borderWidth: 1,
        borderColor: base ? "rgba(255,255,255,0.34)" : "rgba(56,189,248,0.55)",
      }}
    >
      {base ? (
        <Text style={{ color: "#fff", fontWeight: "900", fontSize: Math.max(16, size * 0.43) }}>B</Text>
      ) : (
        <Ionicons name="link-outline" size={Math.max(18, size * 0.46)} color={BLUE} />
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
  const color = mode === "base_smart" ? TEAL : BLUE;
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

function ChainBalanceRow({ item, hidden }: { item: UnifiedWalletData["chainBalances"][number]; hidden: boolean }) {
  const nativeSymbol = item.native?.symbol || (item.chain === "arc_testnet" ? "USDC" : "ETH");
  const nativeAmount = Number(item.native?.amount || 0);
  const usdcAmount = Number(item.usdc?.amount || 0);
  const usdtAmount = Number(item.usdt?.amount || 0);

  return (
    <View style={styles.chainBalanceRow}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={styles.chainBalanceTitle}>
          {chainLabel(item.chain)}
        </Text>
        <Text numberOfLines={1} style={styles.chainBalanceAddress}>
          {shortAddress(item.address)}
        </Text>
      </View>
      <View style={styles.chainBalanceValues}>
        <Text numberOfLines={1} style={styles.chainBalanceValue}>
          {hidden ? "******" : `${fmt(nativeAmount, 6)} ${nativeSymbol}`}
        </Text>
        <Text numberOfLines={1} style={styles.chainBalanceMeta}>
          {hidden ? "******" : `USDC ${fmt(usdcAmount, 6)} / USDT ${fmt(usdtAmount, 6)}`}
        </Text>
      </View>
    </View>
  );
}

export default function UnifiedWalletPanel({
  wallet,
  compact = false,
  presentation = "mobile",
  onOpenNgnWallet,
  onOpenCryptoWallet,
  onOpenHistory,
}: Props) {
  const { balancesHidden, toggleBalancesHidden } = useBalanceVisibility();
  const [sendTo, setSendTo] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [sendToken, setSendToken] = useState<"USDC" | "USDT">("USDC");

  const connected = Boolean(wallet.connectedAddress);
  const activeWalletMode = wallet.circleEnabled ? "circle_market" : wallet.connectedMode ?? wallet.walletMode;
  const activeWalletModeLabel = walletModeLabel(activeWalletMode);
  const copyAddress = firstValidAddress(wallet.connectedAddress, wallet.savedAddress);
  const portfolio = wallet.portfolioPositions.slice(0, compact ? 3 : 5);
  const walletConnectBlocked = Boolean(wallet.connectedMode && wallet.connectedMode !== "walletconnect");
  const baseSmartBlocked = Boolean(wallet.connectedMode && wallet.connectedMode !== "base_smart");
  const desktop = presentation === "desktop";
  const canSendUsdc = isAddress(wallet.chain?.usdc_address || "");
  const canSendUsdt = isAddress(wallet.chain?.usdt_address || "");
  const sendDisabled =
    wallet.sendBusy ||
    !wallet.chain?.active ||
    !sendTo.trim() ||
    !sendAmount.trim() ||
    (sendToken === "USDC" ? !canSendUsdc : !canSendUsdt);

  const primaryCtaIcon = wallet.circleEnabled
    ? "shield-checkmark-outline"
    : connected
      ? "power-outline"
      : activeWalletMode === "base_smart"
        ? "ellipse"
        : "link-outline";

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
    if (mode === "circle_market") {
      await wallet.setWalletMode("circle_market");
      if (!wallet.hasMarketWallet) await wallet.createMarketWallet();
      return;
    }
    if (mode === "base_smart" && !wallet.baseSmartSupported) return;
    if (mode === "walletconnect" && walletConnectBlocked) return;
    if (mode === "base_smart" && baseSmartBlocked) return;
    if (activeWalletMode !== mode) await wallet.setWalletMode(mode);
    if (!connected) {
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

  return (
    <View style={[styles.shell, compact ? styles.shellCompact : undefined, desktop ? styles.shellDesktop : undefined]}>
      <LinearGradient
        colors={["rgba(45,212,191,0.18)", "rgba(56,189,248,0.10)", "rgba(244,183,93,0.12)"]}
        start={{ x: 0.05, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.hero}
      >
        <View style={styles.heroTop}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
            <BrandMark mode={activeWalletMode ?? "circle_market"} size={52} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.heroKicker}>{wallet.hasMarketWallet ? "Account wallet" : "Wallet setup"}</Text>
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
          <Pill label={wallet.hasMarketWallet ? shortAddress(wallet.connectedAddress || wallet.savedAddress) : "Not created"} tone={wallet.hasMarketWallet ? TEAL : AMBER} />
        </View>
      </LinearGradient>

      <View style={desktop ? styles.desktopGrid : styles.mobileStack}>
        <View style={[styles.section, desktop ? styles.desktopPane : undefined]}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>{wallet.circleEnabled ? "Market wallet" : "Wallets"}</Text>
          {!wallet.circleEnabled && connected ? (
            <Pressable onPress={wallet.disconnectWallet} disabled={wallet.busy} style={[styles.inlineAction, wallet.busy ? styles.dimmed : undefined]}>
              <Ionicons name="power-outline" size={15} color={ROSE} />
            </Pressable>
          ) : null}
        </View>
        {wallet.circleEnabled ? (
          <View style={styles.marketWalletCard}>
            <View style={styles.marketWalletIcon}>
              <Ionicons name={wallet.hasMarketWallet ? "shield-checkmark-outline" : "shield-outline"} size={22} color={TEAL} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.marketWalletTitle}>{wallet.hasMarketWallet ? "Main marketplace wallet" : "Create your marketplace wallet"}</Text>
              <Text style={styles.marketWalletText}>
                {wallet.hasMarketWallet
                  ? "This account-bound Circle wallet is used for market escrow, stocks, and stable transfers."
                  : "Create one Circle smart wallet for Arc and supported EVM chains, then use it as your Market wallet."}
              </Text>
            </View>
          </View>
        ) : (
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
        )}

        <Pressable
          onPress={wallet.circleEnabled ? (wallet.hasMarketWallet ? wallet.refreshAll : wallet.createMarketWallet) : connected ? wallet.disconnectWallet : wallet.connectWallet}
          disabled={wallet.busy || !wallet.chain?.active || (wallet.circleEnabled && !wallet.circleConfigured)}
          style={[styles.primaryAction, wallet.busy || !wallet.chain?.active || (wallet.circleEnabled && !wallet.circleConfigured) ? styles.dimmed : undefined]}
        >
          {wallet.busy ? (
            <ActivityIndicator color={wallet.circleEnabled || !connected ? INK : ROSE} />
          ) : (
            <Ionicons name={primaryCtaIcon as keyof typeof Ionicons.glyphMap} size={18} color={wallet.circleEnabled || !connected ? INK : ROSE} />
          )}
          <Text style={[styles.primaryActionText, !wallet.circleEnabled && connected ? { color: ROSE } : undefined]}>
            {wallet.circleEnabled ? (wallet.hasMarketWallet ? "Refresh Market Wallet" : "Create Market Wallet") : connected ? "Disconnect" : activeWalletMode === "base_smart" ? "Coinbase" : "WalletConnect"}
          </Text>
        </Pressable>
        {wallet.circleEnabled && !wallet.circleConfigured ? <Text style={styles.warningText}>Circle wallet is not configured on the server.</Text> : null}
      </View>

        <View style={[styles.statGrid, desktop ? styles.desktopPane : undefined]}>
        <StatTile label="USDC" value={balancesHidden ? "******" : fmt(wallet.usdcBalance, 6)} tone={TEAL} />
        <StatTile label="USDT" value={balancesHidden ? "******" : fmt(wallet.usdtBalance, 6)} tone={AMBER} />
        <StatTile
          label={wallet.isNigeria ? "NGN" : "Stocks"}
          value={balancesHidden ? "******" : wallet.isNigeria ? fmt(wallet.ngnBalance) : `$${fmt(wallet.portfolioTotalUsdc)}`}
          tone={BLUE}
        />
      </View>

        <View style={[styles.section, desktop ? styles.desktopPane : undefined]}>
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

        <View style={[styles.section, desktop ? styles.desktopPane : undefined]}>
        <Text style={styles.sectionTitle}>Identity</Text>
        <View style={styles.stack}>
          <AddressRow
            icon="wallet-outline"
            label="Market wallet"
            value={shortAddress(wallet.savedAddress)}
            onCopy={wallet.savedAddress ? () => copyText(wallet.savedAddress, "Wallet address copied.") : undefined}
          />
          <AddressRow
            icon={wallet.circleEnabled ? "shield-checkmark-outline" : "phone-portrait-outline"}
            label={wallet.circleEnabled ? "Approval wallet" : "Device session"}
            value={shortAddress(wallet.connectedAddress)}
            onCopy={wallet.connectedAddress ? () => copyText(wallet.connectedAddress, "Connected wallet copied.") : undefined}
          />
        </View>

        <View style={styles.buttonRow}>
          {wallet.circleEnabled ? (
            <Pressable
              onPress={() => Alert.alert("Recovery", "Your Market wallet uses Circle user-controlled recovery with PIN and device approval. Seed phrase export is not available for Circle MPC wallets.")}
              style={styles.secondaryAction}
            >
              <Ionicons name="key-outline" size={15} color={TEXT} />
              <Text style={styles.secondaryActionText}>Recovery</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={wallet.useConnectedWallet}
              disabled={wallet.busy || !wallet.chain?.active || !wallet.connectedAddress}
              style={[styles.secondaryAction, wallet.busy || !wallet.chain?.active || !wallet.connectedAddress ? styles.dimmed : undefined]}
            >
              <Ionicons name="swap-horizontal-outline" size={15} color={TEXT} />
              <Text style={styles.secondaryActionText}>Use session</Text>
            </Pressable>
          )}
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

        <View style={[styles.section, desktop ? styles.desktopPane : undefined]}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Chain balances</Text>
          <Text style={styles.sectionMeta}>{wallet.chainBalances.length} chains</Text>
        </View>
        {wallet.chainBalances.length ? (
          <View style={styles.stack}>
            {wallet.chainBalances.map((item) => (
              <ChainBalanceRow key={`${item.chain}-${item.walletId}`} item={item} hidden={balancesHidden} />
            ))}
          </View>
        ) : (
          <View style={styles.emptyRow}>
            <Ionicons name="layers-outline" size={17} color={FAINT} />
            <Text style={styles.emptyText}>
              {wallet.hasMarketWallet ? "Balances will appear after the next refresh." : "Create a Market wallet to see balances by chain."}
            </Text>
          </View>
        )}
      </View>

        <View style={[styles.section, desktop ? styles.desktopPane : undefined]}>
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

        <View style={[styles.section, desktop ? styles.desktopPane : undefined]}>
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

        <View style={[styles.footerActions, desktop ? styles.desktopFull : undefined]}>
        {wallet.isNigeria && onOpenNgnWallet ? (
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
  shellDesktop: {
    padding: 14,
    gap: 12,
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
  mobileStack: {
    gap: 10,
  },
  desktopGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-start",
    gap: 12,
  },
  desktopPane: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "46%",
    minWidth: 320,
  },
  desktopFull: {
    flexBasis: "100%",
    width: "100%",
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
    backgroundColor: "rgba(56,189,248,0.14)",
    borderColor: "rgba(56,189,248,0.35)",
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
  marketWalletCard: {
    minHeight: 86,
    borderRadius: 8,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "rgba(45,212,191,0.10)",
    borderWidth: 1,
    borderColor: "rgba(45,212,191,0.30)",
  },
  marketWalletIcon: {
    width: 44,
    height: 44,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(45,212,191,0.12)",
    borderWidth: 1,
    borderColor: "rgba(45,212,191,0.28)",
  },
  marketWalletTitle: {
    color: TEXT,
    fontSize: 14,
    fontWeight: "900",
  },
  marketWalletText: {
    marginTop: 4,
    color: MUTED,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "700",
  },
  primaryAction: {
    minHeight: 48,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    backgroundColor: TEAL,
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
  chainBalanceRow: {
    minHeight: 66,
    borderRadius: 8,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: PANEL_ALT,
    borderWidth: 1,
    borderColor: BORDER,
  },
  chainBalanceTitle: {
    color: TEXT,
    fontSize: 13,
    fontWeight: "900",
  },
  chainBalanceAddress: {
    marginTop: 4,
    color: FAINT,
    fontSize: 11,
    fontWeight: "800",
  },
  chainBalanceValues: {
    minWidth: 132,
    maxWidth: "52%",
    alignItems: "flex-end",
  },
  chainBalanceValue: {
    color: TEXT,
    fontSize: 12,
    fontWeight: "900",
  },
  chainBalanceMeta: {
    marginTop: 4,
    color: MUTED,
    fontSize: 10,
    fontWeight: "800",
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
  warningText: {
    color: "#FCD34D",
    fontSize: 12,
    fontWeight: "900",
  },
  dimmed: {
    opacity: 0.52,
  },
});
