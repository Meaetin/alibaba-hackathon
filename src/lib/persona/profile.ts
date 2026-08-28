/**
 * The quiz → pipeline bridge. Translates a TravelPersonaResult plus the trip
 * form into the planner's PreferenceProfile, and exposes the dimension-driven
 * scoring/scheduling adjustments. Ported from `docs/quiz-pipeline-bridge.md`
 * (§2 buildProfile, §3 dimension → parameter rules).
 *
 * Precedence rules (the quiz augments, never replaces, the form):
 *  - dietary: always the form (hard constraint, never inferred)
 *  - pace: form wins; `derivePace` is a fallback for when nothing asked
 *  - budget: form wins; persona is a fallback
 *  - interests: form overrides win; otherwise what the answers named, topped up
 *    from the archetype's preset tags
 *  - typeAffinities: the archetype preset, with what the answers named layered
 *    on top — strongest opinion per type wins
 */

import type {
  BudgetLevel,
  Interest,
  Pace,
  PreferenceProfile,
} from "@/lib/planner/types";

import { ARCHETYPE_PRESETS } from "./presets";
import { QUESTIONS } from "./quiz";
import type { PersonaResult, QuizAnswers } from "./types";

export interface TripInputs {
  city: string;
  totalDays: number;
  startDate?: string;
  /** Hard constraints — never inferred from the persona. */
  dietary: string[];
  /**
   * The pace the traveller chose in the create modal. When present it wins
   * outright: a thing the user typed beats a thing the quiz inferred, and quiz
   * Q4 conflates *unhurried* with *unplanned* — it feeds `d1`, which is the
   * spontaneity axis, so a wanderer who wants full days reads as relaxed.
   */
  pace?: Pace;
  budget?: BudgetLevel;
  /** Manual interest chips; when present they replace the persona-derived set. */
  interestOverrides?: Interest[];
}

/**
 * Preset tag → planner Interest union. Tags the union can't express contribute
 * nothing here; their signal rides in `typeAffinities` instead.
 */
const TAG_TO_INTEREST: Record<string, Interest> = {
  outdoors: "outdoors",
  hiking: "outdoors",
  national_parks: "outdoors",
  viewpoints: "outdoors",
  botanical_gardens: "outdoors",
  wildlife: "outdoors",
  nature_walks: "outdoors",
  adventure_sports: "outdoors",
  water_activities: "outdoors",
  scenic_drives: "outdoors",
  cafes: "cafes",
  temples: "temples",
  meditation_retreats: "temples",
  museums: "museums",
  historical_sites: "museums",
  architecture: "museums",
  street_art: "museums",
  landmarks: "museums",
  shows: "museums",
  restaurants: "food",
  street_food: "food",
  food_tours: "food",
  cooking_classes: "food",
  fine_dining: "food",
  iconic_restaurants: "food",
  nightlife: "nightlife",
  bars: "nightlife",
  festivals: "nightlife",
  group_activities: "nightlife",
  shopping: "shopping",
  local_markets: "shopping",
  artisan_shops: "shopping",
};

// ── what the traveller actually said ─────────────────────────────────────────

