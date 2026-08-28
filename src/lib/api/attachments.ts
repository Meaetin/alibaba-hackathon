/**
 * Itinerary attachments — the PDF a flight or lodging was extracted from.
 *
 * **The feature has no backend and cannot be made to work from here.** Unlike
 * the rest of `src/lib/api/**`, which merely points at a dead REST service,
 * this one also wrote the file itself into a private Supabase Storage bucket.
 * Supabase is gone from this project, and object storage is not something a
 * browser module can substitute for: it needs a bucket, a route that signs
 * uploads, and a table to record what was uploaded.
 *
 * (The planner already has an S3-shaped object store for photo bytes —
 * `src/lib/planner/photo-blobs.ts`, backed by `PHOTO_BLOB_*` env. That is the
 * piece to build on if attachments come back. It is a server-side port, so the
 * work is a route under `src/app/api/`, not a rewrite of this file.)
 *
 * Every call therefore **throws a plain sentence** rather than returning empty.
 * That is the opposite of what the unbacked read hooks do, and deliberately so:
 * an empty attachment list is a true statement, but an upload that silently
 * succeeds and stores nothing is a lie the traveller finds out about later. The
 * detail page already routes these through `getFriendlyApiError`.
 */

export type AttachmentEntityType = 'flight' | 'lodging'

export interface UploadAttachmentParams {
  itineraryId: string
  entityType: AttachmentEntityType
  entityId: string
  file: File
  /** Every entity produced by the same extraction, so a delete cascades. */
  linkEntityIds?: string[]
}

export interface ItineraryAttachmentSummary {
  id: string
  entity_type: AttachmentEntityType
  file_name: string
  file_size: number
  mime_type: string
  created_at: string
}

export interface AttachmentSignedUrlResponse {
  signed_url: string
  expires_in_seconds: number
  file_name: string
  mime_type: string
}

export interface DeleteAttachmentParams {
  itineraryId: string
  attachmentId: string
}

const UNAVAILABLE = 'File attachments are not available in this build.'

function unavailable(): never {
  throw new Error(UNAVAILABLE)
}

export async function uploadAttachment(_params: UploadAttachmentParams): Promise<ItineraryAttachmentSummary> {
  return unavailable()
}

/** The one read here, and it throws like the others — see the note above: the
 *  page shows an upload control next to this list, and a list that quietly
 *  reads empty invites somebody to use it. */
export async function listAttachments(_itineraryId: string): Promise<ItineraryAttachmentSummary[]> {
  return unavailable()
}

export async function getAttachmentSignedUrl(
  _itineraryId: string,
  _attachmentId: string,
): Promise<AttachmentSignedUrlResponse> {
  return unavailable()
}

export async function deleteAttachment(_params: DeleteAttachmentParams): Promise<void> {
  return unavailable()
}
