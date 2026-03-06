import { callFn } from "@/services/functions";

export type MarketVerificationStatus =
  | "PENDING"
  | "IN_REVIEW"
  | "VERIFIED"
  | "REJECTED"
  | "RESUBMISSION_REQUIRED"
  | "EXPIRED";

export type MarketVerificationRequest = {
  id: string;
  user_id: string;
  status: MarketVerificationStatus;
  provider: string | null;
  verification_type: string | null;
  provider_level_name: string | null;
  provider_applicant_id: string | null;
  provider_external_user_id: string | null;
  provider_review_status: string | null;
  provider_review_answer: string | null;
  provider_review_reject_type: string | null;
  provider_reject_labels: string[] | null;
  country_code: string | null;
  document_type: string | null;
  verification_url: string | null;
  verification_url_expires_at: string | null;
  provider_last_event_type: string | null;
  provider_last_event_at: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  verified_at: string | null;
  last_error: string | null;
  updated_at: string;
};

export type StartSellerVerificationResult = {
  ok: boolean;
  verified: boolean;
  status: MarketVerificationStatus | "VERIFIED";
  provider?: string;
  verification_url?: string;
  verification_url_expires_at?: string;
  request?: MarketVerificationRequest | null;
};

export async function startSellerVerification(countryCode?: string | null) {
  return await callFn<StartSellerVerificationResult>("market-verification-start", {
    country_code: countryCode || null,
  });
}
