import { createClient } from '@/lib/supabase/client'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'

export type ApiError = Error & { status: number }

export type AlreadyAnalyzedContent = {
  id: string
  content_title: string | null
  content_thumbnail: string | null
  content_url: string
}

export class AlreadyAnalyzedError extends Error {
  content: AlreadyAnalyzedContent

  constructor(content: AlreadyAnalyzedContent) {
    super('already_analyzed')
    this.name = 'AlreadyAnalyzedError'
    this.content = content
  }
}

/**
 * The user has used their monthly link allowance.
 *
 * Typed rather than string-matched so callers can show an upgrade prompt.
 * Before this existed the 402 surfaced as `new Error('quota_exceeded')` and
 * NewLinkModal rendered that raw code straight into the UI.
 * Mirrors `ItineraryQuotaError` in ./itineraries.
 */
export class LinkQuotaError extends Error {
  tier: string
  displayName: string
  monthlyLimit: number
  used: number

  constructor(tier: string, displayName: string, monthlyLimit: number, used: number) {
    super('link_quota_exceeded')
    this.name = 'LinkQuotaError'
    this.tier = tier
    this.displayName = displayName
    this.monthlyLimit = monthlyLimit
    this.used = used
  }
}

async function getAuthToken(): Promise<string | null> {
  const supabase = createClient()
  const { data, error } = await supabase.auth.getSession()

  if (error || !data.session) {
    return null
  }

  return data.session.access_token
}

export async function authFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = await getAuthToken()
  if (!token) {
    const err = new Error('Not authenticated') as ApiError
    err.status = 401
    throw err
  }

  try {
    const headers = new Headers(options.headers)
    if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }
    headers.set('Authorization', `Bearer ${token}`)

    return await fetch(`${API_URL}${path}`, {
      ...options,
      headers,
    })
  } catch (err) {
    // The API being unreachable never produces a Response, so `ensureOk` would
    // never see it. Status 0 marks a transport failure rather than an HTTP one.
    throw err
  }
}

/**
 * Throws an {@link ApiError} (Error + numeric `status`) when the response failed,
 * otherwise parses and returns the JSON body. Centralizes the `!res.ok` unwrap so
 * the 401/403/etc. status contract lives here alongside {@link authFetch} instead
 * of being re-implemented per call.
 */
export async function unwrap<T>(res: Response, fallbackMessage = 'Request failed'): Promise<T> {
  await ensureOk(res, fallbackMessage)
  return res.json() as Promise<T>
}

/**
 * Throws an {@link ApiError} when the response failed; returns nothing on success.
 * Use for endpoints with no body to parse (e.g. 204 DELETEs), where calling
 * `res.json()` would throw on an empty body.
 */
export async function ensureOk(res: Response, fallbackMessage = 'Request failed'): Promise<void> {
  if (res.ok) return
  const body = await res.json().catch(() => ({}))
  const err = new Error(body.error || fallbackMessage) as ApiError
  err.status = res.status
  throw err
}

export async function createJob<T = unknown>(
  type: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const res = await authFetch('/api/jobs', {
    method: 'POST',
    body: JSON.stringify({ type, payload }),
  })

  // 409 already_analyzed carries a `content` payload the caller renders, so this
  // case is handled explicitly before falling through to the generic unwrap.
  if (res.status === 409) {
    const body = await res.json().catch(() => ({}))
    if (body.error === 'already_analyzed' && body.content) {
      throw new AlreadyAnalyzedError(body.content as AlreadyAnalyzedContent)
    }
    const err = new Error(body.error || 'Failed to create job') as ApiError
    err.status = res.status
    throw err
  }

  // 402 quota_exceeded carries the tier and limit the upgrade prompt needs, so
  // it is raised as a typed error rather than a bare message string.
  if (res.status === 402) {
    const body = await res.json().catch(() => ({}))
    if (body.code === 'LINK_QUOTA_EXCEEDED' || body.error === 'quota_exceeded') {
      throw new LinkQuotaError(
        body.tier ?? 'free',
        body.display_name ?? 'your plan',
        body.monthly_limit ?? 0,
        body.used ?? 0,
      )
    }
  }

  return unwrap<T>(res, 'Failed to create job')
}

export async function retryJob(jobId: string) {
  const res = await authFetch(`/api/jobs/${jobId}/retry`, { method: 'POST' })
  return unwrap(res, 'Failed to retry job')
}

export async function detachJob(jobId: string): Promise<{ success: boolean }> {
  const res = await authFetch(`/api/jobs/${jobId}/detach`, { method: 'PATCH' })
  return unwrap<{ success: boolean }>(res, 'Failed to detach job')
}
