export const SUPPORTED_EVM_STOCK_CHAINS = [
  "ethereum",
  "base",
  "arbitrum",
  "optimism",
  "polygon",
  "bnb",
  "arc_testnet",
  "base_sepolia",
  "bnb_testnet",
  "arbitrum_sepolia",
  "polygon_amoy",
] as const;

const SUPPORTED_EVM_STOCK_CHAIN_SET = new Set<string>(SUPPORTED_EVM_STOCK_CHAINS);

export function isSupportedEvmStockChain(chain: string | null | undefined) {
  return SUPPORTED_EVM_STOCK_CHAIN_SET.has(String(chain || "").trim().toLowerCase());
}
