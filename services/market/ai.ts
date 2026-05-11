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
