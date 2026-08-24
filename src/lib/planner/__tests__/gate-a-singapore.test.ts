/**
 * Gate A, Singapore. The same deterministic core, the same harness, the same
 * invariant suite — a different city.
 *
 * It exists because a snapshot you cannot read is a snapshot you cannot review,
 * and `gate-a.test.ts` is the only test that answers "does this still look like
 * a trip". That question needs a reviewer who knows the ground. Kyoto stays as
 * the regression net (it caught the symmetric-`priceFit` bug); this is the one
 * to read when a scoring or scheduling change lands.
 *
 * ## Where the data comes from
 *
 * Nineteen of the 85 places are **live Google payloads**, lifted verbatim from
 * `scripts/output/singapore-place-details.json` — real coordinates, real
 * ratings, real review counts, real `regularOpeningHours.periods`. They carry
 * two hours edge cases nobody would think to hand-write: MacRitchie Nature
 * Trail has no periods at all, and Bukit Batok Nature Park uses Google's
 * always-open encoding (a lone period at day 0, 00:00, with no `close`).
 *
 * The rest are hand-written to fill out the districts and to carry the same
 * adversarial tail as Kyoto: two permanently-closed restaurants, two places
 * with no coordinates, seven at price level 4, a museum with no rating, a
 * steakhouse and a barbecue joint and a seafood restaurant for the vegetarian
 * to trip over, and several near-identical chicken-rice stalls.
 *
 * Hawker centres are typed `food_court, market, restaurant` because that is how
 * Google types them, and it matters: `isRestaurant` is what lets one hold a
 * meal slot, and in Singapore lunch is a hawker centre far more often than it
 * is a restaurant.
 */

import { describe, it, expect } from 'vitest'

import candidates from '../__fixtures__/singapore-candidates.json'
import type { CandidatePlace, Pace, PreferenceProfile } from '../types'
import { selectMealCandidates } from '../funnel'
import { isRestaurant } from '../taxonomy'
import type { Weekday } from '../hours'
import type { AssignClient } from '../validate'
import { alternatesFor, createTrip, renderTimeline } from './harness'
import {
  assertDietaryHonoured,
  assertHoursHonoured,
  assertValidItinerary,
  assertValidShortlist,
  assertWellFormedCandidates,
} from './invariants'

/** Four days in Singapore, vegetarian, mid-budget, arriving on a Tuesday. */
const TRIP = createTrip({
  city: 'Singapore',
  candidates: candidates as CandidatePlace[],
  days: 4,
  profile: {
    interests: ['food', 'cafes', 'outdoors'],
    dietary: ['vegetarian'],
    pace: 'balanced',
    budget: 2,
  } satisfies PreferenceProfile,
  weekday: 2,
})

const CANDIDATES = TRIP.candidates
const { runPipeline, packTrip, validateTrip, lockedStops, nameOf } = TRIP
const WEEKDAY = TRIP.weekday

describe('the Singapore fixture', () => {
  it('is shaped like retrieval output', () => {
    assertWellFormedCandidates(CANDIDATES)
    expect(CANDIDATES.length).toBeGreaterThanOrEqual(80)
  })

  it('carries the same adversarial tail as Kyoto', () => {
    expect(CANDIDATES.filter((c) => c.businessStatus === 'CLOSED_PERMANENTLY')).toHaveLength(2)
    expect(CANDIDATES.filter((c) => c.latitude === undefined)).toHaveLength(2)
    expect(CANDIDATES.some((c) => c.rating === undefined)).toBe(true)
    expect(CANDIDATES.some((c) => c.types.includes('steak_house'))).toBe(true)
    expect(CANDIDATES.some((c) => c.types.includes('seafood_restaurant'))).toBe(true)
    expect(CANDIDATES.filter((c) => c.priceLevel === 4).length).toBeGreaterThan(2)
    expect(CANDIDATES.filter(isRestaurant).length).toBeGreaterThan(20)
  })

  it('keeps the two hours edge cases the live payload handed us', () => {
    const trail = CANDIDATES.find((c) => c.name === 'MacRitchie Nature Trail')!
    const batok = CANDIDATES.find((c) => c.name === 'Bukit Batok Nature Park')!

    // No periods at all. `hours.ts` reads this as always open and says so.
    expect(trail.openingPeriods).toBeUndefined()
    // Google's 24/7 encoding: one period, no `close`. A different code path.
    expect(batok.openingPeriods).toHaveLength(1)
    expect(batok.openingPeriods![0].close).toBeUndefined()
  })

  it('types hawker centres as places you can eat', () => {
    // If Google stopped typing them `restaurant`, no hawker centre could hold a
    // meal slot and a Singapore day would eat at a sit-down restaurant twice.
    const hawkers = CANDIDATES.filter((c) => c.types.includes('food_court'))
    expect(hawkers.length).toBeGreaterThan(5)
    for (const hawker of hawkers) {
      expect(isRestaurant(hawker), `${hawker.name} cannot seat a meal`).toBe(true)
    }
  })
})

