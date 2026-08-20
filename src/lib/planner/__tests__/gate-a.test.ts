/**
 * Gate A — the whole deterministic core driven end-to-end over a hand-written
 * candidate set, with no API keys, no database and no network. See "Gate A" in
 * `docs/implementation-plan.md`.
 *
 * This is the cheapest end-to-end confidence in the project: 86 Kyoto places
 * through cluster → funnel → meal ladder → duration, in milliseconds. When
 * `pack.ts` (Step 7) and `validate.ts` (Step 8) land, extend this file rather
 * than writing a second one — the point is that ONE run exercises the whole
 * offline half, and the invariant suite judges it.
 *
 * The fixture is deliberately adversarial: two permanently-closed places, two
 * with no coordinates at all, a ¥¥¥¥ kaiseki and a steakhouse, several
 * near-identical ramen shops, and a museum with no rating.
 */

import { describe, it, expect } from 'vitest'

import candidates from '../__fixtures__/kyoto-candidates.json'
import type { CandidatePlace, PreferenceProfile } from '../types'
import { clusterPlaces } from '../cluster'
import { runFunnel, selectMealCandidates } from '../funnel'
import { resolveVisitDuration } from '../duration'
import { mulberry32 } from './rng'
import {
  assertDietaryHonoured,
  assertValidShortlist,
  assertWellFormedCandidates,
} from './invariants'

const CANDIDATES = candidates as CandidatePlace[]

/** Five days in Kyoto, vegetarian, mid-budget. */
const TRIP = {
  days: 5,
  profile: {
    interests: ['temples', 'cafes', 'food'],
    dietary: ['vegetarian'],
    pace: 'balanced',
    budget: 2,
  } satisfies PreferenceProfile,
}

/** The one seed the whole file runs on — k-means++ is the only rng consumer. */
const SEED = 1337

function runPipeline(profile: PreferenceProfile = TRIP.profile, days = TRIP.days) {
  const located = CANDIDATES.filter((c) => c.latitude !== undefined)
  const unlocated = CANDIDATES.filter((c) => c.latitude === undefined)
  const clusters = clusterPlaces(located, { k: days, rng: mulberry32(SEED) })
  return { clusters, result: runFunnel(clusters, profile, { unlocated }) }
}

const nameOf = (id: string) => CANDIDATES.find((c) => c.placeId === id)!.name
const isRestaurant = (p: CandidatePlace) =>
  p.types.some((t) => t === 'restaurant' || t.endsWith('_restaurant'))

describe('the fixture itself', () => {
  it('is shaped like retrieval output', () => {
    assertWellFormedCandidates(CANDIDATES)
    expect(CANDIDATES.length).toBeGreaterThanOrEqual(80)
  })

  it('carries the edge cases the pipeline has to survive', () => {
    expect(CANDIDATES.filter((c) => c.businessStatus === 'CLOSED_PERMANENTLY')).toHaveLength(2)
    expect(CANDIDATES.filter((c) => c.latitude === undefined)).toHaveLength(2)
    expect(CANDIDATES.some((c) => c.rating === undefined)).toBe(true)
    expect(CANDIDATES.some((c) => c.types.includes('steak_house'))).toBe(true)
    expect(CANDIDATES.filter((c) => c.priceLevel === 4).length).toBeGreaterThan(2)
    expect(CANDIDATES.filter(isRestaurant).length).toBeGreaterThan(20)
  })
})

