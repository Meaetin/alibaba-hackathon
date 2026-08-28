# Travel Persona Archetypes — Complete Reference

This document is the single source of truth for the 12 travel archetypes used by the Travel Persona Quiz and the personalization pipeline. It combines the user-facing result-page copy, the 4-axis dimensional center points, the derived planning profile, and the pipeline-specific scoring and prompt instructions.

---

## 1. The Dimensional Model

Each archetype is defined by a center point in 4D space. Users are scored 0–100 on each axis, then matched to the nearest archetype by Euclidean distance.

| Axis | Code | 0 = This End | 100 = This End |
|------|------|--------------|----------------|
| **Structure** | `d1` | Master Planner | Spontaneous Wanderer |
| **Comfort** | `d2` | Luxury-first | Roughing It |
| **Focus** | `d3` | Sightseeing Highlights | Deep Immersion |
| **Social** | `d4` | Group-oriented | Solo-oriented |

---

## 2. Archetype Summary

| # | Archetype | Icon | d1 | d2 | d3 | d4 | Pace | Budget |
|---|-----------|------|:--:|:--:|:--:|:--:|------|:------:|
| 1 | [The Master Planner](#1-the-master-planner) | 📋 | 5 | 25 | 35 | 45 | packed | 3 |
| 2 | [The Spontaneous Wanderer](#2-the-spontaneous-wanderer) | 🌬️ | 90 | 65 | 60 | 50 | relaxed | 2 |
| 3 | [The Cultural Diver](#3-the-cultural-diver) | 🎭 | 50 | 60 | 95 | 50 | balanced | 2 |
| 4 | [The Thrill Seeker](#4-the-thrill-seeker) | ⚡ | 40 | 85 | 50 | 40 | balanced | 1 |
| 5 | [The Comfort Cruiser](#5-the-comfort-cruiser) | 🛋️ | 25 | 5 | 25 | 50 | relaxed | 4 |
| 6 | [The Culinary Nomad](#6-the-culinary-nomad) | 🍜 | 45 | 55 | 75 | 40 | balanced | 2 |
| 7 | [The Soulful Soloist](#7-the-soulful-soloist) | 🧘 | 60 | 45 | 70 | 95 | balanced | 2 |
| 8 | [The Social Explorer](#8-the-social-explorer) | 🎉 | 55 | 45 | 60 | 5 | balanced | 2 |
| 9 | [The Nature Pilgrim](#9-the-nature-pilgrim) | 🏔️ | 55 | 80 | 55 | 65 | balanced | 1 |
| 10 | [The Bucket List Chaser](#10-the-bucket-list-chaser) | 🏆 | 25 | 35 | 30 | 40 | packed | 3 |
| 11 | [The Slow Immersionist](#11-the-slow-immersionist) | 🕰️ | 70 | 40 | 85 | 65 | relaxed | 2 |
| 12 | [The Weekend Warrior](#12-the-weekend-warrior) | 🚀 | 15 | 35 | 40 | 30 | packed | 3 |

---

## 3. Full Archetype Profiles

### 1. The Master Planner

**Tagline:** "A well-organized trip is a beautiful trip."

**Description:**  
You travel like you live — with intention, preparation, and a spreadsheet that would impress a project manager. Every detail is considered, from the optimal time to visit each landmark to the best seat at the best restaurant. You're not rigid — you're optimized. Your trips run so smoothly that travel companions feel like they're on a luxury guided tour, even when it's all you.

**Trait Cards:**

| Travel Style | Vibe | Superpower | Blind Spot |
|--------------|------|------------|------------|
| Highly Organized | Prepared & Polished | Logistics wizard | Over-scheduling |

**Destinations:** Japan, Switzerland, Singapore, Germany

**Derived Profile:**

```json
{
  "interests": ["landmarks", "museums", "architecture", "shopping"],
  "dietary": ["vegetarian"],
  "pace": "packed",
  "budget": 3,
  "typeAffinities": {
    "landmarks": 1.4,
    "museums": 1.3,
    "architecture": 1.1,
    "shopping": 0.9
  }
}
```

**Scoring Adjustments:**

```
qualityWeight:      0.30
popularityWeight:   0.25
touristTrapPenalty: 0.00
visitDurationBias:  "min"
```

**Pass B Prompt Inject:**

```
You are planning a trip for a master planner.

TRAVELER PROFILE:
Prefers dense, well-sequenced days with minimal dead time.

Do NOT include wildcard/surprise picks. This traveler wants the
best-known, best-reviewed options.
```

**Pass C Narration Note:**  
Emphasize efficiency, sequence, and what makes this a smart choice in the day's plan.

**Typical Trip Shape:** 8–9 stops per day, tight transitions, minimal gaps. No wildcards.

---

### 2. The Spontaneous Wanderer

**Tagline:** "The best plan is no plan at all."

**Description:**  
You follow the wind. Guidebooks are suggestions, itineraries are fiction, and the best moments are the ones you never saw coming. You thrive on serendipity — a missed train becomes a new friendship, a wrong turn leads to a hidden beach. You travel light, think fast, and collect stories instead of souvenirs.

**Trait Cards:**

| Travel Style | Vibe | Superpower | Blind Spot |
|--------------|------|------------|------------|
| Free-spirited | Adaptable & Bold | Serendipity magnet | Missing reservations |

**Destinations:** India, Thailand, Morocco, Colombia

**Derived Profile:**

```json
{
  "interests": ["cafes", "street_art", "local_markets", "walking_tours"],
  "dietary": ["vegetarian"],
  "pace": "relaxed",
  "budget": 2,
  "typeAffinities": {
    "cafes": 1.3,
    "street_art": 1.2,
    "local_markets": 1.3,
    "walking_tours": 1.1
  }
}
```

**Scoring Adjustments:**

```
qualityWeight:      0.30
popularityWeight:   0.10
touristTrapPenalty: 0.00
visitDurationBias:  "preferred"
```

**Pass B Prompt Inject:**

```
You are planning a trip for a spontaneous wanderer.

TRAVELER PROFILE:
Leave gaps. Fewer anchors, more flex candidates.

Include one 'wildcard' slot per day — a lesser-known gem with
fewer reviews but high quality.
```

**Pass C Narration Note:**  
Emphasize the vibe, the unexpected charm, and why this place rewards curiosity.

**Typical Trip Shape:** 4–5 anchors per day, 2–3 flex/gap slots. Wildcards encouraged.

---

### 3. The Cultural Diver

**Tagline:** "I don't visit places — I try to understand them."

**Description:**  
You travel to learn. Museums, temples, language exchanges, home-cooked meals with strangers — these aren't activities for you, they're the whole point. You read history books before flights, attempt the local language (badly, bravely), and come home with a deeper understanding of something bigger than yourself.

**Trait Cards:**

| Travel Style | Vibe | Superpower | Blind Spot |
|--------------|------|------------|------------|
| Deeply Curious | Empathetic & Intellectual | Cultural fluency | Overlooking rest |

**Destinations:** Italy, Mexico, Turkey, Vietnam

**Derived Profile:**

```json
{
  "interests": ["museums", "temples", "local_markets", "cooking_classes", "historical_sites"],
  "dietary": ["vegetarian"],
  "pace": "balanced",
  "budget": 2,
  "typeAffinities": {
    "museums": 1.4,
    "temples": 1.3,
    "local_markets": 1.2,
    "cooking_classes": 1.5,
    "historical_sites": 1.3
  }
}
```

**Scoring Adjustments:**

```
qualityWeight:      0.45
popularityWeight:   0.10
touristTrapPenalty: 0.15
visitDurationBias:  "max"
```

**Pass B Prompt Inject:**

```
You are planning a trip for a cultural diver.

TRAVELER PROFILE:
Allow longer stays at cultural sites. Rushing past a temple is a failure.

Include one 'wildcard' slot per day — a lesser-known gem with
fewer reviews but high quality.
```

**Pass C Narration Note:**  
Emphasize cultural significance, what to learn here, and the depth this place offers.

**Typical Trip Shape:** 5–6 stops per day, but LONG stays at cultural sites. Hidden temples and neighborhood shrines score higher.

---

### 4. The Thrill Seeker

**Tagline:** "If it doesn't scare me a little, it's not worth doing."

**Description:**  
You travel for adrenaline. Summiting volcanoes at dawn, cliff-diving in Croatia, motorbiking the Ha Giang Loop — your trips are measured in heartbeats, not hotel stars. You're not reckless; you're alive in a way that only comes from pushing past the edge of your comfort zone. Your camera roll looks like a Red Bull ad.

**Trait Cards:**

| Travel Style | Vibe | Superpower | Blind Spot |
|--------------|------|------------|------------|
| Adrenaline-driven | Fearless & Physical | Courage under pressure | Burnout & injury |

**Destinations:** New Zealand, Nepal, Iceland, Costa Rica

**Derived Profile:**

```json
{
  "interests": ["outdoors", "adventure_sports", "viewpoints", "water_activities"],
  "dietary": ["vegetarian"],
  "pace": "balanced",
  "budget": 1,
  "typeAffinities": {
    "outdoors": 1.4,
    "adventure_sports": 1.5,
    "viewpoints": 1.2,
    "water_activities": 1.3
  }
}
```

**Scoring Adjustments:**

```
qualityWeight:      0.30
popularityWeight:   0.25
touristTrapPenalty: 0.00
visitDurationBias:  "preferred"
```

**Pass B Prompt Inject:**

```
You are planning a trip for a thrill seeker.

TRAVELER PROFILE:
Anchor days around one big activity. Fill gaps with recovery
(cafes, viewpoints).

Include one 'wildcard' slot per day — a lesser-known gem with
fewer reviews but high quality.
```

**Pass C Narration Note:**  
Emphasize the adrenaline, the physical experience, and what makes this an epic moment.

**Typical Trip Shape:** 1 big anchor (2–3 hrs) + 3–4 lighter activities per day. Recovery time between adrenaline slots.

---

### 5. The Comfort Cruiser

**Tagline:** "Travel should feel better than home, not harder."

**Description:**  
You've earned your relaxation, and you travel to enjoy it. Five-star hotels, ocean-view suites, spa days, and slow mornings with room service — this is your idea of paradise. You're not lazy; you're intentional about rest. Your trips are designed to recharge you, and you return home genuinely renewed.

**Trait Cards:**

| Travel Style | Vibe | Superpower | Blind Spot |
|--------------|------|------------|------------|
| Leisure-first | Refined & Relaxed | Finding the best of everything | Missing local texture |

**Destinations:** Maldives, Santorini, Bali, Amalfi Coast

**Derived Profile:**

```json
{
  "interests": ["spas", "fine_dining", "shopping", "scenic_drives", "resorts"],
  "dietary": ["vegetarian"],
  "pace": "relaxed",
  "budget": 4,
  "typeAffinities": {
    "spas": 1.4,
    "fine_dining": 1.3,
    "shopping": 1.2,
    "scenic_drives": 1.1,
    "resorts": 1.3
  }
}
```

**Scoring Adjustments:**

```
qualityWeight:      0.30
popularityWeight:   0.25
touristTrapPenalty: 0.00
visitDurationBias:  "min"   // overridden by pace: relaxed stretches durations
```

**Pass B Prompt Inject:**

```
You are planning a trip for a comfort cruiser.

TRAVELER PROFILE:
Slow days. Long meals. Never pack more than 2 activities.

Do NOT include wildcard/surprise picks. This traveler wants the
best-known, best-reviewed options.
```

**Pass C Narration Note:**  
Emphasize atmosphere, quality, and what makes this a luxurious or restful experience.

**Typical Trip Shape:** 2 activities max per day. Long meals and spa time. Budget tier 4.

---

### 6. The Culinary Nomad

**Tagline:** "Tell me what a city eats, and I'll tell you what it is."

**Description:**  
For you, the meal IS the trip. You plan entire days around food — morning markets, cooking classes, lunch at the place with no English menu, dinner at the grandmother's kitchen you found through a local. You understand cultures through their kitchens, and your souvenir is always a new recipe.

**Trait Cards:**

| Travel Style | Vibe | Superpower | Blind Spot |
|--------------|------|------------|------------|
| Food-driven | Sensory & Social | Finding hidden gems | Ignoring non-food experiences |

**Destinations:** Japan, Thailand, Peru, France

**Derived Profile:**

```json
{
  "interests": ["restaurants", "street_food", "local_markets", "cooking_classes", "food_tours", "cafes"],
  "dietary": ["vegetarian"],
  "pace": "balanced",
  "budget": 2,
  "typeAffinities": {
    "restaurants": 1.5,
    "street_food": 1.4,
    "local_markets": 1.3,
    "cooking_classes": 1.4,
    "food_tours": 1.4,
    "cafes": 1.2
  }
}
```

**Scoring Adjustments:**

```
qualityWeight:      0.45
popularityWeight:   0.10
touristTrapPenalty: 0.15
visitDurationBias:  "max"
```

**Pass B Prompt Inject:**

```
You are planning a trip for a culinary nomad.

TRAVELER PROFILE:
Every meal slot is a primary activity, not filler. Allow 90+ minutes
for meals.

Include one 'wildcard' slot per day — a lesser-known gem with
fewer reviews but high quality.
```

**Pass C Narration Note:**  
Emphasize the food story — what's unique, what to order, and why this place matters culinarily.

**Typical Trip Shape:** 3 meals as primary activities + 2–3 food-adjacent stops. Wildcards are hidden kitchens and unreviewed stalls.

---

### 7. The Soulful Soloist

**Tagline:** "I travel to meet myself, somewhere new."

**Description:**  
Solo travel isn't just a preference for you — it's a practice. You journey outward to look inward. Long walks, journaling in cafés, meditation retreats, quiet sunrise viewpoints. You don't avoid people; you seek depth over small talk. Your best travel memories are quiet moments of clarity that changed something in you.

**Trait Cards:**

| Travel Style | Vibe | Superpower | Blind Spot |
|--------------|------|------------|------------|
| Reflective & Independent | Introspective & Calm | Self-awareness | Isolating too much |

**Destinations:** Bali, Portugal, Sri Lanka, Patagonia

**Derived Profile:**

```json
{
  "interests": ["temples", "nature_walks", "meditation_retreats", "bookshops", "cafes", "viewpoints"],
  "dietary": ["vegetarian"],
  "pace": "balanced",
  "budget": 2,
  "typeAffinities": {
    "temples": 1.3,
    "nature_walks": 1.3,
    "meditation_retreats": 1.4,
    "bookshops": 1.1,
    "cafes": 1.2,
    "viewpoints": 1.2
  }
}
```

**Scoring Adjustments:**

```
qualityWeight:      0.45
popularityWeight:   0.10
touristTrapPenalty: 0.00
visitDurationBias:  "preferred"

// Social rules (d4=92):
preferQuietPlaces: true
allowSolitudeSlots: true
crowdPreference: "quiet"
eveningActivityRequired: false
```

**Pass B Prompt Inject:**

```
You are planning a trip for a soulful soloist.

TRAVELER PROFILE:
Built-in solitude. No back-to-back social activities. Long cafe
stays welcome.

This traveler values solitude. A 'wander time' slot with no assigned
place is valid.

Include one 'wildcard' slot per day — a lesser-known gem with
fewer reviews but high quality.
```

**Pass C Narration Note:**  
Emphasize the reflective quality, the quiet moments, and how this place invites presence.

**Typical Trip Shape:** 3–4 anchors max. Long unstructured gaps. No evening pressure. Quiet places preferred.

---

### 8. The Social Explorer

**Tagline:** "Every stranger is a friend I haven't met yet."

**Description:**  
You travel for people. The places are backdrop; the connections are the trip. You're the one who ends up at a family dinner in someone's home, dancing at a local wedding you weren't invited to, or hosting a rooftop dinner for hostel friends. You collect people, not stamps.

**Trait Cards:**

| Travel Style | Vibe | Superpower | Blind Spot |
|--------------|------|------------|------------|
| People-first | Warm & Magnetic | Building instant bonds | Neglecting solo reflection |

**Destinations:** Spain, Brazil, Ireland, Philippines

**Derived Profile:**

```json
{
  "interests": ["nightlife", "local_markets", "food_tours", "group_activities", "festivals", "bars"],
  "dietary": ["vegetarian"],
  "pace": "balanced",
  "budget": 2,
  "typeAffinities": {
    "nightlife": 1.3,
    "local_markets": 1.2,
    "food_tours": 1.3,
    "group_activities": 1.4,
    "festivals": 1.5,
    "bars": 1.2
  }
}
```

**Scoring Adjustments:**

```
qualityWeight:      0.30
popularityWeight:   0.10
touristTrapPenalty: 0.00
visitDurationBias:  "preferred"

// Social rules (d4=8):
preferQuietPlaces: false
allowSolitudeSlots: false
crowdPreference: "packed"
eveningActivityRequired: true
minSocialVenuesPerDay: 2
```

**Pass B Prompt Inject:**

```
You are planning a trip for a social explorer.

TRAVELER PROFILE:
Evening slots are load-bearing, not optional. Prioritize social
venues after 6pm.

IMPORTANT: Every day MUST include an evening activity — this
traveler thrives on social evenings.

Include one 'wildcard' slot per day — a lesser-known gem with
fewer reviews but high quality.
```

**Pass C Narration Note:**  
Emphasize the people, the energy, and the social opportunities this place offers.

**Typical Trip Shape:** 6–7 stops per day. Evening is mandatory and extended. Live music, festivals, pop-up events.

---

### 9. The Nature Pilgrim

**Tagline:** "The mountains don't care about my inbox, and that's why I love them."

**Description:**  
Cities are fine, but you come alive in the wild. Hiking boots, tent poles, and trail maps are your travel essentials. You measure a trip in elevation gained, waterfalls found, and stars seen. Silence, fresh air, and the scale of nature put everything else in perspective. You don't conquer mountains — they recalibrate you.

**Trait Cards:**

| Travel Style | Vibe | Superpower | Blind Spot |
|--------------|------|------------|------------|
| Outdoors & Active | Grounded & Resilient | Endurance & presence | Skipping urban culture |

**Destinations:** Patagonia, Norway, Banff, Nepal

**Derived Profile:**

```json
{
  "interests": ["outdoors", "hiking", "national_parks", "viewpoints", "botanical_gardens", "wildlife"],
  "dietary": ["vegetarian"],
  "pace": "balanced",
  "budget": 1,
  "typeAffinities": {
    "outdoors": 1.5,
    "hiking": 1.5,
    "national_parks": 1.4,
    "viewpoints": 1.3,
    "botanical_gardens": 1.2,
    "wildlife": 1.3
  }
}
```

**Scoring Adjustments:**

```
qualityWeight:      0.30
popularityWeight:   0.10
touristTrapPenalty: 0.00
visitDurationBias:  "preferred"

// Social rules (d4=63):
preferQuietPlaces: false
allowSolitudeSlots: true
crowdPreference: "moderate"
```

**Pass B Prompt Inject:**

```
You are planning a trip for a nature pilgrim.

TRAVELER PROFILE:
Nature activities are anchors. A single 3-hour hike can own a
morning. Everything else is filler.

Include one 'wildcard' slot per day — a lesser-known gem with
fewer reviews but high quality.
```

**Pass C Narration Note:**  
Emphasize the natural beauty, the scale, and what makes this place awe-inspiring.

**Typical Trip Shape:** 1 nature anchor (2–3 hrs) + 1–2 lighter nature stops + filler. Hidden trails and local gorges score higher.

---

### 10. The Bucket List Chaser

**Tagline:** "Life is short. I'm checking things off."

**Description:**  
You've got a list, and you're working through it. Northern Lights? Done. Machu Picchu? Check. Swimming with whale sharks? Next month. You're driven by iconic experiences and once-in-a-lifetime moments. Your trips are ambitious, visually stunning, and make for incredible stories. You inspire everyone around you to dream bigger.

**Trait Cards:**

| Travel Style | Vibe | Superpower | Blind Spot |
|--------------|------|------------|------------|
| Goal-driven | Ambitious & Energetic | Making things happen | Rushing past the present |

**Destinations:** Iceland, Tanzania, Egypt, Galápagos

**Derived Profile:**

```json
{
  "interests": ["landmarks", "viewpoints", "museums", "iconic_restaurants", "shows"],
  "dietary": ["vegetarian"],
  "pace": "packed",
  "budget": 3,
  "typeAffinities": {
    "landmarks": 1.5,
    "viewpoints": 1.3,
    "museums": 1.2,
    "iconic_restaurants": 1.3,
    "shows": 1.2
  }
}
```

**Scoring Adjustments:**

```
qualityWeight:      0.30
popularityWeight:   0.25
touristTrapPenalty: 0.00
visitDurationBias:  "min"
```

**Pass B Prompt Inject:**

```
You are planning a trip for a bucket list chaser.

TRAVELER PROFILE:
Prioritize the iconic, famous, must-see places. This traveler
wants the postcard moments.

Do NOT include wildcard/surprise picks. This traveler wants the
best-known, best-reviewed options.
```

**Pass C Narration Note:**  
Emphasize why this is iconic, what makes it a must-see, and the story they'll tell afterward.

**Typical Trip Shape:** 8–9 stops per day. Short stays at each. Check the boxes. No wildcards.

---

### 11. The Slow Immersionist

**Tagline:** "I don't visit. I stay."

**Description:**  
You don't do drive-by tourism. When you travel, you embed. You rent an apartment, find a regular café, learn the neighborhood rhythms. Two weeks in one village beats seven cities in seven days, every time. You believe travel should change how you live, not just fill your photo album.

**Trait Cards:**

| Travel Style | Vibe | Superpower | Blind Spot |
|--------------|------|------------|------------|
| Slow & Deep | Patient & Observant | Becoming local anywhere | Missing variety |

**Destinations:** Tuscany, Kyoto, Oaxaca, Lisbon

**Derived Profile:**

```json
{
  "interests": ["local_markets", "cafes", "neighborhoods", "cooking_classes", "temples", "artisan_shops"],
  "dietary": ["vegetarian"],
  "pace": "relaxed",
  "budget": 2,
  "typeAffinities": {
    "local_markets": 1.3,
    "cafes": 1.3,
    "neighborhoods": 1.4,
    "cooking_classes": 1.3,
    "temples": 1.2,
    "artisan_shops": 1.2
  }
}
```

**Scoring Adjustments:**

```
qualityWeight:      0.45
popularityWeight:   0.10
touristTrapPenalty: 0.15
visitDurationBias:  "max"

// Social rules (d4=63):
allowSolitudeSlots: true
crowdPreference: "moderate"
```

**Pass B Prompt Inject:**

```
You are planning a trip for a slow immersionist.

TRAVELER PROFILE:
One neighborhood per day, explored deeply. Revisit places over
checking off new ones.

Include one 'wildcard' slot per day — a lesser-known gem with
fewer reviews but high quality.
```

**Pass C Narration Note:**  
Emphasize the local texture, the daily rhythms, and what makes this place feel lived-in.

**Typical Trip Shape:** 4–5 stops per day, all in one neighborhood. Very long stays. Local artisan shops and unmarked cafes score higher.

---

### 12. The Weekend Warrior

**Tagline:** "48 hours is enough if you use them right."

**Description:**  
You don't wait for the perfect two-week window. You grab a Friday night flight and squeeze every ounce of adventure out of 48 hours. Packed itineraries, efficient logistics, maximum experience per hour — you're a master of the micro-trip. Your coworkers don't understand how you saw so much in so little time.

**Trait Cards:**

| Travel Style | Vibe | Superpower | Blind Spot |
|--------------|------|------------|------------|
| Efficient & Intense | High-energy & Focused | Time maximization | Never fully unwinding |

**Destinations:** Barcelona, Bangkok, New York, Mexico City

**Derived Profile:**

```json
{
  "interests": ["landmarks", "restaurants", "shopping", "viewpoints"],
  "dietary": ["vegetarian"],
  "pace": "packed",
  "budget": 3,
  "typeAffinities": {
    "landmarks": 1.4,
    "restaurants": 1.2,
    "shopping": 1.1,
    "viewpoints": 1.2
  }
}
```

**Scoring Adjustments:**

```
qualityWeight:      0.30
popularityWeight:   0.25
touristTrapPenalty: 0.00
visitDurationBias:  "min"
```

**Pass B Prompt Inject:**

```
You are planning a trip for a weekend warrior.

TRAVELER PROFILE:
Maximize slots. Use 'packed' pace regardless of stated preference.
Every minute counts.

Do NOT include wildcard/surprise picks. This traveler wants the
best-known, best-reviewed options.
```

**Pass C Narration Note:**  
Emphasize the payoff-per-minute — why this place is worth the time investment.

**Typical Trip Shape:** 12–14 stops per day. Short stays. Zero wasted time. No wildcards.

---

## 4. How Matching Works

1. The quiz collects 12 answers. Each answer contributes a vector of scores across `d1`, `d2`, `d3`, and `d4`.
2. Raw totals are averaged to produce a user coordinate in 0–100 on each axis.
3. The system calculates Euclidean distance from the user's coordinate to each archetype's center point.
4. The archetype with the smallest distance is the primary match.
5. The secondary archetype is the next-closest match; confidence is derived from the gap between first and second place.

For example, a user who scores `{ d1: 68, d2: 40, d3: 83, d4: 63 }` lands almost exactly on the Slow Immersionist center `{ 70, 40, 85, 65 }`, making that the clear primary match.

---

## 5. Related Documents

- `travel-persona-quiz-methodology.md` — question-by-question scoring rationale and academic sources
- `archetype-output-reference.md` — full sample outputs, derived profiles, and 3-day Tokyo itineraries per archetype
- `quiz-pipeline-bridge.md` — how quiz results map to `PreferenceProfile` and pipeline parameters
- `archetype-data-payloads.md` — TypeScript shapes and API payloads
- `personalization-pipeline.md` — the 13-step planning pipeline that consumes these archetypes
