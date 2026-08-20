# Archetype Data Payloads

The exact JSON output for each archetype across every data structure the pipeline consumes. Each section shows the four payloads that flow through the system.

**Payloads per archetype:**
1. `TravelPersonaResult` — raw quiz output
2. `PreferenceProfile` — what the pipeline's retrieval + scoring stages consume
3. `ScoringConfig` — what the scoring function uses to rank candidates
4. `SchedulingRules` — what the scheduler + Pass B + Pass C consume

---

## Data Structures Reference

```ts
// Payload 1: Quiz output
interface TravelPersonaResult {
  dimensions: { structure: number; comfort: number; focus: number; social: number }
  archetype: string
  secondaryArchetype?: string
  confidence: number
}

// Payload 2: Pipeline input (derived from Payload 1 + trip form)
interface PreferenceProfile {
  interests: string[]
  dietary: string[]
  pace: "relaxed" | "balanced" | "packed"
  budget?: 1 | 2 | 3 | 4
  typeAffinities: Record<string, number>
}

// Payload 3: Scoring layer
interface ScoringConfig {
  weights: { affinity: number; quality: number; priceFit: number; duplication: number }
  touristTrapPenalty: number
  touristTrapThreshold: number
  visitDurationBias: "min" | "preferred" | "max"
  crowdPreference: "quiet" | "moderate" | "packed"
  crowdPenalty: number
}

// Payload 4: Scheduling + LLM prompts
interface SchedulingRules {
  activitiesPerDay: { min: number; max: number; target: number }
  eveningActivityRequired: boolean
  minSocialVenuesPerDay: number
  allowSolitudeSlots: boolean
  mealDurationMinutes: { min: number; preferred: number; max: number }
  serendipitySlot: boolean
  serendipityMaxReviews: number
  passBPromptInject: string
  passCNarrationNote: string
}
```

---

## 1. The Master Planner

### Payload 1 — TravelPersonaResult
```json
{
  "dimensions": { "structure": 12, "comfort": 22, "focus": 33, "social": 42 },
  "archetype": "master_planner",
  "secondaryArchetype": "weekend_warrior",
  "confidence": 0.94
}
```

### Payload 2 — PreferenceProfile
```json
{
  "interests": ["landmarks", "museums", "architecture", "shopping"],
  "dietary": [],
  "pace": "packed",
  "budget": 3,
  "typeAffinities": {
    "landmarks": 1.4,
    "museum": 1.3,
    "tourist_attraction": 1.2,
    "art_gallery": 1.1,
    "shopping_mall": 0.9,
    "store": 0.9
  }
}
```

### Payload 3 — ScoringConfig
```json
{
  "weights": { "affinity": 0.35, "quality": 0.30, "priceFit": 0.20, "duplication": 0.10 },
  "touristTrapPenalty": 0.0,
  "touristTrapThreshold": 0,
  "visitDurationBias": "min",
  "crowdPreference": "moderate",
  "crowdPenalty": 0.0
}
```

### Payload 4 — SchedulingRules
```json
{
  "activitiesPerDay": { "min": 6, "max": 9, "target": 8 },
  "eveningActivityRequired": false,
  "minSocialVenuesPerDay": 0,
  "allowSolitudeSlots": false,
  "mealDurationMinutes": { "min": 45, "preferred": 60, "max": 75 },
  "serendipitySlot": false,
  "serendipityMaxReviews": 0,
  "passBPromptInject": "Prefers dense, well-sequenced days with minimal dead time. Do NOT include wildcard/surprise picks. This traveler wants the best-known, best-reviewed options.",
  "passCNarrationNote": "Emphasize efficiency, sequence, and what makes this a smart choice in the day's plan."
}
```

---

## 2. The Spontaneous Wanderer

### Payload 1 — TravelPersonaResult
```json
{
  "dimensions": { "structure": 88, "comfort": 62, "focus": 58, "social": 48 },
  "archetype": "spontaneous_wanderer",
  "secondaryArchetype": "soulful_soloist",
  "confidence": 0.87
}
```

