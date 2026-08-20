# Travel Persona Quiz — Methodology & Scoring Guide

This document explains how the Travel Persona Quiz works under the hood: the dimension model, how each question contributes to scoring, and how the 12 archetypes are determined from a user's answers.

---

## 1. The Dimension Model

Rather than assigning types arbitrarily (like a BuzzFeed quiz), this quiz uses a **4-axis dimensional model** inspired by academic frameworks like Plog's Allocentric/Psychocentric typology and Cohen's Tourist Typology, combined with popular personality systems like MBTI and the Big Five.

Each axis represents a **continuum** — users are scored 0–100 on each, meaning they can land anywhere on the spectrum, not just at the extremes.

| Axis          | Code | 0 = This End           | 100 = This End       | What It Measures                             |
| ------------- | ---- | ---------------------- | -------------------- | -------------------------------------------- |
| **Structure** | `d1` | Master Planner         | Spontaneous Wanderer | How much you pre-plan vs. improvise          |
| **Comfort**   | `d2` | Luxury-first           | Roughing It          | Your tolerance for discomfort on the road    |
| **Focus**     | `d3` | Sightseeing Highlights | Deep Immersion       | Whether you collect experiences or go deep   |
| **Social**    | `d4` | Group-oriented         | Solo-oriented        | How you recharge and connect while traveling |

> **Why 4 axes?** These four dimensions capture the core tensions that differentiate travel styles in the research literature. Plog's model maps primarily to Structure + Comfort. Cohen's Drifter↔Organized Mass Tourist maps to Structure + Focus. The Big Five travel adaptations (Truity) map to Comfort + Social.

---

## 2. How Each Question Scores

Every question has **3 options**, and each option carries a score vector across all 4 dimensions. When a user selects an answer, those scores are added to their running totals.

### Question 1 — Trip Prep

> _"You just booked a 2-week trip to Japan. What's your next move?"_

| Option                   | d1 (Structure) | d2 (Comfort) | d3 (Focus) | d4 (Social) | Rationale                                                                                         |
| ------------------------ | :------------: | :----------: | :--------: | :---------: | ------------------------------------------------------------------------------------------------- |
| 📋 Spreadsheet time      |       0        |      25      |     40     |     50      | Extreme planner signal. Mild comfort preference (wants control). Neutral on immersion and social. |
| 📌 Bookmark a few things |       45       |      40      |     50     |     50      | Balanced structure — light prep but open-ended. Slight immersion lean.                            |
| 🎒 Just pack and go      |       90       |      55      |     65     |     50      | Maximum spontaneity. Higher comfort tolerance. Immersion-leaning (trusts gut over guides).        |

**Primary signal:** `d1` (Structure) — this is the strongest planner-vs-spontaneous question.

---

### Question 2 — First Morning

> _"It's your first morning in a new city. How does your day start?"_

| Option                | d1  | d2  | d3  | d4  | Rationale                                                                        |
| --------------------- | :-: | :-: | :-: | :-: | -------------------------------------------------------------------------------- |
| 🗺️ Hit the landmarks  | 20  | 30  | 25  | 50  | Structured (early, planned), low comfort need, experience-collection mode.       |
| ☕ Wander to a café   | 75  | 40  | 65  | 55  | Spontaneous, moderate comfort, immersion through observation.                    |
| 🏞️ Find the wild side | 60  | 75  | 55  | 65  | Moderate spontaneity, high comfort tolerance (trails > cafés), slight solo lean. |

**Primary signal:** `d1` + `d2` — separates landmark tourists from café wanderers from nature seekers.

---

### Question 3 — Accommodation

> _"Where do you genuinely prefer to sleep on a trip?"_

| Option                       | d1  | d2  | d3  | d4  | Rationale                                                                                    |
| ---------------------------- | :-: | :-: | :-: | :-: | -------------------------------------------------------------------------------------------- |
| 🏨 A great hotel             | 25  |  5  | 30  | 40  | Hotels = comfort + predictability = planner energy.                                          |
| 🏠 Local Airbnb/guesthouse   | 50  | 45  | 60  | 45  | Balanced. Neighborhood immersion. Moderate comfort trade-off.                                |
| ⛺ Hostel, camp, or wherever | 70  | 90  | 65  | 35  | Maximum comfort tolerance. Spontaneous (goes with the flow). Slightly more social (hostels). |

