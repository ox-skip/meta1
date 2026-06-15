import { Ionicons } from "@expo/vector-icons";
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
  useWindowDimensions,
  View,
} from "react-native";
import Svg, { Defs, Line, LinearGradient as SvgGradient, Path, Rect, Stop, Text as SvgText } from "react-native-svg";

import AppHeader from "@/components/common/AppHeader";
import {
  STOCK,
  StockScreen,
  StockLoadingState,
  StockMetric,
  StockPanel,
  StockPill,
  StockSegment,
  formatStockMoney,
  formatStockPrice,
  formatStockQuantity,
  stockChainLabel,
} from "@/components/market/stock/StockUi";
import { InAppTutorial, TutorialTarget } from "@/components/onboarding/InAppTutorial";
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
import { addCreatorStockLiquidityOnchain, repairLastStockTradeIndex, submitStockTradeOnchain } from "@/services/market/stockOnchain";
import { isWalletMismatchError } from "@/services/market/usdcCheckout";
import { supabase } from "@/services/supabase";
import { friendlyMarketError } from "@/utils/marketUx";

const CARD = STOCK.panel;
const BORDER = STOCK.border;
const MINT = STOCK.mint;
const RED = STOCK.red;
const MUTED = STOCK.muted;
const DEFAULT_TRADE_SLIPPAGE_BPS = 2200;
const QUICK_BUY_AMOUNTS = [0.001, 0.01, 0.1, 10, 20, 50, 100];

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
      return `Trade amount is above the current market limit (${maxVal.toFixed(6)} USDC). Reduce amount and retry.`;
    }
  }
  if (/rpc|on-chain|onchain/i.test(raw)) {
    return raw
      .replace(/on-chain/gi, "network")
      .replace(/onchain/gi, "network")
      .replace(/RPC/gi, "network");
  }
  return friendlyMarketError(error, fallback);
}

