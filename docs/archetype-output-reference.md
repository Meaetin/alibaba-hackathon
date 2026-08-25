# Archetype Output Reference

The complete data output for each of the 12 travel archetypes. Shows the raw quiz result, the derived pipeline profile, scoring adjustments, LLM prompt injections, and a sample itinerary shape for a 3-day trip to Tokyo (vegetarian, balanced pace).

---

## How to Read This Document

Each archetype section contains:

| Block | What it shows |
|-------|--------------|
| **Quiz Result** | The raw `TravelPersonaResult` — dimension scores + archetype match |
| **Derived Profile** | The `PreferenceProfile` the bridge builds from the quiz output |
| **Scoring Adjustments** | How d3 (focus) and d4 (social) modify the scoring formula |
| **Pass B Prompt Inject** | The personality-aware text added to the LLM assignment prompt |
| **Pass C Narration Note** | The tone directive for "why this place for you" copy |
| **Sample Itinerary** | A 3-day Tokyo shape showing how the archetype's preferences manifest |

---

## 1. The Master Planner

### Quiz Result
```json
{
  "dimensions": {
    "structure": 12,
    "comfort": 22,
    "focus": 33,
    "social": 42
  },
  "archetype": "master_planner",
  "secondaryArchetype": "weekend_warrior",
  "confidence": 0.94
}
```

### Derived Profile
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

### Scoring Adjustments
```
qualityWeight:     0.30  (d3=33, highlights-leaning → standard quality)
popularityWeight:  0.25  (d3 < 40 → famous places get a boost)
touristTrapPenalty: 0.00 (d3 < 70 → no penalty)
visitDurationBias: "min" (d3 < 30 → shorter stays, more stops)
```

### Pass B Prompt Inject
```
You are planning a trip for a master planner.

TRAVELER PROFILE:
Prefers dense, well-sequenced days with minimal dead time.

Do NOT include wildcard/surprise picks. This traveler wants the
best-known, best-reviewed options.
```

### Pass C Narration Note
```
Emphasize efficiency, sequence, and what makes this a smart choice
in the day's plan.
```

### Sample 3-Day Tokyo Shape
```
Day 1 — Asakusa / Ueno
  09:00  Senso-ji Temple (60 min)
  10:15  Nakamise Shopping Street (45 min)
  11:30  Lunch: Bon Vegetarian Restaurant (75 min)
  13:00  Tokyo National Museum (90 min)
  15:00  Ueno Park walk (45 min)
  16:00  Ameyoko Market (45 min)
  18:00  Dinner: T's Tantan Ramen (60 min)
  19:30  Tokyo Skytree observation (60 min)

Day 2 — Shibuya / Harajuku
  09:00  Meiji Shrine (60 min)
  10:15  Takeshita Street (45 min)
  11:30  Lunch: Afuri Vegan Ramen (60 min)
  13:00  Shibuya Crossing + Hachiko (30 min)
  13:45  Shibuya Sky observation (60 min)
  15:00  Omotesando architecture walk (60 min)
  16:30  Nezu Museum (75 min)
  18:30  Dinner: Curry House CoCo Ichibanya (60 min)
  20:00  Shibuya nightlife walk (45 min)

Day 3 — Shinjuku / Ikebukuro
  09:00  Shinjuku Gyoen Garden (75 min)
  10:30  Tokyo Metropolitan Government Building (45 min)
  12:00  Lunch: Tsunahachi Tofu (75 min)
  13:30  Kabukicho walk (30 min)
  14:15  Samurai Museum (60 min)
  15:30  Sunshine City shopping (60 min)
  17:00  Ikebukuro viewpoint (30 min)
  18:00  Dinner: Vegetarian Beast (75 min)

Pace: 8–9 stops per day, tight transitions, minimal gaps.
Serendipity: None. Every stop is high-review, well-known.
```

---

## 2. The Spontaneous Wanderer

### Quiz Result
```json
{
  "dimensions": {
    "structure": 88,
    "comfort": 62,
    "focus": 58,
    "social": 48
  },
  "archetype": "spontaneous_wanderer",
  "secondaryArchetype": "soulful_soloist",
  "confidence": 0.87
}
```

### Derived Profile
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

### Scoring Adjustments
```
qualityWeight:     0.30  (d3=58, neutral → standard)
popularityWeight:  0.10  (d3 > 40 → less weight on fame)
touristTrapPenalty: 0.00 (d3 < 70 → no penalty)
visitDurationBias: "preferred" (d3 middle → default durations)
```

### Pass B Prompt Inject
```
You are planning a trip for a spontaneous wanderer.

TRAVELER PROFILE:
Leave gaps. Fewer anchors, more flex candidates.

Include one 'wildcard' slot per day — a lesser-known gem with
fewer reviews but high quality.
```

