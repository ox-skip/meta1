BEGIN;

CREATE OR REPLACE FUNCTION public.market_landing_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.market_can_manage_landing(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.market_admin_users mau
    JOIN public.market_admin_roles mar ON mar.key = mau.role_key
    WHERE mau.user_id = p_user_id
      AND mau.is_active = true
      AND (
        mau.role_key = 'super_admin'
        OR COALESCE(mar.permissions, '[]'::jsonb) ? '*'
        OR COALESCE(mar.permissions, '[]'::jsonb) ? 'landing.manage'
        OR COALESCE(mar.permissions, '[]'::jsonb) ? 'users.moderate'
        OR COALESCE(mar.permissions, '[]'::jsonb) ? 'listings.moderate'
      )
  );
$$;

UPDATE public.market_admin_roles
SET
  permissions = (
    SELECT jsonb_agg(DISTINCT p.permission ORDER BY p.permission)
    FROM jsonb_array_elements_text(
      COALESCE(permissions, '[]'::jsonb) || '["landing.manage"]'::jsonb
    ) AS p(permission)
  ),
  updated_at = now()
WHERE key = 'super_admin'
   OR COALESCE(permissions, '[]'::jsonb) ? 'users.moderate'
   OR COALESCE(permissions, '[]'::jsonb) ? 'listings.moderate';

CREATE TABLE IF NOT EXISTS public.market_landing_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  brand_name text NOT NULL DEFAULT 'BestCity Market',
  hero_eyebrow text NOT NULL DEFAULT 'Trusted digital commerce for modern cities',
  hero_title text NOT NULL DEFAULT 'BestCity Market',
  hero_subtitle text NOT NULL DEFAULT 'A marketplace for verified sellers, escrow-protected orders, digital services, and blockchain-enabled store ownership.',
  hero_media_url text,
  hero_media_storage_path text,
  primary_cta_label text NOT NULL DEFAULT 'Enter the market',
  primary_cta_route text NOT NULL DEFAULT '/market',
  secondary_cta_label text NOT NULL DEFAULT 'Create account',
  secondary_cta_route text NOT NULL DEFAULT '/register',
  company_overview text NOT NULL DEFAULT 'BestCity Market brings discovery, payments, escrow, seller verification, rewards, and store-backed stock identities into one commerce platform.',
  mission_title text NOT NULL DEFAULT 'Our mission',
  mission_body text NOT NULL DEFAULT 'Make online commerce safer, more transparent, and more rewarding for buyers, sellers, and communities.',
  vision_title text NOT NULL DEFAULT 'Our vision',
  vision_body text NOT NULL DEFAULT 'A trusted city-scale digital market where reputation, ownership, and settlement can move with users across borders.',
  what_building_title text NOT NULL DEFAULT 'What we are building',
  what_building_body text NOT NULL DEFAULT 'A premium marketplace stack with verified storefronts, escrow settlement, social commerce, rewards, support workflows, and optional blockchain rails for store stock.',
  why_building_title text NOT NULL DEFAULT 'Why we are building it',
  why_building_body text NOT NULL DEFAULT 'Small businesses need better trust tools, buyers need safer fulfillment, and digital markets need visible accountability from discovery through payout.',
  blockchain_title text NOT NULL DEFAULT 'Why blockchain',
  blockchain_body text NOT NULL DEFAULT 'Blockchain rails give BestCity Market transparent settlement records, programmable escrow, portable seller ownership, and auditable stock-market activity without replacing practical everyday commerce.',
  product_title text NOT NULL DEFAULT 'Product details',
  product_body text NOT NULL DEFAULT 'BestCity Market combines marketplace listings, social feeds, seller profiles, escrow checkout, dispute review, rewards, verification, and stock-identity tools in one connected experience.',
  stats_title text NOT NULL DEFAULT 'Public platform statistics',
  stats_subtitle text NOT NULL DEFAULT 'Live marketplace, escrow, transaction, verification, and stock-market signals refreshed from BestCity Market infrastructure.',
  roadmap_title text NOT NULL DEFAULT 'Roadmap',
  roadmap_body text NOT NULL DEFAULT 'The roadmap is managed by the BestCity Market team and updated as milestones ship.',
  features_title text NOT NULL DEFAULT 'Platform features',
  features_body text NOT NULL DEFAULT 'A trust-first commerce system built for repeat buying, accountable selling, and transparent settlement.',
  team_title text NOT NULL DEFAULT 'Team',
  team_body text NOT NULL DEFAULT 'The people building operations, trust, product, engineering, and growth for BestCity Market.',
  faq_title text NOT NULL DEFAULT 'Frequently asked questions',
  faq_body text NOT NULL DEFAULT 'Answers to common questions about BestCity Market, escrow, verification, demos, and support.',
  demo_title text NOT NULL DEFAULT 'Product demo',
  demo_body text NOT NULL DEFAULT 'Watch official BestCity Market demos hosted from this website. Admins can upload and publish new demo videos at any time.',
  demo_cta_label text NOT NULL DEFAULT 'Open product demo',
  contact_title text NOT NULL DEFAULT 'Contact BestCity Market',
  contact_body text NOT NULL DEFAULT 'For partnerships, seller onboarding, support, or platform enquiries, contact the BestCity Market team.',
  contact_email text NOT NULL DEFAULT 'support@bestcity.market',
  contact_phone text,
  contact_address text,
  contact_cta_label text NOT NULL DEFAULT 'Contact support',
  contact_cta_route text NOT NULL DEFAULT '/market/support',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.market_landing_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_key text NOT NULL,
  eyebrow text,
  title text NOT NULL,
  body text NOT NULL,
  media_url text,
  media_storage_path text,
  cta_label text,
  cta_url text,
  sort_order integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_landing_sections_active_sort_idx
  ON public.market_landing_sections (active, sort_order, created_at);

