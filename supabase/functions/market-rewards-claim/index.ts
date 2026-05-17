import { bad, methodNotAllowed, ok } from "../_shared/market/http.ts";
import {
  cleanText,
  creditReward,
  ensureRewardAccount,
  getTaskAvailability,
  loadRewardTaskByKeyOrId,
  publicTask,
  requireRewardUser,
} from "../_shared/market/rewards.ts";

function makeCompletionKey(userId: string, task: any, supplied?: unknown) {
  const raw = cleanText(supplied, 180);
  if (raw) return raw;
  if (Number(task.lifetime_cap ?? 0) === 1) return `${task.task_key}:${userId}:lifetime`;
  return `${task.task_key}:${userId}:${crypto.randomUUID()}`;
}

async function insertOrLoadCompletion(admin: any, row: Record<string, unknown>) {
  const { data, error } = await admin
    .from("market_reward_task_completions")
    .insert(row)
    .select("id,user_id,task_id,status,progress,evidence,ledger_id,idempotency_key,review_note,completed_at,rewarded_at,rejected_at,created_at,updated_at")
    .single();

  if (!error) return { completion: data, duplicate: false };

  if (String(error.code) !== "23505") throw new Error(error.message);

  const { data: existing, error: existingError } = await admin
    .from("market_reward_task_completions")
    .select("id,user_id,task_id,status,progress,evidence,ledger_id,idempotency_key,review_note,completed_at,rewarded_at,rejected_at,created_at,updated_at")
    .eq("user_id", row.user_id)
    .eq("task_id", row.task_id)
    .eq("idempotency_key", row.idempotency_key)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (!existing?.id) throw new Error("Reward completion conflict could not be loaded");
  return { completion: existing, duplicate: true };
}

async function loadRewardAccount(admin: any, userId: string) {
  const { data, error } = await admin
    .from("market_reward_accounts")
    .select("user_id,balance,lifetime_earned,lifetime_spent,tier_key,daily_streak,longest_streak,last_earned_at,last_spent_at,metadata,created_at,updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  try {
    const ctx = await requireRewardUser(req);
    if (ctx instanceof Response) return ctx;
    const { user, admin } = ctx;
    const body = await req.json().catch(() => ({}));

    await ensureRewardAccount(admin, user.id);

    const task = await loadRewardTaskByKeyOrId(admin, body);
    if (task.trigger_type === "ad_reward") return bad("Use the rewarded ad flow for this task.");
    if (task.trigger_type === "system_event") return bad("This task is completed automatically.");
    if (task.trigger_type === "manual_adjustment") return bad("This task is admin-managed.");

    const availability = await getTaskAvailability(admin, user.id, task);
    if (!availability.available && task.trigger_type !== "admin_review") {
      return bad(availability.reason || "Task is not available", { task: publicTask(task, availability) });
    }

    const nowIso = new Date().toISOString();
    const idempotencyKey = makeCompletionKey(user.id, task, body.idempotency_key);
    const evidence = typeof body.evidence === "object" && body.evidence !== null ? body.evidence : {};

    const { completion, duplicate } = await insertOrLoadCompletion(admin, {
      user_id: user.id,
      task_id: task.id,
      status: task.requires_review || task.trigger_type === "admin_review" ? "pending" : "approved",
      progress: {
        current: availability.progress_current,
        target: availability.progress_target,
      },
      evidence,
      idempotency_key: idempotencyKey,
      completed_at: task.requires_review || task.trigger_type === "admin_review" ? null : nowIso,
    });

    if (task.requires_review || task.trigger_type === "admin_review") {
      return ok({
        ok: true,
        status: "pending_review",
        duplicate,
        message: "Your proof is waiting for review.",
        account: await loadRewardAccount(admin, user.id),
        task: publicTask(task, await getTaskAvailability(admin, user.id, task)),
        completion,
      });
    }

    if (completion.ledger_id) {
      return ok({
        ok: true,
        status: "already_rewarded",
        duplicate: true,
        message: "This reward was already added to your balance.",
        account: await loadRewardAccount(admin, user.id),
        task: publicTask(task, await getTaskAvailability(admin, user.id, task)),
        completion,
      });
    }

    if (Number(task.reward_noms) <= 0) return bad("This task has no reward amount configured.");

    const credit = await creditReward(admin, {
      userId: user.id,
      amount: Number(task.reward_noms),
      source: "task",
      reason: task.title,
      taskId: task.id,
      completionId: completion.id,
      entityType: "market_reward_tasks",
      entityId: task.id,
      idempotencyKey: `task:${idempotencyKey}`,
      metadata: { task_key: task.task_key },
    });

    const { data: updated, error: updateError } = await admin
      .from("market_reward_task_completions")
      .update({
        status: "rewarded",
        ledger_id: credit.ledger_id,
        rewarded_at: nowIso,
        completed_at: completion.completed_at ?? nowIso,
        updated_at: nowIso,
      })
      .eq("id", completion.id)
      .select("id,user_id,task_id,status,progress,evidence,ledger_id,idempotency_key,review_note,completed_at,rewarded_at,rejected_at,created_at,updated_at")
      .single();
    if (updateError) {
      return ok({
        ok: true,
        status: "rewarded",
        duplicate: Boolean(credit.duplicate || duplicate),
        warning: `Noms were credited, but the completion row did not update: ${updateError.message}`,
        message: `Reward credited. Balance is now ${Number(credit.balance ?? 0).toLocaleString()} noms.`,
        credit,
        account: await loadRewardAccount(admin, user.id),
        task: publicTask(task, await getTaskAvailability(admin, user.id, task)),
        completion,
      });
    }

    return ok({
      ok: true,
      status: "rewarded",
      duplicate: Boolean(credit.duplicate || duplicate),
      message: `Reward credited. Balance is now ${Number(credit.balance ?? 0).toLocaleString()} noms.`,
      credit,
      account: await loadRewardAccount(admin, user.id),
      task: publicTask(task, await getTaskAvailability(admin, user.id, task)),
      completion: updated,
    });
  } catch (e) {
    return bad(String((e as any)?.message || e || "Unable to claim reward"));
  }
});
