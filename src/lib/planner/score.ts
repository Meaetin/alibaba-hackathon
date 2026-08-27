/**
 * Stage 3 — deterministic scoring. Rank in code first: auditable, debuggable,
 * free. See "Stage 3" in `docs/personalization-pipeline.md`.
 *
 *   score = w1·affinity + w2·quality + w3·priceFit + w4·popularity
 *         − touristTrapPenalty·popularity
 *
 * (The doc's −w5·duplication term is a set-level concern — the funnel's
 * per-type quotas own it; a single place can't know it's a duplicate.)
 *
 * The last two terms are the traveller's persona reaching this far in. Both are
 * **zero by default**: `WEIGHTS.popularity` is 0 and `touristTrapPenalty` is 0
 * unless a persona moved them, so a planner with no persona scores exactly what
 * it scored before either existed. Every knob arrives as a parameter — nothing
 * here reads a `PersonaResult`.
 *
 * Hard filters run FIRST: a permanently closed place or a dietary violation
 * is not a low score, it's a system failure. `scorePlace` is never handed a
 * filtered-out place — use `scoreCandidates` for list-level scoring.
 */

import type { PriceLevelOrdinal } from "@/lib/maps/price-level";
import { DEFAULT_SCORING_KNOBS, type ScoringKnobs } from "./knobs";
import type { BudgetLevel, CandidatePlace, Interest, PreferenceProfile } from "./types";
import { bridgeFor } from "./taxonomy";

export interface ScoredPlace {
  placeId: string;
  score: number;
  /** Raw material for the "why this place" UX. Never empty for a survivor. */
  reasons: string[];
}

/**
 * Component weights when nobody has said otherwise — the same four numbers as
 * `DEFAULT_SCORING_KNOBS.weights`, kept here because this is the module every
 * scoring test reads them from.
 *
 * `popularity` at zero is what "there is no popularity term" means once the
 * term exists. A persona that wants one raises it, and `resolvePlannerKnobs`
 * renormalises so the four still sum to 1.
 */
export const WEIGHTS = DEFAULT_SCORING_KNOBS.weights;

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

// ── popularity ───────────────────────────────────────────────────────────────

/** Review count at which a place is as famous as this scale can express. */
export const POPULARITY_SATURATION = 10_000;

/**
 * How well known a place is, 0–1, on a log scale — 100 reviews is halfway to
 * 10,000, not a hundredth of the way.
 *
 * Deliberately **not** `quality`. That function asks "is this good?" and uses
 * the review count only to decide how much to trust the stars. This one asks
 * "does everyone go here?", which two different travellers want opposite
 * answers to: one is here for the famous things, the other is here to avoid
 * them. Both read this number; the weights and `touristTrapPenalty` decide the
 * sign.
 *
 * An unknown count is 0, not neutral: "no evidence of fame" is the honest read,
 * and it is the same rule `pickSerendipity` already applies.
 */
