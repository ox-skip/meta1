import { bad, methodNotAllowed, ok } from "../_shared/market/http.ts";
import { supabaseAdminClient } from "../_shared/market/supabase.ts";

Deno.serve(async (req) => {
  if (req.method !== "GET") return methodNotAllowed(req);

  const admin = supabaseAdminClient();
  const url = new URL(req.url);
  const listing_id = url.searchParams.get("listing_id");

  if (!listing_id) return bad("listing_id is required");

  const { data: listing, error } = await admin
    .from("market_listings")
    .select(
      `
      *,
      market_seller_profiles ( user_id, business_name, market_username, display_name, bio, phone, location_text, address, logo_path, banner_path, is_verified, active ),
      market_listing_images!market_listing_images_listing_id_fkey ( id, storage_path, public_url, sort_order, created_at )
    `,
    )
    .eq("id", listing_id)
    .maybeSingle();

  if (error) return bad(error.message);
  if (!listing || !listing.is_active) return bad("Listing not found");

  // sort images client-side for consistency
  const images = (listing.market_listing_images ?? []).slice().sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  return ok({ listing: { ...listing, images } });
});