function formatTradeUsdcAmount(value: unknown) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 0.01) return n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return n.toFixed(2);
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
  const height = 320;
  const left = 16;
  const right = 66;
  const top = 18;
  const bottom = 18;
  const volumeHeight = 68;
  const priceBottom = height - volumeHeight - 16;
  const volumeTop = priceBottom + 10;
  const rows = candles.slice(-120);
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
    const rangePad = Math.max(0.000001, (high - low) * 0.08);
    return { high: high + rangePad, low: Math.max(0, low - rangePad), maxVolume: Math.max(1, maxVolume) };
  }, [rows]);

  const marketStats = useMemo(() => {
    const first = rows[0];
    const last = rows[rows.length - 1];
    const firstClose = Number(first?.close_price_usdc || first?.open_price_usdc || 0);
    const lastClose = Number(last?.close_price_usdc || 0);
    const changePct = firstClose > 0 ? ((lastClose - firstClose) / firstClose) * 100 : 0;
    const volume = rows.reduce((sum, row) => sum + Number(row.volume_usdc || 0), 0);
    const trades = rows.reduce((sum, row) => sum + Number(row.trades_count || 0), 0);
    return { firstClose, lastClose, changePct, volume, trades };
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
        borderRadius: 8,
        overflow: "hidden",
        borderWidth: 1,
        borderColor: "rgba(98,168,255,0.26)",
        backgroundColor: "rgba(6,10,16,0.86)",
      }}
    >
      <View style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)" }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: STOCK.cyan, fontSize: 11, fontWeight: "900" }}>Market Pulse</Text>
            <Text style={{ marginTop: 4, color: STOCK.ink, fontSize: 25, fontWeight: "900" }}>
              {formatStockPrice(marketStats.lastClose, 6)}
            </Text>
          </View>
          <View
            style={{
              borderRadius: 999,
              paddingHorizontal: 10,
              paddingVertical: 6,
              backgroundColor: marketStats.changePct >= 0 ? "rgba(47,214,163,0.15)" : "rgba(255,92,122,0.14)",
              borderWidth: 1,
              borderColor: marketStats.changePct >= 0 ? "rgba(47,214,163,0.42)" : "rgba(255,92,122,0.4)",
            }}
          >
            <Text style={{ color: marketStats.changePct >= 0 ? "#D7FFF3" : "#FFE3EA", fontSize: 11, fontWeight: "900" }}>
              {marketStats.changePct >= 0 ? "+" : ""}
              {marketStats.changePct.toFixed(2)}%
            </Text>
          </View>
        </View>
        <View style={{ marginTop: 12, flexDirection: "row", gap: 9, flexWrap: "wrap" }}>
          <Text style={{ color: STOCK.muted, fontSize: 11, fontWeight: "800" }}>
            Range {formatStockPrice(stats.low, 6)} - {formatStockPrice(stats.high, 6)}
          </Text>
          <Text style={{ color: STOCK.muted, fontSize: 11, fontWeight: "800" }}>
            Volume {formatStockMoney(marketStats.volume, 2)}
          </Text>
          <Text style={{ color: STOCK.muted, fontSize: 11, fontWeight: "800" }}>
            Trades {marketStats.trades}
          </Text>
        </View>
      </View>
      {width > 0 && rows.length > 0 ? (
        <Svg width={width} height={height}>
          <Defs>
            <SvgGradient id="stockAreaGradient" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor="rgba(98,168,255,0.36)" />
              <Stop offset="58%" stopColor="rgba(47,214,163,0.10)" />
              <Stop offset="100%" stopColor="rgba(98,168,255,0.00)" />
            </SvgGradient>
          </Defs>

          {[0, 1, 2, 3, 4].map((i) => {
            const yy = top + (priceH * i) / 4;
            const price = stats.high - ((stats.high - stats.low) * i) / 4;
            return (
              <React.Fragment key={`grid-${i}`}>
                <Line x1={left} y1={yy} x2={left + plotW} y2={yy} stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
                <SvgText x={width - 4} y={yy + 3} fontSize={10} fill="rgba(255,255,255,0.55)" textAnchor="end">
                  {price >= 1 ? price.toFixed(4) : price.toFixed(6)}
                </SvgText>
              </React.Fragment>
            );
          })}

          {rows.map((_, idx) => {
            const interval = Math.max(8, Math.ceil(rows.length / 6));
            if (idx % interval !== 0) return null;
            const xx = xAt(idx);
            return <Line key={`v-${idx}`} x1={xx} y1={top} x2={xx} y2={priceBottom} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />;
          })}

          <Path d={closeLine.areaPath} fill="url(#stockAreaGradient)" />
          <Path d={closeLine.linePath} stroke="rgba(98,168,255,0.94)" strokeWidth={2.4} strokeLinecap="round" fill="none" />

          {marketStats.lastClose > 0 ? (
            <>
              <Line
                x1={left}
                y1={yPrice(marketStats.lastClose)}
                x2={left + plotW}
                y2={yPrice(marketStats.lastClose)}
                stroke={marketStats.changePct >= 0 ? "rgba(47,214,163,0.52)" : "rgba(255,92,122,0.48)"}
                strokeWidth={1}
                strokeDasharray="5 5"
              />
              <Rect
                x={Math.max(left, width - right + 4)}
                y={Math.max(top, yPrice(marketStats.lastClose) - 11)}
                width={right - 8}
                height={22}
                rx={8}
                fill={marketStats.changePct >= 0 ? "rgba(47,214,163,0.20)" : "rgba(255,92,122,0.18)"}
              />
              <SvgText
                x={width - 6}
                y={Math.max(top + 14, yPrice(marketStats.lastClose) + 4)}
                fontSize={10}
                fontWeight="700"
                fill={marketStats.changePct >= 0 ? "#D7FFF3" : "#FFE3EA"}
                textAnchor="end"
              >
                {marketStats.lastClose >= 1 ? marketStats.lastClose.toFixed(4) : marketStats.lastClose.toFixed(6)}
              </SvgText>
            </>
          ) : null}

          {rows.map((c, idx) => {
            const barX = left + idx * xStep + xStep * 0.24;
            const barW = Math.max(1, xStep * 0.5);
            const vy = yVolume(Number(c.volume_usdc || 0));
            const up = Number(c.close_price_usdc || 0) >= Number(c.open_price_usdc || 0);
            return (
              <Rect
                key={`vol-${idx}`}
                x={barX}
                y={vy}
                width={barW}
                height={Math.max(1, height - bottom - vy)}
                rx={1}
                fill={up ? "rgba(47,214,163,0.22)" : "rgba(255,92,122,0.20)"}
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
                  strokeWidth={1.2}
                />
                <Rect x={x} y={top} width={candleW} height={bodyH} rx={Math.min(3, candleW / 2)} fill={color} />
              </React.Fragment>
            );
          })}
        </Svg>
      ) : (
        <View style={{ height, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="analytics-outline" size={26} color={STOCK.faint} />
          <Text style={{ marginTop: 9, color: MUTED, fontWeight: "800" }}>Chart appears after the first trades.</Text>
        </View>
      )}
    </View>
  );
}