**Primary signal:** `d2` (Comfort) — the clearest comfort-vs-roughing-it question.

---

### Question 4 — Pace

> _"What does your ideal travel day look like?"_

| Option                 | d1  | d2  | d3  | d4  | Rationale                                                                         |
| ---------------------- | :-: | :-: | :-: | :-: | --------------------------------------------------------------------------------- |
| ⚡ Packed dawn to dusk | 15  | 30  | 30  | 50  | Highly structured (optimized schedule), experience-collection mode.               |
| 🌊 A loose rhythm      | 55  | 45  | 55  | 50  | Balanced — some structure, some spontaneity.                                      |
| 🛋️ Slow and unhurried  | 80  | 25  | 60  | 55  | No schedule = spontaneous. Low comfort tolerance (wants ease). Immersion-leaning. |

**Primary signal:** `d1` (Structure) + `d3` (Focus) — pace reveals whether you're optimizing or absorbing.

---

### Question 5 — Culture

> _"You arrive somewhere with a totally different culture. You…"_

| Option                     | d1  | d2  | d3  | d4  | Rationale                                                                      |
| -------------------------- | :-: | :-: | :-: | :-: | ------------------------------------------------------------------------------ |
| 🎭 Dive in completely      | 50  | 60  | 95  | 55  | Maximum immersion signal. Higher comfort tolerance (eating local, no English). |
| 📸 Sample the highlights   | 30  | 35  | 40  | 45  | Structured approach, moderate comfort, experience-collection.                  |
| 🧘 Observe from a distance | 40  | 20  | 20  | 60  | Low immersion, low comfort tolerance, more solo/reflective.                    |

**Primary signal:** `d3` (Focus) — the strongest immersion-vs-highlights differentiator.

---

### Question 6 — Social Style

> _"On a trip, your social energy usually looks like…"_

| Option                       | d1  | d2  | d3  | d4  | Rationale                                                      |
| ---------------------------- | :-: | :-: | :-: | :-: | -------------------------------------------------------------- |
| 👥 Group all the way         | 35  | 35  | 40  |  5  | Highly social. Moderate structure (group trips need planning). |
| 🤝 Meet people along the way | 55  | 55  | 65  | 45  | Balanced social. Spontaneous socializing = immersion-leaning.  |
| 🚶 Happy on your own         | 65  | 50  | 70  | 95  | Maximum solo signal. Moderate spontaneity and immersion.       |

**Primary signal:** `d4` (Social) — the core solo-vs-group question.

---

### Question 7 — Food

> _"When it comes to food on the road, you're most excited about…"_

| Option                    | d1  | d2  | d3  | d4  | Rationale                                                                           |
| ------------------------- | :-: | :-: | :-: | :-: | ----------------------------------------------------------------------------------- |
| 🍽️ The food IS the trip   | 40  | 50  | 75  | 45  | Food-driven = high immersion, moderate comfort tolerance (willing to try anything). |
| 🌮 Street food adventures | 65  | 80  | 70  | 50  | Spontaneous + high comfort tolerance + immersion through local eating.              |
| 🥗 Fuel for the journey   | 30  | 30  | 30  | 55  | Food is secondary = lower immersion. Planner-leaning. Moderate comfort.             |

**Primary signal:** `d3` (Focus) + `d2` (Comfort) — food attitudes reveal cultural openness and comfort tolerance.

---

### Question 8 — Risk & Comfort

> _"A local invites you to a village festival 3 hours away by bus. You…"_

| Option                 | d1  | d2  | d3  | d4  | Rationale                                                                             |
| ---------------------- | :-: | :-: | :-: | :-: | ------------------------------------------------------------------------------------- |
| 🚌 Go immediately      | 90  | 75  | 80  | 40  | Maximum spontaneity, high comfort tolerance, high immersion (local invitation).       |
| 🤔 Check reviews first | 20  | 30  | 50  | 55  | Strong planner signal. Low comfort tolerance (needs safety info). Moderate immersion. |
| 😊 Politely decline    | 25  | 10  | 20  | 65  | Low immersion, low comfort tolerance (prefers known environment), more solo.          |

