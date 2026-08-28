/**
 * Google Maps usage counters.
 *
 * **These record nothing.** Each one called a pair of Supabase RPCs —
 * `track_user_api_usage` and `track_global_api_usage` — in a project this build
 * was never pointed at, so every call swallowed its own error and returned. The
 * functions survive because six map and place components call them on render,
 * and the honest version of "this does nothing" is a body that says so rather
 * than a `try/catch` that hides a failing request.
 *
 * Worth knowing before wiring them back: the planner already meters its own
 * Google spend properly, per stage, on `jobs.result.stats` — see
 * `src/lib/planner/` and the pricing notes in `AGENTS.md`. These count the
 * *browser's* Maps JS and Places calls, which nothing else sees. That is a real
 * gap, and closing it means a route and a table, not a client.
 */

export type PlacesSearchType = 'text' | 'nearby'

export async function trackMapLoad(): Promise<void> {}

export async function trackPlacesSearch(_type: PlacesSearchType): Promise<void> {}

export async function trackPlaceDetailsEnterprise(): Promise<void> {}

export async function trackPlacePhoto(): Promise<void> {}

export async function trackPlacesAutocomplete(): Promise<void> {}
