BEGIN;

CREATE TABLE IF NOT EXISTS public.market_support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject text NOT NULL CHECK (char_length(btrim(subject)) BETWEEN 3 AND 140),
  category text NOT NULL DEFAULT 'general',
  priority text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED')),
  related_order_id uuid,
  assigned_admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  message_slug text,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.market_support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.market_support_tickets(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_kind text NOT NULL CHECK (sender_kind IN ('USER', 'ADMIN')),
  message_slug text,
  body text NOT NULL DEFAULT '' CHECK (char_length(btrim(body)) BETWEEN 0 AND 3000),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.market_support_tickets
  ADD COLUMN IF NOT EXISTS message_slug text;

ALTER TABLE public.market_support_messages
  ADD COLUMN IF NOT EXISTS message_slug text;

ALTER TABLE public.market_support_messages
  ALTER COLUMN body SET DEFAULT '';

ALTER TABLE public.market_support_messages
  DROP CONSTRAINT IF EXISTS market_support_messages_body_check;

ALTER TABLE public.market_support_messages
  ADD CONSTRAINT market_support_messages_body_check
  CHECK (char_length(btrim(body)) BETWEEN 0 AND 3000);

CREATE TABLE IF NOT EXISTS public.market_support_message_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.market_support_messages(id) ON DELETE CASCADE,
  ticket_id uuid NOT NULL REFERENCES public.market_support_tickets(id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'file' CHECK (kind IN ('image', 'video', 'audio', 'file')),
  storage_bucket text NOT NULL DEFAULT 'market-support',
  storage_path text NOT NULL,
  public_url text,
  mime_type text,
  file_name text,
  file_size bigint CHECK (file_size IS NULL OR file_size >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.market_support_message_attachments
  DROP CONSTRAINT IF EXISTS market_support_message_attachments_bucket_check;

ALTER TABLE public.market_support_message_attachments
  ADD CONSTRAINT market_support_message_attachments_bucket_check
  CHECK (storage_bucket = 'market-support');

CREATE INDEX IF NOT EXISTS market_support_tickets_user_last_idx
  ON public.market_support_tickets (user_id, last_message_at DESC);

CREATE INDEX IF NOT EXISTS market_support_tickets_queue_idx
  ON public.market_support_tickets (status, priority, last_message_at DESC);

CREATE INDEX IF NOT EXISTS market_support_tickets_assignee_idx
  ON public.market_support_tickets (assigned_admin_id, status, last_message_at DESC);

CREATE INDEX IF NOT EXISTS market_support_messages_ticket_created_idx
  ON public.market_support_messages (ticket_id, created_at);

CREATE INDEX IF NOT EXISTS market_support_message_attachments_message_idx
  ON public.market_support_message_attachments (message_id, created_at);

CREATE INDEX IF NOT EXISTS market_support_message_attachments_ticket_idx
  ON public.market_support_message_attachments (ticket_id, created_at);

CREATE OR REPLACE FUNCTION public.market_support_dm_slug(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    NULLIF((
      SELECT msp.market_username
      FROM public.market_seller_profiles msp
      WHERE msp.user_id = p_user_id
        AND msp.active IS TRUE
      LIMIT 1
    ), ''),
    NULLIF((
      SELECT p.username
      FROM public.profiles p
      WHERE p.id = p_user_id
      LIMIT 1
    ), ''),
    p_user_id::text
  );
$$;

CREATE OR REPLACE FUNCTION public.market_is_support_queue_admin(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.market_admin_users mau
    WHERE mau.user_id = p_user_id
      AND mau.is_active IS TRUE
      AND mau.role_key IN ('support_admin', 'super_admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.market_support_set_ticket_slug()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.message_slug := public.market_support_dm_slug(NEW.user_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.market_support_touch_ticket()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_market_support_tickets_touch ON public.market_support_tickets;
CREATE TRIGGER trg_market_support_tickets_touch
BEFORE UPDATE ON public.market_support_tickets
FOR EACH ROW EXECUTE FUNCTION public.market_support_touch_ticket();

DROP TRIGGER IF EXISTS trg_market_support_tickets_slug ON public.market_support_tickets;
CREATE TRIGGER trg_market_support_tickets_slug
BEFORE INSERT OR UPDATE ON public.market_support_tickets
FOR EACH ROW EXECUTE FUNCTION public.market_support_set_ticket_slug();

CREATE OR REPLACE FUNCTION public.market_support_set_message_slug()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.message_slug := public.market_support_dm_slug(NEW.sender_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_market_support_messages_slug ON public.market_support_messages;
CREATE TRIGGER trg_market_support_messages_slug
BEFORE INSERT OR UPDATE ON public.market_support_messages
FOR EACH ROW EXECUTE FUNCTION public.market_support_set_message_slug();

CREATE OR REPLACE FUNCTION public.market_support_validate_attachment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_message record;
BEGIN
  SELECT ticket_id, sender_id
  INTO v_message
  FROM public.market_support_messages
  WHERE id = NEW.message_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Support message not found';
  END IF;

  IF v_message.ticket_id <> NEW.ticket_id THEN
    RAISE EXCEPTION 'Support attachment ticket mismatch';
  END IF;

  IF v_message.sender_id <> NEW.uploaded_by THEN
    RAISE EXCEPTION 'Support attachment uploader mismatch';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_market_support_attachment_validate ON public.market_support_message_attachments;
CREATE TRIGGER trg_market_support_attachment_validate
BEFORE INSERT OR UPDATE ON public.market_support_message_attachments
FOR EACH ROW EXECUTE FUNCTION public.market_support_validate_attachment();

UPDATE public.market_support_tickets
SET message_slug = public.market_support_dm_slug(user_id)
WHERE message_slug IS NULL;

UPDATE public.market_support_messages
SET message_slug = public.market_support_dm_slug(sender_id)
WHERE message_slug IS NULL;

CREATE OR REPLACE FUNCTION public.market_support_after_message_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket public.market_support_tickets%ROWTYPE;
  v_admin record;
  v_preview text := left(btrim(NEW.body), 180);
BEGIN
  SELECT *
  INTO v_ticket
  FROM public.market_support_tickets
  WHERE id = NEW.ticket_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF v_preview = '' THEN
    v_preview := 'Attachment received';
  END IF;

  UPDATE public.market_support_tickets
  SET
    last_message_at = NEW.created_at,
    status = CASE
      WHEN NEW.sender_kind = 'USER' AND status IN ('RESOLVED', 'CLOSED') THEN 'OPEN'
      ELSE status
    END,
    updated_at = now()
  WHERE id = NEW.ticket_id;

  IF NEW.sender_kind = 'ADMIN' THEN
    PERFORM public.account_insert_notification(
      v_ticket.user_id,
      'support_reply',
      'Support replied',
      v_preview,
      '/market/support?ticket=' || NEW.ticket_id::text,
      'market_support_ticket',
      NEW.ticket_id::text,
      NEW.sender_id,
      jsonb_build_object('ticket_id', NEW.ticket_id::text, 'status', v_ticket.status)
    );
  ELSE
    FOR v_admin IN
      SELECT user_id
      FROM public.market_admin_users
      WHERE is_active IS TRUE
        AND role_key IN ('support_admin', 'super_admin')
    LOOP
      PERFORM public.account_insert_notification(
        v_admin.user_id,
        'support_message',
        'New support message',
        v_preview,
        '/market/admin',
        'market_support_ticket',
        NEW.ticket_id::text,
        NEW.sender_id,
        jsonb_build_object('ticket_id', NEW.ticket_id::text, 'category', v_ticket.category, 'priority', v_ticket.priority)
      );
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_market_support_messages_after_insert ON public.market_support_messages;
CREATE TRIGGER trg_market_support_messages_after_insert
AFTER INSERT ON public.market_support_messages
FOR EACH ROW EXECUTE FUNCTION public.market_support_after_message_insert();

ALTER TABLE public.market_support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_support_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_support_message_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS market_support_tickets_select_owner ON public.market_support_tickets;
CREATE POLICY market_support_tickets_select_owner
ON public.market_support_tickets
FOR SELECT TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS market_support_tickets_select_support_admin ON public.market_support_tickets;
CREATE POLICY market_support_tickets_select_support_admin
ON public.market_support_tickets
FOR SELECT TO authenticated
USING (public.market_is_support_queue_admin(auth.uid()));

DROP POLICY IF EXISTS market_support_tickets_insert_owner ON public.market_support_tickets;
CREATE POLICY market_support_tickets_insert_owner
ON public.market_support_tickets
FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS market_support_tickets_update_support_admin ON public.market_support_tickets;
CREATE POLICY market_support_tickets_update_support_admin
ON public.market_support_tickets
FOR UPDATE TO authenticated
USING (public.market_is_support_queue_admin(auth.uid()))
WITH CHECK (public.market_is_support_queue_admin(auth.uid()));

DROP POLICY IF EXISTS market_support_messages_select_owner ON public.market_support_messages;
CREATE POLICY market_support_messages_select_owner
ON public.market_support_messages
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.market_support_tickets t
    WHERE t.id = market_support_messages.ticket_id
      AND t.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS market_support_messages_select_support_admin ON public.market_support_messages;
CREATE POLICY market_support_messages_select_support_admin
ON public.market_support_messages
FOR SELECT TO authenticated
USING (public.market_is_support_queue_admin(auth.uid()));

DROP POLICY IF EXISTS market_support_messages_insert_owner ON public.market_support_messages;
CREATE POLICY market_support_messages_insert_owner
ON public.market_support_messages
FOR INSERT TO authenticated
WITH CHECK (
  sender_id = auth.uid()
  AND sender_kind = 'USER'
  AND EXISTS (
    SELECT 1
    FROM public.market_support_tickets t
    WHERE t.id = market_support_messages.ticket_id
      AND t.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS market_support_messages_insert_support_admin ON public.market_support_messages;
CREATE POLICY market_support_messages_insert_support_admin
ON public.market_support_messages
FOR INSERT TO authenticated
WITH CHECK (
  sender_id = auth.uid()
  AND sender_kind = 'ADMIN'
  AND public.market_is_support_queue_admin(auth.uid())
);

DROP POLICY IF EXISTS market_support_attachments_select_owner ON public.market_support_message_attachments;
CREATE POLICY market_support_attachments_select_owner
ON public.market_support_message_attachments
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.market_support_tickets t
    WHERE t.id = market_support_message_attachments.ticket_id
      AND t.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS market_support_attachments_select_support_admin ON public.market_support_message_attachments;
CREATE POLICY market_support_attachments_select_support_admin
ON public.market_support_message_attachments
FOR SELECT TO authenticated
USING (public.market_is_support_queue_admin(auth.uid()));

DROP POLICY IF EXISTS market_support_attachments_insert_owner ON public.market_support_message_attachments;
CREATE POLICY market_support_attachments_insert_owner
ON public.market_support_message_attachments
FOR INSERT TO authenticated
WITH CHECK (
  uploaded_by = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.market_support_messages m
    JOIN public.market_support_tickets t ON t.id = m.ticket_id
    WHERE m.id = market_support_message_attachments.message_id
      AND m.ticket_id = market_support_message_attachments.ticket_id
      AND m.sender_id = auth.uid()
      AND t.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS market_support_attachments_insert_support_admin ON public.market_support_message_attachments;
CREATE POLICY market_support_attachments_insert_support_admin
ON public.market_support_message_attachments
FOR INSERT TO authenticated
WITH CHECK (
  uploaded_by = auth.uid()
  AND public.market_is_support_queue_admin(auth.uid())
  AND EXISTS (
    SELECT 1
    FROM public.market_support_messages m
    WHERE m.id = market_support_message_attachments.message_id
      AND m.ticket_id = market_support_message_attachments.ticket_id
      AND m.sender_id = auth.uid()
  )
);

GRANT SELECT, INSERT ON public.market_support_tickets TO authenticated;
GRANT UPDATE ON public.market_support_tickets TO authenticated;
GRANT SELECT, INSERT ON public.market_support_messages TO authenticated;
GRANT SELECT, INSERT ON public.market_support_message_attachments TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('market-support', 'market-support', false, 104857600)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit;

DROP POLICY IF EXISTS market_support_objects_select ON storage.objects;
CREATE POLICY market_support_objects_select
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'market-support'
  AND (
    name LIKE auth.uid()::text || '/%'
    OR public.market_is_support_queue_admin(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.market_support_message_attachments a
      JOIN public.market_support_tickets t ON t.id = a.ticket_id
      WHERE a.storage_bucket = storage.objects.bucket_id
        AND a.storage_path = storage.objects.name
        AND t.user_id = auth.uid()
    )
  )
);

DROP POLICY IF EXISTS market_support_objects_insert_owner ON storage.objects;
CREATE POLICY market_support_objects_insert_owner
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'market-support'
  AND auth.uid() IS NOT NULL
  AND name LIKE auth.uid()::text || '/%'
);

DROP POLICY IF EXISTS market_support_objects_update_owner ON storage.objects;
CREATE POLICY market_support_objects_update_owner
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'market-support'
  AND (
    public.market_is_support_queue_admin(auth.uid())
    OR name LIKE auth.uid()::text || '/%'
  )
)
WITH CHECK (
  bucket_id = 'market-support'
  AND (
    public.market_is_support_queue_admin(auth.uid())
    OR name LIKE auth.uid()::text || '/%'
  )
);

DROP POLICY IF EXISTS market_support_objects_delete_owner ON storage.objects;
CREATE POLICY market_support_objects_delete_owner
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'market-support'
  AND (
    public.market_is_support_queue_admin(auth.uid())
    OR name LIKE auth.uid()::text || '/%'
  )
);

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.market_support_tickets;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.market_support_messages;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.market_support_message_attachments;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;
END $$;

COMMIT;
