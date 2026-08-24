/**
 * Reliability probe for Place Details Enterprise + Atmosphere fields.
 *
 * `docs/personalization-pipeline.md` filters on structured Google data, and
 * `place-details.md` lists extra Atmosphere-SKU fields (servesVegetarianFood,
 * outdoorSeating, goodForChildren, …) that could sharpen the hard filters —
 * but only if Google actually populates them. This script fetches 20 Singapore
 * places across four interest buckets and reports per-field coverage, so the
 * decision to filter on a field is based on measured presence, not hope.
 *
 * Pipeline requirements this script honors (see personalization-pipeline.md):
 *   - `reviews` is in the mask — it is the enrichment pass's only free text
 *   - `photos` are stored as resource NAMES only; media is never resolved
 *   - `priceLevel` goes through `toPriceLevelOrdinal`; `priceRange` is kept
 *     separately and never used for comparison
 *   - search uses a `places.id`-only mask (Essentials IDs Only SKU), so the
 *     Enterprise + Atmosphere spend is exactly the 20 details calls under test
 *   - a previous run's output is reused instead of re-billing; pass --refresh
 *     to force a fresh fetch
 *
 * `editorialSummary` / `generativeSummary` / `reviewSummary` are deliberately
 * EXCLUDED from the production retrieval mask, but included here as part of
 * the test — the doc claims editorial summaries are missing on most places,
 * and this measures that claim.
 *
 * Usage:  npm run places:sample          (reads GOOGLE_PLACES_API_KEY from .env.local)
 *         npm run places:sample -- --refresh
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { toPriceLevelOrdinal, type PriceLevelOrdinal } from "../src/lib/maps/price-level.ts";

const CITY = "Singapore";
const PLACES_PER_BUCKET = 5;
const OUTPUT_PATH = path.join(import.meta.dirname, "output", "singapore-place-details.json");

/**
 * Four buckets from the interest taxonomy (`src/lib/planner/types.ts`), chosen
 * to span the demo profile (vegetarian, outdoors + cafes) AND to contrast
 * atmosphere-rich categories (food, cafes) with atmosphere-poor ones
 * (outdoors, museums) — absence on the latter is itself the finding.
 */
const BUCKETS = [
  { bucket: "food", textQuery: `vegetarian restaurant in ${CITY}` },
  { bucket: "cafes", textQuery: `specialty coffee in ${CITY}` },
  { bucket: "outdoors", textQuery: `scenic park in ${CITY}` },
  { bucket: "museums", textQuery: `museum in ${CITY}` },
] as const;

type Bucket = (typeof BUCKETS)[number]["bucket"];

/**
 * Enterprise + Atmosphere fields under test, from `place-details.md`.
 * `reviews` is measured too but normalized separately (it feeds enrichment).
 * EV/fuel fields are omitted — they only exist on charging/gas stations.
 */
const ATMOSPHERE_FIELDS = [
  "allowsDogs",
  "curbsidePickup",
  "delivery",
  "dineIn",
  "editorialSummary",
  "generativeSummary",
  "goodForChildren",
  "goodForGroups",
  "goodForWatchingSports",
  "liveMusic",
  "menuForChildren",
  "outdoorSeating",
  "parkingOptions",
  "paymentOptions",
  "reservable",
  "restroom",
  "reviewSummary",
  "servesBeer",
  "servesBreakfast",
  "servesBrunch",
  "servesCocktails",
  "servesCoffee",
  "servesDessert",
  "servesDinner",
  "servesLunch",
  "servesVegetarianFood",
  "servesWine",
  "takeout",
] as const;

type AtmosphereField = (typeof ATMOSPHERE_FIELDS)[number];

/** Mirrors the pipeline's SEARCH_FIELD_MASK, plus the fields under test. */
const DETAILS_FIELD_MASK = [
  "id",
  "displayName",
  "formattedAddress",
  "location",
  "types",
  "primaryType",
  "rating",
  "userRatingCount",
  "priceLevel",
  "priceRange",
  "regularOpeningHours",
  "businessStatus",
  "reviews", // the enrichment pass's only free-text input
  "photos", // resource NAMES only — resolving to an image is a separate SKU
  ...ATMOSPHERE_FIELDS,
].join(",");

