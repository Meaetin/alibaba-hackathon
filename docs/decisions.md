# Decisions

- 2026-08-20 — Ported Argo's frontend by copying the measured import closure
  (247 of 298 files) rather than rewriting. Brief was explicit that verbatim
  copies are fine and cleanup comes later.
- 2026-08-20 — Stripped the auth gate (no middleware, no login routes) but kept
  `lib/supabase` and `lib/api` verbatim. Routes render immediately with no
  backend; the data layer stays as the single seam for the new database.
- 2026-08-20 — Stripped PostHog entirely (109 call sites, 25 files) instead of
  no-oping the key, so the ported code carries no dead telemetry.
- 2026-08-20 — Dropped `dialkit` + `agentation` (Argo-internal dev tooling) and
  `recharts` (admin-only, and admin wasn't ported).
- 2026-08-20 — Kept `src/components/ui/auth/**` and `DeleteAccountDialog`
  despite being unreachable, because the brief asked for all components/modals.
- 2026-08-20 — Personalization pipeline runs in this repo as Next.js route
  handlers, not in the Argo backend. That backend isn't in this tree (`src/app`
  has no route handlers) and the hackathon needs stages we can actually run.
- 2026-08-20 — Database for the pipeline is Neon Postgres (Drizzle +
  `@neondatabase/serverless`), not Supabase. Supabase project quota is exhausted;
  Neon is plain Postgres, works in route handlers, and Drizzle collapses the
  three-way column sync (`getItineraryDetail` projection / `useItineraryRealtime`
  column string / `ActivityLocation` type) into one definition.
- 2026-08-20 — Supabase Realtime is dropped. `useJobsQueue` moves to 2s polling
  against `GET /api/jobs/:id`; `useItineraryRealtime` (collaborative editing) is
  cut from v1. Neon has no browser-facing realtime equivalent.
- 2026-08-20 — Renamed `GenerateItineraryParams.preferences` → `options`
  (scheduler knobs) so the traveller's `profile` could sit beside it. Renamed
  `buildClusters` → `buildLocalityPins` so it can't be confused with the
  planner's geographic k-means.
- 2026-08-20 — Geographic clustering happens before Pass B, not after selection.
  The LLM assigns one cluster per day, so it must receive clustered candidates.
- 2026-08-20 — Pass B `capacity` is denominated in minutes, not slot counts. A
  count can't stop a 3-hour hike and a 2-hour museum landing in the same day.
- 2026-08-20 — Learning loop (type affinities from saves/removals) deferred past
  v1. Removals are dominated by scheduling reasons, not taste.
- 2026-08-20 — Dropped `places.editorialSummary` from the field mask. Most places
  don't have one and it's generic where present; the enrichment pass writes a
  better `description` from review snippets instead. Reviews are fetched via
  Place Details only for shortlisted IDs, keeping bulk Text Search at Enterprise
  instead of Enterprise + Atmosphere; the Pass C failure fallback remains
  `enrichment.description` + `match_reasons`.
- 2026-08-20 — Keep both `price_level` and `price_range`; filter on `price_level`
  only. `price_range` is currency-denominated and not comparable across cities.
  Google reports level as a string with two different spellings across
  transports, so `src/lib/maps/price-level.ts` owns the single 0–4 conversion.
- 2026-08-20 — Photo media is resolved only at final-itinerary assembly. Photo
  resource names come free with the search field mask; turning one into an image
  bills the Places Photos SKU, so we fetch ~15 instead of ~1,000.
- 2026-08-20 — Test runner is Vitest (`vitest` + `vite-tsconfig-paths`), not Jest
  or `node --test`. Native ESM + TypeScript with no Babel config, and it reads the
  `@/*` alias straight out of `tsconfig.json`. Implementation order and per-step
  verify commands live in `docs/implementation-plan.md`.
- 2026-08-20 — The funnel returns the shortlist **grouped by cluster**
  (`FunnelResult.clusters`) as well as flat. Pass B (Step 13) assigns one cluster
  per day; a flat `ScoredPlace[]` forced it to re-derive membership by joining on
  `placeId` against the original clusters, which is a silent-drift bug waiting to
  happen. `scoreCluster` implements the doc's `cluster_score` and orders them.
