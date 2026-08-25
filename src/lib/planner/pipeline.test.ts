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

import { describe, expect, it } from 'vitest'

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
  addDays,
  advanceWeekday,
  alternatesFor,
  assignSerendipity,
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
  onProgress?: (progress: PlanProgress) => void
  enqueueEnrichments?: (subjects: readonly EnrichmentSubject[], now: Date) => Promise<void>
}

async function plan(options: RunOptions = {}): Promise<{
  result: PlanResult
  google: ReturnType<typeof createFakeGoogle>
}> {
  const google = createFakeGoogle({
    places: CANDIDATES,
    servesVegetarianFood: options.servesVegetarianFood,
  })
  const result = await runPlan(
    { ...REQUEST, ...options.request },
    {
      googleApiKey: 'test-key',
      cache: createInMemorySearchCache(),
      store: createInMemoryLocationStore(),
      enrichments: createInMemoryEnrichmentStore(options.enrichments),
      enqueueEnrichments: options.enqueueEnrichments,
      responses: createFakeResponses(options.failPassB ? { fail: 'assign' } : {}),
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
