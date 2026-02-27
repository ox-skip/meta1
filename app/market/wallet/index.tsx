import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
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
import { createPublicClient, formatUnits, http } from "viem";

import AppHeader from "@/components/common/AppHeader";
import {
  fetchMarketChains,
  getPreferredMarketChain,
  setPreferredMarketChain,
  type MarketChainConfig,
} from "@/services/market/chainConfig";
import { claimFaucet, readFaucetStatus, type FaucetStatus } from "@/services/market/faucet";
import {
  ensureWalletAddressOnChain,
  getMyPiWallet,
  getMyWalletForChain,
  isPiChain,
  replaceSavedWalletWithDevice,
  saveMyPiWallet,
} from "@/services/market/usdcCheckout";
import {
  connectActiveWalletEvm,
  getActiveWalletSession,
  subscribeActiveWalletSession,
} from "@/services/wallet/activeWalletSession";
import {
  getWalletModeSync,
  isBaseSmartSupported,
  setWalletMode as setPreferredWalletMode,
  subscribeWalletMode,
  type WalletMode,
} from "@/services/wallet/walletMode";
import { supabase } from "@/services/supabase";
import { getRpcUrlForChain } from "@/utils/aaWallet";
import { isNigeriaCountry, resolveUserCountry, type UserCountry } from "@/utils/country";
import { formatCountryLabel } from "@/utils/countryNames";
import { friendlyMarketError } from "@/utils/marketUx";

const ABI = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
] as const;

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

