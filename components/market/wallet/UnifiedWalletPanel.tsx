import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import React, { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import BalanceVisibilityToggle from "@/components/common/BalanceVisibilityToggle";
import { maskBalanceValue, useBalanceVisibility } from "@/hooks/useBalanceVisibility";
import { useUnifiedWallet } from "@/components/market/wallet/useUnifiedWallet";

type UnifiedWalletData = ReturnType<typeof useUnifiedWallet>;

type Props = {
  wallet: UnifiedWalletData;
  compact?: boolean;
  onOpenNgnWallet?: () => void;
  onOpenCryptoWallet?: () => void;
  onOpenHistory?: () => void;
};

function isAddress(value?: string | null) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || ""));
}

function shortAddress(value?: string | null) {
  const v = String(value || "").trim();
  if (!v) return "Not connected";
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

function chainLabel(v?: string | null) {
  return String(v || "").toUpperCase().replace(/_/g, " ");
}

function firstValidAddress(...values: Array<string | null | undefined>) {
  for (const value of values) {
    if (isAddress(value)) return String(value);
  }
  return "";
}

export default function UnifiedWalletPanel({
  wallet,
  compact = false,
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

  const portfolio = wallet.portfolioPositions.slice(0, compact ? 3 : 5);
  const copyAddress = firstValidAddress(wallet.savedAddress, wallet.connectedAddress);
  const canSendUsdt = isAddress(wallet.chain?.usdt_address || "");
  const sendDisabled =
    wallet.sendBusy ||
    !wallet.chain?.active ||
    !sendTo.trim() ||
    !sendAmount.trim() ||
    (sendToken === "USDT" && !canSendUsdt);
  const piAddressTrimmed = piAddressInput.trim();
  const piSaveDisabled =
    wallet.piSaving || piAddressTrimmed === String(wallet.savedPiAddress || "").trim();

  const doSend = async () => {
    try {
      const out = await wallet.sendStableToken({
        symbol: sendToken,
        to: sendTo.trim(),
        amount: sendAmount.trim(),
      });
      setSendAmount("");
      Alert.alert("Transfer submitted", `Tx: ${out.txHash}`);
    } catch (e: any) {
      Alert.alert("Transfer failed", String(e?.message || e || "Unable to send crypto right now."));
    }
  };

  const savePiWallet = async () => {
    try {
      const out = await wallet.savePiAddress(piAddressInput);
      setPiAddressInput(String(out?.address || ""));
      Alert.alert("Saved", out?.address ? "PI wallet address updated." : "PI wallet address cleared.");
    } catch (e: any) {
      Alert.alert("Save failed", String(e?.message || e || "Unable to save PI wallet address."));
    }
  };

  return (
    <View
      style={{
        borderRadius: 22,
        padding: 14,
        backgroundColor: "rgba(255,255,255,0.06)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.12)",
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View>
          <Text style={{ color: "#fff", fontWeight: "900", fontSize: 17 }}>Unified Wallet</Text>
          <Text style={{ marginTop: 4, color: "rgba(255,255,255,0.65)", fontSize: 12 }}>
            Crypto, PI, and stock portfolio in one place.
          </Text>
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <BalanceVisibilityToggle
            hidden={balancesHidden}
            onPress={() => {
              void toggleBalancesHidden();
            }}
            size={40}
          />
          <Pressable
            onPress={wallet.refreshAll}
            disabled={wallet.busy}
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.14)",
              backgroundColor: "rgba(255,255,255,0.06)",
              opacity: wallet.busy ? 0.6 : 1,
            }}
          >
            <Ionicons name="refresh" size={18} color="#fff" />
          </Pressable>
        </View>
      </View>

      <View
        style={{
          marginTop: 12,
          borderRadius: 16,
          padding: 12,
          backgroundColor: "rgba(124,58,237,0.16)",
          borderWidth: 1,
          borderColor: "rgba(167,139,250,0.35)",
        }}
      >
        <Text style={{ color: "rgba(255,255,255,0.75)", fontWeight: "800", fontSize: 11 }}>TOTAL PORTFOLIO (USD APPROX)</Text>
        <Text style={{ marginTop: 5, color: "#fff", fontWeight: "900", fontSize: 22 }}>
          {balancesHidden
            ? maskBalanceValue("$")
            : `$${wallet.overallUsdApprox.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
        </Text>
        <Text style={{ marginTop: 4, color: "rgba(255,255,255,0.66)", fontSize: 11 }}>
          {balancesHidden
            ? "Stable $****** + Stock $******"
            : `Stable $${wallet.stableTotalUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })} + Stock $${wallet.portfolioTotalUsdc.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
        </Text>
      </View>

      <View
        style={{
          marginTop: 10,
          borderRadius: 14,
          padding: 10,
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.1)",
          backgroundColor: "rgba(255,255,255,0.03)",
        }}
      >
        <Text style={{ color: "#fff", fontWeight: "900", fontSize: 13 }}>Stock Portfolio</Text>
        {portfolio.length === 0 ? (
          <Text style={{ marginTop: 6, color: "rgba(255,255,255,0.62)", fontSize: 12 }}>
            No stock holdings yet.
          </Text>
        ) : (
          <View style={{ marginTop: 8, gap: 7 }}>
            {portfolio.map((row) => (
              <View key={`${row.stock_id}-${row.slug}`} style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                <Text numberOfLines={1} style={{ color: "rgba(255,255,255,0.85)", fontWeight: "800", flex: 1 }}>
                  {row.name} ({row.symbol || "STK"}) - {row.qty.toFixed(4)}
                </Text>
                <Text style={{ color: "#fff", fontWeight: "900" }}>
                  {balancesHidden ? maskBalanceValue("$") : `$${row.value_usdc.toFixed(2)}`}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>

      <View style={{ marginTop: 10, flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1, borderRadius: 14, padding: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", backgroundColor: "rgba(255,255,255,0.04)" }}>
          <Text style={{ color: "rgba(255,255,255,0.62)", fontSize: 10, fontWeight: "800" }}>USDC</Text>
          <Text style={{ marginTop: 4, color: "#fff", fontWeight: "900" }}>
            {balancesHidden ? "******" : wallet.usdcBalance.toLocaleString(undefined, { maximumFractionDigits: 6 })}
          </Text>
        </View>
        <View style={{ flex: 1, borderRadius: 14, padding: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", backgroundColor: "rgba(255,255,255,0.04)" }}>
          <Text style={{ color: "rgba(255,255,255,0.62)", fontSize: 10, fontWeight: "800" }}>USDT</Text>
          <Text style={{ marginTop: 4, color: "#fff", fontWeight: "900" }}>
            {balancesHidden ? "******" : wallet.usdtBalance.toLocaleString(undefined, { maximumFractionDigits: 6 })}
          </Text>
        </View>
      </View>
      <View
        style={{
          marginTop: 8,
          borderRadius: 14,
          padding: 10,
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.1)",
          backgroundColor: "rgba(255,255,255,0.04)",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <Text style={{ color: "rgba(255,255,255,0.62)", fontSize: 10, fontWeight: "800" }}>PI WALLET</Text>
        <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }}>{shortValue(wallet.savedPiAddress)}</Text>
      </View>

      <View
        style={{
          marginTop: 10,
          borderRadius: 14,
          padding: 10,
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.1)",
          backgroundColor: "rgba(255,255,255,0.04)",
          gap: 6,
        }}
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
          <Text style={{ color: "rgba(255,255,255,0.62)", fontWeight: "700", fontSize: 11 }}>Saved wallet</Text>
          <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }}>{shortAddress(wallet.savedAddress)}</Text>
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
          <Text style={{ color: "rgba(255,255,255,0.62)", fontWeight: "700", fontSize: 11 }}>Connected session</Text>
          <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }}>{shortAddress(wallet.connectedAddress)}</Text>
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
          <Text style={{ color: "rgba(255,255,255,0.62)", fontWeight: "700", fontSize: 11 }}>Saved PI wallet</Text>
          <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }}>{shortValue(wallet.savedPiAddress)}</Text>
        </View>
      </View>

      {!compact ? (
        <View
          style={{
            marginTop: 10,
            borderRadius: 14,
            padding: 10,
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.1)",
            backgroundColor: "rgba(255,255,255,0.04)",
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "900", fontSize: 13 }}>PI Wallet Address</Text>
          <Text style={{ marginTop: 4, color: "rgba(255,255,255,0.62)", fontSize: 11 }}>
            Save the PI wallet address sellers use for PI settlements.
          </Text>
          <TextInput
            value={piAddressInput}
            onChangeText={setPiAddressInput}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Enter PI wallet address"
            placeholderTextColor="rgba(255,255,255,0.42)"
            style={{
              marginTop: 8,
              height: 42,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.14)",
              backgroundColor: "rgba(255,255,255,0.06)",
              color: "#fff",
              fontWeight: "700",
              fontSize: 12,
              paddingHorizontal: 12,
            }}
          />
          <View style={{ marginTop: 8, flexDirection: "row", gap: 8 }}>
            <Pressable
              onPress={savePiWallet}
              disabled={piSaveDisabled}
              style={{
                flex: 1,
                borderRadius: 12,
                height: 40,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderColor: "rgba(45,212,191,0.4)",
                backgroundColor: "rgba(45,212,191,0.2)",
                opacity: piSaveDisabled ? 0.6 : 1,
              }}
            >
              <Text style={{ color: "#ECFEFF", fontWeight: "900", fontSize: 12 }}>
                {wallet.piSaving ? "Saving..." : "Save PI Wallet"}
              </Text>
            </Pressable>
            <Pressable
              onPress={async () => {
                const value = String(wallet.savedPiAddress || "").trim();
                if (!value) return;
                try {
                  await Clipboard.setStringAsync(value);
                  Alert.alert("Copied", "PI wallet address copied.");
                } catch {
                  Alert.alert("Copy failed", "Unable to copy PI wallet address right now.");
                }
              }}
              disabled={!wallet.savedPiAddress}
              style={{
                flex: 1,
                borderRadius: 12,
                height: 40,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.12)",
                backgroundColor: "rgba(255,255,255,0.05)",
                opacity: wallet.savedPiAddress ? 1 : 0.6,
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }}>Copy PI Wallet</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <View style={{ marginTop: 10 }}>
        <Text style={{ color: "rgba(255,255,255,0.7)", fontWeight: "800", fontSize: 11, marginBottom: 8 }}>
          Wallet Engine
        </Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable
            onPress={() => wallet.setWalletMode("walletconnect")}
            style={{
              flex: 1,
              borderRadius: 12,
              height: 38,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderColor: wallet.walletMode === "walletconnect" ? "rgba(124,58,237,0.55)" : "rgba(255,255,255,0.12)",
              backgroundColor: wallet.walletMode === "walletconnect" ? "rgba(124,58,237,0.2)" : "rgba(255,255,255,0.05)",
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Ionicons name="link-outline" size={14} color="#60A5FA" />
              <Text style={{ color: "#fff", fontWeight: "900", fontSize: 11 }}>WalletConnect</Text>
            </View>
          </Pressable>
          <Pressable
            onPress={() => wallet.setWalletMode("base_smart")}
            disabled={!wallet.baseSmartSupported}
            style={{
              flex: 1,
              borderRadius: 12,
              height: 38,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderColor: wallet.walletMode === "base_smart" ? "rgba(45,212,191,0.55)" : "rgba(255,255,255,0.12)",
              backgroundColor: wallet.walletMode === "base_smart" ? "rgba(45,212,191,0.2)" : "rgba(255,255,255,0.05)",
              opacity: wallet.baseSmartSupported ? 1 : 0.55,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Ionicons name="sparkles-outline" size={14} color="#2DD4BF" />
              <Text style={{ color: "#fff", fontWeight: "900", fontSize: 11 }}>Base wallet</Text>
            </View>
          </Pressable>
        </View>
        {!wallet.baseSmartSupported ? (
          <Text style={{ marginTop: 6, color: "rgba(255,255,255,0.55)", fontSize: 11 }}>
            Base Smart Account is currently available on web.
          </Text>
        ) : null}
      </View>

      <View style={{ marginTop: 10 }}>
        <Text style={{ color: "rgba(255,255,255,0.7)", fontWeight: "800", fontSize: 11, marginBottom: 8 }}>
          Network
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {wallet.chains.map((c) => {
            const selected = wallet.chain?.chain === c.chain;
            return (
              <Pressable
                key={c.chain}
                onPress={() => wallet.selectChain(c)}
                disabled={!c.active}
                style={{
                  marginRight: 8,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: selected ? "rgba(124,58,237,0.55)" : "rgba(255,255,255,0.12)",
                  backgroundColor: selected ? "rgba(124,58,237,0.2)" : "rgba(255,255,255,0.05)",
                  opacity: c.active ? 1 : 0.5,
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "900", fontSize: 11 }}>{chainLabel(c.chain)}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <View style={{ marginTop: 10, flexDirection: "row", gap: 8 }}>
        <Pressable
          onPress={wallet.connectWallet}
          disabled={wallet.busy || !wallet.chain?.active}
          style={{
            flex: 1,
            borderRadius: 14,
            height: 44,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#7C3AED",
            borderWidth: 1,
            borderColor: "#7C3AED",
            opacity: wallet.busy || !wallet.chain?.active ? 0.6 : 1,
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "900" }}>{wallet.busy ? "Working..." : "Connect Wallet"}</Text>
        </Pressable>
        <Pressable
          onPress={wallet.useConnectedWallet}
          disabled={wallet.busy || !wallet.chain?.active || !isAddress(wallet.connectedAddress)}
          style={{
            flex: 1,
            borderRadius: 14,
            height: 44,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(255,255,255,0.06)",
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.12)",
            opacity: wallet.busy || !wallet.chain?.active || !isAddress(wallet.connectedAddress) ? 0.6 : 1,
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "900" }}>Use Connected</Text>
        </Pressable>
      </View>

      <View style={{ marginTop: 8, flexDirection: "row", gap: 8 }}>
        <Pressable
          onPress={async () => {
            if (!copyAddress) return;
            try {
              await Clipboard.setStringAsync(copyAddress);
              Alert.alert("Copied", "Wallet address copied.");
            } catch {
              Alert.alert("Copy failed", "Unable to copy wallet address right now.");
            }
          }}
          disabled={!copyAddress}
          style={{
            flex: 1,
            borderRadius: 12,
            height: 40,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(255,255,255,0.06)",
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.1)",
            opacity: copyAddress ? 1 : 0.6,
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "800", fontSize: 12 }}>Copy Address</Text>
        </Pressable>
        <Pressable
          onPress={onOpenCryptoWallet}
          style={{
            flex: 1,
            borderRadius: 12,
            height: 40,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(255,255,255,0.06)",
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.1)",
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "800", fontSize: 12 }}>Open Crypto Wallet</Text>
        </Pressable>
      </View>

      <View
        style={{
          marginTop: 10,
          borderRadius: 14,
          padding: 10,
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.1)",
          backgroundColor: "rgba(255,255,255,0.04)",
        }}
      >
        <Text style={{ color: "#fff", fontWeight: "900", fontSize: 13 }}>Send Crypto</Text>
        <Text style={{ marginTop: 4, color: "rgba(255,255,255,0.62)", fontSize: 11 }}>
          Transfer USDC/USDT from your connected wallet.
        </Text>

        <View style={{ marginTop: 8, flexDirection: "row", gap: 8 }}>
          <Pressable
            onPress={() => setSendToken("USDC")}
            style={{
              flex: 1,
              height: 36,
              borderRadius: 10,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderColor: sendToken === "USDC" ? "rgba(124,58,237,0.5)" : "rgba(255,255,255,0.12)",
              backgroundColor: sendToken === "USDC" ? "rgba(124,58,237,0.22)" : "rgba(255,255,255,0.05)",
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "900", fontSize: 11 }}>USDC</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              if (!canSendUsdt) {
                Alert.alert("USDT unavailable", "USDT is not configured on the selected network.");
                return;
              }
              setSendToken("USDT");
            }}
            style={{
              flex: 1,
              height: 36,
              borderRadius: 10,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderColor: sendToken === "USDT" ? "rgba(45,212,191,0.5)" : "rgba(255,255,255,0.12)",
              backgroundColor: sendToken === "USDT" ? "rgba(45,212,191,0.22)" : "rgba(255,255,255,0.05)",
              opacity: canSendUsdt ? 1 : 0.55,
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "900", fontSize: 11 }}>USDT</Text>
          </Pressable>
        </View>

        <TextInput
          value={sendTo}
          onChangeText={setSendTo}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Recipient wallet address (0x...)"
          placeholderTextColor="rgba(255,255,255,0.42)"
          style={{
            marginTop: 8,
            height: 42,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.14)",
            backgroundColor: "rgba(255,255,255,0.06)",
            color: "#fff",
            fontWeight: "700",
            fontSize: 12,
            paddingHorizontal: 12,
          }}
        />
        <TextInput
          value={sendAmount}
          onChangeText={setSendAmount}
          keyboardType="decimal-pad"
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={`Amount (${sendToken})`}
          placeholderTextColor="rgba(255,255,255,0.42)"
          style={{
            marginTop: 8,
            height: 42,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.14)",
            backgroundColor: "rgba(255,255,255,0.06)",
            color: "#fff",
            fontWeight: "700",
            fontSize: 12,
            paddingHorizontal: 12,
          }}
        />

        <Pressable
          onPress={doSend}
          disabled={sendDisabled}
          style={{
            marginTop: 8,
            borderRadius: 12,
            height: 42,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(56,189,248,0.2)",
            borderWidth: 1,
            borderColor: "rgba(56,189,248,0.4)",
            opacity: sendDisabled ? 0.6 : 1,
          }}
        >
          <Text style={{ color: "#E0F2FE", fontWeight: "900", fontSize: 12 }}>
            {wallet.sendBusy ? "Sending..." : `Send ${sendToken}`}
          </Text>
        </Pressable>
      </View>

      {onOpenHistory ? (
        <Pressable
          onPress={onOpenHistory}
          style={{
            marginTop: 8,
            borderRadius: 12,
            height: 40,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(124,58,237,0.20)",
            borderWidth: 1,
            borderColor: "rgba(124,58,237,0.45)",
            flexDirection: "row",
            gap: 8,
          }}
        >
          <Ionicons name="time-outline" size={15} color="#fff" />
          <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }}>Transaction History</Text>
        </Pressable>
      ) : null}

      {!!wallet.error ? (
        <Text style={{ marginTop: 10, color: "#FCA5A5", fontWeight: "800", fontSize: 12 }}>{wallet.error}</Text>
      ) : null}
    </View>
  );
}
