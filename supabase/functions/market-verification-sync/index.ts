import { bad, methodNotAllowed, ok, unauth } from "../_shared/market/http.ts";
import { supabaseAdminClient, supabaseUserClient } from "../_shared/market/supabase.ts";
import {
  collectDiditRejectLabels,
  deriveDiditCountryCode,
  deriveDiditDocumentType,
  deriveDiditLastError,
  deriveDiditRejectType,
  deriveDiditReviewAnswer,
  diditRequest,
  getDiditPayloadStatus,
  getVerificationProviderName,
  mapDiditVerificationStatus,
  parseDiditTimestamp,
} from "../_shared/market/verification.ts";

const REQUEST_SELECT =
  "id,user_id,status,provider,verification_type,provider_level_name,provider_applicant_id,provider_external_user_id,provider_review_status,provider_review_answer,provider_review_reject_type,provider_reject_labels,country_code,document_type,verification_url,verification_url_expires_at,provider_last_event_type,provider_last_event_at,submitted_at,reviewed_at,verified_at,last_error,updated_at";

type DiditDecisionResponse = {
  session_id?: string;
  workflow_id?: string;
  vendor_data?: string;
  status?: string;
  created_at?: string | number;
  updated_at?: string | number;
  completed_at?: string | number;
  decision?: {
    status?: string;
  };
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  const supabase = supabaseUserClient(req);
  const admin = supabaseAdminClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  const user = auth?.user;
  if (authErr || !user) return unauth();

  const provider = getVerificationProviderName();
  if (provider !== "didit") return bad(`Unsupported verification provider: ${provider}`);

  const { data: seller, error: sellerErr } = await admin
    .from("market_seller_profiles")
    .select("user_id,is_verified,active")
    .eq("user_id", user.id)
    .maybeSingle();

  if (sellerErr) return bad(sellerErr.message);
  if (!seller || seller.active === false) return bad("Create and activate your seller profile first");

  const { data: existing, error: reqErr } = await admin
    .from("market_verification_requests")
    .select(REQUEST_SELECT)
    .eq("user_id", user.id)
    .maybeSingle();

  if (reqErr) return bad(reqErr.message);
  if (!existing) {
    return ok({
      ok: true,
      synced: false,
      verified: Boolean(seller.is_verified),
      request: null,
    });
  }

  if (seller.is_verified && existing.status === "VERIFIED") {
    return ok({
      ok: true,
      synced: false,
      verified: true,
      request: existing,
    });
  }

  const sessionId = String(existing.provider_applicant_id ?? "").trim();
  if (!sessionId) {
    return ok({
      ok: true,
      synced: false,
      verified: Boolean(seller.is_verified),
      request: existing,
    });
  }

  let payload: DiditDecisionResponse;
  try {
    payload = await diditRequest<DiditDecisionResponse>("GET", `/v3/session/${encodeURIComponent(sessionId)}/decision/`);
  } catch (e: any) {
    return bad(String(e?.message || "Could not sync verification status"));
  }

  const rawStatus = getDiditPayloadStatus(payload);
  if (!rawStatus) {
    return ok({
      ok: true,
      synced: false,
      verified: Boolean(seller.is_verified),
      request: existing,
    });
  }

  const mappedStatus = mapDiditVerificationStatus(rawStatus);
  const rejectLabels = collectDiditRejectLabels(payload);
  const eventAt =
    parseDiditTimestamp(payload?.updated_at ?? payload?.completed_at ?? payload?.created_at) ??
    new Date().toISOString();
  const eventId = `${sessionId}:sync:${rawStatus}:${eventAt}`;
  const vendorData = String(payload?.vendor_data ?? existing.provider_external_user_id ?? "").trim() || null;

  const { data, error } = await admin.rpc("market_apply_verification_provider_result", {
    p_provider: provider,
    p_event_id: eventId,
    p_event_type: "session.sync",
    p_user_id: user.id,
    p_status: mappedStatus,
    p_provider_applicant_id: sessionId,
    p_provider_external_user_id: vendorData,
    p_provider_level_name: String(payload?.workflow_id ?? existing.provider_level_name ?? "").trim() || null,
    p_provider_review_status: rawStatus || null,
    p_provider_review_answer: deriveDiditReviewAnswer(rawStatus),
    p_provider_review_reject_type: deriveDiditRejectType(rawStatus),
    p_provider_reject_labels: rejectLabels,
    p_country_code: deriveDiditCountryCode(payload),
    p_document_type: deriveDiditDocumentType(payload),
    p_provider_event_at: eventAt,
    p_verified_at: mappedStatus === "VERIFIED" ? eventAt : null,
    p_last_error: deriveDiditLastError(payload, mappedStatus, rejectLabels),
  });

  if (error) return bad(error.message);

  const { data: requestRow, error: refreshedErr } = await admin
    .from("market_verification_requests")
    .select(REQUEST_SELECT)
    .eq("user_id", user.id)
    .maybeSingle();

  if (refreshedErr) return bad(refreshedErr.message);

  const { data: sellerAfter } = await admin
    .from("market_seller_profiles")
    .select("is_verified")
    .eq("user_id", user.id)
    .maybeSingle();

  return ok({
    ok: true,
    synced: true,
    applied: Array.isArray(data) ? data[0]?.applied === true : false,
    status: mappedStatus,
    verified: Boolean(sellerAfter?.is_verified),
    request: requestRow ?? existing,
  });
});
