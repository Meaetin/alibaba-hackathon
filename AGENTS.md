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

### The job queue is client-tracked, and the browser holds the pointer
`useJobsQueue` polls `GET /api/jobs/:id` through TanStack Query at 2s per job
and stops the moment a job reads `completed` or `failed` — a poll that never
stops is a bug you find on the bill. The watched ids live in React state and
enter only through `upsertJob`.

**Per-mount state alone was not enough, and the symptom was a card that only
appeared once the work was already done.** A plan queued on `/collections/[id]`
was invisible on `/home`: that page mounts with an empty list and nothing ever
told it the job existed. Pass `restoreFor: userId` and the hook mirrors its ids
into `localStorage` under that traveller (`src/lib/jobs/tracked.ts`) and seeds
from them on mount, so the card survives a navigation and a reload. All six call
sites pass it.

**Ids and types, never rows** — same rule `src/lib/persona/storage.ts` keeps
about the persona, and for the same reason: a stored copy would out-live the run
it describes. Keyed by traveller, because one browser can sign into two accounts.
Entries expire after an hour: a job whose Node process died mid-plan never
reaches a terminal status, so nothing else would ever stop the polling.

A terminal job is forgotten, **failures included**. The failed card stays on the
page that watched it fail — it carries the retry — but restoring it everywhere
would re-announce a failure the traveller has already read. `removeJob` forgets
it too, which is what makes dismissing a card stick; there is no detach endpoint
in this repo and `detachJob` was deleted, having only ever raised "Couldn't
dismiss that" over a dismissal that had already worked.

**Vitest's jsdom ships no `localStorage`**, so `tracked.ts` reads it off
`globalThis` and both test files stub a real `Map` behind the four methods it
calls. A "did not write" assertion has to count writes: storing the same list
back is byte-identical, so comparing the value before and after passes either
way. That one was caught by mutation.

The other half of the same bug was upstream. `handleGenerateItinerary` in
`useCollectionLocationBatchOperations` returns the `jobs` row, and `/links/[id]`
threw it away while `/collections/[id]` only toasted — so both pages rendered
`ItineraryLoadingScreen` with `job={null}`, a progress bar that never moved and
a plan that never redirected when it landed. It announces to the layout queue
itself now, and both pages seed their own `upsertJob`. Same lesson as the link
queue card: check the seam, not the component.

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
and still produces a trip.

`photoBlobKey(placeId, index, maxWidthPx)` is keyed by the **place**, which is
what makes a photo billable once across every itinerary. It used to hash the
photo resource name and the doc comment called that content-addressing — see the
next section for why that was wrong in both directions.

### A Google photo resource name is a per-response token, not an identifier
Run the same Text Search twice, seconds apart, and **all twenty places come back
with a different `photos[].name` for every photo**. Nothing about the place has
changed; the name is minted per response. This one false belief was wired into
two places and cost money in both.

**It wiped photos we had already paid for.** The `locations` upsert invalidated
`photo_urls` and `photos_resolved_at` whenever `photo_names` changed, which is
every single search. So each replan of a city silently un-resolved its whole
pool, and only the ~20 stops that survived *that* run bought their media back.
Measured on 2026-08-29 before the fix: **1,433 of 1,684 locations with photo
names had no resolved photo, and 144 of 686 itinerary stops rendered a grey
box** — a fifth of every trip in the database. The counters said everything was
fine, because from inside one run it was: `resolvePhotos` reported
`failures: []`, and the wipe happened later, during somebody else's plan.

**It defeated the blob cache.** A key derived from the name was new on every
run, so the bucket never hit and every plan re-fetched and re-stored the same
image under a fresh object. `blobHits` was 0 across every job on file.

Both are fixed. The upsert `coalesce`s photo state like `stay_duration` already
did, and `updatePhotoResolution` narrows by `place_id` alone — the old
`photo_names` term in its `where` could only ever refuse a write for media we
had just bought. `scripts/backfill-itinerary-photos.ts` (`npm run
photos:backfill`) repaired the existing rows; it targets stops in an itinerary
rather than all of `locations`, because paying the Photos SKU for a place nobody
will see is the mistake `resolvePhotos`' two-argument signature exists to make
inexpressible.

**The name expires; the `photoUri` looks like it does not, and this repo has
been claiming otherwise since 2026-08-23.** Measured 2026-08-29: two searches
give two names for one photo, and **both resolve to the identical
`lh3.googleusercontent.com` URL**, which carries no signature and no expiry
parameter. Resolving the same name twice returns that same URL again. Google's
docs say the *name* expires and must not be cached, and say nothing at all about
the URI's lifetime. So "the pipeline stores Google's expiring `photoUri`",
repeated in `photos.ts` and `docs/decisions.md`, is an assumption nobody has
tested — treat it as unproven rather than as a fact, and note that a genuinely
aged URL is no longer available to test with, because the backfill overwrote the
twelve that existed.

That weakens one argument for the bucket and not the other. Keep `PHOTO_BLOB_*`
set for **cost**: with it a photo is bought once ever across every itinerary,
which is measurable in `stats.blobHits` and was worth nothing at all while the
key was derived from the name.

**Both stores have to answer this the same way**, and only one of them was
tested. Breaking the in-memory `updatePhotoResolution` left all 30 offline tests
green while the Postgres equivalent went red — and every planner test runs
against the double, so the offline suite was proving nothing about what actually
gets written. `retrieval.test.ts` pins it now. All six guards in this change are
mutation-checked.

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

`DIETARY_CONFLICT_TYPES` is rung 2, and the rule for adding a type is **the
animal has to be the cuisine, not an item on the menu**. `steak_house` is in
because a steakhouse without steak is not a steakhouse. `chicken_restaurant`
was added on 2026-08-26 after a live Singapore run seated a vegetarian at
Poulet - VivoCity for dinner — Google was silent on `servesVegetarianFood` and
a four-entry list had nothing to say about it.

`sushi_restaurant` and `ramen_restaurant` were tried in the same change and
**rejected**: both name the carbohydrate. Gate A's Kyoto fixture contains Vegan
Ramen Uzu Kyoto, and the ramen rule deleted it — which is the whole reason that
fixture exists. Where such a place genuinely serves nothing, Google's direct
`false` catches it at rung 1, the rung that knows rather than guesses. Both
directions have a test in `score.test.ts`.

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
with the whole offline suite still green. It bills real money, so the only way
to run it is `npm run test:places` — `npm test` cannot see the file at all.

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

### `npm test` cannot reach an integration test — that is the gate
There are two Vitest configs. `vitest.config.ts` excludes
`**/*.integration.test.ts` outright, so the default run is offline and free.
`vitest.integration.config.ts` includes only those files, and the three scripts
that use it (`test:db`, `test:blobs`, `test:places`) pass it with `-c`. A
filename on the CLI only *filters* `include`; it cannot add back what `include`
omits, which is why a second config exists rather than an `exclude` override.

The `describe.skipIf(...)` guards are still there, but they are the second lock,
not the first. Vitest does **not** read `.env.local` — only Node's
`--env-file-if-exists=.env.local`, which those same three scripts pass, does.
So a bare `npm test` sees no `DATABASE_URL` or `GOOGLE_PLACES_API_KEY` however
full your `.env.local` is. Skipped is not the same as covered.

`src/lib/db/itineraries.test.ts` is named in the integration config explicitly:
it mixes pure row-shaper tests with one `DATABASE_URL`-gated `saveItinerary`
block, so the filename convention alone would miss it. It is the only such
exception — put new database or live-API tests in an `*.integration.test.ts`
file and nothing needs listing.

### Tests are Vitest, colocated
Test files sit next to their module
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

It came back. `src/lib/persona/profile.ts` shipped three of them in `0b87bd8` —
the `SIGNALS_BY_ANSWER` key and its doc comment — so the file that decides a
traveller's interests was invisible to `rg` for two days. Fixed 2026-08-28. Run
the sweep after any change that copies a memo key from another module; copying
the *escape* out of a rendered file gives you the byte.

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

### `planner_debug.scheduling` exists because a day shipped empty and nothing said so
A live Singapore run produced a three-day trip whose day three had **zero**
stops. The day was in `itinerary_days` with a date and an area name; it just had
no activities. Pass B had filled it and `sequenceDay` had routed it — 4.4 km,
86 travel minutes — and then `validateDay` emptied it. The only surviving trace
was `stats.scheduling.failedDays: 1`, which says how many days went wrong and
never which, or why.

Every field needed was already on `DayValidation` — `repairs`, `failures`,
`assumed` — and was thrown away when the request ended. `SchedulingRecord` keeps
the per-day version of it now, and `pipeline.ts` `console.warn`s an empty or
unfixed day as it happens, following the rule the assignment drops already
follow: the dev terminal is where somebody is actually looking while a plan runs.

`offered` counts Pass B's assignments **plus** the flex picks the packer may
promote. Counting assignments alone was the first version of this field, and it
rendered "kept 8 of 7" on a day where a spare was promoted.

Every day is listed, clean ones included, and the field is optional on the type —
so a plan made before it existed reads as "not recorded" rather than "nothing
went wrong". Same rule `sequencing` keeps one field up, and the same reason.

This is what bumped `PLANNER_DEBUG_VERSION` to **2**. Two tests pin that literal
(`pipeline.test.ts`, `route.test.ts`), deliberately: a shape change should have
to be conscious rather than absorbed.

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

### `hhmm` lives in `pack.ts`, and `validate.ts` re-exports it
Minutes from midnight to a clock face. There were already three copies
(`validate.ts`, `__tests__/harness.ts`, `utils/calendar.ts`) and the debug view
would have been a fourth. Note that `toHHMM` in `utils/calendar.ts` takes
fractional **hours** — a different unit, not a duplicate.

