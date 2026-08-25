/**
 * Step 15 — the composed pipeline, run end to end with zero network.
 *
 * The stages all have their own tests; what this file covers is the *seams
 * between* them, which is where a composition bug lives and where no unit test
 * looks. Four of them are load-bearing enough to have their own case below:
 *
 *   - the weekday comes from the trip's start date, not the host's timezone
 *   - an enrichment miss does not block the run
 *   - the rows Pass B and the validator see are the **hydrated** ones
 *   - photos are resolved for the stops that survived scheduling, and no others
 *
 * The fifth is that a dead Pass B still produces a trip.
 */

import { describe, expect, it, vi } from 'vitest'

import candidates from './__fixtures__/kyoto-candidates.json'
import { createFakeGoogle, createFakeResponses } from './__tests__/fakes'
import { assertValidItinerary } from './__tests__/invariants'
import { mulberry32 } from './__tests__/rng'
import { resolveVisitDuration } from './duration'
import {
  createInMemoryEnrichmentStore,
  type EnrichmentSubject,
  type StoredEnrichment,
} from './enrich'
import { dayCapacity, type AssignResult } from './assign'
import type { ScoredCluster } from './funnel'
import {
  MAX_PROMPT_CACHE_KEY,
  addDays,
  advanceWeekday,
  alternatesFor,
  assignSerendipity,
  promptCacheKeyFor,
  createStraightLineTravel,
  parseIsoDate,
  runPlan,
  searchLocality,
  survivorIdsFromDays,
  weekdayOf,
  type PlanProgress,
  type PlanRequest,
  type PlanResult,
} from './pipeline'
import { buildSearchPlan, createInMemoryLocationStore, createInMemorySearchCache } from './retrieval'
import { QUESTIONS, calculatePersona } from '@/lib/persona/quiz'
import { MODELS } from './openai'
import { SHARED_PREFIX_BLOCK_COUNT } from './narrate'
import { isRestaurant } from './taxonomy'
import type { CandidatePlace, PlaceEnrichment, PreferenceProfile } from './types'

const CANDIDATES = candidates as CandidatePlace[]

/** Three days in Kyoto, vegetarian, mid-budget, arriving on a Monday — the day
 *  the fixture's museums are shut, so repair has something to do. */
const PROFILE: PreferenceProfile = {
  interests: ['temples', 'cafes', 'food'],
  dietary: ['vegetarian'],
  pace: 'balanced',
  budget: 2,
}

const REQUEST: PlanRequest = {
  city: 'Kyoto',
  country: 'Japan',
  startDate: '2026-09-14',
  totalDays: 3,
  profile: PROFILE,
}

const NOW = new Date('2026-08-24T09:00:00.000Z')

interface RunOptions {
  request?: Partial<PlanRequest>
  servesVegetarianFood?: Record<string, boolean>
  enrichments?: readonly StoredEnrichment[]
  failPassB?: boolean
  failTheme?: boolean
  hallucinateAnchors?: readonly string[]
  onProgress?: (progress: PlanProgress) => void
  enqueueEnrichments?: (subjects: readonly EnrichmentSubject[], now: Date) => Promise<void>
  /** Places only a Nearby Search can reach. See `FakeGoogleOptions.nearbyOnly`. */
  nearbyOnly?: readonly CandidatePlace[]
}

async function plan(options: RunOptions = {}): Promise<{
  result: PlanResult
  google: ReturnType<typeof createFakeGoogle>
}> {
  const google = createFakeGoogle({
    places: CANDIDATES,
    servesVegetarianFood: options.servesVegetarianFood,
    ...(options.nearbyOnly ? { nearbyOnly: options.nearbyOnly } : {}),
  })
  const result = await runPlan(
    { ...REQUEST, ...options.request },
    {
      googleApiKey: 'test-key',
      cache: createInMemorySearchCache(),
      store: createInMemoryLocationStore(),
      enrichments: createInMemoryEnrichmentStore(options.enrichments),
      enqueueEnrichments: options.enqueueEnrichments,
      responses: createFakeResponses({
        ...(options.failPassB ? { fail: 'assign' as const } : {}),
        ...(options.failTheme ? { fail: 'theme' as const } : {}),
        ...(options.hallucinateAnchors
          ? { hallucinateAnchors: options.hallucinateAnchors }
          : {}),
      }),
      fetch: google.fetch,
      now: NOW,
      rng: mulberry32(1337),
      getTravelLeg: createStraightLineTravel(),
      onProgress: options.onProgress,
    },
  )
  return { result, google }
}

