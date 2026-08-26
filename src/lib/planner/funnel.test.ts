import { describe, it, expect } from 'vitest'

import type { CandidatePlace, PreferenceProfile } from './types'
import type { PlaceCluster } from './cluster'
import {
  runFunnel,
  pickSerendipity,
  scoreCluster,
  selectMealCandidates,
  widenBudget,
  FUNNEL_DEFAULTS,
  SERENDIPITY_MAX_REVIEWS,
  pickSerendipitySlots,
  type FunnelStats,
} from './funnel'
import { resolvePlannerKnobs } from './knobs'

function makePlace(placeId: string, overrides: Partial<CandidatePlace> = {}): CandidatePlace {
  return {
    placeId,
    name: placeId,
    types: ['tourist_attraction'],
    rating: 4.2,
    userRatingCount: 1000,
    ...overrides,
  }
}

function makeCluster(places: CandidatePlace[]): PlaceCluster {
  return { centroid: { latitude: 35.0, longitude: 135.7 }, places, label: undefined }
}

function makeProfile(overrides: Partial<PreferenceProfile> = {}): PreferenceProfile {
  return { interests: ['cafes', 'temples'], dietary: [], pace: 'balanced', ...overrides }
}

/** `n` places named `{prefix}-p{j}` with deterministically varied ratings. */
function fillCluster(prefix: string, n: number, types: string[] = ['tourist_attraction']): CandidatePlace[] {
  return Array.from({ length: n }, (_, j) =>
    makePlace(`${prefix}-p${j}`, {
      types,
      rating: 3.5 + (j % 15) * 0.1,
      userRatingCount: 500 + j * 7,
    }),
  )
}

const isRestaurant = (p: CandidatePlace) =>
  p.types.some((t) => t === 'restaurant' || t.endsWith('_restaurant'))

/** Which fixture cluster a shortlisted place came from ("c3" for "c3-p42"). */
function clusterOf(placeId: string): string {
  return placeId.split('-')[0]
}

describe('per-cluster cap', () => {
  it('10 clusters × 100 places, cap 20 → exactly 20 from each cluster', () => {
    const clusters = Array.from({ length: 10 }, (_, i) => makeCluster(fillCluster(`c${i}`, 100)))
    const result = runFunnel(clusters, makeProfile())

    expect(result.stages.afterClusterCap).toHaveLength(200)
    const byCluster = new Map<string, number>()
    for (const place of result.stages.afterClusterCap) {
      const key = clusterOf(place.placeId)
      byCluster.set(key, (byCluster.get(key) ?? 0) + 1)
    }
    expect(byCluster.size).toBe(10)
    for (const [key, count] of byCluster) {
      expect(count, `cluster ${key} contributed ${count}`).toBe(20)
    }
  })

  it('one 500-place cluster does not starve the other nine', () => {
    // The failure the cap exists to prevent: without it, the dense district
    // would fill the whole pool by score alone.
    const clusters = [
      makeCluster(fillCluster('c0', 500)),
      ...Array.from({ length: 9 }, (_, i) => makeCluster(fillCluster(`c${i + 1}`, 100))),
    ]
    const result = runFunnel(clusters, makeProfile())

    const byCluster = new Map<string, number>()
    for (const place of result.stages.afterClusterCap) {
      const key = clusterOf(place.placeId)
      byCluster.set(key, (byCluster.get(key) ?? 0) + 1)
    }
    for (let i = 0; i < 10; i++) {
      expect(byCluster.get(`c${i}`), `cluster c${i}`).toBe(20)
    }
  })
})

