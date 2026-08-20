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
