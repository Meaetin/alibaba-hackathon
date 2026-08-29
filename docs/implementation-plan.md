# Personalization Pipeline — Test-First Implementation Plan

Companion to [`personalization-pipeline.md`](./personalization-pipeline.md). That doc
says *what* to build; this one says *in what order*, and *what test proves each part
works* before the part exists.

**Status (2026-08-23):** Steps 0–11 complete — the whole deterministic core,
the invariant suite, and Gate A over **two** cities (Kyoto and Singapore) with
the `pack` and `validate` legs wired in. 311 tests green (9 integration tests
skipped without `DATABASE_URL` / S3 config), `type-check` clean. **Gate A is
passed.** Next is Step 12 (`enrich.ts`), the first step that talks to a model.

**Carried into Step 4's column, found by the Singapore fixture:** `clusterPlaces`
is k-means on raw lat/lng and it fails on a dense-core city — two of four
Singapore days come out holding a handful of far nature parks with nothing to
eat, while the whole civic core competes for one cluster's 20 seats. See
`docs/decisions.md`. It is reported (`cluster.shortfall`) rather than silent,
but it is not fixed.

Gate A drives the packer through a deterministic stand-in for Pass B
(`assignDay`), since the real assignment pass is an LLM and Gate A is offline.
Replace that function when Pass B ships; every assertion around it still holds.

---

## How to read a step

Every step below has the same five parts:

| Part | Meaning |
|---|---|
| **Mode** | `TDD` (write failing tests, then implement) or `Lock` (code exists, tests pin it) or `Seam` (I/O adapter — test the boundary, not the service) |
| **Red** | The command that must fail, and the reason it fails |
| **Tests** | The assertions, named so they read as a spec |
| **Green** | What "done" means, in terms a command can check |
| **Verify** | The literal command |

A step is not finished until its Verify command passes *and* every prior step's
still does. Run `npm test` (whole suite) at each gate, not just the new file.

## The three test modes, and why they differ

**`TDD`** — pure functions over plain data. `score`, `cluster`, `funnel`, `pack`,
`taxonomy`, duration resolution, validation. No network, no clock, no randomness.
These are where test-first genuinely pays: the tests are the spec, they run in
milliseconds, and they catch the bugs that matter (a packer that drops the wrong
thing, a filter that lets a steakhouse through).

**`Seam`** — modules whose job is talking to Google or OpenAI. Writing a test
that asserts "the model returns good tags" is theatre; the model is not under our
control and the assertion would be flaky. What *is* ours, and what these tests
cover:

- the request we build (field masks, payload shape, what we deliberately omit)
- the caching decision (did we avoid the billed call?)
- the response handling (ID membership, `custom_id` keying, partial failure)

Every one of those is deterministic against a fake client. Inject the client;
never let a module reach for `fetch` or `new OpenAI()` itself.

**`Lock`** — code already in the tree (`price-level.ts`, `place-search.ts` price
mapping). No red phase available. Tests are characterization: they pin current
behaviour so the next edit can't silently undo it.

## Two API decisions the tests force, decide them now

Both of these are cheap at the start and expensive to retrofit:

1. **Randomness is injected, never ambient.** k-means++ seeding takes an `rng: () => number`
   parameter defaulting to `Math.random`. Without this, `cluster.test.ts` is flaky
   and you will end up deleting the assertion instead of fixing it.
2. **Time is injected, never ambient.** Cache expiry, `fetched_at`, TTL checks all
   take a `now: Date`. Same reason.

Every module that touches Google or OpenAI takes its client as a parameter with a
production default. That is the entire testability strategy; there is no mocking
framework in this plan.

---

# Step 0 — Test harness

**Mode:** setup · **Blocks:** everything

Vitest, not Jest: native ESM + TypeScript with no Babel config, and it reads the
`@/*` path alias straight out of `tsconfig.json` via `vite-tsconfig-paths`. Node's
built-in runner would also work but gives you no watch mode worth having.

```bash
npm i -D vitest @vitest/ui vite-tsconfig-paths
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
```

Scripts: `"test": "vitest run"`, `"test:watch": "vitest"`.

**Red:** `npm test` → `Unknown command: "test"`.
**Green:** a throwaway `src/lib/planner/harness.test.ts` asserting `1 + 1 === 2`
passes, and a deliberate `1 + 1 === 3` fails with a readable diff. Delete it after.
**Verify:** `npm test && npm run type-check`

Convention for the rest of the plan: tests live next to their module
(`src/lib/planner/score.test.ts`), fixtures in `src/lib/planner/__fixtures__/`.

---

# Step 1 — `price-level.ts` + the `place-search` regression

**Mode:** Lock · **Depends on:** 0

The module exists and is correct. The point of this step is the *bug it was written
to fix* — `normalizePlace` requesting `priceLevel` in the field mask and dropping it —
which has no test and will come back.

