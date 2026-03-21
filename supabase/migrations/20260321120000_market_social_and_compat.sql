BEGIN;

ALTER TABLE IF EXISTS public.market_listings
  ADD COLUMN IF NOT EXISTS availability jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS payment_options jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.market_listings
SET
  availability = COALESCE(availability, '{}'::jsonb),
  payment_options = COALESCE(payment_options, '{}'::jsonb)
WHERE availability IS NULL OR payment_options IS NULL;

ALTER TABLE IF EXISTS public.market_orders
  ADD COLUMN IF NOT EXISTS buyer_contact jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.market_orders
SET buyer_contact = COALESCE(buyer_contact, '{}'::jsonb)
WHERE buyer_contact IS NULL;

ALTER TABLE IF EXISTS public.market_seller_profiles
  ADD COLUMN IF NOT EXISTS social_links jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.market_seller_profiles
SET social_links = COALESCE(social_links, '{}'::jsonb)
WHERE social_links IS NULL;

CREATE OR REPLACE FUNCTION public.market_social_touch_updated_at()
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

CREATE TABLE IF NOT EXISTS public.market_social_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT market_social_posts_body_check CHECK (body IS NULL OR char_length(btrim(body)) > 0)
);

CREATE TABLE IF NOT EXISTS public.market_social_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.market_social_posts(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('image', 'video', 'audio', 'file')),
  storage_path text NOT NULL,
  public_url text NULL,
  mime_type text NULL,
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.market_social_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.market_social_posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(btrim(body)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.market_social_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.market_social_posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reaction text NOT NULL DEFAULT 'like' CHECK (reaction IN ('like')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.market_profile_follows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  followed_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT market_profile_follows_no_self_follow CHECK (follower_id <> followed_id)
);

CREATE INDEX IF NOT EXISTS market_social_posts_author_created_idx
  ON public.market_social_posts (author_id, created_at DESC);

CREATE INDEX IF NOT EXISTS market_social_posts_created_idx
  ON public.market_social_posts (created_at DESC);

CREATE INDEX IF NOT EXISTS market_social_media_post_sort_idx
  ON public.market_social_media (post_id, sort_order, created_at);

CREATE INDEX IF NOT EXISTS market_social_comments_post_created_idx
  ON public.market_social_comments (post_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS market_social_reactions_post_user_uidx
  ON public.market_social_reactions (post_id, user_id);

CREATE INDEX IF NOT EXISTS market_social_reactions_post_idx
  ON public.market_social_reactions (post_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS market_profile_follows_pair_uidx
  ON public.market_profile_follows (follower_id, followed_id);

CREATE INDEX IF NOT EXISTS market_profile_follows_followed_idx
  ON public.market_profile_follows (followed_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_market_social_posts_touch_updated_at ON public.market_social_posts;
CREATE TRIGGER trg_market_social_posts_touch_updated_at
BEFORE UPDATE ON public.market_social_posts
FOR EACH ROW EXECUTE FUNCTION public.market_social_touch_updated_at();

ALTER TABLE public.market_social_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_social_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_social_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_social_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_profile_follows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS market_social_posts_read_all ON public.market_social_posts;
CREATE POLICY market_social_posts_read_all
ON public.market_social_posts
FOR SELECT
TO authenticated, anon
USING (true);

DROP POLICY IF EXISTS market_social_posts_insert_owner ON public.market_social_posts;
CREATE POLICY market_social_posts_insert_owner
ON public.market_social_posts
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = author_id
  AND EXISTS (
    SELECT 1
    FROM public.market_seller_profiles sp
    WHERE sp.user_id = auth.uid()
      AND sp.active = true
  )
);

DROP POLICY IF EXISTS market_social_posts_update_owner ON public.market_social_posts;
CREATE POLICY market_social_posts_update_owner
ON public.market_social_posts
FOR UPDATE
TO authenticated
USING (author_id = auth.uid())
WITH CHECK (author_id = auth.uid());

DROP POLICY IF EXISTS market_social_posts_delete_owner ON public.market_social_posts;
CREATE POLICY market_social_posts_delete_owner
ON public.market_social_posts
FOR DELETE
TO authenticated
USING (author_id = auth.uid());

DROP POLICY IF EXISTS market_social_media_read_all ON public.market_social_media;
CREATE POLICY market_social_media_read_all
ON public.market_social_media
FOR SELECT
TO authenticated, anon
USING (
  EXISTS (
    SELECT 1
    FROM public.market_social_posts p
    WHERE p.id = market_social_media.post_id
  )
);

DROP POLICY IF EXISTS market_social_media_insert_owner ON public.market_social_media;
CREATE POLICY market_social_media_insert_owner
ON public.market_social_media
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.market_social_posts p
    WHERE p.id = market_social_media.post_id
      AND p.author_id = auth.uid()
  )
);

DROP POLICY IF EXISTS market_social_media_update_owner ON public.market_social_media;
CREATE POLICY market_social_media_update_owner
ON public.market_social_media
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.market_social_posts p
    WHERE p.id = market_social_media.post_id
      AND p.author_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.market_social_posts p
    WHERE p.id = market_social_media.post_id
      AND p.author_id = auth.uid()
  )
);

