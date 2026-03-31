// services/supabase.ts
import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const SUPABASE_URL =
  (process.env.EXPO_PUBLIC_SUPABASE_URL as string | undefined) ??
  (process.env.NEXT_PUBLIC_SUPABASE_URL as string | undefined) ??
  "";

const SUPABASE_ANON_KEY =
  (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string | undefined) ??
  (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string | undefined) ??
  "";

// ---- timeout fetch used by supabase-js (prevents endless loading) ----
export function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 20000,
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // If caller passed a signal, pipe it into our controller
  const callerSignal = init.signal;
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  return fetch(input, { ...init, signal: controller.signal })
    .finally(() => clearTimeout(timeoutId));
}

// Choose timeout based on endpoint (uploads need longer)
function supabaseFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = String(input);
  const method = (init?.method || "GET").toUpperCase();

  // Storage uploads can be slower; give them more time
  const isStorage =
    url.includes("/storage/v1/") ||
    url.includes("/storage/v1/object/") ||
    url.includes("/storage/v1/upload/");

  const isWrite = ["POST", "PUT", "PATCH"].includes(method);

  const timeout =
    isStorage && isWrite ? 600000 : // 10 minutes for storage uploads
    isWrite ? 30000 :               // 30s for writes
    20000;                          // 20s for reads

  return fetchWithTimeout(input, init ?? {}, timeout);
}

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn(
    "[supabase] Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY in this build.",
  );
}

if (Platform.OS !== "web" && /localhost|127\.0\.0\.1/i.test(SUPABASE_URL)) {
  console.warn(
    `[supabase] Your SUPABASE_URL is "${SUPABASE_URL}". This will NOT work on a physical phone. Use hosted https://<project>.supabase.co or your PC LAN IP.`,
  );
}

console.log("[supabase] URL:", SUPABASE_URL);

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storage: Platform.OS === "web" ? undefined : (AsyncStorage as any),
  },
  global: {
    fetch: supabaseFetch as any,
  },
});
