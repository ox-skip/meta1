BEGIN;

CREATE TABLE IF NOT EXISTS public.market_official_social_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL UNIQUE CHECK (
    platform IN (
      'discord',
      'twitter',
      'telegram',
      'instagram',
      'youtube',
      'tiktok',
      'facebook',
      'linkedin'
    )
  ),
  label text,
  url text CHECK (url IS NULL OR url ~* '^https?://'),
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100 CHECK (sort_order >= 0),
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_official_social_links_active_idx
  ON public.market_official_social_links (active, sort_order, platform);

CREATE OR REPLACE FUNCTION public.market_official_social_links_touch_updated_at()
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

DROP TRIGGER IF EXISTS trg_market_official_social_links_touch_updated_at ON public.market_official_social_links;
CREATE TRIGGER trg_market_official_social_links_touch_updated_at
BEFORE UPDATE ON public.market_official_social_links
FOR EACH ROW EXECUTE FUNCTION public.market_official_social_links_touch_updated_at();

ALTER TABLE public.market_official_social_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS market_official_social_links_read_active ON public.market_official_social_links;
CREATE POLICY market_official_social_links_read_active
ON public.market_official_social_links
FOR SELECT
TO authenticated, anon
USING (active = true);

DROP POLICY IF EXISTS market_official_social_links_admin_insert ON public.market_official_social_links;
CREATE POLICY market_official_social_links_admin_insert
ON public.market_official_social_links
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.admin_users au
    WHERE au.user_id = auth.uid()
      AND au.active = true
  )
);

DROP POLICY IF EXISTS market_official_social_links_admin_update ON public.market_official_social_links;
CREATE POLICY market_official_social_links_admin_update
ON public.market_official_social_links
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.admin_users au
    WHERE au.user_id = auth.uid()
      AND au.active = true
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.admin_users au
    WHERE au.user_id = auth.uid()
      AND au.active = true
  )
);

DROP POLICY IF EXISTS market_official_social_links_admin_delete ON public.market_official_social_links;
CREATE POLICY market_official_social_links_admin_delete
ON public.market_official_social_links
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.admin_users au
    WHERE au.user_id = auth.uid()
      AND au.active = true
  )
);

DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.market_official_social_links';
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;
END
$$;

GRANT SELECT ON public.market_official_social_links TO authenticated, anon;
GRANT INSERT, UPDATE, DELETE ON public.market_official_social_links TO authenticated;

INSERT INTO public.market_official_social_links (platform, label, url, sort_order, active)
VALUES
  ('discord', 'Discord', NULL, 10, true),
  ('twitter', 'X / Twitter', NULL, 20, true),
  ('telegram', 'Telegram', NULL, 30, true),
  ('instagram', 'Instagram', NULL, 40, true),
  ('youtube', 'YouTube', NULL, 50, true),
  ('tiktok', 'TikTok', NULL, 60, true),
  ('facebook', 'Facebook', NULL, 70, true),
  ('linkedin', 'LinkedIn', NULL, 80, true)
ON CONFLICT (platform) DO UPDATE
SET
  label = COALESCE(EXCLUDED.label, public.market_official_social_links.label),
  sort_order = EXCLUDED.sort_order,
  active = true;

COMMIT;
