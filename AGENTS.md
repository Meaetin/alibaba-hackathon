# AGENTS.md

Ported from Argo's production frontend (`~/Desktop/Projects/Argo/frontend`) on
2026-08-20. Routes: `/home`, `/links/**`, `/collections/**`, `/itineraries/**`.

## Stack

Next.js 15 App Router · React 19 · TypeScript strict · Tailwind **v4** ·
`motion@12` · `@base-ui/react` · `@dnd-kit` · `@vis.gl/react-google-maps` ·
TanStack Query · Supabase JS.

## Learned

### Tailwind v4 is CSS-first — there is no `tailwind.config.js`
The whole design system lives in `src/app/globals.css`:
`:root` tokens → `.dark` overrides → `@theme inline` registration → base and
utility layers → keyframes → page-scoped `@layer components` (bento grid,
day-column board). Adding a token means adding it in **two** places: the raw
`--name` in `:root`/`.dark`, and `--color-name` under `@theme inline`. Motion
tokens are separate, in `src/styles/tokens/motion.css`.

### Never hardcode colors, spacing, or type — use the semantic tokens
Property-agnostic naming, so they read cleanly with any utility prefix:
`bg-surface-*`, `text-content-*`, `text-glyph-*` (icons), `border-edge-*`,
`bg-action-*` (interactive), `bg-category-*` (CategoryBadge / key icons).
There are no shadcn-style `--background`/`--primary` tokens; don't reintroduce them.

### `cn()` for every className
`import { cn } from '@/lib/utils'` — clsx + tailwind-merge. Use CVA for variants.

### Two conventions make the layout addressable — keep both in sync
1. `{/* Section Name */}` JSX comment above every major section (Title Case).
2. `data-region="{page}-{region}"` on every meaningful structural element,
   kebab-case, named by **role** not component (`home-map-tile`, not
   `home-staticmap`). Repeated list items share one name. `data-region` is
   inert — never drive CSS or JS off it.

Skip both for primitives under ~20 lines of JSX and for items inside `.map()`.

### Animation gotcha
Never use `AnimatePresence mode="wait"` with different keys to switch between
modes of the same component — it unmounts/remounts and destroys the component's
internal motion state. Pass a `mode` prop and transition internally instead.

### `/itineraries/[id]` reads Neon; everything else on it is still unwired
`readItineraryDetail` (`src/lib/db/itinerary-detail.ts`) is the page's read path,
served by `GET /api/itineraries/[id]` because the page is a client component and
Neon is server-side only. It is not a port — five selects with no decisions in
them — and the logic worth testing is the mapping, which is pure functions with
their own tests: `minutesToISO`, `endDateFor`, `categoryFor`, `overviewFrom`,
`weekdayDescriptionsFrom`.

The types live there and `src/lib/supabase/queries/home.ts` **re-exports** them,
because twenty-odd components import them from that path. One definition, no
rename layer. The Supabase `getItineraryDetail` is deleted.

Three mappings that are decisions, not translations. `overview` is built from
`planner_debug.themes.titles` — those sentences cost an expensive model call and
nothing rendered them. `thumbnail_url` is the first stop with a resolved photo,
because there is no such column. A card's description prefers Pass C's
`content.whyForYou` over `locations.editorial_summary`: the first is written for
this traveller, the second is Google's description for everyone.

**Read-only, and deliberately.** The page's thirty mutations still point at the
old REST backend on `:8080`. Wiring reads does not make it editable, and an edit
control that silently fails is worse than one that is gone.

Removed with the backends that fed them: sharing and invite tokens,
collaborators and the owner avatar, the companion collection, flights, lodging
and their bookend cards, attachments, `travel_polyline`, `correlation_id`,
`updated_at`, and the location panel's website, phone numbers and Maps link.
`timezone` is gone too — the planner has none, so `ITINERARY_TIMEZONE` is UTC in
one place instead of `?? "UTC"` at twenty call sites.

`ActivityTravelMode` is declared in `itinerary-detail.ts` and re-exported as
`TransportMode` from the day-column constants, so the stored mode and the
displayed mode cannot drift. The planner only ever produces `walk` and
`transit`; `drive` exists for the page's own optimistic rows.

### Two data backends, both currently unwired
- `src/lib/supabase/**` — browser client, direct table queries, realtime channels
  (`useItineraryRealtime`, `useJobsQueue`).
- `src/lib/api/**` — REST calls to `NEXT_PUBLIC_API_URL`, authed with the
  Supabase JWT.

These were copied **verbatim** and are the intended seam for the new database.
Pages render against them today with a null session, so they show empty states.
Rewire here rather than at the call sites.

### Auth was deliberately removed
No `middleware.ts`, no `/login`, no `(auth)` routes. All routes are open. The
navbar still has a sign-out that calls `supabase.auth.signOut()` and pushes to
`/home` — it's a stub. `useSessionUserId()` returns `null` until a session
exists.

### The job queue is client-tracked, and it does not survive a reload
`useJobsQueue` polls `GET /api/jobs/:id` through TanStack Query at 2s per job
and stops the moment a job reads `completed` or `failed` — a poll that never
stops is a bug you find on the bill. The watched ids live in React state and
enter only through `upsertJob`; with auth gone there is no user to re-query the
list by, so a refresh mid-plan loses the queue card (the job itself keeps
running). Restoring it means a server-side list endpoint, not a client change.

`QueueJob` is the Drizzle `jobs` row verbatim. `user_id`, `detached`, and the
`pending`/`cancelled` statuses are gone. `content_id` and `completed_at` stay on
the type as optional, read by the links page's optimistic cards and never
written by the local API — they belong to the old external content-analysis
backend.

Tests for this hook set jsdom with a `// @vitest-environment jsdom` docblock.
The global environment stays `node`; the planner suite depends on it. Under fake
timers React Query's `notifyManager` must be switched to a synchronous scheduler
or every assertion reads the state from one poll ago.