It moved out of `validate.ts` on 2026-08-28 because `pack.ts` had to render a
clock too — a dropped stop now names the meal it blocked and the time that meal
had to start by — and `pack.ts` may not import `validate.ts`, which imports it.
`pack.ts` is the only module that stamps a clock, so it is the right home. The
`export { hhmm } from "./pack"` line in `validate.ts` is there so the debug view
and every other caller keep the import they already had.

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


### An axis score is a percentile now, not an average — and that is why the quiz works
Averaging twelve option vectors is the central limit theorem applied to a
personality quiz. Enumerating all 3^12 = 531,441 answer sets showed what that
cost: **seven of the twelve archetypes were unreachable by any answer set**,
`culinary_nomad` and `bucket_list_chaser` took 99.1% between them, the averaged
`social` score never left 40..61, and **94.3% of answer sets read `mid` on all
four bands** — the row `resolvePlannerKnobs` answers with this planner's plain
defaults. For nineteen travellers in twenty the quiz moved no knob at all, and
every test was green because there is no assertion for an archetype nobody can
reach.

`scoreAnswers` does two things instead, both derived from `QUESTIONS` rather
than tuned: it weights each question by the spread between its highest and
lowest option on that axis (in steps of 15), then converts the weighted total to
its **percentile** among all 531,441 answer sets, counted exactly by a dynamic
program at first use. After: 12/12 reachable, every archetype between 4.8% and
15.4%, all four axes span 0..100, all 81 band combinations occur, 1.5% all
neutral. `npm run personas:reach` (`scripts/persona-reachability.ts`) prints the
whole picture in about a minute.

The percentile is what makes it self-maintaining. A stretch factor picked by
staring at a table goes stale the moment somebody edits one option's numbers and
nothing fails when it does; the table is rebuilt from `QUESTIONS`. The price is
honest and worth stating: the quiz **reacts** now — one changed answer of twelve
moves the archetype about 45% of the time against 17% before. A quiz that almost
never changes its answer is a quiz that is not reading the answers.

`matchArchetype`, the archetype centres and the band cuts at 33/66 are all
unchanged. So is `knobs.ts` — an absent persona and every `mid` band still
return today's constants, and no Gate A snapshot moved, because Gate A plans
without a persona.

**Re-scoring is automatic and that is the point.** `travel_personas` stores raw
answers and `POST /api/plan` rebuilds with `calculatePersona` on every plan, so
every stored persona now reads differently and most will show a different
archetype. `itineraries.persona` snapshots the whole `TravelPersona` per plan
(`request.persona ?? null` in `itineraries.ts`), so existing trips keep the
archetype they were built with.

### The archetype is a prior, not the traveller's taste
Twelve answers became four numbers, four numbers became one archetype, and that
archetype's fixed tag list became the whole trip. A real traveller who answered
"find the wild side", "hostel, camp, or wherever", "street food adventures",
"go immediately" and "an epic adventure" matched The Spontaneous Wanderer, whose
tags are cafes / street art / local markets / walking tours, and got a Singapore
trip of Orchard Road malls and art galleries. **No `outdoors` anywhere**, and
nothing downstream could tell the persona had contradicted the person.

`ANSWER_SIGNALS` in `profile.ts` reads the chosen options directly. Interests
are what the answers named, ordered by weight, with the archetype only topping
the list up to three; `typeAffinities` is the preset with the answers layered on
top and the **strongest opinion per type winning**, the same rule
`typeAffinityBonus` already applies. Pinned by question label **and** option
title, like `SIGNAL_QUESTIONS` — an index would move onto the wrong answer
silently.

Only options that name *content* are in the table. "Spreadsheet time" and "one
carry-on" describe a style and the four axes already read them; inventing a
taste from a style answer is how the archetype got it wrong to begin with. Two
options carry a **refusal** ("fuel for the journey", "politely decline") which
cannot push an interest down — there is no negative weight — but does stop the
archetype topping that interest back up.

The list is capped at five and floored at three because `affinity` in `score.ts`
is matched-over-total, so every extra interest dilutes the rest, and
`buildSearchPlan` bills a text search per interest.

Two gaps, named rather than papered over. The quiz never asks about evenings, so
`nightlife` reaches a profile only through the festival answer or the Social
Explorer preset. And a refusal does not yet damp the preset's *type* weights —
a traveller who said food is not the point can still carry `restaurant: 1.5`
from a culinary archetype.

### Three scripts drive the persona layer, and only one of them spends money
`npm run personas:reach` is the enumeration described two sections up — offline,
free, about a minute, and the source of the witness answer sets that
`quiz.reachability.test.ts` freezes. `npm run personas:plan` sends all seven travellers in
`scripts/travellers.ts` through `POST /api/persona` and `POST /api/plan`
against a running dev server, sequentially, and writes every result to the
gitignored `scripts/output/persona-trips.json`. `npm run personas:report` reads
that file back, so the comparison can be re-shaped without re-planning seven
trips. The runner re-scores all seven answer sets first and refuses to start if
any lands on a different archetype or different bands than it claims.

Scripts run on bare Node, which cannot resolve `./presets` without an extension
or `@/lib/...` at all — both are bundler conventions that everything under
`src/` relies on. `scripts/lib/resolve-hooks.mjs` handles that, installed with
`node --import`. It runs only **after** Node's own resolution has failed, so it
cannot change what already resolves. Note that type-only imports are erased
before resolution, which is why some `src/` modules import cleanly on bare Node
and others do not — the difference is invisible until it bites.


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

### A themed circle must ask for food, and must ask for the *nearest* food
Two changes from one live Bali run. Day three, "Nusa Dua Museum Day", shipped
**three stops and no lunch**: `validateDay` reported `lost_meal` because the
nearest place Google calls a restaurant was **8 km away**, in Kuta. All 813
tests were green.

**`explorePlaces` sent `theme.includedTypes` and nothing else.** A museum day
asked Google for museums and got them. The city-wide Text Searches never cover
a resort strip either — "specialty coffee Bali" returns Kuta and Seminyak,
because that is what is prominent — so the Nearby Search was the only thing that
could have found Nusa Dua's food, and it was never asked. Every themed anchor
now gets **two** circles: the premise circle and a meal circle carrying
`mealSearchTypes(dietary)` from `taxonomy.ts`.

Two circles and not one merged type list, because **a Nearby Search returns at
most twenty places**. Shared between museums and restaurants that is ten of
each, and the day needs both.

`mealSearchTypes` deliberately skips the pool-vocabulary half of
`isSearchableType`. That rule kills types a *model* invented; a constant in our
own source is not invented, and requiring a cold city's first pool to already
contain the word `restaurant` is how a day ends up with nothing to eat. It keeps
the other half — a descriptive-only type still 400s the whole circle — and
`taxonomy.test.ts` pins every entry against `NON_SEARCHABLE_TYPES` rather than
filtering at runtime, because silently dropping one would trade a loud 400 for a
quiet empty circle. A dietary need **widens** the list and never replaces it:
Google types a vegetarian izakaya `izakaya_restaurant`, so asking only for
`vegetarian_restaurant` is how a vegetarian gets nowhere to eat rather than
somewhere to ask. Both directions have a test.

**The meal circle's radius is identical to the premise circle's, and that is a
decision.** The Bali day failed on types, not distance — its two nearest food
places were 1.1 km inside a circle that was never asked about food. A wider meal
circle would also return restaurants beyond `MEMBER_RADIUS_SLACK`, which
`groupByTheme` then refuses to seat on the day anyway. One variable moves, which
is what makes its effect measurable.

**`rankPreference` was never set, so Google was ranking by `POPULARITY`.** That
answers a different question from the one every circle here asks: the twenty
most prominent places *anywhere in the circle*, not the twenty nearest. On a
4 km circle round a Nusa Dua museum that is twenty places in Kuta. It is also
why `feasibility.ts`'s **widen** rung could never fix a thin day — a bigger
circle ranked by popularity walks further from the anchor, not closer, so
"search wider" was reliably the wrong instrument. `NEARBY_RANK_PREFERENCE` is
`DISTANCE` now.

It lives on `NearbySearch` rather than as a bare constant in `runSearch`,
because `searchCacheKey` has to include it: the same circle ranked two ways is
two different answers, and a popularity-ranked entry written before this change
must not serve a distance-ranked request.

**Widening the circle is not the lever, and this is worth knowing before
reaching for it.** Google's ceiling is 50 km and `NEARBY_MAX_RADIUS_METERS`
already holds it, but a request returns at most 20 places however big the
circle. More circles with different type sets is the answer; one bigger circle
is not.

### `food_court` seats a meal, and the fixtures said otherwise
Of 20 `food_court` rows in the live store, **12 carry no `restaurant` type at
all**: `food_court, food, point_of_interest, establishment` and nothing more.
Satay Street @ Lau Pa Sat, Chinatown Food Street, Kopitiam Food Hall, Hill
Street Hainanese Curry Rice. Every one is somewhere you eat lunch, and every one
was invisible to `isRestaurant` — retrieved, scored, ranked, and then unable to
hold the meal slot it exists to hold. The Bali warung failure at scale.

`singapore-candidates.json` argues the opposite, which is why this is written
down. All nine of its food courts are the big named hawker centres, and Google
*does* type those `food_court, market, restaurant` — so both Gate A snapshots
pass with or without the rule, and **neither fixture can protect it**.
`taxonomy.test.ts` writes the bare four-type shape out by hand for that reason.

