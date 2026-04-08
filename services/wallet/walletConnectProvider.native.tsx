import "@walletconnect/react-native-compat";

import React, { useEffect } from "react";

import { AppKit, AppKitProvider, createAppKit, useAccount, useAppKit, useProvider } from "@reown/appkit-react-native";
import { EthersAdapter } from "@reown/appkit-ethers-react-native";
import { arbitrum, base, mainnet, optimism, polygon } from "@reown/appkit/networks";

import {
  clearWalletConnectConnection,
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

const networks = [mainnet, base, polygon, arbitrum, optimism] as any;

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
    });
  }, [address, chainId, isConnected, providerType, walletProvider]);

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
