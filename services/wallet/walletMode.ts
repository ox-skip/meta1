import { Platform } from "react-native";

import * as SecureStore from "@/utils/secureStore";

export type WalletMode = "circle_market" | "walletconnect" | "base_smart";

const KEY_WALLET_MODE = "bc_wallet_mode_v1";

function isCircleWalletModeEnabled() {
  const raw = String(process.env.EXPO_PUBLIC_MARKET_WALLET_PROVIDER || process.env.EXPO_PUBLIC_CIRCLE_WALLET_ENABLED || "").trim().toLowerCase();
  return raw !== "external" && raw !== "walletconnect" && raw !== "0" && raw !== "false";
}

function defaultWalletMode(): WalletMode {
  return isCircleWalletModeEnabled() ? "circle_market" : "walletconnect";
}

let modeState: WalletMode = defaultWalletMode();
let hydrated = false;

const listeners = new Set<(mode: WalletMode) => void>();

function emit() {
  const snapshot = modeState;
  listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch {
      // ignore listener failures
    }
  });
}

function normalizeMode(value: unknown): WalletMode {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "circle_market") return isCircleWalletModeEnabled() ? "circle_market" : "walletconnect";
  if (raw === "base_smart") return "base_smart";
  if (raw === "walletconnect") return "walletconnect";
  return defaultWalletMode();
}

export function isBaseSmartSupported() {
  return Platform.OS === "web";
}

async function hydrateMode() {
  if (hydrated) return modeState;
  hydrated = true;
  try {
    const stored = await SecureStore.getItemAsync(KEY_WALLET_MODE);
    modeState = normalizeMode(stored);
  } catch {
    modeState = defaultWalletMode();
  }
  emit();
  return modeState;
}

void hydrateMode();

export function getWalletModeSync(): WalletMode {
  return modeState;
}

export async function getWalletMode(): Promise<WalletMode> {
  await hydrateMode();
  return modeState;
}

export async function setWalletMode(next: WalletMode) {
  const safe = normalizeMode(next);
  if (safe === "base_smart" && !isBaseSmartSupported()) {
    throw new Error("Coinbase Smart Wallet is available on web. Use WalletConnect on mobile.");
  }
  modeState = safe;
  try {
    await SecureStore.setItemAsync(KEY_WALLET_MODE, safe);
  } catch {
    // ignore persistence failures; state still updates in-memory
  }
  emit();
  return modeState;
}

export function subscribeWalletMode(listener: (mode: WalletMode) => void) {
  listeners.add(listener);
  try {
    listener(modeState);
  } catch {
    // ignore sync listener failures
  }
  void hydrateMode();
  return () => {
    listeners.delete(listener);
  };
}
