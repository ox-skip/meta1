BEGIN;

CREATE TABLE IF NOT EXISTS public.market_profile_prompt_reminders (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  stage text NOT NULL CHECK (stage IN ('create_profile', 'verify_profile')),
  remind_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_profile_prompt_reminders_remind_at_idx
  ON public.market_profile_prompt_reminders (remind_at);

ALTER TABLE public.market_profile_prompt_reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS market_profile_prompt_reminders_select_own ON public.market_profile_prompt_reminders;
CREATE POLICY market_profile_prompt_reminders_select_own
ON public.market_profile_prompt_reminders
FOR SELECT TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS market_profile_prompt_reminders_insert_own ON public.market_profile_prompt_reminders;
CREATE POLICY market_profile_prompt_reminders_insert_own
ON public.market_profile_prompt_reminders
FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS market_profile_prompt_reminders_update_own ON public.market_profile_prompt_reminders;
CREATE POLICY market_profile_prompt_reminders_update_own
ON public.market_profile_prompt_reminders
FOR UPDATE TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS market_profile_prompt_reminders_delete_own ON public.market_profile_prompt_reminders;
CREATE POLICY market_profile_prompt_reminders_delete_own
ON public.market_profile_prompt_reminders
FOR DELETE TO authenticated
USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.market_profile_prompt_reminders TO authenticated;

COMMIT;