`meal_takeaway` is searched for and deliberately **not** seated: all seven live
rows carrying it already carry `restaurant`, so promoting it would assert
something no evidence supports, and a takeaway counter is a weaker claim to a
seventy-five-minute meal slot than a food hall is. Both directions have a test,
and a test asserts the general rule — every type in `MEAL_SEARCH_TYPES` must
either be seatable or be one of the two that hold a `cafe_break`. A search type
nothing can seat is the warung bug written fresh.

Adding this turned up two **private copies** of the predicate, in
`funnel.test.ts` and `assign.test.ts`, which is exactly the "fifth copy" its
doc comment warns about. Both went on asserting the old rule and both still
passed. They import the real one now.

### "Can this day feed itself" has to mean *this traveller*, and it runs before hydration
`mealCapacity` counted bare `isRestaurant`, so a vegetarian's cluster of five
steakhouses read as perfectly feasible. The ladder never fired, nothing was
widened, nothing was borrowed — and the traveller met the problem at
`selectMealCandidates` rung 3, "limited vegetarian options, call ahead", after
every circle had been billed for. **A ladder can only repair a shortage it can
see.** `mealCapacity(cluster, dietary)` now asks `violatesDietaryNeed`, imported
from `score.ts` rather than re-derived, so the stage that *counts* meal capacity
and the stage that later *enforces* it cannot disagree. `borrow` filters the
same way: lending a vegetarian five steakhouses satisfies the arithmetic and
feeds nobody. No dietary needs counts exactly as before, which is what keeps
every other traveller's plan identical.

**Only rung 2 is reachable here, and that is worth knowing before trusting it.**
`repairFeasibility` runs inside `planThemedDays`, which is pipeline step 2;
`servesVegetarianFood` arrives with `hydrateShortlist` at step 3. So Google's
direct boolean is always `undefined` at this point and the count falls to
`DIETARY_CONFLICT_TYPES` — the type guess. That catches a steakhouse district,
which is the case that prompted this, and it will miss a place only Google knows
about. Hydrating earlier is not the fix: hydration is the Atmosphere-tier call
and it is shortlist-only on purpose.

**The unit tests for this all passed with the pipeline wiring deleted.**
`feasibility.test.ts` proves the ladder fires once it is *told* who the
traveller is, and every one of those assertions stayed green when
`dietary: request.profile.dietary` was removed from `pipeline.ts`. A unit test
of a function nothing calls with the right argument is not coverage. The
argument has its own test in `pipeline.test.ts` now — same pool, every
restaurant turned into a steakhouse, and the vegetarian run must buy a widening
search the omnivore does not.

### Near AND notable is two circles, because `rankPreference` is one enum
A themed anchor gets three Nearby Searches: the premise ranked by `DISTANCE`,
the premise ranked by `POPULARITY`, and the meal circle by `DISTANCE`.

Neither ranking is wrong; they answer different questions. Distance alone never
returns the famous museum three kilometres out. Popularity alone returned twenty
places in Kuta for a circle centred in Nusa Dua. The reason to buy both rather
than pick one is that **which the traveller wants is already a persona
decision** — `weights.popularity` is signed and `touristTrapPenalty` sets its
direction, so a deep-immersion traveller wants the obscure place and a
highlights traveller wants the famous one. Ranking at the Google layer discards
one tail twenty places before `scorePlace` ever sees it, and no knob downstream
can get it back. Union first, decide after. Overlap is free — `retrievePlaces`
dedupes and counts `duplicatesDropped`.

The meal circle stays distance-only: lunch has to be walkable from the rest of
the day, and among the near ones the scorer can still prefer the popular one.

`nearbyRequest`'s `query` field carries the rank (`nearby:museum@distance`)
because two circles now differ by nothing else, and a `stats.failures` entry
reading `nearby:museum` twice names neither of them.

### A ladder that fails silently, and a counter that bills the wrong day
Two halves of one blind spot, both found on the Bali run and both fixed together.

**`repairs` only ever held rungs that worked.** A repair is pushed when
`after > before`, so a day that walked all three rungs and fixed nothing left no
trace whatsoever. Bali's day three did exactly that — zero places to eat,
widened and found none, no donor within reach, no better geography — and the
only surviving evidence in the entire run was `validateDay` reporting
`lost_meal` at the very end. `FeasibilityAttempt` records every day that entered
the ladder, fixed or not, with the rungs it walked in order. Same rule
`SchedulingRecord` keeps: "it tried and failed" and "it never ran" are different
answers and an absent row cannot tell them apart.

The debug page rendered `repairs.length === 0` as **"No day needed the
feasibility ladder"**, which on that run was false twice over. It reads
`attempts` now, three-way: `undefined` is an older plan, `[]` is genuinely
clean, and a non-empty list names each day and whether it is still short.

**`explorePlaces` runs twice and only the first was counted.** The `widen`
closure kept `wider.places` and dropped `wider.stats`, so
`stats.explore.billedCalls` reported the opening circles and none of the extra
searches bought for the days going worst — *the days that cost the most read as
the cheapest*. Measured on the Kyoto themed fixture: **12 real `searchNearby`
calls, 9 reported.** Each widen is three circles now rather than one, so the gap
tripled when the premise/popularity/meal split landed. `mergeRetrievalStats`
folds them in.

`failures` matters more than the money there. A widening search that 400s — and
a live Singapore run lost two of three circles to an unsearchable type — was
discarded with the rest of the stats, so "the ladder tried and found nothing"
and "the request was rejected" looked identical.

**`groupByTheme`'s `unclaimed` is on the row now**, not just a `console.warn`
nobody reads after the request ends. It was **87 of 151** on Bali. Note it is
still only a *count*: the places themselves are discarded, which is what stops
`validate.ts` reaching them when a day has nothing to eat.

This is what bumped `PLANNER_DEBUG_VERSION` to **3**. Two tests pin that literal
(`pipeline.test.ts`, `route.test.ts`), deliberately.

One assertion here was written worthless and caught by mutation:
`expect(unclaimed).toBeGreaterThanOrEqual(0)` passes for a dead counter. It
asserts `> 0` against the Kyoto fixture, where three walkable circles cannot
cover 86 places.

### A starving day can reach the places no theme would claim
`groupByTheme` refuses a place further from an anchor than `MEMBER_RADIUS_SLACK`
allows. That rule is right and it leaves **over half the pool on the floor** —
45 of 84 located on the Kyoto fixture, 87 of 151 on a live Bali run, every one
already retrieved and already billed for. Meanwhile `alternatesFor` only ever
offered the day's *own* cluster, so a themed day whose circle held nothing
edible shipped `lost_meal` while the restaurants that would have fixed it sat
unused three streets away.

`GroupResult.unclaimed` is the **places** now, not a count — a count cannot be
handed to a day that needs somewhere to eat.

Three rules keep this from being the "5.7 km cafe" bug again:

- **Meal-capable only, and this traveller's meals.** Filtered by
  `mealSlotReason`, the same predicate `validate.ts` enforces — offering a
  candidate the validator will refuse a moment later is how a repair path
  silently does nothing.
- **The containment is structural, not a promise.** `admits` refuses a
  restaurant for a plain `activity` and `withFill` excludes restaurants
  outright, so a list of restaurants can reach a meal slot or a `cafe_break`
  and nothing else. Putting a *sight* in the reserve would have no such guard.
- **A hard distance cap, deliberately wider than membership.** These places are
  outside the membership reach by definition, so reusing that bound returns
  nothing. It is `radiusFor(hint) * MEMBER_RADIUS_SLACK + walkMaxMeters` — the
  day's own circle plus one hop as far as this traveller travels between stops.

Sorted nearest-first and appended **last**, so the cluster's own ranked
candidates are always spent first. Reserve entries score `0`: they never
competed in the funnel, and a borrowed number would rank them against places
that earned theirs.

**Know how narrow this is before relying on it.** For a `walkable` theme the
reserve's range (1800–3800 m) sits *inside* the widen rung's circle (4000 m),
and widen pushes what it finds straight into the cluster without a membership
check. So on the commonest theme size the reserve only earns its keep when
widen **fails or comes back thin** — a 400 on an unsearchable type, or the
20-result cap hiding a restaurant a text search already found. It is a genuine
backstop for `tight` and `wide` themes, where the widen circle does not cover
the reserve range, and a backstop for a failed widen everywhere else. That is
less than it first sounds like, and it is the honest scope.

**`reserve` is a required argument on purpose.** An empty reserve behaves
exactly like no reserve, so a caller that quietly stopped passing it would keep
every assertion green — a mutation test confirmed it. Making it a parameter
turns that into a compile error. A caller with nothing to offer passes
`NO_MEAL_RESERVE` and says so on the page.

### A dietary need is a phrase, not just a type — and it is asked where the day is
`includedTypes` is coarse on exactly this question. Google types a great
vegetarian-friendly izakaya `izakaya_restaurant`, never
`vegetarian_restaurant`, so a meal circle asking for types finds the places that
**label** themselves and misses everywhere that simply has good vegetarian food.
That is the long tail `taxonomy.ts` has always said Text Search is for.

`dietaryBridgeFor(need).queries` already carried the phrases. They were only
ever fired **city-wide**, by `buildSearchPlan`, where the results cluster
wherever the city is busiest rather than where any given day actually is. On a
three-day trip that is one neighbourhood's worth of answers standing in for
three. Each themed anchor now also gets those phrases, biased to the same circle
the premise and meal circles use — `textNearRequest` in `retrieval.ts`.

