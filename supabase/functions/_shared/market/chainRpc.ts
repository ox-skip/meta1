function cleanAlchemyApiKey(raw?: string | null) {
  const value = String(raw || "").trim();
  if (!value) return "";
  return value.replace(/^https?:\/\/[^/]+\/v2\//i, "");
}

function alchemyUrlForChain(chain: string, apiKey: string) {
  const safeApiKey = cleanAlchemyApiKey(apiKey);
  if (!safeApiKey) return "";

  const normalized = String(chain || "").trim().toLowerCase();
  const urls: Record<string, string> = {
    ethereum: `https://eth-mainnet.g.alchemy.com/v2/${safeApiKey}`,
    base: `https://base-mainnet.g.alchemy.com/v2/${safeApiKey}`,
    base_sepolia: `https://base-sepolia.g.alchemy.com/v2/${safeApiKey}`,
    arbitrum: `https://arb-mainnet.g.alchemy.com/v2/${safeApiKey}`,
    arbitrum_sepolia: `https://arb-sepolia.g.alchemy.com/v2/${safeApiKey}`,
    optimism: `https://opt-mainnet.g.alchemy.com/v2/${safeApiKey}`,
    optimism_sepolia: `https://opt-sepolia.g.alchemy.com/v2/${safeApiKey}`,
    polygon: `https://polygon-mainnet.g.alchemy.com/v2/${safeApiKey}`,
    polygon_amoy: `https://polygon-amoy.g.alchemy.com/v2/${safeApiKey}`,
    bnb: `https://bnb-mainnet.g.alchemy.com/v2/${safeApiKey}`,
    bnb_testnet: `https://bnb-testnet.g.alchemy.com/v2/${safeApiKey}`,
  };

  return urls[normalized] || "";
}

export function resolveRpcUrlForChain(chain: string, configured?: string | null) {
  const direct = String(configured || "").trim();
  if (direct) return direct;

  const normalized = String(chain || "").trim().toLowerCase();
  const upper = normalized.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const aliases: Record<string, string[]> = {
    ethereum: ["ETH"],
    bnb: ["BSC"],
  };
  const prefixes = Array.from(new Set([upper, ...(aliases[normalized] ?? [])]));
  const envNames = prefixes.flatMap((prefix) => [
    `${prefix}_RPC_URL`,
    `${prefix}_ALCHEMY_RPC_URL`,
    `${prefix}_MAINNET_RPC_URL`,
    `${prefix}_MAINNET_ALCHEMY_RPC_URL`,
  ]);
  const explicit = envNames.map((name) => String(Deno.env.get(name) || "").trim()).find(Boolean) || "";
  if (explicit) return explicit;

  const alchemyKey =
    String(Deno.env.get("ALCHEMY_API_KEY") || "").trim() ||
    String(Deno.env.get("EXPO_PUBLIC_ALCHEMY_API_KEY") || "").trim();
  return alchemyUrlForChain(chain, alchemyKey);
}
