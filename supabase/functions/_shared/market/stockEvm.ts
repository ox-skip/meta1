import { keccak_256 } from "https://esm.sh/@noble/hashes@1.3.3/sha3";

export const SUPPORTED_EVM_STOCK_CHAINS = ["ethereum", "base", "arbitrum", "optimism", "polygon", "bnb"] as const;

const SUPPORTED_EVM_STOCK_CHAIN_SET = new Set<string>(SUPPORTED_EVM_STOCK_CHAINS);
const Q192 = 1n << 192n;
const PRICE_SCALE = 100_000_000n;
const STABLE_DECIMALS = 6;
const TOKEN_DECIMALS = 18;

const TOKEN0_SELECTOR = selector4("token0()");
const TOKEN1_SELECTOR = selector4("token1()");
const SLOT0_SELECTOR = selector4("slot0()");
const BALANCE_OF_SELECTOR = selector4("balanceOf(address)");
const TOTAL_SUPPLY_SELECTOR = selector4("totalSupply()");
const BOOTSTRAP_SELECTOR = selector4("bootstrap(bytes32)");
const TRADE_CONFIGS_SELECTOR = selector4("tradeConfigs(bytes32)");
const LIQUIDITY_GUARD_SELECTOR = selector4("liquidityGuardBps()");
const CREATION_LIQUIDITY_SELECTOR = selector4("creationLiquidityAmount()");
const CREATION_RESERVE_SELECTOR = selector4("creationReserveAmount()");

export type EvmPoolSnapshot = {
  token0: string;
  token1: string;
  spot_price_usdc: number;
  stable_reserve_usdc: number;
  token_reserve_qty: number;
  sqrt_price_x96: bigint;
};

export type EvmRouterTradeState = {
  enabled: boolean;
  pool: string | null;
  stable_token: string | null;
  identity_token: string | null;
  liquidity_guard_bps: number;
  max_trade_bps: number;
  effective_max_trade_bps: number;
  cooldown_seconds: number;
  bootstrap_end_time: number;
  bootstrap_active: boolean;
};

export type OnchainEvmQuote = {
  side: "buy" | "sell";
  price_spot_usdc: number;
  price_execution_usdc: number;
  quantity: number;
  notional_usdc: number;
  fee_usdc: number;
  price_impact_bps: number;
  slippage_bps: number;
  max_trade_usdc: number;
  cooldown_seconds: number;
  liquidity_usdc: number;
  launch_guard_active: boolean;
  max_trade_token_qty: number;
};

export function isSupportedEvmStockChain(chain: string | null | undefined) {
  return SUPPORTED_EVM_STOCK_CHAIN_SET.has(String(chain || "").trim().toLowerCase());
}

export function normalizeChain(chain: string | null | undefined) {
  return String(chain || "").trim().toLowerCase();
}

export function isAddress(value: string | null | undefined) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || "").trim());
}

export function norm(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

export function round8(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 100_000_000) / 100_000_000;
}

