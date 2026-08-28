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
  type StoredEnrichment,
} from './enrich'
import { dayCapacity, type AssignResult } from './assign'
import type { ScoredCluster } from './funnel'
import {
  MAX_PROMPT_CACHE_KEY,
  addDays,
  advanceWeekday,
  alternatesFor,
  NO_MEAL_RESERVE,
  assignSerendipity,
  promptCacheKeyFor,
  parseIsoDate,
  runPlan,
  type TravelRouting,
  searchLocality,
  survivorIdsFromDays,
  weekdayOf,
  type PlanProgress,
  type PlanRequest,
  type PlanResult,
} from './pipeline'
import { buildSearchPlan, createInMemoryLocationStore, createInMemorySearchCache } from './retrieval'
import { createTravelEstimate } from './travel-estimate'
import { QUESTIONS, calculatePersona } from '@/lib/persona/quiz'
import { MODELS } from './openai'
import { SHARED_PREFIX_BLOCK_COUNT } from './narrate'
import { MEAL_SEARCH_TYPES, dietaryBridgeFor, isRestaurant } from './taxonomy'
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
  failEnrich?: boolean
  /** The product default lives in the route, so the pipeline tests choose. */
  hallucinateAnchors?: readonly string[]
  onProgress?: (progress: PlanProgress) => void
  /** Places only a Nearby Search can reach. See `FakeGoogleOptions.nearbyOnly`. */
  nearbyOnly?: readonly CandidatePlace[]
  /**
   * Drops the injected provider so `routing` decides, which is the only way to
   * see what the pipeline does when nobody hands it travel times.
   */
  travel?: TravelRouting
  /** Stand in for the Kyoto fixture — for the rules a hand-built pool proves. */
  places?: readonly CandidatePlace[]
}

async function plan(options: RunOptions = {}): Promise<{
  result: PlanResult
  google: ReturnType<typeof createFakeGoogle>
}> {
  const google = createFakeGoogle({
    places: options.places ?? CANDIDATES,
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
      responses: createFakeResponses({
        ...(options.failPassB ? { fail: 'assign' as const } : {}),
        ...(options.failTheme ? { fail: 'theme' as const } : {}),
        ...(options.failEnrich ? { fail: 'enrich' as const } : {}),
        ...(options.hallucinateAnchors
          ? { hallucinateAnchors: options.hallucinateAnchors }
          : {}),
      }),
      fetch: google.fetch,
      now: NOW,
      rng: mulberry32(1337),
      ...(options.travel
        ? { routing: options.travel }
        : { getTravelLeg: createTravelEstimate().getTravelLeg }),
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
    // `failEnrich` is what makes rung 3 reachable now that the live fetch is
    // unconditional: every call fails, so nothing has an estimate of its own.
    const { result } = await plan({ failEnrich: true })

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
      // The mode is the estimator's own, not `travelModeForMeters`' threshold:
      // it walks below the traveller's tolerance whatever the arithmetic says,
      // and above it transit still has to save five minutes before it wins. So
      // the crossover is 1614 street metres rather than the bare 1200.
      expect(leg!.mode).toBe(leg!.meters < 1614 ? 'walk' : 'transit')
    }
  })
})

describe('where the travel times come from', () => {
  it('asks Google for none of them by default, and says so on the stats', async () => {
    // The point of the whole module. Two matrices per day over every pair of a
    // day's stops, spares and replacements came to 29,310 billed elements over
    // a couple of weeks of demo trips, and nothing cached a leg between runs.
    const { result, google } = await plan({ travel: 'estimate' })

    expect(google.calls.filter((url) => url.includes('computeRouteMatrix'))).toEqual([])
    expect(result.stats.travel?.source).toBe('estimate')
    // Counted once per pair, not once per lookup — the packer asks hundreds of
    // times per day and the memo answers.
    const estimated = result.stats.travel as { walk: number; transit: number }
    expect(estimated.walk + estimated.transit).toBeGreaterThan(0)
  })

  it('still routes for real when a caller asks for it, and says that too', async () => {
    const { result, google } = await plan({ travel: 'matrix' })

    expect(google.calls.some((url) => url.includes('computeRouteMatrix'))).toBe(true)
    expect(result.stats.travel?.source).toBe('matrix')
  })

  it('reports nothing at all when the caller brought its own provider', async () => {
    // "Zero requests" and "we never asked the question" are different answers,
    // and a zeroed row would render as the first.
    const { result } = await plan()

    expect(result.stats.travel).toBeUndefined()
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
      NO_MEAL_RESERVE,
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
      NO_MEAL_RESERVE,
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
    const [alternate] = alternatesFor(
      cluster,
      { assignments: [], flex: [] },
      PROFILE,
      new Map(),
      NO_MEAL_RESERVE,
    )
    expect(alternate.duration).toEqual(resolveVisitDuration(place, undefined, PROFILE.pace))
  })
})

