BEGIN;

CREATE TABLE IF NOT EXISTS public.account_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  body text,
  route text,
  entity_type text,
  entity_id text,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS account_notifications_user_created_idx
  ON public.account_notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS account_notifications_user_unread_idx
  ON public.account_notifications (user_id, read_at, created_at DESC);

CREATE INDEX IF NOT EXISTS account_notifications_entity_idx
  ON public.account_notifications (entity_type, entity_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.account_notifications_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_account_notifications_updated_at ON public.account_notifications;
CREATE TRIGGER trg_account_notifications_updated_at
BEFORE UPDATE ON public.account_notifications
FOR EACH ROW EXECUTE FUNCTION public.account_notifications_touch_updated_at();

ALTER TABLE public.account_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS account_notifications_select_own ON public.account_notifications;
CREATE POLICY account_notifications_select_own
ON public.account_notifications
FOR SELECT TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS account_notifications_insert_own ON public.account_notifications;
CREATE POLICY account_notifications_insert_own
ON public.account_notifications
FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS account_notifications_update_own ON public.account_notifications;
CREATE POLICY account_notifications_update_own
ON public.account_notifications
FOR UPDATE TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS account_notifications_delete_own ON public.account_notifications;
CREATE POLICY account_notifications_delete_own
ON public.account_notifications
FOR DELETE TO authenticated
USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_notifications TO authenticated;

CREATE OR REPLACE FUNCTION public.account_insert_notification(
  p_user_id uuid,
  p_kind text,
  p_title text,
  p_body text DEFAULT NULL,
  p_route text DEFAULT NULL,
  p_entity_type text DEFAULT NULL,
  p_entity_id text DEFAULT NULL,
  p_actor_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_title text := left(trim(coalesce(p_title, '')), 160);
  v_body text := nullif(left(trim(coalesce(p_body, '')), 500), '');
BEGIN
  IF p_user_id IS NULL OR v_title = '' THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.account_notifications (
    user_id,
    kind,
    title,
    body,
    route,
    entity_type,
    entity_id,
    actor_id,
    metadata
  )
  VALUES (
    p_user_id,
    lower(coalesce(nullif(trim(p_kind), ''), 'general')),
    v_title,
    v_body,
    nullif(trim(coalesce(p_route, '')), ''),
    nullif(trim(coalesce(p_entity_type, '')), ''),
    nullif(trim(coalesce(p_entity_id, '')), ''),
    p_actor_id,
    coalesce(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.account_notify_market_order_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_listing_title text;
  v_route text := '/market/order/' || NEW.id::text;
BEGIN
  SELECT coalesce(nullif(trim(title), ''), 'your listing')
  INTO v_listing_title
  FROM public.market_listings
  WHERE id = NEW.listing_id;

  PERFORM public.account_insert_notification(
    NEW.buyer_id,
    'order_created',
    'Order created',
    'Your order for ' || coalesce(v_listing_title, 'this listing') || ' was created.',
    v_route,
    'market_order',
    NEW.id::text,
    NEW.seller_id,
    jsonb_build_object('status', upper(coalesce(NEW.status::text, 'CREATED')))
  );

  IF NEW.seller_id IS DISTINCT FROM NEW.buyer_id THEN
    PERFORM public.account_insert_notification(
      NEW.seller_id,
      'order_received',
      'New order received',
      'A buyer placed an order for ' || coalesce(v_listing_title, 'your listing') || '.',
      v_route,
      'market_order',
      NEW.id::text,
      NEW.buyer_id,
      jsonb_build_object('status', upper(coalesce(NEW.status::text, 'CREATED')))
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.account_notify_market_order_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text := upper(coalesce(NEW.status::text, ''));
  v_listing_title text;
  v_route text := '/market/order/' || NEW.id::text;
  v_buyer_title text;
  v_seller_title text;
  v_buyer_body text;
  v_seller_body text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(nullif(trim(title), ''), 'your order')
  INTO v_listing_title
  FROM public.market_listings
  WHERE id = NEW.listing_id;

  v_buyer_title := CASE v_status
    WHEN 'IN_ESCROW' THEN 'Order payment confirmed'
    WHEN 'OUT_FOR_DELIVERY' THEN 'Order is out for delivery'
    WHEN 'DELIVERABLE_UPLOADED' THEN 'Deliverable uploaded'
    WHEN 'DELIVERED' THEN 'Order delivered'
    WHEN 'RELEASED' THEN 'Order completed'
    WHEN 'REFUNDED' THEN 'Order refunded'
    WHEN 'CANCELLED' THEN 'Order cancelled'
    ELSE 'Order updated'
  END;

  v_seller_title := CASE v_status
    WHEN 'IN_ESCROW' THEN 'Order funded'
    WHEN 'OUT_FOR_DELIVERY' THEN 'Order moved to delivery'
    WHEN 'DELIVERABLE_UPLOADED' THEN 'Deliverable saved'
    WHEN 'DELIVERED' THEN 'Delivery marked complete'
    WHEN 'RELEASED' THEN 'Order completed'
    WHEN 'REFUNDED' THEN 'Order refunded'
    WHEN 'CANCELLED' THEN 'Order cancelled'
    ELSE 'Order updated'
  END;

  v_buyer_body := CASE v_status
    WHEN 'RELEASED' THEN coalesce(v_listing_title, 'Your order') || ' was completed successfully.'
    WHEN 'REFUNDED' THEN coalesce(v_listing_title, 'Your order') || ' was refunded.'
    WHEN 'CANCELLED' THEN coalesce(v_listing_title, 'Your order') || ' was cancelled.'
    ELSE coalesce(v_listing_title, 'Your order') || ' is now ' || replace(lower(v_status), '_', ' ') || '.'
  END;

  v_seller_body := CASE v_status
    WHEN 'RELEASED' THEN coalesce(v_listing_title, 'This order') || ' was completed and paid out.'
    WHEN 'REFUNDED' THEN coalesce(v_listing_title, 'This order') || ' was refunded to the buyer.'
    WHEN 'CANCELLED' THEN coalesce(v_listing_title, 'This order') || ' was cancelled.'
    ELSE coalesce(v_listing_title, 'This order') || ' is now ' || replace(lower(v_status), '_', ' ') || '.'
  END;

  PERFORM public.account_insert_notification(
    NEW.buyer_id,
    'order_status_changed',
    v_buyer_title,
    v_buyer_body,
    v_route,
    'market_order',
    NEW.id::text,
    NEW.seller_id,
    jsonb_build_object('status', v_status)
  );

  IF NEW.seller_id IS DISTINCT FROM NEW.buyer_id THEN
    PERFORM public.account_insert_notification(
      NEW.seller_id,
      'order_status_changed',
      v_seller_title,
      v_seller_body,
      v_route,
      'market_order',
      NEW.id::text,
      NEW.buyer_id,
      jsonb_build_object('status', v_status)
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.account_notify_verification_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text := upper(coalesce(NEW.status::text, 'PENDING'));
  v_title text;
  v_body text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  v_title := CASE v_status
    WHEN 'PENDING' THEN 'Verification started'
    WHEN 'IN_REVIEW' THEN 'Verification in review'
    WHEN 'VERIFIED' THEN 'Profile verified'
    WHEN 'REJECTED' THEN 'Verification rejected'
    WHEN 'RESUBMISSION_REQUIRED' THEN 'Verification retry required'
    WHEN 'EXPIRED' THEN 'Verification session expired'
    ELSE 'Verification updated'
  END;

  v_body := CASE v_status
    WHEN 'VERIFIED' THEN 'Your seller verification is complete.'
    WHEN 'REJECTED' THEN 'Your verification request was rejected. Review the provider note and retry.'
    WHEN 'RESUBMISSION_REQUIRED' THEN 'The provider asked for another verification attempt.'
    WHEN 'EXPIRED' THEN 'Your verification session expired before completion.'
    ELSE 'Your verification status changed to ' || replace(lower(v_status), '_', ' ') || '.'
  END;

  PERFORM public.account_insert_notification(
    NEW.user_id,
    'verification_update',
    v_title,
    v_body,
    '/market/verification/status',
    'market_verification_request',
    NEW.id::text,
    NULL,
    jsonb_build_object('status', v_status)
  );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.account_notify_listing_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title text;
  v_body text;
BEGIN
  IF NEW.is_active IS NOT DISTINCT FROM OLD.is_active THEN
    RETURN NEW;
  END IF;

  v_title := CASE WHEN NEW.is_active THEN 'Listing re-enabled' ELSE 'Listing disabled' END;
  v_body := CASE
    WHEN NEW.is_active THEN coalesce(nullif(trim(NEW.title), ''), 'Your listing') || ' is live again.'
    ELSE coalesce(nullif(trim(NEW.title), ''), 'Your listing') || ' is no longer active.'
  END;

  PERFORM public.account_insert_notification(
    NEW.seller_id,
    'listing_state_changed',
    v_title,
    v_body,
    '/market/listings?mine=1',
    'market_listing',
    NEW.id::text,
    NULL,
    jsonb_build_object('is_active', NEW.is_active)
  );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.account_notify_market_review_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.reviewee_id IS NULL OR NEW.reviewee_id = NEW.reviewer_id THEN
    RETURN NEW;
  END IF;

  PERFORM public.account_insert_notification(
    NEW.reviewee_id,
    'review_received',
    'New review received',
    'You received a ' || coalesce(NEW.rating::text, '0') || '-star review.',
    '/market/(tabs)/account',
    'market_review',
    NEW.id::text,
    NEW.reviewer_id,
    jsonb_build_object('rating', NEW.rating, 'comment', coalesce(NEW.comment, ''))
  );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.account_notify_social_comment_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_author_id uuid;
BEGIN
  SELECT p.author_id INTO v_author_id
  FROM public.market_social_posts p
  WHERE p.id = NEW.post_id;

  IF v_author_id IS NULL OR v_author_id = NEW.user_id THEN
    RETURN NEW;
  END IF;

  PERFORM public.account_insert_notification(
    v_author_id,
    'social_comment',
    'New comment on your post',
    left(coalesce(NEW.body, 'Someone commented on your post.'), 180),
    '/market/social',
    'market_social_post',
    NEW.post_id::text,
    NEW.user_id,
    jsonb_build_object('comment_id', NEW.id::text)
  );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.account_notify_profile_follow_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.followed_id IS NULL OR NEW.followed_id = NEW.follower_id THEN
    RETURN NEW;
  END IF;

  PERFORM public.account_insert_notification(
    NEW.followed_id,
    'profile_follow',
    'New follower',
    'Someone followed your seller profile.',
    '/market/(tabs)/account',
    'market_profile_follow',
    NEW.id::text,
    NEW.follower_id,
    '{}'::jsonb
  );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.account_notify_wallet_tx_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title text;
  v_body text;
BEGIN
  v_title := CASE lower(coalesce(NEW.type, ''))
    WHEN 'deposit' THEN 'Wallet deposit recorded'
    WHEN 'transfer_in' THEN 'Funds received'
    WHEN 'transfer_out' THEN 'Transfer sent'
    WHEN 'withdrawal' THEN 'Withdrawal recorded'
    WHEN 'bill' THEN 'Bill payment recorded'
    WHEN 'fee' THEN 'Wallet fee charged'
    ELSE 'Wallet activity'
  END;

  v_body := 'Amount: ' || coalesce(NEW.amount::text, '0');

  PERFORM public.account_insert_notification(
    NEW.user_id,
    'wallet_activity',
    v_title,
    v_body,
    '/fintech/(tabs)/wallet',
    'app_wallet_tx',
    NEW.id::text,
    NULL,
    jsonb_build_object('type', NEW.type, 'reference', NEW.reference)
  );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.account_notify_paystack_event_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.account_insert_notification(
    NEW.user_id,
    'deposit_received',
    'Deposit received',
    'A new account deposit was confirmed.',
    '/fintech/(tabs)/wallet',
    'paystack_event',
    NEW.reference,
    NULL,
    jsonb_build_object('amount', NEW.amount, 'reference', NEW.reference)
  );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.account_notify_withdrawal_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text := lower(coalesce(NEW.status, 'pending'));
  v_title text;
  v_body text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  v_title := CASE v_status
    WHEN 'pending' THEN 'Withdrawal requested'
    WHEN 'processing' THEN 'Withdrawal processing'
    WHEN 'successful' THEN 'Withdrawal completed'
    WHEN 'failed' THEN 'Withdrawal failed'
    WHEN 'reversed' THEN 'Withdrawal reversed'
    WHEN 'refunded' THEN 'Withdrawal refunded'
    ELSE 'Withdrawal updated'
  END;

  v_body := 'Amount: ' || coalesce(NEW.amount::text, '0');

  PERFORM public.account_insert_notification(
    NEW.user_id,
    'withdrawal_update',
    v_title,
    v_body,
    '/fintech/(tabs)/wallet',
    'withdrawal',
    NEW.id::text,
    NULL,
    jsonb_build_object('status', upper(v_status))
  );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.account_notify_dispute_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_buyer_id uuid;
  v_seller_id uuid;
  v_title text;
  v_body text;
  v_status text := upper(coalesce(NEW.status::text, 'OPEN'));
  v_route text := '/market/order/' || NEW.order_id::text;
BEGIN
  SELECT o.buyer_id, o.seller_id
  INTO v_buyer_id, v_seller_id
  FROM public.market_orders o
  WHERE o.id = NEW.order_id;

  v_title := CASE
    WHEN TG_OP = 'INSERT' THEN 'Dispute opened'
    ELSE 'Dispute updated'
  END;

  v_body := CASE
    WHEN TG_OP = 'INSERT' THEN 'A dispute was opened on an order in your account.'
    ELSE 'Dispute status changed to ' || replace(lower(v_status), '_', ' ') || '.'
  END;

  IF v_buyer_id IS NOT NULL THEN
    PERFORM public.account_insert_notification(
      v_buyer_id,
      'dispute_update',
      v_title,
      v_body,
      v_route,
      'market_dispute',
      NEW.id::text,
      NEW.opened_by,
      jsonb_build_object('status', v_status)
    );
  END IF;

  IF v_seller_id IS NOT NULL AND v_seller_id IS DISTINCT FROM v_buyer_id THEN
    PERFORM public.account_insert_notification(
      v_seller_id,
      'dispute_update',
      v_title,
      v_body,
      v_route,
      'market_dispute',
      NEW.id::text,
      NEW.opened_by,
      jsonb_build_object('status', v_status)
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.account_notify_stock_order_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slug text;
  v_name text;
  v_status text := lower(coalesce(NEW.status::text, 'pending'));
  v_title text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  SELECT s.slug, s.name
  INTO v_slug, v_name
  FROM public.market_stock_identities s
  WHERE s.id = NEW.stock_id;

  v_title := CASE v_status
    WHEN 'pending' THEN 'Stock order created'
    WHEN 'submitted' THEN 'Stock order submitted'
    WHEN 'filled' THEN 'Stock order filled'
    WHEN 'failed' THEN 'Stock order failed'
    WHEN 'cancelled' THEN 'Stock order cancelled'
    ELSE 'Stock order updated'
  END;

  PERFORM public.account_insert_notification(
    NEW.user_id,
    'stock_order_update',
    v_title,
    coalesce(v_name, 'Your stock order') || ' is now ' || replace(v_status, '_', ' ') || '.',
    CASE WHEN coalesce(v_slug, '') <> '' THEN '/market/stock/' || v_slug ELSE '/market/stock' END,
    'market_stock_order',
    NEW.id::text,
    NULL,
    jsonb_build_object('status', upper(v_status), 'stock_id', NEW.stock_id::text, 'side', NEW.side::text)
  );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.account_notify_stock_trade_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store_id uuid;
  v_slug text;
  v_name text;
  v_title text;
BEGIN
  SELECT s.store_id, s.slug, s.name
  INTO v_store_id, v_slug, v_name
  FROM public.market_stock_identities s
  WHERE s.id = NEW.stock_id;

  IF v_store_id IS NULL OR v_store_id = NEW.user_id THEN
    RETURN NEW;
  END IF;

  v_title := CASE lower(coalesce(NEW.side::text, 'buy'))
    WHEN 'buy' THEN 'Someone bought your stock'
    ELSE 'Someone sold your stock'
  END;

  PERFORM public.account_insert_notification(
    v_store_id,
    'stock_trade_activity',
    v_title,
    coalesce(v_name, 'Your stock') || ' had a new ' || lower(coalesce(NEW.side::text, 'trade')) || ' trade.',
    CASE WHEN coalesce(v_slug, '') <> '' THEN '/market/stock/' || v_slug ELSE '/market/stock' END,
    'market_stock_trade',
    NEW.id::text,
    NEW.user_id,
    jsonb_build_object(
      'stock_id', NEW.stock_id::text,
      'side', NEW.side::text,
      'price_usdc', NEW.price_usdc,
      'quantity', NEW.quantity
    )
  );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.account_notify_stock_price_move()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pct numeric;
  v_kind text;
  v_title text;
  v_slug text;
  v_name text;
  v_route text;
  v_entity_type text := 'market_stock_price';
  v_holder record;
BEGIN
  IF NEW.last_price_usdc IS NULL OR OLD.last_price_usdc IS NULL OR OLD.last_price_usdc <= 0 THEN
    RETURN NEW;
  END IF;

  v_pct := ((NEW.last_price_usdc - OLD.last_price_usdc) / OLD.last_price_usdc) * 100;
  IF abs(v_pct) < 10 THEN
    RETURN NEW;
  END IF;

  SELECT s.slug, s.name
  INTO v_slug, v_name
  FROM public.market_stock_identities s
  WHERE s.id = NEW.stock_id;

  IF v_pct >= 0 THEN
    v_kind := 'stock_price_surge';
    v_title := 'Stock price surge';
  ELSE
    v_kind := 'stock_price_drop';
    v_title := 'Stock price drop';
  END IF;

  v_route := CASE WHEN coalesce(v_slug, '') <> '' THEN '/market/stock/' || v_slug ELSE '/market/stock' END;

  FOR v_holder IN
    SELECT p.user_id
    FROM public.market_stock_positions p
    WHERE p.stock_id = NEW.stock_id
      AND p.balance_qty > 0
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM public.account_notifications n
      WHERE n.user_id = v_holder.user_id
        AND n.kind = v_kind
        AND n.entity_type = v_entity_type
        AND n.entity_id = NEW.stock_id::text
        AND n.created_at > now() - interval '6 hours'
    ) THEN
      PERFORM public.account_insert_notification(
        v_holder.user_id,
        v_kind,
        v_title,
        coalesce(v_name, 'A stock you hold') || ' moved ' || round(v_pct::numeric, 2)::text || '%.',
        v_route,
        v_entity_type,
        NEW.stock_id::text,
        NULL,
        jsonb_build_object(
          'stock_id', NEW.stock_id::text,
          'old_price_usdc', OLD.last_price_usdc,
          'new_price_usdc', NEW.last_price_usdc,
          'change_percent', round(v_pct::numeric, 2)
        )
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_account_notify_market_order_insert ON public.market_orders;
CREATE TRIGGER trg_account_notify_market_order_insert
AFTER INSERT ON public.market_orders
FOR EACH ROW EXECUTE FUNCTION public.account_notify_market_order_insert();

DROP TRIGGER IF EXISTS trg_account_notify_market_order_status ON public.market_orders;
CREATE TRIGGER trg_account_notify_market_order_status
AFTER UPDATE OF status ON public.market_orders
FOR EACH ROW EXECUTE FUNCTION public.account_notify_market_order_status();

DROP TRIGGER IF EXISTS trg_account_notify_verification_request_insert ON public.market_verification_requests;
CREATE TRIGGER trg_account_notify_verification_request_insert
AFTER INSERT ON public.market_verification_requests
FOR EACH ROW EXECUTE FUNCTION public.account_notify_verification_request();

DROP TRIGGER IF EXISTS trg_account_notify_verification_request_update ON public.market_verification_requests;
CREATE TRIGGER trg_account_notify_verification_request_update
AFTER UPDATE OF status ON public.market_verification_requests
FOR EACH ROW EXECUTE FUNCTION public.account_notify_verification_request();

DROP TRIGGER IF EXISTS trg_account_notify_listing_state ON public.market_listings;
CREATE TRIGGER trg_account_notify_listing_state
AFTER UPDATE OF is_active ON public.market_listings
FOR EACH ROW EXECUTE FUNCTION public.account_notify_listing_state();

DROP TRIGGER IF EXISTS trg_account_notify_market_review_insert ON public.market_reviews;
CREATE TRIGGER trg_account_notify_market_review_insert
AFTER INSERT ON public.market_reviews
FOR EACH ROW EXECUTE FUNCTION public.account_notify_market_review_insert();

DROP TRIGGER IF EXISTS trg_account_notify_social_comment_insert ON public.market_social_comments;
CREATE TRIGGER trg_account_notify_social_comment_insert
AFTER INSERT ON public.market_social_comments
FOR EACH ROW EXECUTE FUNCTION public.account_notify_social_comment_insert();

DROP TRIGGER IF EXISTS trg_account_notify_profile_follow_insert ON public.market_profile_follows;
CREATE TRIGGER trg_account_notify_profile_follow_insert
AFTER INSERT ON public.market_profile_follows
FOR EACH ROW EXECUTE FUNCTION public.account_notify_profile_follow_insert();

DROP TRIGGER IF EXISTS trg_account_notify_wallet_tx_insert ON public.app_wallet_tx_simple;
CREATE TRIGGER trg_account_notify_wallet_tx_insert
AFTER INSERT ON public.app_wallet_tx_simple
FOR EACH ROW EXECUTE FUNCTION public.account_notify_wallet_tx_insert();

DROP TRIGGER IF EXISTS trg_account_notify_paystack_event_insert ON public.paystack_events_simple;
CREATE TRIGGER trg_account_notify_paystack_event_insert
AFTER INSERT ON public.paystack_events_simple
FOR EACH ROW EXECUTE FUNCTION public.account_notify_paystack_event_insert();

DROP TRIGGER IF EXISTS trg_account_notify_withdrawal_insert ON public.withdrawals_simple;
CREATE TRIGGER trg_account_notify_withdrawal_insert
AFTER INSERT ON public.withdrawals_simple
FOR EACH ROW EXECUTE FUNCTION public.account_notify_withdrawal_change();

DROP TRIGGER IF EXISTS trg_account_notify_withdrawal_update ON public.withdrawals_simple;
CREATE TRIGGER trg_account_notify_withdrawal_update
AFTER UPDATE OF status ON public.withdrawals_simple
FOR EACH ROW EXECUTE FUNCTION public.account_notify_withdrawal_change();

DROP TRIGGER IF EXISTS trg_account_notify_dispute_insert ON public.market_disputes;
CREATE TRIGGER trg_account_notify_dispute_insert
AFTER INSERT ON public.market_disputes
FOR EACH ROW EXECUTE FUNCTION public.account_notify_dispute_change();

DROP TRIGGER IF EXISTS trg_account_notify_dispute_update ON public.market_disputes;
CREATE TRIGGER trg_account_notify_dispute_update
AFTER UPDATE OF status ON public.market_disputes
FOR EACH ROW EXECUTE FUNCTION public.account_notify_dispute_change();

DROP TRIGGER IF EXISTS trg_account_notify_stock_order_insert ON public.market_stock_orders;
CREATE TRIGGER trg_account_notify_stock_order_insert
AFTER INSERT ON public.market_stock_orders
FOR EACH ROW EXECUTE FUNCTION public.account_notify_stock_order_change();

DROP TRIGGER IF EXISTS trg_account_notify_stock_order_update ON public.market_stock_orders;
CREATE TRIGGER trg_account_notify_stock_order_update
AFTER UPDATE OF status ON public.market_stock_orders
FOR EACH ROW EXECUTE FUNCTION public.account_notify_stock_order_change();

DROP TRIGGER IF EXISTS trg_account_notify_stock_trade_insert ON public.market_stock_trades;
CREATE TRIGGER trg_account_notify_stock_trade_insert
AFTER INSERT ON public.market_stock_trades
FOR EACH ROW EXECUTE FUNCTION public.account_notify_stock_trade_insert();

DROP TRIGGER IF EXISTS trg_account_notify_stock_price_move ON public.market_stock_price_points;
CREATE TRIGGER trg_account_notify_stock_price_move
AFTER UPDATE OF last_price_usdc ON public.market_stock_price_points
FOR EACH ROW EXECUTE FUNCTION public.account_notify_stock_price_move();

DO $$
BEGIN
  IF to_regclass('public.market_seller_reviews') IS NOT NULL THEN
    EXECUTE $sql$
      CREATE OR REPLACE FUNCTION public.account_notify_seller_review_insert()
      RETURNS trigger
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $fn$
      BEGIN
        IF NEW.seller_id IS NULL OR NEW.seller_id = NEW.reviewer_id THEN
          RETURN NEW;
        END IF;

        PERFORM public.account_insert_notification(
          NEW.seller_id,
          'seller_review_received',
          'New profile review received',
          'You received a ' || coalesce(NEW.rating::text, '0') || '-star seller review.',
          '/market/(tabs)/account',
          'market_seller_review',
          NEW.id::text,
          NEW.reviewer_id,
          jsonb_build_object('rating', NEW.rating, 'comment', coalesce(NEW.comment, ''))
        );

        RETURN NEW;
      END;
      $fn$;
    $sql$;

    EXECUTE 'DROP TRIGGER IF EXISTS trg_account_notify_seller_review_insert ON public.market_seller_reviews';
    EXECUTE 'CREATE TRIGGER trg_account_notify_seller_review_insert AFTER INSERT ON public.market_seller_reviews FOR EACH ROW EXECUTE FUNCTION public.account_notify_seller_review_insert()';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.dm_messages') IS NOT NULL AND to_regclass('public.dm_threads') IS NOT NULL THEN
    EXECUTE $sql$
      CREATE OR REPLACE FUNCTION public.account_notify_dm_message_insert()
      RETURNS trigger
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $fn$
      DECLARE
        v_a_user_id uuid;
        v_b_user_id uuid;
        v_recipient_id uuid;
        v_sender_handle text;
        v_sender_name text;
        v_route text;
        v_body text;
      BEGIN
        SELECT t.a_user_id, t.b_user_id
        INTO v_a_user_id, v_b_user_id
        FROM public.dm_threads t
        WHERE t.id = NEW.thread_id;

        v_recipient_id := CASE
          WHEN NEW.sender_id = v_a_user_id THEN v_b_user_id
          WHEN NEW.sender_id = v_b_user_id THEN v_a_user_id
          ELSE NULL
        END;

        IF v_recipient_id IS NULL OR v_recipient_id = NEW.sender_id THEN
          RETURN NEW;
        END IF;

        SELECT coalesce(sp.market_username, p.username), coalesce(sp.business_name, p.full_name, p.username, 'Someone')
        INTO v_sender_handle, v_sender_name
        FROM public.profiles p
        LEFT JOIN public.market_seller_profiles sp
          ON sp.user_id = p.id
         AND sp.active = true
        WHERE p.id = NEW.sender_id;

        v_route := CASE
          WHEN coalesce(v_sender_handle, '') <> '' THEN '/market/dm/' || lower(v_sender_handle)
          ELSE '/market/(tabs)/messages'
        END;

        v_body := CASE
          WHEN nullif(trim(coalesce(NEW.body, '')), '') IS NOT NULL THEN left(trim(NEW.body), 180)
          WHEN coalesce(NEW.has_attachments, false) THEN v_sender_name || ' sent you an attachment.'
          ELSE v_sender_name || ' sent you a new message.'
        END;

        PERFORM public.account_insert_notification(
          v_recipient_id,
          'dm_new_message',
          'New direct message',
          v_body,
          v_route,
          'dm_message',
          NEW.id::text,
          NEW.sender_id,
          jsonb_build_object('thread_id', NEW.thread_id::text)
        );

        RETURN NEW;
      END;
      $fn$;
    $sql$;

    EXECUTE 'DROP TRIGGER IF EXISTS trg_account_notify_dm_message_insert ON public.dm_messages';
    EXECUTE 'CREATE TRIGGER trg_account_notify_dm_message_insert AFTER INSERT ON public.dm_messages FOR EACH ROW EXECUTE FUNCTION public.account_notify_dm_message_insert()';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'account_notifications'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.account_notifications';
    END IF;
  END IF;
END $$;

COMMIT;
