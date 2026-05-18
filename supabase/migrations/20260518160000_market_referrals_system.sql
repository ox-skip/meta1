BEGIN;

CREATE TABLE IF NOT EXISTS public.market_referral_codes (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{6,16}$'),
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_referral_codes_active_idx
  ON public.market_referral_codes (active, code);

CREATE TABLE IF NOT EXISTS public.market_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  referred_user_id uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  referral_code text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'qualified', 'rewarded', 'rejected', 'void')),
  joiner_ledger_id uuid REFERENCES public.market_reward_ledger(id) ON DELETE SET NULL,
  referrer_ledger_id uuid REFERENCES public.market_reward_ledger(id) ON DELETE SET NULL,
  joiner_reward_noms integer NOT NULL DEFAULT 25 CHECK (joiner_reward_noms >= 0),
  referrer_reward_noms integer NOT NULL DEFAULT 5 CHECK (referrer_reward_noms >= 0),
  bot_score integer NOT NULL DEFAULT 0 CHECK (bot_score >= 0),
  bot_signals jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_hash text,
  user_agent_hash text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  qualified_at timestamptz,
  rewarded_at timestamptz,
  rejected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (referrer_id <> referred_user_id)
);

CREATE INDEX IF NOT EXISTS market_referrals_referrer_status_idx
  ON public.market_referrals (referrer_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS market_referrals_status_created_idx
  ON public.market_referrals (status, created_at DESC);

CREATE INDEX IF NOT EXISTS market_referrals_ip_hash_idx
  ON public.market_referrals (ip_hash)
  WHERE ip_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS market_referrals_user_agent_hash_idx
  ON public.market_referrals (user_agent_hash)
  WHERE user_agent_hash IS NOT NULL;

DROP TRIGGER IF EXISTS trg_market_referral_codes_touch ON public.market_referral_codes;
CREATE TRIGGER trg_market_referral_codes_touch
BEFORE UPDATE ON public.market_referral_codes
FOR EACH ROW EXECUTE FUNCTION public.market_reward_touch_updated_at();

DROP TRIGGER IF EXISTS trg_market_referrals_touch ON public.market_referrals;
CREATE TRIGGER trg_market_referrals_touch
BEFORE UPDATE ON public.market_referrals
FOR EACH ROW EXECUTE FUNCTION public.market_reward_touch_updated_at();

CREATE OR REPLACE FUNCTION public.market_referral_normalize_code(p_code text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT upper(regexp_replace(coalesce(p_code, ''), '[^a-zA-Z0-9]', '', 'g'));
$$;

CREATE OR REPLACE FUNCTION public.market_referral_ensure_code(p_user_id uuid)
RETURNS public.market_referral_codes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
  v_row public.market_referral_codes%ROWTYPE;
  v_attempt integer := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id required';
  END IF;

  SELECT * INTO v_row
  FROM public.market_referral_codes
  WHERE user_id = p_user_id;

  IF FOUND THEN
    RETURN v_row;
  END IF;

  LOOP
    v_attempt := v_attempt + 1;
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

    INSERT INTO public.market_referral_codes (user_id, code)
    VALUES (p_user_id, v_code)
    ON CONFLICT DO NOTHING
    RETURNING * INTO v_row;

    IF FOUND THEN
      RETURN v_row;
    END IF;

    SELECT * INTO v_row
    FROM public.market_referral_codes
    WHERE user_id = p_user_id;

    IF FOUND THEN
      RETURN v_row;
    END IF;

    IF v_attempt >= 20 THEN
      RAISE EXCEPTION 'could not generate referral code';
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.market_referral_apply(
  p_referred_user_id uuid,
  p_code text,
  p_ip_hash text DEFAULT NULL,
  p_user_agent_hash text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
  v_code_row public.market_referral_codes%ROWTYPE;
  v_existing public.market_referrals%ROWTYPE;
  v_referral public.market_referrals%ROWTYPE;
  v_config jsonb := '{}'::jsonb;
  v_bot_filter jsonb := '{}'::jsonb;
  v_enabled boolean := true;
  v_bot_enabled boolean := true;
  v_joiner_reward integer := 25;
  v_referrer_reward integer := 5;
  v_max_ip integer := 5;
  v_max_ua integer := 10;
  v_ip_count integer := 0;
  v_ua_count integer := 0;
  v_bot_score integer := 0;
  v_bot_signals jsonb := '{}'::jsonb;
  v_now timestamptz := now();
  v_joiner_ledger_id uuid;
  v_referrer_ledger_id uuid;
  v_final_status text := 'rewarded';
BEGIN
  IF p_referred_user_id IS NULL THEN
    RAISE EXCEPTION 'p_referred_user_id required';
  END IF;

  v_code := public.market_referral_normalize_code(p_code);
  IF char_length(v_code) < 3 THEN
    RETURN jsonb_build_object('ok', false, 'status', 'invalid_code', 'message', 'Referral code is invalid.');
  END IF;

  SELECT COALESCE(value, '{}'::jsonb) INTO v_config
  FROM public.market_reward_config
  WHERE key = 'referrals';

  v_enabled := COALESCE((v_config->>'enabled')::boolean, true);
  v_joiner_reward := GREATEST(0, LEAST(1000000, COALESCE((v_config->>'joiner_reward_noms')::integer, 25)));
  v_referrer_reward := GREATEST(0, LEAST(1000000, COALESCE((v_config->>'referrer_reward_noms')::integer, 5)));
  v_bot_filter := COALESCE(v_config->'bot_filter', '{}'::jsonb);
  v_bot_enabled := COALESCE((v_bot_filter->>'enabled')::boolean, true);
  v_max_ip := GREATEST(0, COALESCE((v_bot_filter->>'max_referrals_per_ip_hash')::integer, 5));
  v_max_ua := GREATEST(0, COALESCE((v_bot_filter->>'max_referrals_per_user_agent_hash')::integer, 10));

  IF NOT v_enabled THEN
    RETURN jsonb_build_object('ok', false, 'status', 'disabled', 'message', 'Referral rewards are paused.');
  END IF;

  PERFORM public.market_referral_ensure_code(p_referred_user_id);
  PERFORM public.market_reward_ensure_account(p_referred_user_id);

  SELECT * INTO v_existing
  FROM public.market_referrals
  WHERE referred_user_id = p_referred_user_id;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'status', v_existing.status,
      'duplicate', true,
      'message', 'Referral already recorded for this account.',
      'referral_id', v_existing.id
    );
  END IF;

  SELECT * INTO v_code_row
  FROM public.market_referral_codes
  WHERE code = v_code
    AND active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'status', 'invalid_code', 'message', 'Referral code was not found.');
  END IF;

  IF v_code_row.user_id = p_referred_user_id THEN
    RETURN jsonb_build_object('ok', false, 'status', 'self_referral', 'message', 'You cannot use your own referral code.');
  END IF;

  PERFORM public.market_reward_ensure_account(v_code_row.user_id);

  IF v_bot_enabled AND p_ip_hash IS NOT NULL AND v_max_ip > 0 THEN
    SELECT COUNT(*) INTO v_ip_count
    FROM public.market_referrals
    WHERE ip_hash = p_ip_hash
      AND status IN ('pending', 'qualified', 'rewarded');

    IF v_ip_count >= v_max_ip THEN
      v_bot_score := v_bot_score + 70;
      v_bot_signals := v_bot_signals || jsonb_build_object('ip_hash_referral_count', v_ip_count, 'max_referrals_per_ip_hash', v_max_ip);
    END IF;
  END IF;

  IF v_bot_enabled AND p_user_agent_hash IS NOT NULL AND v_max_ua > 0 THEN
    SELECT COUNT(*) INTO v_ua_count
    FROM public.market_referrals
    WHERE user_agent_hash = p_user_agent_hash
      AND status IN ('pending', 'qualified', 'rewarded');

    IF v_ua_count >= v_max_ua THEN
      v_bot_score := v_bot_score + 30;
      v_bot_signals := v_bot_signals || jsonb_build_object('user_agent_hash_referral_count', v_ua_count, 'max_referrals_per_user_agent_hash', v_max_ua);
    END IF;
  END IF;

  IF v_bot_score >= 70 THEN
    INSERT INTO public.market_referrals (
      referrer_id,
      referred_user_id,
      referral_code,
      status,
      joiner_reward_noms,
      referrer_reward_noms,
      bot_score,
      bot_signals,
      ip_hash,
      user_agent_hash,
      metadata,
      rejected_at
    )
    VALUES (
      v_code_row.user_id,
      p_referred_user_id,
      v_code,
      'rejected',
      v_joiner_reward,
      v_referrer_reward,
      v_bot_score,
      v_bot_signals,
      p_ip_hash,
      p_user_agent_hash,
      COALESCE(p_metadata, '{}'::jsonb),
      v_now
    )
    ON CONFLICT (referred_user_id) DO NOTHING
    RETURNING * INTO v_referral;

    RETURN jsonb_build_object(
      'ok', false,
      'status', 'rejected',
      'message', 'Referral needs review before rewards can be issued.',
      'bot_score', v_bot_score,
      'bot_signals', v_bot_signals,
      'referral_id', v_referral.id
    );
  END IF;

  INSERT INTO public.market_referrals (
    referrer_id,
    referred_user_id,
    referral_code,
    status,
    joiner_reward_noms,
    referrer_reward_noms,
    bot_score,
    bot_signals,
    ip_hash,
    user_agent_hash,
    metadata,
    qualified_at
  )
  VALUES (
    v_code_row.user_id,
    p_referred_user_id,
    v_code,
    'qualified',
    v_joiner_reward,
    v_referrer_reward,
    v_bot_score,
    v_bot_signals,
    p_ip_hash,
    p_user_agent_hash,
    COALESCE(p_metadata, '{}'::jsonb),
    v_now
  )
  ON CONFLICT (referred_user_id) DO NOTHING
  RETURNING * INTO v_referral;

  IF NOT FOUND THEN
    SELECT * INTO v_existing
    FROM public.market_referrals
    WHERE referred_user_id = p_referred_user_id;

    RETURN jsonb_build_object(
      'ok', true,
      'status', v_existing.status,
      'duplicate', true,
      'message', 'Referral already recorded for this account.',
      'referral_id', v_existing.id
    );
  END IF;

  IF v_joiner_reward > 0 THEN
    SELECT credit.ledger_id INTO v_joiner_ledger_id
    FROM public.market_reward_credit(
      p_referred_user_id,
      v_joiner_reward,
      'referral_signup',
      'Referral signup bonus',
      NULL,
      NULL,
      'market_referral',
      v_referral.id::text,
      'referral:joiner:' || p_referred_user_id::text,
      jsonb_build_object('referral_id', v_referral.id, 'referrer_id', v_code_row.user_id, 'referral_code', v_code),
      NULL
    ) AS credit
    LIMIT 1;
  END IF;

  IF v_referrer_reward > 0 THEN
    SELECT credit.ledger_id INTO v_referrer_ledger_id
    FROM public.market_reward_credit(
      v_code_row.user_id,
      v_referrer_reward,
      'referral_invite',
      'Successful referral',
      NULL,
      NULL,
      'market_referral',
      v_referral.id::text,
      'referral:referrer:' || p_referred_user_id::text,
      jsonb_build_object('referral_id', v_referral.id, 'referred_user_id', p_referred_user_id, 'referral_code', v_code),
      NULL
    ) AS credit
    LIMIT 1;
  END IF;

  v_final_status := CASE WHEN v_joiner_reward > 0 OR v_referrer_reward > 0 THEN 'rewarded' ELSE 'qualified' END;

  UPDATE public.market_referrals
  SET
    status = v_final_status,
    joiner_ledger_id = v_joiner_ledger_id,
    referrer_ledger_id = v_referrer_ledger_id,
    rewarded_at = CASE WHEN v_final_status = 'rewarded' THEN v_now ELSE NULL END,
    updated_at = v_now
  WHERE id = v_referral.id
  RETURNING * INTO v_referral;

  RETURN jsonb_build_object(
    'ok', true,
    'status', v_final_status,
    'message', 'Referral rewards applied.',
    'referral_id', v_referral.id,
    'joiner_reward_noms', v_joiner_reward,
    'referrer_reward_noms', v_referrer_reward,
    'joiner_ledger_id', v_joiner_ledger_id,
    'referrer_ledger_id', v_referrer_ledger_id
  );
END;
$$;

CREATE OR REPLACE VIEW public.market_referral_leaderboard_v AS
SELECT
  codes.user_id,
  codes.code,
  profiles.username,
  profiles.full_name,
  profiles.public_uid,
  sellers.market_username,
  sellers.display_name,
  sellers.business_name,
  COUNT(referrals.id)::integer AS total_referrals,
  COUNT(referrals.id) FILTER (WHERE referrals.status = 'rewarded')::integer AS successful_referrals,
  COALESCE(SUM(referrals.referrer_reward_noms) FILTER (WHERE referrals.status = 'rewarded'), 0)::integer AS referral_noms_earned,
  COALESCE(accounts.balance, 0)::integer AS balance,
  COALESCE(accounts.lifetime_earned, 0)::integer AS lifetime_earned,
  MAX(referrals.rewarded_at) AS last_referral_at
FROM public.market_referral_codes AS codes
LEFT JOIN public.market_referrals AS referrals
  ON referrals.referrer_id = codes.user_id
LEFT JOIN public.market_reward_accounts AS accounts
  ON accounts.user_id = codes.user_id
LEFT JOIN public.profiles AS profiles
  ON profiles.id = codes.user_id
LEFT JOIN public.market_seller_profiles AS sellers
  ON sellers.user_id = codes.user_id
GROUP BY
  codes.user_id,
  codes.code,
  profiles.username,
  profiles.full_name,
  profiles.public_uid,
  sellers.market_username,
  sellers.display_name,
  sellers.business_name,
  accounts.balance,
  accounts.lifetime_earned;

CREATE OR REPLACE FUNCTION public.market_referral_after_profile_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_referral_code text;
BEGIN
  PERFORM public.market_referral_ensure_code(NEW.id);

  SELECT raw_user_meta_data->>'referral_code' INTO v_referral_code
  FROM auth.users
  WHERE id = NEW.id;

  IF public.market_referral_normalize_code(v_referral_code) <> '' THEN
    PERFORM public.market_referral_apply(
      NEW.id,
      v_referral_code,
      NULL,
      NULL,
      jsonb_build_object('source', 'signup_metadata')
    );
  END IF;

  RETURN NEW;
EXCEPTION
  WHEN others THEN
    RAISE LOG 'market_referral_after_profile_insert error: %', sqlerrm;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_market_referral_after_profile_insert ON public.profiles;
CREATE TRIGGER trg_market_referral_after_profile_insert
AFTER INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.market_referral_after_profile_insert();

INSERT INTO public.market_reward_config (key, value, public_read)
VALUES (
  'referrals',
  '{
    "enabled": true,
    "joiner_reward_noms": 25,
    "referrer_reward_noms": 5,
    "qualification": "signup",
    "share_base_url": "https://bestcity.app/register",
    "bot_filter": {
      "enabled": true,
      "max_referrals_per_ip_hash": 5,
      "max_referrals_per_user_agent_hash": 10,
      "block_self_referral": true
    }
  }'::jsonb,
  true
)
ON CONFLICT (key) DO UPDATE
SET
  value = EXCLUDED.value,
  public_read = EXCLUDED.public_read,
  updated_at = now();

