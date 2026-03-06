BEGIN;

-- Remove legacy single-wallet uniqueness on user_id (if present).
ALTER TABLE public.crypto_wallets
  DROP CONSTRAINT IF EXISTS crypto_wallets_user_id_key;

DO $$
DECLARE
  v_idx_name text;
BEGIN
  FOR v_idx_name IN
    SELECT c.relname
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'crypto_wallets'
      AND i.indisunique
      AND pg_get_indexdef(i.indexrelid) ~* '\(user_id\)'
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS public.%I', v_idx_name);
  END LOOP;
END;
$$;

-- Normalize chain keys before adding composite uniqueness.
UPDATE public.crypto_wallets
SET chain = lower(trim(chain))
WHERE chain IS NOT NULL
  AND chain <> lower(trim(chain));

-- Keep one wallet row per user+chain; newest row wins.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY user_id, chain
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM public.crypto_wallets
)
DELETE FROM public.crypto_wallets w
USING ranked r
WHERE w.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS crypto_wallets_user_chain_uidx
  ON public.crypto_wallets (user_id, chain);

COMMIT;
