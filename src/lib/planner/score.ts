/**
 * Stage 3 — deterministic scoring. Rank in code first: auditable, debuggable,
 * free. See "Stage 3" in `docs/personalization-pipeline.md`.
 *
 *   score = w1·affinity + w2·quality + w3·priceFit
 *
 * (The doc's −w4·duplication term is a set-level concern — the funnel's
 * per-type quotas own it; a single place can't know it's a duplicate.)
 *
 * Hard filters run FIRST: a permanently closed place or a dietary violation
 * is not a low score, it's a system failure. `scorePlace` is never handed a
 * filtered-out place — use `scoreCandidates` for list-level scoring.
 */

import type { PriceLevelOrdinal } from "@/lib/maps/price-level";
import type { BudgetLevel, CandidatePlace, Interest, PreferenceProfile } from "./types";
import { bridgeFor } from "./taxonomy";

export interface ScoredPlace {
  placeId: string;
  score: number;
  /** Raw material for the "why this place" UX. Never empty for a survivor. */
  reasons: string[];
}

/**
 * Component weights, in one place so a tuning change is a one-line diff and
 * the tests stay written as comparisons, not absolutes.
 */
export const WEIGHTS = {
  affinity: 0.4,
  quality: 0.35,
  priceFit: 0.25,
} as const;

// ── quality ─────────────────────────────────────────────────────────────────

/** Prior mean rating (the Bayesian C). An unrated place is assumed average. */
export const QUALITY_PRIOR_MEAN = 3.8;
/** Prior strength in review-count units (the Bayesian m). */
export const QUALITY_PRIOR_WEIGHT = 50;

/**
 * Bayesian-average rating on the 0–5 scale: `(rating·n + C·m) / (n + m)`.
 * Otherwise a 5.0★ with 4 reviews beats a 4.6★ with 8,000.
 */
export function quality(rating: number | undefined, userRatingCount: number | undefined): number {
  if (rating == null) return QUALITY_PRIOR_MEAN;
  const n = userRatingCount ?? 0;
  return (
    (rating * n + QUALITY_PRIOR_MEAN * QUALITY_PRIOR_WEIGHT) / (n + QUALITY_PRIOR_WEIGHT)
  );
}

// ── affinity ─────────────────────────────────────────────────────────────────

/** Interests whose bridge types overlap the place's types. */
export function matchedInterests(place: CandidatePlace, interests: readonly Interest[]): Interest[] {
  return interests.filter((interest) =>
    bridgeFor(interest).types.some((t) => place.types.includes(t)),
  );
}

/**
 * Fraction of the user's interests this place matches, 0–1. Zero overlap is a
 * real 0 — the place can still be rescued by quality, which is what makes the
 * serendipity slot possible.
 */
export function affinity(place: CandidatePlace, interests: readonly Interest[]): number {
  if (interests.length === 0) return 0;
  return matchedInterests(place, interests).length / interests.length;
}

// ── priceFit ─────────────────────────────────────────────────────────────────

/** What an unknown priceLevel scores: neutral, never 0 — "we don't know" must
 *  not read as "wildly off budget". Strictly between exact match (1) and worst
 *  mismatch (0). */
export const PRICE_FIT_NEUTRAL = 0.5;

/**
 * Distance ABOVE budget on the 0–4 ordinal scale, mapped to 1…0. Asymmetric on
 * purpose: under budget is a perfect fit, not a mismatch. A symmetric score
 * contradicts the hard filter directly below it ("cheap is never a violation")
 * and, in the Gate A fixture, ranked a ¥¥ ramen shop above a ¥ Kiyomizu-dera
 * for a ¥¥ traveller. Nobody's budget means "no free temples".
 */
export function priceFit(
  priceLevel: PriceLevelOrdinal | undefined,
  budget: BudgetLevel | undefined,
): number {
  if (priceLevel == null || budget == null) return PRICE_FIT_NEUTRAL;
  if (priceLevel <= budget) return 1;
  return 1 - (priceLevel - budget) / 4;
}

// ── hard filters ─────────────────────────────────────────────────────────────

/**
 * Google types that violate a dietary need outright. Applied to MEAL-SLOT
 * candidates only — a diet doesn't ban you from a museum with a grill in the
 * lobby. Best-effort by design: rung 2 of the dietary ladder (enrichment
 * tags) catches what a type can't.
 */
