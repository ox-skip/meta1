-- Market admin assignment templates
-- Replace the email addresses and passwords before running in production.
-- Passwords are stored as bcrypt hashes via extensions.crypt(..., extensions.gen_salt('bf', 12)).

-- 1. Super admin
WITH target_user AS (
  SELECT id
  FROM auth.users
  WHERE email = 'superadmin@example.com'
  LIMIT 1
)
INSERT INTO public.market_admin_users (
  user_id,
  role_key,
  password_hash,
  display_name,
  is_active,
  updated_at,
  last_password_change_at
)
SELECT
  id,
  'super_admin',
  extensions.crypt('CHANGE-ME-SUPER-ADMIN-PASSWORD', extensions.gen_salt('bf', 12)),
  'Super Admin',
  true,
  now(),
  now()
FROM target_user
ON CONFLICT (user_id) DO UPDATE
SET
  role_key = EXCLUDED.role_key,
  password_hash = EXCLUDED.password_hash,
  display_name = EXCLUDED.display_name,
  is_active = true,
  updated_at = now(),
  last_password_change_at = now();

-- 2. Operations admin
WITH target_user AS (
  SELECT id
  FROM auth.users
  WHERE email = 'opsadmin@example.com'
  LIMIT 1
)
INSERT INTO public.market_admin_users (
  user_id,
  role_key,
  password_hash,
  display_name,
  is_active,
  updated_at,
  last_password_change_at
)
SELECT
  id,
  'operations_admin',
  extensions.crypt('CHANGE-ME-OPS-ADMIN-PASSWORD', extensions.gen_salt('bf', 12)),
  'Operations Admin',
  true,
  now(),
  now()
FROM target_user
ON CONFLICT (user_id) DO UPDATE
SET
  role_key = EXCLUDED.role_key,
  password_hash = EXCLUDED.password_hash,
  display_name = EXCLUDED.display_name,
  is_active = true,
  updated_at = now(),
  last_password_change_at = now();

-- 3. Support admin
WITH target_user AS (
  SELECT id
  FROM auth.users
  WHERE email = 'supportadmin@example.com'
  LIMIT 1
)
INSERT INTO public.market_admin_users (
  user_id,
  role_key,
  password_hash,
  display_name,
  is_active,
  updated_at,
  last_password_change_at
)
SELECT
  id,
  'support_admin',
  extensions.crypt('CHANGE-ME-SUPPORT-ADMIN-PASSWORD', extensions.gen_salt('bf', 12)),
  'Support Admin',
  true,
  now(),
  now()
FROM target_user
ON CONFLICT (user_id) DO UPDATE
SET
  role_key = EXCLUDED.role_key,
  password_hash = EXCLUDED.password_hash,
  display_name = EXCLUDED.display_name,
  is_active = true,
  updated_at = now(),
  last_password_change_at = now();

-- 4. Compliance admin
WITH target_user AS (
  SELECT id
  FROM auth.users
  WHERE email = 'complianceadmin@example.com'
  LIMIT 1
)
INSERT INTO public.market_admin_users (
  user_id,
  role_key,
  password_hash,
  display_name,
  is_active,
  updated_at,
  last_password_change_at
)
SELECT
  id,
  'compliance_admin',
  extensions.crypt('CHANGE-ME-COMPLIANCE-ADMIN-PASSWORD', extensions.gen_salt('bf', 12)),
  'Compliance Admin',
  true,
  now(),
  now()
FROM target_user
ON CONFLICT (user_id) DO UPDATE
SET
  role_key = EXCLUDED.role_key,
  password_hash = EXCLUDED.password_hash,
  display_name = EXCLUDED.display_name,
  is_active = true,
  updated_at = now(),
  last_password_change_at = now();

-- 5. Disable admin access for a user
-- UPDATE public.market_admin_users
-- SET is_active = false, updated_at = now()
-- WHERE user_id = (
--   SELECT id FROM auth.users WHERE email = 'oldadmin@example.com' LIMIT 1
-- );

-- 6. Rotate an admin password
-- UPDATE public.market_admin_users
-- SET
--   password_hash = extensions.crypt('NEW-STRONG-PASSWORD', extensions.gen_salt('bf', 12)),
--   last_password_change_at = now(),
--   updated_at = now()
-- WHERE user_id = (
--   SELECT id FROM auth.users WHERE email = 'supportadmin@example.com' LIMIT 1
-- );
