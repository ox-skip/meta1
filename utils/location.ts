import * as Location from "expo-location";
import { Platform } from "react-native";
import { countryNameFromCode, normalizeCountryCode, normalizeCountryName } from "@/utils/countryNames";

export type LocationCoords = { lat: number; lng: number };
export type LocationGeo = {
  country: string;
  region: string;
  city: string;
  postalCode: string;
  countryCode: string;
  subregion?: string;
  district?: string;
  town?: string;
  locality?: string;
};

export type AvailabilityJson = {
  scope: "global" | "continent" | "country" | "state" | "city" | "radius";
  continents: string[];
  country: { name: string; code: string };
  state: string;
  city: string;
  radiusKm: number;
  center: { lat: number; lng: number; label: string };
  note: string;
};

export type DeliveryGeo = {
  lat: number;
  lng: number;
  city: string;
  region: string;
  country: string;
  countryCode: string;
  label: string;
  continent?: string;
};

export type ProfileLocationAddress = {
  label: string;
  city: string;
  region: string;
  country: string;
  countryCode: string;
  postalCode: string;
  subregion: string;
  district: string;
  town: string;
  locality: string;
  lat: number;
  lng: number;
};

type GeocodeOptions = {
  preferIpOnWeb?: boolean;
  preferIp?: boolean;
  ipOnly?: boolean;
};

type IpLookupResult = {
  coords: LocationCoords;
  geo: LocationGeo;
  label: string;
};

type IpApiCoPayload = {
  country_name?: string;
  country_code?: string;
  region?: string;
  region_code?: string;
  city?: string;
  postal?: string;
  latitude?: number | string;
  longitude?: number | string;
};

type IpWhoPayload = {
  success?: boolean;
  country?: string;
  country_code?: string;
  region?: string;
  region_code?: string;
  city?: string;
  postal?: string;
  latitude?: number | string;
  longitude?: number | string;
};

type IpInfoPayload = {
  country?: string;
  region?: string;
  region_code?: string;
  city?: string;
  postal?: string;
  loc?: string;
};

type CountryIsPayload = {
  country?: string;
};

function buildLabel(parts: Array<string | null | undefined>) {
  return parts.map((p) => String(p || "").trim()).filter(Boolean).join(", ");
}

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function fallbackLabel(coords: LocationCoords) {
  if (!Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) {
    return "Location unavailable";
  }
  return `Lat ${coords.lat.toFixed(5)}, Lng ${coords.lng.toFixed(5)}`;
}