### Payload 2 — PreferenceProfile
```json
{
  "interests": ["cafes", "street_art", "local_markets", "walking_tours"],
  "dietary": [],
  "pace": "relaxed",
  "budget": 2,
  "typeAffinities": {
    "cafe": 1.3,
    "coffee_shop": 1.3,
    "art_gallery": 1.2,
    "market": 1.3,
    "flea_market": 1.3,
    "walking_tour": 1.1
  }
}
```

### Payload 3 — ScoringConfig
```json
{
  "weights": { "affinity": 0.35, "quality": 0.30, "priceFit": 0.20, "duplication": 0.10 },
  "touristTrapPenalty": 0.0,
  "touristTrapThreshold": 0,
  "visitDurationBias": "preferred",
  "crowdPreference": "moderate",
  "crowdPenalty": 0.0
}
```

### Payload 4 — SchedulingRules
```json
{
  "activitiesPerDay": { "min": 3, "max": 5, "target": 4 },
  "eveningActivityRequired": false,
  "minSocialVenuesPerDay": 0,
  "allowSolitudeSlots": false,
  "mealDurationMinutes": { "min": 45, "preferred": 60, "max": 90 },
  "serendipitySlot": true,
  "serendipityMaxReviews": 500,
  "passBPromptInject": "Leave gaps. Fewer anchors, more flex candidates. Include one 'wildcard' slot per day — a lesser-known gem with fewer reviews but high quality.",
  "passCNarrationNote": "Emphasize the vibe, the unexpected charm, and why this place rewards curiosity."
}
```

---

## 3. The Cultural Diver

### Payload 1 — TravelPersonaResult
```json
{
  "dimensions": { "structure": 52, "comfort": 58, "focus": 91, "social": 50 },
  "archetype": "cultural_diver",
  "secondaryArchetype": "slow_immersionist",
  "confidence": 0.92
}
```

### Payload 2 — PreferenceProfile
```json
{
  "interests": ["museums", "temples", "local_markets", "cooking_classes", "historical_sites"],
  "dietary": [],
  "pace": "balanced",
  "budget": 2,
  "typeAffinities": {
    "museum": 1.4,
    "temple": 1.3,
    "place_of_worship": 1.3,
    "market": 1.2,
    "flea_market": 1.2,
    "cooking_school": 1.5,
    "historical_landmark": 1.3,
    "cultural_center": 1.3
  }
}
```

### Payload 3 — ScoringConfig
```json
{
  "weights": { "affinity": 0.35, "quality": 0.45, "priceFit": 0.20, "duplication": 0.10 },
  "touristTrapPenalty": 0.15,
  "touristTrapThreshold": 5000,
  "visitDurationBias": "max",
  "crowdPreference": "moderate",
  "crowdPenalty": 0.0
}
```

### Payload 4 — SchedulingRules
```json
{
  "activitiesPerDay": { "min": 4, "max": 6, "target": 5 },
  "eveningActivityRequired": false,
  "minSocialVenuesPerDay": 0,
  "allowSolitudeSlots": false,
  "mealDurationMinutes": { "min": 60, "preferred": 90, "max": 120 },
  "serendipitySlot": true,
  "serendipityMaxReviews": 500,
  "passBPromptInject": "Allow longer stays at cultural sites. Rushing past a temple is a failure. Include one 'wildcard' slot per day — a lesser-known gem with fewer reviews but high quality.",
  "passCNarrationNote": "Emphasize cultural significance, what to learn here, and the depth this place offers."
}
```

---

## 4. The Thrill Seeker

### Payload 1 — TravelPersonaResult
```json
{
  "dimensions": { "structure": 38, "comfort": 83, "focus": 48, "social": 38 },
  "archetype": "thrill_seeker",
  "secondaryArchetype": "nature_pilgrim",
  "confidence": 0.89
}
```