### PostHog was fully stripped
109 `track()` calls across 25 files removed. The domain types that outlived it
(`Surface`, `QuotaType`, `ShareableEntity`) live in `src/lib/domain-types.ts`.
Several props exist only to carry a `source: Surface` for analytics that no
longer runs — they're harmless but are dead weight if you're cleaning up.

### User-facing errors
Never render a raw backend or Supabase error. `console.error` the technical
detail, then show a plain sentence via `getFriendlyApiError` /
`getFriendlyAuthError` from `src/lib/errors/userMessages.ts`.

### Env
Copy `.env.local.example` → `.env.local`. Google Maps needs two keys
(API key + `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID_LIGHT`) or `/home`, `/collections/**`
and `/itineraries/**` degrade. There is **one** map ID — the light style, used in
both themes. Don't reintroduce a dark map ID; the app's dark mode still drives
marker and polyline colors in `GoogleMapDetail`, but never the base map.

### The site is light-only — `forcedTheme="light"`
`ThemeProvider` (`src/components/ThemeProvider.tsx`) pins `defaultTheme` **and**
`forcedTheme` to light, so `resolvedTheme` is never `"dark"`. The `.dark` blocks in
`globals.css`, the `dark` half of `PALETTE_COLORS`, and the `resolvedTheme === "dark"`
branches in `GoogleMapDetail` / `ItineraryQuickView` are all unreachable today. Don't
add new dark variants; don't treat the existing ones as live.

### Planner naming: `profile` describes the traveller, `options` describes the scheduler
`GenerateItineraryParams.preferences` was renamed to `options` (k-means/scheduler
knobs) so the new `profile?: PreferenceProfile` could sit beside it without either
being misread. Types live in `src/lib/planner/types.ts`. Never merge the two.

Likewise `buildClusters` → `buildLocalityPins` (`src/lib/maps/locality-pins.ts`):
that function groups entities by `"{region}, {country}"` for static-map pins. The
planner's geographic k-means is a separate module (`src/lib/planner/cluster.ts`).
Don't share code between them.

### Photo bytes: the blob store is S3-shaped on purpose
`src/lib/planner/photo-blobs.ts` implements the `PhotoBlobStore` port from
`photos.ts`. Don't reach for a vendor SDK — R2, Neon Object Storage, Supabase
Storage and S3 all satisfy `ObjectStore`, so the backend is `PHOTO_BLOB_*` env,
not code. It's optional: unset, the pipeline stores Google's expiring `photoUri`
and still produces a trip. Keys are content-addressed (`photoBlobKey`), which is
what makes a photo billable once across every itinerary — never key a photo by
place or itinerary id.

Photo resolution is valid only for the exact ordered `photo_names` set. A
retrieval refetch with the same names preserves `photo_urls` and
`photos_resolved_at`; changed names invalidate both. Photo writes go through
`LocationStore.updatePhotoResolution`, which patches only while the stored names
still match — never write a stale full location row from `photos.ts`.

### `src/lib/db` is the single source of column truth
Drizzle tables in `src/lib/db/schema.ts`; the row type is
`InferSelectModel<typeof table>` and every select list is generated from it.
Property names are **snake_case**, matching the columns and the ported
`ActivityLocation` type — don't camelCase them, that's the rename layer Drizzle
replaced. Adding a column means one edit here plus `npm run db:generate`, and
the migration in `drizzle/` is committed.

`stores.ts` implements the `SearchCache` / `LocationStore` ports that
`planner/retrieval.ts` declares, so the in-memory and Postgres paths are
interchangeable. Integration tests (`schema.integration.test.ts`) skip unless
`DATABASE_URL` is set; they are a pre-demo check, not a per-commit gate.

Publish a `place_search_cache` entry only after its location rows persist, and
treat a fresh entry with any missing row as a miss. Cache identity includes
`pageSize`.

### The Atmosphere tier is priced per request — so buy the whole shelf, once
Google sets the SKU from the highest-tier field in the mask, per call. Bulk Text
Search must therefore stay free of every Atmosphere field (`reviews`,
`editorialSummary`, `reviewSummary`, `serves*`): one of them bumps 15–30 queries
for a pool the funnel cuts to ~60. The shortlist Place Details call already pays
that tier for `reviews`, so every other Atmosphere field rides it for free —
`SHORTLIST_FIELD_MASK` in `retrieval.ts` takes all four. Adding a field there is
free; adding one to `SEARCH_FIELD_MASK` is not. Never move one across.

`shortlistHydratedAt` is the "we asked" marker, not `reviewSnippets`. It is
stamped when the answer is *known*, including "Google had nothing to say"; a
**failed** fetch leaves it null so a replan retries. Same contract as
`photos_resolved_at`, and the reason is the same — without it, every place
Google is quiet about gets refetched at Atmosphere prices forever.

### `servesVegetarianFood` is three-state, and `undefined` is not `false`
Google answers for chains and stays silent for most everything else. Reading
silence as "no vegetarian food" would delete most of a city. So
`violatesDietaryNeed` (`score.ts`) uses Google's boolean **only when present**
and otherwise falls back to `DIETARY_CONFLICT_TYPES`; rung 2 of the ladder in
`selectMealCandidates` (`funnel.ts`) does the same against the enrichment tags.

`vegan` reads the vegetarian flag in the hard filter — no vegetarian food means
no vegan food, so `false` is sound for both. It does **not** read it at rung 2,
because vegetarian is not vegan. That asymmetry is deliberate; both directions
have a test.

Measured on 20 live Singapore places (`scripts/output/singapore-place-details.json`):
`servesVegetarianFood` present on 7, `goodForChildren` on 17, `editorialSummary`
on 10, `reviewSummary` on **0**. `reviewSummary` is not broken — it returns full
text for New York, London and Taipei and is simply unpopulated in Singapore, so
it stays on the mask and the column will be null for SG trips. Coffee shops do
come back `servesVegetarianFood: false`, which is harmless only because
`mealSlotReason` requires `isRestaurant` first and `cafe_break` is not a meal
role. Don't remove either guard.

