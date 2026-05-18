import { supabaseAdminClient, supabaseUserClient } from "./supabase.ts";
import { unauth } from "./http.ts";

export type RewardUser = {
  id: string;
  email?: string | null;
};

export type RewardTask = {
  id: string;
  task_key: string;
  title: string;
  description: string | null;
  category: "watch" | "market" | "social" | "onchain" | "custom";
  trigger_type: "client_claim" | "system_event" | "admin_review" | "ad_reward" | "manual_adjustment";
  reward_noms: number;
  cooldown_seconds: number;
  daily_cap: number | null;
  weekly_cap: number | null;
  lifetime_cap: number | null;
  requires_review: boolean;
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  sort_order: number;
  action_route: string | null;
  icon: string | null;
  accent: string | null;
  rules: Record<string, unknown>;
  ui: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type RewardAvailability = {
  available: boolean;
  status: "available" | "completed" | "cooldown" | "capped" | "locked" | "review_pending" | "inactive";
  reason: string | null;
  progress_current: number;
  progress_target: number;
  next_available_at: string | null;
  counts: {
    daily: number;
    weekly: number;
    lifetime: number;
  };
};

export function cleanText(value: unknown, limit = 1000) {
  return String(value ?? "").trim().slice(0, limit);
}

export function toInt(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export function startOfUtcDay(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function startOfUtcWeek(date = new Date()) {
  const day = startOfUtcDay(date);
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() - (weekday - 1));
  return day;
}

export async function requireRewardUser(req: Request): Promise<{ user: RewardUser; admin: any } | Response> {
  const userClient = supabaseUserClient(req);
  const { data, error } = await userClient.auth.getUser();
  const user = data?.user;
  if (error || !user) return unauth();

  return {
    user: { id: user.id, email: user.email },
    admin: supabaseAdminClient(),
  };
}

export function isTaskActive(task: RewardTask, now = new Date()) {
  if (!task.active) return false;
  const nowMs = now.getTime();
  const starts = task.starts_at ? Date.parse(task.starts_at) : Number.NaN;
  const ends = task.ends_at ? Date.parse(task.ends_at) : Number.NaN;
  if (Number.isFinite(starts) && starts > nowMs) return false;
  if (Number.isFinite(ends) && ends <= nowMs) return false;
  return true;
}

export async function ensureRewardAccount(admin: any, userId: string) {
  const { data, error } = await admin.rpc("market_reward_ensure_account", { p_user_id: userId });
  if (error) throw new Error(error.message);
  return data;
}

export async function loadActiveRewardTasks(admin: any) {
  const { data, error } = await admin
    .from("market_reward_tasks")
    .select("*")
    .eq("active", true)
    .or(`starts_at.is.null,starts_at.lte.${new Date().toISOString()}`)
    .or(`ends_at.is.null,ends_at.gt.${new Date().toISOString()}`)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as RewardTask[];
}

export async function loadRewardTaskByKeyOrId(admin: any, input: { task_id?: unknown; task_key?: unknown }) {
  const taskId = cleanText(input.task_id, 80);
  const taskKey = cleanText(input.task_key, 100);
  if (!taskId && !taskKey) throw new Error("task_id or task_key required");

  let query = admin.from("market_reward_tasks").select("*").limit(1);
  query = taskId ? query.eq("id", taskId) : query.eq("task_key", taskKey);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.id) throw new Error("Reward task not found");
  return data as RewardTask;
}

export async function loadTaskCompletions(admin: any, userId: string, taskIds: string[]) {
  if (!taskIds.length) return [];
  const { data, error } = await admin
    .from("market_reward_task_completions")
    .select("id,user_id,task_id,status,progress,evidence,ledger_id,idempotency_key,completed_at,rewarded_at,rejected_at,created_at,updated_at")
    .eq("user_id", userId)
    .in("task_id", taskIds)
    .order("created_at", { ascending: false })
    .limit(600);
  if (error) throw new Error(error.message);
  return data ?? [];
}

function countRewarded(completions: any[], since?: Date) {
  const sinceMs = since ? since.getTime() : null;
  return completions.filter((row) => {
    if (String(row.status ?? "") !== "rewarded" && !row.ledger_id) return false;
    if (!sinceMs) return true;
    const at = Date.parse(String(row.rewarded_at || row.completed_at || row.created_at || ""));
    return Number.isFinite(at) && at >= sinceMs;
  }).length;
}

function latestRewardedCompletion(completions: any[]) {
  return completions
    .filter((row) => String(row.status ?? "") === "rewarded" || row.ledger_id)
    .slice()
    .sort((a, b) => Date.parse(String(b.created_at ?? "")) - Date.parse(String(a.created_at ?? "")))[0] ?? null;
}

function timestampMs(...values: unknown[]) {
  for (const value of values) {
    const parsed = Date.parse(String(value ?? ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return Number.NaN;
}

function positiveNumber(value: unknown, fallback = 1) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function rowTimestampMs(row: Record<string, unknown>, keys: string[]) {
  return timestampMs(...keys.map((key) => row[key]));
}

function windowConfig(rules: Record<string, unknown>) {
  const raw = rules.window;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { mode: "all_time", seconds: 0 };
  }
  const config = raw as Record<string, unknown>;
  return {
    mode: cleanText(config.mode, 40) || "all_time",
    seconds: Math.max(0, toInt(config.seconds, 0)),
    startsAt: cleanText(config.starts_at, 60),
    endsAt: cleanText(config.ends_at, 60),
  };
}

function latestRewardedMs(completions?: any[]) {
  const latest = latestRewardedCompletion(completions ?? []);
  return timestampMs(latest?.rewarded_at, latest?.completed_at, latest?.created_at);
}

function rowsInRewardWindow(
  rows: Record<string, unknown>[],
  rules: Record<string, unknown>,
  task: RewardTask,
  completions: any[] | undefined,
  timeKeys: string[],
) {
  const window = windowConfig(rules);
  const lastRewarded = latestRewardedMs(completions);
  const taskStart = timestampMs(window.startsAt, task.starts_at);
  const taskEnd = timestampMs(window.endsAt, task.ends_at);

  return rows
    .map((row) => ({ row, at: rowTimestampMs(row, timeKeys) }))
    .filter((entry) => Number.isFinite(entry.at))
    .filter((entry) => !Number.isFinite(lastRewarded) || entry.at > lastRewarded)
    .filter((entry) => window.mode !== "campaign" || !Number.isFinite(taskStart) || entry.at >= taskStart)
    .filter((entry) => window.mode !== "campaign" || !Number.isFinite(taskEnd) || entry.at <= taskEnd)
    .sort((a, b) => a.at - b.at);
}

function bestWindowValue(
  entries: Array<{ row: Record<string, unknown>; at: number }>,
  seconds: number,
  valueForRow: (row: Record<string, unknown>) => number,
) {
  if (!entries.length) return 0;
  if (seconds <= 0) {
    return entries.reduce((sum, entry) => sum + valueForRow(entry.row), 0);
  }

  let best = 0;
  let running = 0;
  let start = 0;
  const spanMs = seconds * 1000;

  for (let end = 0; end < entries.length; end += 1) {
    running += valueForRow(entries[end].row);
    while (entries[end].at - entries[start].at > spanMs) {
      running -= valueForRow(entries[start].row);
      start += 1;
    }
    best = Math.max(best, running);
  }

  return best;
}

function progressFromRows(
  rows: Record<string, unknown>[],
  rules: Record<string, unknown>,
  task: RewardTask,
  completions: any[] | undefined,
  timeKeys: string[],
  valueForRow: (row: Record<string, unknown>) => number = () => 1,
) {
  const window = windowConfig(rules);
  const entries = rowsInRewardWindow(rows, rules, task, completions, timeKeys);
  if (window.mode === "after_first_progress") {
    return bestWindowValue(entries, window.seconds, valueForRow);
  }
  return entries.reduce((sum, entry) => sum + valueForRow(entry.row), 0);
}

async function loadRows(admin: any, table: string, select: string, build: (query: any) => any) {
  const query = build(admin.from(table).select(select)).limit(1000);
  const { data, error } = await query;
  if (error) return [];
  return (data ?? []) as Record<string, unknown>[];
}

async function countRows(admin: any, table: string, build: (query: any) => any) {
  const query = build(admin.from(table).select("id", { count: "exact", head: true }));
  const { count, error } = await query;
  if (error) return 0;
  return Number(count ?? 0);
}

async function getSellerProfileCompleteness(admin: any, userId: string) {
  const { data, error } = await admin
    .from("market_seller_profiles")
    .select("user_id,market_username,display_name,business_name,bio,phone,location_text,logo_path,banner_path,offers_remote,offers_in_person,social_links")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data?.user_id) return { exists: false, score: 0 };

  const checks = [
    data.market_username,
    data.display_name,
    data.business_name,
    data.bio,
    data.phone,
    data.location_text,
    data.logo_path,
    data.banner_path,
    data.offers_remote || data.offers_in_person ? "delivery" : "",
    data.social_links && Object.keys(data.social_links ?? {}).length ? "social" : "",
  ];

  return {
    exists: true,
    score: checks.filter((value) => String(value ?? "").trim().length > 0).length,
  };
}

export async function evaluateRewardRule(admin: any, userId: string, task: RewardTask, completions?: any[]) {
  const rules = task.rules ?? {};
  const check = cleanText(rules.check, 80);
  const min = Math.max(1, toInt(rules.min, 1));

  if (!check) {
    return { ok: true, current: 1, target: 1, reason: null };
  }

  if (check === "seller_profile_exists") {
    const profile = await getSellerProfileCompleteness(admin, userId);
    return {
      ok: profile.exists,
      current: profile.exists ? 1 : 0,
      target: 1,
      reason: profile.exists ? null : "Create your store profile to unlock this reward.",
    };
  }

  if (check === "seller_profile_complete") {
    const profile = await getSellerProfileCompleteness(admin, userId);
    const target = Math.max(1, toInt(rules.min_fields, 6));
    return {
      ok: profile.score >= target,
      current: profile.score,
      target,
      reason: profile.score >= target ? null : "Add more store details to unlock this reward.",
    };
  }

  if (check === "active_listing_count") {
    const rows = await loadRows(admin, "market_listings", "id,seller_id,is_active,created_at", (query) =>
      query.eq("seller_id", userId).eq("is_active", true).order("created_at", { ascending: true })
    );
    const current = progressFromRows(rows, rules, task, completions, ["created_at"]);
    return { ok: current >= min, current, target: min, reason: current >= min ? null : "Publish an active listing to unlock this reward." };
  }

  if (check === "buyer_released_order_count") {
    const current = await countRows(admin, "market_orders", (query) =>
      query.eq("buyer_id", userId).not("released_at", "is", null)
    );
    return { ok: current >= min, current, target: min, reason: current >= min ? null : "Complete a marketplace purchase to unlock this reward." };
  }

  if (check === "seller_released_order_count") {
    const current = await countRows(admin, "market_orders", (query) =>
      query.eq("seller_id", userId).not("released_at", "is", null)
    );
    return { ok: current >= min, current, target: min, reason: current >= min ? null : "Complete a marketplace sale to unlock this reward." };
  }

  if (check === "purchase_count") {
    const role = cleanText(rules.role, 20) || "buyer";
    const storeId = cleanText(rules.store_id, 80);
    const listingId = cleanText(rules.listing_id, 80);
    const rows = await loadRows(admin, "market_orders", "id,buyer_id,seller_id,listing_id,status,released_at,created_at,amount,currency", (query) => {
      let q = query.not("released_at", "is", null).order("released_at", { ascending: true });
      q = role === "seller" ? q.eq("seller_id", userId) : q.eq("buyer_id", userId);
      if (storeId) q = q.eq("seller_id", storeId);
      if (listingId) q = q.eq("listing_id", listingId);
      return q;
    });
    const current = progressFromRows(rows, rules, task, completions, ["released_at", "created_at"]);
    const targetLabel = listingId ? "that listing" : storeId ? "that store" : "the marketplace";
    return { ok: current >= min, current, target: min, reason: current >= min ? null : `Complete ${min} purchase${min === 1 ? "" : "s"} from ${targetLabel} to unlock this reward.` };
  }

  if (check === "purchase_volume") {
    const role = cleanText(rules.role, 20) || "buyer";
    const storeId = cleanText(rules.store_id, 80);
    const listingId = cleanText(rules.listing_id, 80);
    const target = positiveNumber(rules.min_amount ?? rules.min_volume ?? rules.min, 1);
    const rows = await loadRows(admin, "market_orders", "id,buyer_id,seller_id,listing_id,status,released_at,created_at,amount,currency", (query) => {
      let q = query.not("released_at", "is", null).order("released_at", { ascending: true });
      q = role === "seller" ? q.eq("seller_id", userId) : q.eq("buyer_id", userId);
      if (storeId) q = q.eq("seller_id", storeId);
      if (listingId) q = q.eq("listing_id", listingId);
      return q;
    });
    const current = progressFromRows(rows, rules, task, completions, ["released_at", "created_at"], (row) => Number(row.amount ?? 0) || 0);
    return { ok: current >= target, current, target, reason: current >= target ? null : `Complete ${target.toLocaleString()} in marketplace purchases to unlock this reward.` };
  }

  if (check === "referral_count") {
    const rawStatuses = Array.isArray(rules.statuses) ? rules.statuses : ["qualified", "rewarded"];
    const statuses = rawStatuses.map((status) => cleanText(status, 40)).filter(Boolean);
    const rows = await loadRows(admin, "market_referrals", "id,status,referrer_id,referred_user_id,created_at,qualified_at,rewarded_at", (query) =>
      query.eq("referrer_id", userId).in("status", statuses.length ? statuses : ["qualified", "rewarded"]).order("created_at", { ascending: true })
    );
    const current = progressFromRows(rows, rules, task, completions, ["qualified_at", "rewarded_at", "created_at"]);
    return { ok: current >= min, current, target: min, reason: current >= min ? null : `Invite ${min} friend${min === 1 ? "" : "s"} to unlock this reward.` };
  }

  if (check === "follow_count") {
    const storeId = cleanText(rules.store_id, 80);
    const rows = await loadRows(admin, "market_profile_follows", "id,follower_id,followed_id,created_at", (query) => {
      let q = query.eq("follower_id", userId).order("created_at", { ascending: true });
      if (storeId) q = q.eq("followed_id", storeId);
      return q;
    });
    const current = progressFromRows(rows, rules, task, completions, ["created_at"]);
    return { ok: current >= min, current, target: min, reason: current >= min ? null : "Follow a store to unlock this reward." };
  }

  if (check === "social_post_count") {
    const rows = await loadRows(admin, "market_social_posts", "id,author_id,created_at", (query) =>
      query.eq("author_id", userId).order("created_at", { ascending: true })
    );
    const current = progressFromRows(rows, rules, task, completions, ["created_at"]);
    return { ok: current >= min, current, target: min, reason: current >= min ? null : "Share a market post to unlock this reward." };
  }

  if (check === "stock_identity_exists") {
    const current = await countRows(admin, "market_stock_identities", (query) =>
      query.eq("store_id", userId).eq("active", true)
    );
    return { ok: current >= 1, current, target: 1, reason: current >= 1 ? null : "Create your store stock identity to unlock this reward." };
  }

  if (check === "stock_trade_count") {
    const side = cleanText(rules.side, 12);
    const stockId = cleanText(rules.stock_id, 80);
    const rows = await loadRows(admin, "market_stock_trades", "id,stock_id,user_id,side,notional_usdc,traded_at,created_at", (query) => {
      let q = query.eq("user_id", userId).order("traded_at", { ascending: true });
      if (stockId) q = q.eq("stock_id", stockId);
      return side ? q.eq("side", side) : q;
    });
    const current = progressFromRows(rows, rules, task, completions, ["traded_at", "created_at"]);
    return { ok: current >= min, current, target: min, reason: current >= min ? null : "Complete this stock action to unlock the reward." };
  }

  if (check === "stock_trade_volume") {
    const side = cleanText(rules.side, 12);
    const stockId = cleanText(rules.stock_id, 80);
    const target = positiveNumber(rules.min_volume_usd ?? rules.min_volume ?? rules.min, 1);
    const rows = await loadRows(admin, "market_stock_trades", "id,stock_id,user_id,side,notional_usdc,traded_at,created_at", (query) => {
      let q = query.eq("user_id", userId).order("traded_at", { ascending: true });
      if (stockId) q = q.eq("stock_id", stockId);
      return side ? q.eq("side", side) : q;
    });
    const current = progressFromRows(rows, rules, task, completions, ["traded_at", "created_at"], (row) => Number(row.notional_usdc ?? 0) || 0);
    return { ok: current >= target, current, target, reason: current >= target ? null : `Reach ${target.toLocaleString()} USDC in stock trades to unlock this reward.` };
  }

  if (check === "admin_review") {
    return { ok: false, current: 0, target: 1, reason: "Submit proof so this reward can be reviewed." };
  }

  return { ok: false, current: 0, target: 1, reason: "This reward is not ready yet." };
}

export async function getTaskAvailability(
  admin: any,
  userId: string,
  task: RewardTask,
  allCompletions?: any[],
): Promise<RewardAvailability> {
  if (!isTaskActive(task)) {
    return {
      available: false,
      status: "inactive",
      reason: "This reward task is not active.",
      progress_current: 0,
      progress_target: 1,
      next_available_at: null,
      counts: { daily: 0, weekly: 0, lifetime: 0 },
    };
  }

  const completions = (allCompletions ?? await loadTaskCompletions(admin, userId, [task.id]))
    .filter((row: any) => String(row.task_id) === task.id);
  const daily = countRewarded(completions, startOfUtcDay());
  const weekly = countRewarded(completions, startOfUtcWeek());
  const lifetime = countRewarded(completions);
  const latest = latestRewardedCompletion(completions);

  const pendingReview = completions.some((row: any) => String(row.status ?? "") === "pending");
  if (pendingReview && task.requires_review) {
    return {
      available: false,
      status: "review_pending",
      reason: "Your submission is waiting for review.",
      progress_current: 1,
      progress_target: 1,
      next_available_at: null,
      counts: { daily, weekly, lifetime },
    };
  }

  if (task.lifetime_cap && lifetime >= task.lifetime_cap) {
    return {
      available: false,
      status: "completed",
      reason: "This reward has already been added to your balance.",
      progress_current: lifetime,
      progress_target: task.lifetime_cap,
      next_available_at: null,
      counts: { daily, weekly, lifetime },
    };
  }

  if (task.daily_cap && daily >= task.daily_cap) {
    const next = startOfUtcDay();
    next.setUTCDate(next.getUTCDate() + 1);
    return {
      available: false,
      status: "capped",
      reason: "Daily reward limit reached.",
      progress_current: daily,
      progress_target: task.daily_cap,
      next_available_at: next.toISOString(),
      counts: { daily, weekly, lifetime },
    };
  }

  if (task.weekly_cap && weekly >= task.weekly_cap) {
    const next = startOfUtcWeek();
    next.setUTCDate(next.getUTCDate() + 7);
    return {
      available: false,
      status: "capped",
      reason: "Weekly reward limit reached.",
      progress_current: weekly,
      progress_target: task.weekly_cap,
      next_available_at: next.toISOString(),
      counts: { daily, weekly, lifetime },
    };
  }

  if (task.cooldown_seconds > 0 && latest?.created_at) {
    const latestMs = Date.parse(String(latest.rewarded_at || latest.completed_at || latest.created_at));
    const nextMs = latestMs + task.cooldown_seconds * 1000;
    if (Number.isFinite(nextMs) && nextMs > Date.now()) {
      return {
      available: false,
      status: "cooldown",
        reason: "This reward is cooling down.",
        progress_current: 0,
        progress_target: 1,
        next_available_at: new Date(nextMs).toISOString(),
        counts: { daily, weekly, lifetime },
      };
    }
  }

  const rule = await evaluateRewardRule(admin, userId, task, completions);
  if (!rule.ok && task.trigger_type !== "ad_reward" && task.trigger_type !== "admin_review") {
    return {
      available: false,
      status: "locked",
      reason: rule.reason,
      progress_current: rule.current,
      progress_target: rule.target,
      next_available_at: null,
      counts: { daily, weekly, lifetime },
    };
  }

  return {
    available: true,
    status: "available",
    reason: null,
    progress_current: Math.min(rule.current, rule.target),
    progress_target: rule.target,
    next_available_at: null,
    counts: { daily, weekly, lifetime },
  };
}

export async function creditReward(admin: any, input: {
  userId: string;
  amount: number;
  source: string;
  reason?: string | null;
  taskId?: string | null;
  completionId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  idempotencyKey?: string | null;
  metadata?: Record<string, unknown>;
  createdBy?: string | null;
}) {
  const { data, error } = await admin.rpc("market_reward_credit", {
    p_user_id: input.userId,
    p_amount: Math.max(1, Math.trunc(input.amount)),
    p_source: input.source,
    p_reason: input.reason ?? null,
    p_task_id: input.taskId ?? null,
    p_completion_id: input.completionId ?? null,
    p_entity_type: input.entityType ?? null,
    p_entity_id: input.entityId ?? null,
    p_idempotency_key: input.idempotencyKey ?? null,
    p_metadata: input.metadata ?? {},
    p_created_by: input.createdBy ?? null,
  });
  if (error) throw new Error(error.message);
  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.ledger_id) throw new Error("Reward credit did not return a ledger id.");
  return result;
}

export async function rewardAdSession(admin: any, session: any, metadata: Record<string, unknown> = {}) {
  if (!session?.id) throw new Error("Ad session missing");
  if (session.ledger_id) {
    return { duplicate: true, credit: null, completion: null, session };
  }

  const rewardNoms = Math.max(0, toInt(session.reward_noms, 0));
  if (rewardNoms <= 0) throw new Error("Ad session has no reward amount");

  const nowIso = new Date().toISOString();
  const idempotencyKey = `ad:${session.id}`;

  let completion: any = null;
  if (session.task_id) {
    const { data, error } = await admin
      .from("market_reward_task_completions")
      .insert({
        user_id: session.user_id,
        task_id: session.task_id,
        status: "approved",
        progress: { current: 1, target: 1 },
        evidence: { ad_session_id: session.id, provider: session.provider, platform: session.platform },
        idempotency_key: idempotencyKey,
        completed_at: nowIso,
      })
      .select("id,user_id,task_id,status,ledger_id,idempotency_key,created_at")
      .single();

    if (error && String(error.code) !== "23505") throw new Error(error.message);
    if (data?.id) {
      completion = data;
    } else {
      const existing = await admin
        .from("market_reward_task_completions")
        .select("id,user_id,task_id,status,ledger_id,idempotency_key,created_at")
        .eq("user_id", session.user_id)
        .eq("task_id", session.task_id)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (existing.error) throw new Error(existing.error.message);
      completion = existing.data ?? null;
    }
  }

  const credit = await creditReward(admin, {
    userId: session.user_id,
    amount: rewardNoms,
    source: "rewarded_ad",
    reason: "Rewarded video",
    taskId: session.task_id,
    completionId: completion?.id ?? null,
    entityType: "market_reward_ad_sessions",
    entityId: session.id,
    idempotencyKey,
    metadata: {
      ad_session_id: session.id,
      provider: session.provider,
      platform: session.platform,
      ...metadata,
    },
  });

  if (completion?.id) {
    await admin
      .from("market_reward_task_completions")
      .update({
        status: "rewarded",
        ledger_id: credit.ledger_id,
        rewarded_at: nowIso,
        completed_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", completion.id);
  }

  const { data: updatedSession, error: updateError } = await admin
    .from("market_reward_ad_sessions")
    .update({
      status: "rewarded",
      ledger_id: credit.ledger_id,
      rewarded_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", session.id)
    .select("*")
    .single();
  if (updateError) throw new Error(updateError.message);

  return { duplicate: Boolean(credit.duplicate), credit, completion, session: updatedSession };
}

export function publicTask(task: RewardTask, availability?: RewardAvailability) {
  return {
    id: task.id,
    task_key: task.task_key,
    title: task.title,
    description: task.description,
    category: task.category,
    trigger_type: task.trigger_type,
    reward_noms: task.reward_noms,
    cooldown_seconds: task.cooldown_seconds,
    daily_cap: task.daily_cap,
    weekly_cap: task.weekly_cap,
    lifetime_cap: task.lifetime_cap,
    requires_review: task.requires_review,
    sort_order: task.sort_order,
    action_route: task.action_route,
    icon: task.icon,
    accent: task.accent,
    rules: task.rules,
    ui: task.ui,
    availability: availability ?? null,
  };
}
