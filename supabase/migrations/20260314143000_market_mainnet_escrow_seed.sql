INSERT INTO public.market_chain_config (
  chain,
  chain_id,
  rpc_url,
  usdc_address,
  escrow_address,
  confirmations_required,
  active,
  usdt_address,
  fee_bps,
  identity_stable_address,
  updated_at
)
VALUES
  (
    'ethereum',
    1,
    null,
    '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    '0x0000000000000000000000000000000000000000',
    12,
    false,
    '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    50,
    '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    now()
  ),
  (
    'base',
    8453,
    null,
    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    '0x0000000000000000000000000000000000000000',
    12,
    false,
    null,
    50,
    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    now()
  ),
  (
    'arbitrum',
    42161,
    null,
    '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    '0x0000000000000000000000000000000000000000',
    12,
    false,
    null,
    50,
    '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    now()
  ),
  (
    'optimism',
    10,
    null,
    '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    '0x0000000000000000000000000000000000000000',
    12,
    false,
    null,
    50,
    '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    now()
  ),
  (
    'polygon',
    137,
    null,
    '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    '0x0000000000000000000000000000000000000000',
    12,
    false,
    null,
    50,
    '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    now()
  ),
  (
    'bnb',
    56,
    null,
    '0x0000000000000000000000000000000000000000',
    '0x0000000000000000000000000000000000000000',
    12,
    false,
    null,
    50,
    null,
    now()
  )
ON CONFLICT (chain) DO UPDATE
SET
  chain_id = EXCLUDED.chain_id,
  rpc_url = COALESCE(NULLIF(public.market_chain_config.rpc_url, ''), EXCLUDED.rpc_url),
  usdc_address = CASE
    WHEN public.market_chain_config.usdc_address IS NULL
      OR public.market_chain_config.usdc_address = ''
      OR public.market_chain_config.usdc_address = '0x0000000000000000000000000000000000000000'
    THEN EXCLUDED.usdc_address
    ELSE public.market_chain_config.usdc_address
  END,
  escrow_address = CASE
    WHEN public.market_chain_config.escrow_address IS NULL
      OR public.market_chain_config.escrow_address = ''
      OR public.market_chain_config.escrow_address = '0x0000000000000000000000000000000000000000'
    THEN EXCLUDED.escrow_address
    ELSE public.market_chain_config.escrow_address
  END,
  confirmations_required = EXCLUDED.confirmations_required,
  usdt_address = COALESCE(NULLIF(public.market_chain_config.usdt_address, ''), EXCLUDED.usdt_address),
  fee_bps = CASE
    WHEN COALESCE(public.market_chain_config.fee_bps, 0) = 0 THEN EXCLUDED.fee_bps
    ELSE public.market_chain_config.fee_bps
  END,
  identity_stable_address = COALESCE(
    NULLIF(public.market_chain_config.identity_stable_address, ''),
    EXCLUDED.identity_stable_address
  ),
  active = CASE
    WHEN public.market_chain_config.escrow_address IS NULL
      OR public.market_chain_config.escrow_address = ''
      OR public.market_chain_config.escrow_address = '0x0000000000000000000000000000000000000000'
    THEN false
    ELSE public.market_chain_config.active
  END,
  updated_at = now();
