import { adminError, getAdminContext } from "../_shared/market/admin.ts";
import {
  asRecord,
  missingGeminiConfigMessage,
  normalizeOneOf,
  normalizeStringList,
  requestGeminiJson,
  trimText,
  type GeminiPart,
} from "../_shared/market/gemini.ts";
import { bad, methodNotAllowed, ok } from "../_shared/market/http.ts";
import { supabaseAdminClient } from "../_shared/market/supabase.ts";

const DISPUTE_BUCKET = "market-disputes";
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const RECOMMENDATIONS = [
  "RELEASE_TO_SELLER",
  "REFUND_TO_BUYER",
  "REQUEST_MORE_EVIDENCE",
  "ESCALATE",
] as const;
const CONFIDENCE = ["LOW", "MEDIUM", "HIGH"] as const;

const REVIEW_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    recommendation: { type: "string" },
    confidence: { type: "string" },
    summary: { type: "string" },
    buyer_claim: { type: "string" },
    seller_claim: { type: "string" },
    evidence_assessment: { type: "string" },
    image_observations: {
      type: "array",
      items: { type: "string" },
    },
    key_facts: {
      type: "array",
      items: { type: "string" },
    },
    contradictions: {
      type: "array",
      items: { type: "string" },
    },
    missing_evidence: {
      type: "array",
      items: { type: "string" },
    },
    risk_flags: {
      type: "array",
      items: { type: "string" },
    },
    recommended_admin_action: { type: "string" },
    suggested_resolution_note: { type: "string" },
  },
  required: [
    "recommendation",
    "confidence",
    "summary",
    "buyer_claim",
    "seller_claim",
    "evidence_assessment",
    "image_observations",
    "key_facts",
    "contradictions",
    "missing_evidence",
    "risk_flags",
    "recommended_admin_action",
    "suggested_resolution_note",
  ],
} as const;

function uuidOrNull(value: unknown) {
  const raw = String(value ?? "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)
    ? raw
    : null;
}

function unique(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)));
}

function byId(rows: any[] | null | undefined, key = "id") {
  const map: Record<string, any> = {};
  for (const row of rows ?? []) {
    const id = String(row?.[key] ?? "");
    if (id) map[id] = row;
  }
  return map;
}

function userLabel(user: any) {
  return trimText(
    user?.seller?.business_name ||
      user?.seller?.display_name ||
      user?.seller?.market_username ||
      user?.profile?.full_name ||
      user?.profile?.username ||
      user?.profile?.email ||
      user?.id ||
      "unknown",
    160,
  );
}

function userBundle(userId: string | null | undefined, profiles: Record<string, any>, sellers: Record<string, any>) {
  const id = String(userId ?? "");
  if (!id) return null;
  return {
    id,
    profile: profiles[id] ?? null,
    seller: sellers[id] ?? null,
    label: userLabel({ id, profile: profiles[id] ?? null, seller: sellers[id] ?? null }),
  };
}

