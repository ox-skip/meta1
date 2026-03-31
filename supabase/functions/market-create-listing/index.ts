import { supabaseUserClient, supabaseAdminClient } from "../_shared/market/supabase.ts";
import { ok, bad, unauth, methodNotAllowed } from "../_shared/market/http.ts";

type ListingCategory = "product" | "service";
type DeliveryType = "physical" | "digital" | "in_person";
type Currency = "NGN" | "USDC";

function isMissingOptionalColumnError(message: string, column: string) {
  return new RegExp(column, "i").test(message) && /(column|schema cache)/i.test(message);
}

function isValidWebsiteUrl(value: string) {
  return /^https:\/\//i.test(value.trim());
}

function assertCategoryRules(category: ListingCategory, delivery_type: DeliveryType) {
  if (category === "product" && delivery_type !== "physical") {
    throw new Error("product listings must have delivery_type=physical");
  }
  if (category === "service" && !["digital", "in_person"].includes(delivery_type)) {
    throw new Error("service listings must have delivery_type=digital or in_person");
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  const supabase = supabaseUserClient(req);
  const admin = supabaseAdminClient();

  const { data: u, error: ue } = await supabase.auth.getUser();
  if (ue || !u.user) return unauth();

  const body = await req.json().catch(() => ({}));

  const category = String(body.category) as ListingCategory;
  const delivery_type = String(body.delivery_type) as DeliveryType;
  const currency = (body.currency ? String(body.currency) : "NGN") as Currency;

  if (!["product", "service"].includes(category)) return bad("Invalid category");
  if (!["physical", "digital", "in_person"].includes(delivery_type)) return bad("Invalid delivery_type");
  if (!["NGN", "USDC"].includes(currency)) return bad("Invalid currency");

  try {
    assertCategoryRules(category, delivery_type);
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    return bad(errorMessage);
  }

  const price_amount = Number(body.price_amount);
  if (!Number.isFinite(price_amount) || price_amount <= 0) return bad("price_amount must be > 0");

  const { data: seller, error: sellerErr } = await admin
    .from("market_seller_profiles")
    .select("user_id,active")
    .eq("user_id", u.user.id)
    .maybeSingle();

  if (sellerErr) return bad(sellerErr.message);
  if (!seller || seller.active === false) return bad("Create and activate your seller profile first");

  const row: Record<string, unknown> = {
    seller_id: u.user.id,
    category,
    sub_category: String(body.sub_category ?? "").trim(),
    title: String(body.title ?? "").trim(),
    description: body.description ? String(body.description) : null,
    price_amount,
    currency,
    delivery_type,
    stock_qty: body.stock_qty === null || body.stock_qty === undefined ? null : Number(body.stock_qty),
    is_active: body.is_active === undefined ? true : !!body.is_active,
  };
  if (Object.prototype.hasOwnProperty.call(body, "availability")) row.availability = body.availability ?? {};
  if (Object.prototype.hasOwnProperty.call(body, "payment_options")) row.payment_options = body.payment_options ?? {};
  if (Object.prototype.hasOwnProperty.call(body, "website_url")) {
    const websiteUrl = String(body.website_url ?? "").trim();
    if (websiteUrl) {
      if (!isValidWebsiteUrl(websiteUrl)) return bad("website_url must start with https://");
      row.website_url = websiteUrl;
    } else {
      row.website_url = null;
    }
  }

  if (!row.sub_category) return bad("sub_category is required");
  if (!row.title) return bad("title is required");
  if (row.stock_qty !== null && (!Number.isInteger(row.stock_qty) || row.stock_qty < 0)) return bad("stock_qty must be null or >= 0");

  let listing: any = null;
  let error: any = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await admin
      .from("market_listings")
      .insert(row)
      .select("*")
      .single();
    listing = result.data ?? null;
    error = result.error ?? null;
    if (!error) break;

    const message = String(error?.message ?? "");
    let removed = false;
    if (Object.prototype.hasOwnProperty.call(row, "availability") && isMissingOptionalColumnError(message, "availability")) {
      delete row.availability;
      removed = true;
    }
    if (Object.prototype.hasOwnProperty.call(row, "payment_options") && isMissingOptionalColumnError(message, "payment_options")) {
      delete row.payment_options;
      removed = true;
    }
    if (Object.prototype.hasOwnProperty.call(row, "website_url") && isMissingOptionalColumnError(message, "website_url")) {
      delete row.website_url;
      removed = true;
    }
    if (!removed) break;
  }

  if (error) return bad(error.message);

  await admin.from("market_audit_logs").insert({
    actor_id: u.user.id,
    actor_type: "user",
    action: "LISTING_CREATED",
    entity_type: "market_listings",
    entity_id: listing.id,
    payload: { category, delivery_type, currency },
  });

  return ok({ listing });
});
