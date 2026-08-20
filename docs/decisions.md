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
  better `description` from review snippets instead. Consequence:
  `places.reviews` is now enrichment's only free-text input, and the Pass C
  failure fallback becomes `enrichment.description` + `match_reasons`.
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
