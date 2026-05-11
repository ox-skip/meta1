import { type AdminContext, getAdminContext } from "../_shared/market/admin.ts";
import { bad, methodNotAllowed, ok, unauth } from "../_shared/market/http.ts";
import { supabaseAdminClient } from "../_shared/market/supabase.ts";
import { envAny } from "../_shared/market/env.ts";

type JsonRecord = Record<string, unknown>;

type SupportAiTriage = {
  category: string;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  confidence: "LOW" | "MEDIUM" | "HIGH";
  summary: string;
  customer_goal: string;
  urgency_reason: string;
  key_facts: string[];
  missing_evidence: string[];
  risk_flags: string[];
  recommended_next_action: string;
  suggested_admin_reply: string;
};

const SUPPORT_CATEGORIES = [
  "order",
  "payment",
  "listing",
  "account",
  "safety",
  "general",
] as const;
const SUPPORT_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
const CONFIDENCE_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;

const TRIAGE_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    category: { type: "string" },
    priority: { type: "string" },
    confidence: { type: "string" },
    summary: { type: "string" },
    customer_goal: { type: "string" },
    urgency_reason: { type: "string" },
    key_facts: {
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
    recommended_next_action: { type: "string" },
    suggested_admin_reply: { type: "string" },
  },
  required: [
    "category",
    "priority",
    "confidence",
    "summary",
    "customer_goal",
    "urgency_reason",
    "key_facts",
    "missing_evidence",
    "risk_flags",
    "recommended_next_action",
    "suggested_admin_reply",
  ],
} as const;

function can(ctx: AdminContext, permission: string) {
  return ctx.roleKey === "super_admin" || ctx.permissions.includes("*") ||
    ctx.permissions.includes(permission);
}

function hasSupportTicketAccess(ctx: AdminContext) {
  return (ctx.roleKey === "super_admin" || ctx.roleKey === "support_admin") &&
    can(ctx, "complaints.respond");
}

function trimText(input: unknown, max = 1000) {
  return String(input ?? "").trim().slice(0, max);
}

function asRecord(input: unknown): JsonRecord {
  return input && typeof input === "object" && !Array.isArray(input)
    ? input as JsonRecord
    : {};
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  return String(error || fallback);
}

function unique(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)),
  );
}

function requireUuid(name: string, value: unknown) {
  const raw = String(value ?? "").trim();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(raw)
  ) {
    throw new Error(`${name} must be a uuid`);
  }
  return raw;
}

function normalizeProviderErrorMessage(status: number, rawMessage: string) {
  const message = trimText(rawMessage, 500);
  const lower = message.toLowerCase();

  if (
    status === 400 &&
    (
      lower.includes("api key not valid") ||
      lower.includes("invalid api key") ||
      lower.includes("permission denied")
    )
  ) {
    return "Gemini API key is invalid. Update GEMINI_API_KEY in Supabase secrets.";
  }
  if (
    status === 401 ||
    status === 403 ||
    lower.includes("api key not valid") ||
    lower.includes("invalid api key") ||
    lower.includes("unauthorized") ||
    lower.includes("permission_denied")
  ) {
    return "Gemini API key is invalid or does not have access. Update GEMINI_API_KEY in Supabase secrets.";
  }
  if (
    status === 402 ||
    lower.includes("resource_exhausted") ||
    lower.includes("quota") ||
    lower.includes("billing") ||
    lower.includes("payment required") ||
    lower.includes("free tier") ||
    lower.includes("rate limit")
  ) {
    return "Gemini quota or rate limit reached. Wait and try again, or set GEMINI_MODEL to gemini-2.5-flash-lite for lighter free-tier usage.";
  }
  if (
    lower.includes("model") &&
    (lower.includes("not found") || lower.includes("access") ||
      lower.includes("unsupported"))
  ) {
    return "The configured Gemini model is not available for this API key. Check GEMINI_MODEL.";
  }
  if (status === 429 || lower.includes("rate limit")) {
    return "Gemini free-tier rate limit reached. Wait and try again.";
  }

  return message || "AI provider request failed";
}

function normalizeStringList(
  input: unknown,
  maxItems: number,
  maxChars: number,
) {
  const list = Array.isArray(input) ? input : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const value = trimText(item, maxChars);
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= maxItems) break;
  }
  return out;
}

function normalizeOneOf<T extends readonly string[]>(
  input: unknown,
  allowed: T,
  fallback: T[number],
): T[number] {
  const raw = trimText(input, 40).toUpperCase();
  return (allowed as readonly string[]).includes(raw)
    ? raw as T[number]
    : fallback;
}

