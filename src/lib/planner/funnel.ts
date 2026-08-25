/**
 * The candidate funnel — staged, deterministic, logged narrowing between
 * retrieval and the LLM. See "The Candidate Funnel" and "Degradation Ladders"
 * in `docs/personalization-pipeline.md`.
 *
 *   retrieved → hard filters → per-cluster cap → global cap + quotas
 *
 * The LLM never sees more than the global cap (~60): beyond that, ranking
 * gets inconsistent and picks become undebuggable. Every stage's survivors
 * and count are exposed (`stages` / `stats`) — `funnel_stats` is persisted on
 * the itinerary row for replayability.
 *
 * Also home to the set-level picks the funnel owns: the serendipity slot and
 * the two degradation ladders (dietary, budget). Every hard rule here has a
 * documented failure path, or a thin city breaks the whole run.
 */

import { DEFAULT_SCORING_KNOBS, type PlannerKnobs, type ScoringKnobs } from "./knobs";
import type { CandidatePlace, PreferenceProfile } from "./types";
import type { PlaceCluster } from "./cluster";
import type { DayTheme } from "./theme";
import {
  affinity,
  hardFilterReason,
  matchedInterests,
  scorePlace,
  type ScoredPlace,
} from "./score";
import { dietaryBridgeFor, isRestaurant } from "./taxonomy";

// ── staged narrowing ─────────────────────────────────────────────────────────

export interface FunnelOptions {
  /** Top-N by score kept within each cluster. Prevents one dense district
   *  starving every other neighborhood. */
  perClusterCap?: number;
  /** Size of the shortlist the LLM sees. */
  globalCap?: number;
  /** Max fraction of the global cap that may be restaurants. */
  maxRestaurantShare?: number;
  /** Max places sharing one cuisine type (`*_restaurant`). */
  maxPerCuisine?: number;
  /**
   * Meal-capable places reserved for **each** cluster before the global cap is
   * spent. Without it the global cap is a single greedy walk down one ranked
   * pool, so the best-scored restaurants all land in whichever neighborhoods
   * are dense and a thin cluster gets none — which is not a shortlist that can
   * become a day. Two: lunch and dinner.
   */
  mealsPerCluster?: number;
  /**
   * Candidates clustering could not place (no lat/lng). Passed in so
   * `stats.retrieved` counts everything retrieval produced and every drop has
   * a recorded reason — otherwise they vanish between the two modules.
   */
  unlocated?: readonly CandidatePlace[];
  /**
   * The traveller's resolved knobs. Only the scoring subset is read here; the
   * default is today's constants, so a funnel run without a persona narrows
   * exactly as it always did.
   */
  knobs?: ScoringKnobs;
  /**
   * The input clusters are already one per day, in day order — keep them that
   * way, empties included.
   *
   * Off by default, and the default is the old behaviour: geographic clusters
   * carry no day of their own, so the funnel ranks them and the best
   * neighbourhood becomes day one. A **themed** cluster carries `theme.dayIndex`,
   * and re-ranking would put day three's premise on day one. Dropping an empty
   * one would silently renumber every day after it, which is worse.
   */
  dayAligned?: boolean;
}

export const FUNNEL_DEFAULTS = {
  perClusterCap: 20,
  globalCap: 60,
  maxRestaurantShare: 0.4,
  maxPerCuisine: 3,
  mealsPerCluster: 2,
  unlocated: [],
  knobs: DEFAULT_SCORING_KNOBS,
  dayAligned: false,
} as const satisfies Required<FunnelOptions>;

/** Stage names double as the stats keys: a new stage added to `FunnelStages`
 *  is a compile error until it has a stat, and the tests loop over the keys. */
export type FunnelStage = "retrieved" | "afterFilters" | "afterClusterCap" | "afterGlobalCap";

export type FunnelStats = Record<FunnelStage, number>;