describe('global cap + quotas', () => {
  // 90 restaurants (30 ramen / 30 sushi / 30 izakaya) + 40 non-restaurants.
  function restaurantHeavyClusters(): PlaceCluster[] {
    const cuisines = ['ramen_restaurant', 'sushi_restaurant', 'izakaya_restaurant']
    const restaurants = cuisines.flatMap((cuisine, c) =>
      Array.from({ length: 30 }, (_, j) =>
        makePlace(`r${c}-p${j}`, {
          types: ['restaurant', cuisine],
          rating: 4.0 + (j % 9) * 0.1,
          userRatingCount: 2000 + j * 11,
        }),
      ),
    )
    const others = Array.from({ length: 40 }, (_, j) =>
      makePlace(`t0-p${j}`, {
        types: ['tourist_attraction'],
        rating: 3.6 + (j % 12) * 0.1,
        userRatingCount: 800 + j * 13,
      }),
    )
    return [makeCluster([...restaurants, ...others])]
  }

  const isRestaurant = (p: CandidatePlace) =>
    p.types.some((t) => t === 'restaurant' || t.endsWith('_restaurant'))

  it('caps the shortlist at 60 with ≤ 40% restaurants even on 90%-restaurant input', () => {
    const result = runFunnel(restaurantHeavyClusters(), makeProfile(), { perClusterCap: 200 })
    const shortlist = result.stages.afterGlobalCap

    expect(shortlist.length).toBeLessThanOrEqual(60)
    const restaurants = shortlist.filter(isRestaurant)
    expect(restaurants.length).toBeLessThanOrEqual(60 * 0.4)
    // The share, not just the absolute count — with 40 non-restaurants available
    // the quota has to actually bind.
    expect(restaurants.length / shortlist.length).toBeLessThanOrEqual(0.4)
  })

  // The quota is denominated in the CAP, not in the output length. In a thin
  // city the shortlist tips past 40% restaurants rather than shrink — Pass B
  // with 34 candidates beats Pass B with 16. Pinned because it reads like a
  // violation of the rule above and is deliberate.
  it('when non-restaurants run out, fills past the 40% share rather than shrinking', () => {
    const cuisines = Array.from({ length: 30 }, (_, i) => `c${i}_restaurant`)
    const restaurants = cuisines.flatMap((cuisine, c) =>
      Array.from({ length: 3 }, (_, j) =>
        makePlace(`r${c}-p${j}`, { types: ['restaurant', cuisine], rating: 4.6 }),
      ),
    )
    const others = fillCluster('other', 10)
    const result = runFunnel([makeCluster([...restaurants, ...others])], makeProfile(), {
      perClusterCap: 200,
    })
    const shortlist = result.stages.afterGlobalCap
    const count = shortlist.filter(isRestaurant).length

    expect(count).toBe(Math.floor(60 * FUNNEL_DEFAULTS.maxRestaurantShare))
    expect(shortlist.length).toBe(count + 10)
    expect(count / shortlist.length).toBeGreaterThan(0.4)
  })

  it('allows ≤ 3 of the same cuisine type', () => {
    const result = runFunnel(restaurantHeavyClusters(), makeProfile(), { perClusterCap: 200 })
    const counts = new Map<string, number>()
    for (const place of result.stages.afterGlobalCap) {
      for (const t of place.types) {
        if (t.endsWith('_restaurant')) counts.set(t, (counts.get(t) ?? 0) + 1)
      }
    }
    for (const [cuisine, count] of counts) {
      expect(count, `${count}× ${cuisine}`).toBeLessThanOrEqual(3)
    }
  })

  it('cuts by score: the highest-scored non-restaurant survives restaurant-heavy input', () => {
    const clusters = restaurantHeavyClusters()
    const star = makePlace('star-attraction', {
      types: ['temple', 'tourist_attraction'], // matches the 'temples' interest
      rating: 4.9,
      userRatingCount: 9000,
    })
    clusters[0].places.push(star)

    const result = runFunnel(clusters, makeProfile(), { perClusterCap: 200 })
    const ids = result.stages.afterGlobalCap.map((p) => p.placeId)
    expect(ids).toContain('star-attraction')
  })
})

