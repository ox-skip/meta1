DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'chain_name'
      AND t.typnamespace = 'public'::regnamespace
      AND e.enumlabel = 'arc_testnet'
  ) THEN
    ALTER TYPE public.chain_name ADD VALUE 'arc_testnet';
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE IF EXISTS public.market_chain_config
  ADD COLUMN IF NOT EXISTS usdt_address text,
  ADD COLUMN IF NOT EXISTS fee_bps integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS is_testnet boolean NOT NULL DEFAULT false,
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
  usdt_address,
  escrow_address,
  confirmations_required,
  active,
  fee_bps,
  is_testnet,
  identity_stable_address,
  identity_factory,
  identity_router,
  identity_name_registry,
  identity_ownership_controller,
  identity_liquidity_manager,
  updated_at
)
VALUES (
  'arc_testnet'::public.chain_name,
  5042002,
  'https://rpc.testnet.arc.network',
  '0x3600000000000000000000000000000000000000',
  NULL,
  '0x20D29e4260b9E767db2050dF25A1511a0b8d614E',
  1,
  true,
  50,
  true,
  '0x3600000000000000000000000000000000000000',
  '0xc053b9341D5f7bbA520Ab2A5F87062AE757febc6',
  '0x3fB6D2e89B632f11cb2B6729C1f8F3426cA61359',
  NULL,
  '0xc41E31384519A38a6bA239BF71C2c910d783dBd4',
  '0x0d90Ab30c2d2681CfBe6283Fc13e7A5b43D1ca8e',
  now()
)
ON CONFLICT (chain) DO UPDATE
SET
  chain_id = EXCLUDED.chain_id,
  rpc_url = COALESCE(NULLIF(public.market_chain_config.rpc_url, ''), EXCLUDED.rpc_url),
  usdc_address = CASE
    WHEN public.market_chain_config.usdc_address IS NULL
      OR public.market_chain_config.usdc_address = ''
      OR public.market_chain_config.usdc_address = '0x0000000000000000000000000000000000000000'
    THEN EXCLUDED.usdc_address
    ELSE public.market_chain_config.usdc_address
  END,
  escrow_address = EXCLUDED.escrow_address,
  confirmations_required = EXCLUDED.confirmations_required,
  fee_bps = CASE
    WHEN COALESCE(public.market_chain_config.fee_bps, 0) = 0 THEN EXCLUDED.fee_bps
    ELSE public.market_chain_config.fee_bps
  END,
  is_testnet = true,
  identity_stable_address = COALESCE(
    NULLIF(public.market_chain_config.identity_stable_address, ''),
    EXCLUDED.identity_stable_address
  ),
  identity_factory = EXCLUDED.identity_factory,
  identity_router = EXCLUDED.identity_router,
  identity_name_registry = EXCLUDED.identity_name_registry,
  identity_ownership_controller = EXCLUDED.identity_ownership_controller,
  identity_liquidity_manager = EXCLUDED.identity_liquidity_manager,
  active = EXCLUDED.active,
  updated_at = now();
