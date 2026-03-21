import * as SecureStore from "@/utils/secureStore";
import { supabase } from "@/services/supabase";
import { availabilityMatchesGeo, getCurrentLocationWithGeocode, pickLocationCity, pickLocationRegion } from "@/utils/location";
import { normalizeCountryCode, normalizeCountryName } from "@/utils/countryNames";

const KEY_COUNTRY_CODE = "bc_user_country_code_v1";
const KEY_COUNTRY_NAME = "bc_user_country_name_v1";
const KEY_COUNTRY_REGION = "bc_user_country_region_v1";
const KEY_COUNTRY_CITY = "bc_user_country_city_v1";
const KEY_COUNTRY_SUBREGION = "bc_user_country_subregion_v1";
const KEY_COUNTRY_DISTRICT = "bc_user_country_district_v1";
const KEY_COUNTRY_TOWN = "bc_user_country_town_v1";
const KEY_COUNTRY_LOCALITY = "bc_user_country_locality_v1";
const KEY_COUNTRY_CONTINENT = "bc_user_country_continent_v1";
const KEY_COUNTRY_LAT = "bc_user_country_lat_v1";
const KEY_COUNTRY_LNG = "bc_user_country_lng_v1";

type CountryResolveResponse = Array<{ region?: string; subregion?: string }>;

export type UserCountry = {
  code: string;
  name: string;
  region?: string;
  city?: string;
  subregion?: string;
  district?: string;
  town?: string;
  locality?: string;
  continent?: string;
  lat?: number;
  lng?: number;
} | null;

const continentByCodeCache = new Map<string, string>();

function norm(val?: string | null) {
  return String(val || "").trim();
}

function toNum(val?: string | null) {
  const n = Number(val);
  return Number.isFinite(n) ? n : NaN;
}

function inferCountryCode(rawCode?: string | null, rawName?: string | null) {
  const code = normalizeCountryCode(rawCode);
  if (code) return code;
  const maybe = norm(rawName);
  if (/^[A-Za-z]{2,3}$/.test(maybe)) return normalizeCountryCode(maybe);
  return "";
}

export function isNigeriaCountry(codeOrName?: string | null) {
  const v = norm(codeOrName).toLowerCase();
  return v === "ng" || v === "nigeria";
}

async function resolveContinentByCountryCode(code?: string | null) {
  const cc = norm(code).toUpperCase();
  if (!cc) return "";
  if (continentByCodeCache.has(cc)) return continentByCodeCache.get(cc) || "";

  try {
    const res = await fetch(`https://restcountries.com/v3.1/alpha/${cc}?fields=region,subregion`);
    if (!res.ok) throw new Error("country-region lookup failed");
    const rows = (await res.json()) as CountryResolveResponse;
    const region = norm(rows?.[0]?.region).toLowerCase();
    const subregion = norm(rows?.[0]?.subregion).toLowerCase();
    let continent = norm(rows?.[0]?.region);

    if (region === "americas") {
      if (subregion.includes("south")) continent = "South America";
      else if (subregion.includes("north") || subregion.includes("central") || subregion.includes("caribbean")) {
        continent = "North America";
      } else {
        continent = "Americas";
      }
    }

    continentByCodeCache.set(cc, continent);
    return continent;
  } catch {
    return "";
  }
}

async function withContinent(country: UserCountry): Promise<UserCountry> {
  if (!country) return null;
  const code = norm(country.code);
  const hasContinent = norm(country.continent);
  if (hasContinent || !code) return country;

  const continent = await resolveContinentByCountryCode(code);
  if (!continent) return country;

  const out = { ...country, continent };
  await setCachedCountry(out.code, out.name, out);
  return out;
}

async function resolveCountryFromProfile(): Promise<UserCountry> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const user = auth?.user;
    if (!user) return null;

    const { data: profile } = await supabase
      .from("market_seller_profiles")
      .select("address")
      .eq("user_id", user.id)
      .maybeSingle();

    const addr = (profile as any)?.address ?? {};
    const code = inferCountryCode(addr?.countryCode, addr?.country);
    const name = normalizeCountryName(addr?.country, code);
    const region = norm(pickLocationRegion(addr));
    const city = norm(pickLocationCity(addr));
    const subregion = norm(addr?.subregion);
    const district = norm(addr?.district);
    const town = norm(addr?.town);
    const locality = norm(addr?.locality);

    if (!code && !name) return null;

    const continent = await resolveContinentByCountryCode(code);
    return { code, name, region, city, subregion, district, town, locality, continent };
  } catch {
    return null;
  }
}