**Primary signal:** `d1` + `d2` + `d3` — the "risk appetite" question hits three axes simultaneously.

---

### Question 9 — Packing

> _"Be honest — what does your packing look like?"_

| Option                           | d1  | d2  | d3  | d4  | Rationale                                                           |
| -------------------------------- | :-: | :-: | :-: | :-: | ------------------------------------------------------------------- |
| 🧳 Color-coded and labeled       |  5  | 20  | 35  | 50  | Extreme planner signal. Low comfort tolerance (wants preparedness). |
| 🎒 One carry-on, essentials only | 55  | 65  | 55  | 55  | Balanced. Moderate comfort tolerance (minimalist = adaptable).      |
| 🤷 Throw things in a bag         | 85  | 55  | 50  | 45  | High spontaneity. Moderate comfort tolerance.                       |

**Primary signal:** `d1` (Structure) — packing style is one of the most reliable planner indicators.

---

### Question 10 — Memories

> _"What makes a trip truly unforgettable for you?"_

| Option                        | d1  | d2  | d3  | d4  | Rationale                                                                             |
| ----------------------------- | :-: | :-: | :-: | :-: | ------------------------------------------------------------------------------------- |
| 🏔️ An epic adventure          | 45  | 80  | 50  | 45  | High comfort tolerance. Moderate on other axes — adventure transcends planning style. |
| 💬 A deep human connection    | 65  | 55  | 90  | 50  | Spontaneous, moderate comfort, maximum immersion (human depth).                       |
| 🌅 A perfect, peaceful moment | 55  | 15  | 55  | 70  | Low comfort tolerance (wants ease). Solo-leaning. Moderate immersion.                 |

**Primary signal:** `d2` (Comfort) + `d4` (Social) — what you _remember_ reveals what you truly value.

---

### Question 11 — Detours

> _"Your train breaks down in a small town not on your itinerary. You feel…"_

| Option            | d1  | d2  | d3  | d4  | Rationale                                                                          |
| ----------------- | :-: | :-: | :-: | :-: | ---------------------------------------------------------------------------------- |
| 😤 Frustrated     |  5  | 25  | 30  | 55  | Extreme planner signal (plans disrupted = stress). Low comfort tolerance.          |
| 🤩 Delighted      | 90  | 65  | 70  | 45  | Maximum spontaneity. High comfort tolerance. Immersion (new town = new discovery). |
| 😌 Chill about it | 60  | 35  | 50  | 60  | Moderate spontaneity. Moderate comfort. Balanced immersion.                        |

**Primary signal:** `d1` (Structure) — reaction to disrupted plans is the purest structure-axis test.

---

### Question 12 — Homecoming

> _"You're home. What's the first thing people hear from you?"_

| Option                         | d1  | d2  | d3  | d4  | Rationale                                                                                 |
| ------------------------------ | :-: | :-: | :-: | :-: | ----------------------------------------------------------------------------------------- |
| 📊 "Let me show you my slides" | 10  | 30  | 35  | 35  | Planner (organized documentation). Low immersion (curated, not absorbed). Social sharing. |
| ✨ "You HAVE to go there"      | 45  | 40  | 55  | 25  | Balanced structure. Moderate immersion. Very social (evangelizing the destination).       |
| 🌍 "Where to next?"            | 70  | 55  | 60  | 55  | Spontaneous (already moving on). Moderate comfort. Moderate immersion.                    |

**Primary signal:** `d1` + `d4` — post-trip behavior reveals planning style and social orientation.

---

## 3. How Scoring Works

### Step 1: Sum Raw Scores

Each of the 12 questions contributes a score to all 4 dimensions. After answering all questions, the raw totals are calculated:

```
total_d1 = sum of d1 scores from all 12 answers
total_d2 = sum of d2 scores from all 12 answers
total_d3 = sum of d3 scores from all 12 answers
total_d4 = sum of d4 scores from all 12 answers
```

### Step 2: Average Across Questions

Each dimension total is divided by the number of questions (12) to normalize the score to a **0–100 range**:

```
score_d1 = total_d1 / 12
score_d2 = total_d2 / 12
score_d3 = total_d3 / 12
score_d4 = total_d4 / 12
```

This gives the user's **Travel DNA profile** — four numbers that describe their position on each axis.

