import { authFetch, ensureOk } from './client'

export async function deleteContent(id: string): Promise<void> {
  const res = await authFetch(`/api/content/${id}`, {
    method: 'DELETE',
  })
  await ensureOk(res, 'Failed to delete content')
}
