import { bad, methodNotAllowed, ok, unauth } from "../_shared/market/http.ts";
import { supabaseAdminClient, supabaseUserClient } from "../_shared/market/supabase.ts";
import { keccak_256 } from "https://esm.sh/@noble/hashes@1.3.3/sha3";
import {
  bucketStartIso,
  isTradingPaused,
  parseSide,
  resolveStockIdentity,
  toNum,
} from "../_shared/market/stock.ts";
import { resolveRpcUrlForChain } from "../_shared/market/chainRpc.ts";
import { deriveActualTradeFromSwap, isSupportedEvmStockChain, parseInt256Word, readPoolSnapshot } from "../_shared/market/stockEvm.ts";

const SWAP_EVENT_TOPIC0 = `0x${
  Array.from(keccak_256(new TextEncoder().encode("Swap(address,address,int256,int256,uint160,uint128,int24)")))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}`;

const TRANSFER_EVENT_TOPIC0 = `0x${
  Array.from(keccak_256(new TextEncoder().encode("Transfer(address,address,uint256)")))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}`;

function round8(n: number) {
  return Math.round(n * 100000000) / 100000000;
}

async function rpcCall(rpcUrl: string, method: string, params: unknown[]) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`RPC ${method} failed: ${res.status}`);
  if (json?.error) throw new Error(String(json.error?.message || `RPC ${method} error`));
  return json?.result;
}

function isHexTxHash(v: string) {
  return /^0x[a-fA-F0-9]{64}$/.test(v);
}

function isAddress(v: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(v || ""));
}

function norm(v: string) {
  return String(v || "").toLowerCase();
}

function topicAddress(addr: string) {
  return `0x${String(addr || "").replace(/^0x/i, "").toLowerCase().padStart(64, "0")}`;
}

async function resolveUserOpSender(rpcUrl: string, userOpHash: string) {
  if (!isHexTxHash(userOpHash)) return null;
  for (const method of ["eth_getUserOperationReceipt", "alchemy_getUserOperationReceipt"]) {
    try {
      const out: any = await rpcCall(rpcUrl, method, [userOpHash]);
      const sender = String(
        out?.sender ?? out?.userOp?.sender ?? out?.userOperation?.sender ?? out?.user_operation?.sender ?? "",
      );
      if (isAddress(sender)) return sender;
    } catch {
      // try next method
    }
  }
  return null;
}