DROP POLICY IF EXISTS market_social_media_delete_owner ON public.market_social_media;
CREATE POLICY market_social_media_delete_owner
ON public.market_social_media
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.market_social_posts p
    WHERE p.id = market_social_media.post_id
      AND p.author_id = auth.uid()
  )
);

DROP POLICY IF EXISTS market_social_comments_read_all ON public.market_social_comments;
CREATE POLICY market_social_comments_read_all
ON public.market_social_comments
FOR SELECT
TO authenticated, anon
USING (true);

DROP POLICY IF EXISTS market_social_comments_insert_owner ON public.market_social_comments;
CREATE POLICY market_social_comments_insert_owner
ON public.market_social_comments
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1
    FROM public.market_social_posts p
    WHERE p.id = market_social_comments.post_id
  )
);

DROP POLICY IF EXISTS market_social_comments_update_owner ON public.market_social_comments;
CREATE POLICY market_social_comments_update_owner
ON public.market_social_comments
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS market_social_comments_delete_owner ON public.market_social_comments;
CREATE POLICY market_social_comments_delete_owner
ON public.market_social_comments
FOR DELETE
TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS market_social_reactions_read_all ON public.market_social_reactions;
CREATE POLICY market_social_reactions_read_all
ON public.market_social_reactions
FOR SELECT
TO authenticated, anon
USING (true);

DROP POLICY IF EXISTS market_social_reactions_insert_owner ON public.market_social_reactions;
CREATE POLICY market_social_reactions_insert_owner
ON public.market_social_reactions
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1
    FROM public.market_social_posts p
    WHERE p.id = market_social_reactions.post_id
  )
);

DROP POLICY IF EXISTS market_social_reactions_update_owner ON public.market_social_reactions;
CREATE POLICY market_social_reactions_update_owner
ON public.market_social_reactions
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS market_social_reactions_delete_owner ON public.market_social_reactions;
CREATE POLICY market_social_reactions_delete_owner
ON public.market_social_reactions
FOR DELETE
TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS market_profile_follows_read_all ON public.market_profile_follows;
CREATE POLICY market_profile_follows_read_all
ON public.market_profile_follows
FOR SELECT
TO authenticated, anon
USING (true);

DROP POLICY IF EXISTS market_profile_follows_insert_owner ON public.market_profile_follows;
CREATE POLICY market_profile_follows_insert_owner
ON public.market_profile_follows
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = follower_id
  AND EXISTS (
    SELECT 1
    FROM public.market_seller_profiles sp
    WHERE sp.user_id = market_profile_follows.followed_id
      AND sp.active = true
  )
);

DROP POLICY IF EXISTS market_profile_follows_delete_owner ON public.market_profile_follows;
CREATE POLICY market_profile_follows_delete_owner
ON public.market_profile_follows
FOR DELETE
TO authenticated
USING (follower_id = auth.uid());

GRANT SELECT ON public.market_social_posts TO authenticated, anon;
GRANT SELECT ON public.market_social_media TO authenticated, anon;
GRANT SELECT ON public.market_social_comments TO authenticated, anon;
GRANT SELECT ON public.market_social_reactions TO authenticated, anon;
GRANT SELECT ON public.market_profile_follows TO authenticated, anon;

GRANT INSERT, UPDATE, DELETE ON public.market_social_posts TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.market_social_media TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.market_social_comments TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.market_social_reactions TO authenticated;
GRANT INSERT, DELETE ON public.market_profile_follows TO authenticated;

DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.market_social_posts';
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;

  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.market_social_media';
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;

  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.market_social_comments';
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;

  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.market_social_reactions';
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;

  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.market_profile_follows';
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;
END
$$;

INSERT INTO storage.buckets (id, name, public)
VALUES ('market-social', 'market-social', true)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  public = EXCLUDED.public;

DROP POLICY IF EXISTS market_social_objects_select ON storage.objects;
CREATE POLICY market_social_objects_select
ON storage.objects
FOR SELECT
TO authenticated, anon
USING (bucket_id = 'market-social');

DROP POLICY IF EXISTS market_social_objects_insert_owner ON storage.objects;
CREATE POLICY market_social_objects_insert_owner
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'market-social'
  AND auth.uid() IS NOT NULL
  AND name LIKE auth.uid()::text || '/%'
);

DROP POLICY IF EXISTS market_social_objects_update_owner ON storage.objects;
CREATE POLICY market_social_objects_update_owner
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'market-social'
  AND auth.uid() IS NOT NULL
  AND name LIKE auth.uid()::text || '/%'
)
WITH CHECK (
  bucket_id = 'market-social'
  AND auth.uid() IS NOT NULL
  AND name LIKE auth.uid()::text || '/%'
);

DROP POLICY IF EXISTS market_social_objects_delete_owner ON storage.objects;
CREATE POLICY market_social_objects_delete_owner
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'market-social'
  AND auth.uid() IS NOT NULL
  AND name LIKE auth.uid()::text || '/%'
);

COMMIT;