/** Why one candidate didn't make the shortlist. Invariant 8: every drop has one. */
export interface DroppedCandidate {
  placeId: string;
  /** The stage whose survivor list this place is absent from. */
  stage: Exclude<FunnelStage, "retrieved">;
  reason: string;
}

/**
 * A cluster as Pass B receives it: its shortlisted members, grouped, plus the
 * `cluster_score` that orders them. Pass B assigns roughly one cluster per
 * day, so grouping must survive the funnel — a flat shortlist would force the
 * caller to re-derive membership by joining on placeId.
 */
export interface ScoredCluster {
  centroid: PlaceCluster["centroid"];
  /**
   * What this day is about, when the theme pass named it. Carried through the
   * funnel untouched so Pass B and Pass C can read a premise the funnel had no
   * opinion about — absent on the geographic path, which is every trip that
   * did not ask for themes.
   */
  theme?: DayTheme;
  /** Neighborhood name. Still unfilled here — nothing in the deterministic
   *  core knows one; Pass B or a reverse-geocode fills it later. */
  label?: string;
  /** `cluster_score` — see `scoreCluster`. */
  score: number;
  /** Shortlisted members of this cluster, best-first. */
  places: CandidatePlace[];
  /**
   * Set when this cluster cannot furnish a whole day — today, when it holds no
   * restaurant to seat a meal in. A day built from it will be missing something,
   * and the caller is told so here rather than discovering it in the timeline.
   */
  shortfall?: string;
  /** The same members scored, index-aligned with `places`. */
  scored: ScoredPlace[];
}

export interface FunnelResult {
  /** Survivors of each stage, in stage order. `afterGlobalCap` is the shortlist. */
  stages: Record<FunnelStage, CandidatePlace[]>;
  /** The shortlist scored and sorted best-first, ready for Pass B. */
  shortlist: ScoredPlace[];
  /** The same shortlist grouped by cluster, best cluster first. Pass B's input. */
  clusters: ScoredCluster[];
  /** Every candidate that didn't survive, with the stage and reason. */
  dropped: DroppedCandidate[];
  /** Persisted as `funnel_stats` on the itinerary row. */
  stats: FunnelStats;
}

/** Specific cuisine types ("ramen_restaurant"), not the generic "restaurant". */
function cuisineTypes(place: CandidatePlace): string[] {
  return place.types.filter((t) => t.endsWith("_restaurant"));
}

/**
 * `cluster_score` — what orders neighborhoods before individual places, the
 * way humans plan a big city ("Day 1 = Asakusa/Ueno" before comparing
 * museums). Mean of the top few place scores, plus two bonuses:
 *
 *   + interest coverage — does this cluster serve MY interests, or just one?
 *   + variety           — is there a mix of activity, food and cafe, or is it
 *                         twenty restaurants in a row?
 *
 * Both bonuses are deliberately SMALL. They exist to break ties on set-level
 * properties a per-place score cannot see — five cafes cover one interest, a
 * cafe and a temple cover two at the same mean score — not to override place
 * quality. Interest matching is already priced into every place score at
 * `WEIGHTS.affinity` (0.4); size these up and you double-count it, and a
 * cluster of 2.5★ places wins on variety alone.
 */
export const CLUSTER_SCORE_WEIGHTS = {
  coverage: 0.06,
  variety: 0.04,
} as const;

/** How many of a cluster's best places set its base score. */
export const CLUSTER_SCORE_TOP_N = 5;

/** The three roles a day wants represented. `cafe` before `food`: a cafe is
 *  often typed `restaurant` too, and it plays the cafe role. */
const CLUSTER_ROLES = ["activity", "food", "cafe"] as const;

function roleOf(place: CandidatePlace): (typeof CLUSTER_ROLES)[number] {
  if (place.types.some((t) => t === "cafe" || t === "coffee_shop")) return "cafe";
  if (isRestaurant(place)) return "food";
  return "activity";
}