### Payload 2 — PreferenceProfile
```json
{
  "interests": ["outdoors", "adventure_sports", "viewpoints", "water_activities"],
  "dietary": [],
  "pace": "balanced",
  "budget": 1,
  "typeAffinities": {
    "park": 1.4,
    "hiking_area": 1.5,
    "national_park": 1.5,
    "adventure_sports_center": 1.5,
    "tourist_attraction": 1.2,
    "observation_deck": 1.2,
    "water_park": 1.3,
    "beach": 1.3
  }
}
```

### Payload 3 — ScoringConfig
```json
{
  "weights": { "affinity": 0.35, "quality": 0.30, "priceFit": 0.20, "duplication": 0.10 },
  "touristTrapPenalty": 0.0,
  "touristTrapThreshold": 0,
  "visitDurationBias": "preferred",
  "crowdPreference": "moderate",
  "crowdPenalty": 0.0
}
```

### Payload 4 — SchedulingRules
```json
{
  "activitiesPerDay": { "min": 4, "max": 7, "target": 5 },
  "eveningActivityRequired": false,
  "minSocialVenuesPerDay": 0,
  "allowSolitudeSlots": false,
  "mealDurationMinutes": { "min": 30, "preferred": 60, "max": 75 },
  "serendipitySlot": true,
  "serendipityMaxReviews": 500,
  "passBPromptInject": "Anchor days around one big activity. Fill gaps with recovery (cafes, viewpoints). Include one 'wildcard' slot per day — a lesser-known gem with fewer reviews but high quality.",
  "passCNarrationNote": "Emphasize the adrenaline, the physical experience, and what makes this an epic moment."
}
```

---

## 5. The Comfort Cruiser

### Payload 1 — TravelPersonaResult
```json
{
  "dimensions": { "structure": 22, "comfort": 8, "focus": 24, "social": 48 },
  "archetype": "comfort_cruiser",
  "secondaryArchetype": "master_planner",
  "confidence": 0.96
}
```

### Payload 2 — PreferenceProfile
```json
{
  "interests": ["spas", "fine_dining", "shopping", "scenic_drives", "resorts"],
  "dietary": [],
  "pace": "relaxed",
  "budget": 4,
  "typeAffinities": {
    "spa": 1.4,
    "day_spa": 1.4,
    "restaurant": 1.3,
    "fine_dining_restaurant": 1.3,
    "shopping_mall": 1.2,
    "boutique": 1.2,
    "scenic_spot": 1.1,
    "resort": 1.3,
    "hotel": 1.3
  }
}
```

### Payload 3 — ScoringConfig
```json
{
  "weights": { "affinity": 0.35, "quality": 0.30, "priceFit": 0.20, "duplication": 0.10 },
  "touristTrapPenalty": 0.0,
  "touristTrapThreshold": 0,
  "visitDurationBias": "max",
  "crowdPreference": "quiet",
  "crowdPenalty": 0.05
}
```

> Note: `visitDurationBias` is `"max"` despite d3=24 because `pace=relaxed` overrides the duration bias — relaxed pace stretches stays regardless of focus score.

### Payload 4 — SchedulingRules
```json
{
  "activitiesPerDay": { "min": 1, "max": 3, "target": 2 },
  "eveningActivityRequired": false,
  "minSocialVenuesPerDay": 0,
  "allowSolitudeSlots": false,
  "mealDurationMinutes": { "min": 75, "preferred": 90, "max": 120 },
  "serendipitySlot": false,
  "serendipityMaxReviews": 0,
  "passBPromptInject": "Slow days. Long meals. Never pack more than 2 activities. Do NOT include wildcard/surprise picks. This traveler wants the best-known, best-reviewed options.",
  "passCNarrationNote": "Emphasize atmosphere, quality, and what makes this a luxurious or restful experience."
}
```

---

## 6. The Culinary Nomad

### Payload 1 — TravelPersonaResult
```json
{
  "dimensions": { "structure": 43, "comfort": 53, "focus": 73, "social": 38 },
  "archetype": "culinary_nomad",
  "secondaryArchetype": "cultural_diver",
  "confidence": 0.91
}
```

