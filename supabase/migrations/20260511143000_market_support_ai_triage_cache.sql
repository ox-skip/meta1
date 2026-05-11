BEGIN;

CREATE TABLE IF NOT EXISTS public.market_support_ai_triages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.market_support_tickets(id) ON DELETE CASCADE,
  generated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'gemini',
  model text,
  triage jsonb NOT NULL,
  source_ticket_updated_at timestamptz,
  source_last_message_at timestamptz,
  source_message_count integer NOT NULL DEFAULT 0 CHECK (source_message_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ticket_id)
);

CREATE INDEX IF NOT EXISTS market_support_ai_triages_ticket_idx
  ON public.market_support_ai_triages (ticket_id, updated_at DESC);

CREATE OR REPLACE FUNCTION public.market_touch_support_ai_triage()
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

DROP TRIGGER IF EXISTS trg_market_support_ai_triages_touch ON public.market_support_ai_triages;
CREATE TRIGGER trg_market_support_ai_triages_touch
BEFORE UPDATE ON public.market_support_ai_triages
FOR EACH ROW EXECUTE FUNCTION public.market_touch_support_ai_triage();

ALTER TABLE public.market_support_ai_triages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS market_support_ai_triages_select_support_admin ON public.market_support_ai_triages;
CREATE POLICY market_support_ai_triages_select_support_admin
ON public.market_support_ai_triages
FOR SELECT TO authenticated
USING (public.market_is_support_queue_admin(auth.uid()));

GRANT SELECT ON public.market_support_ai_triages TO authenticated;

COMMIT;
