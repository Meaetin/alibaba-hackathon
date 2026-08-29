/**
 * `POST /api/plan` — the pipeline's front door.
 *
 * It creates a `jobs` row, **returns it before the plan is finished**, and then
 * runs `runPlan` in the background, writing progress onto that row as each
 * stage starts. The client seeds its queue from the returned row and polls
 * `GET /api/jobs/:id` until the status is terminal.
 *
 * ## The execution model, stated plainly
 *
 * This is a localhost-only demo. The pipeline runs in the long-lived local Node
 * process after the response is sent; `next dev` / `next start` keep that
 * process alive while the browser polls the job row.
 *
 * ## Why the handler asks a factory for its dependencies
 *
 * `planRouteDeps.create` (in `../deps`) is the one seam. Overriding it in
 * `route.test.ts` runs this handler, the real pipeline, the real row shapers
 * and the real error mapping against fakes — with no database, no Google and no
 * OpenAI. Importing `runPlan` directly at the call site would make that
 * impossible without a mocking framework, and there isn't one in this repo.
 *
 * The factory lives one file across because Next rejects any export from a
 * route file that isn't the handler or a known config field.
 */

import { z } from "zod";

import { toJobProgress, type JobRow } from "@/lib/db/itineraries";
import { getFriendlyApiError } from "@/lib/errors/userMessages";
import { buildProfile } from "@/lib/persona/profile";
import { calculatePersona, isScorableAnswers } from "@/lib/persona/quiz";
import type { TravelPersona } from "@/lib/persona/types";
import type { Interest, PreferenceProfile } from "@/lib/planner/types";
import type { SavedTravelPreferences } from "@/lib/preferences/types";
import {
  completedProgress,
  stageOutlook,
  type PlanProgress,
  type PlanRequest,
  type PlanResult,
} from "@/lib/planner/pipeline";

import { planRouteDeps, userFor, type PlanRouteDeps } from "../deps";

/** A long-running Node process. The background work below depends on it. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── the request body ─────────────────────────────────────────────────────────

const InterestSchema = z.enum([
  "outdoors",
  "cafes",
  "temples",
  "museums",
  "food",
  "nightlife",
  "shopping",
]);

/** The trip length the pipeline is built for. `k = totalDays` in clustering, so
 *  a 60-day request would ask k-means for sixty neighbourhoods in one city. */
const MAX_TOTAL_DAYS = 14;

/** Comfortably past the funnel's global cap of 60, so the bound that actually
 *  decides what a trip can hold is the funnel's and not this number. */
const MAX_SEED_LOCATIONS = 200;

