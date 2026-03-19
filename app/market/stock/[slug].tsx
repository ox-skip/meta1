import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  ActivityIndicator,
  Image,
  LayoutChangeEvent,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import Svg, { Defs, Line, LinearGradient as SvgGradient, Path, Rect, Stop, Text as SvgText } from "react-native-svg";

import AppHeader from "@/components/common/AppHeader";
import { InAppTutorial } from "@/components/onboarding/InAppTutorial";
import {
  fetchStockDetail,
  getStockQuote,
  listStockChat,
  postStockChat,
} from "@/services/market/stocks";
import {
  buyStockWithPi,
  getPiStockQuote,
  isPiBrowserEnvironment,
  lockPiStockSellQuote,
  submitPiStockSell,
} from "@/services/market/piStock";
import { tutorialFlows } from "@/services/onboarding/definitions";
import { repairLastStockTradeIndex, submitStockTradeOnchain } from "@/services/market/stockOnchain";
import { isWalletMismatchError } from "@/services/market/usdcCheckout";
import { supabase } from "@/services/supabase";
import { friendlyMarketError } from "@/utils/marketUx";

const BG_TOP = "#0D1B2A";
const BG_BOTTOM = "#071018";
const CARD = "rgba(255,255,255,0.06)";
const BORDER = "rgba(255,255,255,0.12)";
const MINT = "#2DD4BF";
const RED = "#F87171";
const MUTED = "rgba(255,255,255,0.68)";
const DEFAULT_TRADE_SLIPPAGE_BPS = 2200;

type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

type Candle = {
  bucket_start: string;
  open_price_usdc: number;
  high_price_usdc: number;
  low_price_usdc: number;
  close_price_usdc: number;
  volume_qty: number;
  volume_usdc: number;
  trades_count: number;
};

function sellerLogoUrl(path?: string | null) {
  if (!path) return null;
  const { data } = supabase.storage.from("market-sellers").getPublicUrl(path);
  return data?.publicUrl ?? null;
}

function friendlyStockTradeError(error: unknown, fallback: string) {
  const raw = String((error as any)?.message ?? error ?? "").trim();
  const maxMatch = raw.match(/max size\s*\(([\d.]+)\s*usdc\)/i);
  if (maxMatch) {
    const maxVal = Number(maxMatch[1] || 0);
    if (Number.isFinite(maxVal) && maxVal > 0) {
      return `Trade amount is above current on-chain max (${maxVal.toFixed(6)} USDC). Reduce amount and retry.`;
    }
  }
  return friendlyMarketError(error, fallback);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(id);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(id);
        reject(err);
      });
  });
}

function delayResult<T>(timeoutMs: number, value: T) {
  return new Promise<T>((resolve) => {
    setTimeout(() => resolve(value), timeoutMs);
  });
}

async function tryOpenExternalUrl(url?: string | null, settleAfterMs = 1200) {
  const target = String(url || "").trim();
  if (!target) return false;

  try {
    return await Promise.race([
      Linking.openURL(target)
        .then(() => true)
        .catch(() => false),
      delayResult(settleAfterMs, true),
    ]);
  } catch {
    return false;
  }
}

function isDesktopWebEnvironment() {
  if (Platform.OS !== "web") return false;
  const ua = String((globalThis as any)?.navigator?.userAgent || "").toLowerCase();
  return !/(android|iphone|ipad|ipod|mobile|pibrowser|minepi)/i.test(ua);
}

function CandleChart({ candles }: { candles: Candle[] }) {
  const [width, setWidth] = useState(0);
  const height = 262;
  const left = 12;
  const right = 56;
  const top = 14;
  const bottom = 12;
  const volumeHeight = 58;
  const priceBottom = height - volumeHeight - 8;
  const volumeTop = priceBottom + 6;
  const rows = candles.slice(-100);
  const plotW = Math.max(10, width - left - right);
  const priceH = Math.max(10, priceBottom - top);
  const volH = Math.max(8, height - bottom - volumeTop);

  const stats = useMemo(() => {
    if (!rows.length) {
      return { high: 1, low: 0, maxVolume: 1 };
    }
    let high = Number.MIN_VALUE;
    let low = Number.MAX_VALUE;
    let maxVolume = 0;
    for (const c of rows) {
      high = Math.max(high, Number(c.high_price_usdc || 0));
      low = Math.min(low, Number(c.low_price_usdc || 0));
      maxVolume = Math.max(maxVolume, Number(c.volume_usdc || 0));
    }
    if (!Number.isFinite(high) || !Number.isFinite(low) || high <= low) {
      high = Math.max(1, Number(rows[0]?.high_price_usdc || 1));
      low = Math.max(0, Number(rows[0]?.low_price_usdc || 0));
    }
    return { high, low, maxVolume: Math.max(1, maxVolume) };
  }, [rows]);

  const xStep = plotW / Math.max(1, rows.length);

  function xAt(index: number) {
    return left + index * xStep + xStep / 2;
  }

  function yPrice(price: number) {
    const range = Math.max(0.0000001, stats.high - stats.low);
    const t = (price - stats.low) / range;
    return top + (1 - t) * priceH;
  }

  function yVolume(volume: number) {
    const t = Math.max(0, Math.min(1, volume / stats.maxVolume));
    return volumeTop + (1 - t) * volH;
  }

  const closeLine = (() => {
    if (!rows.length) return { linePath: "", areaPath: "" };
    const points = rows.map((c, i) => `${xAt(i)},${yPrice(Number(c.close_price_usdc || 0))}`);
    const [first] = points;
    const last = points[points.length - 1];
    const linePath = `M ${points.join(" L ")}`;
    const firstX = Number(first.split(",")[0]);
    const lastX = Number(last.split(",")[0]);
    const areaPath = `${linePath} L ${lastX},${priceBottom} L ${firstX},${priceBottom} Z`;
    return { linePath, areaPath };
  })();

  function onLayout(e: LayoutChangeEvent) {
    setWidth(Math.floor(e.nativeEvent.layout.width));
  }

  return (
    <View
      onLayout={onLayout}
      style={{
        marginTop: 10,
        borderRadius: 14,
        overflow: "hidden",
        borderWidth: 1,
        borderColor: BORDER,
        backgroundColor: "rgba(255,255,255,0.035)",
      }}
    >
      {width > 0 && rows.length > 0 ? (
        <Svg width={width} height={height}>
          <Defs>
            <SvgGradient id="stockAreaGradient" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor="rgba(45,212,191,0.35)" />
              <Stop offset="100%" stopColor="rgba(45,212,191,0.02)" />
            </SvgGradient>
          </Defs>

          {[0, 1, 2, 3, 4].map((i) => {
            const yy = top + (priceH * i) / 4;
            const price = stats.high - ((stats.high - stats.low) * i) / 4;
            return (
              <React.Fragment key={`grid-${i}`}>
                <Line x1={left} y1={yy} x2={left + plotW} y2={yy} stroke="rgba(255,255,255,0.10)" strokeWidth={1} />
                <SvgText x={width - 4} y={yy + 3} fontSize={10} fill="rgba(255,255,255,0.55)" textAnchor="end">
                  {price.toFixed(4)}
                </SvgText>
              </React.Fragment>
            );
          })}

          {rows.map((_, idx) => {
            if (idx % 12 !== 0) return null;
            const xx = xAt(idx);
            return <Line key={`v-${idx}`} x1={xx} y1={top} x2={xx} y2={priceBottom} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />;
          })}

          <Path d={closeLine.areaPath} fill="url(#stockAreaGradient)" />
          <Path d={closeLine.linePath} stroke="rgba(45,212,191,0.85)" strokeWidth={1.5} fill="none" />

          {rows.map((c, idx) => {
            const barX = left + idx * xStep + xStep * 0.24;
            const barW = Math.max(1, xStep * 0.5);
            const vy = yVolume(Number(c.volume_usdc || 0));
            return (
              <Rect
                key={`vol-${idx}`}
                x={barX}
                y={vy}
                width={barW}
                height={Math.max(1, height - bottom - vy)}
                fill="rgba(148,163,184,0.22)"
              />
            );
          })}

          {rows.map((c, idx) => {
            const candleW = Math.max(2, xStep * 0.62);
            const x = left + idx * xStep + (xStep - candleW) / 2;
            const o = Number(c.open_price_usdc || 0);
            const h = Number(c.high_price_usdc || 0);
            const l = Number(c.low_price_usdc || 0);
            const cl = Number(c.close_price_usdc || 0);
            const up = cl >= o;
            const color = up ? MINT : RED;
            const yOpen = yPrice(o);
            const yClose = yPrice(cl);
            const top = Math.min(yOpen, yClose);
            const bodyH = Math.max(1, Math.abs(yOpen - yClose));
            return (
              <React.Fragment key={`${c.bucket_start}-${idx}`}>
                <Line
                  x1={x + candleW / 2}
                  y1={yPrice(h)}
                  x2={x + candleW / 2}
                  y2={yPrice(l)}
                  stroke={color}
                  strokeWidth={1}
                />
                <Rect x={x} y={top} width={candleW} height={bodyH} fill={color} />
              </React.Fragment>
            );
          })}
        </Svg>
      ) : (
        <View style={{ height, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: MUTED }}>No candle data yet</Text>
        </View>
      )}
    </View>
  );
}

