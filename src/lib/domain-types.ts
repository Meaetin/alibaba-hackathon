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
