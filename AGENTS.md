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
