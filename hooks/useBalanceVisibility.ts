import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "ui:balances_hidden";

let balancesHiddenState = false;
let balancesHiddenHydrated = false;
let loadPromise: Promise<boolean> | null = null;
const listeners = new Set<(hidden: boolean) => void>();

function emit(hidden: boolean) {
  listeners.forEach((listener) => listener(hidden));
}

async function loadBalancesHidden() {
  if (balancesHiddenHydrated) return balancesHiddenState;
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        balancesHiddenState = stored === "1";
      } catch {
        balancesHiddenState = false;
      } finally {
        balancesHiddenHydrated = true;
      }
      emit(balancesHiddenState);
      return balancesHiddenState;
    })().finally(() => {
      loadPromise = null;
    });
  }
  return loadPromise;
}

async function persistBalancesHidden(next: boolean) {
  balancesHiddenState = !!next;
  balancesHiddenHydrated = true;
  emit(balancesHiddenState);
  try {
    await AsyncStorage.setItem(STORAGE_KEY, balancesHiddenState ? "1" : "0");
  } catch {
    // ignore persistence failure and keep the in-memory preference
  }
  return balancesHiddenState;
}

export function maskBalanceValue(prefix = "") {
  return prefix ? `${prefix} ******` : "******";
}

export function useBalanceVisibility() {
  const [balancesHidden, setBalancesHiddenState] = useState(balancesHiddenState);
  const [ready, setReady] = useState(balancesHiddenHydrated);

  useEffect(() => {
    const listener = (hidden: boolean) => {
      setBalancesHiddenState(hidden);
      setReady(true);
    };
    listeners.add(listener);
    if (balancesHiddenHydrated) {
      setBalancesHiddenState(balancesHiddenState);
      setReady(true);
    } else {
      void loadBalancesHidden().catch(() => {
        setReady(true);
      });
    }
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const toggleBalancesHidden = useCallback(async () => {
    return await persistBalancesHidden(!balancesHiddenState);
  }, []);

  const setBalancesHidden = useCallback(async (next: boolean) => {
    return await persistBalancesHidden(next);
  }, []);

  return {
    balancesHidden,
    balancesReady: ready,
    toggleBalancesHidden,
    setBalancesHidden,
  };
}