export function scoreCluster(
  places: readonly CandidatePlace[],
  profile: PreferenceProfile,
  knobs: ScoringKnobs = DEFAULT_SCORING_KNOBS,
): number {
  if (places.length === 0) return 0;

  const top = places
    .map((place) => scorePlace(place, profile, knobs).score)
    .sort((a, b) => b - a)
    .slice(0, CLUSTER_SCORE_TOP_N);
  const base = top.reduce((sum, s) => sum + s, 0) / top.length;

  const covered = new Set(places.flatMap((p) => matchedInterests(p, profile.interests)));
  const coverage =
    profile.interests.length === 0 ? 0 : covered.size / profile.interests.length;

  const roles = new Set(places.map(roleOf));
  const variety = roles.size / CLUSTER_ROLES.length;

  return (
    base + CLUSTER_SCORE_WEIGHTS.coverage * coverage + CLUSTER_SCORE_WEIGHTS.variety * variety
  );
}

/**
 * Runs the deterministic funnel over clustered candidates. Never random,
 * never an LLM: hard filters, then top-N per cluster by Stage 3 score, then
 * a global cap with per-type quotas so the shortlist isn't all restaurants.
 *
 * Cluster membership survives to `result.clusters` — Pass B assigns one
 * cluster per day and cannot re-derive it from a flat list.
 */