CREATE TABLE IF NOT EXISTS public.market_landing_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  icon_key text NOT NULL DEFAULT 'sparkles-outline',
  accent text NOT NULL DEFAULT '#2DD4BF',
  sort_order integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_landing_features_active_sort_idx
  ON public.market_landing_features (active, sort_order, created_at);

CREATE TABLE IF NOT EXISTS public.market_landing_roadmap (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('shipped', 'in_progress', 'planned', 'exploring')),
  target_label text,
  sort_order integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_landing_roadmap_active_sort_idx
  ON public.market_landing_roadmap (active, sort_order, created_at);

CREATE TABLE IF NOT EXISTS public.market_landing_team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  role_title text NOT NULL,
  bio text,
  image_url text,
  image_storage_path text,
  social_url text,
  sort_order integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_landing_team_active_sort_idx
  ON public.market_landing_team_members (active, sort_order, created_at);

CREATE TABLE IF NOT EXISTS public.market_landing_faqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question text NOT NULL,
  answer text NOT NULL,
  sort_order integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_landing_faqs_active_sort_idx
  ON public.market_landing_faqs (active, sort_order, created_at);

CREATE TABLE IF NOT EXISTS public.market_landing_demo_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  video_url text,
  video_storage_path text,
  thumbnail_url text,
  thumbnail_storage_path text,
  sort_order integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_landing_demo_videos_active_sort_idx
  ON public.market_landing_demo_videos (active, sort_order, created_at);

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'market_landing_config',
    'market_landing_sections',
    'market_landing_features',
    'market_landing_roadmap',
    'market_landing_team_members',
    'market_landing_faqs',
    'market_landing_demo_videos'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_' || table_name || '_touch_updated_at', table_name);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.market_landing_touch_updated_at()',
      'trg_' || table_name || '_touch_updated_at',
      table_name
    );
  END LOOP;
END;
$$;

