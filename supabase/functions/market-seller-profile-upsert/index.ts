import { bad, methodNotAllowed, ok, unauth } from "../_shared/market/http.ts";
import { supabaseAdminClient, supabaseUserClient } from "../_shared/market/supabase.ts";

function hasOwn(payload: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(payload, key);
}

function toTrimmedText(value: unknown) {
  const text = String(value ?? "").trim();
  return text.length ? text : null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(req);

  const supabase = supabaseUserClient(req);
  const admin = supabaseAdminClient();

  const { data: u, error: ue } = await supabase.auth.getUser();
  if (ue || !u.user) return unauth();

  const payload = await req.json().catch(() => ({})) as Record<string, unknown>;

  const { data: existing, error: existingError } = await admin
    .from("market_seller_profiles")
    .select("user_id")
    .eq("user_id", u.user.id)
    .maybeSingle();

  if (existingError) return bad(existingError.message);

  const row: Record<string, unknown> = {
    user_id: u.user.id,
    updated_at: new Date().toISOString(),
  };

  if (hasOwn(payload, "business_name")) {
    const businessName = String(payload.business_name ?? "").trim();
    if (!businessName) return bad("business_name is required");
    row.business_name = businessName;
  } else if (!existing?.user_id) {
    return bad("business_name is required");
  }

  if (hasOwn(payload, "market_username")) row.market_username = toTrimmedText(payload.market_username);
  if (hasOwn(payload, "display_name")) row.display_name = toTrimmedText(payload.display_name);
  if (hasOwn(payload, "bio")) row.bio = toTrimmedText(payload.bio);
  if (hasOwn(payload, "phone")) row.phone = toTrimmedText(payload.phone);
  if (hasOwn(payload, "location_text")) row.location_text = toTrimmedText(payload.location_text);
  if (hasOwn(payload, "address")) row.address = payload.address ?? {};
  if (hasOwn(payload, "logo_path")) row.logo_path = toTrimmedText(payload.logo_path);
  if (hasOwn(payload, "banner_path")) row.banner_path = toTrimmedText(payload.banner_path);
  if (hasOwn(payload, "offers_remote")) row.offers_remote = !!payload.offers_remote;
  if (hasOwn(payload, "offers_in_person")) row.offers_in_person = !!payload.offers_in_person;
  if (hasOwn(payload, "active")) row.active = !!payload.active;
  if (hasOwn(payload, "social_links")) row.social_links = payload.social_links ?? {};

  let { data, error } = await admin
    .from("market_seller_profiles")
    .upsert(row, { onConflict: "user_id" })
    .select("*")
    .single();

  const message = String(error?.message ?? "");
  if (error && hasOwn(row, "social_links") && /social_links/i.test(message) && /(column|schema cache)/i.test(message)) {
    delete row.social_links;
    ({ data, error } = await admin
      .from("market_seller_profiles")
      .upsert(row, { onConflict: "user_id" })
      .select("*")
      .single());
  }

  if (error) return bad(error.message);
  return ok({ seller_profile: data });
});