### Step 3: Match to Nearest Archetype

Each of the 12 archetypes has a **center point** in 4D space — the ideal score that perfectly represents that type. The quiz calculates the **Euclidean distance** from the user's score to each archetype's center:

```
distance = √( (score_d1 - center_d1)²
            + (score_d2 - center_d2)²
            + (score_d3 - center_d3)²
            + (score_d4 - center_d4)² )
```

The archetype with the **smallest distance** is the user's match.

### Why Euclidean Distance?

This approach means that:

- Users are matched to their **closest overall fit**, not just the highest single-axis score
- A user who is "mostly planner but loves roughing it" will match to a different archetype than "mostly planner who loves luxury" — even though both are planners on `d1`
- It naturally handles **blended personalities** — most people aren't pure types

---

## 4. Archetype Center Points

Here's where each archetype "lives" in 4D space, and what that means:

| Archetype                    | d1 (Structure) | d2 (Comfort) | d3 (Focus) | d4 (Social) | Design Logic                                                                                                                                   |
| ---------------------------- | :------------: | :----------: | :--------: | :---------: | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **The Master Planner**       |       5        |      25      |     35     |     45      | Near-zero spontaneity. Slightly luxe. Experience-collector. Moderately social.                                                                 |
| **The Spontaneous Wanderer** |       90       |      65      |     60     |     50      | Maximum spontaneity. High comfort tolerance. Moderate immersion. Neutral social.                                                               |
| **The Cultural Diver**       |       50       |      60      |     95     |     50      | Balanced structure. High comfort tolerance (goes local). Maximum immersion. Neutral social.                                                    |
| **The Thrill Seeker**        |       40       |      85      |     50     |     40      | Moderate structure (adventures need some planning). Maximum comfort tolerance. Moderate immersion. Slightly group-leaning (adventure buddies). |
| **The Comfort Cruiser**      |       25       |      5       |     25     |     50      | Highly structured (needs predictability). Maximum luxury. Low immersion (comfort over culture). Neutral social.                                |
| **The Culinary Nomad**       |       45       |      55      |     75     |     40      | Balanced structure. Moderate comfort tolerance. High immersion (food = culture). Slightly group-leaning (food is social).                      |
| **The Soulful Soloist**      |       60       |      45      |     70     |     95      | Spontaneous-leaning. Moderate comfort. High immersion. Maximum solo.                                                                           |
| **The Social Explorer**      |       55       |      45      |     60     |      5      | Moderate spontaneity. Moderate comfort. Moderate immersion. Maximum group/social.                                                              |
| **The Nature Pilgrim**       |       55       |      80      |     55     |     65      | Moderate spontaneity. High comfort tolerance (outdoorsy). Moderate immersion. Solo-leaning.                                                    |
| **The Bucket List Chaser**   |       25       |      35      |     30     |     40      | Highly structured (needs to "get" the experience). Low comfort tolerance. Low immersion (highlights over depth). Slightly group.               |
| **The Slow Immersionist**    |       70       |      40      |     85     |     65      | Spontaneous (goes with local rhythm). Moderate comfort. Near-maximum immersion. Solo-leaning.                                                  |
| **The Weekend Warrior**      |       15       |      35      |     40     |     30      | Near-zero spontaneity (must optimize limited time). Low comfort tolerance. Moderate immersion. Group-leaning.                                  |

---

## 5. Dimension Contribution by Question

This table shows which dimensions each question most strongly differentiates on. Cells with bold values are the **primary signals** for that question.

| #   | Question       | d1 (Structure) | d2 (Comfort)  |  d3 (Focus)   |  d4 (Social)  |
| --- | -------------- | :------------: | :-----------: | :-----------: | :-----------: |
| 1   | Trip Prep      | **90** spread  |   30 spread   |   25 spread   |   0 spread    |
| 2   | First Morning  | **55** spread  | **45** spread |   40 spread   |   15 spread   |
| 3   | Accommodation  |   45 spread    | **85** spread |   35 spread   |   10 spread   |
| 4   | Pace           | **65** spread  |   20 spread   | **30** spread |   0 spread    |
| 5   | Culture        |   20 spread    |   40 spread   | **75** spread |   15 spread   |
| 6   | Social Style   |   30 spread    |   20 spread   |   30 spread   | **90** spread |
| 7   | Food           | **35** spread  | **50** spread | **45** spread |   5 spread    |
| 8   | Risk & Comfort | **70** spread  | **65** spread | **60** spread |   15 spread   |
| 9   | Packing        | **80** spread  | **45** spread |   20 spread   |   10 spread   |
| 10  | Memories       |   20 spread    | **65** spread | **40** spread |   25 spread   |
| 11  | Detours        | **85** spread  |   40 spread   | **40** spread |   15 spread   |
| 12  | Homecoming     | **60** spread  |   25 spread   |   25 spread   |   30 spread   |

