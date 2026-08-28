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
import {
  completedProgress,
  stageOutlook,
  type PlanProgress,
  type PlanRequest,
  type PlanResult,
} from "@/lib/planner/pipeline";

import { planRouteDeps, type PlanRouteDeps } from "../deps";

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
  /**
   * The row in `travel_personas`, not the persona itself. In the body rather
   * than a cookie on purpose: `route.test.ts` drives this handler through the
   * `planRouteDeps` seam with no database and no network, and a cookie would
   * need a second seam for request headers.
   */
  personaId: z.string().uuid().optional(),
  /**
   * How a day is decided. The **client** chooses, not the library: `runPlan`
   * defaults to `"geographic"` so that "no mode means today, exactly" stays
   * true for every test and every caller, and the product default lives where
   * the product is. `createItineraryRouted` sends `"themed"`.
   */
  mode: z.enum(["geographic", "themed"]).optional(),
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

  const { personaId, interestOverrides, ...trip } = parsed.data;
  const persona = await resolvePersona(personaId, deps);
  const planRequest: PlanRequest = {
    ...trip,
    profile: composeProfile(trip.profile, persona, interestOverrides),
    ...(persona ? { persona } : {}),
  };

  // The payload is the request as accepted, so a client reading the job row
  // back can see exactly what it asked for.
  const job = await deps.store.createJob({ payload: parsed.data, now: deps.now() });

  // Deliberately not awaited: the response goes out now and the local Node
  // process continues the plan behind it.
  void runPlanJob(job.id, planRequest, deps);

  return Response.json(job, { status: 202 });
}

/**
 * Turns the id on the wire into the thing the pipeline reads.
 *
 * The result is rebuilt with `calculatePersona` from the stored answers rather
 * than assembled from the stored `dimensions` and `archetype` columns: the
 * answers are the source of truth, and rebuilding is what makes a scoring
 * change reach every traveller without re-asking anyone twelve questions.
 *
 * **An unresolvable persona plans without one.** A stale `localStorage` id, or
 * a database that has been wiped, must not cost the traveller their trip —
 * absent persona is a supported path with a test on it, so the fallback is the
 * ordinary behaviour rather than a degraded one. It is logged, not surfaced.
 */
async function resolvePersona(
  personaId: string | undefined,
  deps: PlanRouteDeps,
): Promise<TravelPersona | undefined> {
  if (!personaId) return undefined;
  try {
    const row = await deps.personas.get(personaId);
    if (!row) {
      console.warn(`[POST /api/plan] persona ${personaId} was not found — planning without it`);
      return undefined;
    }
    if (!isScorableAnswers(row.answers)) {
      console.error(`[POST /api/plan] persona ${personaId} has answers this quiz cannot score`);
      return undefined;
    }
    return { answers: row.answers, result: calculatePersona(row.answers) };
  } catch (error) {
    console.error(`[POST /api/plan] persona ${personaId} could not be read`, error);
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
 */
function composeProfile(
  submitted: PreferenceProfile,
  persona: TravelPersona | undefined,
  interestOverrides: Interest[] | undefined,
): PreferenceProfile {
  if (!persona) return submitted;
  return buildProfile(
    persona.result,
    {
      // `buildProfile` takes these for symmetry with the bridge doc; nothing in
      // the profile it returns reads either.
      city: "",
      totalDays: 0,
      dietary: submitted.dietary,
      pace: submitted.pace,
      budget: submitted.budget,
      ...(interestOverrides ? { interestOverrides } : {}),
    },
    persona.answers,
  );
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
    const { itineraryId } = await deps.store.saveItinerary(result);
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
