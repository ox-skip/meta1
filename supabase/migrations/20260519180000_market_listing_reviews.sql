CREATE TABLE IF NOT EXISTS public.market_listing_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES public.market_listings(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.market_orders(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT market_listing_reviews_no_self_review CHECK (reviewer_id <> seller_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS market_listing_reviews_listing_reviewer_uidx
  ON public.market_listing_reviews (listing_id, reviewer_id);

CREATE UNIQUE INDEX IF NOT EXISTS market_listing_reviews_order_uidx
  ON public.market_listing_reviews (order_id);

CREATE INDEX IF NOT EXISTS market_listing_reviews_listing_created_idx
  ON public.market_listing_reviews (listing_id, created_at DESC);

CREATE INDEX IF NOT EXISTS market_listing_reviews_seller_created_idx
  ON public.market_listing_reviews (seller_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.market_listing_reviews_touch_updated_at()
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

DROP TRIGGER IF EXISTS trg_market_listing_reviews_touch_updated_at ON public.market_listing_reviews;
CREATE TRIGGER trg_market_listing_reviews_touch_updated_at
BEFORE UPDATE ON public.market_listing_reviews
FOR EACH ROW EXECUTE FUNCTION public.market_listing_reviews_touch_updated_at();

CREATE OR REPLACE FUNCTION public.market_listing_review_order_is_eligible(
  p_order_id uuid,
  p_listing_id uuid,
  p_seller_id uuid,
  p_reviewer_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.market_orders AS orders
    WHERE orders.id = p_order_id
      AND orders.listing_id = p_listing_id
      AND orders.seller_id = p_seller_id
      AND orders.buyer_id = p_reviewer_id
      AND orders.status::text IN ('DELIVERED', 'RELEASED')
  );
$$;

REVOKE ALL ON FUNCTION public.market_listing_review_order_is_eligible(uuid, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.market_listing_review_order_is_eligible(uuid, uuid, uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE VIEW public.market_listing_review_summary AS
SELECT
  listing_id,
  COUNT(*)::integer AS review_count,
  ROUND(AVG(rating)::numeric, 2) AS avg_rating
FROM public.market_listing_reviews
GROUP BY listing_id;

ALTER TABLE public.market_listing_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS market_listing_reviews_select_public ON public.market_listing_reviews;
CREATE POLICY market_listing_reviews_select_public
ON public.market_listing_reviews
FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS market_listing_reviews_insert_eligible_buyer ON public.market_listing_reviews;
CREATE POLICY market_listing_reviews_insert_eligible_buyer
ON public.market_listing_reviews
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = reviewer_id
  AND public.market_listing_review_order_is_eligible(order_id, listing_id, seller_id, reviewer_id)
);

DROP POLICY IF EXISTS market_listing_reviews_update_own_eligible ON public.market_listing_reviews;
CREATE POLICY market_listing_reviews_update_own_eligible
ON public.market_listing_reviews
FOR UPDATE
TO authenticated
USING (auth.uid() = reviewer_id)
WITH CHECK (
  auth.uid() = reviewer_id
  AND public.market_listing_review_order_is_eligible(order_id, listing_id, seller_id, reviewer_id)
);

DROP POLICY IF EXISTS market_listing_reviews_delete_own ON public.market_listing_reviews;
CREATE POLICY market_listing_reviews_delete_own
ON public.market_listing_reviews
FOR DELETE
TO authenticated
USING (auth.uid() = reviewer_id);

GRANT SELECT ON public.market_listing_reviews TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.market_listing_reviews TO authenticated;
GRANT ALL ON public.market_listing_reviews TO service_role;
GRANT SELECT ON public.market_listing_review_summary TO anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'market_listing_reviews'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.market_listing_reviews;
    END IF;
  END IF;
END $$;
