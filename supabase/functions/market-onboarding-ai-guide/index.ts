import { bad, methodNotAllowed, ok, unauth } from "../_shared/market/http.ts";
import { supabaseUserClient } from "../_shared/market/supabase.ts";
import {
  asRecord,
  errorMessage,
  requestGeminiJson,
  trimText,
} from "../_shared/market/gemini.ts";

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    text: { type: "string" },
  },
  required: ["text"],
} as const;

function cleanMode(value: unknown) {
  return trimText(value, 20).toLowerCase() === "full" ? "full" : "summary";
}

function cleanProviderError(error: unknown) {
  const message = errorMessage(error, "BestCity Ai could not prepare this guide.");
  if (/missing env var|GEMINI_API_KEY|GOOGLE_API_KEY|GOOGLE_GENERATIVE_AI_API_KEY/i.test(message)) {
    return "BestCity Ai is not configured yet.";
  }
  return message
    .replace(/Gemini/gi, "BestCity Ai provider")
    .replace(/GEMINI_MODEL/g, "AI_MODEL")
    .replace(/GEMINI_API_KEY|GOOGLE_API_KEY|GOOGLE_GENERATIVE_AI_API_KEY/g, "AI_PROVIDER_KEY");
}

function normalizeGuide(raw: unknown, mode: "summary" | "full", fallback: string) {
  const data = asRecord(raw);
  const limit = mode === "summary" ? 520 : 1100;
  return trimText(data.text, limit) || trimText(fallback, limit);
}

function buildFallback(input: {
  stepBody: string;
  targetLabel: string;
  flowSummary: string;
  actionLabel: string;
  mode: "summary" | "full";
}) {
  const focus = input.targetLabel ? `Focus on ${input.targetLabel}. ` : "";
  const action = input.actionLabel ? `\n\nTry it now: ${input.actionLabel}` : "";
  if (input.mode === "summary") {
    return `${focus}${input.stepBody}${action}`;
  }
  const context = input.flowSummary ? `\n\nWhy it matters: ${input.flowSummary}` : "";
  return `${focus}${input.stepBody}${context}${action || "\n\nUse the highlighted area first, then continue through the tutorial once the control feels clear."}`;
}

function buildPrompt(input: {
  mode: "summary" | "full";
  flowKey: string;
  flowTitle: string;
  flowSummary: string;
  stepIndex: number;
  totalSteps: number;
  stepTitle: string;
  stepBody: string;
  targetLabel: string;
  targetPosition: string;
  actionLabel: string;
  aiHint: string;
}) {
  const payload = {
    app: "BestCity",
    role: "in-app onboarding",
    mode: input.mode,
    flow_key: input.flowKey,
    flow_title: input.flowTitle,
    flow_summary: input.flowSummary,
    step_number: input.stepIndex + 1,
    total_steps: input.totalSteps,
    step_title: input.stepTitle,
    step_body: input.stepBody,
    highlighted_area: input.targetLabel,
    highlighted_position: input.targetPosition,
    suggested_user_action: input.actionLabel,
    extra_instruction: input.aiHint,
  };

  const lengthRule = input.mode === "summary"
    ? "Write 2 short sentences maximum."
    : "Write a concise coaching explanation in 2 short paragraphs plus one practical action sentence.";

  return [
    "You are BestCity Ai, a calm in-app onboarding coach for a marketplace app.",
    "Help the user understand only the current highlighted tutorial step.",
    "Do not mention implementation details, providers, internal tables, policies, or backend logic.",
    "Do not tell the user the tutorial replaces the app. The regular guided tutorial remains primary.",
    lengthRule,
    "Return JSON only with a text field.",
    "Tutorial payload:",
    JSON.stringify(payload),
  ].join("\n\n");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  const userClient = supabaseUserClient(req);
  const { data: auth, error: authError } = await userClient.auth.getUser();
  if (authError || !auth.user) return unauth();

  try {
    const body = asRecord(await req.json().catch(() => ({})));
    const mode = cleanMode(body.mode);
    const flowKey = trimText(body.flow_key, 120);
    const flowTitle = trimText(body.flow_title, 160);
    const flowSummary = trimText(body.flow_summary, 500);
    const stepTitle = trimText(body.step_title, 180);
    const stepBody = trimText(body.step_body, 900);
    const targetLabel = trimText(body.target_label, 120);
    const targetPosition = trimText(body.target_position, 40);
    const actionLabel = trimText(body.action_label, 240);
    const aiHint = trimText(body.ai_hint, 420);
    const stepIndex = Math.max(0, Math.min(50, Number(body.step_index) || 0));
    const totalSteps = Math.max(1, Math.min(50, Number(body.total_steps) || 1));

    if (!stepTitle || !stepBody) {
      return bad("BestCity Ai needs a tutorial step before it can explain it.");
    }

    const fallback = buildFallback({ stepBody, targetLabel, flowSummary, actionLabel, mode });
    const result = await requestGeminiJson({
      prompt: buildPrompt({
        mode,
        flowKey,
        flowTitle,
        flowSummary,
        stepIndex,
        totalSteps,
        stepTitle,
        stepBody,
        targetLabel,
        targetPosition,
        actionLabel,
        aiHint,
      }),
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.35,
      maxOutputTokens: mode === "summary" ? 220 : 520,
    });

    return ok({
      ok: true,
      text: normalizeGuide(result.data, mode, fallback),
      mode,
    });
  } catch (error: unknown) {
    return bad(cleanProviderError(error));
  }
});
