import { formatUnits } from "viem";

import { callFn } from "@/services/functions";
import type { MarketChainConfig } from "@/services/market/chainConfig";
import { approveCircleChallenge } from "@/services/wallet/circleWalletSdk";

export type CircleWalletProvider = "circle";

export type CircleMarketWallet = {
  id: string;
  chain: string;
  blockchain: string;
  address: string;
  walletSetId?: string | null;
  accountType?: string | null;
  custodyType?: string | null;
};

export type CircleTokenBalance = {
  symbol: string;
  amount: number;
  decimals?: number | null;
  tokenAddress?: string | null;
  isNative?: boolean;
};

export type CircleChainBalance = {
  chain: string;
  blockchain: string;
  address: string;
  walletId: string;
  native?: CircleTokenBalance | null;
  usdc?: CircleTokenBalance | null;
  usdt?: CircleTokenBalance | null;
  tokens: CircleTokenBalance[];
};

type CircleSessionChallenge = {
  configured: boolean;
  requiresApproval?: boolean;
  challengeId?: string | null;
  userToken?: string | null;
  encryptionKey?: string | null;
  challenges?: Array<{
    env?: string | null;
    challengeId?: string | null;
    userToken?: string | null;
    encryptionKey?: string | null;
  }>;
  wallets?: CircleMarketWallet[];
  message?: string | null;
};

type CircleTxChallenge = CircleSessionChallenge & {
  refId: string;
  walletId: string;
};

const WAIT_STATES = new Set(["INITIATED", "QUEUED", "SENT", "STUCK", "PENDING"]);
const FAIL_STATES = new Set(["FAILED", "DENIED", "CANCELLED"]);

export function isCircleMarketWalletEnabled() {
  const raw = String(process.env.EXPO_PUBLIC_MARKET_WALLET_PROVIDER || process.env.EXPO_PUBLIC_CIRCLE_WALLET_ENABLED || "").trim().toLowerCase();
  return raw !== "external" && raw !== "walletconnect" && raw !== "0" && raw !== "false";
}

export function circleBlockchainForChain(chain?: string | null) {
  const key = String(chain || "").trim().toLowerCase();
  const map: Record<string, string> = {
    ethereum: "ETH",
    eth: "ETH",
    sepolia: "ETH-SEPOLIA",
    base: "BASE",
    base_sepolia: "BASE-SEPOLIA",
    arbitrum: "ARB",
    arbitrum_sepolia: "ARB-SEPOLIA",
    optimism: "OP",
    optimism_sepolia: "OP-SEPOLIA",
    polygon: "MATIC",
    polygon_amoy: "MATIC-AMOY",
    avalanche: "AVAX",
    avax: "AVAX",
    avalanche_fuji: "AVAX-FUJI",
    arc: "ARC",
    arc_testnet: "ARC-TESTNET",
    monad: "MONAD",
    monad_testnet: "MONAD-TESTNET",
    unichain: "UNI",
    unichain_sepolia: "UNI-SEPOLIA",
  };
  return map[key] || "";
}

export function isCircleSupportedChain(chain?: string | null) {
  return Boolean(circleBlockchainForChain(chain));
}

function isAddress(value?: string | null) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || "").trim());
}

