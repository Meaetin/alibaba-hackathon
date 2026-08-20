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
