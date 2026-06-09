-- Repair USDC listings that were saved with both stable checkout routes disabled.
-- Safe to run more than once.

UPDATE public.market_listings
SET
  payment_options = jsonb_set(
    COALESCE(payment_options, '{}'::jsonb),
    '{allow_usdc}',
    'true'::jsonb,
    true
  ),
  updated_at = now()
WHERE UPPER(currency::text) = 'USDC'
  AND COALESCE(payment_options->'allow_usdc', 'false'::jsonb) <> 'true'::jsonb
  AND COALESCE(payment_options->'allow_usdt', 'false'::jsonb) <> 'true'::jsonb;