describe('dates and weekdays', () => {
  it('reads the weekday off the calendar date, whatever the host timezone is', () => {
    const original = process.env.TZ
    // Two zones either side of Greenwich. In Los Angeles, UTC midnight on the
    // 14th is 17:00 on the 13th — a Sunday — which is exactly the off-by-one
    // a bare `new Date("2026-09-14").getDay()` produces.
    const zones = ['America/Los_Angeles', 'Pacific/Kiritimati', 'UTC']
    try {
      const naive: number[] = []
      for (const zone of zones) {
        process.env.TZ = zone
        naive.push(new Date('2026-09-14').getDay())
        expect(weekdayOf('2026-09-14'), `weekdayOf disagreed with itself in ${zone}`).toBe(1)
      }
      // If this fails, the platform ignored `process.env.TZ` and the assertion
      // above proved nothing — the test is broken, not the code.
      expect(
        new Set(naive).size,
        'process.env.TZ had no effect, so the timezone case was never exercised',
      ).toBeGreaterThan(1)
    } finally {
      process.env.TZ = original
    }
  })

  it('walks the week forward across a month boundary', () => {
    expect(weekdayOf('2026-09-30')).toBe(3)
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    // A leap day, which is where naive month arithmetic falls over.
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(advanceWeekday(6, 1)).toBe(0)
    expect(advanceWeekday(3, 11)).toBe(0)
  })

  it('refuses a date that is not a real calendar date', () => {
    expect(() => parseIsoDate('2026-02-30')).toThrow(/not a real calendar date/)
    expect(() => parseIsoDate('14/09/2026')).toThrow(/YYYY-MM-DD/)
  })

  it('dates every planned day from the start date', async () => {
    const { result } = await plan()
    expect(result.days.map((day) => day.date)).toEqual([
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
    ])
    expect(result.days.map((day) => day.weekday)).toEqual([1, 2, 3])
  })
})

describe('a full run', () => {
  it('produces a valid itinerary and touches no network', async () => {
    const seen: PlanProgress[] = []
    const { result, google } = await plan({ onProgress: (progress) => seen.push(progress) })

    expect(result.days).toHaveLength(3)
    for (const day of result.days) assertValidItinerary(day.day, day.input)

    const stops = result.days.flatMap((day) =>
      day.day.segments.filter((segment) => segment.kind === 'activity'),
    )
    expect(stops.length).toBeGreaterThan(8)
    // Every stop has prose and a place row behind it.
    for (const stop of stops) {
      expect(result.content.get(stop.placeId)?.whyForYou.length ?? 0).toBeGreaterThan(0)
      expect(result.places.has(stop.placeId)).toBe(true)
    }

    // The stages, in order, each reported once before it ran.
    expect(seen.map((progress) => progress.stage)).toEqual([
      'retrieve',
      'cluster',
      'hydrate',
      'enrich',
      'assign',
      'schedule',
      'photos',
      'narrate',
    ])
    expect(google.searchCalls.length).toBeGreaterThan(0)
  })

  it('reports every stage it could have lost a candidate at', async () => {
    const { result } = await plan()
    const { stats } = result

    expect(stats.retrieval.billedCalls).toBe(stats.retrieval.unique)
    expect(stats.funnel.retrieved).toBeGreaterThan(stats.funnel.afterGlobalCap)
    expect(result.funnelStats).toEqual(stats.funnel)
    expect(stats.clustering.clusters).toBeGreaterThan(0)
    expect(stats.assignment.days).toBe(3)
    expect(stats.narration.requested).toBe(stats.scheduling.scheduled)
  })

  it('keeps the funnel own numbers on the result', async () => {
    const { result } = await plan()
    expect(Object.keys(result.funnelStats).sort()).toEqual([
      'afterClusterCap',
      'afterFilters',
      'afterGlobalCap',
      'retrieved',
    ])
    expect(result.funnelStats.afterGlobalCap).toBe(result.scored.size)
  })
})

