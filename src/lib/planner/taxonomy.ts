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

import type { CandidatePlace, Interest } from "./types";

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

/**
 * The types a themed day's meal circle asks Google for.
 *
 * A themed Nearby Search used to send `theme.includedTypes` and nothing else,
 * so a museum day asked for museums and got them. On a live Bali run that left
 * day three with the nearest restaurant **8 km away** and no lunch — the search
 * that could have found somewhere to eat was never asked to. A day has to eat
 * whatever it is about, so the meal types are a constant here rather than
 * anything a model or a persona can talk it out of.
 *
 * Dietary needs widen it and never narrow it: `vegetarian_restaurant` is added
 * to plain `restaurant`, not substituted for it. Google types a vegetarian
 * izakaya `izakaya_restaurant`, and asking only for the specific type is how a
 * vegetarian ends up with nowhere to eat rather than somewhere to ask.
 *
 * `food_court` and `meal_takeaway` are here for street food: a hawker centre,
 * a satay street, a kopitiam. Adding `food_court` to a **search** without also
 * teaching `isRestaurant` about it would have been worse than not adding it —
 * see the note on that function.
 */
export const MEAL_SEARCH_TYPES = [
  "restaurant",
  "cafe",
  "bakery",
  "food_court",
  "meal_takeaway",
] as const;

/**
 * `MEAL_SEARCH_TYPES` plus whatever this traveller's dietary needs name.
 *
 * Note what this does **not** do: it never checks the type against the pool's
 * vocabulary the way `isSearchableType` makes a model's proposal do. That rule
 * exists to kill types a model invented, and a constant in this file is not
 * invented — requiring a cold city's first pool to already contain the word
 * `restaurant` is how a day ends up with nothing to eat.
 */
export function mealSearchTypes(dietary: readonly string[] = []): string[] {
  const types = [
    ...MEAL_SEARCH_TYPES,
    ...dietary.flatMap((need) => dietaryBridgeFor(need)?.types ?? []),
  ];
  return [...new Set(types)];
}

/**
 * Somewhere you can eat a meal. Google types a specific cuisine as
 * `ramen_restaurant` and a generic one as plain `restaurant`; both seat a meal
 * slot. It lives here rather than in the funnel because it is a question about
 * Google's type vocabulary, and because four modules ask it — the funnel's
 * quotas, the validator's meal rule, the invariant suite and Gate A. A fifth
 * private copy is how the four quietly disagree.
 *
 * **`food_court` is here because of what live data says, and the fixtures say
 * the opposite.** Of 20 `food_court` rows in the store, **12 carry no
 * `restaurant` type at all** — Satay Street @ Lau Pa Sat, Chinatown Food
 * Street, Kopitiam Food Hall, Hill Street Hainanese Curry Rice. They are
 * `food_court, food, point_of_interest, establishment` and nothing more. Every
 * one is unambiguously somewhere you eat lunch, and every one was invisible to
 * this predicate: found by retrieval, ranked by the funnel, and then unable to
 * hold the meal slot it exists to hold.
 *
 * `singapore-candidates.json` would have hidden that. All nine of its food
 * courts are the big named hawker centres, and Google does type those
 * `food_court, market, restaurant` — so both Gate A snapshots are unmoved by
 * this line and **neither fixture can protect it**. `taxonomy.test.ts` pins the
 * bare four-type shape directly for that reason.
 *
 * `meal_takeaway` is deliberately **not** here. All seven live rows carrying it
 * already carry `restaurant`, so adding it would assert something no evidence
 * supports — and a takeaway counter with no seating is a weaker claim to a
 * seventy-five-minute meal slot than a food hall is.
 */
export function isRestaurant(place: Pick<CandidatePlace, "types">): boolean {
  return place.types.some(
    (t) => t === "restaurant" || t === "food_court" || t.endsWith("_restaurant"),
  );
}
