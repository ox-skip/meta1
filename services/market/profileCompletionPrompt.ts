import { supabase } from "@/services/supabase";

const DAY_MS = 24 * 60 * 60 * 1000;

const REMINDER_DELAY_MS = {
  "3_days": 3 * DAY_MS,
  "1_week": 7 * DAY_MS,
  "1_month": 30 * DAY_MS,
} as const;

export type MarketProfileCompletionStage = "create_profile" | "verify_profile";
export type MarketProfileCompletionReminderOption = keyof typeof REMINDER_DELAY_MS;

export type MarketProfileCompletionReminder = {
  stage: MarketProfileCompletionStage;
  remindAt: string;
};

type SellerProfileStatus = {
  is_verified?: boolean | null;
} | null;

type MarketProfileCompletionReminderRow = {
  stage: MarketProfileCompletionStage;
  remind_at: string;
};

export function getMarketProfileCompletionStage(
  profile: SellerProfileStatus,
): MarketProfileCompletionStage | null {
  if (!profile) return "create_profile";
  if (!profile.is_verified) return "verify_profile";
  return null;
}

export function getMarketProfileCompletionReminderLabel(
  option: MarketProfileCompletionReminderOption,
) {
  const labels: Record<MarketProfileCompletionReminderOption, string> = {
    "3_days": "3 days",
    "1_week": "1 week",
    "1_month": "1 month",
  };
  return labels[option];
}

export async function loadMarketProfileCompletionReminder(
  userId: string,
): Promise<MarketProfileCompletionReminder | null> {
  const { data, error } = await supabase
    .from("market_profile_prompt_reminders")
    .select("stage,remind_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.warn("[market-profile-prompt] reminder load failed", error.message);
    return null;
  }

  const row = (data as MarketProfileCompletionReminderRow | null) ?? null;
  if (!row?.stage || !row?.remind_at) return null;

  return {
    stage: row.stage,
    remindAt: row.remind_at,
  };
}

export async function clearMarketProfileCompletionReminder(userId: string) {
  const { error } = await supabase
    .from("market_profile_prompt_reminders")
    .delete()
    .eq("user_id", userId);

  if (error) {
    console.warn("[market-profile-prompt] reminder clear failed", error.message);
  }
}

export async function scheduleMarketProfileCompletionReminder(params: {
  userId: string;
  stage: MarketProfileCompletionStage;
  option: MarketProfileCompletionReminderOption;
}) {
  const remindAt = new Date(Date.now() + REMINDER_DELAY_MS[params.option]).toISOString();

  const { data, error } = await supabase
    .from("market_profile_prompt_reminders")
    .upsert(
      {
        user_id: params.userId,
        stage: params.stage,
        remind_at: remindAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    )
    .select("stage,remind_at")
    .single();

  if (error) {
    throw new Error(error.message || "Could not save reminder.");
  }

  const row = data as MarketProfileCompletionReminderRow;
  return {
    stage: row.stage,
    remindAt: row.remind_at,
  };
}

export function shouldShowMarketProfileCompletionPrompt(params: {
  stage: MarketProfileCompletionStage | null;
  reminder: MarketProfileCompletionReminder | null;
  nowMs?: number;
}) {
  const { stage, reminder, nowMs = Date.now() } = params;
  if (!stage) return false;
  if (!reminder) return true;
  if (reminder.stage !== stage) return true;
  return new Date(reminder.remindAt).getTime() <= nowMs;
}
