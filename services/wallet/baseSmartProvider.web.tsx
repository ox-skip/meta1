import React, { useEffect, useMemo, useState } from "react";

import {
  clearBaseSmartConnection,
  setBaseSmartConnection,
  setBaseSmartRuntime,
} from "@/services/wallet/baseSmartSession";

const metadata = {
  appName: "Best City",
  appLogoUrl: "https://bestcity.app/icon.png",
  appChainIds: [1, 10, 137, 8453, 84532, 42161, 11155111],
};

type BaseRuntime = {
  createBaseAccountSDK: (params: any) => any;
};

let runtime: BaseRuntime | null = null;
let runtimeFailed = false;
let sdk: any = null;

function isAddress(value: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || ""));
}

function normalizeChainId(raw: unknown) {
  const value = String(raw ?? "").trim();
  if (/^0x[0-9a-fA-F]+$/.test(value)) return Number.parseInt(value, 16);
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toHexChainId(raw: string) {
  const v = String(raw || "").trim();
  if (v.startsWith("0x")) return v;
  if (/^eip155:\d+$/i.test(v)) {
    const n = Number(v.split(":")[1] || 0);
    return Number.isFinite(n) ? `0x${n.toString(16)}` : "0x0";
  }
  const n = Number(v);
  return Number.isFinite(n) ? `0x${n.toString(16)}` : "0x0";
}

function canUseRuntime() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function loadRuntime(): BaseRuntime | null {
  if (runtimeFailed || !canUseRuntime()) return null;
  if (runtime) return runtime;

  try {
    const pkg = require("@base-org/account");
    runtime = { createBaseAccountSDK: pkg.createBaseAccountSDK };
    return runtime;
  } catch (e: any) {
    runtimeFailed = true;
    console.warn("[BaseSmart] Web runtime failed to load:", String(e?.message || e));
    return null;
  }
}

function getSdk(rt: BaseRuntime) {
  if (sdk) return sdk;
  sdk = rt.createBaseAccountSDK({
    ...metadata,
    preference: {
      telemetry: false,
    },
  });
  return sdk;
}

function SessionBinder({ provider }: { provider: any }) {
  const [epoch, setEpoch] = useState(0);

  const sync = useMemo(() => {
    return async () => {
      try {
        const accounts = ((await provider.request({ method: "eth_accounts" })) as string[]) || [];
        const address = String(accounts?.[0] || "").trim();
        const chainHex = await provider.request({ method: "eth_chainId" }).catch(() => "0x0");
        const chainId = normalizeChainId(chainHex);
        if (isAddress(address)) {
          setBaseSmartConnection({
            connected: true,
            address,
            chainId,
            provider,
            providerType: "base_smart",
          });
        } else {
          clearBaseSmartConnection();
        }
      } catch {
        clearBaseSmartConnection();
      }
    };
  }, [provider]);

  useEffect(() => {
    setBaseSmartRuntime({
      openModal: async () => {
        await provider.request({ method: "eth_requestAccounts" });
        setEpoch((v) => v + 1);
      },
      disconnect: async () => {
        if (typeof provider.disconnect === "function") {
          await Promise.resolve(provider.disconnect());
        } else {
          clearBaseSmartConnection();
        }
      },
      switchNetwork: async (caipOrHex: string) => {
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: toHexChainId(caipOrHex) }],
        });
      },
    });
  }, [provider]);

  useEffect(() => {
    void sync();
  }, [sync, epoch]);

  useEffect(() => {
    const onAccountsChanged = () => {
      setEpoch((v) => v + 1);
    };
    const onChainChanged = () => {
      setEpoch((v) => v + 1);
    };
    const onConnect = () => {
      setEpoch((v) => v + 1);
    };
    const onDisconnect = () => {
      clearBaseSmartConnection();
    };

    provider.on?.("accountsChanged", onAccountsChanged);
    provider.on?.("chainChanged", onChainChanged);
    provider.on?.("connect", onConnect);
    provider.on?.("disconnect", onDisconnect);

    return () => {
      provider.removeListener?.("accountsChanged", onAccountsChanged);
      provider.removeListener?.("chainChanged", onChainChanged);
      provider.removeListener?.("connect", onConnect);
      provider.removeListener?.("disconnect", onDisconnect);
    };
  }, [provider]);

  return null;
}

export function BaseSmartProvider({ children }: { children: React.ReactNode }) {
  const [provider, setProvider] = useState<any>(null);

  useEffect(() => {
    if (!canUseRuntime()) return;
    const rt = loadRuntime();
    if (!rt) return;
    const next = getSdk(rt)?.getProvider?.();
    if (next && typeof next.request === "function") {
      setProvider(next);
      return;
    }
    setBaseSmartRuntime({
      openModal: async () => {
        throw new Error("Coinbase Smart Wallet is unavailable.");
      },
    });
  }, []);

  if (!provider) {
    return <>{children}</>;
  }

  return (
    <>
      <SessionBinder provider={provider} />
      {children}
    </>
  );
}
