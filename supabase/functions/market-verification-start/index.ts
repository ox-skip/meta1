import { bad, methodNotAllowed, ok, unauth } from "../_shared/market/http.ts";
import {
  extractBearerToken,
  supabaseAdminClient,
  supabaseUserClient,
} from "../_shared/market/supabase.ts";
import {
  buildSellerVerificationExternalUserId,
  diditRequest,
  getDiditCallbackMethod,
  getDiditCallbackUrl,
  getDiditLanguage,
  getDiditSessionTtlSecs,
  getDiditWorkflowId,
  getVerificationProviderName,
  mapDiditVerificationStatus,
  normalizeCountryCode,
  normalizePhone,
} from "../_shared/market/verification.ts";

type DiditSessionResponse = {
  session_id?: string;
  workflow_id?: string;
  url?: string;
  status?: string;
};

function linkExpiresAt(ttlSecs: number) {
  return new Date(Date.now() + (ttlSecs * 1000)).toISOString();
}

function isReusableVerificationLink(existing: { verification_url?: string | null; verification_url_expires_at?: string | null; status?: string | null } | null) {
  const url = String(existing?.verification_url ?? "").trim();
  if (!url) return false;
  if (String(existing?.status ?? "").toUpperCase() === "VERIFIED") return false;

  const expiresAt = String(existing?.verification_url_expires_at ?? "").trim();
  if (!expiresAt) return true;

  const expiresAtMs = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiresAtMs)) return true;
  return expiresAtMs > Date.now();
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  const token = extractBearerToken(req);
  if (!token) return unauth();

  const supabase = supabaseUserClient(req);
  const admin = supabaseAdminClient();

  // This function authenticates the caller inside the handler so it can run
  // with verify_jwt=false and still reject missing/invalid bearer tokens.
  const { data: auth, error: authErr } = await supabase.auth.getUser(token);
  const user = auth?.user;
  if (authErr || !user) return unauth();

  const provider = getVerificationProviderName();
  if (provider !== "didit") return bad(`Unsupported verification provider: ${provider}`);

  const body = await req.json().catch(() => ({}));
  const countryCode = normalizeCountryCode(body?.country_code);

  const { data: seller, error: sellerErr } = await admin
    .from("market_seller_profiles")
    .select("user_id,business_name,market_username,is_verified,active,phone")
    .eq("user_id", user.id)
    .maybeSingle();

  if (sellerErr) return bad(sellerErr.message);
  if (!seller || seller.active === false) return bad("Create and activate your seller profile first");

  const { data: profileRow } = await admin
    .from("profiles")
    .select("email")
    .eq("id", user.id)
    .maybeSingle();

  const { data: existing, error: reqErr } = await admin
    .from("market_verification_requests")
    .select(
      "id,user_id,status,provider,verification_type,provider_level_name,provider_applicant_id,provider_external_user_id,provider_review_status,provider_review_answer,provider_review_reject_type,provider_reject_labels,country_code,document_type,verification_url,verification_url_expires_at,provider_last_event_type,provider_last_event_at,submitted_at,reviewed_at,verified_at,last_error,note,admin_note,updated_at",
    )
    .eq("user_id", user.id)
    .maybeSingle();

  if (reqErr) return bad(reqErr.message);

  if (seller.is_verified) {
    return ok({
      ok: true,
      verified: true,
      status: "VERIFIED",
      request: existing ?? null,
    });
  }

  const workflowId = getDiditWorkflowId();
  const ttlSecs = getDiditSessionTtlSecs();
  const externalUserId = buildSellerVerificationExternalUserId(user.id);

  if (isReusableVerificationLink(existing as any)) {
    return ok({
      ok: true,
      verified: false,
      status: existing?.status ?? "PENDING",
      provider,
      verification_url: existing?.verification_url ?? null,
      verification_url_expires_at: existing?.verification_url_expires_at ?? null,
      request: existing ?? null,
    });
  }

  const requestBody: Record<string, unknown> = {
    workflow_id: workflowId,
    vendor_data: externalUserId,
    callback_method: getDiditCallbackMethod(),
    language: getDiditLanguage(),
  };

  const callbackUrl = getDiditCallbackUrl();
  if (callbackUrl) requestBody.callback = callbackUrl;

  const contactDetails: Record<string, unknown> = {};
  const email = String(profileRow?.email ?? "").trim();
  const phone = normalizePhone(seller?.phone);
  if (email) contactDetails.email = email;
  if (phone) contactDetails.phone = phone;
  if (Object.keys(contactDetails).length > 0) {
    requestBody.contact_details = contactDetails;
  }

  if (countryCode) {
    requestBody.expected_details = {
      id_country: countryCode,
    };
  }

  try {
    const result = await diditRequest<DiditSessionResponse>("POST", "/v3/session/", requestBody);
    const verificationUrl = String(result?.url ?? "").trim();
    const sessionId = String(result?.session_id ?? "").trim();
    const providerStatus = String(result?.status ?? "").trim();
    const mappedStatus = mapDiditVerificationStatus(providerStatus);

    if (!verificationUrl || !sessionId) {
      return bad("Didit did not return verification URL/session id");
    }

    const now = new Date().toISOString();
    const payload = {
      user_id: user.id,
      status: mappedStatus,
      note: existing?.note ?? null,
      admin_note: null,
      submitted_at: existing?.submitted_at ?? now,
      reviewed_at: null,
      reviewed_by: null,
      provider,
      verification_type: "government_id",
      provider_applicant_id: sessionId,
      provider_external_user_id: externalUserId,
      provider_level_name: workflowId,
      provider_review_status: providerStatus || null,
      provider_review_answer: null,
      provider_review_reject_type: null,
      provider_reject_labels: [],
      country_code: countryCode ?? null,
      verification_url: verificationUrl,
      verification_url_expires_at: linkExpiresAt(ttlSecs),
      provider_last_event_type: "session_created",
      provider_last_event_at: now,
      verified_at: null,
      last_error: null,
    };

    const { data: requestRow, error: upsertErr } = await admin
      .from("market_verification_requests")
      .upsert(payload, { onConflict: "user_id" })
      .select(
        "id,user_id,status,provider,verification_type,provider_level_name,provider_applicant_id,provider_external_user_id,provider_review_status,provider_review_answer,provider_review_reject_type,provider_reject_labels,country_code,document_type,verification_url,verification_url_expires_at,provider_last_event_type,provider_last_event_at,submitted_at,reviewed_at,verified_at,last_error,updated_at",
      )
      .single();

    if (upsertErr) return bad(upsertErr.message);

    return ok({
      ok: true,
      verified: false,
      status: mappedStatus,
      provider,
      verification_url: verificationUrl,
      verification_url_expires_at: payload.verification_url_expires_at,
      request: requestRow,
    });
  } catch (e: any) {
    const message = String(e?.message || "Could not start verification");
    const now = new Date().toISOString();

    try {
      await admin
        .from("market_verification_requests")
        .upsert(
          {
            user_id: user.id,
            status: existing?.status ?? "PENDING",
            note: existing?.note ?? null,
            admin_note: existing?.admin_note ?? null,
            submitted_at: existing?.submitted_at ?? now,
            provider,
            verification_type: "government_id",
            provider_external_user_id: externalUserId,
            provider_level_name: workflowId,
            country_code: countryCode ?? null,
            provider_last_event_type: "session_create_failed",
            provider_last_event_at: now,
            last_error: message,
          },
          { onConflict: "user_id" },
        );
    } catch {
      // Ignore persistence failures here and surface the provider error instead.
    }

    return bad(message);
  }
});