describe('enrichment misses do not block the run', () => {
  it('ships a full itinerary and sizes visits from the type heuristic', async () => {
    const { result } = await plan()

    expect(result.stats.enrichment.hits).toBe(0)
    expect(result.stats.enrichment.misses).toBe(result.funnelStats.afterGlobalCap)
    expect(result.days.some((day) => day.day.segments.length > 0)).toBe(true)

    // Rung 3 of the duration ladder: with no cached enrichment and no stored
    // stay_duration, every visit is the type table's answer.
    const sized = result.days.flatMap((day) => day.input.assignments)
    expect(sized.length).toBeGreaterThan(0)
    for (const assignment of sized) {
      expect(assignment.duration).toEqual(
        resolveVisitDuration(assignment.place, undefined, PROFILE.pace),
      )
    }
  })

  it('hands every cold shortlist row to the durable batch seam', async () => {
    const queued: EnrichmentSubject[] = []
    const { result } = await plan({
      enqueueEnrichments: async (subjects, now) => {
        expect(now).toBe(NOW)
        queued.push(...subjects)
      },
    })

    expect(queued).toHaveLength(result.stats.enrichment.misses)
    expect(new Set(queued.map((place) => place.placeId)).size).toBe(queued.length)
  })
})

describe('hydration reaches Pass B and the validator', () => {
  it('lets a `servesVegetarianFood: false` from hydration change the day', async () => {
    const clean = await plan()
    const lunch = clean.result.days
      .flatMap((day) => day.day.segments)
      .find((segment) => segment.kind === 'activity' && segment.role === 'lunch')
    expect(lunch, 'the baseline run seated no lunch, so there is nothing to spoil').toBeDefined()
    const lunchId = lunch!.kind === 'activity' ? lunch!.placeId : ''

    // The baseline had no complaint about that stop.
    expect(
      clean.result.days.flatMap((day) => day.repairs).filter((repair) => repair.rule === 'meal_slot'),
    ).toHaveLength(0)

    // Now Google answers "no vegetarian food" for exactly that place. The flag
    // arrives only at hydration, so this fails unless the hydrated row — not
    // the pre-hydration snapshot — is what reaches validation.
    const spoiled = await plan({ servesVegetarianFood: { [lunchId]: false } })
    const repairs = spoiled.result.days
      .flatMap((day) => day.repairs)
      .filter((repair) => repair.rule === 'meal_slot')
    const failures = spoiled.result.days
      .flatMap((day) => day.failures)
      .filter((failure) => failure.rule === 'meal_slot')

    expect(repairs.length + failures.length).toBeGreaterThan(0)
    expect([
      ...repairs.map((repair) => repair.removed.placeId),
      ...failures.map((failure) => failure.placeId),
    ]).toContain(lunchId)
    // And it is gone from the timeline, in that slot at least.
    const stillAtLunch = spoiled.result.days
      .flatMap((day) => day.day.segments)
      .some(
        (segment) =>
          segment.kind === 'activity' && segment.role === 'lunch' && segment.placeId === lunchId,
      )
    expect(stillAtLunch).toBe(false)
  })

  it('carries the hydrated row into the stored place, not the search snapshot', async () => {
    const { result } = await plan()
    // Every shortlisted place was asked for its Atmosphere fields exactly once.
    expect(result.stats.hydration.requested).toBe(result.funnelStats.afterGlobalCap)
    expect(result.stats.hydration.billedCalls).toBe(result.stats.hydration.requested)
    expect(result.stats.hydration.failures).toEqual([])
    for (const place of result.places.values()) {
      expect(place.shortlistHydratedAt, `${place.name} reached the trip unhydrated`).not.toBeNull()
    }
  })
})

describe('photos', () => {
  it('resolves for the stops that survived scheduling and nothing else', async () => {
    const { result, google } = await plan()

    const survivors = survivorIdsFromDays(result.days.map((day) => day.day))
    expect(result.stats.photos.requested).toBe(survivors.length)
    expect(result.stats.photos.notInPool).toBe(0)
    expect(result.stats.photos.resolved).toBe(survivors.length)

    // The shortlist is the pool Pass B chose from; the trip is a fraction of it.
    expect(survivors.length).toBeLessThan(result.funnelStats.afterGlobalCap)
    expect(result.stats.photos.poolSize).toBeGreaterThan(survivors.length)

    // The billed calls name survivors, and only survivors.
    const billed = google.mediaCalls.map((name) => name.split('/')[1])
    expect(billed.slice().sort()).toEqual(survivors.slice().sort())
  })
})

