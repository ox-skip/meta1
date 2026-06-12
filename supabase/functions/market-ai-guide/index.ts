import { bad, methodNotAllowed, ok, unauth } from "../_shared/market/http.ts";
import { supabaseUserClient } from "../_shared/market/supabase.ts";
import {
  asRecord,
  errorMessage,
  normalizeStringList,
  requestGeminiJson,
  trimText,
} from "../_shared/market/gemini.ts";

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    answer: { type: "string" },
    follow_ups: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["answer", "follow_ups"],
} as const;

function cleanProviderError(error: unknown) {
  const message = errorMessage(error, "BestCity AI could not answer right now.");
  if (/missing env var|GEMINI_API_KEY|GOOGLE_API_KEY|GOOGLE_GENERATIVE_AI_API_KEY/i.test(message)) {
    return "BestCity AI is not configured yet.";
  }
  return message
    .replace(/Gemini/gi, "BestCity AI provider")
    .replace(/GEMINI_MODEL/g, "AI_MODEL")
    .replace(/GEMINI_API_KEY|GOOGLE_API_KEY|GOOGLE_GENERATIVE_AI_API_KEY/g, "AI_PROVIDER_KEY");
}

function normalizeResponse(raw: unknown) {
  const data = asRecord(raw);
  const answer = trimText(data.answer, 1400);
  const followUps = normalizeStringList(data.follow_ups, 4, 80);
  return {
    answer,
    follow_ups: followUps.length
      ? followUps
      : [
          "How do I buy safely?",
          "How do I sell on BestCity?",
          "Explain escrow",
          "What is the stock market?",
        ],
  };
}

function buildPrompt(input: {
  question: string;
  context: Record<string, unknown>;
}) {
  const marketKnowledge = {
    app: "BestCity Market",
    purpose:
      "A marketplace for discovering products, services, seller social updates, escrow-backed orders, wallets, rewards, verification, support, and digital stock tools.",
    home_sections: [
      "All combines products and services.",
      "Products focuses on shippable or physical item listings.",
      "Services focuses on service offers and in-person or digital work.",
      "Social shows seller updates, launches, and marketplace media.",
    ],
    discovery_tools: [
      "Search by listing, seller, need, or category.",
      "Use category chips to narrow products or services.",
      "Use Local feed for listings matched to the user's country and Global feed for all marketplace listings.",
      "Sort by newest, low price, or high price when comparing offers.",
      "Featured listings and stores are promoted; verified stores carry stronger trust signals.",
    ],
    buyer_flow: [
      "Open a listing and review media, description, price, seller profile, reviews, comments, delivery terms, stock, and availability.",
      "Use checkout only when the listing and seller details make sense.",
      "Where supported, funds move through escrow before seller release.",
      "Confirm delivery or completion from the order page before release.",
      "Use messages, support, or disputes when something is unclear.",
    ],
    seller_flow: [
      "Create or complete a market profile/store.",
      "Create listings with clear title, description, price, category, delivery type, stock or service terms, and useful media.",
      "Keep buyer communication and proof inside BestCity.",
      "Use order pages to deliver, upload digital deliverables, or respond to buyer actions.",
      "Verification and featuring help buyers trust and discover a store.",
    ],
    order_and_safety:
      "Orders track created, paid or escrowed, delivery/upload, buyer confirmation, completion, cancellation, refund, or dispute states. Users should not move payment or delivery proof outside BestCity when they need protection.",
    stock_market:
      "The Stock Market shortcut opens digital stock tools for store market identities, quotes, trades, positions, portfolio tracking, and market discussion. It is separate from ordinary product/service checkout and should be reviewed carefully before trading.",
    boundaries: [
      "Do not claim to see private orders, balances, messages, exact listing data, or hidden policies unless provided in context.",
      "Do not promise refunds, guaranteed safety, or investment returns.",
      "Do not give legal, financial, or medical advice.",
      "When unsure, direct the user to open the relevant listing, order, wallet, support, verification, or stock screen.",
    ],
  };

  return [
    "You are BestCity AI, a practical in-app guide for BestCity Market.",
    "Answer the user's market question like a real product guide. Be specific to BestCity Market and explain the workflow clearly.",
    "Keep the answer short enough for a mobile chat: 1 to 3 compact paragraphs, then practical next steps when helpful.",
    "Use plain language. Do not mention Gemini, prompts, internal database names, backend functions, or implementation details.",
    "If the question is off-topic, gently bring it back to BestCity Market.",
    "Return JSON only with answer and follow_ups fields.",
    "BestCity Market knowledge:",
    JSON.stringify(marketKnowledge),
    "Current screen context:",
    JSON.stringify(input.context),
    "User question:",
    input.question,
  ].join("\n\n");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  const userClient = supabaseUserClient(req);
  const { data: auth, error: authError } = await userClient.auth.getUser();
  if (authError || !auth.user) return unauth();

  try {
    const body = asRecord(await req.json().catch(() => ({})));
    const question = trimText(body.question, 500);
    if (!question) return bad("Ask BestCity AI a market question first.");

    const context = asRecord(body.context);
    const cleanContext = {
      section: trimText(context.section, 40),
      directory_mode: trimText(context.directoryMode, 40),
      feed_scope: trimText(context.feedScope, 40),
      result_count: Number(context.resultCount ?? 0) || 0,
      location: trimText(context.locationLabel, 120),
      selected_category: trimText(context.selectedCategory, 80),
      search_query: trimText(context.query, 120),
      sort_by: trimText(context.sortBy, 40),
    };

    const result = await requestGeminiJson({
      prompt: buildPrompt({ question, context: cleanContext }),
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.35,
      maxOutputTokens: 700,
    });

    const normalized = normalizeResponse(result.data);
    if (!normalized.answer) return bad("BestCity AI did not return an answer.");

    return ok({
      ok: true,
      ...normalized,
      model: result.model,
    });
  } catch (error: unknown) {
    return bad(cleanProviderError(error));
  }
});