describe('FunnelStats', () => {
  // Loop over the stats keys themselves so a new stage cannot be added
  // without a stat — the loop picks it up automatically.
  function assertStatsMatchStages(result: ReturnType<typeof runFunnel>) {
    const stageNames = Object.keys(result.stats) as (keyof FunnelStats)[]
    expect(stageNames.length).toBeGreaterThanOrEqual(4)
    for (const stage of stageNames) {
      expect(result.stats[stage], `stats.${stage}`).toBe(result.stages[stage].length)
    }
  }

  it('every stat equals the actual length of the corresponding stage list', () => {
    const clusters = [
      makeCluster([
        ...fillCluster('c0', 80),
        makePlace('c0-closed', { businessStatus: 'CLOSED_PERMANENTLY' }),
      ]),
      makeCluster(fillCluster('c1', 80)),
    ]
    const result = runFunnel(clusters, makeProfile())
    assertStatsMatchStages(result)
    // The closed place really was cut at the filter stage.
    expect(result.stats.afterFilters).toBe(result.stats.retrieved - 1)
  })

  it('stats are complete even when no cut fires (40-candidate city)', () => {
    // Both clusters sit at exactly the per-cluster cap — every stage a no-op.
    const clusters = [makeCluster(fillCluster('c0', 20)), makeCluster(fillCluster('c1', 20))]
    const result = runFunnel(clusters, makeProfile())
    assertStatsMatchStages(result)
    // Every stage a no-op: all four counts identical.
    expect(new Set(Object.values(result.stats)).size).toBe(1)
    expect(result.stats.retrieved).toBe(40)
  })
})

describe('cluster grouping (Pass B input)', () => {
  // Two clusters, distinguishable by placeId prefix.
  function twoClusters(): PlaceCluster[] {
    return [
      { centroid: { latitude: 35.0, longitude: 135.6 }, places: fillCluster('west', 30) },
      { centroid: { latitude: 35.1, longitude: 135.8 }, places: fillCluster('east', 30) },
    ]
  }

  it('the shortlist survives grouped by cluster — Pass B never re-derives membership', () => {
    const result = runFunnel(twoClusters(), makeProfile())

    expect(result.clusters).toHaveLength(2)
    const grouped = result.clusters.flatMap((c) => c.places.map((p) => p.placeId))
    expect(grouped.sort()).toEqual(result.stages.afterGlobalCap.map((p) => p.placeId).sort())
    for (const cluster of result.clusters) {
      const prefixes = new Set(cluster.places.map((p) => clusterOf(p.placeId)))
      expect(prefixes.size, 'a cluster must not mix fixture clusters').toBe(1)
    }
  })

  it('each cluster carries its centroid, label slot and index-aligned scores', () => {
    const [first] = runFunnel(twoClusters(), makeProfile()).clusters

    expect(first.centroid).toEqual({ latitude: expect.any(Number), longitude: expect.any(Number) })
    expect(first.label).toBeUndefined()
    expect(first.scored.map((s) => s.placeId)).toEqual(first.places.map((p) => p.placeId))
  })

  it('clusters come back best-first, and members within a cluster best-first', () => {
    const result = runFunnel(twoClusters(), makeProfile())
    const scores = result.clusters.map((c) => c.score)
    expect([...scores].sort((a, b) => b - a)).toEqual(scores)

    for (const cluster of result.clusters) {
      const memberScores = cluster.scored.map((s) => s.score)
      expect([...memberScores].sort((a, b) => b - a)).toEqual(memberScores)
    }
  })

  it('reserves meals for a cluster the global quotas would otherwise starve', () => {
    const clusters: PlaceCluster[] = [
      makeCluster(fillCluster('good', 30)),
      // All one cuisine, all worse-rated: on score alone every one of these
      // loses to the good cluster, and the cuisine quota would admit 3 at most.
      {
        centroid: { latitude: 35.5, longitude: 135.9 },
        places: fillCluster('food', 30, ['restaurant', 'ramen_restaurant']).map((p) => ({
          ...p,
          rating: 3.0,
          userRatingCount: 5,
        })),
      },
    ]
    const result = runFunnel(clusters, makeProfile(), { globalCap: 20 })

    expect(result.clusters.every((c) => c.places.length > 0)).toBe(true)
    // The reservation is the whole point: a day in the quiet neighborhood still
    // gets fed, even though nothing there outranks the good cluster.
    const food = result.clusters.find((c) => clusterOf(c.places[0].placeId) === 'food')
    expect(food, 'the food cluster was starved out entirely').toBeDefined()
    expect(food!.places.filter(isRestaurant)).toHaveLength(FUNNEL_DEFAULTS.mealsPerCluster)
    expect(food!.shortfall).toBeUndefined()
  })

  it('a cluster with nothing to reserve and nothing competitive is omitted, not returned empty', () => {
    const clusters: PlaceCluster[] = [
      makeCluster(fillCluster('good', 30)),
      // No restaurants, so nothing is reserved; every member loses on score.
      {
        centroid: { latitude: 35.5, longitude: 135.9 },
        places: fillCluster('dull', 30).map((p) => ({ ...p, rating: 3.0, userRatingCount: 5 })),
      },
    ]
    const result = runFunnel(clusters, makeProfile(), { globalCap: 20 })

    expect(result.clusters.every((c) => c.places.length > 0)).toBe(true)
    expect(result.clusters.map((c) => clusterOf(c.places[0].placeId))).toEqual(['good'])
  })

  it('says so when a cluster cannot seat a day\u2019s meals', () => {
    // One restaurant available where a day needs two.
    const clusters: PlaceCluster[] = [
      makeCluster([
        ...fillCluster('lonely', 10),
        makePlace('lonely-eat', { types: ['restaurant'], rating: 4.5, userRatingCount: 900 }),
      ]),
    ]
    const result = runFunnel(clusters, makeProfile())

    expect(result.clusters[0].shortfall).toMatch(/cannot seat/i)
    expect(result.clusters[0].shortfall).toMatch(/1 place/)
  })
})

