import { bad, unauth } from "./http.ts";
import { supabaseAdminClient, supabaseUserClient } from "./supabase.ts";

const SESSION_HEADER = "x-admin-session";

export type AdminContext = {
  userId: string;
  roleKey: string;
  roleName: string;
  permissions: string[];
  sessionToken: string | null;
  authMode: "session" | "service-token";
};

type AdminOptions = {
  permissions?: string[];
  requireSession?: boolean;
  allowServiceToken?: boolean;
};

function normalizePermissions(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.map((value) => String(value ?? "").trim()).filter(Boolean);
}

async function sha256Hex(input: string) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hasAllPermissions(granted: string[], required: string[]) {
  if (!required.length) return true;
  const set = new Set(granted);
  return required.every((item) => set.has(item));
}

async function resolveServiceToken(req: Request): Promise<AdminContext | Response | null> {
  const expected = Deno.env.get("MARKET_ADMIN_TOKEN") ?? "";
  if (!expected) return null;

  const token =
    req.headers.get("x-admin-token") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";

  if (!token || token !== expected) return null;

  return {
    userId: "service-token",
    roleKey: "service-token",
    roleName: "Service Token",
    permissions: ["*"],
    sessionToken: null,
    authMode: "service-token",
  };
}

async function resolveSessionContext(req: Request): Promise<AdminContext | Response> {
  const sessionToken = String(req.headers.get(SESSION_HEADER) ?? "").trim();
  if (!sessionToken) return unauth();

  const userClient = supabaseUserClient(req);
  const authRes = await userClient.auth.getUser();
  const user = authRes.data.user;
  if (authRes.error || !user) return unauth();

  const sessionHash = await sha256Hex(sessionToken);
  const admin = supabaseAdminClient();
  const nowIso = new Date().toISOString();

  const { data: adminRow, error } = await admin
    .from("market_admin_users")
    .select(`
      user_id,
      role_key,
      is_active,
      market_admin_roles (
        key,
        name,
        permissions
      )
    `)
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !adminRow) return unauth();

  const { data: sessionRow, error: sessionError } = await admin
    .from("market_admin_sessions")
    .select("id, expires_at, revoked_at")
    .eq("user_id", user.id)
    .eq("session_hash", sessionHash)
    .is("revoked_at", null)
    .gt("expires_at", nowIso)
    .maybeSingle();

  if (sessionError || !sessionRow) return unauth();

  await admin
    .from("market_admin_sessions")
    .update({ last_seen_at: nowIso })
    .eq("id", sessionRow.id);

  const role = Array.isArray((adminRow as any).market_admin_roles)
    ? (adminRow as any).market_admin_roles[0]
    : (adminRow as any).market_admin_roles;

  return {
    userId: user.id,
    roleKey: String(role?.key ?? adminRow.role_key ?? ""),
    roleName: String(role?.name ?? adminRow.role_key ?? "Admin"),
    permissions: normalizePermissions(role?.permissions),
    sessionToken,
    authMode: "session",
  };
}

export function getForwardedAdminHeaders(req: Request) {
  const headers: Record<string, string> = {};
  const auth = req.headers.get("authorization");
  const sessionToken = req.headers.get(SESSION_HEADER);
  const serviceToken = req.headers.get("x-admin-token");

  if (auth) headers.Authorization = auth;
  if (sessionToken) headers[SESSION_HEADER] = sessionToken;
  if (serviceToken) headers["x-admin-token"] = serviceToken;

  return headers;
}

export async function getAdminContext(req: Request, options: AdminOptions = {}): Promise<AdminContext | Response> {
  const permissions = options.permissions ?? [];
  const allowServiceToken = options.requireSession ? false : (options.allowServiceToken ?? true);

  if (allowServiceToken) {
    const serviceCtx = await resolveServiceToken(req);
    if (serviceCtx && !(serviceCtx instanceof Response)) {
      if (serviceCtx.permissions.includes("*") || hasAllPermissions(serviceCtx.permissions, permissions)) {
        return serviceCtx;
      }
      return unauth();
    }
  }

  const sessionCtx = await resolveSessionContext(req);
  if (sessionCtx instanceof Response) return sessionCtx;
  if (!hasAllPermissions(sessionCtx.permissions, permissions)) return unauth();
  return sessionCtx;
}

export async function requireAdmin(req: Request, options: AdminOptions = {}) {
  const ctx = await getAdminContext(req, options);
  return ctx instanceof Response ? ctx : null;
}

export function adminError(e: unknown) {
  const msg = String((e as any)?.message ?? e);
  return bad(msg);
}
