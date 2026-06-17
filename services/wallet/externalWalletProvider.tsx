import React, { useEffect, useState } from "react";

import { BaseSmartProvider } from "@/services/wallet/baseSmartProvider";
import { WalletConnectProvider } from "@/services/wallet/walletConnectProvider";
import { getWalletModeSync, subscribeWalletMode } from "@/services/wallet/walletMode";

export function ExternalWalletProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState(getWalletModeSync());

  useEffect(() => {
    const unsub = subscribeWalletMode((next) => setMode(next));
    return () => unsub();
  }, []);

  if (mode === "base_smart") {
    return <BaseSmartProvider>{children}</BaseSmartProvider>;
  }

  if (mode === "circle_market") {
    return <>{children}</>;
  }

  return <WalletConnectProvider>{children}</WalletConnectProvider>;
}
