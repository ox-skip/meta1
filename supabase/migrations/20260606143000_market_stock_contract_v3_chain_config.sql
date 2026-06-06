ALTER TABLE IF EXISTS public.market_chain_config
  ADD COLUMN IF NOT EXISTS identity_ownership_controller text,
  ADD COLUMN IF NOT EXISTS identity_liquidity_manager text;