### Payload 2 — PreferenceProfile
```json
{
  "interests": ["restaurants", "street_food", "local_markets", "cooking_classes", "food_tours", "cafes"],
  "dietary": [],
  "pace": "balanced",
  "budget": 2,
  "typeAffinities": {
    "restaurant": 1.5,
    "meal_delivery": 1.0,
    "fast_food_restaurant": 1.1,
    "street_food_stall": 1.4,
    "market": 1.3,
    "flea_market": 1.2,
    "cooking_school": 1.4,
    "food_tour": 1.4,
    "cafe": 1.2,
    "coffee_shop": 1.2
  }
}
```

### Payload 3 — ScoringConfig
```json
{
  "weights": { "affinity": 0.35, "quality": 0.45, "priceFit": 0.20, "duplication": 0.10 },
  "touristTrapPenalty": 0.15,
  "touristTrapThreshold": 5000,
  "visitDurationBias": "max",
  "crowdPreference": "moderate",
  "crowdPenalty": 0.0
}
```

### Payload 4 — SchedulingRules
```json
{
  "activitiesPerDay": { "min": 4, "max": 7, "target": 5 },
  "eveningActivityRequired": false,
  "minSocialVenuesPerDay": 0,
  "allowSolitudeSlots": false,
  "mealDurationMinutes": { "min": 75, "preferred": 90, "max": 120 },
  "serendipitySlot": true,
  "serendipityMaxReviews": 500,
  "passBPromptInject": "Every meal slot is a primary activity, not filler. Allow 90+ minutes for meals. Include one 'wildcard' slot per day — a lesser-known gem with fewer reviews but high quality.",
  "passCNarrationNote": "Emphasize the food story — what's unique, what to order, and why this place matters culinarily."
}
```

---

## 7. The Soulful Soloist

### Payload 1 — TravelPersonaResult
```json
{
  "dimensions": { "structure": 58, "comfort": 43, "focus": 68, "social": 92 },
  "archetype": "soulful_soloist",
  "secondaryArchetype": "spontaneous_wanderer",
  "confidence": 0.88
}
```

### Payload 2 — PreferenceProfile
```json
{
  "interests": ["temples", "nature_walks", "meditation_retreats", "bookshops", "cafes", "viewpoints"],
  "dietary": [],
  "pace": "balanced",
  "budget": 2,
  "typeAffinities": {
    "temple": 1.3,
    "place_of_worship": 1.3,
    "park": 1.3,
    "hiking_area": 1.2,
    "meditation_center": 1.4,
    "yoga_studio": 1.3,
    "book_store": 1.1,
    "cafe": 1.2,
    "coffee_shop": 1.2,
    "observation_deck": 1.2,
    "scenic_spot": 1.2
  }
}
```

### Payload 3 — ScoringConfig
```json
{
  "weights": { "affinity": 0.35, "quality": 0.40, "priceFit": 0.20, "duplication": 0.10 },
  "touristTrapPenalty": 0.0,
  "touristTrapThreshold": 0,
  "visitDurationBias": "preferred",
  "crowdPreference": "quiet",
  "crowdPenalty": 0.10
}
```

### Payload 4 — SchedulingRules
```json
{
  "activitiesPerDay": { "min": 2, "max": 5, "target": 3 },
  "eveningActivityRequired": false,
  "minSocialVenuesPerDay": 0,
  "allowSolitudeSlots": true,
  "mealDurationMinutes": { "min": 45, "preferred": 60, "max": 90 },
  "serendipitySlot": true,
  "serendipityMaxReviews": 500,
  "passBPromptInject": "Built-in solitude. No back-to-back social activities. Long cafe stays welcome. This traveler values solitude. A 'wander time' slot with no assigned place is valid. Include one 'wildcard' slot per day — a lesser-known gem with fewer reviews but high quality.",
  "passCNarrationNote": "Emphasize the reflective quality, the quiet moments, and how this place invites presence."
}
```

---

## 8. The Social Explorer

