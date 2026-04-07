import { formatCountryLabel, normalizeCountryCode, normalizeCountryName } from "@/utils/countryNames";

export type ListingOriginCountry = {
  code: string;
  name: string;
  flag: string;
  label: string;
  compactLabel: string;
};

function parseMaybeJsonObject<T extends Record<string, unknown>>(value: unknown): T | null {
  if (!value) return null;
  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? (parsed as T) : null;
    } catch {
      return null;
    }
  }
  return typeof value === "object" ? (value as T) : null;
}

export function flagEmojiFromCountryCode(code?: string | null) {
  const cc = normalizeCountryCode(code);
  if (!/^[A-Z]{2}$/.test(cc)) return "";
  const first = cc.codePointAt(0);
  const second = cc.codePointAt(1);
  if (!first || !second) return "";
  return String.fromCodePoint(127397 + first, 127397 + second);
}

export function resolveListingOriginCountry(
  availabilityInput: unknown,
  paymentOptionsInput?: unknown,
): ListingOriginCountry | null {
  const availability =
    parseMaybeJsonObject<any>(availabilityInput) ??
    parseMaybeJsonObject<any>(paymentOptionsInput)?.availability ??
    null;

  const availabilityCountry = availability?.country ?? availability?.geo ?? {};
  const code = normalizeCountryCode(
    availabilityCountry?.code ||
      availabilityCountry?.countryCode ||
      availabilityCountry?.country_code ||
      availability?.countryCode ||
      availability?.country_code,
  );
  const name = normalizeCountryName(
    availabilityCountry?.name ||
      availabilityCountry?.country ||
      availability?.country ||
      availability?.country_name,
    code,
  );

  if (!code && !name) return null;

  return {
    code,
    name,
    flag: flagEmojiFromCountryCode(code),
    label: formatCountryLabel(name, code),
    compactLabel: name || code,
  };
}
