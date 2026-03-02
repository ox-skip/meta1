BEGIN;

ALTER TABLE public.store_identity_permissions
  ADD COLUMN IF NOT EXISTS can_create_evm boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_create_pi boolean NOT NULL DEFAULT true;

UPDATE public.store_identity_permissions
SET
  can_create_evm = COALESCE(can_create, true),
  can_create_pi = COALESCE(can_create_pi, true)
WHERE true;

INSERT INTO public.market_chain_config (
  chain,
  chain_id,
  rpc_url,
  usdc_address,
  usdt_address,
  escrow_address,
  confirmations_required,
  active
)
VALUES (
  'pi_testnet',
  0,
  NULL,
  '0x0000000000000000000000000000000000000000',
  '0x0000000000000000000000000000000000000000',
  '0x0000000000000000000000000000000000000000',
  1,
  true
)
ON CONFLICT (chain) DO UPDATE
SET
  chain_id = EXCLUDED.chain_id,
  confirmations_required = EXCLUDED.confirmations_required,
  active = EXCLUDED.active,
  updated_at = now();

ALTER TABLE public.market_stock_identities
  DROP CONSTRAINT IF EXISTS market_stock_identities_store_id_key;

DROP INDEX IF EXISTS public.market_stock_identities_store_kind_uidx;
CREATE UNIQUE INDEX market_stock_identities_store_kind_uidx
  ON public.market_stock_identities (
    store_id,
    (
      CASE
        WHEN chain = 'pi_testnet'::public.chain_name THEN 'pi'
        ELSE 'evm'
      END
    )
  );

ALTER TABLE public.market_stock_reserve_balance
  DROP CONSTRAINT IF EXISTS market_stock_reserve_balance_store_id_key;

CREATE INDEX IF NOT EXISTS market_stock_reserve_balance_store_idx
  ON public.market_stock_reserve_balance (store_id);

CREATE OR REPLACE FUNCTION public.market_stock_enforce_create_permission()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_can_create boolean := true;
BEGIN
  IF NEW.chain = 'pi_testnet'::public.chain_name THEN
    SELECT COALESCE(p.can_create_pi, true)
    INTO v_can_create
    FROM public.store_identity_permissions p
    WHERE p.store_id = NEW.store_id;
  ELSE
    SELECT COALESCE(p.can_create_evm, COALESCE(p.can_create, true))
    INTO v_can_create
    FROM public.store_identity_permissions p
    WHERE p.store_id = NEW.store_id;
  END IF;

  IF COALESCE(v_can_create, true) = false THEN
    RAISE EXCEPTION 'Store cannot create stock identity right now';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.market_stock_lock_create_after_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.chain = 'pi_testnet'::public.chain_name THEN
    INSERT INTO public.store_identity_permissions (store_id, can_create, can_create_evm, can_create_pi)
    VALUES (NEW.store_id, true, true, false)
    ON CONFLICT (store_id)
    DO UPDATE
      SET can_create_pi = false,
          updated_at = now();
  ELSE
    INSERT INTO public.store_identity_permissions (store_id, can_create, can_create_evm, can_create_pi)
    VALUES (NEW.store_id, false, false, true)
    ON CONFLICT (store_id)
    DO UPDATE
      SET can_create = false,
          can_create_evm = false,
          updated_at = now();
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
