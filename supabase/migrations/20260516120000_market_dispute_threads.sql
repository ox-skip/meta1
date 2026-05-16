BEGIN;

ALTER TABLE public.market_disputes
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

ALTER TABLE public.market_disputes
  ADD COLUMN IF NOT EXISTS resolution_note text;

CREATE TABLE IF NOT EXISTS public.market_dispute_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id uuid NOT NULL REFERENCES public.market_disputes(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.market_orders(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  sender_kind text NOT NULL CHECK (sender_kind IN ('BUYER', 'SELLER', 'ADMIN')),
  body text NOT NULL DEFAULT '' CHECK (char_length(btrim(body)) BETWEEN 0 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.market_dispute_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id uuid NOT NULL REFERENCES public.market_disputes(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES public.market_dispute_messages(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.market_orders(id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'file' CHECK (kind IN ('image', 'video', 'audio', 'file')),
  storage_bucket text NOT NULL DEFAULT 'market-disputes',
  storage_path text NOT NULL,
  public_url text,
  mime_type text,
  file_name text,
  file_size bigint CHECK (file_size IS NULL OR file_size >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.market_dispute_attachments
  DROP CONSTRAINT IF EXISTS market_dispute_attachments_bucket_check;

ALTER TABLE public.market_dispute_attachments
  ADD CONSTRAINT market_dispute_attachments_bucket_check
  CHECK (storage_bucket = 'market-disputes');

CREATE INDEX IF NOT EXISTS market_dispute_messages_dispute_created_idx
  ON public.market_dispute_messages (dispute_id, created_at);

CREATE INDEX IF NOT EXISTS market_dispute_messages_order_created_idx
  ON public.market_dispute_messages (order_id, created_at);

CREATE INDEX IF NOT EXISTS market_dispute_attachments_message_idx
  ON public.market_dispute_attachments (message_id, created_at);

CREATE INDEX IF NOT EXISTS market_dispute_attachments_dispute_idx
  ON public.market_dispute_attachments (dispute_id, created_at);

CREATE OR REPLACE FUNCTION public.market_order_party_role(p_order_id uuid, p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN o.buyer_id = p_user_id THEN 'BUYER'
    WHEN o.seller_id = p_user_id THEN 'SELLER'
    ELSE NULL
  END
  FROM public.market_orders o
  WHERE o.id = p_order_id
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.market_is_order_party(p_order_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.market_order_party_role(p_order_id, p_user_id) IS NOT NULL, false);
$$;

CREATE OR REPLACE FUNCTION public.market_disputes_touch()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_market_disputes_touch ON public.market_disputes;
CREATE TRIGGER trg_market_disputes_touch
BEFORE UPDATE ON public.market_disputes
FOR EACH ROW EXECUTE FUNCTION public.market_disputes_touch();

CREATE OR REPLACE FUNCTION public.market_validate_dispute_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dispute public.market_disputes%ROWTYPE;
  v_role text;
BEGIN
  SELECT *
  INTO v_dispute
  FROM public.market_disputes
  WHERE id = NEW.dispute_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispute not found';
  END IF;

  IF v_dispute.order_id <> NEW.order_id THEN
    RAISE EXCEPTION 'Dispute message order mismatch';
  END IF;

  IF v_dispute.status::text NOT IN ('OPEN', 'UNDER_REVIEW') THEN
    RAISE EXCEPTION 'Dispute is closed';
  END IF;

  IF NEW.sender_kind = 'ADMIN' THEN
    IF NOT public.market_admin_has_permission(NEW.sender_id, 'complaints.respond') THEN
      RAISE EXCEPTION 'Admin dispute reply is not allowed';
    END IF;
    RETURN NEW;
  END IF;

  v_role := public.market_order_party_role(NEW.order_id, NEW.sender_id);
  IF v_role IS NULL OR v_role <> NEW.sender_kind THEN
    RAISE EXCEPTION 'Dispute message sender is not an order party';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_market_dispute_messages_validate ON public.market_dispute_messages;
CREATE TRIGGER trg_market_dispute_messages_validate
BEFORE INSERT OR UPDATE ON public.market_dispute_messages
FOR EACH ROW EXECUTE FUNCTION public.market_validate_dispute_message();

CREATE OR REPLACE FUNCTION public.market_dispute_after_message_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.market_disputes
  SET updated_at = NEW.created_at
  WHERE id = NEW.dispute_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_market_dispute_messages_after_insert ON public.market_dispute_messages;
CREATE TRIGGER trg_market_dispute_messages_after_insert
AFTER INSERT ON public.market_dispute_messages
FOR EACH ROW EXECUTE FUNCTION public.market_dispute_after_message_insert();

CREATE OR REPLACE FUNCTION public.market_validate_dispute_attachment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_message public.market_dispute_messages%ROWTYPE;
BEGIN
  SELECT *
  INTO v_message
  FROM public.market_dispute_messages
  WHERE id = NEW.message_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispute message not found';
  END IF;

  IF v_message.dispute_id <> NEW.dispute_id OR v_message.order_id <> NEW.order_id THEN
    RAISE EXCEPTION 'Dispute attachment mismatch';
  END IF;

  IF v_message.sender_id <> NEW.uploaded_by THEN
    RAISE EXCEPTION 'Dispute attachment uploader mismatch';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_market_dispute_attachments_validate ON public.market_dispute_attachments;
CREATE TRIGGER trg_market_dispute_attachments_validate
BEFORE INSERT OR UPDATE ON public.market_dispute_attachments
FOR EACH ROW EXECUTE FUNCTION public.market_validate_dispute_attachment();

CREATE OR REPLACE FUNCTION public.market_resolve_dispute_on_order_settlement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_resolution public.market_dispute_resolution;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.status::text NOT IN ('RELEASED', 'REFUNDED') THEN
    RETURN NEW;
  END IF;

  IF OLD.status::text = NEW.status::text THEN
    RETURN NEW;
  END IF;

  v_resolution := CASE
    WHEN NEW.status::text = 'RELEASED' THEN 'RELEASE_TO_SELLER'::public.market_dispute_resolution
    ELSE 'REFUND_TO_BUYER'::public.market_dispute_resolution
  END;

  UPDATE public.market_disputes
  SET
    status = 'RESOLVED'::public.market_dispute_status,
    resolution = COALESCE(resolution, v_resolution),
    resolved_at = COALESCE(resolved_at, now()),
    updated_at = now()
  WHERE order_id = NEW.id
    AND status::text IN ('OPEN', 'UNDER_REVIEW');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_market_resolve_dispute_on_order_settlement ON public.market_orders;
CREATE TRIGGER trg_market_resolve_dispute_on_order_settlement
AFTER UPDATE OF status ON public.market_orders
FOR EACH ROW EXECUTE FUNCTION public.market_resolve_dispute_on_order_settlement();

DROP FUNCTION IF EXISTS public.market_open_dispute_rpc(uuid, text);
CREATE FUNCTION public.market_open_dispute_rpc(p_order_id uuid, p_reason text)
RETURNS public.market_disputes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_order public.market_orders%ROWTYPE;
  v_dispute public.market_disputes%ROWTYPE;
  v_reason text := left(NULLIF(btrim(COALESCE(p_reason, '')), ''), 1000);
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sign in to open a dispute';
  END IF;

  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Dispute reason required';
  END IF;

  SELECT *
  INTO v_order
  FROM public.market_orders
  WHERE id = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_order.buyer_id <> v_user AND v_order.seller_id <> v_user THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  IF v_order.status::text NOT IN ('IN_ESCROW', 'OUT_FOR_DELIVERY', 'DELIVERABLE_UPLOADED', 'DELIVERED', 'DISPUTED') THEN
    RAISE EXCEPTION 'Dispute not allowed in current status';
  END IF;

  SELECT *
  INTO v_dispute
  FROM public.market_disputes
  WHERE order_id = p_order_id;

  IF FOUND THEN
    IF v_dispute.status::text = 'RESOLVED' THEN
      RAISE EXCEPTION 'Dispute is already resolved';
    END IF;
    RETURN v_dispute;
  END IF;

  IF v_order.status::text <> 'DISPUTED' THEN
    PERFORM public.market_transition_order_status(
      p_order_id,
      v_order.version,
      'DISPUTED',
      'Dispute opened'
    );
  END IF;

  INSERT INTO public.market_disputes (order_id, opened_by, reason, status)
  VALUES (p_order_id, v_user, v_reason, 'OPEN'::public.market_dispute_status)
  RETURNING * INTO v_dispute;

  RETURN v_dispute;
END;
$$;

ALTER TABLE public.market_disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_dispute_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_dispute_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS market_disputes_select_party_or_admin ON public.market_disputes;
CREATE POLICY market_disputes_select_party_or_admin
ON public.market_disputes
FOR SELECT TO authenticated
USING (
  public.market_is_order_party(order_id, auth.uid())
  OR public.market_admin_has_permission(auth.uid(), 'disputes.read')
  OR public.market_admin_has_permission(auth.uid(), 'disputes.resolve')
);

DROP POLICY IF EXISTS market_disputes_insert_party ON public.market_disputes;
CREATE POLICY market_disputes_insert_party
ON public.market_disputes
FOR INSERT TO authenticated
WITH CHECK (
  opened_by = auth.uid()
  AND public.market_is_order_party(order_id, auth.uid())
  AND EXISTS (
    SELECT 1
    FROM public.market_orders o
    WHERE o.id = market_disputes.order_id
      AND o.status::text IN ('IN_ESCROW', 'OUT_FOR_DELIVERY', 'DELIVERABLE_UPLOADED', 'DELIVERED', 'DISPUTED')
  )
);

DROP POLICY IF EXISTS market_disputes_update_admin ON public.market_disputes;
CREATE POLICY market_disputes_update_admin
ON public.market_disputes
FOR UPDATE TO authenticated
USING (public.market_admin_has_permission(auth.uid(), 'disputes.resolve'))
WITH CHECK (public.market_admin_has_permission(auth.uid(), 'disputes.resolve'));

DROP POLICY IF EXISTS market_dispute_messages_select_party_or_admin ON public.market_dispute_messages;
CREATE POLICY market_dispute_messages_select_party_or_admin
ON public.market_dispute_messages
FOR SELECT TO authenticated
USING (
  public.market_is_order_party(order_id, auth.uid())
  OR public.market_admin_has_permission(auth.uid(), 'disputes.read')
  OR public.market_admin_has_permission(auth.uid(), 'disputes.resolve')
);

DROP POLICY IF EXISTS market_dispute_messages_insert_party_or_admin ON public.market_dispute_messages;
CREATE POLICY market_dispute_messages_insert_party_or_admin
ON public.market_dispute_messages
FOR INSERT TO authenticated
WITH CHECK (
  sender_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.market_disputes d
    WHERE d.id = market_dispute_messages.dispute_id
      AND d.order_id = market_dispute_messages.order_id
      AND d.status::text IN ('OPEN', 'UNDER_REVIEW')
  )
  AND (
    (
      sender_kind IN ('BUYER', 'SELLER')
      AND public.market_order_party_role(order_id, auth.uid()) = sender_kind
    )
    OR (
      sender_kind = 'ADMIN'
      AND public.market_admin_has_permission(auth.uid(), 'complaints.respond')
    )
  )
);

DROP POLICY IF EXISTS market_dispute_attachments_select_party_or_admin ON public.market_dispute_attachments;
CREATE POLICY market_dispute_attachments_select_party_or_admin
ON public.market_dispute_attachments
FOR SELECT TO authenticated
USING (
  public.market_is_order_party(order_id, auth.uid())
  OR public.market_admin_has_permission(auth.uid(), 'evidence.read')
  OR public.market_admin_has_permission(auth.uid(), 'disputes.resolve')
);

DROP POLICY IF EXISTS market_dispute_attachments_insert_party_or_admin ON public.market_dispute_attachments;
CREATE POLICY market_dispute_attachments_insert_party_or_admin
ON public.market_dispute_attachments
FOR INSERT TO authenticated
WITH CHECK (
  uploaded_by = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.market_dispute_messages m
    WHERE m.id = market_dispute_attachments.message_id
      AND m.dispute_id = market_dispute_attachments.dispute_id
      AND m.order_id = market_dispute_attachments.order_id
      AND m.sender_id = auth.uid()
  )
);

GRANT EXECUTE ON FUNCTION public.market_open_dispute_rpc(uuid, text) TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.market_disputes TO authenticated;
GRANT SELECT, INSERT ON public.market_dispute_messages TO authenticated;
GRANT SELECT, INSERT ON public.market_dispute_attachments TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('market-disputes', 'market-disputes', false, 104857600)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit;

DROP POLICY IF EXISTS market_dispute_objects_select ON storage.objects;
CREATE POLICY market_dispute_objects_select
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'market-disputes'
  AND (
    name LIKE auth.uid()::text || '/%'
    OR public.market_admin_has_permission(auth.uid(), 'evidence.read')
    OR EXISTS (
      SELECT 1
      FROM public.market_dispute_attachments a
      WHERE a.storage_bucket = storage.objects.bucket_id
        AND a.storage_path = storage.objects.name
        AND public.market_is_order_party(a.order_id, auth.uid())
    )
  )
);

DROP POLICY IF EXISTS market_dispute_objects_insert_owner ON storage.objects;
CREATE POLICY market_dispute_objects_insert_owner
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'market-disputes'
  AND auth.uid() IS NOT NULL
  AND name LIKE auth.uid()::text || '/%'
);

DROP POLICY IF EXISTS market_dispute_objects_update_owner ON storage.objects;
CREATE POLICY market_dispute_objects_update_owner
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'market-disputes'
  AND (
    name LIKE auth.uid()::text || '/%'
    OR public.market_admin_has_permission(auth.uid(), 'evidence.read')
  )
)
WITH CHECK (
  bucket_id = 'market-disputes'
  AND (
    name LIKE auth.uid()::text || '/%'
    OR public.market_admin_has_permission(auth.uid(), 'evidence.read')
  )
);

DROP POLICY IF EXISTS market_dispute_objects_delete_owner ON storage.objects;
CREATE POLICY market_dispute_objects_delete_owner
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'market-disputes'
  AND (
    name LIKE auth.uid()::text || '/%'
    OR public.market_admin_has_permission(auth.uid(), 'evidence.read')
  )
);

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.market_dispute_messages;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.market_dispute_attachments;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;
END $$;

COMMIT;
