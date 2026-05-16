import { bad, methodNotAllowed, ok } from "../_shared/market/http.ts";
import {
  ensureRewardAccount,
  getTaskAvailability,
  loadActiveRewardTasks,
  loadTaskCompletions,
  publicTask,
  requireRewardUser,
} from "../_shared/market/rewards.ts";

function activeWindowFilter(row: any) {
  const now = Date.now();
  const starts = row?.starts_at ? Date.parse(String(row.starts_at)) : Number.NaN;
  const ends = row?.ends_at ? Date.parse(String(row.ends_at)) : Number.NaN;
  if (Number.isFinite(starts) && starts > now) return false;
  if (Number.isFinite(ends) && ends <= now) return false;
  return row?.active !== false;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  try {
    const ctx = await requireRewardUser(req);
    if (ctx instanceof Response) return ctx;
    const { user, admin } = ctx;

    await ensureRewardAccount(admin, user.id);

    const [
      accountRes,
      tasks,
      ledgerRes,
      promotionsRes,
      configRes,
      pendingRes,
      redemptionsRes,
    ] = await Promise.all([
      admin
        .from("market_reward_accounts")
        .select("user_id,balance,lifetime_earned,lifetime_spent,tier_key,daily_streak,longest_streak,last_earned_at,last_spent_at,metadata,created_at,updated_at")
        .eq("user_id", user.id)
        .single(),
      loadActiveRewardTasks(admin),
      admin
        .from("market_reward_ledger")
        .select("id,user_id,task_id,delta,balance_after,source,reason,entity_type,entity_id,status,metadata,created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50),
      admin
        .from("market_reward_promotions")
        .select("id,placement_key,store_id,listing_id,title,subtitle,media_url,sponsor_label,cta_label,cta_route,priority,active,starts_at,ends_at,metadata,created_at,updated_at")
        .eq("active", true)
        .order("priority", { ascending: true })
        .order("created_at", { ascending: false })
        .limit(30),
      admin
        .from("market_reward_config")
        .select("key,value")
        .eq("public_read", true),
      admin
        .from("market_reward_task_completions")
        .select("id,task_id,status,evidence,review_note,created_at,updated_at")
        .eq("user_id", user.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(30),
      admin
        .from("market_reward_redemptions")
        .select("id,redemption_key,title,cost_noms,status,metadata,fulfilled_at,created_at,updated_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    if (accountRes.error) return bad(accountRes.error.message);
    if (ledgerRes.error) return bad(ledgerRes.error.message);
    if (promotionsRes.error) return bad(promotionsRes.error.message);
    if (configRes.error) return bad(configRes.error.message);
    if (pendingRes.error) return bad(pendingRes.error.message);
    if (redemptionsRes.error) return bad(redemptionsRes.error.message);

    const taskIds = tasks.map((task) => task.id);
    const completions = await loadTaskCompletions(admin, user.id, taskIds);
    const enrichedTasks = await Promise.all(
      tasks.map(async (task) => publicTask(task, await getTaskAvailability(admin, user.id, task, completions))),
    );

    const config: Record<string, unknown> = {};
    for (const row of configRes.data ?? []) {
      config[String(row.key)] = row.value ?? {};
    }

    return ok({
      ok: true,
      generated_at: new Date().toISOString(),
      account: accountRes.data,
      tasks: enrichedTasks,
      ledger: ledgerRes.data ?? [],
      promotions: (promotionsRes.data ?? []).filter(activeWindowFilter),
      pending_reviews: pendingRes.data ?? [],
      redemptions: redemptionsRes.data ?? [],
      config,
    });
  } catch (e) {
    return bad(String((e as any)?.message || e || "Unable to load rewards"));
  }
});