const PlanRequestSchema = z.object({
  city: z.string().trim().min(1),
  country: z.string().trim().min(1).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  totalDays: z.number().int().min(1).max(MAX_TOTAL_DAYS),
  name: z.string().trim().min(1).optional(),
  profile: z.object({
    interests: z.array(InterestSchema),
    dietary: z.array(z.string().trim().min(1)),
    pace: z.enum(["relaxed", "balanced", "packed"]),
    budget: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
    typeAffinities: z.record(z.string(), z.number()).optional(),
  }),
  /**
   * Interests the traveller picked themselves, as opposed to the placeholder
   * set in `profile.interests`.
   *
   * The distinction is load-bearing and cannot be inferred: with a persona
   * resolved, `buildProfile` derives interests from the archetype, and it must
   * be able to tell "the demo sent its four defaults" from "the traveller chose
   * these four". There is no interest-picking UI yet — this is the named seam
   * for when there is.
   */
  interestOverrides: z.array(InterestSchema).optional(),
  /*
   * There is no `personaId` here any more, and its absence is the point.
   *
   * It used to be on the wire because the browser's `localStorage` pointer was
   * the only thing that knew which persona was whose. With a session there is a
   * better answer: the persona belongs to the traveller, `travel_personas.user_id`
   * is unique, and the handler reads it from the cookie. A client-named id would
   * now be a way to plan a trip with somebody else's personality.
   */
  /**
   * How a day is decided. The **client** chooses, not the library: `runPlan`
   * defaults to `"geographic"` so that "no mode means today, exactly" stays
   * true for every test and every caller, and the product default lives where
   * the product is. `createItineraryRouted` sends `"themed"`.
   */
  mode: z.enum(["geographic", "themed"]).optional(),
  /**
   * Where the traveller is staying. Bounds retrieval and every day to a circle
   * around it — see `PlanBase` in `pipeline.ts` for why a `city` string alone
   * built a Bali trip three provinces wide.
   *
   * Validated as a real coordinate rather than passed through: it reaches
   * `metersBetween`, and a longitude of 3000 there returns a number rather than
   * an error, so every place in the pool would read as out of reach and the
   * trip would come back empty with nothing to say why. The radius is capped by
   * `resolveBase`, not here — one clamp, in the module that uses it twice.
   */
  base: z
    .object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      radiusMeters: z.number().positive().optional(),
    })
    .optional(),
  /**
   * Places the traveller ticked before asking for a trip — the "generate an
   * itinerary from these" path off a collection or a link.
   *
   * `locations.id`, because that is what every card in this app carries. The
   * handler translates them to place ids before the pipeline sees them; a
   * client that sent place ids would be a client that had to know which of the
   * two identifiers this app's cards happen to hold.
   *
   * Capped rather than unbounded: a selection bigger than this is not a trip.
   */
  seedLocationIds: z.array(z.string().uuid()).max(MAX_SEED_LOCATIONS).optional(),
  options: z
    .object({
      maxK: z.number().int().positive().optional(),
      kmeansInitMethod: z.enum(["kmeans++", "random", "grid"]).optional(),
      maxIterations: z.number().int().positive().optional(),
      startTime: z.string().optional(),
      endTime: z.string().optional(),
    })
    .optional(),
});

// ── the handler ──────────────────────────────────────────────────────────────

const PLAN_FAILED_MESSAGE = "We couldn't build that itinerary. Please try again.";
const BAD_REQUEST_MESSAGE = "That trip request is missing something. Please check and try again.";
const SIGNED_OUT_MESSAGE = "Please sign in to plan a trip.";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: BAD_REQUEST_MESSAGE }, { status: 400 });
  }

  const parsed = PlanRequestSchema.safeParse(body);
  if (!parsed.success) {
    // The technical detail stays in the log; the caller gets a sentence.
    console.error("[POST /api/plan] rejected request body", parsed.error.issues);
    return Response.json({ error: BAD_REQUEST_MESSAGE }, { status: 400 });
  }
  let deps: PlanRouteDeps;
  try {
    deps = planRouteDeps.create();
  } catch (error) {
    console.error("[POST /api/plan] the planner is not configured", error);
    return Response.json({ error: PLAN_FAILED_MESSAGE }, { status: 503 });
  }

  // The gate sits after `create` because it needs the store, and before the job
  // row because an anonymous request must not leave one behind.
  const user = await userFor(request, deps);
  if (!user) return Response.json({ error: SIGNED_OUT_MESSAGE }, { status: 401 });

  const { interestOverrides, seedLocationIds, ...trip } = parsed.data;
  const [persona, preferences, seedPlaceIds] = await Promise.all([
    resolvePersona(user.id, deps),
    resolvePreferences(user.id, deps),
    resolveSeeds(seedLocationIds, deps),
  ]);
  const planRequest: PlanRequest = {
    ...trip,
    profile: composeProfile(trip.profile, persona, interestOverrides, preferences),
    ...(persona ? { persona } : {}),
    ...(seedPlaceIds.length > 0 ? { seedPlaceIds } : {}),
  };

  // The payload is the request as accepted, so a client reading the job row
  // back can see exactly what it asked for.
  const job = await deps.store.createJob({ payload: parsed.data, now: deps.now() });

  // Deliberately not awaited: the response goes out now and the local Node
  // process continues the plan behind it.
  void runPlanJob(job.id, planRequest, deps, user.id);

  return Response.json(job, { status: 202 });
}

