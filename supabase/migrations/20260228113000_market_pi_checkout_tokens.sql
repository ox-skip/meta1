BEGIN;

ALTER TABLE public.market_pi_payments
  ADD COLUMN IF NOT EXISTS checkout_token text,
  ADD COLUMN IF NOT EXISTS checkout_token_expires_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS market_pi_payments_checkout_token_idx
  ON public.market_pi_payments (checkout_token)
  WHERE checkout_token IS NOT NULL;

COMMIT;
