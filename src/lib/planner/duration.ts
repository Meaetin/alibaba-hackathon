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

function fromScalar(preferred: number): VisitDuration {
  return {
    min: Math.round(preferred * SPREAD.min),
    preferred,
    max: Math.round(preferred * SPREAD.max),
  };
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
    base = { min: low, preferred: Math.round((low + high) / 2), max: high };
  } else {
    base = fromScalar(fromTypeHeuristic(place) ?? DEFAULT_VISIT_MINUTES);
  }

  const preferred = Math.min(
    base.max,
    Math.max(base.min, Math.round(base.preferred * PACE_MULTIPLIERS[pace])),
  );
  return { ...base, preferred };
}
