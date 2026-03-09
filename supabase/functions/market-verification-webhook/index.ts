import { bad, methodNotAllowed, ok } from "../_shared/market/http.ts";
import { supabaseAdminClient } from "../_shared/market/supabase.ts";
import {
  collectDiditRejectLabels,
  deriveDiditCountryCode,
  deriveDiditDocumentType,
  deriveDiditLastError,
  deriveDiditRejectType,
  deriveDiditReviewAnswer,
  getVerificationProviderName,
  getDiditPayloadStatus,
  mapDiditVerificationStatus,
  parseDiditTimestamp,
  parseSellerVerificationExternalUserId,
  verifyDiditWebhookSignatureRaw,
  verifyDiditWebhookSignatureSimple,
  verifyDiditWebhookSignatureV2,
} from "../_shared/market/verification.ts";

function isUuid(value: string) {
  return /^[0-9a-fA-F-]{36}$/.test(value);
}

function extractUserId(vendorData: unknown) {
  const parsed = parseSellerVerificationExternalUserId(String(vendorData ?? ""));
  if (parsed) return parsed;
  const raw = String(vendorData ?? "").trim();
  return isUuid(raw) ? raw : null;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function deriveEventId(payload: any, rawBody: string) {
  const sessionId = String(payload?.session_id ?? "").trim();
  const webhookType = String(payload?.webhook_type ?? "").trim() || "status.updated";
  const status = String(payload?.status ?? "").trim();
  const timestamp = String(payload?.timestamp ?? payload?.created_at ?? "").trim();
  if (sessionId && timestamp) return `${sessionId}:${webhookType}:${status}:${timestamp}`;
  if (sessionId) return `${sessionId}:${webhookType}:${status || "unknown"}`;
  const hash = await sha256Hex(rawBody);
  return `didit:${hash}`;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  const provider = getVerificationProviderName();
  if (provider !== "didit") return bad(`Unsupported verification provider: ${provider}`);

  const rawBody = await req.text().catch(() => "");
  if (!rawBody) return bad("Empty payload");

  let payload: any = null;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return bad("Invalid JSON payload");
  }

  const timestampHeader = req.headers.get("x-timestamp");
  const sigV2 = req.headers.get("x-signature-v2");
  const sigSimple = req.headers.get("x-signature-simple");
  const sigRaw = req.headers.get("x-signature");

  let isValid = false;
  if (sigV2) isValid = await verifyDiditWebhookSignatureV2(payload, sigV2, timestampHeader);
  if (!isValid && sigSimple) isValid = await verifyDiditWebhookSignatureSimple(payload, sigSimple, timestampHeader);
  if (!isValid && sigRaw) isValid = await verifyDiditWebhookSignatureRaw(rawBody, sigRaw, timestampHeader);

  if (!isValid) {
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const admin = supabaseAdminClient();
  const eventId = await deriveEventId(payload, rawBody);
  const sessionId = String(payload?.session_id ?? "").trim() || null;
  const vendorData = String(payload?.vendor_data ?? "").trim() || null;
  const webhookType = String(payload?.webhook_type ?? "").trim() || "status.updated";
  const rawStatus = getDiditPayloadStatus(payload);

  let userId = extractUserId(vendorData);
  if (!userId && sessionId) {
    const { data: existing } = await admin
      .from("market_verification_requests")
      .select("user_id")
      .eq("provider", provider)
      .eq("provider_applicant_id", sessionId)
      .maybeSingle();
    userId = existing?.user_id ?? null;
  }

  if (!userId) {
    return ok({
      ok: true,
      ignored: true,
      reason: "unmapped_user",
      event_id: eventId,
      provider,
    });
  }

  const mappedStatus = mapDiditVerificationStatus(rawStatus);
  const rejectLabels = collectDiditRejectLabels(payload);
  const eventAt = parseDiditTimestamp(payload?.timestamp ?? payload?.created_at) ?? new Date().toISOString();
  const countryCode = deriveDiditCountryCode(payload);
  const documentType = deriveDiditDocumentType(payload);

  const { data, error } = await admin.rpc("market_apply_verification_provider_result", {
    p_provider: provider,
    p_event_id: eventId,
    p_event_type: webhookType,
    p_user_id: userId,
    p_status: mappedStatus,
    p_provider_applicant_id: sessionId,
    p_provider_external_user_id: vendorData,
    p_provider_level_name: String(payload?.workflow_id ?? "").trim() || null,
    p_provider_review_status: rawStatus || null,
    p_provider_review_answer: deriveDiditReviewAnswer(rawStatus),
    p_provider_review_reject_type: deriveDiditRejectType(rawStatus),
    p_provider_reject_labels: rejectLabels,
    p_country_code: countryCode,
    p_document_type: documentType,
    p_provider_event_at: eventAt,
    p_verified_at: mappedStatus === "VERIFIED" ? eventAt : null,
    p_last_error: deriveDiditLastError(payload, mappedStatus, rejectLabels),
  });

  if (error) return bad(error.message);

  return ok({
    ok: true,
    provider,
    event_id: eventId,
    status: mappedStatus,
    applied: Array.isArray(data) ? data[0]?.applied === true : false,
  });
});
