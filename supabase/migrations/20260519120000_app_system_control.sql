BEGIN;

CREATE TABLE IF NOT EXISTS public.app_system_control (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  maintenance_enabled boolean NOT NULL DEFAULT false,
  maintenance_message text NOT NULL DEFAULT 'BestCity Market is receiving a scheduled upgrade. Please check back soon.',
  maintenance_eta text,
  force_update boolean NOT NULL DEFAULT false,
  min_version text NOT NULL DEFAULT '0.0.0',
  update_message text NOT NULL DEFAULT 'A newer BestCity app version is required to continue.',
  apk_url text,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.app_system_control_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_app_system_control_touch ON public.app_system_control;
CREATE TRIGGER trg_app_system_control_touch
BEFORE UPDATE ON public.app_system_control
FOR EACH ROW EXECUTE FUNCTION public.app_system_control_touch_updated_at();

INSERT INTO public.app_system_control (id)
VALUES (true)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.app_system_control ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_system_control_public_select ON public.app_system_control;
CREATE POLICY app_system_control_public_select
ON public.app_system_control
FOR SELECT
TO anon, authenticated
USING (true);

GRANT SELECT ON public.app_system_control TO anon, authenticated;
GRANT ALL ON public.app_system_control TO service_role;

COMMIT;
