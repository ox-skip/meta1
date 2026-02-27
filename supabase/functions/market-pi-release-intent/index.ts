import { bad, methodNotAllowed, ok, unauth } from "../_shared/market/http.ts";
import { toFixedString, toSafeNumber } from "../_shared/market/pi.ts";
import { supabaseAdminClient, supabaseUserClient } from "../_shared/market/supabase.ts";

const PI_CHAIN = "pi_testnet";

async function safeInsertIntent(admin: any, input: {
  order_id: string;
  status: string;
  amount_usd: number;
  release_ref: string;
  failure_reason?: string | null;
}) {
  const { error } = await admin.from("market_crypto_intents").insert({
    order_id: input.order_id,
    intent_type: "RELEASE",
    status: input.status,
    chain: PI_CHAIN,
    from_wallet: "pi_escrow",
    to_wallet: "pi_seller_settlement",
    amount_units: Number(toFixedString(input.amount_usd, 8)),
    amount_raw: null,
    client_reference: input.release_ref,
    tx_hash: null,
    failure_reason: input.failure_reason || null,
  });
  if (error) {
    console.warn("[market-pi-release-intent] intent insert skipped:", error.message);
  }
}

async function transitionToReleased(admin: any, order: any) {
  try {
    const tr = await admin.rpc("market_transition_order_status", {
      p_order_id: order.id,
      p_expected_version: Number(order.version ?? 0),
      p_new_status: "RELEASED",
      p_note: "Pi testnet release confirmed",
    });
    if (!tr.error) return null;
  } catch {
    // fallback below
  }

  const { error } = await admin
    .from("market_orders")
    .update({
      status: "RELEASED",
      released_at: new Date().toISOString(),
      version: Number(order.version ?? 0) + 1,
    })
    .eq("id", order.id)
    .neq("status", "RELEASED");

  return error ? String(error.message || "Unable to transition order to RELEASED") : null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  const supabase = supabaseUserClient(req);
  const admin = supabaseAdminClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  const user = auth?.user;
  if (authErr || !user) return unauth();

  const body = await req.json().catch(() => ({}));
  const order_id = String(body?.order_id ?? "").trim();
  if (!order_id) return bad("order_id required");

  const { data: order, error: orderErr } = await admin
    .from("market_orders")
    .select("id,buyer_id,status,version,amount,listing_id,currency")
    .eq("id", order_id)
    .maybeSingle();
  if (orderErr) return bad(orderErr.message);
  if (!order) return bad("Order not found");
  if (order.buyer_id !== user.id) return bad("Not your order");

  const status = String(order.status || "").toUpperCase();
  if (status === "RELEASED") {
    return ok({ ok: true, order_id, already_released: true, settlement_mode: "pi_testnet_virtual" });
  }

  const allowed = ["IN_ESCROW", "DELIVERED", "DELIVERABLE_UPLOADED"];
  if (!allowed.includes(status)) return bad(`Cannot release from status: ${order.status}`);

  const { data: dispute } = await admin
    .from("market_disputes")
    .select("status")
    .eq("order_id", order_id)
    .maybeSingle();
  if (dispute && String(dispute.status || "").toUpperCase() === "OPEN") {
    return bad("Order is under dispute");
  }

  const { data: piRows, error: piErr } = await admin
    .from("market_pi_payments")
    .select("status,paid_usd")
    .eq("order_id", order_id);
  if (piErr) return bad(piErr.message);
  const paidUsd = ((piRows as any[]) ?? []).reduce((acc, row) => {
    const s = String(row.status || "").toUpperCase();
    if (s !== "SETTLED" && s !== "UNDERPAID") return acc;
    return acc + toSafeNumber(row.paid_usd, 0);
  }, 0);
  if (paidUsd <= 0) return bad("No Pi payment found for this order");

  const { data: listing } = await admin
    .from("market_listings")
    .select("delivery_type")
    .eq("id", order.listing_id)
    .maybeSingle();
  const { data: otp } = await admin
    .from("market_order_otps")
    .select("verified_at")
    .eq("order_id", order_id)
    .maybeSingle();
  const isDigital = String(listing?.delivery_type ?? "").toLowerCase() === "digital";
  if (!isDigital && !otp?.verified_at) return bad("OTP not verified");

  const releaseRef = crypto.randomUUID();
  await safeInsertIntent(admin, {
    order_id,
    status: "CREATED",
    amount_usd: toSafeNumber(order.amount, 0),
    release_ref: releaseRef,
  });

  const trErr = await transitionToReleased(admin, order);
  if (trErr) {
    await safeInsertIntent(admin, {
      order_id,
      status: "FAILED",
      amount_usd: toSafeNumber(order.amount, 0),
      release_ref: releaseRef,
      failure_reason: trErr,
    });
    return bad(trErr);
  }

  await safeInsertIntent(admin, {
    order_id,
    status: "CONFIRMED",
    amount_usd: toSafeNumber(order.amount, 0),
    release_ref: releaseRef,
  });

  try {
    await admin.from("market_audit_logs").insert({
      actor_id: user.id,
      actor_type: "user",
      action: "PI_RELEASE_CONFIRMED",
      entity_type: "market_orders",
      entity_id: order_id,
      payload: {
        release_ref: releaseRef,
        settlement_mode: "pi_testnet_virtual",
        amount_usd: Number(toFixedString(toSafeNumber(order.amount, 0), 8)),
      },
    });
  } catch {
    // audit best-effort
  }

  return ok({
    ok: true,
    order_id,
    release_ref: releaseRef,
    settlement_mode: "pi_testnet_virtual",
    note: "Pi testnet release was confirmed server-side.",
  });
});
