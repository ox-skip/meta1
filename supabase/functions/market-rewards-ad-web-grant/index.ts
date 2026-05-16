import { bad, methodNotAllowed, ok } from "../_shared/market/http.ts";
import {
  cleanText,
  getTaskAvailability,
  loadRewardTaskByKeyOrId,
  publicTask,
  requireRewardUser,
  rewardAdSession,
} from "../_shared/market/rewards.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  try {
    const ctx = await requireRewardUser(req);
    if (ctx instanceof Response) return ctx;
    const { user, admin } = ctx;
    const body = await req.json().catch(() => ({}));
    const sessionId = cleanText(body.session_id, 80);
    if (!sessionId) return bad("session_id required");

    const { data: session, error } = await admin
      .from("market_reward_ad_sessions")
      .select("*")
      .eq("id", sessionId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) return bad(error.message);
    if (!session?.id) return bad("Ad session not found");

    if (session.provider !== "google_ad_manager" || session.platform !== "web") {
      return bad("This grant endpoint only accepts Google Ad Manager web rewarded sessions.");
    }
    if (Date.parse(String(session.expires_at)) <= Date.now()) return bad("Ad session expired");
    if (["rejected", "expired"].includes(String(session.status ?? ""))) {
      return bad(session.failure_reason || "Ad session cannot be rewarded.");
    }
    if (session.ledger_id || session.status === "rewarded") {
      const duplicate = await rewardAdSession(admin, session, { verification_mode: "gpt_web_duplicate" });
      return ok({ ok: true, duplicate: true, reward: duplicate });
    }

    const task = session.task_id
      ? await loadRewardTaskByKeyOrId(admin, { task_id: session.task_id })
      : null;
    const availability = task ? await getTaskAvailability(admin, user.id, task) : null;
    if (availability && !availability.available) {
      return bad(availability.reason || "Ad reward is not available", {
        task: task ? publicTask(task, availability) : null,
      });
    }

    const nowIso = new Date().toISOString();
    const { data: verifiedSession, error: updateError } = await admin
      .from("market_reward_ad_sessions")
      .update({
        status: "verified",
        client_earned_at: session.client_earned_at ?? nowIso,
        verified_at: nowIso,
        verification_payload: {
          ...(session.verification_payload ?? {}),
          verification_mode: "gpt_rewarded_slot_granted",
          web_reward: body.reward ?? null,
          web_granted_at: nowIso,
        },
        updated_at: nowIso,
      })
      .eq("id", session.id)
      .select("*")
      .single();
    if (updateError) return bad(updateError.message);

    const reward = await rewardAdSession(admin, verifiedSession, {
      verification_mode: "gpt_rewarded_slot_granted",
      reward: body.reward ?? null,
    });

    return ok({
      ok: true,
      duplicate: Boolean(reward.duplicate),
      reward,
      task: task ? publicTask(task, availability ?? undefined) : null,
    });
  } catch (e) {
    return bad(String((e as any)?.message || e || "Unable to grant web rewarded ad"));
  }
});
