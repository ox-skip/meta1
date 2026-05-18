import { bad, methodNotAllowed, ok } from "../_shared/market/http.ts";
import { requireRewardUser } from "../_shared/market/rewards.ts";

const textEncoder = new TextEncoder();

function forwardedIp(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for") || "";
  const firstForwarded = forwarded.split(",")[0]?.trim();
  return (
    firstForwarded ||
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip") ||
    ""
  ).trim();
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function privacyHash(kind: string, value: string) {
  const raw = value.trim();
  if (!raw) return null;
  const salt = Deno.env.get("REFERRAL_HASH_SALT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "bestcity-referrals";
  return await sha256Hex(`${salt}:${kind}:${raw}`);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  try {
    const ctx = await requireRewardUser(req);
    if (ctx instanceof Response) return ctx;

    const body = await req.json().catch(() => ({}));
    const code = String(body?.code ?? body?.referral_code ?? "").trim();
    if (!code) return bad("Referral code required");

    const ipHash = await privacyHash("ip", forwardedIp(req));
    const userAgentHash = await privacyHash("ua", req.headers.get("user-agent") || "");

    const { data, error } = await ctx.admin.rpc("market_referral_apply", {
      p_referred_user_id: ctx.user.id,
      p_code: code,
      p_ip_hash: ipHash,
      p_user_agent_hash: userAgentHash,
      p_metadata: {
        source: "client_claim",
        surface: String(body?.surface ?? "rewards"),
      },
    });

    if (error) return bad(error.message);
    return ok(data ?? { ok: true });
  } catch (e) {
    return bad(String((e as any)?.message || e || "Unable to apply referral code"));
  }
});