INSERT INTO public.market_landing_config (id)
VALUES (true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.market_landing_features (title, body, icon_key, accent, sort_order)
VALUES
  ('Verified storefronts', 'Seller profiles, trust checks, and visible business information help buyers understand who they are trading with.', 'shield-checkmark-outline', '#38BDF8', 10),
  ('Escrow-protected orders', 'BestCity Market holds order value while buyers and sellers move through fulfillment, delivery, review, release, refund, or dispute workflows.', 'lock-closed-outline', '#22C55E', 20),
  ('Social commerce', 'Stores can publish updates and media so discovery feels alive instead of anonymous.', 'chatbubbles-outline', '#F59E0B', 30),
  ('Rewards and referrals', 'Noms rewards, campaigns, referrals, and promoted placements help grow healthy activity across the marketplace.', 'gift-outline', '#F97316', 40),
  ('Store stock identities', 'Eligible sellers can create stock identities that make store ownership and activity visible on supported blockchain rails.', 'trending-up-outline', '#2DD4BF', 50),
  ('Admin-backed trust operations', 'Support, dispute review, verification, moderation, and settlement controls help the platform respond when something needs human judgment.', 'people-outline', '#A78BFA', 60)
ON CONFLICT DO NOTHING;

INSERT INTO public.market_landing_roadmap (title, body, status, target_label, sort_order)
VALUES
  ('Core marketplace foundation', 'Listings, seller profiles, search, checkout, escrow states, support, and notifications.', 'shipped', 'Foundation', 10),
  ('Trust and verification expansion', 'Richer seller verification, public trust signals, dispute workflows, and policy-managed marketplace guidance.', 'in_progress', 'Trust layer', 20),
  ('Stock identity rails', 'Store-backed stock identities, trading controls, reinvestment tracking, liquidity tools, and public market analytics.', 'in_progress', 'Blockchain rails', 30),
  ('Public company website and demos', 'A web-first public landing experience with live metrics, admin-managed content, and hosted product demos.', 'planned', 'Public site', 40)
ON CONFLICT DO NOTHING;

INSERT INTO public.market_landing_sections (section_key, eyebrow, title, body, sort_order)
VALUES
  ('overview', 'Company overview', 'A market built around trust, settlement, and seller growth', 'BestCity Market is designed as a full commerce operating system: buyers discover listings and stores, sellers build visible storefronts, and the platform supports escrow, disputes, verification, rewards, and stock-market infrastructure.', 10),
  ('mission', 'Mission and vision', 'Safer commerce for buyers and stronger tools for sellers', 'The company exists to make digital trade feel accountable from the first search to the final payout. The long-term vision is a market where reputation, settlement records, and ownership signals can travel with users as they grow.', 20),
  ('blockchain', 'Blockchain choice', 'Transparent rails where transparency actually helps', 'BestCity Market uses blockchain where it can improve auditability, programmable settlement, store ownership, and stock-market activity. Everyday buying remains practical while critical financial events become easier to verify.', 30),
  ('product', 'Product', 'Marketplace, social commerce, escrow, rewards, and stock tools in one system', 'The platform combines storefronts, listings, media posts, notifications, AI-assisted support, escrow operations, seller verification, rewards, referrals, and on-chain stock identities for eligible stores.', 40)
ON CONFLICT DO NOTHING;

INSERT INTO public.market_landing_faqs (question, answer, sort_order)
VALUES
  ('Can I view this page without signing in?', 'Yes. The BestCity Market public website, platform statistics, and demo page are available on the web without requiring an account.', 10),
  ('How does BestCity Market protect buyers and sellers?', 'The platform combines verified seller profiles, escrow states, dispute review, support workflows, and transparent order history so both sides can trade with clearer accountability.', 20),
  ('Why does BestCity Market use blockchain?', 'Blockchain is used for the places where transparent settlement, programmable escrow, stock identity, and auditable market activity are valuable. The marketplace experience remains practical for everyday users.', 30),
  ('Where are demo videos hosted?', 'Demo videos are managed by admins and hosted from the current BestCity Market website or configured platform media storage. The public demo link is generated from the current deployment domain.', 40),
  ('Who can update this public website?', 'Super admins and moderation-capable admins can update landing content, media, demos, team members, FAQs, and public company information from the admin dashboard.', 50)
ON CONFLICT DO NOTHING;

ALTER TABLE public.market_landing_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_landing_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_landing_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_landing_roadmap ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_landing_team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_landing_faqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_landing_demo_videos ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'market_landing_config',
    'market_landing_sections',
    'market_landing_features',
    'market_landing_roadmap',
    'market_landing_team_members',
    'market_landing_faqs',
    'market_landing_demo_videos'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_public_select', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO anon, authenticated USING (true)',
      table_name || '_public_select',
      table_name
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_admin_insert', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.market_can_manage_landing(auth.uid()))',
      table_name || '_admin_insert',
      table_name
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_admin_update', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.market_can_manage_landing(auth.uid())) WITH CHECK (public.market_can_manage_landing(auth.uid()))',
      table_name || '_admin_update',
      table_name
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_admin_delete', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.market_can_manage_landing(auth.uid()))',
      table_name || '_admin_delete',
      table_name
    );
  END LOOP;
