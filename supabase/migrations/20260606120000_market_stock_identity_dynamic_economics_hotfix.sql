ALTER TABLE public.market_stock_identities
  DROP CONSTRAINT IF EXISTS market_stock_identities_total_supply_check,
  DROP CONSTRAINT IF EXISTS market_stock_identities_creation_fee_usdc_check,
  DROP CONSTRAINT IF EXISTS market_stock_identities_creation_lp_usdc_check,
  DROP CONSTRAINT IF EXISTS market_stock_identities_creation_reserve_usdc_check,
  DROP CONSTRAINT IF EXISTS market_stock_identities_creation_economics_check;

ALTER TABLE public.market_stock_identities
  ALTER COLUMN total_supply SET DEFAULT 100000000,
  ALTER COLUMN creation_fee_usdc SET DEFAULT 0,
  ALTER COLUMN creation_lp_usdc SET DEFAULT 0,
  ALTER COLUMN creation_reserve_usdc SET DEFAULT 0;

ALTER TABLE public.market_stock_identities
  ADD CONSTRAINT market_stock_identities_total_supply_check
  CHECK (total_supply > 0);

ALTER TABLE public.market_stock_identities
  ADD CONSTRAINT market_stock_identities_creation_economics_check
  CHECK (
    creation_fee_usdc >= 0
    AND creation_lp_usdc >= 0
    AND creation_reserve_usdc >= 0
    AND round((creation_lp_usdc + creation_reserve_usdc)::numeric, 6) = round(creation_fee_usdc::numeric, 6)
  );
