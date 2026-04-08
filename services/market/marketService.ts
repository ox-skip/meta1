import { callFn } from "@/services/functions";
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
  website_url?: string | null;
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

function buildListingPayload(input: CreateListingInput) {
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

  return {
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
    ...(input.website_url !== undefined ? { website_url: input.website_url ?? null } : {}),
    is_active: requestedActive && !outOfStock,
  };
}

async function ensureListingAccountProfile() {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  const user = auth?.user;
  if (authError) throw new Error(authError.message);
  if (!user) throw new Error("Not authenticated");

  try {
    const { data: existing, error } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();

    if (error) throw error;
    if (existing?.id) return;

    const payload: Record<string, unknown> = { id: user.id };
    if (user.email) payload.email = user.email;
    const fullName = String(user.user_metadata?.full_name || user.user_metadata?.name || "").trim();
    if (fullName) payload.full_name = fullName;

    const { error: upsertError } = await supabase
      .from("profiles")
      .upsert(payload, { onConflict: "id" });
    if (!upsertError) return;

    console.log("[marketService.ensureListingAccountProfile] direct profiles upsert failed", upsertError.message);
  } catch (error: any) {
    console.log("[marketService.ensureListingAccountProfile] direct profiles check failed", String(error?.message || error));
  }

  try {
    await callFn("market-seller-profile-upsert", {});
  } catch (error: any) {
    console.log("[marketService.ensureListingAccountProfile] function fallback failed", String(error?.message || error));
  }
}

async function createListingDirect(payload: ReturnType<typeof buildListingPayload>) {
  const { data, error } = await supabase
    .from("market_listings")
    .insert(payload)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

async function insertListingImageDirect(
  img: ListingImageInsert,
  options?: { activateListing?: boolean },
) {
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
    throw new Error(error?.message || "Image row insert failed.");
  }

  const isFirstImage = Number(img.sort_order ?? 0) === 0;
  if (isFirstImage || options?.activateListing === true) {
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (isFirstImage) updates.cover_image_id = data.id;
    if (options?.activateListing === true) updates.is_active = true;

    const { error: listingError } = await supabase
      .from("market_listings")
      .update(updates)
      .eq("id", img.listing_id);
    if (listingError) throw new Error(listingError.message);
  }

  return data;
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
  const payload = buildListingPayload(input);
  await ensureListingAccountProfile();

  try {
    return await createListingDirect(payload);
  } catch (directError: any) {
    console.log("[marketService.createListing] direct insert failed", String(directError?.message || directError));
  }

  try {
    const out = await callFn<{ listing?: any }>("market-create-listing", payload);
    const listing = (out as any)?.listing ?? null;
    if (!listing?.id) throw new Error("Listing creation failed (missing id)");
    return listing;
  } catch (error: any) {
    console.log("[marketService.createListing] function fallback failed", String(error?.message || error));
    return await createListingDirect(payload);
  }
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
    try {
      const row = await insertListingImageDirect(img, options);
      rows.push(row);
      continue;
    } catch (directError: any) {
      console.log("[marketService.insertListingImages] direct insert failed", String(directError?.message || directError));
    }

    try {
      const out = await callFn<{ image?: any }>("market-add-listing-image", {
        listing_id: img.listing_id,
        storage_path: img.storage_path,
        public_url: img.public_url ?? null,
        sort_order: Number.isFinite(Number(img.sort_order)) ? Number(img.sort_order) : 0,
        meta: img.meta ?? {},
        set_as_cover: Number(img.sort_order ?? 0) === 0,
        activate_listing: options?.activateListing === true,
      });
      const row = (out as any)?.image ?? null;
      if (!row?.id) throw new Error("Image row insert failed.");
      rows.push(row);
    } catch (error: any) {
      console.log("[marketService.insertListingImages] function fallback failed", String(error?.message || error));
      try {
        const row = await insertListingImageDirect(img, options);
        rows.push(row);
      } catch (directError: any) {
        throw errorWithPartialRows(directError?.message || "Image row insert failed.", rows);
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
  fileBody?: Blob | null;
  contentType: string;
  upsert?: boolean;
}) {
  return uploadToSupabaseStorage({
    bucket: params.bucket,
    path: params.path,
    localUri: params.uri,
    fileBody: params.fileBody ?? null,
    contentType: params.contentType,
    upsert: params.upsert ?? false,
  });
}
