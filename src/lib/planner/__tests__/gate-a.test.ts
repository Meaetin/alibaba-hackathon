/**
 * Gate A — the whole deterministic core driven end-to-end over a hand-written
 * candidate set, with no API keys, no database and no network. See "Gate A" in
 * `docs/implementation-plan.md`.
 *
 * This is the cheapest end-to-end confidence in the project: 86 Kyoto places
 * through cluster → funnel → meal ladder → duration → pack → validate, in
 * milliseconds. Extend this file rather than writing a second one — the point
 * is that ONE run exercises the whole offline half, and the invariant suite
 * judges it.
 *
 * The fixture is deliberately adversarial: two permanently-closed places, two
 * with no coordinates at all, a ¥¥¥¥ kaiseki and a steakhouse, several
 * near-identical ramen shops, and a museum with no rating.
 *
 * It also carries opening hours, assigned by type the way Google reports them:
 * temples and landmarks 09:00–17:00, museums the same but shut on Mondays,
 * restaurants split 11:00–14:30 and 17:00–22:00, cafes 08:00–18:00, bars from
 * 17:00. Thirteen places have none at all — parks, a bamboo grove, a mountain
 * trail, Fushimi Inari's open shrine path, Togetsukyo Bridge, Sannenzaka —
 * because for ungated public space "no hours" is the truth rather than a gap,
 * and the validator has to be able to tell the difference. The gated landmarks
 * keep theirs: Nijo Castle and the Imperial Palace really do sell a last ticket.
 */

import { describe, it, expect } from 'vitest'

import candidates from '../__fixtures__/kyoto-candidates.json'
import type { CandidatePlace, Pace, PreferenceProfile } from '../types'
import { selectMealCandidates } from '../funnel'
import { resolveVisitDuration } from '../duration'
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

/** Five days in Kyoto, vegetarian, mid-budget, arriving on a Tuesday. */
const TRIP = createTrip({
  city: 'Kyoto',
  candidates: candidates as CandidatePlace[],
  days: 5,
  profile: {
    interests: ['temples', 'cafes', 'food'],
    dietary: ['vegetarian'],
    pace: 'balanced',
    budget: 2,
  } satisfies PreferenceProfile,
  weekday: 2,
})

const CANDIDATES = TRIP.candidates
const { runPipeline, packTrip, validateTrip, lockedStops, nameOf } = TRIP
const WEEKDAY = TRIP.weekday

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

// ── the pack leg ─────────────────────────────────────────────────────────────
//
// `straightLineLegs` (the Routes stand-in), `assignDay` (the Pass B stand-in)
// and `packTrip` come from the harness, so Singapore drives the same ones.

