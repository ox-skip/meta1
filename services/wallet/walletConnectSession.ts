export type WalletConnectRuntime = {
  openModal?: () => Promise<void> | void;
  disconnect?: () => Promise<void> | void;
  switchNetwork?: (caipNetwork: string) => Promise<void> | void;
};

export type WalletConnectSession = {
  connected: boolean;
  address: string;
  chainId: number;
  provider: any | null;
  providerType: string;
  caipAddress: string;
  accountType: string;
  smartAccounts: string[];
  runtime: WalletConnectRuntime;
};

const EMPTY_RUNTIME: WalletConnectRuntime = {};

let state: WalletConnectSession = {
  connected: false,
  address: "",
  chainId: 0,
  provider: null,
  providerType: "",
  caipAddress: "",
  accountType: "",
  smartAccounts: [],
  runtime: EMPTY_RUNTIME,
};

const listeners = new Set<(next: WalletConnectSession) => void>();
const walletConnectProjectId = String(process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID || "").trim();

function isAddress(value: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || ""));
}

function notify() {
  const snapshot = getWalletConnectSession();
  listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch {
      // ignore listener failures
    }
  });
}

export function parseChainIdFromCaipAddress(caipAddress?: string | null) {
  const raw = String(caipAddress || "").trim();
  // CAIP address format for EVM: eip155:<chainId>:<address>
  const m = /^eip155:(\d+):0x[a-fA-F0-9]{40}$/.exec(raw);
  if (!m) return 0;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : 0;
}

export function plainAddressFromCaip(caipAddress?: string | null) {
  const raw = String(caipAddress || "").trim();
  const m = /^eip155:\d+:(0x[a-fA-F0-9]{40})$/.exec(raw);
  return m?.[1] || "";
}

export function setWalletConnectRuntime(runtime: WalletConnectRuntime) {
  state = {
    ...state,
    runtime: runtime || EMPTY_RUNTIME,
  };
  notify();
}

export function setWalletConnectConnection(input: {
  connected?: boolean;
  address?: string | null;
  chainId?: number | null;
  provider?: any;
  providerType?: string | null;
  caipAddress?: string | null;
  accountType?: string | null;
  smartAccounts?: (string | null | undefined)[] | null;
}) {
  const nextAddress = String(input.address || "").trim();
  const nextChainId = Number(input.chainId);
  const smartAccounts = (input.smartAccounts ?? [])
    .map((account) => plainAddressFromCaip(account) || String(account || "").trim())
    .filter(isAddress);
  const nextAccountType = String(input.accountType || "");
  const effectiveAddress =
    nextAccountType.toLowerCase().includes("smart") && smartAccounts[0]
      ? smartAccounts[0]
      : nextAddress;
  const nextConnected = Boolean(input.connected) && isAddress(effectiveAddress);

  state = {
    ...state,
    connected: nextConnected,
    address: nextConnected ? effectiveAddress : "",
    chainId: Number.isFinite(nextChainId) ? nextChainId : 0,
    provider: input.provider ?? null,
    providerType: String(input.providerType || ""),
    caipAddress: String(input.caipAddress || ""),
    accountType: nextAccountType,
    smartAccounts,
  };

  notify();
}

export function clearWalletConnectConnection() {
  state = {
    ...state,
    connected: false,
    address: "",
    chainId: 0,
    provider: null,
    providerType: "",
    caipAddress: "",
    accountType: "",
    smartAccounts: [],
  };
  notify();
}

export function getWalletConnectSession(): WalletConnectSession {
  return {
    connected: state.connected,
    address: state.address,
    chainId: state.chainId,
    provider: state.provider,
    providerType: state.providerType,
    caipAddress: state.caipAddress,
    accountType: state.accountType,
    smartAccounts: [...state.smartAccounts],
    runtime: {
      openModal: state.runtime.openModal,
      disconnect: state.runtime.disconnect,
      switchNetwork: state.runtime.switchNetwork,
    },
  };
}

export function subscribeWalletConnectSession(listener: (next: WalletConnectSession) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function waitForOpenModal(timeoutMs: number) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const open = getWalletConnectSession().runtime.openModal;
    if (open) return open;
    await sleep(120);
  }
  return null;
}

type ConnectWalletConnectOpts = {
  forceModal?: boolean;
};

export async function connectWalletConnectEvm(timeoutMs = 60_000, opts?: ConnectWalletConnectOpts) {
  const current = getWalletConnectSession();
  const forceModal = opts?.forceModal === true;
  if (!forceModal && current.connected && current.address) return current;

  let openModal = current.runtime.openModal;
  if (!openModal) {
    openModal = await waitForOpenModal(Math.min(timeoutMs, 12_000));
  }

  if (!openModal) {
    if (!walletConnectProjectId) {
      throw new Error("WalletConnect is not configured. Set EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID in this app and restart.");
    }
    throw new Error("WalletConnect is still initializing. Retry in a moment.");
  }

  await Promise.resolve(openModal());

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const next = getWalletConnectSession();
    if (next.connected && next.address) return next;
    await sleep(200);
  }

  throw new Error("Wallet connection timed out. Open WalletConnect and approve the session.");
}

export async function getWalletConnectEip155Provider(timeoutMs = 60_000) {
  let connected = await connectWalletConnectEvm(timeoutMs);
  let provider = connected.provider;

  if (!provider || typeof provider.request !== "function") {
    const runtime = getWalletConnectSession().runtime;
    if (runtime.openModal) {
      await Promise.resolve(runtime.openModal());
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        connected = getWalletConnectSession();
        provider = connected.provider;
        if (connected.connected && connected.address && provider && typeof provider.request === "function") {
          break;
        }
        await sleep(200);
      }
    }
  }

  if (!provider || typeof provider.request !== "function") {
    throw new Error("Connected wallet provider is unavailable. Reconnect your wallet and try again.");
  }

  return {
    provider,
    address: connected.address,
    chainId: connected.chainId,
  };
}
