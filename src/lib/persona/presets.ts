/**
 * Persona → pipeline bridge data. One preset per archetype, ported from
 * `docs/quiz-pipeline-bridge.md` (§2 interest presets) and
 * `docs/archetype-data-payloads.md` (Payloads 2–4).
 *
 * Two tag layers per archetype:
 *  - `tags`: human-readable interest tags (UI chips, overrides, docs).
 *  - `typeAffinities`: Google Places type keys + weights — the layer affinity
 *    scoring matches against `CandidatePlace.types`.
 *
 * `interests` on the resulting PreferenceProfile stays within the planner's
 * fixed 7-member Interest union (retrieval's taxonomy bridge); everything the
 * union can't express rides in `typeAffinities`.
 */

import type { BudgetLevel, Pace } from "@/lib/planner/types";

import type { TravelArchetypeId } from "./types";

export interface PersonaScoringConfig {
  weights: { affinity: number; quality: number; priceFit: number; duplication: number };
  touristTrapPenalty: number;
  /** Review-count threshold for the trap penalty; 0 = disabled. */
  touristTrapThreshold: number;
  visitDurationBias: "min" | "preferred" | "max";
  crowdPreference: "quiet" | "moderate" | "packed";
  crowdPenalty: number;
}

export interface PersonaSchedulingRules {
  activitiesPerDay: { min: number; max: number; target: number };
  eveningActivityRequired: boolean;
  minSocialVenuesPerDay: number;
  allowSolitudeSlots: boolean;
  mealDurationMinutes: { min: number; preferred: number; max: number };
  serendipitySlot: boolean;
  /** Wildcard picks must have at most this many reviews; 0 = disabled. */
  serendipityMaxReviews: number;
}

export interface ArchetypePreset {
  /** Human-readable interest tags (display + override vocabulary). */
  tags: string[];
  /** Google Places type affinities — soft scoring weights, never filters. */
  typeAffinities: Record<string, number>;
  pace: Pace;
  budget: BudgetLevel;
  scoring: PersonaScoringConfig;
  scheduling: PersonaSchedulingRules;
  /** Personality inject for the Pass B (day assignment) system prompt. */
  passBPromptInject: string;
  /** Tone directive for Pass C ("why this place for you") narration. */
  passCNarrationNote: string;
}

const WILDCARD =
  "Include one 'wildcard' slot per day — a lesser-known gem with fewer reviews but high quality.";
const NO_WILDCARD =
  "Do NOT include wildcard/surprise picks. This traveler wants the best-known, best-reviewed options.";

const std = (quality: number): PersonaScoringConfig["weights"] => ({
  affinity: 0.35,
  quality,
  priceFit: 0.2,
  duplication: 0.1,
});

