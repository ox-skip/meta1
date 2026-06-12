import "@walletconnect/react-native-compat";

import React, { useEffect } from "react";

import { AppKit, AppKitProvider, createAppKit, useAccount, useAppKit, useProvider } from "@reown/appkit-react-native";
import { EthersAdapter } from "@reown/appkit-ethers-react-native";
// eslint-disable-next-line import/no-unresolved
import { arbitrum, base, mainnet, optimism, polygon } from "@reown/appkit/networks";

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
  redirect: {
    native: "bestcitypay://",
    universal: "https://bestcity.app",
    linkMode: true,
  },
};

const arcTestnet = {
  id: 5042002,
  caipNetworkId: "eip155:5042002",
  chainNamespace: "eip155",
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.arc.network"] },
    public: { http: ["https://rpc.testnet.arc.network"] },
  },
  blockExplorers: {
    default: { name: "ArcScan", url: "https://testnet.arcscan.app" },
  },
  testnet: true,
} as const;

const networks = [mainnet, base, polygon, arbitrum, optimism, arcTestnet] as any;

let appKitInstance: any = null;

if (projectId) {
  const ethersAdapter = new EthersAdapter();
  appKitInstance = createAppKit({
    adapters: [ethersAdapter],
    projectId,
    metadata,
    networks,
    defaultNetwork: base,
    enableCoinbase: false,
    features: {
      analytics: false,
    },
  });
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

function SessionBinder() {
  const appKit = useAppKit() as any;
  const accountState = useAccount() as any;
  const providerState = useProvider("eip155" as any) as any;

  const open = appKit?.open;
  const disconnect = appKit?.disconnect;
  const isConnected = Boolean(accountState?.isConnected);
  const address = String(accountState?.address || "");
  const caipAddress = String(accountState?.caipAddress || "");
  const chainIdFromCaip = parseChainIdFromCaipAddress(caipAddress);
  const chainId = Number(accountState?.chainId || chainIdFromCaip || 0);

  const walletProvider = providerState?.walletProvider ?? providerState?.provider ?? null;
  const providerType = String(providerState?.walletProviderType || providerState?.providerType || "");
  const embeddedProvider = embeddedProviderName(accountState, providerState, walletProvider);
  const smartAccounts = collectSmartAccounts(accountState, providerState, walletProvider, Boolean(embeddedProvider));
  const accountType = String(accountState?.embeddedWalletInfo?.accountType || (embeddedProvider && smartAccounts.length ? "smartAccount" : ""));

  useEffect(() => {
    setWalletConnectRuntime({
      openModal: async () => {
        if (!open) throw new Error("WalletConnect modal is unavailable.");
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
      providerType,
      caipAddress,
      accountType,
      smartAccounts,
    });
  }, [accountType, address, caipAddress, chainId, embeddedProvider, isConnected, providerType, smartAccounts, walletProvider]);

  return <AppKit />;
}

export function WalletConnectProvider({ children }: { children: React.ReactNode }) {
  if (!projectId || !appKitInstance) {
    return <>{children}</>;
  }

  return (
    <AppKitProvider instance={appKitInstance}>
      <SessionBinder />
      {children}
    </AppKitProvider>
  );
}