- 2026-08-20 — Cluster-score coverage/variety bonuses are 0.06/0.04, not 0.15/0.10.
  Interest matching is already priced into every place score at `WEIGHTS.affinity`
  (0.4); at the larger weights a cluster of 2.5★ places outscored a cluster of
  4.9★ ones purely on role variety. The bonuses break ties, they don't override.
- 2026-08-20 — Every funnel cut records `{ placeId, stage, reason }` in
  `FunnelResult.dropped`, and `hardFilterReason` in `score.ts` owns both the rule
  and its wording so the two can't drift. This is invariant 8 of the cross-cutting
  suite, enforced at the funnel instead of waiting for Gate A.
- 2026-08-20 — The restaurant quota is denominated in the global cap (24 of 60),
  not in the output length. In a thin city the shortlist tips past 40% restaurants
  rather than shrink; 34 candidates for Pass B beats 16. Pinned by a test, because
  it reads like a bug.
- 2026-08-20 — Two known gaps deferred, noted at the step that will close them:
  cluster labels stay `undefined` through the deterministic core (Step 13 decides
  Pass B vs reverse-geocode), and `avgVisitMinutes` from enrichment is trusted
  unvalidated by `resolveVisitDuration` (Step 12 clamps it). Neither blocks Gate A.
- 2026-08-20 — `priceFit` is asymmetric: at or under budget scores 1, only
  *above* budget is penalized. The symmetric version contradicted the hard filter
  ("cheap is never a violation") and ranked a ¥¥ ramen shop above a ¥
  Kiyomizu-dera for a ¥¥ traveller. Found by the Gate A fixture, not by any unit
  test — each unit test was individually right.
- 2026-08-20 — Gate A's end-to-end fixture run lives in
  `src/lib/planner/__tests__/gate-a.test.ts` and is the extension point for Steps
  7 and 8. `__tests__/` means cross-module (invariants, seeded rng, Gate A);
  per-module tests stay colocated.
- 2026-08-21 — One Google Maps map ID only, the light style, used in both app
  themes. `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID_DARK` is gone; maintaining a second
  Cloud Console map style wasn't worth it. App dark mode still colors markers and
  polylines, just not the base map.
- 2026-08-21 — Singapore probe (20 places, `npm run places:sample`) confirmed the
  summary decision empirically: `generativeSummary` and `reviewSummary` were 0/20
  (unavailable in SG), `editorialSummary` 10/20. All three Google summaries stay
  out of the production mask; the enrichment `description` is the replacement.
- 2026-08-21 — `allowsDogs` and `goodForGroups` are excluded from the production
  retrieval mask. Nothing in `PreferenceProfile` consumes them and coverage is
  sparse (8/20, 5/20). Atmosphere fields belong on shortlist-only Place Details
  hydration if a future profile input consumes them; adding one to bulk Text
  Search would raise every candidate query to Enterprise + Atmosphere.
- 2026-08-21 — No LLM price estimation in v1. The probe showed `price_level`
  missing only on parks/museums (F&B was 10/10), i.e. exactly where budget
  filtering doesn't apply; "unknown scores neutral" already handles it. If a
  real city run ever shows F&B gaps, the fix is a grounded `estimatedPriceLevel`
  field on the Stage 7 enrichment output (derived from review snippets, stored
  separately, used only as a low-weight fallback) — never a cold "what does X
  cost" LLM call, which is hallucinated data feeding a hard filter.
- 2026-08-21 — A place is promoted to a packer **anchor** on `duration.min >= 180`,
  not on `preferred`. `resolveVisitDuration` scales `preferred` by pace, so keying
  on it would let a relaxed traveller promote a place that a packed traveller
  doesn't — anchor status has to be a property of the place, not of who's
  visiting. It also draws the line the design intends: teamLab (min 180) anchors,
  a museum you *could* do in two hours (min 120) stays elastic.
- 2026-08-21 — `PACE_PLANS.durationBias` names bounds, never a multiplier: it
  picks the bound a visit is built at, and growth may lift it one bound higher
  (`min`→`preferred`, `preferred`→`max`, `max` stays). A second multiplier here
  would double-count the one `duration.ts` already applied to `preferred`. The
  first version grew every pace to `max`, which made the knob decoration —
  relaxed and packed produced identical durations on any day with room to spare.
