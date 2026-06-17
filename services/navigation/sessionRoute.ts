import * as SecureStore from "@/utils/secureStore";

const KEY_PREFIX = "bc_last_session_route_v1";
const MAX_ROUTE_AGE_MS = 1000 * 60 * 60 * 24 * 30;

type SavedRoute = {
  href: string;
  savedAt: number;
};

function keyForUser(userId: string) {
  return `${KEY_PREFIX}:${userId}`;
}

function cleanPath(pathname?: string | null) {
  const path = String(pathname || "").trim();
  if (!path || path === "/") return "";
  return path;
}

function segmentValue(segments: readonly string[], index: number) {
  return String(segments[index] || "").trim();
}

function isPathValue(pathname: string, value: string) {
  const normalizedValue = decodeURIComponent(String(value || "")).trim();
  if (!normalizedValue) return false;

  return pathname
    .split("/")
    .map((part) => decodeURIComponent(part))
    .some((part) => part === normalizedValue);
}

function encodeParams(pathname: string, params: Record<string, unknown>) {
  const parts: string[] = [];

  Object.keys(params)
    .sort()
    .forEach((key) => {
      const value = params[key];
      const values = Array.isArray(value) ? value : [value];

      values.forEach((item) => {
        if (item === null || item === undefined) return;

        const text = String(item).trim();
        if (!text || isPathValue(pathname, text)) return;

        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(text)}`);
      });
    });

  return parts.join("&");
}

export function isPersistableSessionRoute(segments: readonly string[], pathname?: string | null) {
  const path = cleanPath(pathname);
  if (!path) return false;

  const group = segmentValue(segments, 0);
  if (!group) return false;
  if (group === "(auth)" || group === "(onboarding)" || group === "pi") return false;
  if (path.includes("/reset") || path.includes("/login") || path.includes("/register")) return false;
  if (path.includes("/wallet-setup")) return false;

  return true;
}

export function isSessionRestoreEntryPoint(segments: readonly string[], pathname?: string | null) {
  const path = cleanPath(pathname);
  const group = segmentValue(segments, 0);
  const route = segmentValue(segments, 1);

  if (!path || !group) return true;
  if (group === "(auth)" || group === "(onboarding)") return true;
  if (group === "market" && route === "(tabs)" && segments.length <= 2) return true;
  if (path === "/market" || path === "/market/") return true;

  return false;
}

export function buildSessionRouteHref(
  pathname: string | null | undefined,
  params: Record<string, unknown>,
  segments: readonly string[],
) {
  const path = cleanPath(pathname);
  if (!isPersistableSessionRoute(segments, path)) return null;

  const query = encodeParams(path, params);
  return query ? `${path}?${query}` : path;
}

export async function loadLastSessionRoute(userId?: string | null) {
  const id = String(userId || "").trim();
  if (!id) return null;

  try {
    const raw = await SecureStore.getItemAsync(keyForUser(id));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as SavedRoute;
    const href = cleanPath(parsed?.href);
    const savedAt = Number(parsed?.savedAt);

    if (!href || !Number.isFinite(savedAt)) return null;
    if (Date.now() - savedAt > MAX_ROUTE_AGE_MS) return null;

    return href;
  } catch {
    return null;
  }
}

export async function saveLastSessionRoute(userId: string, href: string) {
  const id = String(userId || "").trim();
  const path = cleanPath(href);
  if (!id || !path) return;

  const payload: SavedRoute = {
    href: path,
    savedAt: Date.now(),
  };

  await SecureStore.setItemAsync(keyForUser(id), JSON.stringify(payload));
}