describe('a dead Pass B', () => {
  it('degrades to the ranked shortlist and still produces a trip', async () => {
    const { result } = await plan({ failPassB: true })

    expect(result.stats.assignment.fallbackDays).toBe(3)
    expect(result.days).toHaveLength(3)
    for (const day of result.days) assertValidItinerary(day.day, day.input)

    const stops = result.days.flatMap((day) =>
      day.day.segments.filter((segment) => segment.kind === 'activity'),
    )
    expect(stops.length).toBeGreaterThan(8)
    // Narration still ran — only the assignment call was down.
    expect(result.stats.narration.narrated).toBe(stops.length)
    // And the fallback still seats meals in restaurants.
    const meals = result.days.flatMap((day) =>
      day.day.segments.flatMap((segment) =>
        segment.kind === 'activity' && (segment.role === 'lunch' || segment.role === 'dinner')
          ? [result.places.get(segment.placeId)!]
          : [],
      ),
    )
    expect(meals.length).toBeGreaterThan(0)
    for (const place of meals) expect(isRestaurant(place)).toBe(true)
  })
})

describe('travel legs', () => {
  it('prices the leg leaving each stop but never the last one', async () => {
    const { result } = await plan()
    for (const day of result.days) {
      const stops = day.day.segments.filter((segment) => segment.kind === 'activity')
      if (stops.length < 2) continue
      expect(day.travelToNext.has(stops.at(-1)!.placeId)).toBe(false)
      const leg = day.travelToNext.get(stops[0].placeId)
      expect(leg, 'the first stop of a multi-stop day has no leg leaving it').toBeDefined()
      expect(leg!.minutes).toBeGreaterThan(0)
      expect(leg!.meters).toBeGreaterThanOrEqual(0)
      expect(leg!.mode).toBe(leg!.meters < 1200 ? 'walk' : 'transit')
    }
  })
})

describe('the search locality', () => {
  it('leaves Singapore exactly as it was — the demo path must not move', () => {
    // The create flow sends `city` and `country` both as "Singapore", because
    // the city-state has no region to pick. Appending the country would change
    // every query string and therefore every `searchCacheKey`, quietly throwing
    // away the pre-warmed rows the demo runs on.
    expect(searchLocality('Singapore', 'Singapore')).toBe('Singapore')
    expect(searchLocality('Singapore', 'singapore')).toBe('Singapore')

    const demoProfile: PreferenceProfile = {
      interests: ['outdoors', 'cafes', 'museums', 'food'],
      dietary: [],
      pace: 'balanced',
    }
    expect(
      buildSearchPlan(demoProfile, searchLocality('Singapore', 'Singapore')),
    ).toEqual(buildSearchPlan(demoProfile, 'Singapore'))
  })

  it('names the country when it adds something, so Springfield is answerable', () => {
    expect(searchLocality('Kyoto', 'Japan')).toBe('Kyoto, Japan')
    expect(searchLocality('Springfield', 'United States')).toBe('Springfield, United States')
  })

  it('is the city alone when no country was given', () => {
    expect(searchLocality('Kyoto')).toBe('Kyoto')
    expect(searchLocality('  Kyoto  ', '   ')).toBe('Kyoto')
  })

  it('reaches Google — the country is on the wire, not just on the row', async () => {
    const { google } = await plan({ request: { city: 'Kyoto', country: 'Japan' } })
    expect(google.searchCalls.length).toBeGreaterThan(0)
    for (const body of google.searchCalls) expect(body).toContain('Kyoto, Japan')
  })
})

