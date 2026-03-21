const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
const originalResolveFilename = Module._resolveFilename;
const originalLoad = Module._load;

function registerTsHook() {
  const exts = [".ts", ".tsx"];
  for (const ext of exts) {
    Module._extensions[ext] = function compileTs(module, filename) {
      const source = fs.readFileSync(filename, "utf8");
      const { outputText } = ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2020,
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          jsx: ts.JsxEmit.React,
        },
        fileName: filename,
      });
      module._compile(outputText, filename);
    };
  }
}

registerTsHook();

Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
  if (request.startsWith("@/")) {
    const next = path.join(ROOT, request.slice(2));
    return originalResolveFilename.call(this, next, parent, isMain, options);
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

Module._load = function loadMock(request, parent, isMain) {
  if (request === "expo-location") {
    return {
      Accuracy: { Balanced: "balanced" },
      requestForegroundPermissionsAsync: async () => ({ granted: true }),
      getCurrentPositionAsync: async () => ({
        coords: { latitude: 0, longitude: 0 },
      }),
      reverseGeocodeAsync: async () => [],
    };
  }
  if (request === "react-native") {
    return { Platform: { OS: "web" } };
  }
  if (
    request === "@/utils/secureStore" ||
    request.endsWith("/utils/secureStore") ||
    request.endsWith("\\utils\\secureStore")
  ) {
    return {
      getItemAsync: async () => null,
      setItemAsync: async () => {},
      deleteItemAsync: async () => {},
    };
  }
  if (
    request === "@/services/supabase" ||
    request.endsWith("/services/supabase") ||
    request.endsWith("\\services\\supabase")
  ) {
    return {
      supabase: {
        auth: { getUser: async () => ({ data: { user: null } }) },
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const {
  availabilityMayMatch,
  syncManualLocationTextAddress,
  toDeliveryGeo,
  toProfileLocationAddress,
} = require(path.join(ROOT, "utils", "location.ts"));
const { listingMatchesCountry } = require(path.join(ROOT, "utils", "country.ts"));

test("toDeliveryGeo normalizes fallback city, region, and country", () => {
  const out = toDeliveryGeo({
    coords: { lat: 6.5244, lng: 3.3792 },
    geo: {
      town: "Ikeja",
      subregion: "Lagos",
      country: "NG",
      countryCode: "ng",
    },
  });

  assert.equal(out.city, "Ikeja");
  assert.equal(out.region, "Lagos");
  assert.equal(out.country, "Nigeria");
  assert.equal(out.countryCode, "NG");
  assert.equal(out.label, "Lat 6.52440, Lng 3.37920");
});

test("toProfileLocationAddress preserves structured fallback fields", () => {
  const out = toProfileLocationAddress({
    coords: { lat: 51.5074, lng: -0.1278 },
    geo: {
      locality: "Westminster",
      district: "Greater London",
      country: "UK",
      countryCode: "uk",
      postalCode: "SW1A",
    },
    label: "Westminster, London, United Kingdom",
  });

  assert.equal(out.city, "Westminster");
  assert.equal(out.region, "Greater London");
  assert.equal(out.country, "United Kingdom");
  assert.equal(out.countryCode, "UK");
  assert.equal(out.postalCode, "SW1A");
});

test("availabilityMayMatch enforces continent scope", () => {
  const africaBuyer = {
    lat: 6.5244,
    lng: 3.3792,
    city: "Ikeja",
    region: "Lagos",
    country: "Nigeria",
    countryCode: "NG",
    label: "Ikeja, Lagos, Nigeria",
    continent: "Africa",
  };

  assert.equal(
    availabilityMayMatch(
      {
        scope: "continent",
        continents: ["Europe"],
        country: { name: "", code: "" },
        state: "",
        city: "",
        radiusKm: 0,
        center: { lat: 0, lng: 0, label: "" },
        note: "",
      },
      africaBuyer,
    ),
    false,
  );

  assert.equal(
    availabilityMayMatch(
      {
        scope: "continent",
        continents: ["Americas"],
        country: { name: "", code: "" },
        state: "",
        city: "",
        radiusKm: 0,
        center: { lat: 0, lng: 0, label: "" },
        note: "",
      },
      { ...africaBuyer, continent: "North America" },
    ),
    true,
  );
});

test("syncManualLocationTextAddress clears stale structured fields after manual override", () => {
  const next = syncManualLocationTextAddress(
    {
      label: "Ikeja, Lagos, Nigeria",
      city: "Ikeja",
      region: "Lagos",
      country: "Nigeria",
      countryCode: "NG",
      postalCode: "100001",
      lat: 6.6,
      lng: 3.3,
    },
    "Remote / Worldwide",
  );

  assert.deepEqual(next, { label: "Remote / Worldwide" });
});

test("syncManualLocationTextAddress preserves structured fields when label stays aligned", () => {
  const next = syncManualLocationTextAddress(
    {
      label: "Ikeja, Lagos, Nigeria",
      city: "Ikeja",
      region: "Lagos",
      country: "Nigeria",
      countryCode: "NG",
    },
    "Ikeja, Lagos, Nigeria",
  );

  assert.deepEqual(next, {
    label: "Ikeja, Lagos, Nigeria",
    city: "Ikeja",
    region: "Lagos",
    country: "Nigeria",
    countryCode: "NG",
  });
});

test("listingMatchesCountry keeps city/state filtering working for listing discovery", () => {
  const availability = {
    scope: "city",
    continents: [],
    country: { name: "Nigeria", code: "NG" },
    state: "Lagos",
    city: "Ikeja",
    radiusKm: 0,
    center: { lat: 0, lng: 0, label: "" },
    note: "",
  };

  assert.equal(
    listingMatchesCountry(availability, {
      code: "NG",
      name: "Nigeria",
      region: "Lagos",
      city: "Ikeja",
      continent: "Africa",
      lat: 6.5244,
      lng: 3.3792,
    }),
    true,
  );

  assert.equal(
    listingMatchesCountry(availability, {
      code: "NG",
      name: "Nigeria",
      region: "Abuja",
      city: "Wuse",
      continent: "Africa",
      lat: 9.0667,
      lng: 7.4833,
    }),
    false,
  );
});