export const ARCHETYPE_PRESETS: Record<TravelArchetypeId, ArchetypePreset> = {
  master_planner: {
    tags: ["landmarks", "museums", "architecture", "shopping"],
    typeAffinities: {
      landmarks: 1.4,
      museum: 1.3,
      tourist_attraction: 1.2,
      art_gallery: 1.1,
      shopping_mall: 0.9,
      store: 0.9,
    },
    pace: "packed",
    budget: 3,
    scoring: {
      weights: std(0.3),
      touristTrapPenalty: 0,
      touristTrapThreshold: 0,
      visitDurationBias: "min",
      crowdPreference: "moderate",
      crowdPenalty: 0,
    },
    scheduling: {
      activitiesPerDay: { min: 6, max: 9, target: 8 },
      eveningActivityRequired: false,
      minSocialVenuesPerDay: 0,
      allowSolitudeSlots: false,
      mealDurationMinutes: { min: 45, preferred: 60, max: 75 },
      serendipitySlot: false,
      serendipityMaxReviews: 0,
    },
    passBPromptInject: `Prefers dense, well-sequenced days with minimal dead time. ${NO_WILDCARD}`,
    passCNarrationNote:
      "Emphasize efficiency, sequence, and what makes this a smart choice in the day's plan.",
  },

  spontaneous_wanderer: {
    tags: ["cafes", "street_art", "local_markets", "walking_tours"],
    typeAffinities: {
      cafe: 1.3,
      coffee_shop: 1.3,
      art_gallery: 1.2,
      market: 1.3,
      flea_market: 1.3,
      walking_tour: 1.1,
    },
    pace: "relaxed",
    budget: 2,
    scoring: {
      weights: std(0.3),
      touristTrapPenalty: 0,
      touristTrapThreshold: 0,
      visitDurationBias: "preferred",
      crowdPreference: "moderate",
      crowdPenalty: 0,
    },
    scheduling: {
      activitiesPerDay: { min: 3, max: 5, target: 4 },
      eveningActivityRequired: false,
      minSocialVenuesPerDay: 0,
      allowSolitudeSlots: false,
      mealDurationMinutes: { min: 45, preferred: 60, max: 90 },
      serendipitySlot: true,
      serendipityMaxReviews: 500,
    },
    passBPromptInject: `Leave gaps. Fewer anchors, more flex candidates. ${WILDCARD}`,
    passCNarrationNote:
      "Emphasize the vibe, the unexpected charm, and why this place rewards curiosity.",
  },

  cultural_diver: {
    tags: ["museums", "temples", "local_markets", "cooking_classes", "historical_sites"],
    typeAffinities: {
      museum: 1.4,
      temple: 1.3,
      place_of_worship: 1.3,
      market: 1.2,
      flea_market: 1.2,
      cooking_school: 1.5,
      historical_landmark: 1.3,
      cultural_center: 1.3,
    },
    pace: "balanced",
    budget: 2,
    scoring: {
      weights: std(0.45),
      touristTrapPenalty: 0.15,
      touristTrapThreshold: 5000,
      visitDurationBias: "max",
      crowdPreference: "moderate",
      crowdPenalty: 0,
    },
    scheduling: {
      activitiesPerDay: { min: 4, max: 6, target: 5 },
      eveningActivityRequired: false,
      minSocialVenuesPerDay: 0,
      allowSolitudeSlots: false,
      mealDurationMinutes: { min: 60, preferred: 90, max: 120 },
      serendipitySlot: true,
      serendipityMaxReviews: 500,
    },
    passBPromptInject: `Allow longer stays at cultural sites. Rushing past a temple is a failure. ${WILDCARD}`,
    passCNarrationNote:
      "Emphasize cultural significance, what to learn here, and the depth this place offers.",
  },

  thrill_seeker: {
    tags: ["outdoors", "adventure_sports", "viewpoints", "water_activities"],
    typeAffinities: {
      park: 1.4,
      hiking_area: 1.5,
      national_park: 1.5,
      adventure_sports_center: 1.5,
      tourist_attraction: 1.2,
      observation_deck: 1.2,
      water_park: 1.3,
      beach: 1.3,
    },
    pace: "balanced",
    budget: 1,
    scoring: {
      weights: std(0.3),
      touristTrapPenalty: 0,
      touristTrapThreshold: 0,
      visitDurationBias: "preferred",
      crowdPreference: "moderate",
      crowdPenalty: 0,
    },
    scheduling: {
      activitiesPerDay: { min: 4, max: 7, target: 5 },
      eveningActivityRequired: false,
      minSocialVenuesPerDay: 0,
      allowSolitudeSlots: false,
      mealDurationMinutes: { min: 30, preferred: 60, max: 75 },
      serendipitySlot: true,
      serendipityMaxReviews: 500,
    },
    passBPromptInject: `Anchor days around one big activity. Fill gaps with recovery (cafes, viewpoints). ${WILDCARD}`,
    passCNarrationNote:
      "Emphasize the adrenaline, the physical experience, and what makes this an epic moment.",
  },

  comfort_cruiser: {
    tags: ["spas", "fine_dining", "shopping", "scenic_drives", "resorts"],
    typeAffinities: {
      spa: 1.4,
      day_spa: 1.4,
      restaurant: 1.3,
      fine_dining_restaurant: 1.3,
      shopping_mall: 1.2,
      boutique: 1.2,
      scenic_spot: 1.1,
      resort: 1.3,
      hotel: 1.3,
    },
    pace: "relaxed",
    budget: 4,
    scoring: {
      weights: std(0.3),
      touristTrapPenalty: 0,
      touristTrapThreshold: 0,
      visitDurationBias: "max",
      crowdPreference: "quiet",
      crowdPenalty: 0.05,
    },
    scheduling: {
      activitiesPerDay: { min: 1, max: 3, target: 2 },
      eveningActivityRequired: false,
      minSocialVenuesPerDay: 0,
      allowSolitudeSlots: false,
      mealDurationMinutes: { min: 75, preferred: 90, max: 120 },
      serendipitySlot: false,
      serendipityMaxReviews: 0,
    },
    passBPromptInject: `Slow days. Long meals. Never pack more than 2 activities. ${NO_WILDCARD}`,
    passCNarrationNote:
      "Emphasize atmosphere, quality, and what makes this a luxurious or restful experience.",
  },

  culinary_nomad: {
    tags: ["restaurants", "street_food", "local_markets", "cooking_classes", "food_tours", "cafes"],
    typeAffinities: {
      restaurant: 1.5,
      meal_delivery: 1.0,
      fast_food_restaurant: 1.1,
      street_food_stall: 1.4,
      market: 1.3,
      flea_market: 1.2,
      cooking_school: 1.4,
      food_tour: 1.4,
      cafe: 1.2,
      coffee_shop: 1.2,
    },
    pace: "balanced",
    budget: 2,
    scoring: {
      weights: std(0.45),
      touristTrapPenalty: 0.15,
      touristTrapThreshold: 5000,
      visitDurationBias: "max",
      crowdPreference: "moderate",
      crowdPenalty: 0,
    },
    scheduling: {
      activitiesPerDay: { min: 4, max: 7, target: 5 },
      eveningActivityRequired: false,
      minSocialVenuesPerDay: 0,
      allowSolitudeSlots: false,
      mealDurationMinutes: { min: 75, preferred: 90, max: 120 },
      serendipitySlot: true,
      serendipityMaxReviews: 500,
    },
    passBPromptInject: `Every meal slot is a primary activity, not filler. Allow 90+ minutes for meals. ${WILDCARD}`,
    passCNarrationNote:
      "Emphasize the food story — what's unique, what to order, and why this place matters culinarily.",
  },

  soulful_soloist: {
    tags: ["temples", "nature_walks", "meditation_retreats", "bookshops", "cafes", "viewpoints"],
    typeAffinities: {
      temple: 1.3,
      place_of_worship: 1.3,
      park: 1.3,
      hiking_area: 1.2,
      meditation_center: 1.4,
      yoga_studio: 1.3,
      book_store: 1.1,
      cafe: 1.2,
      coffee_shop: 1.2,
      observation_deck: 1.2,
      scenic_spot: 1.2,
    },
    pace: "balanced",
    budget: 2,
    scoring: {
      weights: std(0.4),
      touristTrapPenalty: 0,
      touristTrapThreshold: 0,
      visitDurationBias: "preferred",
      crowdPreference: "quiet",
      crowdPenalty: 0.1,
    },
    scheduling: {
      activitiesPerDay: { min: 2, max: 5, target: 3 },
      eveningActivityRequired: false,
      minSocialVenuesPerDay: 0,
      allowSolitudeSlots: true,
      mealDurationMinutes: { min: 45, preferred: 60, max: 90 },
      serendipitySlot: true,
      serendipityMaxReviews: 500,
    },
    passBPromptInject: `Built-in solitude. No back-to-back social activities. Long cafe stays welcome. This traveler values solitude. A 'wander time' slot with no assigned place is valid. ${WILDCARD}`,
    passCNarrationNote:
      "Emphasize the reflective quality, the quiet moments, and how this place invites presence.",
  },

  social_explorer: {
    tags: ["nightlife", "local_markets", "food_tours", "group_activities", "festivals", "bars"],
    typeAffinities: {
      bar: 1.2,
      night_club: 1.3,
      karaoke_bar: 1.2,
      market: 1.2,
      flea_market: 1.1,
      food_tour: 1.3,
      event_venue: 1.4,
      festival: 1.5,
      entertainment_agency: 1.4,
      performing_arts_theater: 1.3,
    },
    pace: "balanced",
    budget: 2,
    scoring: {
      weights: std(0.3),
      touristTrapPenalty: 0,
      touristTrapThreshold: 0,
      visitDurationBias: "preferred",
      crowdPreference: "packed",
      crowdPenalty: 0.05,
    },
    scheduling: {
      activitiesPerDay: { min: 5, max: 8, target: 6 },
      eveningActivityRequired: true,
      minSocialVenuesPerDay: 2,
      allowSolitudeSlots: false,
      mealDurationMinutes: { min: 60, preferred: 90, max: 120 },
      serendipitySlot: true,
      serendipityMaxReviews: 500,
    },
    passBPromptInject: `Evening slots are load-bearing, not optional. Prioritize social venues after 6pm. IMPORTANT: Every day MUST include an evening activity — this traveler thrives on social evenings. ${WILDCARD}`,
    passCNarrationNote:
      "Emphasize the people, the energy, and the social opportunities this place offers.",
  },

  nature_pilgrim: {
    tags: ["outdoors", "hiking", "national_parks", "viewpoints", "botanical_gardens", "wildlife"],
    typeAffinities: {
      park: 1.5,
      hiking_area: 1.5,
      national_park: 1.4,
      nature_reserve: 1.4,
      observation_deck: 1.3,
      scenic_spot: 1.3,
      botanical_garden: 1.2,
      zoo: 1.1,
      wildlife_park: 1.3,
      campground: 1.2,
    },
    pace: "balanced",
    budget: 1,
    scoring: {
      weights: std(0.3),
      touristTrapPenalty: 0,
      touristTrapThreshold: 0,
      visitDurationBias: "preferred",
      crowdPreference: "moderate",
      crowdPenalty: 0,
    },
    scheduling: {
      activitiesPerDay: { min: 3, max: 5, target: 4 },
      eveningActivityRequired: false,
      minSocialVenuesPerDay: 0,
      allowSolitudeSlots: true,
      mealDurationMinutes: { min: 30, preferred: 60, max: 75 },
      serendipitySlot: true,
      serendipityMaxReviews: 500,
    },
    passBPromptInject: `Nature activities are anchors. A single 3-hour hike can own a morning. Everything else is filler. ${WILDCARD}`,
    passCNarrationNote:
      "Emphasize the natural beauty, the scale, and what makes this place awe-inspiring.",
  },

  bucket_list_chaser: {
    tags: ["landmarks", "viewpoints", "museums", "iconic_restaurants", "shows"],
    typeAffinities: {
      tourist_attraction: 1.5,
      landmark: 1.5,
      observation_deck: 1.3,
      scenic_spot: 1.3,
      museum: 1.2,
      restaurant: 1.3,
      fine_dining_restaurant: 1.3,
      performing_arts_theater: 1.2,
      show_venue: 1.2,
    },
    pace: "packed",
    budget: 3,
    scoring: {
      weights: std(0.3),
      touristTrapPenalty: 0,
      touristTrapThreshold: 0,
      visitDurationBias: "min",
      crowdPreference: "moderate",
      crowdPenalty: 0,
    },
    scheduling: {
      activitiesPerDay: { min: 6, max: 10, target: 8 },
      eveningActivityRequired: false,
      minSocialVenuesPerDay: 0,
      allowSolitudeSlots: false,
      mealDurationMinutes: { min: 30, preferred: 60, max: 75 },
      serendipitySlot: false,
      serendipityMaxReviews: 0,
    },
    passBPromptInject: `Prioritize the iconic, famous, must-see places. This traveler wants the postcard moments. ${NO_WILDCARD}`,
    passCNarrationNote:
      "Emphasize why this is iconic, what makes it a must-see, and the story they'll tell afterward.",
  },

  slow_immersionist: {
    tags: ["local_markets", "cafes", "neighborhoods", "cooking_classes", "temples", "artisan_shops"],
    typeAffinities: {
      market: 1.3,
      flea_market: 1.2,
      cafe: 1.3,
      coffee_shop: 1.3,
      neighborhood: 1.4,
      cooking_school: 1.3,
      temple: 1.2,
      place_of_worship: 1.2,
      art_gallery: 1.2,
      handicraft_store: 1.2,
      artisan_shop: 1.2,
    },
    pace: "relaxed",
    budget: 2,
    scoring: {
      weights: std(0.45),
      touristTrapPenalty: 0.15,
      touristTrapThreshold: 5000,
      visitDurationBias: "max",
      crowdPreference: "moderate",
      crowdPenalty: 0,
    },
    scheduling: {
      activitiesPerDay: { min: 3, max: 5, target: 4 },
      eveningActivityRequired: false,
      minSocialVenuesPerDay: 0,
      allowSolitudeSlots: true,
      mealDurationMinutes: { min: 75, preferred: 90, max: 120 },
      serendipitySlot: true,
      serendipityMaxReviews: 500,
    },
    passBPromptInject: `One neighborhood per day, explored deeply. Revisit places over checking off new ones. ${WILDCARD}`,
    passCNarrationNote:
      "Emphasize the local texture, the daily rhythms, and what makes this place feel lived-in.",
  },

  weekend_warrior: {
    tags: ["landmarks", "restaurants", "shopping", "viewpoints"],
    typeAffinities: {
      tourist_attraction: 1.4,
      landmark: 1.4,
      restaurant: 1.2,
      shopping_mall: 1.1,
      store: 1.1,
      observation_deck: 1.2,
      scenic_spot: 1.2,
    },
    pace: "packed",
    budget: 3,
    scoring: {
      weights: std(0.3),
      touristTrapPenalty: 0,
      touristTrapThreshold: 0,
      visitDurationBias: "min",
      crowdPreference: "moderate",
      crowdPenalty: 0,
    },
    scheduling: {
      activitiesPerDay: { min: 8, max: 14, target: 12 },
      eveningActivityRequired: false,
      minSocialVenuesPerDay: 0,
      allowSolitudeSlots: false,
      mealDurationMinutes: { min: 30, preferred: 45, max: 60 },
      serendipitySlot: false,
      serendipityMaxReviews: 0,
    },
    passBPromptInject: `Maximize slots. Use 'packed' pace regardless of stated preference. Every minute counts. ${NO_WILDCARD}`,
    passCNarrationNote:
      "Emphasize the payoff-per-minute — why this place is worth the time investment.",
  },
};