/**
 * Turns the signed-in traveller into the thing the pipeline reads.
 *
 * The result is rebuilt with `calculatePersona` from the stored answers rather
 * than assembled from the stored `dimensions` and `archetype` columns: the
 * answers are the source of truth, and rebuilding is what makes a scoring
 * change reach every traveller without re-asking anyone twelve questions.
 *
 * **No persona plans without one.** Somebody who has never taken the quiz, or
 * whose row cannot be scored, must not lose their trip over it — absent persona
 * is a supported path with a test on it, so the fallback is the ordinary
 * behaviour rather than a degraded one. It is logged, not surfaced.
 */
async function resolvePersona(
  userId: string,
  deps: PlanRouteDeps,
): Promise<TravelPersona | undefined> {
  try {
    const row = await deps.personas.getByUser(userId);
    if (!row) {
      console.warn(`[POST /api/plan] ${userId} has no persona — planning without one`);
      return undefined;
    }
    if (!isScorableAnswers(row.answers)) {
      console.error(`[POST /api/plan] persona ${row.id} has answers this quiz cannot score`);
      return undefined;
    }
    return { answers: row.answers, result: calculatePersona(row.answers) };
  } catch (error) {
    console.error(`[POST /api/plan] the persona for ${userId} could not be read`, error);
    return undefined;
  }
}

/**
 * The picked places, translated from row ids to the place ids the planner
 * speaks.
 *
 * **A lookup that fails plans without the picks**, the same supported ladder
 * `resolvePersona` and `resolvePreferences` below follow: losing the selection
 * is not worth losing the trip. It is warned about rather than surfaced,
 * because the traveller can see for themselves whether their places turned up
 * and an error toast over a trip that built fine is the worse of the two.
 *
 * Ids the database does not have are dropped inside `placeIdsForLocationIds`
 * and counted by the pipeline as `stats.seeds.missing`.
 */
async function resolveSeeds(
  locationIds: string[] | undefined,
  deps: PlanRouteDeps,
): Promise<string[]> {
  if (!locationIds || locationIds.length === 0) return [];
  try {
    return await deps.placeIdsFor(locationIds);
  } catch (error) {
    console.error("[POST /api/plan] the picked places could not be resolved", error);
    return [];
  }
}

/**
 * The traveller's saved travel preferences, or `undefined`.
 *
 * **Preferences that cannot be read plan without them**, the same supported
 * path as an absent persona: losing personalisation is not worth losing the
 * trip, and a traveller who has set none is the ordinary case, not a degraded
 * one. Logged, never surfaced.
 */
async function resolvePreferences(
  userId: string,
  deps: PlanRouteDeps,
): Promise<SavedTravelPreferences | undefined> {
  try {
    return (await deps.users.readPreferences(userId)) ?? undefined;
  } catch (error) {
    console.error(`[POST /api/plan] the preferences for ${userId} could not be read`, error);
    return undefined;
  }
}

