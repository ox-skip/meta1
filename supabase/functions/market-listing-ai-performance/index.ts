import { bad, methodNotAllowed, ok, unauth } from "../_shared/market/http.ts";
import {
  supabaseAdminClient,
  supabaseUserClient,
} from "../_shared/market/supabase.ts";
import {
  asRecord,
  missingGeminiConfigMessage,
  normalizeOneOf,
  normalizeStringList,
  requestGeminiJson,
  trimText,
} from "../_shared/market/gemini.ts";

const CONFIDENCE_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    performance_score: { type: "number" },
    confidence: { type: "string" },
    summary: { type: "string" },
    conversion_wins: { type: "array", items: { type: "string" } },
    issue_flags: { type: "array", items: { type: "string" } },
    action_items: { type: "array", items: { type: "string" } },
    media_tips: { type: "array", items: { type: "string" } },
    pricing_note: { type: "string" },
    suggested_title: { type: "string" },
    suggested_description: { type: "string" },
  },
  required: [
    "performance_score",
    "confidence",
    "summary",
    "conversion_wins",
    "issue_flags",
    "action_items",
    "media_tips",
    "pricing_note",
    "suggested_title",
    "suggested_description",
  ],
} as const;

function requireUuid(name: string, value: unknown) {
  const raw = String(value ?? "").trim();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(raw)
  ) {
    throw new Error(`${name} must be a uuid`);
  }
  return raw;
}