describe('Gate A — funnel → assignment → pack', () => {
  it('turns all five Kyoto days into valid timelines', () => {
    const trip = packTrip()
    expect(trip).toHaveLength(TRIP.days)
    for (const { input, day } of trip) assertValidItinerary(day, input)
  })

  it('holds every invariant at every pace, not just the one the fixture uses', () => {
    for (const pace of ['relaxed', 'balanced', 'packed'] as Pace[]) {
      for (const { input, day } of packTrip(pace)) assertValidItinerary(day, input)
    }
  })

  it('builds days a person could actually walk, and never eats a meal it was given', () => {
    const trip = packTrip()
    // Two of the five Kyoto clusters hold no restaurant at all, so the stand-in
    // assigner has no lunch to seat there. That's a fact about the placeholder,
    // not the packer — what has to hold is that a meal the packer *was* handed
    // reaches the timeline, since meals are the last thing it may drop.
    const withLunch = trip.filter(({ input }) => input.assignments.some((a) => a.role === 'lunch'))
    expect(withLunch.length, 'no day has a lunch to test — this assertion went vacuous').toBeGreaterThanOrEqual(3)

    for (const { input, day } of trip) {
      const activities = day.segments.filter((segment) => segment.kind === 'activity')
      expect(activities.length, 'a day with fewer than three stops is not a day').toBeGreaterThanOrEqual(3)

      for (const role of ['lunch', 'dinner'] as const) {
        const assigned = input.assignments.find((a) => a.role === role)
        if (!assigned) continue
        const meal = activities.find((activity) => activity.role === role)
        expect(meal, `${assigned.place.name} was assigned ${role} and never made the day`).toBeDefined()
        // Nobody eats for three hours. If this trips, duration resolution drifted.
        expect(meal!.endMin - meal!.startMin).toBeLessThanOrEqual(150)
      }
    }
  })

  it('every day is fed, or the funnel says plainly why it cannot be', () => {
    const { result } = runPipeline()
    for (const cluster of result.clusters) {
      const eats = cluster.places.filter(isRestaurant).length
      if (eats >= 2) {
        expect(cluster.shortfall, `a cluster with ${eats} restaurants was flagged anyway`).toBeUndefined()
      } else {
        // The reservation can only hand out what retrieval found. When a
        // neighborhood truly has nothing to eat, that is a fact about the
        // candidate set — and it has to arrive as a stated shortfall, not as a
        // day that quietly has no lunch in it.
        expect(cluster.shortfall, `${eats} restaurants and no shortfall recorded`).toBeDefined()
      }
    }
    // …and the reservation has to actually be doing work: most days are fed.
    const fed = result.clusters.filter((c) => !c.shortfall).length
    expect(fed * 2).toBeGreaterThan(result.clusters.length)
  })

  it('spends the day rather than stranding the traveller in it', () => {
    for (const { day } of packTrip()) {
      const minutesIn = (kind: string) =>
        day.segments
          .filter((segment) => segment.kind === kind)
          .reduce((sum, segment) => sum + (segment.endMin - segment.startMin), 0)
      const total = day.segments.at(-1)!.endMin - day.segments[0].startMin
      expect(minutesIn('activity') / total, 'more than half this day is spent waiting').toBeGreaterThan(0.5)
    }
  })

  it('pace changes the trip, and says what it cost', () => {
    const stops = (pace: Pace) =>
      packTrip(pace).reduce(
        (sum, { day }) => sum + day.segments.filter((segment) => segment.kind === 'activity').length,
        0,
      )
    expect(stops('packed')).toBeGreaterThan(stops('relaxed'))
    // Fewer stops means more cuts, and every one of them is named.
    const cuts = packTrip('relaxed').flatMap(({ day }) => day.dropped)
    expect(cuts.length).toBeGreaterThan(0)
    for (const cut of cuts) expect(cut.reason).toMatch(/over budget/i)
  })
})

describe('Gate A — the packed trip itself', () => {
  it('matches the recorded itinerary', () => {
    const trip = packTrip().map(({ day }, index) => ({
      day: index + 1,
      timeline: renderTimeline(day.segments),
      dropped: day.dropped.map((record) => `${record.name} — ${record.reason}`),
    }))
    expect(trip).toMatchSnapshot()
  })
})

// ── the validate leg ─────────────────────────────────────────────────────────