`retrieval.integration.test.ts` is the only thing that catches Google changing a
response shape — `editorialSummary` is `{text}` but `reviewSummary` is
`{text:{text}}`, and a silent change to either leaves every summary undefined
with the whole offline suite still green. It bills real money, so it skips
unless `GOOGLE_PLACES_API_KEY` is set: `npm run test:places`.

### Lint is `eslint .` on a flat config, and it is green at zero errors
`next lint` is deprecated in Next 15 and gone in 16, so `npm run lint` calls the
ESLint CLI against `eslint.config.mjs`. `no-unused-vars` is an **error** under
`src/lib/planner`, `src/lib/db` and `src/lib/maps`, and a **warning** everywhere
else: the ported Argo UI has 27 dead `source` / `surface` / `method` props left
from the PostHog strip, and underscoring them would mark deliberate what is
really a backlog. The 54 `react-hooks/exhaustive-deps` and
`@next/next/no-img-element` warnings are the same kind of visible debt. Keep the
error count at zero; don't silence a warning to make a number smaller.

### `place-search.ts` is browser-only
It's built on the Maps JS `Place` class and needs a live `google.maps.Map`. Server-side
retrieval uses the Places REST API in `src/lib/planner/retrieval.ts`.

`normalizePlace` used to request `priceLevel` in the field mask and then drop it.
Both paths now go through `toPriceLevelOrdinal` (`src/lib/maps/price-level.ts`) —
keep it that way, or budget scoring loses its only input. The same rule holds for
`priceRange`: both paths flatten through `toPriceRange`
(`src/lib/maps/price-range.ts`) so `locations.price_range` holds one shape.
Anything that redeclares `{ startPrice, endPrice, currency }` inline is drift —
import the type. `normalizePlace` and
`SEARCH_FIELDS` are module-private; export them if you need to test the mapping.

### Tests are Vitest, colocated
`npm test` (`vitest run`). Test files sit next to their module
(`src/lib/planner/score.test.ts`), fixtures in `__fixtures__/`. `__tests__/` is
for **cross-module** work only — the invariant suite (`__tests__/invariants.ts`),
the shared seeded rng, and the Gate A end-to-end run. Per-module tests don't go
in there.

`__tests__/gate-a.test.ts` drives 86 hand-written Kyoto candidates through the
whole offline core and snapshots the result. Run it after any scoring change and
read the snapshot diff before accepting it — it is the only test that tells you
whether the trip still looks like a trip. It has already caught one real bug that
every unit test passed straight through. Randomness and
time are **injected parameters**, never ambient — k-means takes an `rng`, cache
expiry takes a `now`. Google and OpenAI clients are injected too; there is no
mocking framework. Build order and per-step assertions live in
`docs/implementation-plan.md`.

### The funnel is the only place that answers "what got cut, and why"
`runFunnel` returns the shortlist three ways — flat (`shortlist`), grouped by
cluster (`clusters`, what Pass B consumes), and `dropped` with a stage and a
reason per casualty. Adding a cut means adding a `FunnelStage`, a stat, and a
`dropped` entry; a cut that only shrinks a list is a silent bug. Hard-filter
wording lives with the rule in `hardFilterReason` (`score.ts`), never duplicated
at the call site.

Dietary is a hard filter but a **meal-slot** one: `applyHardFilters` only enforces
it when passed `{ mealSlot: true }`, and the day-level ladder lives in
`selectMealCandidates`. The older prose in `personalization-pipeline.md` that said
"dietary = filter, always" was wrong and has been corrected.

### Gate A runs two cities from one harness
`__tests__/harness.ts` holds everything city-agnostic: the Routes stand-in
(`straightLineLegs`), the Pass B stand-in (`assignDay`), `alternatesFor`, and
`createTrip(fixture)` which binds candidates + profile + days + weekday and
returns `runPipeline` / `packTrip` / `validateTrip` / `lockedStops`. A third
city is a JSON fixture plus its own assertions — never a second copy of the
pipeline.

`gate-a.test.ts` (Kyoto, 5 days) is the **regression net**: it caught the
symmetric-`priceFit` bug and its snapshot is the one that proves scoring didn't
drift. `gate-a-singapore.test.ts` (4 days, 85 places, 19 of them live Google
payloads) is the **reviewable** one — read that snapshot when you want to know
whether the output still looks like a trip.

Fixtures carry opening hours. Ungated public space — parks, trails, a bamboo
grove, Fushimi Inari's shrine path, Togetsukyo Bridge — deliberately has none,
because `hasKnownHours` distinguishing "always open" from "we never got hours"
is the whole reason `assumed` exists. Don't "fix" a fixture by giving
everything hours.

### `clusterPlaces` fails on a dense-core city — known, unfixed
k-means on raw lat/lng optimises squared distance and nothing else, so a city
with a packed centre and a sparse edge spends clusters on the edge. In the
Singapore fixture two of four days come out holding 3 and 2 far-flung nature
parks with nothing to eat, while ~40 civic-core places fight over one cluster's
20 seats — which is why Gardens by the Bay and the National Gallery are not in
the shortlist. Reproduces at k = 4, 5 and 6.

`cluster.shortfall` reports it, so no day silently ships without lunch. Before
blaming the funnel or the scorer for a thin Singapore day, check the cluster
sizes first.

### `validate.ts` repairs from the ranked list — never by re-asking the LLM
Step 8 sits between Pass B and the stored day. `validateDay(input, deps)` packs,
inspects, swaps and packs again; it does not edit a finished timeline, because a
swap moves every segment after it. Three rules — `closed`, `meal_slot`,
`lost_meal` — and a three-rung ladder: **swap** from the same bucket, **drop** if
nothing fits, **fail** if the thing that doesn't fit is a meal. A restaurant may
hold a meal slot or a cafe break, never a plain activity.

`ValidateDeps.assign` is a **tripwire, not a dependency**: the module never calls
it, and `validate.test.ts` asserts zero calls. Don't reach for it — the funnel's
ranked shortlist is the fallback queue, and that's the point.

