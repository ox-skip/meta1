export type BaseSmartRuntime = {
  openModal?: () => Promise<void> | void;
  disconnect?: () => Promise<void> | void;
  switchNetwork?: (caipNetwork: string) => Promise<void> | void;
};

export type BaseSmartSession = {
  connected: boolean;
  address: string;
  chainId: number;
  provider: any | null;
  providerType: string;
  runtime: BaseSmartRuntime;
};

const EMPTY_RUNTIME: BaseSmartRuntime = {};

let state: BaseSmartSession = {
  connected: false,
  address: "",
  chainId: 0,
  provider: null,
  providerType: "",
  runtime: EMPTY_RUNTIME,
};

const listeners = new Set<(next: BaseSmartSession) => void>();

function isAddress(value: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || ""));
}

function notify() {
  const snapshot = getBaseSmartSession();
  listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch {
      // ignore listener failures
    }
  });
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function waitForOpenModal(timeoutMs: number): Promise<BaseSmartRuntime["openModal"]> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const open = getBaseSmartSession().runtime.openModal;
    if (open) return open;
    await sleep(120);
  }
  return undefined;
}

export function setBaseSmartRuntime(runtime: BaseSmartRuntime) {
  state = {
    ...state,
    runtime: runtime || EMPTY_RUNTIME,
  };
  notify();
}

export function setBaseSmartConnection(input: {
  connected?: boolean;
  address?: string | null;
  chainId?: number | null;
  provider?: any;
  providerType?: string | null;
}) {
  const nextAddress = String(input.address || "").trim();
  const nextConnected = Boolean(input.connected) && isAddress(nextAddress);
  const nextChainId = Number(input.chainId);

  state = {
    ...state,
    connected: nextConnected,
    address: nextConnected ? nextAddress : "",
    chainId: Number.isFinite(nextChainId) ? nextChainId : 0,
    provider: input.provider ?? null,
    providerType: String(input.providerType || "base_smart"),
  };

  notify();
}

export function clearBaseSmartConnection() {
  state = {
    ...state,
    connected: false,
    address: "",
    chainId: 0,
    provider: null,
    providerType: "",
  };
  notify();
}

export function getBaseSmartSession(): BaseSmartSession {
  return {
    connected: state.connected,
    address: state.address,
    chainId: state.chainId,
    provider: state.provider,
    providerType: state.providerType,
    runtime: {
      openModal: state.runtime.openModal,
      disconnect: state.runtime.disconnect,
      switchNetwork: state.runtime.switchNetwork,
    },
  };
}

export function subscribeBaseSmartSession(listener: (next: BaseSmartSession) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

type ConnectBaseSmartOpts = {
  forceModal?: boolean;
};

export async function connectBaseSmartEvm(timeoutMs = 60_000, opts?: ConnectBaseSmartOpts) {
  const current = getBaseSmartSession();
  const forceModal = opts?.forceModal === true;
  if (!forceModal && current.connected && current.address) return current;

  let openModal = current.runtime.openModal;
  if (!openModal) {
    openModal = await waitForOpenModal(Math.min(timeoutMs, 12_000));
  }

  if (!openModal) {
    throw new Error("Coinbase Smart Wallet is still initializing. Retry in a moment.");
  }

  await Promise.resolve(openModal());

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const next = getBaseSmartSession();
    if (next.connected && next.address) return next;
    await sleep(200);
  }

  throw new Error("Coinbase Smart Wallet connection timed out. Approve the connection and retry.");
}

export async function getBaseSmartEip155Provider(timeoutMs = 60_000) {
  let connected = await connectBaseSmartEvm(timeoutMs);
  let provider = connected.provider;

  if (!provider || typeof provider.request !== "function") {
    const runtime = getBaseSmartSession().runtime;
    if (runtime.openModal) {
      await Promise.resolve(runtime.openModal());
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        connected = getBaseSmartSession();
        provider = connected.provider;
        if (connected.connected && connected.address && provider && typeof provider.request === "function") {
          break;
        }
        await sleep(200);
      }
    }
  }

  if (!provider || typeof provider.request !== "function") {
    throw new Error("Coinbase Smart Wallet is unavailable. Reconnect and try again.");
  }

  return {
    provider,
    address: connected.address,
    chainId: connected.chainId,
  };
}
