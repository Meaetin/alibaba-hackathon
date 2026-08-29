import { unwrap, ensureOk } from './client'

/**
 * A flight on a trip, as every flight component already reads it.
 *
 * The name is historical — the first flights in this app came out of a PDF —
 * but the shape is the contract between `itinerary_flights` and the cards, so
 * the columns are named after it rather than the other way round. See
 * `src/lib/db/flights.ts`.
 */
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
  /**
   * The fare, as written. A string because the column is one: "412.50" is not
   * 412.5, and a decimal amount put through binary floating point comes back
   * having quietly lost its cents.
   */
  cost?: string
  currency?: string
  terminal?: string
  baggage_allowance?: string
  ticket_number?: string
  /** The seat picked at booking, e.g. "12A". Absent when none was chosen. */
  seat?: string
  /** Who is flying, as given at booking. One passenger per row today. */
  passenger_name?: string
  status?: 'confirmed' | 'pending' | 'cancelled'
  /** Where the row came from — a booked Atlas fare, or one typed in by hand. */
  source?: 'booked' | 'manual' | 'extracted'
  // FK to the attachment that produced this row (PDF upload + extract). Null
  // when the flight was added manually.
  source_attachment_id?: string | null
  created_at: string
  updated_at: string
}

/** What a create or an edit may send. Dates are required; nothing else is. */
export interface FlightPayload {
  source?: 'booked' | 'manual' | 'extracted'
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
  cost?: string
  currency?: string
  terminal?: string
  baggage_allowance?: string
  ticket_number?: string
  seat?: string
  passenger_name?: string
  status?: string
}

/**
 * PDF extraction is the one flight call with no backend in this repo.
 *
 * It needs a document-extraction service; the other four are served by
 * `/api/itineraries/[id]/flights`. Left pointed at `NEXT_PUBLIC_API_URL` so it
 * fails against a named address rather than silently 404ing on our own origin —
 * "the extraction service is not configured" and "this app has no such route"
 * are different answers and the caller's error message should say which.
 */
const EXTRACT_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'

export async function extractFlightsFromPDF(
  itineraryId: string,
  file: File
): Promise<ExtractedFlight[]> {
  const formData = new FormData()
  formData.append('file', file)

  const res = await fetch(
    `${EXTRACT_API_URL}/api/itineraries/${itineraryId}/flights/extract`,
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

/**
 * The four calls below are same-origin, so the httpOnly session cookie rides
 * along without being asked for. They used to point at `NEXT_PUBLIC_API_URL` —
 * a REST backend this repo does not contain — which is why nothing about a
 * flight has ever survived a reload.
 */

export async function createFlight(
  itineraryId: string,
  flight: FlightPayload
): Promise<ExtractedFlight> {
  const res = await fetch(`/api/itineraries/${itineraryId}/flights`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(flight),
  })

  await ensureOk(res, 'Failed to create flight')
  return res.json()
}

export async function getFlights(itineraryId: string): Promise<ExtractedFlight[]> {
  const res = await fetch(`/api/itineraries/${itineraryId}/flights`, {
    credentials: 'same-origin',
  })

  const flights = await unwrap<ExtractedFlight[]>(res, 'Failed to fetch flights')
  return Array.isArray(flights) ? flights : []
}

export async function updateFlight(
  itineraryId: string,
  flightId: string,
  patch: Partial<FlightPayload>
): Promise<ExtractedFlight> {
  const res = await fetch(`/api/itineraries/${itineraryId}/flights/${flightId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(patch),
  })

  await ensureOk(res, 'Failed to update flight')
  return res.json()
}

export async function deleteFlight(
  itineraryId: string,
  flightId: string
): Promise<void> {
  const res = await fetch(`/api/itineraries/${itineraryId}/flights/${flightId}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  })

  await ensureOk(res, 'Failed to delete flight')
}
