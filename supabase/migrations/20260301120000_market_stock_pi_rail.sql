BEGIN;

ALTER TABLE public.market_stock_positions
  ADD COLUMN IF NOT EXISTS locked_redemption_qty numeric(30,12) NOT NULL DEFAULT 0;

ALTER TABLE public.market_stock_orders
  ADD COLUMN IF NOT EXISTS settlement_rail text NOT NULL DEFAULT 'evm',
  ADD COLUMN IF NOT EXISTS quote_ref text,
  ADD COLUMN IF NOT EXISTS external_payment_id text,
  ADD COLUMN IF NOT EXISTS external_txid text;

ALTER TABLE public.market_stock_trades
  ADD COLUMN IF NOT EXISTS settlement_rail text NOT NULL DEFAULT 'evm',
  ADD COLUMN IF NOT EXISTS quote_ref text,
  ADD COLUMN IF NOT EXISTS external_payment_id text,
  ADD COLUMN IF NOT EXISTS external_txid text;

CREATE UNIQUE INDEX IF NOT EXISTS market_stock_orders_quote_ref_uidx
  ON public.market_stock_orders (quote_ref)
  WHERE quote_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS market_stock_orders_rail_status_idx
  ON public.market_stock_orders (stock_id, settlement_rail, status, created_at DESC);

CREATE INDEX IF NOT EXISTS market_stock_trades_rail_time_idx
  ON public.market_stock_trades (stock_id, settlement_rail, traded_at DESC);