async function resolveCountryFromLocation(opts?: { ipOnly?: boolean }): Promise<UserCountry> {
  try {
    const loc = await getCurrentLocationWithGeocode({
      preferIpOnWeb: true,
      preferIp: true,
      ipOnly: Boolean(opts?.ipOnly),
    });
    const code = inferCountryCode(loc?.geo?.countryCode, loc?.geo?.country);
    const name = normalizeCountryName(loc?.geo?.country, code);
    const region = norm(pickLocationRegion(loc?.geo));
    const city = norm(pickLocationCity(loc?.geo));
    const subregion = norm((loc?.geo as any)?.subregion);
    const district = norm((loc?.geo as any)?.district);
    const town = norm((loc?.geo as any)?.town);
    const locality = norm((loc?.geo as any)?.locality);
    const lat = Number(loc?.coords?.lat);
    const lng = Number(loc?.coords?.lng);

    if (!code && !name) return null;

    const continent = await resolveContinentByCountryCode(code);
    return {
      code,
      name,
      region,
      city,
      subregion,
      district,
      town,
      locality,
      continent,
      lat: Number.isFinite(lat) ? lat : undefined,
      lng: Number.isFinite(lng) ? lng : undefined,
    };
  } catch {
    return null;
  }
}

export async function getCachedCountry(): Promise<UserCountry> {
  const code = normalizeCountryCode(await SecureStore.getItemAsync(KEY_COUNTRY_CODE));
  const nameRaw = norm(await SecureStore.getItemAsync(KEY_COUNTRY_NAME));
  const name = normalizeCountryName(nameRaw, code);
  const region = norm(await SecureStore.getItemAsync(KEY_COUNTRY_REGION));
  const city = norm(await SecureStore.getItemAsync(KEY_COUNTRY_CITY));
  const subregion = norm(await SecureStore.getItemAsync(KEY_COUNTRY_SUBREGION));
  const district = norm(await SecureStore.getItemAsync(KEY_COUNTRY_DISTRICT));
  const town = norm(await SecureStore.getItemAsync(KEY_COUNTRY_TOWN));
  const locality = norm(await SecureStore.getItemAsync(KEY_COUNTRY_LOCALITY));
  const continent = norm(await SecureStore.getItemAsync(KEY_COUNTRY_CONTINENT));
  const lat = toNum(await SecureStore.getItemAsync(KEY_COUNTRY_LAT));
  const lng = toNum(await SecureStore.getItemAsync(KEY_COUNTRY_LNG));

  if (code || name) {
    return {
      code,
      name,
      region,
      city,
      subregion,
      district,
      town,
      locality,
      continent,
      lat: Number.isFinite(lat) ? lat : undefined,
      lng: Number.isFinite(lng) ? lng : undefined,
    };
  }
  return null;
}