function normalizeCategory(input: unknown, fallback: string) {
  const raw = trimText(input, 48).toLowerCase();
  if ((SUPPORT_CATEGORIES as readonly string[]).includes(raw)) return raw;
  const cleanFallback = trimText(fallback, 48).toLowerCase();
  return (SUPPORT_CATEGORIES as readonly string[]).includes(cleanFallback)
    ? cleanFallback
    : "general";
}

function extractAssistantText(payload: unknown): string {
  const root = asRecord(payload);
  const candidates = Array.isArray(root.candidates) ? root.candidates : [];
  const firstCandidate = asRecord(candidates[0]);
  const content = asRecord(firstCandidate.content);
  const parts = Array.isArray(content.parts) ? content.parts : [];
  const text = parts
    .map((part: unknown) => trimText(asRecord(part).text, 20000))
    .filter(Boolean)
    .join("");
  return trimText(text, 20000);
}

function normalizeTriage(
  raw: unknown,
  fallbackCategory: string,
  fallbackPriority: string,
): SupportAiTriage {
  const triage = asRecord(raw);
  return {
    category: normalizeCategory(triage.category, fallbackCategory),
    priority: normalizeOneOf(
      triage.priority,
      SUPPORT_PRIORITIES,
      normalizeOneOf(fallbackPriority, SUPPORT_PRIORITIES, "NORMAL"),
    ),
    confidence: normalizeOneOf(triage.confidence, CONFIDENCE_LEVELS, "LOW"),
    summary: trimText(triage.summary, 420),
    customer_goal: trimText(triage.customer_goal, 260),
    urgency_reason: trimText(triage.urgency_reason, 260),
    key_facts: normalizeStringList(triage.key_facts, 6, 220),
    missing_evidence: normalizeStringList(triage.missing_evidence, 6, 220),
    risk_flags: normalizeStringList(triage.risk_flags, 5, 220),
    recommended_next_action: trimText(triage.recommended_next_action, 340),
    suggested_admin_reply: trimText(triage.suggested_admin_reply, 1400),
  };
}

function attachmentSummary(attachment: any) {
  return {
    kind: trimText(attachment?.kind, 24),
    mime_type: trimText(attachment?.mime_type, 120),
    file_name: trimText(attachment?.file_name, 160),
    file_size: Number.isFinite(Number(attachment?.file_size))
      ? Number(attachment.file_size)
      : null,
    created_at: trimText(attachment?.created_at, 40),
  };
}

function messagesForPrompt(
  messages: any[],
  attachmentsByMessage: Record<string, any[]>,
) {
  return messages.slice(-60).map((message: any, index: number) => ({
    index: index + 1,
    sender_kind: trimText(message?.sender_kind, 20).toUpperCase() || "USER",
    created_at: trimText(message?.created_at, 40),
    body: trimText(message?.body, 1800),
    attachments: (attachmentsByMessage[String(message?.id)] ?? []).slice(0, 8)
      .map(attachmentSummary),
  }));
}

