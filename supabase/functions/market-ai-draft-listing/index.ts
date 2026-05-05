import { supabaseUserClient } from "../_shared/market/supabase.ts";
import { bad, methodNotAllowed, ok, unauth } from "../_shared/market/http.ts";
import { envAny } from "../_shared/market/env.ts";

type ListingCategory = "product" | "service";
type DeliveryType = "physical" | "digital" | "in_person";

type AiDraft = {
  suggested_title: string;
  suggested_description: string;
  suggested_sub_category: string;
  tags: string[];
  warnings: string[];
  price_hint_low: number;
  price_hint_high: number;
  price_hint_currency: string;
  price_hint_reason: string;
  media_notes: string[];
  confidence_note: string;
};

type JsonRecord = Record<string, unknown>;

const DRAFT_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    suggested_title: { type: "string" },
    suggested_description: { type: "string" },
    suggested_sub_category: { type: "string" },
    tags: {
      type: "array",
      items: { type: "string" },
    },
    warnings: {
      type: "array",
      items: { type: "string" },
    },
    price_hint_low: { type: "number" },
    price_hint_high: { type: "number" },
    price_hint_currency: { type: "string" },
    price_hint_reason: { type: "string" },
    media_notes: {
      type: "array",
      items: { type: "string" },
    },
    confidence_note: { type: "string" },
  },
  required: [
    "suggested_title",
    "suggested_description",
    "suggested_sub_category",
    "tags",
    "warnings",
    "price_hint_low",
    "price_hint_high",
    "price_hint_currency",
    "price_hint_reason",
    "media_notes",
    "confidence_note",
  ],
} as const;

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

function normalizeMoney(input: unknown) {
  const num = Number(input);
  return Number.isFinite(num) && num > 0 ? num : 0;
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

function normalizeDraft(raw: unknown, fallbackCurrency: string): AiDraft {
  const draft = asRecord(raw);
  const priceHintLow = normalizeMoney(draft.price_hint_low);
  const priceHintHigh = normalizeMoney(draft.price_hint_high);
  const low = priceHintLow;
  const high = priceHintHigh > 0 ? Math.max(priceHintLow, priceHintHigh) : 0;

  return {
    suggested_title: trimText(draft.suggested_title, 120),
    suggested_description: trimText(draft.suggested_description, 2200),
    suggested_sub_category: trimText(draft.suggested_sub_category, 80),
    tags: normalizeStringList(draft.tags, 8, 32),
    warnings: normalizeStringList(draft.warnings, 6, 180),
    price_hint_low: low,
    price_hint_high: high,
    price_hint_currency: trimText(draft.price_hint_currency, 12) ||
      fallbackCurrency,
    price_hint_reason: trimText(draft.price_hint_reason, 220),
    media_notes: normalizeStringList(draft.media_notes, 4, 180),
    confidence_note: trimText(draft.confidence_note, 180),
  };
}

function buildPrompt(body: JsonRecord) {
  const mediaSummary = Array.isArray(body.media_summary)
    ? body.media_summary
    : [];
  const availableSubCategories = Array.isArray(body.available_sub_categories)
    ? body.available_sub_categories
    : [];
  const payload = {
    category: trimText(body.category, 20),
    delivery_type: trimText(body.delivery_type, 20),
    current_sub_category: trimText(body.sub_category, 80),
    title: trimText(body.title, 300),
    description: trimText(body.description, 5000),
    website_url: trimText(body.website_url, 300),
    price: Number.isFinite(Number(body.price)) ? Number(body.price) : null,
    local_currency: trimText(body.local_currency, 12) || "USD",
    media_summary: mediaSummary.length
      ? mediaSummary.slice(0, 8).map((item: unknown) => {
        const media = asRecord(item);
        return {
          kind: trimText(media.kind, 12),
          content_type: trimText(media.content_type, 80),
          file_name: trimText(media.file_name, 120),
          file_size: Number.isFinite(Number(media.file_size))
            ? Number(media.file_size)
            : null,
        };
      })
      : [],
    available_sub_categories: availableSubCategories.length
      ? availableSubCategories.slice(0, 60).map((item: unknown) => {
        const subCategory = asRecord(item);
        return {
          slug: trimText(subCategory.slug, 80),
          title: trimText(subCategory.title, 120),
        };
      })
      : [],
  };

  return [
    "You are writing marketplace listing suggestions for a seller.",
    "Return structured JSON only.",
    "Use only facts from the input payload. Do not invent brand, condition, warranty, delivery promises, stock, dimensions, timelines, or features that are not stated.",
    "Keep the seller in the same main listing type. Do not convert products into services or services into products.",
    "suggested_title must be concise, specific, and buyer-friendly.",
    "suggested_description must improve clarity and buyer confidence, but stay grounded in the provided details.",
    "suggested_sub_category must be one of the provided available_sub_categories.slug values when there is a clear match. Otherwise return an empty string.",
    "tags must be short lowercase search keywords.",
    "warnings must call out missing details that a buyer would likely want before purchasing.",
    "If there is not enough pricing evidence, set price_hint_low and price_hint_high to 0 and leave price_hint_reason empty.",
    "media_notes should mention any useful presentation advice visible from the media summary, without inventing unseen facts.",
    "confidence_note should be a short sentence explaining how reliable the suggestions are.",
    "Input payload:",
    JSON.stringify(payload),
  ].join("\n\n");
}

async function requestListingDraft(prompt: string) {
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
        responseJsonSchema: DRAFT_RESPONSE_SCHEMA,
        temperature: 0.3,
        maxOutputTokens: 1200,
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
    throw new Error("Gemini returned an unreadable AI draft.");
  }

  return {
    model: String(asRecord(json).modelVersion || model),
    draft: parsed,
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  const supabase = supabaseUserClient(req);
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return unauth();

  const body = asRecord(await req.json().catch(() => ({})));
  const category = trimText(body.category, 20) as ListingCategory;
  const deliveryType = trimText(body.delivery_type, 20) as DeliveryType;

  if (!["product", "service"].includes(category)) {
    return bad("Invalid category");
  }
  if (!["physical", "digital", "in_person"].includes(deliveryType)) {
    return bad("Invalid delivery_type");
  }

  const hasMeaningfulInput = !!trimText(body.title, 300) ||
    !!trimText(body.description, 2000) ||
    !!trimText(body.website_url, 300) ||
    (Array.isArray(body.media_summary) && body.media_summary.length > 0);

  if (!hasMeaningfulInput) {
    return bad(
      "Add at least a title, description, website URL, or media before using AI.",
    );
  }

  try {
    const prompt = buildPrompt(body);
    const result = await requestListingDraft(prompt);
    const fallbackCurrency = trimText(body.local_currency, 12) || "USD";
    return ok({
      model: result.model,
      draft: normalizeDraft(result.draft, fallbackCurrency),
    });
  } catch (error: unknown) {
    const message = errorMessage(error, "AI draft failed");
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
