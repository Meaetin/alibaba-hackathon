# Persona Tags & Google Places Affinities

What each travel persona "means" to the personalization pipeline: the human-readable
interest tags, the Google Places type affinities they translate into, and the
pace/budget/scoring/scheduling behavior they drive.

**Sources:** `docs/quiz-pipeline-bridge.md` (translation rules),
`docs/archetype-data-payloads.md` (payload values), `docs/archetype-personas.md`
(character definitions).
**Code:** `src/lib/persona/presets.ts` (data), `src/lib/persona/profile.ts`
(`buildProfile` + dimension rules), consumed via the planner's
`PreferenceProfile` (`src/lib/planner/types.ts`).

## How the two tag layers work

| Layer | Example | Purpose |
|-------|---------|---------|
| **Interest tags** | `street_food`, `temples` | Human vocabulary — UI chips, overrides, this doc. Mapped into the planner's 7-member `Interest` union where possible. |
| **Places affinities** | `street_food_stall: 1.4` | Google Places type keys + soft weights. Matched against `place.types` during affinity scoring. This is the precision layer; tags the union can't express still ride here. |

Precedence (the quiz augments, never replaces, the trip form): dietary is always
the form; budget = form ?? persona fallback; interests = form overrides ??
persona-derived; typeAffinities = always the archetype preset.

---

## 1. The Master Planner 📋

- **Tags:** landmarks · museums · architecture · shopping
- **Places affinities:** `landmarks 1.4` · `museum 1.3` · `tourist_attraction 1.2` · `art_gallery 1.1` · `shopping_mall 0.9` · `store 0.9`
- **Pace / Budget:** packed · 3
- **Scoring:** quality 0.30 · trap penalty 0 · duration bias `min` · crowd moderate
- **Scheduling:** 6–9 activities/day (target 8) · meals 45/60/75 min · no wildcards
- **Pass B:** Prefers dense, well-sequenced days with minimal dead time. No wildcard picks — best-known, best-reviewed options only.
- **Pass C:** Emphasize efficiency, sequence, and what makes this a smart choice in the day's plan.

## 2. The Spontaneous Wanderer 🌬️

- **Tags:** cafes · street_art · local_markets · walking_tours
- **Places affinities:** `cafe 1.3` · `coffee_shop 1.3` · `art_gallery 1.2` · `market 1.3` · `flea_market 1.3` · `walking_tour 1.1`
- **Pace / Budget:** relaxed · 2
- **Scoring:** quality 0.30 · trap penalty 0 · duration bias `preferred` · crowd moderate
- **Scheduling:** 3–5/day (target 4) · meals 45/60/90 min · wildcards ≤500 reviews
- **Pass B:** Leave gaps. Fewer anchors, more flex candidates. One wildcard slot per day.
- **Pass C:** Emphasize the vibe, the unexpected charm, and why this place rewards curiosity.

## 3. The Cultural Diver 🎭

- **Tags:** museums · temples · local_markets · cooking_classes · historical_sites
- **Places affinities:** `museum 1.4` · `temple 1.3` · `place_of_worship 1.3` · `market 1.2` · `flea_market 1.2` · `cooking_school 1.5` · `historical_landmark 1.3` · `cultural_center 1.3`
- **Pace / Budget:** balanced · 2
- **Scoring:** quality **0.45** · trap penalty **0.15** (>5000 reviews) · duration bias `max` · crowd moderate
- **Scheduling:** 4–6/day (target 5) · meals 60/90/120 min · wildcards ≤500 reviews
- **Pass B:** Allow longer stays at cultural sites. Rushing past a temple is a failure. One wildcard slot per day.
- **Pass C:** Emphasize cultural significance, what to learn here, and the depth this place offers.

## 4. The Thrill Seeker ⚡

- **Tags:** outdoors · adventure_sports · viewpoints · water_activities
- **Places affinities:** `park 1.4` · `hiking_area 1.5` · `national_park 1.5` · `adventure_sports_center 1.5` · `tourist_attraction 1.2` · `observation_deck 1.2` · `water_park 1.3` · `beach 1.3`
- **Pace / Budget:** balanced · 1
- **Scoring:** quality 0.30 · trap penalty 0 · duration bias `preferred` · crowd moderate
- **Scheduling:** 4–7/day (target 5) · meals 30/60/75 min · wildcards ≤500 reviews
- **Pass B:** Anchor days around one big activity. Fill gaps with recovery (cafes, viewpoints). One wildcard slot per day.
- **Pass C:** Emphasize the adrenaline, the physical experience, and what makes this an epic moment.

## 5. The Comfort Cruiser 🛋️