- 2026-08-21 — Only **meal** slot windows are enforced by the packer. Non-meal
  roles wait at most `MAX_SLOT_WAIT_MINUTES` (60) for their window to open and
  then start on arrival. Gate A caught the alternative: a thin day held Ryoan-ji
  back until the 20:00 evening window and billed the traveller three hours of
  "free break" to get there. Consequence to know about: on a thin day a segment's
  `role` can read `evening_activity` at 12:20. The label is Pass B's assignment,
  not a claim about the clock.
- 2026-08-21 — Vendor switch: OpenAI, not Anthropic. `gpt-5.6-terra` for Pass B
  (one call, structured output, arithmetic against a minute budget — the one place
  a cheap model's mistake costs a repair loop) and `gpt-5.6-luna` for Pass C and
  Stage 7 enrichment (~75 short, non-reasoning calls). Frontier (`gpt-5.6-sol`) is
  deliberately unused: code owns the clock, the geometry and the filtering, so the
  model only assigns IDs to buckets and writes two sentences. Both take
  `reasoning: { effort }` and default to `medium`, so set it explicitly or you buy
  reasoning tokens for tag extraction. OpenAI's prompt caching is automatic and
  prefix-hashed — no `cache_control` breakpoint, a 1024-token floor, and
  `prompt_cache_key` to route Pass C's parallel calls to one entry.
- 2026-08-21 — A stop's `role` is `activity | lunch | dinner | cafe_break`: what it
  is, never when it happens. The old time-flavoured roles folded kind, position and
  a clock claim into one field; only the clock claim could be wrong and it
  duplicated `startMin`. Position is the array index, time is the timestamp. This
  deleted the soft-clamp-and-wait machinery that caused the bug, since an activity
  with no window has nothing to wait for.
- 2026-08-21 — The packer has **no cap on stops per day**, in count or in minutes.
  A count cut days the clock had room for (three temples, done by 13:28). Minutes
  don't fix it: the wall clock already caps a balanced day at ~415–465 activity
  minutes, so a useful cap would have to sit below the range the shrink-ladder
  fixtures need. The clock is the budget; pace keeps only `bufferMin`, `dayEndMin`
  and the duration bounds.
- 2026-08-21 — `PacePlan.shrinkFloor` — relaxed will not compress a visit below
  `preferred`, and drops a stop instead. Without it `durationBias: "max"` is
  self-defeating: Gate A showed relaxed and packed producing the *same 32 stops*,
  because the ladder squeezed the relaxed day straight back to `min` to fit them.
- 2026-08-21 — The funnel reserves `mealsPerCluster` (2) restaurants per cluster
  before the global cap is spent. The cap was a single greedy walk down one ranked
  pool, so the best-scored restaurants pooled in dense neighborhoods and two of
  five Kyoto clusters got none — a shortlist that cannot become a day. Where a
  cluster genuinely has nothing to eat, `ScoredCluster.shortfall` says so; the
  reservation can only distribute what retrieval found, and closing that last gap
  is retrieval's job (Step 10), not the funnel's.
- 2026-08-21 — Opening hours live on a **weekly** clock: `hours.ts` flattens
  Google's `{day, hour, minute}` periods to minutes-since-Sunday-00:00. Both
  awkward cases then need no special branch — a Friday bar closing 02:00 Saturday
  is an ordinary interval, and a Saturday one closing Sunday is that interval
  shifted a week. No `Date`, no timezone conversion: Google's periods are already
  local to the place, so `weekday` is an injected parameter like `rng` and `now`.
  `isOpenDuring` requires the **whole** visit inside a window, not just its start.
- 2026-08-21 — A place with no usable opening periods is treated as open 24/7.
  Chosen deliberately, and it is not free: "always open" and "Google returned
  nothing" are indistinguishable in the payload, so a museum whose hours failed to
  arrive is waved through exactly like a nature trail that genuinely never closes
  (1/20 in the Singapore probe). `hasKnownHours` keeps that visible so Step 8 can
  pass a stop on the assumption without reporting it as verified — it counts
  unusable periods (malformed, zero-length) as no periods for the same reason.
- 2026-08-22 — Retrieval talks to the database through two injected ports,
  `SearchCache` and `LocationStore`, not through Drizzle directly. Step 10 was
  specced to depend on Step 9, but nothing in its test list is about SQL: it is
  about which requests reach Google. Ports let the whole module run with zero
  network *and* zero database, and reduce Step 9 to implementing two interfaces.
  In-memory implementations ship in the module and are the offline path.
- 2026-08-22 — The retrieval cache key lowercases and whitespace-collapses
  `city` and `query` before hashing
  `sha256(city | query | includedType | pageSize)`.
  "Kyoto" and "kyoto" are the same search and billing Google twice to learn that
  is pure waste. `includedType` is NOT normalized — a different type filter is a
  different search — and page size is included because it changes the result set.
- 2026-08-24 — Search-cache entries publish only after their location rows
  persist, and a fresh cache entry with missing rows is treated as a miss. A
  counter alone left the cache poisoned and the candidate set thin for 30 days.
- 2026-08-24 — Photo resolution is versioned by the ordered `photo_names` set.
  Refetching the same names preserves URLs and the resolution stamp; changed
  names invalidate both, and photo writes patch only those columns while the
  stored names still match.
- 2026-08-22 — A search that returns zero places is cached like any other. It is
  a real answer, and the alternative re-bills a genuinely-empty query on every
  replan for 30 days. A search that *fails* (non-2xx, network error) is never
  cached; it lands in `RetrievalStats.failures` and the run continues.
- 2026-08-22 — `places.formattedAddress` is in the retrieval field mask even
  though the design doc's mask omits it. `locations.formatted_address` needs it
  and it bills at the Essentials tier, which `places.location` and `places.types`
  already trigger — it is free given the rest of the mask.
- 2026-08-23 — Resolved photos are stored as the `photoUri` from a
  `skipHttpRedirect=true` media response, never as the `/media` request URL.
  The design doc's original example showed the latter, which only renders in an
  `<img src>` with the API key embedded — and `GOOGLE_PLACES_API_KEY` is a
  server key with no referrer restriction, so that publishes it in page source
  and re-bills the Photos SKU on every render. Doc corrected.
- 2026-08-23 — `photosPerPlace` defaults to **1**. The cost table budgets "~15
  media fetches" for a trip, and that only holds at one fetch per stop; this is
  the pipeline's only per-stop billed call, so the default multiplies directly.
- 2026-08-23 — `photos_resolved_at` is stamped when the answer is *known*,
  which includes "this place has no photos" (names empty → stamped, zero
  fetches). A media fetch that fails leaves it null, because the point of the
  column is telling a replan whether trying again could help. A place that
  already carries the stamp is skipped, so replanning costs nothing.
- 2026-08-23 — `FetchLike` and `mapWithConcurrency` live in
  `src/lib/planner/http.ts`, shared by the Seam modules. There is deliberately
  no HTTP client and no retry policy there: each Seam module owns its endpoint,
  field mask and failure semantics, which are the parts worth reading in a diff.
- 2026-08-23 — Drizzle row types use **snake_case TS property names**, matching
  the Postgres columns. The ported UI types (`ActivityLocation` in
  `src/lib/supabase/queries/home.ts`) already speak snake_case, so a camelCase
  schema would reintroduce a rename layer — a fourth hand-maintained list, which
  is the exact thing Drizzle was adopted to delete.
- 2026-08-23 — `createLocationStore.upsertMany` coalesces `stay_duration`,
  `photo_urls` and `photos_resolved_at` against the existing row instead of
  overwriting. Retrieval never learns those three, so a plain upsert on refetch
  would wipe the enrichment backfill and the resolved media and re-bill both.
- 2026-08-23 — The Drizzle stores do not filter on `expires_at`. `retrievePlaces`
  compares against an injected `now`; a store that filtered too would put a
  second, ambient clock in the path and make the TTL untestable.
- 2026-08-23 — `formatMinutes` accepts `0..1440` and throws outside it. `1440`
  renders as `"24:00"` so a day ending at midnight doesn't read as ending at its
  own start. Out-of-range input is corrupt data, not a display problem, so it
  fails loudly rather than rendering a plausible lie.
- 2026-08-23 — Photo resolution takes its survivor list from
  `survivorIdsFromDays(days)`, derived from the packed timeline's `activity`
  segments, never from a hand-assembled list. `resolvePhotos` already makes
  "resolve the whole pool" inexpressible, but a caller could still pass the
  funnel shortlist (~60) or a cluster's 15 candidates — and roughly half a
  cluster's places don't survive scheduling. Only stops a user will actually
  see are worth the Photos SKU.
- 2026-08-23 — **No photo blob store, for now.** The `PhotoBlobStore` port and
  the cache-through path exist in `photos.ts` and are tested, but nothing
  configures one, so `photo_urls` holds Google's `photoUri`. Consequence,
  accepted knowingly: those URLs expire, so an itinerary reopened weeks later
  shows broken images and `photos_resolved_at` being set means nothing retries.
  Blocking fact behind the deferral — Neon Object Storage is public beta and
  `us-east-2` only, while the `hackathon` project (`curly-union-42502230`) is
  `aws-ap-southeast-1`, where the planner's many Postgres round-trips belong.
  A bucket would mean a second project or a ~200ms-per-query move. When it's
  worth it, implement the two-method port against any S3-compatible store.

- 2026-08-23 — One canonical `PriceRange`, flat, in `src/lib/maps/price-range.ts`,
  sibling of `price-level.ts` and for the same reason. `locations.price_range` had
  two writers disagreeing on shape: the browser add-a-place path already flattened
  Google's nested `{ startPrice: { currencyCode, units } }` via a private
  `normalizePriceRange`, while `planner/retrieval.ts` stored the nested form
  verbatim into the same jsonb column. Both now call `toPriceRange`, which is
  idempotent so a re-normalized row survives. `formatPriceRange` and every card
  type import the flat shape rather than redeclaring it.
- 2026-08-23 — `PhotoBlobStore` is implemented against **S3, not a vendor**
  (`src/lib/planner/photo-blobs.ts`). R2, Neon Object Storage, Supabase Storage
  and AWS S3 all speak the same three calls, so the backend is an env decision.
  Neon Object Storage is the eventual home because it branches with the database,
  but it is public beta and `us-east-2` only while this project's database is in
  `ap-southeast-1`; nothing in the code changes when that lands.
- 2026-08-23 — Split into two layers: `ObjectStore` (the bucket, ~30 lines of
  SDK) and `createPhotoBlobStore` (the lookup → download → upload flow). The
  layer with logic is then testable against a Map with zero network, matching
  the no-mocking-framework rule the rest of the pipeline follows.
- 2026-08-23 — `putFromUrl` refuses to store a zero-byte or failed download.
  Storing one would poison the cache permanently: the key is content-addressed,
  so every later lookup would be a "hit" on a broken image and no replan could
  repair it. `resolveOne` already falls back to the paid `photoUri`.
- 2026-08-23 — A failing blob *lookup* is now caught in `resolveOne` and treated
  as a miss, matching what the write path already did. Previously an unreachable
  bucket propagated out and the stop shipped with no photo at all — strictly
  worse than having no bucket configured.
- 2026-08-23 — `s3ConfigFromEnv` returns undefined when nothing is set (a
  supported state) but **throws when only some of it is set**. A typo that
  silently disabled the cache would show up as a Places Photos bill, not a bug
  report.
- 2026-08-23 — `validate.ts` owns a pack → inspect → swap → pack loop rather than
  editing a finished timeline. A swap changes the day's shape (a nearer
  restaurant shortens two travel legs and moves everything after it), so an
  in-place edit would be arithmetic the packer already owns, done twice and
  differently.
