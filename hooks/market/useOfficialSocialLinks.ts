import { useCallback, useEffect, useMemo, useState } from "react";

import { supabase } from "@/services/supabase";

export type OfficialSocialPlatform =
  | "discord"
  | "twitter"
  | "telegram"
  | "instagram"
  | "youtube"
  | "tiktok"
  | "facebook"
  | "linkedin";

export type OfficialSocialLinkRow = {
  platform: OfficialSocialPlatform;
  label: string | null;
  url: string | null;
  active: boolean;
  sort_order: number;
  updated_at: string | null;
};

const OFFICIAL_SOCIAL_PLATFORMS: OfficialSocialPlatform[] = [
  "discord",
  "twitter",
  "telegram",
  "instagram",
  "youtube",
  "tiktok",
  "facebook",
  "linkedin",
];

function isOfficialSocialPlatform(value: string): value is OfficialSocialPlatform {
  return OFFICIAL_SOCIAL_PLATFORMS.includes(value as OfficialSocialPlatform);
}

function normalizeUrl(input: string | null | undefined) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

export function useOfficialSocialLinks() {
  const [rows, setRows] = useState<OfficialSocialLinkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const { data, error } = await supabase
      .from("market_official_social_links")
      .select("platform,label,url,active,sort_order,updated_at")
      .eq("active", true)
      .order("sort_order", { ascending: true });

    if (error) {
      setError(String(error.message || error));
      setRows([]);
      setLoading(false);
      return;
    }

    const normalized: OfficialSocialLinkRow[] = [];
    for (const raw of (data ?? []) as any[]) {
      const platform = String(raw.platform || "").toLowerCase();
      if (!isOfficialSocialPlatform(platform)) continue;
      normalized.push({
        platform,
        label: raw.label == null ? null : String(raw.label),
        url: normalizeUrl(raw.url == null ? null : String(raw.url)),
        active: Boolean(raw.active),
        sort_order: Number(raw.sort_order ?? 100),
        updated_at: raw.updated_at == null ? null : String(raw.updated_at),
      });
    }

    setRows(normalized);
    setLoading(false);
  }, []);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    load().catch((e) => {
      if (!mounted) return;
      setError(String((e as any)?.message || e));
      setRows([]);
      setLoading(false);
    });

    const channel = supabase
      .channel(`market-official-socials-${Date.now()}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "market_official_social_links" },
        () => {
          load().catch(() => {});
        },
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [load]);

  const byPlatform = useMemo(() => {
    const map = new Map<OfficialSocialPlatform, OfficialSocialLinkRow>();
    rows.forEach((row) => {
      map.set(row.platform, row);
    });
    return map;
  }, [rows]);

  return { rows, byPlatform, loading, error, reload: load };
}