function toNum(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

export function pickLocationRegion(input: Partial<LocationGeo> | DeliveryGeo | null | undefined) {
  return cleanText((input as any)?.region || (input as any)?.subregion || (input as any)?.district || (input as any)?.state);
}

export function pickLocationCity(input: Partial<LocationGeo> | DeliveryGeo | null | undefined) {
  return cleanText(
    (input as any)?.city || (input as any)?.town || (input as any)?.locality || (input as any)?.district || (input as any)?.subregion
  );
}

export function toDeliveryGeo(input: {
  coords: Partial<LocationCoords> | null | undefined;
  geo: Partial<LocationGeo> | DeliveryGeo | null | undefined;
  label?: string | null;
  continent?: string | null;
}): DeliveryGeo {
  const lat = Number((input.coords as any)?.lat);
  const lng = Number((input.coords as any)?.lng);
  const rawCountryCode = cleanText((input.geo as any)?.countryCode || (input.geo as any)?.country_code);
  const countryCode = normalizeCountryCode(rawCountryCode);
  const country = normalizeCountryName((input.geo as any)?.country, countryCode) || cleanText((input.geo as any)?.country);
  return {
    lat: Number.isFinite(lat) ? lat : Number.NaN,
    lng: Number.isFinite(lng) ? lng : Number.NaN,
    city: pickLocationCity(input.geo),
    region: pickLocationRegion(input.geo),
    country,
    countryCode,
    label: cleanText(input.label) || fallbackLabel({ lat, lng }),
    continent: cleanText(input.continent) || undefined,
  };
}

export function toProfileLocationAddress(input: {
  coords: Partial<LocationCoords> | null | undefined;
  geo: Partial<LocationGeo> | DeliveryGeo | null | undefined;
  label?: string | null;
}): ProfileLocationAddress {
  const lat = Number((input.coords as any)?.lat);
  const lng = Number((input.coords as any)?.lng);
  const rawCountryCode = cleanText((input.geo as any)?.countryCode || (input.geo as any)?.country_code);
  const countryCode = normalizeCountryCode(rawCountryCode);
  return {
    label: cleanText(input.label) || fallbackLabel({ lat, lng }),
    city: pickLocationCity(input.geo),
    region: pickLocationRegion(input.geo),
    country: normalizeCountryName((input.geo as any)?.country, countryCode) || cleanText((input.geo as any)?.country),
    countryCode,
    postalCode: cleanText((input.geo as any)?.postalCode || (input.geo as any)?.postal_code),
    subregion: cleanText((input.geo as any)?.subregion),
    district: cleanText((input.geo as any)?.district),
    town: cleanText((input.geo as any)?.town),
    locality: cleanText((input.geo as any)?.locality),
    lat: Number.isFinite(lat) ? lat : Number.NaN,
    lng: Number.isFinite(lng) ? lng : Number.NaN,
  };
}

export function syncManualLocationTextAddress(current: unknown, nextLabel?: string | null) {
  const trimmed = cleanText(nextLabel);
  if (!trimmed) return {};

  const prev = current && typeof current === "object" ? ({ ...(current as Record<string, unknown>) } as Record<string, unknown>) : {};
  const prevLabel = cleanText(prev.label);
  const hasStructuredLocation = Boolean(
    pickLocationCity(prev as any) ||
      pickLocationRegion(prev as any) ||
      cleanText(prev.country) ||
      cleanText(prev.countryCode) ||
      cleanText(prev.postalCode) ||
      Number.isFinite(Number(prev.lat)) ||
      Number.isFinite(Number(prev.lng))
  );

  if (!hasStructuredLocation || !prevLabel || prevLabel === trimmed) {
    return { ...prev, label: trimmed };
  }

  return { label: trimmed };
}

function parseIpInfoLoc(loc?: string) {
  const raw = String(loc || "").trim();
  if (!raw.includes(",")) return { lat: NaN, lng: NaN };
  const [a, b] = raw.split(",");
  return { lat: toNum(a), lng: toNum(b) };
}

function withNoCache(url: string) {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}_=${Date.now()}`;
}

function ipLookupToResult(input: {
  country?: string;
  countryCode?: string;
  region?: string;
  city?: string;
  postalCode?: string;
  subregion?: string;
  district?: string;
  town?: string;
  locality?: string;
  lat?: number;
  lng?: number;
}) {
  const directCode = normalizeCountryCode(input.countryCode);
  const inferredCode = !directCode && /^[A-Za-z]{2,3}$/.test(String(input.country || ""))
    ? normalizeCountryCode(input.country)
    : "";
  const countryCode = directCode || inferredCode;
  const countryName = normalizeCountryName(input.country, countryCode);

  const coords = {
    lat: Number.isFinite(input.lat) ? Number(input.lat) : NaN,
    lng: Number.isFinite(input.lng) ? Number(input.lng) : NaN,
  };

  const geo: LocationGeo = {
    country: String(countryName || ""),
    countryCode,
    region: String(input.region || ""),
    city: String(input.city || ""),
    postalCode: String(input.postalCode || ""),
    subregion: String(input.subregion || ""),
    district: String(input.district || ""),
    town: String(input.town || ""),
    locality: String(input.locality || ""),
  };

  const label =
    buildLabel([geo.city || geo.town || geo.locality, geo.region || geo.subregion || geo.district, geo.country]) ||
    fallbackLabel(coords);
  return { coords, geo, label };
}

async function fetchIpLocation(): Promise<IpLookupResult | null> {
  try {
    const res = await fetch(withNoCache("https://ipapi.co/json/"), {
      headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
    });
    if (res.ok) {
      const payload = (await res.json()) as IpApiCoPayload;
      const out = ipLookupToResult({
        country: payload.country_name,
        countryCode: payload.country_code,
        region: payload.region,
        city: payload.city,
        postalCode: payload.postal,
        lat: toNum(payload.latitude),
        lng: toNum(payload.longitude),
      });
      if (out.geo.countryCode || out.geo.country) return out;
    }
  } catch {
    // ignore and continue
  }

  try {
    const res = await fetch(withNoCache("https://ipwho.is/"), {
      headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
    });
    if (res.ok) {
      const payload = (await res.json()) as IpWhoPayload;
      if (payload?.success !== false) {
        const out = ipLookupToResult({
          country: payload.country,
          countryCode: payload.country_code,
          region: payload.region,
          city: payload.city,
          postalCode: payload.postal,
          lat: toNum(payload.latitude),
          lng: toNum(payload.longitude),
        });
        if (out.geo.countryCode || out.geo.country) return out;
      }
    }
  } catch {
    // ignore and continue
  }

  try {
    const res = await fetch(withNoCache("https://ipinfo.io/json"), {
      headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
    });
    if (res.ok) {
      const payload = (await res.json()) as IpInfoPayload;
      const loc = parseIpInfoLoc(payload.loc);
      const out = ipLookupToResult({
        countryCode: normalizeCountryCode(payload.country),
        country: countryNameFromCode(payload.country),
        region: payload.region,
        city: payload.city,
        postalCode: payload.postal,
        lat: loc.lat,
        lng: loc.lng,
      });
      if (out.geo.countryCode || out.geo.country) return out;
    }
  } catch {
    // ignore
  }

  // Minimal country fallback with broad availability.
  try {
    const res = await fetch(withNoCache("https://api.country.is/"), {
      headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
    });
    if (res.ok) {
      const payload = (await res.json()) as CountryIsPayload;
      const out = ipLookupToResult({
        countryCode: normalizeCountryCode(payload.country),
        country: countryNameFromCode(payload.country),
      });
      if (out.geo.countryCode) return out;
    }
  } catch {
    // ignore
  }

  return null;
}

export async function getCurrentLocationWithGeocode(opts?: GeocodeOptions) {
  const preferIpFirst = Boolean(opts?.preferIp) || (Platform.OS === "web" && Boolean(opts?.preferIpOnWeb));
  const ipOnly = Boolean(opts?.ipOnly);
  if (preferIpFirst) {
    const ipFirst = await fetchIpLocation();
    if (ipFirst) return ipFirst;
    if (ipOnly) {
      throw new Error("IP location lookup failed.");
    }
  }

  if (ipOnly) {
    throw new Error("IP location lookup failed.");
  }

  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) {
      throw new Error("Location permission denied.");
    }

    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    const coords: LocationCoords = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
    };

    let geo: LocationGeo = {
      country: "",
      region: "",
      city: "",
      postalCode: "",
      countryCode: "",
      subregion: "",
      district: "",
      town: "",
      locality: "",
    };

    let label = fallbackLabel(coords);

    try {
      const res = await Location.reverseGeocodeAsync({
        latitude: coords.lat,
        longitude: coords.lng,
      });

      const first = res?.[0];
      if (first) {
        const countryCode = normalizeCountryCode(first.isoCountryCode ?? "");
        const countryName = normalizeCountryName(first.country ?? "", countryCode);
        const city = first.city ?? first.subregion ?? first.district ?? first.name ?? "";
        const subregion = first.subregion ?? "";
        const district = first.district ?? "";
        const town = first.city ?? first.name ?? "";
        const locality = first.name ?? first.street ?? "";

        geo = {
          country: countryName,
          region: first.region ?? "",
          city,
          postalCode: first.postalCode ?? "",
          countryCode,
          subregion,
          district,
          town,
          locality,
        };

        const line1 = buildLabel([first.name, first.street]);
        const line2 = buildLabel([geo.city || geo.town, geo.region || geo.subregion || geo.district]);
        const line3 = buildLabel([geo.country]);
        label = buildLabel([line1, line2, line3]) || fallbackLabel(coords);
      }
    } catch {
      // Keep best-effort coords and label
    }

    if (!geo.countryCode && !geo.country) {
      const ipFallback = await fetchIpLocation();
      if (ipFallback) return ipFallback;
    }

    return { coords, geo, label };
  } catch (error: any) {
    const ipFallback = await fetchIpLocation();
    if (ipFallback) return ipFallback;
    throw error;
  }
}

export function formatAvailabilitySummary(availability: AvailabilityJson | null | undefined) {
  if (!availability || !availability.scope) return "Worldwide";

  const note = availability.note ? ` - ${availability.note}` : "";

  switch (availability.scope) {
    case "global":
      return `Worldwide${note}`;
    case "continent": {
      const list = (availability.continents || []).filter(Boolean).join(", ");
      return list ? `Continents: ${list}${note}` : `Continents only${note}`;
    }
    case "country": {
      const country =
        normalizeCountryName(availability.country?.name, availability.country?.code) ||
        normalizeCountryCode(availability.country?.code) ||
        "Selected country";
      return `Country: ${country}${note}`;
    }
    case "state": {
      const country = normalizeCountryName(availability.country?.name, availability.country?.code) || availability.country?.code;
      const parts = [availability.state, country].filter(Boolean);
      return `State: ${parts.join(", ") || "Selected state"}${note}`;
    }
    case "city": {
      const country = normalizeCountryName(availability.country?.name, availability.country?.code) || availability.country?.code;
      const parts = [availability.city, availability.state, country].filter(Boolean);
      return `City: ${parts.join(", ") || "Selected city"}${note}`;
    }
    case "radius": {
      const km = availability.radiusKm ? `${availability.radiusKm} km` : "radius";
      const center = availability.center?.label || "center point";
      return `Within ${km} of ${center}${note}`;
    }
    default:
      return `Worldwide${note}`;
  }
}

function toNorm(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function continentMatches(continentList: string[] | null | undefined, buyerContinentRaw?: string | null) {
  const buyerContinent = toNorm(buyerContinentRaw);
  if (!buyerContinent) return true;

  const list = (continentList || []).map((v) => toNorm(v)).filter(Boolean);
  if (!list.length) return true;

  if (buyerContinent === "americas") {
    return list.includes("americas") || list.includes("north america") || list.includes("south america");
  }
  if (buyerContinent === "north america" || buyerContinent === "south america") {
    return list.includes(buyerContinent) || list.includes("americas");
  }
  return list.includes(buyerContinent);
}

function countryMatches(
  buyerGeo: DeliveryGeo,
  availabilityCountry: AvailabilityJson["country"] | null | undefined
) {
  const buyerCountryCode = toNorm(normalizeCountryCode(buyerGeo.countryCode));
  const buyerCountry = toNorm(normalizeCountryName(buyerGeo.country, buyerGeo.countryCode) || buyerGeo.country);
  const countryCode = toNorm(normalizeCountryCode(availabilityCountry?.code));
  const countryName = toNorm(normalizeCountryName(availabilityCountry?.name, availabilityCountry?.code) || availabilityCountry?.name);

  if (!countryName && !countryCode) return true;
  if (buyerCountry && countryName && buyerCountry === countryName) return true;
  if (buyerCountryCode && countryCode && buyerCountryCode === countryCode) return true;
  return false;
}

function kmBetween(a: LocationCoords, b: LocationCoords) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);

  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function availabilityMayMatch(
  availability: AvailabilityJson | null | undefined,
  buyerGeo: DeliveryGeo | null | undefined
) {
  if (!availability || !availability.scope) return true;
  if (!buyerGeo) return true;

  const scope = availability.scope;
  const buyerRegion = toNorm(pickLocationRegion(buyerGeo));
  const buyerCity = toNorm(pickLocationCity(buyerGeo));

  if (scope === "global") return true;

  if (scope === "continent") {
    return continentMatches(availability.continents, buyerGeo.continent);
  }

  if (scope === "country") {
    return countryMatches(buyerGeo, availability.country);
  }

  if (scope === "state") {
    const state = toNorm(availability.state);
    const countryOk = countryMatches(buyerGeo, availability.country);
    return countryOk && !!buyerRegion && !!state && buyerRegion === state;
  }

  if (scope === "city") {
    const state = toNorm(availability.state);
    const city = toNorm(availability.city);
    const countryOk = countryMatches(buyerGeo, availability.country);
    const stateOk = !state || (!!buyerRegion && buyerRegion === state);
    return countryOk && stateOk && !!buyerCity && !!city && buyerCity === city;
  }

  if (scope === "radius") {
    const center = availability.center;
    const radius = Number(availability.radiusKm || 0);
    if (!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lng) || !Number.isFinite(radius) || radius <= 0) {
      return true;
    }
    if (!Number.isFinite(buyerGeo.lat) || !Number.isFinite(buyerGeo.lng)) return true;
    const distance = kmBetween({ lat: center.lat, lng: center.lng }, { lat: buyerGeo.lat, lng: buyerGeo.lng });
    return distance <= radius;
  }

  return true;
}

