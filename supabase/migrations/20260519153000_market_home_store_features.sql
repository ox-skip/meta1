ALTER TABLE IF EXISTS public.market_seller_profiles
  ADD COLUMN IF NOT EXISTS featured_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS featured_until timestamptz,
  ADD COLUMN IF NOT EXISTS featured_listing_limit integer NOT NULL DEFAULT 12;

ALTER TABLE IF EXISTS public.market_seller_profiles
  DROP CONSTRAINT IF EXISTS market_seller_profiles_featured_listing_limit_check;

ALTER TABLE IF EXISTS public.market_seller_profiles
  ADD CONSTRAINT market_seller_profiles_featured_listing_limit_check
  CHECK (featured_listing_limit BETWEEN 1 AND 100);

UPDATE public.market_seller_profiles
SET featured_listing_limit = 12
WHERE featured_listing_limit IS NULL;
