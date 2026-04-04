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

function normalizeProviderErrorMessage(status: number, rawMessage: string) {
  const message = trimText(rawMessage, 500);
  const lower = message.toLowerCase();

  if (status === 401 || status === 403 || lower.includes("invalid api key") || lower.includes("unauthorized")) {
    return "OpenRouter API key is invalid. Update OPENROUTER_API_KEY in Supabase secrets.";
  }
  if (
    status === 402 ||
    lower.includes("insufficient_credit") ||
    lower.includes("insufficient credits") ||
    lower.includes("quota") ||
    lower.includes("billing") ||
    lower.includes("payment required") ||
    lower.includes("credits required")
  ) {
    return "OpenRouter credits are required for this request or your free quota is exhausted. Use the free router model and check your OpenRouter account limits.";
  }
  if (lower.includes("model") && (lower.includes("not found") || lower.includes("access") || lower.includes("unsupported"))) {
    return "The configured OpenRouter model is not available for this API key. Check OPENROUTER_MODEL.";
  }
  if (status === 429 || lower.includes("rate limit")) {
    return "OpenRouter free-model rate limit reached. Free accounts have low request limits. Wait and try again.";
  }

  return message || "AI provider request failed";
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

function extractAssistantText(payload: any): string {
  const content = trimText(payload?.choices?.[0]?.message?.content, 20000);
  if (content) return content;

  const text = trimText(payload?.choices?.[0]?.text, 20000);
  if (text) return text;

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
  const apiKey = envAny(["OPENROUTER_API_KEY"]);
  const model = envAny(["OPENROUTER_MODEL"], "openrouter/free").trim();
  const baseUrl = envAny(["OPENROUTER_API_BASE"], "https://openrouter.ai/api/v1").replace(/\/+$/, "");
  const referer = trimText(envAny(["OPENROUTER_HTTP_REFERER", "APP_PUBLIC_URL"], ""), 200);
  const title = trimText(envAny(["OPENROUTER_APP_TITLE"], "Meta Market"), 80);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  if (referer) headers["HTTP-Referer"] = referer;
  if (title) headers["X-OpenRouter-Title"] = title;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "market_listing_ai_draft",
          strict: true,
          schema: DRAFT_RESPONSE_SCHEMA,
        },
      },
      plugins: [{ id: "response-healing" }],
      temperature: 0.3,
      max_tokens: 1200,
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
        json?.error?.metadata?.raw ||
        json?.message ||
        text ||
        `Provider request failed with status ${res.status}`,
      400,
    );
    throw new Error(normalizeProviderErrorMessage(res.status, rawMessage));
  }

  const outputText = extractAssistantText(json);
  if (!outputText) {
    throw new Error("The AI provider returned an empty response.");
  }

  let parsed: any = null;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    throw new Error("The AI provider returned an unreadable AI draft.");
  }

  return {
    model: String(json?.model || model),
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
    if (/missing env var/i.test(message) || /OPENROUTER_API_KEY/i.test(message)) {
      return bad("AI is not configured yet. Add OPENROUTER_API_KEY to Supabase Edge Function secrets.");
    }
    return bad(message);
  }
});
