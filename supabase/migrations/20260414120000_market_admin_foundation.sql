CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.market_admin_roles (
  key text PRIMARY KEY,
  name text NOT NULL,
  description text,
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  rank integer NOT NULL DEFAULT 100 CHECK (rank >= 0),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.market_admin_users (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  role_key text NOT NULL REFERENCES public.market_admin_roles(key),
  is_active boolean NOT NULL DEFAULT true,
  password_hash text NOT NULL,
  display_name text,
  notes text,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  last_login_at timestamp with time zone,
  last_password_change_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.market_admin_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  session_hash text NOT NULL UNIQUE,
  expires_at timestamp with time zone NOT NULL,
  revoked_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  last_seen_at timestamp with time zone NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text
);

CREATE INDEX IF NOT EXISTS market_admin_users_role_idx
  ON public.market_admin_users(role_key)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS market_admin_sessions_user_idx
  ON public.market_admin_sessions(user_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS market_admin_sessions_expires_idx
  ON public.market_admin_sessions(expires_at)
  WHERE revoked_at IS NULL;

INSERT INTO public.market_admin_roles (key, name, description, permissions, rank)
VALUES
  (
    'super_admin',
    'Super Admin',
    'Full control across support, marketplace operations, and escrow settings.',
    '["admin.members.manage","admin.roles.read","users.read","users.moderate","users.delete","listings.read","listings.moderate","listings.delete","orders.read","orders.manage","disputes.read","disputes.resolve","evidence.read","complaints.read","complaints.respond","verification.read","verification.review","escrow.read","escrow.settle","chain.read","chain.admin","audit.read","analytics.read"]'::jsonb,
    0
  ),
  (
    'operations_admin',
    'Operations Admin',
    'Handles listings, orders, disputes, evidence, and settlements.',
    '["users.read","users.moderate","listings.read","listings.moderate","orders.read","orders.manage","disputes.read","disputes.resolve","evidence.read","complaints.read","complaints.respond","escrow.read","escrow.settle","audit.read","analytics.read"]'::jsonb,
    10
  ),
  (
    'support_admin',
    'Support Admin',
    'Handles complaints, disputes, evidence review, and account moderation.',
    '["users.read","users.moderate","listings.read","orders.read","disputes.read","disputes.resolve","evidence.read","complaints.read","complaints.respond","audit.read"]'::jsonb,
    20
  ),
  (
    'compliance_admin',
    'Compliance Admin',
    'Handles verification and policy enforcement without settlement controls.',
    '["users.read","listings.read","orders.read","disputes.read","evidence.read","complaints.read","verification.read","verification.review","audit.read","analytics.read"]'::jsonb,
    30
  )
ON CONFLICT (key) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  permissions = EXCLUDED.permissions,
  rank = EXCLUDED.rank,
  updated_at = now();

CREATE OR REPLACE FUNCTION public.market_is_admin(p_user_id uuid)
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
      AND mau.is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.market_admin_permissions(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(mar.permissions, '[]'::jsonb)
  FROM public.market_admin_users mau
  JOIN public.market_admin_roles mar
    ON mar.key = mau.role_key
  WHERE mau.user_id = p_user_id
    AND mau.is_active = true
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.market_admin_has_permission(p_user_id uuid, p_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.market_admin_users mau
    JOIN public.market_admin_roles mar
      ON mar.key = mau.role_key
    CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(mar.permissions, '[]'::jsonb)) AS perm(value)
    WHERE mau.user_id = p_user_id
      AND mau.is_active = true
      AND perm.value = p_permission
  );
$$;

CREATE OR REPLACE FUNCTION public.market_admin_verify_password(p_user_id uuid, p_password text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.market_admin_users mau
    WHERE mau.user_id = p_user_id
      AND mau.is_active = true
      AND mau.password_hash = extensions.crypt(p_password, mau.password_hash)
  );
$$;

ALTER TABLE public.market_admin_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_admin_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS market_admin_roles_select_for_admins ON public.market_admin_roles;
CREATE POLICY market_admin_roles_select_for_admins
ON public.market_admin_roles
FOR SELECT
TO authenticated
USING (public.market_is_admin(auth.uid()));

DROP POLICY IF EXISTS market_admin_users_select_self ON public.market_admin_users;
CREATE POLICY market_admin_users_select_self
ON public.market_admin_users
FOR SELECT
TO authenticated
USING (auth.uid() = user_id AND is_active = true);

DROP POLICY IF EXISTS market_admin_sessions_select_self ON public.market_admin_sessions;
CREATE POLICY market_admin_sessions_select_self
ON public.market_admin_sessions
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);