/**
 * ## Why the archetype cannot be the only source of a traveller's tastes
 *
 * Twelve answers become four numbers, four numbers become one archetype, and
 * that archetype's fixed tag list becomes the whole trip. Every answer except
 * the one that decided the match is discarded — and a real traveller found the
 * hole. They answered "find the wild side", "hostel, camp, or wherever",
 * "street food adventures", "go immediately" and "an epic adventure", matched
 * The Spontaneous Wanderer, and got that archetype's tags: cafes, street art,
 * local markets, walking tours. No `outdoors` anywhere. Their Singapore trip
 * came back as shopping malls and art galleries, and nothing downstream could
 * tell that the persona had contradicted the person.
 *
 * The fix is not to replace the archetype — it is a decent prior, and a
 * traveller who says nothing concrete still needs tastes from somewhere. The
 * fix is that **an answer that names a thing outranks an archetype that
 * implies one.** Same rule the rest of this file already follows for pace and
 * budget: a thing the traveller stated beats a thing we inferred.
 *
 * ## What is in the table and what is deliberately not
 *
 * Only options that name *content* are listed. "Spreadsheet time", "one
 * carry-on" and "colour-coded and labelled" describe a travel style, and the
 * four axes already read them; inventing a taste from a style answer is how the
 * archetype got it wrong in the first place.
 *
 * Two options carry a **refusal** instead of a taste. "Fuel for the journey"
 * says food is not the point and "politely decline" turns down the festival.
 * Neither can push an interest down — there is no negative weight — but both
 * stop the archetype from topping that interest back up, which is the only way
 * the traveller's "no" survives contact with a preset built for somebody else.
 * An interest another answer named outright still wins: a stated yes beats a
 * stated no on a different question, because the yes was about a place and the
 * no was about a priority.
 *
 * Two known gaps, stated rather than papered over. The quiz never asks about
 * evenings, so `nightlife` reaches a profile only through the festival answer
 * or through the Social Explorer preset. And no answer names shopping directly
 * — it rides on the market half of the food and culture answers.
 *
 * ## Pinned by label and title, like `SIGNAL_QUESTIONS`
 *
 * A question or option reordered above one of these would silently move a
 * signal onto the wrong answer and still read perfectly well, so the pin is the
 * text rather than an index. `profile.test.ts` asserts every pair resolves.
 */
export interface AnswerSignal {
  /** `QuizQuestion.label`. */
  question: string;
  /** `QuizOption.title`. */
  option: string;
  /** How plainly this answer names each interest, 0–1. */
  interests: Partial<Record<Interest, number>>;
  /** Interests this answer turns down. Blocks the archetype's top-up only. */
  declines?: Interest[];
  /** Google Places types, 1.0 = neutral — the same units as a preset's map. */
  types?: Record<string, number>;
}

export const ANSWER_SIGNALS: readonly AnswerSignal[] = [
  {
    question: "First Morning",
    option: "Hit the landmarks",
    interests: { museums: 0.8 },
    types: { tourist_attraction: 1.35, historical_landmark: 1.3, monument: 1.3 },
  },
  {
    question: "First Morning",
    option: "Wander to a café",
    interests: { cafes: 1 },
    types: { cafe: 1.4, coffee_shop: 1.4, bakery: 1.2 },
  },
  {
    question: "First Morning",
    option: "Find the wild side",
    interests: { outdoors: 1 },
    types: {
      park: 1.4,
      hiking_area: 1.45,
      national_park: 1.4,
      nature_reserve: 1.4,
      scenic_spot: 1.3,
      observation_deck: 1.25,
    },
  },
  {
    question: "Culture",
    option: "Dive in completely",
    interests: { temples: 0.8, food: 0.4, shopping: 0.4 },
    types: {
      place_of_worship: 1.35,
      temple: 1.35,
      cultural_center: 1.3,
      cooking_school: 1.35,
      market: 1.25,
    },
  },
  {
    question: "Culture",
    option: "Sample the highlights",
    interests: { museums: 0.7 },
    types: { museum: 1.3, tourist_attraction: 1.3, art_gallery: 1.2 },
  },
  {
    question: "Culture",
    option: "Observe from a distance",
    interests: { cafes: 0.4 },
    types: { cafe: 1.2, observation_deck: 1.2, art_gallery: 1.15 },
  },
  {
    question: "Food",
    option: "The food IS the trip",
    interests: { food: 1, shopping: 0.4 },
    types: {
      restaurant: 1.45,
      market: 1.35,
      cooking_school: 1.4,
      food_tour: 1.4,
      fine_dining_restaurant: 1.25,
    },
  },
  {
    question: "Food",
    option: "Street food adventures",
    interests: { food: 1, shopping: 0.4 },
    types: { street_food_stall: 1.45, food_court: 1.4, market: 1.35, restaurant: 1.3 },
  },
  { question: "Food", option: "Fuel for the journey", interests: {}, declines: ["food"] },
  {
    question: "Risk & Comfort",
    option: "Go immediately",
    interests: { nightlife: 0.5 },
    types: { event_venue: 1.3, festival: 1.35, performing_arts_theater: 1.2 },
  },
  {
    question: "Risk & Comfort",
    option: "Politely decline",
    interests: {},
    declines: ["nightlife"],
  },
  {
    question: "Memories",
    option: "An epic adventure",
    interests: { outdoors: 0.9 },
    types: {
      hiking_area: 1.4,
      national_park: 1.35,
      adventure_sports_center: 1.4,
      beach: 1.3,
      water_park: 1.25,
    },
  },
  {
    question: "Memories",
    option: "A perfect, peaceful moment",
    interests: { outdoors: 0.4 },
    types: { scenic_spot: 1.3, observation_deck: 1.3, park: 1.2 },
  },
  {
    question: "Detours",
    option: "Chill about it",
    interests: { cafes: 0.4 },
    types: { cafe: 1.2, book_store: 1.15 },
  },
];

