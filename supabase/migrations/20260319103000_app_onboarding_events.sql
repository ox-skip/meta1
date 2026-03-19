BEGIN;

CREATE TABLE IF NOT EXISTS public.app_onboarding_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  flow_key text NOT NULL,
  flow_title text NOT NULL,
  status text NOT NULL CHECK (status IN ('completed', 'skipped')),
  completed_steps integer NOT NULL DEFAULT 0 CHECK (completed_steps >= 0),
  total_steps integer NOT NULL DEFAULT 1 CHECK (total_steps > 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_onboarding_events_steps_check CHECK (completed_steps <= total_steps)
);

CREATE INDEX IF NOT EXISTS app_onboarding_events_user_created_idx
  ON public.app_onboarding_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS app_onboarding_events_flow_created_idx
  ON public.app_onboarding_events (flow_key, created_at DESC);

ALTER TABLE public.app_onboarding_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_onboarding_events_select_own ON public.app_onboarding_events;
CREATE POLICY app_onboarding_events_select_own
ON public.app_onboarding_events
FOR SELECT TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS app_onboarding_events_insert_own ON public.app_onboarding_events;
CREATE POLICY app_onboarding_events_insert_own
ON public.app_onboarding_events
FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

COMMIT;