**`locationBias` biases, it does not restrict** — Google may still answer with
something outside the circle. That is safe rather than sloppy: an anchored find
too far from the day is refused by `MEMBER_RADIUS_SLACK` at grouping, and the
meal reserve caps its own reach. The stray result is dropped downstream instead
of seated.

It is in `searchCacheKey`. The same phrase asked in two neighbourhoods is two
different answers, and neither may serve the city-wide call `buildSearchPlan`
already made with the identical `textQuery`.

Two rules on what gets asked, both with a test. **Only a traveller with a need
pays** — an empty `dietary` fires nothing at all. And **a need with no phrases
in the bridge fires nothing**, rather than a query we invented: an invented
query is a billed call returning whatever Google makes of a word we chose.

A negative never goes in one of these. "no seafood" matches seafood
restaurants; refusals are `DIETARY_CONFLICT_TYPES`' job, after the search.

Note the offline suite proves the **requests** and can prove nothing about the
answers: `createFakeGoogle` pages through its fixture and ignores `textQuery`,
`includedTypes`, `rankPreference` and `locationBias` alike. Every circle around
one anchor comes back identical. Only a live run tests the response layer.

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

### A day can also run long at the *end*, and `pickVictim` needs blame for that too
The mirror of the late-lunch rule two sections up, found on a live Singapore
trip for a cafés-and-nightlife persona: three days that were **offered 9, 8 and
8 stops and shipped 2, 3 and 2**, with no repair, no failure and no meal missing
its window. Every survivor was a meal. Nothing in the trip said why.

`blockedBefore` narrows blame only when a *meal* misses its window. A day that
instead runs past `dayEndMin` set nothing, so `pickVictim` fell back to the
globally lowest-scored stop — and on a day with a hard anchor in it, that is
almost always a stop whose removal moves the end of the day by **zero minutes**.
Dinner re-anchors at 18:00 however early you arrive, so shedding the 9 AM coffee
cannot bring a 23:15 nightcap home. The day shed its whole morning by score
before it reached the two bars behind dinner that were the cause.

`stampDay` returns `overrunFrom` now: the index of the last stop that **waited**
for its window. A stop that waits swallows every spare minute in front of it, so
blame is that stop and everything after it. Measured on the real day — the
packer dropped six stops and kept three; dropping the one stop that actually
caused the overrun keeps all eight others.

Three things worth knowing before touching it:

- **The waiting stop is inside its own blame set.** Dropping it does shorten the
  tail, because everything after it then stops waiting too.
- **`blockedBefore` wins when both are set.** A stamp that failed on a meal
  window never reached the end of the day, so its overrun is not yet a fact.
  Both are read from the *same* stamp in `fitDay` so they cannot describe
  different attempts.
- **Neither Gate A city can see this.** Both fixtures are sight-heavy, so no day
  ends with a stop behind a waiting anchor. Instrumented, the new narrowing
  fires on **32 of 53** drops across the two snapshots and changes the victim in
  **none** of them — the path is well covered and simply agrees there. Neither
  snapshot moved. A fixture that ships bars after dinner would close the gap.

**Squeezing per segment was considered and rejected.** It changes no outcome.
When a day eventually fits, `growDay` gives the wasted minutes straight back —
a morning stop cut for nothing grows into idle time the lunch anchor was going
to waste anyway, and growth before an anchor never competes with growth after
it. When a day cannot fit, the squeeze is irrelevant: the search already reaches
"every ordinary stop on its floor", shrinking never delays anything downstream,
so if any set of sizes fits then the all-floors set fits. The proportional
squeeze **cannot miss a feasible day**. What imprecision remains is `growDay`'s
greedy grow-back within one segment, which is a different function's problem.

One test in `pack.test.ts` was green for the wrong reason and is fixed:
`'still drops by score when the day merely runs long'` claimed no meal missed
its window while its dinner arrived at 1245 against a 1200 latest start. The
fifteen-minute pace buffer on each leg is what hid it — it had been exercising
`blockedBefore` and would have passed whatever the overrun rule said.

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

### Travel: the matrix still exists, it is just no longer the default
`PipelineDeps.routing` picks between `travel-estimate.ts` (free, a model) and
`routes.ts` (billed, a measurement), and it defaults to **`"estimate"`**. That
reverses this repo's usual rule about product defaults living at the caller, on
purpose: the rule is about choices that change what a traveller gets, and this
one changes what a run *spends*. A library whose default is to spend money bills
whoever forgets it is there. `stats.travel.source` says which path answered, and
is `undefined` when a caller injected `getTravelLeg` and neither ran — "zero
requests" and "we never asked" are different answers.

The trigger was 29,310 billed elements over a couple of weeks of demo trips. Two
matrices per day over a day's stops **plus its spares plus six replacements** is
about 650 elements a day; nothing cached a leg, so every replan of Singapore
bought the same pairs again. If you turn the matrix back on, cache legs first —
a `(from, to, mode, weekday)` table is the missing piece, not a smaller `N`.

**The estimator was fitted, not guessed, and the fit is the interesting part.**
Against 81 legs Google really routed (seven travellers, sixteen complete days,
recovered from `scripts/output/persona-trips.json` joined to `locations`), the
old `createStraightLineTravel` understated **53 of them and overstated 3**, and
understated a whole day's travel by 525 minutes out of 2440. That is not noise:
the packer believes the day is 22% emptier than it is, fills it, and the
validator then drops what will not fit — so some of the "offered 8, shipped 2"
days were this. The replacement is crow-flight × **1.5** (median measured 1.52),
80 street m/min on foot, and 8 minutes plus 225 street m/min on transit. After:
3.8 minutes of error per leg against 7.3, 434 m against 844 m, bias gone (18
over, 19 under), a day's total out by 4% rather than 22%. Fitting on six
travellers and testing on the seventh held (1.9–6.4 min), so it is not seven
trips of overfitting.

**What is genuinely lost is the mode.** Whether the bus beats the walk needs a
timetable and nobody gives those away at city scale, so the choice is a
threshold again — the exact thing `routes.ts` was written to stop. It agrees
with Google on 89% of those 81 legs. The threshold is the traveller's own
`walkMaxMeters`, plus the same `TRANSIT_MIN_SAVING_MINUTES` margin the matrix
uses, which puts the crossover at 1614 street metres. Importing that margin from
`routes.ts` rather than redeclaring it is deliberate: a measured leg and an
estimated one must not disagree about when boarding is worth it.

The rest of this section is about the matrix, and all of it still holds when you
ask for it.

Measured against Google on day one of the Singapore
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

**Everything degrades to the estimator**, which is how this could fail
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

### Auth is ours, it lives in Neon, and Supabase is gone
Accounts are `users` + `sessions` beside the trips they own. Email and password,
`scrypt` from `node:crypto` (no dependency), and an **opaque** session token in
an httpOnly cookie whose **sha256 is what the row stores** — a `sessions` row
cannot be replayed as a login, so a database dump is not a set of live sessions.
Signing out is a delete, which is the thing a stateless JWT cannot offer.

**Every handler reads the cookie off `request.headers`, never through
`next/headers`.** That is the same rule that put `personaId` in the plan route's
body: a handler stays a pure `Request → Response` and `route.test.ts` drives it
with no request scope. `userFor(request, deps)` in `app/api/deps.ts` is the one
place a request becomes a person, and it takes the store so the seam holds. The
single exception is `/itineraries/[id]/debug`, a server component with no
`Request` to read — and no handler test either.

`middleware.ts` checks that a cookie **exists** and nothing more. It runs on the
Edge runtime, which cannot reach Neon, so it is a redirect for looks and every
route that guards something checks for real. This is also why
`SESSION_COOKIE_NAME` lives alone in `src/lib/auth/cookie.ts`: importing it from
`session.ts` drags in `node:crypto` and the middleware fails to build — a
failure `tsc` cannot see, because it is a runtime constraint.

**The persona is no longer named on the wire.** `POST /api/plan` reads it from
the session via `personas.getByUser`, and `travel_personas.user_id` is unique,
which is what the table's own prose has always promised. A client-supplied
`personaId` survives in exactly one place — sign-up and sign-in — where it
claims a persona taken *before* this app had accounts. That is a migration path,
not a general seam.

**`saveItinerary(result, ownerId)` takes the owner as a second argument.** The
planner never learns that users exist: `runPlan` builds the result, and the
route handler — the only thing holding a session — says whose it is.

**Somebody else's trip is a 404, never a 403.** A 403 confirms the id names a
real itinerary, which is the one fact an outsider wants. An itinerary with a
**null** owner is nobody's and is also a 404.

The Supabase strip removed `src/lib/supabase/**` and both `@supabase/*`
packages. Two things to know about what is left:

- **The types outlived the queries.** `FilterType`, `RecentContentItem`,
  `SearchResponse`, `LocationReference`, `ProfileRow` and friends moved to
  `src/lib/domain-types.ts`, which is where `Surface` and `QuotaType` already
  sat after the PostHog strip. `ItineraryDetail` and friends now come straight
  from `src/lib/db/itinerary-detail.ts` — the re-export through
  `supabase/queries/home.ts` is gone and twenty imports moved.
- **A hook with no backend returns empty and says so in its doc comment.**
  `useSearchQuery`, `useRecentlyViewedQuery`, `useLocationReferencesQuery`,
  `useEntityLocationsQuery`, `useCollaboratorProfilesQuery`, `useRecordView` and
  `usePaginatedContent` are all in that state. That is not the same as the old
  behaviour, which was a *failing request* that looked identical from the
  outside — the difference is that the emptiness is now written down.

  **A write does the opposite: it throws.** `src/lib/api/attachments.ts` and the
  add-to-collection paths raise a plain sentence rather than resolving. An empty
  list is a true statement; an upload that silently stores nothing is a lie the
  traveller finds out about later.

