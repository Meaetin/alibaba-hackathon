# Quiz → Pipeline Bridge — Data Mapping Spec

How the Travel Persona Quiz output feeds the Hyper-Personalized Itinerary Pipeline.
This is the contract between the quiz (what it produces) and the pipeline (what it consumes).

---

## The Problem

Two systems, two data shapes:

| System | Produces | Consumes |
|--------|----------|----------|
| **Quiz** | 4 dimension scores (d1–d4, each 0–100) + 1 archetype match | — |
| **Pipeline** | — | `PreferenceProfile { interests[], dietary[], pace, budget?, typeAffinities? }` |

The quiz is rich on *personality* but doesn't ask about specific interests (cafes? temples? hiking?) or dietary needs. The pipeline is rich on *place taxonomy* but doesn't know anything about the traveler's temperament. This bridge defines the translation layer.

---

## Architecture: Two Data Sources, One Profile

```
┌─────────────────┐     ┌──────────────────────┐
│  Persona Quiz   │     │  Trip Setup Form     │
│  (12 questions) │     │  (city, dates, etc.) │
└────────┬────────┘     └──────────┬───────────┘
         │                         │
         │  TravelPersonaResult    │  TripInputs
         │  { dimensions,          │  { city, totalDays,
         │    archetype,           │    dietary[], budget?,
         │    dimensionScores }    │    interestOverrides[] }
         │                         │
         ▼                         ▼
    ┌────────────────────────────────────┐
    │       Profile Builder              │
    │   (src/lib/planner/profile.ts)     │
    │                                    │
    │   persona + tripInputs             │
    │     → PreferenceProfile            │
    └──────────────┬─────────────────────┘
                   │
                   ▼
    ┌────────────────────────────────────┐
    │       Personalization Pipeline     │
    │   (retrieval → scoring → …)        │
    └────────────────────────────────────┘
```

The quiz never *replaces* the trip setup form — it **augments** it. The user still picks a city, dates, and dietary needs. The quiz adds the personality layer that determines *how* those choices get fulfilled.

---

## 1. Quiz Output → TypeScript Interface

The quiz must produce a structured result object, not just an archetype name:

```ts
interface TravelPersonaResult {
  /** Raw 0–100 scores on each dimension */
  dimensions: {
    structure: number    // d1: 0 = planner, 100 = spontaneous
    comfort: number      // d2: 0 = luxury, 100 = roughing it
    focus: number        // d3: 0 = highlights, 100 = deep immersion
    social: number       // d4: 0 = group, 100 = solo
  }

  /** Closest-match archetype ID */
  archetype: TravelArchetype

  /** Second-closest archetype (the "secondary blend") */
  secondaryArchetype?: TravelArchetype

  /** Euclidean distance to the primary archetype (lower = stronger match) */
  confidence: number
}

type TravelArchetype =
  | "master_planner"
  | "spontaneous_wanderer"
  | "cultural_diver"
  | "thrill_seeker"
  | "comfort_cruiser"
  | "culinary_nomad"
  | "soulful_soloist"
  | "social_explorer"
  | "nature_pilgrim"
  | "bucket_list_chaser"
  | "slow_immersionist"
  | "weekend_warrior"
```

**Why emit dimension scores AND archetype?** The archetype is the human-readable label ("you're a Cultural Diver!"). The dimension scores are the machine-readable input that the pipeline actually uses for fine-grained decisions. Two Cultural Divers with different comfort scores should get very different itineraries.

---

## 2. The Bridge: Archetype → Interest Presets

Each archetype carries a **base interest profile** — the set of Google Places categories that type naturally gravitates toward. This is the core translation: turning personality into searchable place types.

### Archetype Interest Map

