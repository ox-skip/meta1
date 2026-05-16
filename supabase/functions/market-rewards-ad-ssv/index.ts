import { bad, methodNotAllowed, ok } from "../_shared/market/http.ts";
import {
  cleanText,
  getTaskAvailability,
  loadRewardTaskByKeyOrId,
  rewardAdSession,
} from "../_shared/market/rewards.ts";
import { supabaseAdminClient } from "../_shared/market/supabase.ts";

const GOOGLE_KEYS_URL = "https://www.gstatic.com/admob/reward/verifier-keys.json";

function base64UrlToBytes(input: string) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function pemToSpki(pem: string) {
  const body = pem
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\s+/g, "");
  return base64UrlToBytes(body);
}

function derEcdsaToRaw(der: Uint8Array) {
  let offset = 0;
  if (der[offset++] !== 0x30) throw new Error("Invalid ECDSA signature");
  let seqLen = der[offset++];
  if (seqLen & 0x80) {
    const bytes = seqLen & 0x7f;
    seqLen = 0;
    for (let i = 0; i < bytes; i++) seqLen = (seqLen << 8) + der[offset++];
  }
  if (der[offset++] !== 0x02) throw new Error("Invalid ECDSA r");
  const rLen = der[offset++];
  const r = der.slice(offset, offset + rLen);
  offset += rLen;
  if (der[offset++] !== 0x02) throw new Error("Invalid ECDSA s");
  const sLen = der[offset++];
  const s = der.slice(offset, offset + sLen);

  const out = new Uint8Array(64);
  const rTrim = r[0] === 0 ? r.slice(1) : r;
  const sTrim = s[0] === 0 ? s.slice(1) : s;
  out.set(rTrim.slice(-32), 32 - Math.min(32, rTrim.length));
  out.set(sTrim.slice(-32), 64 - Math.min(32, sTrim.length));
  return out;
}

function signedPayloadCandidates(url: URL) {
  const raw = url.search.startsWith("?") ? url.search.slice(1) : url.search;
  const parts = raw.split("&").filter(Boolean);
  const noSig = parts.filter((part) => {
    const key = decodeURIComponent(part.split("=")[0] ?? "");
    return key !== "signature" && key !== "key_id";
  }).join("&");

  const beforeSignature = raw.includes("&signature=")
    ? raw.slice(0, raw.indexOf("&signature="))
    : raw.includes("signature=")
      ? raw.slice(0, raw.indexOf("signature=")).replace(/&$/, "")
      : noSig;

  return Array.from(new Set([beforeSignature, noSig].filter(Boolean)));
}

async function verifyGoogleSignature(url: URL) {
  const signature = url.searchParams.get("signature") ?? "";
  const keyId = url.searchParams.get("key_id") ?? "";
  if (!signature || !keyId) return false;

  const res = await fetch(GOOGLE_KEYS_URL);
  if (!res.ok) throw new Error("Could not load Google reward verifier keys");
  const json = await res.json();
  const keys = Array.isArray(json?.keys) ? json.keys : [];
  const key = keys.find((item: any) => String(item.keyId ?? item.key_id ?? "") === String(keyId));
  const pem = String(key?.pem ?? "");
  if (!pem) return false;

  const cryptoKey = await crypto.subtle.importKey(
    "spki",
    pemToSpki(pem),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );

  const signatureBytes = derEcdsaToRaw(base64UrlToBytes(signature));
  for (const payload of signedPayloadCandidates(url)) {
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      cryptoKey,
      signatureBytes,
      new TextEncoder().encode(payload),
    );
    if (ok) return true;
  }
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return methodNotAllowed(req);
  if (!["GET", "POST"].includes(req.method)) return methodNotAllowed(req);

  const admin = supabaseAdminClient();
  const url = new URL(req.url);
  const customData = cleanText(url.searchParams.get("custom_data"), 220);
  const userId = cleanText(url.searchParams.get("user_id"), 80);
  const transactionId = cleanText(url.searchParams.get("transaction_id"), 160);
  const allowUnverified = Deno.env.get("REWARD_AD_SSV_ALLOW_UNVERIFIED") === "true";

  try {
    if (!customData || !userId || !transactionId) {
      return bad("Missing SSV parameters");
    }

    const verified = allowUnverified ? true : await verifyGoogleSignature(url);
    const { data: session, error } = await admin
      .from("market_reward_ad_sessions")
      .select("*")
      .eq("custom_data", customData)
      .maybeSingle();
    if (error) return bad(error.message);
    if (!session?.id) return bad("Ad session not found");
    if (String(session.user_id) !== userId) return bad("Ad session user mismatch");

    const payload = Object.fromEntries(url.searchParams.entries());
    if (!verified) {
      await admin
        .from("market_reward_ad_sessions")
        .update({
          status: "rejected",
          failure_reason: "Invalid Google SSV signature",
          provider_transaction_id: transactionId || null,
          verification_payload: payload,
          updated_at: new Date().toISOString(),
        })
        .eq("id", session.id);
      return bad("Invalid SSV signature");
    }

    if (session.ledger_id || session.status === "rewarded") {
      return ok({ ok: true, duplicate: true });
    }

    if (session.task_id) {
      const task = await loadRewardTaskByKeyOrId(admin, { task_id: session.task_id });
      const availability = await getTaskAvailability(admin, session.user_id, task);
      if (!availability.available) {
        await admin
          .from("market_reward_ad_sessions")
          .update({
            status: "rejected",
            failure_reason: availability.reason || "Reward cap reached",
            provider_transaction_id: transactionId,
            verification_payload: payload,
            verified_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", session.id);
        return bad(availability.reason || "Reward cap reached");
      }
    }

    const { data: verifiedSession, error: updateError } = await admin
      .from("market_reward_ad_sessions")
      .update({
        status: "verified",
        provider_transaction_id: transactionId,
        verification_payload: payload,
        verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", session.id)
      .select("*")
      .single();

    if (updateError) {
      if (String(updateError.code) === "23505") return ok({ ok: true, duplicate: true });
      return bad(updateError.message);
    }

    const reward = await rewardAdSession(admin, verifiedSession, {
      provider_transaction_id: transactionId,
      reward_amount: url.searchParams.get("reward_amount"),
      reward_item: url.searchParams.get("reward_item"),
      verification_mode: allowUnverified ? "unverified_env_override" : "google_ssv",
    });

    return ok({ ok: true, reward });
  } catch (e) {
    return bad(String((e as any)?.message || e || "Rewarded ad verification failed"));
  }
});
