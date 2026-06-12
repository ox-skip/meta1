import { createPublicClient, createWalletClient, custom, http } from "viem";
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
const ARC_TESTNET_CHAIN_ID = 5042002;
const ARC_TESTNET_USDC_NATIVE = { name: "USDC", symbol: "USDC", decimals: 18 };
const ARC_TESTNET_PUBLIC_RPC = "https://rpc.testnet.arc.network";
const ARC_TESTNET_EXPLORER = "https://testnet.arcscan.app";

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
    [ARC_TESTNET_CHAIN_ID]: {
      id: ARC_TESTNET_CHAIN_ID,
      name: "Arc Testnet",
      nativeCurrency: ARC_TESTNET_USDC_NATIVE,
      rpcUrls: {
        default: { http: [ARC_TESTNET_PUBLIC_RPC] },
        public: { http: [ARC_TESTNET_PUBLIC_RPC] },
      },
      blockExplorers: {
        default: { name: "ArcScan", url: ARC_TESTNET_EXPLORER },
      },
      testnet: true,
    },
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

function envRpcUrlForChain(chainName?: string | null) {
  const normalized = String(chainName || "").trim().toLowerCase();
  const upper = normalized.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const aliases: Record<string, string[]> = {
    ethereum: ["ETH"],
    bnb: ["BSC"],
  };
  const prefixes = Array.from(new Set([upper, ...(aliases[normalized] ?? [])])).filter(Boolean);
  const names = prefixes.flatMap((prefix) => [
    `EXPO_PUBLIC_${prefix}_RPC_URL`,
    `EXPO_PUBLIC_${prefix}_ALCHEMY_RPC_URL`,
    `EXPO_PUBLIC_${prefix}_MAINNET_RPC_URL`,
    `EXPO_PUBLIC_${prefix}_MAINNET_ALCHEMY_RPC_URL`,
    `${prefix}_RPC_URL`,
    `${prefix}_ALCHEMY_RPC_URL`,
    `${prefix}_MAINNET_RPC_URL`,
    `${prefix}_MAINNET_ALCHEMY_RPC_URL`,
  ]);
  return names.map((name) => String((process.env as any)?.[name] || "").trim()).find(Boolean) || "";
}

function toHexChainId(chainId: number) {
  return `0x${chainId.toString(16)}`;
}

function isHexHash(value?: string | null) {
  return /^0x[a-fA-F0-9]{64}$/.test(String(value || "").trim());
}

function rpcQuantity(value: unknown) {
  if (value === undefined || value === null) return "0x0";
  try {
    const raw = typeof value === "bigint" ? value : BigInt(String(value));
    return `0x${raw.toString(16)}`;
  } catch {
    return "0x0";
  }
}

function toBigIntValue(value: unknown) {
  if (value === undefined || value === null) return 0n;
  try {
    return typeof value === "bigint" ? value : BigInt(String(value));
  } catch {
    return 0n;
  }
}

function formatWeiForDisplay(value: bigint) {
  if (value <= 0n) return "0";
  const whole = value / 1_000_000_000_000_000_000n;
  const frac = value % 1_000_000_000_000_000_000n;
  const fracText = frac.toString().padStart(18, "0").slice(0, 6).replace(/0+$/, "");
  return fracText ? `${whole.toString()}.${fracText}` : whole.toString();
}

function bestWalletError(err: unknown) {
  const candidates = [
    (err as any)?.shortMessage,
    (err as any)?.details,
    (err as any)?.cause?.shortMessage,
    (err as any)?.cause?.details,
    (err as any)?.cause?.message,
    (err as any)?.message,
    err,
  ];
  for (const value of candidates) {
    const text = String(value || "").trim();
    if (text && text !== "[object Object]") return text;
  }
  return "unknown wallet error";
}

function optionalEnv(name: string) {
  return String((process.env as any)?.[name] || "").trim();
}

function paymasterUrlForChainId(chainId: number) {
  if (chainId === 8453) {
    return (
      optionalEnv("EXPO_PUBLIC_BASE_PAYMASTER_URL") ||
      optionalEnv("EXPO_PUBLIC_BASE_PAYMASTER_RPC_URL") ||
      optionalEnv("EXPO_PUBLIC_BASE_GAS_MANAGER_URL") ||
      optionalEnv("EXPO_PUBLIC_ALCHEMY_BASE_PAYMASTER_URL")
    );
  }
  if (chainId === 84532) {
    return (
      optionalEnv("EXPO_PUBLIC_BASE_SEPOLIA_PAYMASTER_URL") ||
      optionalEnv("EXPO_PUBLIC_BASE_SEPOLIA_PAYMASTER_RPC_URL") ||
      optionalEnv("EXPO_PUBLIC_BASE_SEPOLIA_GAS_MANAGER_URL") ||
      optionalEnv("EXPO_PUBLIC_ALCHEMY_BASE_SEPOLIA_PAYMASTER_URL")
    );
  }
  return "";
}