### Pass C Narration Note
```
Emphasize the vibe, the unexpected charm, and why this place
rewards curiosity.
```

### Sample 3-Day Tokyo Shape
```
Day 1 — Shimokitazawa / Daikanyama
  09:30  Wander Shimokitazawa vintage shops (flex, 90 min)
  11:30  Lunch: Falafel Brothers (60 min)
  13:00  Shimokitazawa street art walk (flex, 60 min)
  14:30  Coffee at Bear Pond Espresso (45 min)
  15:30  [free time — flex slot: local gallery or park]
  18:00  Dinner: Rojiura Curry (75 min)

Day 2 — Yanaka / Nippori
  10:00  Yanaka Cemetery walk (60 min)
  11:00  Coffee at Kayaba Coffee (45 min)
  12:00  Lunch: Yanaka Sobadokoro (60 min)
  13:30  Nippori Fabric Town wander (flex, 75 min)
  15:00  [free time — flex slot: neighborhood temple or garden]
  18:30  Dinner: Shojin Ryori at Daigo (90 min)

Day 3 — Koenji / Nakano
  10:00  Koenji thrift street (flex, 90 min)
  12:00  Lunch: Vegetarian cafe in Koenji (60 min)
  13:30  Nakano Broadway wander (60 min)
  15:00  [free time — flex slot: local izakaya or park]
  18:00  Dinner: 8ablish (75 min)

Pace: 4–5 anchors per day, 2–3 flex/gap slots.
Serendipity: Yes — each day has a wildcard from <500 reviews.
```

---

## 3. The Cultural Diver

### Quiz Result
```json
{
  "dimensions": {
    "structure": 52,
    "comfort": 58,
    "focus": 91,
    "social": 50
  },
  "archetype": "cultural_diver",
  "secondaryArchetype": "slow_immersionist",
  "confidence": 0.92
}
```

### Derived Profile
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

### Scoring Adjustments
```
qualityWeight:     0.45  (d3=91, high immersion → depth over popularity)
popularityWeight:  0.10  (d3 > 40 → less weight on fame)
touristTrapPenalty: 0.15 (d3 > 70 → penalize tourist traps)
visitDurationBias: "max" (d3 > 70 → longer stays at cultural sites)
```

### Pass B Prompt Inject
```
You are planning a trip for a cultural diver.

TRAVELER PROFILE:
Allow longer stays at cultural sites. Rushing past a temple is a failure.

Include one 'wildcard' slot per day — a lesser-known gem with
fewer reviews but high quality.
```

### Pass C Narration Note
```
Emphasize cultural significance, what to learn here, and the depth
this place offers.
```

### Sample 3-Day Tokyo Shape
```
Day 1 — Arashiyama-style Deep Dive (Asakusa)
  09:00  Senso-ji Temple — full exploration (120 min)
         ↳ "Not just the main hall — walk the side paths to find the
            bronze statues and quiet prayer corners most tourists skip."
  11:15  Asakusa Culture Tourist Center (45 min)
  12:30  Lunch: Bon Vegetarian — tofu kaiseki (90 min)
         ↳ "Tofu kaiseki is the house specialty — vegetarian isn't a
            compromise here, it's the tradition."
  14:15  Edo-Tokyo Museum (120 min)
  16:30  Kappabashi Street (artisan shops, 60 min)
  18:30  Dinner: Daikokuya Tempura (vegetarian options, 75 min)

Day 2 — Yanaka / Ueno Cultural Corridor
  09:00  Yanaka Cemetery + Tennoji Temple (90 min)
  10:45  Kayaba Coffee — historic kissaten (45 min)
  12:00  Lunch: Shojin Ryori at Towa (120 min)
  14:00  Tokyo National Museum (150 min)
  17:00  Ameyoko Market immersion (60 min)
  18:30  Dinner: T's Tantan (75 min)

Day 3 — Shimokitazawa + Cooking
  09:30  Vegetarian cooking class (150 min — anchor)
         ↳ "Learn to make shojin ryori at home. This isn't a demo —
            you're cooking a full meal."
  12:30  Lunch: your own cooking
  14:00  Local temple visit (90 min)
  16:00  Vintage kimono shop + neighborhood walk (75 min)
  18:30  Dinner: local izakaya with vegetarian menu (90 min)

Pace: 5–6 stops per day, but LONG stays at cultural sites.
Serendipity: Yes — hidden temples, neighborhood shrines, local workshops.
Tourist trap penalty: Senso-ji still included (too iconic) but its
  score is slightly reduced; lesser-known temples score higher.
```

---

## 4. The Thrill Seeker

### Quiz Result
```json
{
  "dimensions": {
    "structure": 38,
    "comfort": 83,
    "focus": 48,
    "social": 38
  },
  "archetype": "thrill_seeker",
  "secondaryArchetype": "nature_pilgrim",
  "confidence": 0.89
}
```

