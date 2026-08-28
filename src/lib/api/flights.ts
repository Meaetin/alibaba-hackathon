import { unwrap, ensureOk } from './client'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'

export interface ExtractedFlight {
  id: string
  itinerary_id: string
  created_by: string
  flight_number?: string
  airline?: string
  depart_date: string
  depart_time?: string
  depart_airport_code?: string
  depart_city?: string
  depart_country?: string
  arrive_date: string
  arrive_time?: string
  arrive_airport_code?: string
  arrive_city?: string
  arrive_country?: string
  duration_minutes?: number
  confirmation?: string
  fare_class?: string
  cost?: number
  currency?: string
  terminal?: string
  baggage_allowance?: string
  ticket_number?: string
  status?: 'confirmed' | 'pending' | 'cancelled'
  // FK to the attachment that produced this row (PDF upload + extract). Null
  // when the flight was added manually.
  source_attachment_id?: string | null
  created_at: string
  updated_at: string
}

/**
 * These calls go to the old REST backend on `NEXT_PUBLIC_API_URL`, which is
 * gone, so they fail whatever they send. The Supabase bearer token they used
 * to carry is gone with it; the session is an httpOnly cookie now and the
 * browser attaches it for same-origin requests without being asked.
 */

export async function extractFlightsFromPDF(
  itineraryId: string,
  file: File
): Promise<ExtractedFlight[]> {
  const formData = new FormData()
  formData.append('file', file)

  const res = await fetch(
    `${API_URL}/api/itineraries/${itineraryId}/flights/extract`,
    {
      method: 'POST',
      credentials: 'same-origin',
      body: formData,
    }
  )

  await ensureOk(res, 'Failed to extract flights')
  const data = await res.json()
  return data.flights
}

export async function createFlight(
  itineraryId: string,
  flight: {
    flight_number?: string
    airline?: string
    depart_date: string
    depart_time?: string
    depart_airport_code?: string
    depart_city?: string
    depart_country?: string
    arrive_date: string
    arrive_time?: string
    arrive_airport_code?: string
    arrive_city?: string
    arrive_country?: string
    duration_minutes?: number
    confirmation?: string
    fare_class?: string
    cost?: number
    currency?: string
    terminal?: string
    baggage_allowance?: string
    ticket_number?: string
    status?: string
  }
) {
  const res = await fetch(
    `${API_URL}/api/itineraries/${itineraryId}/flights`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(flight),
    }
  )

  await ensureOk(res, 'Failed to create flight')
  const created = await res.json()
  return created
}

export async function getFlights(itineraryId: string) {
  const res = await fetch(
    `${API_URL}/api/itineraries/${itineraryId}/flights`,
    { credentials: 'same-origin' }
  )

  return unwrap(res, 'Failed to fetch flights')
}