### Payload 1 — TravelPersonaResult
```json
{
  "dimensions": { "structure": 53, "comfort": 43, "focus": 58, "social": 8 },
  "archetype": "social_explorer",
  "secondaryArchetype": "culinary_nomad",
  "confidence": 0.90
}
```

### Payload 2 — PreferenceProfile
```json
{
  "interests": ["nightlife", "local_markets", "food_tours", "group_activities", "festivals", "bars"],
  "dietary": [],
  "pace": "balanced",
  "budget": 2,
  "typeAffinities": {
    "bar": 1.2,
    "night_club": 1.3,
    "karaoke_bar": 1.2,
    "market": 1.2,
    "flea_market": 1.1,
    "food_tour": 1.3,
    "event_venue": 1.4,
    "festival": 1.5,
    "entertainment_agency": 1.4,
    "performing_arts_theater": 1.3
  }
}
```

### Payload 3 — ScoringConfig
```json
{
  "weights": { "affinity": 0.35, "quality": 0.30, "priceFit": 0.20, "duplication": 0.10 },
  "touristTrapPenalty": 0.0,
  "touristTrapThreshold": 0,
  "visitDurationBias": "preferred",
  "crowdPreference": "packed",
  "crowdPenalty": 0.05
}
```

### Payload 4 — SchedulingRules
```json
{
  "activitiesPerDay": { "min": 5, "max": 8, "target": 6 },
  "eveningActivityRequired": true,
  "minSocialVenuesPerDay": 2,
  "allowSolitudeSlots": false,
  "mealDurationMinutes": { "min": 60, "preferred": 90, "max": 120 },
  "serendipitySlot": true,
  "serendipityMaxReviews": 500,
  "passBPromptInject": "Evening slots are load-bearing, not optional. Prioritize social venues after 6pm. IMPORTANT: Every day MUST include an evening activity — this traveler thrives on social evenings. Include one 'wildcard' slot per day — a lesser-known gem with fewer reviews but high quality.",
  "passCNarrationNote": "Emphasize the people, the energy, and the social opportunities this place offers."
}
```

---

## 9. The Nature Pilgrim

### Payload 1 — TravelPersonaResult
```json
{
  "dimensions": { "structure": 53, "comfort": 78, "focus": 53, "social": 63 },
  "archetype": "nature_pilgrim",
  "secondaryArchetype": "thrill_seeker",
  "confidence": 0.86
}
```

### Payload 2 — PreferenceProfile
```json
{
  "interests": ["outdoors", "hiking", "national_parks", "viewpoints", "botanical_gardens", "wildlife"],
  "dietary": [],
  "pace": "balanced",
  "budget": 1,
  "typeAffinities": {
    "park": 1.5,
    "hiking_area": 1.5,
    "national_park": 1.4,
    "nature_reserve": 1.4,
    "observation_deck": 1.3,
    "scenic_spot": 1.3,
    "botanical_garden": 1.2,
    "zoo": 1.1,
    "wildlife_park": 1.3,
    "campground": 1.2
  }
}
```

### Payload 3 — ScoringConfig
```json
{
  "weights": { "affinity": 0.35, "quality": 0.30, "priceFit": 0.20, "duplication": 0.10 },
  "touristTrapPenalty": 0.0,
  "touristTrapThreshold": 0,
  "visitDurationBias": "preferred",
  "crowdPreference": "moderate",
  "crowdPenalty": 0.0
}
```

### Payload 4 — SchedulingRules
```json
{
  "activitiesPerDay": { "min": 3, "max": 5, "target": 4 },
  "eveningActivityRequired": false,
  "minSocialVenuesPerDay": 0,
  "allowSolitudeSlots": true,
  "mealDurationMinutes": { "min": 30, "preferred": 60, "max": 75 },
  "serendipitySlot": true,
  "serendipityMaxReviews": 500,
  "passBPromptInject": "Nature activities are anchors. A single 3-hour hike can own a morning. Everything else is filler. Include one 'wildcard' slot per day — a lesser-known gem with fewer reviews but high quality.",
  "passCNarrationNote": "Emphasize the natural beauty, the scale, and what makes this place awe-inspiring."
}
```