`lost_meal` is how an overrun is observed. `pack.ts` cannot return an
overrunning day (it shrinks, then drops), so a dropped **activity** is the pace
knob working as designed and is not a failure; a dropped **meal** is travel
eating the day.

Everything is injected, including the **weekday** — `hours.ts` takes one and
nothing in the planner derives it. `start_date` stops at the API seam until
Step 15.

### Assertions in the planner suite are mutation-checked, not just green
Five assertions in `validate.test.ts` passed on first writing while testing
nothing — a decoy that was already in the day, a probe rejected by an earlier
check, a "termination" case that never reached the bound. After a change to
`validate.ts`, `score.ts`, `funnel.ts` or `pack.ts`, break the rule you just
touched and confirm a test goes red. Green is not evidence.

### Photos are billed per stop — resolve from the finished timeline, never earlier
Retrieval stores photo resource *names* for free; turning one into an image
bills the Places Photos SKU per fetch. `resolvePhotos(pool, survivorIds, deps)`
in `src/lib/planner/photos.ts` takes the pool and the survivors as two arguments
so "resolve everything retrieval found" isn't expressible — and the survivor list
must come from `survivorIdsFromDays(days)`, the packed timeline's `activity`
segments. Half a cluster's candidates don't survive scheduling; the funnel
shortlist is ~60 and the final trip is ~15.

`photos_resolved_at` is stamped when the answer is *known*, including "this place
has no photos" (names empty, zero fetches). A fetch that **fails** leaves it null
so a replan retries. Stored URLs are the `photoUri` from a `skipHttpRedirect=true`
response, never the `/media` URL — that one only renders with the API key
embedded, and `GOOGLE_PLACES_API_KEY` is an unrestricted server key.

### Never run `npm run build` while `next dev` is running
Both write `.next/`. A production build drops its own `BUILD_ID` and manifests
on top of the dev server's, and the running `next dev --turbopack` then serves
**500 Internal Server Error** on every route with nothing useful in the
terminal. It looks exactly like the app broke.

Recovery is to stop the dev server, `rm -rf .next`, and start it again — not to
debug the page that appeared to fail. To type-check a change while a dev server
is up, use `npm run type-check` and `npm run lint`, which touch nothing shared.

### The demo runtime is localhost-only
The 2026-08-24 demo runs in a long-lived local Node process. Do not flag
post-response pipeline work as a serverless deployment blocker unless the
deployment scope changes.

### Never type a control character into source — it makes the file unsearchable
`pipeline.ts` carried a literal NUL byte as the separator in the travel-leg memo
key. It renders as a space, git diffs it as text (the binary sniff only reads
the first 8000 bytes), TypeScript compiles it and every test passed — but grep
and ripgrep classify the whole file as binary and skip it **silently**. The file
simply stopped appearing in code search, with no warning to anyone. Write the
escape — `\u0000` inside the template literal — never the byte. To sweep the
repo, walk `src/` in Python and flag any byte below `0x09`.

### `itineraries.planner_debug` is where the models' own words go
Two things used to be built and thrown away inside one request: Pass B's
one-sentence `why` per stop (paid for on the expensive model, read by nobody)
and the plain-English reason for every id it named that we refused. Both now
land on `itineraries.planner_debug`, shaped by `src/lib/planner/debug.ts`, and
the drops are `console.warn`'d as they happen so they show up in the dev
terminal too.

It is **diagnostics, never content** — no card reads it, and it may be reshaped
without a migration because the column is `jsonb` and `PLANNER_DEBUG_VERSION`
says which shape a row is. Per-stage counters deliberately are **not** in it:
they are already durable on `jobs.result.stats`, and a second copy is a second
thing to keep true.

### `EnrichmentSubject` is a `Pick`, which is compile-time only
Hand the enricher a whole `RetrievedPlace` and the whole thing reaches the
prompt — coordinates, photo names, price range. `toEnrichmentSubject` projects
at runtime; call it at every boundary that sends a subject. Correctness is
unaffected (`enrichmentSourceHash` only digests `buildEnrichmentInput`), so
nothing fails — the payload just quietly gets fat.

**Everything in `enrich.ts` degrades except the store.** `enrichPlaces` says
"nothing here throws" and means it for every provider and parsing failure: a
place that fails falls to the type heuristic in `duration.ts`, exactly as a
cache miss already did. A refused **store** write is reported as `storeError`
rather than raised — the answers are already in hand and serve this plan; what
is lost is the next plan's cache hit.

### `searchLocality` is how `country` reaches Google, and Singapore must not move
`PlanRequest.country` used to be validated, stored on the itinerary row and
never used: `buildSearchPlan` takes one string and interpolates it into
"specialty coffee {city}". The country is now appended **only when it differs
from the city**, which is load-bearing for the demo — the create flow sends
`city` and `country` both as "Singapore", the two compare equal, and the query
stays the literal `"Singapore"` with the same `searchCacheKey` and the same
pre-warmed rows. `pipeline.test.ts` pins that equality. Kyoto with a country
becomes "Kyoto, Japan".

Do **not** remove the client's `city: input.region?.trim() || input.country`
fallback in `createItineraryRouted` — that fallback is how a city-state gets a
city at all.

### A repair must size its visit from the same rung Pass B used
`alternatesFor` in `pipeline.ts` passed `undefined` for enrichment, so a museum
Pass B picked was 90 minutes and the identical museum swapped in by `validate.ts`
was whatever the type heuristic said. It takes the enrichment map now, and it is
exported purely so that has its own test: which rung a repair lands on is not
observable from a finished itinerary without a fixture built to force a swap.

### A truncated model response is a 200 with half a JSON object
`ResponsesResult` carries `status` and `incompleteReason` because a response cut
off at `max_output_tokens` parses exactly like a model that wrote nonsense, and
the two need different fixes — one is a number, the other is a prompt.
`narrate.ts` counts them separately as `stats.truncated`. When testing this,
slice a **real** answer in half: a made-up broken string fails to parse either
way, so the fallback alone proves nothing about which path produced it. One of
these tests passed with the feature removed until it also asserted the counter.