describe('repairs draw on the same duration ladder Pass B used', () => {
  const place = CANDIDATES.find((entry) => entry.types.includes('museum'))!
  const enrichment: PlaceEnrichment = {
    description: 'A long one.',
    tags: [],
    confidence: 0.9,
    // Deliberately nothing like the museum heuristic's 90 minutes.
    avgVisitMinutes: [200, 240],
  }
  const cluster = {
    places: [place],
    scored: [{ placeId: place.placeId, score: 0.8, reasons: [] }],
    score: 0.8,
  } as unknown as Parameters<typeof alternatesFor>[0]

  it('sizes a spare from its enrichment, not from the type heuristic', () => {
    const withEnrichment = alternatesFor(
      cluster,
      { assignments: [], flex: [] },
      PROFILE,
      new Map([[place.placeId, enrichment]]),
    )
    expect(withEnrichment).toHaveLength(1)
    expect(withEnrichment[0].duration).toEqual(
      resolveVisitDuration(place, enrichment, PROFILE.pace),
    )
  })

  it('gives the same place the same length whichever path it arrives by', () => {
    // The bug this pins: a museum Pass B picked was 90 minutes and the same
    // museum swapped in by `validate.ts` was whatever the heuristic said.
    const asAlternate = alternatesFor(
      cluster,
      { assignments: [], flex: [] },
      PROFILE,
      new Map([[place.placeId, enrichment]]),
    )[0].duration
    const asAssignment = resolveVisitDuration(place, enrichment, PROFILE.pace)
    expect(asAlternate).toEqual(asAssignment)

    const heuristic = resolveVisitDuration(place, undefined, PROFILE.pace)
    expect(
      asAlternate,
      'the fixture no longer distinguishes the two rungs, so this test proves nothing',
    ).not.toEqual(heuristic)
  })

  it('falls back to the heuristic for a place with no enrichment', () => {
    const [alternate] = alternatesFor(cluster, { assignments: [], flex: [] }, PROFILE, new Map())
    expect(alternate.duration).toEqual(resolveVisitDuration(place, undefined, PROFILE.pace))
  })
})

describe('the diagnostic record', () => {
  it("keeps Pass B's sentence per stop instead of paying for it and dropping it", async () => {
    const { result } = await plan()
    const { rationale } = result.debug.assignment

    expect(rationale.length).toBeGreaterThan(0)
    for (const entry of rationale) {
      expect(entry.why.trim().length).toBeGreaterThan(0)
      expect(entry.dayIndex).toBeGreaterThanOrEqual(0)
      expect(entry.dayIndex).toBeLessThan(3)
      expect(['assignment', 'flex']).toContain(entry.kind)
    }
    // A flex pick's sentence is kept too — it is the same call and the same cost.
    expect(rationale.some((entry) => entry.kind === 'flex')).toBe(true)
  })

  it('records the enrichment misses that shipped on the type heuristic', async () => {
    const { result } = await plan()
    expect(result.debug.enrichment.misses).toEqual(
      expect.arrayContaining([expect.any(String)]),
    )
    expect(result.debug.enrichment.misses.length).toBe(result.stats.enrichment.misses)
  })

  it('names the days the ranked shortlist had to fill', async () => {
    const { result } = await plan({ failPassB: true })
    expect(result.debug.assignment.fallbackDays).toEqual([0, 1, 2])
    expect(result.debug.assignment.rationale).toEqual([])
  })

  it('stamps itself from the injected clock, never the wall clock', async () => {
    const { result } = await plan()
    expect(result.debug.recordedAt).toBe(NOW.toISOString())
    expect(result.debug.version).toBe(1)
  })
})

describe('the serendipity slot', () => {
  const profile: PreferenceProfile = { interests: ['cafes'], dietary: [], pace: 'balanced' }

  function place(placeId: string, overrides: Partial<CandidatePlace> = {}): CandidatePlace {
    return { placeId, name: placeId, types: ['cafe'], ...overrides }
  }

  const gem = place('gem')
  const spent = place('spent')

  function clusterOf(places: CandidatePlace[], score = 1): ScoredCluster {
    return {
      centroid: { latitude: 35, longitude: 135.7 },
      score,
      places,
      scored: places.map((p) => ({ placeId: p.placeId, score: 0.5, reasons: [] })),
    }
  }

  /** Two days, each with one assigned stop, and nothing in flex. */
  function assignmentOf(assigned: CandidatePlace[][]): AssignResult {
    return {
      days: assigned.map((places, dayIndex) => ({
        dayIndex,
        fallback: false,
        input: {
          assignments: places.map((place, position) => ({
            place,
            role: 'activity' as const,
            position,
            score: 0.5,
            duration: { min: 60, preferred: 60, max: 60 },
          })),
        },
      })),
      rationale: [],
      dropped: [],
    }
  }

  it('puts a wildcard on the day whose cluster holds it', () => {
    const byDay = assignSerendipity(
      [gem],
      [clusterOf([spent]), clusterOf([gem])],
      assignmentOf([[spent], []]),
      profile,
      new Map(),
    )
    // Day 1, not day 0. A wildcard on the wrong side of the city is not
    // serendipity, it is a bus ride.
    expect([...byDay.keys()]).toEqual([1])
    expect(byDay.get(1)?.[0].place.placeId).toBe('gem')
  })

  it('drops a wildcard Pass B already spent', () => {
    const byDay = assignSerendipity(
      [spent],
      [clusterOf([spent])],
      assignmentOf([[spent]]),
      profile,
      new Map(),
    )
    expect(byDay.size).toBe(0)
  })

  it('drops a wildcard whose cluster produced no day', () => {
    // Three clusters, two days: the third cluster's places have nowhere to go.
    const orphan = place('orphan')
    const byDay = assignSerendipity(
      [orphan],
      [clusterOf([spent]), clusterOf([gem]), clusterOf([orphan])],
      assignmentOf([[spent], [gem]]),
      profile,
      new Map(),
    )
    expect(byDay.size).toBe(0)
  })

  it('sizes the wildcard from the same duration ladder every other stop used', () => {
    const enrichment: PlaceEnrichment = {
      description: 'a quiet room',
      tags: [],
      confidence: 0.9,
      avgVisitMinutes: [100, 140],
    }
    const byDay = assignSerendipity(
      [gem],
      [clusterOf([gem])],
      assignmentOf([[]]),
      profile,
      new Map([['gem', enrichment]]),
    )
    expect(byDay.get(0)?.[0].duration).toEqual(
      resolveVisitDuration(gem, enrichment, profile.pace),
    )
  })

  it('adds nothing to a run with no persona, through the whole pipeline', async () => {
    // The requirement that keeps Gate A still: `serendipityPerTrip` is 0 unless
    // a persona raised it, so a day still carries exactly the one flex pick
    // Pass B was given room for, never a second one from here.
    const { result } = await plan()
    const allowed = dayCapacity(PROFILE.pace).flex
    expect(allowed).toBe(1)
    for (const day of result.days) {
      expect((day.input.flex ?? []).length).toBeLessThanOrEqual(allowed)
    }
  })
})

