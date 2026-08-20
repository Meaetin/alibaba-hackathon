import { createClient } from '@/lib/supabase/client'
import { unwrap, ensureOk } from './client'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'

export type AttachmentEntityType = 'flight' | 'lodging'

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file'
  return base.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'file'
}

export interface UploadAttachmentParams {
  itineraryId: string
  entityType: AttachmentEntityType
  entityId: string
  file: File
  /**
   * Every entity (flight or lodging) produced by the same extraction. Backend
   * stamps `source_attachment_id` on each so deleting the attachment cascades
   * to all of them. Should include `entityId` for completeness.
   */
  linkEntityIds?: string[]
}

export async function uploadAttachment({
  itineraryId,
  entityType,
  entityId,
  file,
  linkEntityIds,
}: UploadAttachmentParams): Promise<ItineraryAttachmentSummary> {
  if (file.size === 0) {
    throw new Error('File is empty (likely a cloud placeholder)')
  }
  if (!ALLOWED_MIME.has(file.type)) {
    throw new Error(`Unsupported file type: ${file.type || 'unknown'}`)
  }

  const supabase = createClient()
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
  if (sessionError || !sessionData.session) {
    throw new Error('Not authenticated')
  }

  const objectId = crypto.randomUUID()
  const safeName = sanitizeFilename(file.name)
  const storagePath = `${itineraryId}/${entityType}/${entityId}/${objectId}-${safeName}`

  const { error: uploadErr } = await supabase.storage
    .from('itinerary-attachments')
    .upload(storagePath, file, { contentType: file.type, upsert: false })
  if (uploadErr) {
    throw new Error(`Storage upload failed: ${uploadErr.message}`)
  }

  const endpoint =
    entityType === 'flight'
      ? `/api/itineraries/${itineraryId}/flights/${entityId}/attachments`
      : `/api/itineraries/${itineraryId}/lodgings/${entityId}/attachments`

  const res = await fetch(`${API_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionData.session.access_token}`,
    },
    body: JSON.stringify({
      file_name: file.name,
      file_size: file.size,
      mime_type: file.type,
      storage_path: storagePath,
      ...(linkEntityIds && linkEntityIds.length > 0 ? { link_entity_ids: linkEntityIds } : {}),
    }),
  })

  if (!res.ok) {
    // Roll back the just-uploaded object before surfacing the error so a failed
    // registration doesn't leave an orphaned file in storage.
    await supabase.storage.from('itinerary-attachments').remove([storagePath]).catch(() => {})
    await ensureOk(res, 'Failed to register attachment')
  }

  const inserted = await res.json()
  return {
    id: inserted.id,
    entity_type: inserted.entity_type,
    file_name: inserted.file_name,
    file_size: inserted.file_size,
    mime_type: inserted.mime_type,
    created_at: inserted.created_at,
  }
}

export interface ItineraryAttachmentSummary {
  id: string
  entity_type: AttachmentEntityType
  file_name: string
  file_size: number
  mime_type: string
  created_at: string
}

export async function listAttachments(itineraryId: string): Promise<ItineraryAttachmentSummary[]> {
  const supabase = createClient()
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
  if (sessionError || !sessionData.session) {
    throw new Error('Not authenticated')
  }

  const res = await fetch(`${API_URL}/api/itineraries/${itineraryId}/attachments`, {
    headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
  })

  return unwrap<ItineraryAttachmentSummary[]>(res, 'Failed to fetch attachments')
}

export interface AttachmentSignedUrlResponse {
  signed_url: string
  expires_in_seconds: number
  file_name: string
  mime_type: string
}

/**
 * Fetches a short-lived signed URL for viewing an attachment file. The PDF is
 * stored in a private Supabase Storage bucket; the URL is valid for the TTL
 * the backend grants (currently 120s) and lets the browser open the file
 * directly in a new tab.
 */
export async function getAttachmentSignedUrl(
  itineraryId: string,
  attachmentId: string,
): Promise<AttachmentSignedUrlResponse> {
  const supabase = createClient()
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
  if (sessionError || !sessionData.session) {
    throw new Error('Not authenticated')
  }

  const res = await fetch(
    `${API_URL}/api/itineraries/${itineraryId}/attachments/${attachmentId}/signed-url`,
    { headers: { Authorization: `Bearer ${sessionData.session.access_token}` } },
  )

  return unwrap<AttachmentSignedUrlResponse>(res, 'Failed to fetch signed URL')
}

export interface DeleteAttachmentParams {
  itineraryId: string
  attachmentId: string
}

/**
 * Deletes the attachment row + its storage object. The DB cascade then removes
 * every flight or lodging that linked back via `source_attachment_id`, and each
 * of those cascades to its activity cards (existing FK on migration 050).
 *
 * For attachments created before migration 092 (no back-references), migration
 * 093 backfilled `source_attachment_id`, so the same cascade now applies to
 * legacy data.
 */
export async function deleteAttachment({
  itineraryId,
  attachmentId,
}: DeleteAttachmentParams): Promise<void> {
  const supabase = createClient()
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
  if (sessionError || !sessionData.session) {
    throw new Error('Not authenticated')
  }
  const headers = { Authorization: `Bearer ${sessionData.session.access_token}` }
  const path = `/api/itineraries/${itineraryId}/attachments/${attachmentId}`

  const res = await fetch(`${API_URL}${path}`, { method: 'DELETE', headers })
  // 404 means it's already gone — treat the delete as idempotently successful.
  if (res.status === 404) return
  await ensureOk(res, 'Failed to delete attachment')
}