function sendCallsCapabilities(chainId: number) {
  const paymasterUrl = paymasterUrlForChainId(chainId);
  return paymasterUrl ? { paymasterService: { url: paymasterUrl, optional: true } } : undefined;
}

function firstHashFromCallsValue(value: unknown) {
  const raw = typeof value === "string" ? value : String((value as any)?.id || "");
  const match = raw.match(/0x[a-fA-F0-9]{64}/);
  return match?.[0] || "";
}

function callBundleId(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  const id = String((value as any)?.id || "").trim();
  return id || "";
}

function callsStatusTxHash(status: unknown) {
  const candidates = [
    (status as any)?.receipts?.[0]?.transactionHash,
    (status as any)?.receipt?.transactionHash,
    (status as any)?.transactionHash,
  ];
  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (isHexHash(value)) return value;
  }
  return "";
}

function isCallsStatusFailureMessage(value: unknown) {
  const msg = String(value || "").toLowerCase();
  return msg.includes("failed") || msg.includes("reverted") || msg.includes("rejected");
}

function isUnsupportedWalletSendCallsError(err: unknown) {
  const msg = bestWalletError(err).toLowerCase();
  return (
    msg.includes("unsupported method") ||
    msg.includes("method not found") ||
    msg.includes("method not supported") ||
    msg.includes("unsupported wc_ method") ||
    msg.includes("doesn't has corresponding handler") ||
    msg.includes("does not have corresponding handler") ||
    (
      msg.includes("wallet_sendcalls") &&
      (
        msg.includes("unsupported") ||
        msg.includes("not supported") ||
        msg.includes("does not exist") ||
        msg.includes("not available")
      )
    )
  );
}

async function waitForWalletCallsTxHash(provider: any, id: string, timeoutMs = 75_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const status = await provider.request({
        method: "wallet_getCallsStatus",
        params: [id],
      });
      const txHash = callsStatusTxHash(status);
      if (txHash) return txHash;

      const state = String((status as any)?.status || "").toLowerCase();
      if (["failure", "failed", "reverted"].includes(state)) {
        throw new Error(String((status as any)?.message || (status as any)?.error || "wallet_sendCalls failed"));
      }
    } catch (err: any) {
      const msg = String(err?.message || err || "").toLowerCase();
      if (isCallsStatusFailureMessage(msg)) {
        throw err;
      }
      if (msg.includes("unsupported") || msg.includes("not supported") || msg.includes("method not found")) return "";
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return "";
}

async function sendSmartWalletCall(args: {
  provider: any;
  chainId: number;
  from: `0x${string}`;
  to: `0x${string}`;
  data?: `0x${string}`;
  value?: unknown;
}) {
  try {
    const capabilities = sendCallsCapabilities(args.chainId);
    const result = await args.provider.request({
      method: "wallet_sendCalls",
      params: [
        {
          version: "2.0.0",
          chainId: toHexChainId(args.chainId),
          from: args.from,
          atomicRequired: false,
          ...(capabilities ? { capabilities } : {}),
          calls: [
            {
              to: args.to,
              data: args.data || "0x",
              value: rpcQuantity(args.value),
            },
          ],
        },
      ],
    });

    const id = callBundleId(result);
    let statusHash = "";
    if (id) {
      try {
        statusHash = await waitForWalletCallsTxHash(args.provider, id);
      } catch (statusErr) {
        if (isCallsStatusFailureMessage(bestWalletError(statusErr))) throw statusErr;
      }
    }
    const immediateHash = firstHashFromCallsValue(result);
    const hash = statusHash || immediateHash;
    if (!hash) {
      throw new Error("Base smart wallet did not return a transaction hash.");
    }
    return { hash, callsId: id || null };
  } catch (err: any) {
    throw new Error(`Embedded smart wallet failed to send transaction: ${bestWalletError(err)}`);
  }
}

async function ensureWalletHasDirectGas(args: {
  rpcUrl: string;
  chainName?: string | null;
  nativeSymbol?: string | null;
  from: `0x${string}`;
  value?: unknown;
}) {
  if (!args.rpcUrl) return;
  try {
    const publicClient = createPublicClient({ transport: http(args.rpcUrl) });
    const balance = await publicClient.getBalance({ address: args.from });
    const value = toBigIntValue(args.value);
    if (balance > value) return;

    const chainName = String(args.chainName || "this chain");
    const symbol = String(args.nativeSymbol || "ETH");
    throw new Error(
      `This WalletConnect wallet needs ${symbol} on ${chainName} for gas. ` +
        `It currently has ${formatWeiForDisplay(balance)} ${symbol}. ` +
        `Fund ${args.from} with a small amount of ${symbol}, or use a wallet that already has gas.`,
    );
  } catch (err: any) {
    const msg = String(err?.message || err || "");
    if (msg.includes("needs") && msg.includes("for gas")) throw err;
  }
}

