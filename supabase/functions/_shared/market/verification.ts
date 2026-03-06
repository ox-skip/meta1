import { envAny } from "./env.ts";

const encoder = new TextEncoder();

function optionalEnv(...keys: string[]) {
  for (const key of keys) {
    const value = Deno.env.get(key);
    if (value && value.trim().length) return value.trim();
  }
  return "";
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function signHmacSha256Hex(secret: string, payload: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return bytesToHex(new Uint8Array(signature));
}

export function getVerificationProviderName() {
  return envAny(["MARKET_VERIFICATION_PROVIDER"], "didit").trim().toLowerCase();
}

export function getDiditBaseUrl() {
  return envAny(["DIDIT_BASE_URL"], "https://verification.didit.me").replace(/\/+$/, "");
}

export function getDiditApiKey() {
  return envAny(["DIDIT_API_KEY"]);
}

export function getDiditWebhookSecret() {
  return envAny(["DIDIT_WEBHOOK_SECRET"]);
}

export function getDiditWorkflowId() {
  return envAny(["DIDIT_WORKFLOW_ID", "DIDIT_VERIFICATION_WORKFLOW_ID", "MARKET_VERIFICATION_WORKFLOW_ID"]);
}

export function getDiditSessionTtlSecs() {
  const raw = Number(envAny(["DIDIT_LINK_TTL_SECS"], "86400"));
  if (!Number.isFinite(raw) || raw < 300) return 86400;
  return Math.min(Math.floor(raw), 604800);
}

export function getDiditCallbackUrl() {
  return optionalEnv("DIDIT_CALLBACK_URL", "MARKET_VERIFICATION_CALLBACK_URL");
}

export function getDiditCallbackMethod() {
  const raw = optionalEnv("DIDIT_CALLBACK_METHOD", "MARKET_VERIFICATION_CALLBACK_METHOD").toLowerCase();
  if (raw === "initiator" || raw === "completer" || raw === "both") return raw;
  return "both";
}

export function getDiditLanguage() {
  const raw = optionalEnv("DIDIT_LANGUAGE", "MARKET_VERIFICATION_LANGUAGE");
  return raw || "en";
}

export function buildSellerVerificationExternalUserId(userId: string) {
  return `seller:${String(userId || "").trim()}`;
}

export function parseSellerVerificationExternalUserId(externalUserId: string | null | undefined) {
  const raw = String(externalUserId || "").trim();
  const match = raw.match(/^seller:([0-9a-fA-F-]{36})$/);
  return match?.[1] ?? null;
}

export function normalizeCountryCode(input: unknown) {
  const raw = String(input ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(raw) ? raw : null;
}

export function normalizePhone(input: unknown) {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  const compact = raw.replace(/[^\d+]/g, "");
  return compact.length >= 7 ? compact : null;
}

export function parseDiditTimestamp(input: unknown) {
  if (input === null || input === undefined || input === "") return null;
  if (typeof input === "number" && Number.isFinite(input)) {
    if (input > 10_000_000_000) return new Date(input).toISOString();
    return new Date(input * 1000).toISOString();
  }
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    if (n > 10_000_000_000) return new Date(n).toISOString();
    return new Date(n * 1000).toISOString();
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function mapDiditVerificationStatus(input: unknown) {
  const raw = typeof input === "string" ? input : String((input as any)?.status ?? "");
  const status = raw.trim();
  if (status === "Approved") return "VERIFIED";
  if (status === "Declined") return "REJECTED";
  if (status === "In Review") return "IN_REVIEW";
  if (status === "Resubmitted") return "RESUBMISSION_REQUIRED";
  if (status === "Expired" || status === "Abandoned" || status === "Kyc Expired") return "EXPIRED";
  return "PENDING";
}

export async function diditRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const upperMethod = method.toUpperCase();
  const bodyText = body === undefined ? "" : JSON.stringify(body);
  const url = /^https?:\/\//i.test(path) ? path : `${getDiditBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;

  const res = await fetch(url, {
    method: upperMethod,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": getDiditApiKey(),
    },
    body: bodyText || undefined,
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
    const message = String(
      json?.message ||
        json?.error ||
        json?.detail ||
        json?.description ||
        text ||
        `Didit ${upperMethod} ${path} failed`,
    );
    throw new Error(message);
  }
  return json as T;
}

function isFreshTimestamp(timestampHeader?: string | null) {
  const parsed = Number(String(timestampHeader ?? "").trim());
  if (!Number.isFinite(parsed)) return false;
  const now = Math.floor(Date.now() / 1000);
  return Math.abs(now - parsed) <= 300;
}

function shortenFloats(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(shortenFloats);
  if (input !== null && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) out[k] = shortenFloats(v);
    return out;
  }
  if (typeof input === "number" && !Number.isInteger(input) && input % 1 === 0) return Math.trunc(input);
  return input;
}

function sortKeys(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(sortKeys);
  if (input !== null && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(input as Record<string, unknown>).sort()) {
      out[key] = sortKeys((input as Record<string, unknown>)[key]);
    }
    return out;
  }
  return input;
}

