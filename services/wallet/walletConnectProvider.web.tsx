import React, { useEffect, useMemo, useState } from "react";

import {
  clearWalletConnectConnection,
  plainAddressFromCaip,
  parseChainIdFromCaipAddress,
  setWalletConnectConnection,
  setWalletConnectRuntime,
} from "@/services/wallet/walletConnectSession";

const projectId = String(process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID || "").trim();

const metadata = {
  name: "Best City",
  description: "Best City wallet connection",
  url: "https://bestcity.app",
  icons: ["https://bestcity.app/icon.png"],
};

type RuntimeModules = {
  createAppKit: any;
  useAppKit: any;
  useAppKitAccount: any;
  useAppKitProvider: any;
  WagmiAdapter: any;
  networks: any;
  QueryClient: any;
  QueryClientProvider: any;
  WagmiProvider: any;
};

let runtime: RuntimeModules | null = null;
let runtimeLoadFailed = false;
let adapter: any = null;
let queryClient: any = null;
let initialized = false;

function canUseBrowserRuntime() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function loadRuntime(): RuntimeModules | null {
  if (runtimeLoadFailed || !canUseBrowserRuntime()) return null;
  if (runtime) return runtime;

  try {
    const reownReact = require("@reown/appkit/react");
    const adapterPkg = require("@reown/appkit-adapter-wagmi");
    const networksPkg = require("@reown/appkit/networks");
    const queryPkg = require("@tanstack/react-query");
    const wagmiPkg = require("wagmi");
    const controllersReact = require("@reown/appkit-controllers/react");

    runtime = {
      createAppKit: reownReact.createAppKit,
      useAppKit: reownReact.useAppKit,
      useAppKitAccount: reownReact.useAppKitAccount,
      useAppKitProvider: reownReact.useAppKitProvider || controllersReact.useAppKitProvider,
      WagmiAdapter: adapterPkg.WagmiAdapter,
      networks: networksPkg,
      QueryClient: queryPkg.QueryClient,
      QueryClientProvider: queryPkg.QueryClientProvider,
      WagmiProvider: wagmiPkg.WagmiProvider,
    };

    return runtime;
  } catch (e: any) {
    runtimeLoadFailed = true;
    console.warn("[WalletConnect] Web runtime failed to load:", String(e?.message || e));
    return null;
  }
}

function getNetworks(rt: RuntimeModules) {
  const n = rt.networks;
  return [n.mainnet, n.base, n.polygon, n.arbitrum, n.optimism] as any;
}

function parseSmartAccounts(raw: unknown) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeAddress(raw: unknown) {
  const value = String(raw || "").trim();
  return plainAddressFromCaip(value) || value;
}

function sessionProperties(providerState: any, walletProvider: any) {
  return walletProvider?.session?.sessionProperties || providerState?.session?.sessionProperties || {};
}

function embeddedProviderName(accountState: any, providerState: any, walletProvider: any) {
  const props = sessionProperties(providerState, walletProvider);
  return String(
    accountState?.embeddedWalletInfo?.authProvider ||
      accountState?.socialProvider ||
      props.provider ||
      props.email ||
      "",
  ).trim();
}

function collectSmartAccounts(accountState: any, providerState: any, walletProvider: any, embedded: boolean) {
  if (!embedded) return [];
  const out = new Set<string>();
  const add = (value: unknown) => {
    const address = normalizeAddress(value);
    if (/^0x[a-fA-F0-9]{40}$/.test(address)) out.add(address);
  };

  const allAccounts = Array.isArray(accountState?.allAccounts) ? accountState.allAccounts : [];
  for (const account of allAccounts) {
    if (String(account?.type || "").toLowerCase().includes("smart")) {
      add(account?.address || account?.caipAddress);
    }
  }

  for (const account of parseSmartAccounts(sessionProperties(providerState, walletProvider).smartAccounts)) {
    add(account);
  }

  return [...out];
}

function ensureInitialized() {
  if (initialized) return;
  initialized = true;
  if (!projectId || !canUseBrowserRuntime()) return;

  const rt = loadRuntime();
  if (!rt) return;

  const networks = getNetworks(rt);
  const runtimeMetadata = {
    ...metadata,
    url: canUseBrowserRuntime() ? window.location.origin : metadata.url,
  };

  adapter = new rt.WagmiAdapter({
    projectId,
    networks,
    ssr: false,
  });

  rt.createAppKit({
    adapters: [adapter],
    projectId,
    metadata: runtimeMetadata,
    networks,
    defaultNetwork: rt.networks.base,
    enableCoinbase: false,
    features: {
      analytics: false,
    },
  });

  queryClient = new rt.QueryClient();
}

function SessionBinder({ rt }: { rt: RuntimeModules }) {
  const appKit = rt.useAppKit() as any;
  const accountState = rt.useAppKitAccount() as any;
  const providerState = rt.useAppKitProvider("eip155") as any;

  const open = appKit?.open;
  const disconnect = appKit?.disconnect;
  const isConnected = Boolean(accountState?.isConnected);
  const address = String(accountState?.address || "");
  const caipAddress = String(accountState?.caipAddress || "");
  const chainIdFromCaip = parseChainIdFromCaipAddress(caipAddress);
  const chainId = Number(accountState?.chainId || chainIdFromCaip || 0);
  const walletProvider = providerState?.walletProvider ?? providerState?.provider ?? null;
  const embeddedProvider = embeddedProviderName(accountState, providerState, walletProvider);
  const smartAccounts = collectSmartAccounts(accountState, providerState, walletProvider, Boolean(embeddedProvider));
  const accountType = String(accountState?.embeddedWalletInfo?.accountType || (embeddedProvider && smartAccounts.length ? "smartAccount" : ""));

  useEffect(() => {
    if (!open) return;
    setWalletConnectRuntime({
      openModal: async () => {
        await Promise.resolve(open());
      },
      disconnect: async () => {
        if (!disconnect) {
          clearWalletConnectConnection();
          return;
        }
        await Promise.resolve(disconnect());
      },
    });
  }, [disconnect, open]);

  useEffect(() => {
    if (!isConnected || !address) {
      clearWalletConnectConnection();
      return;
    }

    setWalletConnectConnection({
      connected: true,
      address,
      chainId,
      provider: walletProvider,
      providerType: "eip155",
      caipAddress,
      accountType,
      smartAccounts,
    });
  }, [accountType, address, caipAddress, chainId, embeddedProvider, isConnected, smartAccounts, walletProvider]);

  return null;
}

export function WalletConnectProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    if (!canUseBrowserRuntime()) return;

    loadRuntime();
    ensureInitialized();

    if (adapter && queryClient) {
      setReady(true);
    }
  }, []);

  const rt = useMemo(() => loadRuntime(), [ready]);
  if (!projectId || !rt || !adapter || !queryClient) {
    return <>{children}</>;
  }

  const WagmiProvider = rt.WagmiProvider as any;
  const QueryClientProvider = rt.QueryClientProvider as any;

  return (
    <WagmiProvider config={adapter.wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <SessionBinder rt={rt} />
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
