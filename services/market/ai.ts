import { callFn } from "@/services/functions";

export type MarketAiSubCategoryOption = {
  slug: string;
  title: string;
};

export type MarketAiDraftInput = {
  category: "product" | "service";
  delivery_type: "physical" | "digital" | "in_person";
  sub_category?: string;
  title?: string;
  description?: string;
  website_url?: string;
  price?: number | null;
  local_currency?: string;
  media_summary?: Array<{
    kind: "image" | "video";
    content_type: string;
    file_name?: string | null;
    file_size?: number | null;
  }>;
  available_sub_categories?: MarketAiSubCategoryOption[];
};

export type MarketAiDraftResult = {
  draft: {
    suggested_title: string;
    suggested_description: string;
    suggested_sub_category: string;
    tags: string[];
    warnings: string[];
    price_hint_low: number;
    price_hint_high: number;
    price_hint_currency: string;
    price_hint_reason: string;
    media_notes: string[];
    confidence_note: string;
  };
  model?: string;
};

export async function generateListingAiDraft(input: MarketAiDraftInput) {
  return await callFn<MarketAiDraftResult>("market-ai-draft-listing", input, 45000);
}

export type MarketOrderAiRisk = {
  risk_level: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  confidence: "LOW" | "MEDIUM" | "HIGH";
  summary: string;
  mismatch_flags: string[];
  payment_flags: string[];
  delivery_flags: string[];
  dispute_likelihood: string;
  recommended_actions: string[];
  buyer_note: string;
  seller_note: string;
};

export type MarketOrderAiRiskResult = {
  ok: true;
  order_id: string;
  model?: string;
  risk: MarketOrderAiRisk;
};

export async function generateOrderAiRisk(orderId: string) {
  return await callFn<MarketOrderAiRiskResult>(
    "market-order-ai-risk",
    { order_id: orderId },
    45000,
  );
}

export type MarketListingAiPerformance = {
  performance_score: number;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  summary: string;
  conversion_wins: string[];
  issue_flags: string[];
  action_items: string[];
  media_tips: string[];
  pricing_note: string;
  suggested_title: string;
  suggested_description: string;
};

export type MarketListingAiPerformanceResult = {
  ok: true;
  listing_id: string;
  model?: string;
  performance: MarketListingAiPerformance;
};

export async function generateListingAiPerformance(listingId: string) {
  return await callFn<MarketListingAiPerformanceResult>(
    "market-listing-ai-performance",
    { listing_id: listingId },
    45000,
  );
}

export type BestCityMarketGuideContext = {
  section?: string;
  directoryMode?: string;
  feedScope?: string;
  resultCount?: number;
  locationLabel?: string;
  selectedCategory?: string | null;
  query?: string;
  sortBy?: string;
};

export type BestCityMarketGuideResult = {
  answer: string;
  source: "bestcity_ai" | "local";
  followUps: string[];
};

type BestCityMarketGuideResponse = {
  ok?: boolean;
  answer?: string;
  follow_ups?: string[];
};

function cleanGuideText(value: unknown, limit = 1400) {
  const text = String(value ?? "")
    .trim()
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
  return text.length > limit ? `${text.slice(0, limit).trim()}...` : text;
}

function cleanFollowUps(value: unknown) {
  const list = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const text = cleanGuideText(item, 80);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= 4) break;
  }
  return out;
}