`useMapClusters` and `useDashboardRecent` were genuinely rewired rather than
emptied — both read `GET /api/itineraries`, which is the one list that exists.
`RawMapLocation` moved into `locality-pins.ts`, with the function that consumes
it, so deleting a backend can never again take an input type with it.

### `GET /api/itineraries` is new, and its absence is why the grid looked empty
`getItineraries()` called the dead REST backend on `:8080`, the query failed, and
`data = []` renders exactly like "no itineraries yet". Auth without this endpoint
scopes nothing anybody can see.

`readItineraryList` (`src/lib/db/itinerary-list.ts`) is three aggregate queries,
not `readItineraryDetail` in a loop — a grid of twenty cards needs a name, a
date, a photo and a count, not every opening period in the trip. Three fields
are decisions and all three **call into `itinerary-detail.ts`** rather than
restating it: `end_date` via `endDateFor`, `overview` via `overviewFrom`, and
`thumbnail_url` as the first stop with a resolved photo. A card and the page it
opens disagreeing about a trip's end date is the bug nobody reports and
everybody notices.

`updated_at` reports the creation time, because `itineraries` has no
`updated_at` and the page is read-only. `is_public`, `is_bookmarked`,
`is_archived` and `collection_id` are pinned to their off value: they belong to
features that left with the old backend, and the card components still take them.

### The first account claims the trips that have no owner, once
Thirty-seven itineraries were planned before this app had accounts. The first
sign-up takes them, and **the guard is inside the SQL** —
`(select count(*) from users) = 1` in the same `update` — because the Neon HTTP
driver has no read-then-write transaction, the same constraint `saveItinerary`
documents about itself. Two simultaneous sign-ups: at most one claims.

It is one-shot and spent on first use. **If you create a throwaway account to
test something, delete it before handing the app over**, or the real first
sign-up inherits nothing. `itineraries.user_id` is `on delete set null`
precisely so that undoing this is possible; `travel_personas.user_id` is
`cascade`, so a deleted account takes its persona with it.

### Mutation-checking with `git checkout --` will eat your work
The rule in this file says to break a rule and confirm a test goes red. Doing
that with `git checkout -- <file>` to revert reverts the file to **HEAD**, which
throws away every real change in it, not just the mutation — and on an untracked
file it fails outright and leaves the mutation in place. Both happened here.
Revert with the exact inverse edit instead.

All eight guards in this change are mutation-checked: the two 401 gates, the
owner check, the one-shot claim, the password length guard, session expiry, the
logout delete, and the persona being keyed on the user rather than on the id the
browser sent.

### Travel preferences live on `users.preferences`, and the server owns the derivation
A jsonb column, not a table: exactly one set per person, no history wanted, and
`users` is already the per-person row. Same decision as `itineraries.persona`
being a snapshot rather than a join.

**Only `selectedIds` crosses the wire.** The planner-ready `profile` inside
`SavedTravelPreferences` is derived by `createSavedPreferences` from the picked
ids *and* the traveller's persona, and `PUT /api/preferences` rebuilds it on
every write from its own copy of the persona. So a retuned
`buildPreferenceProfile`, or a retaken quiz, reaches the stored row instead of
being frozen at whatever some browser computed on the day. It is the rule
`POST /api/persona` already keeps about `calculatePersona`, applied a second
time. A client-sent `profile` is ignored and a test sends one.

An id the registry no longer knows is **dropped, not rejected** — a stale id
from an older build is a preference that is gone, which is a reason to forget it
rather than to fail the save and lose the eleven beside it.

**Nothing plans with them yet.** `createItineraryRouted` still sends
`LOCAL_DEMO_PROFILE`, so `preferences.profile` is computed, stored and read by
nobody but the profile page's chips. That is the same shape as the Pass C bug
this file already records — four things written, three rendered nowhere. Moving
them server-side is what makes the wiring possible; the wiring itself has not
happened.

### The profile page still keeps two things in `localStorage`, and one is a duplicate
`argo:profile-banner:` is a cosmetic index and per-browser is defensible.

`argo:persona:` is **not**. It caches a whole `PersonaResult` under the user id
while `travel_personas` holds the answers server-side, so the profile page can
show one archetype while the planner uses another — exactly the failure mode
`src/lib/persona/storage.ts` documents when it explains why the browser holds
only a pointer: "a cached copy of the scores would quietly out-live a change to
the scoring tables and there would be no way to tell." `PersonaQuizDialog`
already POSTs the answers to `/api/persona`; the profile page then writes its
own second copy. Fixing it needs a `GET /api/persona`, which does not exist.

### PRs merged into a feature branch are not on `main`
`gh pr view` reports a PR as `MERGED` when it lands in **its own base branch**.
PR #5 (preferences) targeted `feature/travel-persona` and PR #6 (flights)
targeted `feature/atlas-flight`; only PR #7 targeted `main`. So for two weeks
the preferences module was "merged" and absent from every branch anybody worked
on. Check `baseRefName`, or `git merge-base --is-ancestor`, before assuming a
merged PR is in the tree.

`feature/atlas-flight` is still unmerged — `/flights`, the seat map and
`PRODUCT.md` are not on this branch.

### Saved preferences fill `interestOverrides` — the seam that was waiting for them
`PlanRequest.interestOverrides` has carried a comment since it was added saying
it is "the named seam for when there is" an interest-picking UI. The preferences
dialog is that UI. `POST /api/plan` reads `users.preferences` from the session
and `composeProfile` folds it in, so a picked tag beats the archetype's inferred
list — the same "a thing the user typed beats a thing the quiz inferred" rule
the rest of the persona layer keeps.

Three contributions, three different merge rules, and none of them is arbitrary:

- **Interests become overrides.** A picked tag is a stated choice; the
  archetype's list is an inference.
- **Dietary is a union, never a replacement.** It is the one hard filter in the
  funnel, and dropping half of one is how somebody is seated at a steakhouse.
- **Type affinities merge, strongest opinion per type winning** — the rule
  `deriveTypeAffinities` already uses to layer answers onto a preset and the one
  `typeAffinityBonus` uses when a place carries several mapped types. Both maps
  are on the **same scale** (1.0 neutral, read as an offset), so it is a merge
  and not a conversion. `buildPreferenceProfile`'s 1.35 is +0.35, inside
  `TYPE_AFFINITY_MAX`.

**Pace and budget are deliberately not taken from preferences.** Their values in
`SavedTravelPreferences.profile` are derived from the persona by
`buildPreferenceProfile`, so reading them would be reading the persona through a
stale copy — the persona itself is right there, and the trip form beats both.

A traveller with preferences and **no** persona still gets them: routing
everything through `buildProfile` would drop them silently, because that
function needs a persona to run at all. There is a test for that path.

**One test here was written vacuous and only a mutation caught it.** The
registry's first `dietary` entry is literally `vegetarian`, which is also what
`route.test.ts`'s fixture profile sends — so union and replacement produced the
identical list and the assertion held whatever the rule said. It now picks a
need that differs from the form's, on purpose. When testing a merge, make the
two sides *distinguishable* first.

### The persona is read from the server now, and `localStorage` holds only the pointer
`GET /api/persona` returns `{ id, answers, result }` and **rebuilds the result
from the answers**, never from the stored `dimensions` / `archetype` columns —
which is why `travel_personas` keeps the answers at all. Answers this quiz can
no longer score read as `null`, not a 500: a row written by an older question
set is a persona we no longer have, not a server fault.

The profile page used to keep a whole `PersonaResult` in `localStorage` beside
that row, so it could show one archetype while the planner used another. That is
precisely the cached copy `src/lib/persona/storage.ts` explains the browser
avoids. Only `argo:profile-banner:` is left in `localStorage`, and it is a
cosmetic index.

### A `cafe_break` before lunch used to destroy the whole morning
`assign.ts` tells Pass B, in as many words, that "a role says what a stop is,
never when it is — a scheduler stamps the times afterwards." So the model tags a
coffee shop `cafe_break` because it **is** one, and puts it first in the day
because that is when you drink coffee. `stampDay` then read the same role as a
*time*: `DAY_SKELETON` gives `cafe_break` a window of 15:30–17:00 and the open
end was a hard floor (`start = Math.max(arrival, opens)`), so that cafe could
not be seated before 15:30, so lunch behind it could not start by 13:30, so
`blockedBefore` fired and `pickVictim` dropped every stop in front of lunch.

Measured on a live Ubud trip: **nine dropped stops across three days, every one
of them pre-lunch, and not one stop after lunch dropped on any day.** All three
days opened at 11:30 with lunch; two of them ended at 19:15 against a 21:00
limit, having shed three stops each. Replayed with the real coordinates,
durations and persona knobs, day one reproduces to the minute with the two
morning cafes tagged `cafe_break` — and keeps all six stops, 09:00 to 20:30,
with them tagged `activity`.

**Only meals wait now.** A `cafe_break` starts when you arrive, exactly like an
`activity`. The window still governs `fillIdle`, which is what it was written
for and what its own doc comment describes: labelling an afternoon lull as a
coffee, not moving a stop the traveller was given in an order somebody chose.
The comment beside the old code already claimed "the cafe window is a preference
that yields" — it yielded at the late end (`start = arrival`) and not at the
early end, and that asymmetry was the bug.

