import { describe, expect, it } from 'vitest'

import { metersBetween } from './geo'
import { STREET_DETOUR_FACTOR, createTravelEstimate } from './travel-estimate'
import type { CandidatePlace } from './types'

/** One degree of latitude, on the sphere `geo.ts` uses. */
const METERS_PER_DEGREE = (6_371_000 * Math.PI) / 180

/** A place `metersNorth` up the same meridian, so a leg's length is an input. */
function placeAt(id: string, metersNorth: number): CandidatePlace {
  return {
    placeId: id,
    name: id,
    types: [],
    latitude: 35 + metersNorth / METERS_PER_DEGREE,
    longitude: 135,
  }
}

const ORIGIN = placeAt('origin', 0)

describe('the distance', () => {
  it('is street metres, not crow-flight ones', () => {
    const to = placeAt('b', 1000)
    const { getTravelLeg } = createTravelEstimate()

    const crow = metersBetween(
      { latitude: ORIGIN.latitude!, longitude: ORIGIN.longitude! },
      { latitude: to.latitude!, longitude: to.longitude! },
    )
    // The whole reason the module exists: Google's routed distance over these
    // legs was a median 1.52x the great-circle one, and the old stand-in
    // reported the great-circle one.
    expect(getTravelLeg(ORIGIN, to).meters).toBe(Math.round(crow * STREET_DETOUR_FACTOR))
    expect(getTravelLeg(ORIGIN, to).meters).toBeGreaterThan(crow)
  })

  it('turns into whole minutes upwards, so no leg promises an early arrival', () => {
    // 750 street metres is 9.375 minutes on foot. Ten, not nine: `pack.ts` then
    // puts it on the five-minute grid, and rounding to nearest here would drop
    // a leg like this one from a fifteen-minute block into a ten-minute one.
    expect(createTravelEstimate().getTravelLeg(ORIGIN, placeAt('b', 500))).toEqual({
      meters: 750,
      minutes: 10,
      mode: 'walk',
    })
  })

  it('is zero for a place with no coordinates, never NaN', () => {
    const nowhere: CandidatePlace = { placeId: 'nowhere', name: 'nowhere', types: [] }
    const leg = createTravelEstimate().getTravelLeg(ORIGIN, nowhere)

    expect(leg.meters).toBe(0)
    expect(leg.minutes).toBe(0)
    expect(Number.isNaN(leg.minutes)).toBe(false)
  })
})

describe('the mode', () => {
  it('walks anything inside the traveller’s own tolerance', () => {
    // 1200 crow metres is 1800 street metres: past the easygoing 1200 m
    // tolerance, and transit does beat it (see the next test). A rugged
    // traveller walks 2000 m, so the same leg stays on foot.
    const to = placeAt('b', 1200)
    const rugged = createTravelEstimate(2000).getTravelLeg(ORIGIN, to)

    expect(rugged.meters).toBe(1800)
    expect(rugged.mode).toBe('walk')
    expect(rugged.minutes).toBe(23)
  })

  it('takes transit past the tolerance, once it is meaningfully faster', () => {
    const to = placeAt('b', 1200)
    const easygoing = createTravelEstimate(1200).getTravelLeg(ORIGIN, to)

    expect(easygoing.mode).toBe('transit')
    // Eight minutes to reach a stop and wait, then 1800 m at 225 m/min.
    expect(easygoing.minutes).toBe(16)
  })

  it('stays on foot past the tolerance while boarding saves less than five minutes', () => {
    // 1500 street metres is well past the 1200 m tolerance, and transit is
    // still quicker on paper — 14.7 minutes against 18.8. Nobody boards for
    // four minutes, so this walks. Deleting the margin makes it transit.
    const leg = createTravelEstimate(1200).getTravelLeg(ORIGIN, placeAt('b', 1000))

    expect(leg.meters).toBe(1500)
    expect(leg.mode).toBe('walk')
    expect(leg.minutes).toBe(19)
  })

  it('crosses over at 1614 street metres and not before', () => {
    const estimate = createTravelEstimate(1200)
    // 1605 m and 1620 m — the margin is met on one side of it and not the other.
    expect(estimate.getTravelLeg(ORIGIN, placeAt('near', 1070)).mode).toBe('walk')
    expect(estimate.getTravelLeg(ORIGIN, placeAt('far', 1080)).mode).toBe('transit')
  })
})

describe('the memo', () => {
  it('answers a repeated pair from cache, which is what lets the packer search', () => {
    const { getTravelLeg, stats } = createTravelEstimate()
    const to = placeAt('b', 400)

    const first = getTravelLeg(ORIGIN, to)
    for (let i = 0; i < 50; i++) getTravelLeg(ORIGIN, to)

    // The identical object, not an equal one: a fresh computation per lookup
    // would still pass a deep-equality check.
    expect(getTravelLeg(ORIGIN, to)).toBe(first)
    expect(stats).toEqual({ walk: 1, transit: 0 })
  })

  it('counts pairs by the mode it chose, in each direction separately', () => {
    const { getTravelLeg, stats } = createTravelEstimate(1200)
    const near = placeAt('near', 300)
    const far = placeAt('far', 2000)

    getTravelLeg(ORIGIN, near)
    getTravelLeg(near, ORIGIN)
    getTravelLeg(ORIGIN, far)

    expect(stats).toEqual({ walk: 2, transit: 1 })
  })
})