function buildPrompt(input: {
  ticket: any;
  messages: any[];
  attachmentsByMessage: Record<string, any[]>;
  sellerProfile: any | null;
  order: any | null;
  listing: any | null;
  dispute: any | null;
}) {
  const {
    ticket,
    messages,
    attachmentsByMessage,
    sellerProfile,
    order,
    listing,
    dispute,
  } = input;
  const ticketUserId = String(ticket?.user_id ?? "");
  const payload = {
    allowed_categories: SUPPORT_CATEGORIES,
    allowed_priorities: SUPPORT_PRIORITIES,
    ticket: {
      id: trimText(ticket?.id, 80),
      subject: trimText(ticket?.subject, 240),
      current_category: trimText(ticket?.category, 48),
      current_priority: trimText(ticket?.priority, 24),
      status: trimText(ticket?.status, 24),
      created_at: trimText(ticket?.created_at, 40),
      last_message_at: trimText(ticket?.last_message_at, 40),
      has_related_order: Boolean(ticket?.related_order_id),
    },
    customer_market_context: sellerProfile
      ? {
        has_seller_profile: true,
        seller_profile_active: Boolean(sellerProfile.active),
        seller_verified: Boolean(sellerProfile.is_verified),
        payout_tier: trimText(sellerProfile.payout_tier, 40),
        risk_score: Number.isFinite(Number(sellerProfile.risk_score))
          ? Number(sellerProfile.risk_score)
          : null,
      }
      : { has_seller_profile: false },
    related_order: order
      ? {
        id: trimText(order.id, 80),
        status: trimText(order.status, 40),
        quantity: Number.isFinite(Number(order.quantity))
          ? Number(order.quantity)
          : null,
        amount: Number.isFinite(Number(order.amount))
          ? Number(order.amount)
          : null,
        currency: trimText(order.currency, 16),
        ticket_user_is_buyer: String(order.buyer_id ?? "") === ticketUserId,
        ticket_user_is_seller: String(order.seller_id ?? "") === ticketUserId,
        created_at: trimText(order.created_at, 40),
        in_escrow_at: trimText(order.in_escrow_at, 40),
        out_for_delivery_at: trimText(order.out_for_delivery_at, 40),
        deliverable_uploaded_at: trimText(order.deliverable_uploaded_at, 40),
        delivered_at: trimText(order.delivered_at, 40),
        released_at: trimText(order.released_at, 40),
        refunded_at: trimText(order.refunded_at, 40),
        cancelled_at: trimText(order.cancelled_at, 40),
      }
      : null,
    related_listing: listing
      ? {
        id: trimText(listing.id, 80),
        title: trimText(listing.title, 240),
        category: trimText(listing.category, 40),
        sub_category: trimText(listing.sub_category, 80),
        delivery_type: trimText(listing.delivery_type, 40),
        price_amount: Number.isFinite(Number(listing.price_amount))
          ? Number(listing.price_amount)
          : null,
        currency: trimText(listing.currency, 16),
        stock_qty: Number.isFinite(Number(listing.stock_qty))
          ? Number(listing.stock_qty)
          : null,
        is_active: Boolean(listing.is_active),
      }
      : null,
    related_dispute: dispute
      ? {
        id: trimText(dispute.id, 80),
        status: trimText(dispute.status, 40),
        reason: trimText(dispute.reason, 600),
        resolution: trimText(dispute.resolution, 600),
        created_at: trimText(dispute.created_at, 40),
        updated_at: trimText(dispute.updated_at, 40),
      }
      : null,
    conversation: messagesForPrompt(messages, attachmentsByMessage),
  };

  return [
    "You are a support triage assistant for a marketplace admin team.",
    "Return structured JSON only.",
    "Use only facts in the input payload. Do not invent order state, delivery proof, refunds, releases, policy decisions, identity details, or customer intent.",
    "You are advisory only. Do not decide the case outcome. Do not promise refunds, releases, compensation, account action, or external contact.",
    "category must be one of allowed_categories. priority must be one of allowed_priorities.",
    "Use URGENT only for safety risk, account compromise, payment loss requiring immediate intervention, legal/regulatory risk, or clear time-critical escrow harm.",
    "risk_flags should be empty unless there is a concrete safety, fraud, payment, identity, abuse, or escalation risk in the payload.",
    "missing_evidence should ask for proof the admin needs before taking action, such as screenshots, receipt, order ID, delivery proof, or exact error messages.",
    "suggested_admin_reply must be short, warm, professional, and ready for the admin to edit. It must not mention AI or Gemini.",
    "If the thread already has an admin reply asking for the same evidence, recommend the next operational action instead of repeating it.",
    "Input payload:",
    JSON.stringify(payload),
  ].join("\n\n");
}