END;
$$;

GRANT SELECT ON public.market_landing_config TO anon, authenticated;
GRANT SELECT ON public.market_landing_sections TO anon, authenticated;
GRANT SELECT ON public.market_landing_features TO anon, authenticated;
GRANT SELECT ON public.market_landing_roadmap TO anon, authenticated;
GRANT SELECT ON public.market_landing_team_members TO anon, authenticated;
GRANT SELECT ON public.market_landing_faqs TO anon, authenticated;
GRANT SELECT ON public.market_landing_demo_videos TO anon, authenticated;

GRANT INSERT, UPDATE, DELETE ON public.market_landing_config TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.market_landing_sections TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.market_landing_features TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.market_landing_roadmap TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.market_landing_team_members TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.market_landing_faqs TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.market_landing_demo_videos TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('market-landing', 'market-landing', true, 524288000)
ON CONFLICT (id) DO UPDATE
SET
  public = true,
  file_size_limit = 524288000;

DROP POLICY IF EXISTS market_landing_objects_select ON storage.objects;
CREATE POLICY market_landing_objects_select
ON storage.objects
FOR SELECT TO anon, authenticated
USING (bucket_id = 'market-landing');

DROP POLICY IF EXISTS market_landing_objects_insert_admin ON storage.objects;
CREATE POLICY market_landing_objects_insert_admin
ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'market-landing'
  AND public.market_can_manage_landing(auth.uid())
);

DROP POLICY IF EXISTS market_landing_objects_update_admin ON storage.objects;
CREATE POLICY market_landing_objects_update_admin
ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'market-landing'
  AND public.market_can_manage_landing(auth.uid())
)
WITH CHECK (
  bucket_id = 'market-landing'
  AND public.market_can_manage_landing(auth.uid())
);

DROP POLICY IF EXISTS market_landing_objects_delete_admin ON storage.objects;
CREATE POLICY market_landing_objects_delete_admin
ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'market-landing'
  AND public.market_can_manage_landing(auth.uid())
);

CREATE OR REPLACE FUNCTION public.market_public_platform_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start timestamptz := date_trunc('day', now());
  v_total_users bigint := 0;
  v_verified_users bigint := 0;
  v_total_orders bigint := 0;
  v_completed_orders bigint := 0;
  v_total_transactions bigint := 0;
  v_daily_transaction_volume numeric := 0;
  v_total_trading_volume numeric := 0;
  v_total_stock_volume numeric := 0;
  v_total_stock_reinvestment_fees numeric := 0;
  v_total_escrow_locked numeric := 0;
  v_total_payouts numeric := 0;
  v_total_disputes bigint := 0;
  v_open_disputes bigint := 0;
  v_active_listings bigint := 0;
  v_active_sellers bigint := 0;
  v_stock_identities bigint := 0;
  v_reviews bigint := 0;
