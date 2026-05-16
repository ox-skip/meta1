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
    const event = cleanText(body.event, 40);
    if (!sessionId) return bad("session_id required");
    if (!["loaded", "shown", "client_earned", "error"].includes(event)) return bad("Unsupported ad event");

    const { data: session, error } = await admin
      .from("market_reward_ad_sessions")
      .select("*")
      .eq("id", sessionId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) return bad(error.message);
    if (!session?.id) return bad("Ad session not found");
    if (Date.parse(String(session.expires_at)) <= Date.now()) return bad("Ad session expired");

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      verification_payload: {
        ...(session.verification_payload ?? {}),
        last_client_event: event,
        client_reward: body.reward ?? null,
        client_error: event === "error" ? cleanText(body.error, 240) : null,
      },
    };

    if (event === "loaded" && session.status === "created") patch.status = "loaded";
    if (event === "shown" && !["client_earned", "verified", "rewarded"].includes(String(session.status))) {
      patch.status = "shown";
      patch.shown_at = new Date().toISOString();
    }
    if (event === "client_earned" && !["verified", "rewarded"].includes(String(session.status))) {
      patch.status = "client_earned";
      patch.client_earned_at = new Date().toISOString();
    }
    if (event === "error") {
      patch.status = "rejected";
      patch.failure_reason = cleanText(body.error, 240) || "Client ad error";
    }

    const { data: updated, error: updateError } = await admin
      .from("market_reward_ad_sessions")
      .update(patch)
      .eq("id", session.id)
      .select("*")
      .single();
    if (updateError) return bad(updateError.message);

    const allowClientFallback = Deno.env.get("REWARD_AD_CLIENT_FALLBACK") === "true";
    if (event === "client_earned" && allowClientFallback) {
      const task = session.task_id
        ? await loadRewardTaskByKeyOrId(admin, { task_id: session.task_id })
        : null;
      if (task) {
        const availability = await getTaskAvailability(admin, user.id, task);
        if (!availability.available) return bad(availability.reason || "Ad reward is not available");
      }
      const reward = await rewardAdSession(admin, updated, { verification_mode: "client_fallback" });
      return ok({ ok: true, pending_verification: false, reward });
    }

    return ok({
      ok: true,
      pending_verification: event === "client_earned",
      session: updated,
      message: event === "client_earned"
        ? "Ad completed. Noms will be credited after server verification."
        : null,
    });
  } catch (e) {
    return bad(String((e as any)?.message || e || "Unable to record ad event"));
  }
});
