import React, { useEffect } from "react";

import { setBaseSmartRuntime } from "@/services/wallet/baseSmartSession";

export function BaseSmartProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    setBaseSmartRuntime({
      openModal: async () => {
        throw new Error("Coinbase Smart Wallet is available on web. Use WalletConnect on mobile.");
      },
      disconnect: async () => undefined,
      switchNetwork: async () => {
        throw new Error("Coinbase Smart Wallet network switching is available on web.");
      },
    });
  }, []);

  return <>{children}</>;
}