function clampScore(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function normalizePerformance(raw: unknown) {
  const data = asRecord(raw);
  return {
    performance_score: clampScore(data.performance_score),
    confidence: normalizeOneOf(data.confidence, CONFIDENCE_LEVELS, "LOW"),
    summary: trimText(data.summary, 420),
    conversion_wins: normalizeStringList(data.conversion_wins, 5, 180),
    issue_flags: normalizeStringList(data.issue_flags, 7, 180),
    action_items: normalizeStringList(data.action_items, 8, 220),
    media_tips: normalizeStringList(data.media_tips, 6, 180),
    pricing_note: trimText(data.pricing_note, 260),
    suggested_title: trimText(data.suggested_title, 120),
    suggested_description: trimText(data.suggested_description, 2200),
  };
}

async function maybeCount(
  query: PromiseLike<{ count: number | null; error: any }>,
) {
  const { count, error } = await query;
  if (error) {
    console.warn(
      "[market-listing-ai-performance] count skipped:",
      error.message,
    );
    return 0;
  }
  return Number(count ?? 0);
}

function buildPrompt(input: {
  listing: any;
  images: any[];
  previews: any[];
  metrics: Record<string, number>;
  recentComments: any[];
}) {
  const payload = {
    listing: {
      id: input.listing.id,
      category: input.listing.category,
      sub_category: input.listing.sub_category,
      title: trimText(input.listing.title, 300),
      description: trimText(input.listing.description, 5000),
      price_amount: input.listing.price_amount,
      currency: input.listing.currency,
      delivery_type: input.listing.delivery_type,
      stock_qty: input.listing.stock_qty,
      is_active: input.listing.is_active,
      website_url_present: Boolean(input.listing.website_url),
      created_at: input.listing.created_at,
      updated_at: input.listing.updated_at,
    },
    media: {
      image_count: input.images.length,
      preview_count: input.previews.length,
      image_meta: input.images.slice(0, 8).map((image: any) => ({
        sort_order: image.sort_order,
        mime_type: trimText(image.mime_type || image.meta?.mime_type, 120),
        file_name: trimText(image.file_name || image.meta?.file_name, 160),
      })),
      preview_types: input.previews.slice(0, 8).map((preview: any) => ({
        kind: preview.kind,
        title: trimText(preview.title, 120),
        mime_type: trimText(preview.mime_type, 120),
        link_url_present: Boolean(preview.link_url),
      })),
    },
    metrics: input.metrics,
    recent_buyer_comments: input.recentComments.slice(0, 8).map((
      comment: any,
    ) => ({
      body: trimText(comment.body, 600),
      created_at: comment.created_at,
    })),
  };

  return [
    "You are a marketplace seller performance assistant.",
    "Return structured JSON only.",
    "Use only facts from the payload. Do not invent sales, traffic, customer demographics, guarantees, specs, or availability.",
    "Assess how clear and purchase-ready this live listing is. Use metrics only as weak signals, because low counts may simply mean the listing is new.",
    "performance_score is 0 to 100 for listing readiness and conversion quality, not seller quality.",
    "suggested_title and suggested_description can improve copy, but must remain grounded in the existing listing facts.",
    "action_items should be practical edits the seller can make now.",
    "media_tips should focus on proof/coverage gaps visible from metadata counts, not unseen image content.",
    "Input payload:",
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
    const listingId = requireUuid("listing_id", body.listing_id);
    const admin = supabaseAdminClient();

    const { data: listing, error: listingError } = await admin
      .from("market_listings")
      .select(
        "id,seller_id,category,sub_category,title,description,price_amount,currency,delivery_type,stock_qty,is_active,website_url,created_at,updated_at",
      )
      .eq("id", listingId)
      .maybeSingle();
    if (listingError) throw listingError;
    if (!listing?.id) throw new Error("Listing not found");
    if (String(listing.seller_id) !== auth.user.id) return unauth();

    const [
      { data: images, error: imageError },
      { data: previews, error: previewError },
      { data: comments, error: commentError },
    ] = await Promise.all([
      admin
        .from("market_listing_images")
        .select("id,listing_id,sort_order,meta,created_at")
        .eq("listing_id", listingId)
        .order("sort_order", { ascending: true }),
      admin
        .from("market_listing_previews")
        .select("id,listing_id,kind,title,link_url,mime_type,created_at")
        .eq("listing_id", listingId)
        .order("sort_order", { ascending: true }),
      admin
        .from("market_listing_comments")
        .select("id,listing_id,body,created_at")
        .eq("listing_id", listingId)
        .order("created_at", { ascending: false })
        .limit(12),
    ]);
    if (imageError) throw imageError;
    if (previewError) throw previewError;
    if (commentError) throw commentError;

    const [
      orderCount,
      activeOrderCount,
      completedOrderCount,
      likeCount,
      dislikeCount,
      commentCount,
    ] = await Promise.all([
      maybeCount(
        admin
          .from("market_orders")
          .select("id", { count: "exact", head: true })
          .eq("listing_id", listingId),
      ),
      maybeCount(
        admin
          .from("market_orders")
          .select("id", { count: "exact", head: true })
          .eq("listing_id", listingId)
          .in("status", [
            "CREATED",
            "IN_ESCROW",
            "OUT_FOR_DELIVERY",
            "DELIVERED",
          ]),
      ),
      maybeCount(
        admin
          .from("market_orders")
          .select("id", { count: "exact", head: true })
          .eq("listing_id", listingId)
          .in("status", ["RELEASED", "DELIVERED"]),
      ),
      maybeCount(
        admin
          .from("market_listing_reactions")
          .select("id", { count: "exact", head: true })
          .eq("listing_id", listingId)
          .eq("reaction", "like"),
      ),
      maybeCount(
        admin
          .from("market_listing_reactions")
          .select("id", { count: "exact", head: true })
          .eq("listing_id", listingId)
          .eq("reaction", "dislike"),
      ),
      maybeCount(
        admin
          .from("market_listing_comments")
          .select("id", { count: "exact", head: true })
          .eq("listing_id", listingId),
      ),
    ]);

    const result = await requestGeminiJson({
      prompt: buildPrompt({
        listing,
        images: images ?? [],
        previews: previews ?? [],
        metrics: {
          orders_total: orderCount,
          orders_active: activeOrderCount,
          orders_completed_or_delivered: completedOrderCount,
          likes: likeCount,
          dislikes: dislikeCount,
          comments: commentCount,
        },
        recentComments: comments ?? [],
      }),
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.25,
      maxOutputTokens: 1500,
    });

    return ok({
      ok: true,
      listing_id: listingId,
      model: result.model,
      performance: normalizePerformance(result.data),
    });
  } catch (error: unknown) {
    return bad(missingGeminiConfigMessage(error));
  }
});
