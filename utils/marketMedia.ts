export type MarketMediaKind = "image" | "video";

type MediaLike = {
  public_url?: string | null;
  storage_path?: string | null;
  meta?: any;
  mime_type?: string | null;
};

const VIDEO_EXTENSIONS = new Set([
  "3gp",
  "avi",
  "m4v",
  "mkv",
  "mov",
  "mp4",
  "mpeg",
  "mpg",
  "webm",
]);

export function inferMarketMediaKind(input?: string | null): MarketMediaKind {
  const raw = String(input || "").trim().toLowerCase();
  if (!raw) return "image";
  if (raw.startsWith("video/")) return "video";
  if (raw.startsWith("image/")) return "image";

  const clean = raw.split("#")[0]?.split("?")[0] ?? raw;
  const ext = clean.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? "";
  return VIDEO_EXTENSIONS.has(ext) ? "video" : "image";
}

export function resolveMarketMediaKind(media?: MediaLike | null): MarketMediaKind {
  const metaType = String(
    media?.meta?.content_type || media?.meta?.mime_type || media?.mime_type || "",
  ).trim();
  if (metaType) return inferMarketMediaKind(metaType);
  return inferMarketMediaKind(String(media?.public_url || media?.storage_path || ""));
}

export function buildMarketMediaUrl(
  media: Pick<MediaLike, "public_url" | "storage_path"> | null | undefined,
  supabaseUrl: string,
  bucket: string,
) {
  if (!media) return null;
  if (media.public_url) return media.public_url;

  const storagePath = String(media.storage_path || "").trim();
  if (!storagePath || !supabaseUrl) return null;
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${storagePath}`;
}

export function sortMarketMedia<T extends { sort_order?: number | null }>(items: T[] | null | undefined): T[] {
  if (!items?.length) return [];
  return [...items].sort((a, b) => Number(a?.sort_order ?? 0) - Number(b?.sort_order ?? 0));
}

export function resolveMarketMediaSource<T extends MediaLike>(
  candidates: Array<T | null | undefined>,
  supabaseUrl: string,
  bucket: string,
): { media: T; url: string; kind: MarketMediaKind } | null {
  for (const media of candidates) {
    if (!media) continue;
    const url = buildMarketMediaUrl(media, supabaseUrl, bucket);
    if (!url) continue;
    return {
      media,
      url,
      kind: resolveMarketMediaKind(media),
    };
  }
  return null;
}