### Derived Profile
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

### Scoring Adjustments
```
qualityWeight:     0.30  (d3=48, neutral)
popularityWeight:  0.25  (d3 < 50 → slightly favors well-known)
touristTrapPenalty: 0.00 (d3 < 70)
visitDurationBias: "preferred" (d3 middle)
```

### Pass B Prompt Inject
```
You are planning a trip for a thrill seeker.

TRAVELER PROFILE:
Anchor days around one big activity. Fill gaps with recovery
(cafes, viewpoints).

Include one 'wildcard' slot per day — a lesser-known gem with
fewer reviews but high quality.
```

### Pass C Narration Note
```
Emphasize the adrenaline, the physical experience, and what makes
this an epic moment.
```

### Sample 3-Day Tokyo Shape
```
Day 1 — Mt. Takao (anchor day)
  07:30  Train to Mt. Takao (60 min transit)
  09:00  Mt. Takao Trail #1 hike (180 min — anchor)
         ↳ "1,200 steps to the summit. The view of Fuji on a clear
            day is the postcard."
  12:30  Lunch: summit rest area (45 min)
  14:00  Descent via Trail #6 (Inariyama, 90 min)
  16:00  Onsen near Takaosanguchi (60 min)
  18:00  Dinner: back in Shinjuku, Afuri Vegan Ramen (60 min)

Day 2 — Urban Adventure
  09:00  Rock climbing at T-Wall Ikebukuro (120 min — anchor)
  11:30  Lunch: vegetarian bento near gym (45 min)
  13:00  Kayaking Tokyo Bay (90 min)
  15:00  Odaiba waterfront recovery walk (45 min)
  16:30  TeamLab Borderless (90 min)
  18:30  Dinner: 8ablish (75 min)

Day 3 — Nature + Heights
  08:00  Showa Kinen Park cycling (120 min)
  10:30  Coffee at Fuglen (45 min)
  12:00  Lunch: Rojiura Curry (60 min)
  14:00  Tokyo Skytree (60 min)
  15:30  Bouldering at B-Pump Ogikubo (90 min)
  18:00  Dinner: Beast Vegetarian (75 min)

Pace: 1 big anchor (2–3 hrs) + 3–4 lighter activities per day.
Serendipity: Yes — lesser-known trails, local climbing gyms, hidden viewpoints.
```

---

## 5. The Comfort Cruiser

### Quiz Result
```json
{
  "dimensions": {
    "structure": 22,
    "comfort": 8,
    "focus": 24,
    "social": 48
  },
  "archetype": "comfort_cruiser",
  "secondaryArchetype": "master_planner",
  "confidence": 0.96
}
```

### Derived Profile
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

### Scoring Adjustments
```
qualityWeight:     0.30  (d3=24, highlights-leaning → standard)
popularityWeight:  0.25  (d3 < 40 → famous/reliable = good)
touristTrapPenalty: 0.00 (d3 < 70)
visitDurationBias: "min" (d3 < 30 → but overridden by pace: relaxed stretches durations)
```

### Pass B Prompt Inject
```
You are planning a trip for a comfort cruiser.

TRAVELER PROFILE:
Slow days. Long meals. Never pack more than 2 activities.

Do NOT include wildcard/surprise picks. This traveler wants the
best-known, best-reviewed options.
```

### Pass C Narration Note
```
Emphasize atmosphere, quality, and what makes this a luxurious or
restful experience.
```

### Sample 3-Day Tokyo Shape
```
Day 1 — Ginza / Marunouchi
  10:00  Hotel breakfast / slow morning (flex)
  11:30  Shopping at Ginza Six (90 min)
  13:00  Lunch: Shojin Ryori at Tofutei — 2hr reservation (120 min)
         ↳ "Private tatami room. Seasonal kaiseki that happens to be
            entirely plant-based. Reservations essential."
  15:30  Spa at Mandarin Oriental (120 min)
  18:30  Dinner: Ukai-tei (90 min)
  20:00  Early night / hotel onsen

Day 2 — Odaiba / Waterfront
  10:00  Late hotel breakfast
  11:30  Odaiba waterfront stroll (60 min)
  13:00  Lunch: Bills Odaiba — ricotta pancakes (90 min)
  14:30  teamLab Borderless (90 min)
  16:30  Spa at Oedo Onsen Monogatari (120 min)
  19:00  Dinner: Tsunahachi Tofu (90 min)

Day 3 — Daikanyama / Nakameguro
  10:30  Coffee at % Arabica (30 min)
  11:00  Daikanyama T-Site browse (75 min)
  12:30  Lunch: Ivy Place (90 min)
  14:00  Nakameguro canal walk (45 min)
  15:00  Afternoon spa treatment (90 min)
  18:00  Dinner: Kozue at Park Hyatt (120 min)

Pace: 2 activities max per day. Long meals. Spa time.
Serendipity: None. Only the best-reviewed, most reliable options.
Budget: Tier 4 — fine dining and premium spas throughout.
```

