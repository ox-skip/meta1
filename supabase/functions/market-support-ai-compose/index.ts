import { bad, methodNotAllowed, ok, unauth } from "../_shared/market/http.ts";
import {
  supabaseAdminClient,
  supabaseUserClient,
} from "../_shared/market/supabase.ts";
import {
  asRecord,
  JsonRecord,
  missingGeminiConfigMessage,
  normalizeOneOf,
  normalizeStringList,
  requestGeminiJson,
  trimText,
} from "../_shared/market/gemini.ts";

type SupportCompose = {
  subject: string;
  category: string;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  improved_body: string;
  missing_evidence: string[];
  evidence_to_attach: string[];
  safety_note: string;
  confidence: "LOW" | "MEDIUM" | "HIGH";
};

const SUPPORT_CATEGORIES = [
  "order",
  "payment",
  "listing",
  "stock",
  "account",
  "safety",
  "general",
] as const;
const SUPPORT_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
const CONFIDENCE_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    subject: { type: "string" },
    category: { type: "string" },
    priority: { type: "string" },
    improved_body: { type: "string" },
    missing_evidence: { type: "array", items: { type: "string" } },
    evidence_to_attach: { type: "array", items: { type: "string" } },
    safety_note: { type: "string" },
    confidence: { type: "string" },
  },
  required: [
    "subject",
    "category",
    "priority",
    "improved_body",
    "missing_evidence",
    "evidence_to_attach",
    "safety_note",
    "confidence",
  ],
} as const;

function requireUuid(name: string, value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(raw)
  ) {
    throw new Error(`${name} must be a uuid`);
  }
  return raw;
}

function normalizeCategory(input: unknown, fallback = "general") {
  const raw = trimText(input, 48).toLowerCase();
  if ((SUPPORT_CATEGORIES as readonly string[]).includes(raw)) return raw;
  const cleanFallback = trimText(fallback, 48).toLowerCase();
  return (SUPPORT_CATEGORIES as readonly string[]).includes(cleanFallback)
    ? cleanFallback
    : "general";
}

function normalizeCompose(raw: unknown, fallback: JsonRecord): SupportCompose {
  const data = asRecord(raw);
  return {
    subject: trimText(data.subject, 140) ||
      trimText(fallback.subject, 140) ||
      "Marketplace support request",
    category: normalizeCategory(data.category, trimText(fallback.category, 48)),
    priority: normalizeOneOf(
      data.priority,
      SUPPORT_PRIORITIES,
      normalizeOneOf(fallback.priority, SUPPORT_PRIORITIES, "NORMAL"),
    ),
    improved_body: trimText(data.improved_body, 3000) ||
      trimText(fallback.body, 3000),
    missing_evidence: normalizeStringList(data.missing_evidence, 6, 180),
    evidence_to_attach: normalizeStringList(data.evidence_to_attach, 6, 180),
    safety_note: trimText(data.safety_note, 220),
    confidence: normalizeOneOf(data.confidence, CONFIDENCE_LEVELS, "LOW"),
  };
}