**Neither Gate A snapshot contains a single assigned `cafe_break`** — the
harness never emits one — so both fixtures passed whatever this rule said, and
neither moved when it changed. That is why `pack.test.ts` writes the case out by
hand, the same reason `taxonomy.test.ts` hand-writes the bare `food_court`
shape. The invariant suite only window-checks meals, and `admits` in
`validate.ts` already tests a non-meal replacement against the segment's *real*
times rather than the nominal window, so nothing else in the tree assumed a cafe
sat between 15:30 and 17:00.

**A drop now says which of the two things went wrong.** `packDay` stamped
`OVER_BUDGET_REASON` on every removal, and on that Ubud trip the sentence "over
budget — no room left in the day" was printed under days ending at 19:15 with a
two-and-a-half-hour hole in the morning. `blockedMealReason` names the meal and
its latest start instead; `OVER_BUDGET_REASON` is kept for the days that really
did run past `dayEndMin`, which on that trip was exactly one of the three. Both
directions have a test.

### `city` is a string, and a string is not a place — `PlanRequest.base` is
A live Bali trip planned as `city: "Bali"` came back as three days a province
apart: Bedugul in the north, Ubud in the middle, Uluwatu on the southern cliffs,
each about two hours' drive from the next. Nothing was broken. `buildSearchPlan`
interpolated the word into "specialty coffee Bali", Google answered for an
island 150 km across, and the themes anchored wherever the pool happened to be.
`themes.unclaimed` was **215 of 388** — more than half the places we paid for
sat outside every day's reach.

The coordinate was there the whole time. `NewItineraryModal` runs a Google
`PlaceAutocomplete` and puts `latitude` / `longitude` on its submit payload;
`createItineraryRouted` passed them to the blank-itinerary path and **dropped
them on the planning path**. Same shape as the Pass C bug this file already
records — collected, carried, read by nobody.

`PlanBase` is `{ latitude, longitude, radiusMeters? }`, defaulting to
`DEFAULT_BASE_RADIUS_METERS` (25 km — Ubud to Denpasar, and Kyoto is 20 km
across). Deliberately **not** a persona knob: `walkMaxMeters` answers "how far
will you walk between two stops", which is a different question, and reading one
as the other bounds a trip by somebody's tolerance for pavement.

**One radius, used twice, clamped once.** `resolveBase` clamps to
`NEARBY_MAX_RADIUS_METERS` because `textNearRequest` already clamps its own copy
— without the same clamp a 200 km request would *search* a 50 km circle and then
*keep* everything within 200 km, a bound looser than the search it enforces.

- **The circle biases retrieval.** `buildSearchPlan` takes an optional `near`
  and wraps every query in `textNearRequest`. A bias is not a restriction and
  that is fine; the pool filter enforces.
- **`withinReach` in `pipeline.ts` is the enforcement**, applied to the whole
  pool immediately after retrieval — so a themed `anchorPlaceId`, which must
  already be an id from the pool, is inside the circle **structurally**. Same
  kind of guarantee as the hallucination defence, not a sentence in a prompt.
  Nothing was added to the theme prompt for this and nothing should be.
- **A place with no coordinates is kept.** Silence is not evidence of distance,
  `runFunnel` already takes the unlocated as their own bucket, and nothing can
  seat one on a day anyway.
- **It returns two lists**, not a filtered one. These are places we paid Google
  for and then refused; `stats.base.dropped` counts them and `runPlan` warns on
  the terminal. A high number is not waste to optimise away — it is the
  measurement saying the search string answers for a wider area than the
  traveller is in.

**Absent must plan exactly as before, byte for byte.** `buildSearchPlan` with no
`near` produces identical requests *and identical cache keys* — a stray
`locationBias` on every text search would orphan every pre-warmed city row at
once, and nothing would report it: the run would just be slower and cost more.
`stats.base` is **omitted** rather than zeroed when no base was sent, the same
rule `StageUsage` keeps. Three tests pin all of it.

The route validates the coordinate rather than passing it through, because it
reaches `metersBetween` — which answers a *number* for a longitude of 3000. Every
place would read as out of reach and the trip would come back empty with nothing
to say why.

**What this does not do**, so nobody assumes it: nothing models where you sleep
in *time*. There are still no hotel legs at the start and end of a day and no
travel between days, so a day ending at 21:00 an hour from the base costs
nothing in the packer. That is the change that touches `pack.ts` and both Gate A
snapshots, and it has not happened.

### Most stops that go missing were dropped by the packer, and nothing said so
A live Bali day rendered "kept 4 of 7 offered" with one repair line under it.
Three stops had vanished and the debug page said nothing whatsoever about them —
not a name, not a reason, no swap-in. The reasons existed the whole time.