export function runFunnel(
  clusters: readonly (PlaceCluster & { theme?: DayTheme })[],
  profile: PreferenceProfile,
  options: FunnelOptions = {},
): FunnelResult {
  const { perClusterCap, globalCap, maxRestaurantShare, maxPerCuisine, mealsPerCluster, unlocated, knobs, dayAligned } = {
    ...FUNNEL_DEFAULTS,
    ...options,
  };

  const clustered = clusters.flatMap((c) => c.places);
  const retrieved = [...clustered, ...unlocated];
  const dropped: DroppedCandidate[] = unlocated.map((place) => ({
    placeId: place.placeId,
    stage: "afterFilters",
    reason: "no coordinates — cannot be placed in a day",
  }));

  // Stage: hard filters (closed, off-budget; dietary is meal-slot-only and
  // belongs to `selectMealCandidates`) — cluster-agnostic.
  const filteredByCluster = clusters.map((cluster) =>
    cluster.places.filter((place) => {
      const reason = hardFilterReason(place, profile);
      if (reason === undefined) return true;
      dropped.push({ placeId: place.placeId, stage: "afterFilters", reason });
      return false;
    }),
  );
  const afterFilters = filteredByCluster.flat();

  // Stage: per-cluster cap — score, keep top N within each cluster.
  const scores = new Map<string, ScoredPlace>();
  const cappedByCluster = filteredByCluster.map((places) => {
    const ranked = places
      .map((place) => {
        const scored = scorePlace(place, profile, knobs);
        scores.set(place.placeId, scored);
        return { place, scored };
      })
      .sort((a, b) => b.scored.score - a.scored.score);
    for (const { place } of ranked.slice(perClusterCap)) {
      dropped.push({
        placeId: place.placeId,
        stage: "afterClusterCap",
        reason: `outside the top ${perClusterCap} of its cluster`,
      });
    }
    return ranked.slice(0, perClusterCap).map(({ place }) => place);
  });
  const afterClusterCap = cappedByCluster.flat();

  const clusterOfPlace = new Map<string, number>();
  cappedByCluster.forEach((places, index) => {
    for (const place of places) clusterOfPlace.set(place.placeId, index);
  });

  // Stage: global cap + quotas — greedy walk down the ranked pool; a place is
  // skipped (not ended on) when it would bust a quota, so the highest-scored
  // non-restaurants always get their look.
  //
  // The restaurant quota is denominated in the CAP, not in the eventual output
  // length: in a thin city where non-restaurants run out, 24 restaurants out
  // of 34 beats a shortlist of 16 that starves Pass B of anything to choose.
  const ranked = [...afterClusterCap].sort(
    (a, b) => scores.get(b.placeId)!.score - scores.get(a.placeId)!.score,
  );
  const restaurantCap = Math.floor(globalCap * maxRestaurantShare);
  const afterGlobalCap: CandidatePlace[] = [];
  let restaurantCount = 0;
  const cuisineCounts = new Map<string, number>();

  // Every cluster's best few restaurants are claimed up front and admitted
  // ahead of the greedy walk, so a day in a quiet neighborhood still gets fed.
  // They're taken from the ranked pool, not added to it — the cap is unchanged.
  const reserved = new Set<string>();
  for (const places of cappedByCluster) {
    for (const place of places
      .filter(isRestaurant)
      .sort((a, b) => scores.get(b.placeId)!.score - scores.get(a.placeId)!.score)
      .slice(0, mealsPerCluster)) {
      reserved.add(place.placeId);
    }
  }
  for (const place of ranked) {
    if (!reserved.has(place.placeId)) continue;
    restaurantCount += 1;
    for (const c of cuisineTypes(place)) cuisineCounts.set(c, (cuisineCounts.get(c) ?? 0) + 1);
    afterGlobalCap.push(place);
  }

  for (const place of ranked) {
    if (reserved.has(place.placeId)) continue;
    if (afterGlobalCap.length >= globalCap) {
      dropped.push({
        placeId: place.placeId,
        stage: "afterGlobalCap",
        reason: `outside the global cap of ${globalCap}`,
      });
      continue;
    }
    if (isRestaurant(place)) {
      if (restaurantCount >= restaurantCap) {
        dropped.push({
          placeId: place.placeId,
          stage: "afterGlobalCap",
          reason: `restaurant quota full (${restaurantCap})`,
        });
        continue;
      }
      const cuisines = cuisineTypes(place);
      const full = cuisines.find((c) => (cuisineCounts.get(c) ?? 0) >= maxPerCuisine);
      if (full !== undefined) {
        dropped.push({
          placeId: place.placeId,
          stage: "afterGlobalCap",
          reason: `cuisine quota full: ${maxPerCuisine}× ${full}`,
        });
        continue;
      }
      restaurantCount += 1;
      for (const c of cuisines) cuisineCounts.set(c, (cuisineCounts.get(c) ?? 0) + 1);
    }
    afterGlobalCap.push(place);
  }

  // Regroup the shortlist by cluster, best cluster first. Empty clusters are
  // omitted — a day cannot be built from one.
  // The reserved pre-pass admitted meals out of turn; the shortlist Pass B sees
  // is score-ordered regardless of how a place earned its slot.
  afterGlobalCap.sort((a, b) => scores.get(b.placeId)!.score - scores.get(a.placeId)!.score);

  const shortlisted = new Set(afterGlobalCap.map((p) => p.placeId));
  const scoredClusters: ScoredCluster[] = clusters
    .map((cluster, index) => {
      const members = (cappedByCluster[index] ?? []).filter((p) => shortlisted.has(p.placeId));
      const meals = members.filter(isRestaurant).length;
      return {
        centroid: cluster.centroid,
        label: cluster.label,
        ...(cluster.theme ? { theme: cluster.theme } : {}),
        score: scoreCluster(members, profile, knobs),
        places: members,
        scored: members.map((p) => scores.get(p.placeId)!),
        ...(meals < mealsPerCluster
          ? {
              shortfall: `only ${meals} place${meals === 1 ? "" : "s"} to eat; a day here cannot seat ${mealsPerCluster} meals`,
            }
          : {}),
      };
    })
    .filter((c) => dayAligned || c.places.length > 0);
  if (!dayAligned) scoredClusters.sort((a, b) => b.score - a.score);

  return {
    stages: { retrieved, afterFilters, afterClusterCap, afterGlobalCap },
    shortlist: afterGlobalCap.map((p) => scores.get(p.placeId)!),
    clusters: scoredClusters,
    dropped,
    stats: {
      retrieved: retrieved.length,
      afterFilters: afterFilters.length,
      afterClusterCap: afterClusterCap.length,
      afterGlobalCap: afterGlobalCap.length,
    },
  };
}

