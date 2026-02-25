BEGIN;

CREATE TABLE IF NOT EXISTS public.market_policy_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  surface text NOT NULL CHECK (surface IN ('checkout', 'order')),
  section text NOT NULL CHECK (section IN ('flow', 'status_guidance', 'safety', 'progress')),
  audience text NOT NULL DEFAULT 'both' CHECK (audience IN ('buyer', 'seller', 'both')),
  order_status text CHECK (order_status IS NULL OR order_status = UPPER(order_status)),
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'success', 'warn', 'danger')),
  title text NOT NULL,
  body text,
  bullets jsonb NOT NULL DEFAULT '[]'::jsonb,
  cta_label text,
  cta_action text,
  sort_order integer NOT NULL DEFAULT 100 CHECK (sort_order >= 0),
  active boolean NOT NULL DEFAULT true,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_policy_entries_surface_idx
  ON public.market_policy_entries (surface, active, sort_order);

CREATE INDEX IF NOT EXISTS market_policy_entries_status_idx
  ON public.market_policy_entries (surface, order_status, audience)
  WHERE active = true;

DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.market_policy_entries';
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;
END
$$;

CREATE OR REPLACE FUNCTION public.market_policy_entries_touch_updated_at()
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

DROP TRIGGER IF EXISTS trg_market_policy_entries_touch_updated_at ON public.market_policy_entries;
CREATE TRIGGER trg_market_policy_entries_touch_updated_at
BEFORE UPDATE ON public.market_policy_entries
FOR EACH ROW EXECUTE FUNCTION public.market_policy_entries_touch_updated_at();

ALTER TABLE public.market_policy_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS market_policy_entries_read_active ON public.market_policy_entries;
CREATE POLICY market_policy_entries_read_active
ON public.market_policy_entries
FOR SELECT TO authenticated
USING (active = true);

DROP POLICY IF EXISTS market_policy_entries_admin_insert ON public.market_policy_entries;
CREATE POLICY market_policy_entries_admin_insert
ON public.market_policy_entries
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.admin_users au
    WHERE au.user_id = auth.uid()
      AND au.active = true
  )
);

DROP POLICY IF EXISTS market_policy_entries_admin_update ON public.market_policy_entries;
CREATE POLICY market_policy_entries_admin_update
ON public.market_policy_entries
FOR UPDATE TO authenticated
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

DROP POLICY IF EXISTS market_policy_entries_admin_delete ON public.market_policy_entries;
CREATE POLICY market_policy_entries_admin_delete
ON public.market_policy_entries
FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.admin_users au
    WHERE au.user_id = auth.uid()
      AND au.active = true
  )
);

GRANT SELECT ON public.market_policy_entries TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.market_policy_entries TO authenticated;

