import { createClient } from '@/lib/supabase/client'
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

async function getAuthToken(): Promise<string> {
  const supabase = createClient()
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session) throw new Error('Not authenticated')
  return data.session.access_token
}

export async function extractFlightsFromPDF(
  itineraryId: string,
  file: File
): Promise<ExtractedFlight[]> {
  const token = await getAuthToken()
  const formData = new FormData()
  formData.append('file', file)

  const res = await fetch(
    `${API_URL}/api/itineraries/${itineraryId}/flights/extract`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
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
  const token = await getAuthToken()
  const res = await fetch(
    `${API_URL}/api/itineraries/${itineraryId}/flights`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(flight),
    }
  )

  await ensureOk(res, 'Failed to create flight')
  const created = await res.json()
  return created
}

export async function getFlights(itineraryId: string) {
  const token = await getAuthToken()
  const res = await fetch(
    `${API_URL}/api/itineraries/${itineraryId}/flights`,
    { headers: { Authorization: `Bearer ${token}` } }
  )

  return unwrap(res, 'Failed to fetch flights')
}
