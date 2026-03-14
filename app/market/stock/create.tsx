import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import AppHeader from "@/components/common/AppHeader";
import { fetchMarketChains } from "@/services/market/chainConfig";
import { isSupportedEvmStockChain } from "@/services/market/stockChains";
import { createStockIdentityOnchain } from "@/services/market/stockOnchain";
import { isWalletMismatchError } from "@/services/market/usdcCheckout";
import { supabase } from "@/services/supabase";
import { friendlyMarketError } from "@/utils/marketUx";

const BG_TOP = "#0D1B2A";
const BG_BOTTOM = "#071018";
const CARD = "rgba(255,255,255,0.06)";
const BORDER = "rgba(255,255,255,0.12)";
const MINT = "#2DD4BF";
const MUTED = "rgba(255,255,255,0.68)";
const CHAIN_ORDER: Record<string, number> = {
  base: 0,
  ethereum: 1,
  arbitrum: 2,
  optimism: 3,
  polygon: 4,
};

function formatMoney(value: number) {
  return Number(value || 0).toFixed(6).replace(/\.?0+$/, "");
}

function formatCreationMessage(economics?: {
  creation_fee_usdc?: number;
  liquidity_usdc?: number;
  reserve_usdc?: number;
  platform_usdc?: number;
} | null) {
  const fee = Number(economics?.creation_fee_usdc ?? 0);
  const liquidity = Number(economics?.liquidity_usdc ?? 0);
  const reserve = Number(economics?.reserve_usdc ?? economics?.platform_usdc ?? 0);
  if (fee <= 0) {
    return "EVM stock identity created on-chain. Current factory creation fee is $0.";
  }
  return `EVM stock identity created on-chain. Creation fee $${formatMoney(fee)} split into $${formatMoney(liquidity)} liquidity and $${formatMoney(reserve)} reserve.`;
}