- **Tags:** spas · fine_dining · shopping · scenic_drives · resorts
- **Places affinities:** `spa 1.4` · `day_spa 1.4` · `restaurant 1.3` · `fine_dining_restaurant 1.3` · `shopping_mall 1.2` · `boutique 1.2` · `scenic_spot 1.1` · `resort 1.3` · `hotel 1.3`
- **Pace / Budget:** relaxed · 4
- **Scoring:** quality 0.30 · trap penalty 0 · duration bias `max` · crowd **quiet** (penalty 0.05 on packed)
- **Scheduling:** 1–3/day (target 2) · meals 75/90/120 min · no wildcards
- **Pass B:** Slow days. Long meals. Never pack more than 2 activities. No wildcard picks.
- **Pass C:** Emphasize atmosphere, quality, and what makes this a luxurious or restful experience.

## 6. The Culinary Nomad 🍜

- **Tags:** restaurants · street_food · local_markets · cooking_classes · food_tours · cafes
- **Places affinities:** `restaurant 1.5` · `meal_delivery 1.0` · `fast_food_restaurant 1.1` · `street_food_stall 1.4` · `market 1.3` · `flea_market 1.2` · `cooking_school 1.4` · `food_tour 1.4` · `cafe 1.2` · `coffee_shop 1.2`
- **Pace / Budget:** balanced · 2
- **Scoring:** quality **0.45** · trap penalty **0.15** (>5000 reviews) · duration bias `max` · crowd moderate
- **Scheduling:** 4–7/day (target 5) · meals 75/90/120 min · wildcards ≤500 reviews
- **Pass B:** Every meal slot is a primary activity, not filler. Allow 90+ minutes for meals. One wildcard slot per day.
- **Pass C:** Emphasize the food story — what's unique, what to order, and why this place matters culinarily.

## 7. The Soulful Soloist 🧘

- **Tags:** temples · nature_walks · meditation_retreats · bookshops · cafes · viewpoints
- **Places affinities:** `temple 1.3` · `place_of_worship 1.3` · `park 1.3` · `hiking_area 1.2` · `meditation_center 1.4` · `yoga_studio 1.3` · `book_store 1.1` · `cafe 1.2` · `coffee_shop 1.2` · `observation_deck 1.2` · `scenic_spot 1.2`
- **Pace / Budget:** balanced · 2
- **Scoring:** quality 0.40 · trap penalty 0 · duration bias `preferred` · crowd **quiet** (penalty 0.10 on packed)
- **Scheduling:** 2–5/day (target 3) · solitude slots allowed · meals 45/60/90 min · wildcards ≤500 reviews
- **Pass B:** Built-in solitude. No back-to-back social activities. A 'wander time' slot with no assigned place is valid. One wildcard slot per day.
- **Pass C:** Emphasize the reflective quality, the quiet moments, and how this place invites presence.

## 8. The Social Explorer 🎉

- **Tags:** nightlife · local_markets · food_tours · group_activities · festivals · bars
- **Places affinities:** `bar 1.2` · `night_club 1.3` · `karaoke_bar 1.2` · `market 1.2` · `flea_market 1.1` · `food_tour 1.3` · `event_venue 1.4` · `festival 1.5` · `entertainment_agency 1.4` · `performing_arts_theater 1.3`
- **Pace / Budget:** balanced · 2
- **Scoring:** quality 0.30 · trap penalty 0 · duration bias `preferred` · crowd **packed** (penalty 0.05 on quiet)
- **Scheduling:** 5–8/day (target 6) · **evening activity required** · ≥2 social venues/day · meals 60/90/120 min · wildcards ≤500 reviews
- **Pass B:** Evening slots are load-bearing, not optional. Every day MUST include an evening activity. One wildcard slot per day.
- **Pass C:** Emphasize the people, the energy, and the social opportunities this place offers.

## 9. The Nature Pilgrim 🏔️

- **Tags:** outdoors · hiking · national_parks · viewpoints · botanical_gardens · wildlife
- **Places affinities:** `park 1.5` · `hiking_area 1.5` · `national_park 1.4` · `nature_reserve 1.4` · `observation_deck 1.3` · `scenic_spot 1.3` · `botanical_garden 1.2` · `zoo 1.1` · `wildlife_park 1.3` · `campground 1.2`
- **Pace / Budget:** balanced · 1
- **Scoring:** quality 0.30 · trap penalty 0 · duration bias `preferred` · crowd moderate
- **Scheduling:** 3–5/day (target 4) · solitude slots allowed · meals 30/60/75 min · wildcards ≤500 reviews
- **Pass B:** Nature activities are anchors. A single 3-hour hike can own a morning. Everything else is filler. One wildcard slot per day.
- **Pass C:** Emphasize the natural beauty, the scale, and what makes this place awe-inspiring.

## 10. The Bucket List Chaser 🏆