function localMarketGuide(question: string, context?: BestCityMarketGuideContext): BestCityMarketGuideResult {
  const q = question.toLowerCase();
  const scope = context?.feedScope === "country" ? "Local" : "Global";
  const location = context?.locationLabel && context.locationLabel !== "Location unavailable"
    ? context.locationLabel
    : "your detected country";
  const section = String(context?.section || "").toLowerCase();
  const mode = String(context?.directoryMode || "").toLowerCase();
  const currentQuery = String(context?.query || "").trim();

  let answer =
    "BestCity Market helps you discover products, services, sellers, social updates, and digital stock tools from one market home. Start with Products or Services, use search or category chips to narrow the feed, then open a listing to review media, seller details, delivery terms, comments, trust signals, and checkout options.";

  if (section === "search") {
    const queryHint = currentQuery
      ? `Your current query is "${currentQuery}". If results are weak, try fewer words, a category word, the seller name, or a direct @username.`
      : "Start with a concrete product, service, category, seller name, or @username.";
    const modeHint =
      mode === "store"
        ? "Store mode is best for seller names and handles."
        : mode === "product"
        ? "Product mode is best for physical items and shippable goods."
        : mode === "service"
        ? "Service mode is best for skills, bookings, and work offers."
        : "All mode checks listings and stores together.";
    answer = `${queryHint} ${modeHint} BestCity ranks exact titles, store handles, categories, matching descriptions, availability, and freshness first.`;
  } else if (/escrow|trust|safe|payment|pay|checkout|release/.test(q)) {
    answer =
      "For buying, BestCity is built around a trust flow: review the listing and seller, place the order through checkout, keep payment protected in escrow where supported, confirm delivery or completion, then release funds to the seller. If something feels wrong, use messages, order details, support, or dispute tools instead of moving the deal outside BestCity.";
  } else if (/sell|seller|store|listing|post/.test(q)) {
    answer =
      "For selling, create or complete your store profile, add clear listing media, choose product or service, set price, stock or delivery details, and keep buyer conversations inside BestCity. Verified and featured store signals help buyers trust you faster, while order tools track each sale from payment through delivery confirmation.";
  } else if (/search|find|category|filter|near|local|global/.test(q)) {
    answer =
      `Use search for exact needs, section tabs for Products, Services, or Social, and category chips for browsing. The ${scope} feed controls whether you see listings for ${location} or the whole marketplace. Sorting by newest or price helps compare options quickly.`;
  } else if (/stock|share|trade|portfolio/.test(q)) {
    answer =
      "The Stock Market shortcut opens BestCity's digital stock area, where stores can have tradable market identities and users can inspect markets, quotes, positions, and portfolio exposure. Treat it as a separate market tool from normal product and service listings, and review quotes carefully before submitting trades.";
  } else if (/order|delivery|dispute|support|refund/.test(q)) {
    answer =
      "Orders are tracked from creation through payment, escrow, seller delivery or upload, buyer confirmation, and release. Open the order page to see the next available action. If delivery is unclear, proof is missing, or a refund is needed, use the order tools, dispute flow, or support so the record stays inside BestCity.";
  } else if (/verify|verified|feature|promote/.test(q)) {
    answer =
      "Verified stores have stronger trust signals for buyers. Featured listings and storefronts are promoted areas that make good offers easier to notice. They do not replace your own checks: still inspect media, price, delivery terms, seller profile, and order history before buying.";
  }

  return {
    answer: cleanGuideText(answer, 1400),
    source: "local",
    followUps: section === "search"
      ? [
          "How should I search?",
          "Why no results?",
          "Product or service mode?",
          "How do I find a store?",
        ]
      : [
          "How do I buy safely?",
          "How do I sell on BestCity?",
          "Explain local and global feeds",
          "What is the stock market?",
        ],
  };
}

export async function askBestCityMarketGuide(
  question: string,
  context?: BestCityMarketGuideContext,
): Promise<BestCityMarketGuideResult> {
  const cleanQuestion = cleanGuideText(question, 500);
  if (!cleanQuestion) {
    return localMarketGuide("Explain BestCity Market", context);
  }

  try {
    const response = await callFn<BestCityMarketGuideResponse>(
      "market-ai-guide",
      {
        question: cleanQuestion,
        context,
      },
      35000,
    );

    const answer = cleanGuideText(response.answer, 1400);
    if (response.ok !== false && answer) {
      return {
        answer,
        source: "bestcity_ai",
        followUps: cleanFollowUps(response.follow_ups),
      };
    }
  } catch {
    // The market guide should still be helpful if the optional AI provider is unavailable.
  }

  return localMarketGuide(cleanQuestion, context);
}