### `/itineraries/[id]/debug` is the app's only server component
It reads `itineraries.planner_debug`, `funnel_stats`, the stored days, the
`jobs.result.stats` blob, and renders them as one page: the funnel's cuts, the stage counters, the days with Pass B's sentence
under each stop, the ids we refused, the narration fallbacks, and the enrichment
misses. Every value is already on a row, so there is no query, no polling and no
loading state — it ships 167 B of client JS.

The read layer is `src/lib/db/diagnostics.ts`, which is **not** a port: no
interface, no in-memory double. It is five `select`s with no decisions in them,
so a fake would only prove the fake works. The logic that *is* worth testing
lives in the view and is tested there.

**It is not linked from anywhere.** Auth is gone, so a visible link would put
every place id, score and model rationale one click from the itinerary page.
Type the URL.

### Pass B's sentences are keyed by day **and** place, never place alone
The rationale arrives as one flat list for the whole trip. A traveller can visit
the same place on two days, so a `place_id` key silently renders day one's
sentence under day two's stop — and it reads perfectly well, which is why
`PlannerDebugView.test.tsx` pins it with two different sentences for one id.

The same file keeps a rule worth repeating: `debug: null` (an itinerary planned
before the column existed) must render "not recorded", never "nothing was
dropped". They are different answers and conflating them is a lie told by the
one page whose job is the truth.

### Vitest needs `oxc: { jsx: { runtime: 'automatic' } }` to import any `.tsx`
`tsconfig.json` has to keep `jsx: preserve` because Next owns the app build, so
without that line in `vitest.config.ts` a test importing a component dies at
parse time with "make sure to not set jsx to preserve". `esbuild: { jsx: ... }`
does **not** work — Vite 8 parses with oxc, not esbuild. `include` covers
`*.test.tsx` as well now, and the environment stays `node`: rendering a server
component with `renderToStaticMarkup` needs no DOM, and the planner suite
depends on `node`.

### `hhmm` is exported from `validate.ts`
Minutes from midnight to a clock face. There were already three copies
(`validate.ts`, `__tests__/harness.ts`, `utils/calendar.ts`) and the debug view
would have been a fourth. Note that `toHHMM` in `utils/calendar.ts` takes
fractional **hours** — a different unit, not a duplicate.

### `.qoder/` is generated output and is gitignored — never commit it
The repowiki under `.qoder/` is regenerated per branch, so two branches that
both regenerate it conflict on ~180 files with no meaningful winner. It was
removed from the index on 2026-08-25 and added to `.gitignore`. The files stay
on disk; regenerate freely, just don't `git add -f` them back.

### The persona is stored server-side, and the browser holds only an id
`travel_personas` keeps the raw `QuizAnswers` plus the derived `dimensions` and
`archetype`. Answers are the source of truth — `calculatePersona` is a scoring
function that can be retuned, and `POST /api/plan` rebuilds the result from the
answers rather than reading the derived columns.

**A retake rewrites the row in place.** One persona per person, one stable id,
nothing for `localStorage` to migrate. The cost is that the table describes who
the traveller is *now*, not who they were when an older trip was planned — which
is why `itineraries.persona` snapshots the whole thing (answers and result) on
**every** plan, and why nothing explaining an existing itinerary may join to
`travel_personas`.

`PersonaStore` is declared in `src/lib/db/personas.ts`, not `stores.ts`: the
ports in `stores.ts` are the *planner's*, and nothing in the planner knows a
persona has a row. It follows `PlanStore` in `itineraries.ts` instead.

### `knobs.ts` is the only file that reads a `PersonaResult`
Every other module takes the knob it needs as a parameter, the way `rng` and
`now` are already injected. Four pairs of axes collide, and a collision resolved
at two call sites is resolved twice, differently, eventually:

- **`immersion` owns fame.** `spontaneity` may move only the serendipity
  threshold, or a deep-and-spontaneous traveller gets fifteen places with forty
  reviews each.
- **`comfortTolerance` owns the price curve.** `immersion` exempts specific
  types (`market`, `food_court`) instead of reshaping it.
- **`pace` owns minutes, `spontaneity` owns openness.** Generalised: a thing the
  user typed beats a thing the quiz inferred. `visitDurationBias` is the one
  shared knob — pace sets the floor and `immersion` may raise it one step,
  never lower it.

**A missing persona returns today's constants, field for field, and so does
every `mid` band.** `knobs.test.ts` asserts both. That is what keeps the Gate A
snapshots still for a traveller who never took the quiz, and it is why two
proposals from `docs/quiz-pipeline-bridge.md` lose: a 0.1 popularity weight at
mid, and one social venue a day at mid.

`getFocusScoringAdjustments` and `getSocialSchedulingRules` were **deleted**
rather than connected — they cut at 30/60/70 where the bands cut at 33/66. The
three fields with no mechanism to connect to are named in `profile.ts`.

### `popularity` is not `quality`, and the difference is the whole persona
`quality` asks "is this good?" and uses the review count only to decide how much
to trust the stars. `popularity` asks "does everyone go here?" — log-scaled, so
100 reviews is halfway to 10,000. Two travellers want opposite answers; the
weights and `touristTrapPenalty` decide the sign. Both terms are **zero by
default**, which is what "there is no popularity term" means once the term
exists.

`typeAffinities` is read by `scorePlace` as an offset from neutral, bounded to
±0.5. It is the persona's precision layer: the `Interest` union has seven members
and cannot say "here for the galleries, not the shopping malls". A type the map
never mentions scores 0, the same as no map at all — silence is not a zero
opinion expressed loudly.

### The persona reaches a prompt as words, never as a number
`persona-brief.ts` renders four instructions, four statements of what the
traveller actually said, and at most three negatives. The rule the module turns
on: **instructions to the planner, not descriptions of the person.** A model
handed adjectives returns adjectives. `persona-brief.test.ts` asserts it.