function normalizeHash(value?: string | null) {
  const raw = String(value || "").trim();
  return /^0x[a-fA-F0-9]{64}$/.test(raw) ? raw : "";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeRefId(prefix: string, chain: string, extra?: string | null) {
  const cleanExtra = String(extra || "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 24);
  const stamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return ["bc", prefix, chain, cleanExtra, stamp, random].filter(Boolean).join("_").slice(0, 96);
}

function amountFromWei(value: unknown) {
  if (value === undefined || value === null) return undefined;
  try {
    const raw = typeof value === "bigint" ? value : BigInt(String(value));
    if (raw <= 0n) return undefined;
    return formatUnits(raw, 18);
  } catch {
    return undefined;
  }
}

async function circleAction<T>(action: string, body: Record<string, unknown> = {}, timeoutMs = 30000) {
  return await callFn<T>("circle-wallet", { action, ...body }, timeoutMs);
}

async function approveCircleChallenges(input: CircleSessionChallenge) {
  const challenges = Array.isArray(input.challenges) && input.challenges.length
    ? input.challenges
    : input.challengeId
      ? [
          {
            challengeId: input.challengeId,
            userToken: input.userToken,
            encryptionKey: input.encryptionKey,
          },
        ]
      : [];

  for (const challenge of challenges) {
    const challengeId = String(challenge.challengeId || "").trim();
    if (!challengeId) continue;
    await approveCircleChallenge({
      userToken: String(challenge.userToken || ""),
      encryptionKey: String(challenge.encryptionKey || ""),
      challengeId,
      env: challenge.env,
    });
  }
}

export async function getCircleWalletStatus(chains?: MarketChainConfig[]) {
  return await circleAction<{
    configured: boolean;
    wallets: CircleMarketWallet[];
    message?: string | null;
  }>("status", { chains: (chains ?? []).map((c) => c.chain) });
}

export async function syncCircleWallets(chains?: MarketChainConfig[]) {
  return await circleAction<{
    configured: boolean;
    wallets: CircleMarketWallet[];
    message?: string | null;
  }>("sync_wallets", { chains: (chains ?? []).map((c) => c.chain) }, 45000);
}

export async function createMarketCircleWallets(chains: MarketChainConfig[]) {
  const chainKeys = chains.filter((c) => isCircleSupportedChain(c.chain)).map((c) => c.chain);
  if (!chainKeys.length) {
    throw new Error("No Circle-supported EVM chains are configured for this market.");
  }

  const challenge = await circleAction<CircleSessionChallenge>("create_wallets", { chains: chainKeys }, 45000);
  if (!challenge.configured) {
    throw new Error(challenge.message || "Circle wallet is not configured.");
  }

  if (challenge.requiresApproval) {
    await approveCircleChallenges(challenge);
  }

  for (let i = 0; i < 8; i++) {
    const synced = await syncCircleWallets(chains);
    if (synced.wallets.length) return synced;
    await sleep(1500);
  }

  return await syncCircleWallets(chains);
}

export async function getCircleWalletForChain(chain: MarketChainConfig) {
  const status = await getCircleWalletStatus([chain]);
  const wanted = circleBlockchainForChain(chain.chain);
  return (
    status.wallets.find((wallet) => wallet.chain === chain.chain) ||
    status.wallets.find((wallet) => wallet.blockchain === wanted) ||
    null
  );
}

export async function ensureCircleWalletForChain(chain: MarketChainConfig) {
  const existing = await getCircleWalletForChain(chain);
  if (existing?.id && isAddress(existing.address)) return existing;

  const created = await createMarketCircleWallets([chain]);
  const wanted = circleBlockchainForChain(chain.chain);
  const wallet =
    created.wallets.find((row) => row.chain === chain.chain) ||
    created.wallets.find((row) => row.blockchain === wanted) ||
    null;
  if (!wallet?.id || !isAddress(wallet.address)) {
    throw new Error(`Circle wallet was not created for ${chain.chain}.`);
  }
  return wallet;
}

async function transactionByRef(input: { refId: string; walletId: string; chain: string }) {
  return await circleAction<{
    transaction: any | null;
  }>("transaction_by_ref", input, 20000);
}

export async function waitForCircleTransaction(input: {
  refId: string;
  walletId: string;
  chain: string;
  timeoutMs?: number;
}) {
  const timeoutMs = Number(input.timeoutMs || 120000);
  const started = Date.now();
  let lastState = "";

  while (Date.now() - started < timeoutMs) {
    const out = await transactionByRef(input);
    const tx = out.transaction;
    const txHash = normalizeHash(tx?.txHash || tx?.transactionHash || tx?.hash);
    if (txHash) return { txHash, transaction: tx };

    const state = String(tx?.state || "").toUpperCase();
    if (state) lastState = state;
    if (FAIL_STATES.has(state)) {
      throw new Error(String(tx?.errorReason || tx?.errorDetails || `Circle transaction ${state.toLowerCase()}.`));
    }
    if (state && !WAIT_STATES.has(state)) {
      throw new Error(`Circle transaction ended without a transaction hash (${state}).`);
    }

    await sleep(2500);
  }

  throw new Error(lastState ? `Circle transaction is still ${lastState.toLowerCase()}. Try refreshing in a moment.` : "Circle transaction hash was not available yet.");
}

export async function sendCircleContractExecution(input: {
  chain: MarketChainConfig;
  contractAddress: string;
  callData: string;
  value?: unknown;
  refId?: string;
}) {
  const wallet = await ensureCircleWalletForChain(input.chain);
  const refId = input.refId || makeRefId("contract", input.chain.chain);
  const challenge = await circleAction<CircleTxChallenge>(
    "contract_execution",
    {
      chain: input.chain.chain,
      walletId: wallet.id,
      contractAddress: input.contractAddress,
      callData: input.callData,
      amount: amountFromWei(input.value),
      refId,
    },
    45000,
  );

  if (!challenge.configured) {
    throw new Error(challenge.message || "Circle wallet is not configured.");
  }
  if (challenge.requiresApproval) {
    await approveCircleChallenges(challenge);
  }

  const settled = await waitForCircleTransaction({ refId, walletId: wallet.id, chain: input.chain.chain });
  return { hash: settled.txHash, txHash: settled.txHash, refId, wallet };
}

export async function sendCircleTokenTransfer(input: {
  chain: MarketChainConfig;
  tokenAddress: string;
  to: string;
  amount: string;
  symbol?: string;
  refId?: string;
}) {
  const wallet = await ensureCircleWalletForChain(input.chain);
  const refId = input.refId || makeRefId("transfer", input.chain.chain, input.symbol);
  const challenge = await circleAction<CircleTxChallenge>(
    "transfer",
    {
      chain: input.chain.chain,
      walletId: wallet.id,
      tokenAddress: input.tokenAddress,
      destinationAddress: input.to,
      amount: input.amount,
      refId,
    },
    45000,
  );

  if (!challenge.configured) {
    throw new Error(challenge.message || "Circle wallet is not configured.");
  }
  if (challenge.requiresApproval) {
    await approveCircleChallenges(challenge);
  }

  const settled = await waitForCircleTransaction({ refId, walletId: wallet.id, chain: input.chain.chain });
  return { hash: settled.txHash, txHash: settled.txHash, refId, wallet };
}

export async function fetchCircleChainBalances(chains: MarketChainConfig[]) {
  const out = await circleAction<{
    configured: boolean;
    balances: CircleChainBalance[];
    message?: string | null;
  }>("balances", { chains: chains.map((c) => c.chain) }, 45000);
  if (!out.configured) {
    throw new Error(out.message || "Circle wallet is not configured.");
  }
  return out.balances;
}

export async function getCircleMarketSmartAccount(chain: MarketChainConfig) {
  const wallet = await ensureCircleWalletForChain(chain);

  const client = {
    account: wallet.address as `0x${string}`,
    sendTransaction: async (args: any) => {
      const to = String(args?.to || "").trim();
      const data = String(args?.data || "0x").trim();
      if (!isAddress(to)) throw new Error("Missing valid transaction target.");
      if (!/^0x([a-fA-F0-9]{2})*$/.test(data)) throw new Error("Transaction data must be hex encoded.");
      return await sendCircleContractExecution({
        chain,
        contractAddress: to,
        callData: data,
        value: args?.value,
      });
    },
    sendTransactions: async (args: any) => {
      const requests = Array.isArray(args?.requests) ? args.requests : [];
      let last: any = null;
      for (const req of requests) {
        last = await (client as any).sendTransaction(req);
      }
      return last || { hash: "" };
    },
  };

  return {
    chain: {
      id: Number((chain as any).chain_id || 0),
      name: String(chain.chain || "Circle chain"),
    },
    account: wallet.address as `0x${string}`,
    client,
    address: wallet.address as `0x${string}`,
    rpcUrl: String(chain.rpc_url || ""),
    wallet,
  };
}
