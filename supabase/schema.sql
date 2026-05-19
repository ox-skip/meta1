-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.app_fee_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope = ANY (ARRAY['deposit'::text, 'withdrawal'::text, 'bill'::text, 'transfer'::text, 'market'::text])),
  flat_fee numeric NOT NULL DEFAULT 0,
  percent_fee numeric NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT app_fee_rules_pkey PRIMARY KEY (id)
);
CREATE TABLE public.app_wallet_tx_simple (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type text NOT NULL CHECK (type = ANY (ARRAY['deposit'::text, 'transfer_in'::text, 'transfer_out'::text, 'withdrawal'::text, 'fee'::text, 'bill'::text])),
  amount numeric NOT NULL CHECK (amount >= 0::numeric),
  reference text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT app_wallet_tx_simple_pkey PRIMARY KEY (id),
  CONSTRAINT app_wallet_tx_simple_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.app_wallets_simple (
  user_id uuid NOT NULL,
  balance numeric NOT NULL DEFAULT 0,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT app_wallets_simple_pkey PRIMARY KEY (user_id),
  CONSTRAINT app_wallets_simple_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.banks_ng (
  code text NOT NULL,
  name text NOT NULL,
  slug text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT banks_ng_pkey PRIMARY KEY (code)
);
CREATE TABLE public.market_audit_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  actor_id uuid,
  actor_type text NOT NULL CHECK (actor_type = ANY (ARRAY['user'::text, 'system'::text, 'admin'::text, 'webhook'::text])),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT market_audit_logs_pkey PRIMARY KEY (id)
);
CREATE TABLE public.market_chain_config (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  chain USER-DEFINED NOT NULL UNIQUE,
  chain_id integer NOT NULL,
  rpc_url text,
  usdc_address text NOT NULL,
  escrow_address text NOT NULL,
  confirmations_required integer NOT NULL DEFAULT 3 CHECK (confirmations_required >= 1 AND confirmations_required <= 50),
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT market_chain_config_pkey PRIMARY KEY (id)
);
CREATE TABLE public.market_chain_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  chain USER-DEFINED NOT NULL DEFAULT 'base'::chain_name,
  event_type USER-DEFINED NOT NULL,
  order_id uuid NOT NULL,
  tx_hash text NOT NULL,
  log_index integer NOT NULL DEFAULT 0,
  block_number bigint NOT NULL,
  block_time timestamp with time zone,
  buyer_wallet text,
  seller_wallet text,
  amount_raw text,
  amount_units numeric,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT market_chain_events_pkey PRIMARY KEY (id),
  CONSTRAINT market_chain_events_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.market_orders(id)
);
CREATE TABLE public.market_crypto_escrows (
  order_id uuid NOT NULL,
  chain USER-DEFINED NOT NULL DEFAULT 'base'::chain_name,
  buyer_wallet text,
  seller_wallet text,
  token_address text NOT NULL,
  escrow_address text NOT NULL,
  amount_units numeric NOT NULL DEFAULT 0,
  amount_raw text,
  deposited_tx_hash text UNIQUE,
  released_tx_hash text UNIQUE,
  refunded_tx_hash text UNIQUE,
  deposited_at timestamp with time zone,
  released_at timestamp with time zone,
  refunded_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  order_key text UNIQUE,
  CONSTRAINT market_crypto_escrows_pkey PRIMARY KEY (order_id),
  CONSTRAINT market_crypto_escrows_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.market_orders(id)
);
CREATE TABLE public.market_crypto_intents (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  intent_type USER-DEFINED NOT NULL,
  status USER-DEFINED NOT NULL DEFAULT 'CREATED'::crypto_intent_status,
  chain USER-DEFINED NOT NULL DEFAULT 'base'::chain_name,
  from_wallet text,
  to_wallet text,
  token_address text,
  escrow_address text,
  amount_units numeric,
  amount_raw text,
  client_reference text,
  tx_hash text,
  failure_reason text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  order_key text,
  CONSTRAINT market_crypto_intents_pkey PRIMARY KEY (id),
  CONSTRAINT market_crypto_intents_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.market_orders(id)
);
CREATE TABLE public.market_deliverables (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE,
  storage_path_full text NOT NULL,
  storage_path_preview text NOT NULL,
  uploaded_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT market_deliverables_pkey PRIMARY KEY (id),
  CONSTRAINT market_deliverables_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.market_orders(id),
  CONSTRAINT market_deliverables_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.profiles(id)
);
CREATE TABLE public.market_disputes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE,
  opened_by uuid NOT NULL,
  reason text NOT NULL,
  status USER-DEFINED NOT NULL DEFAULT 'OPEN'::market_dispute_status,
  resolution USER-DEFINED,
  resolved_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT market_disputes_pkey PRIMARY KEY (id),
  CONSTRAINT market_disputes_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.market_orders(id),
  CONSTRAINT market_disputes_opened_by_fkey FOREIGN KEY (opened_by) REFERENCES public.profiles(id),
  CONSTRAINT market_disputes_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.profiles(id)
);
CREATE TABLE public.market_escrow_ledger (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE,
  provider text NOT NULL CHECK (provider = ANY (ARRAY['wallet_ngn'::text, 'paystack'::text, 'base_usdc'::text])),
  reference text NOT NULL,
  locked_at timestamp with time zone,
  released_at timestamp with time zone,
  refunded_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  amount_locked numeric NOT NULL DEFAULT 0,
  fee_amount numeric NOT NULL DEFAULT 0,
  total_debit numeric NOT NULL DEFAULT 0,
  CONSTRAINT market_escrow_ledger_pkey PRIMARY KEY (id),
  CONSTRAINT market_escrow_ledger_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.market_orders(id)
);
CREATE TABLE public.market_fee_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  flat_fee numeric NOT NULL DEFAULT 0 CHECK (flat_fee >= 0::numeric),
  percent_fee numeric NOT NULL DEFAULT 0 CHECK (percent_fee >= 0::numeric),
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT market_fee_rules_pkey PRIMARY KEY (id)
);
CREATE TABLE public.market_idempotency_keys (
  key text NOT NULL,
  scope text NOT NULL,
  consumed_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT market_idempotency_keys_pkey PRIMARY KEY (key)
);
CREATE TABLE public.market_listing_images (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL,
  storage_path text NOT NULL,
  public_url text,
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT market_listing_images_pkey PRIMARY KEY (id),
  CONSTRAINT market_listing_images_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.market_listings(id)
);
CREATE TABLE public.market_listings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL,
  category USER-DEFINED NOT NULL,
  sub_category text NOT NULL,
  title text NOT NULL,
  description text,
  price_amount numeric NOT NULL CHECK (price_amount > 0::numeric),
  currency USER-DEFINED NOT NULL DEFAULT 'NGN'::market_currency,
  delivery_type USER-DEFINED NOT NULL,
  stock_qty integer CHECK (stock_qty IS NULL OR stock_qty >= 0),
  is_active boolean NOT NULL DEFAULT true,
  featured_enabled boolean NOT NULL DEFAULT false,
  featured_until timestamp with time zone,
  featured_priority integer NOT NULL DEFAULT 100 CHECK (featured_priority >= 0 AND featured_priority <= 100000),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  cover_image_id uuid,
  CONSTRAINT market_listings_pkey PRIMARY KEY (id),
  CONSTRAINT market_listings_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.profiles(id),
  CONSTRAINT market_listings_cover_image_fk FOREIGN KEY (cover_image_id) REFERENCES public.market_listing_images(id)
);
CREATE TABLE public.market_order_otps (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE,
  otp_hash text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 10),
  verified_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT market_order_otps_pkey PRIMARY KEY (id),
  CONSTRAINT market_order_otps_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.market_orders(id)
);
CREATE TABLE public.market_orders (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  buyer_id uuid NOT NULL,
  seller_id uuid NOT NULL,
  listing_id uuid NOT NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  unit_price numeric NOT NULL CHECK (unit_price > 0::numeric),
  amount numeric NOT NULL CHECK (amount > 0::numeric),
  currency USER-DEFINED NOT NULL DEFAULT 'NGN'::market_currency,
  status USER-DEFINED NOT NULL DEFAULT 'CREATED'::market_order_status,
  version integer NOT NULL DEFAULT 0,
  fee_amount numeric NOT NULL DEFAULT 0 CHECK (fee_amount >= 0::numeric),
  wallet_debit_tx_id uuid,
  wallet_credit_tx_id uuid,
  wallet_fee_tx_id uuid,
  delivery_address jsonb NOT NULL DEFAULT '{}'::jsonb,
  note text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  in_escrow_at timestamp with time zone,
  out_for_delivery_at timestamp with time zone,
  deliverable_uploaded_at timestamp with time zone,
  delivered_at timestamp with time zone,
  released_at timestamp with time zone,
  refunded_at timestamp with time zone,
  cancelled_at timestamp with time zone,
  CONSTRAINT market_orders_pkey PRIMARY KEY (id),
  CONSTRAINT market_orders_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.profiles(id),
  CONSTRAINT market_orders_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.profiles(id),
  CONSTRAINT market_orders_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.market_listings(id)
);
CREATE TABLE public.market_reviews (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  reviewer_id uuid NOT NULL,
  reviewee_id uuid NOT NULL,
  rating integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT market_reviews_pkey PRIMARY KEY (id),
  CONSTRAINT market_reviews_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.market_orders(id),
  CONSTRAINT market_reviews_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES public.profiles(id),
  CONSTRAINT market_reviews_reviewee_id_fkey FOREIGN KEY (reviewee_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.market_seller_profiles (
  user_id uuid NOT NULL,
  market_username text UNIQUE,
  display_name text,
  business_name text NOT NULL,
  bio text,
  phone text,
  location_text text,
  address jsonb NOT NULL DEFAULT '{}'::jsonb,
  logo_path text,
  banner_path text,
  offers_remote boolean NOT NULL DEFAULT false,
  offers_in_person boolean NOT NULL DEFAULT false,
  is_verified boolean NOT NULL DEFAULT false,
  risk_score integer NOT NULL DEFAULT 0 CHECK (risk_score >= 0 AND risk_score <= 100),
  active boolean NOT NULL DEFAULT true,
  featured_enabled boolean NOT NULL DEFAULT false,
  featured_until timestamp with time zone,
  featured_listing_limit integer NOT NULL DEFAULT 12 CHECK (featured_listing_limit >= 1 AND featured_listing_limit <= 100),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  payout_tier text NOT NULL DEFAULT 'standard'::text CHECK (payout_tier = ANY (ARRAY['standard'::text, 'fast'::text])),
  CONSTRAINT market_seller_profiles_pkey PRIMARY KEY (user_id),
  CONSTRAINT market_seller_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.market_verification_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  status text NOT NULL CHECK (status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text])),
  note text,
  admin_note text,
  submitted_at timestamp with time zone NOT NULL DEFAULT now(),
  reviewed_at timestamp with time zone,
  reviewed_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT market_verification_requests_pkey PRIMARY KEY (id),
  CONSTRAINT market_verification_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.market_wallet_events (
  order_id uuid NOT NULL,
  locked_tx_id uuid,
  released_tx_id uuid,
  refunded_tx_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT market_wallet_events_pkey PRIMARY KEY (order_id),
  CONSTRAINT market_wallet_events_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.market_orders(id)
);
CREATE TABLE public.paystack_events_simple (
  reference text NOT NULL,
  user_id uuid NOT NULL,
  amount numeric NOT NULL,
  fee numeric NOT NULL DEFAULT 0,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT paystack_events_simple_pkey PRIMARY KEY (reference),
  CONSTRAINT paystack_events_simple_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.profiles (
  id uuid NOT NULL,
  email text UNIQUE,
  username text UNIQUE,
  full_name text,
  created_at timestamp with time zone DEFAULT now(),
  public_uid text NOT NULL DEFAULT encode(gen_random_bytes(8), 'hex'::text),
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
);
CREATE TABLE public.app_onboarding_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  flow_key text NOT NULL,
  flow_title text NOT NULL,
  status text NOT NULL,
  completed_steps integer NOT NULL DEFAULT 0,
  total_steps integer NOT NULL DEFAULT 1,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT app_onboarding_events_pkey PRIMARY KEY (id),
  CONSTRAINT app_onboarding_events_steps_check CHECK ((completed_steps >= 0) AND (total_steps > 0) AND (completed_steps <= total_steps)),
  CONSTRAINT app_onboarding_events_status_check CHECK ((status = ANY (ARRAY['completed'::text, 'skipped'::text]))),
  CONSTRAINT app_onboarding_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);
CREATE TABLE public.user_virtual_accounts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  paystack_customer_code text,
  paystack_dedicated_account_id bigint,
  account_number text NOT NULL,
  bank_name text NOT NULL,
  account_name text NOT NULL,
  currency text NOT NULL DEFAULT 'NGN'::text,
  provider_slug text,
  active boolean NOT NULL DEFAULT true,
  raw jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT user_virtual_accounts_pkey PRIMARY KEY (id),
  CONSTRAINT user_virtual_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.withdrawal_limits_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tier text NOT NULL CHECK (tier = ANY (ARRAY['standard'::text, 'fast'::text])),
  daily_cap numeric NOT NULL DEFAULT 0 CHECK (daily_cap >= 0::numeric),
  monthly_cap numeric NOT NULL DEFAULT 0 CHECK (monthly_cap >= 0::numeric),
  min_interval_minutes integer NOT NULL DEFAULT 0 CHECK (min_interval_minutes >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT withdrawal_limits_rules_pkey PRIMARY KEY (id)
);
CREATE TABLE public.withdrawals_simple (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0::numeric),
  fee numeric NOT NULL DEFAULT 0,
  total_debit numeric NOT NULL DEFAULT 0,
  bank_name text,
  account_number text,
  account_name text,
  paystack_reference text UNIQUE,
  paystack_transfer_code text,
  status text NOT NULL DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'processing'::text, 'successful'::text, 'failed'::text, 'reversed'::text, 'refunded'::text])),
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT withdrawals_simple_pkey PRIMARY KEY (id),
  CONSTRAINT withdrawals_simple_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