export default function CreateStockIdentityScreen() {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [txExplorer, setTxExplorer] = useState<string | null>(null);
  const [successVisible, setSuccessVisible] = useState(false);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [slug, setSlug] = useState("");
  const [chains, setChains] = useState<any[]>([]);
  const [chain, setChain] = useState<string>("");
  const [sellerState, setSellerState] = useState<{ exists: boolean; verified: boolean; active: boolean }>({
    exists: false,
    verified: false,
    active: false,
  });

  const chainRows = useMemo(
    () =>
      (chains ?? [])
        .filter((c: any) =>
          c?.active &&
          isSupportedEvmStockChain(String(c?.chain || "")) &&
          c?.identity_factory &&
          c?.identity_router &&
          (c?.identity_stable_address || c?.usdc_address)
        )
        .sort((a: any, b: any) => {
          const left = CHAIN_ORDER[String(a?.chain || "").toLowerCase()] ?? 999;
          const right = CHAIN_ORDER[String(b?.chain || "").toLowerCase()] ?? 999;
          if (left !== right) return left - right;
          return String(a?.chain || "").localeCompare(String(b?.chain || ""));
        }),
    [chains],
  );

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const [{ data: auth, error: authErr }, chainData] = await Promise.all([
          supabase.auth.getUser(),
          fetchMarketChains(),
        ]);
        if (authErr) throw authErr;
        const uid = auth?.user?.id ?? null;
        if (!uid) throw new Error("Sign in first");

        const { data: seller, error: sellerErr } = await supabase
          .from("market_seller_profiles")
          .select("user_id,is_verified,active")
          .eq("user_id", uid)
          .maybeSingle();
        if (sellerErr) throw sellerErr;

        if (!mounted) return;
        const chainRows = (chainData ?? []).filter((c: any) =>
          c.active &&
          isSupportedEvmStockChain(String(c.chain || "")) &&
          c.identity_factory &&
          c.identity_router &&
          (c.identity_stable_address || c.usdc_address)
        );
        const defaultChain =
          chainRows.find((c: any) => String(c.chain || "").toLowerCase() === "base")?.chain ||
          chainRows[0]?.chain ||
          "";
        setChains(chainData ?? []);
        setChain(String(defaultChain));
        setSellerState({
          exists: !!seller?.user_id,
          verified: !!seller?.is_verified,
          active: seller?.active !== false && !!seller?.user_id,
        });
      } catch (e: any) {
        if (!mounted) return;
        setErr(friendlyMarketError(e, "Unable to prepare identity creation right now."));
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  async function onCreate() {
    setErr(null);
    setOkMsg(null);
    try {
      if (!name.trim() || name.trim().length < 3) throw new Error("Name must be at least 3 characters");
      if (!symbol.trim() || symbol.trim().length < 2) throw new Error("Symbol must be at least 2 characters");
      if (!chain.trim()) throw new Error("Select a chain");

      setConfirmVisible(false);
      setSubmitting(true);
      const res = await createStockIdentityOnchain({
        name: name.trim(),
        symbol: symbol.trim().toUpperCase(),
        chain,
        slug: slug.trim() || null,
      });

      if (!res?.ok) throw new Error("Identity creation failed");
      const createdSlug = String(res.identity?.slug || "");
      const createdTxHash = String(res?.tx_hash || "").trim();
      setTxHash(createdTxHash || null);
      setTxExplorer(String(res?.explorer_url || "").trim() || null);
      if (res?.repaired) {
        setOkMsg("Stock identity repaired and trading enabled.");
      } else if (res?.created === false) {
        setOkMsg("Stock identity already exists and is ready for trading.");
      } else {
        setOkMsg(formatCreationMessage(res?.economics ?? null));
      }
      setSuccessVisible(true);
      if (createdSlug) {
        setTimeout(() => {
          router.replace(`/market/stock/${createdSlug}` as any);
        }, 700);
      }
    } catch (e: any) {
      console.error("[stock-create-ui] create failed", {
        message: String(e?.message ?? e ?? ""),
        chain,
        name: name.trim(),
        symbol: symbol.trim().toUpperCase(),
      });
      if (isWalletMismatchError(e)) {
        Alert.alert(
          "Wallet mismatch detected",
          "Saved wallet does not match your connected wallet. Open Wallet and tap 'Use connected wallet' before creating stock.",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Open Wallet", onPress: () => router.push("/market/wallet" as any) },
          ],
        );
      }
      setErr(friendlyMarketError(e, "Could not create stock identity."));
    } finally {
      setSubmitting(false);
    }
  }

  const blockReason = !sellerState.exists
    ? "Create your seller profile first."
    : !sellerState.active
    ? "Your seller profile is inactive."
    : !sellerState.verified
    ? "Only verified stores can create stock identity."
    : null;

  return (
    <LinearGradient colors={[BG_TOP, BG_BOTTOM]} style={{ flex: 1, paddingHorizontal: 16, paddingTop: 14 }}>
      <AppHeader title="Create Digital Stock" subtitle="One EVM stock per verified store. Fixed supply: 100,000,000." />
      <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
        {loading ? (
          <View style={{ marginTop: 30, alignItems: "center" }}>
            <ActivityIndicator />
            <Text style={{ marginTop: 10, color: MUTED }}>Preparing screen...</Text>
          </View>
        ) : null}

        {!!blockReason ? (
          <View style={{ marginTop: 12, borderRadius: 14, padding: 12, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
            <Text style={{ color: "#FCA5A5", fontWeight: "900" }}>{blockReason}</Text>
            <Pressable
              onPress={() => router.push("/market/profile/create" as any)}
              style={{
                marginTop: 10,
                borderRadius: 12,
                paddingVertical: 10,
                alignItems: "center",
                backgroundColor: "rgba(45,212,191,0.16)",
                borderWidth: 1,
                borderColor: "rgba(45,212,191,0.42)",
              }}
            >
              <Text style={{ color: "#ECFEFF", fontWeight: "900" }}>Open Seller Profile</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={{ marginTop: 12, gap: 10 }}>
          <View style={{ borderRadius: 14, padding: 12, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
            <Text style={{ color: "#fff", fontWeight: "800" }}>Name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Example: Ada Fashion House"
              placeholderTextColor="rgba(255,255,255,0.45)"
              style={{ marginTop: 8, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, color: "#fff", backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: BORDER }}
              editable={!submitting && !loading && !blockReason}
            />
          </View>

          <View style={{ borderRadius: 14, padding: 12, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
            <Text style={{ color: "#fff", fontWeight: "800" }}>Symbol</Text>
            <TextInput
              value={symbol}
              onChangeText={(v) => setSymbol(v.toUpperCase())}
              placeholder="Example: ADAH"
              placeholderTextColor="rgba(255,255,255,0.45)"
              autoCapitalize="characters"
              style={{ marginTop: 8, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, color: "#fff", backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: BORDER }}
              editable={!submitting && !loading && !blockReason}
            />
          </View>

          <View style={{ borderRadius: 14, padding: 12, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
            <Text style={{ color: "#fff", fontWeight: "800" }}>Slug (optional)</Text>
            <TextInput
              value={slug}
              onChangeText={setSlug}
              placeholder="ada-fashion-house-stock"
              placeholderTextColor="rgba(255,255,255,0.45)"
              style={{ marginTop: 8, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, color: "#fff", backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: BORDER }}
              editable={!submitting && !loading && !blockReason}
            />
          </View>
        </View>

        <View style={{ marginTop: 12, borderRadius: 14, padding: 12, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
          <Text style={{ color: "#fff", fontWeight: "800" }}>Chain</Text>
          <View style={{ marginTop: 10, flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {chainRows.map((c: any) => {
              const active = chain === c.chain;
              return (
                <Pressable
                  key={String(c.chain)}
                  onPress={() => setChain(String(c.chain))}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 999,
                    backgroundColor: active ? "rgba(45,212,191,0.20)" : "rgba(255,255,255,0.05)",
                    borderWidth: 1,
                    borderColor: active ? "rgba(45,212,191,0.55)" : BORDER,
                  }}
                  disabled={!!blockReason || submitting}
                >
                  <Text style={{ color: "#fff", fontWeight: "800", fontSize: 12 }}>
                    {String(c.chain).toUpperCase().replace("_", " ")}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={{ marginTop: 12, borderRadius: 14, padding: 12, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
          <Text style={{ color: "#fff", fontWeight: "900", fontSize: 14 }}>Creation Economics</Text>
          <Text style={{ marginTop: 8, color: MUTED, fontSize: 12 }}>
            Creation fee is read from the on-chain factory when you submit.
          </Text>
          <Text style={{ marginTop: 3, color: MUTED, fontSize: 12 }}>
            New deployments default to $0 unless the contract admin updates the fee onchain.
          </Text>
          <Text style={{ marginTop: 3, color: MUTED, fontSize: 12 }}>
            Launch price is fixed onchain for a 100,000,000 supply stock to start below $5,000 market cap.
          </Text>
          <View style={{ marginTop: 8, flexDirection: "row", gap: 6, alignItems: "center" }}>
            <Ionicons name="shield-checkmark-outline" size={15} color={MINT} />
            <Text style={{ color: MUTED, fontSize: 11 }}>
              Reserved names/symbols are blocked unless your store has allow_reserved=true.
            </Text>
          </View>
        </View>

        {!!err ? (
          <View style={{ marginTop: 12, borderRadius: 12, padding: 10, backgroundColor: "rgba(127,29,29,0.26)", borderWidth: 1, borderColor: "rgba(239,68,68,0.35)" }}>
            <Text style={{ color: "#FCA5A5", fontWeight: "800" }}>{err}</Text>
          </View>
        ) : null}

        {!!okMsg ? (
          <View style={{ marginTop: 12, borderRadius: 12, padding: 10, backgroundColor: "rgba(6,78,59,0.26)", borderWidth: 1, borderColor: "rgba(16,185,129,0.40)" }}>
            <Text style={{ color: "#A7F3D0", fontWeight: "800" }}>{okMsg}</Text>
          </View>
        ) : null}

        <Pressable
          onPress={() => {
            if (!name.trim() || name.trim().length < 3) {
              setErr("Name must be at least 3 characters");
              return;
            }
            if (!symbol.trim() || symbol.trim().length < 2) {
              setErr("Symbol must be at least 2 characters");
              return;
            }
            if (!chain.trim()) {
              setErr("Select a chain");
              return;
            }
            setConfirmVisible(true);
          }}
          disabled={submitting || loading || !!blockReason}
          style={{
            marginTop: 14,
            borderRadius: 14,
            paddingVertical: 13,
            alignItems: "center",
            backgroundColor: submitting || loading || !!blockReason ? "rgba(45,212,191,0.25)" : "rgba(45,212,191,0.42)",
            borderWidth: 1,
            borderColor: "rgba(45,212,191,0.55)",
          }}
        >
          <Text style={{ color: "#ECFEFF", fontWeight: "900", fontSize: 15 }}>
            {submitting ? "Creating..." : "Create Stock Identity"}
          </Text>
        </Pressable>
      </ScrollView>

      <Modal visible={confirmVisible} transparent animationType="fade" onRequestClose={() => setConfirmVisible(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.62)", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <View style={{ width: "100%", maxWidth: 420, borderRadius: 16, padding: 14, backgroundColor: "#0B1220", borderWidth: 1, borderColor: BORDER }}>
            <Text style={{ color: "#fff", fontWeight: "900", fontSize: 16 }}>Confirm On-Chain Creation</Text>
            <Text style={{ marginTop: 8, color: MUTED, fontSize: 12 }}>Name: {name.trim()}</Text>
            <Text style={{ marginTop: 4, color: MUTED, fontSize: 12 }}>Symbol: {symbol.trim().toUpperCase()}</Text>
            <Text style={{ marginTop: 4, color: MUTED, fontSize: 12 }}>Chain: {chain.toUpperCase().replace("_", " ")}</Text>
            <Text style={{ marginTop: 8, color: "#E2E8F0", fontWeight: "800", fontSize: 12 }}>
              This will execute on-chain and read the current creation fee from the factory before your wallet signs.
            </Text>
            <Text style={{ marginTop: 4, color: MUTED, fontSize: 12 }}>
              The stock supply is fixed at 100,000,000 and the launch valuation is set onchain below $5,000 market cap.
            </Text>

            <View style={{ marginTop: 12, flexDirection: "row", gap: 8 }}>
              <Pressable
                onPress={() => setConfirmVisible(false)}
                style={{ flex: 1, borderRadius: 11, paddingVertical: 10, alignItems: "center", backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: BORDER }}
              >
                <Text style={{ color: "#fff", fontWeight: "800" }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={onCreate}
                disabled={submitting}
                style={{ flex: 1, borderRadius: 11, paddingVertical: 10, alignItems: "center", backgroundColor: "rgba(45,212,191,0.34)", borderWidth: 1, borderColor: "rgba(45,212,191,0.60)" }}
              >
                <Text style={{ color: "#ECFEFF", fontWeight: "900" }}>{submitting ? "Submitting..." : "Confirm"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={successVisible} transparent animationType="fade" onRequestClose={() => setSuccessVisible(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.62)", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <View style={{ width: "100%", maxWidth: 420, borderRadius: 16, padding: 14, backgroundColor: "#052019", borderWidth: 1, borderColor: "rgba(45,212,191,0.4)" }}>
            <Text style={{ color: "#A7F3D0", fontWeight: "900", fontSize: 16 }}>Creation Successful</Text>
            <Text style={{ marginTop: 8, color: "#ECFEFF", fontSize: 12 }}>
              Stock identity was created on-chain and synced to BestCity.
            </Text>
            {!!txHash ? (
              <Text style={{ marginTop: 8, color: "#99F6E4", fontSize: 11 }} numberOfLines={2}>
                Tx: {txHash}
              </Text>
            ) : null}
            <View style={{ marginTop: 12, flexDirection: "row", gap: 8 }}>
              <Pressable
                onPress={() => setSuccessVisible(false)}
                style={{ flex: 1, borderRadius: 10, paddingVertical: 9, alignItems: "center", backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "rgba(255,255,255,0.16)" }}
              >
                <Text style={{ color: "#fff", fontWeight: "800" }}>Close</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  if (txExplorer) Linking.openURL(txExplorer);
                }}
                disabled={!txExplorer}
                style={{ flex: 1, borderRadius: 10, paddingVertical: 9, alignItems: "center", backgroundColor: txExplorer ? "rgba(45,212,191,0.28)" : "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: txExplorer ? "rgba(45,212,191,0.56)" : "rgba(255,255,255,0.16)" }}
              >
                <Text style={{ color: "#ECFEFF", fontWeight: "900" }}>View On Explorer</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </LinearGradient>
  );
}


