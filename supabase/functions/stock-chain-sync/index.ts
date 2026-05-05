import { adminError, requireAdmin } from "../_shared/market/admin.ts";
import { bad, methodNotAllowed, ok } from "../_shared/market/http.ts";
import { supabaseAdminClient } from "../_shared/market/supabase.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  try {
    const blocked = await requireAdmin(req, { requireSession: true, permissions: ["chain.admin"] });
    if (blocked) return blocked;

    const admin = supabaseAdminClient();
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "").trim().toLowerCase();

    if (action === "set_reinvestment_status") {
      const reinvestmentId = String(body?.reinvestment_id ?? "").trim();
      const status = String(body?.status ?? "").trim().toLowerCase();
      const txHash = String(body?.tx_hash ?? "").trim() || null;
      if (!reinvestmentId) return bad("reinvestment_id is required");
      if (!["queued", "submitted", "confirmed", "failed"].includes(status)) return bad("Invalid status");

      const { data, error } = await admin
        .from("market_stock_reinvestments")
        .update({
          status,
          tx_hash: txHash,
          updated_at: new Date().toISOString(),
        })
        .eq("id", reinvestmentId)
        .select("*")
        .single();
      if (error) return bad(error.message);
      return ok({ ok: true, action, reinvestment: data });
    }

    if (action === "set_trading_pause") {
      const stockId = String(body?.stock_id ?? "").trim();
      const pauseMinutes = Number(body?.pause_minutes ?? 0);
      if (!stockId) return bad("stock_id is required");

      const pausedUntil = pauseMinutes > 0
        ? new Date(Date.now() + (pauseMinutes * 60 * 1000)).toISOString()
        : null;

      const { data, error } = await admin
        .from("market_stock_identities")
        .update({
          trading_paused_until: pausedUntil,
          updated_at: new Date().toISOString(),
        })
        .eq("id", stockId)
        .select("id,slug,name,symbol,trading_paused_until,updated_at")
        .single();
      if (error) return bad(error.message);
      return ok({ ok: true, action, stock: data });
    }

    return bad("Unsupported action");
  } catch (e) {
    return adminError(e);
  }
});
