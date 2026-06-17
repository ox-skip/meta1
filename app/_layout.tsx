import "react-native-get-random-values";
// app/_layout.tsx
// app/_layout.tsx
import { supabase } from "@/services/supabase";
import { Redirect, Slot, useGlobalSearchParams, usePathname, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Image,
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
import {
  buildSessionRouteHref,
  isSessionRestoreEntryPoint,
  loadLastSessionRoute,
  saveLastSessionRoute,
} from "@/services/navigation/sessionRoute";
import { ExternalWalletProvider } from "@/services/wallet/externalWalletProvider";

import * as Application from "expo-application";
import * as Linking from "expo-linking";

const APP_LOGO = require("@/assets/images/icon.png");
const BRAND_SURFACE = "#090D0B";
const BRAND_SURFACE_DEEP = "#050706";
const BRAND_TEAL = "#2DD4BF";
const BRAND_GOLD = "#F4B75D";
const BRAND_TEXT = "#FFFDF7";
const BRAND_MUTED = "rgba(255,253,247,0.66)";

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

function BrandBootLoader() {
  const spin = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const spinLoop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 1180,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 760,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 760,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );

    spinLoop.start();
    pulseLoop.start();
    return () => {
      spinLoop.stop();
      pulseLoop.stop();
    };
  }, [pulse, spin]);

  const rotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });
  const pulseScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.92, 1.08],
  });
  const pulseOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.48, 0.86],
  });

  return (
    <View style={styles.loader}>
      <View style={styles.loaderGlow} />
      <View style={styles.loaderCard}>
        <Animated.View
          style={[
            styles.loaderPulse,
            {
              opacity: pulseOpacity,
              transform: [{ scale: pulseScale }],
            },
          ]}
        />
        <Animated.View style={[styles.loaderRing, { transform: [{ rotate }] }]} />
        <View style={styles.loaderLogoWrap}>
          <Image source={APP_LOGO} style={styles.loaderLogo} resizeMode="cover" />
        </View>
      </View>
      <Text style={styles.loaderTitle}>BestCity Market</Text>
      <Text style={styles.loaderText}>Preparing your marketplace</Text>
      <View style={styles.loaderDots}>
        <View style={[styles.loaderDot, { backgroundColor: BRAND_TEAL }]} />
        <View style={[styles.loaderDot, { backgroundColor: BRAND_GOLD }]} />
        <View style={[styles.loaderDot, { backgroundColor: BRAND_TEAL }]} />
      </View>
    </View>
  );
}