```ts
const ARCHETYPE_INTERESTS: Record<TravelArchetype, ArchetypeInterestPreset> = {

  master_planner: {
    // Structured, experience-collecting, moderate comfort
    baseInterests: ["landmarks", "museums", "architecture", "shopping"],
    interestWeights: { landmarks: 1.4, museums: 1.3, architecture: 1.1, shopping: 0.9 },
    serendipitySlot: false,        // planners don't want wildcards
    pacingNotes: "Prefers dense, well-sequenced days with minimal dead time",
  },

  spontaneous_wanderer: {
    // Unplanned, adaptable, moderate-to-high comfort tolerance
    baseInterests: ["cafes", "street_art", "local_markets", "walking_tours"],
    interestWeights: { cafes: 1.3, street_art: 1.2, local_markets: 1.3, walking_tours: 1.1 },
    serendipitySlot: true,          // thrives on surprises
    pacingNotes: "Leave gaps. Fewer anchors, more flex candidates.",
  },

  cultural_diver: {
    // High immersion, curious, comfortable going local
    baseInterests: ["museums", "temples", "local_markets", "cooking_classes", "historical_sites"],
    interestWeights: { museums: 1.4, temples: 1.3, local_markets: 1.2, cooking_classes: 1.5, historical_sites: 1.3 },
    serendipitySlot: true,
    pacingNotes: "Allow longer stays at cultural sites. Rushing past a temple is a failure.",
  },

  thrill_seeker: {
    // High comfort tolerance, physical, experience-driven
    baseInterests: ["outdoors", "adventure_sports", "viewpoints", "water_activities"],
    interestWeights: { outdoors: 1.4, adventure_sports: 1.5, viewpoints: 1.2, water_activities: 1.3 },
    serendipitySlot: true,
    pacingNotes: "Anchor days around one big activity. Fill gaps with recovery (cafes, viewpoints).",
  },

  comfort_cruiser: {
    // Luxury-first, structured, low immersion tolerance
    baseInterests: ["spas", "fine_dining", "shopping", "scenic_drives", "resorts"],
    interestWeights: { spas: 1.4, fine_dining: 1.3, shopping: 1.2, scenic_drives: 1.1, resorts: 1.3 },
    serendipitySlot: false,
    pacingNotes: "Slow days. Long meals. Never pack more than 2 activities.",
  },

  culinary_nomad: {
    // Food IS the trip, high immersion, moderate comfort
    baseInterests: ["restaurants", "street_food", "local_markets", "cooking_classes", "food_tours", "cafes"],
    interestWeights: { restaurants: 1.5, street_food: 1.4, local_markets: 1.3, cooking_classes: 1.4, food_tours: 1.4, cafes: 1.2 },
    serendipitySlot: true,          // the hidden gem IS the serendipity
    pacingNotes: "Every meal slot is a primary activity, not filler. Allow 90+ min for meals.",
  },

  soulful_soloist: {
    // Reflective, solo, immersive, moderate comfort
    baseInterests: ["temples", "nature_walks", "meditation_retreats", "bookshops", "cafes", "viewpoints"],
    interestWeights: { temples: 1.3, nature_walks: 1.3, meditation_retreats: 1.4, bookshops: 1.1, cafes: 1.2, viewpoints: 1.2 },
    serendipitySlot: true,
    pacingNotes: "Built-in solitude. No back-to-back social activities. Long cafe stays welcome.",
  },

  social_explorer: {
    // People-first, group-friendly, moderate everything
    baseInterests: ["nightlife", "local_markets", "food_tours", "group_activities", "festivals", "bars"],
    interestWeights: { nightlife: 1.3, local_markets: 1.2, food_tours: 1.3, group_activities: 1.4, festivals: 1.5, bars: 1.2 },
    serendipitySlot: true,
    pacingNotes: "Evening slots are load-bearing, not optional. Prioritize social venues after 6pm.",
  },

  nature_pilgrim: {
    // Outdoorsy, high comfort tolerance, solo-leaning
    baseInterests: ["outdoors", "hiking", "national_parks", "viewpoints", "botanical_gardens", "wildlife"],
    interestWeights: { outdoors: 1.5, hiking: 1.5, national_parks: 1.4, viewpoints: 1.3, botanical_gardens: 1.2, wildlife: 1.3 },
    serendipitySlot: true,
    pacingNotes: "Nature activities are anchors (2–4 hours each). Cities are transit, not destinations.",
  },

  bucket_list_chaser: {
    // Iconic experiences, structured, moderate comfort
    baseInterests: ["landmarks", "viewpoints", "museums", "iconic_restaurants", "shows"],
    interestWeights: { landmarks: 1.5, viewpoints: 1.3, museums: 1.2, iconic_restaurants: 1.3, shows: 1.2 },
    serendipitySlot: false,         // wants the famous things, not hidden gems
    pacingNotes: "Dense days hitting the must-sees. Quality-adjusted rating weighs heavily (famous = high reviews).",
  },

  slow_immersionist: {
    // Slow pace, deep immersion, moderate comfort
    baseInterests: ["local_markets", "cafes", "neighborhoods", "cooking_classes", "temples", "artisan_shops"],
    interestWeights: { local_markets: 1.3, cafes: 1.3, neighborhoods: 1.4, cooking_classes: 1.3, temples: 1.2, artisan_shops: 1.2 },
    serendipitySlot: true,
    pacingNotes: "One area per day, explored deeply. Revisit places over checking off new ones.",
  },

  weekend_warrior: {
    // Efficient, structured, time-maximizing
    baseInterests: ["landmarks", "restaurants", "shopping", "viewpoints"],
    interestWeights: { landmarks: 1.4, restaurants: 1.2, shopping: 1.1, viewpoints: 1.2 },
    serendipitySlot: false,
    pacingNotes: "Maximize slots. Use 'packed' pace regardless of stated preference. Every minute counts.",
  },
}

interface ArchetypeInterestPreset {
  /** Interest taxonomy keys — feeds the taxonomy bridge to Google Places types */
  baseInterests: string[]
  /** Scoring multipliers per interest — boosts/reduces affinity score */
  interestWeights: Record<string, number>
  /** Whether to include the serendipity/wildcard slot per day */
  serendipitySlot: boolean
  /** Natural-language pacing guidance for the Pass B system prompt */
  pacingNotes: string
}
```

