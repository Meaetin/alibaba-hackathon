/**
 * Maps an authentication failure to a plain-language sentence.
 *
 * It used to translate Supabase's `AuthError` codes — `invalid_credentials`,
 * `email_not_confirmed`, `over_email_send_rate_limit` and a dozen more. Auth is
 * ours now and lives in `src/app/api/auth/**`, which already answers with a
 * sentence written for the person reading it, so there is far less to map: the
 * cases below are the ones a *transport* failure produces, where there is no
 * server message to pass on.
 *
 * Anything with a message from our own API is returned as-is, because that
 * message was written to be read. Everything else falls through to the generic
 * line rather than surfacing a stack or a status code.
 */
export function getFriendlyAuthError(
  error: { message?: string; status?: number } | null | undefined,
): string {
  if (!error) return 'Something went wrong. Please try again.'

  const raw = (error.message ?? '').toLowerCase()

  // Status 0 is this codebase's marker for "never reached the server" — see
  // `AuthError` in `src/lib/api/auth.ts`.
  if (error.status === 0 || raw.includes('network') || raw.includes('failed to fetch')) {
    return 'We couldn’t reach the server. Check your connection and try again.'
  }
  if (raw.includes('rate limit') || error.status === 429) {
    return 'Too many attempts. Please wait a moment and try again.'
  }
  if (error.message) return error.message

  return 'We couldn’t sign you in. Please try again.'
}

/**
 * Backend messages that are written for end users and safe to surface as-is.
 * Anything not on this list gets replaced with the provided fallback.
 */
const FRIENDLY_BACKEND_MESSAGES = new Set<string>([
  'Collection not found',
  'Itinerary not found',
  'Activity not found',
  'Lodging not found',
  'Flight not found',
  'Expense not found',
  'Attachment not found',
  'Location not found',
  'Job not found',
  'User not found',
  'Invalid invite token',
  'Invite link has expired',
  'Access denied',
  'Already a member of this collection',
  'Already a member of this itinerary',
  'Location already in collection',
  'User is already a collaborator',
  'Only the owner can delete the collection',
  'Only the owner can delete the itinerary',
  'Only the owner can add collaborators',
  'Only the owner can remove collaborators',
  'Only the owner can generate public tokens',
  'Only the owner can revoke public tokens',
  'Only the owner can generate invite tokens',
  'Only the owner can revoke invite tokens',
  'Only the owner can view collaborators',
  'Only the expense creator or itinerary owner can modify this expense',
  'Only the expense creator or itinerary owner can delete this expense',
  'Cannot remove yourself as owner',
  'Cannot remove the itinerary owner',
  'Itinerary cannot exceed 30 days',
  'Service temporarily unavailable',
  'Only PDF files are supported',
  'No file uploaded',
  'Could not extract text from PDF',
  'Could not extract a place from this Google Maps URL',
  'Could not identify a place from this URL',
  'Could not match this URL to a Google Place',
])

/**
 * Returns a user-friendly error string. If the underlying error message is on
 * the safe whitelist, it is shown as-is; otherwise the caller's `fallback`
 * (typically a sentence written for the UI) is returned. Technical text never
 * leaks into the UI.
 */
export function getFriendlyApiError(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback
  const message = err.message?.trim()
  if (!message) return fallback
  if (FRIENDLY_BACKEND_MESSAGES.has(message)) return message
  return fallback
}
