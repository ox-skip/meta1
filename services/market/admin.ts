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
      tickets: any[];
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
    admins?: {
      users: any[];
      roles: any[];
    };
  };
};

export type MarketAdminSupportTicketResult = {
  ok: true;
  generated_at: string;
  admin: MarketAdminOverview["admin"];
  ticket: any;
};

export type MarketAdminActionResult = {
  ok: true;
  [key: string]: any;
};

export type MarketSupportAiTriage = {
  category: string;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  confidence: "LOW" | "MEDIUM" | "HIGH";
  summary: string;
  customer_goal: string;
  urgency_reason: string;
  key_facts: string[];
  missing_evidence: string[];
  risk_flags: string[];
  recommended_next_action: string;
  suggested_admin_reply: string;
};

export type MarketSupportAiTriageResult = {
  ok: true;
  ticket_id: string;
  generated_at: string;
  model?: string;
  cached?: boolean;
  triage: MarketSupportAiTriage;
};

export type MarketDisputeAiReview = {
  recommendation: "RELEASE_TO_SELLER" | "REFUND_TO_BUYER" | "REQUEST_MORE_EVIDENCE" | "ESCALATE";
  confidence: "LOW" | "MEDIUM" | "HIGH";
  summary: string;
  buyer_claim: string;
  seller_claim: string;
  evidence_assessment: string;
  image_observations: string[];
  key_facts: string[];
  contradictions: string[];
  missing_evidence: string[];
  risk_flags: string[];
  recommended_admin_action: string;
  suggested_resolution_note: string;
};

export type MarketDisputeAiReviewResult = {
  ok: true;
  dispute_id: string;
  order_id: string;
  generated_at: string;
  model?: string;
  image_count: number;
  skipped_images?: string[];
  review: MarketDisputeAiReview;
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

async function callAdminFn<T>(name: string, body?: unknown, timeoutMs = 20000): Promise<T> {
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
    timeoutMs,
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

export async function loadAdminSupportTicket(ticketId: string) {
  return await callAdminFn<MarketAdminSupportTicketResult>(
    "market-admin-support-ticket",
    { ticket_id: ticketId },
  );
}

export async function runAdminAction(body: Record<string, unknown>) {
  return await callAdminFn<MarketAdminActionResult>("market-admin-action", body);
}

export async function generateSupportAiTriage(ticketId: string, options?: { force?: boolean }) {
  return await callAdminFn<MarketSupportAiTriageResult>(
    "market-support-ai-triage",
    { ticket_id: ticketId, force: options?.force === true },
    45000,
  );
}

function uuidOrNull(value?: string | null) {
  const raw = String(value ?? "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)
    ? raw
    : null;
}

export async function generateDisputeAiReview(disputeId: string, orderId?: string | null) {
  const cleanDisputeId = uuidOrNull(disputeId);
  const cleanOrderId = uuidOrNull(orderId);
  return await callAdminFn<MarketDisputeAiReviewResult>(
    "market-dispute-ai-review",
    { dispute_id: cleanDisputeId, order_id: cleanOrderId },
    60000,
  );
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
