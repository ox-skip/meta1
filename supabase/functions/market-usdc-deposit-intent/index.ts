import { bad, methodNotAllowed, ok, unauth } from "../_shared/market/http.ts";
import { supabaseAdminClient, supabaseUserClient } from "../_shared/market/supabase.ts";
import { resolveRpcUrlForChain } from "../_shared/market/chainRpc.ts";
import { addRaw, feeFromRaw, getFeeBps, getFeeRecipient, orderKeyKeccak, toUsdcRaw } from "../_shared/market/crypto.ts";

function pickToken(body: any) {
  return String(body?.token ?? body?.currency ?? body?.token_symbol ?? "USDC").toUpperCase();
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
  const token = pickToken(body);

  if (!order_id) return bad("order_id required");
  if (!chain) return bad("chain required");
  if (!["USDC", "USDT"].includes(token)) return bad("token must be USDC or USDT");

  const { data: order, error: orderErr } = await admin
    .from("market_orders")
    .select("id,buyer_id,seller_id,currency,status,amount,listing_id")
    .eq("id", order_id)
    .maybeSingle();

  if (orderErr) return bad(orderErr.message);
  if (!order) return bad("Order not found");
  if (order.buyer_id !== user.id) return bad("Not your order");
  if (order.status !== "CREATED") return bad(`Order status ${order.status} is not payable`);

  const { data: listing, error: listingErr } = await admin
    .from("market_listings")
    .select("id,payment_options,currency,is_active")
    .eq("id", order.listing_id)
    .maybeSingle();

  if (listingErr) return bad(listingErr.message);
  if (!listing || !listing.is_active) return bad("Listing not found or inactive");

  const po = (listing.payment_options ?? {}) as Record<string, unknown>;
  const hasRoutes =
    typeof po.allow_usdc === "boolean" ||
    typeof po.allow_usdt === "boolean" ||
    typeof po.allow_ngn === "boolean";

  const allowUsdc = hasRoutes ? po.allow_usdc === true : String(listing.currency ?? "").toUpperCase() === "USDC";
  const allowUsdt = hasRoutes ? po.allow_usdt === true : String(listing.currency ?? "").toUpperCase() === "USDT";

  if (token === "USDC" && !allowUsdc) return bad("Listing does not accept USDC");
  if (token === "USDT" && !allowUsdt) return bad("Listing does not accept USDT");

  const { data: cfg, error: cfgErr } = await admin
    .from("market_chain_config")
    .select("chain,chain_id,usdc_address,usdt_address,escrow_address,confirmations_required,rpc_url,active,fee_bps")
    .eq("chain", chain)
    .eq("active", true)
    .maybeSingle();

  if (cfgErr) return bad(cfgErr.message);
  if (!cfg) return bad("Chain config missing or inactive");

  const tokenAddress = token === "USDT" ? cfg.usdt_address : cfg.usdc_address;
  if (!tokenAddress) return bad(`${token} address missing for chain config`);
  if (!cfg.escrow_address) return bad("Escrow address missing for chain config");
  const rpcUrl = resolveRpcUrlForChain(cfg.chain, cfg.rpc_url);

  const { data: buyerWallet } = await admin
    .from("crypto_wallets")
    .select("address")
    .eq("user_id", order.buyer_id)
    .eq("chain", cfg.chain)
    .maybeSingle();

  const { data: sellerWallet } = await admin
    .from("crypto_wallets")
    .select("address")
    .eq("user_id", order.seller_id)
    .eq("chain", cfg.chain)
    .maybeSingle();

  const buyerAddr = String(buyerWallet?.address ?? body?.buyer_wallet ?? "").trim();
  const sellerAddr = String(sellerWallet?.address ?? "").trim();

  if (!buyerAddr.startsWith("0x")) return bad("Buyer wallet not found for selected chain");
  if (!sellerAddr.startsWith("0x")) return bad("Seller wallet not found for selected chain");

  const amountUnits = Number(order.amount ?? 0);
  if (!Number.isFinite(amountUnits) || amountUnits <= 0) return bad("Invalid order amount");

  const amountRaw = toUsdcRaw(amountUnits);
  const orderKey = orderKeyKeccak(order.id);

  const { error: escUpsertErr } = await admin
    .from("market_crypto_escrows")
    .upsert(
      {
        order_id: order.id,
        order_key: orderKey,
        chain: cfg.chain,
        buyer_wallet: buyerAddr,
        seller_wallet: sellerAddr,
        token_address: tokenAddress,
        escrow_address: cfg.escrow_address,
        amount_units: amountUnits,
        amount_raw: amountRaw,
      },
      { onConflict: "order_id" },
    );

  if (escUpsertErr) return bad(escUpsertErr.message);

  if (String(order.currency).toUpperCase() !== token) {
    const { error: updateOrderErr } = await admin
      .from("market_orders")
      .update({ currency: token })
      .eq("id", order.id)
      .eq("status", "CREATED");
    if (updateOrderErr) return bad(updateOrderErr.message);
  }

  const configFeeBps = Number((cfg as any)?.fee_bps ?? NaN);
  const feeBps =
    Number.isFinite(configFeeBps) && configFeeBps >= 0 && configFeeBps <= 200
      ? Math.round(configFeeBps)
      : getFeeBps();
  const buyerFeeRaw = feeFromRaw(amountRaw, feeBps);
  const buyerTotalRaw = addRaw(amountRaw, buyerFeeRaw);

  await admin.rpc("market_set_crypto_intent", {
    p_order_id: order.id,
    p_intent_type: "DEPOSIT",
    p_status: "CREATED",
    p_from_wallet: buyerAddr,
    p_to_wallet: cfg.escrow_address,
    p_amount_units: amountUnits,
    p_amount_raw: amountRaw,
    p_tx_hash: null,
    p_failure_reason: null,
  });

  return ok({
    ok: true,
    order_id: order.id,
    order_key: orderKey,
    chain: cfg.chain,
    chain_id: cfg.chain_id,
    confirmations_required: cfg.confirmations_required,
    rpc_url: rpcUrl || cfg.rpc_url,
    escrow_address: cfg.escrow_address,
    token_symbol: token,
    token_address: tokenAddress,
    usdc_address: cfg.usdc_address,
    usdt_address: cfg.usdt_address ?? null,
    buyer_wallet: buyerAddr,
    seller_wallet: sellerAddr,
    amount_units: amountUnits,
    amount_raw: amountRaw,
    fee_bps: feeBps,
    fee_recipient: getFeeRecipient(),
    buyer_fee_raw: buyerFeeRaw,
    buyer_total_raw: buyerTotalRaw,
    contract_method: "deposit(bytes32 orderKey, address seller, address token, uint256 amount)",
  });
});
