import { describe, it, expect } from 'vitest'

import type { CandidatePlace } from './types'
import type { PreferenceProfile } from './types'
import {
  quality,
  QUALITY_PRIOR_MEAN,
  affinity,
  priceFit,
  PRICE_FIT_NEUTRAL,
  applyHardFilters,
  hardFilterReason,
  scorePlace,
  scoreCandidates,
} from './score'

function makePlace(overrides: Partial<CandidatePlace> = {}): CandidatePlace {
  return {
    placeId: 'ChIJ_test',
    name: 'Test Place',
    types: ['cafe'],
    ...overrides,
  }
}

function makeProfile(overrides: Partial<PreferenceProfile> = {}): PreferenceProfile {
  return {
    interests: ['cafes'],
    dietary: [],
    pace: 'balanced',
    ...overrides,
  }
}

describe('quality (Bayesian)', () => {
  // The headline case, as a comparison not a magic number: raw rating would
  // rank the 5.0★/4-review place first, which is exactly the bug.
  it('4.6★ / 8000 reviews outscores 5.0★ / 4 reviews', () => {
    expect(quality(4.6, 8000)).toBeGreaterThan(quality(5.0, 4))
  })

  it('a place with no rating gets the prior, not 0', () => {
    expect(quality(undefined, undefined)).toBe(QUALITY_PRIOR_MEAN)
    expect(quality(undefined, undefined)).toBeGreaterThan(0)
  })

  it('is monotonic in review count at fixed rating (above the prior)', () => {
    const counts = [10, 100, 1000, 10000]
    const scores = counts.map((n) => quality(4.6, n))
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThan(scores[i - 1])
    }
  })
})

describe('affinity', () => {
  it('a cafe scores higher for interests [cafes] than for [temples]', () => {
    const cafe = makePlace({ types: ['cafe'] })
    expect(affinity(cafe, ['cafes'])).toBeGreaterThan(affinity(cafe, ['temples']))
  })

  it('matching two of the user interests outscores matching one', () => {
    const interests = ['cafes', 'outdoors', 'museums'] as const
    const two = makePlace({ types: ['cafe', 'park'] })
    const one = makePlace({ types: ['cafe'] })
    expect(affinity(two, [...interests])).toBeGreaterThan(affinity(one, [...interests]))
  })

  it('zero overlap → affinity 0, but total score still finite (quality can rescue it)', () => {
    const place = makePlace({ types: ['laundry'], rating: 4.8, userRatingCount: 5000 })
    expect(affinity(place, ['cafes'])).toBe(0)
    const scored = scorePlace(place, makeProfile())
    expect(Number.isFinite(scored.score)).toBe(true)
    expect(scored.score).toBeGreaterThan(0)
  })
})

describe('priceFit', () => {
  // The doc's explicit rule: unknown priceLevel scores neutral, never 0 —
  // "we don't know" must not read as "wildly off budget".
  it('unknown priceLevel scores neutral, strictly between exact match and worst mismatch', () => {
    expect(priceFit(undefined, 2)).toBe(PRICE_FIT_NEUTRAL)
    expect(PRICE_FIT_NEUTRAL).toBeLessThan(priceFit(2, 2))
    expect(PRICE_FIT_NEUTRAL).toBeGreaterThan(priceFit(4, 1))
  })

  it('under budget is a perfect fit, not a mismatch — cheap is never a penalty', () => {
    // Mirrors the hard filter, which only ever kills places ABOVE budget. A
    // symmetric priceFit ranked a mid-price ramen shop above a ¥ Kiyomizu-dera.
    expect(priceFit(0, 2)).toBe(priceFit(2, 2))
    expect(priceFit(1, 2)).toBe(priceFit(2, 2))
    expect(priceFit(3, 2)).toBeLessThan(priceFit(2, 2))
  })

  it('exact budget match > one step off > three steps off', () => {
    const exact = priceFit(2, 2)
    const oneOff = priceFit(3, 2)
    const threeOff = priceFit(4, 1)
    expect(exact).toBeGreaterThan(oneOff)
    expect(oneOff).toBeGreaterThan(threeOff)
  })
})