---

## 6. The Culinary Nomad

### Quiz Result
```json
{
  "dimensions": {
    "structure": 43,
    "comfort": 53,
    "focus": 73,
    "social": 38
  },
  "archetype": "culinary_nomad",
  "secondaryArchetype": "cultural_diver",
  "confidence": 0.91
}
```

### Derived Profile
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

### Scoring Adjustments
```
qualityWeight:     0.45  (d3=73, high immersion → depth matters)
popularityWeight:  0.10  (d3 > 40 → less fame bias)
touristTrapPenalty: 0.15 (d3 > 70 → penalize tourist traps)
visitDurationBias: "max" (d3 > 70 → longer meals)
```

### Pass B Prompt Inject
```
You are planning a trip for a culinary nomad.

TRAVELER PROFILE:
Every meal slot is a primary activity, not filler. Allow 90+ minutes
for meals.

Include one 'wildcard' slot per day — a lesser-known gem with
fewer reviews but high quality.
```

### Pass C Narration Note
```
Emphasize the food story — what's unique, what to order, and why
this place matters culinarily.
```

### Sample 3-Day Tokyo Shape
```
Day 1 — Tsukiji / Ginza Food Trail
  08:30  Tsukiji Outer Market food walk (90 min)
         ↳ "Start with tamagoyaki (vegetarian version), then fresh
            fruit stands and pickled vegetables."
  10:30  Coffee atStreamer Coffee (30 min)
  12:00  Lunch: Tofu Kaiseki at Ukai — the main event (120 min)
         ↳ "Seasonal tofu course. Order the yudofu set — simmered
            at the table, served with seasonal vegetables."
  14:30  Depachika food hall at Mitsukoshi (60 min)
  16:00  Afternoon wagashi + matcha (45 min)
  18:30  Dinner: 8ablish — plant-based fine dining (120 min)
         ↳ "The mushroom risotto uses koji-fermented mushrooms.
            Ask about the seasonal tasting menu."

Day 2 — Shimokitazawa / Sangenjaya
  09:30  Shimokitazawa morning market (60 min)
  11:00  Cooking class: vegetarian ramen (150 min — anchor)
  13:00  Lunch: your own cooking
  14:30  Specialty coffee crawl: Bear Pond + Onibus (75 min)
  16:00  Sangenjaya izakaya street walk (45 min)
  18:00  Dinner: Shojin Ryori at Daigo (120 min)
         ↳ "500-year-old temple cuisine. The sesame tofu is legendary."

Day 3 — Yanaka / Ueno
  09:00  Yanaka Ginza street food walk (75 min)
         ↳ "Try the sweet potato croquettes (vegetarian) from
            Tanaka Shoten."
  11:00  Kayaba Coffee — historic kissaten (45 min)
  12:30  Lunch: T's Tantan Vegan Ramen — Tokyo Station (75 min)
         ↳ "The dan-dan ramen is entirely plant-based. The sesame
            broth is the draw."
  14:00  Ameyoko Market food stalls (60 min)
  15:30  Afternoon sake tasting at nearby shop (45 min)
  18:00  Dinner: Falafel Brothers Shimokitazawa (75 min)

Pace: 3 meals as primary activities + 2–3 food-adjacent stops.
Serendipity: Yes — hidden izakaya, unreviewed market stalls, local kitchens.
```

---

## 7. The Soulful Soloist

### Quiz Result
```json
{
  "dimensions": {
    "structure": 58,
    "comfort": 43,
    "focus": 68,
    "social": 92
  },
  "archetype": "soulful_soloist",
  "secondaryArchetype": "spontaneous_wanderer",
  "confidence": 0.88
}
```

### Derived Profile
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

### Scoring Adjustments
```
qualityWeight:     0.45  (d3=68, immersion-leaning)
popularityWeight:  0.10  (d3 > 40)
touristTrapPenalty: 0.00 (d3 < 70, borderline)
visitDurationBias: "preferred" (d3 middle-high → default but stretched for temples)
```

**Social rules (d4=92):**
```
preferQuietPlaces: true
allowSolitudeSlots: true
crowdPreference: "quiet"
eveningActivityRequired: false
```

### Pass B Prompt Inject
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

### Pass C Narration Note
```
Emphasize the reflective quality, the quiet moments, and how this
place invites presence.
```