function formatCountdown(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(Number(totalSeconds || 0)));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export default function MarketWallet() {
  const { width } = useWindowDimensions();
  const wide = width >= 980;

  const [country, setCountry] = useState<UserCountry | undefined>(undefined);
  const isNigeria = isNigeriaCountry(country?.code || country?.name);

  const [chains, setChains] = useState<MarketChainConfig[]>([]);
  const [chain, setChain] = useState<MarketChainConfig | null>(null);
  const [chainErr, setChainErr] = useState<string | null>(null);
  const [walletAddr, setWalletAddr] = useState("");
  const [piWalletAddr, setPiWalletAddr] = useState("");
  const [piInput, setPiInput] = useState("");
  const [connectedAddr, setConnectedAddr] = useState("");
  const [walletMode, setWalletMode] = useState<WalletMode>(getWalletModeSync());
  const [busy, setBusy] = useState(false);
  const [piSaving, setPiSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [usdc, setUsdc] = useState("0");
  const [usdt, setUsdt] = useState("0");
  const [txs, setTxs] = useState<TxRow[]>([]);
  const [txLoading, setTxLoading] = useState(false);
  const [netOpen, setNetOpen] = useState(false);
  const [faucetLoading, setFaucetLoading] = useState(false);
  const [faucetBusy, setFaucetBusy] = useState(false);
  const [faucet, setFaucet] = useState<FaucetStatus | null>(null);
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const c = await resolveUserCountry({ prompt: true, refresh: true });
        if (mounted) {
          setCountry((prev) => c ?? prev ?? null);
        }
      } catch {
        if (mounted) {
          setCountry((prev) => prev ?? null);
        }
      }
    })();

    const sync = () => {
      const s = getActiveWalletSession();
      setConnectedAddr(s.connected ? String(s.address || "") : "");
    };
    sync();

    const unsub = subscribeActiveWalletSession(sync);
    const unsubMode = subscribeWalletMode((next) => setWalletMode(next));
    return () => {
      mounted = false;
      unsub();
      unsubMode();
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    setPiInput(piWalletAddr);
  }, [piWalletAddr]);

  async function loadPiWallet() {
    try {
      const row = await getMyPiWallet();
      const next = String((row as any)?.address || "").trim();
      setPiWalletAddr(next);
    } catch {
      setPiWalletAddr("");
    }
  }

  async function loadFaucet(selected?: MarketChainConfig | null, addrInput?: string | null) {
    const c = selected ?? chain;
    if (!c) {
      setFaucet(null);
      return;
    }

    const addr = String(addrInput || walletAddr || connectedAddr || "").trim();
    try {
      setFaucetLoading(true);
      const status = await readFaucetStatus(c, isAddress(addr) ? addr : null);
      setFaucet(status);
    } catch {
      setFaucet(null);
    } finally {
      setFaucetLoading(false);
    }
  }

  async function refresh(selected?: MarketChainConfig | null, forced?: string) {
    const c = selected ?? chain;
    if (!c) return "";

    let addr = String(forced || "").trim();
    if (!addr) {
      const row = await getMyWalletForChain(c.chain);
      addr = String(row?.address || "").trim();
    }

    setWalletAddr(addr);
    if (!isAddress(addr)) {
      setUsdc("0");
      setUsdt("0");
      await loadFaucet(c, "");
      return "";
    }

    const rpc = getRpcUrlForChain(c);
    if (!rpc) return addr;
    const client = createPublicClient({ transport: http(rpc) });

    try {
      if (isAddress(c.usdc_address)) {
        const d = Number(await client.readContract({ address: c.usdc_address as `0x${string}`, abi: ABI, functionName: "decimals" }));
        const raw = await client.readContract({ address: c.usdc_address as `0x${string}`, abi: ABI, functionName: "balanceOf", args: [addr as `0x${string}`] });
        setUsdc(formatUnits(raw as bigint, d));
      }
    } catch {
      setUsdc("0");
    }

    try {
      if (isAddress(c.usdt_address)) {
        const d = Number(await client.readContract({ address: c.usdt_address as `0x${string}`, abi: ABI, functionName: "decimals" }));
        const raw = await client.readContract({ address: c.usdt_address as `0x${string}`, abi: ABI, functionName: "balanceOf", args: [addr as `0x${string}`] });
        setUsdt(formatUnits(raw as bigint, d));
      } else {
        setUsdt("0");
      }
    } catch {
      setUsdt("0");
    }

    await loadFaucet(c, addr);

    return addr;
  }

  async function loadTx(addrInput?: string) {
    const addr = String(addrInput || walletAddr || "").trim();
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
  }

  async function loadChains() {
    try {
      setChainErr(null);
      const all = await fetchMarketChains();
      setChains(all);
      const selected = (await getPreferredMarketChain()) ?? all.find((c) => c.active) ?? all[0] ?? null;
      setChain(selected);
      const addr = await refresh(selected);
      await loadTx(addr);
      await loadPiWallet();
    } catch (e: any) {
      setChainErr(String(e?.message || "Unable to load networks."));
    }
  }

  useEffect(() => {
    loadChains();
  }, []);

  async function onConnect() {
    if (!chain) return;
    setErr(null);
    setBusy(true);
    try {
      if (isPiChain(chain.chain)) {
        throw new Error("PI network does not use EVM connect. Save your PI wallet address below.");
      }
      await connectActiveWalletEvm(60_000, { forceModal: true });
      const out = await ensureWalletAddressOnChain(chain);
      const addr = await refresh(chain, out.address);
      await loadTx(addr);
      Alert.alert("Wallet connected", "Wallet linked successfully.");
    } catch (e: any) {
      setErr(friendlyMarketError(e, "Unable to connect wallet."));
    } finally {
      setBusy(false);
    }
  }

  async function onUseConnected() {
    if (!chain) return;
    setErr(null);
    setBusy(true);
    try {
      if (isPiChain(chain.chain)) {
        throw new Error("PI network does not use EVM connect. Save your PI wallet address below.");
      }
      await connectActiveWalletEvm(60_000, { forceModal: true });
      const out = await replaceSavedWalletWithDevice(chain);
      const addr = await refresh(chain, out.address);
      await loadTx(addr);
      Alert.alert("Wallet updated", "Saved address synced to connected wallet.");
    } catch (e: any) {
      setErr(friendlyMarketError(e, "Could not sync wallet."));
    } finally {
      setBusy(false);
    }
  }

  async function onClaimFaucet() {
    if (!chain) return;
    setErr(null);
    setFaucetBusy(true);
    try {
      if (isPiChain(chain.chain)) {
        throw new Error("Faucet is only available for EVM testnet wallets.");
      }
      await connectActiveWalletEvm(60_000, { forceModal: true });
      const linked = await ensureWalletAddressOnChain(chain);
      const out = await claimFaucet(chain);
      const addr = await refresh(chain, linked.address);
      await loadTx(addr);
      await loadFaucet(chain, linked.address);
      const txRef = out.txHash || out.userOpHash;
      Alert.alert("Faucet claim sent", txRef ? `Reference: ${txRef}` : "Your faucet claim transaction was submitted.");
    } catch (e: any) {
      setErr(friendlyMarketError(e, "Unable to claim faucet."));
    } finally {
      setFaucetBusy(false);
    }
  }

  async function onSavePiWallet() {
    setErr(null);
    setPiSaving(true);
    try {
      const out = await saveMyPiWallet(piInput);
      const next = String((out as any)?.address || "").trim();
      setPiWalletAddr(next);
      setPiInput(next);
      Alert.alert("Saved", next ? "PI wallet address updated." : "PI wallet address cleared.");
    } catch (e: any) {
      setErr(friendlyMarketError(e, "Unable to save PI wallet address."));
    } finally {
      setPiSaving(false);
    }
  }

  const total = useMemo(() => Number(usdc || 0) + Number(usdt || 0), [usdc, usdt]);
  const copyAddress = useMemo(() => {
    if (isAddress(walletAddr)) return walletAddr;
    if (isAddress(connectedAddr)) return connectedAddr;
    return "";
  }, [walletAddr, connectedAddr]);
  const locationText = useMemo(() => {
    if (!country) return "Location unavailable";
    return [country.city, country.region, formatCountryLabel(country.name, country.code)].filter(Boolean).join(", ");
  }, [country]);

  const modeTitle = walletMode === "base_smart" ? "Base Smart Account" : "WalletConnect";
  const modeSubtitle =
    walletMode === "base_smart"
      ? "Use Base smart account signing and approvals."
      : "Use WalletConnect wallet chooser and session signing.";
  const faucetSecondsLeft = useMemo(() => {
    const next = Number(faucet?.nextClaimAt ?? 0);
    if (!Number.isFinite(next) || next <= 0) return 0;
    return Math.max(0, next - nowSec);
  }, [faucet?.nextClaimAt, nowSec]);
  const faucetUsdcDisplay = useMemo(() => fmt(formatUnits(faucet?.usdcAmountRaw ?? 0n, 6)), [faucet?.usdcAmountRaw]);
  const faucetUsdtDisplay = useMemo(() => fmt(formatUnits(faucet?.usdtAmountRaw ?? 0n, 6)), [faucet?.usdtAmountRaw]);
  const faucetReady = Boolean(faucet?.available);
  const faucetClaimDisabled = Boolean(!chain?.active || faucetBusy || busy || faucetLoading || !faucetReady || faucetSecondsLeft > 0);

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
              <View style={[s.statePill, connectedAddr ? s.okPill : s.idlePill]}>
                <Text style={s.stateText}>{connectedAddr ? "Connected" : "Not connected"}</Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                {isNigeria ? (
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
                try {
                  setErr(null);
                  await setPreferredWalletMode("walletconnect");
                } catch (e: any) {
                  setErr(friendlyMarketError(e, "Unable to switch wallet mode."));
                }
              }}
              style={[
                s.engineBtn,
                walletMode === "walletconnect" ? s.engineBtnActivePurple : undefined,
              ]}
            >
              <View style={s.engineInner}>
                <Ionicons name="link-outline" size={14} color="#60A5FA" />
                <Text style={s.engineText}>WalletConnect</Text>
              </View>
            </Pressable>
            <Pressable
              onPress={async () => {
                try {
                  setErr(null);
                  await setPreferredWalletMode("base_smart");
                } catch (e: any) {
                  setErr(friendlyMarketError(e, "Unable to switch wallet mode."));
                }
              }}
              disabled={!isBaseSmartSupported()}
              style={[
                s.engineBtn,
                walletMode === "base_smart" ? s.engineBtnActiveGreen : undefined,
                !isBaseSmartSupported() ? s.dimmed : undefined,
              ]}
            >
              <View style={s.engineInner}>
                <Ionicons name="sparkles-outline" size={14} color="#2DD4BF" />
                <Text style={s.engineText}>Base Wallet</Text>
              </View>
            </Pressable>
          </View>
          {!isBaseSmartSupported() ? (
            <Text style={{ marginTop: 6, color: "rgba(255,255,255,0.58)", fontSize: 11 }}>
              Base Smart is currently available on web.
            </Text>
          ) : null}

          {!!err ? <Text style={s.err}>{err}</Text> : null}
          {!!chainErr ? <Text style={s.err}>{chainErr}</Text> : null}

          <View style={[s.grid, wide && s.gridWide]}>
            <View style={s.col}>
              <View style={s.card}>
                <View style={s.rowBetween}>
                  <Text style={s.h}>Network</Text>
                  <Pressable style={s.iconBtn} disabled={busy} onPress={loadChains}>
                    <Ionicons name="refresh" size={15} color="#fff" />
                  </Pressable>
                </View>

                <Pressable style={s.selector} onPress={() => setNetOpen(true)}>
                  <Text style={s.selectorText}>{chain ? chainLabel(chain.chain) : "Select network"}</Text>
                  <Ionicons name="chevron-down" size={16} color="#fff" />
                </Pressable>

                <View style={s.metricsRow}>
                  <View style={s.metric}>
                    <Text style={s.metricLabel}>USDC</Text>
                    <Text style={s.metricValue}>{fmt(usdc)}</Text>
                  </View>
                  <View style={s.metric}>
                    <Text style={s.metricLabel}>USDT</Text>
                    <Text style={s.metricValue}>{fmt(usdt)}</Text>
                  </View>
                  <View style={[s.metric, s.metricAccent]}>
                    <Text style={s.metricLabel}>TOTAL</Text>
                    <Text style={s.metricValue}>{fmt(String(total))}</Text>
                  </View>
                </View>

                <View style={s.faucetCard}>
                  <View style={s.rowBetween}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.faucetTitle}>Testnet Faucet</Text>
                      <Text style={s.faucetSub}>
                        {faucetReady
                          ? `Claim ${faucetUsdcDisplay} USDC + ${faucetUsdtDisplay} USDT every ${Math.max(
                              1,
                              Math.round(Number(faucet?.cooldownSeconds || 86_400) / 3600)
                            )}h`
                          : "Faucet is not active on this selected network."}
                      </Text>
                    </View>
                    <Ionicons name="water-outline" size={17} color="#93C5FD" />
                  </View>
                  <Pressable
                    style={[s.faucetBtn, faucetClaimDisabled && s.dimmed]}
                    disabled={faucetClaimDisabled}
                    onPress={onClaimFaucet}
                  >
                    <Text style={s.mainText}>
                      {faucetBusy
                        ? "Claiming..."
                        : faucetLoading
                        ? "Checking faucet..."
                        : faucetSecondsLeft > 0
                        ? `Next claim in ${formatCountdown(faucetSecondsLeft)}`
                        : "Claim Faucet"}
                    </Text>
                  </Pressable>
                  {!faucetReady ? (
                    <Text style={s.dim}>Switch to an active faucet network to claim test tokens.</Text>
                  ) : null}
                </View>

                <View style={s.addrCard}>
                  <View style={s.addrRow}>
                    <Text style={s.addrLabel}>Saved</Text>
                    <Text style={s.addrValue}>{shortAddr(walletAddr)}</Text>
                  </View>
                  <View style={s.addrRow}>
                    <Text style={s.addrLabel}>Session</Text>
                    <Text style={s.addrValue}>{shortAddr(connectedAddr)}</Text>
                  </View>
                  <View style={s.addrRow}>
                    <Text style={s.addrLabel}>PI wallet</Text>
                    <Text style={s.addrValue}>{shortValue(piWalletAddr)}</Text>
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
                      disabled={piSaving || piInput.trim() === String(piWalletAddr || "").trim()}
                      onPress={onSavePiWallet}
                    >
                      <Text style={s.btnText}>{piSaving ? "Saving..." : "Save PI Wallet"}</Text>
                    </Pressable>
                    <Pressable
                      style={s.btnSmall}
                      disabled={!piWalletAddr}
                      onPress={async () => {
                        if (!piWalletAddr) return;
                        try {
                          await Clipboard.setStringAsync(piWalletAddr);
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
                  <Pressable style={s.btnSmall} disabled={txLoading || busy} onPress={() => loadTx()}>
                    <Text style={s.btnText}>{txLoading ? "Loading..." : "Refresh Activity"}</Text>
                  </Pressable>
                </View>

                <Pressable style={[s.main, (!chain?.active || busy) && s.dimmed]} disabled={!chain?.active || busy} onPress={onConnect}>
                  <Text style={s.mainText}>{busy ? "Connecting..." : "Connect Wallet"}</Text>
                </Pressable>
                <Pressable style={[s.altBtn, (!chain?.active || busy || !connectedAddr) && s.dimmed]} disabled={!chain?.active || busy || !connectedAddr} onPress={onUseConnected}>
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
            {chains.map((c) => (
              <Pressable
                key={c.chain}
                style={[s.selector, !c.active && s.dimmed]}
                disabled={!c.active}
                onPress={async () => {
                  setNetOpen(false);
                  setChain(c);
                  await setPreferredMarketChain(c.chain);
                  const addr = await refresh(c);
                  await loadTx(addr);
                }}
              >
                <Text style={s.selectorText}>{chainLabel(c.chain)}</Text>
                {chain?.chain === c.chain ? <Ionicons name="checkmark-circle" size={16} color="#A78BFA" /> : null}
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
  faucetCard: {
    marginTop: 10,
    borderRadius: 12,
    padding: 10,
    backgroundColor: "rgba(59,130,246,0.12)",
    borderWidth: 1,
    borderColor: "rgba(147,197,253,0.35)",
    gap: 8,
  },
  faucetTitle: { color: "#DBEAFE", fontWeight: "900", fontSize: 12 },
  faucetSub: { marginTop: 3, color: "rgba(219,234,254,0.82)", fontSize: 11, fontWeight: "700" },
  faucetBtn: {
    minHeight: 42,
    borderRadius: 12,
    backgroundColor: "#2563EB",
    borderWidth: 1,
    borderColor: "rgba(147,197,253,0.65)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
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
