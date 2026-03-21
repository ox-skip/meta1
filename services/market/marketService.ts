import { uploadToSupabaseStorage } from "@/services/market/storageUpload";
import { supabase } from "@/services/supabase";

export type MarketSellerProfile = {
  user_id: string;
  market_username: string | null;
  display_name: string | null;
  business_name: string;
  bio: string | null;
  phone: string | null;
  location_text: string | null;
  logo_path: string | null;
  banner_path: string | null;
  offers_remote: boolean;
  offers_in_person: boolean;
  is_verified: boolean;
  payout_tier: "standard" | "fast";
  active: boolean;
};

export type CreateListingInput = {
  seller_id: string;
  category: "product" | "service";
  sub_category: string; // you store slug e.g "mens-wear"
  delivery_type: "physical" | "digital" | "in_person";
  title: string;
  description?: string | null;
  price_amount: number;
  currency: "NGN" | "USDC" | "USDT";
  stock_qty?: number | null; // products
  availability?: any;
  payment_options?: any;
  is_active?: boolean;
};

export type ListingImageInsert = {
  listing_id: string;
  storage_path: string;
  public_url: string | null;
  sort_order: number;
  meta?: any;
};

function errorWithPartialRows(message: string, rows: any[]) {
  const error = new Error(message) as Error & { partialRows?: any[] };
  error.partialRows = rows;
  return error;
}

export async function getMySellerProfile() {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("market_seller_profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as MarketSellerProfile | null;
}

export async function upsertSellerProfile(input: Partial<MarketSellerProfile> & { business_name: string }) {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) throw new Error("Not authenticated");

  const payload = {
    user_id: user.id,
    business_name: input.business_name,
    market_username: input.market_username ?? null,
    display_name: input.display_name ?? null,
    bio: input.bio ?? null,
    phone: input.phone ?? null,
    location_text: input.location_text ?? null,
    address: (input as any).address ?? {},
    logo_path: input.logo_path ?? null,
    banner_path: input.banner_path ?? null,
    offers_remote: input.offers_remote ?? false,
    offers_in_person: input.offers_in_person ?? false,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("market_seller_profiles")
    .upsert(payload, { onConflict: "user_id" })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data as MarketSellerProfile;
}

export async function createListing(input: CreateListingInput) {
  const stockQty =
    input.stock_qty === undefined || input.stock_qty === null ? null : Number(input.stock_qty);
  const outOfStock = input.category === "product" && stockQty !== null && Number(stockQty) <= 0;
  const requestedActive = typeof input.is_active === "boolean" ? input.is_active : true;
  const paymentOptions = { ...(input.payment_options ?? {}) } as any;
  if (outOfStock) {
    paymentOptions.out_of_stock = true;
    paymentOptions.out_of_stock_at = new Date().toISOString();
  } else {
    delete paymentOptions.out_of_stock;
    delete paymentOptions.out_of_stock_at;
  }

  const { data, error } = await supabase
    .from("market_listings")
    .insert({
      seller_id: input.seller_id,
      category: input.category,
      sub_category: input.sub_category,
      title: input.title,
      description: input.description ?? null,
      price_amount: input.price_amount,
      currency: input.currency,
      delivery_type: input.delivery_type,
      stock_qty: stockQty,
      availability: input.availability ?? {},
      payment_options: paymentOptions,
      is_active: requestedActive && !outOfStock,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function setListingCoverImage(listingId: string, coverImageId: string) {
  const { error } = await supabase
    .from("market_listings")
    .update({ cover_image_id: coverImageId, updated_at: new Date().toISOString() })
    .eq("id", listingId);

  if (error) throw new Error(error.message);
}

export async function insertListingImages(
  images: ListingImageInsert[],
  options?: { activateListing?: boolean },
) {
  if (!images.length) return [];

  const rows: any[] = [];
  for (const img of images) {
    const { data, error } = await supabase
      .from("market_listing_images")
      .insert({
        listing_id: img.listing_id,
        storage_path: img.storage_path,
        public_url: img.public_url ?? null,
        sort_order: Number.isFinite(Number(img.sort_order)) ? Number(img.sort_order) : 0,
        meta: img.meta ?? {},
      })
      .select("*")
      .single();

    if (error || !data?.id) {
      throw errorWithPartialRows(error?.message || "Image row insert failed.", rows);
    }

    rows.push(data);

    if (options?.activateListing === true && Number(img.sort_order ?? 0) === 0) {
      const { error: activateError } = await supabase
        .from("market_listings")
        .update({ is_active: true, updated_at: new Date().toISOString() })
        .eq("id", img.listing_id);
      if (activateError) {
        throw errorWithPartialRows(activateError.message, rows);
      }
    }
  }

  return rows;
}

export async function rollbackListingDraft(listingId: string, uploadedPaths: string[] = []) {
  const cleanPaths = Array.from(
    new Set(
      uploadedPaths
        .map((p) => String(p || "").trim())
        .filter(Boolean),
    ),
  );

  if (cleanPaths.length) {
    const { error: storageError } = await supabase.storage.from("market-listings").remove(cleanPaths);
    if (storageError) {
      console.log("[rollbackListingDraft] storage cleanup failed", storageError.message);
    }
  }

  const { error: imageDeleteError } = await supabase
    .from("market_listing_images")
    .delete()
    .eq("listing_id", listingId);
  if (imageDeleteError) {
    console.log("[rollbackListingDraft] image rows cleanup failed", imageDeleteError.message);
  }

  const { error: deactivateError } = await supabase
    .from("market_listings")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", listingId);
  if (deactivateError) {
    console.log("[rollbackListingDraft] listing deactivate failed", deactivateError.message);
  }

  const { error: listingDeleteError } = await supabase
    .from("market_listings")
    .delete()
    .eq("id", listingId);
  if (listingDeleteError) {
    console.log("[rollbackListingDraft] listing delete failed", listingDeleteError.message);
  }
}

export async function uploadToBucket(params: {
  bucket: string;
  path: string;
  uri: string;
  contentType: string;
}) {
  // fetch file as blob (works in Expo)

  return uploadToSupabaseStorage({
    bucket: params.bucket,
    path: params.path,
    localUri: params.uri,
    contentType: params.contentType,

  });

  
}