export function selector4(signature: string) {
  const hash = keccak_256(new TextEncoder().encode(signature));
  return `0x${Array.from(hash.slice(0, 4)).map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function pow10(exp: number) {
  let out = 1n;
  for (let i = 0; i < exp; i++) out *= 10n;
  return out;
}

function padHex64(value: string) {
  const clean = String(value || "").replace(/^0x/i, "").toLowerCase();
  return clean.padStart(64, "0");
}

function wordAt(cleanHex: string, index: number) {
  const start = index * 64;
  return cleanHex.slice(start, start + 64);
}

function parseAddressWord(wordHex: string) {
  if (wordHex.length !== 64) return null;
  const candidate = `0x${wordHex.slice(24)}`;
  return isAddress(candidate) ? candidate : null;
}

function parseUint256Word(wordHex: string) {
  if (!wordHex || wordHex.length !== 64) return 0n;
  return BigInt(`0x${wordHex}`);
}

export function parseInt256Word(wordHex: string) {
  const value = parseUint256Word(wordHex);
  if (value >> 255n) {
    return value - (1n << 256n);
  }
  return value;
}

function boolFromWord(wordHex: string) {
  return parseUint256Word(wordHex) !== 0n;
}

function encodeAddressArg(address: string) {
  return padHex64(String(address || "").replace(/^0x/i, ""));
}

function encodeBytes32Arg(value: string) {
  const clean = String(value || "").replace(/^0x/i, "").toLowerCase();
  if (clean.length !== 64) throw new Error("bytes32 argument is invalid");
  return clean;
}

function rawToNumber(raw: bigint, decimals: number) {
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const base = pow10(decimals);
  const whole = abs / base;
  const fraction = abs % base;
  const fractionText = fraction.toString().padStart(decimals, "0").slice(0, Math.min(decimals, 8)).replace(/0+$/, "");
  const text = `${negative ? "-" : ""}${whole.toString()}${fractionText ? `.${fractionText}` : ""}`;
  const out = Number(text);
  return Number.isFinite(out) ? out : 0;
}

function sqrtPriceToStablePerToken(sqrtPriceX96: bigint, token0: string, stableToken: string, identityToken: string) {
  if (sqrtPriceX96 <= 0n) return 0;
  const ratioX192 = sqrtPriceX96 * sqrtPriceX96;
  const decimalScale = pow10(Math.max(0, TOKEN_DECIMALS - STABLE_DECIMALS));
  const token0Norm = norm(token0);
  const stableNorm = norm(stableToken);
  const identityNorm = norm(identityToken);

  if (token0Norm === identityNorm) {
    const scaled = (ratioX192 * decimalScale * PRICE_SCALE) / Q192;
    return rawToNumber(scaled, 8);
  }

  if (token0Norm === stableNorm) {
    const scaled = (Q192 * decimalScale * PRICE_SCALE) / ratioX192;
    return rawToNumber(scaled, 8);
  }

  return 0;
}

export async function rpcCall(rpcUrl: string, method: string, params: unknown[]) {
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

async function ethCall(rpcUrl: string, to: string, data: string) {
  const out = await rpcCall(rpcUrl, "eth_call", [{ to, data }, "latest"]);
  return String(out || "");
}

export async function readPoolSnapshot(input: {
  rpcUrl: string;
  poolAddress: string;
  stableToken: string;
  identityToken: string;
}): Promise<EvmPoolSnapshot> {
  const { rpcUrl, poolAddress, stableToken, identityToken } = input;
  const [token0Raw, token1Raw, slot0Raw, stableBalanceRaw, tokenBalanceRaw] = await Promise.all([
    ethCall(rpcUrl, poolAddress, TOKEN0_SELECTOR),
    ethCall(rpcUrl, poolAddress, TOKEN1_SELECTOR),
    ethCall(rpcUrl, poolAddress, SLOT0_SELECTOR),
    ethCall(rpcUrl, stableToken, `${BALANCE_OF_SELECTOR}${encodeAddressArg(poolAddress)}`),
    ethCall(rpcUrl, identityToken, `${BALANCE_OF_SELECTOR}${encodeAddressArg(poolAddress)}`),
  ]);

  const token0 = parseAddressWord(padHex64(token0Raw)) || parseAddressWord(String(token0Raw).replace(/^0x/i, "").padStart(64, "0")) || "";
  const token1 = parseAddressWord(padHex64(token1Raw)) || parseAddressWord(String(token1Raw).replace(/^0x/i, "").padStart(64, "0")) || "";
  const slot0Clean = String(slot0Raw || "").replace(/^0x/i, "");
  const sqrtPriceX96 = parseUint256Word(wordAt(slot0Clean, 0));
  const spotPriceUsdc = sqrtPriceToStablePerToken(sqrtPriceX96, token0, stableToken, identityToken);

  return {
    token0,
    token1,
    spot_price_usdc: Math.max(0, spotPriceUsdc),
    stable_reserve_usdc: Math.max(0, rawToNumber(BigInt(String(stableBalanceRaw || "0x0")), STABLE_DECIMALS)),
    token_reserve_qty: Math.max(0, rawToNumber(BigInt(String(tokenBalanceRaw || "0x0")), TOKEN_DECIMALS)),
    sqrt_price_x96: sqrtPriceX96,
  };
}

export async function readErc20Balance(input: {
  rpcUrl: string;
  tokenAddress: string;
  owner: string;
  decimals: number;
}) {
  const raw = await ethCall(input.rpcUrl, input.tokenAddress, `${BALANCE_OF_SELECTOR}${encodeAddressArg(input.owner)}`);
  const rawValue = BigInt(String(raw || "0x0"));
  return {
    raw: rawValue,
    value: rawToNumber(rawValue, Math.max(0, Math.floor(input.decimals))),
  };
}

export async function readErc20TotalSupply(input: {
  rpcUrl: string;
  tokenAddress: string;
  decimals: number;
}) {
  const raw = await ethCall(input.rpcUrl, input.tokenAddress, TOTAL_SUPPLY_SELECTOR);
  const rawValue = BigInt(String(raw || "0x0"));
  return {
    raw: rawValue,
    value: rawToNumber(rawValue, Math.max(0, Math.floor(input.decimals))),
  };
}

export async function readRouterTradeState(input: {
  rpcUrl: string;
  routerAddress: string;
  storeKey: string;
}): Promise<EvmRouterTradeState> {
  const { rpcUrl, routerAddress, storeKey } = input;
  const [tradeRaw, bootstrapRaw, liquidityGuardRaw] = await Promise.all([
    ethCall(rpcUrl, routerAddress, `${TRADE_CONFIGS_SELECTOR}${encodeBytes32Arg(storeKey)}`),
    ethCall(rpcUrl, routerAddress, `${BOOTSTRAP_SELECTOR}${encodeBytes32Arg(storeKey)}`),
    ethCall(rpcUrl, routerAddress, LIQUIDITY_GUARD_SELECTOR),
  ]);

  const tradeClean = String(tradeRaw || "").replace(/^0x/i, "");
  const bootstrapClean = String(bootstrapRaw || "").replace(/^0x/i, "");
  const endTime = Number(parseUint256Word(wordAt(bootstrapClean, 2)));
  const nowSec = Math.floor(Date.now() / 1000);
  const bootstrapActive = endTime > 0 && endTime >= nowSec;
  const bootstrapMaxTradeBps = Number(parseUint256Word(wordAt(bootstrapClean, 0)));
  const liquidityGuardBps = Number(parseUint256Word(String(liquidityGuardRaw || "").replace(/^0x/i, "").padStart(64, "0")));
  let effectiveMaxTradeBps = liquidityGuardBps > 0 ? liquidityGuardBps : 0;
  if (bootstrapActive && bootstrapMaxTradeBps > 0) {
    effectiveMaxTradeBps = effectiveMaxTradeBps > 0
      ? Math.min(effectiveMaxTradeBps, bootstrapMaxTradeBps)
      : bootstrapMaxTradeBps;
  }

  return {
    enabled: boolFromWord(wordAt(tradeClean, 0)),
    pool: parseAddressWord(wordAt(tradeClean, 2)),
    stable_token: parseAddressWord(wordAt(tradeClean, 3)),
    identity_token: parseAddressWord(wordAt(tradeClean, 4)),
    liquidity_guard_bps: liquidityGuardBps,
    max_trade_bps: bootstrapMaxTradeBps,
    effective_max_trade_bps: effectiveMaxTradeBps,
    cooldown_seconds: Number(parseUint256Word(wordAt(bootstrapClean, 1))),
    bootstrap_end_time: endTime,
    bootstrap_active: bootstrapActive,
  };
}

export function buildOnchainEvmQuote(input: {
  side: "buy" | "sell";
  spotPriceUsdc: number;
  stableReserveUsdc: number;
  tokenReserveQty: number;
  amountUsdc?: number;
  quantity?: number;
  maxTradeUsdc: number;
  maxTradeTokenQty: number;
  cooldownSeconds: number;
  launchGuardActive: boolean;
}) {
  const spotPriceUsdc = Math.max(0.00000001, Number(input.spotPriceUsdc || 0));
  const stableReserveUsdc = Math.max(0, Number(input.stableReserveUsdc || 0));
  const tokenReserveQty = Math.max(0, Number(input.tokenReserveQty || 0));
  const maxTradeUsdc = Math.max(0, Number(input.maxTradeUsdc || 0));
  const maxTradeTokenQty = Math.max(0, Number(input.maxTradeTokenQty || 0));
  const cooldownSeconds = Math.max(0, Math.floor(Number(input.cooldownSeconds || 0)));
  const launchGuardActive = input.launchGuardActive === true;

  if (stableReserveUsdc <= 0 || tokenReserveQty <= 0) {
    throw new Error("Pool has no active liquidity yet. Seed initial liquidity before trading.");
  }

  if (input.side === "buy") {
    const amountUsdc = Math.max(0, Number(input.amountUsdc || 0));
    if (amountUsdc <= 0) throw new Error("amount_usdc must be > 0 for buy orders");
    if (maxTradeUsdc > 0 && amountUsdc > maxTradeUsdc) {
      throw new Error(`Order exceeds on-chain max size (${maxTradeUsdc.toFixed(6)} USDC)`);
    }

    const k = stableReserveUsdc * tokenReserveQty;
    const nextStable = stableReserveUsdc + amountUsdc;
    const nextToken = k / nextStable;
    const quantity = tokenReserveQty - nextToken;
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Pool quote returned zero output.");

    const execution = amountUsdc / quantity;
    const impactBps = Math.max(0, ((execution - spotPriceUsdc) / spotPriceUsdc) * 10_000);
    return {
      side: "buy" as const,
      price_spot_usdc: round8(spotPriceUsdc),
      price_execution_usdc: round8(execution),
      quantity: round8(quantity),
      notional_usdc: round8(amountUsdc),
      fee_usdc: 0,
      price_impact_bps: round8(impactBps),
      slippage_bps: round8(impactBps),
      max_trade_usdc: round8(maxTradeUsdc),
      cooldown_seconds: cooldownSeconds,
      liquidity_usdc: round8(stableReserveUsdc),
      launch_guard_active: launchGuardActive,
      max_trade_token_qty: round8(maxTradeTokenQty),
    } satisfies OnchainEvmQuote;
  }

  const quantity = Math.max(0, Number(input.quantity || 0));
  if (quantity <= 0) throw new Error("quantity must be > 0 for sell orders");
  if (maxTradeTokenQty > 0 && quantity > maxTradeTokenQty) {
    throw new Error(`Order exceeds on-chain max size (${maxTradeTokenQty.toFixed(6)} token)`);
  }

  const k = stableReserveUsdc * tokenReserveQty;
  const nextToken = tokenReserveQty + quantity;
  const nextStable = k / nextToken;
  const notionalUsdc = stableReserveUsdc - nextStable;
  if (!Number.isFinite(notionalUsdc) || notionalUsdc <= 0) {
    throw new Error("Pool quote returned zero output.");
  }

  const execution = notionalUsdc / quantity;
  const impactBps = Math.max(0, ((spotPriceUsdc - execution) / spotPriceUsdc) * 10_000);
  return {
    side: "sell" as const,
    price_spot_usdc: round8(spotPriceUsdc),
    price_execution_usdc: round8(execution),
    quantity: round8(quantity),
    notional_usdc: round8(notionalUsdc),
    fee_usdc: 0,
    price_impact_bps: round8(impactBps),
    slippage_bps: round8(impactBps),
    max_trade_usdc: round8(maxTradeUsdc),
    cooldown_seconds: cooldownSeconds,
    liquidity_usdc: round8(stableReserveUsdc),
    launch_guard_active: launchGuardActive,
    max_trade_token_qty: round8(maxTradeTokenQty),
  } satisfies OnchainEvmQuote;
}

export function storeKeyForStoreId(storeId: string) {
  const hash = keccak_256(new TextEncoder().encode(String(storeId || "").trim()));
  return `0x${Array.from(hash).map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export async function readFactoryCreationSettings(input: {
  rpcUrl: string;
  factoryAddress: string;
}) {
  const [liquidityRaw, reserveRaw] = await Promise.all([
    ethCall(input.rpcUrl, input.factoryAddress, CREATION_LIQUIDITY_SELECTOR),
    ethCall(input.rpcUrl, input.factoryAddress, CREATION_RESERVE_SELECTOR),
  ]);

  const liquidityRawValue = BigInt(String(liquidityRaw || "0x0"));
  const reserveRawValue = BigInt(String(reserveRaw || "0x0"));
  const liquidityUsdc = rawToNumber(liquidityRawValue, STABLE_DECIMALS);
  const reserveUsdc = rawToNumber(reserveRawValue, STABLE_DECIMALS);

  return {
    liquidity_raw: liquidityRawValue,
    reserve_raw: reserveRawValue,
    total_raw: liquidityRawValue + reserveRawValue,
    liquidity_usdc: round8(liquidityUsdc),
    reserve_usdc: round8(reserveUsdc),
    creation_fee_usdc: round8(liquidityUsdc + reserveUsdc),
  };
}

export function deriveActualTradeFromSwap(input: {
  side: "buy" | "sell";
  amount0: bigint;
  amount1: bigint;
  token0: string;
  stableToken: string;
  identityToken: string;
}) {
  const token0Norm = norm(input.token0);
  const stableNorm = norm(input.stableToken);
  const identityNorm = norm(input.identityToken);
  if (token0Norm !== stableNorm && token0Norm !== identityNorm) {
    throw new Error("Pool token order does not match stock assets");
  }

  const stableDelta = token0Norm === stableNorm ? input.amount0 : input.amount1;
  const tokenDelta = token0Norm === identityNorm ? input.amount0 : input.amount1;
  const stableAmountRaw = input.side === "buy"
    ? (stableDelta > 0n ? stableDelta : -stableDelta)
    : (stableDelta < 0n ? -stableDelta : stableDelta);
  const tokenAmountRaw = input.side === "buy"
    ? (tokenDelta < 0n ? -tokenDelta : tokenDelta)
    : (tokenDelta > 0n ? tokenDelta : -tokenDelta);

  const notionalUsdc = rawToNumber(stableAmountRaw, STABLE_DECIMALS);
  const quantity = rawToNumber(tokenAmountRaw, TOKEN_DECIMALS);
  if (notionalUsdc <= 0 || quantity <= 0) {
    throw new Error("Could not derive actual trade amounts from pool swap log");
  }

  return {
    notional_usdc: round8(notionalUsdc),
    quantity: round8(quantity),
    price_execution_usdc: round8(notionalUsdc / quantity),
  };
}
