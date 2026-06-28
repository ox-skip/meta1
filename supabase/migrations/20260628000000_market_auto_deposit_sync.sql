-- RPC function to log deposit auto-sync results for auditing
-- The market_chain_sync table already exists and is used by market-escrow-poller
CREATE OR REPLACE FUNCTION public.market_poll_deposit_sync_rpc(p_results jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.market_audit_logs (
    actor_type,
    action,
    entity_type,
    payload
  ) VALUES (
    'system',
    'DEPOSIT_AUTO_SYNC',
    'chain',
    p_results
  );
  RETURN jsonb_build_object('logged', true, 'timestamp', now());
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('logged', false, 'error', SQLERRM);
END;
$$;