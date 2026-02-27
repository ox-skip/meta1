BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'chain_name'
      AND t.typnamespace = 'public'::regnamespace
      AND e.enumlabel = 'pi_testnet'
  ) THEN
    ALTER TYPE public.chain_name ADD VALUE 'pi_testnet';
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS public.market_pi_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.market_orders(id) ON DELETE CASCADE,
  buyer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  quote_ref text NOT NULL UNIQUE,
  quote_usd_amount numeric(20,8) NOT NULL CHECK (quote_usd_amount > 0),
  quote_pi_amount numeric(30,8) NOT NULL CHECK (quote_pi_amount > 0),
  quote_price_usd numeric(20,8) NOT NULL CHECK (quote_price_usd > 0),
  quote_expires_at timestamptz NOT NULL,
  payment_id text UNIQUE,
  txid text UNIQUE,
  is_topup boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'QUOTED' CHECK (
    status IN ('QUOTED','APPROVED','CANCELLED','UNDERPAID','SETTLED','FAILED')
  ),
  paid_pi_amount numeric(30,8),
  completion_price_usd numeric(20,8),
  paid_usd numeric(20,8),
  cumulative_paid_usd numeric(20,8),
  shortfall_usd numeric(20,8),
  topup_pi_required numeric(30,8),
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_pi_payments_order_idx
  ON public.market_pi_payments (order_id, created_at DESC);

CREATE INDEX IF NOT EXISTS market_pi_payments_buyer_idx
  ON public.market_pi_payments (buyer_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS market_pi_payments_status_idx
  ON public.market_pi_payments (status, quote_expires_at);

CREATE OR REPLACE FUNCTION public.market_pi_payments_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_market_pi_payments_touch_updated_at ON public.market_pi_payments;
CREATE TRIGGER trg_market_pi_payments_touch_updated_at
BEFORE UPDATE ON public.market_pi_payments
FOR EACH ROW EXECUTE FUNCTION public.market_pi_payments_touch_updated_at();

ALTER TABLE public.market_pi_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS market_pi_payments_select_own ON public.market_pi_payments;
CREATE POLICY market_pi_payments_select_own
ON public.market_pi_payments
FOR SELECT
TO authenticated
USING (buyer_id = auth.uid());

GRANT SELECT ON public.market_pi_payments TO authenticated;

COMMIT;
