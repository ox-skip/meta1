BEGIN;

CREATE TABLE IF NOT EXISTS public.market_reward_accounts (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  balance integer NOT NULL DEFAULT 0 CHECK (balance >= 0),
  lifetime_earned integer NOT NULL DEFAULT 0 CHECK (lifetime_earned >= 0),
  lifetime_spent integer NOT NULL DEFAULT 0 CHECK (lifetime_spent >= 0),
  tier_key text NOT NULL DEFAULT 'starter',
  daily_streak integer NOT NULL DEFAULT 0 CHECK (daily_streak >= 0),
  longest_streak integer NOT NULL DEFAULT 0 CHECK (longest_streak >= 0),
  last_earned_at timestamptz,
  last_spent_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.market_reward_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_key text NOT NULL UNIQUE CHECK (task_key ~ '^[a-z0-9_:-]{3,80}$'),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 3 AND 140),
  description text,
  category text NOT NULL CHECK (category IN ('watch', 'market', 'social', 'onchain', 'custom')),
  trigger_type text NOT NULL DEFAULT 'client_claim' CHECK (trigger_type IN ('client_claim', 'system_event', 'admin_review', 'ad_reward', 'manual_adjustment')),
  reward_noms integer NOT NULL DEFAULT 0 CHECK (reward_noms >= 0 AND reward_noms <= 1000000),
  cooldown_seconds integer NOT NULL DEFAULT 0 CHECK (cooldown_seconds >= 0),
  daily_cap integer CHECK (daily_cap IS NULL OR daily_cap >= 1),
  weekly_cap integer CHECK (weekly_cap IS NULL OR weekly_cap >= 1),
  lifetime_cap integer CHECK (lifetime_cap IS NULL OR lifetime_cap >= 1),
  requires_review boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  starts_at timestamptz,
  ends_at timestamptz,
  sort_order integer NOT NULL DEFAULT 100,
  action_route text,
  icon text,
  accent text,
  rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  ui jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.profiles(id),
  updated_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS market_reward_tasks_active_idx
  ON public.market_reward_tasks (active, category, sort_order, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS public.market_reward_task_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES public.market_reward_tasks(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rewarded', 'rejected', 'expired')),
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_event_id uuid,
  ledger_id uuid,
  idempotency_key text,
  reviewed_by uuid REFERENCES public.profiles(id),
  review_note text,
  completed_at timestamptz,
  rewarded_at timestamptz,
  rejected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT market_reward_task_completions_user_task_key_uidx UNIQUE (user_id, task_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS market_reward_task_completions_user_idx
  ON public.market_reward_task_completions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS market_reward_task_completions_task_status_idx
  ON public.market_reward_task_completions (task_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.market_reward_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text UNIQUE,
  event_type text NOT NULL CHECK (char_length(btrim(event_type)) BETWEEN 3 AND 100),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  entity_type text,
  entity_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_reward_events_user_type_idx
  ON public.market_reward_events (user_id, event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS public.market_reward_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  task_id uuid REFERENCES public.market_reward_tasks(id) ON DELETE SET NULL,
  completion_id uuid REFERENCES public.market_reward_task_completions(id) ON DELETE SET NULL,
  delta integer NOT NULL CHECK (delta <> 0),
  balance_after integer NOT NULL CHECK (balance_after >= 0),
  source text NOT NULL CHECK (char_length(btrim(source)) BETWEEN 2 AND 80),
  reason text,
  entity_type text,
  entity_id text,
  idempotency_key text,
  status text NOT NULL DEFAULT 'settled' CHECK (status IN ('pending', 'settled', 'reversed', 'void')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS market_reward_ledger_idempotency_uidx
  ON public.market_reward_ledger (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS market_reward_ledger_user_created_idx
  ON public.market_reward_ledger (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS market_reward_ledger_task_created_idx
  ON public.market_reward_ledger (task_id, created_at DESC);

ALTER TABLE public.market_reward_task_completions
  DROP CONSTRAINT IF EXISTS market_reward_task_completions_ledger_fkey;

ALTER TABLE public.market_reward_task_completions
  ADD CONSTRAINT market_reward_task_completions_ledger_fkey
  FOREIGN KEY (ledger_id) REFERENCES public.market_reward_ledger(id) ON DELETE SET NULL;

ALTER TABLE public.market_reward_task_completions
  DROP CONSTRAINT IF EXISTS market_reward_task_completions_event_fkey;

ALTER TABLE public.market_reward_task_completions
  ADD CONSTRAINT market_reward_task_completions_event_fkey
  FOREIGN KEY (source_event_id) REFERENCES public.market_reward_events(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.market_reward_ad_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  task_id uuid REFERENCES public.market_reward_tasks(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'admob' CHECK (provider IN ('admob', 'google_ad_manager', 'manual')),
  platform text NOT NULL DEFAULT 'unknown',
  ad_unit_id text,
  custom_data text NOT NULL,
  provider_transaction_id text UNIQUE,
  reward_noms integer NOT NULL DEFAULT 0 CHECK (reward_noms >= 0),
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'loaded', 'shown', 'client_earned', 'verified', 'rewarded', 'rejected', 'expired')),
  failure_reason text,
  verification_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ledger_id uuid REFERENCES public.market_reward_ledger(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 minutes'),
  shown_at timestamptz,
  client_earned_at timestamptz,
  verified_at timestamptz,
  rewarded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_reward_ad_sessions_user_created_idx
  ON public.market_reward_ad_sessions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS market_reward_ad_sessions_status_idx
  ON public.market_reward_ad_sessions (status, expires_at);

CREATE TABLE IF NOT EXISTS public.market_reward_promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  placement_key text NOT NULL CHECK (placement_key ~ '^[a-z0-9_:-]{3,80}$'),
  store_id uuid REFERENCES public.market_seller_profiles(user_id) ON DELETE SET NULL,
  listing_id uuid REFERENCES public.market_listings(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 3 AND 140),
  subtitle text,
  media_url text,
  sponsor_label text NOT NULL DEFAULT 'Promoted',
  cta_label text,
  cta_route text,
  priority integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  starts_at timestamptz,
  ends_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.profiles(id),
  updated_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS market_reward_promotions_placement_idx
  ON public.market_reward_promotions (placement_key, active, priority, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS public.market_reward_promotion_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id uuid NOT NULL REFERENCES public.market_reward_promotions(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN ('impression', 'click')),
  placement_key text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_reward_promotion_events_promo_idx
  ON public.market_reward_promotion_events (promotion_id, event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS public.market_reward_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  ledger_id uuid REFERENCES public.market_reward_ledger(id) ON DELETE SET NULL,
  redemption_key text NOT NULL CHECK (redemption_key ~ '^[a-z0-9_:-]{3,80}$'),
  title text NOT NULL,
  cost_noms integer NOT NULL CHECK (cost_noms > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'fulfilled', 'rejected', 'cancelled')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  fulfilled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_reward_redemptions_user_idx
  ON public.market_reward_redemptions (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.market_reward_config (
  key text PRIMARY KEY CHECK (key ~ '^[a-z0-9_:-]{3,80}$'),
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  public_read boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.market_reward_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_market_reward_accounts_touch ON public.market_reward_accounts;
CREATE TRIGGER trg_market_reward_accounts_touch
BEFORE UPDATE ON public.market_reward_accounts
FOR EACH ROW EXECUTE FUNCTION public.market_reward_touch_updated_at();

DROP TRIGGER IF EXISTS trg_market_reward_tasks_touch ON public.market_reward_tasks;
CREATE TRIGGER trg_market_reward_tasks_touch
BEFORE UPDATE ON public.market_reward_tasks
FOR EACH ROW EXECUTE FUNCTION public.market_reward_touch_updated_at();

DROP TRIGGER IF EXISTS trg_market_reward_task_completions_touch ON public.market_reward_task_completions;
CREATE TRIGGER trg_market_reward_task_completions_touch
BEFORE UPDATE ON public.market_reward_task_completions
FOR EACH ROW EXECUTE FUNCTION public.market_reward_touch_updated_at();

DROP TRIGGER IF EXISTS trg_market_reward_ad_sessions_touch ON public.market_reward_ad_sessions;
CREATE TRIGGER trg_market_reward_ad_sessions_touch
BEFORE UPDATE ON public.market_reward_ad_sessions
FOR EACH ROW EXECUTE FUNCTION public.market_reward_touch_updated_at();

DROP TRIGGER IF EXISTS trg_market_reward_promotions_touch ON public.market_reward_promotions;
CREATE TRIGGER trg_market_reward_promotions_touch
BEFORE UPDATE ON public.market_reward_promotions
FOR EACH ROW EXECUTE FUNCTION public.market_reward_touch_updated_at();

DROP TRIGGER IF EXISTS trg_market_reward_redemptions_touch ON public.market_reward_redemptions;
CREATE TRIGGER trg_market_reward_redemptions_touch
BEFORE UPDATE ON public.market_reward_redemptions
FOR EACH ROW EXECUTE FUNCTION public.market_reward_touch_updated_at();

DROP TRIGGER IF EXISTS trg_market_reward_config_touch ON public.market_reward_config;
CREATE TRIGGER trg_market_reward_config_touch
BEFORE UPDATE ON public.market_reward_config
FOR EACH ROW EXECUTE FUNCTION public.market_reward_touch_updated_at();

CREATE OR REPLACE FUNCTION public.market_reward_ensure_account(p_user_id uuid)
RETURNS public.market_reward_accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account public.market_reward_accounts%ROWTYPE;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id required';
  END IF;

  INSERT INTO public.market_reward_accounts (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_account
  FROM public.market_reward_accounts
  WHERE user_id = p_user_id;

  RETURN v_account;
END;
$$;

CREATE OR REPLACE FUNCTION public.market_reward_credit(
  p_user_id uuid,
  p_amount integer,
  p_source text,
  p_reason text DEFAULT NULL,
  p_task_id uuid DEFAULT NULL,
  p_completion_id uuid DEFAULT NULL,
  p_entity_type text DEFAULT NULL,
  p_entity_id text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_created_by uuid DEFAULT NULL
)
RETURNS TABLE(ledger_id uuid, balance integer, delta integer, created_at timestamptz, duplicate boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance integer;
  v_ledger public.market_reward_ledger%ROWTYPE;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id required';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'credit amount must be positive';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_ledger
    FROM public.market_reward_ledger
    WHERE idempotency_key = p_idempotency_key
    LIMIT 1;

    IF FOUND THEN
      ledger_id := v_ledger.id;
      balance := v_ledger.balance_after;
      delta := v_ledger.delta;
      created_at := v_ledger.created_at;
      duplicate := true;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  BEGIN
    PERFORM public.market_reward_ensure_account(p_user_id);

    UPDATE public.market_reward_accounts AS account
    SET
      balance = account.balance + p_amount,
      lifetime_earned = account.lifetime_earned + p_amount,
      last_earned_at = now(),
      updated_at = now()
    WHERE account.user_id = p_user_id
    RETURNING account.balance INTO v_balance;

    INSERT INTO public.market_reward_ledger (
      user_id,
      task_id,
      completion_id,
      delta,
      balance_after,
      source,
      reason,
      entity_type,
      entity_id,
      idempotency_key,
      metadata,
      created_by
    )
    VALUES (
      p_user_id,
      p_task_id,
      p_completion_id,
      p_amount,
      v_balance,
      p_source,
      p_reason,
      p_entity_type,
      p_entity_id,
      p_idempotency_key,
      COALESCE(p_metadata, '{}'::jsonb),
      p_created_by
    )
    RETURNING * INTO v_ledger;

    ledger_id := v_ledger.id;
    balance := v_balance;
    delta := p_amount;
    created_at := v_ledger.created_at;
    duplicate := false;
    RETURN NEXT;
  EXCEPTION WHEN unique_violation THEN
    IF p_idempotency_key IS NULL THEN
      RAISE;
    END IF;

    SELECT * INTO v_ledger
    FROM public.market_reward_ledger
    WHERE idempotency_key = p_idempotency_key
    LIMIT 1;

    ledger_id := v_ledger.id;
    balance := v_ledger.balance_after;
    delta := v_ledger.delta;
    created_at := v_ledger.created_at;
    duplicate := true;
    RETURN NEXT;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.market_reward_debit(
  p_user_id uuid,
  p_amount integer,
  p_source text,
  p_reason text DEFAULT NULL,
  p_entity_type text DEFAULT NULL,
  p_entity_id text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_created_by uuid DEFAULT NULL
)
RETURNS TABLE(ledger_id uuid, balance integer, delta integer, created_at timestamptz, duplicate boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance integer;
  v_ledger public.market_reward_ledger%ROWTYPE;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id required';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'debit amount must be positive';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_ledger
    FROM public.market_reward_ledger
    WHERE idempotency_key = p_idempotency_key
    LIMIT 1;

    IF FOUND THEN
      ledger_id := v_ledger.id;
      balance := v_ledger.balance_after;
      delta := v_ledger.delta;
      created_at := v_ledger.created_at;
      duplicate := true;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  BEGIN
    PERFORM public.market_reward_ensure_account(p_user_id);

    UPDATE public.market_reward_accounts AS account
    SET
      balance = account.balance - p_amount,
      lifetime_spent = account.lifetime_spent + p_amount,
      last_spent_at = now(),
      updated_at = now()
    WHERE account.user_id = p_user_id
      AND account.balance >= p_amount
    RETURNING account.balance INTO v_balance;

    IF v_balance IS NULL THEN
      RAISE EXCEPTION 'insufficient noms balance';
    END IF;

    INSERT INTO public.market_reward_ledger (
      user_id,
      delta,
      balance_after,
      source,
      reason,
      entity_type,
      entity_id,
      idempotency_key,
      metadata,
      created_by
    )
    VALUES (
      p_user_id,
      -p_amount,
      v_balance,
      p_source,
      p_reason,
      p_entity_type,
      p_entity_id,
      p_idempotency_key,
      COALESCE(p_metadata, '{}'::jsonb),
      p_created_by
    )
    RETURNING * INTO v_ledger;

    ledger_id := v_ledger.id;
    balance := v_balance;
    delta := -p_amount;
    created_at := v_ledger.created_at;
    duplicate := false;
    RETURN NEXT;
  EXCEPTION WHEN unique_violation THEN
    IF p_idempotency_key IS NULL THEN
      RAISE;
    END IF;

    SELECT * INTO v_ledger
    FROM public.market_reward_ledger
    WHERE idempotency_key = p_idempotency_key
    LIMIT 1;

    ledger_id := v_ledger.id;
    balance := v_ledger.balance_after;
    delta := v_ledger.delta;
    created_at := v_ledger.created_at;
    duplicate := true;
    RETURN NEXT;
  END;
END;
$$;

INSERT INTO public.market_admin_roles (key, name, description, permissions, rank)
VALUES (
  'reward_admin',
  'Reward Admin',
  'Manages noms, reward tasks, sponsored placements, reviews, and balance adjustments.',
  '["rewards.read","rewards.tasks.manage","rewards.promotions.manage","rewards.adjust","rewards.review","rewards.analytics"]'::jsonb,
  25
)
ON CONFLICT (key) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  permissions = EXCLUDED.permissions,
  rank = EXCLUDED.rank,
  updated_at = now();

UPDATE public.market_admin_roles
SET
  permissions = (
    SELECT jsonb_agg(value ORDER BY value)
    FROM (
      SELECT DISTINCT value
      FROM jsonb_array_elements_text(
        COALESCE(permissions, '[]'::jsonb) ||
        '["rewards.read","rewards.tasks.manage","rewards.promotions.manage","rewards.adjust","rewards.review","rewards.analytics"]'::jsonb
      ) AS p(value)
    ) AS merged
  ),
  updated_at = now()
WHERE key = 'super_admin';

INSERT INTO public.market_reward_tasks (
  task_key,
  title,
  description,
  category,
  trigger_type,
  reward_noms,
  cooldown_seconds,
  daily_cap,
  weekly_cap,
  lifetime_cap,
  requires_review,
  sort_order,
  action_route,
  icon,
  accent,
  rules,
  ui
)
VALUES
  (
    'watch_rewarded_video',
    'Watch a sponsored video',
    'Watch a short sponsored video and earn noms when it finishes.',
    'watch',
    'ad_reward',
    8,
    900,
    5,
    25,
    NULL,
    false,
    10,
    NULL,
    'videocam-outline',
    '#38BDF8',
    '{"provider":"admob","requires_ssv":true}'::jsonb,
    '{"tone":"gold","badge":"Daily","primaryLabel":"Watch"}'::jsonb
  ),
  (
    'create_store_profile',
    'Open your store',
    'Create your public store profile so buyers can recognize and trust you.',
    'market',
    'client_claim',
    80,
    0,
    NULL,
    NULL,
    1,
    false,
    20,
    '/market/profile/create',
    'person-add-outline',
    '#F59E0B',
    '{"check":"seller_profile_exists"}'::jsonb,
    '{"badge":"Starter","primaryLabel":"Create profile"}'::jsonb
  ),
  (
    'complete_store_profile',
    'Make your store stand out',
    'Add your logo, bio, location, contact, and delivery details.',
    'market',
    'client_claim',
    120,
    0,
    NULL,
    NULL,
    1,
    false,
    30,
    '/market/profile/edit',
    'storefront-outline',
    '#F97316',
    '{"check":"seller_profile_complete","min_fields":6}'::jsonb,
    '{"badge":"Trust","primaryLabel":"Finish profile"}'::jsonb
  ),
  (
    'publish_first_listing',
    'List your first item',
    'Add a product or service buyers can discover in the marketplace.',
    'market',
    'client_claim',
    150,
    0,
    NULL,
    NULL,
    1,
    false,
    40,
    '/market/(tabs)/sell',
    'add-circle-outline',
    '#FBBF24',
    '{"check":"active_listing_count","min":1}'::jsonb,
    '{"badge":"Seller","primaryLabel":"Create listing"}'::jsonb
  ),
  (
    'first_purchase_completed',
    'Make your first purchase',
    'Complete one marketplace order as a buyer.',
    'market',
    'client_claim',
    200,
    0,
    NULL,
    NULL,
    1,
    false,
    50,
    '/market/(tabs)',
    'bag-check-outline',
    '#4ADE80',
    '{"check":"buyer_released_order_count","min":1}'::jsonb,
    '{"badge":"Buyer","primaryLabel":"Shop"}'::jsonb
  ),
  (
    'first_sale_completed',
    'Make your first sale',
    'Complete one marketplace order as a seller.',
    'market',
    'client_claim',
    240,
    0,
    NULL,
    NULL,
    1,
    false,
    60,
    '/market/(tabs)/orders',
    'receipt-outline',
    '#22C55E',
    '{"check":"seller_released_order_count","min":1}'::jsonb,
    '{"badge":"Seller","primaryLabel":"View orders"}'::jsonb
  ),
  (
    'follow_first_store',
    'Follow a store',
    'Follow a seller you want to keep up with.',
    'social',
    'client_claim',
    40,
    0,
    NULL,
    NULL,
    1,
    false,
    70,
    '/market/social',
    'people-outline',
    '#A78BFA',
    '{"check":"follow_count","min":1}'::jsonb,
    '{"badge":"Social","primaryLabel":"Find stores"}'::jsonb
  ),
  (
    'create_social_post',
    'Share a market update',
    'Post a launch, find, or update in the market feed.',
    'social',
    'client_claim',
    60,
    3600,
    3,
    12,
    NULL,
    false,
    80,
    '/market/social',
    'newspaper-outline',
    '#C084FC',
    '{"check":"social_post_count","min":1,"period":"all_time"}'::jsonb,
    '{"badge":"Social","primaryLabel":"Post"}'::jsonb
  ),
  (
    'create_stock_identity',
    'Launch your store stock',
    'Create your store stock profile for the stock market.',
    'onchain',
    'client_claim',
    350,
    0,
    NULL,
    NULL,
    1,
    false,
    90,
    '/market/stock/create',
    'trending-up-outline',
    '#2DD4BF',
    '{"check":"stock_identity_exists"}'::jsonb,
    '{"badge":"Growth","primaryLabel":"Create stock"}'::jsonb
  ),
  (
    'buy_store_stock',
    'Buy store stock',
    'Support a store by buying its digital stock.',
    'onchain',
    'client_claim',
    75,
    3600,
    3,
    12,
    NULL,
    false,
    100,
    '/market/stock',
    'arrow-up-circle-outline',
    '#14B8A6',
    '{"check":"stock_trade_count","side":"buy","min":1}'::jsonb,
    '{"badge":"Trade","primaryLabel":"Buy stock"}'::jsonb
  ),
  (
    'sell_store_stock',
    'Sell store stock',
    'Complete a sell trade from your stock portfolio.',
    'onchain',
    'client_claim',
    75,
    3600,
    3,
    12,
    NULL,
    false,
    110,
    '/market/stock/portfolio',
    'arrow-down-circle-outline',
    '#0EA5E9',
    '{"check":"stock_trade_count","side":"sell","min":1}'::jsonb,
    '{"badge":"Trade","primaryLabel":"Portfolio"}'::jsonb
  ),
  (
    'custom_campaign_review',
    'Bonus challenge',
    'Complete a featured marketplace challenge and submit proof.',
    'custom',
    'admin_review',
    0,
    0,
    NULL,
    NULL,
    NULL,
    true,
    900,
    NULL,
    'sparkles-outline',
    '#F472B6',
    '{"check":"admin_review"}'::jsonb,
    '{"badge":"Bonus","primaryLabel":"Submit proof"}'::jsonb
  )
ON CONFLICT (task_key) DO UPDATE
SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  trigger_type = EXCLUDED.trigger_type,
  reward_noms = EXCLUDED.reward_noms,
  cooldown_seconds = EXCLUDED.cooldown_seconds,
  daily_cap = EXCLUDED.daily_cap,
  weekly_cap = EXCLUDED.weekly_cap,
  lifetime_cap = EXCLUDED.lifetime_cap,
  requires_review = EXCLUDED.requires_review,
  sort_order = EXCLUDED.sort_order,
  action_route = EXCLUDED.action_route,
  icon = EXCLUDED.icon,
  accent = EXCLUDED.accent,
  rules = EXCLUDED.rules,
  ui = EXCLUDED.ui,
  updated_at = now();

INSERT INTO public.market_reward_config (key, value, public_read)
VALUES
  (
    'noms_economy',
    '{
      "name":"noms",
      "transferable":false,
      "cash_out":false,
      "onchain":false,
      "daily_ad_cap":5,
      "history_limit":50,
      "tiers":[
        {"key":"starter","label":"Starter","min":0},
        {"key":"rising","label":"Rising Seller","min":1000},
        {"key":"trusted","label":"Trusted Market Pro","min":5000},
        {"key":"elite","label":"Elite Operator","min":15000}
      ],
      "redemption_catalog":[
        {"key":"listing_boost","title":"Listing Boost","subtitle":"Give one listing a stronger spotlight in buyer discovery.","cost_noms":750,"icon":"rocket-outline","accent":"#2DD4BF"},
        {"key":"sponsored_top_display","title":"Sponsored Top Display","subtitle":"Put your store in a premium rewards placement for shoppers to notice.","cost_noms":2500,"icon":"megaphone-outline","accent":"#F4B75D"},
        {"key":"profile_glow","title":"Profile Glow","subtitle":"Add a premium look to your store profile when this reward opens.","cost_noms":1200,"icon":"diamond-outline","accent":"#A78BFA"}
      ]
    }'::jsonb,
    true
  ),
  (
    'rewards_ui',
    '{
      "hero_title":"Noms Rewards",
      "hero_subtitle":"Earn noms for videos, store activity, shopping, social actions, and stock milestones.",
      "empty_promotion_title":"Featured stores",
      "empty_promotion_subtitle":"Sponsored stores and special offers can appear here."
    }'::jsonb,
    true
  )
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value, public_read = EXCLUDED.public_read, updated_at = now();

ALTER TABLE public.market_reward_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_reward_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_reward_task_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_reward_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_reward_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_reward_ad_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_reward_promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_reward_promotion_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_reward_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_reward_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS market_reward_accounts_select_self ON public.market_reward_accounts;
CREATE POLICY market_reward_accounts_select_self
ON public.market_reward_accounts
FOR SELECT
TO authenticated
USING (auth.uid() = user_id OR public.market_admin_has_permission(auth.uid(), 'rewards.read'));

DROP POLICY IF EXISTS market_reward_tasks_select_active ON public.market_reward_tasks;
CREATE POLICY market_reward_tasks_select_active
ON public.market_reward_tasks
FOR SELECT
TO anon, authenticated
USING (
  active = true
  AND (starts_at IS NULL OR starts_at <= now())
  AND (ends_at IS NULL OR ends_at > now())
);

DROP POLICY IF EXISTS market_reward_tasks_select_admin ON public.market_reward_tasks;
CREATE POLICY market_reward_tasks_select_admin
ON public.market_reward_tasks
FOR SELECT
TO authenticated
USING (public.market_admin_has_permission(auth.uid(), 'rewards.read'));

DROP POLICY IF EXISTS market_reward_completions_select_self ON public.market_reward_task_completions;
CREATE POLICY market_reward_completions_select_self
ON public.market_reward_task_completions
FOR SELECT
TO authenticated
USING (auth.uid() = user_id OR public.market_admin_has_permission(auth.uid(), 'rewards.review'));

DROP POLICY IF EXISTS market_reward_events_select_self ON public.market_reward_events;
CREATE POLICY market_reward_events_select_self
ON public.market_reward_events
FOR SELECT
TO authenticated
USING (auth.uid() = user_id OR auth.uid() = actor_id OR public.market_admin_has_permission(auth.uid(), 'rewards.read'));

DROP POLICY IF EXISTS market_reward_ledger_select_self ON public.market_reward_ledger;
CREATE POLICY market_reward_ledger_select_self
ON public.market_reward_ledger
FOR SELECT
TO authenticated
USING (auth.uid() = user_id OR public.market_admin_has_permission(auth.uid(), 'rewards.read'));

DROP POLICY IF EXISTS market_reward_ad_sessions_select_self ON public.market_reward_ad_sessions;
CREATE POLICY market_reward_ad_sessions_select_self
ON public.market_reward_ad_sessions
FOR SELECT
TO authenticated
USING (auth.uid() = user_id OR public.market_admin_has_permission(auth.uid(), 'rewards.read'));

DROP POLICY IF EXISTS market_reward_promotions_select_public ON public.market_reward_promotions;
CREATE POLICY market_reward_promotions_select_public
ON public.market_reward_promotions
FOR SELECT
TO anon, authenticated
USING (
  active = true
  AND (starts_at IS NULL OR starts_at <= now())
  AND (ends_at IS NULL OR ends_at > now())
);

DROP POLICY IF EXISTS market_reward_promotions_select_admin ON public.market_reward_promotions;
CREATE POLICY market_reward_promotions_select_admin
ON public.market_reward_promotions
FOR SELECT
TO authenticated
USING (public.market_admin_has_permission(auth.uid(), 'rewards.promotions.manage'));

DROP POLICY IF EXISTS market_reward_promotion_events_insert_auth ON public.market_reward_promotion_events;
CREATE POLICY market_reward_promotion_events_insert_auth
ON public.market_reward_promotion_events
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

DROP POLICY IF EXISTS market_reward_promotion_events_select_admin ON public.market_reward_promotion_events;
CREATE POLICY market_reward_promotion_events_select_admin
ON public.market_reward_promotion_events
FOR SELECT
TO authenticated
USING (public.market_admin_has_permission(auth.uid(), 'rewards.analytics'));

DROP POLICY IF EXISTS market_reward_redemptions_select_self ON public.market_reward_redemptions;
CREATE POLICY market_reward_redemptions_select_self
ON public.market_reward_redemptions
FOR SELECT
TO authenticated
USING (auth.uid() = user_id OR public.market_admin_has_permission(auth.uid(), 'rewards.review'));

DROP POLICY IF EXISTS market_reward_config_select_public ON public.market_reward_config;
CREATE POLICY market_reward_config_select_public
ON public.market_reward_config
FOR SELECT
TO anon, authenticated
USING (public_read = true OR public.market_admin_has_permission(auth.uid(), 'rewards.read'));

GRANT SELECT ON public.market_reward_accounts TO authenticated;
GRANT SELECT ON public.market_reward_tasks TO anon, authenticated;
GRANT SELECT ON public.market_reward_task_completions TO authenticated;
GRANT SELECT ON public.market_reward_events TO authenticated;
GRANT SELECT ON public.market_reward_ledger TO authenticated;
GRANT SELECT ON public.market_reward_ad_sessions TO authenticated;
GRANT SELECT ON public.market_reward_promotions TO anon, authenticated;
GRANT SELECT, INSERT ON public.market_reward_promotion_events TO authenticated;
GRANT SELECT ON public.market_reward_redemptions TO authenticated;
GRANT SELECT ON public.market_reward_config TO anon, authenticated;

GRANT ALL ON public.market_reward_accounts TO service_role;
GRANT ALL ON public.market_reward_tasks TO service_role;
GRANT ALL ON public.market_reward_task_completions TO service_role;
GRANT ALL ON public.market_reward_events TO service_role;
GRANT ALL ON public.market_reward_ledger TO service_role;
GRANT ALL ON public.market_reward_ad_sessions TO service_role;
GRANT ALL ON public.market_reward_promotions TO service_role;
GRANT ALL ON public.market_reward_promotion_events TO service_role;
GRANT ALL ON public.market_reward_redemptions TO service_role;
GRANT ALL ON public.market_reward_config TO service_role;

REVOKE ALL ON FUNCTION public.market_reward_ensure_account(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.market_reward_credit(uuid, integer, text, text, uuid, uuid, text, text, text, jsonb, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.market_reward_debit(uuid, integer, text, text, text, text, text, jsonb, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.market_reward_ensure_account(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.market_reward_credit(uuid, integer, text, text, uuid, uuid, text, text, text, jsonb, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.market_reward_debit(uuid, integer, text, text, text, text, text, jsonb, uuid) TO service_role;

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.market_reward_accounts;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.market_reward_ledger;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.market_reward_task_completions;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.market_reward_tasks;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.market_reward_promotions;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

COMMIT;
