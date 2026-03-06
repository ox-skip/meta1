BEGIN;

CREATE TABLE IF NOT EXISTS public.market_verification_provider_events (
  provider text NOT NULL,
  event_id text NOT NULL,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  provider_applicant_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT market_verification_provider_events_pkey PRIMARY KEY (provider, event_id)
);

ALTER TABLE public.market_verification_requests
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS verification_type text NOT NULL DEFAULT 'government_id',
  ADD COLUMN IF NOT EXISTS provider_applicant_id text,
  ADD COLUMN IF NOT EXISTS provider_external_user_id text,
  ADD COLUMN IF NOT EXISTS provider_level_name text,
  ADD COLUMN IF NOT EXISTS provider_review_status text,
  ADD COLUMN IF NOT EXISTS provider_review_answer text,
  ADD COLUMN IF NOT EXISTS provider_review_reject_type text,
  ADD COLUMN IF NOT EXISTS provider_reject_labels jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS country_code text,
  ADD COLUMN IF NOT EXISTS document_type text,
  ADD COLUMN IF NOT EXISTS verification_url text,
  ADD COLUMN IF NOT EXISTS verification_url_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_last_event_type text,
  ADD COLUMN IF NOT EXISTS provider_last_event_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text;

UPDATE public.market_verification_requests
SET
  status = CASE
    WHEN status = 'APPROVED' THEN 'VERIFIED'
    WHEN status = 'PENDING' THEN 'PENDING'
    WHEN status = 'REJECTED' THEN 'REJECTED'
    ELSE 'PENDING'
  END,
  provider = COALESCE(NULLIF(provider, ''), 'manual'),
  verification_type = COALESCE(NULLIF(verification_type, ''), 'government_id'),
  verified_at = CASE
    WHEN status = 'APPROVED' THEN COALESCE(verified_at, reviewed_at, updated_at, submitted_at)
    ELSE verified_at
  END
WHERE true;

ALTER TABLE public.market_verification_requests
  DROP CONSTRAINT IF EXISTS market_verification_requests_status_check;

ALTER TABLE public.market_verification_requests
  ADD CONSTRAINT market_verification_requests_status_check
  CHECK (
    status = ANY (
      ARRAY[
        'PENDING'::text,
        'IN_REVIEW'::text,
        'VERIFIED'::text,
        'REJECTED'::text,
        'RESUBMISSION_REQUIRED'::text,
        'EXPIRED'::text
      ]
    )
  );

ALTER TABLE public.market_verification_requests
  DROP CONSTRAINT IF EXISTS market_verification_requests_verification_type_check;

ALTER TABLE public.market_verification_requests
  ADD CONSTRAINT market_verification_requests_verification_type_check
  CHECK (verification_type = 'government_id');

