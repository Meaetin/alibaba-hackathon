/**
 * The quiz → pipeline bridge. Translates a TravelPersonaResult plus the trip
 * form into the planner's PreferenceProfile, and exposes the dimension-driven
 * scoring/scheduling adjustments. Ported from `docs/quiz-pipeline-bridge.md`
 * (§2 buildProfile, §3 dimension → parameter rules).
 *
 * Precedence rules (the quiz augments, never replaces, the form):
 *  - dietary: always the form (hard constraint, never inferred)
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

/** d1 (Structure) → pace. Identity archetypes force packed (bridge §3). */
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

/** d3 (Focus) → scoring weight adjustments (bridge §3). */
export function getFocusScoringAdjustments(persona: PersonaResult) {
  const d3 = persona.dimensions.focus;
  return {
    qualityWeight: d3 > 60 ? 0.45 : 0.3,
    popularityWeight: d3 < 40 ? 0.25 : 0.1,
    touristTrapPenalty: d3 > 70 ? 0.15 : 0,
    visitDurationBias: (d3 > 70 ? "max" : d3 < 30 ? "min" : "preferred") as
      | "min"
      | "preferred"
      | "max",
  };
}

/** d4 (Social) → scheduling adjustments (bridge §3). */
export function getSocialSchedulingRules(persona: PersonaResult) {
  const d4 = persona.dimensions.social;
  return {
    eveningActivityRequired: d4 < 30,
    minSocialVenuesPerDay: d4 < 30 ? 2 : d4 < 60 ? 1 : 0,
    preferQuietPlaces: d4 > 70,
    allowSolitudeSlots: d4 > 60,
    crowdPreference: (d4 > 70 ? "quiet" : d4 < 30 ? "packed" : "moderate") as
      | "quiet"
      | "moderate"
      | "packed",
  };
}

/** Persona + trip form → the planner's PreferenceProfile (bridge §2). */
export function buildProfile(
  persona: PersonaResult,
  tripInputs: TripInputs,
): PreferenceProfile {
  const preset = ARCHETYPE_PRESETS[persona.archetype.id];
  return {
    interests: tripInputs.interestOverrides ?? deriveInterests(persona),
    dietary: tripInputs.dietary,
    pace: derivePace(persona),
    budget: tripInputs.budget ?? deriveBudget(persona),
    typeAffinities: { ...preset.typeAffinities },
  };
}