- 2026-08-23 — The design doc's "travel time overruns the window" is checked as
  `lost_meal`, not as an overrunning day. `pack.ts` cannot *return* one — it
  shrinks, then drops, until the day fits — so the overrun is only observable as
  its cost, and meals are the last thing the packer gives up. A dropped
  **activity** is the pace knob working, not a failure to repair.
- 2026-08-23 — Repair ladder is swap → drop → fail, with meals exempt from the
  drop rung. Swap-or-fail alone returned `ok: false` on 3 of 10 Gate A day-runs,
  because the only thing open at 20:15 is always a restaurant. A day that ends
  after dinner is a real day; a day with a locked temple in it is not.
- 2026-08-23 — A restaurant may repair a meal slot or a cafe break, never a plain
  activity. Without the rule the validator swapped Kennin-ji for a ramen shop
  twenty minutes after dinner — valid, and a worse trip — and quietly spent the
  funnel's restaurant quota doing it.
- 2026-08-23 — The Kyoto fixture carries opening hours, assigned by Google type
  (temples 09:00–17:00, museums the same but shut Mondays, restaurants split
  11:00–14:30 / 17:00–22:00). Ungated public space gets none, because for a
  bridge or a mountain trail "no hours" is the truth rather than a gap — and
  telling those two apart is the whole job of `hasKnownHours`.
