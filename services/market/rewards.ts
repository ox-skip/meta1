import { Platform } from "react-native";

import { showRewardedAd, type RewardedAdResult } from "@/components/ads/RewardedAd";
import { callFn } from "@/services/functions";
import { supabase } from "@/services/supabase";

export type RewardCategory = "watch" | "market" | "social" | "onchain" | "custom";

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

export type RewardTask = {
  id: string;
  task_key: string;
  title: string;
  description: string | null;
  category: RewardCategory;
  trigger_type: "client_claim" | "system_event" | "admin_review" | "ad_reward" | "manual_adjustment";
  reward_noms: number;
  cooldown_seconds: number;
  daily_cap: number | null;
  weekly_cap: number | null;
  lifetime_cap: number | null;
  requires_review: boolean;
  sort_order: number;
  action_route: string | null;
  icon: string | null;
  accent: string | null;
  rules: Record<string, any>;
  ui: Record<string, any>;
  availability: RewardAvailability | null;
};

export type RewardAccount = {
  user_id: string;
  balance: number;
  lifetime_earned: number;
  lifetime_spent: number;
  tier_key: string;
  daily_streak: number;
  longest_streak: number;
  last_earned_at: string | null;
  last_spent_at: string | null;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
};

export type RewardLedgerEntry = {
  id: string;
  user_id: string;
  task_id: string | null;
  delta: number;
  balance_after: number;
  source: string;
  reason: string | null;
  entity_type: string | null;
  entity_id: string | null;
  status: string;
  metadata: Record<string, any>;
  created_at: string;
};

export type RewardPromotion = {
  id: string;
  placement_key: string;
  store_id: string | null;
  listing_id: string | null;
  title: string;
  subtitle: string | null;
  media_url: string | null;
  sponsor_label: string;
  cta_label: string | null;
  cta_route: string | null;
  priority: number;
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
};

export type RewardsHome = {
  ok: true;
  generated_at: string;
  account: RewardAccount;
  tasks: RewardTask[];
  ledger: RewardLedgerEntry[];
  promotions: RewardPromotion[];
  pending_reviews: any[];
  redemptions: any[];
  config: Record<string, any>;
};

export type RewardClaimResult = {
  ok: true;
  status: "pending_review" | "rewarded" | "already_rewarded";
  duplicate?: boolean;
  message?: string;
  warning?: string;
  credit?: any;
  account?: RewardAccount | null;
  task: RewardTask;
  completion: any;
};

export type RewardAdStartResult = {
  ok: true;
  session: {
    id: string;
    user_id: string;
    task_id: string;
    provider: string;
    platform: string;
    ad_unit_id: string | null;
    custom_data: string;
    reward_noms: number;
    status: string;
    expires_at: string;
    created_at: string;
  };
  ssv: {
    user_id: string;
    custom_data: string;
  };
  task: RewardTask;
};

export async function fetchRewardsHome() {
  return await callFn<RewardsHome>("market-rewards-home", {}, 25000);
}

export async function claimRewardTask(input: {
  task_id?: string;
  task_key?: string;
  evidence?: Record<string, any>;
  idempotency_key?: string;
}) {
  return await callFn<RewardClaimResult>("market-rewards-claim", input, 25000);
}

export async function startRewardedAdTask(taskKey = "watch_rewarded_video") {
  return await callFn<RewardAdStartResult>(
    "market-rewards-ad-start",
    {
      task_key: taskKey,
      platform: Platform.OS,
      surface: "rewards",
    },
    20000,
  );
}

export async function reportRewardedAdEvent(input: {
  session_id: string;
  event: "loaded" | "shown" | "client_earned" | "error";
  reward?: any;
  error?: string;
}) {
  return await callFn<any>("market-rewards-ad-client-event", input, 20000);
}

export async function grantRewardedWebAd(input: {
  session_id: string;
  reward?: any;
}) {
  return await callFn<any>("market-rewards-ad-web-grant", input, 20000);
}

export async function watchRewardedAdForNoms(taskKey = "watch_rewarded_video") {
  const start = await startRewardedAdTask(taskKey);
  const sessionId = start.session.id;

  let lastClientEvent: Promise<any> | null = null;
  let earnedEventReported = false;
  const safeReport = (event: "loaded" | "shown" | "client_earned" | "error", payload?: any) => {
    if (event === "client_earned") earnedEventReported = true;
    lastClientEvent = reportRewardedAdEvent({
      session_id: sessionId,
      event,
      reward: event === "client_earned" ? payload : undefined,
      error: event === "error" ? String(payload ?? "Ad error") : undefined,
    }).catch((error) => ({ error: String(error?.message || error) }));
  };

  const result: RewardedAdResult = await showRewardedAd({
    adUnitId: start.session.ad_unit_id,
    userId: start.ssv.user_id,
    customData: start.ssv.custom_data,
    onEvent: (event, payload) => {
      if (event === "loaded") safeReport("loaded");
      if (event === "shown") safeReport("shown");
      if (event === "earned") safeReport("client_earned", payload);
      if (event === "error") safeReport("error", payload);
    },
  });

  if (result.earned) {
    if (!earnedEventReported) safeReport("client_earned", result.reward ?? {});
  } else if (result.error) {
    safeReport("error", result.error);
  }

  const report = lastClientEvent ? await lastClientEvent : null;
  const webGrant = Platform.OS === "web" && result.earned
    ? await grantRewardedWebAd({
        session_id: sessionId,
        reward: result.reward ?? {},
      }).catch((error) => ({ error: String(error?.message || error) }))
    : null;

  return { start, result, report, webGrant };
}

export async function recordRewardPromotionEvent(input: {
  promotion_id: string;
  placement_key: string;
  event_type: "impression" | "click";
  metadata?: Record<string, any>;
}) {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id ?? null;
  const { error } = await supabase.from("market_reward_promotion_events").insert({
    promotion_id: input.promotion_id,
    user_id: userId,
    event_type: input.event_type,
    placement_key: input.placement_key,
    metadata: input.metadata ?? {},
  });
  if (error) {
    console.warn("[rewards] promotion event skipped", error.message);
  }
}