CREATE UNIQUE INDEX IF NOT EXISTS market_verification_requests_provider_applicant_uidx
  ON public.market_verification_requests (provider, provider_applicant_id)
  WHERE provider_applicant_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS market_verification_requests_provider_external_uidx
  ON public.market_verification_requests (provider, provider_external_user_id)
  WHERE provider_external_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS market_verification_requests_status_idx
  ON public.market_verification_requests (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS market_verification_provider_events_user_idx
  ON public.market_verification_provider_events (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.market_verification_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_market_verification_requests_updated_at ON public.market_verification_requests;
CREATE TRIGGER trg_market_verification_requests_updated_at
BEFORE UPDATE ON public.market_verification_requests
FOR EACH ROW EXECUTE FUNCTION public.market_verification_touch_updated_at();

CREATE OR REPLACE FUNCTION public.market_apply_verification_provider_result(
  p_provider text,
  p_event_id text,
  p_event_type text,
  p_user_id uuid,
  p_status text,
  p_provider_applicant_id text DEFAULT NULL,
  p_provider_external_user_id text DEFAULT NULL,
  p_provider_level_name text DEFAULT NULL,
  p_provider_review_status text DEFAULT NULL,
  p_provider_review_answer text DEFAULT NULL,
  p_provider_review_reject_type text DEFAULT NULL,
  p_provider_reject_labels jsonb DEFAULT '[]'::jsonb,
  p_country_code text DEFAULT NULL,
  p_document_type text DEFAULT NULL,
  p_provider_event_at timestamptz DEFAULT NULL,
  p_verified_at timestamptz DEFAULT NULL,
  p_last_error text DEFAULT NULL
)
RETURNS TABLE(applied boolean, request_id uuid, seller_verified boolean)
LANGUAGE plpgsql
AS $$
DECLARE
  v_status text := upper(COALESCE(NULLIF(p_status, ''), 'PENDING'));
  v_provider text := lower(COALESCE(NULLIF(p_provider, ''), 'didit'));
  v_request_id uuid;
  v_existing_verified boolean := false;
  v_event_at timestamptz := COALESCE(p_provider_event_at, now());
BEGIN
  IF v_status NOT IN ('PENDING', 'IN_REVIEW', 'VERIFIED', 'REJECTED', 'RESUBMISSION_REQUIRED', 'EXPIRED') THEN
    RAISE EXCEPTION 'Unsupported verification status: %', v_status;
  END IF;

  INSERT INTO public.market_verification_provider_events (
    provider,
    event_id,
    user_id,
    event_type,
    provider_applicant_id
  )
  VALUES (
    v_provider,
    p_event_id,
    p_user_id,
    COALESCE(NULLIF(p_event_type, ''), 'provider_event'),
    NULLIF(p_provider_applicant_id, '')
  )
  ON CONFLICT (provider, event_id) DO NOTHING;

  IF NOT FOUND THEN
    SELECT id INTO v_request_id
    FROM public.market_verification_requests
    WHERE user_id = p_user_id;

    SELECT COALESCE(is_verified, false) INTO v_existing_verified
    FROM public.market_seller_profiles
    WHERE user_id = p_user_id;

    RETURN QUERY SELECT false, v_request_id, v_existing_verified;
    RETURN;
  END IF;

  INSERT INTO public.market_verification_requests (
    user_id,
    status,
    note,
    admin_note,
    submitted_at,
    reviewed_at,
    reviewed_by,
    created_at,
    updated_at,
    provider,
    verification_type,
    provider_applicant_id,
    provider_external_user_id,
    provider_level_name,
    provider_review_status,
    provider_review_answer,
    provider_review_reject_type,
    provider_reject_labels,
    country_code,
    document_type,
    provider_last_event_type,
    provider_last_event_at,
    verified_at,
    last_error
  )
  VALUES (
    p_user_id,
    v_status,
    NULL,
    NULL,
    now(),
    CASE WHEN v_status IN ('VERIFIED', 'REJECTED', 'RESUBMISSION_REQUIRED') THEN v_event_at ELSE NULL END,
    NULL,
    now(),
    now(),
    v_provider,
    'government_id',
    NULLIF(p_provider_applicant_id, ''),
    NULLIF(p_provider_external_user_id, ''),
    NULLIF(p_provider_level_name, ''),
    NULLIF(p_provider_review_status, ''),
    NULLIF(p_provider_review_answer, ''),
    NULLIF(p_provider_review_reject_type, ''),
    COALESCE(p_provider_reject_labels, '[]'::jsonb),
    NULLIF(upper(COALESCE(p_country_code, '')), ''),
    NULLIF(p_document_type, ''),
    COALESCE(NULLIF(p_event_type, ''), 'provider_event'),
    v_event_at,
    CASE WHEN v_status = 'VERIFIED' THEN COALESCE(p_verified_at, v_event_at) ELSE NULL END,
    NULLIF(p_last_error, '')
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    status = EXCLUDED.status,
    provider = EXCLUDED.provider,
    verification_type = EXCLUDED.verification_type,
    provider_applicant_id = COALESCE(EXCLUDED.provider_applicant_id, public.market_verification_requests.provider_applicant_id),
    provider_external_user_id = COALESCE(EXCLUDED.provider_external_user_id, public.market_verification_requests.provider_external_user_id),
    provider_level_name = COALESCE(EXCLUDED.provider_level_name, public.market_verification_requests.provider_level_name),
    provider_review_status = COALESCE(EXCLUDED.provider_review_status, public.market_verification_requests.provider_review_status),
    provider_review_answer = COALESCE(EXCLUDED.provider_review_answer, public.market_verification_requests.provider_review_answer),
    provider_review_reject_type = COALESCE(EXCLUDED.provider_review_reject_type, public.market_verification_requests.provider_review_reject_type),
    provider_reject_labels = CASE
      WHEN jsonb_typeof(EXCLUDED.provider_reject_labels) = 'array' AND jsonb_array_length(EXCLUDED.provider_reject_labels) > 0
        THEN EXCLUDED.provider_reject_labels
      ELSE public.market_verification_requests.provider_reject_labels
    END,
    country_code = COALESCE(EXCLUDED.country_code, public.market_verification_requests.country_code),
    document_type = COALESCE(EXCLUDED.document_type, public.market_verification_requests.document_type),
    provider_last_event_type = EXCLUDED.provider_last_event_type,
    provider_last_event_at = EXCLUDED.provider_last_event_at,
    reviewed_at = CASE
      WHEN EXCLUDED.status IN ('VERIFIED', 'REJECTED', 'RESUBMISSION_REQUIRED')
        THEN COALESCE(EXCLUDED.provider_last_event_at, now())
      ELSE public.market_verification_requests.reviewed_at
    END,
    verified_at = CASE
      WHEN EXCLUDED.status = 'VERIFIED'
        THEN COALESCE(EXCLUDED.verified_at, public.market_verification_requests.verified_at, now())
      ELSE public.market_verification_requests.verified_at
    END,
    verification_url = CASE
      WHEN EXCLUDED.status = 'VERIFIED' THEN NULL
      ELSE public.market_verification_requests.verification_url
    END,
    verification_url_expires_at = CASE
      WHEN EXCLUDED.status = 'VERIFIED' THEN NULL
      ELSE public.market_verification_requests.verification_url_expires_at
    END,
    last_error = CASE
      WHEN EXCLUDED.status = 'VERIFIED' THEN NULL
      ELSE COALESCE(EXCLUDED.last_error, public.market_verification_requests.last_error)
    END,
    updated_at = now()
  RETURNING id INTO v_request_id;

  IF v_status = 'VERIFIED' THEN
    UPDATE public.market_seller_profiles
    SET
      is_verified = true,
      updated_at = now()
    WHERE user_id = p_user_id;
  END IF;

  SELECT COALESCE(is_verified, false) INTO v_existing_verified
  FROM public.market_seller_profiles
  WHERE user_id = p_user_id;

  INSERT INTO public.market_audit_logs (
    actor_id,
    actor_type,
    action,
    entity_type,
    entity_id,
    payload
  )
  VALUES (
    NULL,
    'webhook',
    'seller_verification_status_changed',
    'market_verification_requests',
    v_request_id,
    jsonb_build_object(
      'provider', v_provider,
      'event_id', p_event_id,
      'event_type', p_event_type,
      'status', v_status,
      'user_id', p_user_id
    )
  );

  RETURN QUERY SELECT true, v_request_id, v_existing_verified;
END;
$$;

ALTER TABLE public.market_verification_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS market_verification_requests_read_own ON public.market_verification_requests;
CREATE POLICY market_verification_requests_read_own
ON public.market_verification_requests
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

GRANT SELECT ON public.market_verification_requests TO authenticated;

COMMIT;