ALTER TABLE public.market_referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_referrals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS market_referral_codes_select_self ON public.market_referral_codes;
CREATE POLICY market_referral_codes_select_self
ON public.market_referral_codes
FOR SELECT
TO authenticated
USING (auth.uid() = user_id OR public.market_admin_has_permission(auth.uid(), 'rewards.read'));

DROP POLICY IF EXISTS market_referrals_select_related ON public.market_referrals;
CREATE POLICY market_referrals_select_related
ON public.market_referrals
FOR SELECT
TO authenticated
USING (
  auth.uid() = referrer_id
  OR auth.uid() = referred_user_id
  OR public.market_admin_has_permission(auth.uid(), 'rewards.read')
);

GRANT SELECT ON public.market_referral_codes TO authenticated;
GRANT SELECT ON public.market_referrals TO authenticated;
GRANT SELECT ON public.market_referral_leaderboard_v TO service_role;
GRANT ALL ON public.market_referral_codes TO service_role;
GRANT ALL ON public.market_referrals TO service_role;

REVOKE ALL ON FUNCTION public.market_referral_normalize_code(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.market_referral_ensure_code(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.market_referral_apply(uuid, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.market_referral_after_profile_insert() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.market_referral_normalize_code(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.market_referral_ensure_code(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.market_referral_apply(uuid, text, text, text, jsonb) TO service_role;

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.market_referrals;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.market_referral_codes;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

COMMIT;
