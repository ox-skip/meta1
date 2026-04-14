import { adminError } from "../_shared/market/admin.ts";
import { bad, methodNotAllowed, ok, unauth } from "../_shared/market/http.ts";
import { supabaseAdminClient, supabaseUserClient } from "../_shared/market/supabase.ts";

function randomToken() {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
}

async function sha256Hex(input: string) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  try {
    const userClient = supabaseUserClient(req);
    const authRes = await userClient.auth.getUser();
    const user = authRes.data.user;
    if (authRes.error || !user) return unauth();

    const body = await req.json().catch(() => ({}));
    const password = String(body?.password ?? "").trim();
    if (!password) return bad("Admin password is required");

    const admin = supabaseAdminClient();
    const { data: adminUser, error: adminErr } = await admin
      .from("market_admin_users")
      .select(`
        user_id,
        role_key,
        is_active,
        display_name,
        market_admin_roles (
          key,
          name,
          permissions
        )
      `)
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (adminErr || !adminUser) return unauth();

    const verifyRes = await admin.rpc("market_admin_verify_password", {
      p_user_id: user.id,
      p_password: password,
    });
    if (verifyRes.error) return bad(verifyRes.error.message);
    if (!verifyRes.data) return unauth();

    const plainToken = randomToken();
    const sessionHash = await sha256Hex(plainToken);
    const ttlHours = Math.max(1, Math.min(Number(Deno.env.get("MARKET_ADMIN_SESSION_HOURS") ?? "12"), 72));
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
    const nowIso = new Date().toISOString();

    await admin
      .from("market_admin_sessions")
      .update({ revoked_at: nowIso })
      .eq("user_id", user.id)
      .is("revoked_at", null);

    const { error: insertErr } = await admin
      .from("market_admin_sessions")
      .insert({
        user_id: user.id,
        session_hash: sessionHash,
        expires_at: expiresAt,
        last_seen_at: nowIso,
        ip_address: req.headers.get("x-forwarded-for"),
        user_agent: req.headers.get("user-agent"),
      });
    if (insertErr) return bad(insertErr.message);

    await admin
      .from("market_admin_users")
      .update({ last_login_at: nowIso, updated_at: nowIso })
      .eq("user_id", user.id);

    const role = Array.isArray((adminUser as any).market_admin_roles)
      ? (adminUser as any).market_admin_roles[0]
      : (adminUser as any).market_admin_roles;

    await admin.from("market_audit_logs").insert({
      actor_id: user.id,
      actor_type: "admin",
      action: "ADMIN_LOGIN",
      entity_type: "market_admin_users",
      entity_id: user.id,
      payload: {
        role_key: adminUser.role_key,
        auth_mode: "session",
      },
    });

    return ok({
      ok: true,
      session_token: plainToken,
      expires_at: expiresAt,
      admin: {
        user_id: user.id,
        role_key: String(role?.key ?? adminUser.role_key ?? ""),
        role_name: String(role?.name ?? adminUser.role_key ?? "Admin"),
        display_name: adminUser.display_name ?? user.email ?? "Admin",
        permissions: Array.isArray(role?.permissions) ? role.permissions : [],
      },
    });
  } catch (e) {
    return adminError(e);
  }
});