**Tests** (`src/lib/maps/price-level.test.ts`):
- `"MODERATE"` → `2` (Maps JS spelling)
- `"PRICE_LEVEL_MODERATE"` → `2` (REST spelling)
- `"PRICE_LEVEL_FREE"` → `0`
- `"PRICE_LEVEL_UNSPECIFIED"` → `undefined`
- `undefined`, `null`, `2`, `""`, `"MODERATELY"` → `undefined`
- **`0` and `undefined` are distinguishable** — `toPriceLevelOrdinal('PRICE_LEVEL_FREE') !== toPriceLevelOrdinal(undefined)`, asserted explicitly rather than left implied by the two rows above. This is the whole reason the function returns `undefined` instead of `0`.

**Tests** (`src/lib/maps/place-search.test.ts`) — with one prerequisite:
`normalizePlace` and `SEARCH_FIELDS` are currently **module-private**, and the file
is browser-only (it reads `google.maps.places.Place`). Export both for testing —
that is the smallest change that makes the regression testable; the alternative is
driving `runPlaceSearch` with a fake `google.maps.Map`, which is far more fixture
than the assertion is worth.

- `normalizePlace` on a fake `Place`-shaped object with `priceLevel: 'MODERATE'`
  yields `priceLevel: 2`
- `SEARCH_FIELDS` contains `priceLevel` (guards mask/normalizer drift in the other
  direction — paying for a field nobody reads)
- `toPlaceDetailsPayload` carries `priceLevel` through to the persistence shape, so
  the browser add-to-day path stores it

**Verify:** `npx vitest run src/lib/maps`

---

# Step 2 — `taxonomy.ts`

**Mode:** TDD · **Depends on:** 0

Interest → Google types + text queries. Pure lookup, no logic worth arguing about —
but the exhaustiveness test below is what stops a new interest silently retrieving
nothing.

**Red:** `import { bridgeFor } from './taxonomy'` → module not found.

**Tests** (`src/lib/planner/taxonomy.test.ts`):
- **every `Interest` has a bridge row.** Iterate a `const ALL_INTERESTS: Interest[]`
  array; assert each has ≥1 type and ≥1 query. Give `ALL_INTERESTS` a
  `satisfies readonly Interest[]` annotation so adding a union member without
  adding an array entry is a *compile* error, and the runtime test then catches
  the missing bridge row.
- `"cafes"` → types include `cafe` and `coffee_shop`
- `{city}` is interpolated: `queriesFor('cafes', 'Kyoto')` contains
  `"specialty coffee Kyoto"`, and no returned string still contains `"{city}"`
- dietary bridge: `"vegetarian"` → `vegetarian_restaurant`, `vegan_restaurant`
- two interests sharing a type produce a **deduped** type list (retrieval bills
  per query — duplicates are money)

**Green:** all pass; `type-check` clean.
**Verify:** `npx vitest run src/lib/planner/taxonomy`

---

# Step 3 — `score.ts`

**Mode:** TDD · **Depends on:** 2 · **Highest value in the plan**

Hard filters + the weighted score + match reasons. If one step gets careful tests,
this is it: it is pure, it is where the dietary guarantee lives, and every number
downstream is derived from it.

**Red:** `score.test.ts` imports `scorePlace`, `applyHardFilters` — module not found.

**Tests** (`src/lib/planner/score.test.ts`), grouped as they should be in the file:

*quality (Bayesian)*
- `4.6★ / 8000 reviews` outscores `5.0★ / 4 reviews` — the headline case, written
  as a comparison not a magic number
- a place with `rating: undefined` gets the prior (`C`), not `0`
- quality is monotonic in review count at fixed rating

*affinity*
- a `cafe` scores higher for `interests: ['cafes']` than for `['temples']`
- a place matching two of the user's interests outscores one matching one
- zero overlap → affinity `0`, but total score still finite (it can be rescued by
  quality — this is what makes the serendipity slot possible)

*priceFit*
- **unknown `priceLevel` scores neutral, never `0`** — the doc's explicit rule.
  Assert `priceFit(undefined, 2) === NEUTRAL` and that it sits strictly between
  the exact-match and worst-mismatch values
- exact budget match > one step off > three steps off

