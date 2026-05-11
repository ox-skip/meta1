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

const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
const CONFIDENCE_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    risk_level: { type: "string" },
    confidence: { type: "string" },
    summary: { type: "string" },
    mismatch_flags: { type: "array", items: { type: "string" } },
    payment_flags: { type: "array", items: { type: "string" } },
    delivery_flags: { type: "array", items: { type: "string" } },
    dispute_likelihood: { type: "string" },
    recommended_actions: { type: "array", items: { type: "string" } },
    buyer_note: { type: "string" },
    seller_note: { type: "string" },
  },
  required: [
    "risk_level",
    "confidence",
    "summary",
    "mismatch_flags",
    "payment_flags",
    "delivery_flags",
    "dispute_likelihood",
    "recommended_actions",
    "buyer_note",
    "seller_note",
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

function normalizeRisk(raw: unknown) {
  const data = asRecord(raw);
  return {
    risk_level: normalizeOneOf(data.risk_level, RISK_LEVELS, "LOW"),
    confidence: normalizeOneOf(data.confidence, CONFIDENCE_LEVELS, "LOW"),
    summary: trimText(data.summary, 420),
    mismatch_flags: normalizeStringList(data.mismatch_flags, 6, 180),
    payment_flags: normalizeStringList(data.payment_flags, 6, 180),
    delivery_flags: normalizeStringList(data.delivery_flags, 6, 180),
    dispute_likelihood: trimText(data.dispute_likelihood, 180),
    recommended_actions: normalizeStringList(data.recommended_actions, 7, 220),
    buyer_note: trimText(data.buyer_note, 700),
    seller_note: trimText(data.seller_note, 700),
  };
}

async function maybeList(query: PromiseLike<{ data: any; error: any }>) {
  const { data, error } = await query;
  if (error) {
    console.warn(
      "[market-order-ai-risk] context query skipped:",
      error.message,
    );
    return [];
  }
  return data ?? [];
}

function buildPrompt(input: {
  userId: string;
  order: any;
  listing: any | null;
  buyerSellerContext: any;
  disputes: any[];
  deliverables: any[];
  intents: any[];
  piPayments: any[];
}) {
  const payload = {
    current_user_role: String(input.order.buyer_id) === input.userId
      ? "buyer"
      : String(input.order.seller_id) === input.userId
      ? "seller"
      : "unknown",
    order: {
      id: input.order.id,
      status: input.order.status,
      quantity: input.order.quantity,
      unit_price: input.order.unit_price,
      amount: input.order.amount,
      currency: input.order.currency,
      created_at: input.order.created_at,
      in_escrow_at: input.order.in_escrow_at,
      out_for_delivery_at: input.order.out_for_delivery_at,
      deliverable_uploaded_at: input.order.deliverable_uploaded_at,
      delivered_at: input.order.delivered_at,
      released_at: input.order.released_at,
      refunded_at: input.order.refunded_at,
      cancelled_at: input.order.cancelled_at,
      has_delivery_address: Boolean(input.order.delivery_address),
      has_buyer_contact: Boolean(input.order.buyer_contact),
    },
    listing: input.listing
      ? {
        id: input.listing.id,
        title: trimText(input.listing.title, 240),
        category: input.listing.category,
        sub_category: input.listing.sub_category,
        delivery_type: input.listing.delivery_type,
        price_amount: input.listing.price_amount,
        currency: input.listing.currency,
        stock_qty: input.listing.stock_qty,
        is_active: input.listing.is_active,
      }
      : null,
    counterparties: input.buyerSellerContext,
    disputes: input.disputes.slice(0, 5),
    deliverables: input.deliverables.slice(0, 8).map((item: any) => ({
      id: item.id,
      uploaded_by: item.uploaded_by,
      created_at: item.created_at,
      has_link_url: Boolean(item.link_url),
      file_name: trimText(item.file_name, 160),
      mime_type: trimText(item.mime_type, 120),
    })),
    crypto_intents: input.intents.slice(0, 10).map((item: any) => ({
      intent_type: item.intent_type,
      status: item.status,
      chain: item.chain,
      tx_hash_present: Boolean(item.tx_hash),
      failure_reason: trimText(item.failure_reason, 240),
      created_at: item.created_at,
      updated_at: item.updated_at,
    })),
    pi_payments: input.piPayments.slice(0, 5).map((item: any) => ({
      status: item.status,
      payment_id_present: Boolean(item.payment_id),
      txid_present: Boolean(item.txid),
      topup_pi_required: item.topup_pi_required,
      shortfall_usd: item.shortfall_usd,
      updated_at: item.updated_at,
    })),
  };

  return [
    "You are a marketplace checkout and order risk assistant.",
    "Return structured JSON only.",
    "Use only facts from the payload. Do not invent fraud, delivery status, payment success, refunds, releases, or user intent.",
    "Identify mismatches between order status, payment/escrow signals, delivery/deliverable state, listing availability, and dispute history.",
    "Do not tell a user to go off-platform. Do not promise a refund or release. Recommend safe, in-app actions only.",
    "risk_level should be LOW unless concrete signals show payment, delivery, safety, or dispute risk.",
    "buyer_note and seller_note should be short user-facing notes for the current order state.",
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
    const orderId = requireUuid("order_id", body.order_id);
    const admin = supabaseAdminClient();

    const { data: order, error: orderError } = await admin
      .from("market_orders")
      .select(
        "id,buyer_id,seller_id,listing_id,quantity,unit_price,amount,currency,status,delivery_address,buyer_contact,created_at,in_escrow_at,out_for_delivery_at,deliverable_uploaded_at,delivered_at,released_at,refunded_at,cancelled_at",
      )
      .eq("id", orderId)
      .maybeSingle();
    if (orderError) throw orderError;
    if (!order?.id) throw new Error("Order not found");
    if (
      String(order.buyer_id) !== auth.user.id &&
      String(order.seller_id) !== auth.user.id
    ) {
      return unauth();
    }

    const listingId = String(order.listing_id ?? "").trim();
    const [
      { data: listing, error: listingError },
      { data: buyer, error: buyerError },
      { data: seller, error: sellerError },
    ] = await Promise.all([
      listingId
        ? admin
          .from("market_listings")
          .select(
            "id,seller_id,category,sub_category,title,price_amount,currency,delivery_type,stock_qty,is_active,created_at,updated_at",
          )
          .eq("id", listingId)
          .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      admin
        .from("market_seller_profiles")
        .select(
          "user_id,market_username,is_verified,risk_score,active,payout_tier",
        )
        .eq("user_id", order.buyer_id)
        .maybeSingle(),
      admin
        .from("market_seller_profiles")
        .select(
          "user_id,market_username,is_verified,risk_score,active,payout_tier",
        )
        .eq("user_id", order.seller_id)
        .maybeSingle(),
    ]);
    if (listingError) throw listingError;
    if (buyerError) throw buyerError;
    if (sellerError) throw sellerError;

    const [disputes, deliverables, intents, piPayments] = await Promise.all([
      maybeList(
        admin
          .from("market_disputes")
          .select("id,order_id,reason,status,resolution,created_at,updated_at")
          .eq("order_id", orderId)
          .order("created_at", { ascending: false }),
      ),
      maybeList(
        admin
          .from("market_deliverables")
          .select(
            "id,order_id,uploaded_by,file_name,mime_type,link_url,created_at",
          )
          .eq("order_id", orderId)
          .order("created_at", { ascending: false }),
      ),
      maybeList(
        admin
          .from("market_crypto_intents")
          .select(
            "id,order_id,intent_type,status,chain,tx_hash,failure_reason,created_at,updated_at",
          )
          .eq("order_id", orderId)
          .order("created_at", { ascending: false }),
      ),
      maybeList(
        admin
          .from("market_pi_payments")
          .select(
            "id,order_id,status,payment_id,txid,topup_pi_required,shortfall_usd,updated_at,created_at",
          )
          .eq("order_id", orderId)
          .order("created_at", { ascending: false }),
      ),
    ]);

    const result = await requestGeminiJson({
      prompt: buildPrompt({
        userId: auth.user.id,
        order,
        listing: listing ?? null,
        buyerSellerContext: {
          buyer_has_seller_profile: Boolean(buyer),
          buyer_verified_seller_profile: Boolean(buyer?.is_verified),
          seller_active: Boolean(seller?.active),
          seller_verified: Boolean(seller?.is_verified),
          seller_risk_score: Number.isFinite(Number(seller?.risk_score))
            ? Number(seller?.risk_score)
            : null,
          seller_payout_tier: trimText(seller?.payout_tier, 40),
        },
        disputes,
        deliverables,
        intents,
        piPayments,
      }),
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.15,
      maxOutputTokens: 1300,
    });

    return ok({
      ok: true,
      order_id: orderId,
      model: result.model,
      risk: normalizeRisk(result.data),
    });
  } catch (error: unknown) {
    return bad(missingGeminiConfigMessage(error));
  }
});