### Sample 3-Day Tokyo Shape
```
Day 1 — Yanaka Slow Morning
  09:00  Yanaka Cemetery morning walk (75 min)
         ↳ "The quietest hour in Tokyo. Old gravestones, cherry
            trees, and almost no tourists."
  10:30  Kayaba Coffee — read and write (60 min)
         ↳ "A Showa-era kissaten preserved as-is. Second-floor
            window seat, journal, espresso."
  12:00  Lunch: small Yanaka soba shop (60 min)
  13:30  [wander time — no assigned place, 90 min]
  15:30  Tennoji Temple sunset (45 min)
         ↳ "The bronze Buddha faces west. Sit. That's the activity."
  17:00  [free time / return to accommodation]

Day 2 — Meiji / Nature
  08:00  Meiji Shrine forest walk — before crowds (90 min)
         ↳ "The approach through the forest is the real temple.
            Arrive at opening. The silence is the point."
  10:00  Shinjuku Gyoen slow walk (90 min)
  11:45  Lunch: quiet vegetarian cafe (75 min)
  13:30  Bookshop browse — Daikanyama T-Site (60 min)
  15:00  [wander time — 60 min]
  16:30  Temple meditation session if available (60 min)
  18:00  Solo dinner at counter-seat restaurant (60 min)

Day 3 — Mt. Takao Solitude
  07:30  Early train to Mt. Takao
  09:00  Trail #6 solo hike (150 min)
         ↳ "The quieter trail. Fewer people, more forest."
  12:00  Summit rest + journal (45 min)
  13:00  Descent + lunch at base (60 min)
  15:00  Return to Tokyo
  16:30  [wander time — last afternoon, 90 min]
  18:30  Final solo dinner (75 min)

Pace: 3–4 anchors max. Long unstructured gaps. No evening pressure.
Serendipity: Yes — quiet temples, uncrowded trails, hidden bookshops.
Crowd: Quiet places preferred. Packed venues penalized in scoring.
```

---

## 8. The Social Explorer

### Quiz Result
```json
{
  "dimensions": {
    "structure": 53,
    "comfort": 43,
    "focus": 58,
    "social": 8
  },
  "archetype": "social_explorer",
  "secondaryArchetype": "culinary_nomad",
  "confidence": 0.90
}
```

### Derived Profile
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

### Scoring Adjustments
```
qualityWeight:     0.30  (d3=58, neutral)
popularityWeight:  0.10  (d3 > 40)
touristTrapPenalty: 0.00
visitDurationBias: "preferred"
```

**Social rules (d4=8):**
```
preferQuietPlaces: false
allowSolitudeSlots: false
crowdPreference: "packed"
eveningActivityRequired: true
minSocialVenuesPerDay: 2
```

### Pass B Prompt Inject
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

### Pass C Narration Note
```
Emphasize the people, the energy, and the social opportunities this
place offers.
```

### Sample 3-Day Tokyo Shape
```
Day 1 — Shibuya / Harajuku
  10:00  Meiji Shrine group visit (60 min)
  11:30  Takeshita Street with friends (60 min)
  13:00  Lunch: group-friendly izakaya (90 min)
  15:00  Cooking class — group activity (120 min)
  17:30  Shibuya Crossing at golden hour (30 min)
  18:30  Dinner: group dinner at Torikizoku (90 min)
  20:30  Shibuya bar hop — Golden Gai (120 min)

Day 2 — Asakusa / Skytree
  09:30  Food tour of Asakusa (120 min)
         ↳ "Group walking tour hits 6 stops. The best way to meet
            people and eat simultaneously."
  12:00  Lunch: street food from the tour
  14:00  Tokyo Skytree group visit (60 min)
  15:30  Sumida Park hang (45 min)
  17:00  Craft beer at Popeye (60 min)
  18:30  Dinner: vegetarian-friendly izakaya (90 min)
  20:30  Nightlife in Ryogoku (90 min)

Day 3 — Shimokitazawa / Koenji
  10:00  Vintage shopping with group (90 min)
  12:00  Lunch: Shimokita food hall (75 min)
  14:00  Group walking tour of Shimokitazawa (90 min)
  16:00  Koenji live music venue (60 min)
  18:00  Dinner: group feast at vegetarian restaurant (90 min)
  20:00  Live music / nightlife in Koenji (120 min)
         ↳ "Koenji's underground music scene is where locals and
            travelers collide. Show up, make friends."

Pace: 6–7 stops per day. Evening is mandatory and extended.
Serendipity: Yes — live music venues, local festivals, pop-up events.
```

---

## 9. The Nature Pilgrim

### Quiz Result
```json
{
  "dimensions": {
    "structure": 53,
    "comfort": 78,
    "focus": 53,
    "social": 63
  },
  "archetype": "nature_pilgrim",
  "secondaryArchetype": "thrill_seeker",
  "confidence": 0.86
}
```

