import { ok, methodNotAllowed } from "../_shared/market/http.ts";
import { supabaseAdminClient } from "../_shared/market/supabase.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  const admin = supabaseAdminClient();

  let { data, error } = await admin
    .from("market_chain_config")
    .select("chain,chain_id,rpc_url,usdc_address,usdt_address,escrow_address,faucet_address,faucet_active,faucet_cooldown_seconds,faucet_usdc_amount_raw,faucet_usdt_amount_raw,is_testnet,identity_factory,identity_router,identity_name_registry,identity_ownership_controller,identity_liquidity_manager,identity_stable_address,confirmations_required,active")
    .order("active", { ascending: false });

  if (error) {
    const legacy = await admin
      .from("market_chain_config")
      .select("chain,chain_id,rpc_url,usdc_address,usdt_address,escrow_address,faucet_address,faucet_active,faucet_cooldown_seconds,faucet_usdc_amount_raw,faucet_usdt_amount_raw,identity_factory,identity_router,identity_name_registry,identity_stable_address,confirmations_required,active")
      .order("active", { ascending: false });
    data = legacy.data;
    error = legacy.error;
  }

  if (error) {
    return ok({ chains: [], error: error.message });
  }

  return ok({ chains: data ?? [] });
});