describe('Gate A — pack → validate', () => {
  it('has something to catch: the packer alone schedules Kyoto temples after closing', () => {
    // Day 1 of the recorded itinerary ends "20:15-21:00 activity: Kennin-ji",
    // three hours after the gate shuts. Nothing before Step 8 looks at hours,
    // so this is what a trip is without a validator — and it is why the leg
    // below is not decoration.
    expect(lockedStops(WEEKDAY).length, 'nothing to validate — this whole leg went vacuous').toBeGreaterThan(0)
  })

  it('leaves every stop open during its slot, or names the one it could not place', () => {
    for (const { validation } of validateTrip()) {
      if (validation.ok) {
        assertHoursHonoured(validation.day, validation.input, WEEKDAY)
        continue
      }
      // A failure is allowed. A silent one is not.
      expect(validation.failures.length).toBeGreaterThan(0)
      for (const failure of validation.failures) {
        expect(failure.reason.trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('still hands back days a person could walk', () => {
    for (const { validation } of validateTrip()) {
      // `validation.input` is the repaired assignment, so a swapped-out or
      // dropped place is simply not in it — the suite's scheduled-XOR-dropped
      // check reads the day it actually got, with no special case for who cut what.
      assertValidItinerary(validation.day, validation.input)
    }
  })

  it('repairs from the ranked list and never asks the model to try again', () => {
    let calls = 0
    const assign: AssignClient = { assign: () => ++calls }
    const trip = validateTrip(TRIP.profile.pace, WEEKDAY, assign)
    const repairs = trip.flatMap(({ validation }) => validation.repairs)

    expect(repairs.length, 'no repair happened — this assertion went vacuous').toBeGreaterThan(0)
    expect(calls, 'repair asked Pass B to try again').toBe(0)

    // Every swap-in came from that day's own fallback queue, never from thin air.
    trip.forEach(({ input, validation }, index) => {
      const { result } = runPipeline()
      const offered = new Set(
        alternatesFor(result.clusters[index], input, TRIP.profile.pace).map((a) => a.place.placeId),
      )
      for (const repair of validation.repairs) {
        if (!repair.inserted) continue
        expect(offered.has(repair.inserted.placeId), `${repair.inserted.name} was invented`).toBe(true)
      }
    })
  })

  it('drops a stop only when the list is spent, and says so in the same breath', () => {
    for (const { validation } of validateTrip()) {
      for (const repair of validation.repairs) {
        if (repair.inserted) continue
        expect(repair.role, 'a meal was dropped to make the day validate').not.toMatch(/lunch|dinner/)
        expect(
          validation.day.dropped.map((record) => record.placeId),
          `${repair.removed.name} left the day with no record of it`,
        ).toContain(repair.removed.placeId)
      }
    }
  })

  it('assumes hours only for the places that genuinely have none', () => {
    const assumed = validateTrip().flatMap(({ validation }) => validation.assumed)
    expect(assumed.length, 'nothing was assumed — the fixture lost its hours-free places').toBeGreaterThan(0)
    for (const stop of assumed) {
      const place = CANDIDATES.find((c) => c.placeId === stop.placeId)!
      expect(place.openingPeriods, `${place.name} has hours and was waved through anyway`).toBeUndefined()
    }
  })

  it('a Monday is not a Tuesday — the weekday changes the trip', () => {
    const names = (weekday: Weekday) =>
      validateTrip(TRIP.profile.pace, weekday)
        .flatMap(({ validation }) => validation.day.segments)
        .flatMap((segment) => (segment.kind === 'activity' ? [segment.name] : []))

    // The fixture's museums shut on Mondays. A validator that ignored the
    // weekday would produce the same five days either way.
    expect(names(1)).not.toEqual(names(2))
  })

  it('holds at every pace', () => {
    for (const pace of ['relaxed', 'balanced', 'packed'] as Pace[]) {
      for (const { validation } of validateTrip(pace)) {
        expect(validation.ok).toBe(validation.failures.length === 0)
        if (validation.ok) assertHoursHonoured(validation.day, validation.input, WEEKDAY)
      }
    }
  })
})

describe('Gate A — the validated trip itself', () => {
  it('matches the recorded repairs', () => {
    const trip = validateTrip().map(({ validation }, index) => ({
      day: index + 1,
      ok: validation.ok,
      repairs: validation.repairs.map((repair) =>
        repair.inserted
          ? `${repair.removed.name} -> ${repair.inserted.name} (${repair.reason})`
          : `${repair.removed.name} dropped (${repair.reason})`,
      ),
      failures: validation.failures.map((failure) => `${failure.name}: ${failure.reason}`),
      assumed: validation.assumed.map((stop) => stop.name),
    }))
    expect(trip).toMatchSnapshot()
  })
})
