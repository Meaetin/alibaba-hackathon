import { authFetch, ensureOk, unwrap } from './client'
import type { ContentDetail, ContentListItem } from '@/lib/db/content'

export type { ContentDetail, ContentListItem }

/**
 * Every link this traveller has analyzed, newest first.
 *
 * The whole list — there is no cursor, because a person saves tens of links and
 * `GET /api/content` returns them all. Signed out, the endpoint answers with an
 * empty array rather than a 401: the grid's "no links yet" state is the right
 * thing to show, and an error toast on a page somebody may legitimately look at
 * is not.
 */
export async function getContent(): Promise<ContentListItem[]> {
  const res = await authFetch('/api/content')
  return unwrap<ContentListItem[]>(res, 'Failed to load links')
}

/** One link and the places it named. Rejects with a 404 for a link that is not
 *  this traveller's — the API deliberately cannot tell you it exists. */
export async function getContentDetail(id: string): Promise<ContentDetail> {
  const res = await authFetch(`/api/content/${id}`)
  return unwrap<ContentDetail>(res, 'Failed to load link')
}

export async function deleteContent(id: string): Promise<void> {
  const res = await authFetch(`/api/content/${id}`, {
    method: 'DELETE',
  })
  await ensureOk(res, 'Failed to delete content')
}
