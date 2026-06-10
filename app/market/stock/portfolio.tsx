import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";

import AppHeader from "@/components/common/AppHeader";
import {
  STOCK,
  StockAlert,
  StockEmptyState,
  StockLoadingState,
  StockMetric,
  StockPanel,
  StockPill,
  StockScreen,
  formatStockMoney,
  formatStockPrice,
  formatStockQuantity,
  stockChainLabel,
} from "@/components/market/stock/StockUi";
import { InAppTutorial, TutorialTarget } from "@/components/onboarding/InAppTutorial";
import { fetchMyStockPortfolio } from "@/services/market/stocks";
import { tutorialFlows } from "@/services/onboarding/definitions";
import { friendlyMarketError } from "@/utils/marketUx";

export default function StockPortfolioScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState<any[]>([]);

  async function load() {
    setErr(null);
    try {
      const res = await fetchMyStockPortfolio();
      setRows(res.positions ?? []);
      setTotal(Number(res.total_value_usdc ?? 0));
    } catch (e: any) {
      setRows([]);
      setTotal(0);
      setErr(friendlyMarketError(e, "Unable to load your stock portfolio."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const summary = useMemo(() => {
    const invested = rows.reduce((sum, row) => sum + Number(row.balance_qty ?? 0) * Number(row.avg_cost_usdc ?? 0), 0);
    const pnl = rows.reduce((sum, row) => sum + Number(row.unrealized_pnl_usdc ?? 0), 0);
    const locked = rows.reduce((sum, row) => sum + Number(row.locked_redemption_qty ?? 0), 0);
    const winners = rows.filter((row) => Number(row.unrealized_pnl_usdc ?? 0) >= 0).length;
    return { invested, pnl, locked, winners };
  }, [rows]);

  return (
    <StockScreen>
      <InAppTutorial enabled={!loading} flow={tutorialFlows.stockPortfolio} />
      <AppHeader title="Stock Portfolio" subtitle="Positions, cost basis, and trade-ready holdings." />
      <ScrollView
        contentContainerStyle={{ paddingBottom: 28 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      >
        <TutorialTarget id="stock.portfolio.total">
          <StockPanel style={{ marginTop: 10 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <StockPill label={`${rows.length} Positions`} tone="cyan" icon="layers-outline" compact />
                <Text style={{ marginTop: 12, color: STOCK.ink, fontWeight: "900", fontSize: 32 }}>
                  {formatStockMoney(total)}
                </Text>
                <Text style={{ marginTop: 4, color: STOCK.muted, fontWeight: "800" }}>Current portfolio value</Text>
              </View>
              <View
                style={{
                  width: 58,
                  height: 58,
                  borderRadius: 22,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "rgba(52,211,153,0.14)",
                  borderWidth: 1,
                  borderColor: "rgba(52,211,153,0.38)",
                }}
              >
                <Ionicons name="pie-chart" size={25} color={STOCK.mint} />
              </View>
            </View>

            <View style={{ marginTop: 16, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              <StockMetric label="Unrealized P/L" value={formatStockMoney(summary.pnl)} tone={summary.pnl >= 0 ? "mint" : "red"} />
              <StockMetric label="Cost Basis" value={formatStockMoney(summary.invested)} />
              <StockMetric label="Locked" value={formatStockQuantity(summary.locked, 2)} tone="amber" />
            </View>
          </StockPanel>
        </TutorialTarget>

        {loading ? <StockLoadingState label="Loading portfolio" /> : null}

        {!!err ? <StockAlert>{err}</StockAlert> : null}

        {!loading && !err && rows.length === 0 ? (
          <View style={{ marginTop: 14 }}>
            <StockEmptyState
              icon="wallet-outline"
              title="No stock positions"
              message="Buy a listed stock to add it to your portfolio."
              actionLabel="Browse Market"
              onAction={() => router.push("/market/stock" as any)}
            />
          </View>
        ) : null}

        {!loading && rows.length > 0 ? (
          <View style={{ marginTop: 12, flexDirection: "row", gap: 10 }}>
            <StockMetric label="Profitable" value={`${summary.winners}/${rows.length}`} tone="mint" />
            <StockMetric label="Allocation" value={total > 0 ? "Live" : "Flat"} tone="cyan" />
          </View>
        ) : null}

        <TutorialTarget id="stock.portfolio.positions">
          <View style={{ marginTop: 12, gap: 11 }}>
          {rows.map((row: any, index: number) => {
            const stock = row.identity;
            const symbol = String(stock?.symbol || "");
            const name = String(stock?.name || "Stock");
            const slug = String(stock?.slug || "");
            const qty = Number(row.balance_qty ?? 0);
            const avg = Number(row.avg_cost_usdc ?? 0);
            const locked = Number(row.locked_redemption_qty ?? 0);
            const price = Number(row.price_now_usdc ?? 0);
            const value = Number(row.value_usdc ?? 0);
            const pnl = Number(row.unrealized_pnl_usdc ?? 0);
            const allocation = total > 0 ? (value / total) * 100 : 0;

            const rowCard = (
              <Pressable
                onPress={() => slug && router.push(`/market/stock/${slug}` as any)}
                style={{ opacity: slug ? 1 : 0.72 }}
              >
                <StockPanel>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ color: STOCK.ink, fontWeight: "900", fontSize: 16 }} numberOfLines={1}>
                        {name}
                      </Text>
                      <View style={{ marginTop: 6, flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                        <StockPill label={symbol || "STOCK"} tone="cyan" compact />
                        <StockPill label={stockChainLabel(stock?.chain)} compact />
                        {locked > 0 ? <StockPill label="Redemption Lock" tone="amber" compact /> : null}
                      </View>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={{ color: STOCK.ink, fontWeight: "900", fontSize: 18 }}>{formatStockMoney(value)}</Text>
                      <StockPill label={formatStockMoney(pnl)} tone={pnl >= 0 ? "mint" : "red"} compact />
                    </View>
                  </View>

                  <View style={{ marginTop: 13, flexDirection: "row", flexWrap: "wrap", gap: 9 }}>
                    <StockMetric label="Quantity" value={formatStockQuantity(qty, 4)} />
                    <StockMetric label="Average" value={formatStockPrice(avg, 6)} />
                    <StockMetric label="Current" value={formatStockPrice(price, 6)} />
                  </View>

                  <View style={{ marginTop: 12, flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <View style={{ flex: 1, height: 8, borderRadius: 999, backgroundColor: STOCK.panelSoft, overflow: "hidden" }}>
                      <View
                        style={{
                          width: `${Math.max(4, Math.min(100, allocation))}%`,
                          height: 8,
                          borderRadius: 999,
                          backgroundColor: pnl >= 0 ? STOCK.mint : STOCK.red,
                        }}
                      />
                    </View>
                    <Text style={{ color: STOCK.muted, fontSize: 11, fontWeight: "800" }}>{allocation.toFixed(1)}%</Text>
                    <Ionicons name="chevron-forward" size={17} color={STOCK.muted} />
                  </View>
                </StockPanel>
              </Pressable>
            );
            return index === 0 ? (
              <TutorialTarget key={`${row.stock_id}-${row.user_id}`} id="stock.portfolio.marketEntry">
                {rowCard}
              </TutorialTarget>
            ) : (
              <React.Fragment key={`${row.stock_id}-${row.user_id}`}>{rowCard}</React.Fragment>
            );
          })}
          </View>
        </TutorialTarget>
      </ScrollView>
    </StockScreen>
  );
}