function attachmentSummary(attachment: any, imageIncluded = false) {
  return {
    id: trimText(attachment?.id, 80),
    kind: trimText(attachment?.kind, 24),
    mime_type: trimText(attachment?.mime_type, 120),
    file_name: trimText(attachment?.file_name, 160),
    file_size: Number.isFinite(Number(attachment?.file_size)) ? Number(attachment.file_size) : null,
    image_included_for_ai: imageIncluded,
    created_at: trimText(attachment?.created_at, 40),
  };
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function supportedImageMime(mime: unknown) {
  const raw = String(mime || "").toLowerCase();
  return ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"].includes(raw);
}

async function downloadImageEvidence(admin: any, attachments: any[]) {
  const images: Array<{ attachmentId: string; fileName: string; mimeType: string; data: string }> = [];
  const includedIds = new Set<string>();
  const skipped: string[] = [];

  for (const attachment of attachments) {
    if (images.length >= MAX_IMAGES) break;
    const mime = trimText(attachment?.mime_type, 120).toLowerCase();
    const kind = trimText(attachment?.kind, 24).toLowerCase();
    if (kind !== "image" && !mime.startsWith("image/")) continue;
    if (mime && !supportedImageMime(mime)) {
      skipped.push(`${trimText(attachment?.file_name, 80) || "image"}: unsupported image type`);
      continue;
    }

    const declaredSize = Number(attachment?.file_size ?? 0);
    if (Number.isFinite(declaredSize) && declaredSize > MAX_IMAGE_BYTES) {
      skipped.push(`${trimText(attachment?.file_name, 80) || "image"}: too large`);
      continue;
    }

    try {
      const bucket = trimText(attachment?.storage_bucket, 80) || DISPUTE_BUCKET;
      const path = trimText(attachment?.storage_path, 500);
      const publicUrl = trimText(attachment?.public_url, 1000);
      let blob: Blob | null = null;
      if (path) {
        const { data, error } = await admin.storage.from(bucket).download(path);
        if (error) throw error;
        blob = data;
      } else if (publicUrl) {
        const res = await fetch(publicUrl);
        if (!res.ok) throw new Error(`image fetch failed: ${res.status}`);
        blob = await res.blob();
      }
      if (!blob) continue;

      const mimeType = (mime || blob.type || "image/jpeg").replace("image/jpg", "image/jpeg");
      if (!supportedImageMime(mimeType)) {
        skipped.push(`${trimText(attachment?.file_name, 80) || "image"}: unsupported image type`);
        continue;
      }

      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (bytes.byteLength > MAX_IMAGE_BYTES) {
        skipped.push(`${trimText(attachment?.file_name, 80) || "image"}: too large`);
        continue;
      }

      const attachmentId = String(attachment?.id ?? "");
      includedIds.add(attachmentId);
      images.push({
        attachmentId,
        fileName: trimText(attachment?.file_name, 120) || `proof-${images.length + 1}`,
        mimeType,
        data: bytesToBase64(bytes),
      });
    } catch (error) {
      skipped.push(`${trimText(attachment?.file_name, 80) || "image"}: could not read`);
      console.warn("[market-dispute-ai-review] image skipped", (error as any)?.message ?? error);
    }
  }

  return { images, includedIds, skipped };
}

function normalizeReview(raw: unknown) {
  const review = asRecord(raw);
  return {
    recommendation: normalizeOneOf(review.recommendation, RECOMMENDATIONS, "REQUEST_MORE_EVIDENCE"),
    confidence: normalizeOneOf(review.confidence, CONFIDENCE, "LOW"),
    summary: trimText(review.summary, 700),
    buyer_claim: trimText(review.buyer_claim, 400),
    seller_claim: trimText(review.seller_claim, 400),
    evidence_assessment: trimText(review.evidence_assessment, 700),
    image_observations: normalizeStringList(review.image_observations, 6, 260),
    key_facts: normalizeStringList(review.key_facts, 8, 260),
    contradictions: normalizeStringList(review.contradictions, 6, 260),
    missing_evidence: normalizeStringList(review.missing_evidence, 8, 260),
    risk_flags: normalizeStringList(review.risk_flags, 6, 260),
    recommended_admin_action: trimText(review.recommended_admin_action, 500),
    suggested_resolution_note: trimText(review.suggested_resolution_note, 800),
  };
}

async function loadProfiles(admin: any, ids: string[]) {
  const list = unique(ids);
  if (!list.length) return {};
  const { data, error } = await admin
    .from("profiles")
    .select("id,email,username,full_name,public_uid,created_at")
    .in("id", list);
  if (error) throw error;
  return byId(data);
}

async function loadSellers(admin: any, ids: string[]) {
  const list = unique(ids);
  if (!list.length) return {};
  const { data, error } = await admin
    .from("market_seller_profiles")
    .select("user_id,market_username,display_name,business_name,is_verified,risk_score,active,payout_tier,created_at,updated_at")
    .in("user_id", list);
  if (error) throw error;
  return byId(data, "user_id");
}

async function loadContext(admin: any, input: { disputeId?: string | null; orderId?: string | null }) {
  let disputeQuery = admin
    .from("market_disputes")
    .select("id,order_id,opened_by,reason,status,resolution,resolved_by,resolved_at,resolution_note,created_at,updated_at");
  disputeQuery = input.disputeId ? disputeQuery.eq("id", input.disputeId) : disputeQuery.eq("order_id", input.orderId);
  const { data: dispute, error: disputeError } = await disputeQuery.maybeSingle();
  if (disputeError) throw disputeError;
  if (!dispute?.id) throw new Error("Dispute not found");

  const orderId = String(dispute.order_id ?? "");
  const [
    { data: order, error: orderError },
    { data: messages, error: messagesError },
    { data: deliverables, error: deliverablesError },
    { data: escrow, error: escrowError },
    { data: intents, error: intentsError },
  ] = await Promise.all([
    admin
      .from("market_orders")
      .select("id,buyer_id,seller_id,listing_id,quantity,unit_price,amount,currency,status,version,fee_amount,note,created_at,in_escrow_at,out_for_delivery_at,deliverable_uploaded_at,delivered_at,released_at,refunded_at,cancelled_at")
      .eq("id", orderId)
      .maybeSingle(),
    admin
      .from("market_dispute_messages")
      .select("id,dispute_id,order_id,sender_id,sender_kind,body,created_at")
      .eq("dispute_id", disputeId)
      .order("created_at", { ascending: true })
      .limit(120),
    admin
      .from("market_deliverables")
      .select("id,order_id,uploaded_by,created_at")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true })
      .limit(20),
    admin
      .from("market_crypto_escrows")
      .select("order_id,chain,buyer_wallet,seller_wallet,token_address,escrow_address,amount_units,amount_raw,deposited_tx_hash,released_tx_hash,refunded_tx_hash,deposited_at,released_at,refunded_at,order_key,created_at,updated_at")
      .eq("order_id", orderId)
      .maybeSingle(),
    admin
      .from("market_crypto_intents")
      .select("id,order_id,intent_type,status,chain,from_wallet,to_wallet,amount_units,amount_raw,tx_hash,failure_reason,created_at,updated_at")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true })
      .limit(50),
  ]);
  if (orderError) throw orderError;
  if (messagesError) throw messagesError;
  if (deliverablesError) throw deliverablesError;
  if (escrowError) throw escrowError;
  if (intentsError) throw intentsError;
  if (!order?.id) throw new Error("Order not found");

  const [{ data: listing, error: listingError }, { data: attachments, error: attachmentsError }] = await Promise.all([
    order?.listing_id
      ? admin
        .from("market_listings")
        .select("id,seller_id,category,sub_category,title,price_amount,currency,delivery_type,stock_qty,is_active,created_at,updated_at")
        .eq("id", order.listing_id)
        .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    (messages ?? []).length
      ? admin
        .from("market_dispute_attachments")
        .select("id,dispute_id,message_id,order_id,uploaded_by,kind,storage_bucket,storage_path,public_url,mime_type,file_name,file_size,created_at")
        .in("message_id", (messages ?? []).map((message: any) => message.id))
        .order("created_at", { ascending: true })
        .limit(500)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (listingError) throw listingError;
  if (attachmentsError) throw attachmentsError;

  const profileIds = unique([
    dispute.opened_by,
    dispute.resolved_by,
    order.buyer_id,
    order.seller_id,
    listing?.seller_id,
    ...(messages ?? []).map((message: any) => message.sender_id),
    ...(attachments ?? []).map((attachment: any) => attachment.uploaded_by),
    ...(deliverables ?? []).map((deliverable: any) => deliverable.uploaded_by),
  ]);
  const [profiles, sellers] = await Promise.all([
    loadProfiles(admin, profileIds),
    loadSellers(admin, profileIds),
  ]);

  const attachmentsByMessage: Record<string, any[]> = {};
  for (const attachment of attachments ?? []) {
    const messageId = String(attachment.message_id ?? "");
    if (!messageId) continue;
    attachmentsByMessage[messageId] = [...(attachmentsByMessage[messageId] ?? []), attachment];
  }

  return {
    dispute,
    order,
    listing,
    messages: messages ?? [],
    attachments: attachments ?? [],
    attachmentsByMessage,
    deliverables: deliverables ?? [],
    escrow,
    intents: intents ?? [],
    profiles,
    sellers,
  };
}

function buildPrompt(context: any, includedIds: Set<string>, skippedImages: string[]) {
  const { dispute, order, listing, messages, attachmentsByMessage, deliverables, escrow, intents, profiles, sellers } = context;
  const buyer = userBundle(order.buyer_id, profiles, sellers);
  const seller = userBundle(order.seller_id, profiles, sellers);
  const payload = {
    allowed_recommendations: RECOMMENDATIONS,
    dispute: {
      id: trimText(dispute.id, 80),
      status: trimText(dispute.status, 40),
      reason: trimText(dispute.reason, 900),
      current_resolution: trimText(dispute.resolution, 120),
      opened_at: trimText(dispute.created_at, 40),
      updated_at: trimText(dispute.updated_at, 40),
    },
    order: {
      id: trimText(order.id, 80),
      status: trimText(order.status, 40),
      quantity: Number.isFinite(Number(order.quantity)) ? Number(order.quantity) : null,
      amount: Number.isFinite(Number(order.amount)) ? Number(order.amount) : null,
      currency: trimText(order.currency, 16),
      fee_amount: Number.isFinite(Number(order.fee_amount)) ? Number(order.fee_amount) : null,
      note: trimText(order.note, 500),
      created_at: trimText(order.created_at, 40),
      in_escrow_at: trimText(order.in_escrow_at, 40),
      out_for_delivery_at: trimText(order.out_for_delivery_at, 40),
      deliverable_uploaded_at: trimText(order.deliverable_uploaded_at, 40),
      delivered_at: trimText(order.delivered_at, 40),
      released_at: trimText(order.released_at, 40),
      refunded_at: trimText(order.refunded_at, 40),
      cancelled_at: trimText(order.cancelled_at, 40),
    },
    buyer: buyer
      ? {
        label: buyer.label,
        id: trimText(buyer.id, 80),
        seller_profile: buyer.seller
          ? {
            is_verified: Boolean(buyer.seller.is_verified),
            risk_score: Number.isFinite(Number(buyer.seller.risk_score)) ? Number(buyer.seller.risk_score) : null,
            active: Boolean(buyer.seller.active),
          }
          : null,
      }
      : null,
    seller: seller
      ? {
        label: seller.label,
        id: trimText(seller.id, 80),
        seller_profile: seller.seller
          ? {
            is_verified: Boolean(seller.seller.is_verified),
            risk_score: Number.isFinite(Number(seller.seller.risk_score)) ? Number(seller.seller.risk_score) : null,
            active: Boolean(seller.seller.active),
            payout_tier: trimText(seller.seller.payout_tier, 40),
          }
          : null,
      }
      : null,
    listing: listing
      ? {
        id: trimText(listing.id, 80),
        title: trimText(listing.title, 240),
        category: trimText(listing.category, 80),
        sub_category: trimText(listing.sub_category, 120),
        delivery_type: trimText(listing.delivery_type, 80),
        price_amount: Number.isFinite(Number(listing.price_amount)) ? Number(listing.price_amount) : null,
        currency: trimText(listing.currency, 16),
        stock_qty: Number.isFinite(Number(listing.stock_qty)) ? Number(listing.stock_qty) : null,
        is_active: Boolean(listing.is_active),
      }
      : null,
    deliverables: (deliverables ?? []).slice(-20).map((deliverable: any) => ({
      id: trimText(deliverable.id, 80),
      uploaded_by_role: String(deliverable.uploaded_by ?? "") === String(order.seller_id ?? "") ? "SELLER" : "UNKNOWN",
      created_at: trimText(deliverable.created_at, 40),
    })),
    stable_escrow: escrow
      ? {
        chain: trimText(escrow.chain, 80),
        deposited_tx_hash: trimText(escrow.deposited_tx_hash, 120),
        released_tx_hash: trimText(escrow.released_tx_hash, 120),
        refunded_tx_hash: trimText(escrow.refunded_tx_hash, 120),
        deposited_at: trimText(escrow.deposited_at, 40),
        released_at: trimText(escrow.released_at, 40),
        refunded_at: trimText(escrow.refunded_at, 40),
      }
      : null,
    crypto_intents: (intents ?? []).slice(-20).map((intent: any) => ({
      intent_type: trimText(intent.intent_type, 40),
      status: trimText(intent.status, 40),
      chain: trimText(intent.chain, 80),
      tx_hash: trimText(intent.tx_hash, 120),
      failure_reason: trimText(intent.failure_reason, 300),
      created_at: trimText(intent.created_at, 40),
      updated_at: trimText(intent.updated_at, 40),
    })),
    skipped_images: skippedImages,
    conversation: (messages ?? []).slice(-80).map((message: any, index: number) => {
      const sender = userBundle(message.sender_id, profiles, sellers);
      const attachments = attachmentsByMessage[String(message.id)] ?? [];
      return {
        index: index + 1,
        sender_kind: trimText(message.sender_kind, 24).toUpperCase(),
        sender_label: sender?.label ?? "unknown",
        sender_is_buyer: String(message.sender_id ?? "") === String(order.buyer_id ?? ""),
        sender_is_seller: String(message.sender_id ?? "") === String(order.seller_id ?? ""),
        created_at: trimText(message.created_at, 40),
        body: trimText(message.body, 2500),
        attachments: attachments.map((attachment: any) => attachmentSummary(attachment, includedIds.has(String(attachment.id ?? "")))),
      };
    }),
  };

  return [
    "You are an admin-only dispute review assistant for a marketplace escrow team.",
    "Return structured JSON only. Your output is advisory and visible only to admins.",
    "Use only the input payload and attached image proof. Do not invent delivery events, payment events, identities, receipts, tracking, or policy details.",
    "Read image proof when present. If an image is unclear, partial, cropped, unrelated, or not enough to prove a claim, say so in image_observations and evidence_assessment.",
    "Recommend RELEASE_TO_SELLER only when the available order state, seller proof, and party statements strongly support that the seller fulfilled the trade and buyer evidence does not outweigh it.",
    "Recommend REFUND_TO_BUYER only when the available order state, buyer proof, and party statements strongly support non-delivery, wrong delivery, fraud, duplicate payment, or seller failure.",
    "Recommend REQUEST_MORE_EVIDENCE when important proof is missing or the current evidence is balanced/unclear.",
    "Recommend ESCALATE for safety, fraud-ring, legal, identity, chargeback, severe abuse, or platform-risk cases.",
    "Never tell the admin to rely only on AI. Always give a concrete admin next step.",
    "suggested_resolution_note must be concise and written as an internal admin note, not a message to the user.",
    "Input payload:",
    JSON.stringify(payload),
  ].join("\n\n");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  try {
    const ctx = await getAdminContext(req, { requireSession: true, permissions: ["disputes.resolve"] });
    if (ctx instanceof Response) return ctx;

    const body = await req.json().catch(() => ({}));
    const disputeId = uuidOrNull(body?.dispute_id ?? body?.disputeId);
    const orderId = uuidOrNull(body?.order_id ?? body?.orderId);
    if (!disputeId && !orderId) return bad("dispute_id or order_id must be a uuid");
    const admin = supabaseAdminClient();

    const context = await loadContext(admin, { disputeId, orderId });
    if (!["OPEN", "UNDER_REVIEW"].includes(String(context.dispute.status ?? "").toUpperCase())) {
      return bad("Dispute is not open for AI review");
    }

    const imageEvidence = await downloadImageEvidence(admin, context.attachments);
    const prompt = buildPrompt(context, imageEvidence.includedIds, imageEvidence.skipped);
    const parts: GeminiPart[] = [{ text: prompt }];
    imageEvidence.images.forEach((image, index) => {
      parts.push({ text: `Image proof ${index + 1}: ${image.fileName} (attachment ${image.attachmentId})` });
      parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
    });

    const result = await requestGeminiJson({
      prompt,
      parts,
      responseSchema: REVIEW_RESPONSE_SCHEMA,
      temperature: 0.15,
      maxOutputTokens: 2200,
    });
    const review = normalizeReview(result.data);
    const generatedAt = new Date().toISOString();

    await admin.from("market_audit_logs").insert({
      actor_id: ctx.userId,
      actor_type: "admin",
      action: "DISPUTE_AI_REVIEW_GENERATED",
      entity_type: "market_disputes",
      entity_id: context.dispute.id,
      payload: {
        order_id: context.dispute.order_id,
        model: result.model,
        image_count: imageEvidence.images.length,
        recommendation: review.recommendation,
        confidence: review.confidence,
      },
    });

    return ok({
      ok: true,
      dispute_id: context.dispute.id,
      order_id: context.dispute.order_id,
      generated_at: generatedAt,
      model: result.model,
      image_count: imageEvidence.images.length,
      skipped_images: imageEvidence.skipped,
      review,
    });
  } catch (error) {
    return adminError(missingGeminiConfigMessage(error));
  }
});