### How This Feeds the Pipeline

The pipeline's `PreferenceProfile.interests` field currently comes from onboarding chips (user picks "outdoors", "cafes", etc.). With the quiz, interests are **derived** instead:

```ts
function buildProfile(
  persona: TravelPersonaResult,
  tripInputs: TripInputs
): PreferenceProfile {
  const preset = ARCHETYPE_INTERESTS[persona.archetype]

  // Start from archetype's base interests
  let interests = [...preset.baseInterests]

  // User can override/add interests in the trip form (hard override wins)
  if (tripInputs.interestOverrides?.length) {
    interests = [...tripInputs.interestOverrides]
  }

  // Build typeAffinities from archetype weights
  const typeAffinities: Record<string, number> = {}
  for (const [type, weight] of Object.entries(preset.interestWeights)) {
    typeAffinities[type] = weight
  }

  return {
    interests,
    dietary: tripInputs.dietary,           // always from the form, never inferred
    pace: derivePace(persona),              // see §3
    budget: tripInputs.budget ?? deriveBudget(persona),  // form wins; fallback to persona
    typeAffinities,
  }
}
```

---

## 3. Dimension Scores → Pipeline Parameters

Beyond interests, the raw dimension scores adjust several pipeline behaviors:

### d1 (Structure) → `pace`

```ts
function derivePace(persona: TravelPersonaResult): "relaxed" | "balanced" | "packed" {
  const d1 = persona.dimensions.structure

  // Low d1 = planner = packed days (they want to maximize)
  // High d1 = spontaneous = relaxed (they want flexibility)
  if (d1 <= 30) return "packed"
  if (d1 <= 65) return "balanced"
  return "relaxed"
}
```

**Override:** The `weekend_warrior` and `bucket_list_chaser` archetypes force "packed" regardless of the continuous score, because their identity depends on time-maximization.

### d2 (Comfort) → `budget` fallback

```ts
function deriveBudget(persona: TravelPersonaResult): 1 | 2 | 3 | 4 | undefined {
  const d2 = persona.dimensions.comfort

  // Low d2 = luxury-first → higher budget tier
  // High d2 = roughing it → lower budget tier
  if (d2 <= 20) return 4     // luxury
  if (d2 <= 40) return 3     // moderate-high
  if (d2 <= 65) return 2     // moderate
  return 1                    // budget
}
```

**Important:** Budget from the quiz is a *fallback*. If the user explicitly sets a budget in the trip form, that always wins. The quiz-derived budget is only used when the user skips the budget field.

### d3 (Focus) → scoring weight adjustments

