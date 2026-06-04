import { bad, methodNotAllowed, ok, unauth } from "../_shared/market/http.ts";
import { supabaseAdminClient, supabaseUserClient } from "../_shared/market/supabase.ts";
import { resolveRpcUrlForChain } from "../_shared/market/chainRpc.ts";
import { isLaunchGuardActive, isTradingPaused, parseSide, resolveStockIdentity, toNum } from "../_shared/market/stock.ts";
import {
  buildOnchainEvmQuote,
  isAddress,
  isSupportedEvmStockChain,
  norm,
  readErc20Balance,
  readPoolSnapshot,
  readRouterTradeState,
  round8,
  storeKeyForStoreId,
} from "../_shared/market/stockEvm.ts";

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
  const amountUsdc = toNum(body?.amount_usdc, 0);
  const quantity = toNum(body?.quantity, 0);
  const maxSlippageBps = toNum(body?.max_slippage_bps, 1200);

  if (!side) return bad("side must be buy or sell");
  const identity = await resolveStockIdentity(admin as any, { stockId, slug });
  if (!identity) return bad("Stock identity not found");
  if (identity.chain === "pi_testnet") {
    return bad("This is a Pi-native stock. Use the Pi stock market flow.");
  }
  if (!isSupportedEvmStockChain(identity.chain)) {
    return bad("EVM stock quotes are restricted to ethereum, base, arbitrum, optimism, and polygon mainnet.");
  }
  if (isTradingPaused(identity)) return bad("Trading is paused for this stock");

  const { data: chainConfig, error: chainErr } = await admin
    .from("market_chain_config")
    .select("chain,chain_id,rpc_url,confirmations_required,identity_factory,identity_router,identity_name_registry,identity_stable_address,usdc_address")
    .eq("chain", identity.chain)
    .eq("active", true)
    .maybeSingle();
  if (chainErr) return bad(chainErr.message);
  if (!chainConfig) return bad(`Chain config missing for ${identity.chain}`);
  const rpcUrl = resolveRpcUrlForChain(identity.chain, chainConfig.rpc_url);
  if (!rpcUrl) return bad(`rpc_url missing for ${identity.chain}`);

  const stableAddress = String(chainConfig.identity_stable_address || chainConfig.usdc_address || "").trim();
  const routerAddress = String(chainConfig.identity_router || "").trim();
  const tokenAddress = String(identity.token_address || "").trim();
  const poolAddress = String(identity.pool_address || "").trim();
  if (!isAddress(stableAddress)) return bad(`identity_stable_address missing for ${identity.chain}`);
  if (!isAddress(routerAddress)) return bad(`identity_router missing for ${identity.chain}`);
  if (!isAddress(tokenAddress)) return bad("Stock token address is missing");
  if (!isAddress(poolAddress)) return bad("Stock pool address is missing");

  const { data: wallet, error: walletErr } = await admin
    .from("crypto_wallets")
    .select("id,address,chain")
    .eq("user_id", user.id)
    .eq("chain", identity.chain)
    .maybeSingle();
  if (walletErr) return bad(walletErr.message);
  if (!wallet?.address) return bad(`No wallet found for ${identity.chain}`);
  if (!isAddress(String(wallet.address))) return bad(`Saved wallet is invalid for ${identity.chain}`);

  const cutoff = new Date(Date.now() - 10 * 1000).toISOString();
  const { count: recentCount, error: recentErr } = await admin
    .from("market_stock_orders")
    .select("id", { count: "exact", head: true })
    .eq("stock_id", identity.id)
    .eq("user_id", user.id)
    .gte("created_at", cutoff);
  if (recentErr) return bad(recentErr.message);
  if ((recentCount ?? 0) > 0) return bad("Cooldown active. Please wait before placing another order");

  try {
    const [poolSnapshot, routerState, tokenBalance] = await Promise.all([
      readPoolSnapshot({
        rpcUrl,
        poolAddress,
        stableToken: stableAddress,
        identityToken: tokenAddress,
      }),
      readRouterTradeState({
        rpcUrl,
        routerAddress,
        storeKey: storeKeyForStoreId(identity.store_id),
      }),
      side === "sell"
        ? readErc20Balance({
          rpcUrl,
          tokenAddress,
          owner: String(wallet.address),
          decimals: 18,
        })
        : Promise.resolve({ raw: 0n, value: 0 }),
    ]);

    if (!routerState.enabled) return bad("Trading is not enabled for this stock yet.");
    if (routerState.pool && norm(routerState.pool) !== norm(poolAddress)) {
      return bad("Pool address mismatch for this stock. Re-sync the stock identity.");
    }
    if (routerState.stable_token && norm(routerState.stable_token) !== norm(stableAddress)) {
      return bad("Stable token mismatch for this stock. Re-sync the stock identity.");
    }
    if (routerState.identity_token && norm(routerState.identity_token) !== norm(tokenAddress)) {
      return bad("Identity token mismatch for this stock. Re-sync the stock identity.");
    }

    const launchGuardActive = routerState.bootstrap_active || isLaunchGuardActive(identity);
    const effectiveMaxTradeBps = Math.max(0, Number(routerState.effective_max_trade_bps || 0));
    const maxTradeUsdc = effectiveMaxTradeBps > 0
      ? round8((poolSnapshot.stable_reserve_usdc * effectiveMaxTradeBps) / 10_000)
      : round8(poolSnapshot.stable_reserve_usdc);
    const maxTradeTokenQty = effectiveMaxTradeBps > 0
      ? round8((poolSnapshot.token_reserve_qty * effectiveMaxTradeBps) / 10_000)
      : round8(poolSnapshot.token_reserve_qty);

    if (side === "sell") {
      if (quantity <= 0) return bad("quantity must be > 0 for sell");
      if (tokenBalance.value < quantity) {
        return bad(`Insufficient on-chain balance. You have ${tokenBalance.value.toFixed(6)} ${identity.symbol}`);
      }
    }

    const quote = buildOnchainEvmQuote({
      side,
      spotPriceUsdc: poolSnapshot.spot_price_usdc,
      stableReserveUsdc: poolSnapshot.stable_reserve_usdc,
      tokenReserveQty: poolSnapshot.token_reserve_qty,
      amountUsdc,
      quantity,
      maxTradeUsdc,
      maxTradeTokenQty,
      cooldownSeconds: routerState.cooldown_seconds,
      launchGuardActive,
    });

    if (quote.slippage_bps > maxSlippageBps) {
      return bad(`Slippage too high (${quote.slippage_bps.toFixed(2)} bps > ${maxSlippageBps} bps)`);
    }

    return ok({
      ok: true,
      identity: {
        id: identity.id,
        store_id: identity.store_id,
        slug: identity.slug,
        name: identity.name,
        symbol: identity.symbol,
        chain: identity.chain,
        chain_id: identity.chain_id,
        token_address: identity.token_address,
        pool_address: identity.pool_address,
      },
      wallet: {
        address: wallet.address,
        chain: wallet.chain,
      },
      chain_config: chainConfig,
      quote,
      guardrails: {
        max_slippage_bps: maxSlippageBps,
        cooldown_seconds: quote.cooldown_seconds,
        max_trade_usdc: quote.max_trade_usdc,
        max_trade_token_qty: quote.max_trade_token_qty,
        launch_guard_active: quote.launch_guard_active,
        liquidity_guard_bps: routerState.liquidity_guard_bps,
        bootstrap_max_trade_bps: routerState.max_trade_bps,
        effective_max_trade_bps: effectiveMaxTradeBps,
      },
      onchain: {
        spot_price_usdc: poolSnapshot.spot_price_usdc,
        stable_reserve_usdc: poolSnapshot.stable_reserve_usdc,
        token_reserve_qty: poolSnapshot.token_reserve_qty,
        wallet_token_balance: side === "sell" ? round8(tokenBalance.value) : null,
      },
    });
  } catch (e: any) {
    return bad(String(e?.message ?? e));
  }
});
