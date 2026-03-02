import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import AppHeader from "@/components/common/AppHeader";
import {
  buyStockWithPi,
  getPiStockQuote,
  isPiBrowserEnvironment,
  lockPiStockSellQuote,
  submitPiStockSell,
} from "@/services/market/piStock";
import { fetchStockDetail } from "@/services/market/stocks";
import { friendlyMarketError } from "@/utils/marketUx";

const BG_TOP = "#111827";
const BG_BOTTOM = "#0B1020";
const CARD = "rgba(255,255,255,0.06)";
const BORDER = "rgba(255,255,255,0.12)";
const GOLD = "#F59E0B";
const MUTED = "rgba(255,255,255,0.68)";

export default function PiStockDetailScreen() {
  const params = useLocalSearchParams<{ slug?: string }>();
  const slug = String(params.slug ?? "").trim().toLowerCase();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amountUsdc, setAmountUsdc] = useState("");
  const [quantity, setQuantity] = useState("");
  const [quote, setQuote] = useState<any | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function loadDetail(silent = false) {
    if (!slug) return;
    if (!silent) setLoading(true);
    setErr(null);
    try {
      const res = await fetchStockDetail({
        slug,
        timeframe: "1m",
        candle_limit: 120,
        trade_limit: 40,
      });
      setDetail(res);
    } catch (e: any) {
      setErr(friendlyMarketError(e, "Unable to load Pi stock details."));
      setDetail(null);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    loadDetail();
  }, [slug]);

  useEffect(() => {
    if (!detail?.identity?.slug) return;
    if (String(detail.identity.chain || "").toLowerCase() === "pi_testnet") return;
    router.replace((`/market/stock/${detail.identity.slug}` as any) as any);
  }, [detail?.identity?.slug, detail?.identity?.chain]);

  useEffect(() => {
    if (!detail?.identity?.id) return;
    let cancelled = false;
    const id = setTimeout(async () => {
      try {
        const amt = Number(amountUsdc || 0);
        const qty = Number(quantity || 0);
        if (side === "buy" && (!Number.isFinite(amt) || amt <= 0)) {
          setQuote(null);
          setQuoteErr(null);
          return;
        }
        if (side === "sell" && (!Number.isFinite(qty) || qty <= 0)) {
          setQuote(null);
          setQuoteErr(null);
          return;
        }
        setQuoting(true);
        const res = await getPiStockQuote({
          slug,
          side,
          amount_usdc: side === "buy" ? amt : undefined,
          quantity: side === "sell" ? qty : undefined,
        });
        if (!cancelled) {
          setQuote(res.quote ?? null);
          setQuoteErr(null);
        }
      } catch (e: any) {
        if (!cancelled) {
          setQuote(null);
          setQuoteErr(friendlyMarketError(e, "Quote unavailable"));
        }
      } finally {
        if (!cancelled) setQuoting(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [detail?.identity?.id, slug, side, amountUsdc, quantity]);

  async function onSubmit() {
    if (!slug) return;
    setSuccessMessage(null);
    setQuoteErr(null);
    try {
      setSubmitting(true);
      if (side === "buy") {
        const amt = Number(amountUsdc || 0);
        if (!Number.isFinite(amt) || amt <= 0) throw new Error("Enter a valid USD amount");

        const res: any = await buyStockWithPi({ slug, amount_usdc: amt });
        if (res?.handoff_required) {
          await Linking.openURL(String(res.pi_browser_url || res.checkout_url || ""));
          setSuccessMessage("Continue this Pi stock buy inside Pi Browser, then return and refresh.");
        } else {
          setSuccessMessage("Pi payment confirmed and shares were credited.");
        }
      } else {
        const qty = Number(quantity || 0);
        if (!Number.isFinite(qty) || qty <= 0) throw new Error("Enter a valid quantity");
        const locked = await lockPiStockSellQuote({ slug, quantity: qty });
        const res = await submitPiStockSell({
          stock_id: detail?.identity?.id,
          quote_ref: String(locked.quote.quote_ref),
          quote_signature: String(locked.quote.quote_signature),
        });
        setSuccessMessage(
          `Pi sell locked and queued. Queue #${Number(res.queue_position || 0)} for ${Number(res.locked_payout_pi || 0).toFixed(8)} PI.`,
        );
      }

      setAmountUsdc("");
      setQuantity("");
      setQuote(null);
      await loadDetail(true);
    } catch (e: any) {
      const message = friendlyMarketError(e, "Pi stock action failed.");
      setQuoteErr(message);
      Alert.alert("Pi stock", message);
    } finally {
      setSubmitting(false);
    }
  }

  const title = detail?.identity?.name || "Pi Stock";
  const symbol = detail?.identity?.symbol || "";
  const price = Number(detail?.stats?.price ?? 0);
  const marketCap = Number(detail?.stats?.market_cap ?? 0);
  const volume24 = Number(detail?.stats?.volume_24h_quote ?? 0);
  const myPos = detail?.my_position ?? null;
  const piLiquidity = detail?.pi?.liquidity ?? null;
  const myPiRedemptions = detail?.pi?.my_redemptions ?? [];
  const isPiBrowser = isPiBrowserEnvironment();

  return (
    <LinearGradient colors={[BG_TOP, BG_BOTTOM]} style={{ flex: 1, paddingHorizontal: 16, paddingTop: 14 }}>
      <AppHeader title="Pi Stock Detail" subtitle="Pi-native stock, fully separated from the EVM stock market." />
      <ScrollView contentContainerStyle={{ paddingBottom: 28 }}>
        {loading ? (
          <View style={{ marginTop: 30, alignItems: "center" }}>
            <ActivityIndicator />
            <Text style={{ marginTop: 10, color: MUTED }}>Loading Pi stock...</Text>
          </View>
        ) : null}

        {!!err ? (
          <View style={{ marginTop: 12, borderRadius: 12, padding: 12, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
            <Text style={{ color: "#FCA5A5", fontWeight: "800" }}>{err}</Text>
          </View>
        ) : null}

        {!loading && !err && detail ? (
          <>
            <View style={{ marginTop: 10, borderRadius: 15, padding: 12, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
              <Text style={{ color: "#fff", fontWeight: "900", fontSize: 18 }}>
                {title} <Text style={{ color: "#FCD34D" }}>({symbol})</Text>
              </Text>
              <Text style={{ marginTop: 6, color: MUTED, fontSize: 12 }}>
                @{detail?.seller?.market_username || "store"} - {detail?.seller?.business_name || "Store"}
              </Text>

              <View style={{ marginTop: 10, flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1, borderRadius: 12, padding: 10, backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: BORDER }}>
                  <Text style={{ color: MUTED, fontSize: 11 }}>Price</Text>
                  <Text style={{ marginTop: 4, color: "#fff", fontWeight: "900" }}>${price.toFixed(6)}</Text>
                </View>
                <View style={{ flex: 1, borderRadius: 12, padding: 10, backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: BORDER }}>
                  <Text style={{ color: MUTED, fontSize: 11 }}>Market Cap</Text>
                  <Text style={{ marginTop: 4, color: "#fff", fontWeight: "900" }}>${marketCap.toFixed(2)}</Text>
                </View>
                <View style={{ flex: 1, borderRadius: 12, padding: 10, backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: BORDER }}>
                  <Text style={{ color: MUTED, fontSize: 11 }}>24h Vol</Text>
                  <Text style={{ marginTop: 4, color: "#fff", fontWeight: "900" }}>${volume24.toFixed(2)}</Text>
                </View>
              </View>
            </View>

            {!!myPos ? (
              <View style={{ marginTop: 10, borderRadius: 12, padding: 10, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
                <Text style={{ color: "#fff", fontWeight: "900" }}>My Position</Text>
                <Text style={{ marginTop: 6, color: MUTED, fontSize: 12 }}>
                  Qty {Number(myPos.balance_qty || 0).toFixed(6)} - Avg ${Number(myPos.avg_cost_usdc || 0).toFixed(6)}
                </Text>
                <Text style={{ marginTop: 4, color: "#FDE68A", fontSize: 12, fontWeight: "800" }}>
                  Locked for redemption: {Number(myPos.locked_redemption_qty || 0).toFixed(6)} {symbol}
                </Text>
              </View>
            ) : null}

            {!!piLiquidity ? (
              <View style={{ marginTop: 10, borderRadius: 12, padding: 10, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
                <Text style={{ color: "#fff", fontWeight: "900" }}>Pi Liquidity</Text>
                <Text style={{ marginTop: 6, color: MUTED, fontSize: 12 }}>
                  LPI {Number(piLiquidity.lpi || 0).toFixed(2)} - Coverage {Number(piLiquidity.coverage_ratio || 0).toFixed(2)} - Queue budget {Number(piLiquidity.available_budget_pi || 0).toFixed(8)} PI / 24h
                </Text>
                <Text style={{ marginTop: 4, color: Number(piLiquidity.sells_paused) ? "#FCA5A5" : "#BFDBFE", fontSize: 12, fontWeight: "800" }}>
                  {Number(piLiquidity.sells_paused)
                    ? "New Pi sells are paused until liquidity recovers."
                    : "Pi-native stock uses dynamic queue and payout budgeting."}
                </Text>
              </View>
            ) : null}

            <View style={{ marginTop: 10, borderRadius: 14, padding: 12, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
              <Text style={{ color: "#fff", fontWeight: "900" }}>Pi Trade</Text>

              <View style={{ marginTop: 10, flexDirection: "row", gap: 8 }}>
                <Pressable
                  onPress={() => setSide("buy")}
                  style={{
                    flex: 1,
                    borderRadius: 10,
                    paddingVertical: 10,
                    alignItems: "center",
                    backgroundColor: side === "buy" ? "rgba(245,158,11,0.20)" : "rgba(255,255,255,0.05)",
                    borderWidth: 1,
                    borderColor: side === "buy" ? "rgba(245,158,11,0.50)" : BORDER,
                  }}
                >
                  <Text style={{ color: "#fff", fontWeight: "900" }}>Buy With Pi</Text>
                </Pressable>
                <Pressable
                  onPress={() => setSide("sell")}
                  style={{
                    flex: 1,
                    borderRadius: 10,
                    paddingVertical: 10,
                    alignItems: "center",
                    backgroundColor: side === "sell" ? "rgba(248,113,113,0.20)" : "rgba(255,255,255,0.05)",
                    borderWidth: 1,
                    borderColor: side === "sell" ? "rgba(248,113,113,0.50)" : BORDER,
                  }}
                >
                  <Text style={{ color: "#fff", fontWeight: "900" }}>Sell For Pi</Text>
                </Pressable>
              </View>

              {side === "buy" ? (
                <View style={{ marginTop: 10 }}>
                  <Text style={{ color: MUTED, fontSize: 12 }}>Amount (USD reference)</Text>
                  <TextInput
                    value={amountUsdc}
                    onChangeText={setAmountUsdc}
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor="rgba(255,255,255,0.45)"
                    style={{ marginTop: 6, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, color: "#fff", backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: BORDER }}
                    editable={!submitting}
                  />
                </View>
              ) : (
                <View style={{ marginTop: 10 }}>
                  <Text style={{ color: MUTED, fontSize: 12 }}>Quantity ({symbol})</Text>
                  <TextInput
                    value={quantity}
                    onChangeText={setQuantity}
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor="rgba(255,255,255,0.45)"
                    style={{ marginTop: 6, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, color: "#fff", backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: BORDER }}
                    editable={!submitting}
                  />
                </View>
              )}

              {quoting ? <Text style={{ marginTop: 8, color: MUTED, fontSize: 12 }}>Getting Pi quote...</Text> : null}

              {!!quote ? (
                <View style={{ marginTop: 8 }}>
                  <Text style={{ color: MUTED, fontSize: 12 }}>
                    Exec ${Number(quote.price_execution_usdc || 0).toFixed(6)} - Qty {Number(quote.quantity || 0).toFixed(6)}
                  </Text>
                  <Text style={{ marginTop: 4, color: MUTED, fontSize: 12 }}>
                    {side === "buy"
                      ? `Pay ${Number(quote.gross_pi || 0).toFixed(8)} PI`
                      : `Locked payout ${Number(quote.net_pi || 0).toFixed(8)} PI`}
                  </Text>
                  <Text style={{ marginTop: 4, color: MUTED, fontSize: 12 }}>
                    LPI {Number(quote.lpi || 0).toFixed(2)} - Cooldown {Number(quote.cooldown_seconds || 0).toFixed(0)}s
                  </Text>
                </View>
              ) : null}

              {!!quoteErr ? <Text style={{ marginTop: 8, color: "#FCA5A5", fontSize: 12, fontWeight: "800" }}>{quoteErr}</Text> : null}
              {!!successMessage ? <Text style={{ marginTop: 8, color: "#A7F3D0", fontSize: 12, fontWeight: "800" }}>{successMessage}</Text> : null}

              <Pressable
                onPress={() => void onSubmit()}
                disabled={submitting || quoting || !quote}
                style={{
                  marginTop: 10,
                  borderRadius: 11,
                  paddingVertical: 11,
                  alignItems: "center",
                  backgroundColor: submitting || quoting || !quote
                    ? "rgba(255,255,255,0.15)"
                    : side === "buy"
                    ? "rgba(245,158,11,0.30)"
                    : "rgba(248,113,113,0.30)",
                  borderWidth: 1,
                  borderColor: submitting || quoting || !quote
                    ? "rgba(255,255,255,0.22)"
                    : side === "buy"
                    ? "rgba(245,158,11,0.50)"
                    : "rgba(248,113,113,0.50)",
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "900" }}>
                  {submitting
                    ? "Submitting..."
                    : side === "buy"
                    ? isPiBrowser
                      ? "Pay With Pi"
                      : "Open In Pi Browser"
                    : "Lock And Queue Sell"}
                </Text>
              </Pressable>
            </View>

            {myPiRedemptions.length > 0 ? (
              <View style={{ marginTop: 10, gap: 8 }}>
                {myPiRedemptions.slice(0, 3).map((row: any) => (
                  <View key={String(row.id)} style={{ borderRadius: 10, padding: 10, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
                    <Text style={{ color: "#fff", fontWeight: "800" }}>
                      Queue #{Number(row.queue_seq || 0)} - {String(row.status || "").toUpperCase()}
                    </Text>
                    <Text style={{ marginTop: 4, color: MUTED, fontSize: 12 }}>
                      Locked {Number(row.locked_net_payout_pi || 0).toFixed(8)} PI for {Number(row.quantity_locked || 0).toFixed(6)} {symbol}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={{ marginTop: 10, gap: 8 }}>
              <Text style={{ color: "#fff", fontWeight: "900" }}>Recent Trades</Text>
              {(detail?.trades ?? []).slice(0, 10).map((trade: any) => (
                <View key={String(trade.id)} style={{ borderRadius: 10, padding: 10, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={{ color: "#fff", fontWeight: "800" }}>
                      {String(trade.side || "").toUpperCase()} {Number(trade.quantity || 0).toFixed(6)} {symbol}
                    </Text>
                    <Text style={{ color: String(trade.side || "") === "buy" ? "#FCD34D" : "#FCA5A5", fontWeight: "800" }}>
                      {String(trade.settlement_rail || "pi").toUpperCase()}
                    </Text>
                  </View>
                  <Text style={{ marginTop: 4, color: MUTED, fontSize: 12 }}>
                    ${Number(trade.price_usdc || 0).toFixed(6)} - ${Number(trade.notional_usdc || 0).toFixed(6)}
                  </Text>
                </View>
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>
    </LinearGradient>
  );
}