```ts
function getFocusScoringAdjustments(persona: TravelPersonaResult) {
  const d3 = persona.dimensions.focus

  return {
    // High d3 (immersion) → boost quality weight (depth over popularity)
    // Low d3 (highlights) → boost popularity signal (famous = good)
    qualityWeight: d3 > 60 ? 0.45 : 0.30,
    popularityWeight: d3 < 40 ? 0.25 : 0.10,

    // High d3 → penalize tourist traps (high review count but generic)
    touristTrapPenalty: d3 > 70 ? 0.15 : 0.0,

    // High d3 → longer minimum visit durations (don't rush cultural sites)
    visitDurationBias: d3 > 70 ? "max" : d3 < 30 ? "min" : "preferred",
  }
}
```

### d4 (Social) → scheduling adjustments

```ts
function getSocialSchedulingRules(persona: TravelPersonaResult) {
  const d4 = persona.dimensions.social

  return {
    // Low d4 (group) → require evening activities, prioritize social venues
    eveningActivityRequired: d4 < 30,
    minSocialVenuesPerDay: d4 < 30 ? 2 : d4 < 60 ? 1 : 0,

    // High d4 (solo) → allow quiet slots, prefer low-crowd places
    preferQuietPlaces: d4 > 70,
    allowSolitudeSlots: d4 > 60,       // "wander time" as a valid slot role

    // Crowd profile adjustment in scoring
    crowdPreference: d4 > 70 ? "quiet" : d4 < 30 ? "packed" : "moderate",
  }
}
```

---

## 4. Pass B System Prompt Augmentation

The archetype's `pacingNotes` string is injected into the **Pass B system prompt** — the LLM that assigns places to day slots. This is where personality becomes behaviorally visible in the itinerary:

```ts
function buildPassBSystemPrompt(
  persona: TravelPersonaResult,
  socialRules: SocialSchedulingRules,
): string {
  const preset = ARCHETYPE_INTERESTS[persona.archetype]

  return `You are planning a trip for a ${persona.archetype.replace(/_/g, ' ')}.

TRAVELER PROFILE:
${preset.pacingNotes}

${socialRules.eveningActivityRequired ? "IMPORTANT: Every day MUST include an evening activity — this traveler thrives on social evenings." : ""}
${socialRules.allowSolitudeSlots ? "This traveler values solitude. A 'wander time' slot with no assigned place is valid." : ""}
${persona.archetype === 'culinary_nomad' ? "Meal slots are primary activities. Allow 90–120 minutes minimum. Recommend signature dishes." : ""}
${persona.archetype === 'nature_pilgrim' ? "Nature activities are anchors. A single 3-hour hike can own a morning. Everything else is filler." : ""}
${persona.archetype === 'slow_immersionist' ? "One neighborhood per day. Depth over breadth. If a place deserves 3 hours, give it 3 hours." : ""}
${persona.archetype === 'bucket_list_chaser' ? "Prioritize the iconic, famous, must-see places. This traveler wants the postcard moments." : ""}
${preset.serendipitySlot ? "Include one 'wildcard' slot per day — a lesser-known gem with fewer reviews but high quality." : "Do NOT include wildcard/surprise picks. This traveler wants the best-known, best-reviewed options."}`
}
```

---

## 5. Pass C Narration Augmentation

The "why this place for you" copy in Pass C receives the archetype context, so it can write personality-aware explanations:

