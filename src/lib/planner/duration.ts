/**
 * Visit-duration resolution — the "Stay Duration: Resolution Ladder" in
 * `docs/personalization-pipeline.md`:
 *
 *   1. `locations.stay_duration` where present
 *   2. Enriched estimate (`avgVisitMinutes` range from the cached LLM pass)
 *   3. Type heuristic table (cafe 45, temple 45, museum 90, hike 120, …)
 *   4. Global default
 *
 * Pace is NOT a rung: it's a multiplier applied to `preferred` after the
 * ladder resolves, and it never pushes `preferred` outside [min, max] — the
 * packer relies on those bounds being honest.
 *
 * Every number that leaves here is a multiple of `VISIT_STEP_MINUTES`. Nothing
 * upstream measures a visit to the minute — the type table is round numbers, a
 * model answers in round numbers, and `stay_duration` is somebody's estimate —
 * so a 43-minute visit was never a fact, only the arithmetic of a 0.85 pace
 * multiplier and a packer growing a stop one minute at a time until the day
 * filled. Rounding at the source is what lets the packer keep every start and
 * end on a clock face a person would write down.
 */

import type { CandidatePlace, Pace, PlaceEnrichment } from "./types";

/** Elastic-slot duration: the packer shrinks toward `min` when a day is over
 *  budget and stretches toward `max` when it's under. */
export interface VisitDuration {
  /** Floor — below this the visit isn't worth it. */
  min: number;
  preferred: number;
  /** Relaxed-pace ceiling. */
  max: number;
}

/**
 * The grain of the whole schedule. Visits, travel legs and the packer's
 * squeeze-and-grow all move in multiples of this, so every stamped time lands
 * on :00, :05, :10 and so on.
 *
 * Five and not fifteen: a quarter-hour grain would round a 45-minute cafe to an
 * hour and cost a stop a day. Five is under the precision anything here
 * actually has, so it throws nothing away.
 */
export const VISIT_STEP_MINUTES = 5;

/** Rounds to the nearest step, never below one whole step. */
export function toStep(minutes: number): number {
  return Math.max(VISIT_STEP_MINUTES, Math.round(minutes / VISIT_STEP_MINUTES) * VISIT_STEP_MINUTES);
}

/** Rounds up. For travel, where promising an earlier arrival than the route
 *  allows is the failure that matters. */
export function ceilToStep(minutes: number): number {
  return Math.max(0, Math.ceil(minutes / VISIT_STEP_MINUTES) * VISIT_STEP_MINUTES);
}

export const PACE_MULTIPLIERS: Record<Pace, number> = {
  relaxed: 1.2,
  balanced: 1.0,
  packed: 0.85,
};

/** Rung 4: what a place resolves to when nothing else knows better. */
export const DEFAULT_VISIT_MINUTES = 60;

/**
 * Rung 3, keyed by Google Places type. Same vocabulary as the taxonomy
 * bridge. First match wins scanning `primaryType` then `types` in order.
 */
export const TYPE_DURATION_MINUTES: Record<string, number> = {
  cafe: 45,
  coffee_shop: 45,
  place_of_worship: 45, // temples & shrines
  historical_landmark: 45,
  monument: 30,
  museum: 90,
  art_gallery: 75,
  hiking_area: 120,
  national_park: 120,
  park: 60,
  botanical_garden: 60,
  garden: 45,
  shopping_mall: 60,
  department_store: 60,
  market: 60,
  restaurant: 75,
  bar: 60,
};

/** min/max spread applied when a rung yields a single number (rungs 1, 3, 4). */
const SPREAD = { min: 2 / 3, max: 1.5 } as const;

/**
 * How much longer than `preferred` a visit may ever be planned.
 *
 * `max` was `preferred * 1.5`, which punishes the longest stops hardest —
 * exactly backwards. Measured on a live relaxed Singapore day: a 195-minute
 * national gallery became 293 minutes, a 135-minute restaurant became 203, and
 * four stops totalled 711 minutes against a 660-minute day *before a single
 * minute of travel*. A stop that already runs three hours does not need another
 * ninety; a forty-five minute cafe can absorb a little more.
 *
 * So the rule is **half again, but never more than half an hour longer**. It
 * cannot lengthen any visit relative to the old multiplier — it only stops the
 * long tail running away, which is why short stops are untouched.
 */
export const MAX_LIFT_MINUTES = 30;

/** The ceiling of a visit's elastic range, given where it prefers to sit. */
export function maxFor(preferred: number): number {
  return preferred + Math.min(Math.round(preferred * (SPREAD.max - 1)), MAX_LIFT_MINUTES);
}

function fromScalar(preferred: number): VisitDuration {
  return quantizeDuration({
    min: Math.round(preferred * SPREAD.min),
    preferred,
    max: maxFor(preferred),
  });
}

/**
 * Snaps a duration to the step grid, keeping `min <= preferred <= max`.
 *
 * The ordering has to survive the rounding: a range like [42, 43, 44] must not
 * come back with `min` above `preferred`, because the packer treats those
 * bounds as honest and squeezes against them.
 *
 * Exported because `pack.ts` applies it again on the way in. Every production
 * duration already comes from this module and is already on the grid, so that
 * second call is a no-op — but the packer is the only thing in the pipeline
 * that stamps a clock, and "every time is on the grid" has to be its own
 * guarantee rather than a promise it inherits from whoever called it.
 */
export function quantizeDuration(duration: VisitDuration): VisitDuration {
  const min = toStep(duration.min);
  const preferred = Math.max(min, toStep(duration.preferred));
  return { min, preferred, max: Math.max(preferred, toStep(duration.max)) };
}

function fromTypeHeuristic(place: CandidatePlace): number | undefined {
  if (place.primaryType && Object.hasOwn(TYPE_DURATION_MINUTES, place.primaryType)) {
    return TYPE_DURATION_MINUTES[place.primaryType];
  }
  const match = place.types.find((t) => Object.hasOwn(TYPE_DURATION_MINUTES, t));
  return match === undefined ? undefined : TYPE_DURATION_MINUTES[match];
}

/**
 * Resolves how long a visit should take: ladder first, then the pace
 * multiplier on `preferred`, clamped to [min, max]. Always returns finite
 * positive minutes — the fallback rung guarantees it.
 */
export function resolveVisitDuration(
  place: CandidatePlace,
  enrichment: Pick<PlaceEnrichment, "avgVisitMinutes"> | undefined,
  pace: Pace,
): VisitDuration {
  let base: VisitDuration;
  if (place.stayDuration != null && place.stayDuration > 0) {
    base = fromScalar(place.stayDuration);
  } else if (enrichment) {
    const [low, high] = enrichment.avgVisitMinutes;
    // The model answers with a range and is capped by the same rule, so
    // "90 to 300 minutes" cannot buy a five-hour stop that no other rung could.
    const preferred = Math.round((low + high) / 2);
    base = quantizeDuration({ min: low, preferred, max: Math.min(high, maxFor(preferred)) });
  } else {
    base = fromScalar(fromTypeHeuristic(place) ?? DEFAULT_VISIT_MINUTES);
  }

  const preferred = Math.min(
    base.max,
    Math.max(base.min, toStep(base.preferred * PACE_MULTIPLIERS[pace])),
  );
  return { ...base, preferred };
}