`packDay` cuts a stop when the day runs out of minutes and records it in
`PackedDay.dropped` with a plain sentence ("over budget — no room left in the
day"). `validateDay`'s `settle()` merges its own rung-2 cuts into that same list
on purpose, so a reader never has to know which module removed a stop. Then
`pipeline.ts` built `SchedulingRecord` from `repairs` and `failures` only and
threw the list away. The single survivor was `stats.scheduling.dropped` — a
trip-wide total, which is the "how many, never which" shape `SchedulingRecord`
was written to replace. The fix landed for repairs and failures and stopped one
field short.

**A packer cut has no replacement and never will.** `validate.ts` swaps for
three rules (`closed`, `meal_slot`, `lost_meal`); a cut for time is not one of
them, because putting a different place in the same slot spends the same
minutes. `pickVictim` removes and moves on. That is the pace knob working, not a
failure — but it has to be *visible*, which is the whole of this change.

`SchedulingRecord.dropped` is optional, so an older row reads "not recorded"
rather than "nothing was dropped". Three chips, not two: `N dropped` when the
list is non-empty, `drops not recorded` when it is absent and `scheduled <
offered`, and `clean` only when the day really is. The first version of that
chain called a day that lost three stops clean.

The **view** dedupes and the record does not. A rung-2 cut is on a repair line
already as "→ dropped" and is also in `PackedDay.dropped`; printing both reads
as two stops lost. `cutsOf` filters by name — a repair records the removed stop
by name, not by id. Keep the stored list complete and decide presentation in the
component.

This is what bumped `PLANNER_DEBUG_VERSION` to **4**. Two tests pin that literal
(`pipeline.test.ts`, `route.test.ts`), deliberately. All four new guards are
mutation-checked.

### `signedIn()` scopes its user ids, and the reason is a bug it already caused
Every call built a fresh `createInMemoryUserStore` whose id sequence restarts at
1, so **two travellers in one test shared an id**. That silently turns every
"somebody else cannot see this" assertion into a comparison of a thing with
itself. A `GET /api/persona` test caught it by failing; the assertions that
would have passed anyway are the worry, and there were already several.

Ids are `00000000-0000-4000-8000-{call}{n}` now, still deterministic because the
counter only moves forward and nothing there reads a clock or a random number.

### Frame OCR is not the optional half of link analysis — it is often the only half
`src/lib/links/**` is Argo's content-analysis worker (`backend/worker`) with the
cloud removed: no Pub/Sub, no checkpoint artifacts, no Supabase row, no retry
counter carried between attempts. Six stages in one local process — RapidAPI for
metadata and media URLs, ffmpeg for audio and frames, Whisper, OpenAI vision OCR,
one extraction call, then `retrievePlaces` to turn each named place into a
`locations` row.

**The first real video tested returned a 3-character transcript.** "3 Singapore
Food Centres You Must Eat At" is 43 seconds of music over captions; Whisper
heard the word "You" and nothing else. Every place in that result came from the
twelve OCR lines and the description. A transcript-only pipeline would have
returned a summary, a country and an empty list, and looked like it worked —
which is why OCR was added back after being cut from the first plan.

**Two runs of the same video named 8 places, then 3.** The prompt never told the
model to read the description as carefully as the transcript, and on that post
the five stall names are only in the description. Saying so explicitly took it
to a stable 11/11 across three runs — and cost precision: the description opens
with a paragraph of history, so "Ellenborough Market" (closed) matched a café of
that name and "The Central" matched a mall. Argo's *text* prompt already
excluded "locations mentioned only as background context"; its *video* prompt
did not, and this port inherited the gap. With that exclusion the same video is
a stable 8/8, all of them places the video actually recommends.

**A Text Search almost always returns something, so `no_match` rarely fires.**
That makes a hallucinated or historical name resolve to a real, wrong place
rather than to nothing. Precision has to be won in the prompt; the resolver
cannot recover it. Two mentions can also be one venue — "Lau Pa Sat" and "Telok
Ayer Market" are the same market — so `stats.locationsDistinct` counts place ids
while `resolved` keeps every mention. Same rule the debug page keeps: the record
stays complete, the view decides.

Chain outlets resolve to whichever branch Google ranks first (Lao Ban Soya
Beancurd came back as the Sengkang branch for an Old Airport Road video). Fixing
that needs a `locationBias` circle, which needs a coordinate the pipeline does
not have.

`detail: "low"` on the vision calls is a cost decision with a known edge: it caps
the image at 512px, which reads overlay captions comfortably and will miss small
background signage. Measured at ~107 input tokens per frame, so a 43-second clip
costs about $0.003 all in — the Whisper minute costs more than the OCR does.

### yt-dlp was tried first and lost to TikTok on the first attempt
The link pipeline originally used yt-dlp: one binary, no API key, metadata and
media in a single call, and `uploader_id` gave the YouTube `@handle` that Argo
pays a *second* RapidAPI endpoint to recover. It worked on three YouTube videos
and then failed on the first TikTok with `Unable to extract universal data for
rehydration`, on a build ten days old. That is the tax on scraping — the
extractor breaks when the platform changes its page, and it breaks for everyone
at once. `createRapidApiMediaSource` is Argo's `social-download-all-in-one` path
ported back in.

Two things carried over from that experiment. `MediaSource` splits into
`inspect` (the billed call, returning metadata **and** the media URLs) and
`download` (bandwidth only), so the duration cap still refuses a seventeen-minute
video after one cheap call and before any bytes move. And the RapidAPI response
has **no caption field distinct from the title**, so `metadata.description` is
empty on this path where yt-dlp filled it — which matters, because a YouTube
description is where a creator lists every stall they visited, and that is
exactly where five of one test video's eight places came from. On TikTok the
title *is* the caption, so nothing is lost there.

**A TikTok slideshow is not an edge case.** `duration: 0`, images, no video
track — and travel content is full of them. `download` returns a discriminated
union rather than a path: a slideshow's own pictures go straight to OCR as
frames, ffmpeg never runs, and transcription is not attempted at all. Not
attempting it is deliberately different from failing it — an image post with no
speech is working as intended, so it must not appear in `stats.failures`. Both
directions have a test.

### `content` is the library a link job produces, and `jobs` is only the queue
A `jobs` row is about a *run*: no owner, no delete, no dedupe. `content` +
`content_locations` are the artifact, and the split is the one the planner
already makes between `jobs` and `itineraries`. The full pipeline output stays
on `jobs.result` — transcript, OCR lines, counters, model spend — and is
diagnostics; `content` holds the handful of fields a card and a detail page
read, plus the places.

`content_locations.location_id` has **no cascade**, deliberately. `locations` is
the shared Places cache, so deleting a link must not delete a restaurant three
other links and an itinerary point at. Verified against Neon: deleting a link
took its `content_locations` rows and left `locations` at 1794.

`mention` is stored beside the place it resolved to. Without it there is no way
to see that a name matched the wrong venue, which is this pipeline's known
failure mode — a Text Search almost always returns *something*, so `no_match`
almost never fires and a hallucinated name becomes a real, wrong place.

**`normalized_url` must keep YouTube's `v` parameter.** The first version
stripped the whole query string on the theory that all three platforms identify
a video by its path. TikTok and Instagram do; YouTube does for `youtu.be/ID` and
`/shorts/ID` and does **not** for `watch?v=ID`. So every watch URL collapsed to
`youtube.com/watch`, and the second YouTube link anybody pasted came back
"already analyzed" pointing at the first. Found by pasting two, and every unit
test passed through it because they all used TikTok URLs. It canonicalizes
through `youtubeVideoId` now — the same extractor the media source uses — so the
id we fetch by and the id we deduplicate by cannot drift.

### The link job is served at `POST /api/jobs`, and `authFetch` is same-origin now
`createJob` in `src/lib/api/client.ts` has always posted `{ type, payload }` to
`/api/jobs`, and `GET /api/jobs/[id]` is the poller both pages already use. So
the handler lives there rather than at a prettier `/api/links/*` path that would
have needed an adapter whose only job is to undo a rename. `jobs.type` is
`"content-analysis"` for the same reason: it is the string `/links` and `/home`
already pass to `useJobsQueue`.

`API_URL` in `client.ts` defaulted to `http://localhost:8080`, a REST backend
this repo does not contain, so every call left the app to fail against nothing.
It defaults to **same-origin**. The endpoints Next now serves reach the real
thing and carry the session cookie; the rest 404 instead of hitting a connection
refused. Both are failures, only one is honest about where it looked — on a
loaded `/links` page that is `/api/profile/quota` and `/api/collections`, and
their empty states already handle it. **Leave `NEXT_PUBLIC_API_URL` blank**;
pointing it elsewhere sends those requests off-origin without the cookie.

`content_id` rides on `jobs.result`, not on a column. `buildOptimisticContent`
keys the finished card on it so the queue card morphs into the link card in the
same grid slot. A `jobs.content_id` column would be a second place to keep one
fact true.

### Photos are resolved for a link's places, and it is the only per-place cost
Retrieval stores photo resource *names* for free; turning one into an image
bills the Places Photos SKU. `analyzeLink` calls `resolvePhotos` over the places
that **resolved**, never the pool, at one photo each — the same rule the planner
follows with `survivorIdsFromDays`. Without it every location card on
`/links/[id]` is a grey box, which is what the first live run looked like.

It is folded into the resolve stage rather than given its own progress stage: it
is a handful of parallel fetches on a step that already takes seconds, and the
stage weights in `progress.ts` are measured rather than invented. A failure is
counted on `stats.photosResolved` and in `failures` — a place with no picture is
a card with a grey box, not a lost link.

### Two link tests passed by luck because OCR batches run four at a time
`runFrameOcr` fans out at concurrency 4, so `client.requests` is in **arrival**
order, not batch order. Two assertions indexed into it positionally
(`prompts[2]`, `toEqual([10, 10, 5])`) and passed for days, then went red once
the suite got busy enough to reorder them. Both sort now. When asserting over a
fan-out, sort or key by something in the payload — the fake in `ocr.test.ts`
identifies a batch by decoding its first frame, for exactly this reason.

### Flights are persisted now, and `/flights` is gone
`itinerary_flights` hangs off `itineraries`, not off a day: the planner never
produces a flight, never schedules one, and `itinerary_activities` is keyed on a
`day_id` and a `position` a flight has no answer for. Deleting a trip takes its
flights by cascade; nothing else points at them.

**Nothing about a flight used to survive a reload, and it was not a bug in one
place.** `completeFlightBooking` only called `setFlights`. Manual add, edit and
delete all reached `NEXT_PUBLIC_API_URL` — the REST backend on `:8080` this repo
does not contain. And **nothing ever loaded flights on mount**, so even a
working write would have shown an empty tab on the next visit. All three are
fixed together; fixing any one alone would have looked identical from outside.

The columns are `ExtractedFlight`'s, field for field. That name is historical —
the first flights came out of a PDF — but it is the type the card, the manual
form and the edit form already speak, so a row reaches a card with no rename
layer. `seat` and `passenger_name` are the two additions, both from the booking
confirmation and both previously visible only on the confirmation screen; `seat`
renders on the card now, because a column nothing reads is the pattern this file
already warns about.

**Dates and clock times are stored apart** (`date` + `text`). That is how an
airline states them and how every form collects them: a departure is "14 Sep,
23:55 local", not an instant. Composing them needs the airport's timezone, which
this app does not have.

**`cost` is text, and the read must not `Number()` it.** The first version did,
and a smoke test against Neon showed "412.50" coming back as `412.5` — a decimal
amount through binary floating point, quietly missing its cents. `ExtractedFlight.cost`
is a string end to end now.

`source` is `booked | manual | extracted`, held by a check constraint. An
*invalid* one falls back to `manual` rather than failing the write: the flight is
real either way, and refusing to save a traveller's booking over a label loses
the thing that matters to keep the thing that does not.

Two things the routes keep that are worth not re-deriving. `refuseUnlessOwner`
(`access.ts`) answers **404, never 403** for somebody else's trip, and a
database failure throws past it so the handler can answer 500 — an outage must
not render as a missing trip. And every single-flight write narrows by the
itinerary **and** the flight id in the same `where`, so an id guessed from one
trip cannot be edited or deleted through another.

`parse.ts` and `access.ts` sit beside the handlers for the reason `deps.ts`
does: a route file may export only its handler.

**A booking that fails to save still shows its card, and the toast says so.**
The traveller has a ticket number either way and the airline was not asked
whether we managed to file it.

Eleven of twelve guards here are mutation-checked green→red. The twelfth is
worth knowing: **the allowlist that stops a browser choosing its own `id` exists
twice** — `toFlightInput` in `parse.ts` and `toColumns` in `src/lib/db/flights.ts`
— and turning *either* into a spread leaves all 25 tests passing. Only both
together go red. Real defence in depth, and a standing reminder that a green
suite is not evidence the layer you are editing works.

PDF extraction is the one flight call still unbacked. It needs a
document-extraction service; it keeps its `NEXT_PUBLIC_API_URL` base so it fails
against a named address rather than 404ing on our own origin.

**`/flights` was deleted**, with its layout and the home page's "Discover
flights" `CreateCard` and carousel slide. Everything it did — Atlas fare search,
the booking flow, the seat map — the itinerary Flight tab already did, and the
page had no way to attach a booking to a trip. `/api/flights/search` stays; the
tab depends on it. The home bento's create block is an L of three now, and the
feed flows into the fourth cell.

Flight price watches are still React state and still lost on reload. Different
feature, different table, not done.

### `hashvatar` is in `package.json` and was missing from `node_modules`
Every page 500'd with `Module not found: hashvatar/react` — `/home`, `/links`,
all of them — and `tsc` had been reporting it as a lone unrelated error the whole
time. `npm install` fixes it. If every route dies at once and the trace names a
package rather than your code, check `node_modules` before debugging the page.


### A job the client never seeds is a job with no card, and the card was already built
`/links` had the whole loading card — `LinkQueueCard` with the video's poster
frame, a progress bar walking measured stage weights, a failed state with a
retry button — and it had never once rendered. `handleLinkSubmit` did
`await createJob(...)` and **threw the returned row away**, and `useJobsQueue`
starts watching an id only through `upsertJob`. So the link analysed fine, the
`content` row landed, and the page showed nothing at all until the next refresh.
`/home`'s content-analysis queue had the same hole, which is why its "Link
finished analyzing" toast could never fire either.

Nothing downstream was wrong. `runLinkJob` writes progress at every stage and
`toLinkJobProgress` has always carried the thumbnail; RapidAPI's `inspect` is
the first stage, so the frame is on the row from the `download` write onward and
the card is a grey box for about two seconds before it fills.

The lesson is the one this file keeps writing down from the other end: a
component with no data source renders an empty state, which looks exactly like
"nothing is happening". Check the seam, not the component.

### Retry re-runs the row it was given, and `queued` is what resets the bar
`POST /api/jobs/[id]/retry` resets the failed row and starts `runLinkJob` on it
again. A second `POST /api/jobs` would also work and would hand back a **second
id**, so the card the traveller clicked would leave the grid and a different one
would appear — while this way `useJobsQueue` is already polling the id.

`runLinkJob` moved to `src/app/api/jobs/run.ts` for it, because a route file may
export only its handler.

Three things decided here:

- **The reset writes `status: "queued"`, not `processing`.**
  `useProgressAnimation` refuses to walk backwards while a job is processing —
  by design, since a reconcile pass can hand it a staler row than the poll it
  already applied. A retry stamped `processing` therefore leaves the bar parked
  at the percentage the failure died on. `queued` is the one status that reads
  as zero.
- **The failed run's thumbnail is kept and passed into the new run.** The
  metadata stage has none of its own until RapidAPI answers, so without the seed
  a retry blanks the card for two seconds. Same reason `runLinkJob` holds the
  thumbnail across stages, one level up.
- **`LINK_STUCK_MS` lives in `progress.ts` and is imported by both sides.** The
  card offers a retry on an in-flight job that has been silent for fifteen
  minutes; an endpoint using a different bound would answer "it is still
  running" to the one thing the traveller can see is not.

**The remove button is gone from the link queue card.** `/api/jobs/[id]/detach`
does not exist in this repo, so the X dropped the card and then raised
"Couldn't remove link, try again later." A card that only lives until the next
reload does not need one.

### Three assertions in the retry suite passed while testing nothing
Mutation-checking all eleven guards caught them, and each was a different way of
being green for free:

- **Two 409s that no assertion could tell apart.** The "already finished" test
  used a row whose `updated_at` was current, so the *still running* rung refused
  it first. It passed with the completed guard deleted. Both tests assert the
  message now, and the finished one is silent past `LINK_STUCK_MS` so only its
  own rung can fire.
- **A reset of a field nothing can populate.** `result: null` was in the patch
  and asserted, but only a finished run writes a result and a finished run is
  refused — so the line could never turn red. Removed, with the reason written
  where it was.
- **A seeded thumbnail asserted after the seed stopped mattering.** The test read
  the row *after* the fake pipeline had reported a later stage carrying its own
  metadata. It blocks inside the metadata stage now and reads the row there,
  which is the only window where the seed is the only thing on the row.

### The collections UI was complete and had no backend at all
`src/lib/api/collections.ts` called fourteen endpoints and **none of them
existed**. The create modal, the rubber-band selection toolbar, the "Save to"
pickers on `/links/[id]` and `/itineraries/[id]`, the detail grid, the map, the
inline create-and-save — all of it shipped, none of it had ever talked to
anything. `handleAddToDestination` threw on purpose and `createItineraryRouted`
threw on any selection. Two tables and six routes turned the whole surface on;
two UI files changed.

`collections` + `collection_locations`, and the junction's `location_id` carries
**no cascade** — the same rule `content_locations` keeps. `locations` is the
shared Places cache, so removing a place from one traveller's shelf must not
delete a restaurant an itinerary and three links also point at. That identity is
also what makes "save this place from a video" free: a link's card, a
collection's card and an itinerary activity all hold the same `locations.id`.

`CollectionStore` (`src/lib/db/collections.ts`) follows `content.ts` — port,
Postgres implementation, in-memory double — and keeps the same ownership rule:
**somebody else's collection is a 404, never a 403**, with the owner check inside
the `where` rather than as a comparison afterwards.

Two rules worth knowing before touching `addLocations`. It reports what
**landed**, never what was offered: `{ added, duplicates, unknown }`, because a
toast reading "added 8" over a grid showing 6 is the lie nobody reports. And it
moves `updated_at` only when something actually changed — `/collections` sorts
by it, so a no-op add that reordered the grid would be a write the traveller did
not make.

What is deliberately still missing: collaborators, invite and public tokens
(`InviteModal` and `/collections/public/[token]` 404 exactly as before), and
`POST /api/collections/[id]/locations/from-google-maps`, so the "Add place"
button on the collection page still fails.

### A finished plan gets a companion collection, and the link is on the collection
The ported cards have always assumed every itinerary has a backing collection —
`ActionToolbarItinerary.collectionId`, with a comment claiming the database
enforces it. Saving a place "to a trip" means saving it to that trip's shelf: an
itinerary is a schedule and a place with no day and no time has nowhere to sit
in one.

`collections.itinerary_id` is unique and nullable, so a collection either backs
a trip or is free-standing. The foreign key sits on **this** side rather than as
`itineraries.collection_id` for two reasons: cascade runs the right way
(deleting a trip takes its companion; deleting the companion leaves the trip),
and `itineraries` gains no column that every row planned before this would have
left null.

It is created by `POST /api/plan`, never by `saveItinerary` — the planner does
not know shelves exist, the same rule that makes the route and not the store
decide who owns a trip. **A failed shelf must not fail the trip**: the itinerary
is already written and is the thing the traveller asked for, so the failure is
logged, exactly the ladder `resolvePersona` and `resolvePreferences` follow. A
trip with no located stops gets **no** collection rather than an empty one —
an empty shelf reads as "this trip saved nothing", which is a different and
wrong statement.

**A companion is hidden from `listCollections`, and only from there.** The trip
is already in the grid as a trip, so listing its shelf beside it shows one set of
places twice under two names. The filter is `isNull(collections.itinerary_id)` in
the store — one place, because `GET /api/collections` is what the grid, the
rubber-band toolbar and all three "Save to" pickers read. `readCollection` still
answers for it: the "Save to itinerary" menus post places to that id, so hidden
from the list must not mean gone.

Two assertions in `collections.test.ts` used `listCollections` to prove a
companion had or had not been created, and both now pass whatever the creation
rule says. They read `store.rows` instead. Watch the double's id sequence when
seeding a row beside a companion — `nextId` starts at
`00000000-0000-4000-a000-000000000001`, so a hand-written row on that id is
silently overwritten by the shelf the test then mints.

**Older trips have no companion and nothing backfills one.** `readItineraryList`
returns `collection_id: ""` for them, and the three "Save to itinerary" menus
filter on it. Posting places to a collection id of `""` would be a write that
quietly does nothing.

### `seedPlaceIds` plans from the traveller's own picks — and a seed is not a pin
`createItineraryRouted` used to throw on any selection: "the local planner does
not accept pinned place ids yet." It does now, as `PlanRequest.seedPlaceIds`.

The route takes `seedLocationIds` (`locations.id`, which is what every card in
this app holds) and translates once through `placeIdsForLocationIds` in
`stores.ts`; the planner speaks `place_id` from retrieval to the funnel and
neither side learns the other's identifier. An id with no row is **dropped**, not
raised — a stale selection must not lose the other eleven places somebody
picked — and surfaces as `stats.seeds.missing`.

In `runPlan` the seeds are read from `LocationStore` and merged by `withSeeds`
after retrieval. Three rules, each a decision: a seed already in the pool is not
added twice (the retrieved row is the fresher one); a seed **skips the base
circle**, because `withinReach` exists to stop a search string answering for a
whole province and a place somebody ticked is not a stray search result; and an
id with no stored row is counted, never searched for. `stats.base.kept` reads
`reach.kept.length` and not `pool.length` for the same reason — otherwise the
base reports a circle wider than the one it enforced.

`FunnelOptions.pinned` is how they rank. Picks sort first at the per-cluster cap
and are admitted ahead of the greedy walk at the global cap, which exempts them
from the restaurant and cuisine quotas — a quota exists to stop a shortlist
*nobody chose* being all noodles. They are **not** exempt from the hard filters
(a shut door is a fact, not a preference) nor from the caps themselves, and both
tails are recorded in `dropped` with their own wording.

Two things that had to move for this and are worth knowing:

- **The reserve loop's restaurant count is now guarded by `isRestaurant`.** It
  used to increment unconditionally, which was safe only while the reserve held
  restaurants and nothing else. A picked museum counted as one would have shrunk
  the quota for everybody.
- **A cluster's best few restaurants are held out of the competition for the
  per-cluster cap whenever anything is pinned.** Without it a traveller who
  picks twenty sights in one neighbourhood takes every slot, the meal reserve
  finds no restaurant left to reserve, and the day ships with nowhere to eat —
  `lost_meal` arriving by a new route. `held` is empty when nothing was picked,
  so both Gate A snapshots are untouched.

**Say this out loud before anyone relies on it: a seed reaching the shortlist is
not a seat in the trip.** Pass B still decides which day a place belongs to and
`packDay` can still drop it for time like any other stop. There is no locked-stop
concept in this planner and adding one touches `funnel`, `assign`, `pack` and
`validate`. `stats.seeds` and the day list are the only honest answers to "did my
places make it".

The pipeline wiring has its own test, because `withSeeds` and the funnel's
`pinned` both pass while nothing hands them anything — which is the failure this
file already records twice (`dietary: request.profile.dietary`, and the
feasibility ladder). `RunOptions.stored` in `pipeline.test.ts` seeds
`LocationStore` with a row no search can reach, which is the only way to prove a
seed came out of the store rather than out of retrieval.