### Derived Profile
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

### Scoring Adjustments
```
qualityWeight:     0.30  (d3=53, neutral)
popularityWeight:  0.10
touristTrapPenalty: 0.00
visitDurationBias: "preferred"
```

**Social rules (d4=63):**
```
preferQuietPlaces: false (borderline)
allowSolitudeSlots: true
crowdPreference: "moderate"
```

### Pass B Prompt Inject
```
You are planning a trip for a nature pilgrim.

TRAVELER PROFILE:
Nature activities are anchors. A single 3-hour hike can own a
morning. Everything else is filler.

Include one 'wildcard' slot per day — a lesser-known gem with
fewer reviews but high quality.
```

### Pass C Narration Note
```
Emphasize the natural beauty, the scale, and what makes this place
awe-inspiring.
```

### Sample 3-Day Tokyo Shape
```
Day 1 — Mt. Takao (full day anchor)
  07:30  Early train (60 min transit)
  09:00  Mt. Takao Trail #4 full hike (180 min — anchor)
         ↳ "The suspension bridge section is the highlight. 360°
            canopy, and Fuji on clear days."
  12:30  Summit lunch (45 min)
  13:30  Descent via monkey park route (60 min)
  15:00  Hot spring soak (60 min)
  17:00  Return to Tokyo
  18:30  Dinner: casual vegetarian (60 min)

Day 2 — Shinjuku Gyoen + Todoroki
  08:00  Shinjuku Gyoen early entry (90 min)
         ↳ "The Japanese garden section at dawn light. The scale
            of this park in the middle of Tokyo is staggering."
  10:00  Todoroki Valley trail (90 min)
         ↳ "Tokyo's only ravine. Bamboo, waterfalls, and a temple
            at the end. Feels impossible inside the city."
  12:00  Lunch: cafe near Todoroki (60 min)
  14:00  Showa Kinen Park cycling (120 min)
  17:00  Sunset at a rooftop viewpoint (45 min)
  18:30  Dinner (60 min)

Day 3 — Okutama
  07:00  Train to Okutama (90 min)
  09:00  Hikawa Gorge hike (150 min — anchor)
         ↳ "Emerald water, limestone cliffs, and almost nobody.
            This is the Tokyo most visitors never see."
  12:00  Packed lunch by the river (45 min)
  13:00  Lake Okutama walk (60 min)
  14:30  Return to Tokyo
  17:00  Rest / free time
  18:30  Dinner (60 min)

Pace: 1 nature anchor (2–3 hrs) + 1–2 lighter nature stops + filler.
Serendipity: Yes — hidden trails, local gorges, uncrowded parks.
```

---

## 10. The Bucket List Chaser

### Quiz Result
```json
{
  "dimensions": {
    "structure": 23,
    "comfort": 33,
    "focus": 28,
    "social": 38
  },
  "archetype": "bucket_list_chaser",
  "secondaryArchetype": "master_planner",
  "confidence": 0.93
}
```

### Derived Profile
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

### Scoring Adjustments
```
qualityWeight:     0.30  (d3=28, highlights)
popularityWeight:  0.25  (d3 < 40 → famous = good)
touristTrapPenalty: 0.00
visitDurationBias: "min" (d3 < 30 → quick hits)
```

### Pass B Prompt Inject
```
You are planning a trip for a bucket list chaser.

TRAVELER PROFILE:
Prioritize the iconic, famous, must-see places. This traveler
wants the postcard moments.

Do NOT include wildcard/surprise picks. This traveler wants the
best-known, best-reviewed options.
```

### Pass C Narration Note
```
Emphasize why this is iconic, what makes it a must-see, and the
story they'll tell afterward.
```

### Sample 3-Day Tokyo Shape
```
Day 1 — The Icons (East)
  08:30  Senso-ji Temple (60 min)
         ↳ "Tokyo's oldest temple. The giant red lantern is THE
            Tokyo photo."
  10:00  Tokyo Skytree (60 min)
         ↳ "634m. The observation deck view is unmatched."
  11:30  Lunch: Sometaro Okonomiyaki (60 min)
  13:00  Edo-Tokyo Museum (75 min)
  15:00  Imperial Palace East Gardens (45 min)
  16:00  Tokyo Station architecture (30 min)
  17:30  teamLab Planets (90 min)
  19:30  Dinner: Ichiran Ramen (vegetarian option, 45 min)

Day 2 — The Icons (West)
  08:00  Meiji Shrine (60 min)
  09:30  Harajuku / Takeshita Street (45 min)
  11:00  Shibuya Crossing (30 min)
  11:45  Shibuya Sky (45 min)
  13:00  Lunch: Afuri Ramen (60 min)
  14:30  Shinjuku Gyoen (60 min)
  16:00  Tokyo Metropolitan Government Building (30 min)
  17:00  Kabukicho neon walk (30 min)
  18:00  Dinner: Robot Restaurant area + izakaya (90 min)
  20:00  Golden Gai bar (60 min)

Day 3 — The Icons (South)
  08:00  Tsukiji Outer Market (60 min)
  09:30  teamLab Borderless (90 min)
  11:30  Odaiba — Unicorn Gundam (30 min)
  12:30  Lunch: Bills Odaiba (60 min)
  14:00  Rainbow Bridge walk (45 min)
  15:30  Zojoji Temple + Tokyo Tower (60 min)
  17:30  Roppongi Hills observation deck (45 min)
  19:00  Dinner: Gonpachi (the "Kill Bill" restaurant, 75 min)

Pace: 8–9 stops per day. Short stays at each. Check the boxes.
Serendipity: None. Only the famous, iconic, must-see places.
```