/**
 * Fixed order, so two interests on the same weight always come out the same way
 * round. Matches the `Interest` union's own declaration order.
 */
const INTEREST_ORDER: readonly Interest[] = [
  "outdoors",
  "cafes",
  "temples",
  "museums",
  "food",
  "nightlife",
  "shopping",
];

/** Below this, an answer only hinted — not enough to spend a retrieval query on. */
const INTEREST_FLOOR = 0.5;
/** Under this many, the archetype tops the list up. */
const MIN_INTERESTS = 3;
/**
 * `affinity` in `score.ts` is matched-over-total, so every extra interest
 * dilutes the ones that matter, and `buildSearchPlan` bills a text search per
 * interest. A long list is worse than a short one in both money and ranking.
 */
const MAX_INTERESTS = 5;

/** `{question label}\u0000{option title}` → signal. Built once. */
const SIGNALS_BY_ANSWER = new Map<string, AnswerSignal>(
  ANSWER_SIGNALS.map((signal) => [`${signal.question}\u0000${signal.option}`, signal]),
);

/** The signals for the options this traveller actually chose. */
export function signalsFor(answers: QuizAnswers | undefined): AnswerSignal[] {
  if (!answers) return [];
  return QUESTIONS.flatMap((question, index) => {
    const chosen = answers[index];
    if (chosen == null || chosen < 0 || chosen >= question.options.length) return [];
    const signal = SIGNALS_BY_ANSWER.get(
      `${question.label}\u0000${question.options[chosen].title}`,
    );
    return signal ? [signal] : [];
  });
}

/** Every interest the answers named, heaviest first. */
export function interestWeights(answers: QuizAnswers | undefined): Map<Interest, number> {
  const weights = new Map<Interest, number>();
  for (const signal of signalsFor(answers)) {
    for (const [interest, weight] of Object.entries(signal.interests)) {
      weights.set(
        interest as Interest,
        (weights.get(interest as Interest) ?? 0) + (weight ?? 0),
      );
    }
  }
  return weights;
}

/** Unique union members covered by the preset's tags, first-seen order. */
function presetInterests(persona: PersonaResult): Interest[] {
  const preset = ARCHETYPE_PRESETS[persona.archetype.id];
  const interests: Interest[] = [];
  for (const tag of preset.tags) {
    const mapped = TAG_TO_INTEREST[tag];
    if (mapped && !interests.includes(mapped)) interests.push(mapped);
  }
  return interests;
}

/**
 * What the traveller's answers named, topped up from their archetype.
 *
 * `answers` is optional so a persona rebuilt from scores alone still produces
 * interests — it falls back to today's preset-only list, which is honest, where
 * inventing an answer would not be. Same discipline as `buildPersonaBrief`.
 */
export function deriveInterests(
  persona: PersonaResult,
  answers?: QuizAnswers,
): Interest[] {
  const fromPreset = presetInterests(persona);
  const weights = interestWeights(answers);
  if (weights.size === 0) return fromPreset;

  const spoken = INTEREST_ORDER.filter(
    (interest) => (weights.get(interest) ?? 0) >= INTEREST_FLOOR,
  )
    .sort((a, b) => (weights.get(b) ?? 0) - (weights.get(a) ?? 0))
    .slice(0, MAX_INTERESTS);

  const declined = new Set(signalsFor(answers).flatMap((signal) => signal.declines ?? []));
  for (const interest of fromPreset) {
    if (spoken.length >= MIN_INTERESTS) break;
    if (spoken.includes(interest) || declined.has(interest)) continue;
    spoken.push(interest);
  }
  return spoken.length > 0 ? spoken : fromPreset;
}