describe('Gate A — cluster → funnel', () => {
  it('satisfies every invariant the deterministic core guarantees', () => {
    const { result } = runPipeline()
    assertValidShortlist(result, TRIP.profile)
  })

  it('narrows monotonically, and every candidate is accounted for', () => {
    const { result } = runPipeline()
    const { retrieved, afterFilters, afterClusterCap, afterGlobalCap } = result.stats

    expect(retrieved).toBe(CANDIDATES.length)
    expect(afterFilters).toBeLessThan(retrieved)
    expect(afterClusterCap).toBeLessThanOrEqual(afterFilters)
    expect(afterGlobalCap).toBeLessThanOrEqual(afterClusterCap)
    expect(afterGlobalCap).toBeGreaterThan(0)
  })

  it('drops exactly what it should, for the reason it should', () => {
    const { result } = runPipeline()
    const reasonFor = (id: string) => result.dropped.find((d) => d.placeId === id)?.reason

    expect(reasonFor('ChIJ_yamamoto_closed')).toMatch(/closed/i)
    expect(reasonFor('ChIJ_kokopeli_closed')).toMatch(/closed/i)
    expect(reasonFor('ChIJ_handicraft')).toMatch(/coordinates/i)
    // ¥¥¥¥ against a mid budget is two steps out — killed, not widened.
    expect(reasonFor('ChIJ_kikunoi')).toMatch(/budget/i)
    expect(reasonFor('ChIJ_gion_steak')).toMatch(/budget/i)
  })

  it('gives a temples-and-cafes traveller the Kyoto they came for', () => {
    const { result } = runPipeline()
    const ids = new Set(result.stages.afterGlobalCap.map((p) => p.placeId))

    for (const must of ['ChIJ_fushimi_inari', 'ChIJ_kiyomizu', 'ChIJ_kinkakuji']) {
      expect(ids.has(must), `${nameOf(must)} missing from a 5-day Kyoto shortlist`).toBe(true)
    }
    // …and it isn't just a food list.
    const restaurants = result.stages.afterGlobalCap.filter(isRestaurant)
    expect(restaurants.length / result.stages.afterGlobalCap.length).toBeLessThanOrEqual(0.4)
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
    expect(b.clusters.map((c) => c.score)).toEqual(a.clusters.map((c) => c.score))
  })

  it('a different traveller gets a different trip from the same candidates', () => {
    const nightOwl = runPipeline({
      interests: ['nightlife', 'shopping'],
      dietary: [],
      pace: 'packed',
      budget: 3,
    }).result
    const temples = runPipeline().result

    const a = nightOwl.stages.afterGlobalCap.map((p) => p.placeId)
    const b = temples.stages.afterGlobalCap.map((p) => p.placeId)
    expect(a).not.toEqual(b)
    expect(nightOwl.shortlist[0].placeId).not.toBe(temples.shortlist[0].placeId)
  })
})

describe('Gate A — meal ladder and durations over the real shortlist', () => {
  it('a vegetarian gets rung 1 in Kyoto, with no caveat and no violation', () => {
    const { result } = runPipeline()
    const meals = result.stages.afterGlobalCap.filter(isRestaurant)
    const selection = selectMealCandidates(meals, TRIP.profile)

    expect(selection.rung).toBe(1)
    assertDietaryHonoured(selection, TRIP.profile)
  })

  it('a bucket with no vegetarian option falls to rung 3 and says so', () => {
    // The steakhouse is already gone at budget 2 — raise the budget so this
    // tests the ladder rather than the budget filter.
    const profile: PreferenceProfile = { ...TRIP.profile, budget: 4 }
    const bucket = CANDIDATES.filter(
      (c) => isRestaurant(c) && !c.types.some((t) => t.startsWith('veg')),
    )
    const selection = selectMealCandidates(bucket, profile)

    expect(selection.rung).toBe(3)
    expect(selection.caveat).toMatch(/vegetarian/)
    assertDietaryHonoured(selection, profile)
  })

  it('every shortlisted place resolves to a sane visit duration', () => {
    const { result } = runPipeline()
    for (const place of result.stages.afterGlobalCap) {
      const { min, preferred, max } = resolveVisitDuration(place, undefined, TRIP.profile.pace)
      expect(min, `${place.name} has a non-positive minimum`).toBeGreaterThan(0)
      expect(preferred).toBeGreaterThanOrEqual(min)
      expect(preferred).toBeLessThanOrEqual(max)
      expect(Number.isFinite(max)).toBe(true)
    }
  })

  it('pace changes the day, not the bounds', () => {
    const temple = CANDIDATES.find((c) => c.placeId === 'ChIJ_ginkakuji')!
    const relaxed = resolveVisitDuration(temple, undefined, 'relaxed')
    const packed = resolveVisitDuration(temple, undefined, 'packed')

    expect(relaxed.preferred).toBeGreaterThan(packed.preferred)
    expect(relaxed.min).toBe(packed.min)
    expect(relaxed.max).toBe(packed.max)
  })
})

describe('Gate A — the shortlist itself', () => {
  it('matches the recorded plan', () => {
    const { result } = runPipeline()
    const summary = {
      stats: result.stats,
      days: result.clusters.map((cluster) => ({
        score: Number(cluster.score.toFixed(3)),
        places: cluster.places.map((p) => p.name),
      })),
    }
    expect(summary).toMatchSnapshot()
  })
})
