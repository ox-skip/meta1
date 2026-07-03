import { methodNotAllowed, ok } from "../_shared/market/http.ts";
import { supabaseAdminClient } from "../_shared/market/supabase.ts";

const LANDING_BUCKET = "market-landing";

function publicUrl(admin: any, storagePath?: string | null) {
  const path = String(storagePath ?? "").trim();
  if (!path) return null;
  const { data } = admin.storage.from(LANDING_BUCKET).getPublicUrl(path);
  return data?.publicUrl ?? null;
}

function withHydratedUrl(admin: any, row: any, urlKey: string, storageKey: string) {
  if (!row) return row;
  const current = String(row[urlKey] ?? "").trim();
  if (current) return row;
  const resolved = publicUrl(admin, row[storageKey]);
  return resolved ? { ...row, [urlKey]: resolved } : row;
}

async function listActive(admin: any, table: string, limit = 120) {
  const { data, error } = await admin
    .from(table)
    .select("*")
    .eq("active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return methodNotAllowed(req);
  if (req.method !== "GET" && req.method !== "POST") return methodNotAllowed(req);

  try {
    const admin = supabaseAdminClient();

    const [
      statsRes,
      configRes,
      sections,
      features,
      roadmap,
      teamMembers,
      faqs,
      demos,
    ] = await Promise.all([
      admin.rpc("market_public_platform_stats"),
      admin.from("market_landing_config").select("*").eq("id", true).maybeSingle(),
      listActive(admin, "market_landing_sections"),
      listActive(admin, "market_landing_features"),
      listActive(admin, "market_landing_roadmap"),
      listActive(admin, "market_landing_team_members"),
      listActive(admin, "market_landing_faqs", 160),
      listActive(admin, "market_landing_demo_videos"),
    ]);

    if (statsRes.error) throw statsRes.error;
    if (configRes.error) throw configRes.error;

    const config = withHydratedUrl(admin, configRes.data, "hero_media_url", "hero_media_storage_path");
    const hydratedSections = sections.map((row: any) => withHydratedUrl(admin, row, "media_url", "media_storage_path"));
    const hydratedTeam = teamMembers.map((row: any) => withHydratedUrl(admin, row, "image_url", "image_storage_path"));
    const hydratedDemos = demos.map((row: any) => {
      const withVideo = withHydratedUrl(admin, row, "video_url", "video_storage_path");
      return withHydratedUrl(admin, withVideo, "thumbnail_url", "thumbnail_storage_path");
    });

    return ok({
      ok: true,
      generated_at: new Date().toISOString(),
      stats: statsRes.data ?? {},
      content: {
        config,
        sections: hydratedSections,
        features,
        roadmap,
        team_members: hydratedTeam,
        faqs,
        demo_videos: hydratedDemos,
      },
    });
  } catch (e) {
    return ok({
      ok: false,
      generated_at: new Date().toISOString(),
      error: String((e as any)?.message || e || "Could not load public landing content."),
      stats: {},
      content: {
        config: null,
        sections: [],
        features: [],
        roadmap: [],
        team_members: [],
        faqs: [],
        demo_videos: [],
      },
    });
  }
});
