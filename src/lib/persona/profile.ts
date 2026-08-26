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
 *  - interests: form overrides win; otherwise derived from the preset tags
 *  - typeAffinities: always the archetype preset (the persona's precision layer)
 */

import type {
  BudgetLevel,
  Interest,
  Pace,
  PreferenceProfile,
} from "@/lib/planner/types";

import { ARCHETYPE_PRESETS } from "./presets";
import type { PersonaResult } from "./types";

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

/** Unique union members covered by the preset's tags, first-seen order. */
export function deriveInterests(persona: PersonaResult): Interest[] {
  const preset = ARCHETYPE_PRESETS[persona.archetype.id];
  const interests: Interest[] = [];
  for (const tag of preset.tags) {
    const mapped = TAG_TO_INTEREST[tag];
    if (mapped && !interests.includes(mapped)) interests.push(mapped);
  }
  return interests;
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

/** Persona + trip form → the planner's PreferenceProfile (bridge §2). */
export function buildProfile(
  persona: PersonaResult,
  tripInputs: TripInputs,
): PreferenceProfile {
  const preset = ARCHETYPE_PRESETS[persona.archetype.id];
  return {
    interests: tripInputs.interestOverrides ?? deriveInterests(persona),
    dietary: tripInputs.dietary,
    pace: tripInputs.pace ?? derivePace(persona),
    budget: tripInputs.budget ?? deriveBudget(persona),
    typeAffinities: { ...preset.typeAffinities },
  };
}