```ts
function buildPassCProfileSlice(persona: TravelPersonaResult) {
  return {
    archetype: persona.archetype,
    archetypeLabel: ARCHETYPE_LABELS[persona.archetype],
    personalityNote: ARCHETYPE_NARRATION_NOTES[persona.archetype],
    // e.g., for cultural_diver:
    // "This traveler seeks depth and understanding. Emphasize what makes this place culturally significant, not just that it's popular."
    // for comfort_cruiser:
    // "This traveler values comfort and ease. Emphasize the experience quality, atmosphere, and what makes this a relaxing choice."
  }
}

const ARCHETYPE_NARRATION_NOTES: Record<TravelArchetype, string> = {
  master_planner:       "Emphasize efficiency, sequence, and what makes this a smart choice in the day's plan.",
  spontaneous_wanderer: "Emphasize the vibe, the unexpected charm, and why this place rewards curiosity.",
  cultural_diver:       "Emphasize cultural significance, what to learn here, and the depth this place offers.",
  thrill_seeker:        "Emphasize the adrenaline, the physical experience, and what makes this an epic moment.",
  comfort_cruiser:      "Emphasize atmosphere, quality, and what makes this a luxurious or restful experience.",
  culinary_nomad:       "Emphasize the food story — what's unique, what to order, and why this place matters culinarily.",
  soulful_soloist:      "Emphasize the reflective quality, the quiet moments, and how this place invites presence.",
  social_explorer:      "Emphasize the people, the energy, and the social opportunities this place offers.",
  nature_pilgrim:       "Emphasize the natural beauty, the scale, and what makes this place awe-inspiring.",
  bucket_list_chaser:   "Emphasize why this is iconic, what makes it a must-see, and the story they'll tell afterward.",
  slow_immersionist:    "Emphasize the local texture, the daily rhythms, and what makes this place feel lived-in.",
  weekend_warrior:      "Emphasize the payoff-per-minute — why this place is worth the time investment.",
}
```

---

## 6. Scoring Formula Adjustments

The Stage 3 scoring formula gains persona-aware weight modifiers:

```ts
// Base formula (from pipeline spec):
// score = w1·affinity + w2·quality + w3·priceFit − w4·duplication

// With persona adjustments:
function scorePlaceWithPersona(
  place: PlaceCandidate,
  profile: PreferenceProfile,
  persona: TravelPersonaResult,
  focusAdj: FocusScoringAdjustments,
  socialRules: SocialSchedulingRules,
): ScoredPlace {

  const affinity = computeAffinity(place.types, profile.interests, profile.typeAffinities)
  const quality = computeBayesianQuality(place.rating, place.userRatingCount)
  const priceFit = computePriceFit(place.priceLevel, profile.budget)

  // Persona-aware weights
  const w1 = 0.35                                              // affinity (stable)
  const w2 = focusAdj.qualityWeight                             // quality (varies with d3)
  const w3 = 0.20                                              // price fit (stable)
  const w4 = 0.10                                              // duplication penalty (stable)

  let score = w1 * affinity + w2 * quality + w3 * priceFit - w4 * computeDuplication(place)

  // d3-based tourist trap penalty
  if (focusAdj.touristTrapPenalty > 0 && place.userRatingCount > 5000) {
    score -= focusAdj.touristTrapPenalty
  }

  // d4-based crowd preference
  if (socialRules.preferQuietPlaces && place.enrichment?.crowdProfile === "packed") {
    score -= 0.10
  }
  if (socialRules.crowdPreference === "packed" && place.enrichment?.crowdProfile === "quiet") {
    score -= 0.05
  }

  // Enrichment confidence as tiebreaker (always beneficial)
  if (place.enrichment?.confidence) {
    score += place.enrichment.confidence * 0.02
  }

  return { ...place, score, reasons: buildMatchReasons(place, profile, persona) }
}
```

---

## 7. Trip Form Changes

The existing trip creation form needs these additions/changes:

### New: Persona Quiz Integration

```ts
interface TripInputs {
  // Existing fields
  city: string
  totalDays: number
  startDate: string
  dietary: string[]
  budget?: 1 | 2 | 3 | 4

  // Existing: manual interest chips (now optional)
  interestOverrides?: string[]

  // NEW: persona result (from quiz, optional)
  persona?: TravelPersonaResult
}
```

### UX Flow

```
Option A: User takes the quiz FIRST
  Quiz → Result page with "Plan a trip with this profile" CTA
  → Trip form (city + dates + dietary) with persona pre-attached
  → Interests section shows "Based on your persona: [derived interests]"
  → User can tweak/override interests
  → Submit → Pipeline

Option B: User creates a trip FIRST, takes quiz during setup
  Trip form → "Discover your travel style" optional step
  → Quiz (inline or modal) → Results auto-fill interest weights
  → Continue to submit

Option C: User skips the quiz entirely
  Trip form works as today: manual interest chips + optional budget
  → Pipeline uses manual interests with default weights
  → No persona = no personality-aware adjustments
```

### Interest Override UI