`traits` come from the bands; `signals` come from the four highest-spread
answers (Q1, Q3, Q5, Q6 — pinned by question *label*, because a question
inserted above one would shift every signal onto the wrong axis and still read
perfectly well). They are allowed to disagree and are labelled apart in the
prompt so the model can hold both.

The brief and the day premises go in `buildSharedPrefix`, **never** the per-stop
payload — the other way round is fifteen cache misses. `promptCacheKeyFor` gained
the four bands for the same reason.

### Themed planning: `PlanRequest.mode`, and every rung falls back
`"themed"` replaces the statistical centroid with a semantic anchor. Four
stages: `survey.ts` (deterministic city summary), `theme.ts` (one model call),
`explore` (Nearby Search in `pipeline.ts`), `group.ts`.

**`DayTheme.anchorPlaceId` must be an id already in the pool.** That one rule is
the whole hallucination defence, and it hands us verified coordinates for free.
An invented id drops that day to geography and is recorded, never retried — a
model that named a place we do not have will name it again.

A Nearby Search is a `SearchRequest` with a `nearby` circle, so it runs through
`retrievePlaces` and inherits the cache, the location persistence, the dedupe and
the rule that a cache entry is published only after its rows land. It uses
`SEARCH_FIELD_MASK`: one Atmosphere field would bump the SKU tier on every
nearby call.

`runFunnel` gained `dayAligned` because a themed cluster carries `theme.dayIndex`
— score-ranking would move day three's premise onto day one, and dropping an
empty cluster would renumber every day after it.

`runPlan` still defaults to `"geographic"`; the **client** sends `"themed"`. A
library default that changes behaviour silently is a trap, so the product default
lives in `createItineraryRouted` where somebody can see it.

### Theme infeasibility is discovered after you have paid
A thin geographic cluster is visible before a cent is spent (`shortfall`); a thin
theme is only visible after its Nearby Search is billed. `feasibility.ts` is the
mitigation and stays deterministic — a model call there would double the latency
budget on the days already going badly.

Three rungs, every one recorded on `planner_debug.themes.repairs`: **widen** (one
more billed search), **merge** (borrow surplus restaurants from the nearest
theme, never taking the donor below its own feasibility), **fall back** (take the
geography and drop the premise). "Merge" does not fuse two days — that would
leave the trip a day short and renumber everything after it.

When testing this, note that a **themed** donor gets repaired on the next pass of
the loop and borrows its own restaurants straight back. An assertion written
against two themed clusters passes whatever the rule says. Use a themeless donor.

### Three fixes from one live Singapore run, 2026-08-25

A themed 3-day Singapore trip came out with 3 stops on day two and five stops
with no name. All 687 tests were green through both.

**`rows` must be built from `poolWithExplored`, never `pool`.** Every place a
themed Nearby Search finds lives only in the wider pool. Reading `pool` dropped
them from `rows`, and `rows` becomes `result.places` — which is the list
`saveItinerary` resolves `location_id` from. So an explored stop reached the
database with a null `location_id`, no photo and no Atmosphere fields, while
the itinerary still rendered as complete. The `notInPool` counters on
hydration, enrichment and photos had been reporting it on every themed run.

The suite could not see it because `createFakeGoogle` answered `searchNearby`
out of the **text-search pool**, so an "explored" place was always already in
`pool`. `FakeGoogleOptions.nearbyOnly` is what makes the two pools distinct.
Any test about explored places is vacuous without it.

**`pickVictim` must drop from in front of the meal that failed.** A meal has a
hard window — lunch must *start* by 13:30 — and it is late because of what runs
before it. Dropping a low-scored stop *after* it costs a stop and moves the meal
not at all, so the day stays infeasible and the loop cuts again. One late lunch
therefore shed a whole afternoon before touching the single morning stop that
caused it. `stampDay` now returns `blockedBefore` and `pickVictim` narrows to
that prefix, falling back to the whole day so it always returns a stop.

**`nearestTheme` needs a distance cap, and `MEMBER_RADIUS_SLACK` is it.** It had
none: every place joined its nearest anchor however far, and a type match made it
look 40% closer. A cafe **5.7 km** from the anchor joined a walkable coffee theme
and cost that day seven of its ten stops. The cap is
`radiusFor(theme.radiusHint, walkMaxMeters) * 1.5` — the circle the theme was
actually billed for, plus slack for text-search finds just outside it. The
discount decides *which* theme wins a place; it must never decide *whether* one
can join.

The cap is metres while the choice stays squared degrees. That is not drift: a
comparison between two distances from the same place rides a monotonic transform
for free, and an absolute threshold cannot.

`feasibility.ts` takes the same `walkMaxMeters` for the same reason. Without it
rung 2 hands back exactly what membership refused, and the day reads as repaired
— it has its two restaurants — while the packer still spends the morning on
transit.

Places no theme will claim are counted as `GroupResult.unclaimed` and warned
about, because a cut that only shrinks a list is the bug this project already
knows about. On a themeless day they come back as leftovers.

`metersBetween` now lives once, in `geo.ts`. It takes **definite** coordinates:
the three callers each mean something different by a missing one (zero-minute
leg, joins no theme, sorts last when borrowed), so the guard stays at the call
site and only the trigonometry is shared.

### Two failures the whole offline suite cannot see
Both were found by one live run and neither moved a single test.

**`prompt_cache_key` is capped at 64 characters.** Spelled out, "Singapore +
four interests + four persona bands" is 84, and OpenAI answers **400 on every
model call in the run** — theme, Pass B and all fifteen narrations. Each one then
degrades to its documented fallback, so the plan completes and the itinerary
still looks like an itinerary. `promptCacheKeyFor` hashes now and
`MAX_PROMPT_CACHE_KEY` is pinned by a test with pathological inputs.

