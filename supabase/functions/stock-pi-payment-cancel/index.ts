import { bad, methodNotAllowed, ok, unauth } from "../_shared/market/http.ts";
import { piCancelPayment } from "../_shared/market/pi.ts";
import { supabaseAdminClient, supabaseUserClient } from "../_shared/market/supabase.ts";

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

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  const user = auth?.user ?? null;
  const usingCheckoutToken = !user && !!checkout_token;
  if (authErr && !usingCheckoutToken) return unauth();
  if (!user && !usingCheckoutToken) return unauth();

  let query = admin
    .from("market_stock_pi_payments")
    .select("id,user_id,order_id,quote_ref,payment_id,status,checkout_token_expires_at")
    .eq("stock_id", stock_id)
    .eq("quote_ref", quote_ref);
  if (user) query = query.eq("user_id", user.id);
  if (!user && checkout_token) query = query.eq("checkout_token", checkout_token);

  const { data: row, error: rowErr } = await query.maybeSingle();
  if (rowErr) return bad(rowErr.message);
  if (!row) return bad("Pi buy payment not found");

  if (!user) {
    const tokenExpiresAtMs = new Date(String((row as any)?.checkout_token_expires_at || "")).getTime();
    if (!Number.isFinite(tokenExpiresAtMs) || tokenExpiresAtMs <= Date.now()) {
      return bad("Pi checkout session expired.");
    }
  }

  const status = String(row.status || "").toUpperCase();
  if (status === "SETTLED" || status === "CANCELLED") {
    return ok({
      ok: true,
      stock_id,
      quote_ref,
      payment_id: String(row.payment_id || payment_id),
      status,
      idempotent: true,
    });
  }

  const finalPaymentId = String(row.payment_id || payment_id || "").trim();
  if (finalPaymentId) {
    await piCancelPayment(finalPaymentId).catch(() => null);
  }

  const { error: updErr } = await admin
    .from("market_stock_pi_payments")
    .update({
      status: "CANCELLED",
      payment_id: finalPaymentId || null,
      raw: { cancelled_at: new Date().toISOString() },
    })
    .eq("id", row.id)
    .in("status", ["QUOTED", "APPROVED", "FAILED"]);
  if (updErr) return bad(updErr.message);

  await admin
    .from("market_stock_orders")
    .update({
      status: "cancelled",
      fail_reason: "Pi payment cancelled",
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.order_id)
    .eq("user_id", row.user_id)
    .in("status", ["pending", "submitted"]);

  return ok({
    ok: true,
    stock_id,
    quote_ref,
    payment_id: finalPaymentId || null,
    status: "CANCELLED",
  });
});
