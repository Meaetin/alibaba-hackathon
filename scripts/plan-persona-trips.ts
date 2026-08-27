/**
 * Plans one real itinerary per test traveller and puts the results side by side.
 *
 * This is the online counterpart to the offline suite: it spends money, hits
 * Google and OpenAI, and writes rows. It exists because the whole persona layer
 * has one claim — same city, same dates, same form, different person, different
 * trip — and nothing in the test suite can check that claim end to end, because
 * Pass B is a model and the offline harness may not call one.
 *
 * ## It goes through the front door
 *
 * `POST /api/persona` then `POST /api/plan`, against a running `next dev`. Not
 * `runPlan` directly: the interesting seams are `resolvePersona` and
 * `composeProfile` inside the route handler, and importing the library would
 * skip both. The body is the one `createItineraryRouted` sends, including
 * `mode: "themed"`, which is the product default and lives in the client.
 *
 * ## Sequential, on purpose
 *
 * Enrichment is the binding limit — roughly 48k tokens per plan against a
 * 200k/minute budget, so about three plans a minute at best. Sequential also
 * lets `place_search_cache` and `locations` warm up: the first traveller pays
 * for Singapore's text searches and the rest reuse every query they share.
 *
 * ## Nothing is billed until the travellers check out
 *
 * `checkTravellers` re-scores all seven answer sets offline and refuses to run
 * if any lands on a different archetype or different bands than it claims. A
 * traveller who has quietly drifted onto another archetype would produce seven
 * trips that prove nothing, at full price.
 *
 * ## Why plain SQL rather than Drizzle
 *
 * `src/lib/db/client.ts` imports `./schema` with no file extension, which Node
 * resolves only under a bundler. This script runs on bare Node, the same way
 * every other script in this directory does, so it opens its own Neon
 * connection and reads with SQL. Nothing here writes — the writes all happen
 * inside the route handler, where they belong.
 *
 * Usage:  npm run personas:plan
 *         BASE_URL=http://localhost:3001 npm run personas:plan
 */

import { neon } from "@neondatabase/serverless";

import type { JobRow } from "@/lib/db/itineraries";
import type { PlanStats } from "@/lib/planner/pipeline";
import type { PreferenceProfile } from "@/lib/planner/types";

import { buildProfile } from "../src/lib/persona/profile.ts";
import { calculatePersona } from "../src/lib/persona/quiz.ts";
import { bandsOf, resolvePlannerKnobs, toPersonaAxes } from "../src/lib/planner/knobs.ts";
import { renderPersonaBrief, buildPersonaBrief } from "../src/lib/planner/persona-brief.ts";
import { TRAVELLERS, type Traveller } from "./travellers.ts";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

/** Every traveller gets the same city, the same dates and the same trip length,
 *  so the persona is the only thing that differs between the seven runs. */
const TRIP = {
  city: "Singapore",
  country: "Singapore",
  startDate: "2026-09-14",
  totalDays: 3,
  mode: "themed" as const,
};

/** How long one plan may take before the script gives up on it. Themed plans
 *  run a theme call, a Pass B, live enrichment and ~15 narrations. */
const PLAN_TIMEOUT_MS = 12 * 60 * 1000;
const POLL_INTERVAL_MS = 3_000;

// ── the offline pre-flight ───────────────────────────────────────────────────

const bandKeyFor = (traveller: Traveller): string => {
  const b = bandsOf(toPersonaAxes(calculatePersona(traveller.answers).dimensions));
  return `${b.spontaneity}/${b.comfortTolerance}/${b.immersion}/${b.solitude}`;
};

/** Throws before anything is billed if a traveller no longer describes who they
 *  claim to. Returns nothing — it is a gate, not a step. */
function checkTravellers(): void {
  const wrong: string[] = [];
  for (const traveller of TRAVELLERS) {
    const persona = calculatePersona(traveller.answers);
    if (persona.archetype.id !== traveller.intendedArchetype) {
      wrong.push(
        `${traveller.key}: claims ${traveller.intendedArchetype}, scores ${persona.archetype.id}`,
      );
    }
    const bands = bandKeyFor(traveller);
    if (bands !== traveller.intendedBands) {
      wrong.push(`${traveller.key}: claims bands ${traveller.intendedBands}, scores ${bands}`);
    }
  }
  if (wrong.length > 0) {
    throw new Error(`the travellers no longer match their claims:\n  ${wrong.join("\n  ")}`);
  }
}