---

## 10. The Bucket List Chaser

### Payload 1 — TravelPersonaResult
```json
{
  "dimensions": { "structure": 23, "comfort": 33, "focus": 28, "social": 38 },
  "archetype": "bucket_list_chaser",
  "secondaryArchetype": "master_planner",
  "confidence": 0.93
}
```

### Payload 2 — PreferenceProfile
```json
{
  "interests": ["landmarks", "viewpoints", "museums", "iconic_restaurants", "shows"],
  "dietary": [],
  "pace": "packed",
  "budget": 3,
  "typeAffinities": {
    "tourist_attraction": 1.5,
    "landmark": 1.5,
    "observation_deck": 1.3,
    "scenic_spot": 1.3,
    "museum": 1.2,
    "restaurant": 1.3,
    "fine_dining_restaurant": 1.3,
    "performing_arts_theater": 1.2,
    "show_venue": 1.2
  }
}
```

### Payload 3 — ScoringConfig
```json
{
  "weights": { "affinity": 0.35, "quality": 0.30, "priceFit": 0.20, "duplication": 0.10 },
  "touristTrapPenalty": 0.0,
  "touristTrapThreshold": 0,
  "visitDurationBias": "min",
  "crowdPreference": "moderate",
  "crowdPenalty": 0.0
}
```

### Payload 4 — SchedulingRules
```json
{
  "activitiesPerDay": { "min": 6, "max": 10, "target": 8 },
  "eveningActivityRequired": false,
  "minSocialVenuesPerDay": 0,
  "allowSolitudeSlots": false,
  "mealDurationMinutes": { "min": 30, "preferred": 60, "max": 75 },
  "serendipitySlot": false,
  "serendipityMaxReviews": 0,
  "passBPromptInject": "Prioritize the iconic, famous, must-see places. This traveler wants the postcard moments. Do NOT include wildcard/surprise picks. This traveler wants the best-known, best-reviewed options.",
  "passCNarrationNote": "Emphasize why this is iconic, what makes it a must-see, and the story they'll tell afterward."
}
```

---

## 11. The Slow Immersionist

### Payload 1 — TravelPersonaResult
```json
{
  "dimensions": { "structure": 68, "comfort": 38, "focus": 83, "social": 63 },
  "archetype": "slow_immersionist",
  "secondaryArchetype": "cultural_diver",
  "confidence": 0.88
}
```

### Payload 2 — PreferenceProfile
```json
{
  "interests": ["local_markets", "cafes", "neighborhoods", "cooking_classes", "temples", "artisan_shops"],
  "dietary": [],
  "pace": "relaxed",
  "budget": 2,
  "typeAffinities": {
    "market": 1.3,
    "flea_market": 1.2,
    "cafe": 1.3,
    "coffee_shop": 1.3,
    "neighborhood": 1.4,
    "cooking_school": 1.3,
    "temple": 1.2,
    "place_of_worship": 1.2,
    "art_gallery": 1.2,
    "handicraft_store": 1.2,
    "artisan_shop": 1.2
  }
}
```

### Payload 3 — ScoringConfig
```json
{
  "weights": { "affinity": 0.35, "quality": 0.45, "priceFit": 0.20, "duplication": 0.10 },
  "touristTrapPenalty": 0.15,
  "touristTrapThreshold": 5000,
  "visitDurationBias": "max",
  "crowdPreference": "moderate",
  "crowdPenalty": 0.0
}
```

### Payload 4 — SchedulingRules
```json
{
  "activitiesPerDay": { "min": 3, "max": 5, "target": 4 },
  "eveningActivityRequired": false,
  "minSocialVenuesPerDay": 0,
  "allowSolitudeSlots": true,
  "mealDurationMinutes": { "min": 75, "preferred": 90, "max": 120 },
  "serendipitySlot": true,
  "serendipityMaxReviews": 500,
  "passBPromptInject": "One neighborhood per day, explored deeply. Revisit places over checking off new ones. Include one 'wildcard' slot per day — a lesser-known gem with fewer reviews but high quality.",
  "passCNarrationNote": "Emphasize the local texture, the daily rhythms, and what makes this place feel lived-in."
}
```

