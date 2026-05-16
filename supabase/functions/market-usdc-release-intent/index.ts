import { bad, methodNotAllowed, ok, unauth } from "../_shared/market/http.ts";
import { supabaseAdminClient, supabaseUserClient } from "../_shared/market/supabase.ts";

function normalizeOrderKey(value: unknown) {
  const raw = String(value ?? "").trim();
  const withPrefix = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(withPrefix)) {
    throw new Error("Stored escrow order_key must be a 32-byte hex value");
  }
  return withPrefix;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  const supabase = supabaseUserClient(req);
  const admin = supabaseAdminClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  const user = auth?.user;
  if (authErr || !user) return unauth();

  const body = await req.json().catch(() => ({}));
  const order_id = String(body?.order_id ?? "");
  const chain = String(body?.chain ?? "");

  if (!order_id) return bad("order_id required");

  const { data: order } = await admin
    .from("market_orders")
    .select("id,buyer_id,currency,status,listing_id")
    .eq("id", order_id)
    .maybeSingle();

  if (!order) return bad("Order not found");
  if (order.buyer_id !== user.id) return bad("Not your order");
  if (!["USDC", "USDT"].includes(order.currency)) return bad("Order must be USDC or USDT");

  const allowed = ["IN_ESCROW", "DELIVERED", "DELIVERABLE_UPLOADED"];

  const { data: dispute } = await admin
    .from("market_disputes")
    .select("status")
    .eq("order_id", order_id)
    .maybeSingle();

  if (dispute && String(dispute.status || "").toUpperCase() === "OPEN") {
    return bad("Order is under dispute");
  }

  if (!allowed.includes(order.status)) {
    return bad(`Cannot release from status: ${order.status}`);
  }

  const { data: esc } = await admin
    .from("market_crypto_escrows")
    .select("order_id,order_key,escrow_address,buyer_wallet,seller_wallet,token_address,amount_units,amount_raw,chain")
    .eq("order_id", order_id)
    .maybeSingle();

  if (!esc?.order_key) return bad("Crypto escrow mapping missing");
  const orderKey = normalizeOrderKey(esc.order_key);
  if (chain && esc.chain && chain !== esc.chain) return bad("Chain mismatch");

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

  await admin.rpc("market_set_crypto_intent", {
    p_order_id: order_id,
    p_intent_type: "RELEASE",
    p_status: "CREATED",
    p_from_wallet: esc.buyer_wallet,
    p_to_wallet: esc.seller_wallet,
    p_amount_units: Number(esc.amount_units ?? 0),
    p_amount_raw: esc.amount_raw ?? null,
    p_tx_hash: null,
    p_failure_reason: null,
  });

  await admin.from("market_audit_logs").insert({
    actor_id: user.id,
    actor_type: "user",
    action: `${order.currency}_RELEASE_INTENT`,
    entity_type: "market_orders",
    entity_id: order_id,
    payload: { order_key: orderKey, chain: esc.chain },
  });

  return ok({
    ok: true,
    order_id,
    order_key: orderKey,
    chain: esc.chain,
    escrow_address: esc.escrow_address,
    contract_method: "release(bytes32 orderKey)",
    args: [orderKey],
    note: "Client should send on-chain release tx, then indexer updates DB to RELEASED",
  });
});