const DIETARY_CONFLICT_TYPES: Record<string, readonly string[]> = {
  vegetarian: ["steak_house", "barbecue_restaurant", "seafood_restaurant", "hamburger_restaurant"],
  vegan: ["steak_house", "barbecue_restaurant", "seafood_restaurant", "hamburger_restaurant"],
};

/** How many priceLevel steps above budget a place must be to be killed rather
 *  than widened toward later (one step out is "widen later", not "kill now"). */
const BUDGET_KILL_STEPS = 2;

export interface HardFilterContext {
  /** True when the list is being filtered as meal candidates. */
  mealSlot?: boolean;
}

function violatesDietaryNeed(place: CandidatePlace, need: string): boolean {
  const conflicts = Object.hasOwn(DIETARY_CONFLICT_TYPES, need)
    ? DIETARY_CONFLICT_TYPES[need]
    : undefined;
  return conflicts?.some((t) => place.types.includes(t)) ?? false;
}

/**
 * Why a place fails the hard filters, or `undefined` if it survives. The rule
 * and its human-readable reason live together so the funnel's `dropped` list
 * can never drift from the filter that produced it.
 */
export function hardFilterReason(
  place: CandidatePlace,
  profile: PreferenceProfile,
  context: HardFilterContext = {},
): string | undefined {
  if (place.businessStatus === "CLOSED_PERMANENTLY") return "permanently closed";
  if (context.mealSlot) {
    const need = profile.dietary.find((d) => violatesDietaryNeed(place, d));
    if (need) return `dietary conflict: ${need}`;
  }
  if (
    profile.budget != null &&
    place.priceLevel != null &&
    place.priceLevel - profile.budget >= BUDGET_KILL_STEPS
  ) {
    return `price level ${place.priceLevel} is ${place.priceLevel - profile.budget} steps over budget ${profile.budget}`;
  }
  return undefined;
}

/**
 * The non-negotiables, applied before any scoring: permanently closed, dietary
 * mismatch (meal slots only), budget way out of range. Cheap places are never
 * filtered for a high budget — cheap is not a violation.
 */
export function applyHardFilters(
  places: readonly CandidatePlace[],
  profile: PreferenceProfile,
  context: HardFilterContext = {},
): CandidatePlace[] {
  return places.filter((place) => hardFilterReason(place, profile, context) === undefined);
}

// ── scoring + match reasons ──────────────────────────────────────────────────

/** "2.1k" for 2,100; "8k" for 8,000; raw below 1,000. */
function formatReviewCount(count: number): string {
  if (count < 1000) return String(count);
  return `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k`;
}

function buildReasons(place: CandidatePlace, matched: readonly Interest[]): string[] {
  const reasons = matched.map((interest) => `matches: ${interest}`);
  if (place.rating != null && place.userRatingCount != null) {
    reasons.push(`${place.rating}★ · ${formatReviewCount(place.userRatingCount)} reviews`);
  }
  // A survivor must always explain itself — the "why this place" UX has no
  // fallback for an empty list.
  if (reasons.length === 0) reasons.push("recommended nearby");
  return reasons;
}

/**
 * Score ONE place that already passed hard filters. For lists, use
 * `scoreCandidates`, which filters first.
 */
export function scorePlace(place: CandidatePlace, profile: PreferenceProfile): ScoredPlace {
  const matched = matchedInterests(place, profile.interests);
  const affinityScore = affinity(place, profile.interests);
  const qualityScore = quality(place.rating, place.userRatingCount) / 5; // → 0–1
  const fitScore = priceFit(place.priceLevel, profile.budget);
  const score =
    WEIGHTS.affinity * affinityScore + WEIGHTS.quality * qualityScore + WEIGHTS.priceFit * fitScore;
  return { placeId: place.placeId, score, reasons: buildReasons(place, matched) };
}

/** Hard filters, then scores, sorted best-first. The pipeline's entry point. */
export function scoreCandidates(
  places: readonly CandidatePlace[],
  profile: PreferenceProfile,
  context: HardFilterContext = {},
): ScoredPlace[] {
  return applyHardFilters(places, profile, context)
    .map((place) => scorePlace(place, profile))
    .sort((a, b) => b.score - a.score);
}
