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