export default function StockDetailScreen() {
  const params = useLocalSearchParams<{ slug?: string }>();
  const slug = String(params.slug ?? "").trim().toLowerCase();

  const [timeframe, setTimeframe] = useState<Timeframe>("1m");
  const [panel, setPanel] = useState<"trade" | "trades" | "chat">("trade");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [detail, setDetail] = useState<any | null>(null);

  const [tradeRail, setTradeRail] = useState<"evm" | "pi">("evm");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amountUsdc, setAmountUsdc] = useState("");
  const [quantity, setQuantity] = useState("");
  const [quote, setQuote] = useState<any | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [pendingTrade, setPendingTrade] = useState<{
    rail: "evm" | "pi";
    side: "buy" | "sell";
    amount_usdc?: number;
    quantity?: number;
    lockedQuote?: any | null;
  } | null>(null);
  const [successVisible, setSuccessVisible] = useState(false);
  const [successTxHash, setSuccessTxHash] = useState<string | null>(null);
  const [successExplorer, setSuccessExplorer] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState(
    "Your order executed on-chain and was recorded in market history.",
  );
  const [quickAmount, setQuickAmount] = useState(20);
  const [quickQuote, setQuickQuote] = useState<any | null>(null);
  const [quickQuoteErr, setQuickQuoteErr] = useState<string | null>(null);

  const [chatLoading, setChatLoading] = useState(false);
  const [chatErr, setChatErr] = useState<string | null>(null);
  const [chatRows, setChatRows] = useState<any[]>([]);
  const [chatText, setChatText] = useState("");
  const [posting, setPosting] = useState(false);
  const [repairing, setRepairing] = useState(false);

  async function loadDetail(silent = false) {
    if (!slug) return;
    if (!silent) setLoading(true);
    setErr(null);
    try {
      const res = await fetchStockDetail({
        slug,
        timeframe,
        candle_limit: 140,
        trade_limit: 50,
      });
      setDetail(res);
    } catch (e: any) {
      setErr(friendlyMarketError(e, "Unable to load stock details."));
      setDetail(null);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function loadChat(silent = false) {
    if (!slug) return;
    if (!silent) setChatLoading(true);
    setChatErr(null);
    try {
      const res = await listStockChat({ slug, limit: 60 });
      setChatRows(res.messages ?? []);
    } catch (e: any) {
      setChatErr(friendlyMarketError(e, "Unable to load chat."));
      setChatRows([]);
    } finally {
      if (!silent) setChatLoading(false);
    }
  }

  useEffect(() => {
    loadDetail();
  }, [slug, timeframe]);

  useEffect(() => {
    loadChat();
  }, [slug]);

  useEffect(() => {
    const stockId = detail?.identity?.id;
    if (!stockId) return;
    const ch = supabase
      .channel(`stock-live-${stockId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "market_stock_trades", filter: `stock_id=eq.${stockId}` },
        () => {
          loadDetail(true);
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "market_stock_chat_messages", filter: `stock_id=eq.${stockId}` },
        () => {
          loadChat(true);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [detail?.identity?.id]);

  useEffect(() => {
    const stock = detail?.identity;
    if (!stock) return;

    setQuote(null);
    setQuoteErr(null);
    let cancelled = false;
    const id = setTimeout(async () => {
      try {
        const amt = Number(amountUsdc || 0);
        const qty = Number(quantity || 0);
        if (side === "buy" && (!Number.isFinite(amt) || amt <= 0)) return;
        if (side === "sell" && (!Number.isFinite(qty) || qty <= 0)) return;
        setQuoting(true);
        const res = tradeRail === "pi"
          ? await getPiStockQuote({
            slug,
            side,
            amount_usdc: side === "buy" ? amt : undefined,
            quantity: side === "sell" ? qty : undefined,
          })
          : await getStockQuote({
            slug,
            side,
            amount_usdc: side === "buy" ? amt : undefined,
            quantity: side === "sell" ? qty : undefined,
            max_slippage_bps: DEFAULT_TRADE_SLIPPAGE_BPS,
          });
        if (!cancelled) setQuote(res.quote ?? null);
      } catch (e: any) {
        if (!cancelled) {
          setQuote(null);
          setQuoteErr(friendlyStockTradeError(e, "Quote unavailable"));
        }
      } finally {
        if (!cancelled) setQuoting(false);
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [slug, tradeRail, side, amountUsdc, quantity, detail?.identity?.id]);

  useEffect(() => {
    const paused = !!detail?.stats?.trading_paused || tradeRail !== "evm";
    if (!slug || paused) {
      setQuickQuote(null);
      setQuickQuoteErr(null);
      return;
    }
    let cancelled = false;
    const id = setTimeout(async () => {
      try {
        setQuickQuoteErr(null);
        const res = await getStockQuote({
          slug,
          side: "buy",
          amount_usdc: quickAmount,
          max_slippage_bps: DEFAULT_TRADE_SLIPPAGE_BPS,
        });
        if (!cancelled) setQuickQuote(res.quote ?? null);
      } catch (e: any) {
        if (!cancelled) {
          setQuickQuote(null);
          setQuickQuoteErr(friendlyStockTradeError(e, "Quick quote unavailable"));
        }
      }
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [slug, quickAmount, detail?.stats?.trading_paused, tradeRail]);

  async function executeTrade() {
    if (!slug || !pendingTrade) return;
    setQuoteErr(null);
    try {
      setSubmitting(true);
      setConfirmVisible(false);
      if (pendingTrade.rail === "pi" && pendingTrade.side === "buy") {
        const res: any = await withTimeout(
          buyStockWithPi({
            slug,
            amount_usdc: Number(pendingTrade.amount_usdc || 0),
          }),
          25_000,
          "Pi stock checkout is taking too long. Retry once, then open Pi Browser manually if needed.",
        );

        if (res?.handoff_required) {
          const piBrowserUrl = String(res.pi_browser_url || "").trim();
          const checkoutUrl = String(res.checkout_url || "").trim();
          const desktopWeb = isDesktopWebEnvironment();
          const opened = desktopWeb
            ? await tryOpenExternalUrl(checkoutUrl)
            : (
              (await tryOpenExternalUrl(piBrowserUrl)) ||
              (piBrowserUrl !== checkoutUrl && (await tryOpenExternalUrl(checkoutUrl)))
            );

          if (!opened) {
            throw new Error(
              desktopWeb
                ? "Unable to open the Pi stock handoff page. Open this stock on your phone and retry."
                : "Unable to open Pi Browser. Open Pi Browser and retry this stock buy.",
            );
          }

          Alert.alert(
            desktopWeb ? "Open on your phone" : "Continue in Pi Browser",
            desktopWeb
              ? "A Pi stock checkout page was opened. Scan its QR code or copy the link to your phone, then continue in Pi Browser."
              : "Pi checkout was opened. Complete the payment there, then return and refresh your position.",
          );
          setPendingTrade(null);
          return;
        }

        setSuccessTxHash(String(res?.txid || "") || null);
        setSuccessExplorer(null);
        setSuccessMessage("Pi payment confirmed and your shares were credited to the off-chain stock ledger.");
      } else if (pendingTrade.rail === "pi" && pendingTrade.side === "sell") {
        const lockedQuote = pendingTrade.lockedQuote;
        if (!lockedQuote?.quote_ref || !lockedQuote?.quote_signature) {
          throw new Error("Locked sell quote missing. Request a fresh Pi sell quote.");
        }
        const res = await submitPiStockSell({
          stock_id: detail?.identity?.id,
          quote_ref: String(lockedQuote.quote_ref),
          quote_signature: String(lockedQuote.quote_signature),
        });
        setSuccessTxHash(null);
        setSuccessExplorer(null);
        setSuccessMessage(
          `Sell accepted. ${Number(res.locked_payout_pi || 0).toFixed(8)} PI is locked at this quote and queued at position #${Number(res.queue_position || 0)}.`,
        );
      } else {
        const res = await withTimeout(
          submitStockTradeOnchain({
            slug,
            side: pendingTrade.side,
            amount_usdc: pendingTrade.amount_usdc,
            quantity: pendingTrade.quantity,
            max_slippage_bps: DEFAULT_TRADE_SLIPPAGE_BPS,
          }),
          170_000,
          "Trade is taking too long. Check your wallet for a submitted transaction, then retry or use Repair Last Trade.",
        );

        setSuccessTxHash(String(res?.tx_hash || "") || null);
        setSuccessExplorer(String(res?.explorer_url || "") || null);
        const pendingIndex = String(res?.execution?.status || "").toUpperCase() === "PENDING_INDEX";
        setSuccessMessage(
          pendingIndex
            ? "Transaction is confirmed on-chain. Market history indexing is still syncing. Use Repair Last Trade if it does not appear shortly."
            : "Your order executed on-chain and was recorded in market history.",
        );
      }
      setSuccessVisible(true);
      setAmountUsdc("");
      setQuantity("");
      setQuote(null);
      setPendingTrade(null);
      await loadDetail(true);
      setPanel("trades");
    } catch (e: any) {
      if (isWalletMismatchError(e)) {
        Alert.alert(
          "Wallet mismatch detected",
          "Saved wallet does not match your connected wallet. Open Wallet and tap 'Use connected wallet' before trading.",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Open Wallet", onPress: () => router.push("/market/wallet" as any) },
          ],
        );
      }
      setQuoteErr(friendlyStockTradeError(e, "Trade failed"));
    } finally {
      setSubmitting(false);
      setConfirmVisible(false);
    }
  }

  async function onRepairTrade() {
    if (repairing) return;
    setRepairing(true);
    try {
      const res = await repairLastStockTradeIndex();
      await loadDetail(true);
      setPanel("trades");
      const tx = String((res as any)?.execution?.tx_hash || (res as any)?.tx_hash || "");
      const msg = tx ? `Trade reindexed.\nTx: ${tx}` : "Trade reindexed.";
      Alert.alert("Repair complete", msg);
    } catch (e: any) {
      Alert.alert("Repair failed", friendlyMarketError(e, "Unable to repair trade history."));
    } finally {
      setRepairing(false);
    }
  }

  async function onSubmitTrade() {
    if (!slug) return;
    const amt = Number(amountUsdc || 0);
    const qty = Number(quantity || 0);
    if (side === "buy" && (!Number.isFinite(amt) || amt <= 0)) {
      setQuoteErr("Enter valid USDC amount");
      return;
    }
    if (side === "sell" && (!Number.isFinite(qty) || qty <= 0)) {
      setQuoteErr("Enter valid token quantity");
      return;
    }
    if (quoting) {
      setQuoteErr("Quote is still updating. Please wait a moment.");
      return;
    }
    if (quoteErr) {
      return;
    }
    if (!quote) {
      setQuoteErr("Quote unavailable. Please retry.");
      return;
    }
    setQuoteErr(null);
    if (tradeRail === "pi" && side === "sell") {
      try {
        setSubmitting(true);
        const locked = await lockPiStockSellQuote({
          slug,
          quantity: qty,
        });
        setQuote(locked.quote ?? null);
        setPendingTrade({
          rail: "pi",
          side,
          quantity: qty,
          lockedQuote: locked.quote,
        });
        setConfirmVisible(true);
      } catch (e: any) {
        setQuoteErr(friendlyMarketError(e, "Unable to lock the Pi sell quote."));
      } finally {
        setSubmitting(false);
      }
      return;
    }
    setPendingTrade({
      rail: tradeRail,
      side,
      amount_usdc: side === "buy" ? amt : undefined,
      quantity: side === "sell" ? qty : undefined,
      lockedQuote: tradeRail === "pi" ? quote : null,
    });
    setConfirmVisible(true);
  }

  async function onPostChat() {
    if (!chatText.trim()) return;
    if (!slug) return;
    setChatErr(null);
    try {
      setPosting(true);
      const res = await postStockChat({ slug, body: chatText.trim() });
      setChatText("");
      if (res?.message) {
        setChatRows((prev) => [res.message, ...prev].slice(0, 80));
      } else {
        await loadChat(true);
      }
    } catch (e: any) {
      setChatErr(friendlyMarketError(e, "Unable to post chat message"));
    } finally {
      setPosting(false);
    }
  }

  function onQuickBuy() {
    if (!slug || tradingPaused || tradeRail !== "evm") return;
    if (quickQuoteErr) return;
    if (!quickQuote) {
      setQuickQuoteErr("Quick quote unavailable. Please wait and try again.");
      return;
    }
    setQuickQuoteErr(null);
    setPendingTrade({
      rail: "evm",
      side: "buy",
      amount_usdc: quickAmount,
    });
    setConfirmVisible(true);
  }

  const title = detail?.identity?.name || "Stock";
  const symbol = detail?.identity?.symbol || "";
  const isPiNativeStock = String(detail?.identity?.chain || "").toLowerCase() === "pi_testnet";
  const chainText = String(detail?.identity?.chain || "")
    .toUpperCase()
    .replace("_", " ");
  const price = Number(detail?.stats?.price ?? 0);
  const mcap = Number(detail?.stats?.market_cap ?? 0);
  const vol24 = Number(detail?.stats?.volume_24h_quote ?? 0);
  const trades24 = Number(detail?.stats?.trades_24h ?? 0);
  const myPos = detail?.my_position ?? null;
  const myPiRedemptions = detail?.pi?.my_redemptions ?? [];
  const piLiquidity = detail?.pi?.liquidity ?? null;
  const piLpi = Number(piLiquidity?.lpi ?? 0);
  const piSellsPaused = !!piLiquidity?.sells_paused;
  const piQueueBudget = Number(piLiquidity?.available_budget_pi ?? 0);
  const piCoverageRatio = Number(piLiquidity?.coverage_ratio ?? 0);
  const lockedRedemptionQty = Number(myPos?.locked_redemption_qty ?? 0);
  const tradingPaused = !!detail?.stats?.trading_paused;
  const launchGuard = !!detail?.stats?.launch_guard_active;
  const isPiBrowser = isPiBrowserEnvironment();
  const isDesktopWeb = isDesktopWebEnvironment();
  const candles = (detail?.candles ?? []) as Candle[];
  const trades = detail?.trades ?? [];
  const sellerLogo = sellerLogoUrl(detail?.seller?.logo_path);
  const latestCandle = candles.length ? candles[candles.length - 1] : null;
  const chartHigh = candles.length ? Math.max(...candles.map((c) => Number(c.high_price_usdc || 0))) : 0;
  const chartLow = candles.length ? Math.min(...candles.map((c) => Number(c.low_price_usdc || 0))) : 0;
  const confirmQuote = pendingTrade?.lockedQuote
    ? pendingTrade.lockedQuote
    : pendingTrade?.side === "buy" && pendingTrade?.amount_usdc === quickAmount && pendingTrade?.rail === "evm"
    ? (quickQuote ?? quote)
    : quote;
  const sideValue = side === "buy" ? Number(amountUsdc || 0) : Number(quantity || 0);
  const sideInputOk = Number.isFinite(sideValue) && sideValue > 0;
  const canSubmitTrade = !submitting
    && !tradingPaused
    && !(tradeRail === "pi" && side === "sell" && piSellsPaused)
    && !quoting
    && sideInputOk
    && !quoteErr
    && !!quote;
  const canQuickBuy = tradeRail === "evm" && !submitting && !tradingPaused && !!quickQuote && !quickQuoteErr;

  useEffect(() => {
    if (isPiNativeStock) {
      if (tradeRail !== "pi") setTradeRail("pi");
      return;
    }
    if (tradeRail !== "evm") setTradeRail("evm");
  }, [isPiNativeStock, tradeRail]);

  return (
    <LinearGradient colors={[BG_TOP, BG_BOTTOM]} style={{ flex: 1, paddingHorizontal: 16, paddingTop: 14 }}>
      <InAppTutorial enabled={!loading && !!detail} flow={tutorialFlows.stockDetail} />
      <AppHeader title="Stock Detail" subtitle="Realtime market + chat + buy/sell execution." />
      <ScrollView contentContainerStyle={{ paddingBottom: 148 }}>
        {loading ? (
          <View style={{ marginTop: 28, alignItems: "center" }}>
            <ActivityIndicator />
            <Text style={{ marginTop: 8, color: MUTED }}>Loading stock details...</Text>
          </View>
        ) : null}

        {!!err ? (
          <View style={{ marginTop: 12, borderRadius: 12, padding: 10, backgroundColor: "rgba(127,29,29,0.26)", borderWidth: 1, borderColor: "rgba(239,68,68,0.35)" }}>
            <Text style={{ color: "#FCA5A5", fontWeight: "800" }}>{err}</Text>
          </View>
        ) : null}

        {!loading && !err && detail ? (
          <>
            <View style={{ marginTop: 10, borderRadius: 15, padding: 12, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 16,
                    overflow: "hidden",
                    borderWidth: 1,
                    borderColor: "rgba(255,255,255,0.2)",
                    backgroundColor: "rgba(255,255,255,0.06)",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {sellerLogo ? (
                    <Image source={{ uri: sellerLogo }} style={{ width: 52, height: 52 }} />
                  ) : (
                    <Ionicons name="storefront-outline" size={20} color="rgba(255,255,255,0.75)" />
                  )}
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={{ color: "#fff", fontWeight: "900", fontSize: 18 }} numberOfLines={1}>
                    {title} <Text style={{ color: "#99F6E4" }}>({symbol})</Text>
                  </Text>
                  <View style={{ marginTop: 4, flexDirection: "row", alignItems: "center", gap: 5 }}>
                    <Text style={{ color: MUTED, fontSize: 12, flexShrink: 1 }} numberOfLines={1}>
                      @{detail?.seller?.market_username || "store"} - {detail?.seller?.business_name || "Store"}
                    </Text>
                    {detail?.seller?.is_verified ? <Ionicons name="checkmark-circle" size={13} color="#60A5FA" /> : null}
                  </View>
                </View>

                <Pressable
                  disabled={!detail?.seller?.market_username}
                  onPress={() =>
                    detail?.seller?.market_username
                      ? router.push(`/market/profile/${detail.seller.market_username}` as any)
                      : undefined
                  }
                  style={{
                    borderRadius: 10,
                    paddingHorizontal: 10,
                    paddingVertical: 8,
                    backgroundColor: "rgba(255,255,255,0.06)",
                    borderWidth: 1,
                    borderColor: BORDER,
                    opacity: detail?.seller?.market_username ? 1 : 0.5,
                  }}
                >
                  <Text style={{ color: "#fff", fontSize: 11, fontWeight: "900" }}>Store</Text>
                </Pressable>
              </View>

              <View style={{ marginTop: 9, flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                <View style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: BORDER }}>
                  <Text style={{ color: "#fff", fontWeight: "800", fontSize: 11 }}>{chainText}</Text>
                </View>
                <View style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: tradingPaused ? "rgba(248,113,113,0.18)" : "rgba(45,212,191,0.18)", borderWidth: 1, borderColor: tradingPaused ? "rgba(248,113,113,0.42)" : "rgba(45,212,191,0.45)" }}>
                  <Text style={{ color: "#fff", fontWeight: "800", fontSize: 11 }}>
                    {tradingPaused ? "Trading Paused" : launchGuard ? "Bootstrap Guard" : "Trading Active"}
                  </Text>
                </View>
              </View>
            </View>

            <View style={{ marginTop: 10, flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1, borderRadius: 12, padding: 10, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
                <Text style={{ color: MUTED, fontSize: 11 }}>Price</Text>
                <Text style={{ marginTop: 4, color: "#fff", fontWeight: "900" }}>${price.toFixed(6)}</Text>
              </View>
              <View style={{ flex: 1, borderRadius: 12, padding: 10, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
                <Text style={{ color: MUTED, fontSize: 11 }}>Market Cap</Text>
                <Text style={{ marginTop: 4, color: "#fff", fontWeight: "900" }}>${mcap.toFixed(2)}</Text>
              </View>
              <View style={{ flex: 1, borderRadius: 12, padding: 10, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
                <Text style={{ color: MUTED, fontSize: 11 }}>24h Vol</Text>
                <Text style={{ marginTop: 4, color: "#fff", fontWeight: "900" }}>${vol24.toFixed(2)}</Text>
              </View>
            </View>

            <View style={{ marginTop: 8, borderRadius: 12, padding: 10, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
              <Text style={{ color: MUTED, fontSize: 11 }}>24h Trades</Text>
              <Text style={{ marginTop: 4, color: "#fff", fontWeight: "900" }}>{trades24}</Text>
            </View>

            <View style={{ marginTop: 10, flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {(["1m", "5m", "15m", "1h", "4h", "1d"] as Timeframe[]).map((tf) => (
                <Pressable
                  key={tf}
                  onPress={() => setTimeframe(tf)}
                  style={{
                    paddingHorizontal: 11,
                    paddingVertical: 7,
                    borderRadius: 999,
                    backgroundColor: timeframe === tf ? "rgba(45,212,191,0.20)" : "rgba(255,255,255,0.05)",
                    borderWidth: 1,
                    borderColor: timeframe === tf ? "rgba(45,212,191,0.55)" : BORDER,
                  }}
                >
                  <Text style={{ color: "#fff", fontWeight: "800", fontSize: 12 }}>{tf}</Text>
                </Pressable>
              ))}
            </View>

            <View style={{ marginTop: 8, flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1, borderRadius: 11, padding: 9, backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: BORDER }}>
                <Text style={{ color: MUTED, fontSize: 10 }}>Last</Text>
                <Text style={{ marginTop: 3, color: "#fff", fontWeight: "900", fontSize: 12 }}>
                  ${Number(latestCandle?.close_price_usdc ?? price).toFixed(6)}
                </Text>
              </View>
              <View style={{ flex: 1, borderRadius: 11, padding: 9, backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: BORDER }}>
                <Text style={{ color: MUTED, fontSize: 10 }}>High</Text>
                <Text style={{ marginTop: 3, color: "#fff", fontWeight: "900", fontSize: 12 }}>${chartHigh.toFixed(6)}</Text>
              </View>
              <View style={{ flex: 1, borderRadius: 11, padding: 9, backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: BORDER }}>
                <Text style={{ color: MUTED, fontSize: 10 }}>Low</Text>
                <Text style={{ marginTop: 3, color: "#fff", fontWeight: "900", fontSize: 12 }}>${chartLow.toFixed(6)}</Text>
              </View>
            </View>

            <CandleChart candles={candles} />

            {!!myPos ? (
              <View style={{ marginTop: 10, borderRadius: 12, padding: 10, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
                <Text style={{ color: "#fff", fontWeight: "900" }}>My Position</Text>
                <Text style={{ marginTop: 6, color: MUTED, fontSize: 12 }}>
                  Qty {Number(myPos.balance_qty || 0).toFixed(6)} - Avg ${Number(myPos.avg_cost_usdc || 0).toFixed(6)} - Realized ${Number(myPos.realized_pnl_usdc || 0).toFixed(2)}
                </Text>
                {lockedRedemptionQty > 0 ? (
                  <Text style={{ marginTop: 4, color: "#FDE68A", fontSize: 12, fontWeight: "800" }}>
                    Locked for redemption: {lockedRedemptionQty.toFixed(6)} {symbol}
                  </Text>
                ) : null}
              </View>
            ) : null}

            {!!piLiquidity ? (
              <View
                style={{
                  marginTop: 10,
                  borderRadius: 12,
                  padding: 10,
                  backgroundColor: piLpi >= 1.5 ? "rgba(120,53,15,0.28)" : "rgba(8,47,73,0.28)",
                  borderWidth: 1,
                  borderColor: piLpi >= 1.5 ? "rgba(251,191,36,0.35)" : "rgba(56,189,248,0.28)",
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "900" }}>Pi Liquidity Pressure</Text>
                <Text style={{ marginTop: 6, color: MUTED, fontSize: 12 }}>
                  LPI {piLpi.toFixed(2)} - Coverage {piCoverageRatio.toFixed(2)} - Queue budget {piQueueBudget.toFixed(8)} PI / 24h
                </Text>
                <Text style={{ marginTop: 4, color: piSellsPaused ? "#FCA5A5" : "#BFDBFE", fontSize: 12, fontWeight: "800" }}>
                  {piSellsPaused
                    ? "Stress mode: new Pi sells are paused until coverage improves. Existing locked sells remain honored."
                    : "Stress mode is active dynamically. Sell spreads, cooldowns, and supply release adjust with LPI."}
                </Text>
              </View>
            ) : null}

            <View style={{ marginTop: 12, flexDirection: "row", gap: 8 }}>
              <Pressable
                onPress={() => setPanel("trade")}
                style={{
                  flex: 1,
                  borderRadius: 11,
                  paddingVertical: 10,
                  alignItems: "center",
                  backgroundColor: panel === "trade" ? "rgba(45,212,191,0.20)" : "rgba(255,255,255,0.05)",
                  borderWidth: 1,
                  borderColor: panel === "trade" ? "rgba(45,212,191,0.55)" : BORDER,
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "800" }}>Trade</Text>
              </Pressable>
              <Pressable
                onPress={() => setPanel("trades")}
                style={{
                  flex: 1,
                  borderRadius: 11,
                  paddingVertical: 10,
                  alignItems: "center",
                  backgroundColor: panel === "trades" ? "rgba(45,212,191,0.20)" : "rgba(255,255,255,0.05)",
                  borderWidth: 1,
                  borderColor: panel === "trades" ? "rgba(45,212,191,0.55)" : BORDER,
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "800" }}>Trades</Text>
              </Pressable>
              <Pressable
                onPress={() => setPanel("chat")}
                style={{
                  flex: 1,
                  borderRadius: 11,
                  paddingVertical: 10,
                  alignItems: "center",
                  backgroundColor: panel === "chat" ? "rgba(45,212,191,0.20)" : "rgba(255,255,255,0.05)",
                  borderWidth: 1,
                  borderColor: panel === "chat" ? "rgba(45,212,191,0.55)" : BORDER,
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "800" }}>Chat</Text>
              </Pressable>
            </View>

            {panel === "trade" ? (
              <View style={{ marginTop: 10, borderRadius: 14, padding: 12, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
                {!isPiNativeStock ? (
                  <View style={{ marginBottom: 10, borderRadius: 10, padding: 10, backgroundColor: "rgba(45,212,191,0.10)", borderWidth: 1, borderColor: "rgba(45,212,191,0.28)" }}>
                    <Text style={{ color: "#ECFEFF", fontWeight: "900" }}>EVM Settlement</Text>
                    <Text style={{ marginTop: 4, color: MUTED, fontSize: 12 }}>
                      This stock is part of the formal EVM market. Pi trading is available only on Pi-native stock identities.
                    </Text>
                  </View>
                ) : null}

                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Pressable
                    onPress={() => setSide("buy")}
                    style={{
                      flex: 1,
                      borderRadius: 10,
                      paddingVertical: 10,
                      alignItems: "center",
                      backgroundColor: side === "buy" ? "rgba(45,212,191,0.20)" : "rgba(255,255,255,0.05)",
                      borderWidth: 1,
                      borderColor: side === "buy" ? "rgba(45,212,191,0.55)" : BORDER,
                    }}
                    disabled={tradingPaused}
                  >
                    <Text style={{ color: "#fff", fontWeight: "900" }}>Buy</Text>
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
                      borderColor: side === "sell" ? "rgba(248,113,113,0.55)" : BORDER,
                    }}
                    disabled={tradingPaused}
                  >
                    <Text style={{ color: "#fff", fontWeight: "900" }}>Sell</Text>
                  </Pressable>
                </View>

                {side === "buy" ? (
                  <View style={{ marginTop: 10 }}>
                    <Text style={{ color: MUTED, fontSize: 12 }}>{tradeRail === "pi" ? "Amount (USD)" : "Amount (USDC)"}</Text>
                    <TextInput
                      value={amountUsdc}
                      onChangeText={setAmountUsdc}
                      keyboardType="decimal-pad"
                      placeholder="0.00"
                      placeholderTextColor="rgba(255,255,255,0.45)"
                      style={{ marginTop: 6, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, color: "#fff", backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: BORDER }}
                      editable={!submitting && !tradingPaused}
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
                      editable={!submitting && !tradingPaused}
                    />
                  </View>
                )}

                {quoting ? (
                  <Text style={{ marginTop: 8, color: MUTED, fontSize: 12 }}>Getting quote...</Text>
                ) : null}

                {!!quote ? (
                  <View style={{ marginTop: 8 }}>
                    <Text style={{ color: MUTED, fontSize: 12 }}>
                      Exec ${Number(quote.price_execution_usdc || 0).toFixed(6)} - Impact {Number(quote.price_impact_bps || 0).toFixed(2)} bps
                    </Text>
                    <Text style={{ marginTop: 3, color: MUTED, fontSize: 12 }}>
                      Qty {Number(quote.quantity || 0).toFixed(6)} - Gross ${Number((quote.gross_usdc ?? quote.notional_usdc) || 0).toFixed(6)} - Fee ${Number(quote.fee_usdc || 0).toFixed(6)}
                    </Text>
                    <Text style={{ marginTop: 3, color: MUTED, fontSize: 12 }}>
                      {tradeRail === "pi"
                        ? `${side === "buy" ? "Pay" : "Locked payout"} ${Number((side === "buy" ? quote.gross_pi : quote.net_pi) || 0).toFixed(8)} PI`
                        : `Max trade (quote): $${Number(quote.max_trade_usdc || 0).toFixed(6)} USDC`}
                    </Text>
                    {tradeRail === "pi" ? (
                      <Text style={{ marginTop: 3, color: MUTED, fontSize: 12 }}>
                        LPI {Number(quote.lpi || 0).toFixed(2)} - Coverage {Number(quote.coverage_ratio || 0).toFixed(2)} - Flow {Number(quote.flow_balance || 0).toFixed(2)}
                      </Text>
                    ) : null}
                    {tradeRail === "pi" && side === "sell" ? (
                      <Text style={{ marginTop: 3, color: "#FDE68A", fontSize: 12 }}>
                        Locked payout is fixed once accepted. Shares move to `LOCKED_FOR_REDEMPTION` immediately.
                      </Text>
                    ) : null}
                    {tradeRail === "pi" && side === "buy" && !isPiBrowser ? (
                      <Text style={{ marginTop: 3, color: "#BFDBFE", fontSize: 12 }}>
                        {isDesktopWeb
                          ? "Desktop will open a phone handoff page with QR and copy-link. Continue on your phone in Pi Browser."
                          : "Pi buy will hand off to Pi Browser before server completion credits shares."}
                      </Text>
                    ) : null}
                    {tradeRail === "pi" && side === "sell" && piSellsPaused ? (
                      <Text style={{ marginTop: 3, color: "#FCA5A5", fontSize: 12, fontWeight: "700" }}>
                        New Pi sells are paused by the circuit breaker for this stock.
                      </Text>
                    ) : null}
                    {tradeRail === "pi" && myPiRedemptions.length > 0 ? (
                      <Text style={{ marginTop: 3, color: MUTED, fontSize: 12 }}>
                        Latest queue status: {String(myPiRedemptions[0]?.status || "QUEUED")}
                      </Text>
                    ) : null}
                    {tradeRail === "pi" && side === "buy" ? (
                      <Text style={{ marginTop: 3, color: MUTED, fontSize: 12 }}>
                        Supply release multiplier {Number(quote.supply_release_multiplier || 1).toFixed(2)}
                      </Text>
                    ) : null}
                    {tradeRail === "pi" && side === "sell" ? (
                      <Text style={{ marginTop: 3, color: MUTED, fontSize: 12 }}>
                        Stress sell spread {Number(quote.stress_spread_bps || 0).toFixed(0)} bps - Early exit fee {Number(quote.early_exit_fee_bps || 0).toFixed(0)} bps
                      </Text>
                    ) : null}
                    {tradeRail === "pi" ? (
                      <Text style={{ marginTop: 3, color: MUTED, fontSize: 12 }}>
                        Cooldown {Number(quote.cooldown_seconds || 0).toFixed(0)}s
                      </Text>
                    ) : null}
                    {tradeRail === "pi" && quote.quote_expires_at ? (
                      <Text style={{ marginTop: 3, color: MUTED, fontSize: 12 }}>
                        Quote expires {String(quote.quote_expires_at)}
                      </Text>
                    ) : null}
                    {tradeRail === "evm" ? (
                      <Text style={{ marginTop: 3, color: MUTED, fontSize: 12 }}>
                        Max trade (quote): ${Number(quote.max_trade_usdc || 0).toFixed(6)} USDC
                      </Text>
                    ) : null}
                    {tradeRail === "pi" && side === "buy" ? (
                      <Text style={{ marginTop: 3, color: MUTED, fontSize: 12 }}>
                        {isPiBrowser
                          ? "Pay with Pi is available in this browser."
                          : isDesktopWeb
                          ? "Desktop opens a phone handoff page. Scan the QR code there or copy the link to your phone."
                          : "Open in Pi Browser is required to authorize this payment."}
                      </Text>
                    ) : null}
                  </View>
                ) : null}

                {!!quoteErr ? (
                  <Text style={{ marginTop: 8, color: "#FCA5A5", fontWeight: "700", fontSize: 12 }}>{quoteErr}</Text>
                ) : null}

                <Pressable
                  onPress={() => void onSubmitTrade()}
                  disabled={!canSubmitTrade}
                  style={{
                    marginTop: 10,
                    borderRadius: 11,
                    paddingVertical: 11,
                    alignItems: "center",
                    backgroundColor: !canSubmitTrade
                      ? "rgba(255,255,255,0.15)"
                      : tradingPaused
                      ? "rgba(255,255,255,0.15)"
                      : side === "buy"
                      ? "rgba(45,212,191,0.32)"
                      : "rgba(248,113,113,0.30)",
                    borderWidth: 1,
                    borderColor: !canSubmitTrade
                      ? "rgba(255,255,255,0.22)"
                      : tradingPaused
                      ? "rgba(255,255,255,0.22)"
                      : side === "buy"
                      ? "rgba(45,212,191,0.58)"
                      : "rgba(248,113,113,0.58)",
                  }}
                >
                  <Text style={{ color: "#fff", fontWeight: "900" }}>
                    {submitting
                      ? "Submitting..."
                      : tradingPaused
                      ? "Trading Paused"
                      : tradeRail === "pi" && side === "buy"
                      ? isPiBrowser
                        ? "Pay With Pi"
                        : isDesktopWeb
                        ? "Continue On Phone"
                        : "Open In Pi Browser"
                      : tradeRail === "pi" && side === "sell"
                      ? piSellsPaused
                        ? "Pi Sells Paused"
                        : "Lock Pi Sell"
                      : side === "buy"
                      ? "Submit Buy"
                      : "Submit Sell"}
                  </Text>
                </Pressable>

                {tradeRail === "evm" ? (
                  <Pressable
                    onPress={onRepairTrade}
                    disabled={repairing}
                    style={{
                      marginTop: 8,
                      borderRadius: 11,
                      paddingVertical: 10,
                      alignItems: "center",
                      backgroundColor: "rgba(255,255,255,0.06)",
                      borderWidth: 1,
                      borderColor: BORDER,
                      opacity: repairing ? 0.7 : 1,
                    }}
                  >
                    <Text style={{ color: "#fff", fontWeight: "800", fontSize: 12 }}>
                      {repairing ? "Repairing..." : "Repair Last Trade"}
                    </Text>
                  </Pressable>
                ) : null}

                {tradeRail === "pi" && myPiRedemptions.length > 0 ? (
                  <View style={{ marginTop: 10, gap: 8 }}>
                    {myPiRedemptions.slice(0, 3).map((row: any) => (
                      <View key={String(row.id)} style={{ borderRadius: 10, padding: 10, backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: BORDER }}>
                        <Text style={{ color: "#fff", fontWeight: "800" }}>
                          Queue #{Number(row.queue_seq || 0)} - {String(row.status || "").toUpperCase()}
                        </Text>
                        <Text style={{ marginTop: 4, color: MUTED, fontSize: 12 }}>
                          Locked {Number(row.locked_net_payout_pi || 0).toFixed(8)} PI for {Number(row.quantity_locked || 0).toFixed(6)} {symbol}
                        </Text>
                        {row.next_retry_at ? (
                          <Text style={{ marginTop: 3, color: "rgba(255,255,255,0.55)", fontSize: 11 }}>
                            Next retry {new Date(String(row.next_retry_at)).toLocaleString()}
                          </Text>
                        ) : null}
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}

            {panel === "trades" ? (
              <View style={{ marginTop: 10, gap: 8 }}>
                {trades.length === 0 ? (
                  <View style={{ borderRadius: 12, padding: 12, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
                    <Text style={{ color: MUTED }}>No trades yet.</Text>
                  </View>
                ) : (
                  trades.map((t: any) => (
                    <View key={String(t.id)} style={{ borderRadius: 12, padding: 10, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                        <Text style={{ color: t.side === "buy" ? MINT : RED, fontWeight: "900" }}>
                          {String(t.side || "").toUpperCase()}
                        </Text>
                        <Text style={{ color: MUTED, fontSize: 11 }}>
                          {new Date(String(t.traded_at || t.created_at || Date.now())).toLocaleString()}
                        </Text>
                      </View>
                      <Text style={{ marginTop: 4, color: "#fff", fontWeight: "800" }}>
                        ${Number(t.price_usdc || 0).toFixed(6)} x {Number(t.quantity || 0).toFixed(6)}
                      </Text>
                      <Text style={{ marginTop: 2, color: MUTED, fontSize: 11 }}>
                        Notional ${Number(t.notional_usdc || 0).toFixed(6)} - Fee ${Number(t.fee_usdc || 0).toFixed(6)}
                      </Text>
                    </View>
                  ))
                )}
              </View>
            ) : null}

            {panel === "chat" ? (
              <View style={{ marginTop: 10 }}>
                <View style={{ borderRadius: 12, padding: 10, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
                  <Text style={{ color: "#fff", fontWeight: "900" }}>Live Chat</Text>
                  <Text style={{ marginTop: 3, color: MUTED, fontSize: 11 }}>Rate limited to reduce spam and noise.</Text>
                </View>

                <View style={{ marginTop: 8, borderRadius: 12, padding: 10, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
                  <TextInput
                    value={chatText}
                    onChangeText={setChatText}
                    placeholder="Share insight or ask question..."
                    placeholderTextColor="rgba(255,255,255,0.45)"
                    style={{ color: "#fff", minHeight: 44 }}
                    editable={!posting}
                  />
                  <Pressable
                    onPress={onPostChat}
                    disabled={posting || !chatText.trim()}
                    style={{
                      marginTop: 8,
                      borderRadius: 10,
                      paddingVertical: 9,
                      alignItems: "center",
                      backgroundColor: posting || !chatText.trim() ? "rgba(45,212,191,0.20)" : "rgba(45,212,191,0.36)",
                      borderWidth: 1,
                      borderColor: "rgba(45,212,191,0.55)",
                    }}
                  >
                    <Text style={{ color: "#ECFEFF", fontWeight: "900" }}>{posting ? "Posting..." : "Post Chat"}</Text>
                  </Pressable>
                </View>

                {chatLoading ? (
                  <View style={{ marginTop: 10, alignItems: "center" }}>
                    <ActivityIndicator />
                    <Text style={{ marginTop: 7, color: MUTED }}>Loading chat...</Text>
                  </View>
                ) : null}

                {!!chatErr ? (
                  <View style={{ marginTop: 8, borderRadius: 12, padding: 10, backgroundColor: "rgba(127,29,29,0.26)", borderWidth: 1, borderColor: "rgba(239,68,68,0.35)" }}>
                    <Text style={{ color: "#FCA5A5", fontWeight: "800" }}>{chatErr}</Text>
                  </View>
                ) : null}

                <View style={{ marginTop: 8, gap: 8 }}>
                  {chatRows.map((m: any) => (
                    <View key={String(m.id)} style={{ borderRadius: 12, padding: 10, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                        <Text style={{ color: "#fff", fontWeight: "800", fontSize: 12 }}>
                          @{m?.profile?.username || m?.profile?.full_name || "user"}
                        </Text>
                        <Text style={{ color: MUTED, fontSize: 11 }}>
                          {new Date(String(m.created_at || Date.now())).toLocaleTimeString()}
                        </Text>
                      </View>
                      <Text style={{ marginTop: 5, color: "#E2E8F0" }}>{String(m.body || "")}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      {!loading && !err && detail && tradeRail === "evm" ? (
        <View
          style={{
            position: "absolute",
            left: 14,
            right: 14,
            bottom: 14,
            borderRadius: 14,
            padding: 10,
            backgroundColor: "rgba(3,7,18,0.92)",
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.16)",
          }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ color: "#fff", fontWeight: "900" }}>Quick Buy</Text>
            <Text style={{ color: MUTED, fontSize: 11 }}>
              {quickQuote ? `~${Number(quickQuote.quantity || 0).toFixed(4)} ${symbol}` : "Live quote"}
            </Text>
          </View>

          <View style={{ marginTop: 8, flexDirection: "row", gap: 8 }}>
            {[10, 20, 50, 100].map((v) => (
              <Pressable
                key={v}
                onPress={() => setQuickAmount(v)}
                style={{
                  flex: 1,
                  borderRadius: 10,
                  paddingVertical: 8,
                  alignItems: "center",
                  backgroundColor: quickAmount === v ? "rgba(45,212,191,0.20)" : "rgba(255,255,255,0.05)",
                  borderWidth: 1,
                  borderColor: quickAmount === v ? "rgba(45,212,191,0.52)" : BORDER,
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "800", fontSize: 12 }}>${v}</Text>
              </Pressable>
            ))}
          </View>

          <View style={{ marginTop: 8, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <View style={{ flex: 1 }}>
              {quickQuote ? (
                <View>
                  <Text style={{ color: MUTED, fontSize: 11 }}>
                    Exec ${Number(quickQuote.price_execution_usdc || 0).toFixed(6)} - Impact {Number(quickQuote.price_impact_bps || 0).toFixed(2)} bps
                  </Text>
                  <Text style={{ marginTop: 2, color: MUTED, fontSize: 11 }}>
                    Max trade (quote): ${Number(quickQuote.max_trade_usdc || 0).toFixed(6)} USDC
                  </Text>
                </View>
              ) : quickQuoteErr ? (
                <Text style={{ color: "#FCA5A5", fontSize: 11, fontWeight: "700" }}>{quickQuoteErr}</Text>
              ) : (
                <Text style={{ color: MUTED, fontSize: 11 }}>Preparing quote...</Text>
              )}
            </View>
            <Pressable
              onPress={onQuickBuy}
              disabled={!canQuickBuy}
              style={{
                borderRadius: 10,
                paddingHorizontal: 14,
                paddingVertical: 10,
                backgroundColor: !canQuickBuy ? "rgba(255,255,255,0.14)" : "rgba(45,212,191,0.34)",
                borderWidth: 1,
                borderColor: !canQuickBuy ? "rgba(255,255,255,0.26)" : "rgba(45,212,191,0.58)",
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }}>
                {submitting ? "Submitting..." : !canQuickBuy ? "Quote Needed" : `Buy $${quickAmount}`}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <Modal visible={confirmVisible} transparent animationType="fade" onRequestClose={() => setConfirmVisible(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.62)", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <View style={{ width: "100%", maxWidth: 420, borderRadius: 16, padding: 14, backgroundColor: "#0B1220", borderWidth: 1, borderColor: BORDER }}>
            <Text style={{ color: "#fff", fontWeight: "900", fontSize: 16 }}>
              {pendingTrade?.rail === "pi"
                ? pendingTrade?.side === "buy"
                  ? "Confirm Pi Payment"
                  : "Confirm Locked Pi Sell"
                : "Confirm On-Chain Trade"}
            </Text>
            <Text style={{ marginTop: 8, color: MUTED, fontSize: 12 }}>
              Side: {(pendingTrade?.side || side).toUpperCase()}
            </Text>
            <Text style={{ marginTop: 4, color: MUTED, fontSize: 12 }}>
              {pendingTrade?.side === "buy"
                ? `Amount: $${Number(pendingTrade?.amount_usdc || 0).toFixed(2)} USDC`
                : `Quantity: ${Number(pendingTrade?.quantity || 0).toFixed(6)} ${symbol}`}
            </Text>
            {confirmQuote ? (
              <Text style={{ marginTop: 6, color: "#E2E8F0", fontSize: 12 }}>
                Est. exec ${Number(confirmQuote.price_execution_usdc || 0).toFixed(6)} | Fee ${Number(confirmQuote.fee_usdc || 0).toFixed(6)}
              </Text>
            ) : null}
            {pendingTrade?.rail === "pi" ? (
              <>
                <Text style={{ marginTop: 6, color: "#BFDBFE", fontSize: 12 }}>
                  {pendingTrade?.side === "buy"
                    ? `${Number(confirmQuote?.gross_pi || 0).toFixed(8)} PI will be authorized and only server confirmation credits shares.`
                    : `${Number(confirmQuote?.net_pi || 0).toFixed(8)} PI is locked at this sell quote and will pay out from the queue budget.`}
                </Text>
                <Text style={{ marginTop: 6, color: MUTED, fontSize: 12 }}>
                  {pendingTrade?.side === "buy"
                    ? isPiBrowser
                      ? "This runs Pi Browser payment approval and server-side completion."
                      : "This opens Pi Browser, then server-side completion credits shares after Pi confirms."
                    : "Shares move to LOCKED_FOR_REDEMPTION immediately after acceptance. Retries are idempotent and queue-driven."}
                </Text>
              </>
            ) : (
              <Text style={{ marginTop: 8, color: MUTED, fontSize: 12 }}>
                This sends a real on-chain transaction from your wallet.
              </Text>
            )}

            <View style={{ marginTop: 12, flexDirection: "row", gap: 8 }}>
              <Pressable
                onPress={() => setConfirmVisible(false)}
                style={{ flex: 1, borderRadius: 11, paddingVertical: 10, alignItems: "center", backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: BORDER }}
              >
                <Text style={{ color: "#fff", fontWeight: "800" }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={executeTrade}
                disabled={submitting}
                style={{ flex: 1, borderRadius: 11, paddingVertical: 10, alignItems: "center", backgroundColor: "rgba(45,212,191,0.34)", borderWidth: 1, borderColor: "rgba(45,212,191,0.58)" }}
              >
                <Text style={{ color: "#ECFEFF", fontWeight: "900" }}>{submitting ? "Submitting..." : "Confirm"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={successVisible} transparent animationType="fade" onRequestClose={() => setSuccessVisible(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.62)", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <View style={{ width: "100%", maxWidth: 420, borderRadius: 16, padding: 14, backgroundColor: "#052019", borderWidth: 1, borderColor: "rgba(45,212,191,0.45)" }}>
            <Text style={{ color: "#A7F3D0", fontWeight: "900", fontSize: 16 }}>Trade Successful</Text>
            <Text style={{ marginTop: 8, color: "#ECFEFF", fontSize: 12 }}>
              {successMessage}
            </Text>
            {!!successTxHash ? (
              <Text style={{ marginTop: 8, color: "#99F6E4", fontSize: 11 }} numberOfLines={2}>
                Tx: {successTxHash}
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
                  if (successExplorer) Linking.openURL(successExplorer);
                }}
                disabled={!successExplorer}
                style={{ flex: 1, borderRadius: 10, paddingVertical: 9, alignItems: "center", backgroundColor: successExplorer ? "rgba(45,212,191,0.28)" : "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: successExplorer ? "rgba(45,212,191,0.58)" : "rgba(255,255,255,0.16)" }}
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


