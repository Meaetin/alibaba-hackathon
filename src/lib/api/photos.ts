import { authFetch } from './client'

export interface LocationPhotoQuery {
  region?: string | null
  country?: string | null
  /**
   * Stable identifier (a job id). The API picks the same photo for the same seed,
   * so a card that resolves its own image still matches the one the worker saves.
   */
  seed?: string | null
}

/**
 * Session-lifetime memo, shared by every caller: the API's own `unsplash_cache`
 * makes a repeat lookup cheap, but a grid of cards for the same destination
 * shouldn't issue a request each.
 */
const cache = new Map<string, string>()

export function locationPhotoKey({ region, country, seed }: LocationPhotoQuery): string {
  return `${region?.trim() ?? ''}|${country?.trim() ?? ''}|${seed ?? ''}`
}

export function cachedLocationPhoto(query: LocationPhotoQuery): string | null {
  return cache.get(locationPhotoKey(query)) ?? null
}

/**
 * Destination photo for a place, from the API's cached Unsplash pool — the same
 * pool the worker draws saved thumbnails from.
 *
 * Never throws: a missing photo is a cosmetic loss (the card falls back to its
 * gradient), so an unreachable or slow API resolves to null.
 */
export async function fetchLocationPhoto(query: LocationPhotoQuery): Promise<string | null> {
  const region = query.region?.trim() ?? ''
  const country = query.country?.trim() ?? ''
  const seed = query.seed ?? ''
  if (!region && !country) return null

  const key = locationPhotoKey({ region, country, seed })
  const cached = cache.get(key)
  if (cached) return cached

  const params = new URLSearchParams()
  if (region) params.set('region', region)
  if (country) params.set('country', country)
  if (seed) params.set('seed', seed)

  try {
    const res = await authFetch(`/api/photos/location?${params}`, {
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null

    const { url } = (await res.json()) as { url: string | null }
    if (!url) return null

    cache.set(key, url)
    return url
  } catch {
    return null
  }
}
