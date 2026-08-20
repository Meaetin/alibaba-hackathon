/**
 * The taxonomy bridge: static mapping from the fixed `Interest` union (and
 * dietary needs) to Google Places types + text queries. See "Stage 2 —
 * Retrieval" in `docs/personalization-pipeline.md`.
 *
 * Why both types AND text queries: Google's `includedTypes` filter is coarse
 * (a great vegetarian-friendly izakaya is typed `izakaya_restaurant`, not
 * `vegetarian_restaurant`). Text Search catches the long tail.
 *
 * Queries carry a `{city}` placeholder interpolated by `queriesFor` — never
 * send a raw row to retrieval.
 */

import type { Interest } from "./types";

export interface TaxonomyBridge {
  /** Google Places types — used as `includedType` filters and for affinity scoring. */
  types: readonly string[];
  /** Text Search queries with a `{city}` placeholder. */
  queries: readonly string[];
}

/**
 * One row per Interest. `Record<Interest, …>` is the exhaustiveness guarantee:
 * adding a union member in types.ts without a row here is a compile error.
 */
const INTEREST_BRIDGE: Record<Interest, TaxonomyBridge> = {
  outdoors: {
    types: ["park", "hiking_area", "botanical_garden", "garden", "national_park"],
    queries: ["scenic walk in {city}", "viewpoint {city}"],
  },
  cafes: {
    types: ["cafe", "coffee_shop"],
    queries: ["specialty coffee {city}", "kissaten {city}"],
  },
  temples: {
    types: ["place_of_worship", "historical_landmark", "monument"],
    queries: ["must-see temples {city}", "shrines and temples {city}"],
  },
  museums: {
    types: ["museum", "art_gallery"],
    queries: ["best museums {city}", "art galleries {city}"],
  },
  food: {
    types: ["restaurant", "food_court", "market"],
    queries: ["best local food {city}", "street food {city}"],
  },
  nightlife: {
    types: ["bar", "pub", "wine_bar", "night_club"],
    queries: ["cocktail bars {city}", "nightlife {city}"],
  },
  shopping: {
    types: ["shopping_mall", "department_store", "market"],
    queries: ["local markets {city}", "shopping streets {city}"],
  },
};

/**
 * Dietary needs are free-form strings on the profile (hard constraints, not
 * taxonomy members), so this bridge is best-effort: known needs get retrieval
 * rows; unknown ones return undefined and are handled by filtering alone.
 */
const DIETARY_BRIDGE: Record<string, TaxonomyBridge> = {
  vegetarian: {
    types: ["vegetarian_restaurant", "vegan_restaurant"],
    queries: ["vegetarian restaurants {city}", "vegan friendly restaurants {city}"],
  },
  vegan: {
    types: ["vegan_restaurant"],
    queries: ["vegan restaurants {city}"],
  },
};

/** Every Interest, derived from the bridge so the two can never drift. */
export const ALL_INTERESTS = Object.keys(INTEREST_BRIDGE) as readonly Interest[];

export function bridgeFor(interest: Interest): TaxonomyBridge {
  return INTEREST_BRIDGE[interest];
}

/** Text queries for one interest with `{city}` interpolated. */
export function queriesFor(interest: Interest, city: string): string[] {
  return INTEREST_BRIDGE[interest].queries.map((q) => q.replaceAll("{city}", city));
}

/**
 * The union of types across interests, deduped and in first-seen order.
 * Retrieval bills per query — a type shared by two interests must be
 * requested once.
 */
export function typesFor(interests: readonly Interest[]): string[] {
  return [...new Set(interests.flatMap((i) => INTEREST_BRIDGE[i].types))];
}

export function dietaryBridgeFor(dietary: string): TaxonomyBridge | undefined {
  return Object.hasOwn(DIETARY_BRIDGE, dietary) ? DIETARY_BRIDGE[dietary] : undefined;
}
