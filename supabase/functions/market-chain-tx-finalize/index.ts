import { bad, methodNotAllowed, ok, unauth } from "../_shared/market/http.ts";
import { supabaseAdminClient, supabaseUserClient } from "../_shared/market/supabase.ts";
import { resolveRpcUrlForChain } from "../_shared/market/chainRpc.ts";
import {
  decodeEscrowData,
  findEscrowEventLog,
  hexToAddress,
  rpcCall,
  toNum,
  type EscrowEventType,
} from "../_shared/market/escrowEvents.ts";
type EventType = EscrowEventType;

function isHexHash(v?: string | null) {
  return /^0x[a-fA-F0-9]{64}$/.test(String(v || "").trim());
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
  const tx_hash = String(body?.tx_hash ?? "").toLowerCase();
  const event_type = String(body?.event_type ?? "").toUpperCase() as EventType;
  const chain = String(body?.chain ?? "");

  if (!order_id) return bad("order_id required");
  if (!isHexHash(tx_hash)) return bad("tx_hash required");
  if (!(["DEPOSIT", "RELEASE", "REFUND"] as string[]).includes(event_type)) return bad("event_type must be DEPOSIT, RELEASE or REFUND");

  const { data: order, error: orderErr } = await admin
    .from("market_orders")
    .select("id,buyer_id,seller_id,status,version")
    .eq("id", order_id)
    .maybeSingle();

  if (orderErr) return bad(orderErr.message);
  if (!order) return bad("Order not found");
  if (user.id !== order.buyer_id && user.id !== order.seller_id) return bad("Not allowed");

  const { data: esc, error: escErr } = await admin
    .from("market_crypto_escrows")
    .select("order_id,order_key,chain,escrow_address,token_address,buyer_wallet,seller_wallet,amount_units,amount_raw")
    .eq("order_id", order_id)
    .maybeSingle();

  if (escErr) return bad(escErr.message);
  if (!esc?.order_key) return bad("Crypto escrow mapping missing");
  if (chain && esc.chain && chain !== esc.chain) return bad("Chain mismatch");

  const { data: cfg, error: cfgErr } = await admin
    .from("market_chain_config")
    .select("chain,rpc_url,confirmations_required,active,escrow_address,usdc_address")
    .eq("chain", esc.chain)
    .eq("active", true)
    .maybeSingle();

  if (cfgErr) return bad(cfgErr.message);
  if (!cfg) return bad("Active chain config not found");
  const rpcUrl = resolveRpcUrlForChain(esc.chain, cfg.rpc_url);
  if (!rpcUrl) return bad("rpc_url missing for selected chain");

  const expectedEscrow = String(esc.escrow_address || cfg.escrow_address || "").trim().toLowerCase();
  if (!expectedEscrow.startsWith("0x")) return bad("Escrow address missing for selected chain");
  if (cfg.escrow_address && String(cfg.escrow_address).trim().toLowerCase() !== expectedEscrow) {
    return bad("Escrow address mismatch between order mapping and chain config");
  }

  const receipt = await rpcCall(rpcUrl, "eth_getTransactionReceipt", [tx_hash]);
  if (!receipt) return ok({ ok: true, finalized: false, reason: "pending_mempool" });

  const statusHex = String(receipt?.status ?? "0x0");
  if (statusHex !== "0x1") {
    await admin.rpc("market_set_crypto_intent", {
      p_order_id: order_id,
      p_intent_type: event_type,
      p_status: "FAILED",
      p_from_wallet: esc.buyer_wallet ?? null,
      p_to_wallet: esc.seller_wallet ?? null,
      p_amount_units: Number(esc.amount_units ?? 0),
      p_amount_raw: esc.amount_raw ?? null,
      p_tx_hash: tx_hash,
      p_failure_reason: `Transaction reverted (${statusHex})`,
    });
    return bad("Transaction reverted on-chain");
  }

  const blockNumber = toNum(receipt?.blockNumber);
  const latestBlock = toNum(await rpcCall(rpcUrl, "eth_blockNumber", []));
  const confirmations = Math.max(0, latestBlock - blockNumber + 1);
  const required = Number(cfg.confirmations_required ?? 1);

  if (confirmations < required) {
    return ok({ ok: true, finalized: false, confirmations, required });
  }

  const hit = findEscrowEventLog(receipt, expectedEscrow, esc.order_key, event_type);
  if (!hit) return bad(`Expected ${event_type} event not found in tx logs`);

  if (event_type === "DEPOSIT") {
    const buyer = hexToAddress(hit.topics?.[2]);
    const seller = hexToAddress(hit.topics?.[3]);
    const { token, amountRaw } = decodeEscrowData(hit.data);
    const tokenAddr = (token || esc.token_address || cfg.usdc_address || "").toLowerCase();
    const amountUnits = Number(amountRaw) / 1_000_000;
    const { error: applyErr } = await admin.rpc("market_apply_chain_deposit", {
      p_order_id: esc.order_id,
      p_buyer_wallet: buyer,
      p_seller_wallet: seller,
      p_amount_raw: amountRaw ? amountRaw.toString() : null,
      p_amount_units: amountUnits,
      p_tx_hash: String(hit.transactionHash ?? tx_hash),
      p_log_index: toNum(hit.logIndex as any),
      p_block_number: toNum(hit.blockNumber as any),
      p_block_time: null,
      p_raw: hit,
      p_token_address: tokenAddr,
    });
    if (applyErr) return bad(applyErr.message);
  } else if (event_type === "RELEASE") {
    const { error: applyErr } = await admin.rpc("market_apply_chain_release", {
      p_order_id: esc.order_id,
      p_tx_hash: String(hit.transactionHash ?? tx_hash),
      p_log_index: toNum(hit.logIndex as any),
      p_block_number: toNum(hit.blockNumber as any),
      p_block_time: null,
      p_raw: hit,
    });
    if (applyErr) return bad(applyErr.message);
  } else {
    const { error: applyErr } = await admin.rpc("market_apply_chain_refund", {
      p_order_id: esc.order_id,
      p_tx_hash: String(hit.transactionHash ?? tx_hash),
      p_log_index: toNum(hit.logIndex as any),
      p_block_number: toNum(hit.blockNumber as any),
      p_block_time: null,
      p_raw: hit,
    });
    if (applyErr) return bad(applyErr.message);
  }

  await admin.from("market_audit_logs").insert({
    actor_id: user.id,
    actor_type: "user",
    action: `STABLE_${event_type}_CONFIRMED`,
    entity_type: "market_orders",
    entity_id: order_id,
    payload: { tx_hash, chain: esc.chain, confirmations, required },
  });

  return ok({ ok: true, finalized: true, confirmations, required, event_type, order_id, chain: esc.chain });
});
