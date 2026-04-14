import { adminError, getAdminContext } from "../_shared/market/admin.ts";
import { methodNotAllowed, ok } from "../_shared/market/http.ts";
import { supabaseAdminClient } from "../_shared/market/supabase.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  try {
    const ctx = await getAdminContext(req, { requireSession: true });
    if (ctx instanceof Response) return ctx;

    const admin = supabaseAdminClient();
    const nowIso = new Date().toISOString();

    const { error } = await admin
      .from("market_admin_sessions")
      .update({ revoked_at: nowIso, last_seen_at: nowIso })
      .eq("user_id", ctx.userId)
      .eq("session_hash", await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ctx.sessionToken ?? "")).then((buf) =>
        Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("")
      ));

    if (error) throw error;

    await admin.from("market_audit_logs").insert({
      actor_id: ctx.userId,
      actor_type: "admin",
      action: "ADMIN_LOGOUT",
      entity_type: "market_admin_users",
      entity_id: ctx.userId,
      payload: {
        role_key: ctx.roleKey,
        auth_mode: ctx.authMode,
      },
    });

    return ok({ ok: true });
  } catch (e) {
    return adminError(e);
  }
});
