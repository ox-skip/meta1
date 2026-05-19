ALTER TABLE IF EXISTS public.market_listings
  ADD COLUMN IF NOT EXISTS featured_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS featured_until timestamptz,
  ADD COLUMN IF NOT EXISTS featured_priority integer NOT NULL DEFAULT 100;

ALTER TABLE IF EXISTS public.market_listings
  DROP CONSTRAINT IF EXISTS market_listings_featured_priority_check;

ALTER TABLE IF EXISTS public.market_listings
  ADD CONSTRAINT market_listings_featured_priority_check
  CHECK (featured_priority BETWEEN 0 AND 100000);

UPDATE public.market_listings
SET featured_priority = 100
WHERE featured_priority IS NULL;
