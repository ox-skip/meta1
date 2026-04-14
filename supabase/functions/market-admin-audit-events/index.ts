import { adminError, requireAdmin } from "../_shared/market/admin.ts";
import { bad, methodNotAllowed, ok } from "../_shared/market/http.ts";
import { supabaseAdminClient } from "../_shared/market/supabase.ts";

Deno.serve(async (req) => {
  if (req.method !== "GET") return methodNotAllowed(req);

  try {
    const authFail = await requireAdmin(req, { requireSession: true, permissions: ["audit.read"] });
    if (authFail) return authFail;

    const admin = supabaseAdminClient();
    const url = new URL(req.url);
    const order_id = url.searchParams.get("order_id");
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);

    if (!order_id) return bad("order_id is required");

    const { data, error } = await admin
      .from("market_audit_logs")
      .select("*")
      .eq("entity_type", "market_orders")
      .eq("entity_id", order_id)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) return bad(error.message);

    return ok({ order_id, events: data ?? [] });
  } catch (e) {
    return adminError(e);
  }
});