When a persona is attached, the interests section should show:

```
┌────────────────────────────────────────────────┐
│  Your travel style: The Cultural Diver 🎭      │
│                                                │
│  We've pre-selected interests that match you:  │
│                                                │
│  [✓] Museums    [✓] Temples    [✓] Markets     │
│  [✓] Cooking    [✓] History    [ ] Nightlife   │
│  [ ] Adventure  [ ] Shopping   [ ] Spas        │
│                                                │
│  Customize these or add your own:              │
│  [+ Add interest]                              │
└────────────────────────────────────────────────┘
```

The pre-selected interests come from `ARCHETYPE_INTERESTS[archetype].baseInterests`, but the user can toggle any of them off or add new ones.

---

## 8. Database Changes

The `itineraries` table already stores `profile jsonb`. We extend it:

```sql
ALTER TABLE itineraries ADD COLUMN persona jsonb;
-- Stores the full TravelPersonaResult when a quiz was used.
-- NULL when the trip was created without the quiz.
```

The `profile` column continues to store the `PreferenceProfile` (the pipeline's input). The `persona` column stores the raw quiz result for analytics and re-generation.

Why both? Because the `PreferenceProfile` is a *derivative* — it loses the original dimension scores. If we later change the mapping logic, we need the raw persona to re-derive the profile without re-asking the user 12 questions.

---

## 9. End-to-End Data Flow

For a user who takes the quiz and creates a trip to Kyoto for 4 days:

```
1. User takes quiz
   → Answers 12 questions
   → Scored: d1=52, d2=58, d3=88, d4=50
   → Archetype: "cultural_diver" (closest center)
   → Secondary: "slow_immersionist"

2. User clicks "Plan a Trip" from results page
   → Trip form opens with persona attached
   → Interests pre-filled: [museums, temples, local_markets, cooking_classes, historical_sites]
   → Budget pre-suggested: 2 (moderate, from d2=58)
   → Pace pre-set: balanced (from d1=52)

3. User fills in:
   → City: Kyoto
   → Dates: 4 days starting Oct 15
   → Dietary: vegetarian
   → Accepts pre-filled interests, removes "cooking_classes", adds "gardens"
   → Skips budget (will use quiz-derived fallback)

4. Profile Builder runs:
   → interests: [museums, temples, local_markets, historical_sites, gardens]
   → dietary: ["vegetarian"]
   → pace: "balanced"
   → budget: 2 (from d2=58 fallback)
   → typeAffinities: { museums: 1.4, temples: 1.3, local_markets: 1.2, gardens: 1.0 }

5. Pipeline runs with persona-augmented scoring:
   → d3=88 → quality weight boosted to 0.45, tourist trap penalty active
   → d4=50 → no social scheduling overrides (neutral)
   → d1=52 → balanced pace, normal buffer
   → d2=58 → budget tier 2, moderate comfort tolerance

6. Result:
   → Retrieval: ~300 candidates across Kyoto, heavy on temples/museums/markets
   → Scoring: vegetarian + cultural depth = tofu kaiseki outranks ramen chains
   → Pass B prompt: "This is a Cultural Diver. Allow longer stays at cultural sites."
   → Pass C narration: "Emphasize cultural significance, what to learn here…"
   → Itinerary: Temple-heavy, long lunch at a vegetarian kaiseki,
     2-hour museum stay (not the default 90min), garden walk, market visit
```

---

## 10. What the Quiz Does NOT Determine

These things remain the user's explicit choice or the pipeline's own logic:

| Decision | Source | Why the quiz doesn't touch it |
|----------|--------|-------------------------------|
| Destination city | User choice | Personality doesn't pick your city |
| Travel dates | User choice | Calendar, not temperament |
| Dietary requirements | User input (hard constraint) | Medical/ethical, not personality |
| Budget (when explicitly set) | User input | Quiz is fallback only |
| Specific restaurant reservations | Pipeline logic | Operational, not personality |
| Travel time between stops | Google Distance Matrix | Physics, not feelings |
| Opening hours validation | Google Places data | Facts, not preferences |
| Photo resolution | Pipeline Step 12 | Cost optimization, not taste |

The quiz shapes **what gets recommended and how it's arranged**, never **where the user goes or when**.
