---
kind: external_dependency
name: Neon serverless Postgres — replacement for Supabase data layer
slug: neon-postgres
category: external_dependency
category_hints:
    - vendor_identity
    - migration_status
scope:
    - '**'
source_files:
    - docs/personalization-pipeline.md
    - docs/implementation-plan.md
---

### Identity + role
Neon is chosen as the database backend to replace the existing Supabase data layer. It is plain Postgres accessed via `@neondatabase/serverless` with Drizzle ORM, deployed as serverless functions inside Next.js route handlers.

### Migration status
Supabase is still present in the codebase (`@supabase/supabase-js`, `@supabase/ssr`, `src/lib/supabase/**`) but is explicitly marked as unwired — pages render empty states against it. The new pipeline will use Neon instead. Realtime capabilities (`useItineraryRealtime`, `useJobsQueue` Supabase channels) are being replaced with TanStack Query polling against `GET /api/jobs/:id` because Neon has no browser-facing realtime equivalent.

### Schema surface
Planned tables include `locations` (cached Google data), `place_search_cache` (30-day TTL), `place_enrichments` (90-day TTL keyed by place_id + model + prompt_version + source_hash), `area_guides`, `itineraries`, `itinerary_days`, `itinerary_activities`, and `jobs` (queue with progress JSON).

### Why Neon here
- Plain Postgres DDL without Supabase-specific RLS/storage/auth.
- Serverless driver works in route handlers without connection pooling.
- Drizzle collapses the three-way column sync problem between select projections, realtime hydration strings, and TS types into one source of truth.