import { bad, methodNotAllowed, ok, unauth } from "../_shared/market/http.ts";
import { piApprovePayment } from "../_shared/market/pi.ts";
import { supabaseAdminClient, supabaseUserClient } from "../_shared/market/supabase.ts";

async function safeAudit(admin: any, payload: Record<string, unknown>) {
  const { error } = await admin.from("market_audit_logs").insert(payload);
  if (error) {
    console.warn("[stock-pi-payment-approve] audit insert skipped:", error.message);
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  const supabase = supabaseUserClient(req);
  const admin = supabaseAdminClient();
  const body = await req.json().catch(() => ({}));
  const stock_id = String(body?.stock_id ?? body?.identity_id ?? "").trim();
  const quote_ref = String(body?.quote_ref ?? "").trim();
  const payment_id = String(body?.payment_id ?? "").trim();
  const checkout_token = String(body?.checkout_token ?? "").trim();

  if (!stock_id) return bad("stock_id required");
  if (!quote_ref) return bad("quote_ref required");
  if (!payment_id) return bad("payment_id required");

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  const user = auth?.user ?? null;
  const usingCheckoutToken = !user && !!checkout_token;
  if (authErr && !usingCheckoutToken) return unauth();
  if (!user && !usingCheckoutToken) return unauth();

  let query = admin
    .from("market_stock_pi_payments")
    .select("id,stock_id,user_id,order_id,quote_id,quote_ref,payment_id,status,checkout_token_expires_at")
    .eq("stock_id", stock_id)
    .eq("quote_ref", quote_ref);

  if (user) query = query.eq("user_id", user.id);
  if (!user && checkout_token) query = query.eq("checkout_token", checkout_token);

  const { data: row, error: rowErr } = await query.maybeSingle();
  if (rowErr) return bad(rowErr.message);
  if (!row) return bad("Pi buy intent not found");
  if (user && row.user_id !== user.id) return bad("Not your quote");

  if (!user) {
    const tokenExpiresAtMs = new Date(String((row as any)?.checkout_token_expires_at || "")).getTime();
    if (!Number.isFinite(tokenExpiresAtMs) || tokenExpiresAtMs <= Date.now()) {
      return bad("Pi checkout session expired. Start the Pi buy again.");
    }
  }

  const status = String(row.status || "").toUpperCase();
  if (status === "SETTLED" || status === "APPROVED") {
    return ok({
      ok: true,
      stock_id,
      quote_ref,
      payment_id: String(row.payment_id || payment_id),
      status,
      idempotent: true,
    });
  }
  if (status === "CANCELLED") return bad("Pi buy payment is cancelled");

  const boundPaymentId = String(row.payment_id || "").trim();
  if (boundPaymentId && boundPaymentId !== payment_id) {
    return bad("Quote already bound to another payment id");
  }

  try {
    await piApprovePayment(payment_id);
  } catch (e: any) {
    await admin
      .from("market_stock_pi_payments")
      .update({
        payment_id,
        status: "FAILED",
        raw: { approve_error: String(e?.message || e || "Pi approve failed") },
      })
      .eq("id", row.id)
      .eq("status", row.status);
    return bad(String(e?.message || e || "Pi approve failed"));
  }

  const { error: updErr } = await admin
    .from("market_stock_pi_payments")
    .update({
      payment_id,
      status: "APPROVED",
      raw: { approved_at: new Date().toISOString() },
    })
    .eq("id", row.id)
    .in("status", ["QUOTED", "FAILED"]);
  if (updErr) return bad(updErr.message);

  await admin
    .from("market_stock_orders")
    .update({
      status: "submitted",
      settlement_rail: "pi",
      external_payment_id: payment_id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.order_id)
    .eq("user_id", row.user_id);

  await safeAudit(admin, {
    actor_id: user?.id ?? null,
    actor_type: user ? "user" : "system",
    action: "STOCK_PI_BUY_APPROVED",
    entity_type: "market_stock_identities",
    entity_id: stock_id,
    payload: {
      order_id: row.order_id,
      quote_ref,
      payment_id,
    },
  });

  return ok({
    ok: true,
    stock_id,
    quote_ref,
    payment_id,
    status: "APPROVED",
  });
});