function preferredSenderAddress(session: ReturnType<typeof getActiveWalletSession>, fallback: string) {
  const smart = Array.isArray(session.smartAccounts)
    ? session.smartAccounts.find((account) => isAddress(String(account || "")))
    : "";
  if (String(session.accountType || "").toLowerCase().includes("smart") && smart) {
    return smart as `0x${string}`;
  }
  return fallback as `0x${string}`;
}

function buildChainForWallet(chainConfig: MarketChainConfig, chainOverride?: any) {
  if (chainOverride) return chainOverride;
  const chainId = normalizeChainId((chainConfig as any).chain_id);
  const fallback = getFallbackChainById(chainId);
  if (fallback) return fallback;

  const rpc = String(chainConfig.rpc_url || "").trim();
  const isArcTestnet = chainId === ARC_TESTNET_CHAIN_ID || String(chainConfig.chain || "").toLowerCase() === "arc_testnet";
  return {
    id: chainId,
    name: isArcTestnet ? "Arc Testnet" : String(chainConfig.chain || `Chain ${chainId}`),
    nativeCurrency: isArcTestnet ? ARC_TESTNET_USDC_NATIVE : { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: {
      default: { http: rpc ? [rpc] : [] },
      public: { http: rpc ? [rpc] : [] },
    },
    blockExplorers: isArcTestnet ? { default: { name: "ArcScan", url: ARC_TESTNET_EXPLORER } } : undefined,
    testnet: isArcTestnet || undefined,
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
  const chainId = normalizeChainId((chainConfig as any).chain_id);
  const activeSession = getActiveWalletSession();
  const senderAddress = preferredSenderAddress(activeSession, address);

  const walletClient = createWalletClient({
    chain: chain as any,
    transport: custom(provider as any),
  });

  const client = {
    account: senderAddress,
    sendTransaction: async (args: any) => {
      await ensureProviderChain(chain, chainConfig, provider);

      const from = String(args?.account || args?.from || senderAddress);
      const to = String(args?.to || "");
      if (!isAddress(from)) throw new Error("Missing valid sender wallet address.");
      if (!isAddress(to)) throw new Error("Missing valid recipient contract/wallet address.");

      const session = getActiveWalletSession();
      const txFrom = preferredSenderAddress(session, from);
      if (session.mode === "walletconnect" && !paymasterUrlForChainId(chainId)) {
        await ensureWalletHasDirectGas({
          rpcUrl,
          chainName: String(chain?.name || chainConfig.chain || "Base"),
          nativeSymbol: String(chain?.nativeCurrency?.symbol || "ETH"),
          from: txFrom,
          value: args?.value,
        });
      }

      const useWalletSendCalls =
        session.mode === "base_smart";
      const smartCallArgs = {
        provider,
        chainId,
        from: txFrom,
        to: to as `0x${string}`,
        data: (args?.data as `0x${string}` | undefined) ?? undefined,
        value: args?.value,
      };
      if (useWalletSendCalls) {
        try {
          return await sendSmartWalletCall(smartCallArgs);
        } catch (smartErr) {
          if (!isUnsupportedWalletSendCallsError(smartErr)) {
            throw smartErr;
          }
        }
      }

      const hash = await walletClient.sendTransaction({
        account: txFrom,
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
          account: args?.account || senderAddress,
          ...req,
        });
        last = String(out?.hash || "");
      }
      return { hash: last || null };
    },
  };

  return {
    chain,
    account: senderAddress,
    client,
    address: senderAddress,
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
  const envRpc = envRpcUrlForChain((chainConfig as any).chain);
  const configuredRpc = String(chainConfig.rpc_url || "").trim();

  if (chainId === ARC_TESTNET_CHAIN_ID || String((chainConfig as any).chain || "").toLowerCase() === "arc_testnet") {
    return envRpc || configuredRpc || chain?.rpcUrls?.default?.http?.[0] || ARC_TESTNET_PUBLIC_RPC;
  }

  return (
    explicitAlchemy ||
    envRpc ||
    (apiKey && chain?.rpcUrls?.alchemy?.http?.[0]?.replace("${ALCHEMY_API_KEY}", apiKey)) ||
    configuredRpc ||
    chain?.rpcUrls?.default?.http?.[0] ||
    ""
  );
}
