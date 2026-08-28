import type { Interest, Pace, PreferenceProfile } from "@/lib/planner/types";
import type { PersonaResult } from "@/lib/persona/types";
import { ARCHETYPE_PRESETS } from "@/lib/persona/presets";
import { deriveBudget, derivePace } from "@/lib/persona/profile";

import type {
  PreferenceDefinition,
  PreferenceGroup,
  SavedTravelPreferences,
} from "./types";

const GROUPS: Record<string, PreferenceGroup> = {
  culture: "Culture & sights",
  food: "Food & drink",
  nature: "Nature & adventure",
  wellness: "Wellness & rest",
  local: "Local life & social",
  practical: "Practical preferences",
};

const interest = (
  id: string,
  label: string,
  group: PreferenceGroup,
  aliases: string[],
  placeTypes: string[],
): PreferenceDefinition => ({ id, label, category: "interest", group, aliases, placeTypes });

export const PREFERENCE_REGISTRY: readonly PreferenceDefinition[] = [
  interest("architecture", "Architecture", GROUPS.culture, ["architecture", "buildings", "design"], ["historical_landmark"]),
  interest("historical_sites", "Historical sites", GROUPS.culture, ["historical sites", "history", "heritage"], ["historical_landmark"]),
  interest("landmarks", "Landmarks", GROUPS.culture, ["landmarks", "famous sights", "monuments"], ["tourist_attraction"]),
  interest("museums", "Museums", GROUPS.culture, ["museums", "galleries", "exhibitions"], ["museum", "art_gallery"]),
  interest("shows", "Shows", GROUPS.culture, ["shows", "theatre", "theater", "performances"], ["performing_arts_theater"]),
  interest("street_art", "Street art", GROUPS.culture, ["street art", "murals", "graffiti"], ["art_gallery"]),
  interest("temples", "Temples", GROUPS.culture, ["temples", "shrines", "sacred sites"], ["hindu_temple", "place_of_worship"]),

  interest("bars", "Bars", GROUPS.food, ["bars", "cocktails", "pubs"], ["bar"]),
  interest("cafes", "Cafés", GROUPS.food, ["cafes", "coffee", "bakeries", "local bakeries"], ["cafe", "bakery"]),
  interest("cooking_classes", "Cooking classes", GROUPS.food, ["cooking classes", "learn to cook"], ["cooking_class"]),
  interest("fine_dining", "Fine dining", GROUPS.food, ["fine dining", "tasting menus"], ["fine_dining_restaurant"]),
  interest("food_tours", "Food tours", GROUPS.food, ["food tours", "culinary tours"], ["tour_agency", "restaurant"]),
  interest("iconic_restaurants", "Iconic restaurants", GROUPS.food, ["iconic restaurants", "famous restaurants"], ["restaurant"]),
  interest("restaurants", "Restaurants", GROUPS.food, ["restaurants", "dining out"], ["restaurant"]),
  interest("street_food", "Street food", GROUPS.food, ["street food", "hawker food", "food stalls"], ["restaurant", "food_court"]),

  interest("adventure_sports", "Adventure sports", GROUPS.nature, ["adventure sports", "extreme sports"], ["adventure_sports_center"]),
  interest("botanical_gardens", "Botanical gardens", GROUPS.nature, ["botanical gardens", "gardens"], ["botanical_garden"]),
  interest("hiking", "Hiking", GROUPS.nature, ["hiking", "hikes", "trails", "trekking", "sunrise hikes"], ["hiking_area", "national_park"]),
  interest("national_parks", "National parks", GROUPS.nature, ["national parks", "nature reserves"], ["national_park"]),
  interest("nature_walks", "Nature walks", GROUPS.nature, ["nature walks", "forest walks"], ["park"]),
  interest("outdoors", "Outdoors", GROUPS.nature, ["outdoors", "outdoor activities"], ["park"]),
  interest("scenic_drives", "Scenic drives", GROUPS.nature, ["scenic drives", "road trips"], ["tourist_attraction"]),
  interest("viewpoints", "Viewpoints", GROUPS.nature, ["viewpoints", "views", "lookouts", "sunsets"], ["tourist_attraction"]),
  interest("water_activities", "Water activities", GROUPS.nature, ["water activities", "kayaking", "surfing", "snorkeling"], ["marina"]),
  interest("wildlife", "Wildlife", GROUPS.nature, ["wildlife", "animals", "birdwatching"], ["wildlife_park", "zoo"]),

  interest("meditation_retreats", "Meditation retreats", GROUPS.wellness, ["meditation retreats", "meditation", "mindfulness"], ["meditation_center"]),
  interest("resorts", "Resorts", GROUPS.wellness, ["resorts", "resort stays"], ["resort_hotel"]),
  interest("spas", "Spas", GROUPS.wellness, ["spas", "spa", "wellness treatments"], ["spa"]),

  interest("artisan_shops", "Artisan shops", GROUPS.local, ["artisan shops", "craft shops", "local crafts"], ["store"]),
  interest("bookshops", "Bookshops", GROUPS.local, ["bookshops", "bookstores", "books"], ["book_store"]),
  interest("festivals", "Festivals", GROUPS.local, ["festivals", "carnivals"], ["event_venue"]),
  interest("group_activities", "Group activities", GROUPS.local, ["group activities", "meet people", "social activities"], ["community_center"]),
  interest("local_markets", "Local markets", GROUPS.local, ["local markets", "markets", "flea markets"], ["market"]),
  interest("neighborhoods", "Neighbourhoods", GROUPS.local, ["neighborhoods", "neighbourhoods", "local areas"], ["tourist_attraction"]),
  interest("nightlife", "Nightlife", GROUPS.local, ["nightlife", "clubs", "late nights"], ["night_club"]),
  interest("shopping", "Shopping", GROUPS.local, ["shopping", "malls", "boutiques"], ["shopping_mall", "store"]),
  interest("walking_tours", "Walking tours", GROUPS.local, ["walking tours", "guided walks"], ["tour_agency"]),

  { id: "vegetarian", label: "Vegetarian", category: "dietary", group: GROUPS.practical, aliases: ["vegetarian", "no meat"], requiresConfirmation: true },
  { id: "vegan", label: "Vegan", category: "dietary", group: GROUPS.practical, aliases: ["vegan", "plant based", "plant-based"], requiresConfirmation: true },
  { id: "seafood_allergy", label: "Seafood allergy", category: "dietary", group: GROUPS.practical, aliases: ["allergic to seafood", "seafood allergy", "shellfish allergy", "allergic to shellfish"], requiresConfirmation: true },
  { id: "breakfast_focus", label: "Breakfast person", category: "meal", group: GROUPS.practical, aliases: ["breakfast person", "breakfast", "brunch", "morning meals"] },
  { id: "early_evenings", label: "Early evenings", category: "schedule", group: GROUPS.practical, aliases: ["don't like to stay out late", "dont like to stay out late", "not stay out late", "avoid late nights", "early nights", "early evenings"], requiresConfirmation: true },
] as const;