export default function RootLayout() {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const pathname = usePathname();
  const routeParams = useGlobalSearchParams();

  const [systemState, setSystemState] = useState<
    | { type: "maintenance"; message: string; eta?: string }
    | { type: "update"; message: string; url: string }
    | null
  >(null);

  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);
  const [lastRouteReady, setLastRouteReady] = useState(false);
  const [lastRouteHref, setLastRouteHref] = useState<string | null>(null);
  const [hasInitialUrl, setHasInitialUrl] = useState(false);
  const [initialUrlChecked, setInitialUrlChecked] = useState(false);

  const retryNonceRef = useRef(0);
  const authEventsReadyRef = useRef(false);
  const lastAuthAccessTokenRef = useRef<string | null>(null);
  const lastSavedRouteRef = useRef<string | null>(null);
  const routeSegments = segments as readonly string[];
  const routeParamsKey = useMemo(() => JSON.stringify(routeParams ?? {}), [routeParams]);

  /* ---------------- ADMOB INIT ---------------- */
  useEffect(() => {
    initMobileAds();
  }, []);

  useEffect(() => {
    let mounted = true;

    Linking.getInitialURL()
      .then((url: string | null) => {
        if (mounted) {
          setHasInitialUrl(Boolean(url));
          setInitialUrlChecked(true);
        }
      })
      .catch(() => {
        if (mounted) {
          setHasInitialUrl(false);
          setInitialUrlChecked(true);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const userId = user?.id ?? null;

    setLastRouteReady(false);
    setLastRouteHref(null);
    lastSavedRouteRef.current = null;

    if (!userId) {
      setLastRouteReady(true);
      return () => {
        mounted = false;
      };
    }

    loadLastSessionRoute(userId)
      .then((href) => {
        if (!mounted) return;
        setLastRouteHref(href);
        lastSavedRouteRef.current = href;
      })
      .catch(() => {
        if (!mounted) return;
        setLastRouteHref(null);
      })
      .finally(() => {
        if (mounted) setLastRouteReady(true);
      });

    return () => {
      mounted = false;
    };
  }, [user?.id]);

  useEffect(() => {
    const userId = user?.id ?? null;
    if (!userId || !lastRouteReady || booting || loading) return;

    const shouldRestore =
      !!lastRouteHref &&
      initialUrlChecked &&
      !hasInitialUrl &&
      isSessionRestoreEntryPoint(routeSegments, pathname) &&
      lastRouteHref !== pathname;
    if (shouldRestore) return;

    const href = buildSessionRouteHref(pathname, routeParams as Record<string, unknown>, routeSegments);
    if (!href || href === lastSavedRouteRef.current) return;

    lastSavedRouteRef.current = href;
    void saveLastSessionRoute(userId, href);
  }, [
    user?.id,
    lastRouteReady,
    lastRouteHref,
    initialUrlChecked,
    hasInitialUrl,
    booting,
    loading,
    pathname,
    routeParamsKey,
    routeSegments.join("/"),
  ]);

  /* ---------------- SYSTEM CONTROL CHECK ---------------- */
  useEffect(() => {
    let mounted = true;

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
          setSystemState(null);
          setBooting(false);
          return;
        }

        setSystemState(null);

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
      setBootError("Having trouble connecting to BestCity services.");
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
  const isAdminRoute = routeSegments[0] === "market" && routeSegments[1] === "admin";
  const isAuthRoute = routeSegments[0] === "(auth)";
  const canBypassMaintenance = isAdminRoute || isAuthRoute;

  if ((booting || loading) && !bootError) {
    return <BrandBootLoader />;
  }

  /*
          Loading…
        </Text>
      </View>
    );
  }

  */

  if (bootError) {
    return (
      <View style={styles.blockContainer}>
        <Text style={styles.title}>Connection issue</Text>
        <Text style={styles.message}>{bootError}</Text>
        <Text style={styles.subText}>BestCity services could not be reached. Please try again.</Text>

        <Pressable style={styles.button} onPress={retryBoot}>
          <Text style={styles.buttonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (systemState?.type === "maintenance" && !canBypassMaintenance) {
    return (
      <View style={styles.blockContainer}>
        <Text style={styles.title}>BestCity is upgrading</Text>
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
  const group = routeSegments[0];
  const route = routeSegments[1];
  const isPasswordRecovery = group === "(auth)" && route === "reset";
  const shouldRestoreLastRoute =
    !!user &&
    lastRouteReady &&
    !!lastRouteHref &&
    initialUrlChecked &&
    !hasInitialUrl &&
    !isPasswordRecovery &&
    isSessionRestoreEntryPoint(routeSegments, pathname) &&
    lastRouteHref !== pathname;

  if (!user && group !== "(auth)" && group !== "pi") {
    return <Redirect href="/(auth)/login" />;
  }

  if (shouldRestoreLastRoute) {
    return <Redirect href={lastRouteHref as any} />;
  }

  if (user && !isPasswordRecovery && (group === "(auth)" || group === "(onboarding)")) {
    return <Redirect href="/market/wallet-setup" />;
  }

  if (user && !group) {
    return <Redirect href={(lastRouteHref || "/market/(tabs)") as any} />;
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
    backgroundColor: BRAND_SURFACE,
    justifyContent: "center",
    alignItems: "center",
    padding: 28,
    overflow: "hidden",
  },
  loaderGlow: {
    position: "absolute",
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: "rgba(45,212,191,0.10)",
    borderWidth: 1,
    borderColor: "rgba(244,183,93,0.12)",
  },
  loaderCard: {
    width: 118,
    height: 118,
    alignItems: "center",
    justifyContent: "center",
  },
  loaderPulse: {
    position: "absolute",
    width: 96,
    height: 96,
    borderRadius: 34,
    backgroundColor: "rgba(45,212,191,0.12)",
    borderWidth: 1,
    borderColor: "rgba(45,212,191,0.34)",
  },
  loaderRing: {
    position: "absolute",
    width: 112,
    height: 112,
    borderRadius: 40,
    borderWidth: 4,
    borderColor: "rgba(255,253,247,0.10)",
    borderTopColor: BRAND_TEAL,
    borderRightColor: BRAND_GOLD,
  },
  loaderLogoWrap: {
    width: 62,
    height: 62,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "rgba(255,253,247,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,253,247,0.18)",
  },
  loaderLogo: {
    width: 62,
    height: 62,
  },
  loaderTitle: {
    marginTop: 20,
    color: BRAND_TEXT,
    fontSize: 20,
    fontWeight: "900",
    textAlign: "center",
  },
  loaderText: {
    marginTop: 6,
    color: BRAND_MUTED,
    fontWeight: "800",
    fontSize: 13,
    textAlign: "center",
  },
  loaderDots: {
    marginTop: 16,
    flexDirection: "row",
    gap: 7,
  },
  loaderDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    opacity: 0.82,
  },
  blockContainer: {
    flex: 1,
    backgroundColor: BRAND_SURFACE_DEEP,
    justifyContent: "center",
    alignItems: "center",
    padding: 28,
  },
  title: {
    fontSize: 24,
    fontWeight: "900",
    color: BRAND_TEXT,
    marginBottom: 12,
    textAlign: "center",
  },
  message: {
    color: BRAND_MUTED,
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
    backgroundColor: BRAND_GOLD,
    paddingVertical: 14,
    paddingHorizontal: 36,
    borderRadius: 18,
  },
  buttonText: {
    color: BRAND_SURFACE_DEEP,
    fontWeight: "900",
    fontSize: 16,
  },
});