describe('Singapore — cluster → funnel', () => {
  it('satisfies every invariant the deterministic core guarantees', () => {
    assertValidShortlist(runPipeline().result, TRIP.profile)
  })

  it('drops exactly what it should, for the reason it should', () => {
    const { result } = runPipeline()
    const reasonFor = (id: string) => result.dropped.find((d) => d.placeId === id)?.reason

    expect(reasonFor('ChIJ_sg_sky_on_57_closed')).toMatch(/closed/i)
    expect(reasonFor('ChIJ_sg_whitegrass_closed')).toMatch(/closed/i)
    expect(reasonFor('ChIJ_sg_katong_laksa_nogeo')).toMatch(/coordinates/i)
    // Level 4 against a mid budget is two steps out — killed, not widened.
    expect(reasonFor('ChIJ_sg_odette')).toMatch(/budget/i)
    expect(reasonFor('ChIJ_sg_burnt_ends')).toMatch(/budget/i)
    expect(reasonFor('ChIJ_sg_cut_steakhouse')).toMatch(/budget/i)
  })

  it('gives a food-and-parks traveller somewhere to walk and somewhere to eat', () => {
    const ids = new Set(runPipeline().result.stages.afterGlobalCap.map((p) => p.placeId))

    for (const must of ['ChIJ_sg_botanic_gardens', 'ChIJ_sg_maxwell', 'ChIJ_sg_macritchie']) {
      expect(ids.has(must), `${nameOf(must)} missing from a 4-day Singapore shortlist`).toBe(true)
    }
  })

  it('squeezes the Marina Bay icons out, and can say exactly why', () => {
    // Gardens by the Bay, Merlion Park and the National Gallery all lose their
    // per-cluster slot. Their scores are fine — the problem is that Singapore's
    // whole civic core lands in ONE cluster, so ~40 places compete for 20 seats.
    // Recorded here rather than left as a surprise: if a clustering change fixes
    // it, this test fails and that is the news.
    const { result } = runPipeline()
    for (const id of ['ChIJ_sg_gardens_by_the_bay', 'ChIJ_sg_merlion', 'ChIJ_sg_natgallery']) {
      const record = result.dropped.find((d) => d.placeId === id)
      expect(record, `${nameOf(id)} survived — clustering may have been fixed`).toBeDefined()
      expect(record!.stage).toBe('afterClusterCap')
    }
  })

  it('says plainly that two of the four days cannot be fed', () => {
    // k-means on raw lat/lng spends a cluster on each far-flung nature park
    // group — Bukit Timah/Rifle Range/Bukit Batok, then Chestnut/the Zoo —
    // because squared distance is all it optimises and Singapore is a dense
    // core with a sparse periphery. Two of four days come out with nothing to
    // eat in them.
    //
    // What must hold, and does, is that the funnel *reports* it rather than
    // shipping a day that quietly has no lunch. The clustering itself is a
    // known defect; see docs/decisions.md.
    const { result } = runPipeline()
    const starved = result.clusters.filter((cluster) => cluster.shortfall)

    expect(starved).toHaveLength(2)
    for (const cluster of starved) {
      expect(cluster.places.filter(isRestaurant)).toHaveLength(0)
      expect(cluster.shortfall).toMatch(/cannot seat/)
    }
  })

  it('produces geographically coherent days: every place is nearest its own cluster', () => {
    const { result } = runPipeline()
    const centroids = result.clusters.map((c) => c.centroid)
    const d2 = (p: CandidatePlace, c: { latitude: number; longitude: number }) =>
      (p.latitude! - c.latitude) ** 2 + (p.longitude! - c.longitude) ** 2

    result.clusters.forEach((cluster, own) => {
      for (const place of cluster.places) {
        const nearest = centroids.reduce(
          (best, c, i) => (d2(place, c) < d2(place, centroids[best]) ? i : best),
          0,
        )
        expect(nearest, `${place.name} sits closer to another day's neighborhood`).toBe(own)
      }
    })
  })

  it('is reproducible: same seed, same itinerary', () => {
    const a = runPipeline().result
    const b = runPipeline().result
    expect(b.stages.afterGlobalCap.map((p) => p.placeId)).toEqual(
      a.stages.afterGlobalCap.map((p) => p.placeId),
    )
  })

  it('a vegetarian gets rung 1, with no caveat and no violation', () => {
    const meals = runPipeline().result.stages.afterGlobalCap.filter(isRestaurant)
    const selection = selectMealCandidates(meals, TRIP.profile)

    expect(selection.rung).toBe(1)
    assertDietaryHonoured(selection, TRIP.profile)
  })
})

