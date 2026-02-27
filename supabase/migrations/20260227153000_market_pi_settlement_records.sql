BEGIN;

CREATE TABLE IF NOT EXISTS public.market_pi_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.market_orders(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('RELEASE', 'REFUND')),
  status text NOT NULL DEFAULT 'CREATED' CHECK (
    status IN ('CREATED', 'SUBMITTED', 'CONFIRMED', 'FAILED', 'CANCELLED')
  ),
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_type text NOT NULL DEFAULT 'system' CHECK (
    actor_type IN ('buyer', 'seller', 'admin', 'system')
  ),
  recipient_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_pi_uid text NOT NULL,
  recipient_wallet text,
  amount_pi numeric(30,8) NOT NULL CHECK (amount_pi > 0),
  amount_usd_snapshot numeric(20,8) NOT NULL CHECK (amount_usd_snapshot >= 0),
  payment_id text UNIQUE,
  txid text UNIQUE,
  failure_reason text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_at timestamptz,
  confirmed_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_pi_settlements_order_kind_idx
  ON public.market_pi_settlements (order_id, kind, created_at DESC);

CREATE INDEX IF NOT EXISTS market_pi_settlements_status_idx
  ON public.market_pi_settlements (status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS market_pi_settlements_one_confirmed_idx
  ON public.market_pi_settlements (order_id, kind)
  WHERE status = 'CONFIRMED';

CREATE OR REPLACE FUNCTION public.market_pi_settlements_touch_updated_at()
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

DROP TRIGGER IF EXISTS trg_market_pi_settlements_touch_updated_at ON public.market_pi_settlements;
CREATE TRIGGER trg_market_pi_settlements_touch_updated_at
BEFORE UPDATE ON public.market_pi_settlements
FOR EACH ROW EXECUTE FUNCTION public.market_pi_settlements_touch_updated_at();

ALTER TABLE public.market_pi_settlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS market_pi_settlements_select_participants ON public.market_pi_settlements;
CREATE POLICY market_pi_settlements_select_participants
ON public.market_pi_settlements
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.market_orders o
    WHERE o.id = order_id
      AND (o.buyer_id = auth.uid() OR o.seller_id = auth.uid())
  )
);

GRANT SELECT ON public.market_pi_settlements TO authenticated;

COMMIT;