/** Loose shape of a Places REST details response; only what we touch. */
interface RawPlace {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  types?: string[];
  primaryType?: string;
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  priceRange?: unknown;
  regularOpeningHours?: { periods?: unknown[] };
  businessStatus?: string;
  reviews?: { rating?: number; text?: { text?: string } }[];
  photos?: { name?: string }[];
  [key: string]: unknown;
}

/** Normalized record, column-named after the `locations` table in the design doc. */
interface SampledPlace {
  bucket: Bucket;
  place_id: string;
  name: string;
  formatted_address: string | null;
  latitude: number | null;
  longitude: number | null;
  types: string[];
  primary_type: string | null;
  rating: number | null;
  user_rating_count: number | null;
  price_level: PriceLevelOrdinal | null;
  price_level_raw: string | null;
  price_range: unknown;
  business_status: string | null;
  opening_periods: unknown[] | null;
  review_snippets: { rating: number | null; text: string }[];
  photo_names: string[];
  /** Raw Atmosphere payload — the data whose reliability is being measured. */
  atmosphere: Partial<Record<AtmosphereField, unknown>>;
}

interface SampleFile {
  fetched_at: string;
  city: string;
  field_mask: string;
  places: SampledPlace[];
}

function requireApiKey(): string {
  const key = process.env.GOOGLE_PLACES_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) {
    console.error(
      "Missing API key. Set GOOGLE_PLACES_API_KEY in .env.local (see .env.local.example).",
    );
    process.exit(1);
  }
  if (!process.env.GOOGLE_PLACES_API_KEY) {
    console.warn(
      "⚠ Falling back to NEXT_PUBLIC_GOOGLE_MAPS_API_KEY — browser keys are often " +
        "referrer-restricted and will 403 from a script. Prefer GOOGLE_PLACES_API_KEY.",
    );
  }
  return key;
}

async function placesFetch(url: string, apiKey: string, init: RequestInit, fieldMask: string) {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": fieldMask,
      ...init.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Places API ${res.status} for ${url}\n${body}\n` +
        (res.status === 403
          ? "Hint: the key must have 'Places API (New)' enabled and no HTTP-referrer restriction."
          : ""),
    );
  }
  return res.json();
}

/** Text Search with an id-only mask — Essentials IDs Only SKU, the cheap step. */
async function searchPlaceIds(textQuery: string, apiKey: string): Promise<string[]> {
  const data = (await placesFetch(
    "https://places.googleapis.com/v1/places:searchText",
    apiKey,
    { method: "POST", body: JSON.stringify({ textQuery, pageSize: PLACES_PER_BUCKET }) },
    "places.id",
  )) as { places?: { id: string }[] };
  return (data.places ?? []).map((p) => p.id);
}

/** Place Details with the full mask — the Enterprise + Atmosphere call under test. */
async function fetchPlaceDetails(placeId: string, apiKey: string): Promise<RawPlace> {
  return (await placesFetch(
    `https://places.googleapis.com/v1/places/${placeId}`,
    apiKey,
    { method: "GET" },
    DETAILS_FIELD_MASK,
  )) as RawPlace;
}

function normalizePlace(raw: RawPlace, bucket: Bucket): SampledPlace {
  const atmosphere: Partial<Record<AtmosphereField, unknown>> = {};
  for (const field of ATMOSPHERE_FIELDS) {
    // Google omits unknown fields entirely; only copy what actually came back,
    // so "absent" stays distinguishable from "false" in the coverage report.
    if (Object.prototype.hasOwnProperty.call(raw, field)) atmosphere[field] = raw[field];
  }
  return {
    bucket,
    place_id: raw.id,
    name: raw.displayName?.text ?? "",
    formatted_address: raw.formattedAddress ?? null,
    latitude: raw.location?.latitude ?? null,
    longitude: raw.location?.longitude ?? null,
    types: raw.types ?? [],
    primary_type: raw.primaryType ?? null,
    rating: raw.rating ?? null,
    user_rating_count: raw.userRatingCount ?? null,
    price_level: toPriceLevelOrdinal(raw.priceLevel) ?? null,
    price_level_raw: raw.priceLevel ?? null,
    price_range: raw.priceRange ?? null,
    business_status: raw.businessStatus ?? null,
    opening_periods: raw.regularOpeningHours?.periods ?? null,
    review_snippets: (raw.reviews ?? [])
      .slice(0, 5)
      .map((r) => ({ rating: r.rating ?? null, text: r.text?.text ?? "" })),
    photo_names: (raw.photos ?? []).flatMap((p) => (p.name ? [p.name] : [])),
    atmosphere,
  };
}

