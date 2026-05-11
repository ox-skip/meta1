declare module "@/services/wallet/baseSmartProvider" {
  import type React from "react";

  export function BaseSmartProvider(props: { children: React.ReactNode }): React.ReactElement;
}

declare module "@/services/wallet/walletConnectProvider" {
  import type React from "react";

  export function WalletConnectProvider(props: { children: React.ReactNode }): React.ReactElement;
}
