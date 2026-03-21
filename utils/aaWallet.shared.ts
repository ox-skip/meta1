import { createWalletClient, custom } from "viem";
import { arbitrum, base, mainnet, optimism, polygon } from "viem/chains";

import { connectActiveWalletEvm, getActiveWalletEip155Provider, getActiveWalletSession } from "@/services/wallet/activeWalletSession";

export type MarketChainConfig = {
  chain: string;
  chain_id: number;
  rpc_url: string | null;
  usdc_address: string;
  escrow_address: string;
  identity_factory?: string | null;
  identity_router?: string | null;
  identity_name_registry?: string | null;
  identity_stable_address?: string | null;
  confirmations_required: number;
  active: boolean;
};

const EXTERNAL_WALLET_SENTINEL_PK = `0x${"f".repeat(64)}` as `0x${string}`;

function isAddress(value: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || ""));
}

function normalizeChainId(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function cleanAlchemyApiKey(raw?: string) {
  const value = String(raw || "").trim();
  if (!value) return "";
  return value.replace(/^https?:\/\/[^/]+\/v2\//i, "");
}

function getFallbackChainById(chainId: number) {
  const map: Record<number, any> = {
    8453: base,
    1: mainnet,
    137: polygon,
    42161: arbitrum,
    10: optimism,
  };
  return map[chainId] ?? null;
}

function alchemyUrlForChainId(chainId: number, apiKey?: string) {
  const safeApiKey = cleanAlchemyApiKey(apiKey);
  if (!safeApiKey) return "";
  const map: Record<number, string> = {
    8453: `https://base-mainnet.g.alchemy.com/v2/${safeApiKey}`,
    1: `https://eth-mainnet.g.alchemy.com/v2/${safeApiKey}`,
    137: `https://polygon-mainnet.g.alchemy.com/v2/${safeApiKey}`,
    42161: `https://arb-mainnet.g.alchemy.com/v2/${safeApiKey}`,
    10: `https://opt-mainnet.g.alchemy.com/v2/${safeApiKey}`,
  };
  return map[chainId] ?? "";
}

function toHexChainId(chainId: number) {
  return `0x${chainId.toString(16)}`;
}

function buildChainForWallet(chainConfig: MarketChainConfig, chainOverride?: any) {
  if (chainOverride) return chainOverride;
  const chainId = normalizeChainId((chainConfig as any).chain_id);
  const fallback = getFallbackChainById(chainId);
  if (fallback) return fallback;

  const rpc = String(chainConfig.rpc_url || "").trim();
  return {
    id: chainId,
    name: String(chainConfig.chain || `Chain ${chainId}`),
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: {
      default: { http: rpc ? [rpc] : [] },
      public: { http: rpc ? [rpc] : [] },
    },
  } as any;
}

async function getCurrentProviderChainId(provider: any) {
  try {
    const raw = String(await provider.request({ method: "eth_chainId" }));
    if (/^0x[0-9a-fA-F]+$/.test(raw)) return Number.parseInt(raw, 16);
  } catch {
    // ignore provider read errors
  }

  const session = getActiveWalletSession();
  return normalizeChainId(session.chainId);
}

async function ensureProviderChain(chain: any, chainConfig: MarketChainConfig, provider: any) {
  const chainId = normalizeChainId((chainConfig as any).chain_id);
  if (!chainId) throw new Error(`Invalid chain_id for ${chainConfig.chain}`);

  const current = await getCurrentProviderChainId(provider);
  if (current === chainId) return;

  const session = getActiveWalletSession();
  if (session.runtime.switchNetwork) {
    try {
      await Promise.resolve(session.runtime.switchNetwork(`eip155:${chainId}`));
      const postSwitch = await getCurrentProviderChainId(provider);
      if (postSwitch === chainId) return;
    } catch {
      // continue with provider RPC fallback
    }
  }

  const targetHex = toHexChainId(chainId);

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: targetHex }],
    });
    return;
  } catch (switchErr: any) {
    const code = Number(switchErr?.code);
    if (code !== 4902 && code !== -32603) {
      throw new Error(switchErr?.message || `Unable to switch wallet network to ${chainConfig.chain}.`);
    }
  }

  const rpcUrl = getRpcUrlForChain(chainConfig, chain);
  if (!rpcUrl) throw new Error(`Missing RPC URL for ${chainConfig.chain}.`);

  const explorer = String(chain?.blockExplorers?.default?.url || "").trim();
  try {
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: targetHex,
          chainName: String(chain?.name || chainConfig.chain || `Chain ${chainId}`),
          nativeCurrency: chain?.nativeCurrency || { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: [rpcUrl],
          blockExplorerUrls: explorer ? [explorer] : undefined,
        },
      ],
    });
  } catch (addErr: any) {
    throw new Error(addErr?.message || `Unable to add ${chainConfig.chain} to wallet.`);
  }

  await provider.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: targetHex }],
  });
}

export function normalizePrivateKey(rawKey: string): `0x${string}` {
  const trimmed = String(rawKey || "").trim();
  const cleaned = trimmed.replace(/\s+/g, "");
  const hex = cleaned.startsWith("0x") ? cleaned.slice(2) : cleaned;
  if (/^[a-fA-F0-9]{64}$/.test(hex)) {
    return `0x${hex}` as `0x${string}`;
  }
  throw new Error("Private key must be 64 hex chars (with or without 0x).");
}

