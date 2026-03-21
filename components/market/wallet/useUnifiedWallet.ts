import { useCallback, useEffect, useMemo, useState } from "react";
import { createPublicClient, encodeFunctionData, formatUnits, http, parseUnits } from "viem";

import { useWalletSimple } from "@/hooks/wallet/useWalletSimple";
import { fetchMarketChains, getPreferredMarketChain, setPreferredMarketChain, type MarketChainConfig } from "@/services/market/chainConfig";
import { fetchMyStockPortfolio } from "@/services/market/stocks";
import {
  ensureWalletAddressOnChain,
  getMyPiWallet,
  getMyWalletForChain,
  isPiChain,
  isPiWalletAddress,
  replaceSavedWalletWithDevice,
  saveMyPiWallet,
} from "@/services/market/usdcCheckout";
import { connectActiveWalletEvm, getActiveWalletEip155Provider, getActiveWalletSession, subscribeActiveWalletSession } from "@/services/wallet/activeWalletSession";
import { getWalletModeSync, isBaseSmartSupported, setWalletMode, subscribeWalletMode, type WalletMode } from "@/services/wallet/walletMode";
import { getRpcUrlForChain, getSmartAccount } from "@/utils/aaWallet";
import { isNigeriaCountry, resolveUserCountry, type UserCountry } from "@/utils/country";
import { friendlyMarketError } from "@/utils/marketUx";

const ERC20_ABI = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const ERC20_TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

function isAddress(value?: string | null) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || ""));
}

export type UnifiedWalletStockPosition = {
  stock_id: string;
  slug: string;
  symbol: string;
  name: string;
  qty: number;
  value_usdc: number;
};