async function requestSupportTriage(prompt: string) {
  const apiKey = envAny([
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY",
  ]);
  const model = envAny(["GEMINI_MODEL"], "gemini-2.5-flash").trim();
  const baseUrl = envAny(
    ["GEMINI_API_BASE"],
    "https://generativelanguage.googleapis.com/v1beta",
  ).replace(/\/+$/, "");
  const modelPath = model.startsWith("models/") ? model : `models/${model}`;

  const res = await fetch(`${baseUrl}/${modelPath}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: TRIAGE_RESPONSE_SCHEMA,
        temperature: 0.2,
        maxOutputTokens: 1500,
      },
    }),
  });

  const text = await res.text().catch(() => "");
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  if (!res.ok) {
    const root = asRecord(json);
    const errorObj = asRecord(root.error);
    const metadata = asRecord(errorObj.metadata);
    const rawMessage = trimText(
      errorObj.message ||
        errorObj.status ||
        metadata.raw ||
        root.message ||
        text ||
        `Provider request failed with status ${res.status}`,
      400,
    );
    throw new Error(normalizeProviderErrorMessage(res.status, rawMessage));
  }

  const outputText = extractAssistantText(json);
  if (!outputText) {
    const root = asRecord(json);
    const candidates = Array.isArray(root.candidates) ? root.candidates : [];
    const firstCandidate = asRecord(candidates[0]);
    const promptFeedback = asRecord(root.promptFeedback);
    const reason = trimText(
      firstCandidate.finishReason || promptFeedback.blockReason || "",
      120,
    );
    throw new Error(
      reason
        ? `Gemini returned an empty response (${reason}).`
        : "Gemini returned an empty response.",
    );
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    throw new Error("Gemini returned unreadable support triage.");
  }

  return {
    model: String(asRecord(json).modelVersion || model),
    triage: parsed,
  };
}

async function loadTriageContext(admin: any, ticketId: string) {
  const { data: ticket, error: ticketError } = await admin
    .from("market_support_tickets")
    .select(
      "id,user_id,subject,category,priority,status,related_order_id,assigned_admin_id,message_slug,last_message_at,resolved_at,created_at,updated_at",
    )
    .eq("id", ticketId)
    .maybeSingle();
  if (ticketError) throw ticketError;
  if (!ticket?.id) throw new Error("Support ticket not found");

  const [
    { data: messages, error: messagesError },
    { data: sellerProfile, error: sellerError },
  ] = await Promise.all([
    admin
      .from("market_support_messages")
      .select("id,ticket_id,sender_id,sender_kind,message_slug,body,created_at")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: true })
      .limit(80),
    admin
      .from("market_seller_profiles")
      .select(
        "user_id,is_verified,risk_score,active,payout_tier,created_at,updated_at",
      )
      .eq("user_id", ticket.user_id)
      .maybeSingle(),
  ]);
  if (messagesError) throw messagesError;
  if (sellerError) throw sellerError;

  const messageIds = unique((messages ?? []).map((message: any) => message.id));
  const { data: attachments, error: attachmentsError } = messageIds.length
    ? await admin
      .from("market_support_message_attachments")
      .select(
        "id,message_id,ticket_id,kind,mime_type,file_name,file_size,created_at",
      )
      .in("message_id", messageIds)
      .order("created_at", { ascending: true })
      .limit(500)
    : { data: [], error: null };
  if (attachmentsError) throw attachmentsError;

  const attachmentsByMessage: Record<string, any[]> = {};
  for (const attachment of attachments ?? []) {
    const messageId = String(attachment.message_id ?? "");
    if (!messageId) continue;
    attachmentsByMessage[messageId] = [
      ...(attachmentsByMessage[messageId] ?? []),
      attachment,
    ];
  }

  let order: any | null = null;
  let listing: any | null = null;
  let dispute: any | null = null;
  const orderId = String(ticket.related_order_id ?? "").trim();
  if (orderId) {
    const [
      { data: orderRow, error: orderError },
      { data: disputeRow, error: disputeError },
    ] = await Promise.all([
      admin
        .from("market_orders")
        .select(
          "id,buyer_id,seller_id,listing_id,quantity,unit_price,amount,currency,status,created_at,in_escrow_at,out_for_delivery_at,deliverable_uploaded_at,delivered_at,released_at,refunded_at,cancelled_at",
        )
        .eq("id", orderId)
        .maybeSingle(),
      admin
        .from("market_disputes")
        .select(
          "id,order_id,opened_by,reason,status,resolution,created_at,updated_at",
        )
        .eq("order_id", orderId)
        .maybeSingle(),
    ]);
    if (orderError) throw orderError;
    if (disputeError) throw disputeError;
    order = orderRow ?? null;
    dispute = disputeRow ?? null;

    const listingId = String(order?.listing_id ?? "").trim();
    if (listingId) {
      const { data: listingRow, error: listingError } = await admin
        .from("market_listings")
        .select(
          "id,seller_id,category,sub_category,title,price_amount,currency,delivery_type,stock_qty,is_active,created_at,updated_at",
        )
        .eq("id", listingId)
        .maybeSingle();
      if (listingError) throw listingError;
      listing = listingRow ?? null;
    }
  }

  return {
    ticket,
    messages: messages ?? [],
    attachmentsByMessage,
    sellerProfile: sellerProfile ?? null,
    order,
    listing,
    dispute,
  };
}

function cacheFresh(
  cache: any,
  context: Awaited<ReturnType<typeof loadTriageContext>>,
) {
  if (!cache?.triage) return false;
  return String(cache.source_ticket_updated_at ?? "") ===
      String(context.ticket?.updated_at ?? "") &&
    String(cache.source_last_message_at ?? "") ===
      String(context.ticket?.last_message_at ?? "") &&
    Number(cache.source_message_count ?? -1) === context.messages.length;
}

async function loadCachedTriage(
  admin: any,
  ticketId: string,
  context: Awaited<ReturnType<typeof loadTriageContext>>,
) {
  const { data, error } = await admin
    .from("market_support_ai_triages")
    .select(
      "id,ticket_id,model,triage,source_ticket_updated_at,source_last_message_at,source_message_count,updated_at,created_at",
    )
    .eq("ticket_id", ticketId)
    .maybeSingle();
  if (error) {
    console.warn(
      "[market-support-ai-triage] cache read skipped:",
      error.message,
    );
    return null;
  }
  if (!cacheFresh(data, context)) return null;
  return data;
}

async function saveCachedTriage(
  admin: any,
  ctx: AdminContext,
  ticketId: string,
  context: Awaited<ReturnType<typeof loadTriageContext>>,
  model: string,
  triage: SupportAiTriage,
) {
  const { error } = await admin
    .from("market_support_ai_triages")
    .upsert({
      ticket_id: ticketId,
      generated_by: ctx.userId === "service-token" ? null : ctx.userId,
      provider: "gemini",
      model,
      triage,
      source_ticket_updated_at: context.ticket?.updated_at ?? null,
      source_last_message_at: context.ticket?.last_message_at ?? null,
      source_message_count: context.messages.length,
    }, { onConflict: "ticket_id" });
  if (error) {
    console.warn(
      "[market-support-ai-triage] cache write skipped:",
      error.message,
    );
  }
}

async function audit(admin: any, ctx: AdminContext, input: {
  ticketId: string;
  model: string;
  ticket: any;
  triage: SupportAiTriage;
}) {
  const { error } = await admin.from("market_audit_logs").insert({
    actor_id: ctx.userId === "service-token" ? null : ctx.userId,
    actor_type: "admin",
    action: "SUPPORT_AI_TRIAGE_GENERATED",
    entity_type: "market_support_tickets",
    entity_id: input.ticketId,
    payload: {
      role_key: ctx.roleKey,
      model: input.model,
      ticket_status: input.ticket?.status ?? null,
      ticket_priority: input.ticket?.priority ?? null,
      suggested_category: input.triage.category,
      suggested_priority: input.triage.priority,
      confidence: input.triage.confidence,
    },
  });
  if (error) {
    console.warn("[market-support-ai-triage] audit skipped:", error.message);
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  try {
    const ctx = await getAdminContext(req, {
      requireSession: true,
      permissions: ["complaints.respond"],
    });
    if (ctx instanceof Response) return ctx;
    if (!hasSupportTicketAccess(ctx)) return unauth();

    const body = asRecord(await req.json().catch(() => ({})));
    const ticketId = requireUuid("ticket_id", body.ticket_id);
    const forceRefresh = body.force === true || body.force_refresh === true;
    const admin = supabaseAdminClient();
    const context = await loadTriageContext(admin, ticketId);

    if (!forceRefresh) {
      const cached = await loadCachedTriage(admin, ticketId, context);
      if (cached?.triage) {
        const triage = normalizeTriage(
          cached.triage,
          context.ticket.category,
          context.ticket.priority,
        );
        return ok({
          ok: true,
          ticket_id: ticketId,
          generated_at: cached.updated_at ?? cached.created_at ??
            new Date().toISOString(),
          model: cached.model ?? null,
          cached: true,
          triage,
        });
      }
    }

    const result = await requestSupportTriage(buildPrompt(context));
    const triage = normalizeTriage(
      result.triage,
      context.ticket.category,
      context.ticket.priority,
    );
    await saveCachedTriage(admin, ctx, ticketId, context, result.model, triage);
    await audit(admin, ctx, {
      ticketId,
      model: result.model,
      ticket: context.ticket,
      triage,
    });

    return ok({
      ok: true,
      ticket_id: ticketId,
      generated_at: new Date().toISOString(),
      model: result.model,
      cached: false,
      triage,
    });
  } catch (error: unknown) {
    const message = errorMessage(error, "Support AI triage failed");
    if (
      /missing env var/i.test(message) ||
      /GEMINI_API_KEY|GOOGLE_API_KEY|GOOGLE_GENERATIVE_AI_API_KEY/i.test(
        message,
      )
    ) {
      return bad(
        "AI is not configured yet. Add GEMINI_API_KEY to Supabase Edge Function secrets.",
      );
    }
    return bad(message);
  }
});
