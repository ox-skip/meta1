import { bad, methodNotAllowed, ok } from "../_shared/market/http.ts";
import {
  cleanText,
  ensureRewardAccount,
  getTaskAvailability,
  loadRewardTaskByKeyOrId,
  publicTask,
  requireRewardUser,
} from "../_shared/market/rewards.ts";

function adUnitForPlatform(platform: string) {
  const p = platform.toLowerCase();
  if (p === "ios") return Deno.env.get("ADMOB_REWARDED_UNIT_ID_IOS") ?? Deno.env.get("ADMOB_REWARDED_UNIT_ID") ?? null;
  if (p === "android") return Deno.env.get("ADMOB_REWARDED_UNIT_ID_ANDROID") ?? Deno.env.get("ADMOB_REWARDED_UNIT_ID") ?? null;
  if (p === "web") {
    return Deno.env.get("GAM_REWARDED_AD_UNIT_PATH_WEB")
      ?? Deno.env.get("GOOGLE_AD_MANAGER_REWARDED_UNIT_PATH_WEB")
      ?? Deno.env.get("ADMOB_REWARDED_UNIT_ID_WEB")
      ?? null;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  try {
    const ctx = await requireRewardUser(req);
    if (ctx instanceof Response) return ctx;
    const { user, admin } = ctx;
    const body = await req.json().catch(() => ({}));

    await ensureRewardAccount(admin, user.id);

    const task = await loadRewardTaskByKeyOrId(admin, {
      task_key: cleanText(body.task_key, 100) || "watch_rewarded_video",
    });
    if (task.trigger_type !== "ad_reward") return bad("Task is not a rewarded ad task.");

    const availability = await getTaskAvailability(admin, user.id, task);
    if (!availability.available) {
      return bad(availability.reason || "Rewarded ad task is not available", {
        task: publicTask(task, availability),
      });
    }

    const platform = (cleanText(body.platform, 40) || "unknown").toLowerCase();
    const sessionId = crypto.randomUUID();
    const nonce = crypto.randomUUID().replace(/-/g, "");
    const customData = `${sessionId}:${nonce}`;
    const adUnitId = adUnitForPlatform(platform);

    const { data, error } = await admin
      .from("market_reward_ad_sessions")
      .insert({
        id: sessionId,
        user_id: user.id,
        task_id: task.id,
        provider: platform === "web" ? "google_ad_manager" : "admob",
        platform,
        ad_unit_id: adUnitId,
        custom_data: customData,
        reward_noms: task.reward_noms,
        status: "created",
        verification_payload: {
          task_key: task.task_key,
          started_from: cleanText(body.surface, 80) || "rewards",
        },
      })
      .select("id,user_id,task_id,provider,platform,ad_unit_id,custom_data,reward_noms,status,expires_at,created_at")
      .single();
    if (error) return bad(error.message);

    return ok({
      ok: true,
      session: data,
      ssv: {
        user_id: user.id,
        custom_data: customData,
      },
      task: publicTask(task, availability),
    });
  } catch (e) {
    return bad(String((e as any)?.message || e || "Unable to start rewarded ad"));
  }
});