---

## 12. The Weekend Warrior

### Payload 1 — TravelPersonaResult
```json
{
  "dimensions": { "structure": 13, "comfort": 33, "focus": 38, "social": 28 },
  "archetype": "weekend_warrior",
  "secondaryArchetype": "master_planner",
  "confidence": 0.95
}
```

### Payload 2 — PreferenceProfile
```json
{
  "interests": ["landmarks", "restaurants", "shopping", "viewpoints"],
  "dietary": [],
  "pace": "packed",
  "budget": 3,
  "typeAffinities": {
    "tourist_attraction": 1.4,
    "landmark": 1.4,
    "restaurant": 1.2,
    "shopping_mall": 1.1,
    "store": 1.1,
    "observation_deck": 1.2,
    "scenic_spot": 1.2
  }
}
```

### Payload 3 — ScoringConfig
```json
{
  "weights": { "affinity": 0.35, "quality": 0.30, "priceFit": 0.20, "duplication": 0.10 },
  "touristTrapPenalty": 0.0,
  "touristTrapThreshold": 0,
  "visitDurationBias": "min",
  "crowdPreference": "moderate",
  "crowdPenalty": 0.0
}
```

### Payload 4 — SchedulingRules
```json
{
  "activitiesPerDay": { "min": 8, "max": 14, "target": 12 },
  "eveningActivityRequired": false,
  "minSocialVenuesPerDay": 0,
  "allowSolitudeSlots": false,
  "mealDurationMinutes": { "min": 30, "preferred": 45, "max": 60 },
  "serendipitySlot": false,
  "serendipityMaxReviews": 0,
  "passBPromptInject": "Maximize slots. Use 'packed' pace regardless of stated preference. Every minute counts. Do NOT include wildcard/surprise picks. This traveler wants the best-known, best-reviewed options.",
  "passCNarrationNote": "Emphasize the payoff-per-minute — why this place is worth the time investment."
}
```

---

## Quick Lookup — Key Differences at a Glance

| Field | Planner types | Spontaneous types | Immersion types | Social types |
|-------|:---:|:---:|:---:|:---:|
| `pace` | `"packed"` | `"relaxed"` | `"balanced"` / `"relaxed"` | `"balanced"` |
| `activitiesPerDay.target` | 8–12 | 3–5 | 4–5 | 6 |
| `mealDurationMinutes.preferred` | 45–60 | 60 | 90 | 90 |
| `serendipitySlot` | `false` | `true` | `true` | `true` |
| `eveningActivityRequired` | `false` | `false` | `false` | **`true`** |
| `allowSolitudeSlots` | `false` | `false` | **`true`** | `false` |
| `touristTrapPenalty` | `0.0` | `0.0` | **`0.15`** | `0.0` |
| `qualityWeight` | `0.30` | `0.30` | **`0.45`** | `0.30` |
| `visitDurationBias` | `"min"` | `"preferred"` | **`"max"`** | `"preferred"` |
| `crowdPreference` | `"moderate"` | `"moderate"` | `"moderate"` / `"quiet"` | **`"packed"`** |
| `budget` | `3` | `1–2` | `1–2` | `2` |

**Planner types:** Master Planner, Bucket List Chaser, Weekend Warrior
**Spontaneous types:** Spontaneous Wanderer, Nature Pilgrim
**Immersion types:** Cultural Diver, Culinary Nomad, Soulful Soloist, Slow Immersionist
**Social types:** Social Explorer

> Note: Some archetypes straddle categories. Comfort Cruiser is a planner type with `visitDurationBias: "max"` (unusual — driven by relaxed pace overriding focus score). Thrill Seeker is closer to spontaneous with moderate structure.
