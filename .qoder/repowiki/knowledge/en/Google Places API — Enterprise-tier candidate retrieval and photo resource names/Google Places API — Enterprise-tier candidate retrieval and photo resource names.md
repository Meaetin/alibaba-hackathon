---
kind: external_dependency
name: Google Places API — Enterprise-tier candidate retrieval and photo resource names
slug: google-places-api
category: external_dependency
category_hints:
    - vendor_identity
    - sdk_real_api
    - client_constraint
scope:
    - '**'
source_files:
    - src/lib/maps/place-search.ts
    - src/lib/maps/price-level.ts
    - docs/personalization-pipeline.md
---

### Identity + role
The project uses Google's Places API at the **Enterprise tier** for two purposes: (1) retrieving place candidates via Text/Nearby Search with a field mask that includes `places.reviews`, `places.photos` (resource names only), `priceLevel`, opening hours, business status, etc.; (2) the browser-side map search path built on `@vis.gl/react-google-maps` which calls the Maps JS `Place` class.

### Integration points
- Server path (planned): `src/lib/planner/retrieval.ts` — hits the Places REST API directly with a fixed `SEARCH_FIELD_MASK`. The mask deliberately omits `editorialSummary` and stores photo *resource names* only; media resolution happens later in Step 12 when the itinerary is final.
- Price-level normalization goes through `src/lib/maps/price-level.ts` (`toPriceLevelOrdinal`) so both Maps JS (`"MODERATE"`) and REST (`"PRICE_LEVEL_MODERATE"`) strings converge to the same ordinal used by scoring.

### Stable usage model
- Retrieval is cache-first: each `(city | query | includedType)` hash is checked against `place_search_cache` before any billed call. Cache TTL is 30 days.
- Photos are resolved late: only the ~15 stops that survive the funnel get their resource names turned into actual image URLs (separate Places Photos SKU). Eager resolution is forbidden.
- The LLM never sees raw lat/lng or full opening-hours periods; only coarse `open_windows` hints are passed downstream.

### Client constraint
Enterprise tier returns up to ~20 places per billed request; a cold Tokyo plan costs roughly 50 such requests. The design assumes pre-warming the demo city ahead of time to avoid cold-start latency on stage.