export default function StockDetailScreen() {
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ slug?: string; side?: string }>();
  const slug = String(params.slug ?? "").trim().toLowerCase();
  const requestedSide = String(params.side || "").trim().toLowerCase() === "sell" ? "sell" : "buy";

  const [timeframe, setTimeframe] = useState<Timeframe>("1m");
  const [panel, setPanel] = useState<"trade" | "trades" | "chat">("trade");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const [tradeRail, setTradeRail] = useState<"evm" | "pi">("evm");
  const [side, setSide] = useState<"buy" | "sell">(requestedSide);
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
    "Your trade was completed and recorded in market history.",
  );
  const [quickAmount, setQuickAmount] = useState(20);
  const [quickQuote, setQuickQuote] = useState<any | null>(null);
  const [quickQuoteErr, setQuickQuoteErr] = useState<string | null>(null);
  const [liquidityAmount, setLiquidityAmount] = useState("");
  const [addingLiquidity, setAddingLiquidity] = useState(false);

  const [chatLoading, setChatLoading] = useState(false);
  const [chatErr, setChatErr] = useState<string | null>(null);
  const [chatRows, setChatRows] = useState<any[]>([]);
  const [chatText, setChatText] = useState("");
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    setSide(requestedSide);
    setPanel("trade");
  }, [requestedSide]);
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
      if (String(res?.identity?.chain || "").toLowerCase() === "pi_testnet") {
        setErr("This stock is not available in the public stock market view.");
        setDetail(null);
        return;
      }
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
    let mounted = true;
    supabase.auth.getUser()
      .then(({ data }) => {
        if (mounted) setCurrentUserId(data?.user?.id ?? null);
      })
      .catch(() => {
        if (mounted) setCurrentUserId(null);
      });
    return () => {
      mounted = false;
    };
  }, []);

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
          setQuoteErr(friendlyStockTradeError(e, "Price unavailable"));
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
          setQuickQuoteErr(friendlyStockTradeError(e, "Fast buy price unavailable"));
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
          "Checkout is taking longer than expected. Retry once, then continue on your phone if needed.",
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
                ? "Unable to open the stock handoff page. Open this stock on your phone and retry."
                : "Unable to open the secure checkout. Retry this stock buy.",
            );
          }

          Alert.alert(
            desktopWeb ? "Open on your phone" : "Continue checkout",
            desktopWeb
              ? "A checkout page opened. Scan its QR code or copy the link to your phone, then continue there."
              : "Checkout was opened. Complete the payment there, then return and refresh your position.",
          );
          setPendingTrade(null);
          return;
        }

        setSuccessTxHash(String(res?.txid || "") || null);
        setSuccessExplorer(null);
        setSuccessMessage("Payment confirmed and your shares are now in your stock position.");
      } else if (pendingTrade.rail === "pi" && pendingTrade.side === "sell") {
        const lockedQuote = pendingTrade.lockedQuote;
        if (!lockedQuote?.quote_ref || !lockedQuote?.quote_signature) {
          throw new Error("Locked sell price missing. Request a fresh sell price.");
        }
        const res = await submitPiStockSell({
          stock_id: detail?.identity?.id,
          quote_ref: String(lockedQuote.quote_ref),
          quote_signature: String(lockedQuote.quote_signature),
        });
        setSuccessTxHash(null);
        setSuccessExplorer(null);
        setSuccessMessage(`Sell accepted. Payout is locked at this price and queued at position #${Number(res.queue_position || 0)}.`);
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
          "Trade is taking too long. Check your wallet activity, then retry or use Sync Last Trade.",
        );

        setSuccessTxHash(String(res?.tx_hash || "") || null);
        setSuccessExplorer(String(res?.explorer_url || "") || null);
        const pendingIndex = String(res?.execution?.status || "").toUpperCase() === "PENDING_INDEX";
        setSuccessMessage(
          pendingIndex
            ? "Trade is confirmed. Market history is still syncing. Use Sync Last Trade if it does not appear shortly."
            : "Your trade was completed and recorded in market history.",
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
      setQuoteErr("Price is still updating. Please wait a moment.");
      return;
    }
    if (quoteErr) {
      return;
    }
    if (!quote) {
      setQuoteErr("Price unavailable. Please retry.");
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
        setQuoteErr(friendlyMarketError(e, "Unable to lock the sell price."));
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
      setQuickQuoteErr("Fast buy price unavailable. Please wait and try again.");
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

  async function onAddLiquidity() {
    const amount = Number(String(liquidityAmount || "").replace(/,/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) {
      setErr("Enter a valid USDC amount.");
      return;
    }
    setErr(null);
    setAddingLiquidity(true);
    try {
      const res = await addCreatorStockLiquidityOnchain({ slug, amount_usdc: amount });
      setSuccessTxHash(String(res?.tx_hash || "") || null);
      setSuccessExplorer(String(res?.explorer_url || "") || null);
      setSuccessMessage(`Added ${formatTradeUsdcAmount(amount)} USDC to market depth.`);
      setSuccessVisible(true);
      setLiquidityAmount("");
      await loadDetail(true);
    } catch (e: any) {
      setErr(friendlyStockTradeError(e, "Could not add liquidity."));
    } finally {
      setAddingLiquidity(false);
    }
  }

  const title = detail?.identity?.name || "Stock";
  const symbol = detail?.identity?.symbol || "";
  const isPiNativeStock = String(detail?.identity?.chain || "").toLowerCase() === "pi_testnet";
  const chainText = stockChainLabel(detail?.identity?.chain);
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
  const isStoreOwner = !!currentUserId && String(detail?.identity?.store_id || "") === String(currentUserId);
  const canAddLiquidity = isStoreOwner && !isPiNativeStock && !addingLiquidity && Number(liquidityAmount || 0) > 0;
  const isWide = width >= 980;
  const pageMaxWidth = isWide ? 1120 : undefined;

  useEffect(() => {
    if (isPiNativeStock) {
      if (tradeRail !== "pi") setTradeRail("pi");
      return;
    }
    if (tradeRail !== "evm") setTradeRail("evm");
  }, [isPiNativeStock, tradeRail]);

  return (
    <StockScreen style={{ paddingHorizontal: isWide ? 28 : 16 }}>
      <InAppTutorial enabled={!loading && !!detail} flow={tutorialFlows.stockDetail} />
      <View style={{ alignSelf: "center", width: "100%", maxWidth: pageMaxWidth }}>
        <AppHeader title="Stock Market" subtitle="Price, chart, trades, and community." />
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: 148, alignSelf: "center", width: "100%", maxWidth: pageMaxWidth }}>
        {loading ? <StockLoadingState label="Loading stock" /> : null}

        {!!err ? (
          <View style={{ marginTop: 12, borderRadius: 12, padding: 10, backgroundColor: "rgba(127,29,29,0.26)", borderWidth: 1, borderColor: "rgba(239,68,68,0.35)" }}>
            <Text style={{ color: "#FCA5A5", fontWeight: "800" }}>{err}</Text>
          </View>
        ) : null}

        {!loading && !err && detail ? (
          <>
            <TutorialTarget id="stock.detail.stats">
              <StockPanel style={{ marginTop: 10, padding: isWide ? 14 : 12, backgroundColor: "rgba(247,250,252,0.06)" }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <View
                    style={{
                      width: isWide ? 58 : 54,
                      height: isWide ? 58 : 54,
                      borderRadius: 8,
                      overflow: "hidden",
                      borderWidth: 1,
                      borderColor: STOCK.borderStrong,
                      backgroundColor: STOCK.panelSoft,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {sellerLogo ? (
                      <Image source={{ uri: sellerLogo }} style={{ width: isWide ? 58 : 54, height: isWide ? 58 : 54 }} />
                    ) : (
                      <Ionicons name="storefront-outline" size={25} color={STOCK.muted} />
                    )}
                  </View>

                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ color: STOCK.ink, fontWeight: "900", fontSize: isWide ? 22 : 19 }} numberOfLines={1}>
                      {title}
                    </Text>
                    <View style={{ marginTop: 5, flexDirection: "row", alignItems: "center", gap: 5 }}>
                      <Text style={{ color: MUTED, fontSize: 12, flexShrink: 1, fontWeight: "700" }} numberOfLines={1}>
                        {symbol} - @{detail?.seller?.market_username || "store"}
                      </Text>
                      {detail?.seller?.is_verified ? <Ionicons name="checkmark-circle" size={14} color={STOCK.cyan} /> : null}
                    </View>
                    <View style={{ marginTop: 8, flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                      <StockPill label={`/stock/${slug}`} tone="plain" compact />
                      <StockPill label={chainText} tone={isPiNativeStock ? "amber" : "cyan"} compact />
                      <StockPill
                        label={tradingPaused ? "Paused" : launchGuard ? "Guarded" : "Open"}
                        tone={tradingPaused ? "red" : "mint"}
                        compact
                      />
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
                      width: 43,
                      height: 43,
                      borderRadius: 8,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: STOCK.panelSoft,
                      borderWidth: 1,
                      borderColor: BORDER,
                      opacity: detail?.seller?.market_username ? 1 : 0.5,
                    }}
                  >
                    <Ionicons name="storefront-outline" size={18} color={STOCK.ink} />
                  </Pressable>
                </View>

                <View style={{ marginTop: 12, flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  <StockMetric label="Price" value={formatStockPrice(price, 6)} tone="mint" />
                  <StockMetric label="Market Cap" value={formatStockMoney(mcap)} />
                  <StockMetric label="24h Volume" value={formatStockMoney(vol24)} tone="cyan" />
                  <StockMetric label="24h Trades" value={String(trades24)} tone="amber" />
                </View>
              </StockPanel>
            </TutorialTarget>

            <View style={{ marginTop: 10, flexDirection: isWide ? "row" : "column", gap: 12, alignItems: "flex-start" }}>
              <View style={{ flex: 1, minWidth: 0, width: isWide ? undefined : "100%" }}>

            <View style={{ marginTop: 12 }}>
              <StockSegment
                value={timeframe}
                onChange={setTimeframe}
                options={[
                  { key: "1m", label: "1m", tone: "mint" },
                  { key: "5m", label: "5m", tone: "mint" },
                  { key: "15m", label: "15m", tone: "cyan" },
                  { key: "1h", label: "1h", tone: "cyan" },
                  { key: "4h", label: "4h", tone: "amber" },
                  { key: "1d", label: "1d", tone: "amber" },
                ]}
              />
            </View>

            <View style={{ marginTop: 10, flexDirection: "row", gap: 9 }}>
              <StockMetric label="Last" value={formatStockPrice(Number(latestCandle?.close_price_usdc ?? price), 6)} />
              <StockMetric label="High" value={formatStockPrice(chartHigh, 6)} tone="mint" />
              <StockMetric label="Low" value={formatStockPrice(chartLow, 6)} tone="red" />
            </View>

            <CandleChart candles={candles} />

            {!!myPos ? (
              <StockPanel style={{ marginTop: 10 }}>
                <Text style={{ color: STOCK.ink, fontWeight: "900", fontSize: 15 }}>My Position</Text>
                <View style={{ marginTop: 10, flexDirection: "row", flexWrap: "wrap", gap: 9 }}>
                  <StockMetric label="Quantity" value={formatStockQuantity(myPos.balance_qty, 4)} />
                  <StockMetric label="Average" value={formatStockPrice(myPos.avg_cost_usdc, 6)} tone="cyan" />
                  <StockMetric label="Realized" value={formatStockMoney(myPos.realized_pnl_usdc)} tone={Number(myPos.realized_pnl_usdc || 0) >= 0 ? "mint" : "red"} />
                </View>
                {lockedRedemptionQty > 0 ? (
                  <Text style={{ marginTop: 9, color: "#FDE68A", fontSize: 12, fontWeight: "800" }}>
                    Locked for redemption: {formatStockQuantity(lockedRedemptionQty, 4)} {symbol}
                  </Text>
                ) : null}
              </StockPanel>
            ) : null}

            {isStoreOwner && !isPiNativeStock ? (
              <StockPanel style={{ marginTop: 10, backgroundColor: "rgba(98,168,255,0.08)", borderColor: "rgba(98,168,255,0.22)" }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: STOCK.ink, fontWeight: "900", fontSize: 15 }}>Market Depth</Text>
                    <Text style={{ marginTop: 4, color: STOCK.muted, fontSize: 12, lineHeight: 17 }}>
                      Add USDC so larger buys can clear with less price movement.
                    </Text>
                  </View>
                  <StockPill label="Store Owner" tone="cyan" compact />
                </View>
                <View style={{ marginTop: 12, flexDirection: "row", gap: 8, alignItems: "center" }}>
                  <TextInput
                    value={liquidityAmount}
                    onChangeText={setLiquidityAmount}
                    keyboardType="decimal-pad"
                    placeholder="0.0001"
                    placeholderTextColor="rgba(255,255,255,0.42)"
                    style={{
                      flex: 1,
                      borderRadius: 8,
                      paddingHorizontal: 10,
                      paddingVertical: 10,
                      color: "#fff",
                      backgroundColor: "rgba(255,255,255,0.05)",
                      borderWidth: 1,
                      borderColor: BORDER,
                      fontWeight: "800",
                    }}
                    editable={!addingLiquidity}
                  />
                  <Pressable
                    onPress={onAddLiquidity}
                    disabled={!canAddLiquidity}
                    style={{
                      borderRadius: 8,
                      minHeight: 42,
                      paddingHorizontal: 13,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: canAddLiquidity ? "rgba(98,168,255,0.28)" : "rgba(255,255,255,0.10)",
                      borderWidth: 1,
                      borderColor: canAddLiquidity ? "rgba(98,168,255,0.52)" : BORDER,
                    }}
                  >
                    <Text style={{ color: canAddLiquidity ? "#DCEBFF" : STOCK.faint, fontWeight: "900", fontSize: 12 }}>
                      {addingLiquidity ? "Adding" : "Add"}
                    </Text>
                  </Pressable>
                </View>
              </StockPanel>
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
                <Text style={{ color: "#fff", fontWeight: "900" }}>Liquidity pressure</Text>
                <Text style={{ marginTop: 6, color: MUTED, fontSize: 12 }}>
                  LPI {piLpi.toFixed(2)} - Coverage {piCoverageRatio.toFixed(2)} - Queue budget {piQueueBudget.toFixed(8)} / 24h
                </Text>
                <Text style={{ marginTop: 4, color: piSellsPaused ? "#FCA5A5" : "#BFDBFE", fontSize: 12, fontWeight: "800" }}>
                  {piSellsPaused
                    ? "New sells are paused until coverage improves. Existing locked sells remain honored."
                    : "Sell spreads, cooldowns, and supply release adjust with LPI."}
                </Text>
              </View>
            ) : null}

              </View>
              <View style={{ width: isWide ? 368 : ("100%" as any) }}>

            <TutorialTarget id="stock.detail.tabs">
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
            </TutorialTarget>

            {panel === "trade" ? (
              <View style={{ marginTop: 10, borderRadius: 14, padding: 12, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
                {!isPiNativeStock ? (
                  <View style={{ marginBottom: 10, borderRadius: 10, padding: 10, backgroundColor: "rgba(45,212,191,0.10)", borderWidth: 1, borderColor: "rgba(45,212,191,0.28)" }}>
                    <Text style={{ color: "#ECFEFF", fontWeight: "900" }}>Network Market</Text>
                    <Text style={{ marginTop: 4, color: MUTED, fontSize: 12 }}>
                      Trading is live on {chainText}.
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
                  <Text style={{ marginTop: 8, color: MUTED, fontSize: 12 }}>Updating price</Text>
                ) : null}

                {!!quote ? (
                  <View style={{ marginTop: 8 }}>
                    <Text style={{ color: MUTED, fontSize: 12 }}>
                      Expected price ${Number(quote.price_execution_usdc || 0).toFixed(6)} - Move {(Number(quote.price_impact_bps || 0) / 100).toFixed(2)}%
                    </Text>
                    <Text style={{ marginTop: 3, color: MUTED, fontSize: 12 }}>
                      Shares {Number(quote.quantity || 0).toFixed(6)} - Value ${Number((quote.gross_usdc ?? quote.notional_usdc) || 0).toFixed(6)} - Fee ${Number(quote.fee_usdc || 0).toFixed(6)}
                    </Text>
                    <Text style={{ marginTop: 3, color: MUTED, fontSize: 12 }}>
                      {tradeRail === "pi"
                        ? `${side === "buy" ? "Pay" : "Locked payout"} ${Number((side === "buy" ? quote.gross_pi : quote.net_pi) || 0).toFixed(8)} payment units`
                        : `Current limit: $${Number(quote.max_trade_usdc || 0).toFixed(6)} USDC`}
                    </Text>
                    {tradeRail === "pi" ? (
                      <Text style={{ marginTop: 3, color: MUTED, fontSize: 12 }}>
                        LPI {Number(quote.lpi || 0).toFixed(2)} - Coverage {Number(quote.coverage_ratio || 0).toFixed(2)} - Flow {Number(quote.flow_balance || 0).toFixed(2)}
                      </Text>
                    ) : null}
                    {tradeRail === "pi" && side === "sell" ? (
                      <Text style={{ marginTop: 3, color: "#FDE68A", fontSize: 12 }}>
                        Locked payout is fixed once accepted. Shares are held for redemption immediately.
                      </Text>
                    ) : null}
                    {tradeRail === "pi" && side === "buy" && !isPiBrowser ? (
                      <Text style={{ marginTop: 3, color: "#BFDBFE", fontSize: 12 }}>
                        {isDesktopWeb
                          ? "Desktop will open a phone handoff page with QR and copy-link. Continue on your phone."
                          : "Buy checkout opens before confirmed shares are added."}
                      </Text>
                    ) : null}
                    {tradeRail === "pi" && side === "sell" && piSellsPaused ? (
                      <Text style={{ marginTop: 3, color: "#FCA5A5", fontSize: 12, fontWeight: "700" }}>
                        New sells are paused by the circuit breaker for this stock.
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
                        Stress spread {(Number(quote.stress_spread_bps || 0) / 100).toFixed(2)}% - Early exit fee {(Number(quote.early_exit_fee_bps || 0) / 100).toFixed(2)}%
                      </Text>
                    ) : null}
                    {tradeRail === "pi" ? (
                      <Text style={{ marginTop: 3, color: MUTED, fontSize: 12 }}>
                        Cooldown {Number(quote.cooldown_seconds || 0).toFixed(0)}s
                      </Text>
                    ) : null}
                    {tradeRail === "pi" && quote.quote_expires_at ? (
                      <Text style={{ marginTop: 3, color: MUTED, fontSize: 12 }}>
                        Price expires {String(quote.quote_expires_at)}
                      </Text>
                    ) : null}
                    {tradeRail === "evm" ? (
                      <Text style={{ marginTop: 3, color: MUTED, fontSize: 12 }}>
                        Current limit: $${Number(quote.max_trade_usdc || 0).toFixed(6)} USDC
                      </Text>
                    ) : null}
                    {tradeRail === "pi" && side === "buy" ? (
                      <Text style={{ marginTop: 3, color: MUTED, fontSize: 12 }}>
                        {isPiBrowser
                          ? "Payment is available in this browser."
                          : isDesktopWeb
                          ? "Desktop opens a phone handoff page. Scan the QR code there or copy the link to your phone."
                          : "Open the secure browser to authorize this payment."}
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
                      ? "Submitting"
                      : tradingPaused
                      ? "Trading Paused"
                      : tradeRail === "pi" && side === "buy"
                      ? isPiBrowser
                        ? "Pay"
                        : isDesktopWeb
                        ? "Continue On Phone"
                        : "Open Secure Browser"
                      : tradeRail === "pi" && side === "sell"
                      ? piSellsPaused
                        ? "Sells Paused"
                        : "Lock Sell"
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
                      borderRadius: 8,
                      paddingVertical: 10,
                      alignItems: "center",
                      backgroundColor: "rgba(255,255,255,0.06)",
                      borderWidth: 1,
                      borderColor: BORDER,
                      opacity: repairing ? 0.7 : 1,
                    }}
                  >
                    <Text style={{ color: "#fff", fontWeight: "800", fontSize: 12 }}>
                      {repairing ? "Checking" : "Sync Last Trade"}
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
                          Locked payout for {Number(row.quantity_locked || 0).toFixed(6)} {symbol}
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
                    <Text style={{ color: MUTED }}>No trades recorded.</Text>
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
                  <Text style={{ color: "#fff", fontWeight: "900" }}>Market Chat</Text>
                  <Text style={{ marginTop: 3, color: MUTED, fontSize: 11 }}>Rate limited to reduce spam and noise.</Text>
                </View>

                <View style={{ marginTop: 8, borderRadius: 12, padding: 10, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER }}>
                  <TextInput
                    value={chatText}
                    onChangeText={setChatText}
                    placeholder="Add a market comment"
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
                    <Text style={{ color: "#ECFEFF", fontWeight: "900" }}>{posting ? "Posting" : "Post"}</Text>
                  </Pressable>
                </View>

                {chatLoading ? (
                  <View style={{ marginTop: 10, alignItems: "center" }}>
                    <ActivityIndicator />
                    <Text style={{ marginTop: 7, color: MUTED }}>Loading chat</Text>
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
              </View>
            </View>
          </>
        ) : null}
      </ScrollView>

      {!loading && !err && detail && tradeRail === "evm" ? (
        <TutorialTarget id="stock.detail.quote">
          <View
          style={{
            position: "absolute",
            left: 14,
            right: 14,
            bottom: 14,
            borderRadius: 8,
            padding: 10,
            backgroundColor: "rgba(6,10,16,0.94)",
            borderWidth: 1,
            borderColor: "rgba(98,168,255,0.24)",
          }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ color: "#fff", fontWeight: "900" }}>Quick Buy</Text>
            <Text style={{ color: MUTED, fontSize: 11 }}>
              {quickQuote ? `~${Number(quickQuote.quantity || 0).toFixed(4)} ${symbol}` : "Live price"}
            </Text>
          </View>

          <View style={{ marginTop: 8, flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {QUICK_BUY_AMOUNTS.map((v) => (
              <Pressable
                key={String(v)}
                onPress={() => setQuickAmount(v)}
                style={{
                  flexGrow: 1,
                  flexBasis: 66,
                  borderRadius: 8,
                  paddingVertical: 8,
                  alignItems: "center",
                  backgroundColor: quickAmount === v ? "rgba(47,214,163,0.20)" : "rgba(255,255,255,0.05)",
                  borderWidth: 1,
                  borderColor: quickAmount === v ? "rgba(47,214,163,0.52)" : BORDER,
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "800", fontSize: 11 }}>${formatTradeUsdcAmount(v)}</Text>
              </Pressable>
            ))}
          </View>

          <View style={{ marginTop: 8, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <View style={{ flex: 1 }}>
              {quickQuote ? (
                <View>
                  <Text style={{ color: MUTED, fontSize: 11 }}>
                    Price ${Number(quickQuote.price_execution_usdc || 0).toFixed(6)} - Move {(Number(quickQuote.price_impact_bps || 0) / 100).toFixed(2)}%
                  </Text>
                  <Text style={{ marginTop: 2, color: MUTED, fontSize: 11 }}>
                    Current limit: ${Number(quickQuote.max_trade_usdc || 0).toFixed(6)} USDC
                  </Text>
                </View>
              ) : quickQuoteErr ? (
                <Text style={{ color: "#FCA5A5", fontSize: 11, fontWeight: "700" }}>{quickQuoteErr}</Text>
              ) : (
                <Text style={{ color: MUTED, fontSize: 11 }}>Preparing price</Text>
              )}
            </View>
            <TutorialTarget id="stock.detail.confirm">
              <Pressable
                onPress={onQuickBuy}
                disabled={!canQuickBuy}
                style={{
                  borderRadius: 8,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  backgroundColor: !canQuickBuy ? "rgba(255,255,255,0.14)" : "rgba(47,214,163,0.34)",
                  borderWidth: 1,
                  borderColor: !canQuickBuy ? "rgba(255,255,255,0.26)" : "rgba(47,214,163,0.58)",
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }}>
                  {submitting ? "Submitting" : !canQuickBuy ? "Price needed" : `Buy $${formatTradeUsdcAmount(quickAmount)}`}
                </Text>
              </Pressable>
            </TutorialTarget>
          </View>
          </View>
        </TutorialTarget>
      ) : null}

      <Modal visible={confirmVisible} transparent animationType="fade" onRequestClose={() => setConfirmVisible(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.62)", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <View style={{ width: "100%", maxWidth: 420, borderRadius: 16, padding: 14, backgroundColor: "#0B1220", borderWidth: 1, borderColor: BORDER }}>
            <Text style={{ color: "#fff", fontWeight: "900", fontSize: 16 }}>
              {pendingTrade?.rail === "pi"
                ? pendingTrade?.side === "buy"
                  ? "Confirm Payment"
                  : "Confirm Locked Sell"
                : "Confirm Trade"}
            </Text>
            <Text style={{ marginTop: 8, color: MUTED, fontSize: 12 }}>
              Side: {(pendingTrade?.side || side).toUpperCase()}
            </Text>
            <Text style={{ marginTop: 4, color: MUTED, fontSize: 12 }}>
              {pendingTrade?.side === "buy"
                ? `Amount: $${formatTradeUsdcAmount(pendingTrade?.amount_usdc)} USDC`
                : `Quantity: ${Number(pendingTrade?.quantity || 0).toFixed(6)} ${symbol}`}
            </Text>
            {confirmQuote ? (
              <Text style={{ marginTop: 6, color: "#E2E8F0", fontSize: 12 }}>
                Est. price ${Number(confirmQuote.price_execution_usdc || 0).toFixed(6)} | Fee ${Number(confirmQuote.fee_usdc || 0).toFixed(6)}
              </Text>
            ) : null}
            {pendingTrade?.rail === "pi" ? (
              <>
                <Text style={{ marginTop: 6, color: "#BFDBFE", fontSize: 12 }}>
                  {pendingTrade?.side === "buy"
                    ? `${Number(confirmQuote?.gross_pi || 0).toFixed(8)} payment units will be authorized after payment confirmation.`
                    : `${Number(confirmQuote?.net_pi || 0).toFixed(8)} payment units are locked at this sell price and will pay out from the queue budget.`}
                </Text>
                <Text style={{ marginTop: 6, color: MUTED, fontSize: 12 }}>
                  {pendingTrade?.side === "buy"
                    ? isPiBrowser
                      ? "Payment approval runs before shares are added."
                      : "This opens secure checkout; shares are added after payment confirms."
                    : "Shares are held for redemption immediately after acceptance. Queue retries are idempotent."}
                </Text>
              </>
            ) : (
              <Text style={{ marginTop: 8, color: MUTED, fontSize: 12 }}>
                Your wallet will ask you to approve this trade.
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
                <Text style={{ color: "#ECFEFF", fontWeight: "900" }}>{submitting ? "Submitting" : "Confirm"}</Text>
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
                <Text style={{ color: "#ECFEFF", fontWeight: "900" }}>View Receipt</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </StockScreen>
  );
}


