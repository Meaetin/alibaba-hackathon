import { authFetch, unwrap, ensureOk } from './client'
import type { PriceRange } from "@/lib/maps/price-range";

export interface Collection {
  id: string
  name: string
  description?: string
  country?: string
  region?: string
  latitude?: number
  longitude?: number
  tags: string[]
  thumbnail_url?: string
  owner_id: string
  is_public: boolean
  is_bookmarked: boolean
  is_archived: boolean
  public_token?: string
  invite_token?: string
  invite_token_expires_at?: string | null
  fork_count: number
  forked_from_id?: string
  created_at: string
  updated_at: string
}

export interface CollectionWithRole extends Collection {
  user_role: 'owner' | 'collaborator'
  location_count: number
  preview_images: string[]
}

export interface Location {
  id: string
  name: string
  formatted_address?: string
  latitude?: number
  longitude?: number
  location_type?: string
  primary_type?: string
  categories?: string[]
  tags: string[]
  photo_urls?: string[]
  website_uri?: string
  international_phone_number?: string
  rating?: number
  regular_opening_hours?: Record<string, unknown>
  country?: string
  locality?: string
  stay_duration?: number
  price_range?: PriceRange
  google_maps_uri?: string | null
  place_id?: string
  location_context?: string
  // junction-scoped fields (state within this collection)
  is_bookmarked: boolean
  is_archived: boolean
  added_at?: string
}

export interface CollectionWithLocations extends Collection {
  locations: Location[]
  user_role?: 'owner' | 'collaborator'
}

export async function getCollections(params?: { search?: string }): Promise<CollectionWithRole[]> {
  const query = params?.search ? `?search=${encodeURIComponent(params.search)}` : ''
  const res = await authFetch(`/api/collections${query}`)
  return unwrap<CollectionWithRole[]>(res, 'Failed to fetch collections')
}

export async function getCollection(id: string): Promise<CollectionWithLocations> {
  const res = await authFetch(`/api/collections/${id}`)
  return unwrap<CollectionWithLocations>(res, 'Failed to fetch collection')
}

export async function createCollection(name: string, country?: string, region?: string, latitude?: number, longitude?: number, tags?: string[]): Promise<Collection> {
  const response = await authFetch('/api/collections', {
    method: 'POST',
    body: JSON.stringify({
      name,
      ...(country ? { country } : {}),
      ...(region ? { region } : {}),
      ...(latitude != null ? { latitude } : {}),
      ...(longitude != null ? { longitude } : {}),
      ...(tags && tags.length > 0 ? { tags } : {}),
    }),
  })

  const created = await unwrap<Collection>(response, 'Failed to create collection')
  return created
}

