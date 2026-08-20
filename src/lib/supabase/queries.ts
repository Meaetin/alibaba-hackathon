import type { SupabaseClient } from '@supabase/supabase-js'

// ───── Types ─────────────────────────────────────────────────────────────────

// ───── Profile Types ─────────────────────────────────────────────────────────

export type ProfileRow = {
  id: string
  email: string
  display_name: string | null
  avatar_url: string | null
}

export async function getProfile(
  supabase: SupabaseClient,
  userId: string,
): Promise<ProfileRow | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, display_name, avatar_url')
    .eq('id', userId)
    .single()

  if (error) {
    console.error('Error fetching profile:', error)
    return null
  }
  return data
}

export async function getProfiles(
  supabase: SupabaseClient,
  userIds: string[],
): Promise<ProfileRow[]> {
  if (userIds.length === 0) return []
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, display_name, avatar_url')
    .in('id', userIds)

  if (error) {
    console.error('Error fetching profiles:', error)
    return []
  }
  return data ?? []
}

// ───── user_content ──────────────────────────────────────────────────────────

export async function getContentDetail(
  supabase: SupabaseClient,
  contentId: string
) {
  // Scoping is enforced by RLS on user_content + the !inner join — we don't
  // need to round-trip for the session just to pass userId here.
  return supabase
    .from('content')
    .select(`
      id,
      content_url,
      content_url_normalized,
      content_title,
      content_author,
      content_thumbnail,
      generated_summary,
      location_count,
      platform,
      content_type,
      processing_status,
      created_at,
      region,
      country,
      user_content!inner(user_id),
      content_locations (
        locations (
          id,
          name,
          formatted_address,
          google_maps_uri,
          rating,
          business_status,
          categories,
          tags,
          latitude,
          longitude,
          photo_urls,
          regular_opening_hours,
          international_phone_number,
          website_uri,
          stay_duration,
          price_range,
          primary_type,
          location_context
        )
      )
    `)
    .eq('id', contentId)
    .single()
}

// ───── collection_locations ──────────────────────────────────────────────────

export async function addLocationsToCollection(
  supabase: SupabaseClient,
  collectionId: string,
  locationIds: string[]
) {
  return supabase
    .from('collection_locations')
    .upsert(
      locationIds.map((location_id) => ({ collection_id: collectionId, location_id })),
      { onConflict: 'collection_id,location_id', ignoreDuplicates: true }
    )
}

/**
 * Fetch up to 4 distinct preview image URLs per collection, keyed by collection id.
 * Shared by the home, search, and recently-viewed query modules so they don't each
 * reimplement the same collection_locations → photo_urls grouping.
 */
export async function getCollectionPreviewImages(
  supabase: SupabaseClient,
  collectionIds: string[]
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>()
  if (collectionIds.length === 0) return map

  const { data } = await supabase
    .from('collection_locations')
    .select('collection_id, locations(photo_urls)')
    .in('collection_id', collectionIds)

  if (data) {
    for (const row of data as unknown as Array<{
      collection_id: string
      locations: { photo_urls: string[] | null } | null
    }>) {
      const url = row.locations?.photo_urls?.[0]
      if (!url) continue
      const existing = map.get(row.collection_id) ?? []
      if (existing.length < 4 && !existing.includes(url)) {
        existing.push(url)
        map.set(row.collection_id, existing)
      }
    }
  }

  return map
}