describe('scoreCluster', () => {
  const profile = makeProfile() // interests: cafes, temples

  it('a cluster serving both interests outscores one serving only a single interest', () => {
    const both = [
      makePlace('c1', { types: ['cafe'] }),
      makePlace('t1', { types: ['place_of_worship'] }),
    ]
    const one = [
      makePlace('c2', { types: ['cafe'] }),
      makePlace('c3', { types: ['cafe'] }),
    ]
    expect(scoreCluster(both, profile)).toBeGreaterThan(scoreCluster(one, profile))
  })

  it('a mixed activity/food/cafe cluster outscores a same-role cluster of equal places', () => {
    const base = { rating: 4.2, userRatingCount: 1000 }
    const mixed = [
      makePlace('a', { types: ['tourist_attraction'], ...base }),
      makePlace('b', { types: ['restaurant'], ...base }),
      makePlace('c', { types: ['cafe'], ...base }),
    ]
    const sameRole = [
      makePlace('d', { types: ['tourist_attraction'], ...base }),
      makePlace('e', { types: ['tourist_attraction'], ...base }),
      makePlace('f', { types: ['tourist_attraction'], ...base }),
    ]
    // Both clusters cover exactly one interest (cafe) vs none, so hold coverage
    // level by comparing against a no-interest profile.
    const blind = makeProfile({ interests: [] })
    expect(scoreCluster(mixed, blind)).toBeGreaterThan(scoreCluster(sameRole, blind))
  })

  it('is dominated by place quality: a great cluster beats a varied mediocre one', () => {
    const great = fillCluster('great', 5).map((p) => ({ ...p, rating: 4.9, userRatingCount: 5000 }))
    const mediocre = [
      makePlace('m1', { types: ['tourist_attraction'], rating: 2.5, userRatingCount: 5000 }),
      makePlace('m2', { types: ['restaurant'], rating: 2.5, userRatingCount: 5000 }),
      makePlace('m3', { types: ['cafe'], rating: 2.5, userRatingCount: 5000 }),
    ]
    expect(scoreCluster(great, profile)).toBeGreaterThan(scoreCluster(mediocre, profile))
  })

  it('an empty cluster scores 0, no NaN', () => {
    expect(scoreCluster([], profile)).toBe(0)
  })
})