export async function setCachedCountry(
  code?: string | null,
  name?: string | null,
  extras?: Partial<NonNullable<UserCountry>>
) {
  const c = normalizeCountryCode(code);
  const n = normalizeCountryName(name, c);
  const region = norm(extras?.region);
  const city = norm(extras?.city);
  const subregion = norm(extras?.subregion);
  const district = norm(extras?.district);
  const town = norm(extras?.town);
  const locality = norm(extras?.locality);
  const continent = norm(extras?.continent);
  const lat = Number(extras?.lat);
  const lng = Number(extras?.lng);
  const hasExtras = extras !== undefined;

  if (c) await SecureStore.setItemAsync(KEY_COUNTRY_CODE, c);
  if (n) await SecureStore.setItemAsync(KEY_COUNTRY_NAME, n);
  if (hasExtras) {
    if (region) await SecureStore.setItemAsync(KEY_COUNTRY_REGION, region);
    else await SecureStore.deleteItemAsync(KEY_COUNTRY_REGION);

    if (city) await SecureStore.setItemAsync(KEY_COUNTRY_CITY, city);
    else await SecureStore.deleteItemAsync(KEY_COUNTRY_CITY);

    if (subregion) await SecureStore.setItemAsync(KEY_COUNTRY_SUBREGION, subregion);
    else await SecureStore.deleteItemAsync(KEY_COUNTRY_SUBREGION);

    if (district) await SecureStore.setItemAsync(KEY_COUNTRY_DISTRICT, district);
    else await SecureStore.deleteItemAsync(KEY_COUNTRY_DISTRICT);

    if (town) await SecureStore.setItemAsync(KEY_COUNTRY_TOWN, town);
    else await SecureStore.deleteItemAsync(KEY_COUNTRY_TOWN);

    if (locality) await SecureStore.setItemAsync(KEY_COUNTRY_LOCALITY, locality);
    else await SecureStore.deleteItemAsync(KEY_COUNTRY_LOCALITY);

    if (continent) await SecureStore.setItemAsync(KEY_COUNTRY_CONTINENT, continent);
    else await SecureStore.deleteItemAsync(KEY_COUNTRY_CONTINENT);

    if (Number.isFinite(lat)) await SecureStore.setItemAsync(KEY_COUNTRY_LAT, String(lat));
    else await SecureStore.deleteItemAsync(KEY_COUNTRY_LAT);

    if (Number.isFinite(lng)) await SecureStore.setItemAsync(KEY_COUNTRY_LNG, String(lng));
    else await SecureStore.deleteItemAsync(KEY_COUNTRY_LNG);
  }
  if (!c && !n) {
    await SecureStore.deleteItemAsync(KEY_COUNTRY_CODE);
    await SecureStore.deleteItemAsync(KEY_COUNTRY_NAME);
    await SecureStore.deleteItemAsync(KEY_COUNTRY_REGION);
    await SecureStore.deleteItemAsync(KEY_COUNTRY_CITY);
    await SecureStore.deleteItemAsync(KEY_COUNTRY_SUBREGION);
    await SecureStore.deleteItemAsync(KEY_COUNTRY_DISTRICT);
    await SecureStore.deleteItemAsync(KEY_COUNTRY_TOWN);
    await SecureStore.deleteItemAsync(KEY_COUNTRY_LOCALITY);
    await SecureStore.deleteItemAsync(KEY_COUNTRY_CONTINENT);
    await SecureStore.deleteItemAsync(KEY_COUNTRY_LAT);
    await SecureStore.deleteItemAsync(KEY_COUNTRY_LNG);
  }
}

export async function resolveUserCountry(opts?: { prompt?: boolean; refresh?: boolean; ipOnly?: boolean }) {
  const cached = await getCachedCountry();
  const shouldRefresh = Boolean(opts?.prompt || opts?.refresh);
  // Only enforce strict live-IP behavior for VPN-sensitive flows.
  const preferLiveLocation = Boolean(opts?.ipOnly);
  const strictIp = Boolean(opts?.ipOnly);

  if (!shouldRefresh && cached) {
    return await withContinent(cached);
  }

  if (shouldRefresh) {
    const fromLocation = await resolveCountryFromLocation({ ipOnly: strictIp });
    if (fromLocation) {
      await setCachedCountry(fromLocation.code, fromLocation.name, fromLocation);
      return fromLocation;
    }

    // If strict live lookup is requested (e.g. VPN test), avoid overriding with profile/cached country.
    if (preferLiveLocation) {
      return null;
    }

    const fromProfile = await resolveCountryFromProfile();
    if (fromProfile) {
      await setCachedCountry(fromProfile.code, fromProfile.name, fromProfile);
      return fromProfile;
    }

    if (cached) {
      return await withContinent(cached);
    }

    return null;
  }

  const fromProfile = await resolveCountryFromProfile();
  if (fromProfile) {
    await setCachedCountry(fromProfile.code, fromProfile.name, fromProfile);
    return fromProfile;
  }

  return null;
}

export function listingMatchesCountry(availability: any, country: UserCountry | null, includeGlobal = true) {
  return availabilityMatchesGeo(
    availability,
    country
      ? {
          country: country.name,
          countryCode: country.code,
          region: country.region,
          city: country.city,
          subregion: country.subregion,
          district: country.district,
          town: country.town,
          locality: country.locality,
          continent: country.continent,
          lat: country.lat,
          lng: country.lng,
        }
      : null,
    includeGlobal,
  );
}