BEGIN
  SELECT COUNT(*) INTO v_total_users FROM public.profiles;

  SELECT COUNT(DISTINCT user_id) INTO v_verified_users
  FROM (
    SELECT user_id
    FROM public.market_seller_profiles
    WHERE is_verified = true
    UNION
    SELECT user_id
    FROM public.market_verification_requests
    WHERE status::text IN ('VERIFIED', 'APPROVED')
  ) verified;

  SELECT COUNT(*) INTO v_total_orders FROM public.market_orders;
  SELECT COUNT(*) INTO v_completed_orders FROM public.market_orders WHERE status::text = 'RELEASED';
  SELECT COUNT(*) INTO v_total_transactions FROM public.market_transaction_history;

  SELECT COALESCE(SUM(ABS(amount)), 0) INTO v_daily_transaction_volume
  FROM public.market_transaction_history
  WHERE occurred_at >= v_start;

  SELECT COALESCE(SUM(amount + COALESCE(fee_amount, 0)), 0) INTO v_total_trading_volume
  FROM public.market_orders
  WHERE status::text IN ('IN_ESCROW', 'OUT_FOR_DELIVERY', 'DELIVERABLE_UPLOADED', 'DELIVERED', 'RELEASED');

  SELECT COALESCE(SUM(notional_usdc), 0) INTO v_total_stock_volume
  FROM public.market_stock_trades;

  SELECT COALESCE(SUM(gross_usdc), 0) INTO v_total_stock_reinvestment_fees
  FROM public.market_stock_reinvestments
  WHERE status IN ('queued', 'submitted', 'confirmed');

  SELECT COALESCE(SUM(amount + COALESCE(fee_amount, 0)), 0) INTO v_total_escrow_locked
  FROM public.market_orders
  WHERE status::text IN ('IN_ESCROW', 'OUT_FOR_DELIVERY', 'DELIVERABLE_UPLOADED', 'DELIVERED', 'DISPUTED');

  SELECT
    COALESCE((SELECT SUM(amount) FROM public.market_orders WHERE status::text = 'RELEASED'), 0)
    + COALESCE((SELECT SUM(amount_usd_snapshot) FROM public.market_stock_pi_payouts WHERE status = 'CONFIRMED'), 0)
  INTO v_total_payouts;

  SELECT COUNT(*) INTO v_total_disputes FROM public.market_disputes;
  SELECT COUNT(*) INTO v_open_disputes FROM public.market_disputes WHERE status::text IN ('OPEN', 'UNDER_REVIEW');
  SELECT COUNT(*) INTO v_active_listings FROM public.market_listings WHERE is_active = true;
  SELECT COUNT(*) INTO v_active_sellers FROM public.market_seller_profiles WHERE active = true;
  SELECT COUNT(*) INTO v_stock_identities FROM public.market_stock_identities WHERE active = true;
  SELECT COUNT(*) INTO v_reviews FROM public.market_listing_reviews;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'total_users', v_total_users,
    'total_verified_users', v_verified_users,
    'total_orders', v_total_orders,
    'total_transactions', v_total_transactions,
    'daily_transaction_volume', v_daily_transaction_volume,
    'total_trading_volume', v_total_trading_volume,
    'total_stock_volume', v_total_stock_volume,
    'total_stock_reinvestment_fees', v_total_stock_reinvestment_fees,
    'total_value_locked_in_escrow', v_total_escrow_locked,
    'total_payouts_made', v_total_payouts,
    'number_of_disputes', v_total_disputes,
    'open_disputes', v_open_disputes,
    'number_of_completed_orders', v_completed_orders,
    'active_listings', v_active_listings,
    'active_sellers', v_active_sellers,
    'stock_identities', v_stock_identities,
    'listing_reviews', v_reviews
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.market_public_platform_stats() TO anon, authenticated;

COMMIT;
