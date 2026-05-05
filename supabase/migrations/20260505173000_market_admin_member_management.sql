-- Helper used by the admin dashboard to add/update admins while keeping
-- bcrypt hashing inside Postgres.

CREATE OR REPLACE FUNCTION public.market_admin_upsert_user(
  p_target_user_id uuid,
  p_role_key text,
  p_password text DEFAULT NULL,
  p_display_name text DEFAULT NULL,
  p_is_active boolean DEFAULT true,
  p_actor_id uuid DEFAULT NULL
)
RETURNS TABLE (
  user_id uuid,
  role_key text,
  is_active boolean,
  display_name text,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz,
  last_login_at timestamptz,
  last_password_change_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_password text := NULLIF(trim(COALESCE(p_password, '')), '');
  v_exists boolean := false;
BEGIN
  IF p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'target user is required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_target_user_id) THEN
    RAISE EXCEPTION 'target user profile not found';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.market_admin_roles r WHERE r.key = p_role_key) THEN
    RAISE EXCEPTION 'unknown admin role: %', p_role_key;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.market_admin_users mau
    WHERE mau.user_id = p_target_user_id
  )
  INTO v_exists;

  IF NOT v_exists AND v_password IS NULL THEN
    RAISE EXCEPTION 'password is required for a new admin';
  END IF;

  IF v_password IS NOT NULL AND length(v_password) < 8 THEN
    RAISE EXCEPTION 'admin password must be at least 8 characters';
  END IF;

  INSERT INTO public.market_admin_users (
    user_id,
    role_key,
    password_hash,
    display_name,
    is_active,
    created_by,
    updated_at,
    last_password_change_at
  )
  VALUES (
    p_target_user_id,
    p_role_key,
    CASE
      WHEN v_password IS NULL THEN ''
      ELSE extensions.crypt(v_password, extensions.gen_salt('bf', 12))
    END,
    NULLIF(trim(COALESCE(p_display_name, '')), ''),
    COALESCE(p_is_active, true),
    p_actor_id,
    now(),
    now()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    role_key = EXCLUDED.role_key,
    password_hash = CASE
      WHEN v_password IS NULL THEN public.market_admin_users.password_hash
      ELSE EXCLUDED.password_hash
    END,
    display_name = COALESCE(EXCLUDED.display_name, public.market_admin_users.display_name),
    is_active = COALESCE(p_is_active, public.market_admin_users.is_active),
    created_by = COALESCE(public.market_admin_users.created_by, p_actor_id),
    updated_at = now(),
    last_password_change_at = CASE
      WHEN v_password IS NULL THEN public.market_admin_users.last_password_change_at
      ELSE now()
    END;

  RETURN QUERY
  SELECT
    mau.user_id,
    mau.role_key,
    mau.is_active,
    mau.display_name,
    mau.created_by,
    mau.created_at,
    mau.updated_at,
    mau.last_login_at,
    mau.last_password_change_at
  FROM public.market_admin_users mau
  WHERE mau.user_id = p_target_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.market_admin_upsert_user(uuid, text, text, text, boolean, uuid) TO service_role;