// ── the front door ───────────────────────────────────────────────────────────

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`POST ${path} → ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload as T;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The job row as the route returns it, plus the result blob the handler writes
 *  on completion. `stats` is the only part this script reads. */
type PlanJob = JobRow & { result?: { itinerary_id?: string; stats?: PlanStats } | null };

/** Polls the job row until it reads terminal, or gives up. The job row is the
 *  only place a background plan reports itself; there is no other signal. */
async function awaitJob(jobId: string): Promise<PlanJob> {
  const deadline = Date.now() + PLAN_TIMEOUT_MS;
  let lastStage = "";
  while (Date.now() < deadline) {
    const response = await fetch(`${BASE_URL}/api/jobs/${jobId}`);
    if (!response.ok) throw new Error(`GET /api/jobs/${jobId} → ${response.status}`);
    const job = (await response.json()) as PlanJob;
    const stage = job.progress?.label ?? job.status;
    if (stage !== lastStage) {
      process.stdout.write(`      ${stage}\n`);
      lastStage = stage;
    }
    if (job.status === "completed" || job.status === "failed") return job;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`job ${jobId} did not finish within ${PLAN_TIMEOUT_MS / 60000} minutes`);
}

// ── what came back ───────────────────────────────────────────────────────────

const sql = neon(process.env.DATABASE_URL ?? "");

/** The three columns with no API of their own, plus enough to identify the row. */
interface ItineraryRow {
  profile: PreferenceProfile;
  funnel_stats: unknown;
  planner_debug: unknown;
  persona: unknown;
  name: string;
  city: string;
  start_date: string;
  total_days: number;
}

/** One stop, joined to the `locations` row the schedule points at. */
interface StopRow {
  day_index: number;
  area_name: string | null;
  date: string;
  position: number;
  slot_role: string;
  start_min: number;
  end_min: number;
  score: number | null;
  match_reasons: string[];
  content: { whyForYou?: string } | null;
  travel_to_next: unknown;
  location_id: string | null;
  place_id: string | null;
  name: string | null;
  primary_type: string | null;
  types: string[] | null;
  rating: number | null;
  user_rating_count: number | null;
  price_level: number | null;
}

interface TripDay {
  dayIndex: number;
  date: string;
  areaName: string | null;
  stops: Array<Record<string, unknown>>;
}

/**
 * The stored trip, read back off the rows rather than off the response: the
 * columns are what a reader of this itinerary will see tomorrow, and three of
 * them — `profile`, `funnel_stats`, `planner_debug` — have no API at all.
 *
 * The stop's name, rating and price level live on `locations`, not on
 * `itinerary_activities`; the activity row holds the schedule and the join.
 * Reading them here is what lets the report say "this traveller's stops
 * averaged price level 3" rather than only listing names.
 */
async function readTrip(itineraryId: string) {
  const [row] = (await sql`
    select profile, funnel_stats, planner_debug, persona, name, city, start_date, total_days
    from itineraries where id = ${itineraryId}
  `) as unknown as ItineraryRow[];

  const stops = (await sql`
    select d.day_index, d.area_name, d.date,
           a.position, a.slot_role, a.start_min, a.end_min, a.score,
           a.match_reasons, a.content, a.travel_to_next, a.location_id,
           l.place_id, l.name, l.primary_type, l.types,
           l.rating, l.user_rating_count, l.price_level
    from itinerary_days d
    join itinerary_activities a on a.day_id = d.id
    left join locations l on l.id = a.location_id
    where d.itinerary_id = ${itineraryId}
    order by d.day_index, a.position
  `) as unknown as StopRow[];

  const days: TripDay[] = [];
  for (const stop of stops) {
    let day = days.find((d) => d.dayIndex === stop.day_index);
    if (!day) {
      day = { dayIndex: stop.day_index, date: stop.date, areaName: stop.area_name, stops: [] };
      days.push(day);
    }
    day.stops.push({
      name: stop.name,
      role: stop.slot_role,
      placeId: stop.place_id,
      // A null `location_id` on a themed run is the bug the explored-pool fix
      // was for. Worth seeing in the report rather than inferring.
      locationId: stop.location_id,
      startMin: stop.start_min,
      endMin: stop.end_min,
      score: stop.score,
      primaryType: stop.primary_type,
      types: stop.types,
      rating: stop.rating,
      userRatingCount: stop.user_rating_count,
      priceLevel: stop.price_level,
      whyForYou: stop.content?.whyForYou ?? null,
      matchReasons: stop.match_reasons,
      travelToNext: stop.travel_to_next,
    });
  }

  return { row, days };
}

// ── the run ──────────────────────────────────────────────────────────────────

async function planFor(traveller: Traveller) {
  const persona = calculatePersona(traveller.answers);
  console.log(`\n── ${traveller.name} (${traveller.key})`);
  console.log(`   ${persona.archetype.name}, confidence ${persona.confidence}`);
  console.log(`   bands ${bandKeyFor(traveller)}`);

  const { id: personaId } = await post<{ id: string }>("/api/persona", {
    answers: traveller.answers,
  });
  console.log(`   persona row ${personaId}`);

  const job = await post<PlanJob>("/api/plan", {
    ...TRIP,
    name: `${traveller.name} — ${TRIP.city}`,
    // The demo's placeholder interests, exactly as the browser sends them.
    // `composeProfile` replaces them from the persona; that replacement is the
    // thing under test, so they must not be sent as `interestOverrides`.
    profile: {
      interests: ["outdoors", "cafes", "museums", "food"],
      dietary: traveller.form.dietary,
      pace: traveller.form.pace,
      ...(traveller.form.budget ? { budget: traveller.form.budget } : {}),
    },
    personaId,
  });
  console.log(`   job ${job.id}`);

  const finished = await awaitJob(job.id);
  if (finished.status === "failed") {
    console.log(`   FAILED: ${finished.error}`);
    return { traveller, personaId, jobId: job.id, failed: finished.error };
  }

  // A completed job always carries one; a job that says otherwise is a bug in
  // the route, and guessing at an id here would hide it behind an empty report.
  const itineraryId = finished.itinerary_id ?? finished.result?.itinerary_id;
  if (!itineraryId) {
    console.log("   COMPLETED WITH NO ITINERARY ID — nothing to read back");
    return { traveller, personaId, jobId: job.id, failed: "completed without an itinerary id" };
  }
  const trip = await readTrip(itineraryId);

  // What the persona was *supposed* to do, computed the same way the pipeline
  // computes it. Printed beside the trip so a difference in the plan can be
  // traced to a knob rather than guessed at.
  const profile = buildProfile(persona, {
    city: TRIP.city,
    totalDays: TRIP.totalDays,
    dietary: traveller.form.dietary,
    pace: traveller.form.pace,
    budget: traveller.form.budget,
  });
  const knobs = resolvePlannerKnobs(profile, persona, profile.pace);

  console.log(`   itinerary ${itineraryId} — ${trip.days.reduce((n, d) => n + d.stops.length, 0)} stops`);

  return {
    traveller,
    personaId,
    jobId: job.id,
    itineraryId,
    archetype: persona.archetype.id,
    confidence: persona.confidence,
    dimensions: persona.dimensions,
    bands: bandKeyFor(traveller),
    profile,
    knobs,
    // All three audiences, because they render different sections of the same
    // brief and "the persona reached the prompt" is per-stage, not global.
    brief: Object.fromEntries(
      (["theme", "assign", "narrate"] as const).map((audience) => [
        audience,
        renderPersonaBrief(buildPersonaBrief(persona, traveller.answers), audience),
      ]),
    ),
    stats: finished.result?.stats,
    storedProfile: trip.row?.profile,
    funnelStats: trip.row?.funnel_stats,
    plannerDebug: trip.row?.planner_debug,
    days: trip.days,
  };
}

async function main() {
  checkTravellers();
  console.log(`all ${TRAVELLERS.length} travellers score as claimed — starting\n`);
  console.log(`${TRIP.totalDays} days in ${TRIP.city} from ${TRIP.startDate}, mode ${TRIP.mode}`);
  console.log(`front door ${BASE_URL}`);

  const results = [];
  for (const traveller of TRAVELLERS) {
    try {
      results.push(await planFor(traveller));
    } catch (error) {
      console.error(`   ${traveller.key} threw`, error);
      results.push({ traveller, error: String(error) });
    }
  }

  const path = new URL("./output/persona-trips.json", import.meta.url);
  await (await import("node:fs/promises")).writeFile(path, JSON.stringify(results, null, 2));
  console.log(`\nwrote ${path.pathname}`);
  return results;
}

main().catch((error) => {
  console.error("the persona run failed", error);
  process.exitCode = 1;
});