describe('the prompt cache key', () => {
  const base: PlanRequest = {
    city: 'Kyoto',
    startDate: '2026-09-14',
    totalDays: 3,
    profile: { interests: ['temples'], dietary: [], pace: 'balanced' },
  }

  it('never exceeds the provider limit, however long the inputs are', () => {
    // The bug a real run found and no test did: spelled out, this key is 84
    // characters, OpenAI answers 400 on *every* model call in the run, and each
    // one degrades to its documented fallback — so the plan completes and the
    // trip still looks like a trip.
    const worst: PlanRequest = {
      ...base,
      city: 'Ciudad Autonoma de Buenos Aires, Argentina',
      profile: {
        interests: ['outdoors', 'cafes', 'temples', 'museums', 'food', 'nightlife', 'shopping'],
        dietary: ['vegetarian', 'vegan', 'halal', 'gluten-free'],
        pace: 'relaxed',
        budget: 4,
      },
      persona: {
        answers: Array(QUESTIONS.length).fill(0),
        result: calculatePersona(Array(QUESTIONS.length).fill(0)),
      },
    }
    expect(promptCacheKeyFor(worst).length).toBeLessThanOrEqual(MAX_PROMPT_CACHE_KEY)
    expect(promptCacheKeyFor(base).length).toBeLessThanOrEqual(MAX_PROMPT_CACHE_KEY)
  })

  it('still says which city it belongs to', () => {
    expect(promptCacheKeyFor(base)).toMatch(/^plan:kyoto:/)
  })

  it('gives two travellers with the same taste one warm key', () => {
    expect(promptCacheKeyFor(base)).toBe(promptCacheKeyFor({ ...base, name: 'Another trip' }))
  })

  it('gives two personas two keys rather than letting them thrash one', () => {
    const withPersona = (answers: number[]): PlanRequest => ({
      ...base,
      persona: { answers, result: calculatePersona(answers) },
    })
    const first = withPersona(Array(QUESTIONS.length).fill(0))
    const last = withPersona(QUESTIONS.map((q) => q.options.length - 1))
    expect(promptCacheKeyFor(first)).not.toBe(promptCacheKeyFor(last))
    // And no persona is not one of them — it reads as the neutral row.
    expect(promptCacheKeyFor(base)).not.toBe(promptCacheKeyFor(first))
  })
})

