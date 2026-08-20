import type { AuthError } from '@supabase/supabase-js'

/**
 * Maps Supabase auth errors to plain-language messages.
 * Keep technical detail in `console.error` / network panel; surface only friendly text.
 */
export function getFriendlyAuthError(error: AuthError | { message?: string; code?: string | null } | null | undefined): string {
  if (!error) return 'Something went wrong. Please try again.'

  const code = (error as { code?: string | null }).code ?? null
  const raw = (error.message ?? '').toLowerCase()

  if (code === 'invalid_credentials' || raw.includes('invalid login credentials')) {
    return 'The email or password you entered is incorrect.'
  }
  if (code === 'email_not_confirmed' || raw.includes('email not confirmed')) {
    return 'Please confirm your email address before signing in.'
  }
  if (code === 'user_already_exists' || raw.includes('user already registered') || raw.includes('already been registered')) {
    return 'An account with this email already exists. Try signing in instead.'
  }
  if (code === 'weak_password' || raw.includes('password should be at least') || raw.includes('weak password')) {
    return 'That password doesn’t meet the requirements. Please check the list below.'
  }
  if (code === 'email_address_invalid' || raw.includes('invalid email') || raw.includes('valid email')) {
    return 'Please enter a valid email address.'
  }
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || raw.includes('rate limit')) {
    return 'Too many attempts. Please wait a moment and try again.'
  }
  // The project's SMTP provider rejected the send. Distinct from a bad address:
  // nothing the person types will fix it, so don't imply otherwise.
  if (raw.includes('error sending') || raw.includes('smtp')) {
    return 'We couldn’t send that email just now. This is on our end — please try again shortly.'
  }
  if (code === 'signups_not_allowed' || raw.includes('signups not allowed')) {
    return 'Sign-ups are temporarily disabled. Please check back later.'
  }
  if (code === 'email_provider_disabled' || raw.includes('email logins are disabled')) {
    return 'Email sign-in is temporarily disabled. Try another sign-in method.'
  }
  if (raw.includes('network') || raw.includes('failed to fetch')) {
    return 'We couldn’t reach the server. Check your connection and try again.'
  }

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