export function useUnifiedWallet() {
  const { balance: ngnBalance, loading: ngnLoading, error: ngnError, reload: reloadNgn } = useWalletSimple();

  const [country, setCountry] = useState<UserCountry | undefined>(undefined);
  const [countryErr, setCountryErr] = useState<string | null>(null);
  const [chains, setChains] = useState<MarketChainConfig[]>([]);
  const [chain, setChain] = useState<MarketChainConfig | null>(null);
  const [chainErr, setChainErr] = useState<string | null>(null);
  const [savedAddress, setSavedAddress] = useState("");
  const [savedPiAddress, setSavedPiAddress] = useState("");
  const [connectedAddress, setConnectedAddress] = useState("");
  const [walletMode, setWalletModeState] = useState<WalletMode>(getWalletModeSync());
  const [usdcBalance, setUsdcBalance] = useState("0");
  const [usdtBalance, setUsdtBalance] = useState("0");
  const [portfolioTotalUsdc, setPortfolioTotalUsdc] = useState(0);
  const [portfolioPositions, setPortfolioPositions] = useState<UnifiedWalletStockPosition[]>([]);
  const [portfolioLoading, setPortfolioLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);
  const [piSaving, setPiSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isNigeria = isNigeriaCountry(country?.code || country?.name);
  const stableTotalUsd = useMemo(() => Number(usdcBalance || 0) + Number(usdtBalance || 0), [usdcBalance, usdtBalance]);
  const overallUsdApprox = useMemo(() => stableTotalUsd + Number(portfolioTotalUsdc || 0), [stableTotalUsd, portfolioTotalUsdc]);
  const loading = ngnLoading || portfolioLoading || busy || sendBusy || piSaving || country === undefined;

  const refreshCountry = useCallback(async () => {
    try {
      setCountryErr(null);
      const c = await resolveUserCountry({ prompt: true, refresh: true });
      setCountry((prev) => c ?? prev ?? null);
      if (!c) setCountryErr("Live location not detected. Showing last known country.");
      return c;
    } catch (e: any) {
      setCountry((prev) => prev ?? null);
      setCountryErr(String(e?.message || "Could not read location."));
      return null;
    }
  }, []);

  const refreshPortfolio = useCallback(async () => {
    setPortfolioLoading(true);
    try {
      const res = await fetchMyStockPortfolio();
      const positions = Array.isArray(res.positions) ? res.positions : [];
      const mapped: UnifiedWalletStockPosition[] = positions.map((row: any) => ({
        stock_id: String(row?.stock_id || ""),
        slug: String(row?.identity?.slug || ""),
        symbol: String(row?.identity?.symbol || ""),
        name: String(row?.identity?.name || "Stock"),
        qty: Number(row?.balance_qty ?? 0),
        value_usdc: Number(row?.value_usdc ?? 0),
      }));
      setPortfolioPositions(mapped.sort((a, b) => b.value_usdc - a.value_usdc));
      setPortfolioTotalUsdc(Number(res.total_value_usdc ?? 0));
    } catch {
      setPortfolioPositions([]);
      setPortfolioTotalUsdc(0);
    } finally {
      setPortfolioLoading(false);
    }
  }, []);

  const refreshPiWallet = useCallback(async () => {
    try {
      const row = await getMyPiWallet();
      const next = String((row as any)?.address || "").trim();
      setSavedPiAddress(next);
      return next;
    } catch {
      setSavedPiAddress("");
      return "";
    }
  }, []);

  const refreshChainBalances = useCallback(
    async (selected?: MarketChainConfig | null, forcedAddress?: string) => {
      const current = selected ?? chain;
      if (!current) {
        setSavedAddress("");
        setUsdcBalance("0");
        setUsdtBalance("0");
        return { address: "" };
      }

      let nextAddress = String(forcedAddress || "").trim();
      if (!nextAddress) {
        const row = await getMyWalletForChain(current.chain);
        nextAddress = String(row?.address || "").trim();
      }

      setSavedAddress(nextAddress);
      if (!isAddress(nextAddress)) {
        setUsdcBalance("0");
        setUsdtBalance("0");
        return { address: "" };
      }

      const rpcUrl = getRpcUrlForChain(current);
      if (!rpcUrl) return { address: nextAddress };

      const client = createPublicClient({ transport: http(rpcUrl) });

      try {
        if (isAddress(current.usdc_address)) {
          const d = Number(await client.readContract({ address: current.usdc_address as `0x${string}`, abi: ERC20_ABI, functionName: "decimals" }));
          const raw = await client.readContract({
            address: current.usdc_address as `0x${string}`,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [nextAddress as `0x${string}`],
          });
          setUsdcBalance(formatUnits(raw as bigint, d));
        } else {
          setUsdcBalance("0");
        }
      } catch {
        setUsdcBalance("0");
      }

      try {
        if (isAddress(current.usdt_address)) {
          const d = Number(await client.readContract({ address: current.usdt_address as `0x${string}`, abi: ERC20_ABI, functionName: "decimals" }));
          const raw = await client.readContract({
            address: current.usdt_address as `0x${string}`,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [nextAddress as `0x${string}`],
          });
          setUsdtBalance(formatUnits(raw as bigint, d));
        } else {
          setUsdtBalance("0");
        }
      } catch {
        setUsdtBalance("0");
      }

      return { address: nextAddress };
    },
    [chain],
  );

  const loadChains = useCallback(async () => {
    try {
      setChainErr(null);
      const all = await fetchMarketChains();
      setChains(all);
      const preferred = (await getPreferredMarketChain()) ?? all.find((c) => c.active) ?? all[0] ?? null;
      setChain(preferred);
      await refreshChainBalances(preferred);
    } catch (e: any) {
      setChainErr(String(e?.message || "Unable to load networks."));
      setChains([]);
      setChain(null);
      setSavedAddress("");
      setUsdcBalance("0");
      setUsdtBalance("0");
    }
  }, [refreshChainBalances]);

  const selectChain = useCallback(
    async (next: MarketChainConfig) => {
      setError(null);
      try {
        setChain(next);
        await setPreferredMarketChain(next.chain);
        await refreshChainBalances(next);
      } catch (e: any) {
        setError(friendlyMarketError(e, "Unable to switch network."));
      }
    },
    [refreshChainBalances],
  );

  const connectWallet = useCallback(async () => {
    if (!chain) return;
    setBusy(true);
    setError(null);
    try {
      if (isPiChain(chain.chain)) {
        throw new Error("PI network does not use EVM connect. Save your PI wallet address below.");
      }
      await connectActiveWalletEvm(60_000, { forceModal: true });
      const out = await ensureWalletAddressOnChain(chain);
      await refreshChainBalances(chain, out.address);
    } catch (e: any) {
      setError(friendlyMarketError(e, "Unable to connect wallet."));
    } finally {
      setBusy(false);
    }
  }, [chain, refreshChainBalances]);

  const useConnectedWallet = useCallback(async () => {
    if (!chain) return;
    setBusy(true);
    setError(null);
    try {
      if (isPiChain(chain.chain)) {
        throw new Error("PI network does not use EVM connect. Save your PI wallet address below.");
      }
      await connectActiveWalletEvm(60_000, { forceModal: true });
      const out = await replaceSavedWalletWithDevice(chain);
      await refreshChainBalances(chain, out.address);
    } catch (e: any) {
      setError(friendlyMarketError(e, "Could not sync wallet."));
    } finally {
      setBusy(false);
    }
  }, [chain, refreshChainBalances]);

  const refreshAll = useCallback(async () => {
    try {
      setError(null);
      await Promise.allSettled([reloadNgn(), refreshPortfolio(), refreshCountry(), refreshPiWallet()]);
      await refreshChainBalances();
    } catch (e: any) {
      setError(friendlyMarketError(e, "Unable to refresh wallet data."));
    }
  }, [refreshChainBalances, refreshCountry, refreshPiWallet, refreshPortfolio, reloadNgn]);

  const savePiAddress = useCallback(async (addressInput: string) => {
    const normalized = String(addressInput || "").trim();
    setPiSaving(true);
    setError(null);
    try {
      if (normalized && !isPiWalletAddress(normalized)) {
        throw new Error("Enter a valid PI wallet address.");
      }
      const out = await saveMyPiWallet(normalized);
      const next = String((out as any)?.address || "").trim();
      setSavedPiAddress(next);
      return { address: next };
    } catch (e: any) {
      const msg = friendlyMarketError(e, "Unable to save PI wallet address.");
      setError(msg);
      throw new Error(msg);
    } finally {
      setPiSaving(false);
    }
  }, []);

  const sendStableToken = useCallback(
    async (input: { symbol: "USDC" | "USDT"; to: string; amount: string }) => {
      const current = chain;
      if (!current) throw new Error("Select a network first.");

      const to = String(input.to || "").trim();
      if (!isAddress(to)) {
        throw new Error("Enter a valid recipient wallet address.");
      }

      const amountText = String(input.amount || "").trim();
      if (!amountText) {
        throw new Error("Enter an amount to send.");
      }

      const tokenAddress = input.symbol === "USDT" ? String(current.usdt_address || "") : String(current.usdc_address || "");
      if (!isAddress(tokenAddress)) {
        throw new Error(`${input.symbol} is not configured on this network.`);
      }

      setSendBusy(true);
      setError(null);
      try {
        const { account, address, client } = await getSmartAccount(current);
        if (!isAddress(address)) {
          throw new Error("Wallet connection failed. Reconnect and try again.");
        }
        if (String(address).toLowerCase() === to.toLowerCase()) {
          throw new Error("Recipient address cannot be your own wallet address.");
        }

        const rpc = getRpcUrlForChain(current);
        if (!rpc) {
          throw new Error("Missing network RPC URL. Ask admin to update chain config.");
        }

        const publicClient = createPublicClient({ transport: http(rpc) });
        const decimals = Number(
          await publicClient.readContract({
            address: tokenAddress as `0x${string}`,
            abi: ERC20_ABI,
            functionName: "decimals",
          }),
        );

        let amountRaw = 0n;
        try {
          amountRaw = parseUnits(amountText, decimals);
        } catch {
          throw new Error(`Invalid amount format for ${input.symbol}.`);
        }
        if (amountRaw <= 0n) {
          throw new Error("Amount must be greater than zero.");
        }

        const balanceRaw = await publicClient.readContract({
          address: tokenAddress as `0x${string}`,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [address as `0x${string}`],
        });
        if (BigInt(balanceRaw as bigint) < amountRaw) {
          throw new Error(`Insufficient ${input.symbol} balance.`);
        }

        const data = encodeFunctionData({
          abi: ERC20_TRANSFER_ABI,
          functionName: "transfer",
          args: [to as `0x${string}`, amountRaw],
        });

        const submitted = await (client as any).sendTransaction({
          account,
          from: address as `0x${string}`,
          to: tokenAddress as `0x${string}`,
          data,
        });

        const txHash = String(
          (submitted as any)?.transactionHash ||
            (submitted as any)?.hash ||
            (submitted as any)?.userOpHash ||
            (submitted as any)?.userOperationHash ||
            "",
        ).trim();
        if (!txHash) {
          throw new Error("Transfer submitted but no transaction hash was returned.");
        }

        await refreshChainBalances(current, address);

        return {
          txHash,
          symbol: input.symbol,
          to,
          amount: amountText,
        };
      } catch (e: any) {
        const msg = friendlyMarketError(e, "Unable to send crypto right now.");
        setError(msg);
        throw new Error(msg);
      } finally {
        setSendBusy(false);
      }
    },
    [chain, refreshChainBalances],
  );

  useEffect(() => {
    const sync = () => {
      const s = getActiveWalletSession();
      setConnectedAddress(s.connected ? String(s.address || "") : "");
    };
    sync();
    const unsub = subscribeActiveWalletSession(sync);
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = subscribeWalletMode((next) => setWalletModeState(next));
    return () => unsub();
  }, []);

  const changeWalletMode = useCallback(async (next: WalletMode) => {
    setError(null);
    try {
      await setWalletMode(next);
      setWalletModeState(next);
      await refreshChainBalances();
    } catch (e: any) {
      setError(friendlyMarketError(e, "Unable to change wallet mode."));
    }
  }, [refreshChainBalances]);

  useEffect(() => {
    loadChains();
    refreshPortfolio();
    refreshCountry();
    refreshPiWallet();
  }, [loadChains, refreshCountry, refreshPiWallet, refreshPortfolio]);

  return {
    loading,
    busy,
    sendBusy,
    error: error || chainErr || countryErr || ngnError || null,
    ngnBalance: Number(ngnBalance || 0),
    country,
    isNigeria,
    walletMode,
    baseSmartSupported: isBaseSmartSupported(),
    chains,
    chain,
    savedAddress,
    savedPiAddress,
    connectedAddress,
    usdcBalance: Number(usdcBalance || 0),
    usdtBalance: Number(usdtBalance || 0),
    stableTotalUsd,
    portfolioTotalUsdc: Number(portfolioTotalUsdc || 0),
    portfolioPositions,
    overallUsdApprox,
    connectWallet,
    useConnectedWallet,
    setWalletMode: changeWalletMode,
    refreshAll,
    refreshCountry,
    selectChain,
    loadChains,
    refreshChainBalances,
    refreshPiWallet,
    savePiAddress,
    piSaving,
    sendStableToken,
  };
}
