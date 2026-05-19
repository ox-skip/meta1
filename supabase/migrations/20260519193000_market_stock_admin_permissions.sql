INSERT INTO public.market_admin_roles (key, name, description, permissions, rank)
VALUES (
  'stock_admin',
  'Stock Admin',
  'Manages stock identities, stock trading gates, creation permissions, reinvestments, and stock identity contracts.',
  '[
    "stock.read",
    "stock.manage",
    "stock.contracts",
    "chain.read",
    "chain.admin",
    "audit.read",
    "analytics.read"
  ]'::jsonb,
  24
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
        '["stock.read","stock.manage","stock.contracts"]'::jsonb
      ) AS p(value)
    ) AS merged
  ),
  updated_at = now()
WHERE key = 'super_admin';

UPDATE public.market_admin_roles
SET
  permissions = (
    SELECT jsonb_agg(value ORDER BY value)
    FROM (
      SELECT DISTINCT value
      FROM jsonb_array_elements_text(
        COALESCE(permissions, '[]'::jsonb) ||
        '["stock.read","stock.manage"]'::jsonb
      ) AS p(value)
    ) AS merged
  ),
  updated_at = now()
WHERE key = 'operations_admin';
