/** Which page/surface an action was initiated from. */
export type Surface =
  | 'dashboard'
  | 'links'
  | 'link_detail'
  | 'collections'
  | 'collection_detail'
  | 'itineraries'
  | 'itinerary_detail'
  | 'map'
  | 'search'
  | 'navbar'
  | 'public_share'

/** The two entities that support sharing, collaborators and public tokens. */
export type ShareableEntity = 'collection' | 'itinerary'

/** Which quota a user ran into. */
export type QuotaType = 'link' | 'itinerary'

/**
 * Which slice of a traveller's stuff a dashboard grid is showing.
 *
 * This and `RecentContentItem` used to live in `src/lib/supabase/queries/home.ts`
 * alongside the Supabase query that built them. That module is gone — Supabase
 * was never configured in this build and nothing read a real row through it —
 * but the card components are typed against these, so the types outlive the
 * backend exactly as `Surface` and `QuotaType` above outlived PostHog.
 *
 * `itinerary`, `collection` and `links` are wired into the dashboard today.
 * The remaining values name features whose backend left with the old REST API
 * and are kept because the filter chips, empty states and card variants still
 * reference them.
 */
export type FilterType =
  | 'recent'
  | 'itinerary'
  | 'collection'
  | 'links'
  | 'location'
  | 'favorites'
  | 'archived'

/** One card in a dashboard grid, whatever kind of thing it points at. */
export type RecentContentItem = {
  id: string
  type: 'itinerary' | 'collection' | 'link' | 'location'
  name: string
  thumbnail_url?: string | null
  preview_images?: string[]
  updated_at: string
  is_bookmarked?: boolean
  is_archived?: boolean
  metadata?: Record<string, unknown>
}

/* ─── Types that outlived the Supabase backend ───────────────────────────────
 *
 * Everything below described a table in a Supabase project this build was never
 * pointed at: search, recently-viewed, cross-references between a location and
 * the collections holding it, collaborator profiles. The queries are gone; the
 * types stay because the components that render these things are still on the
 * page and still need to compile.
 *
 * The hooks that used to produce them now return empty results and say so.
 * Wiring any of them means a Neon read and a route, not a Supabase client.
 */

/** One row in the navbar's search dropdown. */
export type SearchResultItem = {
  id: string
  entity_type: 'link' | 'collection' | 'itinerary'
  name: string
  thumbnail_url: string | null
  preview_images?: string[]
  region: string | null
  country: string | null
  updated_at: string
  relevance: number
}

export type SearchResponse = {
  results: SearchResultItem[]
  hasMore: boolean
}

/** One row in the navbar's "recently viewed" list. */
export type RecentlyViewedItem = {
  id: string
  type: 'link' | 'collection' | 'itinerary'
  name: string
  thumbnail_url: string | null
  preview_images?: string[]
  viewed_at: string
}

/** A location that belongs to some link, collection or itinerary. */
export type EntityLocationItem = {
  id: string
  name: string
  thumbnail_url: string | null
}

/** A collection or itinerary that also contains a given location. */
export type LocationReference = {
  id: string
  type: 'Collection' | 'Itinerary'
  name: string
  locationCount: number
  thumbnailUrl: string | null
}

export type LocationReferenceExclude = {
  itineraryId?: string
  collectionId?: string
}

/** A person on a shared collection or itinerary. */
export type ProfileRow = {
  id: string
  email: string
  display_name: string | null
  avatar_url: string | null
}