- 2026-08-23 — `isRestaurant` moved to `taxonomy.ts`. It had been copied
  privately into the funnel, the invariant suite and Gate A, and Step 8 needed a
  fourth; it is a question about Google's type vocabulary, which is what that
  module is for.

- 2026-08-23 — The blob integration test stands in for Google's CDN with an
  object it just wrote to the same bucket, rather than hitting a real photo URL.
  The download path is exercised for real, with no billed call and no dependency
  on third-party uptime.
- 2026-08-23 — Gate A now runs two cities. Kyoto stays as the regression net (it
  caught the symmetric `priceFit`); Singapore is the fixture a reviewer who
  knows the ground can actually read, which is the only way "does this still
  look like a trip" gets answered. The shared machinery lives in
  `__tests__/harness.ts` so a third city is a data file, not a second pipeline.
- 2026-08-23 — 19 of the 85 Singapore candidates are live Google payloads lifted
  from `scripts/output/singapore-place-details.json`, not hand-written. They
  carry two opening-hours encodings nobody would think to invent: MacRitchie
  Nature Trail has no periods at all, and Bukit Batok Nature Park uses Google's
  always-open form (one period, day 0, 00:00, no `close`).
- 2026-08-23 — **Known defect, not fixed: `clusterPlaces` is k-means on raw
  lat/lng, and it fails on a dense-core city.** Singapore's civic core (~40
  places within a few km) collapses into one cluster while two clusters are
  spent on far nature parks holding 3 and 2 places with nothing to eat. Holds at
  k = 4, 5 and 6, so it is the geometry and not the day count. Gardens by the
  Bay, Merlion Park and the National Gallery are squeezed out of the shortlist
  by the per-cluster cap as a direct result. The funnel reports the starved days
  via `cluster.shortfall`, so nothing ships silently — but two of four days are
  not days. Any fix is a Step 4 redesign (capacity-constrained k-means, or
  discarding outliers by distance from the city centroid).
