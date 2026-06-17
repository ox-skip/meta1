BEGIN;

ALTER TABLE public.crypto_wallets
  ADD COLUMN IF NOT EXISTS wallet_type text,
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS provider_wallet_id text,
  ADD COLUMN IF NOT EXISTS provider_wallet_set_id text,
  ADD COLUMN IF NOT EXISTS provider_user_id text,
  ADD COLUMN IF NOT EXISTS provider_blockchain text,
  ADD COLUMN IF NOT EXISTS provider_ref_id text,
  ADD COLUMN IF NOT EXISTS account_type text,
  ADD COLUMN IF NOT EXISTS custody_type text,
  ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS crypto_wallets_provider_wallet_id_idx
  ON public.crypto_wallets (provider, provider_wallet_id)
  WHERE provider_wallet_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS crypto_wallets_provider_user_id_idx
  ON public.crypto_wallets (provider, provider_user_id)
  WHERE provider_user_id IS NOT NULL;

COMMIT;
