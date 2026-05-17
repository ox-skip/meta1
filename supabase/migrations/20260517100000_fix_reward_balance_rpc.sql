BEGIN;

CREATE OR REPLACE FUNCTION public.market_reward_credit(
  p_user_id uuid,
  p_amount integer,
  p_source text,
  p_reason text DEFAULT NULL,
  p_task_id uuid DEFAULT NULL,
  p_completion_id uuid DEFAULT NULL,
  p_entity_type text DEFAULT NULL,
  p_entity_id text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_created_by uuid DEFAULT NULL
)
RETURNS TABLE(ledger_id uuid, balance integer, delta integer, created_at timestamptz, duplicate boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance integer;
  v_ledger public.market_reward_ledger%ROWTYPE;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id required';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'credit amount must be positive';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_ledger
    FROM public.market_reward_ledger
    WHERE idempotency_key = p_idempotency_key
    LIMIT 1;

    IF FOUND THEN
      ledger_id := v_ledger.id;
      balance := v_ledger.balance_after;
      delta := v_ledger.delta;
      created_at := v_ledger.created_at;
      duplicate := true;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  BEGIN
    PERFORM public.market_reward_ensure_account(p_user_id);

    UPDATE public.market_reward_accounts AS account
    SET
      balance = account.balance + p_amount,
      lifetime_earned = account.lifetime_earned + p_amount,
      last_earned_at = now(),
      updated_at = now()
    WHERE account.user_id = p_user_id
    RETURNING account.balance INTO v_balance;

    INSERT INTO public.market_reward_ledger (
      user_id,
      task_id,
      completion_id,
      delta,
      balance_after,
      source,
      reason,
      entity_type,
      entity_id,
      idempotency_key,
      metadata,
      created_by
    )
    VALUES (
      p_user_id,
      p_task_id,
      p_completion_id,
      p_amount,
      v_balance,
      p_source,
      p_reason,
      p_entity_type,
      p_entity_id,
      p_idempotency_key,
      COALESCE(p_metadata, '{}'::jsonb),
      p_created_by
    )
    RETURNING * INTO v_ledger;

    ledger_id := v_ledger.id;
    balance := v_balance;
    delta := p_amount;
    created_at := v_ledger.created_at;
    duplicate := false;
    RETURN NEXT;
  EXCEPTION WHEN unique_violation THEN
    IF p_idempotency_key IS NULL THEN
      RAISE;
    END IF;

    SELECT * INTO v_ledger
    FROM public.market_reward_ledger
    WHERE idempotency_key = p_idempotency_key
    LIMIT 1;

    ledger_id := v_ledger.id;
    balance := v_ledger.balance_after;
    delta := v_ledger.delta;
    created_at := v_ledger.created_at;
    duplicate := true;
    RETURN NEXT;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.market_reward_debit(
  p_user_id uuid,
  p_amount integer,
  p_source text,
  p_reason text DEFAULT NULL,
  p_entity_type text DEFAULT NULL,
  p_entity_id text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_created_by uuid DEFAULT NULL
)
RETURNS TABLE(ledger_id uuid, balance integer, delta integer, created_at timestamptz, duplicate boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance integer;
  v_ledger public.market_reward_ledger%ROWTYPE;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id required';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'debit amount must be positive';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_ledger
    FROM public.market_reward_ledger
    WHERE idempotency_key = p_idempotency_key
    LIMIT 1;

    IF FOUND THEN
      ledger_id := v_ledger.id;
      balance := v_ledger.balance_after;
      delta := v_ledger.delta;
      created_at := v_ledger.created_at;
      duplicate := true;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  BEGIN
    PERFORM public.market_reward_ensure_account(p_user_id);

    UPDATE public.market_reward_accounts AS account
    SET
      balance = account.balance - p_amount,
      lifetime_spent = account.lifetime_spent + p_amount,
      last_spent_at = now(),
      updated_at = now()
    WHERE account.user_id = p_user_id
      AND account.balance >= p_amount
    RETURNING account.balance INTO v_balance;

    IF v_balance IS NULL THEN
      RAISE EXCEPTION 'insufficient noms balance';
    END IF;

    INSERT INTO public.market_reward_ledger (
      user_id,
      delta,
      balance_after,
      source,
      reason,
      entity_type,
      entity_id,
      idempotency_key,
      metadata,
      created_by
    )
    VALUES (
      p_user_id,
      -p_amount,
      v_balance,
      p_source,
      p_reason,
      p_entity_type,
      p_entity_id,
      p_idempotency_key,
      COALESCE(p_metadata, '{}'::jsonb),
      p_created_by
    )
    RETURNING * INTO v_ledger;

    ledger_id := v_ledger.id;
    balance := v_balance;
    delta := -p_amount;
    created_at := v_ledger.created_at;
    duplicate := false;
    RETURN NEXT;
  EXCEPTION WHEN unique_violation THEN
    IF p_idempotency_key IS NULL THEN
      RAISE;
    END IF;

    SELECT * INTO v_ledger
    FROM public.market_reward_ledger
    WHERE idempotency_key = p_idempotency_key
    LIMIT 1;

    ledger_id := v_ledger.id;
    balance := v_ledger.balance_after;
    delta := v_ledger.delta;
    created_at := v_ledger.created_at;
    duplicate := true;
    RETURN NEXT;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.market_reward_credit(uuid, integer, text, text, uuid, uuid, text, text, text, jsonb, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.market_reward_debit(uuid, integer, text, text, text, text, text, jsonb, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.market_reward_credit(uuid, integer, text, text, uuid, uuid, text, text, text, jsonb, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.market_reward_debit(uuid, integer, text, text, text, text, text, jsonb, uuid) TO service_role;

COMMIT;
