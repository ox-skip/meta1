import { bad, methodNotAllowed, ok, unauth } from "../_shared/market/http.ts";
import {
  supabaseAdminClient,
  supabaseUserClient,
} from "../_shared/market/supabase.ts";
import {
  asRecord,
  missingGeminiConfigMessage,
  normalizeOneOf,
  normalizeStringList,
  requestGeminiJson,
  trimText,
} from "../_shared/market/gemini.ts";

const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
const CONFIDENCE_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    risk_level: { type: "string" },
    confidence: { type: "string" },
    summary: { type: "string" },
    risk_flags: { type: "array", items: { type: "string" } },
    safer_reply: { type: "string" },
    recommended_action: { type: "string" },
    should_pause_before_sending: { type: "boolean" },
  },
  required: [
    "risk_level",
    "confidence",
    "summary",
    "risk_flags",
    "safer_reply",
    "recommended_action",
    "should_pause_before_sending",
  ],
} as const;

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

function normalizeSafety(raw: unknown) {
  const data = asRecord(raw);
  return {
    risk_level: normalizeOneOf(data.risk_level, RISK_LEVELS, "LOW"),
    confidence: normalizeOneOf(data.confidence, CONFIDENCE_LEVELS, "LOW"),
    summary: trimText(data.summary, 360),
    risk_flags: normalizeStringList(data.risk_flags, 7, 180),
    safer_reply: trimText(data.safer_reply, 900),
    recommended_action: trimText(data.recommended_action, 280),
    should_pause_before_sending: Boolean(data.should_pause_before_sending),
  };
}

function buildPrompt(input: {
  thread: any;
  userId: string;
  otherProfile: any | null;
  otherSeller: any | null;
  messages: any[];
  draftMessage: string;
  pendingMediaKind: string;
}) {
  const payload = {
    current_user_id: input.userId,
    other_user: input.otherProfile
      ? {
        id: input.otherProfile.id,
        username: trimText(input.otherProfile.username, 80),
        has_seller_profile: Boolean(input.otherSeller),
        seller_active: Boolean(input.otherSeller?.active),
        seller_verified: Boolean(input.otherSeller?.is_verified),
      }
      : null,
    draft_message: trimText(input.draftMessage, 2500),
    pending_media_kind: trimText(input.pendingMediaKind, 24),
    recent_messages: input.messages.slice(-40).map((
      message: any,
      index: number,
    ) => ({
      index: index + 1,
      mine: String(message.sender_id) === input.userId,
      body: trimText(message.body, 1600),
      has_attachments: Boolean(message.has_attachments),
      created_at: trimText(message.created_at, 40),
    })),
  };

  return [
    "You are a marketplace DM safety assistant.",
    "Return structured JSON only.",
    "Use only the payload. Do not infer facts beyond the messages.",
    "Look for off-platform payment requests, escrow bypass, suspicious links, account compromise, abusive language, threats, fraud patterns, fake delivery/refund promises, pressure tactics, and requests for sensitive credentials.",
    "Do not flag normal buyer-seller negotiation as risky unless there is a concrete safety or payment concern.",
    "If the draft message is risky for the sender to send, provide a safer_reply that keeps them on-platform and avoids sharing sensitive information.",
    "should_pause_before_sending should be true for HIGH or URGENT risk, or when the user's draft contains sensitive personal/payment info, off-platform payment, passwords, seed phrases, OTPs, or unsafe links.",
    "recommended_action should be short and operational.",
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
    const threadId = requireUuid("thread_id", body.thread_id);
    const draftMessage = trimText(body.draft_message, 2500);
    const pendingMediaKind = trimText(body.pending_media_kind, 24);
    const admin = supabaseAdminClient();

    const { data: thread, error: threadError } = await admin
      .from("dm_threads")
      .select("id,a_user_id,b_user_id,last_message_at,created_at")
      .eq("id", threadId)
      .maybeSingle();
    if (threadError) throw threadError;
    if (!thread?.id) throw new Error("DM thread not found");
    if (
      String(thread.a_user_id) !== auth.user.id &&
      String(thread.b_user_id) !== auth.user.id
    ) {
      return unauth();
    }

    const otherUserId = String(thread.a_user_id) === auth.user.id
      ? String(thread.b_user_id)
      : String(thread.a_user_id);
    const [
      { data: messages, error: messagesError },
      { data: profiles, error: profileError },
      { data: seller, error: sellerError },
    ] = await Promise.all([
      admin
        .from("dm_messages")
        .select("id,thread_id,sender_id,body,has_attachments,created_at")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: true })
        .limit(80),
      admin
        .from("profiles")
        .select("id,username,full_name")
        .eq("id", otherUserId)
        .maybeSingle(),
      admin
        .from("market_seller_profiles")
        .select("user_id,market_username,active,is_verified")
        .eq("user_id", otherUserId)
        .maybeSingle(),
    ]);
    if (messagesError) throw messagesError;
    if (profileError) throw profileError;
    if (sellerError) throw sellerError;

    if (!draftMessage && !(messages ?? []).length && !pendingMediaKind) {
      return bad(
        "Add a draft message or open a conversation before using AI safety.",
      );
    }

    const result = await requestGeminiJson({
      prompt: buildPrompt({
        thread,
        userId: auth.user.id,
        otherProfile: profiles ?? null,
        otherSeller: seller ?? null,
        messages: messages ?? [],
        draftMessage,
        pendingMediaKind,
      }),
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.15,
      maxOutputTokens: 1100,
    });

    return ok({
      ok: true,
      thread_id: threadId,
      model: result.model,
      safety: normalizeSafety(result.data),
    });
  } catch (error: unknown) {
    return bad(missingGeminiConfigMessage(error));
  }
});