export const PREFERENCE_BY_ID = new Map(PREFERENCE_REGISTRY.map((item) => [item.id, item]));
export const PREFERENCE_GROUPS = Object.values(GROUPS);

const TAG_TO_INTEREST: Record<string, Interest> = {
  outdoors: "outdoors", hiking: "outdoors", national_parks: "outdoors", viewpoints: "outdoors",
  botanical_gardens: "outdoors", wildlife: "outdoors", nature_walks: "outdoors", adventure_sports: "outdoors",
  water_activities: "outdoors", scenic_drives: "outdoors", cafes: "cafes", temples: "temples",
  meditation_retreats: "temples", museums: "museums", historical_sites: "museums", architecture: "museums",
  street_art: "museums", landmarks: "museums", shows: "museums", restaurants: "food", street_food: "food",
  food_tours: "food", cooking_classes: "food", fine_dining: "food", iconic_restaurants: "food",
  nightlife: "nightlife", bars: "nightlife", festivals: "nightlife", group_activities: "nightlife",
  shopping: "shopping", local_markets: "shopping", artisan_shops: "shopping",
};

export function getPersonaPreferenceIds(persona?: PersonaResult | null): string[] {
  if (!persona) return [];
  return ARCHETYPE_PRESETS[persona.archetype.id].tags.filter((id) => PREFERENCE_BY_ID.has(id));
}

export function buildPreferenceProfile(
  selectedIds: readonly string[],
  persona?: PersonaResult | null,
): PreferenceProfile {
  const interests: Interest[] = [];
  const dietary: string[] = [];
  const typeAffinities: Record<string, number> = {};

  for (const id of selectedIds) {
    const definition = PREFERENCE_BY_ID.get(id);
    if (!definition) continue;
    const mapped = TAG_TO_INTEREST[id];
    if (mapped && !interests.includes(mapped)) interests.push(mapped);
    if (definition.category === "dietary") dietary.push(id);
    for (const type of definition.placeTypes ?? []) typeAffinities[type] = 1.35;
  }

  return {
    interests,
    dietary,
    pace: persona ? derivePace(persona) : ("balanced" satisfies Pace),
    budget: persona ? deriveBudget(persona) : undefined,
    typeAffinities,
  };
}

/**
 * Builds the stored shape from the ids a traveller picked.
 *
 * `now` is a parameter because the server calls this too, and everything
 * server-side in this codebase takes its clock rather than reading one — the
 * same rule `rng` and `now` follow through the planner. The browser can leave
 * it out.
 */
export function createSavedPreferences(
  selectedIds: readonly string[],
  confirmedConstraintIds: readonly string[],
  preferredEndTime: string | undefined,
  persona?: PersonaResult | null,
  now: Date = new Date(),
): SavedTravelPreferences {
  const validIds = [...new Set(selectedIds)].filter((id) => PREFERENCE_BY_ID.has(id));
  return {
    selectedIds: validIds,
    confirmedConstraintIds: [...new Set(confirmedConstraintIds)].filter((id) => validIds.includes(id)),
    preferredEndTime: validIds.includes("early_evenings") ? preferredEndTime : undefined,
    profile: buildPreferenceProfile(validIds, persona),
    updatedAt: now.toISOString(),
  };
}

export function isSavedTravelPreferences(value: unknown): value is SavedTravelPreferences {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SavedTravelPreferences>;
  return Array.isArray(candidate.selectedIds) && Array.isArray(candidate.confirmedConstraintIds);
}