/**
 * `groupByTheme` refuses a place further from an anchor than
 * `MEMBER_RADIUS_SLACK` allows — the right rule, and it leaves over half the
 * pool on the floor: 45 of 84 located on the Kyoto fixture, 87 of 151 on a live
 * Bali run, every one already retrieved and billed for. Meanwhile `validate.ts`
 * could only repair from the day's own cluster, so a themed day whose circle
 * held nothing edible shipped `lost_meal` while the restaurants that would have
 * fixed it sat unused.
 */
describe('the meal reserve', () => {
  const sight = CANDIDATES.find((p) => p.types.includes('museum'))!
  const near = (placeId: string, types: string[], km: number): CandidatePlace => ({
    placeId,
    name: placeId,
    types,
    // ~111 km per degree of latitude, so this is `km` due north of the anchor.
    latitude: (sight.latitude ?? 35) + km / 111,
    longitude: sight.longitude ?? 135.75,
  })
  const cluster = {
    places: [sight],
    scored: [{ placeId: sight.placeId, score: 0.8, reasons: [] }],
    score: 0.8,
    centroid: { latitude: sight.latitude, longitude: sight.longitude },
    theme: { dayIndex: 0, title: 'T', premise: 'p', anchorPlaceId: sight.placeId, includedTypes: [], radiusHint: 'walkable' },
  } as unknown as Parameters<typeof alternatesFor>[0]
  const empty = { assignments: [], flex: [] }
  const reserveOf = (places: CandidatePlace[], walkMaxMeters = 2000) => ({ places, walkMaxMeters })

  it('offers a restaurant no theme would claim, after the cluster is spent', () => {
    const rescue = near('rescue', ['restaurant'], 1)
    const list = alternatesFor(cluster, empty, PROFILE, new Map(), reserveOf([rescue]))
    // The cluster's own candidate first, always — the reserve is a last resort.
    expect(list.map((a) => a.place.placeId)).toEqual([sight.placeId, 'rescue'])
  })

  /**
   * The containment that makes this safe is structural rather than a promise:
   * `admits` refuses a restaurant for a plain activity and `withFill` excludes
   * them outright, so a list of restaurants can reach a meal slot or a cafe
   * break and nothing else. A sight in the reserve would have no such guard.
   */
  it('offers only places that can hold a meal', () => {
    const list = alternatesFor(
      cluster,
      empty,
      PROFILE,
      new Map(),
      reserveOf([near('a-park', ['park'], 1), near('a-mall', ['shopping_mall'], 1)]),
    )
    expect(list.map((a) => a.place.placeId)).toEqual([sight.placeId])
  })

  it('never offers a vegetarian a steakhouse', () => {
    const veg: PreferenceProfile = { ...PROFILE, dietary: ['vegetarian'] }
    const list = alternatesFor(
      cluster,
      empty,
      veg,
      new Map(),
      reserveOf([near('steak', ['steak_house', 'restaurant'], 1), near('soba', ['restaurant'], 1)]),
    )
    expect(list.map((a) => a.place.placeId)).toEqual([sight.placeId, 'soba'])
  })

  /**
   * The cap is wider than membership on purpose — these places are outside the
   * membership reach by definition, so reusing that bound returns nothing. It
   * is the day's circle (1200 m walkable × 1.5 slack = 1800 m) plus one hop as
   * far as this traveller travels: 3.8 km at `walkMaxMeters` 2000.
   */
  it('caps how far it will reach, or it is the 5.7 km cafe bug again', () => {
    const list = alternatesFor(
      cluster,
      empty,
      PROFILE,
      new Map(),
      reserveOf([near('across-town', ['restaurant'], 12), near('one-hop', ['restaurant'], 3)]),
    )
    expect(list.map((a) => a.place.placeId)).toEqual([sight.placeId, 'one-hop'])
  })

  it('offers the nearest first, because the day still has to be walkable', () => {
    const list = alternatesFor(
      cluster,
      empty,
      PROFILE,
      new Map(),
      reserveOf([near('further', ['restaurant'], 3), near('closer', ['restaurant'], 1)]),
    )
    expect(list.slice(1).map((a) => a.place.placeId)).toEqual(['closer', 'further'])
  })

  it('never offers a place the day is already using', () => {
    const rescue = near('rescue', ['restaurant'], 1)
    const list = alternatesFor(
      cluster,
      {
        assignments: [
          { place: rescue, role: 'lunch', score: 0.5, duration: resolveVisitDuration(rescue, undefined, PROFILE.pace) },
        ],
        flex: [],
      },
      PROFILE,
      new Map(),
      reserveOf([rescue]),
    )
    expect(list.map((a) => a.place.placeId)).toEqual([sight.placeId])
  })

  it('is absent on a geographic day, which already gets the leftovers', () => {
    const geographic = { ...cluster, theme: undefined } as Parameters<typeof alternatesFor>[0]
    const list = alternatesFor(
      geographic,
      empty,
      PROFILE,
      new Map(),
      reserveOf([near('rescue', ['restaurant'], 1)]),
    )
    expect(list.map((a) => a.place.placeId)).toEqual([sight.placeId])
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

  it('fetches what the cache missed before Pass B, and the sizes reach the day', async () => {
    // The whole point of the live path. Without it a shortlist is sized from
    // the type table in `duration.ts`; with it, every visit is an estimate of
    // the place. The fake answers with lengths no type heuristic produces, so a
    // duration only it can yield is proof the answer travelled all the way from
    // the call into the stamped day.
    const { result } = await plan()

    expect(result.stats.enrichedNow).toMatchObject({ failed: 0 })
    expect(result.stats.enrichedNow!.enriched).toBeGreaterThan(0)
    expect(result.stats.enrichedNow!.enriched).toBe(result.stats.enrichment.misses)

    // The counter alone would pass with the answers fetched and thrown away, so
    // the assertion that matters compares the stamped days against a run whose
    // every call failed. Same fixture, same seed, same everything else — if the
    // visit lengths are identical, the enrichment never reached the packer.
    const { result: heuristic } = await plan({ failEnrich: true })
    const lengths = (r: PlanResult) =>
      r.days
        .flatMap((day) => day.day.segments)
        .flatMap((segment) =>
          segment.kind === 'activity' ? [segment.endMin - segment.startMin] : [],
        )
        .sort((a, b) => a - b)

    expect(lengths(result)).not.toEqual(lengths(heuristic))

    // `enrich` is in the cost breakdown: the call was spent building *this*
    // trip, even though its cached answer goes on to serve later ones.
    const enrichCost = result.stats.cost.find((entry) => entry.stage === 'enrich')
    expect(enrichCost?.calls).toBe(result.stats.enrichedNow!.requested)
    expect(enrichCost?.batch).toBeUndefined()
  })

  it('plans a whole trip anyway when every enrichment call fails', async () => {
    // Each failure falls back to the type heuristic, which is exactly what a
    // cache miss did before this path existed — so the trip must still be a
    // trip, and the counter must be the only thing that says otherwise.
    const { result } = await plan({ failEnrich: true })

    expect(result.stats.enrichedNow!.enriched).toBe(0)
    expect(result.stats.enrichedNow!.failed).toBe(result.stats.enrichedNow!.requested)
    expect(result.days.length).toBe(REQUEST.totalDays)
    expect(result.days.every((day) => day.day.segments.length > 0)).toBe(true)
  })

  it('stamps itself from the injected clock, never the wall clock', async () => {
    const { result } = await plan()
    expect(result.debug.recordedAt).toBe(NOW.toISOString())
    expect(result.debug.version).toBe(3)
  })

  // The record that would have answered "why did day three ship empty". Every
  // field in it was already computed by `validateDay` and thrown away when the
  // request ended; `stats.scheduling.failedDays` counted the days and could
  // never name one. A row per day, clean days included — "needed no repair" and
  // "was never checked" are different answers.
  it('records one scheduling row per day, and the stop counts are real', async () => {
    const { result } = await plan()

    const rows = result.debug.scheduling ?? []
    expect(rows.map((row) => row.dayIndex)).toEqual(result.days.map((day) => day.dayIndex))

    for (const [index, row] of rows.entries()) {
      // `scheduled` must be counted off the stored timeline, not off the
      // assignment — the whole point is to catch the day where those differ.
      const stops = result.days[index].day.segments.filter((s) => s.kind === 'activity').length
      expect(row.scheduled).toBe(stops)
      // `offered` counts assignments plus the flex picks the packer may
      // promote. Counting assignments alone made this read "kept 8 of 7".
      expect(row.offered).toBeGreaterThan(0)
      expect(row.offered).toBeGreaterThanOrEqual(row.scheduled)
      expect(row.failures).toEqual(result.days[index].failures.map((f) => ({
        rule: f.rule,
        role: f.role,
        placeId: f.placeId,
        name: f.name,
        reason: f.reason,
      })))
    }

    // Zeroes everywhere would satisfy the shape while proving nothing ran. The
    // Kyoto fixture repairs on every weekday, so at least one swap is real.
    expect(rows.some((row) => row.repairs.length > 0)).toBe(true)
  })

  it('warns on the terminal, not only into the column, when a day loses stops', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = await plan()
    const lost = (result.debug.scheduling ?? []).filter(
      (row) => row.scheduled === 0 || row.failures.length > 0,
    )
    // The assertion is conditional on the fixture, and says so: if Kyoto ever
    // validates clean this test proves nothing and should be given a day that
    // cannot be saved. It is the counter that is load-bearing, not the string.
    if (lost.length > 0) {
      expect(warn).toHaveBeenCalled()
      const said = warn.mock.calls.map((call) => String(call[0])).join('\n')
      expect(said).toContain(`day ${lost[0].dayIndex}`)
    }
    warn.mockRestore()
  })

  // The reorder is a step nothing else in this suite can see: `sequence.ts` has
  // its own tests, but whether `runPlan` actually calls it is only observable
  // here. A day left out of this list is a day that shipped unsequenced.
  it('records one route-order row per day, with the meals still in place', async () => {
    const { result } = await plan()

    const rows = result.debug.sequencing ?? []
    expect(rows.map((row) => row.dayIndex)).toEqual(result.days.map((day) => day.dayIndex))

    // Zeroes everywhere would satisfy every arithmetic assertion below while
    // proving `sequenceDay` was never called — the Kyoto fixture has real
    // coordinates, so a real day costs real minutes and covers real ground.
    expect(rows.some((row) => row.beforeMinutes > 0)).toBe(true)
    expect(rows.some((row) => row.meters > 0)).toBe(true)
    // And it must actually shorten at least one day. Pass B here is a fake that
    // orders by score, so the geometry is genuinely unsorted going in.
    expect(rows.some((row) => row.reordered && row.savedMinutes > 0)).toBe(true)

    for (const row of rows) {
      expect(row.afterMinutes).toBeLessThanOrEqual(row.beforeMinutes)
      expect(row.savedMinutes).toBe(row.beforeMinutes - row.afterMinutes)
    }

    // The saving has to reach the trip, not just the debug record. Calling
    // `sequenceDay`, logging what it found and then packing the original order
    // is a passing run that quietly lies on the diagnostics page — so re-walk
    // each finished day and check it costs what the row claims. Only days the
    // validator left alone are comparable; a swap changes the geometry.
    const travel = createTravelEstimate().getTravelLeg
    const walked = (stops: readonly { place: CandidatePlace }[]) =>
      stops
        .slice(1)
        .reduce((total, stop, i) => total + travel(stops[i].place, stop.place).minutes, 0)

    // Aggregate rather than per-day, because `validate.ts` swaps places into
    // slots without looking at the map and so can leave one repaired day
    // improvable again. The trip as a whole must still walk less than the order
    // Pass B handed over, or the reorder was recorded and thrown away.
    // Aggregate, and deliberately weaker than it looks. What this catches is
    // `sequenceDay` not being called at all. What it cannot catch on this
    // fixture is "called, recorded, then packed from the original order
    // anyway": every Kyoto day draws repairs on every weekday, and a repair
    // both swaps places and drops them, so the shipped path is shorter than
    // Pass B's either way. Closing that would need a fixture that validates
    // clean, and `sequence.test.ts` already owns the reordering itself.
    const shipped = result.days.reduce((total, day) => total + walked(day.input.assignments), 0)
    const asAssigned = rows.reduce((total, row) => total + row.beforeMinutes, 0)
    expect(shipped).toBeLessThan(asAssigned)

    // A meal that moved index would be `sequence.ts` failing open, and the
    // resulting day would still pack — just with dinner in the morning.
    for (const day of result.days) {
      const roles = day.input.assignments.map((a) => a.role)
      const meals = roles.filter((role) => role === 'lunch' || role === 'dinner')
      expect(meals).toEqual(meals.slice().sort((a, b) => roles.indexOf(a) - roles.indexOf(b)))
    }
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

    const isMealCircle = (call: { includedTypes: string[] }) =>
      MEAL_SEARCH_TYPES.every((type) => call.includedTypes.includes(type))
    // THREE Nearby Searches per theme — the premise ranked by distance, the
    // premise ranked by popularity, and the meal circle — plus at most three
    // more per day when the feasibility ladder widens a theme that cannot seat
    // two meals. A single merged type list would be cheaper and is the thing
    // this asserts we are not doing: one request returns at most twenty places,
    // and sharing those between museums and restaurants leaves a day short of
    // both.
    expect(google.nearbyCalls.length).toBeGreaterThanOrEqual(9)
    expect(google.nearbyCalls.length).toBeLessThanOrEqual(18)

    // Near AND notable, which is two requests because `rankPreference` is one
    // enum per request. Distance alone never returns the famous museum three
    // kilometres out; popularity alone returned twenty places in Kuta for a
    // circle centred in Nusa Dua. Ranking at the Google layer throws away one
    // tail twenty places before `scorePlace` — whose `popularity` weight is
    // signed by persona — ever sees it.
    const premiseCircles = google.nearbyCalls.filter((call) => !isMealCircle(call))
    for (const premise of premiseCircles) {
      const twin = premiseCircles.find(
        (call) =>
          call.latitude === premise.latitude &&
          call.longitude === premise.longitude &&
          call.radius === premise.radius &&
          call.rankPreference !== premise.rankPreference,
      )
      expect(twin, `premise circle at r=${premise.radius} was ranked only one way`).toBeDefined()
    }
    expect(new Set(premiseCircles.map((c) => c.rankPreference))).toEqual(
      new Set(['DISTANCE', 'POPULARITY']),
    )

    // The meal circle is distance-only, and deliberately: lunch has to be
    // walkable from the rest of the day, and among the near ones the scorer can
    // still prefer the popular one.
    for (const meal of google.nearbyCalls.filter(isMealCircle)) {
      expect(meal.rankPreference).toBe('DISTANCE')
    }


    // Every anchor is asked about food, whatever its premise is about. This is
    // the assertion a live Bali run bought: a museum-day theme searched for
    // museums, the nearest restaurant in the pool ended up 8 km away, and the
    // day shipped with no lunch and no meal candidate to repair from.
    const mealCircles = google.nearbyCalls.filter(isMealCircle)
    const anchorsAskedAboutFood = new Set(
      mealCircles.map((call) => `${call.latitude},${call.longitude}`),
    )
    expect(anchorsAskedAboutFood.size).toBe(3)
    for (const call of mealCircles) {
      expect(call.includedTypes).toEqual(
        expect.arrayContaining([...MEAL_SEARCH_TYPES]),
      )
    }

    // Every meal circle has a premise circle at the same centre AND the same
    // radius. The Bali day failed on types, not distance, and a wider meal
    // circle would return places `groupByTheme` then refuses to seat under
    // `MEMBER_RADIUS_SLACK` anyway. Matching on radius as well as centre is
    // what keeps this honest once the feasibility ladder widens a theme —
    // there are then two circles per anchor and only one is the sibling.
    for (const meal of mealCircles) {
      const sibling = google.nearbyCalls.find(
        (call) =>
          !isMealCircle(call) &&
          call.latitude === meal.latitude &&
          call.longitude === meal.longitude &&
          call.radius === meal.radius,
      )
      expect(sibling, `meal circle at r=${meal.radius} has no premise sibling`).toBeDefined()
    }
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

  /**
   * The wiring, not the rule.
   *
   * `feasibility.test.ts` proves the ladder fires for a vegetarian once it is
   * *told* the traveller is one — and every one of those assertions stayed
   * green when `dietary: request.profile.dietary` was deleted from this file.
   * A unit test of a function nothing calls with the right argument is not
   * coverage, so the argument gets its own test here.
   *
   * Every restaurant in the pool is turned into a steakhouse, which is rung 2
   * of `violatesDietaryNeed` — the only rung reachable at this stage, because
   * `servesVegetarianFood` arrives with hydration and hydration runs *after*
   * grouping. So a vegetarian's every themed day has zero meal capacity, and
   * the ladder must buy a widening search it does not buy for anyone else.
   */
  /**
   * `explorePlaces` runs twice in a themed plan: once for every theme's
   * circles, and again inside the ladder's `widen` rung for each thin day. The
   * second call's stats used to be dropped, so `stats.explore.billedCalls`
   * counted the opening searches and none of the extra ones bought for the days
   * going worst — the days that cost the most read as the cheapest. Measured on
   * this fixture before the fix: 12 real calls, 9 reported.
   *
   * Asserted against the fake's own call log rather than a fixed number,
   * because the point is that the counter matches reality, not that reality is
   * any particular size.
   */
  it('counts the searches the feasibility ladder buys, not just the opening ones', async () => {
    const { result, google } = await plan({ request: { mode: 'themed' } })

    expect(result.stats.theming?.repaired).toBeGreaterThan(0)
    expect(google.nearbyCalls.length).toBeGreaterThan(9)
    // The explore stage bills two endpoints now — the circles and, for a
    // traveller with a dietary need, the phrases asked around each anchor.
    expect(result.stats.explore?.billedCalls).toBe(
      google.nearbyCalls.length + google.biasedSearchCalls.length,
    )
  })

  it('records every day the ladder ran for, and how many it could not fix', async () => {
    const { result } = await plan({ request: { mode: 'themed' } })

    // Not optional on a themed run: absent means "not recorded", which is a
    // different answer from "no day needed it".
    const attempts = result.debug.themes?.attempts
    expect(attempts).toBeDefined()
    for (const attempt of attempts!) {
      expect(attempt.tried.length).toBeGreaterThan(0)
      expect(attempt.unfixed).toBe(attempt.after < attempt.needed)
    }
    expect(result.stats.theming?.unfixed).toBe(attempts!.filter((a) => a.unfixed).length)
    // A `console.warn` used to be the only place this number appeared, and
    // `>= 0` would be no assertion at all — a dead counter passes it. The Kyoto
    // fixture has 86 places and three walkable circles, so a large majority sit
    // outside every theme's reach; zero here means the counter is not wired,
    // not that the city got smaller.
    expect(result.stats.theming?.unclaimed).toBe(result.debug.themes?.unclaimed)
    expect(result.debug.themes?.unclaimed).toBeGreaterThan(0)
  })

  /**
   * `includedTypes` is coarse on exactly this question. Google types a great
   * vegetarian-friendly izakaya `izakaya_restaurant`, never
   * `vegetarian_restaurant`, so the meal circle finds the places that *label*
   * themselves and misses everywhere that simply has good vegetarian food.
   * `dietaryBridgeFor` already carried the phrases that catch the tail — they
   * were only ever fired city-wide, where results cluster wherever the city is
   * busiest rather than where this day actually is.
   */
  it('asks the dietary phrases around each anchor, not just across the city', async () => {
    const { google } = await plan({
      request: { mode: 'themed', profile: { ...PROFILE, dietary: ['vegetarian'] } },
    })

    // Read from the bridge rather than spelled out here — the phrases are the
    // taxonomy's answer to "how do you find this in text", and a copy in a test
    // is a second answer that drifts.
    // `searchLocality`, the same one `buildSearchPlan` uses — "Kyoto, Japan",
    // not "Kyoto". A hardcoded city here would pass today and break the moment
    // the country rule changes.
    const locality = searchLocality(REQUEST.city, REQUEST.country)
    const phrases = dietaryBridgeFor('vegetarian')!.queries.map((q) =>
      q.replaceAll('{city}', locality).toLowerCase(),
    )
    expect(google.biasedSearchCalls.length).toBeGreaterThan(0)
    for (const call of google.biasedSearchCalls) {
      expect(phrases).toContain(call.query.toLowerCase())
      expect(call.radius).toBeGreaterThan(0)
    }

    // Every anchor, so a day's own neighbourhood is asked about rather than the
    // busiest part of the city standing in for all three.
    const anchors = new Set(google.nearbyCalls.map((c) => `${c.latitude},${c.longitude}`))
    const asked = new Set(google.biasedSearchCalls.map((c) => `${c.latitude},${c.longitude}`))
    for (const centre of anchors) expect(asked.has(centre)).toBe(true)

    // The circle is the day's, not the city's. Matched against *some* nearby
    // circle at that centre rather than the first — once the feasibility ladder
    // widens a theme there are two, and the phrase rides the widened one.
    for (const call of google.biasedSearchCalls) {
      const sibling = google.nearbyCalls.find(
        (c) =>
          c.latitude === call.latitude && c.longitude === call.longitude && c.radius === call.radius,
      )
      expect(sibling, `no circle at r=${call.radius} for the phrase "${call.query}"`).toBeDefined()
    }
  })

  it('costs a traveller with no dietary need nothing at all', async () => {
    const { google } = await plan({
      request: { mode: 'themed', profile: { ...PROFILE, dietary: [] } },
    })
    expect(google.biasedSearchCalls).toEqual([])
  })

  it('says nothing for a need it has no phrases for, rather than inventing one', async () => {
    // An invented query is a billed call that returns whatever Google makes of
    // a word we chose. `dietaryBridgeFor` has no row for this one.
    const { google } = await plan({
      request: { mode: 'themed', profile: { ...PROFILE, dietary: ['pescatarian'] } },
    })
    expect(google.biasedSearchCalls).toEqual([])
  })

  it('tells the feasibility ladder who the traveller is', async () => {
    const steakOnly = CANDIDATES.map((place) =>
      isRestaurant(place)
        ? { ...place, types: [...new Set([...place.types, 'steak_house'])] }
        : place,
    )

    const omnivore = await plan({
      places: steakOnly,
      request: { mode: 'themed', profile: { ...PROFILE, dietary: [] } },
    })
    const vegetarian = await plan({
      places: steakOnly,
      request: { mode: 'themed', profile: { ...PROFILE, dietary: ['vegetarian'] } },
    })

    // Identical pool, identical themes, one different word in the profile.
    expect(vegetarian.google.nearbyCalls.length).toBeGreaterThan(
      omnivore.google.nearbyCalls.length,
    )
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
        getTravelLeg: createTravelEstimate().getTravelLeg,
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
    expect(result.stats.theming).toEqual({
      themed: 0,
      fellBack: 3,
      repaired: 0,
      unfixed: 0,
      unclaimed: 0,
    })
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
        getTravelLeg: createTravelEstimate().getTravelLeg,
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
    // Narration and enrichment run on the same model id, and enrichment now
    // runs in every plan — so the model alone no longer picks out Pass C. The
    // block count does: an enrichment request is a system prompt and one place,
    // a narration is the shared prefix plus a per-stop block on top.
    const narrations = responses.requests.filter(
      (r) => r.model === MODELS.narrate && r.input.length > SHARED_PREFIX_BLOCK_COUNT,
    )
    expect(narrations.length).toBeGreaterThan(1)
    const prefixes = new Set(
      narrations.map((r) => JSON.stringify(r.input.slice(0, SHARED_PREFIX_BLOCK_COUNT))),
    )
    expect(prefixes.size).toBe(1)
    expect([...prefixes][0]).toMatch(/Each day of this trip is about one thing/)
  })
})