**Google's Places types split into searchable and descriptive-only, and both
arrive in `places.types`.** `food`, `place_of_worship`, `point_of_interest` and
the rest of `NON_SEARCHABLE_TYPES` come back on real places and cannot be used
as `includedTypes` — the API rejects the **entire** Nearby Search with a 400, not
just that type. Two of three Singapore circles were lost that way. "The pool
contains this type" is necessary and not sufficient; `isSearchableType` applies
both rules.

The lesson generalises: every degradation ladder in this pipeline is also a way
for a real failure to reach production looking like success. When a stage has a
fallback, its test must assert on the counter, not on the output.

### Five findings from the first itinerary anyone actually read, 2026-08-26

**`parseTimeMins` reads UTC, and the default is load-bearing.** It used to fall
back to `d.getHours()` — the *browser's* clock — when no timezone was passed,
and twelve of its call sites pass none. `minutesToISO` builds every stored
timestamp by adding minutes-past-midnight to a UTC midnight, so UTC is that
function's exact inverse and anything else is wrong. The page renders its labels
in `ITINERARY_TIMEZONE` (UTC), so the times looked right while the **sort** was
rotated by the reader's offset: at UTC+8 a 17:15 stop became 01:15 and jumped to
the top, and day one rendered starting at 5:15 PM. Invisible at UTC+0, which is
where CI runs. `activity-utils.test.ts` pins it with a real stored day.
`CompactActivityCard` had a private third copy of the same parser; it is gone.

**`sequence.ts` is step 7a — the day's route order, between Pass B and the
packer.** Two correct rules left a gap: `assign.ts` sends the model no
coordinates (hallucination surface), and `pack.ts` refuses to reorder because
the sequence is Pass B's. So nothing in the pipeline ever looked at the map, and
day one of the first Singapore trip walked 9.0 km to visit 4.6 km of city.
Reordering between the meals cuts the trip from 40.4 km to 33.4 km.

Meals are the fixed points and never change index — `stampDay` seats them in
hard windows, and their position is what puts the morning before lunch. Opening
hours are deliberately **not** consulted: predicting a stop's clock time needs
the packer, which needs the order, and `validate.ts` already packs, inspects and
repairs closures afterwards. Measured on the three real days, reordering caused
**zero** extra repairs. `planner_debug.sequencing` reports before/after minutes
per day, and it is optional on the type so a plan made before it existed reads
as "not recorded" rather than "saved nothing".

**Nothing was sweeping the enrichment queue.** Enrichment ran on OpenAI's Batch
API, and the collector that downloads a finished batch was written, tested and
called by no one — so every batch sat at `validating` forever, `place_enrichments`
had **zero rows**, and every visit duration in every trip came off the type table
in `duration.ts`. Merlion Park was 60 minutes because `park` is 60 minutes, and
the trip looked complete. Collecting once stored 64 enrichments and Merlion Park
became 30–60 while the Peranakan Museum became 120–180. The batch path is gone
now (see below), but the rule it taught is the one this file keeps repeating: a
fallback is also a way for a failure to look like success.

**`places.googleMapsUri` is Pro tier and rides free.** `SEARCH_FIELD_MASK`
already asks for `rating` and `regularOpeningHours`, which are Enterprise, so
the SKU cannot go up — the same asymmetry `SHORTLIST_FIELD_MASK` documents, one
tier down. `locations.google_maps_uri` is the column. Every place stored before
that has none, so `googleMapsPlaceUrl` (`src/lib/maps/google-maps-url.ts`) falls
back to `?api=1&query={name}&query_place_id={place_id}`, which opens the real
place; a coordinate query only drops an unlabelled pin and is the last rung.

**Pass C writes four things per stop and three of them rendered nowhere.**
`highlights`, `foodRecommendations` and `tips` were paid for on a model, stored,
and read by no component; `whyForYou` was only ever visible clamped to two lines
on a card. All four now render in the detail views (`LocationDetailView` in view
mode, `LocationDetailPanel` in edit mode), above Google's `editorial_summary` —
one is written for this traveller, the other is Google's blurb for everyone.

### A repair can undo the route order, and no fixture catches it
`validate.ts` swaps a replacement into the failing stop's **index**, which is
correct for the clock and blind to the map — so a day that left `sequence.ts` in
its shortest order can ship improvable again. Measured on the Kyoto fixture: one
of three days re-sequences 4 minutes shorter after its two swaps. Left alone
deliberately; re-sequencing after validation means re-packing, and a re-pack can
fail a day that had already validated.

It also means `pipeline.test.ts` cannot see the difference between "sequenced"
and "sequenced, recorded, then packed unsequenced". Every Kyoto day repairs on
every weekday, and a repair drops stops, so the shipped path is shorter than
Pass B's either way. The wiring test asserts what it can and says so in a
comment. A fixture that validates clean would close it.

### Travel is measured now, not guessed — `routes.ts`
`createStraightLineTravel` divided great-circle metres by 80 m/min and called
anything under 1200 m a walk. That one threshold decided the **mode** as well as
the minutes, so a 1035 m leg was a walk and a 1208 m leg was a bus, 173 metres
apart and neither looked up. Measured against Google on day one of the Singapore
trip: the straight line understated distance by 30–100% every leg (1.0 km real
1.3, 1.1 real 1.9, 2.2 real 3.0), and 28 of 72 pairs are genuinely faster by
transit.

**A matrix, never per-leg directions.** `TravelLegProvider` forbids a network
call behind its signature because `packDay` calls it hundreds of times per day
and `sequenceDay` thousands. So the whole N×N is fetched once and the provider
is a map lookup — the seam is unchanged. Two matrices per day, walk and transit,
and the faster wins by `TRANSIT_MIN_SAVING_MINUTES`; Google's transit duration
already includes the walk to the stop and the wait, so they compare directly.

`TravelLeg.mode` is new and optional. Present, it is authoritative and
`travelModeForMeters` is not consulted — a measurement must beat a threshold.

Caps are per request and transit's is six times tighter: 625 elements walking,
**100** on transit. `chunkPairs` slices origins and keeps destinations whole. A
16-place day is one walking request and three transit ones. Only
`MATRIX_ALTERNATES` of a day's replacements go in — the rest fall back and are
counted rather than hidden.