async function fetchSample(apiKey: string): Promise<SampleFile> {
  const seen = new Set<string>();
  const places: SampledPlace[] = [];

  for (const { bucket, textQuery } of BUCKETS) {
    console.log(`Searching: "${textQuery}"`);
    const ids = (await searchPlaceIds(textQuery, apiKey)).filter((id) => !seen.has(id));
    for (const id of ids) {
      seen.add(id);
      const raw = await fetchPlaceDetails(id, apiKey);
      places.push(normalizePlace(raw, bucket));
      console.log(`  ✓ ${places[places.length - 1].name}`);
    }
  }

  return {
    fetched_at: new Date().toISOString(),
    city: CITY,
    field_mask: DETAILS_FIELD_MASK,
    places,
  };
}

/** The actual deliverable: per-field presence, split by bucket. */
function printReliabilityReport(sample: SampleFile): void {
  const buckets = BUCKETS.map((b) => b.bucket);
  const total = sample.places.length;
  const col = 24;

  console.log(`\nAtmosphere field coverage — ${total} places in ${sample.city}`);
  console.log(`(present = Google returned the field; booleans show true/present)\n`);

  const header = ["field".padEnd(col), "all".padStart(9), ...buckets.map((b) => b.padStart(10))];
  console.log(header.join(""));
  console.log("-".repeat(col + 9 + buckets.length * 10));

  for (const field of ATMOSPHERE_FIELDS) {
    const cells = [String(field).padEnd(col)];
    const overall = sample.places.filter((p) => field in p.atmosphere);
    const trues = overall.filter((p) => p.atmosphere[field] === true).length;
    const isBool = overall.some((p) => typeof p.atmosphere[field] === "boolean");
    cells.push((isBool ? `${trues}/${overall.length}` : `${overall.length}/${total}`).padStart(9));
    for (const bucket of buckets) {
      const inBucket = sample.places.filter((p) => p.bucket === bucket);
      const present = inBucket.filter((p) => field in p.atmosphere).length;
      cells.push(`${present}/${inBucket.length}`.padStart(10));
    }
    console.log(cells.join(""));
  }

  // The non-atmosphere signals the pipeline already depends on, for contrast.
  const depend: [string, (p: SampledPlace) => boolean][] = [
    ["rating", (p) => p.rating != null],
    ["price_level (ordinal)", (p) => p.price_level != null],
    ["opening_periods", (p) => (p.opening_periods?.length ?? 0) > 0],
    ["review_snippets ≥ 3", (p) => p.review_snippets.length >= 3],
    ["photo_names ≥ 1", (p) => p.photo_names.length > 0],
  ];
  console.log(`\nBaseline pipeline fields`);
  for (const [label, test] of depend) {
    const n = sample.places.filter(test).length;
    console.log(`${label.padEnd(col)}${`${n}/${total}`.padStart(9)}`);
  }

  console.log(`\nFull data: ${path.relative(process.cwd(), OUTPUT_PATH)}`);
}

async function main() {
  const refresh = process.argv.includes("--refresh");

  if (existsSync(OUTPUT_PATH) && !refresh) {
    console.log("Reusing existing sample (pass --refresh to re-bill Google).");
    const sample = JSON.parse(await readFile(OUTPUT_PATH, "utf8")) as SampleFile;
    printReliabilityReport(sample);
    return;
  }

  const apiKey = requireApiKey();
  const sample = await fetchSample(apiKey);
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(sample, null, 2) + "\n", "utf8");
  console.log(`\nSaved ${sample.places.length} places → ${OUTPUT_PATH}`);
  printReliabilityReport(sample);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
