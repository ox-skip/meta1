import * as SecureStore from "@/utils/secureStore";
import { supabase } from "@/services/supabase";
import { getSupabaseAnonKeyOrThrow, getSupabaseFunctionsBaseUrl } from "@/services/net";

export type MarketChainConfig = {
  chain: string;
  chain_id: number;
  rpc_url: string | null;
  usdc_address: string;
  usdt_address: string | null;
  escrow_address: string;
  faucet_address: string | null;
  faucet_active: boolean;
  faucet_cooldown_seconds: number;
  faucet_usdc_amount_raw: string | null;
  faucet_usdt_amount_raw: string | null;
  identity_factory?: string | null;
  identity_router?: string | null;
  identity_name_registry?: string | null;
  identity_stable_address?: string | null;
  confirmations_required: number;
  active: boolean;
};

const KEY_CHAIN = "bc_market_chain_pref_v2";
const MAINNET_CHAINS = new Set(["ethereum", "base", "arbitrum", "optimism", "polygon", "bnb"]);

function parseNumber(input: unknown, fallback: number) {
  const value = Number(input);
  return Number.isFinite(value) ? value : fallback;
}

function cleanAlchemyApiKey(raw?: string | null) {
  const value = String(raw || "").trim();
  if (!value) return "";
  return value.replace(/^https?:\/\/[^/]+\/v2\//i, "");
}

function alchemyUrlForChainId(chainId: number) {
  const apiKey = cleanAlchemyApiKey(process.env.EXPO_PUBLIC_ALCHEMY_API_KEY);
  if (!apiKey) return null;

  const urls: Record<number, string> = {
    1: `https://eth-mainnet.g.alchemy.com/v2/${apiKey}`,
    10: `https://opt-mainnet.g.alchemy.com/v2/${apiKey}`,
    56: `https://bnb-mainnet.g.alchemy.com/v2/${apiKey}`,
    137: `https://polygon-mainnet.g.alchemy.com/v2/${apiKey}`,
    8453: `https://base-mainnet.g.alchemy.com/v2/${apiKey}`,
    42161: `https://arb-mainnet.g.alchemy.com/v2/${apiKey}`,
  };

  return urls[chainId] ?? null;
}

function isSupportedMainnetChain(input: unknown) {
  return MAINNET_CHAINS.has(String(input || "").trim().toLowerCase());
}

export async function fetchMarketChains(): Promise<MarketChainConfig[]> {
  const normalize = (input: any): MarketChainConfig => {
    const chainId = parseNumber(input?.chain_id, 0);
    const rpcUrl = input?.rpc_url ? String(input.rpc_url) : alchemyUrlForChainId(chainId);

    return {
      chain: String(input?.chain ?? ""),
      chain_id: chainId,
      rpc_url: rpcUrl,
      usdc_address: String(input?.usdc_address ?? ""),
      usdt_address: input?.usdt_address ? String(input.usdt_address) : null,
      escrow_address: String(input?.escrow_address ?? ""),
      faucet_address: input?.faucet_address ? String(input.faucet_address) : null,
      faucet_active: Boolean(input?.faucet_active),
      faucet_cooldown_seconds: parseNumber(input?.faucet_cooldown_seconds, 0),
      faucet_usdc_amount_raw:
        input?.faucet_usdc_amount_raw === null || input?.faucet_usdc_amount_raw === undefined
          ? null
          : String(input?.faucet_usdc_amount_raw),
      faucet_usdt_amount_raw:
        input?.faucet_usdt_amount_raw === null || input?.faucet_usdt_amount_raw === undefined
          ? null
          : String(input?.faucet_usdt_amount_raw),
      identity_factory: input?.identity_factory ? String(input.identity_factory) : null,
      identity_router: input?.identity_router ? String(input.identity_router) : null,
      identity_name_registry: input?.identity_name_registry ? String(input.identity_name_registry) : null,
      identity_stable_address: input?.identity_stable_address ? String(input.identity_stable_address) : null,
      confirmations_required: parseNumber(input?.confirmations_required, 3),
      active: Boolean(input?.active),
    };
  };

  try {
    // Prefer direct DB query to avoid stale/misconfigured edge function responses.
    const { data: direct, error: directErr } = await supabase
      .from("market_chain_config")
      .select(
        "chain,chain_id,rpc_url,usdc_address,usdt_address,escrow_address,faucet_address,faucet_active,faucet_cooldown_seconds,faucet_usdc_amount_raw,faucet_usdt_amount_raw,identity_factory,identity_router,identity_name_registry,identity_stable_address,confirmations_required,active"
      )
      .order("active", { ascending: false });
    if (!directErr && direct && direct.length) {
      const directNorm = direct.filter((row) => isSupportedMainnetChain(row?.chain)).map(normalize);
      const hasValidTokens = directNorm.some((c) => /^0x[a-fA-F0-9]{40}$/.test(c.usdc_address || ""));
      if (hasValidTokens) return directNorm;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token;
    const base = getSupabaseFunctionsBaseUrl();
    const res = await fetch(`${base}/market-chain-list`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: getSupabaseAnonKeyOrThrow(),
        Authorization: `Bearer ${accessToken || getSupabaseAnonKeyOrThrow()}`,
      },
      body: JSON.stringify({}),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.message || json?.error || "Failed to load chains");
    const fromFn: MarketChainConfig[] = (json?.chains ?? [])
      .filter((row: any) => isSupportedMainnetChain(row?.chain))
      .map(normalize);
    // Guard against stale function deployments returning empty token addresses.
    const hasValidTokens = fromFn.some((c) => /^0x[a-fA-F0-9]{40}$/.test(c.usdc_address || ""));
    if (fromFn.length && hasValidTokens) return fromFn;
    throw new Error("Chain config payload missing token addresses");
  } catch (e: any) {
    throw new Error(String(e?.message || "Unable to load mainnet chain configuration."));
  }
}

export async function getPreferredMarketChain() {
  const saved = await SecureStore.getItemAsync(KEY_CHAIN);
  const chains = await fetchMarketChains();
  const active = chains.find((c: MarketChainConfig) => c.active) ?? null;
  const fallback = chains[0] ?? null;

  if (saved) {
    const match = chains.find((c: MarketChainConfig) => c.chain === saved);
    if (match?.active) return match;
  }

  if (active) {
    await SecureStore.setItemAsync(KEY_CHAIN, active.chain);
    return active;
  }

  if (fallback) {
    await SecureStore.setItemAsync(KEY_CHAIN, fallback.chain);
    return fallback;
  }

  return null;
}

export async function setPreferredMarketChain(chain: string) {
  await SecureStore.setItemAsync(KEY_CHAIN, chain);
}