**Everything degrades to the straight line**, which is how this could fail
invisibly: a trip built entirely on fallbacks is indistinguishable from a routed
one. `stats.travel.estimated` and `stats.travel.errors` are the only way to
tell, so the tests assert on counters, not on "a leg came back".

Transit needs a departure time and the planner has no timezone. `departureTimeFor`
estimates one hour per 15° of longitude from the day's own places and asks for
10:00 local — midnight UTC would be a night timetable for half the world. It
also clamps into Google's roughly -7/+100 day window, because a trip in the past
still has to route.

### Every stamped time is a multiple of `VISIT_STEP_MINUTES`
"9:00 AM – 9:43 AM" was not an estimate of anything. Merlion Park was a
60-minute constant in a type table, packed pace built it at its 40-minute floor,
and the growth pass handed it the three spare minutes the day had left. Nothing
upstream measures a visit to the minute, so the precision was never real.

Three things hold the grid: `quantizeDuration` in `duration.ts`, travel legs
rounded **up** (`ceilToStep` — promising an earlier arrival than the route
allows is the error that costs a stop), and a squeeze that surrenders whole
steps rather than proportional minutes. `growDay` stepping by five is *not* one
of them — with the other three in place the room to grow into is already a
multiple of the step, so it is a speed win only. `pack.test.ts` says so, and a
mutation confirms it.

`packDay` re-applies `quantizeDuration` on the way in rather than trusting its
caller: it is the only module that stamps a clock, so the guarantee is its own.

Accepting the Gate A snapshots for this: both cities kept the **identical set of
stops** (Kyoto 33, Singapore 20) and only the clock moved. Kyoto's repair path
changed — five-minute boundaries cross opening hours differently, so Kodai-ji is
now dropped directly instead of being swapped for Walden Woods and dropped a
round later. Same outcome, one fewer wasted swap. Compare the stop *sets*, not
the diff line count, when accepting these.

### Model spend: tokens are stored, dollars are computed at render
`jobs.result.stats.cost` is a `StageUsage[]` — stage, model, calls, input,
cached input, output. No dollar figure is ever persisted. List prices move, and
a stored dollar amount silently becomes a wrong claim about a run nobody can
re-measure; `pricing.ts` prices the tokens whenever the debug page is opened, so
correcting a rate re-prices every historical run for free. `PRICES_AS_OF` ships
next to the figure on the page rather than hiding in a comment.

**A model with no rate on file costs `null`, never `0`.** The page then says "no
price on file" and calls the total a floor. A stage reporting $0.00 is worse
than one reporting nothing, because somebody will believe the first.
`RATES` deliberately lists only the models actually in `MODELS`.

**`cached_tokens` is a subset of `input_tokens`, not an addition.** Billing is
the uncached remainder at full rate plus the cached part at 10%. Adding them
would double-charge the cached half and still look plausible. `addUsage` clamps.

`StageUsage.stage` exists because Pass B and the theme call both run on
`MODELS.assign` — "the expensive model cost $0.04" cannot say which of them
spent it. A stage that made no calls is **omitted**, not shown as a zero row:
"Pass B was never reached" and "Pass B was free" are different answers.

**Enrichment is in a plan's cost, and its tokens are counted before the parse.**
The call is spent building this trip, so it is billed to it — even though the
cached answer goes on to serve every later trip touching the same places. A line
that came back as a schema violation was still generated and still billed, so
costing only the usable answers would make a run look cheaper the worse it went.

### Enrichment is fetched before Pass B, and the batch path is gone
Enrichment used to run on OpenAI's Batch API — half price, up to 24 hours — which
made it a cache *warmer*: its answers reached the next plan touching a place,
never the one that queued them. So every first trip to a new city sized its
visits from the type table in `duration.ts` (a park was 60 minutes because `park`
is 60 minutes) and the itinerary looked complete doing it. Worse, the batch only
paid off if something downloaded it, and for weeks nothing did.

`enrichPlaces` sends the same request inside the run, in the stage that always
claimed to be there. Measured on a real 58-place shortlist: 8 took 19.6s, **16
took 11.4s**, 24 and 32 bought only a longer tail (32's worst call 8.9s against
3.7s at 16). No 429 at any level — requests are not the binding limit (58 against
500/min); **tokens are**, at ~48k of a 200,000/min budget per pass, so roughly
three plans a minute however concurrency is set. `ENRICH_CONCURRENCY` is 16.

**There is no longer a way to defer enrichment.** Submit, collect, the durable
`enrichment_batches` queue, `POST /api/enrichments/collect` and the Batch port in
`openai.ts` were all removed on 2026-08-26 — the live path made every one of them
dead weight, and a queue nothing sweeps is worse than no queue. The call is
unconditional: there is no `enrichNow` flag to turn it off, because "off" would
now mean "no enrichment at all", which nobody wants.

Nothing throws: a failed place falls to the type heuristic, which is exactly
what a cache miss already did. That is also why the tests assert on
`stats.enrichedNow.failed` — a completely broken run still produces a whole
itinerary. A refused **store** write is reported, not raised: the answers are
already in hand and serve this plan; what is lost is the next plan's cache hit.

One thing to know when testing this: `MODELS.enrich` and `MODELS.narrate` are the
**same model id**, and enrichment now runs in every plan. Filtering a fake
client's requests by model no longer picks out Pass C — `pipeline.test.ts` uses
the block count as well, because a narration carries the shared prefix plus a
per-stop block while an enrichment call is a system prompt and one place.

### `withBackoff` exists because `withRetry` retries instantly
Immediate retry is right for a one-off flake and useless against a rate limit —
sixty concurrent calls that all 429 will all retry in the same millisecond.
`withBackoff` waits exponentially and only for `isRetryable` errors: 429 and
5xx, plus anything with no status at all (transport). A 400 is our request being
wrong, and asking again buys the same answer at twice the price. `sleep` is
injected for the same reason `now` and `rng` are.