> **Spread** = difference between the lowest and highest option score for that dimension within a question. Higher spread = stronger differentiating power.

### Coverage Balance

| Dimension      | # of Strong-Signal Questions (spread ≥ 50) |
| -------------- | :----------------------------------------: |
| d1 (Structure) |                     6                      |
| d2 (Comfort)   |                     4                      |
| d3 (Focus)     |                     4                      |
| d4 (Social)    |                     1                      |

> **Note on d4:** The Social axis has only one high-spread question (#6), but it's supplemented by moderate signals across several others. This is intentional — in the research literature, the planner-vs-spontaneous and comfort dimensions are more behaviorally distinctive than social preference, which tends to be more situational (people travel solo sometimes and in groups other times).

---

## 6. Result Presentation

After scoring, the user sees:

1. **Archetype Name & Icon** — the closest-match archetype
2. **Tagline** — a one-line personality summary in the archetype's "voice"
3. **Description** — a 3–4 sentence narrative explaining the type
4. **Trait Cards** — four quick-read attributes:
   - _Travel Style_ — one-phrase summary
   - _Vibe_ — emotional tone
   - _Superpower_ — the type's natural strength
   - _Blind Spot_ — a common weakness to watch for
5. **Travel DNA Bars** — visual representation of the user's 4-dimension scores, showing exactly where they fall on each axis
6. **Destination Recommendations** — 4 destinations curated for the archetype

---

## 7. Academic & Industry Sources

The quiz design draws from these frameworks:

| Source                   | Framework                                                                                  | Influence on This Quiz                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| **Plog (1974, 2001)**    | Allocentric–Psychocentric continuum                                                        | d1 (Structure): allocentrics are spontaneous, psychocentrics are planners                       |
| **Cohen (1972)**         | Drifter / Explorer / Individual Mass / Organized Mass Tourist                              | d1 + d3: drifters are spontaneous + immersive; organized mass tourists are planned + highlights |
| **Big Five / Truity**    | Openness, Conscientiousness, Extraversion, Agreeableness, Neuroticism adapted for travel   | d2 (Comfort ≈ Openness) and d4 (Social ≈ Extraversion)                                          |
| **16Personalities**      | MBTI travel type mapping                                                                   | Dimensional approach to categorical results                                                     |
| **JobCannon (2026)**     | 6 travel archetypes: Wanderer, Planner, Cultural Diver, Adventurer, Resort Lounger, Foodie | Archetype naming and scenario-based question design                                             |
| **Baboo Travel**         | 6 personalities based on 30 years of scientific research                                   | Explorer/Adventurer/Globetrotter taxonomy                                                       |
| **Happiness on the Way** | 7 soulful traveler types                                                                   | The Soulful Soloist and Slow Immersionist archetypes                                            |

---

## 8. Limitations & Design Notes

- **Self-report bias:** Like all personality quizzes, results depend on honest self-assessment. Users may answer aspirationally rather than accurately.
- **Situational variation:** Most people shift between archetypes depending on trip context (solo vs. family vs. work trip). The quiz captures the _dominant default_.
- **12 archetypes, not 16:** With 4 binary axes, a full combinatorial model would yield 16 types. The 12 archetypes were chosen to represent the most behaviorally coherent and recognizable clusters, dropping the 4 least distinct combinations.
- **Cultural bias:** The quiz is designed in English with Western travel norms as the implicit baseline. Destination recommendations and scenario framing may resonate differently across cultures.
- **No clinical validity:** This is an entertainment and self-discovery tool, not a psychometric instrument. It should not be used for hiring, clinical assessment, or research without validation.