/**
 * The archetype's type map with the answers layered on top.
 *
 * **Strongest opinion per type wins**, which is the rule `typeAffinityBonus`
 * already applies when a place carries several mapped types — resolving it the
 * same way here means the two cannot disagree about what "this traveller's
 * strongest feeling about a museum" is.
 */
export function deriveTypeAffinities(
  persona: PersonaResult,
  answers?: QuizAnswers,
): Record<string, number> {
  const merged: Record<string, number> = {
    ...ARCHETYPE_PRESETS[persona.archetype.id].typeAffinities,
  };
  for (const signal of signalsFor(answers)) {
    for (const [type, weight] of Object.entries(signal.types ?? {})) {
      const current = merged[type];
      if (current === undefined || Math.abs(weight - 1) > Math.abs(current - 1)) {
        merged[type] = weight;
      }
    }
  }
  return merged;
}

/**
 * d1 (Structure) → pace. Identity archetypes force packed (bridge §3).
 *
 * **A fallback, not the answer.** The create modal asks for pace directly and
 * `buildProfile` prefers that; this runs only where nothing asked. The axis
 * conflates unhurried with unplanned — see the note on `TripInputs.pace`.
 */
export function derivePace(persona: PersonaResult): Pace {
  const id = persona.archetype.id;
  if (id === "weekend_warrior" || id === "bucket_list_chaser") return "packed";
  const d1 = persona.dimensions.structure;
  if (d1 <= 30) return "packed";
  if (d1 <= 65) return "balanced";
  return "relaxed";
}

/** d2 (Comfort) → budget fallback. Only used when the form skips budget. */
export function deriveBudget(persona: PersonaResult): BudgetLevel {
  const d2 = persona.dimensions.comfort;
  if (d2 <= 20) return 4;
  if (d2 <= 40) return 3;
  if (d2 <= 65) return 2;
  return 1;
}

/**
 * Two functions used to live here — `getFocusScoringAdjustments` and
 * `getSocialSchedulingRules` — mapping d3 and d4 onto planner constants. They
 * are gone, and `src/lib/planner/knobs.ts` is where those mappings live now.
 *
 * Not a rewrite for its own sake. They were never called, and connecting them
 * would have left the planner with **two** statements of the same mapping
 * disagreeing about their thresholds: they cut at 30/60/70 while the bands cut
 * at 33/66, and their mid values were not this planner's current constants,
 * which is the property that keeps a persona-less trip identical. Two rules
 * that disagree is worse than either rule.
 *
 * Everything they said that has a consumer moved across: `qualityWeight` and
 * `popularityWeight` became the renormalised `weights`, `touristTrapPenalty`
 * and `visitDurationBias` kept their names, and `minSocialVenuesPerDay` and
 * `crowdPreference` sit on `PlannerKnobs`.
 *
 * Three fields did **not** move, and are named here rather than lost quietly:
 * `eveningActivityRequired`, `preferQuietPlaces` and `allowSolitudeSlots`.
 * Nothing in `assign.ts` or `pack.ts` can express any of them — there is no
 * concept of an evening requirement or a solitude slot in the day skeleton —
 * so wiring them would have meant inventing the mechanism, not connecting one.
 */

/**
 * Persona + trip form → the planner's PreferenceProfile (bridge §2).
 *
 * `answers` is a third parameter rather than a field on `TripInputs` because
 * `TripInputs` is the trip form and these are the quiz — mixing them is how a
 * caller ends up thinking the traveller typed something they only implied.
 * Omitting it falls back to archetype-only tastes.
 */
export function buildProfile(
  persona: PersonaResult,
  tripInputs: TripInputs,
  answers?: QuizAnswers,
): PreferenceProfile {
  return {
    interests: tripInputs.interestOverrides ?? deriveInterests(persona, answers),
    dietary: tripInputs.dietary,
    pace: tripInputs.pace ?? derivePace(persona),
    budget: tripInputs.budget ?? deriveBudget(persona),
    typeAffinities: deriveTypeAffinities(persona, answers),
  };
}