describe('dropped candidates — invariant 8', () => {
  it('every candidate that did not reach the shortlist has a stage and a reason', () => {
    const clusters = [
      makeCluster([
        ...fillCluster('a', 40),
        makePlace('closed', { businessStatus: 'CLOSED_PERMANENTLY' }),
        makePlace('pricey', { priceLevel: 4 }),
      ]),
    ]
    const result = runFunnel(clusters, makeProfile({ budget: 1 }), { perClusterCap: 10 })

    const survived = new Set(result.stages.afterGlobalCap.map((p) => p.placeId))
    const droppedIds = new Set(result.dropped.map((d) => d.placeId))
    for (const place of result.stages.retrieved) {
      if (survived.has(place.placeId)) continue
      expect(droppedIds.has(place.placeId), `${place.placeId} dropped without a reason`).toBe(true)
    }
    expect(result.dropped.every((d) => d.reason.length > 0)).toBe(true)
    expect(survived.size + droppedIds.size).toBe(result.stages.retrieved.length)
  })

  it('names the rule that killed each place, not just the stage', () => {
    const clusters = [
      makeCluster([
        makePlace('keep'),
        makePlace('closed', { businessStatus: 'CLOSED_PERMANENTLY' }),
        makePlace('pricey', { priceLevel: 4 }),
      ]),
    ]
    const { dropped } = runFunnel(clusters, makeProfile({ budget: 1 }))
    const reasonFor = (id: string) => dropped.find((d) => d.placeId === id)?.reason

    expect(reasonFor('closed')).toMatch(/closed/i)
    expect(reasonFor('pricey')).toMatch(/budget/i)
  })

  it('records the cap that dropped a place, per stage', () => {
    const result = runFunnel([makeCluster(fillCluster('a', 50))], makeProfile(), {
      perClusterCap: 10,
      globalCap: 5,
    })
    const stages = new Set(result.dropped.map((d) => d.stage))
    expect(stages).toContain('afterClusterCap')
    expect(stages).toContain('afterGlobalCap')
  })

  it('unlocated candidates count as retrieved and are dropped with a reason', () => {
    const nowhere = makePlace('nowhere')
    const result = runFunnel([makeCluster(fillCluster('a', 5))], makeProfile(), {
      unlocated: [nowhere],
    })

    expect(result.stats.retrieved).toBe(6)
    expect(result.stats.afterFilters).toBe(5)
    expect(result.dropped.find((d) => d.placeId === 'nowhere')?.reason).toMatch(/coordinates/i)
  })
})

describe('serendipity slot', () => {
  const profile = makeProfile({ interests: ['cafes'] })

  const hiddenGem = makePlace('hidden-gem', {
    types: ['cafe'],
    rating: 4.7,
    userRatingCount: 300,
  })
  const lesserGem = makePlace('lesser-gem', {
    types: ['cafe'],
    rating: 4.0,
    userRatingCount: 400,
  })
  const famous = makePlace('famous', {
    types: ['cafe'],
    rating: 4.8,
    userRatingCount: 20000,
  })
  // The old "zero type overlap" rule would pick this: great score, no interest.
  const departmentStore = makePlace('department-store', {
    types: ['department_store'],
    rating: 4.9,
    userRatingCount: 200,
  })

  it('picks the highest-scoring candidate under the review threshold that matches ≥ 1 interest', () => {
    const pick = pickSerendipity([lesserGem, famous, departmentStore, hiddenGem], profile)
    expect(pick?.placeId).toBe('hidden-gem')
  })

  it('a high-scoring 20,000-review place is not the pick', () => {
    const pick = pickSerendipity([famous, lesserGem], profile)
    expect(pick?.placeId).toBe('lesser-gem')
    expect(famous.userRatingCount).toBeGreaterThan(SERENDIPITY_MAX_REVIEWS)
  })

  it('a low-review place matching zero interests is not the pick', () => {
    const pick = pickSerendipity([departmentStore, lesserGem], profile)
    expect(pick?.placeId).toBe('lesser-gem')
  })

  it('no qualifying candidate → undefined, the day is built without one', () => {
    expect(pickSerendipity([famous, departmentStore], profile)).toBeUndefined()
    expect(pickSerendipity([], profile)).toBeUndefined()
  })
})

