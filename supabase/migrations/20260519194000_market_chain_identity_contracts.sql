ALTER TABLE IF EXISTS public.market_chain_config
  ADD COLUMN IF NOT EXISTS usdt_address text,
  ADD COLUMN IF NOT EXISTS fee_bps integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS identity_stable_address text,
  ADD COLUMN IF NOT EXISTS identity_factory text,
  ADD COLUMN IF NOT EXISTS identity_router text,
  ADD COLUMN IF NOT EXISTS identity_name_registry text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'market_chain_config_fee_bps_check'
  ) THEN
    ALTER TABLE public.market_chain_config
      ADD CONSTRAINT market_chain_config_fee_bps_check
      CHECK (fee_bps BETWEEN 0 AND 10000);
  END IF;
END $$;

INSERT INTO public.market_chain_config (
  chain,
  chain_id,
  rpc_url,
  usdc_address,
  escrow_address,
  confirmations_required,
  active,
  fee_bps,
  identity_stable_address,
  identity_factory,
  identity_router,
  identity_name_registry,
  updated_at
)
VALUES (
  'base',
  8453,
  null,
  '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  '0x79d140F6e0795287540381D35641DD40b8574CEb',
  12,
  true,
  50,
  '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  '0x9fC8b6ffAece45E8100ADe2C1625a7828Fc94834',
  '0xfdF0C9Ee7DEA4288f28137fC87327F3AaAdC836F',
  '0x89782c54C7F4b915DabB1850B16409cc651FF006',
  now()
)
ON CONFLICT (chain) DO UPDATE
SET
  chain_id = EXCLUDED.chain_id,
  usdc_address = CASE
    WHEN public.market_chain_config.usdc_address IS NULL
      OR public.market_chain_config.usdc_address = ''
      OR public.market_chain_config.usdc_address = '0x0000000000000000000000000000000000000000'
    THEN EXCLUDED.usdc_address
    ELSE public.market_chain_config.usdc_address
  END,
  escrow_address = CASE
    WHEN public.market_chain_config.escrow_address IS NULL
      OR public.market_chain_config.escrow_address = ''
      OR public.market_chain_config.escrow_address = '0x0000000000000000000000000000000000000000'
    THEN EXCLUDED.escrow_address
    ELSE public.market_chain_config.escrow_address
  END,
  confirmations_required = EXCLUDED.confirmations_required,
  fee_bps = CASE
    WHEN COALESCE(public.market_chain_config.fee_bps, 0) = 0 THEN EXCLUDED.fee_bps
    ELSE public.market_chain_config.fee_bps
  END,
  identity_stable_address = CASE
    WHEN public.market_chain_config.identity_stable_address IS NULL
      OR public.market_chain_config.identity_stable_address = ''
      OR public.market_chain_config.identity_stable_address = '0x0000000000000000000000000000000000000000'
    THEN EXCLUDED.identity_stable_address
    ELSE public.market_chain_config.identity_stable_address
  END,
  identity_factory = CASE
    WHEN public.market_chain_config.identity_factory IS NULL
      OR public.market_chain_config.identity_factory = ''
      OR public.market_chain_config.identity_factory = '0x0000000000000000000000000000000000000000'
    THEN EXCLUDED.identity_factory
    ELSE public.market_chain_config.identity_factory
  END,
  identity_router = CASE
    WHEN public.market_chain_config.identity_router IS NULL
      OR public.market_chain_config.identity_router = ''
      OR public.market_chain_config.identity_router = '0x0000000000000000000000000000000000000000'
    THEN EXCLUDED.identity_router
    ELSE public.market_chain_config.identity_router
  END,
  identity_name_registry = CASE
    WHEN public.market_chain_config.identity_name_registry IS NULL
      OR public.market_chain_config.identity_name_registry = ''
      OR public.market_chain_config.identity_name_registry = '0x0000000000000000000000000000000000000000'
    THEN EXCLUDED.identity_name_registry
    ELSE public.market_chain_config.identity_name_registry
  END,
  active = true,
  updated_at = now();
