import {
  fetchJsonWithTimeout,
  getSupabaseAnonKeyOrThrow,
  getSupabaseFunctionsBaseUrl,
  getSupabaseJwtOrThrow,
} from "@/services/net";
import { recordAuthSessionNotification } from "@/services/market/notifications";
import { supabase } from "@/services/supabase";

function shortText(text: string | null | undefined, limit = 600) {
  if (!text) return "";
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

async function invokeFn<T>(name: string, body: any, timeoutMs: number, token: string) {
  const base = getSupabaseFunctionsBaseUrl();
  return await fetchJsonWithTimeout(
    `${base}/${name}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: getSupabaseAnonKeyOrThrow(),
      },
      body: JSON.stringify(body ?? {}),
    },
    timeoutMs,
  );
}

function extractErrorMessage(text: string | null | undefined, json: any, name: string) {
  return (
    json?.message ||
    json?.error ||
    (typeof json === "string" ? json : null) ||
    (text && text.length < 400 ? text : null) ||
    `Function ${name} failed`
  );
}

async function invokeSdkWithTimeout<T>(name: string, body: any, token: string, timeoutMs = 12000) {
  return await Promise.race([
    supabase.functions.invoke(name, {
      body: body ?? {},
      headers: { Authorization: `Bearer ${token}` },
    }),
    new Promise<{ data: null; error: Error }>((resolve) =>
      setTimeout(() => resolve({ data: null, error: new Error(`Function ${name} timed out`) }), timeoutMs),
    ),
  ]) as { data: T | null; error: any };
}

export async function callFn<T>(name: string, body?: any, timeoutMs = 20000): Promise<T> {
  console.log(`[callFn] ${name} -> start`, body ?? {});

  // First path: SDK invoke with explicit Authorization header.
  try {
    let token = await getSupabaseJwtOrThrow();
    let first = await invokeSdkWithTimeout<T>(name, body, token);

    if (!first.error && first.data) {
      console.log(`[callFn] ${name} -> ok (sdk invoke)`);
      return first.data as T;
    }
    if (first.error) {
      console.log(`[callFn] ${name} -> sdk invoke error`, shortText(String(first.error?.message || first.error)));
    }

    const firstMsg = String(first.error?.message || "");
    if (first.error && /jwt|unauthori/i.test(firstMsg)) {
      const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
      if (!refreshErr && refreshed.session?.access_token) {
        token = refreshed.session.access_token;
        first = await invokeSdkWithTimeout<T>(name, body, token);
        if (!first.error && first.data) {
          console.log(`[callFn] ${name} -> ok (sdk invoke retry)`);
          return first.data as T;
        }
        if (first.error) {
          console.log(`[callFn] ${name} -> sdk invoke retry error`, shortText(String(first.error?.message || first.error)));
        }
      }
    }
  } catch {
    // Continue to manual fallback below.
  }

  // Manual fallback path
  let token = await getSupabaseJwtOrThrow();
  let { res, text, json } = await invokeFn<T>(name, body, timeoutMs, token);

  if (!res.ok) {
    console.log(`[callFn] ${name} -> HTTP ${res.status}`, shortText(text));
  }

  let msg = extractErrorMessage(text, json, name);

  if (!res.ok || (json as any)?.success === false) {
    const lower = String(msg || "").toLowerCase();
    const shouldRetry =
      res.status === 401 && (lower.includes("invalid jwt") || lower.includes("jwt"));

    if (shouldRetry) {
      try {
        const { data: refreshed, error } = await supabase.auth.refreshSession();
        if (!error && refreshed.session?.access_token) {
          token = refreshed.session.access_token;
          const retry = await invokeFn<T>(name, body, timeoutMs, token);
          res = retry.res;
          text = retry.text;
          json = retry.json;
          msg = extractErrorMessage(text, json, name);
        }
      } catch {
        // fall through to error handling
      }
    }
  }

  // Last-resort: use supabase.functions.invoke to let the SDK attach auth headers
  if (!res.ok || (json as any)?.success === false) {
    const lower = String(msg || "").toLowerCase();
    const shouldInvokeFallback =
      res.status === 401 && (lower.includes("invalid jwt") || lower.includes("jwt"));

    if (shouldInvokeFallback) {
      try {
        const token = await getSupabaseJwtOrThrow();
        const { data, error } = await invokeSdkWithTimeout<T>(name, body, token);
        if (!error && data) {
          return data as T;
        }
        if (error) {
          msg = error.message || msg;
        }
      } catch {
        // fall through to error handling
      }
    }
  }

  if (!res.ok || (json as any)?.success === false) {
    const lower = String(msg || "").toLowerCase();
    if (res.status === 401 && (lower.includes("invalid jwt") || lower.includes("jwt"))) {
      try {
        await recordAuthSessionNotification("expired");
      } catch {
        // ignore notification failures during session expiry
      }
      try {
        await supabase.auth.signOut();
      } catch {
        // ignore sign out failures
      }
      throw new Error("Session expired. Please sign in again.");
    }
    console.log(`[callFn] ${name} -> error`, msg);
    const err = new Error(msg);
    (err as any).details = {
      status: res.status,
      text,
      json,
    };
    throw err;
  }

  console.log(`[callFn] ${name} -> ok ${res.status}`);
  return json as T;
}