describe('dietary degradation ladder', () => {
  const profile = makeProfile({ dietary: ['vegetarian'] })

  const veggieHaven = makePlace('veggie-haven', { types: ['vegetarian_restaurant', 'restaurant'] })
  const friendlyIzakaya = makePlace('friendly-izakaya', { types: ['izakaya_restaurant', 'restaurant'] })
  const ramenShop = makePlace('ramen-shop', { types: ['ramen_restaurant', 'restaurant'] })

  it('rung 1: place-type matches win, and the rung is returned even at rung 1', () => {
    const result = selectMealCandidates([veggieHaven, friendlyIzakaya, ramenShop], profile)
    expect(result.rung).toBe(1)
    expect(result.places.map((p) => p.placeId)).toEqual(['veggie-haven'])
    expect(result.caveat).toBeUndefined()
  })

  it('rung 1 empty → falls to rung 2 via the vegetarian-friendly enrichment tag', () => {
    const result = selectMealCandidates([friendlyIzakaya, ramenShop], profile, {
      'friendly-izakaya': ['vegetarian-friendly', 'cozy'],
    })
    expect(result.rung).toBe(2)
    expect(result.places.map((p) => p.placeId)).toEqual(['friendly-izakaya'])
    expect(result.caveat).toBeUndefined()
  })

  // Google states this outright; the enrichment model was inferring it from
  // review text. Ask Google first.
  it("rung 2 accepts Google's servesVegetarianFood with no enrichment tag present", () => {
    const googleVeggie = { ...friendlyIzakaya, servesVegetarianFood: true }
    const result = selectMealCandidates([googleVeggie, ramenShop], profile)
    expect(result.rung).toBe(2)
    expect(result.places.map((p) => p.placeId)).toEqual(['friendly-izakaya'])
  })

  it("Google's false overrides a vegetarian-friendly enrichment tag", () => {
    const googleSaysNo = { ...friendlyIzakaya, servesVegetarianFood: false }
    const result = selectMealCandidates([googleSaysNo, ramenShop], profile, {
      'friendly-izakaya': ['vegetarian-friendly'],
    })
    expect(result.rung).toBe(3)
  })

  // Google has no vegan field, so vegan must keep using tags even when the
  // vegetarian flag is set — vegetarian is not vegan.
  it('a vegan need ignores servesVegetarianFood and still reads the tag', () => {
    const veganProfile = makeProfile({ dietary: ['vegan'] })
    const googleVeggie = { ...friendlyIzakaya, servesVegetarianFood: true }
    expect(selectMealCandidates([googleVeggie, ramenShop], veganProfile).rung).toBe(3)
    expect(
      selectMealCandidates([googleVeggie, ramenShop], veganProfile, {
        'friendly-izakaya': ['vegan-friendly'],
      }).rung,
    ).toBe(2)
  })

  it('rungs 1 and 2 empty → rung 3 (any restaurant) AND the result carries the caveat flag', () => {
    const result = selectMealCandidates([friendlyIzakaya, ramenShop], profile)
    expect(result.rung).toBe(3)
    expect(result.places).toHaveLength(2)
    // Assert the flag, not just the place — Pass C turns it into a tip.
    expect(result.caveat).toBeDefined()
    expect(result.caveat).toMatch(/vegetarian/)
  })

  it('no dietary needs → whole bucket at rung 1, no caveat', () => {
    const result = selectMealCandidates([friendlyIzakaya, ramenShop], makeProfile())
    expect(result.rung).toBe(1)
    expect(result.places).toHaveLength(2)
    expect(result.caveat).toBeUndefined()
  })
})

