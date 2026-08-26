/**
 * Stage 2 — what does this city actually have?
 *
 * A pure function over the retrieved pool. No model, no network, no clock. It
 * exists so the theme pass that follows is a **labelling problem over real
 * data** rather than an invention problem: a model handed a city name will
 * cheerfully propose a glassblowing quarter for a city with one glass shop,
 * and a model handed "area 3 holds 22 places, five of them serve food, and the
 * best-known are these four" cannot.
 *
 * ## Why the areas are geographic and unnamed
 *
 * Nothing in this pipeline geocodes, and nothing knows a neighbourhood name —
 * `formatted_address` is a locale-specific string that would need a different
 * parser per country to yield a ward. So an area here is a k-means cluster, and
 * instead of a name it carries its **landmarks**: the places in it a person
 * would actually use to say where it is. Naming is then the model's job, from
 * evidence, which is the one part of this it is good at.
 *
 * The clustering is the same `clusterPlaces` the old path uses, called with a
 * larger `k`. That is deliberate: the survey wants finer grain than one area
 * per day, because a theme may span two adjacent areas and cannot un-merge one
 * that was cut too coarse.
 */

import { clusterPlaces } from "./cluster";
import { isRestaurant } from "./taxonomy";
import type { CandidatePlace } from "./types";

/** How many of an area's best-known places are named to the model. */
export const LANDMARKS_PER_AREA = 4;
/** How many types the histogram reports before the tail is summarised. */
export const TOP_TYPES = 12;
/** Areas per day of the trip. Finer than the old one-cluster-per-day grain. */
export const AREAS_PER_DAY = 2;
/** Never fewer than this, or a short trip gets one area and no choice. */
export const MIN_AREAS = 4;
/** Never more than this: the survey is a prompt payload, not a data dump. */
export const MAX_AREAS = 16;

export interface SurveyLandmark {
  placeId: string;
  name: string;
  types: string[];
  userRatingCount?: number;
}

export interface SurveyArea {
  /** Position in `CitySurvey.areas`. What a theme's anchor is looked up against. */
  index: number;
  centroid: { latitude: number; longitude: number };
  placeCount: number;
  /** Places that could seat a meal. An area with none cannot hold a whole day. */
  mealCapableCount: number;
  /** Most common Places types here, commonest first. */
  topTypes: string[];
  /** The places a person would use to say where this is, best-known first. */
  landmarks: SurveyLandmark[];
}

export interface CitySurvey {
  city: string;
  totalPlaces: number;
  /** Places with no coordinates. They are in the pool and in no area. */
  unlocated: number;
  areas: SurveyArea[];
  typeHistogram: { type: string; count: number }[];
  /** Count per 0–4 price ordinal, index 0 = free. */
  priceSpread: number[];
  /** Places Google gave no price for — usually most of them. */
  unknownPrice: number;
}

export interface SurveyParams {
  city: string;
  totalDays: number;
  /** Injected, never `Math.random` — k-means++ seeding is the only consumer. */
  rng: () => number;
  /** Overrides the derived area count. Tests and the feasibility ladder use it. */
  areaCount?: number;
}

/**
 * The pool, summarised. Deterministic given the same `rng`, so a survey is as
 * reproducible as the plan built from it.
 */
export function surveyCity(
  pool: readonly CandidatePlace[],
  params: SurveyParams,
): CitySurvey {
  const located = pool.filter((place) => place.latitude !== undefined);
  const unlocated = pool.length - located.length;

  const k = Math.max(
    1,
    Math.min(
      params.areaCount ?? Math.max(MIN_AREAS, params.totalDays * AREAS_PER_DAY),
      MAX_AREAS,
      located.length,
    ),
  );
  const clusters = located.length > 0 ? clusterPlaces([...located], { k, rng: params.rng }) : [];

  return {
    city: params.city,
    totalPlaces: pool.length,
    unlocated,
    areas: clusters.map((cluster, index) => ({
      index,
      centroid: cluster.centroid,
      placeCount: cluster.places.length,
      mealCapableCount: cluster.places.filter(isRestaurant).length,
      topTypes: topTypesOf(cluster.places),
      landmarks: landmarksOf(cluster.places),
    })),
    typeHistogram: histogramOf(pool).slice(0, TOP_TYPES),
    priceSpread: priceSpreadOf(pool),
    unknownPrice: pool.filter((place) => place.priceLevel == null).length,
  };
}

/**
 * The best-known places in an area, by review count.
 *
 * Fame rather than score, deliberately: this list is how the model works out
 * *where* an area is, and the answer to "where is this" is the place everyone
 * has heard of — not the place this particular traveller would most enjoy.
 * A place with no review count sorts last rather than being excluded, so a
 * thinly-covered area still names something.
 */
function landmarksOf(places: readonly CandidatePlace[]): SurveyLandmark[] {
  return [...places]
    .sort((a, b) => (b.userRatingCount ?? -1) - (a.userRatingCount ?? -1))
    .slice(0, LANDMARKS_PER_AREA)
    .map((place) => ({
      placeId: place.placeId,
      name: place.name,
      types: place.types.slice(0, 3),
      ...(place.userRatingCount === undefined ? {} : { userRatingCount: place.userRatingCount }),
    }));
}

function topTypesOf(places: readonly CandidatePlace[]): string[] {
  return histogramOf(places)
    .slice(0, 5)
    .map((entry) => entry.type);
}

/** Ties broken by type name so the output is stable across runs. */
function histogramOf(places: readonly CandidatePlace[]): { type: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const place of places) {
    for (const type of place.types) counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

/** Five buckets, one per `priceLevel` ordinal. Unknown prices are counted
 *  separately — an absent price is not a free place. */
function priceSpreadOf(places: readonly CandidatePlace[]): number[] {
  const spread = [0, 0, 0, 0, 0];
  for (const place of places) {
    if (place.priceLevel == null) continue;
    spread[place.priceLevel] += 1;
  }
  return spread;
}
