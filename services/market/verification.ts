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

export type SyncSellerVerificationResult = {
  ok: boolean;
  synced: boolean;
  applied?: boolean;
  verified: boolean;
  status?: MarketVerificationStatus | "VERIFIED";
  request?: MarketVerificationRequest | null;
};

function normalizeVerificationError(error: unknown) {
  const raw = String((error as any)?.message ?? error ?? "").trim();
  const lower = raw.toLowerCase();

  if (
    lower === "invalid jwt" ||
    lower.includes("session expired") ||
    lower.includes("no session") ||
    lower.includes("auth token")
  ) {
    return "Your login session is invalid. Sign out, sign in again, then retry verification.";
  }

  if (lower.includes("verification provider credentials") || lower.includes("provider rejected server credentials")) {
    return "Verification provider credentials are invalid on the server. Update the verification secrets and redeploy the verification functions.";
  }

  return raw || "Could not start verification.";
}

export async function startSellerVerification(countryCode?: string | null) {
  try {
    return await callFn<StartSellerVerificationResult>("market-verification-start", {
      country_code: countryCode || null,
    });
  } catch (e) {
    throw new Error(normalizeVerificationError(e));
  }
}

export async function syncSellerVerification() {
  try {
    return await callFn<SyncSellerVerificationResult>("market-verification-sync", {});
  } catch (e) {
    throw new Error(normalizeVerificationError(e));
  }
}
