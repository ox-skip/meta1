import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
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
import { useUnifiedWallet } from "@/components/market/wallet/useUnifiedWallet";
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

function fmt(v: string) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 6 }) : "0";
}

function shortAddr(value?: string | null) {
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

function chainLabel(raw?: string | null) {
  return String(raw || "").toUpperCase().replace(/_/g, " ");
}

function statusTone(status?: string | null) {
  const s = String(status || "").toUpperCase();
  if (["COMPLETED", "SUCCESS", "CONFIRMED", "FINALIZED"].includes(s)) {
    return { bg: "rgba(16,185,129,0.2)", border: "rgba(16,185,129,0.4)", text: "#A7F3D0" };
  }
  if (["FAILED", "REVERTED", "ERROR", "CANCELLED"].includes(s)) {
    return { bg: "rgba(239,68,68,0.2)", border: "rgba(239,68,68,0.4)", text: "#FECACA" };
  }
  return { bg: "rgba(255,255,255,0.08)", border: "rgba(255,255,255,0.12)", text: "#E5E7EB" };
}

export default function MarketWallet() {
  const { width } = useWindowDimensions();
  const wide = width >= 980;
  const wallet = useUnifiedWallet();
  const [piInput, setPiInput] = useState("");
  const [txs, setTxs] = useState<TxRow[]>([]);
  const [txLoading, setTxLoading] = useState(false);
  const [netOpen, setNetOpen] = useState(false);

  useEffect(() => {
    setPiInput(wallet.savedPiAddress || "");
  }, [wallet.savedPiAddress]);

  const loadTx = useCallback(async (addrInput?: string) => {
    const addr = String(addrInput || wallet.savedAddress || wallet.connectedAddress || "").trim();
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
        .limit(20);
      if (error) throw error;
      const rows = ((data as TxRow[]) || []).filter((row) => shouldShowTxForAddress(row, addr));
      setTxs(rows);
    } catch {
      setTxs([]);
    } finally {
      setTxLoading(false);
    }
  }, [wallet.connectedAddress, wallet.savedAddress]);

  useEffect(() => {
    void loadTx();
  }, [loadTx, wallet.chain?.chain, wallet.connectedAddress, wallet.savedAddress]);

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

  const total = useMemo(() => Number(wallet.usdcBalance || 0) + Number(wallet.usdtBalance || 0), [wallet.usdcBalance, wallet.usdtBalance]);
  const copyAddress = useMemo(() => {
    if (isAddress(wallet.savedAddress)) return wallet.savedAddress;
    if (isAddress(wallet.connectedAddress)) return wallet.connectedAddress;
    return "";
  }, [wallet.connectedAddress, wallet.savedAddress]);
  const locationText = useMemo(() => {
    if (!wallet.country) return "Location unavailable";
    return [wallet.country.city, wallet.country.region, formatCountryLabel(wallet.country.name, wallet.country.code)].filter(Boolean).join(", ");
  }, [wallet.country]);

  const modeTitle = wallet.walletMode === "base_smart" ? "Base Smart Account" : "WalletConnect";
  const modeSubtitle =
    wallet.walletMode === "base_smart"
      ? "Use Base smart account signing and approvals."
      : "Use WalletConnect wallet chooser and session signing.";

  return (
    <LinearGradient colors={["#140C36", "#05040B"]} style={{ flex: 1 }}>
      <View style={[s.wrap, wide && s.wrapWide]}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 28 }}>
          <View style={{ paddingTop: 14 }}>
            <AppHeader title="Crypto Wallet" subtitle="Choose WalletConnect or Base Smart Account" />
          </View>

          <View style={s.hero}>
            <View style={{ flex: 1 }}>
              <Text style={s.heroTitle}>{modeTitle}</Text>
              <Text style={s.heroSub}>{modeSubtitle}</Text>
            </View>
            <View style={s.heroMeta}>
              <View style={[s.statePill, wallet.connectedAddress ? s.okPill : s.idlePill]}>
                <Text style={s.stateText}>{wallet.connectedAddress ? "Connected" : "Not connected"}</Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                {wallet.isNigeria ? (
                  <Pressable onPress={() => router.push("/fintech/(tabs)/wallet?action=fund" as any)}>
                    <Text style={s.link}>Open NGN Wallet</Text>
                  </Pressable>
                ) : null}
                <Pressable onPress={() => router.push("/market/history" as any)}>
                  <Text style={s.link}>History</Text>
                </Pressable>
              </View>
            </View>
            <Text style={s.locationText}>{locationText}</Text>
          </View>

          <View style={s.engineRow}>
            <Pressable
              onPress={async () => {
                await wallet.setWalletMode("walletconnect");
              }}
              style={[
                s.engineBtn,
                wallet.walletMode === "walletconnect" ? s.engineBtnActivePurple : undefined,
              ]}
            >
              <View style={s.engineInner}>
                <Ionicons name="link-outline" size={14} color="#60A5FA" />
                <Text style={s.engineText}>WalletConnect</Text>
              </View>
            </Pressable>
            <Pressable
              onPress={async () => {
                await wallet.setWalletMode("base_smart");
              }}
              disabled={!wallet.baseSmartSupported}
              style={[
                s.engineBtn,
                wallet.walletMode === "base_smart" ? s.engineBtnActiveGreen : undefined,
                !wallet.baseSmartSupported ? s.dimmed : undefined,
              ]}
            >
              <View style={s.engineInner}>
                <Ionicons name="sparkles-outline" size={14} color="#2DD4BF" />
                <Text style={s.engineText}>Base Wallet</Text>
              </View>
            </Pressable>
          </View>
          {!wallet.baseSmartSupported ? (
            <Text style={{ marginTop: 6, color: "rgba(255,255,255,0.58)", fontSize: 11 }}>
              Base Smart is currently available on web.
            </Text>
          ) : null}

          {!!wallet.error ? <Text style={s.err}>{wallet.error}</Text> : null}

          <View style={[s.grid, wide && s.gridWide]}>
            <View style={s.col}>
              <View style={s.card}>
                <View style={s.rowBetween}>
                  <Text style={s.h}>Network</Text>
                  <Pressable
                    style={s.iconBtn}
                    disabled={wallet.busy}
                    onPress={async () => {
                      await wallet.refreshAll();
                      await loadTx();
                    }}
                  >
                    <Ionicons name="refresh" size={15} color="#fff" />
                  </Pressable>
                </View>

                <Pressable style={s.selector} onPress={() => setNetOpen(true)}>
                  <Text style={s.selectorText}>{wallet.chain ? chainLabel(wallet.chain.chain) : "Select network"}</Text>
                  <Ionicons name="chevron-down" size={16} color="#fff" />
                </Pressable>

                <View style={s.metricsRow}>
                  <View style={s.metric}>
                    <Text style={s.metricLabel}>USDC</Text>
                    <Text style={s.metricValue}>{fmt(String(wallet.usdcBalance))}</Text>
                  </View>
                  <View style={s.metric}>
                    <Text style={s.metricLabel}>USDT</Text>
                    <Text style={s.metricValue}>{fmt(String(wallet.usdtBalance))}</Text>
                  </View>
                  <View style={[s.metric, s.metricAccent]}>
                    <Text style={s.metricLabel}>TOTAL</Text>
                    <Text style={s.metricValue}>{fmt(String(total))}</Text>
                  </View>
                </View>

                <View style={s.addrCard}>
                  <View style={s.addrRow}>
                    <Text style={s.addrLabel}>Saved</Text>
                    <Text style={s.addrValue}>{shortAddr(wallet.savedAddress)}</Text>
                  </View>
                  <View style={s.addrRow}>
                    <Text style={s.addrLabel}>Session</Text>
                    <Text style={s.addrValue}>{shortAddr(wallet.connectedAddress)}</Text>
                  </View>
                  <View style={s.addrRow}>
                    <Text style={s.addrLabel}>PI wallet</Text>
                    <Text style={s.addrValue}>{shortValue(wallet.savedPiAddress)}</Text>
                  </View>
                </View>

                <View style={s.addrCard}>
                  <Text style={s.addrLabel}>Save PI wallet address</Text>
                  <TextInput
                    value={piInput}
                    onChangeText={setPiInput}
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
                  <View style={s.row}>
                    <Pressable
                      style={s.btnSmall}
                      disabled={wallet.piSaving || piInput.trim() === String(wallet.savedPiAddress || "").trim()}
                      onPress={onSavePiWallet}
                    >
                      <Text style={s.btnText}>{wallet.piSaving ? "Saving..." : "Save PI Wallet"}</Text>
                    </Pressable>
                    <Pressable
                      style={s.btnSmall}
                      disabled={!wallet.savedPiAddress}
                      onPress={async () => {
                        if (!wallet.savedPiAddress) return;
                        try {
                          await Clipboard.setStringAsync(wallet.savedPiAddress);
                          Alert.alert("Copied", "PI wallet address copied.");
                        } catch {
                          Alert.alert("Copy failed", "Unable to copy PI wallet address right now.");
                        }
                      }}
                    >
                      <Text style={s.btnText}>Copy PI Wallet</Text>
                    </Pressable>
                  </View>
                </View>

                <View style={s.row}>
                  <Pressable
                    style={s.btnSmall}
                    disabled={!copyAddress}
                    onPress={async () => {
                      if (!copyAddress) return;
                      try {
                        await Clipboard.setStringAsync(copyAddress);
                        Alert.alert("Copied", "Wallet address copied.");
                      } catch {
                        Alert.alert("Copy failed", "Unable to copy wallet address right now.");
                      }
                    }}
                  >
                    <Text style={s.btnText}>Copy Address</Text>
                  </Pressable>
                  <Pressable style={s.btnSmall} disabled={txLoading || wallet.busy} onPress={() => loadTx()}>
                    <Text style={s.btnText}>{txLoading ? "Loading..." : "Refresh Activity"}</Text>
                  </Pressable>
                </View>

                <Pressable style={[s.main, (!wallet.chain?.active || wallet.busy) && s.dimmed]} disabled={!wallet.chain?.active || wallet.busy} onPress={onConnect}>
                  <Text style={s.mainText}>{wallet.busy ? "Connecting..." : "Connect Wallet"}</Text>
                </Pressable>
                <Pressable style={[s.altBtn, (!wallet.chain?.active || wallet.busy || !wallet.connectedAddress) && s.dimmed]} disabled={!wallet.chain?.active || wallet.busy || !wallet.connectedAddress} onPress={onUseConnected}>
                  <Text style={s.btnText}>Use Connected Wallet</Text>
                </Pressable>
              </View>
            </View>

            <View style={s.col}>
              <View style={s.card}>
                <View style={s.rowBetween}>
                  <Text style={s.h}>Activity</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    {txLoading ? <ActivityIndicator size="small" /> : null}
                    <Pressable style={s.iconBtn} onPress={() => router.push("/market/history" as any)}>
                      <Ionicons name="time-outline" size={15} color="#fff" />
                    </Pressable>
                  </View>
                </View>

                <FlatList
                  data={txs}
                  keyExtractor={(i) => i.id}
                  scrollEnabled={false}
                  ListEmptyComponent={
                    <View style={s.emptyWrap}>
                      <Ionicons name="hourglass-outline" size={18} color="rgba(255,255,255,0.55)" />
                      <Text style={s.dim}>No crypto activity yet.</Text>
                    </View>
                  }
                  renderItem={({ item }) => {
                    const tone = statusTone(item.status);
                    return (
                      <View style={s.tx}>
                        <View style={s.rowBetween}>
                          <Text style={s.txTitle}>{item.intent_type || "Intent"}</Text>
                          <View style={[s.txStatus, { backgroundColor: tone.bg, borderColor: tone.border }]}>
                            <Text style={[s.txStatusText, { color: tone.text }]}>{item.status || "pending"}</Text>
                          </View>
                        </View>
                        <Text style={s.dim}>{new Date(item.created_at).toLocaleString()}</Text>
                        <Text style={s.dim}>{chainLabel(item.chain)}</Text>
                        {!!item.tx_hash ? <Text numberOfLines={1} style={s.dim}>Tx: {item.tx_hash}</Text> : null}
                      </View>
                    );
                  }}
                />
              </View>
            </View>
          </View>
        </ScrollView>
      </View>

      <Modal visible={netOpen} transparent animationType="fade" onRequestClose={() => setNetOpen(false)}>
        <View style={s.modalBg}>
          <View style={s.modalCard}>
            <View style={s.rowBetween}>
              <Text style={s.h}>Select network</Text>
              <Pressable onPress={() => setNetOpen(false)}>
                <Ionicons name="close" size={18} color="#fff" />
              </Pressable>
            </View>
            {wallet.chains.map((c) => (
              <Pressable
                key={c.chain}
                style={[s.selector, !c.active && s.dimmed]}
                disabled={!c.active}
                onPress={async () => {
                  setNetOpen(false);
                  await wallet.selectChain(c);
                  await loadTx();
                }}
              >
                <Text style={s.selectorText}>{chainLabel(c.chain)}</Text>
                {wallet.chain?.chain === c.chain ? <Ionicons name="checkmark-circle" size={16} color="#A78BFA" /> : null}
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, width: "100%", alignSelf: "center" },
  wrapWide: { maxWidth: 1160 },
  hero: {
    marginTop: 12,
    borderRadius: 18,
    padding: 16,
    backgroundColor: "rgba(124,58,237,0.16)",
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.35)",
  },
  heroTitle: { color: "#fff", fontWeight: "900", fontSize: 18 },
  heroSub: { marginTop: 4, color: "rgba(255,255,255,0.75)", fontSize: 12 },
  heroMeta: { marginTop: 10, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  statePill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  okPill: { backgroundColor: "rgba(16,185,129,0.2)", borderColor: "rgba(16,185,129,0.4)" },
  idlePill: { backgroundColor: "rgba(255,255,255,0.08)", borderColor: "rgba(255,255,255,0.16)" },
  stateText: { color: "#fff", fontWeight: "900", fontSize: 11 },
  link: { color: "#ECFEFF", fontWeight: "900", fontSize: 12 },
  locationText: { marginTop: 8, color: "rgba(255,255,255,0.62)", fontSize: 11 },
  engineRow: { marginTop: 10, flexDirection: "row", gap: 8 },
  engineBtn: {
    flex: 1,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  engineBtnActivePurple: {
    borderColor: "rgba(124,58,237,0.55)",
    backgroundColor: "rgba(124,58,237,0.22)",
  },
  engineBtnActiveGreen: {
    borderColor: "rgba(45,212,191,0.55)",
    backgroundColor: "rgba(45,212,191,0.22)",
  },
  engineInner: { flexDirection: "row", alignItems: "center", gap: 6 },
  engineText: { color: "#fff", fontWeight: "900", fontSize: 12 },
  grid: { marginTop: 12, gap: 12 },
  gridWide: { flexDirection: "row", alignItems: "flex-start" },
  col: { flex: 1, minWidth: 0 },
  card: {
    borderRadius: 18,
    padding: 14,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.11)",
  },
  h: { color: "#fff", fontWeight: "900", fontSize: 15 },
  row: { marginTop: 10, flexDirection: "row", gap: 10, alignItems: "center" },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  selector: {
    marginTop: 10,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.05)",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  selectorText: { color: "#fff", fontWeight: "800", fontSize: 12 },
  metricsRow: { marginTop: 10, flexDirection: "row", gap: 8 },
  metric: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 10,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  metricAccent: {
    backgroundColor: "rgba(124,58,237,0.18)",
    borderColor: "rgba(167,139,250,0.35)",
  },
  metricLabel: { color: "rgba(255,255,255,0.62)", fontSize: 10, fontWeight: "800" },
  metricValue: { marginTop: 4, color: "#fff", fontWeight: "900", fontSize: 14 },
  addrCard: {
    marginTop: 10,
    borderRadius: 12,
    padding: 10,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    gap: 8,
  },
  addrRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  addrLabel: { color: "rgba(255,255,255,0.62)", fontSize: 11, fontWeight: "700" },
  addrValue: { color: "#fff", fontWeight: "800", fontSize: 12 },
  btnSmall: {
    flex: 1,
    minHeight: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.05)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  btnText: { color: "#fff", fontWeight: "800", fontSize: 12 },
  main: {
    marginTop: 10,
    height: 46,
    borderRadius: 12,
    backgroundColor: "#7C3AED",
    borderWidth: 1,
    borderColor: "#7C3AED",
    alignItems: "center",
    justifyContent: "center",
  },
  altBtn: {
    marginTop: 10,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.05)",
    alignItems: "center",
    justifyContent: "center",
  },
  mainText: { color: "#fff", fontWeight: "900" },
  dim: { marginTop: 6, color: "rgba(255,255,255,0.65)", fontSize: 11 },
  err: { marginTop: 8, color: "#FCA5A5", fontWeight: "800", fontSize: 12, paddingHorizontal: 4 },
  emptyWrap: { marginTop: 14, alignItems: "center" },
  tx: {
    marginTop: 10,
    borderRadius: 12,
    padding: 10,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.09)",
  },
  txTitle: { color: "#fff", fontWeight: "800", fontSize: 12 },
  txStatus: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  txStatusText: { fontWeight: "900", fontSize: 10 },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.52)", justifyContent: "center", padding: 16 },
  modalCard: { borderRadius: 16, padding: 14, backgroundColor: "#0D0B1D", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)" },
  dimmed: { opacity: 0.45 },
});