INSERT INTO public.market_policy_entries (
  key, surface, section, audience, order_status, severity, title, body, bullets, cta_label, cta_action, sort_order, active
)
VALUES
(
  'checkout_flow_main',
  'checkout',
  'flow',
  'buyer',
  NULL,
  'info',
  'How escrow checkout works',
  'Escrow protects both sides. Payment is locked first, then delivery is verified, then release happens.',
  '[
    "Buyer pays into escrow (NGN or crypto).",
    "Seller delivers item/service and keeps updates in order chat.",
    "Buyer shares OTP only after receiving and testing.",
    "Seller verifies OTP after delivery handoff.",
    "Buyer releases funds only when satisfied."
  ]'::jsonb,
  NULL,
  NULL,
  10,
  true
),
(
  'checkout_buyer_safety',
  'checkout',
  'safety',
  'buyer',
  NULL,
  'warn',
  'Buyer safety rules',
  'Do not approve release early. Do not share OTP before delivery and testing.',
  '[
    "Never release funds before full delivery and verification.",
    "Never share OTP before receiving and testing the item.",
    "Keep all promises and evidence in order chat."
  ]'::jsonb,
  NULL,
  NULL,
  20,
  true
),
(
  'checkout_complaint_rule',
  'checkout',
  'safety',
  'both',
  NULL,
  'danger',
  'Complaint and anti-manipulation policy',
  'If either party is manipulative, deceptive, abusive, or violates policy, open a complaint immediately.',
  '[
    "Buyer: file complaint if seller refuses agreed delivery or manipulates release.",
    "Seller: file complaint if buyer attempts OTP abuse, chargeback abuse, or harassment.",
    "Always include proof in chat and deliverables."
  ]'::jsonb,
  NULL,
  NULL,
  30,
  true
),
(
  'order_created_buyer',
  'order',
  'status_guidance',
  'buyer',
  'CREATED',
  'warn',
  'Payment pending',
  'Complete payment so funds move into escrow and seller can start delivery.',
  '[
    "Review listing and agreement details before payment.",
    "Ask questions in chat before paying if anything is unclear."
  ]'::jsonb,
  'Go to checkout',
  'go_checkout',
  40,
  true
),
(
  'order_created_seller',
  'order',
  'status_guidance',
  'seller',
  'CREATED',
  'info',
  'Waiting for buyer payment',
  'Escrow is not funded yet. Do not deliver full product before escrow confirmation.',
  '[
    "You may prepare draft work, but avoid final delivery before escrow is funded."
  ]'::jsonb,
  NULL,
  NULL,
  41,
  true
),
(
  'order_in_escrow_buyer',
  'order',
  'status_guidance',
  'buyer',
  'IN_ESCROW',
  'info',
  'Escrow funded',
  'Funds are protected in escrow. Wait for seller updates and delivery progress.',
  '[
    "Use order chat for all updates and expectations."
  ]'::jsonb,
  NULL,
  NULL,
  50,
  true
),
(
  'order_in_escrow_seller',
  'order',
  'status_guidance',
  'seller',
  'IN_ESCROW',
  'info',
  'Escrow confirmed, proceed with delivery',
  'Start delivery and mark out-for-delivery when handoff begins.',
  '[
    "Upload proofs/previews where applicable before final handoff."
  ]'::jsonb,
  NULL,
  NULL,
  51,
  true
),
(
  'order_out_for_delivery_buyer',
  'order',
  'status_guidance',
  'buyer',
  'OUT_FOR_DELIVERY',
  'warn',
  'Do not share OTP early',
  'Share OTP only after item/service is received and tested.',
  '[
    "Early OTP sharing may unlock seller actions too soon."
  ]'::jsonb,
  NULL,
  NULL,
  60,
  true
),
(
  'order_out_for_delivery_seller',
  'order',
  'status_guidance',
  'seller',
  'OUT_FOR_DELIVERY',
  'warn',
  'Verify OTP only after complete handoff',
  'Request OTP after delivery is complete and agreed scope is met.',
  '[
    "Do not pressure buyer for OTP before completion."
  ]'::jsonb,
  NULL,
  NULL,
  61,
  true
),
(
  'order_delivered_buyer',
  'order',
  'status_guidance',
  'buyer',
  'DELIVERED',
  'success',
  'Release only if satisfied',
  'Release escrow only after confirming product/service quality and completeness.',
  '[
    "If quality is not as agreed, open complaint instead of releasing."
  ]'::jsonb,
  'Open complaint',
  'open_dispute',
  70,
  true
),
(
  'order_delivered_seller',
  'order',
  'status_guidance',
  'seller',
  'DELIVERED',
  'info',
  'Awaiting buyer release',
  'Delivery is marked complete. Keep communication professional while buyer validates.',
  '[
    "If buyer acts in bad faith, open complaint with evidence."
  ]'::jsonb,
  'Open complaint',
  'open_dispute',
  71,
  true
),
(
  'order_released_both',
  'order',
  'status_guidance',
  'both',
  'RELEASED',
  'success',
  'Order completed',
  'Funds were released and order is complete.',
  '[]'::jsonb,
  NULL,
  NULL,
  80,
  true
),
(
  'order_refunded_both',
  'order',
  'status_guidance',
  'both',
  'REFUNDED',
  'danger',
  'Order refunded',
  'Escrow was returned to buyer and this order is closed.',
  '[]'::jsonb,
  NULL,
  NULL,
  81,
  true
),
(
  'order_cancelled_both',
  'order',
  'status_guidance',
  'both',
  'CANCELLED',
  'danger',
  'Order cancelled',
  'This order is closed and cannot continue.',
  '[]'::jsonb,
  NULL,
  NULL,
  82,
  true
),
(
  'order_progress_default',
  'order',
  'progress',
  'both',
  NULL,
  'info',
  'Escrow flow timeline',
  NULL,
  '[
    "Buyer pays and funds move to escrow.",
    "Seller marks out-for-delivery.",
    "Buyer generates OTP after receiving and testing.",
    "Seller verifies OTP after handoff.",
    "Buyer releases funds when fully satisfied."
  ]'::jsonb,
  NULL,
  NULL,
  90,
  true
),
(
  'order_safety_buyer',
  'order',
  'safety',
  'buyer',
  NULL,
  'warn',
  'Buyer protection reminder',
  'Never release funds and never share OTP before receiving and testing.',
  '[
    "Use complaint flow immediately if seller is manipulative or violates terms."
  ]'::jsonb,
  'Open complaint',
  'open_dispute',
  100,
  true
),
(
  'order_safety_seller',
  'order',
  'safety',
  'seller',
  NULL,
  'warn',
  'Seller protection reminder',
  'Do not request OTP before complete delivery. Keep proofs of scope completion.',
  '[
    "Use complaint flow if buyer attempts fraud, OTP abuse, or policy violations."
  ]'::jsonb,
  'Open complaint',
  'open_dispute',
  101,
  true
)
ON CONFLICT (key) DO UPDATE
SET
  surface = EXCLUDED.surface,
  section = EXCLUDED.section,
  audience = EXCLUDED.audience,
  order_status = EXCLUDED.order_status,
  severity = EXCLUDED.severity,
  title = EXCLUDED.title,
  body = EXCLUDED.body,
  bullets = EXCLUDED.bullets,
  cta_label = EXCLUDED.cta_label,
  cta_action = EXCLUDED.cta_action,
  sort_order = EXCLUDED.sort_order,
  active = EXCLUDED.active,
  updated_at = now();

COMMIT;