CREATE TABLE IF NOT EXISTS public.market_stock_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id uuid NOT NULL REFERENCES public.market_stock_identities(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rail text NOT NULL DEFAULT 'pi' CHECK (rail IN ('pi')),
  side public.stock_trade_side NOT NULL,
  quote_ref text NOT NULL UNIQUE,
  quote_signature text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CONSUMED', 'EXPIRED', 'CANCELLED')),
  quote_expires_at timestamptz NOT NULL,
  price_spot_usdc numeric(20,8) NOT NULL CHECK (price_spot_usdc > 0),
  price_execution_usdc numeric(20,8) NOT NULL CHECK (price_execution_usdc > 0),
  gross_usdc numeric(20,8) NOT NULL CHECK (gross_usdc > 0),
  fee_usdc numeric(20,8) NOT NULL DEFAULT 0 CHECK (fee_usdc >= 0),
  net_usdc numeric(20,8) NOT NULL CHECK (net_usdc >= 0),
  pi_price_usd numeric(20,8) NOT NULL CHECK (pi_price_usd > 0),
  gross_pi numeric(30,8) NOT NULL CHECK (gross_pi > 0),
  fee_pi numeric(30,8) NOT NULL DEFAULT 0 CHECK (fee_pi >= 0),
  net_pi numeric(30,8) NOT NULL CHECK (net_pi >= 0),
  quantity numeric(30,12) NOT NULL CHECK (quantity > 0),
  price_impact_bps integer NOT NULL DEFAULT 0 CHECK (price_impact_bps >= 0),
  slippage_bps integer NOT NULL DEFAULT 0 CHECK (slippage_bps >= 0),
  stress_spread_bps integer NOT NULL DEFAULT 0 CHECK (stress_spread_bps >= 0),
  fee_bps integer NOT NULL DEFAULT 0 CHECK (fee_bps >= 0),
  lpi numeric(20,8) NOT NULL DEFAULT 0 CHECK (lpi >= 0),
  coverage_ratio numeric(20,8) NOT NULL DEFAULT 0 CHECK (coverage_ratio >= 0),
  flow_balance numeric(20,8) NOT NULL DEFAULT 1 CHECK (flow_balance >= 0),
  early_exit_fee_bps integer NOT NULL DEFAULT 0 CHECK (early_exit_fee_bps >= 0),
  cooldown_seconds integer NOT NULL DEFAULT 0 CHECK (cooldown_seconds >= 0),
  supply_release_multiplier numeric(20,8) NOT NULL DEFAULT 1 CHECK (supply_release_multiplier > 0),
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_stock_quotes_lookup_idx
  ON public.market_stock_quotes (stock_id, user_id, side, status, quote_expires_at DESC);

CREATE TABLE IF NOT EXISTS public.market_stock_pi_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id uuid NOT NULL REFERENCES public.market_stock_identities(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.market_stock_orders(id) ON DELETE SET NULL,
  quote_id uuid NOT NULL UNIQUE REFERENCES public.market_stock_quotes(id) ON DELETE CASCADE,
  quote_ref text NOT NULL UNIQUE,
  checkout_token text,
  checkout_token_expires_at timestamptz,
  payment_id text,
  txid text,
  status text NOT NULL DEFAULT 'QUOTED' CHECK (status IN ('QUOTED', 'APPROVED', 'SETTLED', 'FAILED', 'CANCELLED')),
  quote_pi_amount numeric(30,8) NOT NULL CHECK (quote_pi_amount > 0),
  quote_usd_amount numeric(20,8) NOT NULL CHECK (quote_usd_amount > 0),
  quantity numeric(30,12) NOT NULL CHECK (quantity > 0),
  paid_pi_amount numeric(30,8),
  completion_price_usd numeric(20,8),
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS market_stock_pi_payments_checkout_token_uidx
  ON public.market_stock_pi_payments (checkout_token)
  WHERE checkout_token IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS market_stock_pi_payments_payment_id_uidx
  ON public.market_stock_pi_payments (payment_id)
  WHERE payment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS market_stock_pi_payments_txid_uidx
  ON public.market_stock_pi_payments (txid)
  WHERE txid IS NOT NULL;

CREATE INDEX IF NOT EXISTS market_stock_pi_payments_stock_status_idx
  ON public.market_stock_pi_payments (stock_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.market_stock_pi_redemption_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_seq bigserial NOT NULL UNIQUE,
  stock_id uuid NOT NULL REFERENCES public.market_stock_identities(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  order_id uuid NOT NULL UNIQUE REFERENCES public.market_stock_orders(id) ON DELETE CASCADE,
  quote_id uuid NOT NULL UNIQUE REFERENCES public.market_stock_quotes(id) ON DELETE RESTRICT,
  quote_ref text NOT NULL UNIQUE,
  recipient_pi_uid text NOT NULL,
  recipient_wallet text,
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED')),
  priority integer NOT NULL DEFAULT 0,
  quantity_locked numeric(30,12) NOT NULL CHECK (quantity_locked > 0),
  locked_gross_usdc numeric(20,8) NOT NULL CHECK (locked_gross_usdc > 0),
  locked_fee_usdc numeric(20,8) NOT NULL DEFAULT 0 CHECK (locked_fee_usdc >= 0),
  locked_net_usdc numeric(20,8) NOT NULL CHECK (locked_net_usdc >= 0),
  locked_net_payout_pi numeric(30,8) NOT NULL CHECK (locked_net_payout_pi > 0),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_retry_at timestamptz,
  processing_started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  last_error text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_stock_pi_redemption_queue_stock_status_idx
  ON public.market_stock_pi_redemption_queue (stock_id, status, queue_seq ASC);

CREATE INDEX IF NOT EXISTS market_stock_pi_redemption_queue_user_idx
  ON public.market_stock_pi_redemption_queue (user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.market_stock_pi_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id uuid NOT NULL UNIQUE REFERENCES public.market_stock_pi_redemption_queue(id) ON DELETE CASCADE,
  stock_id uuid NOT NULL REFERENCES public.market_stock_identities(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.market_stock_orders(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'CREATED' CHECK (status IN ('CREATED', 'SUBMITTED', 'CONFIRMED', 'FAILED', 'CANCELLED')),
  payment_id text,
  txid text,
  amount_pi numeric(30,8) NOT NULL CHECK (amount_pi > 0),
  amount_usd_snapshot numeric(20,8) NOT NULL CHECK (amount_usd_snapshot >= 0),
  recipient_pi_uid text NOT NULL,
  failure_reason text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_at timestamptz,
  confirmed_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS market_stock_pi_payouts_payment_id_uidx
  ON public.market_stock_pi_payouts (payment_id)
  WHERE payment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS market_stock_pi_payouts_txid_uidx
  ON public.market_stock_pi_payouts (txid)
  WHERE txid IS NOT NULL;

CREATE INDEX IF NOT EXISTS market_stock_pi_payouts_status_idx
  ON public.market_stock_pi_payouts (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.market_stock_pi_ledger_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id uuid NOT NULL REFERENCES public.market_stock_identities(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  order_id uuid REFERENCES public.market_stock_orders(id) ON DELETE SET NULL,
  quote_id uuid REFERENCES public.market_stock_quotes(id) ON DELETE SET NULL,
  payment_row_id uuid REFERENCES public.market_stock_pi_payments(id) ON DELETE SET NULL,
  queue_id uuid REFERENCES public.market_stock_pi_redemption_queue(id) ON DELETE SET NULL,
  payout_id uuid REFERENCES public.market_stock_pi_payouts(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (
    event_type IN (
      'BUY_SETTLED',
      'SELL_LOCKED',
      'PAYOUT_CONFIRMED',
      'QUEUE_RETRY',
      'QUEUE_CANCELLED',
      'QUOTE_EXPIRED',
      'MANUAL_ADJUSTMENT'
    )
  ),
  idempotency_key text NOT NULL UNIQUE,
  delta_qty numeric(30,12) NOT NULL DEFAULT 0,
  delta_locked_qty numeric(30,12) NOT NULL DEFAULT 0,
  delta_pool_pi numeric(30,8) NOT NULL DEFAULT 0,
  delta_queued_liability_pi numeric(30,8) NOT NULL DEFAULT 0,
  inflow_pi numeric(30,8) NOT NULL DEFAULT 0,
  outflow_pi numeric(30,8) NOT NULL DEFAULT 0,
  amount_usdc numeric(20,8) NOT NULL DEFAULT 0,
  amount_pi numeric(30,8) NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_stock_pi_ledger_events_stock_time_idx
  ON public.market_stock_pi_ledger_events (stock_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.market_stock_pi_liquidity_state (
  stock_id uuid PRIMARY KEY REFERENCES public.market_stock_identities(id) ON DELETE CASCADE,
  pool_pi_reserved numeric(30,8) NOT NULL DEFAULT 0 CHECK (pool_pi_reserved >= 0),
  queued_liability_pi numeric(30,8) NOT NULL DEFAULT 0 CHECK (queued_liability_pi >= 0),
  inflow_ema_24h numeric(30,8) NOT NULL DEFAULT 0 CHECK (inflow_ema_24h >= 0),
  outflow_ema_24h numeric(30,8) NOT NULL DEFAULT 0 CHECK (outflow_ema_24h >= 0),
  last_flow_at timestamptz,
  last_budget_pi numeric(30,8) NOT NULL DEFAULT 0 CHECK (last_budget_pi >= 0),
  last_budget_window_used_pi numeric(30,8) NOT NULL DEFAULT 0 CHECK (last_budget_window_used_pi >= 0),
  last_coverage_ratio numeric(20,8) NOT NULL DEFAULT 0 CHECK (last_coverage_ratio >= 0),
  last_flow_balance numeric(20,8) NOT NULL DEFAULT 1 CHECK (last_flow_balance >= 0),
  last_lpi numeric(20,8) NOT NULL DEFAULT 0 CHECK (last_lpi >= 0),
  last_budget_multiplier numeric(20,8) NOT NULL DEFAULT 1 CHECK (last_budget_multiplier >= 0),
  last_sell_spread_bps integer NOT NULL DEFAULT 0 CHECK (last_sell_spread_bps >= 0),
  last_cooldown_seconds integer NOT NULL DEFAULT 0 CHECK (last_cooldown_seconds >= 0),
  last_early_exit_fee_bps integer NOT NULL DEFAULT 0 CHECK (last_early_exit_fee_bps >= 0),
  last_supply_release_multiplier numeric(20,8) NOT NULL DEFAULT 1 CHECK (last_supply_release_multiplier > 0),
  sells_paused boolean NOT NULL DEFAULT false,
  circuit_breaker_reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.market_stock_pi_apply_state_delta(
  p_stock_id uuid,
  p_delta_pool_pi numeric DEFAULT 0,
  p_delta_queued_liability_pi numeric DEFAULT 0,
  p_inflow_pi numeric DEFAULT 0,
  p_outflow_pi numeric DEFAULT 0
)
RETURNS public.market_stock_pi_liquidity_state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_state public.market_stock_pi_liquidity_state%ROWTYPE;
  v_now timestamptz := now();
  v_dt_seconds numeric := 86400;
  v_alpha numeric := 1;
BEGIN
  INSERT INTO public.market_stock_pi_liquidity_state (stock_id)
  VALUES (p_stock_id)
  ON CONFLICT (stock_id) DO NOTHING;

  SELECT *
  INTO v_state
  FROM public.market_stock_pi_liquidity_state
  WHERE stock_id = p_stock_id
  FOR UPDATE;

  IF v_state.last_flow_at IS NOT NULL THEN
    v_dt_seconds := GREATEST(EXTRACT(epoch FROM (v_now - v_state.last_flow_at)), 0);
    v_alpha := 1 - exp(-v_dt_seconds / 86400.0);
    v_alpha := LEAST(GREATEST(v_alpha, 0), 1);
  END IF;

  UPDATE public.market_stock_pi_liquidity_state
  SET
    pool_pi_reserved = GREATEST(0, COALESCE(v_state.pool_pi_reserved, 0) + COALESCE(p_delta_pool_pi, 0)),
    queued_liability_pi = GREATEST(0, COALESCE(v_state.queued_liability_pi, 0) + COALESCE(p_delta_queued_liability_pi, 0)),
    inflow_ema_24h = GREATEST(
      0,
      COALESCE(v_state.inflow_ema_24h, 0) * (1 - v_alpha) + GREATEST(COALESCE(p_inflow_pi, 0), 0) * v_alpha
    ),
    outflow_ema_24h = GREATEST(
      0,
      COALESCE(v_state.outflow_ema_24h, 0) * (1 - v_alpha) + GREATEST(COALESCE(p_outflow_pi, 0), 0) * v_alpha
    ),
    last_flow_at = v_now,
    updated_at = v_now
  WHERE stock_id = p_stock_id
  RETURNING * INTO v_state;

  RETURN v_state;
END;
$$;

CREATE OR REPLACE FUNCTION public.market_stock_pi_fill_buy(
  p_payment_row_id uuid,
  p_idempotency_key text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  trade_id uuid,
  order_id uuid,
  new_balance_qty numeric,
  new_avg_cost_usdc numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.market_stock_pi_payments%ROWTYPE;
  v_quote public.market_stock_quotes%ROWTYPE;
  v_order public.market_stock_orders%ROWTYPE;
  v_position public.market_stock_positions%ROWTYPE;
  v_identity public.market_stock_identities%ROWTYPE;
  v_trade public.market_stock_trades%ROWTYPE;
  v_bucket timestamptz := date_trunc('minute', now());
  v_next_balance numeric := 0;
  v_next_avg numeric := 0;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.market_stock_pi_ledger_events e
    WHERE e.idempotency_key = p_idempotency_key
  ) THEN
    SELECT t.*
    INTO v_trade
    FROM public.market_stock_trades t
    WHERE t.quote_ref = (
      SELECT p.quote_ref
      FROM public.market_stock_pi_payments p
      WHERE p.id = p_payment_row_id
    )
      AND t.settlement_rail = 'pi'
      AND t.side = 'buy'
    ORDER BY t.created_at DESC
    LIMIT 1;

    IF v_trade.id IS NOT NULL THEN
      RETURN QUERY
      SELECT
        v_trade.id,
        NULL::uuid,
        NULL::numeric,
        NULL::numeric;
      RETURN;
    END IF;
  END IF;

  SELECT *
  INTO v_payment
  FROM public.market_stock_pi_payments
  WHERE id = p_payment_row_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pi buy payment not found';
  END IF;

  SELECT *
  INTO v_quote
  FROM public.market_stock_quotes
  WHERE id = v_payment.quote_id
  FOR UPDATE;

  SELECT *
  INTO v_order
  FROM public.market_stock_orders
  WHERE id = v_payment.order_id
  FOR UPDATE;

  IF v_payment.status = 'SETTLED' THEN
    SELECT *
    INTO v_trade
    FROM public.market_stock_trades
    WHERE quote_ref = v_payment.quote_ref
      AND settlement_rail = 'pi'
      AND side = 'buy'
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_trade.id IS NOT NULL THEN
      RETURN QUERY
      SELECT
        v_trade.id,
        v_order.id,
        NULL::numeric,
        NULL::numeric;
      RETURN;
    END IF;
  END IF;

  SELECT *
  INTO v_identity
  FROM public.market_stock_identities
  WHERE id = v_payment.stock_id;

  SELECT *
  INTO v_position
  FROM public.market_stock_positions
  WHERE stock_id = v_payment.stock_id
    AND user_id = v_payment.user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    v_position.balance_qty := 0;
    v_position.avg_cost_usdc := 0;
    v_position.locked_redemption_qty := 0;
    v_position.realized_pnl_usdc := 0;
  END IF;

  v_next_balance := COALESCE(v_position.balance_qty, 0) + v_quote.quantity;
  v_next_avg := CASE
    WHEN COALESCE(v_position.balance_qty, 0) <= 0 THEN v_quote.price_execution_usdc
    ELSE (
      (COALESCE(v_position.balance_qty, 0) * COALESCE(v_position.avg_cost_usdc, 0))
      + (v_quote.quantity * v_quote.price_execution_usdc)
    ) / v_next_balance
  END;

  INSERT INTO public.market_stock_positions (
    stock_id,
    user_id,
    balance_qty,
    avg_cost_usdc,
    realized_pnl_usdc,
    locked_redemption_qty,
    updated_at
  )
  VALUES (
    v_payment.stock_id,
    v_payment.user_id,
    v_next_balance,
    v_next_avg,
    COALESCE(v_position.realized_pnl_usdc, 0),
    COALESCE(v_position.locked_redemption_qty, 0),
    now()
  )
  ON CONFLICT (stock_id, user_id)
  DO UPDATE SET
    balance_qty = EXCLUDED.balance_qty,
    avg_cost_usdc = EXCLUDED.avg_cost_usdc,
    realized_pnl_usdc = EXCLUDED.realized_pnl_usdc,
    locked_redemption_qty = EXCLUDED.locked_redemption_qty,
    updated_at = now();

  INSERT INTO public.market_stock_trades (
    stock_id,
    user_id,
    side,
    price_usdc,
    quantity,
    notional_usdc,
    fee_usdc,
    settlement_rail,
    quote_ref,
    external_payment_id,
    external_txid,
    traded_at
  )
  VALUES (
    v_payment.stock_id,
    v_payment.user_id,
    'buy',
    v_quote.price_execution_usdc,
    v_quote.quantity,
    v_quote.gross_usdc,
    v_quote.fee_usdc,
    'pi',
    v_payment.quote_ref,
    v_payment.payment_id,
    v_payment.txid,
    now()
  )
  RETURNING * INTO v_trade;

  INSERT INTO public.market_stock_candles_1m (
    stock_id,
    bucket_start,
    open_price_usdc,
    high_price_usdc,
    low_price_usdc,
    close_price_usdc,
    volume_qty,
    volume_usdc,
    trades_count,
    updated_at
  )
  VALUES (
    v_payment.stock_id,
    v_bucket,
    v_quote.price_execution_usdc,
    v_quote.price_execution_usdc,
    v_quote.price_execution_usdc,
    v_quote.price_execution_usdc,
    v_quote.quantity,
    v_quote.gross_usdc,
    1,
    now()
  )
  ON CONFLICT (stock_id, bucket_start)
  DO UPDATE SET
    high_price_usdc = GREATEST(public.market_stock_candles_1m.high_price_usdc, EXCLUDED.high_price_usdc),
    low_price_usdc = LEAST(public.market_stock_candles_1m.low_price_usdc, EXCLUDED.low_price_usdc),
    close_price_usdc = EXCLUDED.close_price_usdc,
    volume_qty = public.market_stock_candles_1m.volume_qty + EXCLUDED.volume_qty,
    volume_usdc = public.market_stock_candles_1m.volume_usdc + EXCLUDED.volume_usdc,
    trades_count = public.market_stock_candles_1m.trades_count + 1,
    updated_at = now();

  INSERT INTO public.market_stock_price_points (
    stock_id,
    last_price_usdc,
    market_cap_usdc,
    updated_at
  )
  VALUES (
    v_payment.stock_id,
    v_quote.price_execution_usdc,
    v_quote.price_execution_usdc * COALESCE(v_identity.total_supply, 10000000),
    now()
  )
  ON CONFLICT (stock_id)
  DO UPDATE SET
    last_price_usdc = EXCLUDED.last_price_usdc,
    market_cap_usdc = EXCLUDED.market_cap_usdc,
    updated_at = now();

  UPDATE public.market_stock_orders
  SET
    status = 'filled',
    settlement_rail = 'pi',
    quote_ref = v_payment.quote_ref,
    external_payment_id = v_payment.payment_id,
    external_txid = v_payment.txid,
    filled_trade_id = v_trade.id,
    updated_at = now()
  WHERE id = v_payment.order_id;

  UPDATE public.market_stock_pi_payments
  SET
    status = 'SETTLED',
    settled_at = now(),
    updated_at = now()
  WHERE id = v_payment.id;

  UPDATE public.market_stock_quotes
  SET status = 'CONSUMED', updated_at = now()
  WHERE id = v_quote.id;

  PERFORM public.market_stock_pi_apply_state_delta(
    v_payment.stock_id,
    COALESCE(v_payment.paid_pi_amount, v_payment.quote_pi_amount),
    0,
    COALESCE(v_payment.paid_pi_amount, v_payment.quote_pi_amount),
    0
  );

  INSERT INTO public.market_stock_pi_ledger_events (
    stock_id,
    user_id,
    order_id,
    quote_id,
    payment_row_id,
    event_type,
    idempotency_key,
    delta_qty,
    delta_pool_pi,
    inflow_pi,
    amount_usdc,
    amount_pi,
    metadata
  )
  VALUES (
    v_payment.stock_id,
    v_payment.user_id,
    v_payment.order_id,
    v_quote.id,
    v_payment.id,
    'BUY_SETTLED',
    p_idempotency_key,
    v_quote.quantity,
    COALESCE(v_payment.paid_pi_amount, v_payment.quote_pi_amount),
    COALESCE(v_payment.paid_pi_amount, v_payment.quote_pi_amount),
    v_quote.gross_usdc,
    COALESCE(v_payment.paid_pi_amount, v_payment.quote_pi_amount),
    COALESCE(p_metadata, '{}'::jsonb)
  );

  RETURN QUERY
  SELECT
    v_trade.id,
    v_order.id,
    v_next_balance,
    v_next_avg;
END;
$$;

CREATE OR REPLACE FUNCTION public.market_stock_pi_finalize_payout(
  p_payout_id uuid,
  p_idempotency_key text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  trade_id uuid,
  order_id uuid,
  remaining_pool_pi numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payout public.market_stock_pi_payouts%ROWTYPE;
  v_queue public.market_stock_pi_redemption_queue%ROWTYPE;
  v_quote public.market_stock_quotes%ROWTYPE;
  v_order public.market_stock_orders%ROWTYPE;
  v_position public.market_stock_positions%ROWTYPE;
  v_identity public.market_stock_identities%ROWTYPE;
  v_trade public.market_stock_trades%ROWTYPE;
  v_bucket timestamptz := date_trunc('minute', now());
  v_next_balance numeric := 0;
  v_next_locked numeric := 0;
  v_next_realized numeric := 0;
  v_state public.market_stock_pi_liquidity_state%ROWTYPE;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.market_stock_pi_ledger_events e
    WHERE e.idempotency_key = p_idempotency_key
  ) THEN
    SELECT t.*
    INTO v_trade
    FROM public.market_stock_trades t
    WHERE t.external_payment_id = (
      SELECT p.payment_id
      FROM public.market_stock_pi_payouts p
      WHERE p.id = p_payout_id
    )
      AND t.settlement_rail = 'pi'
      AND t.side = 'sell'
    ORDER BY t.created_at DESC
    LIMIT 1;

    IF v_trade.id IS NOT NULL THEN
      RETURN QUERY
      SELECT
        v_trade.id,
        NULL::uuid,
        NULL::numeric;
      RETURN;
    END IF;
  END IF;

  SELECT *
  INTO v_payout
  FROM public.market_stock_pi_payouts
  WHERE id = p_payout_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pi payout not found';
  END IF;

  SELECT *
  INTO v_queue
  FROM public.market_stock_pi_redemption_queue
  WHERE id = v_payout.queue_id
  FOR UPDATE;

  SELECT *
  INTO v_quote
  FROM public.market_stock_quotes
  WHERE id = v_queue.quote_id
  FOR UPDATE;

  SELECT *
  INTO v_order
  FROM public.market_stock_orders
  WHERE id = v_queue.order_id
  FOR UPDATE;

  SELECT *
  INTO v_identity
  FROM public.market_stock_identities
  WHERE id = v_queue.stock_id;

  SELECT *
  INTO v_position
  FROM public.market_stock_positions
  WHERE stock_id = v_queue.stock_id
    AND user_id = v_queue.user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Locked stock position not found';
  END IF;

  IF v_queue.status = 'PAID' AND v_payout.status = 'CONFIRMED' THEN
    SELECT *
    INTO v_trade
    FROM public.market_stock_trades
    WHERE quote_ref = v_queue.quote_ref
      AND settlement_rail = 'pi'
      AND side = 'sell'
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_trade.id IS NOT NULL THEN
      RETURN QUERY
      SELECT
        v_trade.id,
        v_order.id,
        NULL::numeric;
      RETURN;
    END IF;
  END IF;

  IF COALESCE(v_position.balance_qty, 0) < v_queue.quantity_locked THEN
    RAISE EXCEPTION 'Position balance dropped below locked sell quantity';
  END IF;

  IF COALESCE(v_position.locked_redemption_qty, 0) < v_queue.quantity_locked THEN
    RAISE EXCEPTION 'Locked redemption quantity is inconsistent';
  END IF;

  v_next_balance := COALESCE(v_position.balance_qty, 0) - v_queue.quantity_locked;
  v_next_locked := COALESCE(v_position.locked_redemption_qty, 0) - v_queue.quantity_locked;
  v_next_realized := COALESCE(v_position.realized_pnl_usdc, 0)
    + ((v_quote.price_execution_usdc - COALESCE(v_position.avg_cost_usdc, 0)) * v_queue.quantity_locked);

  UPDATE public.market_stock_positions
  SET
    balance_qty = GREATEST(0, v_next_balance),
    locked_redemption_qty = GREATEST(0, v_next_locked),
    realized_pnl_usdc = v_next_realized,
    updated_at = now()
  WHERE stock_id = v_queue.stock_id
    AND user_id = v_queue.user_id;

  INSERT INTO public.market_stock_trades (
    stock_id,
    user_id,
    side,
    price_usdc,
    quantity,
    notional_usdc,
    fee_usdc,
    settlement_rail,
    quote_ref,
    external_payment_id,
    external_txid,
    traded_at
  )
  VALUES (
    v_queue.stock_id,
    v_queue.user_id,
    'sell',
    v_quote.price_execution_usdc,
    v_queue.quantity_locked,
    v_queue.locked_gross_usdc,
    v_queue.locked_fee_usdc,
    'pi',
    v_queue.quote_ref,
    v_payout.payment_id,
    v_payout.txid,
    now()
  )
  RETURNING * INTO v_trade;

  INSERT INTO public.market_stock_candles_1m (
    stock_id,
    bucket_start,
    open_price_usdc,
    high_price_usdc,
    low_price_usdc,
    close_price_usdc,
    volume_qty,
    volume_usdc,
    trades_count,
    updated_at
  )
  VALUES (
    v_queue.stock_id,
    v_bucket,
    v_quote.price_execution_usdc,
    v_quote.price_execution_usdc,
    v_quote.price_execution_usdc,
    v_quote.price_execution_usdc,
    v_queue.quantity_locked,
    v_queue.locked_gross_usdc,
    1,
    now()
  )
  ON CONFLICT (stock_id, bucket_start)
  DO UPDATE SET
    high_price_usdc = GREATEST(public.market_stock_candles_1m.high_price_usdc, EXCLUDED.high_price_usdc),
    low_price_usdc = LEAST(public.market_stock_candles_1m.low_price_usdc, EXCLUDED.low_price_usdc),
    close_price_usdc = EXCLUDED.close_price_usdc,
    volume_qty = public.market_stock_candles_1m.volume_qty + EXCLUDED.volume_qty,
    volume_usdc = public.market_stock_candles_1m.volume_usdc + EXCLUDED.volume_usdc,
    trades_count = public.market_stock_candles_1m.trades_count + 1,
    updated_at = now();

  INSERT INTO public.market_stock_price_points (
    stock_id,
    last_price_usdc,
    market_cap_usdc,
    updated_at
  )
  VALUES (
    v_queue.stock_id,
    v_quote.price_execution_usdc,
    v_quote.price_execution_usdc * COALESCE(v_identity.total_supply, 10000000),
    now()
  )
  ON CONFLICT (stock_id)
  DO UPDATE SET
    last_price_usdc = EXCLUDED.last_price_usdc,
    market_cap_usdc = EXCLUDED.market_cap_usdc,
    updated_at = now();

  UPDATE public.market_stock_orders
  SET
    status = 'filled',
    settlement_rail = 'pi',
    quote_ref = v_queue.quote_ref,
    external_payment_id = v_payout.payment_id,
    external_txid = v_payout.txid,
    filled_trade_id = v_trade.id,
    updated_at = now()
  WHERE id = v_queue.order_id;

  UPDATE public.market_stock_pi_redemption_queue
  SET
    status = 'PAID',
    completed_at = now(),
    updated_at = now()
  WHERE id = v_queue.id;

  UPDATE public.market_stock_pi_payouts
  SET
    status = 'CONFIRMED',
    confirmed_at = now(),
    updated_at = now()
  WHERE id = v_payout.id;

  v_state := public.market_stock_pi_apply_state_delta(
    v_queue.stock_id,
    -v_queue.locked_net_payout_pi,
    -v_queue.locked_net_payout_pi,
    0,
    v_queue.locked_net_payout_pi
  );

  INSERT INTO public.market_stock_pi_ledger_events (
    stock_id,
    user_id,
    order_id,
    quote_id,
    queue_id,
    payout_id,
    event_type,
    idempotency_key,
    delta_qty,
    delta_locked_qty,
    delta_pool_pi,
    delta_queued_liability_pi,
    outflow_pi,
    amount_usdc,
    amount_pi,
    metadata
  )
  VALUES (
    v_queue.stock_id,
    v_queue.user_id,
    v_queue.order_id,
    v_queue.quote_id,
    v_queue.id,
    v_payout.id,
    'PAYOUT_CONFIRMED',
    p_idempotency_key,
    -v_queue.quantity_locked,
    -v_queue.quantity_locked,
    -v_queue.locked_net_payout_pi,
    -v_queue.locked_net_payout_pi,
    v_queue.locked_net_payout_pi,
    v_queue.locked_net_usdc,
    v_queue.locked_net_payout_pi,
    COALESCE(p_metadata, '{}'::jsonb)
  );

  RETURN QUERY
  SELECT
    v_trade.id,
    v_order.id,
    v_state.pool_pi_reserved;
END;
$$;

DROP TRIGGER IF EXISTS trg_market_stock_quotes_updated_at ON public.market_stock_quotes;
CREATE TRIGGER trg_market_stock_quotes_updated_at
BEFORE UPDATE ON public.market_stock_quotes
FOR EACH ROW EXECUTE FUNCTION public.market_stock_set_updated_at();

DROP TRIGGER IF EXISTS trg_market_stock_pi_payments_updated_at ON public.market_stock_pi_payments;
CREATE TRIGGER trg_market_stock_pi_payments_updated_at
BEFORE UPDATE ON public.market_stock_pi_payments
FOR EACH ROW EXECUTE FUNCTION public.market_stock_set_updated_at();

DROP TRIGGER IF EXISTS trg_market_stock_pi_redemption_queue_updated_at ON public.market_stock_pi_redemption_queue;
CREATE TRIGGER trg_market_stock_pi_redemption_queue_updated_at
BEFORE UPDATE ON public.market_stock_pi_redemption_queue
FOR EACH ROW EXECUTE FUNCTION public.market_stock_set_updated_at();

DROP TRIGGER IF EXISTS trg_market_stock_pi_payouts_updated_at ON public.market_stock_pi_payouts;
CREATE TRIGGER trg_market_stock_pi_payouts_updated_at
BEFORE UPDATE ON public.market_stock_pi_payouts
FOR EACH ROW EXECUTE FUNCTION public.market_stock_set_updated_at();

DROP TRIGGER IF EXISTS trg_market_stock_pi_liquidity_state_updated_at ON public.market_stock_pi_liquidity_state;
CREATE TRIGGER trg_market_stock_pi_liquidity_state_updated_at
BEFORE UPDATE ON public.market_stock_pi_liquidity_state
FOR EACH ROW EXECUTE FUNCTION public.market_stock_set_updated_at();

ALTER TABLE public.market_stock_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_stock_pi_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_stock_pi_redemption_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_stock_pi_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_stock_pi_ledger_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_stock_pi_liquidity_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS market_stock_quotes_read_self ON public.market_stock_quotes;
CREATE POLICY market_stock_quotes_read_self ON public.market_stock_quotes
FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS market_stock_pi_payments_read_self ON public.market_stock_pi_payments;
CREATE POLICY market_stock_pi_payments_read_self ON public.market_stock_pi_payments
FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS market_stock_pi_queue_read_self ON public.market_stock_pi_redemption_queue;
CREATE POLICY market_stock_pi_queue_read_self ON public.market_stock_pi_redemption_queue
FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS market_stock_pi_payouts_read_self ON public.market_stock_pi_payouts;
CREATE POLICY market_stock_pi_payouts_read_self ON public.market_stock_pi_payouts
FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS market_stock_pi_ledger_read_self ON public.market_stock_pi_ledger_events;
CREATE POLICY market_stock_pi_ledger_read_self ON public.market_stock_pi_ledger_events
FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS market_stock_pi_liquidity_state_read ON public.market_stock_pi_liquidity_state;
CREATE POLICY market_stock_pi_liquidity_state_read ON public.market_stock_pi_liquidity_state
FOR SELECT TO anon, authenticated USING (true);

GRANT SELECT ON public.market_stock_quotes TO authenticated;
GRANT SELECT ON public.market_stock_pi_payments TO authenticated;
GRANT SELECT ON public.market_stock_pi_redemption_queue TO authenticated;
GRANT SELECT ON public.market_stock_pi_payouts TO authenticated;
GRANT SELECT ON public.market_stock_pi_ledger_events TO authenticated;
GRANT SELECT ON public.market_stock_pi_liquidity_state TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.market_stock_pi_apply_state_delta(uuid, numeric, numeric, numeric, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.market_stock_pi_fill_buy(uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.market_stock_pi_finalize_payout(uuid, text, jsonb) TO service_role;

CREATE OR REPLACE VIEW public.market_stock_pi_liquidity_metrics_v AS
WITH queue_totals AS (
  SELECT
    q.stock_id,
    COALESCE(SUM(q.locked_net_payout_pi), 0)::numeric(30,8) AS queued_liability_pi
  FROM public.market_stock_pi_redemption_queue q
  WHERE q.status IN ('QUEUED', 'PROCESSING')
  GROUP BY q.stock_id
),
payout_window AS (
  SELECT
    p.stock_id,
    COALESCE(SUM(p.amount_pi), 0)::numeric(30,8) AS spent_24h_pi
  FROM public.market_stock_pi_payouts p
  WHERE p.status = 'CONFIRMED'
    AND COALESCE(p.confirmed_at, p.updated_at, p.created_at) >= now() - interval '24 hours'
  GROUP BY p.stock_id
),
base AS (
  SELECT
    i.id AS stock_id,
    COALESCE(s.pool_pi_reserved, 0)::numeric(30,8) AS pool_pi_reserved,
    COALESCE(q.queued_liability_pi, 0)::numeric(30,8) AS queued_liability_pi,
    COALESCE(s.inflow_ema_24h, 0)::numeric(30,8) AS inflow_ema_24h,
    COALESCE(s.outflow_ema_24h, 0)::numeric(30,8) AS outflow_ema_24h,
    GREATEST(COALESCE(p.spent_24h_pi, 0), 0)::numeric(30,8) AS spent_24h_pi
  FROM public.market_stock_identities i
  LEFT JOIN public.market_stock_pi_liquidity_state s ON s.stock_id = i.id
  LEFT JOIN queue_totals q ON q.stock_id = i.id
  LEFT JOIN payout_window p ON p.stock_id = i.id
),
ratios AS (
  SELECT
    b.*,
    (b.pool_pi_reserved / GREATEST(b.queued_liability_pi, 0.00000001))::numeric(20,8) AS coverage_ratio,
    ((b.inflow_ema_24h + 0.00000001) / (b.outflow_ema_24h + 0.00000001))::numeric(20,8) AS flow_balance
  FROM base b
),
stress AS (
  SELECT
    r.*,
    LEAST(
      3.0,
      GREATEST(
        0.0,
        0.7 * (1.0 / GREATEST(r.coverage_ratio, 0.00000001))
        + 0.3 * (1.0 / GREATEST(r.flow_balance, 0.00000001))
      )
    )::numeric(20,8) AS lpi
  FROM ratios r
),
budgeted AS (
  SELECT
    s.*,
    LEAST(1.2, GREATEST(0.1, 1.2 - 0.5 * s.lpi))::numeric(20,8) AS budget_multiplier,
    (s.pool_pi_reserved * 0.02)::numeric(30,8) AS base_budget_pi
  FROM stress s
)
SELECT
  b.stock_id,
  b.pool_pi_reserved,
  b.queued_liability_pi,
  b.inflow_ema_24h,
  b.outflow_ema_24h,
  b.spent_24h_pi,
  b.coverage_ratio,
  b.flow_balance,
  b.lpi,
  b.budget_multiplier,
  b.base_budget_pi,
  (b.base_budget_pi * b.budget_multiplier)::numeric(30,8) AS budget_pi,
  GREATEST(
    0,
    (b.base_budget_pi * b.budget_multiplier) - b.spent_24h_pi
  )::numeric(30,8) AS available_budget_pi,
  LEAST(1200, GREATEST(0, ROUND(b.lpi * 300)))::integer AS sell_spread_bps,
  LEAST(300, GREATEST(10, ROUND(30 + b.lpi * 45)))::integer AS cooldown_seconds,
  LEAST(500, GREATEST(50, ROUND(50 + b.lpi * 120)))::integer AS early_exit_fee_bps,
  GREATEST(0.25, LEAST(1.0, 1.0 - b.lpi * 0.18))::numeric(20,8) AS supply_release_multiplier,
  (b.coverage_ratio < 0.15 OR b.lpi >= 2.85) AS sells_paused
FROM budgeted b;

CREATE OR REPLACE FUNCTION public.market_stock_pi_lock_sell(
  p_quote_id uuid,
  p_order_id uuid,
  p_stock_id uuid,
  p_user_id uuid,
  p_quote_ref text,
  p_recipient_pi_uid text,
  p_recipient_wallet text,
  p_idempotency_key text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  queue_id uuid,
  order_id uuid,
  locked_qty numeric,
  locked_payout_pi numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quote public.market_stock_quotes%ROWTYPE;
  v_position public.market_stock_positions%ROWTYPE;
  v_existing_queue public.market_stock_pi_redemption_queue%ROWTYPE;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.market_stock_pi_ledger_events e
    WHERE e.idempotency_key = p_idempotency_key
  ) THEN
    SELECT q.*
    INTO v_existing_queue
    FROM public.market_stock_pi_redemption_queue q
    WHERE q.quote_id = p_quote_id;

    IF v_existing_queue.id IS NOT NULL THEN
      RETURN QUERY
      SELECT
        v_existing_queue.id,
        v_existing_queue.order_id,
        v_existing_queue.quantity_locked,
        v_existing_queue.locked_net_payout_pi;
      RETURN;
    END IF;
  END IF;

  SELECT *
  INTO v_quote
  FROM public.market_stock_quotes
  WHERE id = p_quote_id
    AND stock_id = p_stock_id
    AND user_id = p_user_id
    AND side = 'sell'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sell quote not found';
  END IF;

  IF v_quote.status = 'CONSUMED' THEN
    SELECT q.*
    INTO v_existing_queue
    FROM public.market_stock_pi_redemption_queue q
    WHERE q.quote_id = p_quote_id;

    IF v_existing_queue.id IS NULL THEN
      RAISE EXCEPTION 'Sell quote already consumed';
    END IF;

    RETURN QUERY
    SELECT
      v_existing_queue.id,
      v_existing_queue.order_id,
      v_existing_queue.quantity_locked,
      v_existing_queue.locked_net_payout_pi;
    RETURN;
  END IF;

  IF v_quote.status <> 'OPEN' THEN
    RAISE EXCEPTION 'Sell quote is not open';
  END IF;

  IF v_quote.quote_expires_at <= now() THEN
    UPDATE public.market_stock_quotes
    SET status = 'EXPIRED', updated_at = now()
    WHERE id = v_quote.id;
    RAISE EXCEPTION 'Sell quote expired';
  END IF;

  SELECT *
  INTO v_position
  FROM public.market_stock_positions
  WHERE stock_id = p_stock_id
    AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No stock position found';
  END IF;

  IF COALESCE(v_position.balance_qty, 0) - COALESCE(v_position.locked_redemption_qty, 0) < v_quote.quantity THEN
    RAISE EXCEPTION 'Insufficient available balance';
  END IF;

  UPDATE public.market_stock_positions
  SET
    locked_redemption_qty = COALESCE(locked_redemption_qty, 0) + v_quote.quantity,
    updated_at = now()
  WHERE stock_id = p_stock_id
    AND user_id = p_user_id;

  UPDATE public.market_stock_orders
  SET
    status = 'submitted',
    settlement_rail = 'pi',
    quote_ref = p_quote_ref,
    updated_at = now()
  WHERE id = p_order_id
    AND user_id = p_user_id;

  UPDATE public.market_stock_quotes
  SET status = 'CONSUMED', updated_at = now()
  WHERE id = v_quote.id;

  INSERT INTO public.market_stock_pi_redemption_queue (
    stock_id,
    user_id,
    order_id,
    quote_id,
    quote_ref,
    recipient_pi_uid,
    recipient_wallet,
    quantity_locked,
    locked_gross_usdc,
    locked_fee_usdc,
    locked_net_usdc,
    locked_net_payout_pi,
    raw
  )
  VALUES (
    p_stock_id,
    p_user_id,
    p_order_id,
    p_quote_id,
    p_quote_ref,
    p_recipient_pi_uid,
    p_recipient_wallet,
    v_quote.quantity,
    v_quote.gross_usdc,
    v_quote.fee_usdc,
    v_quote.net_usdc,
    v_quote.net_pi,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING * INTO v_existing_queue;

  PERFORM public.market_stock_pi_apply_state_delta(
    p_stock_id,
    0,
    v_quote.net_pi,
    0,
    0
  );

  INSERT INTO public.market_stock_pi_ledger_events (
    stock_id,
    user_id,
    order_id,
    quote_id,
    queue_id,
    event_type,
    idempotency_key,
    delta_locked_qty,
    delta_queued_liability_pi,
    amount_usdc,
    amount_pi,
    metadata
  )
  VALUES (
    p_stock_id,
    p_user_id,
    p_order_id,
    p_quote_id,
    v_existing_queue.id,
    'SELL_LOCKED',
    p_idempotency_key,
    v_quote.quantity,
    v_quote.net_pi,
    v_quote.net_usdc,
    v_quote.net_pi,
    COALESCE(p_metadata, '{}'::jsonb)
  );

  RETURN QUERY
  SELECT
    v_existing_queue.id,
    v_existing_queue.order_id,
    v_existing_queue.quantity_locked,
    v_existing_queue.locked_net_payout_pi;
END;
$$;

GRANT SELECT ON public.market_stock_pi_liquidity_metrics_v TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.market_stock_pi_lock_sell(uuid, uuid, uuid, uuid, text, text, text, text, jsonb) TO service_role;

COMMIT;
