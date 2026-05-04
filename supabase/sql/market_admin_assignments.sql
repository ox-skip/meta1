-- Market admin assignment template
-- Replace the email address and password before running in production.
-- Passwords are stored as bcrypt hashes via extensions.crypt(..., extensions.gen_salt('bf', 12)).
--
-- Important: public.market_admin_users is keyed by user_id, so one Supabase
-- account can only have one active admin role at a time. To change the role,
-- rerun this block with a different role_key.

WITH target_user AS (
  SELECT id
  FROM auth.users
  WHERE lower(email) = lower('skima714@gmail.com')
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
  extensions.crypt('16@Nath.com1', extensions.gen_salt('bf', 12)),
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

-- Optional role examples for separate accounts:
-- operations_admin
-- support_admin
-- compliance_admin
--
-- Copy the block above and change the email, role_key, password, and
-- display_name when you need to add another admin account.

-- Disable admin access for a user
-- UPDATE public.market_admin_users
-- SET is_active = false, updated_at = now()
-- WHERE user_id = (
--   SELECT id FROM auth.users WHERE lower(email) = lower('oldadmin@example.com') LIMIT 1
-- );

-- Rotate an admin password
-- UPDATE public.market_admin_users
-- SET
--   password_hash = extensions.crypt('NEW-STRONG-PASSWORD', extensions.gen_salt('bf', 12)),
--   last_password_change_at = now(),
--   updated_at = now()
-- WHERE user_id = (
--   SELECT id FROM auth.users WHERE lower(email) = lower('skima714@gmail.com') LIMIT 1
-- );
