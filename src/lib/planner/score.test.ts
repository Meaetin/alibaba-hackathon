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
  popularity,
  typeAffinityBonus,
  TYPE_AFFINITY_MAX,
  WEIGHTS,
} from './score'
import { DEFAULT_SCORING_KNOBS } from './knobs'

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

  // The real failure that put these types on the list: a live Singapore run
  // seated a vegetarian at Poulet - VivoCity for dinner. Google was silent on
  // `servesVegetarianFood`, and the type list had nothing to say about a place
  // whose whole cuisine is the animal.
  it('a chicken restaurant is removed from meal-slot candidates for a vegetarian', () => {
    const poulet = makePlace({
      placeId: 'ChIJ_poulet',
      types: ['french_restaurant', 'chicken_restaurant', 'restaurant'],
    })
    expect(poulet.servesVegetarianFood).toBeUndefined()
    expect(applyHardFilters([poulet], vegetarianProfile, { mealSlot: true })).toEqual([])
  })

  // The boundary the list is drawn on: the animal has to be the cuisine, not an
  // item on the menu. A list that also killed these would delete most of a city.
  // Ramen and sushi were tried on the conflict list and rejected: both name the
  // carbohydrate. Gate A's Kyoto fixture has a vegan ramen shop in it, and the
  // ramen rule deleted it — this is that lesson, pinned where the rule lives.
  it.each([
    ['italian', ['italian_restaurant', 'restaurant']],
    ['ramen', ['ramen_restaurant', 'restaurant']],
    ['sushi', ['sushi_restaurant', 'restaurant']],
    ['a plain cafe', ['cafe', 'coffee_shop']],
    ['a hawker centre', ['food_court', 'market', 'restaurant']],
  ])('%s survives, because Google never said and the cuisine is not an animal', (_label, types) => {
    const place = makePlace({ placeId: 'ChIJ_ok', types })
    expect(applyHardFilters([place], vegetarianProfile, { mealSlot: true })).toHaveLength(1)
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

describe('popularity', () => {
  it('is log-scaled — a hundred reviews is halfway to ten thousand', () => {
    // Not a linear fraction: on a linear scale a 100-review place would score
    // one hundredth, and the whole term would be about landmarks only.
    expect(popularity(100)).toBeCloseTo(0.5, 2)
    expect(popularity(10_000)).toBe(1)
    expect(popularity(50_000)).toBe(1)
  })

  it('reads an unknown count as unknown fame, not average fame', () => {
    expect(popularity(undefined)).toBe(0)
    expect(popularity(0)).toBe(0)
  })

  it('asks a different question from quality', () => {
    // A superb little place nobody has been to: high quality, low fame. If
    // these two moved together the tourist-trap penalty would be a quality
    // penalty, which is not what any traveller asked for.
    expect(quality(4.9, 40)).toBeGreaterThan(quality(4.0, 40))
    expect(popularity(40)).toBe(popularity(40))
    expect(popularity(40)).toBeLessThan(popularity(9000))
  })
})

describe('typeAffinityBonus', () => {
  const affinities = { museum: 1.3, shopping_mall: 0.9 }

  it('reads the map as an offset from neutral', () => {
    expect(typeAffinityBonus(makePlace({ types: ['museum'] }), affinities)).toBeCloseTo(0.3)
    expect(typeAffinityBonus(makePlace({ types: ['shopping_mall'] }), affinities)).toBeCloseTo(-0.1)
  })

  it('says nothing about a type the map never mentions', () => {
    // Silence is not a zero opinion expressed loudly — an unlisted type must
    // score the same as a place with no map at all.
    expect(typeAffinityBonus(makePlace({ types: ['laundry'] }), affinities)).toBe(0)
    expect(typeAffinityBonus(makePlace({ types: ['museum'] }), undefined)).toBe(0)
  })

  it('takes the strongest opinion when a place has several types', () => {
    const place = makePlace({ types: ['shopping_mall', 'museum'] })
    expect(typeAffinityBonus(place, affinities)).toBeCloseTo(0.3)
  })

  it('is bounded, so one preset entry cannot out-vote the whole score', () => {
    expect(typeAffinityBonus(makePlace({ types: ['museum'] }), { museum: 4 })).toBe(
      TYPE_AFFINITY_MAX,
    )
    expect(typeAffinityBonus(makePlace({ types: ['museum'] }), { museum: 0 })).toBe(
      -TYPE_AFFINITY_MAX,
    )
  })

  it('lifts a place the interest union cannot express', () => {
    // The seven-member union has no "art gallery" member. Without the type map
    // this place matches nothing at all and rides on quality alone.
    const gallery = makePlace({ types: ['art_gallery'], rating: 4.4, userRatingCount: 600 })
    const plain = makeProfile({ interests: ['food'] })
    const persona = makeProfile({ interests: ['food'], typeAffinities: { art_gallery: 1.4 } })
    expect(scorePlace(gallery, persona).score).toBeGreaterThan(
      scorePlace(gallery, plain).score,
    )
  })
})

describe('priceFit under budget', () => {
  it('treats cheap as a perfect fit by default', () => {
    expect(priceFit(0, 3)).toBe(1)
    expect(priceFit(3, 3)).toBe(1)
  })

  it('penalises cheap only for the traveller who asked for polish', () => {
    // Symmetric, and only here: the default curve must stay asymmetric or the
    // hard filter directly below it ("cheap is never a violation") contradicts
    // the score that follows it.
    expect(priceFit(0, 3, true)).toBeLessThan(priceFit(0, 3, false))
    expect(priceFit(3, 3, true)).toBe(1)
    // Above budget is unaffected by the flag — that half was never in dispute.
    expect(priceFit(4, 2, true)).toBe(priceFit(4, 2, false))
  })
})

describe('scorePlace with persona knobs', () => {
  const famous = makePlace({ types: ['cafe'], rating: 4.5, userRatingCount: 9000 })
  const obscure = makePlace({
    placeId: 'ChIJ_obscure',
    types: ['cafe'],
    rating: 4.5,
    userRatingCount: 60,
  })

  it('defaults to today: no popularity term, no fame penalty', () => {
    expect(WEIGHTS.popularity).toBe(0)
    // Same rating, wildly different fame. Without a persona the two differ only
    // by the Bayesian shrink in `quality`, and the famous one wins on that.
    const gap = scorePlace(famous, makeProfile()).score - scorePlace(obscure, makeProfile()).score
    expect(gap).toBeGreaterThan(0)
    expect(gap).toBeLessThan(0.05)
  })

  it('lets the highlights traveller pay for fame', () => {
    const knobs = {
      ...DEFAULT_SCORING_KNOBS,
      weights: { affinity: 0.33, quality: 0.25, priceFit: 0.21, popularity: 0.21 },
    }
    const before = scorePlace(famous, makeProfile()).score - scorePlace(obscure, makeProfile()).score
    const after =
      scorePlace(famous, makeProfile(), knobs).score -
      scorePlace(obscure, makeProfile(), knobs).score
    expect(after).toBeGreaterThan(before)
  })

  it('lets the deep traveller charge for it instead', () => {
    const knobs = { ...DEFAULT_SCORING_KNOBS, touristTrapPenalty: 0.15 }
    // The whole point of the axis: the famous cafe now loses to the quiet one
    // despite the identical rating.
    expect(scorePlace(famous, makeProfile(), knobs).score).toBeLessThan(
      scorePlace(obscure, makeProfile(), knobs).score,
    )
  })

  it('exempts the types where cheap is the experience', () => {
    const hawker = makePlace({ types: ['food_court'], priceLevel: 0 })
    const polished = { ...DEFAULT_SCORING_KNOBS, priceFitPenalisesBelow: true }
    const polishedAndDeep = { ...polished, cheapTypeExemptions: ['food_court'] }
    const profile = makeProfile({ budget: 3 })

    expect(scorePlace(hawker, profile, polishedAndDeep).score).toBeGreaterThan(
      scorePlace(hawker, profile, polished).score,
    )
  })
})
