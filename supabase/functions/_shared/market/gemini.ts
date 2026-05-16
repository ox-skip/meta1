import { envAny } from "./env.ts";

export type JsonRecord = Record<string, unknown>;

export function trimText(input: unknown, max = 1000) {
  return String(input ?? "").trim().slice(0, max);
}

export function asRecord(input: unknown): JsonRecord {
  return input && typeof input === "object" && !Array.isArray(input)
    ? input as JsonRecord
    : {};
}

export function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  return String(error || fallback);
}

export function normalizeStringList(
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

export function normalizeOneOf<T extends readonly string[]>(
  input: unknown,
  allowed: T,
  fallback: T[number],
): T[number] {
  const raw = trimText(input, 60).toUpperCase();
  return (allowed as readonly string[]).includes(raw)
    ? raw as T[number]
    : fallback;
}

export type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

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

export async function requestGeminiJson(input: {
  prompt: string;
  parts?: GeminiPart[];
  responseSchema: unknown;
  temperature?: number;
  maxOutputTokens?: number;
}) {
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
  const parts = input.parts?.length ? input.parts : [{ text: input.prompt }];

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
          parts,
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: input.responseSchema,
        temperature: input.temperature ?? 0.2,
        maxOutputTokens: input.maxOutputTokens ?? 1200,
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

  try {
    return {
      model: String(asRecord(json).modelVersion || model),
      data: JSON.parse(outputText) as unknown,
    };
  } catch {
    throw new Error("Gemini returned unreadable JSON.");
  }
}

export function missingGeminiConfigMessage(error: unknown) {
  const message = errorMessage(error, "AI request failed");
  if (
    /missing env var/i.test(message) ||
    /GEMINI_API_KEY|GOOGLE_API_KEY|GOOGLE_GENERATIVE_AI_API_KEY/i.test(message)
  ) {
    return "AI is not configured yet. Add GEMINI_API_KEY to Supabase Edge Function secrets.";
  }
  return message;
}