export async function updateCollection(
  id: string,
  data: { is_bookmarked?: boolean; is_archived?: boolean; name?: string; description?: string | null; country?: string | null; region?: string | null; latitude?: number | null; longitude?: number | null },
): Promise<CollectionWithRole> {
  const res = await authFetch(`/api/collections/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
  const updated = await unwrap<CollectionWithRole>(res, 'Failed to update collection')
  if (data.is_archived !== undefined) {
  }
  if (data.is_bookmarked !== undefined) {
  }
  return updated
}

/** What `POST /api/collections/[id]/locations` reports back. Counted from the
 *  rows that landed, never the ids that were sent. */
export interface AddLocationsResult {
  added: number
  /** Already on this collection. Adding twice is idempotent, not an error. */
  duplicates: number
  /** Ids with no `locations` row, skipped rather than invented. */
  unknown: number
}

/**
 * Puts places on a collection.
 *
 * The ids are `locations.id` — the shared Places cache row — which is what every
 * caller already holds: a link's cards come from `content_locations`, a
 * collection's from `collection_locations`, and an itinerary activity carries
 * `location_id`. That shared identity is the whole point of the junction, and
 * it is why saving a place from a video costs nothing extra.
 */
export async function addLocationsToCollection(
  collectionId: string,
  locationIds: string[],
): Promise<AddLocationsResult> {
  const res = await authFetch(`/api/collections/${collectionId}/locations`, {
    method: 'POST',
    body: JSON.stringify({ location_ids: locationIds }),
  })
  return unwrap<AddLocationsResult>(res, 'Failed to add locations to collection')
}

export interface AddFromGoogleMapsResult {
  location: Location
  alreadyInCollection: boolean
}

export async function addLocationFromGoogleMapsUrl(
  collectionId: string,
  url: string,
): Promise<AddFromGoogleMapsResult> {
  const res = await authFetch(`/api/collections/${collectionId}/locations/from-google-maps`, {
    method: 'POST',
    body: JSON.stringify({ url }),
  })
  return unwrap<AddFromGoogleMapsResult>(res, 'Failed to add location')
}

export interface Collaborator {
  id: string
  email: string
  role: string
  joined_at: string
}

export async function generateCollectionPublicToken(collectionId: string): Promise<{ token: string }> {
  const res = await authFetch(`/api/collections/${collectionId}/tokens/public`, { method: 'POST' })
  return unwrap<{ token: string }>(res, 'Failed to generate public token')
}

export async function revokeCollectionPublicToken(collectionId: string): Promise<void> {
  const res = await authFetch(`/api/collections/${collectionId}/tokens/public`, { method: 'DELETE' })
  await ensureOk(res, 'Failed to revoke public token')
}

export async function generateCollectionInviteToken(collectionId: string): Promise<{ token: string; expires_at: string }> {
  const res = await authFetch(`/api/collections/${collectionId}/tokens/invite`, { method: 'POST' })
  return unwrap<{ token: string; expires_at: string }>(res, 'Failed to generate invite token')
}

export async function revokeCollectionInviteToken(collectionId: string): Promise<void> {
  const res = await authFetch(`/api/collections/${collectionId}/tokens/invite`, { method: 'DELETE' })
  await ensureOk(res, 'Failed to revoke invite token')
}

export async function getCollectionCollaborators(collectionId: string): Promise<Collaborator[]> {
  const res = await authFetch(`/api/collections/${collectionId}/collaborators`)
  return unwrap<Collaborator[]>(res, 'Failed to fetch collaborators')
}

export async function removeCollectionCollaborator(collectionId: string, userId: string): Promise<void> {
  const res = await authFetch(`/api/collections/${collectionId}/collaborators/${userId}`, { method: 'DELETE' })
  await ensureOk(res, 'Failed to remove collaborator')
}

export async function getCollectionInviteInfo(token: string): Promise<{ id: string; name: string; country?: string; region?: string; type: string }> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || ''
  const res = await fetch(`${apiUrl}/api/collections/invite/${token}/info`)
  return unwrap<{ id: string; name: string; country?: string; region?: string; type: string }>(res, 'Failed to fetch invite info')
}

export async function joinCollectionByToken(token: string): Promise<Collection> {
  const res = await authFetch(`/api/collections/join/${token}`, { method: 'POST' })
  return unwrap<Collection>(res, 'Failed to join collection')
}

export interface PublicCollectionLocation {
  id: string
  name: string
  formatted_address?: string
  photo_urls?: string[]
  latitude?: number
  longitude?: number
  is_bookmarked: boolean
  is_archived: boolean
}

export interface PublicCollection {
  id: string
  name: string
  country?: string
  region?: string
  thumbnail_url?: string | null
  locations: PublicCollectionLocation[]
}

export async function getPublicCollection(token: string): Promise<PublicCollection> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || ''
  const res = await fetch(`${apiUrl}/api/collections/public/${token}`)
  return unwrap<PublicCollection>(res, 'Collection not found')
}

export async function deleteCollection(id: string): Promise<void> {
  const res = await authFetch(`/api/collections/${id}`, {
    method: 'DELETE',
  })
  await ensureOk(res, 'Failed to delete collection')
}

export async function removeCollectionLocation(collectionId: string, locationId: string): Promise<void> {
  const res = await authFetch(`/api/collections/${collectionId}/locations/${locationId}`, {
    method: 'DELETE',
  })
  await ensureOk(res, 'Failed to remove location from collection')
}
