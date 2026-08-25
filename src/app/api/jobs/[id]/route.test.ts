/**
 * `GET /api/jobs/[id]`, the poll target.
 *
 * Two things matter here and nothing else does. The body must be the `jobs` row
 * as Drizzle read it — `useJobsQueue` types `QueueJob` off exactly those column
 * names, so any reshaping here would be a second source of truth for the same
 * fields. And an id nobody has heard of must be a 404: the client stops polling
 * on a 404 and keeps trying on anything else, so a 500 would leave a dead id
 * being fetched every two seconds until the tab closes.
 */

import { getTableColumns } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { createInMemoryPlanStore, toJobProgress, type JobRow } from '@/lib/db/itineraries'
import { jobs } from '@/lib/db/schema'

import { jobsRouteDeps } from '../../deps'
import { GET } from './route'

const NOW = new Date('2026-08-24T09:00:00.000Z')

const originalCreate = jobsRouteDeps.create

afterEach(() => {
  jobsRouteDeps.create = originalCreate
})

function install() {
  const store = createInMemoryPlanStore()
  jobsRouteDeps.create = () => ({ store })
  return store
}

function get(id: string): Promise<Response> {
  // Next 15 hands the dynamic segment in as a promise.
  return GET(new Request(`http://localhost/api/jobs/${id}`), {
    params: Promise.resolve({ id }),
  })
}

describe('GET /api/jobs/[id]', () => {
  it('returns the jobs row, column for column', async () => {
    const store = install()
    const job = await store.createJob({ payload: { city: 'Kyoto' }, now: NOW })

    const response = await get(job.id)
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>

    // Every column of the table, and nothing invented on top of it. Read off
    // the Drizzle definition so a new column cannot silently go unserved.
    const columns = Object.keys(getTableColumns(jobs)).sort()
    expect(Object.keys(body).sort()).toEqual(columns)

    expect(body.id).toBe(job.id)
    expect(body.type).toBe('itinerary-planning')
    expect(body.status).toBe('queued')
    expect(body.itinerary_id).toBeNull()
    expect(body.error).toBeNull()
    expect(body.progress).toBeNull()
    expect(body.payload).toEqual({ city: 'Kyoto' })
    // Timestamps cross the wire as ISO strings, which is what the hook parses.
    expect(body.created_at).toBe(NOW.toISOString())
    expect(body.updated_at).toBe(NOW.toISOString())
  })

  it('carries every progress field the loading screen reads', async () => {
    const store = install()
    const job = await store.createJob({ payload: {}, now: NOW })
    await store.updateJob(
      job.id,
      {
        status: 'processing',
        progress: toJobProgress(
          { stage: 'assign', label: 'Choosing what goes on which day', percent: 32, done: 4, total: 9 },
          NOW,
        ),
      },
      NOW,
    )

    const body = (await (await get(job.id)).json()) as JobRow
    expect(body.status).toBe('processing')
    expect(body.progress).toEqual({
      percent: 32,
      label: 'Choosing what goes on which day',
      stage: 'assign',
      done: 4,
      total: 9,
      fired_at: NOW.toISOString(),
      eta_seconds: expect.any(Number),
      next_percent: expect.any(Number),
      stage_ms: expect.any(Number),
    })
  })

  it('answers 404 for an id it has never seen, not 500', async () => {
    install()
    const response = await get('11111111-2222-3333-4444-555555555555')

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Job not found' })
  })

  it('answers 404 for an id that is not even a uuid', async () => {
    install()
    const response = await get('not-a-uuid')

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Job not found' })
  })
})
