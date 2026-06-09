import { bad, methodNotAllowed, ok, unauth } from "../_shared/market/http.ts";
import { supabaseAdminClient, supabaseUserClient } from "../_shared/market/supabase.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  const supabase = supabaseUserClient(req);
  const admin = supabaseAdminClient();

  const { data: u, error: ue } = await supabase.auth.getUser();
  if (ue || !u.user) return unauth();

  const body = await req.json().catch(() => ({}));
  const listing_id = String(body.listing_id ?? "");
  const storage_path = String(body.storage_path ?? "").trim();
  const sort_order = body.sort_order === undefined ? 0 : Number(body.sort_order);
  const setAsCover = body.set_as_cover === true;
  const activateListing = body.activate_listing === true;

  if (!listing_id) return bad("listing_id required");
  if (!storage_path) return bad("storage_path required");
  if (!Number.isFinite(sort_order) || sort_order < 0) return bad("sort_order must be >= 0");

  // Ensure listing belongs to this seller
  const { data: listing, error: le } = await admin
    .from("market_listings")
    .select("id,seller_id")
    .eq("id", listing_id)
    .maybeSingle();

  if (le || !listing) return bad("Listing not found");
  if (listing.seller_id !== u.user.id) return bad("Not your listing");

  const { data: img, error } = await admin
    .from("market_listing_images")
    .insert({
      listing_id,
      storage_path,
      public_url: body.public_url ? String(body.public_url) : null,
      sort_order,
      meta: body.meta ?? {},
    })
    .select("*")
    .single();

  if (error) return bad(error.message);

  // Optionally set cover_image_id if requested or if none exists.
  if (setAsCover) {
    const updates: Record<string, unknown> = {
      cover_image_id: img.id,
      updated_at: new Date().toISOString(),
    };
    if (activateListing) updates.is_active = true;
    const { error: coverErr } = await admin.from("market_listings").update(updates).eq("id", listing_id);
    if (coverErr) return bad(coverErr.message);
  } else {
    const { data: cur, error: curErr } = await admin
      .from("market_listings")
      .select("cover_image_id")
      .eq("id", listing_id)
      .single();
    if (curErr) return bad(curErr.message);

    if (!cur?.cover_image_id) {
      const updates: Record<string, unknown> = {
        cover_image_id: img.id,
        updated_at: new Date().toISOString(),
      };
      if (activateListing) updates.is_active = true;
      const { error: setErr } = await admin
        .from("market_listings")
        .update(updates)
        .eq("id", listing_id);
      if (setErr) return bad(setErr.message);
    } else if (activateListing) {
      const { error: activateErr } = await admin
        .from("market_listings")
        .update({ is_active: true, updated_at: new Date().toISOString() })
        .eq("id", listing_id);
      if (activateErr) return bad(activateErr.message);
    }
  }

  return ok({ image: img });
});