async function loadRelatedOrder(admin: any, userId: string, orderId: string) {
  if (!orderId) return null;
  const { data: order, error } = await admin
    .from("market_orders")
    .select(
      "id,buyer_id,seller_id,listing_id,quantity,amount,currency,status,created_at,in_escrow_at,out_for_delivery_at,deliverable_uploaded_at,delivered_at,released_at,refunded_at,cancelled_at",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw error;
  if (!order?.id) throw new Error("Related order was not found.");
  if (String(order.buyer_id) !== userId && String(order.seller_id) !== userId) {
    throw new Error("You can only attach your own order to support.");
  }

  let listing = null;
  const listingId = String(order.listing_id ?? "").trim();
  if (listingId) {
    const { data, error: listingError } = await admin
      .from("market_listings")
      .select(
        "id,title,category,sub_category,delivery_type,currency,price_amount,is_active",
      )
      .eq("id", listingId)
      .maybeSingle();
    if (listingError) throw listingError;
    listing = data ?? null;
  }

  return {
    order: {
      id: order.id,
      status: order.status,
      quantity: order.quantity,
      amount: order.amount,
      currency: order.currency,
      user_is_buyer: String(order.buyer_id) === userId,
      user_is_seller: String(order.seller_id) === userId,
      created_at: order.created_at,
      in_escrow_at: order.in_escrow_at,
      out_for_delivery_at: order.out_for_delivery_at,
      deliverable_uploaded_at: order.deliverable_uploaded_at,
      delivered_at: order.delivered_at,
      released_at: order.released_at,
      refunded_at: order.refunded_at,
      cancelled_at: order.cancelled_at,
    },
    listing,
  };
}

function buildPrompt(input: {
  body: JsonRecord;
  related: any;
  attachmentSummary: any[];
}) {
  const payload = {
    allowed_categories: SUPPORT_CATEGORIES,
    allowed_priorities: SUPPORT_PRIORITIES,
    draft: {
      subject: trimText(input.body.subject, 300),
      category: trimText(input.body.category, 48),
      priority: trimText(input.body.priority, 24),
      message: trimText(input.body.body, 5000),
      related_order_id_present: Boolean(input.related?.order?.id),
      attachments: input.attachmentSummary,
    },
    related_order_context: input.related,
  };

  return [
    "You help a marketplace customer write a clear support ticket before it is submitted.",
    "Return structured JSON only.",
    "Use only facts from the payload. Do not invent order states, proof, refunds, delivery promises, identity details, or policy decisions.",
    "Improve clarity, chronology, and completeness. Keep the user's meaning and tone intact.",
    "category must be one of allowed_categories. priority must be one of allowed_priorities.",
    "Use URGENT only for safety risk, account compromise, payment loss requiring immediate support, legal/regulatory risk, or clear time-critical escrow harm.",
    "improved_body should be ready to send as the ticket message, written in first person from the customer.",
    "missing_evidence should list details still needed. evidence_to_attach should list files/screenshots the user should add before submitting.",
    "safety_note should be empty unless the user mentions threats, fraud, account compromise, or off-platform payment risk.",
    "Input payload:",
    JSON.stringify(payload),
  ].join("\n\n");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  const userClient = supabaseUserClient(req);
  const { data: auth, error: authError } = await userClient.auth.getUser();
  if (authError || !auth.user) return unauth();

  try {
    const body = asRecord(await req.json().catch(() => ({})));
    const hasMeaningfulInput = Boolean(trimText(body.subject, 200)) ||
      Boolean(trimText(body.body, 1000)) ||
      Boolean(trimText(body.related_order_id, 80)) ||
      (Array.isArray(body.attachments) && body.attachments.length > 0);
    if (!hasMeaningfulInput) {
      return bad("Add a subject, message, order ID, or proof before using AI.");
    }

    const orderId = requireUuid("related_order_id", body.related_order_id);
    const admin = supabaseAdminClient();
    const related = orderId
      ? await loadRelatedOrder(admin, auth.user.id, orderId)
      : null;
    const attachments = Array.isArray(body.attachments) ? body.attachments : [];
    const attachmentSummary = attachments.slice(0, 8).map((item: unknown) => {
      const file = asRecord(item);
      return {
        kind: trimText(file.kind, 24),
        mime_type: trimText(file.mime_type || file.mimeType, 120),
        file_name: trimText(file.file_name || file.name, 160),
        file_size: Number.isFinite(Number(file.file_size || file.size))
          ? Number(file.file_size || file.size)
          : null,
      };
    });

    const result = await requestGeminiJson({
      prompt: buildPrompt({ body, related, attachmentSummary }),
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.2,
      maxOutputTokens: 1200,
    });

    return ok({
      ok: true,
      model: result.model,
      suggestion: normalizeCompose(result.data, body),
    });
  } catch (error: unknown) {
    return bad(missingGeminiConfigMessage(error));
  }
});