- 2026-08-24 — **The shortlist Place Details call now carries the whole
  Atmosphere mask, not just `reviews`.** Google prices the Enterprise +
  Atmosphere SKU per request, set by the highest-tier field in the mask, so
  `editorialSummary`, `reviewSummary` and `servesVegetarianFood` ride free on a
  call we already make. Asking for reviews alone paid that tier for a third of
  the goods. Bulk Text Search still excludes all of them: there the same fields
  would bump 15–30 queries for a pool the funnel cuts to ~60.
- 2026-08-24 — **`shortlist_hydrated_at` replaces `review_snippets: null` as the
  "we asked" marker.** With four fields on the mask, "did we call?" is a
  different question from "what did reviews say?", and Google being quiet about
  a place is a legitimate answer that must not trigger a refetch. Stamped when
  the answer is known; left null when the fetch failed, so a replan retries.
  Mirrors `photos_resolved_at`.
- 2026-08-24 — **Dietary filtering prefers Google's `servesVegetarianFood` over
  the place-type guess, but only when Google actually answered.** `undefined` is
  the common case outside chains and falls through to `DIETARY_CONFLICT_TYPES`;
  reading it as `false` would delete most of a city. `vegan` borrows the
  vegetarian flag in the hard filter (no vegetarian food implies no vegan food)
  but not at rung 2 of the ladder (vegetarian is not vegan). This retires the
  planned "rung 2 = LLM enrichment tags" for the vegetarian case — we were about
  to infer from review text a boolean Google states outright.
- 2026-08-24 — **`reviewSummary` stays on the shortlist mask despite returning
  nothing in Singapore.** Measured live: absent on all 20 sampled SG places and
  on 3 re-probed today, but populated with full text for New York, London and
  Taipei. It is a regional rollout, not a bad field name, and it costs nothing
  on a call already at the Atmosphere tier.
- 2026-08-24 — **`npm run lint` migrated off the deprecated `next lint` to
  `eslint .` with a flat config.** `no-unused-vars` errors under
  `src/lib/planner`, `src/lib/db` and `src/lib/maps`, warns elsewhere: the
  ported UI's 27 hits are dead PostHog props, and underscoring them would
  disguise a backlog as intent. Zero errors, 81 warnings, exit 0.
