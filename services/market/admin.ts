import * as SecureStore from "@/utils/secureStore";
import {
  fetchJsonWithTimeout,
  getSupabaseAnonKeyOrThrow,
  getSupabaseFunctionsBaseUrl,
  getSupabaseJwtOrThrow,
} from "@/services/net";

const ADMIN_SESSION_KEY = "market_admin_session_token_v1";

export type MarketAdminOverview = {
  ok: true;
  admin: {
    user_id: string;
    role_key: string;
    role_name: string;
    permissions: string[];
  };
  metrics: Record<string, number>;
  modules: Array<{
    key: string;
    title: string;
    description: string;
    permission: string;
  }>;
};

export type MarketAdminWorkspace = {
  ok: true;
  generated_at: string;
  admin: MarketAdminOverview["admin"];
  modules: {
    support?: {
      disputes: any[];
    };
    moderation?: {
      sellers: any[];
      listings: any[];
    };
    verification?: {
      requests: any[];
    };
    escrow?: {
      orders: any[];
      chains: any[];
      stocks: any[];
      audit_events: any[];
    };
  };
};

export type MarketAdminActionResult = {
  ok: true;
  [key: string]: any;
};

async function getAdminSessionToken() {
  return (await SecureStore.getItemAsync(ADMIN_SESSION_KEY)) || "";
}

export async function clearAdminSessionToken() {
  await SecureStore.deleteItemAsync(ADMIN_SESSION_KEY);
}

async function setAdminSessionToken(token: string) {
  await SecureStore.setItemAsync(ADMIN_SESSION_KEY, token);
}

async function callAdminFn<T>(name: string, body?: unknown): Promise<T> {
  const jwt = await getSupabaseJwtOrThrow();
  const adminSession = await getAdminSessionToken();
  if (!adminSession) {
    throw new Error("Admin password required.");
  }

  const { res, json, text } = await fetchJsonWithTimeout(
    `${getSupabaseFunctionsBaseUrl()}/${name}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
        apikey: getSupabaseAnonKeyOrThrow(),
        "x-admin-session": adminSession,
      },
      body: JSON.stringify(body ?? {}),
    },
    20000,
  );

  if (!res.ok || !json || (json as any)?.error) {
    const message = String((json as any)?.error || text || `${name} failed`);
    if (res.status === 401) {
      await clearAdminSessionToken();
    }
    throw new Error(message);
  }

  return json as T;
}

export async function loginAdmin(password: string) {
  const jwt = await getSupabaseJwtOrThrow();
  const { res, json, text } = await fetchJsonWithTimeout(
    `${getSupabaseFunctionsBaseUrl()}/market-admin-login`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
        apikey: getSupabaseAnonKeyOrThrow(),
      },
      body: JSON.stringify({ password }),
    },
    20000,
  );

  if (!res.ok || !json || (json as any)?.error) {
    throw new Error(String((json as any)?.error || text || "Admin login failed"));
  }

  const token = String((json as any)?.session_token ?? "");
  if (!token) throw new Error("Admin session token missing");
  await setAdminSessionToken(token);
  return json as {
    ok: true;
    session_token: string;
    expires_at: string;
    admin: {
      user_id: string;
      role_key: string;
      role_name: string;
      display_name: string;
      permissions: string[];
    };
  };
}

export async function loadAdminOverview() {
  return await callAdminFn<MarketAdminOverview>("market-admin-overview");
}

export async function loadAdminWorkspace() {
  return await callAdminFn<MarketAdminWorkspace>("market-admin-workspace");
}

export async function runAdminAction(body: Record<string, unknown>) {
  return await callAdminFn<MarketAdminActionResult>("market-admin-action", body);
}

export async function logoutAdmin() {
  try {
    await callAdminFn("market-admin-logout");
  } finally {
    await clearAdminSessionToken();
  }
}

export async function hasStoredAdminSession() {
  return Boolean(await getAdminSessionToken());
}