---

## 11. The Slow Immersionist

### Quiz Result
```json
{
  "dimensions": {
    "structure": 68,
    "comfort": 38,
    "focus": 83,
    "social": 63
  },
  "archetype": "slow_immersionist",
  "secondaryArchetype": "cultural_diver",
  "confidence": 0.88
}
```

### Derived Profile
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

### Scoring Adjustments
```
qualityWeight:     0.45  (d3=83, deep immersion)
popularityWeight:  0.10  (d3 > 40)
touristTrapPenalty: 0.15 (d3 > 70 → penalize tourist traps)
visitDurationBias: "max" (d3 > 70 → long stays)
```

**Social rules (d4=63):**
```
allowSolitudeSlots: true
crowdPreference: "moderate"
```

### Pass B Prompt Inject
```
You are planning a trip for a slow immersionist.

TRAVELER PROFILE:
One neighborhood per day, explored deeply. Revisit places over
checking off new ones.

Include one 'wildcard' slot per day — a lesser-known gem with
fewer reviews but high quality.
```

### Pass C Narration Note
```
Emphasize the local texture, the daily rhythms, and what makes
this place feel lived-in.
```

### Sample 3-Day Tokyo Shape
```
Day 1 — Yanaka (one neighborhood, all day)
  09:00  Yanaka Cemetery morning walk (90 min)
         ↳ "Locals walk their dogs here every morning. This isn't
            a tourist site — it's a neighborhood park that happens
            to be a cemetery."
  10:45  Kayaba Coffee — stay a while (75 min)
         ↳ "Read, write, watch the neighborhood wake up. The
            second floor has a view of the cemetery canopy."
  12:30  Lunch: Sakanoya — neighborhood fish shop (vegetarian options, 60 min)
  14:00  Yanaka Ginza — browse every shop (90 min)
  15:45  Tennoji Temple (60 min)
  17:00  Return to Kayaba for evening coffee (45 min)
  18:30  Dinner: small neighborhood restaurant (90 min)

Day 2 — Shimokitazawa (one neighborhood, all day)
  10:00  Morning coffee at Onibus (45 min)
  10:45  Vintage shopping — every shop, no rush (120 min)
  12:45  Lunch: Rojiura Curry (90 min)
         ↳ "The kind of place where the owner remembers you from
            last time. Vegetable curry, slow-cooked."
  14:30  Shimokitazawa record shops (75 min)
  16:00  Afternoon cafe + journal (60 min)
  17:30  Local gallery or live music venue (60 min)
  19:00  Dinner: neighborhood izakaya (120 min)

Day 3 — Nakameguro / Daikanyama
  09:30  Nakameguro canal walk (75 min)
  11:00  Daikanyama T-Site — books and coffee (90 min)
  12:45  Lunch: Ivy Place terrace (90 min)
  14:30  Artisan shop walk (75 min)
  16:00  [wander time — revisit favorite spot, 90 min]
  18:30  Final dinner: slow kaiseki (120 min)

Pace: 4–5 stops per day, ALL in one neighborhood. Very long stays.
Serendipity: Yes — local artisan shops, unmarked cafes, neighborhood gems.
```

---

## 12. The Weekend Warrior

### Quiz Result
```json
{
  "dimensions": {
    "structure": 13,
    "comfort": 33,
    "focus": 38,
    "social": 28
  },
  "archetype": "weekend_warrior",
  "secondaryArchetype": "master_planner",
  "confidence": 0.95
}
```

### Derived Profile
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

### Scoring Adjustments
```
qualityWeight:     0.30  (d3=38, highlights-leaning)
popularityWeight:  0.25  (d3 < 40 → famous/efficient = good)
touristTrapPenalty: 0.00
visitDurationBias: "min" (d3 < 40 → quick hits)
```

