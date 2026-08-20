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
Copy `.env.local.example` → `.env.local`. Google Maps needs three keys
(API key + light/dark map IDs) or `/home`, `/collections/**` and
`/itineraries/**` degrade.

### Planner naming: `profile` describes the traveller, `options` describes the scheduler
`GenerateItineraryParams.preferences` was renamed to `options` (k-means/scheduler
knobs) so the new `profile?: PreferenceProfile` could sit beside it without either
being misread. Types live in `src/lib/planner/types.ts`. Never merge the two.

Likewise `buildClusters` → `buildLocalityPins` (`src/lib/maps/locality-pins.ts`):
that function groups entities by `"{region}, {country}"` for static-map pins. The
planner's geographic k-means is a separate module (`src/lib/planner/cluster.ts`).
Don't share code between them.

### `place-search.ts` is browser-only
It's built on the Maps JS `Place` class and needs a live `google.maps.Map`. Server-side
retrieval uses the Places REST API in `src/lib/planner/retrieval.ts`.

`normalizePlace` used to request `priceLevel` in the field mask and then drop it.
Both paths now go through `toPriceLevelOrdinal` (`src/lib/maps/price-level.ts`) —
keep it that way, or budget scoring loses its only input. `normalizePlace` and
`SEARCH_FIELDS` are module-private; export them if you need to test the mapping.

### Tests are Vitest, colocated
`npm test` (`vitest run`). Test files sit next to their module
(`src/lib/planner/score.test.ts`), fixtures in `__fixtures__/`. Randomness and
time are **injected parameters**, never ambient — k-means takes an `rng`, cache
expiry takes a `now`. Google and Anthropic clients are injected too; there is no
mocking framework. Build order and per-step assertions live in
`docs/implementation-plan.md`.
