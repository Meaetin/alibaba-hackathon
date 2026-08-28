/**
 * `POST /api/plan`, driven through the real handler with fake ports.
 *
 * Everything here is the production path except the four things that cost
 * money or need a server: Google, OpenAI, Postgres and the clock. The pipeline,
 * the row shapers, the progress arithmetic and the error mapping are all the
 * real ones — which is the whole reason `planRouteDeps.create` exists.
 *
 * Four properties this file is here to hold:
 *
 *   1. the job id comes back **before** the plan finishes
 *   2. the progress percentage never goes backwards, and lands on exactly 100
 *   3. a failed stage writes a sentence a person can read, never the provider's
 *   4. the itinerary it produces satisfies the invariant suite
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createInMemoryPlanStore, type JobRow, type PlanStore } from '@/lib/db/itineraries'
import { createInMemoryPersonaStore } from '@/lib/db/personas'
import { QUESTIONS, calculatePersona } from '@/lib/persona/quiz'
import type { QuizAnswers } from '@/lib/persona/types'
import type { JobProgress } from '@/lib/db/schema'
import { createInMemoryEnrichmentStore, type EnrichmentStore } from '@/lib/planner/enrich'
import { createFakeGoogle, createFakeResponses } from '@/lib/planner/__tests__/fakes'
import { assertValidItinerary } from '@/lib/planner/__tests__/invariants'
import { mulberry32 } from '@/lib/planner/__tests__/rng'
import candidates from '@/lib/planner/__fixtures__/kyoto-candidates.json'
import { runPlan, type PlanRequest, type PlanResult } from '@/lib/planner/pipeline'
import {
  createInMemoryLocationStore,
  createInMemorySearchCache,
} from '@/lib/planner/retrieval'
import type { CandidatePlace, PreferenceProfile } from '@/lib/planner/types'

import { planRouteDeps, type PlanRouteDeps } from '../deps'
import { signedIn } from '../session-fixture'
import { POST } from './route'

const CANDIDATES = candidates as CandidatePlace[]

const PROFILE: PreferenceProfile = {
  interests: ['temples', 'cafes', 'food'],
  dietary: ['vegetarian'],
  pace: 'balanced',
  budget: 2,
}

const BODY: PlanRequest = {
  city: 'Kyoto',
  country: 'Japan',
  startDate: '2026-09-14',
  totalDays: 3,
  name: 'Three days in Kyoto',
  profile: PROFILE,
}

const NOW = new Date('2026-08-24T09:00:00.000Z')

/** A complete quiz: every question answered with its first option. */
const QUIZ_ANSWERS: QuizAnswers = Array(QUESTIONS.length).fill(0)
/** The opposite traveller: every question answered with its last option. */
const QUIZ_ANSWERS_LAST: QuizAnswers = QUESTIONS.map((question) => question.options.length - 1)

const originalCreate = planRouteDeps.create

/** Signed in unless a test says otherwise — every plan needs an owner now. */
function post(body: unknown = BODY, cookie: string | null = currentCookie): Promise<Response> {
  return POST(
    new Request('http://localhost/api/plan', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
  )
}

/** Set by `install`, read by `post`, so no test threads a cookie by hand. */
let currentCookie: string | null = null

interface Harness {
  store: ReturnType<typeof createInMemoryPlanStore>
  personas: ReturnType<typeof createInMemoryPersonaStore>
  /** The signed-in traveller every request in a test is made as. */
  session: Awaited<ReturnType<typeof signedIn>>
  /** Every `progress` written to the job row, in order. */
  progress: JobProgress[]
  google: ReturnType<typeof createFakeGoogle>
}

async function install(
  overrides: {
    runPlan?: PlanRouteDeps['runPlan']
    enrichments?: EnrichmentStore
    personas?: ReturnType<typeof createInMemoryPersonaStore>
    failPassB?: boolean
  } = {},
): Promise<Harness> {
  const session = await signedIn({ now: NOW })
  const store = createInMemoryPlanStore({ itineraryId: 'itinerary-1' })
  const personas = overrides.personas ?? createInMemoryPersonaStore()
  const progress: JobProgress[] = []
  const google = createFakeGoogle({ places: CANDIDATES })

  const recording: PlanStore & typeof store = {
    ...store,
    async updateJob(id, patch, now) {
      if (patch.progress) progress.push(patch.progress)
      return store.updateJob(id, patch, now)
    },
  }

  planRouteDeps.create = (): PlanRouteDeps => ({
    store: recording,
    users: session.users,
    personas,
    runPlan: overrides.runPlan ?? runPlan,
    now: () => NOW,
    rng: mulberry32(1337),
    googleApiKey: 'test-key',
    cache: createInMemorySearchCache(),
    locations: createInMemoryLocationStore(),
    enrichments: overrides.enrichments ?? createInMemoryEnrichmentStore(),
    responses: createFakeResponses(overrides.failPassB ? { fail: 'assign' } : {}),
    fetch: google.fetch,
  })

  currentCookie = session.cookie
  return { store, personas, progress, google, session }
}

/** The background half is fire-and-forget, so tests wait on the row. */
async function settled(store: Harness['store'], jobId: string): Promise<JobRow> {
  await vi.waitFor(() => {
    const row = store.rows.get(jobId)
    expect(row?.status === 'completed' || row?.status === 'failed').toBe(true)
  })
  return store.rows.get(jobId)!
}

let networkFetch: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  // Nothing in a run may reach the real network. The pipeline's ports all take
  // an injected `fetch`; a call landing here means one of them didn't.
  networkFetch = vi.spyOn(globalThis, 'fetch')
})

