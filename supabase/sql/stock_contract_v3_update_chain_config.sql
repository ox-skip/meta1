-- Stock contract v3 chain config updater.
--
-- Use after a network deployment is complete. Replace the values in the
-- SETTINGS block with the addresses from deployments/identity-<network>.json,
-- then run in the Supabase SQL editor or through a service-role DB session.

DO $$
DECLARE
  v_chain public.chain_name := 'polygon';
  v_chain_id integer := 137;
  v_active boolean := true;
  v_confirmations_required integer := 12;
  v_rpc_url text := '<PASTE_POLYGON_RPC_URL>';
  v_usdc_address text := '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';
  v_identity_stable_address text := '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';
  v_identity_factory text := '0x9fC8b6ffAece45E8100ADe2C1625a7828Fc94834';
  v_identity_router text := '0x94504CCa564AF9DB2602cDA9252b049df65BDa4b';
  v_identity_ownership_controller text := '0x89782c54C7F4b915DabB1850B16409cc651FF006';
  v_identity_liquidity_manager text := '0xfdF0C9Ee7DEA4288f28137fC87327F3AaAdC836F';
BEGIN
  IF v_identity_factory LIKE '<%' OR v_identity_factory = '' THEN
    RAISE EXCEPTION 'Replace v_identity_factory before running this script.';
  END IF;

  IF v_rpc_url LIKE '<%' OR v_rpc_url = '' THEN
    RAISE EXCEPTION 'Replace v_rpc_url before running this script.';
  END IF;

  IF NOT (
    v_rpc_url ~* '^https://'
    AND
    v_usdc_address ~* '^0x[0-9a-f]{40}$'
    AND v_identity_stable_address ~* '^0x[0-9a-f]{40}$'
    AND v_identity_factory ~* '^0x[0-9a-f]{40}$'
    AND v_identity_router ~* '^0x[0-9a-f]{40}$'
    AND v_identity_ownership_controller ~* '^0x[0-9a-f]{40}$'
    AND v_identity_liquidity_manager ~* '^0x[0-9a-f]{40}$'
  ) THEN
    RAISE EXCEPTION 'One or more contract/token addresses are invalid.';
  END IF;

  ALTER TABLE IF EXISTS public.market_chain_config
    ADD COLUMN IF NOT EXISTS usdt_address text,
    ADD COLUMN IF NOT EXISTS fee_bps integer NOT NULL DEFAULT 50,
    ADD COLUMN IF NOT EXISTS identity_stable_address text,
    ADD COLUMN IF NOT EXISTS identity_factory text,
    ADD COLUMN IF NOT EXISTS identity_router text,
    ADD COLUMN IF NOT EXISTS identity_name_registry text,
    ADD COLUMN IF NOT EXISTS identity_ownership_controller text,
    ADD COLUMN IF NOT EXISTS identity_liquidity_manager text;

  INSERT INTO public.market_chain_config (
    chain,
    chain_id,
    rpc_url,
    usdc_address,
    escrow_address,
    confirmations_required,
    active,
    identity_stable_address,
    identity_factory,
    identity_router,
    identity_name_registry,
    identity_ownership_controller,
    identity_liquidity_manager,
    updated_at
  )
  VALUES (
    v_chain,
    v_chain_id,
    v_rpc_url,
    v_usdc_address,
    '0x0000000000000000000000000000000000000000',
    v_confirmations_required,
    v_active,
    v_identity_stable_address,
    v_identity_factory,
    v_identity_router,
    NULL,
    v_identity_ownership_controller,
    v_identity_liquidity_manager,
    now()
  )
  ON CONFLICT (chain) DO UPDATE
  SET
    chain_id = EXCLUDED.chain_id,
    rpc_url = EXCLUDED.rpc_url,
    usdc_address = EXCLUDED.usdc_address,
    confirmations_required = EXCLUDED.confirmations_required,
    active = EXCLUDED.active,
    identity_stable_address = EXCLUDED.identity_stable_address,
    identity_factory = EXCLUDED.identity_factory,
    identity_router = EXCLUDED.identity_router,
    identity_name_registry = EXCLUDED.identity_name_registry,
    identity_ownership_controller = EXCLUDED.identity_ownership_controller,
    identity_liquidity_manager = EXCLUDED.identity_liquidity_manager,
    updated_at = now();
END $$;

SELECT
  chain,
  chain_id,
  active,
  rpc_url IS NOT NULL AS rpc_url_ready,
  usdc_address,
  identity_stable_address,
  identity_factory,
  identity_router,
  identity_ownership_controller,
  identity_liquidity_manager,
  updated_at
FROM public.market_chain_config
WHERE chain = 'polygon'::public.chain_name;