### Pass B Prompt Inject
```
You are planning a trip for a weekend warrior.

TRAVELER PROFILE:
Maximize slots. Use 'packed' pace regardless of stated preference.
Every minute counts.

Do NOT include wildcard/surprise picks. This traveler wants the
best-known, best-reviewed options.
```

### Pass C Narration Note
```
Emphasize the payoff-per-minute — why this place is worth the time
investment.
```

### Sample 3-Day Tokyo Shape
```
Day 1 — Maximum Asakusa / Akihabara
  08:00  Senso-ji Temple (45 min — in and out)
         ↳ "Get there at opening. 45 minutes covers the main hall,
            the incense ritual, and the photo."
  09:00  Nakamise Street (30 min)
  09:45  Kappabashi Street (30 min)
  10:30  Sumida River walk to Ryogoku (30 min)
  11:15  Edo-Tokyo Museum (75 min)
  12:45  Lunch: quick vegetarian ramen (45 min)
  14:00  Akihabara electric town (60 min)
  15:15  Kanda Shrine (30 min)
  16:00  Tokyo Station ramen street (45 min)
  17:30  Imperial Palace (45 min)
  18:45  Dinner: efficiency izakaya (60 min)
  20:00  Tokyo Station night illumination (20 min)

Day 2 — Maximum Shibuya / Shinjuku
  08:30  Meiji Shrine (45 min)
  09:30  Takeshita Street (30 min)
  10:15  Omotesando architecture walk (30 min)
  11:00  Shibuya Crossing (20 min)
  11:30  Shibuya Sky (45 min)
  12:30  Lunch: Afuri (45 min)
  13:30  Shinjuku Gyoen (60 min)
  15:00  Tokyo Metropolitan Building (30 min)
  15:45  Kabukicho walk (20 min)
  16:15  Golden Gai (30 min)
  17:00  Shinjuku shopping (45 min)
  18:00  Dinner: quick kaiseki (60 min)
  19:30  Omoide Yokocho (30 min)
  20:15  Tokyo nightlife glimpse (30 min)

Day 3 — Maximum Odaiba / Ginza
  09:00  teamLab Planets (75 min)
  10:30  Odaiba Gundam (20 min)
  11:00  Odaiba waterfront (30 min)
  11:45  Lunch: Bills (45 min)
  13:00  Tsukiji Outer Market (45 min)
  14:00  Ginza shopping (60 min)
  15:15  Kabukiza Theatre exterior (15 min)
  15:45  Hama-rikyu Gardens (45 min)
  17:00  Shiodome views (20 min)
  17:30  Dinner: quick sushi (45 min)
  18:45  Tokyo Tower at sunset (45 min)

Pace: 12–14 stops per day. Short stays. Zero wasted time.
Serendipity: None. Every stop is optimized for payoff-per-minute.
```

---

## Comparison Matrix: Same Trip, Different Archetypes

All 12 archetypes above are planning the **same trip**: 3 days, Tokyo, vegetarian. Here's how they differ:

| Aspect | Master Planner | Spont. Wanderer | Cultural Diver | Thrill Seeker | Comfort Cruiser | Culinary Nomad |
|---|---|---|---|---|---|---|
| **Stops/day** | 8–9 | 4–5 | 5–6 | 5–6 | 2–3 | 6–7 |
| **Meal time** | 60 min | 60 min | 90–120 min | 45–60 min | 90–120 min | 90–120 min |
| **Longest single stop** | 90 min (museum) | flex/unplanned | 150 min (cooking class) | 180 min (hike) | 120 min (spa) | 150 min (cooking class) |
| **Wildcards** | None | Yes (hidden gems) | Yes (hidden temples) | Yes (local trails) | None | Yes (hidden kitchens) |
| **Evening activity** | Optional | Flex | Optional | Recovery | Spa/rest | Dinner as event |
| **Budget tier** | 3 | 2 | 2 | 1 | 4 | 2 |

| Aspect | Soulful Soloist | Social Explorer | Nature Pilgrim | Bucket List Chaser | Slow Immersionist | Weekend Warrior |
|---|---|---|---|---|---|---|
| **Stops/day** | 3–4 | 6–7 | 3–4 + nature | 8–9 | 4–5 | 12–14 |
| **Meal time** | 60 min | 90 min (social) | 45–60 min | 45–60 min | 90–120 min | 30–45 min |
| **Longest single stop** | wander time (90 min) | bar/nightlife (120 min) | hike (180 min) | teamLab (90 min) | neighborhood (120 min) | teamLab (75 min) |
| **Wildcards** | Yes (quiet spots) | Yes (live music) | Yes (hidden trails) | None | Yes (artisan shops) | None |
| **Evening activity** | None preferred | MANDATORY | Optional | Optional | Optional | Until collapse |
| **Budget tier** | 2 | 2 | 1 | 3 | 2 | 3 |