- **Tags:** landmarks · viewpoints · museums · iconic_restaurants · shows
- **Places affinities:** `tourist_attraction 1.5` · `landmark 1.5` · `observation_deck 1.3` · `scenic_spot 1.3` · `museum 1.2` · `restaurant 1.3` · `fine_dining_restaurant 1.3` · `performing_arts_theater 1.2` · `show_venue 1.2`
- **Pace / Budget:** packed (forced) · 3
- **Scoring:** quality 0.30 · trap penalty 0 · duration bias `min` · crowd moderate
- **Scheduling:** 6–10/day (target 8) · meals 30/60/75 min · no wildcards
- **Pass B:** Prioritize the iconic, famous, must-see places — the postcard moments. No wildcard picks.
- **Pass C:** Emphasize why this is iconic, what makes it a must-see, and the story they'll tell afterward.

## 11. The Slow Immersionist 🕰️

- **Tags:** local_markets · cafes · neighborhoods · cooking_classes · temples · artisan_shops
- **Places affinities:** `market 1.3` · `flea_market 1.2` · `cafe 1.3` · `coffee_shop 1.3` · `neighborhood 1.4` · `cooking_school 1.3` · `temple 1.2` · `place_of_worship 1.2` · `art_gallery 1.2` · `handicraft_store 1.2` · `artisan_shop 1.2`
- **Pace / Budget:** relaxed · 2
- **Scoring:** quality **0.45** · trap penalty **0.15** (>5000 reviews) · duration bias `max` · crowd moderate
- **Scheduling:** 3–5/day (target 4) · solitude slots allowed · meals 75/90/120 min · wildcards ≤500 reviews
- **Pass B:** One neighborhood per day, explored deeply. Revisit places over checking off new ones. One wildcard slot per day.
- **Pass C:** Emphasize the local texture, the daily rhythms, and what makes this place feel lived-in.

## 12. The Weekend Warrior 🚀

- **Tags:** landmarks · restaurants · shopping · viewpoints
- **Places affinities:** `tourist_attraction 1.4` · `landmark 1.4` · `restaurant 1.2` · `shopping_mall 1.1` · `store 1.1` · `observation_deck 1.2` · `scenic_spot 1.2`
- **Pace / Budget:** packed (forced) · 3
- **Scoring:** quality 0.30 · trap penalty 0 · duration bias `min` · crowd moderate
- **Scheduling:** 8–14/day (target 12) · meals 30/45/60 min · no wildcards
- **Pass B:** Maximize slots. Use 'packed' pace regardless of stated preference. Every minute counts. No wildcard picks.
- **Pass C:** Emphasize the payoff-per-minute — why this place is worth the time investment.

---

## Quick lookup

| Persona | Pace | Budget | Quality w | Trap pen. | Duration | Crowd | Wildcards |
|---------|------|:------:|:---------:|:---------:|----------|-------|:---------:|
| Master Planner | packed | 3 | 0.30 | — | min | moderate | ✗ |
| Spontaneous Wanderer | relaxed | 2 | 0.30 | — | preferred | moderate | ✓ |
| Cultural Diver | balanced | 2 | 0.45 | 0.15 | max | moderate | ✓ |
| Thrill Seeker | balanced | 1 | 0.30 | — | preferred | moderate | ✓ |
| Comfort Cruiser | relaxed | 4 | 0.30 | — | max | quiet | ✗ |
| Culinary Nomad | balanced | 2 | 0.45 | 0.15 | max | moderate | ✓ |
| Soulful Soloist | balanced | 2 | 0.40 | — | preferred | quiet | ✓ |
| Social Explorer | balanced | 2 | 0.30 | — | preferred | packed | ✓ |
| Nature Pilgrim | balanced | 1 | 0.30 | — | preferred | moderate | ✓ |
| Bucket List Chaser | packed | 3 | 0.30 | — | min | moderate | ✗ |
| Slow Immersionist | relaxed | 2 | 0.45 | 0.15 | max | moderate | ✓ |
| Weekend Warrior | packed | 3 | 0.30 | — | min | moderate | ✗ |

## Dimension → parameter rules (continuous scores)

Even within an archetype, the raw 0–100 dimension scores fine-tune behavior
(`src/lib/persona/profile.ts`):

- **d1 → pace:** ≤30 packed · ≤65 balanced · else relaxed (Weekend Warrior &
  Bucket List Chaser always packed)
- **d2 → budget fallback:** ≤20 → 4 · ≤40 → 3 · ≤65 → 2 · else 1
- **d3 → scoring:** >60 quality 0.45 · <40 popularity 0.25 · >70 trap penalty
  0.15 + duration `max` · <30 duration `min`
- **d4 → scheduling:** <30 evening required + 2 social venues + packed crowd ·
  >60 solitude slots · >70 prefer quiet
