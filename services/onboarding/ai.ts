import { callFn } from "@/services/functions";
import type { TutorialTargetPosition } from "@/services/onboarding/definitions";

export type OnboardingAiMode = "summary" | "full";

export type OnboardingAiInput = {
  flowKey: string;
  flowTitle: string;
  flowSummary?: string;
  stepIndex: number;
  totalSteps: number;
  stepTitle: string;
  stepBody: string;
  targetLabel?: string;
  targetPosition?: TutorialTargetPosition;
  aiHint?: string;
  mode: OnboardingAiMode;
};

export type OnboardingAiResult = {
  text: string;
  source: "bestcity_ai" | "local";
};

type OnboardingAiResponse = {
  ok?: boolean;
  text?: string;
};

function cleanText(value: unknown, limit = 900) {
  const text = String(value ?? "").trim().replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  return text.length > limit ? `${text.slice(0, limit).trim()}...` : text;
}

function localGuide(input: OnboardingAiInput) {
  const target = input.targetLabel ? `Focus on ${input.targetLabel}. ` : "";
  if (input.mode === "summary") {
    return cleanText(
      `${target}${input.stepBody} This is step ${input.stepIndex + 1} of ${input.totalSteps}, so use it as a quick orientation point before moving on.`,
      520,
    );
  }

  const context = input.flowSummary ? `\n\nWhy it matters: ${input.flowSummary}` : "";
  const hint = input.aiHint ? `\n\nExtra tip: ${input.aiHint}` : "";
  return cleanText(
    `${target}${input.stepBody}${context}${hint}\n\nTry it now: look at the highlighted area, understand what control it gives you, then continue when the screen feels familiar.`,
    900,
  );
}

export async function explainOnboardingStep(input: OnboardingAiInput): Promise<OnboardingAiResult> {
  try {
    const response = await callFn<OnboardingAiResponse>(
      "market-onboarding-ai-guide",
      {
        flow_key: input.flowKey,
        flow_title: input.flowTitle,
        flow_summary: input.flowSummary,
        step_index: input.stepIndex,
        total_steps: input.totalSteps,
        step_title: input.stepTitle,
        step_body: input.stepBody,
        target_label: input.targetLabel,
        target_position: input.targetPosition,
        ai_hint: input.aiHint,
        mode: input.mode,
      },
      25000,
    );

    const text = cleanText(response.text, input.mode === "summary" ? 650 : 1200);
    if (response.ok !== false && text) {
      return { text, source: "bestcity_ai" };
    }
  } catch {
    // The guided tutorial must remain useful even when the optional AI service is unavailable.
  }

  return {
    text: localGuide(input),
    source: "local",
  };
}