// ── serendipity slot ─────────────────────────────────────────────────────────

/** Review-count ceiling for "great but not famous". */
export const SERENDIPITY_MAX_REVIEWS = 500;

/**
 * One wildcard per day: the highest-scoring candidate below the review-count
 * threshold that still matches ≥ 1 interest. NOT the old "zero type overlap"
 * rule — that's an anti-objective that resolves to a department store the
 * user never asked for. Unknown review counts don't qualify: "no evidence"
 * is not "hidden gem". Returns `undefined` when nothing qualifies; the day
 * is simply built without one.
 */
export function pickSerendipity(
  candidates: readonly CandidatePlace[],
  profile: PreferenceProfile,
  knobs: PlannerKnobs | ScoringKnobs = DEFAULT_SCORING_KNOBS,
  maxReviews: number = SERENDIPITY_MAX_REVIEWS,
): CandidatePlace | undefined {
  let best: CandidatePlace | undefined;
  let bestScore = -Infinity;
  for (const place of candidates) {
    if (place.userRatingCount == null || place.userRatingCount >= maxReviews) continue;
    if (affinity(place, profile.interests) === 0) continue;
    const { score } = scorePlace(place, profile, knobs);
    if (score > bestScore) {
      bestScore = score;
      best = place;
    }
  }
  return best;
}

/**
 * The trip's wildcards: the best few "great but not famous" places the funnel
 * shortlisted, one per call to `pickSerendipity` with the previous winners
 * removed so it cannot return the same place twice.
 *
 * `count` is `PlannerKnobs.serendipityPerTrip`, which is **zero without a
 * persona** — this planner has never shipped a wildcard, and "today's
 * behaviour" therefore means none. Only an `improvised` traveller asks for one.
 */
export function pickSerendipitySlots(
  candidates: readonly CandidatePlace[],
  profile: PreferenceProfile,
  knobs: PlannerKnobs,
): CandidatePlace[] {
  const picked: CandidatePlace[] = [];
  const taken = new Set<string>();
  for (let i = 0; i < knobs.serendipityPerTrip; i++) {
    const next = pickSerendipity(
      candidates.filter((place) => !taken.has(place.placeId)),
      profile,
      knobs,
      knobs.serendipityMaxReviews,
    );
    if (!next) break;
    taken.add(next.placeId);
    picked.push(next);
  }
  return picked;
}

// ── dietary degradation ladder ───────────────────────────────────────────────

export type DietaryRung = 1 | 2 | 3;

export interface MealSelection {
  places: CandidatePlace[];
  /** Which rung produced the places. Always present — a caller must never infer it. */
  rung: DietaryRung;
  /** Rung 3 only. Pass C turns this into a tip on the activity card. */
  caveat?: string;
}

/**
 * Descends the dietary ladder over a meal bucket (already hard-filtered):
 *   1. place types match the dietary bridge (`vegetarian_restaurant`, …)
 *   2. Google's own `servesVegetarianFood`, or enrichment tags saying
 *      `"{need}-friendly"` where Google is silent
 *   3. any restaurant in the bucket, surfaced with an explicit caveat
 * Never fails the day. A trip built on rung 3 says so — log the rung.
 *
 * Rung 2 asks Google before it asks the enrichment model, because the model is
 * inferring from review text what Google already states. Only `vegetarian` has
 * a Google field; `vegan` and everything else still rely on tags, since a place
 * serving vegetarian food is not thereby vegan.
 */
