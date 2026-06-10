import { bad, methodNotAllowed, ok, unauth } from "../_shared/market/http.ts";
import { supabaseAdminClient, supabaseUserClient } from "../_shared/market/supabase.ts";
import { insertCryptoIntent } from "../_shared/market/cryptoIntent.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  const supabase = supabaseUserClient(req);
  const admin = supabaseAdminClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  const user = auth?.user;
  if (authErr || !user) return unauth();

  const body = await req.json().catch(() => ({}));
  const order_id = String(body?.order_id ?? "");
  const tx_hash = String(body?.tx_hash ?? "");
  const chain = String(body?.chain ?? "").trim();

  if (!order_id) return bad("order_id required");

  const { data: order, error: orderErr } = await admin
    .from("market_orders")
    .select("id,buyer_id,status,version")
    .eq("id", order_id)
    .maybeSingle();

  if (orderErr) return bad(orderErr.message);
  if (!order) return bad("Order not found");
  if (order.buyer_id !== user.id) return bad("Not your order");

  const { data: esc, error: escErr } = await admin
    .from("market_crypto_escrows")
    .select("order_id,chain,order_key,buyer_wallet,seller_wallet,token_address,escrow_address,amount_units,amount_raw")
    .eq("order_id", order_id)
    .maybeSingle();

  if (escErr) return bad(escErr.message);
  if (!esc) return bad("Crypto escrow mapping missing");
  if (chain && esc.chain && chain !== esc.chain) return bad("Chain mismatch");

  const { error: updEscErr } = await admin
    .from("market_crypto_escrows")
    .update({
      deposited_tx_hash: tx_hash || null,
      deposited_at: null,
    })
    .eq("order_id", order_id);

  if (updEscErr) return bad(updEscErr.message);

  const { error: intentErr } = await insertCryptoIntent(admin, {
    orderId: order_id,
    intentType: "DEPOSIT",
    status: "SUBMITTED",
    chain: esc.chain,
    fromWallet: esc.buyer_wallet,
    toWallet: esc.escrow_address ?? null,
    tokenAddress: esc.token_address,
    escrowAddress: esc.escrow_address,
    amountUnits: Number(esc.amount_units ?? 0),
    amountRaw: esc.amount_raw ?? null,
    txHash: tx_hash || null,
    orderKey: esc.order_key,
  });
  if (intentErr) return bad(intentErr.message);

  // Strict finality: status transition happens only after chain confirmation.

  await admin.from("market_audit_logs").insert({
    actor_id: user.id,
    actor_type: "user",
    action: "STABLE_DEPOSIT_TX_SUBMITTED",
    entity_type: "market_orders",
    entity_id: order_id,
    payload: { tx_hash: tx_hash || null },
  });

  return ok({ ok: true, order_id, tx_hash: tx_hash || null });
});