export function popularity(userRatingCount: number | undefined): number {
  if (userRatingCount == null || userRatingCount <= 0) return 0;
  return Math.min(1, Math.log10(userRatingCount) / Math.log10(POPULARITY_SATURATION));
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

/** How far from neutral the type bonus may pull a place, either way. */
export const TYPE_AFFINITY_MAX = 0.5;

/**
 * `PreferenceProfile.typeAffinities` as an offset from neutral.
 *
 * The map is `{ googleType: weight }` with 1.0 meaning neutral — it comes from
 * `ARCHETYPE_PRESETS`, and it is the persona's precision layer: the `Interest`
 * union has seven members and cannot say "this traveller is here for the
 * galleries but not the shopping malls". The strongest opinion the profile
 * expresses about any of this place's types wins; a type the map never mentions
 * says nothing rather than saying zero.
 *
 * Bounded because it tunes a ranking rather than replacing one. Unbounded, one
 * preset entry of 3.0 would out-vote every other term in the score.
 */
export function typeAffinityBonus(
  place: CandidatePlace,
  typeAffinities: Record<string, number> | undefined,
): number {
  if (!typeAffinities) return 0;
  let strongest: number | undefined;
  for (const type of place.types) {
    if (!Object.hasOwn(typeAffinities, type)) continue;
    const offset = typeAffinities[type] - 1;
    if (strongest === undefined || Math.abs(offset) > Math.abs(strongest)) strongest = offset;
  }
  if (strongest === undefined) return 0;
  return Math.max(-TYPE_AFFINITY_MAX, Math.min(TYPE_AFFINITY_MAX, strongest));
}

// ── priceFit ─────────────────────────────────────────────────────────────────

/** What an unknown priceLevel scores: neutral, never 0 — "we don't know" must
 *  not read as "wildly off budget". Strictly between exact match (1) and worst
 *  mismatch (0). */
export const PRICE_FIT_NEUTRAL = 0.5;

/**
 * Distance ABOVE budget on the 0–4 ordinal scale, mapped to 1…0. Asymmetric by
 * default: under budget is a perfect fit, not a mismatch. A symmetric score
 * contradicts the hard filter directly below it ("cheap is never a violation")
 * and, in the Gate A fixture, ranked a ¥¥ ramen shop above a ¥ Kiyomizu-dera
 * for a ¥¥ traveller. Nobody's budget means "no free temples".
 *
 * `penalisesBelow` is the one traveller for whom that is wrong: the one who
 * said they want it polished. For them the curve becomes symmetric and the
 * hawker stall stops out-ranking the restaurant. Nobody else sees it — it is
 * off unless a persona turns it on, and `comfortTolerance` is the only axis
 * allowed to. See the collision rules in `knobs.ts`.
 */
export function priceFit(
  priceLevel: PriceLevelOrdinal | undefined,
  budget: BudgetLevel | undefined,
  penalisesBelow = false,
): number {
  if (priceLevel == null || budget == null) return PRICE_FIT_NEUTRAL;
  if (priceLevel < budget) return penalisesBelow ? 1 - (budget - priceLevel) / 4 : 1;
  if (priceLevel === budget) return 1;
  return 1 - (priceLevel - budget) / 4;
}

// ── hard filters ─────────────────────────────────────────────────────────────

/**
 * Google types that violate a dietary need outright. The fallback, used only
 * where Google gave no direct answer — see `violatesDietaryNeed`. Applied to
 * MEAL-SLOT candidates only: a diet doesn't ban you from a museum with a grill
 * in the lobby.
 *
 * **The rule for adding one: the animal has to be the cuisine, not an item on
 * the menu.** `steak_house` qualifies because a steakhouse without steak is not
 * a steakhouse; `italian_restaurant` does not, because pasta exists. Getting
 * that boundary wrong in the permissive direction serves meat to a vegetarian,
 * and in the strict direction deletes most of a city — which is the same reason
 * `undefined` from Google is never read as `false`.
 *
 * `chicken_restaurant` was added after a live Singapore run seated a vegetarian
 * at Poulet - VivoCity for dinner. Its types are `french_restaurant,
 * chicken_restaurant, restaurant`, Google was silent on `servesVegetarianFood`,
 * and a four-entry list had nothing to say about it.
 *
 * `sushi_restaurant` and `ramen_restaurant` were tried here and **rejected**.
 * Both name the carbohydrate, not the animal: Gate A's Kyoto fixture contains
 * Vegan Ramen Uzu Kyoto, which the ramen rule deleted. Vegetarian sushi is a
 * category too. Where such a place genuinely serves nothing, Google's
 * `servesVegetarianFood: false` catches it at rung 1, which is the rung that
 * knows rather than guesses.
 */
const DIETARY_CONFLICT_TYPES: Record<string, readonly string[]> = {
  vegetarian: [
    "steak_house",
    "barbecue_restaurant",
    "seafood_restaurant",
    "hamburger_restaurant",
    "chicken_restaurant",
  ],
  vegan: [
    "steak_house",
    "barbecue_restaurant",
    "seafood_restaurant",
    "hamburger_restaurant",
    "chicken_restaurant",
  ],
};

/** How many priceLevel steps above budget a place must be to be killed rather
 *  than widened toward later (one step out is "widen later", not "kill now"). */
const BUDGET_KILL_STEPS = 2;

export interface HardFilterContext {
  /** True when the list is being filtered as meal candidates. */
  mealSlot?: boolean;
}

/**
 * Needs Google answers directly, from the shortlist mask. A direct `false` is
 * Google saying no, and it beats any guess we could make from the place type.
 */
const DIETARY_GOOGLE_FIELD: Record<string, (place: CandidatePlace) => boolean | undefined> = {
  vegetarian: (place) => place.servesVegetarianFood,
  vegan: (place) => place.servesVegetarianFood,
};

/**
 * Two rungs, in order of how much we trust them.
 *
 * 1. Google's own boolean, when the shortlist hydration ran and Google answered.
 *    `false` is a violation; `true` clears the place outright.
 * 2. Otherwise the type list — a guess, and only reachable when Google is silent.
 *
 * The middle case is what matters: `undefined` means Google never said, which is
 * the common answer outside chains. Reading it as `false` would delete most of
 * a city, so it falls through to the guess rather than convicting.
 *
 * `vegan` reads the vegetarian flag deliberately. Google has no vegan field, and
 * a place that serves no vegetarian food serves no vegan food either — so `false`
 * is sound for both. `true` is weaker for vegan than vegetarian, which is why it
 * clears the hard filter but doesn't promote a place up the ladder in `funnel.ts`.
 */
function violatesDietaryNeed(place: CandidatePlace, need: string): boolean {
  const googleAnswer = Object.hasOwn(DIETARY_GOOGLE_FIELD, need)
    ? DIETARY_GOOGLE_FIELD[need](place)
    : undefined;
  if (googleAnswer !== undefined) return !googleAnswer;

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

function buildReasons(
  place: CandidatePlace,
  matched: readonly Interest[],
  typeBonus: number,
): string[] {
  const reasons = matched.map((interest) => `matches: ${interest}`);
  if (typeBonus > 0) reasons.push("your kind of place");
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
 *
 * `knobs` defaults to today's constants, so every call site that has no persona
 * — and every existing test — scores exactly what it scored before.
 */
export function scorePlace(
  place: CandidatePlace,
  profile: PreferenceProfile,
  knobs: ScoringKnobs = DEFAULT_SCORING_KNOBS,
): ScoredPlace {
  const matched = matchedInterests(place, profile.interests);
  const typeBonus = typeAffinityBonus(place, profile.typeAffinities);
  // The seven-member interest union and the persona's type map are two
  // statements about the same thing, so they add rather than compete — and the
  // sum is clamped, because a place cannot match more than all of what you like.
  const affinityScore = clamp01(affinity(place, profile.interests) + typeBonus);
  const qualityScore = quality(place.rating, place.userRatingCount) / 5; // → 0–1
  const fame = popularity(place.userRatingCount);
  const fitScore = priceFit(
    place.priceLevel,
    profile.budget,
    knobs.priceFitPenalisesBelow && !isCheapTypeExempt(place, knobs.cheapTypeExemptions),
  );
  const score =
    knobs.weights.affinity * affinityScore +
    knobs.weights.quality * qualityScore +
    knobs.weights.priceFit * fitScore +
    knobs.weights.popularity * fame -
    knobs.touristTrapPenalty * fame;
  return { placeId: place.placeId, score, reasons: buildReasons(place, matched, typeBonus) };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * How `immersion` says "the market is the point" without reshaping a curve it
 * does not own. A deep-immersion traveller who also wants polish still gets the
 * symmetric price curve everywhere except the handful of types where cheap is
 * the whole experience.
 */
function isCheapTypeExempt(place: CandidatePlace, exemptions: readonly string[]): boolean {
  return exemptions.some((type) => place.types.includes(type));
}

/** Hard filters, then scores, sorted best-first. The pipeline's entry point. */
export function scoreCandidates(
  places: readonly CandidatePlace[],
  profile: PreferenceProfile,
  context: HardFilterContext = {},
  knobs: ScoringKnobs = DEFAULT_SCORING_KNOBS,
): ScoredPlace[] {
  return applyHardFilters(places, profile, context)
    .map((place) => scorePlace(place, profile, knobs))
    .sort((a, b) => b.score - a.score);
}
