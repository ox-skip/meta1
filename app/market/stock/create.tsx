import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

import AppHeader from "@/components/common/AppHeader";
import {
  STOCK,
  StockAlert,
  StockField,
  StockInput,
  StockLoadingState,
  StockMetric,
  StockPanel,
  StockPill,
  StockScreen,
  formatStockMoney,
  stockChainLabel,
} from "@/components/market/stock/StockUi";
import { fetchMarketChains } from "@/services/market/chainConfig";
import { isSupportedEvmStockChain } from "@/services/market/stockChains";
import { createStockIdentityOnchain } from "@/services/market/stockOnchain";
import { isWalletMismatchError } from "@/services/market/usdcCheckout";
import { supabase } from "@/services/supabase";
import { friendlyMarketError } from "@/utils/marketUx";

const CHAIN_ORDER: Record<string, number> = {
  base: 0,
  polygon: 1,
  bnb: 2,
  ethereum: 3,
  arbitrum: 4,
  optimism: 5,
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
    return "Stock market created. No setup fee was charged.";
  }
  return `Stock market created. Setup $${formatMoney(fee)}; $${formatMoney(liquidity)} opening liquidity and $${formatMoney(reserve)} platform reserve.`;
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
          c?.identity_ownership_controller &&
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
        const availableChains = (chainData ?? []).filter((c: any) =>
          c.active &&
          isSupportedEvmStockChain(String(c.chain || "")) &&
          c.identity_factory &&
          c.identity_router &&
          c.identity_ownership_controller &&
          (c.identity_stable_address || c.usdc_address)
        );
        const defaultChain =
          availableChains.find((c: any) => String(c.chain || "").toLowerCase() === "base")?.chain ||
          availableChains[0]?.chain ||
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
        setErr(friendlyMarketError(e, "Unable to prepare stock launch."));
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
      if (!chain.trim()) throw new Error("Select a network");

      setConfirmVisible(false);
      setSubmitting(true);
      const res = await createStockIdentityOnchain({
        name: name.trim(),
        symbol: symbol.trim().toUpperCase(),
        chain,
        slug: slug.trim() || null,
      });

      if (!res?.ok) throw new Error("Stock launch failed");
      const createdSlug = String(res.identity?.slug || "");
      const createdTxHash = String(res?.tx_hash || "").trim();
      setTxHash(createdTxHash || null);
      setTxExplorer(String(res?.explorer_url || "").trim() || null);
      if (res?.repaired) {
        setOkMsg("Stock market recovered and trading enabled.");
      } else if (res?.created === false) {
        setOkMsg("Stock market already exists and is ready for trading.");
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
      console.warn("[CreateStockIdentity] failed", {
        message: String(e?.message || e || ""),
        details: e?.details ?? null,
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
      setErr(friendlyMarketError(e, "Could not create stock market."));
    } finally {
      setSubmitting(false);
    }
  }

  function requestConfirm() {
    setErr(null);
    if (!name.trim() || name.trim().length < 3) {
      setErr("Name must be at least 3 characters");
      return;
    }
    if (!symbol.trim() || symbol.trim().length < 2) {
      setErr("Symbol must be at least 2 characters");
      return;
    }
    if (!chain.trim()) {
      setErr("Select a network");
      return;
    }
    setConfirmVisible(true);
  }

  const blockReason = !sellerState.exists
    ? "Create your seller profile first."
    : !sellerState.active
    ? "Your seller profile is inactive."
    : !sellerState.verified
    ? "Only verified stores can create a stock market."
    : null;

  const disabled = submitting || loading || !!blockReason;

  return (
    <StockScreen>
      <AppHeader title="Launch Stock" subtitle="Open a tradable market for your verified store." />
      <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
        <StockPanel style={{ marginTop: 10, padding: 16, backgroundColor: "rgba(255,255,255,0.08)" }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <StockPill label="Market Launch" tone="cyan" icon="sparkles-outline" compact />
              <Text style={{ marginTop: 12, color: STOCK.ink, fontSize: 30, fontWeight: "900" }}>
                Shape the opening market
              </Text>
              <Text style={{ marginTop: 6, color: STOCK.muted, fontWeight: "800", lineHeight: 19 }}>
                Fixed supply, verified seller launch, and guarded early trading from the first listing.
              </Text>
            </View>
            <View
              style={{
                width: 54,
                height: 54,
                borderRadius: 8,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "rgba(98,168,255,0.14)",
                borderWidth: 1,
                borderColor: "rgba(98,168,255,0.38)",
              }}
            >
              <Ionicons name="business-outline" size={24} color={STOCK.cyan} />
            </View>
          </View>
          <View style={{ marginTop: 16, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            <StockMetric label="Opening Value" value="< $5K" tone="cyan" />
            <StockMetric label="Supply" value="100M" tone="mint" />
            <StockMetric label="Setup Fee" value={formatStockMoney(0)} tone="amber" />
          </View>
        </StockPanel>

        {loading ? <StockLoadingState label="Preparing launch" /> : null}

        {!!blockReason ? (
          <StockPanel tone="red" style={{ marginTop: 12 }}>
            <Text style={{ color: "#FFE4E6", fontWeight: "900" }}>{blockReason}</Text>
            <Pressable
              onPress={() => router.push("/market/profile/create" as any)}
              style={{
                marginTop: 12,
                borderRadius: 8,
                paddingVertical: 11,
                alignItems: "center",
                backgroundColor: "rgba(52,211,153,0.18)",
                borderWidth: 1,
                borderColor: "rgba(52,211,153,0.46)",
              }}
            >
              <Text style={{ color: "#D7FFF3", fontWeight: "900" }}>Open Seller Profile</Text>
            </Pressable>
          </StockPanel>
        ) : null}

        <View style={{ marginTop: 12, gap: 10 }}>
          <StockField label="Stock Name" caption="Use the public store or product name buyers already recognize.">
            <StockInput
              value={name}
              onChangeText={setName}
              placeholder="Ada Fashion House"
              editable={!disabled}
            />
          </StockField>

          <StockField label="Ticker" caption="Two to eight letters works best in trading views.">
            <StockInput
              value={symbol}
              onChangeText={(value) => setSymbol(value.toUpperCase())}
              placeholder="ADAH"
              autoCapitalize="characters"
              editable={!disabled}
            />
          </StockField>

          <StockField label="Market Link" caption="Optional. Leave blank to generate one from the stock name.">
            <StockInput
              value={slug}
              onChangeText={setSlug}
              placeholder="ada-fashion-house-stock"
              autoCapitalize="none"
              editable={!disabled}
            />
          </StockField>
        </View>

        <StockPanel style={{ marginTop: 12 }}>
          <Text style={{ color: STOCK.ink, fontWeight: "900", fontSize: 14 }}>Network</Text>
          <Text style={{ marginTop: 5, color: STOCK.muted, fontSize: 12, lineHeight: 18 }}>
            Choose where this stock will trade.
          </Text>
          <View style={{ marginTop: 12, flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {chainRows.map((row: any) => {
              const key = String(row.chain || "");
              const active = chain === key;
              return (
                <Pressable
                  key={key}
                  onPress={() => setChain(key)}
                  disabled={disabled}
                  style={{
                    borderRadius: 999,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    backgroundColor: active ? "rgba(98,168,255,0.17)" : STOCK.panelSoft,
                    borderWidth: 1,
                    borderColor: active ? "rgba(98,168,255,0.46)" : STOCK.border,
                    opacity: disabled ? 0.65 : 1,
                  }}
                >
                  <Text style={{ color: active ? "#DCEBFF" : STOCK.muted, fontSize: 12, fontWeight: "900" }}>
                    {stockChainLabel(key)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </StockPanel>

        <StockPanel style={{ marginTop: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View
              style={{
                width: 38,
                height: 38,
                borderRadius: 8,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "rgba(34,211,238,0.13)",
                borderWidth: 1,
                borderColor: "rgba(34,211,238,0.34)",
              }}
            >
              <Ionicons name="shield-checkmark-outline" size={19} color={STOCK.cyan} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: STOCK.ink, fontWeight: "900", fontSize: 15 }}>Launch Review</Text>
              <Text style={{ marginTop: 3, color: STOCK.muted, fontSize: 12 }}>
                Availability, seller status, and early trading limits are checked before approval.
              </Text>
            </View>
          </View>
          <View style={{ marginTop: 14, gap: 9 }}>
            <StockMetric label="Setup Cost" value="Reviewed" caption="Shown before approval" tone="cyan" />
            <StockMetric label="Opening Market" value="Guarded" caption="Early trading is capped" tone="mint" />
            <StockMetric label="Availability" value="Verified Sellers" caption="Profile status is checked" tone="amber" />
          </View>
        </StockPanel>

        {!!err ? <StockAlert>{err}</StockAlert> : null}
        {!!okMsg ? <StockAlert tone="mint">{okMsg}</StockAlert> : null}

        <Pressable
          onPress={requestConfirm}
          disabled={disabled}
          style={{
            marginTop: 14,
            borderRadius: 8,
            minHeight: 52,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: disabled ? "rgba(255,255,255,0.12)" : "rgba(47,214,163,0.24)",
            borderWidth: 1,
            borderColor: disabled ? STOCK.border : "rgba(47,214,163,0.52)",
          }}
        >
          <Text style={{ color: disabled ? STOCK.faint : "#D7FFF3", fontWeight: "900", fontSize: 15 }}>
            {submitting ? "Creating" : "Create Stock"}
          </Text>
        </Pressable>
      </ScrollView>

      <Modal visible={confirmVisible} transparent animationType="fade" onRequestClose={() => setConfirmVisible(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.68)", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <StockPanel style={{ width: "100%", maxWidth: 430, backgroundColor: STOCK.modal }}>
            <StockPill label="Confirm" tone="mint" icon="lock-closed-outline" compact />
            <Text style={{ marginTop: 12, color: STOCK.ink, fontWeight: "900", fontSize: 20 }}>Create stock</Text>
            <Text style={{ marginTop: 8, color: STOCK.muted, lineHeight: 19 }}>
              Your wallet will ask you to approve this launch.
            </Text>

            <View style={{ marginTop: 14, gap: 8 }}>
              <StockMetric label="Name" value={name.trim() || "Stock"} />
              <StockMetric label="Symbol" value={symbol.trim().toUpperCase() || "STOCK"} tone="cyan" />
              <StockMetric label="Chain" value={stockChainLabel(chain)} tone="mint" />
            </View>

            <Text style={{ marginTop: 12, color: STOCK.muted, fontSize: 12, lineHeight: 18 }}>
              The supply is fixed at 100,000,000 shares and early trading starts under launch limits.
            </Text>

            <View style={{ marginTop: 14, flexDirection: "row", gap: 9 }}>
              <Pressable
                onPress={() => setConfirmVisible(false)}
                style={{
                  flex: 1,
                  minHeight: 46,
                  borderRadius: 14,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: STOCK.panelSoft,
                  borderWidth: 1,
                  borderColor: STOCK.border,
                }}
              >
                <Text style={{ color: STOCK.ink, fontWeight: "800" }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={onCreate}
                disabled={submitting}
                style={{
                  flex: 1,
                  minHeight: 46,
                  borderRadius: 14,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "rgba(52,211,153,0.24)",
                  borderWidth: 1,
                  borderColor: "rgba(52,211,153,0.52)",
                  opacity: submitting ? 0.7 : 1,
                }}
              >
              <Text style={{ color: "#D7FFF3", fontWeight: "900" }}>{submitting ? "Submitting" : "Confirm"}</Text>
              </Pressable>
            </View>
          </StockPanel>
        </View>
      </Modal>

      <Modal visible={successVisible} transparent animationType="fade" onRequestClose={() => setSuccessVisible(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.68)", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <StockPanel tone="mint" style={{ width: "100%", maxWidth: 430 }}>
            <StockPill label="Created" tone="mint" icon="checkmark-circle-outline" compact />
            <Text style={{ marginTop: 12, color: "#D7FFF3", fontWeight: "900", fontSize: 20 }}>Stock is live</Text>
            <Text style={{ marginTop: 8, color: "#ECFDF5", lineHeight: 19 }}>
              The market was created and synced to BestCity.
            </Text>
            {!!txHash ? (
              <Text style={{ marginTop: 10, color: "#D1FAE5", fontSize: 11, fontWeight: "800" }} numberOfLines={2}>
                Tx: {txHash}
              </Text>
            ) : null}
            <View style={{ marginTop: 14, flexDirection: "row", gap: 9 }}>
              <Pressable
                onPress={() => setSuccessVisible(false)}
                style={{
                  flex: 1,
                  minHeight: 45,
                  borderRadius: 14,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "rgba(255,255,255,0.08)",
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.16)",
                }}
              >
                <Text style={{ color: STOCK.ink, fontWeight: "800" }}>Close</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  if (txExplorer) Linking.openURL(txExplorer);
                }}
                disabled={!txExplorer}
                style={{
                  flex: 1,
                  minHeight: 45,
                  borderRadius: 14,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: txExplorer ? "rgba(34,211,238,0.18)" : "rgba(255,255,255,0.08)",
                  borderWidth: 1,
                  borderColor: txExplorer ? "rgba(34,211,238,0.42)" : "rgba(255,255,255,0.16)",
                  opacity: txExplorer ? 1 : 0.6,
                }}
              >
                <Text style={{ color: txExplorer ? "#CFFAFE" : STOCK.faint, fontWeight: "900" }}>Explorer</Text>
              </Pressable>
            </View>
          </StockPanel>
        </View>
      </Modal>
    </StockScreen>
  );
}
