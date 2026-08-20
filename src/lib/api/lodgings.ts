import { createClient } from '@/lib/supabase/client'
import { unwrap, ensureOk } from './client'
import type { CascadeResult } from '@/lib/api/itineraries'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'

/** Lodging-extract response: lodging rows + per-day Directions cascade snapshots
 *  for every day a check-in / check-out card just landed on. The client applies
 *  `cascades` via `applyServerCascadeToDays` so travel legs + times appear
 *  without depending on realtime UPDATE events landing in order. */
export interface ExtractLodgingsResult {
  lodgings: ExtractedLodging[]
  cascades: CascadeResult[]
}

/** Manual-create / update response: the lodging row plus the same cascade
 *  snapshots used by the extract path. */
export type LodgingMutationResult = ExtractedLodging & {
  cascades?: CascadeResult[]
}

export interface ExtractedLodging {
  id: string
  itinerary_id: string
  created_by: string
  name?: string
  address?: string
  check_in_date: string
  check_in_time?: string
  check_out_date: string
  check_out_time?: string
  confirmation?: string
  cost?: number
  currency?: string
  display_in_itinerary: boolean
  place_id?: string
  latitude?: number
  longitude?: number
  // FK to the enriched `locations` row. Set after Google Places enrichment.
  location_id?: string
  // Geocoded photo from Google Places — surfaced by the extract/create endpoints
  // for optimistic UI; not stored on itinerary_lodgings.
  photo_url?: string
  // FK to the attachment that produced this row (PDF upload + extract). Null
  // when the lodging was added manually.
  source_attachment_id?: string | null
  created_at: string
  updated_at: string
}

async function getAuthToken(): Promise<string> {
  const supabase = createClient()
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session) throw new Error('Not authenticated')
  return data.session.access_token
}

export async function extractLodgingsFromPDF(
  itineraryId: string,
  file: File
): Promise<ExtractLodgingsResult> {
  const token = await getAuthToken()
  const formData = new FormData()
  formData.append('file', file)

  const res = await fetch(
    `${API_URL}/api/itineraries/${itineraryId}/lodgings/extract`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    }
  )

  await ensureOk(res, 'Failed to extract lodgings')
  const data = (await res.json()) as { lodgings: ExtractedLodging[]; cascades?: CascadeResult[] }
  return { lodgings: data.lodgings, cascades: data.cascades ?? [] }
}

export async function getLodgings(itineraryId: string): Promise<ExtractedLodging[]> {
  const token = await getAuthToken()
  const res = await fetch(
    `${API_URL}/api/itineraries/${itineraryId}/lodgings`,
    { headers: { Authorization: `Bearer ${token}` } }
  )

  return unwrap<ExtractedLodging[]>(res, 'Failed to fetch lodgings')
}

export async function updateLodging(
  itineraryId: string,
  lodgingId: string,
  lodging: {
    name?: string
    address?: string
    check_in_date?: string
    check_in_time?: string
    check_out_date?: string
    check_out_time?: string
    confirmation?: string
    cost?: number
    currency?: string
  }
): Promise<LodgingMutationResult> {
  const token = await getAuthToken()
  const res = await fetch(
    `${API_URL}/api/itineraries/${itineraryId}/lodgings/${lodgingId}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(lodging),
    }
  )

  return unwrap<LodgingMutationResult>(res, 'Failed to update lodging')
}

export async function deleteLodging(
  itineraryId: string,
  lodgingId: string
): Promise<void> {
  const token = await getAuthToken()
  const res = await fetch(
    `${API_URL}/api/itineraries/${itineraryId}/lodgings/${lodgingId}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }
  )

  await ensureOk(res, 'Failed to delete lodging')
}

export async function createLodging(
  itineraryId: string,
  lodging: {
    name?: string
    address?: string
    check_in_date: string
    check_in_time?: string
    check_out_date: string
    check_out_time?: string
    confirmation?: string
    cost?: number
    currency?: string
  }
): Promise<LodgingMutationResult> {
  const token = await getAuthToken()
  const res = await fetch(
    `${API_URL}/api/itineraries/${itineraryId}/lodgings`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(lodging),
    }
  )

  await ensureOk(res, 'Failed to create lodging')
  const created = (await res.json()) as LodgingMutationResult
  return created
}