/**
 * The submitted form and the resolved persona, combined into the profile the
 * pipeline plans from.
 *
 * This is the line where a persona stops being a stored row and starts changing
 * the trip. **Without one the submitted profile passes through untouched** —
 * `buildProfile` is never called, so a traveller who skipped the quiz gets the
 * plan this app produced before the quiz existed.
 *
 * With one, `buildProfile` owns the precedence and it is worth restating: the
 * form wins on dietary (a hard constraint is never inferred) and on pace (a
 * thing the user typed beats a thing the quiz inferred); the persona supplies
 * interests, a budget fallback, and the `typeAffinities` map that is its most
 * precise signal. The client's `profile.interests` are deliberately *not*
 * passed as overrides — they are the demo's placeholder, and treating a
 * placeholder as a choice is how the persona would end up changing nothing.
 *
 * **The answers go across too, not just the result.** Interests and type
 * affinities are read from the options the traveller actually chose, with the
 * archetype only topping up what they left unsaid — passing `persona.result`
 * alone silently falls back to archetype-only tastes, which is the failure
 * documented at the top of `profile.ts`.
 *
 * ## Saved preferences are the interest-picking UI this always expected
 *
 * `interestOverrides` has carried a comment since it was added saying it is
 * "the named seam for when there is" an interest-picking UI. The preferences
 * dialog is that UI, so a traveller's saved picks fill the seam rather than a
 * second mechanism being invented beside it. A caller that names overrides
 * explicitly still wins — nothing does today, but the parameter is public.
 *
 * The three things preferences contribute, and why each lands where it does:
 *
 * - **Interests** become overrides, because a picked tag is a stated choice
 *   and the archetype's list is an inference. Same rule as everywhere here.
 * - **Dietary is a union, never a replacement.** It is the one hard filter in
 *   the funnel, and dropping half of one is how somebody is seated at a
 *   steakhouse. The trip form and the saved set are both statements of need.
 * - **Type affinities merge, strongest opinion per type winning**, which is
 *   `deriveTypeAffinities`' rule and `typeAffinityBonus`' rule already. Both
 *   maps are on the same scale — 1.0 neutral, read as an offset — so this is a
 *   merge and not a conversion.
 *
 * Pace and budget are deliberately **not** taken from preferences. Their values
 * there are derived from the persona by `buildPreferenceProfile`, so taking
 * them would be reading the persona through a stale copy; the persona itself is
 * right here, and the trip form beats both anyway.
 */
function composeProfile(
  submitted: PreferenceProfile,
  persona: TravelPersona | undefined,
  interestOverrides: Interest[] | undefined,
  preferences: SavedTravelPreferences | undefined,
): PreferenceProfile {
  const picked = preferences?.profile;
  const dietary = [...new Set([...submitted.dietary, ...(picked?.dietary ?? [])])];
  const overrides =
    interestOverrides ?? (picked?.interests.length ? picked.interests : undefined);

  // No persona: the submitted profile passes through as it always did, with the
  // saved picks layered on. A traveller who set preferences but skipped the
  // quiz must still get them — routing everything through `buildProfile` would
  // silently drop them, because that function needs a persona to run at all.
  if (!persona) {
    return {
      ...submitted,
      dietary,
      ...(overrides ? { interests: overrides } : {}),
      ...(picked?.typeAffinities
        ? { typeAffinities: mergeAffinities(submitted.typeAffinities, picked.typeAffinities) }
        : {}),
    };
  }

  const composed = buildProfile(
    persona.result,
    {
      // `buildProfile` takes these for symmetry with the bridge doc; nothing in
      // the profile it returns reads either.
      city: "",
      totalDays: 0,
      dietary,
      pace: submitted.pace,
      budget: submitted.budget,
      ...(overrides ? { interestOverrides: overrides } : {}),
    },
    persona.answers,
  );

  if (!picked?.typeAffinities) return composed;
  return {
    ...composed,
    typeAffinities: mergeAffinities(composed.typeAffinities, picked.typeAffinities),
  };
}

/**
 * Two affinity maps into one, **strongest opinion per type winning**.
 *
 * The same rule `deriveTypeAffinities` uses to layer answers onto an archetype
 * preset, and the same one `typeAffinityBonus` uses when a place carries
 * several mapped types. Resolving it three ways would mean three answers to
 * "this traveller's strongest feeling about a museum".
 *
 * 1.0 is neutral on both sides, so distance from 1 is the strength.
 */
function mergeAffinities(
  base: Record<string, number> | undefined,
  extra: Record<string, number>,
): Record<string, number> {
  const merged: Record<string, number> = { ...base };
  for (const [type, weight] of Object.entries(extra)) {
    const current = merged[type];
    if (current === undefined || Math.abs(weight - 1) > Math.abs(current - 1)) {
      merged[type] = weight;
    }
  }
  return merged;
}

/**
 * The background half. Never throws: every exit writes a terminal status onto
 * the job row, because a job that stops reporting is indistinguishable from one
 * that is still running and the client will poll it forever.
 *
 * Not exported — a route file may only export its handler and Next's config
 * fields.
 */
