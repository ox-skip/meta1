import * as Application from "expo-application";
import { Platform } from "react-native";

import { supabase } from "@/services/supabase";

export type OnboardingEventStatus = "completed" | "skipped";

type RecordOnboardingEventParams = {
  userId: string;
  flowKey: string;
  flowTitle: string;
  status: OnboardingEventStatus;
  completedSteps: number;
  totalSteps: number;
};

export async function recordOnboardingEvent({
  userId,
  flowKey,
  flowTitle,
  status,
  completedSteps,
  totalSteps,
}: RecordOnboardingEventParams) {
  const safeTotal = Math.max(1, Number(totalSteps || 0));
  const safeCompleted = Math.max(0, Math.min(Number(completedSteps || 0), safeTotal));

  const { error } = await supabase.from("app_onboarding_events").insert({
    user_id: userId,
    flow_key: flowKey,
    flow_title: flowTitle,
    status,
    completed_steps: safeCompleted,
    total_steps: safeTotal,
    metadata: {
      platform: Platform.OS,
      application_id: Application.applicationId ?? null,
      native_app_version: Application.nativeApplicationVersion ?? null,
    },
  });

  if (error) {
    console.warn("[onboarding] unable to record event:", error.message);
  }
}