describe('Singapore — pack and validate', () => {
  it('turns all four days into valid timelines, at every pace', () => {
    for (const pace of ['relaxed', 'balanced', 'packed'] as Pace[]) {
      const trip = packTrip(pace)
      expect(trip).toHaveLength(TRIP.days)
      for (const { input, day } of trip) assertValidItinerary(day, input)
    }
  })

  it('has something to catch: the packer alone schedules shut places', () => {
    expect(
      lockedStops().length,
      'nothing to validate — the fixture lost its opening hours',
    ).toBeGreaterThan(0)
  })

  it('leaves every stop open during its slot, or names the one it could not place', () => {
    for (const { validation } of validateTrip()) {
      expect(validation.ok).toBe(validation.failures.length === 0)
      if (validation.ok) {
        assertHoursHonoured(validation.day, validation.input, WEEKDAY)
        assertValidItinerary(validation.day, validation.input)
        continue
      }
      for (const failure of validation.failures) {
        expect(failure.reason.trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('repairs from the ranked list and never asks the model to try again', () => {
    let calls = 0
    const assign: AssignClient = { assign: () => ++calls }
    const trip = validateTrip(TRIP.profile.pace, WEEKDAY, assign)
    const repairs = trip.flatMap(({ validation }) => validation.repairs)

    expect(repairs.length, 'no repair happened — this assertion went vacuous').toBeGreaterThan(0)
    expect(calls, 'repair asked Pass B to try again').toBe(0)

    for (const { cluster, input, validation } of trip) {
      const offered = new Set(
        alternatesFor(cluster, input, TRIP.profile.pace).map((a) => a.place.placeId),
      )
      for (const repair of validation.repairs) {
        if (!repair.inserted) continue
        expect(offered.has(repair.inserted.placeId), `${repair.inserted.name} was invented`).toBe(true)
      }
    }
  })

  it('never drops a meal, and records every stop it does drop', () => {
    for (const { validation } of validateTrip()) {
      for (const repair of validation.repairs) {
        if (repair.inserted) continue
        expect(repair.role, 'a meal was dropped to make the day validate').not.toMatch(/lunch|dinner/)
        expect(validation.day.dropped.map((r) => r.placeId)).toContain(repair.removed.placeId)
      }
    }
  })

  it('assumes hours only for the places that genuinely have none', () => {
    const assumed = validateTrip().flatMap(({ validation }) => validation.assumed)
    expect(assumed.length, 'nothing was assumed — the fixture lost its hours-free places').toBeGreaterThan(0)
    for (const stop of assumed) {
      const place = CANDIDATES.find((c) => c.placeId === stop.placeId)!
      const alwaysOpen = place.openingPeriods?.every((period) => period.close == null) ?? true
      expect(alwaysOpen, `${place.name} has real hours and was waved through anyway`).toBe(true)
    }
  })

  it('a Monday is not a Tuesday — the weekday changes the trip', () => {
    const names = (weekday: Weekday) =>
      validateTrip(TRIP.profile.pace, weekday)
        .flatMap(({ validation }) => validation.day.segments)
        .flatMap((segment) => (segment.kind === 'activity' ? [segment.name] : []))

    // The Indian Heritage Centre and Sun Yat Sen Memorial Hall shut on Mondays.
    expect(names(1)).not.toEqual(names(2))
  })
})

describe('Singapore — the trip itself', () => {
  it('matches the recorded itinerary', () => {
    const trip = validateTrip().map(({ validation }, index) => ({
      day: index + 1,
      ok: validation.ok,
      timeline: renderTimeline(validation.day.segments),
      dropped: validation.day.dropped.map((record) => `${record.name} — ${record.reason}`),
      repairs: validation.repairs.map((repair) =>
        repair.inserted
          ? `${repair.removed.name} -> ${repair.inserted.name} (${repair.reason})`
          : `${repair.removed.name} dropped (${repair.reason})`,
      ),
      failures: validation.failures.map((failure) => `${failure.name}: ${failure.reason}`),
      assumedOpen: validation.assumed.map((stop) => stop.name),
    }))
    expect(trip).toMatchSnapshot()
  })
})
