import { createClient } from '@/lib/supabase/client'

/** Current usage month key, matching the `MM-YYYY` format the RPCs/columns expect. */
function currentMonthKey(): string {
  const now = new Date()
  return `${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}`
}

export type PlacesSearchType = 'text' | 'nearby'

export async function trackMapLoad(): Promise<void> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const now = new Date()
    const month = `${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}`

    await supabase.rpc('track_user_api_usage', {
      p_user_id: user.id,
      p_month: month,
      p_map_loads: 1,
    })

    await supabase.rpc('track_global_api_usage', {
      p_month: month,
      p_map_loads: 1,
    })
  } catch {
    // Analytics tracking should never break the UI
  }
}

/**
 * Records one place-search request against the Enterprise column for its type.
 * Map search always bills the Enterprise SKU: one call returns up to ~20 places
 * in a single billed request, which is far cheaper per place than a lean Pro
 * search plus a Place Details call when the user adds a place.
 */
export async function trackPlacesSearch(type: PlacesSearchType): Promise<void> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const month = currentMonthKey()
    const param = `p_google_places_${type}_search_enterprise`
    const counts = { [param]: 1 }

    await supabase.rpc('track_user_api_usage', { p_user_id: user.id, p_month: month, ...counts })
    await supabase.rpc('track_global_api_usage', { p_month: month, ...counts })
  } catch {
    // Analytics tracking should never break the UI
  }
}

/**
 * Records one Place Details (Enterprise) call — fired when a pin click needs the
 * rich data a Pro-tier search didn't return. Reuses the existing
 * google_places_enterprise column (same SKU as the worker's place enrichment).
 */
export async function trackPlaceDetailsEnterprise(): Promise<void> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const month = currentMonthKey()
    await supabase.rpc('track_user_api_usage', { p_user_id: user.id, p_month: month, p_google_places_enterprise: 1 })
    await supabase.rpc('track_global_api_usage', { p_month: month, p_google_places_enterprise: 1 })
  } catch {
    // Analytics tracking should never break the UI
  }
}

/**
 * Records one rendered Place photo. Loading a `getURI()` photo URL bills the
 * separate Place Photo SKU (not the search/details field mask), so we count it
 * when the image actually renders.
 */
export async function trackPlacePhoto(): Promise<void> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const month = currentMonthKey()
    await supabase.rpc('track_user_api_usage', { p_user_id: user.id, p_month: month, p_google_places_photos: 1 })
    await supabase.rpc('track_global_api_usage', { p_month: month, p_google_places_photos: 1 })
  } catch {
    // Analytics tracking should never break the UI
  }
}

export async function trackPlacesAutocomplete(): Promise<void> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const now = new Date()
    const month = `${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}`

    await supabase.rpc('track_user_api_usage', {
      p_user_id: user.id,
      p_month: month,
      p_google_places_autocomplete: 1,
    })

    await supabase.rpc('track_global_api_usage', {
      p_month: month,
      p_google_places_autocomplete: 1,
    })
  } catch {
    // Analytics tracking should never break the UI
  }
}
