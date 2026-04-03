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

const OPENAI_RESPONSE_SCHEMA = {
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

function normalizeOpenAiErrorMessage(status: number, rawMessage: string) {
  const message = trimText(rawMessage, 500);
  const lower = message.toLowerCase();

  if (status === 401 || status === 403 || lower.includes("invalid api key")) {
    return "OpenAI API key is invalid. Update OPENAI_API_KEY in Supabase secrets.";
  }
  if (
    lower.includes("insufficient_quota") ||
    lower.includes("quota") ||
    lower.includes("billing") ||
    lower.includes("payment required") ||
    lower.includes("free tier") ||
    lower.includes("not supported for your usage tier")
  ) {
    return "OpenAI API billing or credits are not enabled for this project. Add billing in OpenAI before using AI suggestions.";
  }
  if (lower.includes("model") && (lower.includes("not found") || lower.includes("access") || lower.includes("unsupported"))) {
    return "The configured OpenAI model is not available for this API key. Check OPENAI_LISTING_MODEL.";
  }
  if (status === 429 || lower.includes("rate limit")) {
    return "OpenAI rate limit reached. Wait a moment and try again.";
  }

  return message || "OpenAI request failed";
}

function normalizeStringList(input: unknown, maxItems: number, maxChars: number) {
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

function extractOpenAiText(payload: any): string {
  const direct = trimText(payload?.output_text, 20000);
  if (direct) return direct;

  const output = Array.isArray(payload?.output) ? payload.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const entry of content) {
      const candidate =
        (typeof entry?.text === "string" ? entry.text : "") ||
        (typeof entry?.text?.value === "string" ? entry.text.value : "") ||
        (entry?.json ? JSON.stringify(entry.json) : "") ||
        (typeof entry?.value === "string" ? entry.value : "");
      const text = trimText(candidate, 20000);
      if (text) return text;
    }
  }

  return "";
}

function normalizeDraft(raw: any, fallbackCurrency: string): AiDraft {
  const priceHintLow = normalizeMoney(raw?.price_hint_low);
  const priceHintHigh = normalizeMoney(raw?.price_hint_high);
  const low = priceHintLow;
  const high = priceHintHigh > 0 ? Math.max(priceHintLow, priceHintHigh) : 0;

  return {
    suggested_title: trimText(raw?.suggested_title, 120),
    suggested_description: trimText(raw?.suggested_description, 2200),
    suggested_sub_category: trimText(raw?.suggested_sub_category, 80),
    tags: normalizeStringList(raw?.tags, 8, 32),
    warnings: normalizeStringList(raw?.warnings, 6, 180),
    price_hint_low: low,
    price_hint_high: high,
    price_hint_currency: trimText(raw?.price_hint_currency, 12) || fallbackCurrency,
    price_hint_reason: trimText(raw?.price_hint_reason, 220),
    media_notes: normalizeStringList(raw?.media_notes, 4, 180),
    confidence_note: trimText(raw?.confidence_note, 180),
  };
}

function buildPrompt(body: any) {
  const payload = {
    category: trimText(body?.category, 20),
    delivery_type: trimText(body?.delivery_type, 20),
    current_sub_category: trimText(body?.sub_category, 80),
    title: trimText(body?.title, 300),
    description: trimText(body?.description, 5000),
    website_url: trimText(body?.website_url, 300),
    price: Number.isFinite(Number(body?.price)) ? Number(body.price) : null,
    local_currency: trimText(body?.local_currency, 12) || "USD",
    media_summary: Array.isArray(body?.media_summary)
      ? body.media_summary.slice(0, 8).map((item: any) => ({
          kind: trimText(item?.kind, 12),
          content_type: trimText(item?.content_type, 80),
          file_name: trimText(item?.file_name, 120),
          file_size: Number.isFinite(Number(item?.file_size)) ? Number(item.file_size) : null,
        }))
      : [],
    available_sub_categories: Array.isArray(body?.available_sub_categories)
      ? body.available_sub_categories.slice(0, 60).map((item: any) => ({
          slug: trimText(item?.slug, 80),
          title: trimText(item?.title, 120),
        }))
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
  const apiKey = envAny(["OPENAI_API_KEY"]);
  const model = envAny(["OPENAI_LISTING_MODEL", "OPENAI_MODEL"], "gpt-5.4-mini").trim();
  const baseUrl = envAny(["OPENAI_API_BASE"], "https://api.openai.com/v1").replace(/\/+$/, "");

  const res = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: prompt,
      max_output_tokens: 1200,
      text: {
        format: {
          type: "json_schema",
          name: "market_listing_ai_draft",
          strict: true,
          schema: OPENAI_RESPONSE_SCHEMA,
        },
      },
    }),
  });

  const text = await res.text().catch(() => "");
  let json: any = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  if (!res.ok) {
    const rawMessage = trimText(
      json?.error?.message ||
        json?.message ||
        text ||
        `OpenAI request failed with status ${res.status}`,
      400,
    );
    throw new Error(normalizeOpenAiErrorMessage(res.status, rawMessage));
  }

  const outputText = extractOpenAiText(json);
  if (!outputText) {
    throw new Error("OpenAI returned an empty response.");
  }

  let parsed: any = null;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    throw new Error("OpenAI returned an unreadable AI draft.");
  }

  return {
    model,
    draft: parsed,
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  const supabase = supabaseUserClient(req);
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return unauth();

  const body = await req.json().catch(() => ({}));
  const category = trimText(body?.category, 20) as ListingCategory;
  const deliveryType = trimText(body?.delivery_type, 20) as DeliveryType;

  if (!["product", "service"].includes(category)) return bad("Invalid category");
  if (!["physical", "digital", "in_person"].includes(deliveryType)) return bad("Invalid delivery_type");

  const hasMeaningfulInput =
    !!trimText(body?.title, 300) ||
    !!trimText(body?.description, 2000) ||
    !!trimText(body?.website_url, 300) ||
    (Array.isArray(body?.media_summary) && body.media_summary.length > 0);

  if (!hasMeaningfulInput) {
    return bad("Add at least a title, description, website URL, or media before using AI.");
  }

  try {
    const prompt = buildPrompt(body);
    const result = await requestListingDraft(prompt);
    const fallbackCurrency = trimText(body?.local_currency, 12) || "USD";
    return ok({
      model: result.model,
      draft: normalizeDraft(result.draft, fallbackCurrency),
    });
  } catch (error: any) {
    const message = String(error?.message || error || "AI draft failed");
    if (/missing env var/i.test(message) || /OPENAI_API_KEY/i.test(message)) {
      return bad("AI is not configured yet. Add OPENAI_API_KEY to Supabase Edge Function secrets.");
    }
    return bad(message);
  }
});
