import { authFetch, unwrap, ensureOk } from './client'

/** A row from the shared `itinerary_notes` table. `activity_id` null = a
 *  standalone "overview" note; set = a note attached to one activity. */
export interface ItineraryNoteRow {
  id: string
  itinerary_id: string
  activity_id: string | null
  created_by: string | null
  title: string
  body: string
  created_at: string
  updated_at: string
}

export interface UpsertNotePayload {
  activity_id?: string | null
  title?: string
  body?: string
}

export async function listItineraryNotes(itineraryId: string): Promise<ItineraryNoteRow[]> {
  const res = await authFetch(`/api/itineraries/${itineraryId}/notes`)
  return unwrap<ItineraryNoteRow[]>(res, 'Failed to load notes')
}

/** Idempotent create-or-update. `noteId` is client-generated for new notes;
 *  the server may return a row with a different id for activity notes (it
 *  conflicts on activity_id), so callers should adopt the returned row. */
export async function upsertItineraryNote(
  itineraryId: string,
  noteId: string,
  payload: UpsertNotePayload,
): Promise<ItineraryNoteRow> {
  const res = await authFetch(`/api/itineraries/${itineraryId}/notes/${noteId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
  return unwrap<ItineraryNoteRow>(res, 'Failed to save note')
}

export async function deleteItineraryNote(itineraryId: string, noteId: string): Promise<void> {
  const res = await authFetch(`/api/itineraries/${itineraryId}/notes/${noteId}`, {
    method: 'DELETE',
  })
  await ensureOk(res, 'Failed to delete note')
}
