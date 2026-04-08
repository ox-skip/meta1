import {
  BaseSmartRuntime,
  clearBaseSmartConnection,
  connectBaseSmartEvm,
  getBaseSmartEip155Provider,
  getBaseSmartSession,
  subscribeBaseSmartSession,
} from "@/services/wallet/baseSmartSession";
import {
  clearWalletConnectConnection,
  connectWalletConnectEvm,
  getWalletConnectEip155Provider,
  getWalletConnectSession,
  subscribeWalletConnectSession,
  WalletConnectRuntime,
} from "@/services/wallet/walletConnectSession";
import { getWalletModeSync, subscribeWalletMode, type WalletMode } from "@/services/wallet/walletMode";

export type ActiveWalletRuntime = WalletConnectRuntime | BaseSmartRuntime;

export type ActiveWalletSession = {
  mode: WalletMode;
  connected: boolean;
  address: string;
  chainId: number;
  provider: any | null;
  providerType: string;
  runtime: ActiveWalletRuntime;
};

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function snapshotForMode(mode: WalletMode): ActiveWalletSession {
  if (mode === "base_smart") {
    const base = getBaseSmartSession();
    return {
      mode,
      connected: base.connected,
      address: base.address,
      chainId: base.chainId,
      provider: base.provider,
      providerType: base.providerType || "base_smart",
      runtime: base.runtime,
    };
  }

  const wc = getWalletConnectSession();
  return {
    mode,
    connected: wc.connected,
    address: wc.address,
    chainId: wc.chainId,
    provider: wc.provider,
    providerType: wc.providerType || "walletconnect",
    runtime: wc.runtime,
  };
}

function currentSnapshot(): ActiveWalletSession {
  return snapshotForMode(getWalletModeSync());
}

export function getConnectedWalletMode(): WalletMode | null {
  const base = getBaseSmartSession();
  if (base.connected && base.address) return "base_smart";

  const wc = getWalletConnectSession();
  if (wc.connected && wc.address) return "walletconnect";

  return null;
}

export async function disconnectWalletMode(mode?: WalletMode | null, timeoutMs = 1_500) {
  const target = mode ?? getConnectedWalletMode() ?? getWalletModeSync();

  if (target === "base_smart") {
    const runtime = getBaseSmartSession().runtime;
    if (!runtime.disconnect) {
      clearBaseSmartConnection();
      return;
    }

    await Promise.resolve(runtime.disconnect());

    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const next = getBaseSmartSession();
      if (!next.connected || !next.address) {
        clearBaseSmartConnection();
        return;
      }
      await sleep(120);
    }

    clearBaseSmartConnection();
    return;
  }

  const runtime = getWalletConnectSession().runtime;
  if (!runtime.disconnect) {
    clearWalletConnectConnection();
    return;
  }

  await Promise.resolve(runtime.disconnect());

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const next = getWalletConnectSession();
    if (!next.connected || !next.address) {
      clearWalletConnectConnection();
      return;
    }
    await sleep(120);
  }

  clearWalletConnectConnection();
}

export function getActiveWalletSession(): ActiveWalletSession {
  return currentSnapshot();
}

export function subscribeActiveWalletSession(listener: (next: ActiveWalletSession) => void) {
  const emit = () => {
    try {
      listener(currentSnapshot());
    } catch {
      // ignore listener failures
    }
  };

  emit();

  const unsubMode = subscribeWalletMode(() => emit());
  const unsubWc = subscribeWalletConnectSession(() => emit());
  const unsubBase = subscribeBaseSmartSession(() => emit());

  return () => {
    unsubMode();
    unsubWc();
    unsubBase();
  };
}

type ConnectOpts = {
  forceModal?: boolean;
};

export async function connectActiveWalletEvm(timeoutMs = 60_000, opts?: ConnectOpts) {
  const mode = getWalletModeSync();
  if (mode === "base_smart") {
    return connectBaseSmartEvm(timeoutMs, opts);
  }
  return connectWalletConnectEvm(timeoutMs, opts);
}

export async function getActiveWalletEip155Provider(timeoutMs = 60_000) {
  const mode = getWalletModeSync();
  if (mode === "base_smart") {
    return getBaseSmartEip155Provider(timeoutMs);
  }
  return getWalletConnectEip155Provider(timeoutMs);
}