afterEach(() => {
  planRouteDeps.create = originalCreate
  vi.restoreAllMocks()
})

describe('POST /api/plan', () => {
  it('refuses to plan for a signed-out caller, and leaves no job row behind', async () => {
    const harness = await install()
    const response = await post(BODY, null)

    expect(response.status).toBe(401)
    // The gate has to sit in front of `createJob`, or every anonymous request
    // leaves a queued row that nothing will ever finish.
    expect(harness.store.rows.size).toBe(0)
  })

  it('writes the signed-in traveller onto the itinerary it saves', async () => {
    const harness = await install()
    const job = (await (await post()).json()) as JobRow
    await settled(harness.store, job.id)

    // Without this the row saves with a null owner and the trip is invisible in
    // every list — which is exactly how it behaved before accounts existed.
    expect(harness.store.saved[0].itinerary.user_id).toBe(harness.session.user.id)
  })

  it('rejects a body that is not a plan request, without a stack trace', async () => {
    await install()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await post({ city: 'Kyoto', totalDays: 0 })

    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string }
    expect(body.error).toMatch(/check and try again/)
    expect(errors).toHaveBeenCalled()
  })

  it('returns the job row before the pipeline has finished', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let started = false
    const harness = await install({
      runPlan: async (request, deps) => {
        started = true
        await held
        return runPlan(request, deps)
      },
    })

    const response = await post()
    const job = (await response.json()) as JobRow

    // The response is out, the pipeline is still inside the gate.
    expect(response.status).toBe(202)
    expect(job.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(job.type).toBe('itinerary-planning')
    expect(job.status).toBe('queued')
    expect(started).toBe(true)
    expect(harness.store.rows.get(job.id)?.status).toBe('queued')
    expect(harness.store.saved).toHaveLength(0)

    release()
    const finished = await settled(harness.store, job.id)
    expect(finished.status).toBe('completed')
    expect(harness.store.saved).toHaveLength(1)
  })

  it('never walks the progress bar backwards, and finishes on exactly 100', async () => {
    const harness = await install()
    const job = (await (await post()).json()) as JobRow
    await settled(harness.store, job.id)

    const percents = harness.progress.map((entry) => entry.percent)
    expect(percents.length).toBeGreaterThan(5)
    expect(percents[0]).toBeGreaterThanOrEqual(0)
    expect(percents.at(-1)).toBe(100)
    for (let i = 1; i < percents.length; i++) {
      expect(
        percents[i],
        `the bar went from ${percents[i - 1]}% to ${percents[i]}% at ${harness.progress[i].stage}`,
      ).toBeGreaterThanOrEqual(percents[i - 1])
    }

    // Stage order is the pipeline's, plus the two the handler owns.
    expect(harness.progress.map((entry) => entry.stage)).toEqual([
      'retrieve',
      'cluster',
      'hydrate',
      'enrich',
      'assign',
      'schedule',
      'photos',
      'narrate',
      'save',
      'done',
    ])
    expect(harness.progress.at(-1)!.done).toBe(harness.progress.at(-1)!.total)

    // The loading screen's own fields: a timestamp to count from, an estimate
    // that shrinks, and the span the bar crawls across.
    for (const entry of harness.progress) {
      expect(entry.fired_at).toBe(NOW.toISOString())
      expect(entry.eta_seconds).toBeGreaterThanOrEqual(0)
      expect(entry.next_percent).toBeGreaterThanOrEqual(entry.percent)
    }
    const etas = harness.progress.map((entry) => entry.eta_seconds!)
    for (let i = 1; i < etas.length; i++) expect(etas[i]).toBeLessThanOrEqual(etas[i - 1])
  })

  it('stores a friendly error when a stage throws, and logs the technical one', async () => {
    const raw = 'OpenAI 429 rate_limit_exceeded'
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const harness = await install({
      enrichments: {
        async getMany() {
          throw new Error(raw)
        },
        async putMany() {},
        async updateStayDuration() {},
      },
    })

    const job = (await (await post()).json()) as JobRow
    const finished = await settled(harness.store, job.id)

    expect(finished.status).toBe('failed')
    expect(finished.error).toBeTruthy()
    expect(finished.error).not.toContain('OpenAI')
    expect(finished.error).not.toContain('429')
    expect(finished.error).not.toContain('rate_limit')
    expect(finished.error).toMatch(/couldn't build that itinerary/i)
    expect(harness.store.saved).toHaveLength(0)

    // The detail is not lost — it is in the log, where it belongs.
    const logged = errors.mock.calls.flat().map(String).join(' ')
    expect(logged).toContain(raw)
  })

  it('persists funnel_stats on the itinerary row, matching the funnel output', async () => {
    const harness = await install()
    const job = (await (await post()).json()) as JobRow
    await settled(harness.store, job.id)

    const [saved] = harness.store.saved
    const result: PlanResult = saved.result
    expect(saved.itinerary.funnel_stats).toEqual(result.funnelStats)
    expect(saved.itinerary.funnel_stats).toEqual(result.stats.funnel)
    // Real numbers, in the order the funnel narrows: retrieved ≥ filtered ≥
    // capped ≥ shortlist, and the shortlist is what Pass B actually saw.
    const stats = saved.itinerary.funnel_stats!
    expect(stats.retrieved).toBeGreaterThan(0)
    expect(stats.afterFilters).toBeLessThanOrEqual(stats.retrieved)
    expect(stats.afterClusterCap).toBeLessThanOrEqual(stats.afterFilters)
    expect(stats.afterGlobalCap).toBeLessThanOrEqual(stats.afterClusterCap)
    expect(stats.afterGlobalCap).toBe(result.scored.size)
  })

  it('persists the diagnostic record beside it, through the real handler', async () => {
    const harness = await install()
    const job = (await (await post()).json()) as JobRow
    await settled(harness.store, job.id)

    const [saved] = harness.store.saved
    const debug = saved.itinerary.planner_debug!

    // What the model said and what we refused, on the row you would open when
    // asking why a day came back strange. Both used to die with the request.
    expect(debug.version).toBe(3)
    expect(debug.assignment.rationale.length).toBeGreaterThan(0)
    expect(debug.assignment.rationale.every((entry) => entry.why.trim().length > 0)).toBe(true)
    expect(debug.assignment.fallbackDays).toEqual([])
    expect(debug.narration.truncated).toBe(0)
    expect(debug.enrichment.misses).toEqual(saved.result.debug.enrichment.misses)
  })

  it('stores the whole itinerary: one row per day, one per stop', async () => {
    const harness = await install()
    const job = (await (await post()).json()) as JobRow
    const finished = await settled(harness.store, job.id)

    const [saved] = harness.store.saved
    expect(finished.itinerary_id).toBe(saved.id)
    expect(saved.itinerary.name).toBe('Three days in Kyoto')
    expect(saved.itinerary.city).toBe('Kyoto')
    expect(saved.itinerary.start_date).toBe('2026-09-14')
    expect(saved.itinerary.total_days).toBe(3)
    expect(saved.itinerary.profile).toEqual(PROFILE)

    expect(saved.days.map((day) => day.day_index)).toEqual([0, 1, 2])
    expect(saved.days.map((day) => day.date)).toEqual([
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
    ])

    const scheduled = saved.result.days.flatMap((day) =>
      day.day.segments.filter((segment) => segment.kind === 'activity'),
    )
    expect(saved.activities).toHaveLength(scheduled.length)
    for (const activity of saved.activities) {
      expect(activity.start_min).toBeLessThan(activity.end_min)
      expect(activity.match_reasons!.length).toBeGreaterThan(0)
      expect(activity.content).toBeTruthy()
    }
  })

  it('produces an itinerary the invariant suite accepts, with zero network calls', async () => {
    const harness = await install()
    const job = (await (await post()).json()) as JobRow
    await settled(harness.store, job.id)

    const [saved] = harness.store.saved
    expect(saved.result.days).toHaveLength(3)
    for (const day of saved.result.days) assertValidItinerary(day.day, day.input)

    expect(networkFetch).not.toHaveBeenCalled()
    expect(harness.google.searchCalls.length).toBeGreaterThan(0)
    expect(harness.google.mediaCalls.length).toBeGreaterThan(0)
  })

  it('resolves personaId into the persona, and snapshots it on the row', async () => {
    const harness = await install()
    await harness.personas.upsert({
      userId: harness.session.user.id,
      answers: QUIZ_ANSWERS,
      dimensions: calculatePersona(QUIZ_ANSWERS).dimensions,
      archetype: calculatePersona(QUIZ_ANSWERS).archetype.id,
      now: NOW,
    })

    const job = (await (await post()).json()) as JobRow
    await settled(harness.store, job.id)

    const [saved] = harness.store.saved
    // The pipeline is handed the persona itself; it never learns there is a
    // table. And the row carries the whole thing, answers included, because
    // `travel_personas` is rewritten on a retake and a join would then
    // re-explain this trip with a personality it was never planned from.
    expect(saved.result.request.persona?.answers).toEqual(QUIZ_ANSWERS)
    expect(saved.itinerary.persona?.answers).toEqual(QUIZ_ANSWERS)
    expect(saved.itinerary.persona?.result.archetype.id).toBe(
      calculatePersona(QUIZ_ANSWERS).archetype.id,
    )
  })

  it('rebuilds the result from the stored answers, not from the stored scores', async () => {
    const harness = await install()
    await harness.personas.upsert({
      userId: harness.session.user.id,
      answers: QUIZ_ANSWERS,
      // Deliberately wrong, as a scoring change would leave them. The answers
      // are the source of truth, so these must not reach the itinerary.
      dimensions: { structure: 0, comfort: 0, focus: 0, social: 0 },
      archetype: 'weekend_warrior',
      now: NOW,
    })

    const job = (await (await post()).json()) as JobRow
    await settled(harness.store, job.id)

    const snapshot = harness.store.saved[0].itinerary.persona!
    expect(snapshot.result.dimensions).toEqual(calculatePersona(QUIZ_ANSWERS).dimensions)
  })

  it('plans without a persona when the traveller has no row', async () => {
    const harness = await install()
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const job = (await (await post()).json()) as JobRow
    const finished = await settled(harness.store, job.id)

    // Never taking the quiz costs personalisation, never the trip.
    expect(finished.status).toBe('completed')
    expect(harness.store.saved[0].itinerary.persona).toBeNull()
    expect(warnings).toHaveBeenCalled()
  })

  it('stores null persona when the traveller never took the quiz', async () => {
    const harness = await install()
    const job = (await (await post()).json()) as JobRow
    await settled(harness.store, job.id)
    expect(harness.store.saved[0].itinerary.persona).toBeNull()
  })

  it('builds the profile from the persona, and two travellers differ', async () => {
    // The point of the whole persona layer: same city, same dates, same form,
    // two people, two different plans. If this stops being true the quiz is
    // collecting twelve answers and spending none of them.
    async function planAs(answers: QuizAnswers) {
      const harness = await install()
      await harness.personas.upsert({
        userId: harness.session.user.id,
        answers,
        dimensions: calculatePersona(answers).dimensions,
        archetype: calculatePersona(answers).archetype.id,
        now: NOW,
      })
      const job = (await (await post()).json()) as JobRow
      await settled(harness.store, job.id)
      return harness.store.saved[0]
    }

    const first = await planAs(QUIZ_ANSWERS)
    const second = await planAs(QUIZ_ANSWERS_LAST)

    // The submitted interests were the demo placeholder; the persona replaced
    // them, and the archetype's type map came with them.
    expect(first.itinerary.profile.interests).not.toEqual(PROFILE.interests)
    expect(first.itinerary.profile.typeAffinities).toBeDefined()
    expect(first.itinerary.profile.interests).not.toEqual(second.itinerary.profile.interests)

    // Dietary is a hard constraint and is never inferred; pace was typed.
    expect(first.itinerary.profile.dietary).toEqual(PROFILE.dietary)
    expect(first.itinerary.profile.pace).toBe(PROFILE.pace)
    expect(second.itinerary.profile.pace).toBe(PROFILE.pace)

    // And the trips themselves are not the same trip.
    const stopsOf = (saved: typeof first) => saved.activities.map((a) => a.slot_role).join('|')
    expect(
      stopsOf(first) !== stopsOf(second) ||
        first.result.scored.size !== second.result.scored.size ||
        [...first.result.places.keys()].join() !== [...second.result.places.keys()].join(),
    ).toBe(true)
  })

  it('leaves the submitted profile alone when there is no persona', async () => {
    const harness = await install()
    const job = (await (await post()).json()) as JobRow
    await settled(harness.store, job.id)
    expect(harness.store.saved[0].itinerary.profile).toEqual(PROFILE)
  })

  it('still completes when Pass B is down', async () => {
    const harness = await install({ failPassB: true })
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const job = (await (await post()).json()) as JobRow
    const finished = await settled(harness.store, job.id)

    expect(finished.status).toBe('completed')
    expect(harness.store.saved[0].activities.length).toBeGreaterThan(0)
    expect(errors).toHaveBeenCalled()
  })
})
