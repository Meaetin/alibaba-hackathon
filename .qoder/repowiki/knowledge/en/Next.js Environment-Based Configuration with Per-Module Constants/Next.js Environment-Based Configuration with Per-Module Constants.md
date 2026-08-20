---
kind: configuration_system
name: Next.js Environment-Based Configuration with Per-Module Constants
category: configuration_system
scope:
    - '**'
source_files:
    - .env.local.example
    - next.config.js
    - src/lib/site.ts
    - src/lib/supabase/client.ts
    - src/lib/api/client.ts
    - src/components/ui/map/GoogleMapCluster.tsx
    - src/components/ui/map/GoogleMapDetail.tsx
    - src/components/ui/primitives/PlaceAutocomplete.tsx
---

## What system/approach is used

This Next.js 15 App Router application uses a **pure environment-variable configuration system** with no dedicated config loader library. All runtime configuration is supplied via `NEXT_PUBLIC_*` environment variables (readable at build time and in the browser) and consumed directly as module-level constants throughout the codebase. There are no YAML/JSON/TOML config files, no feature-flag framework, and no centralized config object — each module that needs configuration reads `process.env.NEXT_PUBLIC_*` at import time.

## Key files and packages

- `.env.local.example` — single source of truth for required env vars; documents every variable consumers expect.
- `next.config.js` — Next.js build-time configuration (remote image allowlist, strict mode, experimental package imports).
- `src/lib/site.ts` — centralizes `SITE_URL` derived from `NEXT_PUBLIC_SITE_URL`, with a trailing-slash normalization and `http://localhost:3000` fallback.
- `src/lib/supabase/client.ts` — creates the Supabase browser client using `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- `src/lib/api/client.ts` — defines `API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'` and provides authenticated fetch helpers (`authFetch`, `unwrap`, `ensureOk`) that attach the Supabase session JWT as a Bearer token to all backend calls.
- `src/components/ui/map/GoogleMapCluster.tsx` and `src/components/ui/map/GoogleMapDetail.tsx` — read `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID_LIGHT`, `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID_DARK` at module scope to configure Google Maps.
- `src/components/ui/primitives/PlaceAutocomplete.tsx` — also reads the Google Maps API key.

## Architecture and conventions

1. **Environment variable naming**: Every configurable value is exposed to the browser under the `NEXT_PUBLIC_` prefix. The example file documents the full contract:
   - `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase client credentials.
   - `NEXT_PUBLIC_API_URL` — REST backend base URL (Supabase JWT sent as bearer).
   - `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` / `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID_LIGHT` / `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID_DARK` — Google Maps integration.
   - `NEXT_PUBLIC_SITE_URL` — canonical origin for metadata/OG tags (used only in `src/lib/site.ts`).

2. **Per-module constant pattern**: Each module declares its own top-level `const API_URL = ...` or `const API_KEY = ...` by reading `process.env`. This means there is no shared config module — duplication is intentional and expected. Consumers import the module rather than importing a config singleton.

3. **Fallback defaults**: Where a missing env var would break functionality, modules provide sensible defaults:
   - `API_URL` falls back to `http://localhost:8080`.
   - `SITE_URL` falls back to `http://localhost:3000` and strips trailing slashes.
   - Map IDs fall back to `'map-light'` / `'map-dark'`.
   - Google Maps API key falls back to an empty string (the Google Maps SDK will fail gracefully if not provided).

4. **Strict vs optional keys**: Supabase client uses non-null assertions (`!`) on `SUPABASE_URL` and `SUPABASE_ANON_KEY`, treating them as required — they must be present at runtime. Optional values use `?? ''` or `|| '...'` instead.

5. **Build-time vs runtime separation**: `next.config.js` holds static build configuration (image remote patterns, experimental flags). Runtime service endpoints and secrets live exclusively in environment variables. There is no distinction between dev/prod config files — deployment targets supply different env values.

6. **Auth-bound API access**: The API client (`src/lib/api/client.ts`) does not accept a per-call auth token; it resolves the current Supabase session once per request via `getAuthToken()` and injects `Authorization: Bearer <token>` automatically. This centralizes auth header handling so callers never touch tokens directly.

## Conventions and constraints

- **All public configuration goes through `NEXT_PUBLIC_*` env vars.** No other mechanism (config files, query params, props) is used to configure services like Supabase, the REST API, or Google Maps.
- **New service integrations should add their env vars to `.env.local.example`** and consume them as module-level `process.env.NEXT_PUBLIC_*` constants, following the established pattern in `site.ts`, `supabase/client.ts`, and `api/client.ts`.
- **Required vs optional env vars are distinguished by assertion style**: required vars use `process.env.X!` (non-null assertion); optional vars use `process.env.X ?? default` or `process.env.X || default`.
- **The `next.config.js` remotePatterns list is the authoritative allowlist for external images**; new image hosts must be added here for `<Image />` to work in production.
- **There is no feature flag system**. Conditional behavior is driven by component props or React state, not by runtime flags loaded from configuration.
- **Secrets are not stored in this repo**. Only a `.env.local.example` template is committed; actual `.env.local` is gitignored.