async function runPlanJob(
  jobId: string,
  planRequest: PlanRequest,
  deps: PlanRouteDeps,
  ownerId: string,
): Promise<JobRow | undefined> {
  const write = async (progress: PlanProgress) => {
    const now = deps.now();
    await deps.store.updateJob(
      jobId,
      { status: "processing", progress: toJobProgress(progress, now) },
      now,
    );
  };

  let result: PlanResult;
  try {
    result = await deps.runPlan(planRequest, {
      googleApiKey: deps.googleApiKey,
      cache: deps.cache,
      store: deps.locations,
      enrichments: deps.enrichments,
      responses: deps.responses,
      fetch: deps.fetch,
      blobs: deps.blobs,
      now: deps.now(),
      rng: deps.rng,
      onProgress: write,
    });
  } catch (error) {
    // The provider's own words are for the log, never for the user: a raw
    // "OpenAI 429 rate_limit_exceeded" tells them nothing and leaks our stack.
    console.error(`[plan ${jobId}] the pipeline failed`, error);
    const now = deps.now();
    return deps.store.updateJob(
      jobId,
      { status: "failed", error: getFriendlyApiError(error, PLAN_FAILED_MESSAGE) },
      now,
    );
  }

  try {
    await write(saveProgress());
    const { itineraryId } = await deps.store.saveItinerary(result, ownerId);
    await saveCompanionCollection(itineraryId, ownerId, deps);
    const now = deps.now();
    return await deps.store.updateJob(
      jobId,
      {
        status: "completed",
        itinerary_id: itineraryId,
        progress: toJobProgress(completedProgress(), now),
        result: { itinerary_id: itineraryId, stats: result.stats },
        error: null,
      },
      now,
    );
  } catch (error) {
    console.error(`[plan ${jobId}] the itinerary could not be saved`, error);
    const now = deps.now();
    return deps.store.updateJob(
      jobId,
      { status: "failed", error: getFriendlyApiError(error, PLAN_FAILED_MESSAGE) },
      now,
    );
  }
}

/**
 * The finished trip's own collection: every place it scheduled, on one shelf.
 *
 * It runs here rather than inside `saveItinerary` for the same reason the owner
 * is passed in rather than looked up — the planner never learns that users or
 * shelves exist, and a companion collection is a product decision that belongs
 * where somebody can see it.
 *
 * **A failed shelf must not fail the trip.** The itinerary is already written
 * and is the thing the traveller asked for; losing its companion costs a
 * convenience and is logged, exactly the ladder `resolvePersona` and
 * `resolvePreferences` above already follow. It is also why this is awaited but
 * not inside the `try` that owns the save — a throw here would mark a job
 * `failed` over a trip that saved perfectly.
 */
async function saveCompanionCollection(
  itineraryId: string,
  ownerId: string,
  deps: PlanRouteDeps,
): Promise<void> {
  try {
    const created = await deps.collections.createItineraryCollection(
      itineraryId,
      ownerId,
      deps.now(),
    );
    // Undefined means the trip has no located stops, so there was nothing to
    // put on a shelf. An empty collection beside a trip reads as "this trip
    // saved nothing", which is a different and wrong statement.
    if (!created) {
      console.warn(
        `[plan] itinerary ${itineraryId} has no located stops — no companion collection`,
      );
    }
  } catch (error) {
    console.error(
      `[plan] the companion collection for itinerary ${itineraryId} could not be created`,
      error,
    );
  }
}

/**
 * Saving is the one stage `runPlan` does not own, so the handler reports it —
 * off the same stage table, which is what stops the bar jumping backwards
 * between the pipeline's last report and this one.
 */
function saveProgress(): PlanProgress {
  const outlook = stageOutlook("save");
  return {
    stage: "save",
    label: "Saving your itinerary",
    percent: outlook.percent,
    done: outlook.index,
    total: completedProgress().total,
  };
}