async function resolveBlockTimeIso(rpcUrl: string, blockNumberHex: string) {
  if (!blockNumberHex) return new Date().toISOString();
  try {
    const block: any = await rpcCall(rpcUrl, "eth_getBlockByNumber", [blockNumberHex, false]);
    const tsHex = String(block?.timestamp || "0x0");
    const ts = Number.parseInt(tsHex, 16);
    if (Number.isFinite(ts) && ts > 0) {
      return new Date(ts * 1000).toISOString();
    }
  } catch {
    // ignore timestamp lookup failures and fall back to current time
  }
  return new Date().toISOString();
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  const userClient = supabaseUserClient(req);
  const admin = supabaseAdminClient();
  const { data: auth, error: authErr } = await userClient.auth.getUser();
  const user = auth?.user;
  if (authErr || !user) return unauth();

  const body = await req.json().catch(() => ({}));
  const stockId = String(body?.stock_id ?? body?.identity_id ?? "").trim();
  const slug = String(body?.slug ?? "").trim().toLowerCase();
  const side = parseSide(body?.side);
  const maxSlippageBps = toNum(body?.max_slippage_bps, 1200);
  const executionMode = String(body?.execution_mode ?? "onchain").trim().toLowerCase();
  const txHash = String(body?.tx_hash ?? "").trim();
  const userOpHash = String(body?.user_op_hash ?? "").trim();
  const quoteSnapshot = body?.quote_snapshot ?? null;

  if (!side) return bad("side must be buy or sell");
  if (executionMode && executionMode !== "onchain") {
    return bad("Only onchain execution is allowed");
  }
  if (!isHexTxHash(txHash)) return bad("tx_hash is required for onchain execution");
  const identity = await resolveStockIdentity(admin as any, { stockId, slug });
  if (!identity) return bad("Stock identity not found");
  if (identity.chain === "pi_testnet") {
    return bad("This is a Pi-native stock. Use the Pi stock market flow.");
  }
  if (!isSupportedEvmStockChain(identity.chain)) {
    return bad("EVM stock trading is restricted to supported market networks.");
  }
  if (!isAddress(String(identity.pool_address || ""))) return bad("Stock pool address is missing");
  if (!isAddress(String(identity.token_address || ""))) return bad("Stock token address is missing");
  if (isTradingPaused(identity)) return bad("Trading is paused for this stock");

  const { data: walletRows, error: walletErr } = await admin
    .from("crypto_wallets")
    .select("address,chain,created_at")
    .eq("user_id", user.id)
    .eq("chain", identity.chain)
    .order("created_at", { ascending: true });
  if (walletErr) return bad(walletErr.message);
  const walletAddresses = (walletRows ?? [])
    .map((row: any) => String(row?.address ?? "").trim())
    .filter((addr) => isAddress(addr));
  if (walletAddresses.length <= 0) return bad(`No wallet found for ${identity.chain}`);
  const walletAddressSet = new Set(walletAddresses.map((addr) => norm(addr)));
  const walletTopicSet = new Set(walletAddresses.map((addr) => norm(topicAddress(addr))));
  const wallet = {
    address: walletAddresses[0],
    chain: String((walletRows?.[0] as any)?.chain || identity.chain),
  };

  const cutoff = new Date(Date.now() - 10 * 1000).toISOString();
  const { count: recentCount, error: recentErr } = await admin
    .from("market_stock_orders")
    .select("id", { count: "exact", head: true })
    .eq("stock_id", identity.id)
    .eq("user_id", user.id)
    .gte("created_at", cutoff);
  if (recentErr) return bad(recentErr.message);
  if ((recentCount ?? 0) > 0) return bad("Cooldown active. Wait a few seconds before placing another order");

  const { data: existingTrade, error: existingErr } = await admin
    .from("market_stock_trades")
    .select("id,stock_id,user_id,side,price_usdc,quantity,notional_usdc,fee_usdc,chain_tx_hash,traded_at,created_at")
    .eq("stock_id", identity.id)
    .eq("chain_tx_hash", txHash)
    .maybeSingle();
  if (existingErr) return bad(existingErr.message);
  if (existingTrade) {
    return ok({
      ok: true,
      order_id: null,
      trade: existingTrade,
      quote: quoteSnapshot ?? null,
      identity: {
        id: identity.id,
        slug: identity.slug,
        name: identity.name,
        symbol: identity.symbol,
        chain: identity.chain,
      },
      wallet: {
        address: wallet.address,
        chain: wallet.chain,
      },
      execution: {
        mode: "onchain",
        tx_hash: txHash,
        user_op_hash: userOpHash || null,
        indexed_existing: true,
      },
    });
  }

  const { data: cfg, error: cfgErr } = await admin
    .from("market_chain_config")
    .select("rpc_url,confirmations_required,active,identity_stable_address,usdc_address")
    .eq("chain", identity.chain)
    .eq("active", true)
    .maybeSingle();
  if (cfgErr) return bad(cfgErr.message);
  if (!cfg) return bad(`Chain config missing for ${identity.chain}`);
  const rpcUrl = resolveRpcUrlForChain(identity.chain, cfg?.rpc_url);
  if (!rpcUrl) return bad(`rpc_url missing for ${identity.chain}`);
  const stableAddress = String(cfg.identity_stable_address || cfg.usdc_address || "").trim();
  if (!isAddress(stableAddress)) return bad(`identity_stable_address missing for ${identity.chain}`);

  const receipt: any = await rpcCall(rpcUrl, "eth_getTransactionReceipt", [txHash]);
  if (!receipt) return bad("Transaction receipt not found on chain yet");
  if (String(receipt.status || "").toLowerCase() !== "0x1") return bad("On-chain trade transaction failed");

  const latestBlockHex = await rpcCall(rpcUrl, "eth_blockNumber", []);
  const latestBlock = Number.parseInt(String(latestBlockHex || "0x0"), 16);
  const txBlock = Number.parseInt(String(receipt.blockNumber || "0x0"), 16);
  const confirmations = Number.isFinite(latestBlock) && Number.isFinite(txBlock) ? (latestBlock - txBlock + 1) : 1;
  const required = Math.max(1, Number(cfg.confirmations_required ?? 1));
  if (confirmations < required) {
    return bad(`Awaiting confirmations (${confirmations}/${required})`);
  }

  const logs = Array.isArray(receipt.logs) ? receipt.logs : [];
  const poolNorm = norm(String(identity.pool_address));
  const tokenNorm = norm(String(identity.token_address));
  const stableNorm = norm(stableAddress);
  const poolSwapLog = logs.find((log: any) =>
    norm(String(log?.address || "")) === poolNorm &&
    norm(String(log?.topics?.[0] || "")) === norm(SWAP_EVENT_TOPIC0)
  );
  if (!poolSwapLog) return bad("Transaction does not contain a swap for this stock pool");

  const transferLogs = logs.filter((log: any) => norm(String(log?.topics?.[0] || "")) === norm(TRANSFER_EVENT_TOPIC0));
  const hasWalletTransferOnKnownAssets = transferLogs.some((log: any) => {
    const logAddress = norm(String(log?.address || ""));
    if (logAddress !== tokenNorm && logAddress !== stableNorm) return false;
    const fromTopic = norm(String(log?.topics?.[1] || ""));
    const toTopic = norm(String(log?.topics?.[2] || ""));
    return walletTopicSet.has(fromTopic) || walletTopicSet.has(toTopic);
  });
  // Fallback for pools/tokens that route through wrapper contracts where token/stable address can drift.
  const hasWalletTransferAnyAsset = transferLogs.some((log: any) => {
    const fromTopic = norm(String(log?.topics?.[1] || ""));
    const toTopic = norm(String(log?.topics?.[2] || ""));
    return walletTopicSet.has(fromTopic) || walletTopicSet.has(toTopic);
  });
  const hasWalletTransferLog = hasWalletTransferOnKnownAssets || hasWalletTransferAnyAsset;

  const tx: any = await rpcCall(rpcUrl, "eth_getTransactionByHash", [txHash]).catch(() => null);
  const txFrom = isAddress(String(tx?.from || "")) ? String(tx.from) : null;
  const txFromMatchesUser = txFrom ? walletAddressSet.has(norm(txFrom)) : false;

  let opSenderMatchesUser = false;
  if (!txFromMatchesUser && isHexTxHash(userOpHash)) {
    const opSender = await resolveUserOpSender(rpcUrl, userOpHash);
    if (!opSender) return bad("Could not verify smart account sender from user_op_hash");
    opSenderMatchesUser = walletAddressSet.has(norm(opSender));
    if (!opSenderMatchesUser) {
      return bad("On-chain sender does not match your wallet");
    }
  } else if (!txFromMatchesUser && txFrom && !hasWalletTransferLog) {
    return bad("user_op_hash is required to verify smart account trade sender");
  }

  if (!hasWalletTransferLog && !txFromMatchesUser && !opSenderMatchesUser) {
    return bad("Transaction is not tied to this wallet's stock trade");
  }

  let actualTrade: { price_execution_usdc: number; quantity: number; notional_usdc: number };
  let latestPoolSnapshot: Awaited<ReturnType<typeof readPoolSnapshot>> | null = null;
  try {
    latestPoolSnapshot = await readPoolSnapshot({
      rpcUrl,
      poolAddress: String(identity.pool_address),
      stableToken: stableAddress,
      identityToken: String(identity.token_address),
    });
    const swapData = String((poolSwapLog as any)?.data || "").replace(/^0x/i, "");
    actualTrade = deriveActualTradeFromSwap({
      side,
      amount0: parseInt256Word(swapData.slice(0, 64)),
      amount1: parseInt256Word(swapData.slice(64, 128)),
      token0: latestPoolSnapshot.token0,
      stableToken: stableAddress,
      identityToken: String(identity.token_address),
    });
  } catch (e: any) {
    return bad(String(e?.message || e || "Could not decode executed trade from on-chain swap log"));
  }

  const actualQuote = {
    side,
    price_spot_usdc: toNum(latestPoolSnapshot?.spot_price_usdc, toNum((quoteSnapshot as any)?.price_spot_usdc, actualTrade.price_execution_usdc)),
    price_execution_usdc: actualTrade.price_execution_usdc,
    quantity: actualTrade.quantity,
    notional_usdc: actualTrade.notional_usdc,
    fee_usdc: 0,
    price_impact_bps: toNum((quoteSnapshot as any)?.price_impact_bps, 0),
    slippage_bps: toNum((quoteSnapshot as any)?.slippage_bps, 0),
    max_trade_usdc: toNum((quoteSnapshot as any)?.max_trade_usdc, 0),
    cooldown_seconds: toNum((quoteSnapshot as any)?.cooldown_seconds, 0),
    liquidity_usdc: toNum((quoteSnapshot as any)?.liquidity_usdc, 0),
    launch_guard_active: Boolean((quoteSnapshot as any)?.launch_guard_active),
  };

  const { data: order, error: orderErr } = await admin
    .from("market_stock_orders")
    .insert({
      stock_id: identity.id,
      user_id: user.id,
      side,
      quote_price_usdc: round8(actualTrade.price_execution_usdc),
      amount_usdc: side === "buy" ? round8(actualTrade.notional_usdc) : null,
      quantity: side === "sell" ? round8(actualTrade.quantity) : null,
      slippage_bps: Math.round(maxSlippageBps),
      max_price_impact_bps: Math.round(actualQuote.price_impact_bps),
      status: "submitted",
      submitted_tx_hash: txHash,
    })
    .select("*")
    .single();
  if (orderErr || !order) return bad(orderErr?.message ?? "Failed to create order");

  try {
    const nowIso = await resolveBlockTimeIso(rpcUrl, String(receipt.blockNumber || ""));
    const chainBlock = Number.parseInt(String(receipt.blockNumber || "0x0"), 16);
    const chainLogIndex = Number.parseInt(String((poolSwapLog as any)?.logIndex || (poolSwapLog as any)?.index || "0x0"), 16);
    const { data: trade, error: tradeErr } = await admin
      .from("market_stock_trades")
      .insert({
        stock_id: identity.id,
        user_id: user.id,
        side,
        price_usdc: round8(actualTrade.price_execution_usdc),
        quantity: round8(actualTrade.quantity),
        notional_usdc: round8(actualTrade.notional_usdc),
        fee_usdc: 0,
        chain_tx_hash: txHash,
        chain_block: Number.isFinite(chainBlock) ? chainBlock : null,
        chain_log_index: Number.isFinite(chainLogIndex) ? chainLogIndex : null,
        traded_at: nowIso,
      })
      .select("*")
      .single();
    if (tradeErr || !trade) throw new Error(tradeErr?.message ?? "Failed to write trade");

    const bucketStart = bucketStartIso(nowIso, "1m");
    const { data: candle, error: candleErr } = await admin
      .from("market_stock_candles_1m")
      .select("stock_id,bucket_start,open_price_usdc,high_price_usdc,low_price_usdc,close_price_usdc,volume_qty,volume_usdc,trades_count")
      .eq("stock_id", identity.id)
      .eq("bucket_start", bucketStart)
      .maybeSingle();
    if (candleErr) throw new Error(candleErr.message);

    if (!candle) {
      const { error: insCandleErr } = await admin
        .from("market_stock_candles_1m")
        .insert({
          stock_id: identity.id,
          bucket_start: bucketStart,
          open_price_usdc: round8(actualTrade.price_execution_usdc),
          high_price_usdc: round8(actualTrade.price_execution_usdc),
          low_price_usdc: round8(actualTrade.price_execution_usdc),
          close_price_usdc: round8(actualTrade.price_execution_usdc),
          volume_qty: round8(actualTrade.quantity),
          volume_usdc: round8(actualTrade.notional_usdc),
          trades_count: 1,
        });
      if (insCandleErr) throw new Error(insCandleErr.message);
    } else {
      const { error: updCandleErr } = await admin
        .from("market_stock_candles_1m")
        .update({
          high_price_usdc: Math.max(toNum(candle.high_price_usdc, 0), actualTrade.price_execution_usdc),
          low_price_usdc: Math.min(toNum(candle.low_price_usdc, actualTrade.price_execution_usdc), actualTrade.price_execution_usdc),
          close_price_usdc: round8(actualTrade.price_execution_usdc),
          volume_qty: round8(toNum(candle.volume_qty, 0) + actualTrade.quantity),
          volume_usdc: round8(toNum(candle.volume_usdc, 0) + actualTrade.notional_usdc),
          trades_count: Number(candle.trades_count ?? 0) + 1,
          updated_at: nowIso,
        })
        .eq("stock_id", identity.id)
        .eq("bucket_start", bucketStart);
      if (updCandleErr) throw new Error(updCandleErr.message);
    }

    const liveSpotPriceUsdc = toNum(latestPoolSnapshot?.spot_price_usdc, actualTrade.price_execution_usdc);
    const marketCap = liveSpotPriceUsdc * toNum(identity.total_supply, 100_000_000);
    const { error: pointErr } = await admin
      .from("market_stock_price_points")
      .upsert({
        stock_id: identity.id,
        last_price_usdc: round8(liveSpotPriceUsdc),
        market_cap_usdc: round8(marketCap),
        updated_at: nowIso,
      });
    if (pointErr) throw new Error(pointErr.message);

    const { data: currentPos, error: posErr } = await admin
      .from("market_stock_positions")
      .select("stock_id,user_id,balance_qty,avg_cost_usdc,realized_pnl_usdc")
      .eq("stock_id", identity.id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (posErr) throw new Error(posErr.message);

    const oldBalance = toNum(currentPos?.balance_qty, 0);
    const oldAvg = toNum(currentPos?.avg_cost_usdc, 0);
    const oldRealized = toNum(currentPos?.realized_pnl_usdc, 0);

    let nextBalance = oldBalance;
    let nextAvg = oldAvg;
    let nextRealized = oldRealized;
    if (side === "buy") {
      nextBalance = oldBalance + actualTrade.quantity;
      nextAvg = nextBalance <= 0
        ? 0
        : oldBalance <= 0
        ? actualTrade.price_execution_usdc
        : ((oldBalance * oldAvg) + (actualTrade.quantity * actualTrade.price_execution_usdc)) / nextBalance;
    } else {
      const trackedSellQty = Math.min(oldBalance, actualTrade.quantity);
      nextBalance = Math.max(0, oldBalance - actualTrade.quantity);
      nextAvg = nextBalance <= 0 ? 0 : oldAvg;
      nextRealized = oldRealized + ((actualTrade.price_execution_usdc - oldAvg) * trackedSellQty);
    }

    const { error: upsertPosErr } = await admin
      .from("market_stock_positions")
      .upsert({
        stock_id: identity.id,
        user_id: user.id,
        balance_qty: round8(nextBalance),
        avg_cost_usdc: round8(nextAvg),
        realized_pnl_usdc: round8(nextRealized),
        updated_at: nowIso,
      });
    if (upsertPosErr) throw new Error(upsertPosErr.message);

    const { error: finalOrderErr } = await admin
      .from("market_stock_orders")
      .update({
        status: "filled",
        filled_trade_id: trade.id,
        updated_at: nowIso,
      })
      .eq("id", order.id);
    if (finalOrderErr) throw new Error(finalOrderErr.message);

    return ok({
      ok: true,
      order_id: order.id,
      trade,
      quote: actualQuote,
      identity: {
        id: identity.id,
        slug: identity.slug,
        name: identity.name,
        symbol: identity.symbol,
        chain: identity.chain,
      },
      wallet: {
        address: wallet.address,
        chain: wallet.chain,
      },
      execution: {
        mode: "onchain",
        tx_hash: txHash,
        user_op_hash: userOpHash || null,
        note: "On-chain execution recorded and indexed.",
      },
    });
  } catch (e: any) {
    await admin
      .from("market_stock_orders")
      .update({
        status: "failed",
        fail_reason: String(e?.message ?? e),
        updated_at: new Date().toISOString(),
      })
      .eq("id", order.id);
    return bad(String(e?.message ?? e), { order_id: order.id });
  }
});
