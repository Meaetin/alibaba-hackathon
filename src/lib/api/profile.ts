import { authFetch, unwrap } from './client'

export interface QuotaStatus {
  allowed: boolean
  tier: string
  display_name: string
  status: 'active' | 'past_due' | 'canceled' | 'paused'
  monthly_limit: number
  used: number
  remaining: number
}

export async function getQuota(): Promise<QuotaStatus> {
  const res = await authFetch('/api/profile/quota')
  return unwrap<QuotaStatus>(res, 'Failed to fetch usage quota')
}

export interface ItineraryQuotaStatus {
  allowed: boolean
  tier: string
  display_name: string
  status: 'active' | 'past_due' | 'canceled' | 'paused'
  max_itineraries: number
  current_count: number
  remaining: number
  lifetime_generated: number
}

export async function getItineraryQuota(): Promise<ItineraryQuotaStatus> {
  const res = await authFetch('/api/profile/quota/itineraries')
  return unwrap<ItineraryQuotaStatus>(res, 'Failed to fetch itinerary quota')
}

export interface SharedItemImpact {
  id: string
  name: string
  collaborator_count: number
}

export interface DeletionImpact {
  itineraries_owned: number
  collections_owned: number
  links_analyzed: number
  shared_itineraries: SharedItemImpact[]
  shared_collections: SharedItemImpact[]
}

export async function getDeletionImpact(): Promise<DeletionImpact> {
  const res = await authFetch('/api/profile/deletion-impact')
  return unwrap<DeletionImpact>(res, 'Failed to load account details')
}

/** Permanently deletes the signed-in account. There is no undo. */
export async function deleteAccount(): Promise<void> {
  const res = await authFetch('/api/profile', { method: 'DELETE' })
  if (!res.ok) {
    await unwrap<void>(res, 'Failed to delete account')
  }
}
