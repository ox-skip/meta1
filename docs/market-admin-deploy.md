# Market Admin Deploy

## 1. Link the Supabase project

```powershell
cd E:\meta\meta
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

## 2. Review pending migrations

```powershell
supabase db push --dry-run
```

## 3. Push the new admin migration

```powershell
supabase db push
```

This applies the admin foundation and role-boundary migrations, including
`supabase/migrations/20260414120000_market_admin_foundation.sql` and
`supabase/migrations/20260505170000_market_admin_role_boundaries.sql`.

## 4. Deploy the new admin edge functions

Deploy only the new admin functions:

```powershell
supabase functions deploy market-admin-login
supabase functions deploy market-admin-overview
supabase functions deploy market-admin-workspace
supabase functions deploy market-admin-action
supabase functions deploy market-admin-logout
```

Deploy the updated admin-sensitive functions too:

```powershell
supabase functions deploy market-admin-resolve-dispute
supabase functions deploy market-admin-audit-events
supabase functions deploy market-pi-release-intent
supabase functions deploy market-pi-refund-intent
supabase functions deploy market-stable-admin-settle
supabase functions deploy market-stable-admin-ops
supabase functions deploy market-usdc-refund-intent
supabase functions deploy stock-chain-sync
supabase functions deploy stock-pi-redemption-worker
supabase functions deploy stock-reinvest-order-fee
```

If you want to deploy every function in the repo in one pass:

```powershell
supabase functions deploy
```

## 5. Assign admins from SQL

Use the template in:

`supabase/sql/market_admin_assignments.sql`

Quick examples:

### Super admin

```sql
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
```

### Operations admin

```sql
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
```

### Support admin

```sql
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
```

### Compliance admin

```sql
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
```

## 6. Rotate an admin password later

```sql
UPDATE public.market_admin_users
SET
  password_hash = extensions.crypt('NEW-STRONG-PASSWORD', extensions.gen_salt('bf', 12)),
  last_password_change_at = now(),
  updated_at = now()
WHERE user_id = (
  SELECT id
  FROM auth.users
  WHERE email = 'supportadmin@example.com'
  LIMIT 1
);
```

## 7. Disable an admin instantly

```sql
UPDATE public.market_admin_users
SET
  is_active = false,
  updated_at = now()
WHERE user_id = (
  SELECT id
  FROM auth.users
  WHERE email = 'supportadmin@example.com'
  LIMIT 1
);
```