describe('hard filters — the guarantees', () => {
  const vegetarianProfile = makeProfile({ dietary: ['vegetarian'] })
  const steakhouse = makePlace({
    placeId: 'ChIJ_steak',
    types: ['steak_house', 'restaurant'],
  })

  it('a permanently closed place is removed', () => {
    const closed = makePlace({ businessStatus: 'CLOSED_PERMANENTLY' })
    const open = makePlace({ placeId: 'ChIJ_open', businessStatus: 'OPERATIONAL' })
    const kept = applyHardFilters([closed, open], makeProfile())
    expect(kept.map((p) => p.placeId)).toEqual(['ChIJ_open'])
  })

  it('a steakhouse is removed from meal-slot candidates for dietary: [vegetarian]', () => {
    const kept = applyHardFilters([steakhouse], vegetarianProfile, { mealSlot: true })
    expect(kept).toEqual([])
  })

  // A diet doesn't ban you from a museum with a grill in the lobby.
  it('that same steakhouse is NOT removed from non-meal candidates', () => {
    const kept = applyHardFilters([steakhouse], vegetarianProfile, { mealSlot: false })
    expect(kept.map((p) => p.placeId)).toEqual(['ChIJ_steak'])
  })

  // Google's own answer, from the shortlist hydration mask, outranks the type
  // guess in both directions.
  it("servesVegetarianFood: false removes a place the type list would have missed", () => {
    const plainDiner = makePlace({
      placeId: 'ChIJ_diner',
      types: ['restaurant'],
      servesVegetarianFood: false,
    })
    const kept = applyHardFilters([plainDiner], vegetarianProfile, { mealSlot: true })
    expect(kept).toEqual([])
  })

  it('servesVegetarianFood: true rescues a steakhouse the type list would have killed', () => {
    const veggieSteakhouse = { ...steakhouse, servesVegetarianFood: true }
    const kept = applyHardFilters([veggieSteakhouse], vegetarianProfile, { mealSlot: true })
    expect(kept.map((p) => p.placeId)).toEqual(['ChIJ_steak'])
  })

  // The case that would delete most of a city if we got it wrong: Google is
  // silent for most non-chain places, and silence is not a "no".
  it('undefined falls through to the type list rather than convicting', () => {
    const plainDiner = makePlace({ placeId: 'ChIJ_diner', types: ['restaurant'] })
    expect(plainDiner.servesVegetarianFood).toBeUndefined()
    const kept = applyHardFilters([plainDiner, steakhouse], vegetarianProfile, { mealSlot: true })
    expect(kept.map((p) => p.placeId)).toEqual(['ChIJ_diner'])
  })

  // No vegan field exists at Google, so vegan borrows the vegetarian one. A
  // place serving no vegetarian food serves no vegan food either.
  it('vegan reads the vegetarian flag, and a false still convicts', () => {
    const veganProfile = makeProfile({ dietary: ['vegan'] })
    const plainDiner = makePlace({
      placeId: 'ChIJ_diner',
      types: ['restaurant'],
      servesVegetarianFood: false,
    })
    expect(applyHardFilters([plainDiner], veganProfile, { mealSlot: true })).toEqual([])
  })

  it('the dietary reason names the need, whichever rule produced it', () => {
    const plainDiner = makePlace({ types: ['restaurant'], servesVegetarianFood: false })
    expect(hardFilterReason(plainDiner, vegetarianProfile, { mealSlot: true })).toBe(
      'dietary conflict: vegetarian',
    )
  })

  it('priceLevel 4 is removed for budget 1; priceLevel 2 is kept (one step out is "widen later")', () => {
    const budget1 = makeProfile({ budget: 1 })
    const pricey = makePlace({ placeId: 'ChIJ_pricey', priceLevel: 4 })
    const nearBudget = makePlace({ placeId: 'ChIJ_near', priceLevel: 2 })
    const kept = applyHardFilters([pricey, nearBudget], budget1)
    expect(kept.map((p) => p.placeId)).toEqual(['ChIJ_near'])
  })

  // Filters run BEFORE scoring: a filtered-out place never reaches scorePlace,
  // so it must be absent from scored output entirely.
  it('scoreCandidates never emits a filtered-out place', () => {
    const closed = makePlace({
      placeId: 'ChIJ_closed',
      businessStatus: 'CLOSED_PERMANENTLY',
      rating: 5.0,
      userRatingCount: 9000,
    })
    const open = makePlace({ placeId: 'ChIJ_open', rating: 4.2, userRatingCount: 300 })
    const scored = scoreCandidates([closed, open], makeProfile())
    expect(scored.map((s) => s.placeId)).toEqual(['ChIJ_open'])
  })
})

describe('match reasons', () => {
  it('output shape is { placeId, score, reasons: string[] }', () => {
    const scored = scorePlace(makePlace(), makeProfile())
    expect(scored).toMatchObject({
      placeId: 'ChIJ_test',
      score: expect.any(Number),
      reasons: expect.any(Array),
    })
  })

  it('a vegetarian restaurant matching cafes emits both an interest and a rating reason', () => {
    const place = makePlace({
      types: ['vegetarian_restaurant', 'cafe'],
      rating: 4.8,
      userRatingCount: 2100,
    })
    const { reasons } = scorePlace(place, makeProfile())
    expect(reasons).toContain('matches: cafes')
    expect(reasons).toContain('4.8★ · 2.1k reviews')
  })

  // The "why this place" UX has no fallback if reasons are empty.
  it('reasons are never empty for a place that survived filtering', () => {
    const bare = makePlace({ types: ['laundry'] }) // no rating, no interest match
    const scored = scoreCandidates([bare], makeProfile())
    expect(scored).toHaveLength(1)
    expect(scored[0].reasons.length).toBeGreaterThanOrEqual(1)
  })
})
