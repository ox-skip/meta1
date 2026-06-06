-- Stock contract v3 old-EVM reset.
--
-- Purpose:
--   Remove stock identities created against the old EVM contract set, then
--   reopen EVM stock creation for those stores. Pi identities are untouched.
--
-- Preview before running:
--   SELECT id, store_id, chain, slug, symbol, token_address, pool_address, created_at
--   FROM public.market_stock_identities
--   WHERE chain::text <> 'pi_testnet'
--   ORDER BY created_at DESC;

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.store_identity_permissions
  ADD COLUMN IF NOT EXISTS can_create_evm boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_create_pi boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.market_stock_contract_v3_reset_backup (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT now(),
  table_name text NOT NULL,
  stock_id uuid,
  store_id uuid,
  row_data jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS market_stock_contract_v3_reset_backup_run_idx
  ON public.market_stock_contract_v3_reset_backup (run_id);

CREATE TEMP TABLE _stock_contract_v3_reset_run AS
SELECT gen_random_uuid() AS run_id;

CREATE TEMP TABLE _stock_contract_v3_reset_targets AS
SELECT
  id AS stock_id,
  store_id,
  chain::text AS chain,
  slug,
  symbol,
  token_address,
  pool_address,
  created_at
FROM public.market_stock_identities
WHERE chain::text <> 'pi_testnet';

INSERT INTO public.market_stock_contract_v3_reset_backup (
  run_id,
  table_name,
  stock_id,
  store_id,
  row_data
)
SELECT
  r.run_id,
  'market_stock_identities',
  t.stock_id,
  t.store_id,
  to_jsonb(i)
FROM _stock_contract_v3_reset_run r
CROSS JOIN _stock_contract_v3_reset_targets t
JOIN public.market_stock_identities i ON i.id = t.stock_id;

DO $$
DECLARE
  target_table record;
BEGIN
  FOR target_table IN
    SELECT
      n.nspname AS schema_name,
      c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    JOIN pg_type ty ON ty.oid = a.atttypid
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND a.attname = 'stock_id'
      AND NOT a.attisdropped
      AND ty.typname = 'uuid'
      AND c.relname <> 'market_stock_contract_v3_reset_backup'
  LOOP
    EXECUTE format(
      'INSERT INTO public.market_stock_contract_v3_reset_backup (run_id, table_name, stock_id, store_id, row_data)
       SELECT r.run_id, %L, t.stock_id, targets.store_id, to_jsonb(t)
       FROM _stock_contract_v3_reset_run r
       CROSS JOIN %I.%I t
       JOIN _stock_contract_v3_reset_targets targets ON targets.stock_id = t.stock_id',
      target_table.table_name,
      target_table.schema_name,
      target_table.table_name
    );
  END LOOP;
END $$;

DELETE FROM public.market_stock_identities i
USING _stock_contract_v3_reset_targets t
WHERE i.id = t.stock_id;

INSERT INTO public.store_identity_permissions (
  store_id,
  can_create,
  can_create_evm,
  can_create_pi,
  updated_at
)
SELECT DISTINCT
  t.store_id,
  true,
  true,
  COALESCE(p.can_create_pi, true),
  now()
FROM _stock_contract_v3_reset_targets t
LEFT JOIN public.store_identity_permissions p ON p.store_id = t.store_id
ON CONFLICT (store_id) DO UPDATE
SET
  can_create = true,
  can_create_evm = true,
  updated_at = now();

INSERT INTO public.market_audit_logs (
  actor_id,
  actor_type,
  action,
  entity_type,
  payload
)
SELECT
  NULL,
  'admin',
  'STOCK_CONTRACT_V3_RESET_OLD_EVM_STOCKS',
  'market_stock_identities',
  jsonb_build_object(
    'run_id', r.run_id,
    'deleted_stock_count', (SELECT count(*) FROM _stock_contract_v3_reset_targets),
    'store_count', (SELECT count(DISTINCT store_id) FROM _stock_contract_v3_reset_targets)
  )
FROM _stock_contract_v3_reset_run r
WHERE EXISTS (SELECT 1 FROM _stock_contract_v3_reset_targets);

SELECT
  r.run_id,
  (SELECT count(*) FROM _stock_contract_v3_reset_targets) AS deleted_stock_count,
  (SELECT count(DISTINCT store_id) FROM _stock_contract_v3_reset_targets) AS unlocked_store_count,
  (SELECT count(*) FROM public.market_stock_contract_v3_reset_backup b WHERE b.run_id = r.run_id) AS backed_up_row_count
FROM _stock_contract_v3_reset_run r;

COMMIT;