*hard filters — the guarantees*
- `businessStatus: 'CLOSED_PERMANENTLY'` is removed
- a `steakhouse` is removed from **meal-slot** candidates for `dietary: ['vegetarian']`
- that same steakhouse is **not** removed from non-meal candidates (dietary applies
  to meals; a diet doesn't ban you from a museum with a grill in the lobby)
- `priceLevel: 4` removed for `budget: 1`; `priceLevel: 2` kept for `budget: 1`
  (one step out is "widen later", not "kill now")
- filters run **before** scoring — assert `applyHardFilters` is called on the raw
  set and `scorePlace` is never handed a filtered-out place, by scoring a list
  containing a permanently-closed place and asserting it is absent from output

*match reasons*
- output shape is `{ placeId, score, reasons: string[] }`
- a vegetarian restaurant matching `cafes` emits both `"matches: cafes"` and a
  rating reason like `"4.8★ · 2.1k reviews"`
- **reasons are never empty** for a place that survived filtering — the "why this
  place" UX has no fallback if they are

**Green:** all pass. Weights live in one exported `WEIGHTS` const so a tuning change
is a one-line diff and the tests above stay written as *comparisons*, not absolutes.
**Verify:** `npx vitest run src/lib/planner/score`

---

# Step 4 — `cluster.ts`

**Mode:** TDD · **Depends on:** 0

k-means over lat/lng, `k = total_days`. Unrelated to `src/lib/maps/locality-pins.ts` —
do not import across.

**Tests** (`src/lib/planner/cluster.test.ts`):
- three tight geographic blobs (Arashiyama / Gion / Fushimi coords) with `k = 3`
  → each blob lands wholly in one cluster. Assert by *grouping*, not by cluster
  index — index order is not stable and asserting on it makes a flaky test.
- **deterministic given a fixed `rng`** — same input + same seed → identical
  assignment across two calls. This is the test that forces `rng` injection.
- `k > candidates.length` → returns `candidates.length` non-empty clusters, does
  not throw, does not emit empty clusters
- `k === 1` → one cluster containing everything
- empty input → `[]`, no throw
- `maxIterations` from `SchedulerOptions` is respected (assert it terminates with a
  low cap rather than spinning)
- each cluster carries a centroid and a label slot the funnel can fill

**Verify:** `npx vitest run src/lib/planner/cluster`

---

# Step 5 — `funnel.ts`

**Mode:** TDD · **Depends on:** 3, 4

Staged narrowing, `FunnelStats`, per-type quotas, the serendipity slot, and the
degradation ladders. The tests here are mostly about *what doesn't happen*.

**Tests** (`src/lib/planner/funnel.test.ts`):

*per-cluster cap*
- 10 clusters × 100 places, cap 20 → exactly 20 from each cluster, and
  **no cluster is starved**: build one cluster with 500 places and assert the other
  nine still contribute 20 each. This is the failure the cap exists to prevent.

*global cap + quotas*
- top 60 overall, and **≤ 40% restaurants** even when the input is 90% restaurants
- ≤ 3 of the same cuisine type
- the cut is by score — assert the highest-scored non-restaurant survives a
  restaurant-heavy input

*FunnelStats*
- `stats.retrieved / afterFilters / afterClusterCap / afterGlobalCap` each equal
  the actual length of the corresponding list. Written as a loop over stages so a
  new stage can't be added without a stat.
- stats are present even when no cut fired (a 40-candidate city — every stage a
  no-op, stats still complete)

*serendipity slot*
- picks the highest-scoring candidate with `userRatingCount < 500` that matches
  **≥ 1 interest**
- a high-scoring 20,000-review place is **not** the serendipity pick
- a low-review place matching **zero** interests is **not** the pick (this is the
  revised definition; the old "zero type overlap" rule would select it)
- no qualifying candidate → returns `undefined`, day is built without one

*degradation ladders*
- dietary rung 1 empty → falls to rung 2 (`vegetarian-friendly` enrichment tag)
- rungs 1 and 2 empty → rung 3 (any restaurant) **and** the returned result carries
  the caveat flag that Pass C turns into a tip. Assert the flag, not just the place.
- budget empties a bucket → widens by exactly **one** `priceLevel` step per
  iteration, and the widening is recorded in `match_reasons`
- **the rung used is returned, at every rung including 1** — a caller must never
  have to infer it

*cluster grouping (Pass B's input — added after the first pass at this step)*
- the shortlist comes back **grouped by cluster** (`result.clusters`), best cluster
  first and best member first within each. Step 13 assigns one cluster per day and
  cannot re-derive membership from a flat list.
- each cluster carries `centroid`, the unfilled `label` slot, and its
  `cluster_score` (`scoreCluster`: mean of top-5 place scores + small coverage and
  variety bonuses)
- a cluster the quotas emptied is **omitted**, never returned empty

*dropped candidates (invariant 8, enforced here rather than at Gate A)*
- every candidate in `stages.retrieved` either survives or appears in
  `result.dropped` with a stage and a reason — asserted as a partition, so a new
  cut can't silently swallow anything
- the reason names the rule (`permanently closed`, `price level 4 is 3 steps over
  budget 1`, `cuisine quota full: 3× ramen_restaurant`), not just the stage
- candidates clustering couldn't place (no lat/lng) are passed in as
  `options.unlocated` so they count as retrieved and get a reason — otherwise they
  vanish between `cluster.ts` and `funnel.ts` and `stats.retrieved` lies

**Verify:** `npx vitest run src/lib/planner/funnel`

---

# Step 6 — duration resolution + pace

**Mode:** TDD · **Depends on:** 0 · Small, but `pack` is untestable without it

`resolveVisitDuration(place, enrichment, pace) → VisitDuration`.

**Tests** (`src/lib/planner/duration.test.ts`):
- ladder order, one test per rung, each proving the rung **above** it wins when
  both are present: `stay_duration` beats enrichment; enrichment beats the type
  heuristic; the heuristic beats the global default
- type heuristics: cafe 45, temple 45, museum 90, hike 120
- pace multipliers: relaxed ×1.2, packed ×0.85, balanced ×1.0
- multiplier applies to `preferred` but **never pushes below `min` or above `max`**
- unknown type with no enrichment → a sane default, not `0` and not `NaN`

**Verify:** `npx vitest run src/lib/planner/duration`

---

# Step 7 — `pack.ts` (elastic-slot scheduler)

**Mode:** TDD · **Depends on:** 6 · **Second-highest value in the plan**

Code owns the clock; this is where that rule is either true or isn't. Travel times
come from an **injected** provider (`getTravelLeg(from, to) => { mode, minutes, meters }`)
so tests use a fake matrix and never touch the Routes API.

**Tests** (`src/lib/planner/pack.test.ts`):

*structure*
- output is a contiguous `TimelineSegment[]`: `segments[i].endMin === segments[i+1].startMin`
  (no gaps, no overlaps) — one assertion run over every generated day
- every `activity` segment's `placeId` was in the input assignment set
- a `travel` segment sits between every pair of consecutive activities, and never
  first or last in a day

*anchors*
- lunch lands inside `[690, 810]` regardless of what precedes it
- dinner lands inside `[1080, 1200]`
- a place with `avgVisitMinutes` > 180 is promoted to an **anchor** and everything
  else fills around it

*travel mode*
- < 1.2 km → `walk`; ≥ 1.2 km → `transit`; assert the boundary at exactly 1.2 km
  and state which side it belongs to

*over budget — the degradation ORDER is the test*
- given a day 200 minutes over: durations shrink toward `min` **first**, and flex
  picks are still present
- given a day still over after shrinking: flex picks dropped **next**, real
  assignments untouched
- still over: the **lowest-scored** activity is floored, and only then dropped —
  assert the highest-scored activity survives a day that has to drop something.
  Four separate tests, because "it fits" passing while the order is wrong is
  exactly the bug that produces "why isn't teamLab in my trip?"

*under budget*
- stretch toward `max` first, then promote a flex pick, then add a cafe break

*the dropped list*
- **`result.dropped` is non-empty whenever something was dropped**, and names each
  place with a reason. A packer that silently swallows this passes every other
  test in this file.

*pace*
- `packed` produces more activity segments per day than `relaxed` on identical input
- `relaxed` has `eveningSlot: false` → no segment starts after 20:00
- buffers: 25 / 15 / 10 min appear between activities per pace

**Verify:** `npx vitest run src/lib/planner/pack`

---

# Step 8 — validate + repair

**Mode:** TDD · **Depends on:** 7 · **Done.**

Step 10 of the design. Repairs come from the ranked list, never from the LLM.

`validateDay(input, deps)` packs, inspects, swaps, and packs again — a repair
changes the day's shape, so it cannot be applied to a finished timeline in
place. Three rules, and a three-rung ladder:

1. swap in the next-best candidate **from the same bucket** (a restaurant may
   hold a meal slot, never a plain activity)
2. nothing fits and it isn't a meal → **drop it**, with the reason, into the
   same `dropped` list the packer uses
3. nothing fits and it **is** a meal → validation failure; lunch is not
   something to quietly delete

**Two departures from this section as originally written**, both recorded in
`docs/decisions.md`:

- *"travel time that overruns the window"* is not directly observable — `pack.ts`
  cannot return an overrunning day, it shrinks and then drops until the day fits.
  So the rule is `lost_meal`: the packer surrenders meals last, so a day that
  lost one is a day travel ate whole. A dropped **activity** is pace working as
  designed and is not a failure.
- rung 2 (drop) was added after the Gate A leg showed the alternative: with
  swap-or-fail only, 3 of 10 day-runs returned `ok: false` because the only
  thing open at 20:15 is always a restaurant. The plan's "no candidate → failure"
  case survives for meals, which is where it matters.

**Tests** (`src/lib/planner/validate.test.ts`, 27):
- a place closed during its assigned slot → swapped for the next-best candidate
  from the same bucket; the returned day is then valid
- a meal slot holding a non-restaurant → repaired, and never with a dietary
  violation
- travel that costs the day a meal → repaired by swapping in a reachable one
- **repair never calls the LLM** — a fake assign client with zero calls, on the
  repair path, the drop path and the failure path. Direct assertion of the doc's
  "not by asking the AI to try again" rule.
- no candidates left → a dropped activity, or a validation failure with a reason
  for a meal; never an invalid day, never a throw
- a valid day passes through **byte-identical**, carrying the caller's own input
  object by reference

The suite is mutation-checked: killing any of the three rules, the same-bucket
filter, the drop rung, the meal exemption or the drop record fails at least one
test. Re-run that check after touching this module — five of the assertions in
here were vacuous on first writing and only the mutation pass found them.

**Verify:** `npx vitest run src/lib/planner/validate`

---

## Gate A — deterministic core complete

Everything above is pure and offline. Before touching Google, OpenAI, or Neon:

```bash
npm test && npm run type-check
```

At this gate you can already build a plausible itinerary from a hand-written
candidate fixture with no API keys and no database. **Done, ahead of the gate** —
`src/lib/planner/__fixtures__/kyoto-candidates.json` (86 Kyoto places, including
two permanently closed, two with no coordinates, a ¥¥¥¥ kaiseki, a steakhouse,
several near-identical ramen shops and a museum with no rating) runs through
cluster → funnel → meal ladder → duration → pack → validate in
`__tests__/gate-a.test.ts`, judged by the invariant suite and snapshotted.

The fixture now carries opening hours, assigned by type the way Google reports
them, with ungated public space (parks, the bamboo grove, Fushimi Inari's shrine
path, Togetsukyo Bridge) deliberately left without any — `assumed` is how the
validator says which stops it could only take on trust.

It paid for itself immediately: it caught a symmetric `priceFit` that ranked a
¥¥ ramen shop above a ¥ Kiyomizu-dera for a ¥¥ traveller. Every unit test passed
that bug straight through, because each one was individually correct.

---

# Step 9 — Drizzle schema + `src/lib/db`

**Mode:** Seam · **Depends on:** 0

**Done (2026-08-23)** — `src/lib/db/{schema,client,stores,time}.ts`, one
generated migration in `drizzle/`, and `drizzle.config.ts`. `schema.ts` holds all
eight tables with **snake_case TS property names**, matching both the column
names and the ported `ActivityLocation` type, so a row reaches a card component
without a rename layer that would be its own three-way sync.

`stores.ts` fills the two ports Step 10 declared — `createSearchCache` and
`createLocationStore` — with no call-site changes. `getMany` returns rows in the
order asked for, and `upsertMany` returns the merged stored rows so later stages
see preserved enrichment/photo state rather than the pre-upsert network object.
`stay_duration`, hydrated reviews and resolved photos all survive a refetch. The
photo state used to be conditioned on `photo_names` being unchanged; that was
wrong, because Google mints a fresh resource name for every photo on every
search — see "A Google photo resource name is a per-response token" in
`AGENTS.md`. Photo and review writes use narrow patch methods so they cannot
overwrite fresher retrieval data.

Expiry is not enforced in the store. `retrievePlaces` compares `expiresAt`
against an injected `now`, and a store that also filtered would put a second,
ambient clock in the path.

Scripts: `npm run db:generate` (offline), `db:migrate`, `db:push`, `db:studio` —
the last three load `.env.local` for `DATABASE_URL`.

```bash
npm i drizzle-orm @neondatabase/serverless && npm i -D drizzle-kit
```

**Tests** (`src/lib/db/schema.test.ts`) — cheap and worth it:
- `InferSelectModel<typeof locations>` includes `price_level`, `photo_names`,
  `photos_resolved_at`, `review_snippets`, `stay_duration`. A `satisfies` /
  `expectTypeOf` check that fails at compile time when a column is dropped.
- `itinerary_activities` exposes `start_min` / `end_min` as `number`, not `Date` —
  the "code owns the clock" rule at the storage layer
- `formatMinutes(750) === '12:30'`, `formatMinutes(0) === '00:00'`,
  `formatMinutes(1439) === '23:59'` — the read handler's conversion for the existing
  card components, which want `start_time` / `end_time` strings

**Integration** (`src/lib/db/schema.integration.test.ts`), skipped unless
`DATABASE_URL` is set — `describe.skipIf(!process.env.DATABASE_URL)`:
- migrations apply cleanly to an empty Neon branch
- insert → select round-trips a full `locations` row including the jsonb columns
- `place_search_cache.expires_at` defaults to +30 days

Do not block on the integration tests. They are a nightly/pre-demo check, not a
per-commit gate.

**Verify:** `npm run test:db` — loads `DATABASE_URL` from `.env.local` and runs
both the unit and the integration files. Schema changes go out with
`npm run db:generate && npm run db:migrate`; the committed migration in
`drizzle/` is the source of truth, so prefer it over `drizzle-kit push`.

**Applied (2026-08-23)** to Neon project `hackathon` (`curly-union-42502230`),
branch `production`. All 13 tests green against the live database — the jsonb
round trip, the coalesce guard, and the +30-day default included.

---

# Step 10 — `retrieval.ts`

**Mode:** Seam · **Depends on:** 2, 9 · **The cost-control step**

`fetch` is injected. Every test in this file runs with zero network.

**Done (2026-08-22)** — `src/lib/planner/retrieval.ts` + `retrieval.test.ts`, 38
tests. It did **not** wait for Step 9: the cache and the `locations` table are
injected as two ports, `SearchCache` and `LocationStore`, with in-memory
implementations (`createInMemorySearchCache` / `createInMemoryLocationStore`)
used by the tests and the offline path. Step 9's job shrinks to writing
Drizzle-backed implementations of those two interfaces — no call site changes.

`buildSearchPlan(profile, city)` applies the taxonomy bridge and dedupes by
cache key, so the plan is the unit of billing. The cache key includes page size,
and a fresh entry is a hit only if every referenced location row exists. Search
cache entries publish after their location rows persist, never before.
`RetrievalStats` counts every way
a candidate can be lost (`failures`, `missingFromStore`, `duplicatesDropped`) —
same rule as the funnel: a cut that only shrinks a list is a silent bug.

**Tests** (`src/lib/planner/retrieval.test.ts`):

*caching — this is where the money is*
- **a fresh cache hit issues zero fetch calls.** `expect(fakeFetch).toHaveBeenCalledTimes(0)`.
  The single most valuable assertion in the file.
- the cache key is `sha256(city | query | includedType | pageSize)` and is stable across calls
  and insensitive to nothing else (change city → different key; change nothing →
  same key)
- an entry past `expires_at` is a miss and refetches (uses the injected `now`)
- a fresh entry whose location rows are incomplete is also a miss and self-heals
- location persistence completes before the search-cache entry is published
- partial hits: 3 of 5 queries cached → exactly 2 fetches, and the result set is
  the union of both paths

*the field mask*
- the bulk Text Search mask excludes every field in `SHORTLIST_FIELD_MASK`,
  keeping those calls at Enterprise rather than Enterprise + Atmosphere
- `hydrateShortlist(pool, shortlistIds, deps)` requests the whole Atmosphere set
  — reviews, `editorialSummary`, `reviewSummary`, `servesVegetarianFood` —
  through one Place Details call per shortlisted place, because the SKU is
  priced per request and reviews alone already pays it
- `shortlistHydratedAt` is the "we asked" marker: stamped when the answer is
  known (including "Google said nothing"), left null when the fetch **failed**
- the mask contains `places.photos` and `places.priceLevel`
- the bulk mask does **not** contain `places.editorialSummary`

*normalization*
- `priceLevel: 'PRICE_LEVEL_MODERATE'` → `2` via `toPriceLevelOrdinal` (shared, not
  a second copy)
- photo **resource names** are stored; `photo_urls` is null and `photos_resolved_at`
  is null after retrieval
- **no request is made to any `/media` endpoint during retrieval** — assert against
  the fake fetch's recorded URLs. The billing rule, as a test.
- shortlist hydration stores up to 5 review snippets; a place with no reviews
  stores `[]`, while an unhydrated candidate remains null
- `businessStatus`, `regularOpeningHours.periods`, `priceRange` all survive

*dedupe*
- the same `place_id` returned by two different queries appears once in the output
- oversampling to 100–300 candidates across N interests works without duplicate
  billed calls for identical (city, query, type) triples inside one run

**Verify:** `npx vitest run src/lib/planner/retrieval`

---

# Step 11 — `photos.ts`

**Mode:** Seam · **Depends on:** 10

**Done (2026-08-23)** — `src/lib/planner/photos.ts` + `photos.test.ts`, 18 tests.
`resolvePhotos(pool, survivorIds, deps)` takes the pool and the survivor list as
two arguments precisely so the expensive mistake — handing it everything
retrieval found — isn't expressible in the signature. Writes back through
retrieval's `LocationStore` port, so Step 9 still has exactly two interfaces to
implement.

`FetchLike` and the bounded-concurrency fan-out moved to `src/lib/planner/http.ts`
(3 tests) rather than being copied into a second Seam module. `retrieval.ts`
re-exports `FetchLike`, so its public surface is unchanged.

Build the survivor list with `survivorIdsFromDays(days)` — the packed timeline's
`activity` segments — not by hand.

**`PhotoBlobStore` implemented (2026-08-23)** — `src/lib/planner/photo-blobs.ts`
+ `photo-blobs.test.ts`, 11 tests, plus 2 composition tests in `photos.test.ts`.
S3-compatible rather than vendor-specific, so R2, Neon Object Storage, Supabase
Storage and AWS S3 are all the same code and the backend is an env decision
(`s3ConfigFromEnv`, `PHOTO_BLOB_*`). Neon Object Storage is the eventual home —
it branches with the database — but it is public beta and `us-east-2` only while
this project's database is in `ap-southeast-1`.

Two layers: `ObjectStore` is the bucket, `createPhotoBlobStore` is the
lookup → download → upload flow, so the part with logic tests against a Map with
zero network. Still optional — unset the env and the pipeline stores Google's
expiring `photoUri` exactly as before.

**Verify:** `npm run test:blobs` — runs the offline flow tests plus, when
`PHOTO_BLOB_*` is set, `photo-blobs.integration.test.ts` against the real bucket.

**Applied (2026-08-23)** to a Cloudflare R2 bucket, 15/15 green. The integration
file covers the one seam the offline tests can't reach: HeadObject's 404 shape,
path-style addressing, and whether the bucket is genuinely served publicly — if
it isn't, every card 403s and nothing in the pipeline notices.

**Tests** (`src/lib/planner/photos.test.ts`):
- resolving 15 stops issues exactly 15 media fetches, not 1,000 — pass a candidate
  pool of 1,000 and a survivor list of 15 and assert the count
- `photos_resolved_at` is stamped on success
- a place with `photo_names: []` is skipped entirely (zero fetches) and is
  distinguishable afterwards from one never attempted: `photo_names` empty +
  `photos_resolved_at` set vs. `photos_resolved_at` null
- a failed media fetch does not fail the itinerary — the stop ships without a photo

**Verify:** `npx vitest run src/lib/planner/photos`

---

# Step 12 — `enrich.ts` (Batches)

**Carried over — validate `avgVisitMinutes` before it reaches the packer.**
`resolveVisitDuration` (Step 6) trusts rung 2 completely: `[0, 0]` yields a
zero-minute activity and a reversed `[120, 30]` yields `preferred < min`, both of
which the packer's elastic slots take at face value. Clamp on the way out of
enrichment — a model-authored range is untrusted input, not a constant.

**Mode:** Seam · **Depends on:** 9, 10

```bash
npm i openai
```

Client injected. No test in this file asserts anything about tag *quality*.

**Tests** (`src/lib/planner/enrich.test.ts`):
- read-through cache: hit requires **all four** of fresh `expires_at`, same `model`,
  same `prompt_version`, same `source_hash`. Four tests, each flipping one field and
  asserting a miss — a cache that ignores `prompt_version` is the doc's named bug.
- an empty `description` is treated as a **failure and retried**, not stored
- a miss serves the heuristic fallback **without blocking** — assert
  `generateItinerary` completes with an unenriched place present
- a miss is fetched live by `enrichPlaces` inside the enrich stage, stored, and
  used by the same plan that paid for it. The OpenAI Batch path this step
  originally described was removed on 2026-08-26 — see `docs/decisions.md`.
- on success, `locations.stay_duration` is backfilled where null, and **not**
  overwritten where already set
- `effort: 'none'` is on the request (cost, and it's the kind of thing that silently
  regresses). An earlier draft of this line said `'low'`; the design doc's
  "run it at `reasoning: { effort: "none" }`" is the settled answer, and tag
  extraction has no reasoning to buy.

**Verify:** `npx vitest run src/lib/planner/enrich src/lib/planner/enrichment-queue`

---

# Step 13 — `assign.ts` (Pass B)

**Mode:** Seam · **Depends on:** 5, 12

**Carried over — cluster labels are still unfilled.** `PlaceCluster.label` /
`ScoredCluster.label` are `undefined` all the way through the deterministic core:
nothing there knows that a centroid at (35.017, 135.671) is "Arashiyama". Decide
here whether Pass B names each cluster from its members (free, in the same call)
or a reverse-geocode fills it before the call (accurate, one extra Google SKU).
Until then, day headings would read "Cluster 2".

**Tests** (`src/lib/planner/assign.test.ts`):

*the request*
- `capacity` is denominated in **minutes** (`activity_minutes`), not slot counts
- every candidate carries `open_windows` as a coarse `morning|midday|evening` array
- **the payload does not contain** `latitude`, `longitude`, `formatted_address`,
  `photos`, or opening-hours `periods`. Serialize the request and assert absence by
  key. Every omitted field is hallucination surface; this test is what keeps it
  omitted when someone "just adds lat/lng for context".
- candidates arrive **grouped by cluster** with cluster summaries

*the response*
- an assignment referencing a `place_id` **not in the candidate set is dropped**,
  and the drop is logged. Structured output constrains shape, not membership.
- a response assigning more minutes than `capacity` is accepted and passed to the
  packer — code owns the budget, so this must not throw
- `flex` picks are parsed and marked as flex, not merged into assignments
- an empty `assignments` array for a day → falls back to top-scored candidates by
  role rather than producing an empty day
- malformed response → one retry, then the deterministic fallback; never a thrown
  error that kills the job

**Verify:** `npx vitest run src/lib/planner/assign`

---

# Step 14 — `narrate.ts` (Pass C)

**Mode:** Seam · **Depends on:** 7, 12

**Tests** (`src/lib/planner/narrate.test.ts`):
- **one failing call out of fifteen produces fourteen narrated stops and one
  fallback** — the fallback carrying `enrichment.description` + `match_reasons`.
  Assert the itinerary is returned, not thrown. This is `Promise.allSettled` vs.
  `Promise.all` as a test, and it is the difference between a demo and a stack trace.
- **all fifteen failing still returns a complete itinerary**, every stop on fallback
- prompt block order: the shared system prompt and the profile slice come first as
  their own blocks, and per-stop content is strictly **after** them. There is no
  `cache_control` breakpoint to assert on — that is Anthropic's model; OpenAI's
  prompt caching is automatic and routes on a **prefix hash**. Assert on the
  assembled block array of two different requests: the shared prefix compares
  byte-identical, the suffixes differ. Backwards, this silently costs 15× and no
  other test notices.
- the shared prefix clears **1024 tokens**, below which nothing caches at all.
  Assert a minimum character length standing in for that floor.
- `prompt_cache_key` is one value for the whole itinerary, on all fifteen calls, so
  they route to the same cache. Verify in production with
  `usage.input_tokens_details.cached_tokens` — the Responses API name; the design
  doc's `prompt_tokens_details` is Chat Completions and does not exist here.
- meal slots always request `food_recommendations`, and a returned dish **not in**
  the supplied `signature_dishes` is rejected — the anti-hallucination rule
- non-meal slots omit `food_recommendations`
- `place_id` is echoed and used to correlate; a response with a mismatched
  `place_id` is discarded rather than applied to the wrong stop
- `profile_slice` contains only interests + dietary, not the whole profile

**Verify:** `npx vitest run src/lib/planner/narrate`

---

# Step 15 — route handlers

**Mode:** Seam · **Depends on:** all of the above

`POST /api/plan`, `GET /api/jobs/[id]`. Stage functions injected so the handler test
runs the whole pipeline against fakes.

**Tests** (`src/app/api/plan/route.test.ts`):
- creates a `jobs` row and returns its id **before** the pipeline finishes
- `progress.percent` is monotonically non-decreasing across stages, starts ≥ 0,
  ends at 100 on success
- a stage throwing writes `status: 'failed'` + `error`, and the error text is
  **friendly** — routed through `getFriendlyApiError`, with the technical detail
  `console.error`'d. Assert the response body contains no raw provider message.
- `funnel_stats` is persisted on the itinerary row and its numbers match the
  funnel's own output
- the full run with fake Google + fake OpenAI produces a valid itinerary — reuse
  the Gate A invariant assertions

**Tests** (`src/app/api/jobs/[id]/route.test.ts`):
- response shape matches what `useJobsQueue` reads today (check the hook, don't guess)
- unknown id → 404, not 500

**Verify:** `npx vitest run src/app/api`

---

# Step 16 — client rewire (`useJobsQueue`)

**Mode:** Seam · **Depends on:** 15

Realtime channel → TanStack Query polling. Needs
`npm i -D @testing-library/react jsdom` and `environment: 'jsdom'` on this file.

**Tests** (`src/hooks/useJobsQueue.test.ts`):
- polls `GET /api/jobs/:id` at `refetchInterval: 2000`
- **stops polling on a terminal status** (`completed` / `failed`) — a poll that
  never stops is a bug you find on the bill, not in the UI
- surfaces progress to the loading screen in the shape the component expects

`useItineraryRealtime` is dropped for v1 (per the design doc) — no tests, delete the
subscription rather than leaving it half-wired.

**Verify:** `npx vitest run src/hooks`

---

# Step 17 — golden end-to-end

**Mode:** snapshot · **Depends on:** all

One fixture: **Kyoto, 3 days, vegetarian, outdoors + cafes** — recorded Google
responses (real JSON, captured once, committed) + a stubbed LLM returning a fixed
assignment. Snapshot the resulting timeline.

**Tests** (`src/lib/planner/e2e.test.ts`):
- the timeline snapshot is stable across runs (proves the whole pipeline is
  deterministic given fixed inputs — if this flakes, something is reaching for
  `Math.random` or `Date.now`)
- the shared invariant suite runs over the output (below)
- zero network calls in the entire run

**Verify:** `npx vitest run src/lib/planner/e2e`

---

# Cross-cutting: the invariant suite

`src/lib/planner/__tests__/invariants.ts` exports `assertValidItinerary(it)`. Called
from Gate A, Step 15, and Step 17 — so the same guarantees are checked on
hand-built, API-built, and golden itineraries.

1. No two segments in a day overlap; the day is contiguous
2. Every meal slot holds a restaurant type
3. Every place is open during its assigned window
4. No day exceeds its minute budget
5. Every `place_id` in the output was in the retrieved candidate set
6. **No dietary violation** when the dietary ladder resolved at rung 1 or 2; at
   rung 3, a caveat tip is present
7. Every activity has non-empty `match_reasons`
8. Every dropped candidate has a recorded reason

Write these once. They are worth more than any individual module's tests, because
they hold no matter how the internals get refactored.

---

# Critical path, if time runs out

This is a hackathon; 17 steps is more than a weekend. The demo-critical spine:

**0 → 1 → 2 → 3 → 5 → 6 → 7 → 10 → 13 → 14 → 15**

What can be cut and what it costs:

| Cut | Cost |
|---|---|
| **Step 4** (cluster) — one cluster per city | Days aren't geographically coherent; Pass B loses its per-day area. Visible in the demo. Cut last. |
| ~~**Step 8** (validate)~~ | Done. Worth knowing what it caught: the recorded Gate A itinerary scheduled Kennin-ji at 20:15, three hours after the gate shuts, and every unit test passed it. `open_windows` in Pass B (Step 13) should remove most of the repair traffic, not the need for the check. |
| **Step 9** (Neon) — in-memory cache | No cross-run cache, so no pre-warm. Directly contradicts the demo plan; if you cut this, you demo the cold path. |
| **Step 11** (photos) | Cards render without images. Ugly, not broken. Cutting only the *blob store* is milder still: photos work, but the stored URLs expire and every itinerary re-bills the Photos SKU for a place it has already seen. |
| **Step 12** (enrichment) | No tags, no signature dishes → Pass C food recommendations become ungrounded, i.e. hallucinated dishes. **Do not cut this and keep meal narration.** Cut both together. |
| **Step 16** (rewire) | Job progress doesn't update live. Poll manually or hardcode a loading screen. |
| **Step 17** (golden) | No regression net. Fine on day one, painful on day three. |

## Honest notes on this plan

- **Steps 3, 5, 7 are where test-first actually earns its cost.** They are pure,
  the logic is subtle, and the bugs are silent. If you only write tests for three
  modules, write them for these.
- **Steps 10, 12, 13, 14 are testing our adapter, not the model.** Don't let those
  tests grow into assertions about output quality — they'll flake, get skipped, and
  then the ID-membership check they were actually protecting goes unnoticed.
- **The dependency chain is real.** `pack` needs `duration`; `funnel` needs `score`
  and `cluster`; `narrate` needs `enrich` for grounded dishes. Steps 2–8 can be
  built by one person in order; 9–14 parallelize across people once Gate A is green.
- **Nothing here tests the Google or OpenAI APIs themselves.** The first real
  call will surface a field-shape surprise no fixture predicted. Budget an hour for
  it and capture the real response into the Step 17 fixture the moment it works.
