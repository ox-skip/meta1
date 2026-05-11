import "react-native-get-random-values";
// app/_layout.tsx
// app/_layout.tsx
import { supabase } from "@/services/supabase";
import { Redirect, Slot, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import "../global.css";
import { useAuth } from "../hooks/authentication/useAuth";
import { initMobileAds } from "@/services/ads/initMobileAds";
import { OnboardingProvider } from "@/components/onboarding/InAppTutorial";
import { recordAuthSessionNotification } from "@/services/market/notifications";
import { ExternalWalletProvider } from "@/services/wallet/externalWalletProvider";

import * as Application from "expo-application";
import * as Linking from "expo-linking";

/* ---------------- OPTIONAL: GLOBAL FETCH TIMEOUT ----------------
   If you already added a global fetch timeout elsewhere, remove this block.
   This prevents "infinite loading" when network calls hang in RN. */
declare global {
  // eslint-disable-next-line no-var
  var __FETCH_TIMEOUT_INSTALLED__: boolean | undefined;
}
function installFetchTimeout(timeoutMs = 15000) {
  if (globalThis.__FETCH_TIMEOUT_INSTALLED__) return;
  globalThis.__FETCH_TIMEOUT_INSTALLED__ = true;

  const originalFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const callerSignal = init.signal;
    if (callerSignal) {
      if (callerSignal.aborted) controller.abort();
      else callerSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    try {
      return await originalFetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
  };
}
installFetchTimeout(15000);

/* ---------------- VERSION COMPARE ---------------- */
const isOutdated = (current: string, min: string) => {
  const c = current.split(".").map(Number);
  const m = min.split(".").map(Number);

  for (let i = 0; i < Math.max(c.length, m.length); i++) {
    if ((c[i] || 0) < (m[i] || 0)) return true;
    if ((c[i] || 0) > (m[i] || 0)) return false;
  }
  return false;
};

export default function RootLayout() {
  const { user, loading } = useAuth();
  const segments = useSegments();

  const [systemState, setSystemState] = useState<
    | { type: "maintenance"; message: string; eta?: string }
    | { type: "update"; message: string; url: string }
    | null
  >(null);

  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);

  const supabaseUrl = useMemo(
    () => (supabase as any)?.supabaseUrl as string | undefined,
    []
  );

  const retryNonceRef = useRef(0);
  const authEventsReadyRef = useRef(false);
  const lastAuthAccessTokenRef = useRef<string | null>(null);

  /* ---------------- ADMOB INIT ---------------- */
  useEffect(() => {
    initMobileAds();
  }, []);

  /* ---------------- SYSTEM CONTROL CHECK ---------------- */
  useEffect(() => {
    let mounted = true;

    // Only block in production builds
    if (__DEV__) {
      setBooting(false);
      return;
    }

    (async () => {
      try {
        setBootError(null);

        const appVersion = Application.nativeApplicationVersion ?? "0.0.0";

        const { data, error } = await supabase
          .from("app_system_control")
          .select("*")
          .single();

        if (!mounted) return;

        // If this fails, do NOT block the whole app
        if (error || !data) {
          setBooting(false);
          return;
        }

        if (data.maintenance_enabled) {
          setSystemState({
            type: "maintenance",
            message:
              data.maintenance_message ??
              "We are currently performing maintenance.",
            eta: data.maintenance_eta,
          });
          return;
        }

        if (data.force_update && isOutdated(appVersion, data.min_version)) {
          setSystemState({
            type: "update",
            message:
              data.update_message ?? "A new version is required to continue.",
            url: data.apk_url,
          });
        }
      } catch (e: any) {
        if (!mounted) return;
        setBootError(e?.message ?? "System control check failed");
      } finally {
        if (!mounted) return;
        setBooting(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [retryNonceRef.current]);

  useEffect(() => {
    void supabase.auth
      .getSession()
      .then(({ data }) => {
        authEventsReadyRef.current = true;
        lastAuthAccessTokenRef.current = data.session?.access_token ?? null;
      })
      .catch(() => {
        authEventsReadyRef.current = true;
        lastAuthAccessTokenRef.current = null;
      });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      const nextToken = session?.access_token ?? null;

      if (!authEventsReadyRef.current) {
        authEventsReadyRef.current = true;
        lastAuthAccessTokenRef.current = nextToken;
        return;
      }

      if (event === "SIGNED_IN") {
        if (nextToken && nextToken !== lastAuthAccessTokenRef.current) {
          void recordAuthSessionNotification("signed_in");
        }
        lastAuthAccessTokenRef.current = nextToken;
        return;
      }

      if (event === "TOKEN_REFRESHED") {
        lastAuthAccessTokenRef.current = nextToken;
        return;
      }

      if (event === "SIGNED_OUT") {
        lastAuthAccessTokenRef.current = null;
      }
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  /* ---------------- WATCHDOG (FIXED) ----------------
     This now only runs while booting/loading is true.
     It clears automatically when booting/loading ends. */
  useEffect(() => {
    if (!(booting || loading)) return;

    const id = setTimeout(() => {
      setBootError("Having trouble connecting. Please check your network and Supabase URL.");
      setBooting(false);
    }, 20000);

    return () => clearTimeout(id);
  }, [booting, loading]);

  const retryBoot = () => {
    setBootError(null);
    setBooting(true);
    retryNonceRef.current += 1;
  };

  /* ---------------- GLOBAL BLOCK ---------------- */
  if ((booting || loading) && !bootError) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color="#8B5CF6" />
        <Text style={{ marginTop: 10, color: "rgba(255,255,255,0.7)", fontWeight: "800" }}>
          Loading…
        </Text>
      </View>
    );
  }

  if (bootError) {
    return (
      <View style={styles.blockContainer}>
        <Text style={styles.title}>Connection issue</Text>
        <Text style={styles.message}>{bootError}</Text>

        {supabaseUrl ? (
          <Text style={styles.subText}>Supabase URL: {supabaseUrl}</Text>
        ) : null}

        <Pressable style={styles.button} onPress={retryBoot}>
          <Text style={styles.buttonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (systemState?.type === "maintenance") {
    return (
      <View style={styles.blockContainer}>
        <Text style={styles.title}>Maintenance</Text>
        <Text style={styles.message}>{systemState.message}</Text>
        {systemState.eta && (
          <Text style={styles.subText}>
            Estimated return: {systemState.eta}
          </Text>
        )}
      </View>
    );
  }

  if (systemState?.type === "update") {
    return (
      <View style={styles.blockContainer}>
        <Text style={styles.title}>Update Required</Text>
        <Text style={styles.message}>{systemState.message}</Text>

        <Pressable
          style={styles.button}
          onPress={() => Linking.openURL(systemState.url)}
        >
          <Text style={styles.buttonText}>Update Now</Text>
        </Pressable>
      </View>
    );
  }

  /* ---------------- ROUTING (NO ONBOARDING) ---------------- */
  const routeSegments = segments as readonly string[];
  const group = routeSegments[0];
  const route = routeSegments[1];
  const isPasswordRecovery = group === "(auth)" && route === "reset";

  if (!user && group !== "(auth)" && group !== "pi") {
    return <Redirect href="/(auth)/login" />;
  }

  if (user && !isPasswordRecovery && (group === "(auth)" || group === "(onboarding)")) {
    return <Redirect href="/market/(tabs)" />;
  }

  if (user && !group) {
    return <Redirect href="/market/(tabs)" />;
  }

  return (
    <ExternalWalletProvider>
      <OnboardingProvider userId={user?.id ?? null}>
        <Slot />
        <StatusBar style="light" />
      </OnboardingProvider>
    </ExternalWalletProvider>
  );
}

/* ---------------- STYLES ---------------- */
const styles = StyleSheet.create({
  loader: {
    flex: 1,
    backgroundColor: "#060B1A",
    justifyContent: "center",
    alignItems: "center",
  },
  blockContainer: {
    flex: 1,
    backgroundColor: "#050814",
    justifyContent: "center",
    alignItems: "center",
    padding: 28,
  },
  title: {
    fontSize: 24,
    fontWeight: "900",
    color: "#fff",
    marginBottom: 12,
    textAlign: "center",
  },
  message: {
    color: "#9FA8C7",
    textAlign: "center",
    marginBottom: 16,
  },
  subText: {
    color: "#6B7280",
    fontSize: 13,
    textAlign: "center",
    marginBottom: 12,
  },
  button: {
    marginTop: 10,
    backgroundColor: "#8B5CF6",
    paddingVertical: 14,
    paddingHorizontal: 36,
    borderRadius: 18,
  },
  buttonText: {
    color: "#050814",
    fontWeight: "900",
    fontSize: 16,
  },
});