describe('themed mode', () => {
  it('is off by default — a plan with no mode runs exactly as it always did', async () => {
    const { result, google } = await plan()
    expect(google.nearbyCalls).toHaveLength(0)
    expect(result.stats.explore).toBeUndefined()
    expect(result.stats.theming).toBeUndefined()
    expect(result.debug.themes).toBeUndefined()
    for (const day of result.days) expect(day.areaName).toBeDefined()
  })

  it('names every day and searches around each anchor', async () => {
    const { result, google } = await plan({ request: { mode: 'themed' } })

    expect(result.stats.theming?.themed).toBe(3)
    expect(result.stats.theming?.fellBack).toBe(0)
    // One Nearby Search per theme, plus at most one more per day when the
    // feasibility ladder has to widen a theme that cannot seat two meals.
    expect(google.nearbyCalls.length).toBeGreaterThanOrEqual(3)
    expect(google.nearbyCalls.length).toBeLessThanOrEqual(6)
    // A widen that found nothing still bills, so the count is not derivable
    // from the repair list — but every repair that *did* help is on the record.
    for (const repair of result.debug.themes!.repairs) {
      expect(repair.after).toBeGreaterThan(repair.before)
      expect(repair.reason.length).toBeGreaterThan(0)
    }
    const poolCoords = new Set(
      CANDIDATES.filter((p) => p.latitude !== undefined).map(
        (p) => `${p.latitude},${p.longitude}`,
      ),
    )
    for (const call of google.nearbyCalls) {
      expect(poolCoords.has(`${call.latitude},${call.longitude}`)).toBe(true)
      expect(call.radius).toBeGreaterThan(0)
    }

    // Each day carries its own premise, in day order.
    expect(result.debug.themes?.titles.map((t) => t.dayIndex)).toEqual([0, 1, 2])
    expect(result.debug.themes?.fallbacks).toEqual([])
  })

  it('costs the Nearby Searches on a separate line from the bulk Text Search', async () => {
    // "What did themes cost" is a question somebody will ask, and one merged
    // counter cannot answer it — the two are different SKUs.
    const { result } = await plan({ request: { mode: 'themed' } })
    expect(result.stats.explore!.billedCalls).toBeGreaterThan(0)
    expect(result.stats.retrieval.billedCalls).toBeGreaterThan(0)
    expect(result.stats.explore).not.toBe(result.stats.retrieval)
  })

  it('never buys the Atmosphere tier on a nearby call', async () => {
    // Google sets the SKU from the highest-tier field in the mask, per call.
    // One Atmosphere field here would bump the tier on every nearby search in
    // every plan, for a pool the funnel cuts to ~60 anyway.
    const google = createFakeGoogle({ places: CANDIDATES })
    const masks: string[] = []
    const recording: typeof google.fetch = async (url, init) => {
      if (url.includes('searchNearby')) masks.push(init.headers['X-Goog-FieldMask'] ?? '')
      return google.fetch(url, init)
    }
    await runPlan(
      { ...REQUEST, mode: 'themed' },
      {
        googleApiKey: 'test-key',
        cache: createInMemorySearchCache(),
        store: createInMemoryLocationStore(),
        enrichments: createInMemoryEnrichmentStore(),
        responses: createFakeResponses(),
        fetch: recording,
        now: NOW,
        rng: mulberry32(1337),
        getTravelLeg: createStraightLineTravel(),
      },
    )

    expect(masks.length).toBeGreaterThan(0)
    for (const mask of masks) {
      expect(mask).not.toMatch(/reviews|editorialSummary|reviewSummary|serves/i)
    }
  })

  it('falls back to geography, and still ships a trip, when the theme pass dies', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result, google } = await plan({
      request: { mode: 'themed' },
      failTheme: true,
    })

    // The worst case for a themed run is the default run, one model call poorer.
    expect(result.days).toHaveLength(3)
    expect(result.stats.theming).toEqual({ themed: 0, fellBack: 3, repaired: 0 })
    expect(google.nearbyCalls).toHaveLength(0)
    for (const day of result.days) assertValidItinerary(day.day, day.input)
    errors.mockRestore()
  })

  it('records the day it refused, rather than losing it', async () => {
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = await plan({
      request: { mode: 'themed' },
      hallucinateAnchors: ['a-glassblowing-quarter'],
    })

    // Day one loses its premise and gets a geographic cluster; the other two
    // are untouched, and the reason is on the row rather than in a log line.
    expect(result.stats.theming?.themed).toBe(2)
    expect(result.stats.theming?.fellBack).toBe(1)
    expect(result.debug.themes?.fallbacks).toContainEqual({
      dayIndex: 0,
      anchorPlaceId: 'a-glassblowing-quarter',
      reason: 'the anchor names a place that is not in the pool',
    })
    expect(result.days).toHaveLength(3)
    warnings.mockRestore()
  })

  it('carries a place only the Nearby Search found all the way to the result', async () => {
    // The explored half of the pool lives only in `poolWithExplored`. A stage
    // that reads `pool` instead still produces a complete-looking itinerary —
    // the day has the stop — but the stop reaches the database with no
    // `location_id`, no photo and no Atmosphere fields. Nothing else in this
    // suite could see that, because the Google fake used to answer nearby
    // searches out of the text-search pool.
    const first = await plan({ request: { mode: 'themed' } })
    const byId = new Map(CANDIDATES.map((p) => [p.placeId, p]))
    const nearbyOnly = first.result.debug
      .themes!.titles.flatMap((theme, index) => {
        const anchor = byId.get(theme.anchorPlaceId)
        if (anchor?.latitude === undefined || anchor.longitude === undefined) return []
        return [
          {
            placeId: `nearby-only-diner-${index}`,
            name: `Circle Diner ${index}`,
            types: ['restaurant', 'vegetarian_restaurant'],
            latitude: anchor.latitude + 0.0005,
            longitude: anchor.longitude + 0.0005,
            rating: 4.9,
            userRatingCount: 5_000,
            priceLevel: 2,
          },
          {
            placeId: `nearby-only-temple-${index}`,
            name: `Circle Temple ${index}`,
            types: ['tourist_attraction'],
            latitude: anchor.latitude - 0.0005,
            longitude: anchor.longitude - 0.0005,
            rating: 4.9,
            userRatingCount: 6_000,
          },
        ] as CandidatePlace[]
      })
    expect(nearbyOnly.length).toBeGreaterThan(0)

    const { result } = await plan({ request: { mode: 'themed' }, nearbyOnly })
    const scheduled = result.days.flatMap((planned) =>
      planned.day.segments.flatMap((segment) =>
        segment.kind === 'activity' ? [segment.placeId] : [],
      ),
    )

    // Not vacuous: the circles really did find them and they really are in the
    // trip. Without this the two assertions below pass on an empty set.
    expect(scheduled.some((id) => id.startsWith('nearby-only-'))).toBe(true)

    // The row every stop needs to reach the database with a name.
    for (const placeId of scheduled) {
      expect(result.places.has(placeId), `${placeId} is scheduled but not in result.places`).toBe(
        true,
      )
    }

    // The counters that were non-zero on every themed run and that nobody read.
    expect(result.stats.hydration.notInPool).toBe(0)
    expect(result.stats.photos.notInPool).toBe(0)
  })

  it('produces a themed itinerary the invariant suite accepts', async () => {
    const { result } = await plan({ request: { mode: 'themed' } })
    expect(result.days).toHaveLength(3)
    for (const day of result.days) assertValidItinerary(day.day, day.input)
  })

  it("tells Pass B what each day is about, and Pass C in the cached prefix", async () => {
    const responses = createFakeResponses()
    const google = createFakeGoogle({ places: CANDIDATES })
    await runPlan(
      { ...REQUEST, mode: 'themed' },
      {
        googleApiKey: 'test-key',
        cache: createInMemorySearchCache(),
        store: createInMemoryLocationStore(),
        enrichments: createInMemoryEnrichmentStore(),
        responses,
        fetch: google.fetch,
        now: NOW,
        rng: mulberry32(1337),
        getTravelLeg: createStraightLineTravel(),
      },
    )

    const bodies = responses.requests.map((r) =>
      r.input.map((block) => (typeof block.content === 'string' ? block.content : '')).join('\n'),
    )
    // Pass B: the premise rides in the payload, one per day.
    const assign = bodies.find((body) => body.includes('cluster_id'))!
    expect(assign).toMatch(/"premise"/)

    // Pass C: every day's premise in the shared prefix, not the per-stop block,
    // or fifteen cache reads become fifteen misses.
    const narrations = responses.requests.filter((r) => r.model === MODELS.narrate)
    expect(narrations.length).toBeGreaterThan(1)
    const prefixes = new Set(
      narrations.map((r) => JSON.stringify(r.input.slice(0, SHARED_PREFIX_BLOCK_COUNT))),
    )
    expect(prefixes.size).toBe(1)
    expect([...prefixes][0]).toMatch(/Each day of this trip is about one thing/)
  })
})