export async function verifyDiditWebhookSignatureV2(payload: unknown, signature?: string | null, timestampHeader?: string | null) {
  if (!signature || !isFreshTimestamp(timestampHeader)) return false;
  const canonicalJson = JSON.stringify(sortKeys(shortenFloats(payload)));
  const expected = await signHmacSha256Hex(getDiditWebhookSecret(), canonicalJson);
  return timingSafeEqual(expected, String(signature).trim().toLowerCase());
}

export async function verifyDiditWebhookSignatureSimple(
  payload: any,
  signature?: string | null,
  timestampHeader?: string | null,
) {
  if (!signature || !isFreshTimestamp(timestampHeader)) return false;
  const canonicalString = [
    String(payload?.timestamp ?? ""),
    String(payload?.session_id ?? ""),
    String(payload?.status ?? ""),
    String(payload?.webhook_type ?? ""),
  ].join(":");
  const expected = await signHmacSha256Hex(getDiditWebhookSecret(), canonicalString);
  return timingSafeEqual(expected, String(signature).trim().toLowerCase());
}

export async function verifyDiditWebhookSignatureRaw(rawBody: string, signature?: string | null, timestampHeader?: string | null) {
  if (!signature || !isFreshTimestamp(timestampHeader)) return false;
  const expected = await signHmacSha256Hex(getDiditWebhookSecret(), rawBody);
  return timingSafeEqual(expected, String(signature).trim().toLowerCase());
}

function asStringLabel(item: unknown) {
  if (!item) return "";
  if (typeof item === "string") return item.trim();
  if (typeof item === "object") {
    const obj = item as Record<string, unknown>;
    const value = obj.code ?? obj.reason ?? obj.message ?? obj.name ?? obj.type;
    if (typeof value === "string") return value.trim();
  }
  return "";
}

export function collectDiditRejectLabels(payload: any) {
  const labels: string[] = [];
  const warnings = payload?.decision?.warnings;
  if (Array.isArray(warnings)) {
    for (const warning of warnings) {
      const label = asStringLabel(warning);
      if (label) labels.push(label);
    }
  }

  const reasons = payload?.resubmit_info?.reasons;
  if (reasons && typeof reasons === "object") {
    for (const value of Object.values(reasons as Record<string, unknown>)) {
      const label = asStringLabel(value);
      if (label) labels.push(label);
    }
  }

  return Array.from(new Set(labels)).slice(0, 25);
}

export function deriveDiditDocumentType(payload: any) {
  const candidates = [
    payload?.decision?.id_verification?.document_type,
    payload?.decision?.id_verification?.document?.document_type,
    payload?.decision?.document_type,
    payload?.document_type,
    payload?.decision?.document?.type,
  ];
  for (const candidate of candidates) {
    const text = String(candidate ?? "").trim();
    if (text) return text;
  }
  return null;
}

export function deriveDiditCountryCode(payload: any) {
  const candidates = [
    payload?.decision?.id_verification?.id_country,
    payload?.decision?.id_verification?.poa_country,
    payload?.decision?.id_verification?.country,
    payload?.country,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeCountryCode(candidate);
    if (normalized) return normalized;
  }
  return null;
}
