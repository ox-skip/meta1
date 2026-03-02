import { createPublicClient, encodeFunctionData, http, keccak256, stringToHex } from "viem";
import { Platform } from "react-native";

import { createStockIdentity, getStockQuote, submitStockOrder } from "@/services/market/stocks";
import { fetchMarketChains, MarketChainConfig } from "@/services/market/chainConfig";
import { supabase } from "@/services/supabase";
import { requireLocalAuth } from "@/utils/secureAuth";
import { getSmartAccount } from "@/utils/aaWallet";
import { ensureWalletAddressOnChain, getMyWalletForChain, registerWallet } from "@/services/market/usdcCheckout";
import { getWalletModeSync, setWalletMode } from "@/services/wallet/walletMode";
import * as SecureStore from "@/utils/secureStore";

const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "ok", type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "amount", type: "uint256" }],
  },
] as const;

const IDENTITY_FACTORY_ABI = [
  {
    type: "function",
    name: "createIdentity",
    stateMutability: "nonpayable",
    inputs: [
      { name: "storeId", type: "bytes32" },
      { name: "name", type: "string" },
      { name: "symbol", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "identities",
    stateMutability: "view",
    inputs: [{ name: "storeId", type: "bytes32" }],
    outputs: [
      { name: "token", type: "address" },
      { name: "vault", type: "address" },
      { name: "staking", type: "address" },
      { name: "pool", type: "address" },
      { name: "stable", type: "address" },
      { name: "fee", type: "uint24" },
    ],
  },
  {
    type: "function",
    name: "nameRegistry",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const NAME_REGISTRY_ABI = [
  {
    type: "function",
    name: "isAllowed",
    stateMutability: "view",
    inputs: [
      { name: "creator", type: "address" },
      { name: "nameHash", type: "bytes32" },
      { name: "symbolHash", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const IDENTITY_ROUTER_ABI = [
  {
    type: "function",
    name: "tradeConfigs",
    stateMutability: "view",
    inputs: [{ name: "storeId", type: "bytes32" }],
    outputs: [
      { name: "enabled", type: "bool" },
      { name: "fee", type: "uint24" },
      { name: "pool", type: "address" },
      { name: "stableToken", type: "address" },
      { name: "identityToken", type: "address" },
    ],
  },
  {
    type: "function",
    name: "bootstrap",
    stateMutability: "view",
    inputs: [{ name: "storeId", type: "bytes32" }],
    outputs: [
      { name: "maxTradeBps", type: "uint256" },
      { name: "cooldownSecs", type: "uint256" },
      { name: "endTime", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "buyExactIn",
    stateMutability: "nonpayable",
    inputs: [
      { name: "storeId", type: "bytes32" },
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "sqrtPriceLimitX96", type: "uint160" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
  {
    type: "function",
    name: "sellExactIn",
    stateMutability: "nonpayable",
    inputs: [
      { name: "storeId", type: "bytes32" },
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "sqrtPriceLimitX96", type: "uint160" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

const IDENTITY_CREATED_EVENT_SIG =
  "IdentityCreated(bytes32,address,address,address,address,address,uint24,string,string)";
const IDENTITY_CREATED_TOPIC0 = keccak256(stringToHex(IDENTITY_CREATED_EVENT_SIG));

function logCreate(step: string, meta?: Record<string, unknown>) {
  if (meta) {
    console.log(`[stock-create] ${step}`, meta);
    return;
  }
  console.log(`[stock-create] ${step}`);
}

function logCreateError(step: string, err: unknown, meta?: Record<string, unknown>) {
  const message = String((err as any)?.message ?? err ?? "unknown");
  if (meta) {
    console.error(`[stock-create] ${step} FAILED`, { message, ...meta });
    return;
  }
  console.error(`[stock-create] ${step} FAILED`, { message });
}

function toNumber(input: unknown, fallback = 0) {
  const n = Number(input);
  return Number.isFinite(n) ? n : fallback;
}

function toRaw(value: number, decimals: number, maxFraction = 12) {
  const safe = Math.max(0, Number.isFinite(value) ? value : 0);
  const fixed = safe.toFixed(Math.min(decimals, maxFraction));
  const [whole, fracRaw = ""] = fixed.split(".");
  const frac = (fracRaw + "0".repeat(decimals)).slice(0, decimals);
  const normalized = `${whole}${frac}`.replace(/^0+(\d)/, "$1");
  return BigInt(normalized || "0");
}

function normalizeHex(v: string | null | undefined) {
  const raw = String(v || "").trim();
  return raw.startsWith("0x") ? (raw as `0x${string}`) : null;
}

function isAddress(v: string | null | undefined) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(v || ""));
}

function formatUsdc6(raw: bigint) {
  const whole = raw / 1_000_000n;
  const frac = raw % 1_000_000n;
  const fracText = frac.toString().padStart(6, "0").replace(/0+$/, "");
  return fracText ? `${whole.toString()}.${fracText}` : whole.toString();
}

function formatToken18(raw: bigint) {
  const whole = raw / 1_000_000_000_000_000_000n;
  const frac = raw % 1_000_000_000_000_000_000n;
  const fracText = frac.toString().padStart(18, "0").replace(/0+$/, "");
  return fracText ? `${whole.toString()}.${fracText}` : whole.toString();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(id);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(id);
        reject(error);
      });
  });
}

function isWalletConnectionIssue(err: unknown) {
  const msg = String((err as any)?.message || err || "").toLowerCase();
  return (
    msg.includes("wallet connection timed out") ||
    msg.includes("connection timed out") ||
    msg.includes("provider is unavailable") ||
    msg.includes("still initializing") ||
    msg.includes("reconnect and try again")
  );
}

async function resolveSmartAccountForTrade(chain: MarketChainConfig, userId: string) {
  const mode = getWalletModeSync();
  const firstAttemptTimeoutMs =
    Platform.OS === "web" && mode === "base_smart"
      ? 15_000
      : 45_000;

  try {
    return await withTimeout(
      getSmartAccount(chain, userId),
      firstAttemptTimeoutMs,
      "Wallet connection timed out. Open wallet and reconnect, then retry.",
    );
  } catch (e: any) {
    // Base Smart can fail to complete popup handshake in some desktop browsers.
    // Fallback to WalletConnect once so trade flow can continue.
    const canFallback = Platform.OS === "web" && mode === "base_smart" && isWalletConnectionIssue(e);
    if (!canFallback) throw e;

    try {
      await setWalletMode("walletconnect");
      await sleep(250);
      return await withTimeout(
        getSmartAccount(chain, userId),
        45_000,
        "WalletConnect connection timed out. Open wallet and approve the session, then retry.",
      );
    } catch (fallbackErr: any) {
      const fallbackMsg = String(fallbackErr?.message || fallbackErr || "Wallet connection failed");
      throw new Error(`Base Smart connection failed. Switched to WalletConnect but could not connect: ${fallbackMsg}`);
    }
  }
}

const UINT256_MAX = (2n ** 256n) - 1n;
const KEY_LAST_TRADE_DRAFT = "stock_last_trade_draft";

const CREATE_ERROR_SELECTOR_HINTS: Record<string, string> = {
  // OpenChain lookup: 0x846ec056 -> Exists()
  "0x846ec056":
    "Exists(): identity/name/symbol already exists on-chain. Try a different Name/Symbol, or use the existing identity for this store.",
};

function shortRevertReason(err: unknown) {
  const candidates = [
    (err as any)?.shortMessage,
    (err as any)?.details,
    (err as any)?.cause?.shortMessage,
    (err as any)?.cause?.details,
    (err as any)?.message,
    (err as any)?.cause?.message,
  ]
    .map((v) => String(v || "").trim())
    .filter(Boolean);

  for (const raw of candidates) {
    const lowered = raw.toLowerCase();
    const selectorMatch = raw.match(/0x[a-fA-F0-9]{8}/);
    if (selectorMatch) {
      const selector = selectorMatch[0].toLowerCase();
      const hint = CREATE_ERROR_SELECTOR_HINTS[selector];
      if (hint) return hint;
    }
    const execIdx = lowered.indexOf("execution reverted");
    if (execIdx >= 0) {
      return raw.slice(execIdx).replace(/^.*?(execution reverted)/i, "$1").trim();
    }
    if (lowered.includes("useroperation reverted")) {
      return raw;
    }
    if (lowered.includes("revert")) {
      return raw;
    }
  }
  return "";
}

function bufferedMaxTrade(rawMax: bigint, bufferBps = 9850n) {
  if (rawMax <= 0n) return 0n;
  return (rawMax * bufferBps) / 10_000n;
}

function isAllowanceSimulationReason(reason: string) {
  const r = String(reason || "").toLowerCase();
  return (
    r.includes("allowance") ||
    r.includes("insufficient allowance") ||
    r.includes("transfer amount exceeds allowance") ||
    r.includes("transferhelper") ||
    r.includes("stf")
  );
}

function isTooLittleReceivedReason(reason: string) {
  const r = String(reason || "").toLowerCase();
  return r.includes("too little received") || r.includes("insufficient output amount");
}

function minOutFromExpectedRaw(expectedOutRaw: bigint, slippageBps: number) {
  const bps = Math.max(1, Math.min(9900, Math.round(slippageBps || 0)));
  const keptBps = 10_000n - BigInt(bps);
  const minRaw = (expectedOutRaw * keptBps) / 10_000n;
  return minRaw > 0n ? minRaw : 1n;
}

function toBigIntSafe(input: unknown) {
  try {
    if (typeof input === "bigint") return input;
    if (typeof input === "number" && Number.isFinite(input)) return BigInt(Math.floor(input));
    const text = String(input ?? "").trim();
    if (!text) return 0n;
    return BigInt(text);
  } catch {
    return 0n;
  }
}

function buildAdaptiveSlippagePlan(baseBps: number, quoteImpactBps: number, launchGuardActive: boolean) {
  const normalizedBase = Math.max(100, Math.round(baseBps || 1200));
  const cap = launchGuardActive ? 7000 : 6000;
  const dynamicFloor = launchGuardActive ? 2200 : 1500;
  const impactTarget = Math.ceil(Math.max(0, quoteImpactBps) + (launchGuardActive ? 1300 : 900));
  const target = Math.max(normalizedBase, dynamicFloor, impactTarget);

  const candidates = [normalizedBase, target, target + 700, target + 1400, cap];
  const out: number[] = [];
  for (const n of candidates) {
    const v = Math.max(100, Math.min(cap, Math.round(n)));
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

async function resolveBootstrapMaxTrade(
  publicClient: any,
  args: {
    routerAddress: `0x${string}`;
    storeKey: `0x${string}`;
    tokenIn: `0x${string}`;
    fallbackPool?: `0x${string}` | null;
  },
) {
  try {
    const [bootstrapCfg, tradeCfg] = await Promise.all([
      publicClient.readContract({
        abi: IDENTITY_ROUTER_ABI,
        address: args.routerAddress,
        functionName: "bootstrap",
        args: [args.storeKey],
      }),
      publicClient.readContract({
        abi: IDENTITY_ROUTER_ABI,
        address: args.routerAddress,
        functionName: "tradeConfigs",
        args: [args.storeKey],
      }),
    ]);

    const maxTradeBps = BigInt((bootstrapCfg as any)?.maxTradeBps ?? (bootstrapCfg as any)?.[0] ?? 0n);
    const endTime = BigInt((bootstrapCfg as any)?.endTime ?? (bootstrapCfg as any)?.[2] ?? 0n);
    const enabled = Boolean((tradeCfg as any)?.enabled ?? (tradeCfg as any)?.[0] ?? true);
    if (!enabled || maxTradeBps <= 0n) return null;

    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    if (endTime > 0n && nowSec > endTime) return null;

    const configuredPool = normalizeHex(String((tradeCfg as any)?.pool ?? (tradeCfg as any)?.[2] ?? ""));
    const poolAddress = configuredPool || args.fallbackPool || null;
    if (!poolAddress) return null;

    const poolBalanceRaw = await publicClient.readContract({
      abi: ERC20_ABI,
      address: args.tokenIn,
      functionName: "balanceOf",
      args: [poolAddress],
    }) as bigint;

    const maxTradeRaw = (poolBalanceRaw * maxTradeBps) / 10_000n;
    return {
      poolAddress,
      maxTradeBps,
      poolBalanceRaw,
      maxTradeRaw,
      tradeCfg,
    };
  } catch {
    return null;
  }
}

async function submitStockOrderWithRetry(
  payload: {
    slug: string;
    side: "buy" | "sell";
    amount_usdc?: number;
    quantity?: number;
    max_slippage_bps: number;
    tx_hash: string;
    user_op_hash?: string;
    execution_mode: "onchain";
    quote_snapshot?: any;
  },
  attempts = 20,
  delayMs = 1500,
) {
  let lastErr: any = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return await submitStockOrder(payload);
    } catch (e: any) {
      lastErr = e;
      const msg = String(e?.message ?? e ?? "").toLowerCase();
      const retryable =
        msg.includes("awaiting confirmations") ||
        msg.includes("transaction receipt not found on chain yet") ||
        msg.includes("timed out") ||
        msg.includes("timeout") ||
        msg.includes("abort") ||
        msg.includes("network");
      if (!retryable || i === attempts - 1) break;
      await sleep(delayMs);
    }
  }
  throw lastErr ?? new Error("Trade submitted on-chain but indexing is still pending.");
}

type StockTradeDraft = {
  slug: string;
  side: "buy" | "sell";
  amount_usdc?: number;
  quantity?: number;
  max_slippage_bps?: number;
  quote_snapshot?: any;
  tx_hash?: string;
  user_op_hash?: string;
  created_at?: string;
};

async function readTradeDraft(): Promise<StockTradeDraft | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY_LAST_TRADE_DRAFT);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.slug || !parsed.side) return null;
    return parsed as StockTradeDraft;
  } catch {
    return null;
  }
}

async function writeTradeDraft(next: Partial<StockTradeDraft>) {
  const current = (await readTradeDraft()) ?? {};
  const merged = { ...current, ...next, created_at: new Date().toISOString() };
  try {
    await SecureStore.setItemAsync(KEY_LAST_TRADE_DRAFT, JSON.stringify(merged));
  } catch {
    // ignore persistence failures
  }
}

export async function repairLastStockTradeIndex(input?: { tx_hash?: string; user_op_hash?: string }) {
  const draft = await readTradeDraft();
  if (!draft) throw new Error("No recent trade found to repair.");
  const txHash = String(input?.tx_hash || draft.tx_hash || "").trim();
  if (!txHash.startsWith("0x")) throw new Error("Missing trade transaction hash. Retry a trade first.");
  const side = draft.side;
  const maxSlippage = Number(draft.max_slippage_bps ?? 1200);

  return await submitStockOrderWithRetry({
    slug: draft.slug,
    side,
    amount_usdc: side === "buy" ? draft.amount_usdc : undefined,
    quantity: side === "sell" ? draft.quantity : undefined,
    max_slippage_bps: maxSlippage,
    tx_hash: txHash,
    user_op_hash: String(input?.user_op_hash || draft.user_op_hash || "").trim() || undefined,
    execution_mode: "onchain",
    quote_snapshot: draft.quote_snapshot ?? null,
  });
}

export function storeKeyFromStoreId(storeId: string) {
  return keccak256(stringToHex(String(storeId || "").trim()));
}

export function explorerTxUrl(chain: string, txHash: string) {
  const c = String(chain || "").toLowerCase();
  const h = String(txHash || "").trim();
  if (!h.startsWith("0x")) return null;
  const map: Record<string, string> = {
    sepolia: "https://sepolia.etherscan.io/tx/",
    ethereum: "https://etherscan.io/tx/",
    base_sepolia: "https://sepolia.basescan.org/tx/",
    base: "https://basescan.org/tx/",
    arbitrum_sepolia: "https://sepolia.arbiscan.io/tx/",
    arbitrum: "https://arbiscan.io/tx/",
    polygon_amoy: "https://amoy.polygonscan.com/tx/",
    polygon: "https://polygonscan.com/tx/",
    optimism: "https://optimistic.etherscan.io/tx/",
    bnb: "https://bscscan.com/tx/",
    bnb_testnet: "https://testnet.bscscan.com/tx/",
  };
  const prefix = map[c];
  return prefix ? `${prefix}${h}` : null;
}

async function resolveTxHash(chain: MarketChainConfig, sendResult: any) {
  const txHash = String(sendResult?.hash ?? sendResult?.transactionHash ?? "");
  const userOpHash = String(sendResult?.userOpHash ?? sendResult?.userOperationHash ?? "");
  if (txHash.startsWith("0x")) return { txHash, userOpHash };
  if (!userOpHash.startsWith("0x")) return { txHash: "", userOpHash };

  try {
    const publicClient = createPublicClient({ transport: http(String(chain.rpc_url || "")) });
    const reqAny = publicClient.request as any;
    for (let i = 0; i < 25; i++) {
      const receipt: any =
        (await reqAny({
          method: "eth_getUserOperationReceipt" as any,
          params: [userOpHash as `0x${string}`],
        })) ??
        (await reqAny({
          method: "alchemy_getUserOperationReceipt" as any,
          params: [userOpHash as `0x${string}`],
        }));
      const opTx = String(receipt?.receipt?.transactionHash || receipt?.transactionHash || "");
      if (opTx.startsWith("0x")) {
        return { txHash: opTx, userOpHash };
      }
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
    return { txHash: "", userOpHash };
  } catch {
    return { txHash: "", userOpHash };
  }
}

async function resolveStockChain(chainName: string) {
  const chains = await fetchMarketChains();
  const chain = (chains ?? []).find((c) => c.chain === chainName && c.active);
  if (!chain) throw new Error(`Active chain config not found for ${chainName}`);
  if (!isAddress(chain.identity_factory)) throw new Error(`identity_factory missing for ${chainName}`);
  if (!isAddress(chain.identity_router)) throw new Error(`identity_router missing for ${chainName}`);
  if (!isAddress(chain.identity_stable_address || chain.usdc_address)) throw new Error(`identity_stable_address missing for ${chainName}`);
  if (!chain.rpc_url) throw new Error(`rpc_url missing for ${chainName}`);
  return chain;
}

function toHexBlock(n: bigint) {
  return `0x${n.toString(16)}`;
}

async function findLatestIdentityCreatedTxHash(
  publicClient: any,
  factoryAddress: `0x${string}`,
  storeKey: `0x${string}`,
) {
  try {
    const latest = await publicClient.getBlockNumber();
    // Alchemy free tier restricts eth_getLogs to tiny ranges (often <=10 blocks),
    // so scan backwards in small windows.
    const step = 10n;
    const maxBack = 20_000n;
    const minBlock = latest > maxBack ? latest - maxBack : 0n;
    let to = latest;

    while (to >= minBlock) {
      const from = to >= (step - 1n) ? to - (step - 1n) : 0n;
      const logs = await publicClient.request({
        method: "eth_getLogs",
        params: [
          {
            address: factoryAddress,
            fromBlock: toHexBlock(from),
            toBlock: toHexBlock(to),
            topics: [IDENTITY_CREATED_TOPIC0, storeKey],
          },
        ],
      }) as Array<{ transactionHash?: string }>;

      if (Array.isArray(logs) && logs.length) {
        const last = logs[logs.length - 1];
        const txHash = String(last?.transactionHash || "");
        if (txHash.startsWith("0x")) return txHash;
      }

      if (from === 0n) break;
      to = from - 1n;
    }

    return null;
  } catch {
    return null;
  }
}

async function waitForIdentityInfo(
  publicClient: any,
  factoryAddress: `0x${string}`,
  storeKey: `0x${string}`,
  timeoutMs = 120_000,
) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const info = await publicClient.readContract({
      abi: IDENTITY_FACTORY_ABI,
      address: factoryAddress,
      functionName: "identities",
      args: [storeKey],
    }) as any;

    const tokenAddress = String(info?.token || "");
    const poolAddress = String(info?.pool || "");
    const vaultAddress = String(info?.vault || "");
    const stakingAddress = String(info?.staking || "");
    if (isAddress(tokenAddress) && isAddress(poolAddress)) {
      return { tokenAddress, poolAddress, vaultAddress, stakingAddress };
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return null;
}

async function waitForAllowance(
  publicClient: any,
  token: `0x${string}`,
  owner: `0x${string}`,
  spender: `0x${string}`,
  minAmount: bigint,
  timeoutMs = 120_000,
) {
  const started = Date.now();
  let last = 0n;
  while (Date.now() - started < timeoutMs) {
    try {
      last = await publicClient.readContract({
        abi: ERC20_ABI,
        address: token,
        functionName: "allowance",
        args: [owner, spender],
      }) as bigint;
      if (last >= minAmount) return last;
    } catch {
      // ignore transient RPC issues while polling
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return last;
}

async function diagnoseCreateRevert(
  publicClient: any,
  args: {
    factoryAddress: `0x${string}`;
    stableAddress: `0x${string}`;
    wallet: `0x${string}`;
    storeKey: `0x${string}`;
    creationFeeRaw: bigint;
    name: string;
    symbol: string;
  },
) {
  const notes: string[] = [];
  try {
    const info = await publicClient.readContract({
      abi: IDENTITY_FACTORY_ABI,
      address: args.factoryAddress,
      functionName: "identities",
      args: [args.storeKey],
    }) as any;
    const token = String(info?.token || "");
    const pool = String(info?.pool || "");
    if (isAddress(token) && isAddress(pool)) {
      notes.push(`identity already exists on-chain (token=${token}, pool=${pool})`);
    }
  } catch {
    // ignore diagnostic read failure
  }

  try {
    const allowance = await publicClient.readContract({
      abi: ERC20_ABI,
      address: args.stableAddress,
      functionName: "allowance",
      args: [args.wallet, args.factoryAddress],
    }) as bigint;
    if (allowance < args.creationFeeRaw) {
      notes.push(`allowance too low (${formatUsdc6(allowance)} < 50 USDC)`);
    }
  } catch {
    // ignore diagnostic read failure
  }

  try {
    const balance = await publicClient.readContract({
      abi: ERC20_ABI,
      address: args.stableAddress,
      functionName: "balanceOf",
      args: [args.wallet],
    }) as bigint;
    if (balance < args.creationFeeRaw) {
      notes.push(`stable balance too low (${formatUsdc6(balance)} < 50 USDC)`);
    }
  } catch {
    // ignore diagnostic read failure
  }

  try {
    const registry = await publicClient.readContract({
      abi: IDENTITY_FACTORY_ABI,
      address: args.factoryAddress,
      functionName: "nameRegistry",
      args: [],
    }) as `0x${string}`;
    if (isAddress(registry) && String(registry).toLowerCase() !== "0x0000000000000000000000000000000000000000") {
      const nameHash = keccak256(stringToHex(args.name));
      const symbolHash = keccak256(stringToHex(args.symbol));
      const allowed = await publicClient.readContract({
        abi: NAME_REGISTRY_ABI,
        address: registry,
        functionName: "isAllowed",
        args: [args.wallet, nameHash, symbolHash],
      }) as boolean;
      if (!allowed) {
        notes.push("name/symbol blocked by on-chain NameRegistry");
      }
    }
  } catch {
    // ignore diagnostic read failure
  }

  return notes;
}

async function preflightCreateIdentityCall(
  publicClient: any,
  args: {
    factoryAddress: `0x${string}`;
    wallet: `0x${string}`;
    storeKey: `0x${string}`;
    name: string;
    symbol: string;
  },
) {
  try {
    await publicClient.simulateContract({
      abi: IDENTITY_FACTORY_ABI,
      address: args.factoryAddress,
      functionName: "createIdentity",
      args: [args.storeKey, args.name, args.symbol],
      account: args.wallet,
    });
    return { ok: true as const, reason: "" };
  } catch (e: any) {
    return { ok: false as const, reason: shortRevertReason(e) };
  }
}

export async function createStockIdentityOnchain(input: {
  name: string;
  symbol: string;
  chain: string;
  slug?: string | null;
}) {
  logCreate("start", {
    chain: input.chain,
    symbol: input.symbol,
    name: input.name,
    slug: input.slug ?? null,
  });
  try {
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr) throw authErr;
    const user = auth?.user;
    if (!user) throw new Error("Not authenticated");
    logCreate("auth_ok", { user_id: user.id });

    const { data: existing, error: existingErr } = await supabase
      .from("market_stock_identities")
      .select("id,slug,name,symbol,chain,active,token_address,pool_address,trading_paused_until")
      .eq("store_id", user.id)
      .neq("chain", "pi_testnet")
      .maybeSingle();
    if (existingErr) throw new Error(existingErr.message);
    const pausedUntilMs = Date.parse(String((existing as any)?.trading_paused_until || ""));
    const tradingPaused = Number.isFinite(pausedUntilMs) && pausedUntilMs > Date.now();
    if (
      existing?.id &&
      existing.active !== false &&
      isAddress(String((existing as any).token_address || "")) &&
      isAddress(String((existing as any).pool_address || "")) &&
      !tradingPaused
    ) {
      logCreate("existing_identity_ready", {
        identity_id: existing.id,
        slug: existing.slug,
        chain: existing.chain,
      });
      return {
        ok: true,
        created: false,
        identity: existing,
        tx_hash: null,
        user_op_hash: null,
        explorer_url: null,
      } as any;
    }
    if (existing?.id) {
      logCreate("store_identity_repair_mode", {
        identity_id: existing.id,
        active: existing.active,
        has_token: isAddress(String((existing as any).token_address || "")),
        has_pool: isAddress(String((existing as any).pool_address || "")),
        trading_paused: tradingPaused,
      });
    } else {
      logCreate("store_identity_check_ok");
    }

    logCreate("wallet_connect_required");

    const authCheck = await requireLocalAuth("Create stock identity on-chain");
    if (!authCheck.ok) throw new Error(authCheck.message || "Authentication required");
    logCreate("local_auth_ok");

    const chain = await resolveStockChain(input.chain);
    logCreate("chain_resolved", {
      chain: chain.chain,
      chain_id: chain.chain_id,
      factory: chain.identity_factory,
      stable: chain.identity_stable_address || chain.usdc_address,
    });
    const publicClient = createPublicClient({ transport: http(String(chain.rpc_url || "")) });
    await ensureWalletAddressOnChain(chain);

    const { client, account, address } = await getSmartAccount(chain, user.id);
    logCreate("smart_account_ok", { wallet: address });
    const savedWallet = await getMyWalletForChain(chain.chain);
    await registerWallet(chain.chain, address);
    if (savedWallet?.address && String(savedWallet.address).toLowerCase() !== String(address).toLowerCase()) {
      logCreate("wallet_mapping_updated", { old_wallet: savedWallet.address, new_wallet: address });
    }
    const storeKey = storeKeyFromStoreId(user.id);
    const stableAddress = (chain.identity_stable_address || chain.usdc_address) as `0x${string}`;
    const factoryAddress = chain.identity_factory as `0x${string}`;
    const creationFeeRaw = 50_000_000n; // 50 USDC (6 decimals)

    const [factoryCode, stableCode] = await Promise.all([
      publicClient.getCode({ address: factoryAddress as `0x${string}` }),
      publicClient.getCode({ address: stableAddress as `0x${string}` }),
    ]);
    if (!factoryCode || factoryCode === "0x") {
      throw new Error(`Identity factory contract not found on ${chain.chain}. Update market_chain_config.identity_factory.`);
    }
    if (!stableCode || stableCode === "0x") {
      throw new Error(`Stable token contract not found on ${chain.chain}. Update market_chain_config.identity_stable_address/usdc_address.`);
    }

    const nativeBalance = await publicClient.getBalance({ address: address as `0x${string}` });
    if (nativeBalance <= 0n) {
      throw new Error(`Insufficient ${String(chain.chain || "native")} gas token. Fund this wallet with native gas token first.`);
    }

    // If previous create succeeded on-chain but DB write failed, sync instead of creating again.
    const preInfo = await publicClient.readContract({
      abi: IDENTITY_FACTORY_ABI,
      address: factoryAddress,
      functionName: "identities",
      args: [storeKey as `0x${string}`],
    }) as any;
    const preToken = String(preInfo?.token || "");
    const prePool = String(preInfo?.pool || "");
    const preVault = String(preInfo?.vault || "");
    const preStaking = String(preInfo?.staking || "");
    if (isAddress(preToken) && isAddress(prePool)) {
      logCreate("onchain_identity_already_exists", {
        token: preToken,
        pool: prePool,
        vault: preVault,
        staking: preStaking,
      });
      const recoveredTx = await findLatestIdentityCreatedTxHash(publicClient, factoryAddress, storeKey as `0x${string}`);
      logCreate("sync_existing_submit", { tx_hash: recoveredTx || null });
      const db = await createStockIdentity({
        name: input.name.trim(),
        symbol: input.symbol.trim().toUpperCase(),
        chain: input.chain,
        slug: input.slug ?? undefined,
        tx_hash: recoveredTx || undefined,
        force_sync_existing: true,
        token_address: preToken,
        pool_address: prePool,
        vault_address: preVault,
        staking_address: preStaking,
        store_key: storeKey,
      });
      logCreate("sync_existing_ok", { tx_hash: recoveredTx || null, identity_id: db?.identity?.id ?? null });
      return {
        ...db,
        tx_hash: recoveredTx || null,
        user_op_hash: null,
        explorer_url: recoveredTx ? explorerTxUrl(chain.chain, recoveredTx) : null,
      };
    }

    const stableBalance = await publicClient.readContract({
      abi: ERC20_ABI,
      address: stableAddress,
      functionName: "balanceOf",
      args: [address as `0x${string}`],
    }) as bigint;
    logCreate("stable_balance", {
      token: stableAddress,
      wallet: address,
      balance_raw: stableBalance.toString(),
      balance_usdc: formatUsdc6(stableBalance),
    });
    if (stableBalance < creationFeeRaw) {
      throw new Error(
        `Insufficient USDC for stock creation. Need 50 USDC, wallet has ${formatUsdc6(stableBalance)} USDC.`,
      );
    }

    const currentAllowance = await publicClient.readContract({
      abi: ERC20_ABI,
      address: stableAddress,
      functionName: "allowance",
      args: [address as `0x${string}`, factoryAddress],
    }) as bigint;
    logCreate("allowance_current", {
      owner: address,
      spender: factoryAddress,
      allowance_raw: currentAllowance.toString(),
      allowance_usdc: formatUsdc6(currentAllowance),
    });

    if (currentAllowance < creationFeeRaw) {
      const approveData = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [factoryAddress, creationFeeRaw],
      });

      logCreate("approve_submit", { token: stableAddress, spender: factoryAddress, amount_raw: creationFeeRaw.toString() });
      const approveResult = await (client as any).sendTransaction({
        account,
        to: stableAddress,
        data: approveData,
      });
      const approveResolved = await resolveTxHash(chain, approveResult);
      logCreate("approve_sent", { tx_hash: approveResolved.txHash || null, user_op_hash: approveResolved.userOpHash || null });

      const allowanceReady = await waitForAllowance(
        publicClient,
        stableAddress,
        address as `0x${string}`,
        factoryAddress,
        creationFeeRaw,
        180_000,
      );
      logCreate("allowance_after_approve", {
        allowance_raw: allowanceReady.toString(),
        allowance_usdc: formatUsdc6(allowanceReady),
      });
      if (allowanceReady < creationFeeRaw) {
        throw new Error(
          `Approve transaction did not set required allowance in time. Need 50 USDC allowance, current ${formatUsdc6(allowanceReady)}.`,
        );
      }
    } else {
      logCreate("approve_skip_existing_allowance");
    }

    const preflight = await preflightCreateIdentityCall(publicClient, {
      factoryAddress,
      wallet: address as `0x${string}`,
      storeKey: storeKey as `0x${string}`,
      name: input.name.trim(),
      symbol: input.symbol.trim().toUpperCase(),
    });
    if (!preflight.ok) {
      const notes = await diagnoseCreateRevert(publicClient, {
        factoryAddress,
        stableAddress,
        wallet: address as `0x${string}`,
        storeKey: storeKey as `0x${string}`,
        creationFeeRaw,
        name: input.name.trim(),
        symbol: input.symbol.trim().toUpperCase(),
      });
      if (notes.length) {
        throw new Error(`Cannot create stock yet: ${notes.join("; ")}`);
      }
      if (preflight.reason) {
        throw new Error(`Cannot create stock yet: ${preflight.reason}`);
      }
      throw new Error("Cannot create stock yet: on-chain simulation reverted.");
    }

    const createData = encodeFunctionData({
      abi: IDENTITY_FACTORY_ABI,
      functionName: "createIdentity",
      args: [storeKey as `0x${string}`, input.name.trim(), input.symbol.trim().toUpperCase()],
    });

    logCreate("create_submit", { factory: factoryAddress, store_key: storeKey });
    let createResult: any;
    try {
      createResult = await (client as any).sendTransaction({
        account,
        to: factoryAddress,
        data: createData,
      });
    } catch (submitErr) {
      const reason = shortRevertReason(submitErr);
      if (reason.toLowerCase().includes("exists()")) {
        // Recovery path: if this store identity already exists on-chain, sync DB from latest event.
        const postInfo = await publicClient.readContract({
          abi: IDENTITY_FACTORY_ABI,
          address: factoryAddress,
          functionName: "identities",
          args: [storeKey as `0x${string}`],
        }) as any;
        const postToken = String(postInfo?.token || "");
        const postPool = String(postInfo?.pool || "");
        const postVault = String(postInfo?.vault || "");
        const postStaking = String(postInfo?.staking || "");

        if (isAddress(postToken) && isAddress(postPool)) {
          const recoveredTx = await findLatestIdentityCreatedTxHash(publicClient, factoryAddress, storeKey as `0x${string}`);
          const db = await createStockIdentity({
            name: input.name.trim(),
            symbol: input.symbol.trim().toUpperCase(),
            chain: input.chain,
            slug: input.slug ?? undefined,
            tx_hash: recoveredTx || undefined,
            force_sync_existing: true,
            token_address: postToken,
            pool_address: postPool,
            vault_address: postVault,
            staking_address: postStaking,
            store_key: storeKey,
          });
          return {
            ...db,
            tx_hash: recoveredTx || null,
            user_op_hash: null,
            explorer_url: recoveredTx ? explorerTxUrl(chain.chain, recoveredTx) : null,
          };
        }

        throw new Error("Exists(): identity/name/symbol already exists on-chain. Try a different Name/Symbol.");
      }
      const notes = await diagnoseCreateRevert(publicClient, {
        factoryAddress,
        stableAddress,
        wallet: address as `0x${string}`,
        storeKey: storeKey as `0x${string}`,
        creationFeeRaw,
        name: input.name.trim(),
        symbol: input.symbol.trim().toUpperCase(),
      });
      if (notes.length) {
        throw new Error(`Create transaction reverted: ${notes.join("; ")}`);
      }
      if (reason) {
        throw new Error(`Create transaction reverted: ${reason}`);
      }
      throw submitErr;
    }
    let { txHash, userOpHash } = await resolveTxHash(chain, createResult);
    logCreate("create_sent", { tx_hash: txHash || null, user_op_hash: userOpHash || null });

    if (!txHash.startsWith("0x")) {
      throw new Error("Create transaction submitted, but hash is not available yet. Wait a moment and retry.");
    }

    const createReceipt = await publicClient.waitForTransactionReceipt({
        hash: txHash as `0x${string}`,
        confirmations: Math.max(1, Number(chain.confirmations_required || 1)),
        timeout: 180_000,
      });
    logCreate("create_receipt_ok", {
      tx_hash: txHash,
      status: String((createReceipt as any)?.status ?? ""),
      block_number: String((createReceipt as any)?.blockNumber ?? ""),
    });
    if ((createReceipt as any)?.status && String((createReceipt as any).status).toLowerCase() !== "success") {
      throw new Error(
        `On-chain create transaction failed on ${chain.chain}. Check wallet USDC balance and ensure this store has not already created on-chain.`,
      );
    }

    const info = await waitForIdentityInfo(publicClient, factoryAddress, storeKey as `0x${string}`, 45_000);
    if (!info) {
      logCreate("identity_info_pending_after_receipt", { tx_hash: txHash, store_key: storeKey });
      const recovered = await createStockIdentity({
        name: input.name.trim(),
        symbol: input.symbol.trim().toUpperCase(),
        chain: input.chain,
        slug: input.slug ?? undefined,
        tx_hash: txHash || undefined,
        user_op_hash: userOpHash || undefined,
        store_key: storeKey,
        force_sync_existing: true,
      });
      if (recovered?.ok && recovered?.identity) {
        logCreate("identity_sync_recovered_after_pending", {
          identity_id: recovered?.identity?.id ?? null,
          slug: recovered?.identity?.slug ?? null,
        });
        return {
          ...recovered,
          tx_hash: txHash || null,
          user_op_hash: userOpHash || null,
          explorer_url: txHash ? explorerTxUrl(chain.chain, txHash) : null,
        };
      }
      throw new Error("On-chain identity is still syncing. Please retry in a few seconds.");
    }
    logCreate("identity_info_ok", {
      token: info.tokenAddress,
      pool: info.poolAddress,
      vault: info.vaultAddress,
      staking: info.stakingAddress,
    });

    let tokenAddress = info.tokenAddress;
    let poolAddress = info.poolAddress;
    const vaultAddress = info.vaultAddress;
    const stakingAddress = info.stakingAddress;

    const upsertFromTx = async (useTxHash: string) =>
      await createStockIdentity({
        name: input.name.trim(),
        symbol: input.symbol.trim().toUpperCase(),
        chain: input.chain,
        slug: input.slug ?? undefined,
        tx_hash: useTxHash,
        user_op_hash: userOpHash || undefined,
        token_address: tokenAddress,
        pool_address: poolAddress,
        vault_address: vaultAddress,
        staking_address: stakingAddress,
        store_key: storeKey,
      });

    let db: any;
    try {
      logCreate("db_sync_submit", { tx_hash: txHash });
      db = await upsertFromTx(txHash);
      logCreate("db_sync_ok", { identity_id: db?.identity?.id ?? null, slug: db?.identity?.slug ?? null });
    } catch (e: any) {
      const m = String(e?.message ?? e ?? "").toLowerCase();
      logCreateError("db_sync", e, { tx_hash: txHash });
      // Recovery path for delayed indexer timing: use latest successful IdentityCreated tx for this store.
      if (m.includes("on-chain create transaction failed") || m.includes("transaction receipt not found")) {
        const recoveredTx = await findLatestIdentityCreatedTxHash(publicClient, factoryAddress, storeKey as `0x${string}`);
        logCreate("db_sync_recovery_attempt", { recovered_tx: recoveredTx, current_tx: txHash });
        if (recoveredTx && recoveredTx.toLowerCase() !== txHash.toLowerCase()) {
          txHash = recoveredTx;
          db = await upsertFromTx(txHash);
          logCreate("db_sync_recovery_ok", { tx_hash: txHash, identity_id: db?.identity?.id ?? null });
        } else {
          db = await createStockIdentity({
            name: input.name.trim(),
            symbol: input.symbol.trim().toUpperCase(),
            chain: input.chain,
            slug: input.slug ?? undefined,
            tx_hash: undefined,
            user_op_hash: userOpHash || undefined,
            token_address: tokenAddress,
            pool_address: poolAddress,
            vault_address: vaultAddress,
            staking_address: stakingAddress,
            store_key: storeKey,
            force_sync_existing: true,
          });
          logCreate("db_sync_recovery_ok_no_tx", { identity_id: db?.identity?.id ?? null });
          txHash = "";
        }
      } else {
        throw e;
      }
    }

    return {
      ...db,
      tx_hash: txHash || null,
      user_op_hash: userOpHash || null,
      explorer_url: txHash ? explorerTxUrl(chain.chain, txHash) : null,
    };
  } catch (e) {
    logCreateError("create_flow", e, {
      chain: input.chain,
      symbol: input.symbol,
      name: input.name,
    });
    throw e;
  }
}

export async function submitStockTradeOnchain(input: {
  slug: string;
  side: "buy" | "sell";
  amount_usdc?: number;
  quantity?: number;
  max_slippage_bps?: number;
}) {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  const user = auth?.user;
  if (!user) throw new Error("Not authenticated");

  const authCheck = await withTimeout(
    requireLocalAuth(input.side === "buy" ? "Confirm stock buy" : "Confirm stock sell"),
    60_000,
    "Authentication timed out. Retry and complete biometric/passcode confirmation promptly.",
  );
  if (!authCheck.ok) throw new Error(authCheck.message || "Authentication required");

  const quoteRes = await withTimeout(
    getStockQuote({
      slug: input.slug,
      side: input.side,
      amount_usdc: input.amount_usdc,
      quantity: input.quantity,
      max_slippage_bps: input.max_slippage_bps ?? 1200,
    }),
    25_000,
    "Quote request timed out. Check network and retry.",
  );
  await writeTradeDraft({
    slug: input.slug,
    side: input.side,
    amount_usdc: input.amount_usdc,
    quantity: input.quantity,
    max_slippage_bps: input.max_slippage_bps ?? 1200,
    quote_snapshot: quoteRes?.quote ?? null,
  });

  const chainName = String(quoteRes?.identity?.chain || "");
  const chain = await resolveStockChain(chainName);
  const { client, account, address } = await resolveSmartAccountForTrade(chain, user.id);
  await registerWallet(chain.chain, address);
  const routerAddress = chain.identity_router as `0x${string}`;
  const stableAddress = (chain.identity_stable_address || chain.usdc_address) as `0x${string}`;
  const tokenAddress = normalizeHex(String(quoteRes?.identity?.token_address || ""));
  if (!tokenAddress) throw new Error("Identity token address missing. Re-create identity on-chain or sync DB.");

  const storeId = String(quoteRes?.identity?.store_id || "");
  if (!storeId) throw new Error("Stock store reference missing.");
  const storeKey = storeKeyFromStoreId(storeId);
  const slippageBps = toNumber(input.max_slippage_bps, 1200);
  const publicClient = createPublicClient({ transport: http(String(chain.rpc_url || "")) });
  const poolAddress = normalizeHex(String(quoteRes?.identity?.pool_address || ""));
  const symbol = String(quoteRes?.identity?.symbol || "TOKEN").trim() || "TOKEN";
  let approvalSubmitted = false;
  let tradeCfgCache: any = null;

  let tradeData: `0x${string}`;
  if (input.side === "buy") {
    const amountInRaw = toRaw(toNumber(quoteRes?.quote?.notional_usdc, 0), 6, 6);
    const quotedOut = toNumber(quoteRes?.quote?.quantity, 0);
    if (amountInRaw <= 0n || quotedOut <= 0) throw new Error("Invalid buy quote amount.");
    let quotedOutRaw = toRaw(quotedOut, 18, 12);
    if (quotedOutRaw <= 0n) throw new Error("Invalid buy quote amount.");

    const maxTrade = await resolveBootstrapMaxTrade(publicClient, {
      routerAddress,
      storeKey: storeKey as `0x${string}`,
      tokenIn: stableAddress,
      fallbackPool: poolAddress,
    });
    tradeCfgCache = (maxTrade as any)?.tradeCfg ?? null;
    if (tradeCfgCache && tradeCfgCache.enabled === false) {
      throw new Error("Trading is not enabled for this stock yet.");
    }
    if (tradeCfgCache && normalizeHex(String(tradeCfgCache.stableToken || "")) && normalizeHex(String(tradeCfgCache.stableToken || "")) !== stableAddress) {
      throw new Error("Stable token mismatch for this stock. Please re-sync the stock identity.");
    }
    const maxAllowed = maxTrade ? bufferedMaxTrade(maxTrade.maxTradeRaw) : 0n;
    if (maxTrade && (maxAllowed <= 0n || amountInRaw > maxAllowed)) {
      throw new Error(
        `Order exceeds current on-chain max size (${formatUsdc6(maxAllowed)} USDC). Try a smaller amount.`,
      );
    }

    const stableBalance = await publicClient.readContract({
      abi: ERC20_ABI,
      address: stableAddress,
      functionName: "balanceOf",
      args: [address as `0x${string}`],
    }) as bigint;
    if (stableBalance < amountInRaw) {
      throw new Error(`Insufficient USDC balance. Need ${formatUsdc6(amountInRaw)} USDC.`);
    }

    const allowance = await publicClient.readContract({
      abi: ERC20_ABI,
      address: stableAddress,
      functionName: "allowance",
      args: [address as `0x${string}`, routerAddress],
    }) as bigint;
    if (allowance < amountInRaw) {
      const approveData = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [routerAddress, UINT256_MAX],
      });
      await withTimeout(
        (client as any).sendTransaction({
          account,
          to: stableAddress,
          data: approveData,
        }),
        90_000,
        "Approve transaction timed out in wallet. Retry and approve the request in your wallet app.",
      );
      approvalSubmitted = true;
    }

    const quoteImpactBps = toNumber(quoteRes?.quote?.price_impact_bps, 0);
    const launchGuardActive = Boolean(quoteRes?.quote?.launch_guard_active);
    const slippagePlan = buildAdaptiveSlippagePlan(slippageBps, quoteImpactBps, launchGuardActive);
    let refreshedFromOnchainPreview = false;

    try {
      const preview = await publicClient.simulateContract({
        abi: IDENTITY_ROUTER_ABI,
        address: routerAddress,
        functionName: "buyExactIn",
        args: [storeKey as `0x${string}`, amountInRaw, 0n, 0n],
        account: address as `0x${string}`,
      });
      const previewOutRaw = toBigIntSafe((preview as any)?.result);
      if (previewOutRaw > 0n) {
        quotedOutRaw = previewOutRaw;
        refreshedFromOnchainPreview = true;
      }
    } catch (e: any) {
      const reason = shortRevertReason(e).toLowerCase();
      if (reason.includes("max trade")) {
        throw new Error("Order exceeds current on-chain max size. Try a smaller amount.");
      }
      if (reason.includes("cooldown")) {
        throw new Error("Trade cooldown is active. Wait a few seconds and retry.");
      }
      if (reason.includes("twap deviation")) {
        throw new Error("Price moved too far from TWAP. Wait briefly and retry.");
      }
      if (!(approvalSubmitted && isAllowanceSimulationReason(reason))) {
        // Quote endpoint is off-chain and can lag. If preview fails for unknown reason, keep adaptive slippage fallback.
      }
    }

    let amountOutMinRaw = 0n;
    let preflightPassed = false;
    let sawTooLittleReceived = false;
    let lastReason = "";

    for (const slippageTryBps of slippagePlan) {
      const minOut = minOutFromExpectedRaw(quotedOutRaw, slippageTryBps);
      amountOutMinRaw = minOut;

      try {
        await publicClient.simulateContract({
          abi: IDENTITY_ROUTER_ABI,
          address: routerAddress,
          functionName: "buyExactIn",
          args: [storeKey as `0x${string}`, amountInRaw, amountOutMinRaw, 0n],
          account: address as `0x${string}`,
        });
        preflightPassed = true;
        break;
      } catch (e: any) {
        const reason = shortRevertReason(e).toLowerCase();
        lastReason = reason;
        if (reason.includes("max trade")) {
          throw new Error("Order exceeds current on-chain max size. Try a smaller amount.");
        }
        if (reason.includes("cooldown")) {
          throw new Error("Trade cooldown is active. Wait a few seconds and retry.");
        }
        if (reason.includes("twap deviation")) {
          throw new Error("Price moved too far from TWAP. Wait briefly and retry.");
        }
        if (approvalSubmitted && isAllowanceSimulationReason(reason)) {
          // Approval may still be pending in mempool while simulation runs on latest confirmed state.
          preflightPassed = true;
          break;
        }
        if (isTooLittleReceivedReason(reason)) {
          sawTooLittleReceived = true;
          if (!refreshedFromOnchainPreview) {
            try {
              const preview = await publicClient.simulateContract({
                abi: IDENTITY_ROUTER_ABI,
                address: routerAddress,
                functionName: "buyExactIn",
                args: [storeKey as `0x${string}`, amountInRaw, 0n, 0n],
                account: address as `0x${string}`,
              });
              const previewOutRaw = toBigIntSafe((preview as any)?.result);
              if (previewOutRaw > 0n) {
                quotedOutRaw = previewOutRaw;
                refreshedFromOnchainPreview = true;
              }
            } catch {
              // keep original quote-based fallback path
            }
          }
          continue;
        }
        throw new Error(reason ? `Cannot submit buy yet: ${reason}` : "Cannot submit buy yet due to on-chain guardrails.");
      }
    }

    if (!preflightPassed || amountOutMinRaw <= 0n) {
      if (sawTooLittleReceived) {
        throw new Error(
          "Cannot submit buy yet: pool price moved during quote. We refreshed quote safeguards, but price is still moving fast. Retry now or use a smaller amount.",
        );
      }
      throw new Error(lastReason ? `Cannot submit buy yet: ${lastReason}` : "Cannot submit buy yet due to on-chain guardrails.");
    }

    tradeData = encodeFunctionData({
      abi: IDENTITY_ROUTER_ABI,
      functionName: "buyExactIn",
      args: [storeKey as `0x${string}`, amountInRaw, amountOutMinRaw, 0n],
    });
  } else {
    const quotedInQty = toNumber(quoteRes?.quote?.quantity, 0);
    const quotedOutUsdc = toNumber(quoteRes?.quote?.notional_usdc, 0);
    const amountInRaw = toRaw(quotedInQty, 18, 12);
    if (amountInRaw <= 0n || quotedOutUsdc <= 0) throw new Error("Invalid sell quote amount.");
    let quotedOutRaw = toRaw(quotedOutUsdc, 6, 6);
    if (quotedOutRaw <= 0n) throw new Error("Invalid sell quote amount.");

    const maxTrade = await resolveBootstrapMaxTrade(publicClient, {
      routerAddress,
      storeKey: storeKey as `0x${string}`,
      tokenIn: tokenAddress,
      fallbackPool: poolAddress,
    });
    tradeCfgCache = (maxTrade as any)?.tradeCfg ?? null;
    if (tradeCfgCache && tradeCfgCache.enabled === false) {
      throw new Error("Trading is not enabled for this stock yet.");
    }
    if (tradeCfgCache && normalizeHex(String(tradeCfgCache.identityToken || "")) && normalizeHex(String(tradeCfgCache.identityToken || "")) !== tokenAddress) {
      throw new Error("Token mismatch for this stock. Please re-sync the stock identity.");
    }
    const maxAllowed = maxTrade ? bufferedMaxTrade(maxTrade.maxTradeRaw) : 0n;
    if (maxTrade && (maxAllowed <= 0n || amountInRaw > maxAllowed)) {
      throw new Error(
        `Order exceeds current on-chain max size (${formatToken18(maxAllowed)} ${symbol}). Try a smaller quantity.`,
      );
    }

    const tokenBalance = await publicClient.readContract({
      abi: ERC20_ABI,
      address: tokenAddress,
      functionName: "balanceOf",
      args: [address as `0x${string}`],
    }) as bigint;
    if (tokenBalance < amountInRaw) {
      throw new Error(`Insufficient ${symbol} balance. Need ${formatToken18(amountInRaw)} ${symbol}.`);
    }

    const allowance = await publicClient.readContract({
      abi: ERC20_ABI,
      address: tokenAddress,
      functionName: "allowance",
      args: [address as `0x${string}`, routerAddress],
    }) as bigint;
    if (allowance < amountInRaw) {
      const approveData = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [routerAddress, UINT256_MAX],
      });
      await withTimeout(
        (client as any).sendTransaction({
          account,
          to: tokenAddress,
          data: approveData,
        }),
        90_000,
        "Approve transaction timed out in wallet. Retry and approve the request in your wallet app.",
      );
      approvalSubmitted = true;
    }

    const quoteImpactBps = toNumber(quoteRes?.quote?.price_impact_bps, 0);
    const launchGuardActive = Boolean(quoteRes?.quote?.launch_guard_active);
    const slippagePlan = buildAdaptiveSlippagePlan(slippageBps, quoteImpactBps, launchGuardActive);
    let refreshedFromOnchainPreview = false;

    try {
      const preview = await publicClient.simulateContract({
        abi: IDENTITY_ROUTER_ABI,
        address: routerAddress,
        functionName: "sellExactIn",
        args: [storeKey as `0x${string}`, amountInRaw, 0n, 0n],
        account: address as `0x${string}`,
      });
      const previewOutRaw = toBigIntSafe((preview as any)?.result);
      if (previewOutRaw > 0n) {
        quotedOutRaw = previewOutRaw;
        refreshedFromOnchainPreview = true;
      }
    } catch (e: any) {
      const reason = shortRevertReason(e).toLowerCase();
      if (reason.includes("max trade")) {
        throw new Error("Order exceeds current on-chain max size. Try a smaller quantity.");
      }
      if (reason.includes("cooldown")) {
        throw new Error("Trade cooldown is active. Wait a few seconds and retry.");
      }
      if (reason.includes("twap deviation")) {
        throw new Error("Price moved too far from TWAP. Wait briefly and retry.");
      }
      if (!(approvalSubmitted && isAllowanceSimulationReason(reason))) {
        // Quote endpoint is off-chain and can lag. If preview fails for unknown reason, keep adaptive slippage fallback.
      }
    }

    let amountOutMinRaw = 0n;
    let preflightPassed = false;
    let sawTooLittleReceived = false;
    let lastReason = "";

    for (const slippageTryBps of slippagePlan) {
      const minOut = minOutFromExpectedRaw(quotedOutRaw, slippageTryBps);
      amountOutMinRaw = minOut;

      try {
        await publicClient.simulateContract({
          abi: IDENTITY_ROUTER_ABI,
          address: routerAddress,
          functionName: "sellExactIn",
          args: [storeKey as `0x${string}`, amountInRaw, amountOutMinRaw, 0n],
          account: address as `0x${string}`,
        });
        preflightPassed = true;
        break;
      } catch (e: any) {
        const reason = shortRevertReason(e).toLowerCase();
        lastReason = reason;
        if (reason.includes("max trade")) {
          throw new Error("Order exceeds current on-chain max size. Try a smaller quantity.");
        }
        if (reason.includes("cooldown")) {
          throw new Error("Trade cooldown is active. Wait a few seconds and retry.");
        }
        if (reason.includes("twap deviation")) {
          throw new Error("Price moved too far from TWAP. Wait briefly and retry.");
        }
        if (approvalSubmitted && isAllowanceSimulationReason(reason)) {
          // Approval may still be pending in mempool while simulation runs on latest confirmed state.
          preflightPassed = true;
          break;
        }
        if (isTooLittleReceivedReason(reason)) {
          sawTooLittleReceived = true;
          if (!refreshedFromOnchainPreview) {
            try {
              const preview = await publicClient.simulateContract({
                abi: IDENTITY_ROUTER_ABI,
                address: routerAddress,
                functionName: "sellExactIn",
                args: [storeKey as `0x${string}`, amountInRaw, 0n, 0n],
                account: address as `0x${string}`,
              });
              const previewOutRaw = toBigIntSafe((preview as any)?.result);
              if (previewOutRaw > 0n) {
                quotedOutRaw = previewOutRaw;
                refreshedFromOnchainPreview = true;
              }
            } catch {
              // keep original quote-based fallback path
            }
          }
          continue;
        }
        throw new Error(reason ? `Cannot submit sell yet: ${reason}` : "Cannot submit sell yet due to on-chain guardrails.");
      }
    }

    if (!preflightPassed || amountOutMinRaw <= 0n) {
      if (sawTooLittleReceived) {
        throw new Error(
          "Cannot submit sell yet: pool price moved during quote. We refreshed quote safeguards, but price is still moving fast. Retry now or use a smaller quantity.",
        );
      }
      throw new Error(lastReason ? `Cannot submit sell yet: ${lastReason}` : "Cannot submit sell yet due to on-chain guardrails.");
    }

    tradeData = encodeFunctionData({
      abi: IDENTITY_ROUTER_ABI,
      functionName: "sellExactIn",
      args: [storeKey as `0x${string}`, amountInRaw, amountOutMinRaw, 0n],
    });
  }

  const sendResult = await withTimeout(
    (client as any).sendTransaction({
      account,
      to: routerAddress,
      data: tradeData,
    }),
    120_000,
    "Transaction submission timed out. Check wallet activity and retry.",
  );
  const { txHash, userOpHash } = await withTimeout(
    resolveTxHash(chain, sendResult),
    80_000,
    "Transaction hash resolution timed out. Check wallet activity and retry.",
  );

  if (!txHash.startsWith("0x")) {
    throw new Error("Trade submitted but transaction hash is not available yet. Retry in a few seconds.");
  }
  await writeTradeDraft({ tx_hash: txHash, user_op_hash: userOpHash || undefined });

  await withTimeout(
    publicClient.waitForTransactionReceipt({
      hash: txHash as `0x${string}`,
      confirmations: 1,
      timeout: 120_000,
    }),
    140_000,
    "Transaction confirmation timed out. If your wallet shows success, use Repair Last Trade shortly.",
  );

  try {
    const out = await withTimeout(
      submitStockOrderWithRetry({
        slug: input.slug,
        side: input.side,
        amount_usdc: input.amount_usdc,
        quantity: input.quantity,
        max_slippage_bps: input.max_slippage_bps ?? 1200,
        tx_hash: txHash,
        user_op_hash: userOpHash || undefined,
        execution_mode: "onchain",
        quote_snapshot: quoteRes?.quote ?? null,
      }),
      40_000,
      "Trade confirmed, but indexing is taking longer than expected.",
    );

    return {
      ...out,
      tx_hash: txHash,
      user_op_hash: userOpHash || null,
      explorer_url: explorerTxUrl(chain.chain, txHash),
      quote: quoteRes?.quote ?? null,
    };
  } catch (indexErr: any) {
    return {
      ok: true,
      order_id: null,
      trade: null,
      identity: quoteRes?.identity ?? null,
      wallet: { address, chain: chain.chain },
      execution: {
        mode: "onchain",
        status: "PENDING_INDEX",
        index_error: String(indexErr?.message || indexErr || "index_pending"),
      },
      tx_hash: txHash,
      user_op_hash: userOpHash || null,
      explorer_url: explorerTxUrl(chain.chain, txHash),
      quote: quoteRes?.quote ?? null,
    };
  }
}