describe('budget degradation ladder', () => {
  const profile = makeProfile({ budget: 1 })

  it('an emptied bucket widens by exactly one priceLevel step per iteration', () => {
    const bucket = [
      makePlace('mid-a', { priceLevel: 3 }),
      makePlace('mid-b', { priceLevel: 3 }),
      makePlace('lux', { priceLevel: 4 }),
    ]
    const result = widenBudget(bucket, profile)

    // One step (budget 1 → 2) admits priceLevel 3; priceLevel 4 needs a
    // second step that must never run once the bucket is non-empty.
    expect(result.widenedBy).toBe(1)
    const ids = result.places.map((p) => p.placeId).sort()
    expect(ids).toEqual(['mid-a', 'mid-b'])
  })

  it('records the widening in match_reasons', () => {
    const bucket = [makePlace('mid-a', { priceLevel: 3 })]
    const result = widenBudget(bucket, profile)
    for (const scored of result.scored) {
      expect(scored.reasons.some((r) => /widened/.test(r)), scored.placeId).toBe(true)
    }
  })

  it('no widening needed → widenedBy 0 and no widening reason', () => {
    const bucket = [makePlace('cheap', { priceLevel: 1 }), makePlace('lux', { priceLevel: 4 })]
    const result = widenBudget(bucket, profile)
    expect(result.widenedBy).toBe(0)
    expect(result.places.map((p) => p.placeId)).toEqual(['cheap'])
    for (const scored of result.scored) {
      expect(scored.reasons.some((r) => /widened/.test(r))).toBe(false)
    }
  })

  it('no budget in the profile → nothing to widen, widenedBy 0, bucket untouched', () => {
    const bucket = [makePlace('a', { priceLevel: 4 }), makePlace('b')]
    const result = widenBudget(bucket, makeProfile())
    expect(result.widenedBy).toBe(0)
    expect(result.places).toHaveLength(2)
  })
})

describe('persona knobs in the funnel', () => {
  const profile = makeProfile({ budget: 1 })

  const base = resolvePlannerKnobs(profile, undefined, 'balanced')

  it('stops widening the budget where a polished traveller would', () => {
    const bucket = [makePlace('lux', { priceLevel: 4 })]
    // Unbounded, this walks up the scale until the ¥¥¥¥ place is within two
    // steps of the widened budget and admits it — for someone who said ¥.
    // Bounded at one step it finds nothing, and the ladder hands the whole
    // bucket back rather than failing the day.
    expect(widenBudget(bucket, profile).widenedBy).toBe(2)
    const stingy = widenBudget(bucket, profile, { ...base, budgetWidenSteps: 1 })
    expect(stingy.widenedBy).toBe(0)
    expect(stingy.places).toHaveLength(1)
  })

  it('picks no wildcards without a persona, which is what this planner always did', () => {
    const candidates = [
      makePlace('gem-a', { types: ['cafe'], rating: 4.6, userRatingCount: 120 }),
      makePlace('gem-b', { types: ['cafe'], rating: 4.4, userRatingCount: 90 }),
    ]
    expect(base.serendipityPerTrip).toBe(0)
    expect(pickSerendipitySlots(candidates, profile, base)).toEqual([])
  })

  it('never returns the same wildcard twice', () => {
    const candidates = [
      makePlace('gem-a', { types: ['cafe'], rating: 4.6, userRatingCount: 120 }),
      makePlace('gem-b', { types: ['cafe'], rating: 4.4, userRatingCount: 90 }),
    ]
    const twoPicks = { ...base, serendipityPerTrip: 2 }
    const picks = pickSerendipitySlots(candidates, profile, twoPicks)
    expect(picks.map((p) => p.placeId)).toEqual(['gem-a', 'gem-b'])
  })

  it('returns fewer wildcards than asked when the pool runs out', () => {
    const one = [makePlace('gem-a', { types: ['cafe'], rating: 4.6, userRatingCount: 120 })]
    const threePicks = { ...base, serendipityPerTrip: 3 }
    expect(pickSerendipitySlots(one, profile, threePicks)).toHaveLength(1)
  })

  it('lets a raised threshold admit a place the default rejects', () => {
    const borderline = makePlace('borderline', {
      types: ['cafe'],
      rating: 4.5,
      userRatingCount: 900,
    })
    expect(pickSerendipitySlots([borderline], profile, { ...base, serendipityPerTrip: 1 })).toEqual(
      [],
    )
    const improvised = { ...base, serendipityPerTrip: 1, serendipityMaxReviews: 1500 }
    expect(
      pickSerendipitySlots([borderline], profile, improvised).map((p) => p.placeId),
    ).toEqual(['borderline'])
  })
})
