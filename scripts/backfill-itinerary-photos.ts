/**
 * Re-resolves photos for stops that lost theirs to the resource-name bug.
 *
 * Until 2026-08-29 the location upsert threw away `photo_urls` and
 * `photos_resolved_at` whenever a refetch returned a different `photo_names`
 * set — on the belief that a Google photo resource name identifies a photo. It
 * does not: two identical searches seconds apart return a fresh name for every
 * photo of every place. So every replan of a city silently un-resolved the
 * whole pool, and only the ~20 stops that survived *that* run got their media
 * bought back. Everything else rendered a grey box.
 *
 * The store no longer does that. This script repairs the rows it already ate.
 *
 * It targets **stops in an itinerary**, not the whole `locations` table. The
 * table is the shared Places cache and most of it never reached a card; paying
 * the Photos SKU for a place nobody will see is the exact mistake
 * `resolvePhotos` was shaped to make inexpressible. Same rule, one level up.
 *
 * Three kinds of row qualify:
 *
 *   - names stored, never resolved (the bulk of them);
 *   - resolved but with no URL, which is a fetch that failed;
 *   - resolved to an expiring `googleusercontent` URL, from before the R2
 *     bucket was configured. Those are already broken or soon will be, and
 *     nothing else refreshes them now that the accidental invalidation is gone.
 *
 * The stored names may themselves have expired — they were minted by a search
 * that ran days ago. A name Google no longer honours fails its media fetch,
 * lands in `failures`, and leaves the stamp null, which is exactly what a live
 * plan does. Re-running the plan is the only way to mint fresh names.
 *
 * Usage:
 *   npm run photos:backfill -- --dry-run     # count the work, buy nothing
 *   npm run photos:backfill -- --limit 25    # spend on 25 places
 *   npm run photos:backfill
 *
 * Needs GOOGLE_PLACES_API_KEY and DATABASE_URL in `.env.local`. The
 * `PHOTO_BLOB_*` bucket is optional and strongly wanted: without it the script
 * stores Google's expiring `photoUri` and re-creates the third case above.
 */

import { and, sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { createLocationStore } from "@/lib/db/stores";
import { itinerary_activities, locations } from "@/lib/db/schema";
import { createS3PhotoBlobStore, s3ConfigFromEnv } from "@/lib/planner/photo-blobs";
import { resolvePhotos } from "@/lib/planner/photos";
import type { RetrievedPlace } from "@/lib/planner/retrieval";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set. Copy .env.local.example to .env.local and fill it in.`);
    process.exit(1);
  }
  return value;
}

function numberFlag(args: readonly string[], name: string): number | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = Number(args[index + 1]);
  if (!Number.isInteger(value) || value <= 0) {
    console.error(`${name} needs a positive whole number.`);
    process.exit(1);
  }
  return value;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const limit = numberFlag(args, "--limit");

  const apiKey = required("GOOGLE_PLACES_API_KEY");
  required("DATABASE_URL");

  const db = getDb();
  const store = createLocationStore(db);

  const s3 = s3ConfigFromEnv();
  if (!s3) {
    console.warn(
      "No PHOTO_BLOB_* bucket configured. Photos will be stored as Google's\n" +
        "expiring photoUri, which is what created the third case this script repairs.",
    );
  }

  const hasNames = sql`jsonb_array_length(coalesce(${locations.photo_names}, '[]'::jsonb)) > 0`;
  const needsMedia = sql`(
    ${locations.photos_resolved_at} is null
    or jsonb_array_length(coalesce(${locations.photo_urls}, '[]'::jsonb)) = 0
    or ${locations.photo_urls}->>0 like '%googleusercontent%'
  )`;
  const inAnItinerary = sql`exists (
    select 1 from ${itinerary_activities}
    where ${itinerary_activities.location_id} = ${locations.id}
  )`;

  const candidates = await db
    .select({ placeId: locations.place_id, name: locations.name })
    .from(locations)
    .where(and(hasNames, needsMedia, inAnItinerary))
    .orderBy(locations.name);

  console.log(`${candidates.length} itinerary stops are missing a usable photo.`);
  if (candidates.length === 0) return;

  const selected = limit ? candidates.slice(0, limit) : candidates;
  if (limit && limit < candidates.length) {
    console.log(`--limit ${limit}: leaving ${candidates.length - selected.length} for a later run.`);
  }

  if (dryRun) {
    for (const row of selected) console.log(`  ${row.name}`);
    console.log("\n--dry-run: nothing fetched, nothing billed.");
    return;
  }

  const stored = await store.getMany(selected.map((row) => row.placeId));

  // `resolvePhotos` skips anything already carrying a stamp, which is right for
  // a plan and wrong here: the expiring-URL rows are stamped and are precisely
  // what we came to replace. Clearing it in the pool — never in the row — is
  // this script saying "ask again", and the store write still goes by place id.
  const pool: RetrievedPlace[] = stored.map((place) => ({
    ...place,
    photoUrls: null,
    photosResolvedAt: null,
  }));

  const missing = selected.length - pool.length;
  if (missing > 0) console.warn(`${missing} selected places had no readable row and were skipped.`);

  console.log(`Resolving ${pool.length} places, one photo each…`);
  const started = Date.now();
  const { stats } = await resolvePhotos(
    pool,
    pool.map((place) => place.placeId),
    {
      apiKey,
      store,
      blobs: s3 ? createS3PhotoBlobStore(s3) : undefined,
      now: new Date(),
    },
  );

  console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
  console.log(`  resolved:      ${stats.resolved}`);
  console.log(`  billed fetches:${String(stats.billedCalls).padStart(4)}  (Places Photos SKU)`);
  console.log(`  bucket hits:   ${stats.blobHits}`);
  console.log(`  no photo names:${String(stats.skippedNoNames).padStart(4)}`);
  console.log(`  failures:      ${stats.failures.length}`);

  const byPlaceId = new Map(pool.map((place) => [place.placeId, place.name]));
  for (const failure of stats.failures) {
    console.log(`    ${byPlaceId.get(failure.placeId) ?? failure.placeId}: ${failure.message}`);
  }
  if (stats.failures.length > 0) {
    console.log(
      "\nA failure here is usually an expired resource name. Those places need a\n" +
        "fresh search — replanning a trip in that city will mint new ones.",
    );
  }
}

void main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