export async function getOrCreatePrivateKey(_scope?: string | null): Promise<`0x${string}`> {
  await connectActiveWalletEvm();
  return EXTERNAL_WALLET_SENTINEL_PK;
}

export async function getStoredPrivateKey(_scope?: string | null): Promise<`0x${string}` | null> {
  const session = getActiveWalletSession();
  return session.connected && isAddress(session.address) ? EXTERNAL_WALLET_SENTINEL_PK : null;
}

export async function getWalletBackupSecret(_scope?: string | null) {
  throw new Error("Backup and recovery are managed by the connected wallet. This app does not store private keys.");
}

export async function hasWalletBackup(_scope?: string | null) {
  return true;
}

export async function markWalletBackedUp(_scope?: string | null) {
  // External wallet backup is managed by the wallet provider.
}

export async function regenerateWalletKey(_scope?: string | null) {
  throw new Error("Regenerate is not supported. Manage accounts from your connected wallet.");
}

export async function getScopedWalletAddress(_scope?: string | null) {
  const connected = await connectActiveWalletEvm();
  if (!isAddress(connected.address)) throw new Error("Wallet connection failed. No valid address returned.");
  return connected.address as `0x${string}`;
}

async function ensureConnectedProviderAndAddress(chainConfig: MarketChainConfig) {
  const chainId = normalizeChainId((chainConfig as any).chain_id);
  if (!chainId) {
    throw new Error(`Invalid chain_id for ${chainConfig.chain}`);
  }

  const chain = buildChainForWallet(chainConfig);
  const rpcUrl = getRpcUrlForChain(chainConfig, chain);
  if (!rpcUrl) {
    throw new Error("Missing RPC URL or Alchemy API key.");
  }

  const { provider, address } = await getActiveWalletEip155Provider();
  if (!isAddress(address)) {
    throw new Error("Wallet connection failed. No valid wallet address returned.");
  }

  await ensureProviderChain(chain, chainConfig, provider);

  return {
    provider,
    chain,
    address: address as `0x${string}`,
    rpcUrl,
  };
}

export async function getSmartAccount(chainConfig: MarketChainConfig, _scope?: string | null) {
  const { provider, chain, address, rpcUrl } = await ensureConnectedProviderAndAddress(chainConfig);

  const walletClient = createWalletClient({
    chain: chain as any,
    transport: custom(provider as any),
  });

  const client = {
    account: address as `0x${string}`,
    sendTransaction: async (args: any) => {
      await ensureProviderChain(chain, chainConfig, provider);

      const from = String(args?.account || args?.from || address);
      const to = String(args?.to || "");
      if (!isAddress(from)) throw new Error("Missing valid sender wallet address.");
      if (!isAddress(to)) throw new Error("Missing valid recipient contract/wallet address.");

      const hash = await walletClient.sendTransaction({
        account: from as `0x${string}`,
        to: to as `0x${string}`,
        data: (args?.data as `0x${string}` | undefined) ?? undefined,
        value:
          args?.value === undefined || args?.value === null
            ? undefined
            : (typeof args.value === "bigint" ? args.value : BigInt(String(args.value))),
        chain: chain as any,
      });

      return { hash: String(hash || "") };
    },
    sendTransactions: async (args: any) => {
      const requests = Array.isArray(args?.requests) ? args.requests : [];
      let last = "";
      for (const req of requests) {
        const out = await (client as any).sendTransaction({
          account: args?.account || address,
          ...req,
        });
        last = String(out?.hash || "");
      }
      return { hash: last || null };
    },
  };

  return {
    chain,
    account: address as `0x${string}`,
    client,
    address: address as `0x${string}`,
    rpcUrl,
  };
}

export async function deriveSmartAccountAddress(_chainConfig: MarketChainConfig, _privateKey: `0x${string}`) {
  const connected = await connectActiveWalletEvm();
  if (!isAddress(connected.address)) {
    throw new Error("Connect wallet first.");
  }
  return connected.address as `0x${string}`;
}

export async function getWalletPrivateKey(_scope?: string | null) {
  throw new Error("Private key access is disabled. Use your connected external wallet.");
}

export async function importPrivateKey(_scope: string | null | undefined, _rawKey: string) {
  const connected = await connectActiveWalletEvm();
  if (!isAddress(connected.address)) {
    throw new Error("Wallet connection failed. No valid wallet address returned.");
  }
  return connected.address as `0x${string}`;
}

export function getRpcUrlForChain(chainConfig: MarketChainConfig, chainOverride?: any) {
  const chainId = normalizeChainId((chainConfig as any).chain_id);
  const chain = buildChainForWallet(chainConfig, chainOverride);
  const apiKey = cleanAlchemyApiKey(process.env.EXPO_PUBLIC_ALCHEMY_API_KEY);
  const explicitAlchemy = alchemyUrlForChainId(chainId, apiKey);

  return (
    explicitAlchemy ||
    (apiKey && chain?.rpcUrls?.alchemy?.http?.[0]?.replace("${ALCHEMY_API_KEY}", apiKey)) ||
    chainConfig.rpc_url ||
    chain?.rpcUrls?.default?.http?.[0] ||
    ""
  );
}
