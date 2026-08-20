# Hyper-Personalized Trip Planning — System Design

Design doc for preference-based itinerary generation on top of Google Places data.
Working example: user likes outdoors + cafes, is vegetarian, travelling to Japan for 3 days.

**Status (2026-08-20):** design settled, not yet built. The pipeline runs **inside
this repo** as Next.js route handlers against a **Neon** Postgres database. See
[Where This Runs](#where-this-runs) before writing any code — several claims in
earlier drafts of this doc assumed an Argo backend that does not exist here.

---

# The Whole Flow in Plain Text

**Step 1 — Capture preferences.** When the user creates a trip, we ask a few
structured questions: interests (outdoors, cafes, temples), dietary needs
(vegetarian), pace (relaxed, balanced, or packed), and budget. This becomes the
preference profile. Dietary needs are treated as absolute rules; interests are soft
preferences that influence ranking.

**Step 2 — Translate preferences into searches.** A fixed mapping table turns each
interest into a set of Google place types plus text searches. For example, "cafes"
becomes the place types cafe and coffee_shop, plus text searches like "specialty
coffee in Kyoto". This guarantees we query Google in a way that reflects what the
user actually asked for.

**Step 3 — Retrieve candidates from Google, cache-first.** Before spending a single
billed call we check our own cache: a search whose `(city, query, type)` hash we've
seen recently replays stored `place_id`s instead of hitting Google. Only the misses
go out. Uncached, a city the size of Tokyo costs roughly fifty Enterprise-tier
requests, so this check is the difference between a demo that costs cents and one
that costs real money. Each candidate carries everything needed later: types,
rating, review count, price level, opening hours, and a rough visit duration.

**Step 4 — Apply hard filters.** We remove anything that would be a real failure:
permanently closed places, restaurants that can't serve the user's diet, places
wildly outside budget. A vegetarian must never be shown a steakhouse — enforced
here, in code, never left to the AI. If a filter empties a bucket entirely, we
relax it by a documented ladder rather than failing the day (see
[Degradation Ladders](#degradation-ladders)).

**Step 5 — Score every remaining place in code.** Each place gets a numeric score
combining how well its types match the user's interests, a quality-adjusted rating
(a 4.6 with thousands of reviews beats a 5.0 with four), and price fit. Every score
also records the reasons behind it ("matches cafes", "4.8 stars, 2,100 reviews"),
which later power the "why this place" explanations.

**Step 6 — Narrow the pool, and cluster it, before any AI is involved.** For a huge
city we first score whole neighborhoods (does this area serve the user's interests
and offer variety?), keep the top ~20 places per neighborhood, then keep the top ~60
overall with quotas so the shortlist isn't all restaurants. **The geographic
clustering happens here, not later** — the AI needs to see candidates already grouped
by neighborhood in order to assign one cluster per day. The AI never sees the
thousand raw places, only a shortlist of about 60. Nothing in this narrowing is
random; every cut is scored and logged.

**Step 7 — Enrich the shortlist with AI, once, cached.** Google's structured data
can't tell us a cafe is cozy or a restaurant has vegetarian options — and its
editorial summary is missing on most places, so we don't fetch it at all. Instead we
run a one-time AI pass over the place's name, types and review snippets, producing a
short description plus structured tags (vegetarian-friendly, outdoor seating, good at
sunset), an estimated visit-duration range, and signature dishes. The AI description
is better than Google's anyway: written for our audience and present for every place,
not just the famous ones. Cached per place for ~90 days — paid for once, reused for
every future user.

**Step 8 — AI assigns places to day slots (Pass B).** The AI receives the ~60
candidates grouped by neighborhood, each with its score, tags, estimated duration,
and a coarse open-window hint, plus each day's **time budget in minutes**. It picks
which place fills which slot on which day and writes a short "why" for each pick. It
may also name a few "flex" picks per day — bonus places it liked but couldn't fit. It
can only choose from the candidate IDs we gave it, so it cannot invent places.

**Step 9 — Code builds the actual timeline.** The scheduler takes the AI's
assignments and stamps real times. Meals are anchored to normal meal hours.
Activities are sized using the visit-duration estimate (each place has a minimum,
preferred, and maximum duration). Travel legs between stops are computed from
Google's travel-time data and inserted as their own segments — walk if close,
transit otherwise. If a day overflows its 9am–9pm budget, code shrinks durations,
drops flex picks, or swaps in the next-best scored candidates; if there's spare
time, it stretches durations or promotes a flex pick. Faster pace means more slots
per day, shorter stays, and tighter buffers. The AI never does time math.

**Step 10 — Validate the day.** Code checks every day before accepting it: each
place is open during its assigned slot, meal slots contain restaurants, travel times
are realistic, no day is overloaded. Failures are repaired by swapping in alternates
from the ranked list — not by asking the AI to try again.

**Step 11 — AI writes the per-stop content (Pass C).** Once the timeline is fixed,
one small AI call per stop writes the human layer: why this place suits this user,
what to order (meal slots only, choosing strictly from the real signature dishes we
supplied), the highlights to look for, and practical tips. Each call also receives
the neighboring stops, so it can write connective tissue like "a six-minute walk
from your morning temple". These calls run in parallel; if one fails, we fall back to the cached
enrichment description plus the stop's match reasons and still ship the trip.

**Step 12 — Assemble, resolve photos, deliver.** The final itinerary is an ordered
list of timed segments — travel legs and activities — each activity carrying its
content. **This is the only point at which we fetch photos.** Retrieval stored photo
resource names, which are free; turning one into an image bills the separate Places
Photos SKU, so we resolve them for the ~15 stops that survived rather than the ~1,000
that didn't. Then it's saved, the user is notified through the job queue and loading
screen, and the itinerary page shows each stop with its "why this place" reasoning.

**Step 13 — Learn from what the user does next.** *Deferred past v1* — see
[The Learning Loop](#stage-6--the-learning-loop-deferred) for why naive
save/remove counting makes results worse, not better.

---

# Where This Runs

The earlier draft of this doc described a seam into an Argo backend
(`createItineraryRouted` → worker → `itinerary-planning` queue). **That backend is
not in this repository.** `src/app` contains no route handlers; every call in
`src/lib/api/**` targets `NEXT_PUBLIC_API_URL`, and `AGENTS.md` records that both
data layers were copied verbatim and left unwired.

Decision: **build the pipeline here**, as Next.js route handlers, against Neon.

| Concern | Choice |
|---|---|
| Database | **Neon** serverless Postgres (`@neondatabase/serverless` + Drizzle) |
| Pipeline entry | `POST /api/plan` → writes a `jobs` row → runs stages |
| Progress | Job row polled from the client; **no realtime** |
| Auth | Still none. `user_id` columns are nullable text, unused in v1 |

## Why Neon, and what it costs us

Supabase project quota is exhausted, so a second Supabase project isn't available.
Neon fits for three reasons beyond that:

1. **It's plain Postgres.** Everything in the schema below is standard DDL. No
   Supabase-specific RLS, storage, or auth to model — and auth is already gone.
2. **The serverless driver works in route handlers.** HTTP-based querying means no
   connection-pool management in a serverless function.
3. **Drizzle collapses the three-way column sync** described below into one source
   of truth. That's a genuine correctness win, not just a quota workaround.

The real cost is **Supabase Realtime**. Five files subscribe to `postgres_changes`:
`useJobsQueue`, `useItineraryRealtime`, `ItineraryJobNotifier`, `usePaginatedContent`,
and the itinerary detail page. Neon has no browser-facing realtime equivalent.

- **`useJobsQueue`** → replace the channel subscription with TanStack Query
  `refetchInterval: 2000` against `GET /api/jobs/:id`. A planning job runs 30–90s;
  polling every two seconds is both sufficient and less code than the channel
  dedup logic the hook currently carries.
- **`useItineraryRealtime`** → this is multi-user collaborative editing. Drop it for
  v1; it is irrelevant to the demo and is the single largest realtime consumer.
- The remaining three are content-feed niceties. Leave them dead against the
  unwired Supabase client; the pages already render empty states.

**We are not migrating the other 47 Supabase import sites.** They render empty
states today and will continue to. Only the itinerary-detail read path and the job
queue get rewired, because those are the two surfaces the pipeline actually feeds.

## Naming decisions (settled)

Two names in the ported code invited exactly the confusion this pipeline can't
afford. Both are now fixed in the tree:

**`preferences` → `options`, and `profile` is a sibling.** `GenerateItineraryParams`
carried a `preferences` object that was really scheduler tuning — `maxK`,
`kmeansInitMethod`, `maxIterations`, `startTime`, `endTime`. Putting the traveller's
dietary needs next to `maxK` under one key would guarantee a misread. The split, now
in `src/lib/api/itineraries.ts` and typed in `src/lib/planner/types.ts`:

```ts
export interface GenerateItineraryParams {
  // ...
  /** Scheduler/clustering knobs. Nothing here describes the traveller. */
  options?: SchedulerOptions
  /** The traveller. Drives retrieval, scoring, assignment and narration. */
  profile?: PreferenceProfile
}
```

The rule, stated once so it survives: **a profile describes the traveller; options
describe the scheduler.** They never merge.

**`buildClusters` → `buildLocalityPins`.** `src/lib/maps/buildClusters.ts` sounded
like the planner's geographic clustering. It isn't — it groups saved entities by the
string `"{region}, {country}"` to draw pins on the home and collections static maps,
and the pin's coordinate is the arithmetic mean of its members. It is now
`src/lib/maps/locality-pins.ts` exporting `buildLocalityPins()` / `LocalityPinResult`,
with a header comment pointing at the planner. The planner's real clustering —
k-means over raw lat/lng, `k = total_days` — lives separately at
`src/lib/planner/cluster.ts`. Do not share code between them.

## Budget: placement deliberately open

`PreferenceProfile.budget` is typed as an optional `1 | 2 | 3 | 4` (Google's
`priceLevel` ordinal). Whether the UI collects it during onboarding or in the
create-itinerary modal is undecided and doesn't need deciding yet — the backend
reads it off the profile either way. What *does* need doing is the fix below,
because the input doesn't currently exist at all.

**We keep both `priceLevel` and `priceRange`, and filter on `priceLevel` only.**
`priceRange` is a currency-denominated money range (`{ startPrice: 1, endPrice:
100000, currency: "VND" }`) — fine to display, useless to compare across cities.
`priceLevel` is the ordinal budget filtering uses.

Google reports price level as a *string*, and the two transports spell it
differently: Maps JS yields `"MODERATE"`, Places REST yields `"PRICE_LEVEL_MODERATE"`.
Neither is the `1–4` a profile carries. `src/lib/maps/price-level.ts` owns the single
conversion both paths call:

```ts
export type PriceLevelOrdinal = 0 | 1 | 2 | 3 | 4   // 0 = free
export function toPriceLevelOrdinal(raw: unknown): PriceLevelOrdinal | undefined
```

It returns `undefined` for `PRICE_LEVEL_UNSPECIFIED` and absent data — "we don't
know" has to stay distinguishable from "it's free", or unpriced places get treated as
budget-friendly and flood a low-budget trip.

`place-search.ts` previously requested `"priceLevel"` in its field mask and then
dropped it in `normalizePlace` — paying the Enterprise SKU for a field it threw away.
Fixed: `PlaceSearchResult.priceLevel` and `PlaceDetailsPayload.priceLevel` now carry
the ordinal, so the browser add-to-day path persists it too.

---

## Mental Model: Recall → Precision → Schedule → Explain

Filtering (tags), ranking (scoring), and scheduling (itinerary) are **separate stages
with different tools**. Do not make one mechanism do everything.

| Stage | Job | Tool |
|---|---|---|
| 1. Profile | Turn "likes outdoors, cafes, vegetarian" into structured data | Onboarding chips + implicit signals |
| 2. Retrieval (recall) | Get 100–300 candidate places from Google | Cache check, then Places Text/Nearby Search per interest bucket |
| 3. Ranking (precision) | Score candidates against the profile | Deterministic weighted scoring |
| 4. Clustering | Group the shortlist into neighborhoods | k-means over lat/lng, `k = total_days` |
| 5. Taste rerank | Handle nuance code can't | LLM, constrained to candidate IDs |
| 6. Scheduling | Fit winners into the day's minute budget | Elastic-slot packer |
| 7. Explanation | "Why this place for you" | Match reasons from stage 3 + Pass C narration |

Note that clustering sits at stage 4, **before** the LLM. An earlier draft put it
after selection, which contradicted the Pass B contract — the LLM is asked to assign
one cluster per day, so it must receive candidates already clustered.

## Stage 1 — Preference Profile (structured, not free text)

Never pass raw text like "likes outdoors" through the system. Normalize — the live
definition is `src/lib/planner/types.ts`:

```ts
interface PreferenceProfile {
  interests: Interest[]          // fixed taxonomy — adding one means adding a bridge row
  dietary: string[]              // HARD constraints, not preferences
  pace: "relaxed" | "balanced" | "packed"
  budget?: 1 | 2 | 3 | 4         // Google priceLevel; UI placement TBD
  typeAffinities?: Record<string, number>  // learned; absent until the loop ships
}
```

Key distinction: **dietary/accessibility needs are hard filters; interests are soft
weights.** A vegetarian shown a steakhouse isn't a low score — it's a system failure.

## Stage 2 — Retrieval: Cache First, Then the Taxonomy Bridge

Static mapping from the interest taxonomy to Google Places types + text queries:

```
outdoors    → types: [park, hiking_area, botanical_garden]
              queries: ["scenic walk in {city}", "viewpoint {city}"]
cafes       → types: [cafe, coffee_shop]
              queries: ["specialty coffee {city}", "kissaten {city}"]
vegetarian  → types: [vegetarian_restaurant, vegan_restaurant]
              queries: ["vegetarian ramen {city}", "shojin ryori {city}"]
```

Why both types AND text queries: Google's `includedTypes` filter is coarse (a great
vegetarian-friendly izakaya is typed `izakaya_restaurant`, not
`vegetarian_restaurant`). Text Search catches the long tail.

### The cache check comes first

Every search is keyed by `sha256(city | query | includedType)` against
`place_search_cache`. A fresh hit replays stored `place_id`s and hydrates them from
our own `locations` table; only misses reach Google. This matters because retrieval
is the most expensive stage in the whole pipeline — see
[Cost & Latency](#cost--latency-measured-not-assumed).

Cache TTL is **30 days**, not 90. Google's Places terms allow caching `place_id`
indefinitely but restrict retention of other content; 30 days keeps us clearly
inside that line while still absorbing the entire hackathon.

### Retrieval cannot reuse `place-search.ts`

`src/lib/maps/place-search.ts` is built on the Maps JS `Place` class — `runPlaceSearch`
takes a live `google.maps.Map` for viewport bias. There is no `google.maps` global in
a route handler. **It stays as the frontend's map-search module, untouched.** The
pipeline gets a new server-side module (`src/lib/planner/retrieval.ts`) that hits the
Places REST API directly. What carries over is the field list and the normalization
shape, not the call:

```ts
const SEARCH_FIELD_MASK = [
  'places.id','places.displayName','places.location','places.types','places.primaryType',
  'places.rating','places.userRatingCount','places.priceLevel','places.priceRange',
  'places.regularOpeningHours','places.businessStatus',
  'places.reviews',   // the enrichment pass's only free-text input
  'places.photos',    // resource NAMES only — resolving to an image is a separate SKU
].join(',')
```

Three deliberate choices in that mask:

**No `places.editorialSummary`.** Most places don't have one, so it can't be relied
on, and where it exists it's generic. The enrichment pass writes a better description
from reviews — see [Stage 7](#beyond-google-data-cached-llm-enrichment).

**`places.reviews` becomes load-bearing.** Dropping the editorial summary leaves
reviews as the *only* free-text signal enrichment gets. If this field is missing from
the mask, enrichment silently degrades to guessing from the place name and types.

**`places.photos` returns resource names, not images.** Keep the names; do not
resolve them here — see [Photos](#photos-resolve-late-never-during-retrieval).

Run ~2 queries × N interests, oversample to ~100–300 candidates, dedupe by
`place_id`.

## Stage 3 — Deterministic Scoring

Rank in code first: auditable, debuggable, free.

```
score = w1·affinity + w2·quality + w3·priceFit − w4·duplication
```

- **affinity** — overlap of the place's `types` with the profile's interest buckets
- **quality** — Bayesian-average rating, not raw rating (otherwise a 5.0★ with 4
  reviews beats a 4.6★ with 8,000):
  `quality = (rating × n + C × m) / (n + m)` where C ≈ 50, m ≈ city average
- **priceFit** — distance from `profile.budget` to the place's `priceLevel`
  ordinal. Places with an unknown level score neutral, never zero.
- **Hard filters applied FIRST**: permanently closed, dietary mismatch for meal
  slots, budget way out of range

This stage also emits **match reasons** alongside scores:
`{ placeId, score, reasons: ["matches: cafes", "4.8★ · 2.1k reviews"] }` — the raw
material for the "why this place" UX, persisted on the activity row.

## Stage 4 — LLM Rerank (the taste layer)

Code can't judge that a kissaten fits a "cozy cafe lover" better than a Starbucks
Reserve. Take the top ~60 scored, clustered candidates and give them to an LLM with
their metadata, requesting structured output.

Two non-negotiable guardrails:

1. **The LLM can only return IDs from the candidate list.** Validate every returned
   ID against the candidate set; drop unknowns. Structured output constrains the
   response *shape*, not *membership* — the ID check is still ours to write.
2. **The LLM never does geometry or time math.** It assigns roles
   (breakfast/lunch/morning activity); the scheduler places them.

## Stage 5 — Scheduling: Constraints, Not Vibes

Deterministic, and downstream of clustering rather than responsible for it:

1. Order within a day by time logic: outdoor/major sights in the morning, lunch
   12–14, cafes mid-afternoon, dinner from 18:00
2. **Validate**: opening hours overlap the assigned slot, meal slots are
   restaurants, no duplicate types in a day, travel time between consecutive stops
   is sane (Distance Matrix)
3. Failed validation → swap in the next-best candidate from the same bucket (the
   ranked list from Stage 3 is the fallback queue)

## Stage 6 — The Learning Loop (deferred)

The original plan: record saves, bookmarks, removals and swaps as votes for or
against each place's types, folded into `typeAffinities`.

**Cut from v1.** Naive "increment on save, decrement on remove" over Google types has
a failure mode that makes recommendations actively worse: removals are dominated by
*scheduling* reasons — too far, wrong time, closed that day, already been there —
not taste. A user who deletes a museum because it was shut teaches the system they
hate museums. It's also the least demoable part of the design.

If it ships later, two constraints make it defensible: only count a removal when a
replacement of a *different* type was added in the same session, and weight saves
strictly higher than removes.

---

# Pass Architecture — The LLM Writes Content, Code Owns the Clock

Never let the LLM emit time strings ("9:10am–10:10am"). LLMs are unreliable at
arithmetic and temporal constraint-checking; if the LLM owns times, the day can't be
validated or repaired. The LLM fills **slots**; the scheduler stamps times.

**Pass A — Skeleton (code).** Day template from pace + local meal conventions +
opening hours. Times as minutes-from-midnight integers (trivially validatable):

```ts
const DAY_SKELETON = [
  { role: "morning_activity",   window: [540, 660] },   // 9:00–11:00
  { role: "lunch",              window: [690, 810] },   // 11:30–13:30
  { role: "afternoon_activity", window: [810, 990] },
  { role: "cafe_break",         window: [930, 1020] },  // soft/optional
  { role: "dinner",             window: [1080, 1200] }, // 18:00–20:00
  { role: "evening_activity",   window: [1200, 1260] }, // optional, pace-gated
];
```

**Pass B — Assignment (LLM).** Maps candidate IDs → slot roles per day. IDs only, no
times.

**Pass C — Narration (LLM, parallel + cached prefix).** After the scheduler stamps
every time, one small LLM call per activity generates the content layer:

```ts
interface ActivityContent {
  whyForYou: string;                                       // profile-specific
  highlights: string[];                                    // popular spots in place/area
  foodRecommendations?: { dish: string; note: string }[];  // meal slots only
  tips?: string[];                                         // queueing, booking, photos
}
```

Final timeline assembled by code:

```ts
type TimelineSegment =
  | { kind: "travel"; mode: "walk" | "transit"; startMin: number; endMin: number; fromName: string; toName: string }
  | { kind: "activity"; placeId: string; role: SlotRole; startMin: number; endMin: number; content: ActivityContent };
```

**Travel legs are code-generated**: Distance Matrix / Routes API between consecutive
stops; walk if < ~1.2 km, transit otherwise. If travel pushes a slot past its window
or past closing time → shrink stay to a per-type floor (museum min 45 min) or swap in
the next candidate from Stage 3's ranked list.

## Stay Duration: Resolution Ladder

1. `locations.stay_duration` where present (already consumed by
   `CompactActivityCard.tsx` and `overlap-utils.ts`, so the column earns its keep)
2. Enriched estimate from the cached LLM pass (e.g. kaiseki → 90–120 min)
3. Type heuristic table: cafe 45, temple 45, museum 90, hike 120, shopping street 60…
4. Global default (60 min)

Pace is **not** a rung — it's a multiplier applied to `preferred` after the ladder
resolves (relaxed ×1.2, packed ×0.85), clamped so it never pushes outside
`[min, max]`. See `resolveVisitDuration` in `src/lib/planner/duration.ts`.

## Beyond-Google Data: Cached LLM Enrichment

Structured data is blind to "cozy with good wifi", "vegetarian options", "great at
sunset". Run a **one-time, cached** LLM pass over the shortlist. Input is
`{ name, types, rating, reviewSnippets[5] }` — deliberately *not* Google's
`editorialSummary`, which is absent on most places and generic where present:

```ts
// Cached per place_id — profile-agnostic, pay once, TTL ~90 days
interface PlaceEnrichment {
  description: string;                   // 1–2 sentences. Replaces editorialSummary.
  tags: string[];                        // ["vegetarian-friendly", "outdoor-seating"]
  confidence: number;
  avgVisitMinutes: [number, number];
  signatureDishes?: string[];            // feeds foodRecommendations
  bestTimeOfDay?: "morning" | "midday" | "sunset" | "evening";
  crowdProfile?: "quiet" | "moderate" | "packed";
}
```

`description` is what makes dropping the editorial summary a net win rather than a
loss: it exists for every enriched place, and it's grounded in what reviewers
actually say. It is also the Pass C fallback — so if it's empty, a narration failure
degrades to a bare name and time. Treat an empty `description` as an enrichment
failure and retry it, not as an acceptable result.

`confidence` should reflect how much text the pass actually had. A place with two
reviews and no types deserves a low score, and the funnel can prefer better-evidenced
candidates when scores are otherwise tied.

The profile-specific layer (`whyForYou`, which dish *this* user should order) is not
cached in v1 — profile-specific, low hit rate, not worth the complexity until repeat
usage patterns prove otherwise.

**"Explore {area}" blocks**: separate cache keyed by area name — a mini-guide
("Arashiyama: bamboo grove early, Tenryū-ji, riverside path"). Rule: listed "popular
spots" are cross-checked against the candidate pool where possible; unverifiable
items are phrased as area knowledge, not specific named venues.

## Photos: resolve late, never during retrieval

Google splits photos into two billable acts, and only the second one costs:

1. **Getting the photo's resource name** (`places/ABC/photos/XYZ`) is part of the
   `places.photos` field mask — already paid for by the search request.
2. **Turning that name into an image** (`GET /v1/{name}/media?maxWidthPx=...`) bills
   the separate **Places Photos SKU**, per fetch.

So retrieval stores names for every candidate it sees, and **nothing resolves media
until Step 12**, once the itinerary is final. Resolving eagerly would mean paying for
images of roughly a thousand places to display fifteen.

```ts
// during retrieval — free, part of the search response
photo_names: ["places/ChIJ.../photos/AeJb..."]

// at Step 12 only, for stops that survived
photo_urls: ["https://places.googleapis.com/v1/places/.../media?..."]
```

`photos_resolved_at` distinguishes "we have names but never fetched media" from "this
place genuinely has no photos" — without it, a re-plan can't tell whether to try.

Two notes on the existing browser path, which is **not** wasteful and doesn't need
changing. `place-search.ts` calls `p.getURI()` on up to three photos per result,
but `getURI()` only constructs a URL locally — the SKU bills when the browser
actually *fetches* it, which is why `trackPlacePhoto()` fires on image render rather
than on URL construction. And Maps JS doesn't expose the photo resource `name` at
all (see the `PlacePhotoMeta` comment), which is another reason the pipeline uses
REST: deferred photo resolution isn't expressible in the browser SDK.

## Degradation Ladders

Every hard rule needs a documented failure path, or a thin city breaks the whole run.

**Dietary filter empties the meal bucket.** Do not fail the day. Descend:
1. Place type matches (`vegetarian_restaurant`, `vegan_restaurant`)
2. Enrichment tags include `vegetarian-friendly`
3. Any restaurant, surfaced with an explicit caveat in `ActivityContent.tips`
   ("limited vegetarian options — call ahead")

Log which rung was used. A trip built on rung 3 should say so, not pretend.

**Budget filter empties a bucket.** Widen by one `priceLevel` step at a time and
record the widening in `match_reasons`.

**A Pass C call fails or times out.** Fall back to the cached
`enrichment.description` plus the stop's `match_reasons`, and render the segment
without `whyForYou`. This is a better fallback than the editorial summary it replaces
— match reasons are profile-specific, so even the degraded card says something about
*this* user. Fan the calls out with `Promise.allSettled`, never `Promise.all` — the
"never fail a whole itinerary over one narration call" rule only holds if the code
actually implements it.

---

# Elastic Slots — Variable Durations & Pacing

Fixed slot windows assume every activity is ~2 hours. Wrong: a temple is 40 min, a
hike is 3 hours. Replace fixed windows with a **time budget + elastic durations**.
A day is 720 minutes (9:00–21:00); each place consumes a variable slice.

```ts
interface VisitDuration {
  min: number;        // floor — below this the visit isn't worth it
  preferred: number;  // default
  max: number;        // relaxed-pace ceiling
}
```

Pace is a **plan-level input** that changes three things:

```ts
const PACE_PLANS = {
  relaxed:  { activitiesPerDay: 2, eveningSlot: false, bufferMin: 25, durationBias: "max" },
  balanced: { activitiesPerDay: 3, eveningSlot: true,  bufferMin: 15, durationBias: "preferred" },
  packed:   { activitiesPerDay: 4, eveningSlot: true,  bufferMin: 10, durationBias: "min" },
};
```

Meals are **semi-fixed anchors** (lunch lands inside 11:30–13:30 regardless);
activities are elastic in the gaps between anchors. Special case: if enrichment says
`avgVisitMinutes > 180` (teamLab, a full hike), the place is promoted to an
**anchor** itself — it owns a block and everything else is filler around it.

**Packing algorithm (runs after Pass B):**

1. Stamp meal anchors into their windows
2. Order the day's assigned places (cluster/route logic)
3. Size each at `durationBias`, compute travel legs via Distance Matrix
4. `total = Σ durations + Σ travel + Σ buffers`, compare to 720:
   - **Over** → shrink durations toward `min` → drop flex candidates → shorten the
     day's lowest-scored activity to its floor → last resort: drop it
   - **Under** → stretch toward `max` → pull in a flex candidate → add a cafe break

The packer returns what it dropped. Do not swallow that list — it's the only way to
answer "why isn't teamLab in my trip?".

---

# Pass B ↔ Pass C JSON Contract

## Pass B request — minutes, not counts

```json
{
  "profile": { "interests": ["outdoors", "cafes"], "dietary": ["vegetarian"], "pace": "balanced" },
  "days": [
    {
      "day": 1,
      "area_cluster": "Arashiyama",
      "capacity": { "activity_minutes": 330, "meals": 2, "flex": 1 }
    }
  ],
  "candidates": [
    {
      "place_id": "ChIJ...",
      "name": "Shoraian Tofu",
      "types": ["restaurant", "vegetarian_restaurant"],
      "rating": 4.7, "user_rating_count": 1200,
      "price_level": 3,
      "enrichment_tags": ["vegetarian-friendly", "scenic", "reservation-needed"],
      "visit_minutes": { "min": 60, "preferred": 90, "max": 120 },
      "open_windows": ["midday", "evening"],
      "area_cluster": "Arashiyama",
      "score": 0.87, "match_reasons": ["matches: vegetarian", "4.7★ · 1.2k reviews"]
    }
  ]
}
```

Two deliberate changes from the first draft:

**`capacity` is denominated in minutes, not slot counts.** The earlier
`{ activities: 3, meals: 2 }` shape could not prevent the failure it was introduced
to prevent — a count doesn't stop the model assigning a 3-hour hike *and* a 2-hour
museum to a relaxed day. Every candidate already carries `visit_minutes.preferred`,
so the model does three-number addition against a stated budget. That is the one
arithmetic LLMs handle acceptably, and the packer still owns the truth.

**`open_windows` is a coarse three-value hint.** The original contract sent no
opening-hours data at all, on the reasoning that hours are geometry-adjacent. But
Pass B assigns places to *time slots*, so without any hours signal it will cheerfully
put a 9am-only temple in an evening slot and the Step 10 validator has to repair it.
`["morning","midday","evening"]` costs about three tokens per candidate and removes
most of the repair loop. It is not a schedule — the LLM still never sees periods,
timestamps, or durations in clock form.

Still deliberately NOT sent: lat/lng, opening-hours periods, photos, addresses. Every
omitted field is hallucination surface removed.

## Pass B response — assignments + flex picks

```json
{
  "days": [
    {
      "day": 1,
      "assignments": [
        { "slot_role": "morning_activity", "place_id": "ChIJ_tenryuji", "why": "..." },
        { "slot_role": "lunch", "place_id": "ChIJ_shoraian", "why": "Tofu kaiseki — vegetarian by design, 5 min from Tenryū-ji" }
      ],
      "flex": [{ "place_id": "ChIJ_kimono_forest", "why": "..." }]
    }
  ]
}
```

`flex` is the LLM's overflow valve: candidates it liked but capacity didn't fit. The
scheduler promotes them only if the budget allows — LLM gets expressive freedom,
code keeps the budget.

## What Pass C receives

Pass C consumes the **scheduled segment** (scheduler output), not Pass B's raw
output:

```json
{
  "place": {
    "place_id": "ChIJ_shoraian",
    "name": "Shoraian Tofu",
    "types": ["restaurant", "vegetarian_restaurant"],
    "rating": 4.7,
    "description": "Tofu kaiseki in a riverside house on the Katsura...",  // from enrichment
    "enrichment": {
      "tags": ["vegetarian-friendly", "scenic", "reservation-needed"],
      "signature_dishes": ["yudofu set", "seasonal tofu course"],
      "crowd_profile": "moderate"
    }
  },
  "schedule": {
    "day": 1, "role": "lunch",
    "start_min": 750, "end_min": 840,
    "previous": { "name": "Tenryū-ji", "travel_mode": "walk", "travel_min": 6 },
    "next": { "name": "Bamboo Grove", "travel_mode": "walk", "travel_min": 12 }
  },
  "profile_slice": { "interests": ["outdoors", "cafes"], "dietary": ["vegetarian"] },
  "output_rules": {
    "food_recommendations": "required",
    "max_highlights": 3,
    "reference_only_provided_names": true
  }
}
```

| Field group | Why Pass C needs it |
|---|---|
| `place.enrichment` | Cached tags/dishes — narration doesn't re-derive what's known |
| `schedule.previous/next` | Lets it write "6-min walk from your morning temple" |
| `schedule.start_min/end_min` | Duration-aware tips without letting it choose times |
| `profile_slice` | Only the 2–3 fields that shape tone — not the whole profile |
| `output_rules` | Meal slots demand `foodRecommendations`; name-restriction repeated per-call |

## Pass C response

```json
{
  "place_id": "ChIJ_shoraian",
  "why_for_you": "Vegetarian isn't a compromise here — tofu kaiseki is the house specialty",
  "food_recommendations": [
    { "dish": "Yudofu set", "note": "Their signature; simmered at the table" }
  ],
  "highlights": ["Riverside tatami room", "Seasonal course changes monthly"],
  "tips": ["Reserve ahead — walk-ins rarely get the river view"]
}
```

Echoing `place_id` back lets parallel responses be correlated safely.

**Decision (locked): narration is always generated for meal slots.**
`signature_dishes` from enrichment is passed as **grounding input** (the LLM must
recommend from the real dish list), which kills food hallucination while keeping
personalized phrasing.

---

# Model & SDK Choices

`@anthropic-ai/sdk` is not yet a dependency — add it. Default model is
`claude-opus-5` throughout; the two passes differ in how they're called, not which
model they use.

**Enrichment (Stage 7) — Batches API.** ~60 independent, latency-tolerant calls that
we intend to cache for 90 days. `client.messages.batches.create` is 50% cheaper and
purpose-built for this. Two things to get right: results come back in **any order**,
so key by `custom_id` (= `place_id`) and never by position; and run it at
`output_config: { effort: "low" }` — tag extraction from a review snippet is not a
reasoning task.

**Pass B — one call, structured output.** Use `client.messages.parse()` with
`zodOutputFormat(AssignmentSchema)`. Schema conformance is enforced at the API layer,
so there's no JSON repair loop to write. The candidate-ID membership check remains
ours.

**Pass C — ~15 parallel calls, cached prefix.** Every call shares the same system
prompt and profile slice and differs only in the per-stop payload. Put a
`cache_control: { type: 'ephemeral' }` breakpoint on the last shared block, with the
per-stop content strictly *after* it. Get this backwards and each of the 15 calls
writes its own cache entry and reads nothing. Current models cache prefixes from 512
tokens, so this pays off even with a modest system prompt.

---

# Cost & Latency (measured, not assumed)

The numbers below are estimates for a cold 3-day Tokyo plan. **Instrument the real
ones before tuning any cap** — a mid-sized city may yield 150 candidates, making
three of the four narrowing stages no-ops.

| Stage | Cold city | Warm city (cache hit) |
|---|---|---|
| Places search | ~50 Enterprise requests | 0 |
| Enrichment | ~60 batch LLM calls | 0 |
| Pass B | 1 call, ~7k tokens | 1 call |
| Pass C | ~15 parallel calls | ~15 parallel calls |
| Photos | ~15 media fetches (Step 12 only) | ~15 |
| Wall clock | 60–120s | 15–30s |

Places Search returns up to ~20 places per **billed request**, so "1,043 candidates"
is roughly fifty billed Enterprise calls — the expensive SKU, which
`src/lib/api/maps.ts` already meters per user per month. This is why Step 3 checks
the cache first, and why the demo plan is:

> **Pre-warm the demo city the night before.** Run retrieval + enrichment for the
> target city into `place_search_cache`, `locations` and `place_enrichments` ahead of
> time. A live demo then hits the warm path: one Pass B call plus fifteen short
> narration calls. Do not discover the cold-start latency on stage.

An earlier draft claimed "marginal cost is the assignment call alone." That is true
of the *second* trip to a city and badly misleading for the first.

---

# Database Schema (Neon)

## The three-way sync this replaces

Worth spelling out, because it's the concrete argument for Drizzle over hand-written
queries. In the ported Supabase code, the set of columns on a `locations` row is
written down in **three separate hand-maintained places**:

1. The `locations(...)` select projection inside `getItineraryDetail()` —
   `src/lib/supabase/queries/home.ts`
2. The realtime hydration column string in `src/hooks/useItineraryRealtime.ts:60` —
   a literal `'stay_duration, rating, user_rating_count, price_range, ...'`
3. The `ActivityLocation` TypeScript type, also in `home.ts`

The type comment in the source even says *"Kept in sync with the `locations(...)`
projection ... and with the realtime hydration."* Add `match_reasons` to only the
first and it arrives on the page load path but is silently `undefined` after any
realtime echo — a bug that reproduces only after an edit, which is the worst kind.

With Drizzle there is one table definition. The row type is
`InferSelectModel<typeof locations>` and the select list is generated from it. Adding
a column is one edit. Dropping realtime removes the second list entirely.

## Schema

```sql
-- ─── Cached Google data ──────────────────────────────────────────────────────

create table locations (
  id                uuid primary key default gen_random_uuid(),
  place_id          text unique not null,
  name              text not null,
  latitude          double precision,
  longitude         double precision,
  types             jsonb not null default '[]',
  primary_type      text,
  rating            real,
  user_rating_count int,
  price_level       int,               -- 0..4 ordinal. The budget-filtering input.
  price_range       jsonb,             -- { startPrice, endPrice, currency }. Display only.
  formatted_address text,
  city              text,
  opening_periods   jsonb,             -- Google regularOpeningHours.periods
  review_snippets   jsonb,             -- up to 5. The enrichment pass's only free text.
  photo_names       jsonb,             -- Google photo RESOURCE NAMES. Free. Always populated.
  photo_urls        jsonb,             -- resolved media URLs. Billed. Filled at Step 12 only.
  photos_resolved_at timestamptz,      -- null = names stored, media never fetched
  business_status   text,
  stay_duration     int,               -- minutes; backfilled from enrichment
  fetched_at        timestamptz not null default now()
);
create index locations_city_idx  on locations (city);
create index locations_types_idx on locations using gin (types);

-- Retrieval cache. 30-day TTL keeps us inside Places content-caching terms.
create table place_search_cache (
  query_hash text primary key,          -- sha256(city | query | includedType)
  place_ids  jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days'
);

-- ─── AI caches ───────────────────────────────────────────────────────────────

create table place_enrichments (
  place_id         text primary key references locations(place_id) on delete cascade,
  description      text not null,       -- replaces Google's editorialSummary
  tags             jsonb not null default '[]',
  confidence       real not null,
  visit_min        int,
  visit_max        int,
  signature_dishes jsonb,
  best_time_of_day text check (best_time_of_day in ('morning','midday','sunset','evening')),
  crowd_profile    text check (crowd_profile in ('quiet','moderate','packed')),
  model            text not null,       -- invalidate by model version, not time
  prompt_version   int  not null,       -- see note below
  source_hash      text not null,       -- sha256 of the exact input payload
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null default now() + interval '90 days'
);
create index place_enrichments_expiry on place_enrichments (expires_at);

create table area_guides (
  area_key   text primary key,          -- lower(trim(area || '|' || city))
  highlights jsonb not null,            -- [{ name, note, place_id? }]
  narrative  text not null,
  model      text not null,
  expires_at timestamptz not null default now() + interval '90 days'
);

-- ─── Itinerary ───────────────────────────────────────────────────────────────

create table itineraries (
  id           uuid primary key default gen_random_uuid(),
  user_id      text,                    -- nullable: auth is removed
  name         text not null,
  city         text not null,
  country      text,
  latitude     double precision,
  longitude    double precision,
  start_date   date not null,
  total_days   int not null,
  profile      jsonb not null,          -- PreferenceProfile as submitted
  funnel_stats jsonb,                   -- replayability; see below
  created_at   timestamptz not null default now()
);

create table itinerary_days (
  id           uuid primary key default gen_random_uuid(),
  itinerary_id uuid not null references itineraries(id) on delete cascade,
  day_index    int  not null,
  date         date not null,
  area_name    text,                    -- the cluster label, e.g. "Arashiyama"
  unique (itinerary_id, day_index)
);

create table itinerary_activities (
  id             uuid primary key default gen_random_uuid(),
  day_id         uuid not null references itinerary_days(id) on delete cascade,
  location_id    uuid references locations(id),
  position       int  not null,
  slot_role      text not null,
  start_min      int  not null,         -- minutes from midnight. Code owns the clock.
  end_min        int  not null,
  score          real,
  match_reasons  jsonb not null default '[]',
  content        jsonb,                 -- ActivityContent from Pass C; null on fallback
  travel_to_next jsonb,                 -- { mode, minutes, meters }
  unique (day_id, position)
);

-- ─── Job queue ───────────────────────────────────────────────────────────────

create table jobs (
  id           uuid primary key default gen_random_uuid(),
  type         text not null default 'itinerary-planning',
  status       text not null default 'queued',
  itinerary_id uuid references itineraries(id) on delete cascade,
  payload      jsonb,
  result       jsonb,
  error        text,
  progress     jsonb,                   -- { percent, label, stage, done, total }
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index jobs_status_idx on jobs (status, created_at);
```

### Notes on the schema

**`start_min` / `end_min` as integers, not timestamps.** This is the "code owns the
clock" rule expressed in the storage layer: minutes-from-midnight are trivially
comparable, trivially validatable, and impossible to timezone-corrupt. The read
handler formats them to `"HH:MM"` strings for the existing card components, which
expect `start_time` / `end_time`.

**`prompt_version` is separate from `model`.** The original design had `model` +
`source_hash` + TTL, which correctly invalidates when Google's data changes or the
model is upgraded — but nothing invalidated when *we* changed the enrichment prompt.
Bump `prompt_version` and misses happen naturally.

**`funnel_stats` on the itinerary row.** `{ retrieved, afterFilters,
afterClusterCap, afterGlobalCap, selected, droppedByPacker }` — every cut is
replayable, and "why wasn't teamLab included?" has an answer.

**Read path for enrichment:** select → hit & fresh & same model & same prompt_version
& same source_hash → use → else enqueue enrichment and **serve a heuristic fallback**
rather than blocking itinerary generation on an LLM call. On successful enrichment,
backfill `locations.stay_duration` where null.

---

# The Candidate Funnel (big-city scale)

Problem: Tokyo-scale retrieval yields 10 clusters × ~100 places = 1,000+ candidates.
**It is never random, and the LLM never sees 1,000 places.** Beyond ~40–60 items,
LLM ranking gets inconsistent (lost-in-the-middle), tokens explode, and picks become
undebuggable. Narrowing happens in deterministic, logged stages:

```
1,043 retrieved (10 clusters × ~100)
  → 612  after hard filters        (closed, dietary violations, off-budget)
  → 200  after per-cluster cap     (top ~20 by Stage 3 score per cluster)
  → 60   after global ranking      (top 60 by score, per-type caps applied)
  → 15 + flex  after Pass B        (LLM assigns to day-slots)
```

1. **Hard filters** — closed, business status, way-off-budget. Free. Dietary is a
   hard filter too, but applied to *meal-slot* candidates only: a diet doesn't ban
   you from a museum with a grill in the lobby. See `hardFilterReason` in `score.ts`.
2. **Per-cluster cap (~20/cluster)** — score everything, keep top N within each
   cluster. Without this, one dense district starves every other neighborhood.
3. **Global cap (~60) with per-type quotas** — max ~40% restaurants, max 3 of the
   same cuisine. Otherwise the "personalized" shortlist is 35 restaurants.
4. **Pass B sees only these 60**, pre-grouped by cluster (~120 tokens each ≈ 7k
   tokens — one comfortable, consistent call).

## Two-level narrowing: neighborhoods first, places second

Mirrors how humans plan big cities ("Day 1 = Asakusa/Ueno" before comparing
individual places):

```
cluster_score = mean(top 5 place scores in cluster)
              + interest_coverage bonus   // does this cluster serve MY interests?
              + variety bonus             // mix of activity + food + cafe?
```

Implemented as `scoreCluster` in `src/lib/planner/funnel.ts`. Both bonuses are small
(0.06 / 0.04) on purpose: interest matching is already priced into every place score
at `WEIGHTS.affinity`, so a large coverage bonus double-counts it and lets a cluster
of mediocre places win on variety alone.

Pass B receives candidates grouped by cluster with cluster summaries; its day
assignments naturally allocate ~one cluster per day. "Outdoors + cafes" user →
park-rich clusters outscore nightlife districts before any LLM call.

## Serendipity slot (revised)

Pure score-maximization creates a filter bubble of the obvious. The fix is **one
wildcard slot per day: the highest-scoring candidate below a review-count
threshold** (say, under 500 reviews) that still matches at least one interest.

The earlier definition — highest-scoring candidate with *zero* type overlap with the
profile — is an anti-objective. For an outdoors-and-cafes vegetarian in Tokyo, "best
thing you have no interest in" resolves to a department store or a Michelin
steakhouse. "Great but not famous" is the surprise people actually want, and it's
still a scored, explainable choice rather than a dice roll.

## Funnel responsibilities

| Cut | Owner | Mechanism |
|---|---|---|
| 1,043 → 612 | Code | Hard filters (dietary = filter, on meal slots) |
| 612 → 200 | Code | Stage 3 score, per-cluster cap |
| 200 → 60 | Code | Global rank + per-type quotas + cluster score ordering |
| 60 → 15+flex | LLM | Pass B: taste, nuance, "why" |
| Timing/packing | Code | Elastic-slot scheduler |

**The LLM's job is to make 15 hard choices, not 1,000 easy ones.** Every easy choice
pushed upstream into code makes the system cheaper, more consistent, and debuggable;
every hard choice left to the LLM is where personalization actually shows.

---

# Module Map

What to build, in dependency order. Pure-function modules first — those are the ones
worth unit tests.

| Module | Responsibility |
|---|---|
| `src/lib/planner/types.ts` | ✅ `PreferenceProfile`, `SchedulerOptions`, taxonomy |
| `src/lib/planner/taxonomy.ts` | Interest → Google types + text queries |
| `src/lib/maps/price-level.ts` | ✅ Shared `toPriceLevelOrdinal` for both transports |
| `src/lib/planner/retrieval.ts` | Cache check → Places REST → normalize (incl. `priceLevel`, photo names) |
| `src/lib/planner/photos.ts` | Resolve photo names → media URLs. Called at Step 12 only |
| `src/lib/planner/score.ts` | `quality`, `affinity`, `priceFit`, `scorePlace`, hard filters |
| `src/lib/planner/cluster.ts` | k-means over lat/lng, `k = total_days` |
| `src/lib/planner/funnel.ts` | Staged narrowing + `FunnelStats` |
| `src/lib/planner/enrich.ts` | `place_enrichments` read-through + Batches writer |
| `src/lib/planner/assign.ts` | Pass B: schema, call, ID validation |
| `src/lib/planner/pack.ts` | Elastic-slot packer → `TimelineSegment[]` |
| `src/lib/planner/narrate.ts` | Pass C: parallel, cached prefix, `allSettled` |
| `src/lib/db/schema.ts` | Drizzle tables — the single source of column truth |
| `src/app/api/plan/route.ts` | Entry: create job, run stages, write progress |
| `src/app/api/jobs/[id]/route.ts` | Poll target for `useJobsQueue` |

Build Stages 1–3 and the packer fully deterministic first; use the LLM only where
it's strong (reranking nuance, writing "why" copy). Testable stage-by-stage, degrades
gracefully, every recommendation explainable.