export function selectMealCandidates(
  bucket: readonly CandidatePlace[],
  profile: PreferenceProfile,
  enrichmentTags: Record<string, readonly string[]> = {},
): MealSelection {
  const needs = profile.dietary;
  if (needs.length === 0) return { places: [...bucket], rung: 1 };

  const rung1 = bucket.filter((place) =>
    needs.every(
      (need) => dietaryBridgeFor(need)?.types.some((t) => place.types.includes(t)) ?? false,
    ),
  );
  if (rung1.length > 0) return { places: rung1, rung: 1 };

  const rung2 = bucket.filter((place) => needs.every((need) => meetsAtRung2(place, need, enrichmentTags)));
  if (rung2.length > 0) return { places: rung2, rung: 2 };

  return {
    places: [...bucket],
    rung: 3,
    caveat: `limited ${needs.join("/")} options — call ahead`,
  };
}

/** Google's direct answer where it has one, the enrichment tag otherwise. */
function meetsAtRung2(
  place: CandidatePlace,
  need: string,
  enrichmentTags: Record<string, readonly string[]>,
): boolean {
  if (need === "vegetarian" && place.servesVegetarianFood !== undefined) {
    return place.servesVegetarianFood;
  }
  const tags = Object.hasOwn(enrichmentTags, place.placeId)
    ? enrichmentTags[place.placeId]
    : undefined;
  return tags?.includes(`${need}-friendly`) ?? false;
}

// ── budget degradation ladder ────────────────────────────────────────────────

/** Mirrors the hard-filter kill rule: this many steps above budget is out. */
const BUDGET_KILL_STEPS = 2;
const MAX_BUDGET = 4;

export interface BudgetWidening {
  places: CandidatePlace[];
  /** Match-reason-carrying scores at the effective (possibly widened) budget. */
  scored: ScoredPlace[];
  /** Steps the budget was widened to fill the bucket. 0 = stated budget worked. */
  widenedBy: number;
}

/**
 * When the budget empties a bucket, widen by exactly ONE `priceLevel` step
 * per iteration until something survives, and record the widening in the
 * survivors' match_reasons. A place needing two steps is never admitted when
 * one step already filled the bucket.
 */
export function widenBudget(
  bucket: readonly CandidatePlace[],
  profile: PreferenceProfile,
  knobs: PlannerKnobs | undefined = undefined,
): BudgetWidening {
  const budget = profile.budget;
  const scoring: ScoringKnobs = knobs ?? DEFAULT_SCORING_KNOBS;
  // How far the traveller will bend. Absent knobs means the old unbounded walk
  // to the top of the scale; a `polished` persona stops after one step, which
  // is the difference between "a bit dearer than I said" and "not what I asked
  // for at all".
  const maxSteps = knobs?.budgetWidenSteps ?? MAX_BUDGET;
  if (budget == null) {
    return {
      places: [...bucket],
      scored: bucket.map((p) => scorePlace(p, profile, scoring)),
      widenedBy: 0,
    };
  }

  for (let widenedBy = 0; budget + widenedBy <= MAX_BUDGET && widenedBy <= maxSteps; widenedBy++) {
    const effective = budget + widenedBy;
    const survivors = bucket.filter(
      (p) => p.priceLevel == null || p.priceLevel - effective < BUDGET_KILL_STEPS,
    );
    if (survivors.length === 0) continue;
    const scored = survivors.map((place) => {
      const s = scorePlace(place, profile, scoring);
      return widenedBy === 0
        ? s
        : { ...s, reasons: [...s.reasons, `budget widened by ${widenedBy}`] };
    });
    return { places: survivors, scored, widenedBy };
  }

  // Reachable now that widening is bounded: a `polished` traveller who allows
  // one step and finds nothing within it gets the whole bucket back rather than
  // an empty day. Never fail the day.
  return { places: [...bucket], scored: bucket.map((p) => scorePlace(p, profile, scoring)), widenedBy: 0 };
}
