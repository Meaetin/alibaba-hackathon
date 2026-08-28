/**
 * Step 7 — the elastic-slot packer. See "Elastic Slots" in
 * `docs/personalization-pipeline.md` and Step 7 in `docs/implementation-plan.md`.
 *
 * Everything here is deterministic: travel times come from a fake matrix, the
 * clock is minutes-from-midnight integers, and there is no randomness. The
 * over-budget tests are four separate tests because the degradation ORDER is
 * the spec — "it fits" passing while the order is wrong is exactly the bug
 * that produces "why isn't teamLab in my trip?".
 */

import { describe, it, expect } from 'vitest'

import type { CandidatePlace, Pace } from './types'
import { VISIT_STEP_MINUTES, type VisitDuration } from './duration'
import {
  DAY_END_MIN,
  DAY_SKELETON,
  MEAL_MAX_MINUTES,
  PACE_PLANS,
  WALK_MAX_METERS,
  packDay,
  travelModeForMeters,
  type PackDayInput,
  type PackedDay,
  type SlotRole,
  type TravelLegProvider,
} from './pack'

// ── fixture helpers ──────────────────────────────────────────────────────────

const place = (name: string, types: string[] = ['tourist_attraction']): CandidatePlace => ({
  placeId: `ChIJ_${name}`,
  name,
  types,
})

const dur = (min: number, preferred = min, max = preferred): VisitDuration => ({
  min,
  preferred,
  max,
})

const assign = (
  name: string,
  role: SlotRole,
  score: number,
  duration: VisitDuration,
  types?: string[],
) => ({
  place: place(name, types ?? (role === 'lunch' || role === 'dinner' ? ['restaurant'] : undefined)),
  role,
  score,
  duration,
})

const flex = (name: string, score: number, duration: VisitDuration) => ({
  place: place(name),
  score,
  duration,
})

/** Fake travel matrix: one default leg, per-pair overrides keyed "from->to". */
const travel =
  (
    minutes: number,
    meters: number,
    overrides: Record<string, { minutes: number; meters: number }> = {},
  ): TravelLegProvider =>
  (from, to) =>
    overrides[`${from.placeId}->${to.placeId}`] ?? { minutes, meters }

const NO_TRAVEL = travel(0, 0)

const activities = (day: PackedDay) => day.segments.filter((s) => s.kind === 'activity')
const travels = (day: PackedDay) => day.segments.filter((s) => s.kind === 'travel')
const segmentFor = (day: PackedDay, name: string) =>
  activities(day).find((s) => s.placeId === `ChIJ_${name}`)
const lengthOf = (s: { startMin: number; endMin: number }) => s.endMin - s.startMin
const droppedIds = (day: PackedDay) => day.dropped.map((d) => d.placeId)

/**
 * Every boundary in the day sits on the step grid.
 *
 * This is what "9:00 AM – 9:43 AM" was: 43 minutes was never anyone's estimate
 * of Merlion Park, it was a 40-minute floor plus the three spare minutes the
 * wall clock had left over after the growth pass.
 *
 * Three things hold the grid, and mutating any one of them turns these red:
 * quantized durations, travel legs rounded up, and a squeeze that surrenders
 * whole steps. The growth pass stepping by five is **not** one of them — with
 * the other three in place the room a stop can grow into is already a multiple
 * of the step, so growing by single minutes reaches the same answer. That line
 * is a speed win and this test deliberately does not claim otherwise.
 */
function expectOnStepGrid(day: PackedDay) {
  for (const s of day.segments) {
    expect(s.startMin % VISIT_STEP_MINUTES, `${s.kind} starts off-grid at ${s.startMin}`).toBe(0)
    expect(s.endMin % VISIT_STEP_MINUTES, `${s.kind} ends off-grid at ${s.endMin}`).toBe(0)
  }
}

function expectContiguous(day: PackedDay) {
  for (const s of day.segments) {
    expect(s.endMin, `zero or negative-length segment at ${s.startMin}`).toBeGreaterThan(s.startMin)
  }
  for (let i = 0; i + 1 < day.segments.length; i++) {
    expect(day.segments[i].endMin, `gap or overlap after segment ${i}`).toBe(
      day.segments[i + 1].startMin,
    )
  }
}

/** A four-stop day that fits comfortably at every pace. */
const typicalDay = (): PackDayInput => ({
  assignments: [
    assign('temple', 'activity', 0.9, dur(60, 90, 120)),
    assign('tofu_lunch', 'lunch', 0.8, dur(45, 60, 90)),
    assign('museum', 'activity', 0.85, dur(60, 90, 135)),
    assign('izakaya', 'dinner', 0.75, dur(60, 75, 90)),
  ],
})

/** Over budget at preferred sizes, but shrinking alone brings it home. */
// The pressure has to come from the activities. Meals are capped at
// `MEAL_MAX_MINUTES` now, so a fixture that overloaded the day with two
// two-hour lunches gets those ninety minutes handed straight back and the
// museum never needs to shrink — which is the cap working, not the packer
// failing.
const overShrinkable = (): PackDayInput => ({
  assignments: [
    assign('temple', 'activity', 0.9, dur(105, 210, 280)),
    assign('tofu_lunch', 'lunch', 0.8, dur(45, 70, 75)),
    assign('museum', 'activity', 0.95, dur(120, 270, 330)),
    assign('izakaya', 'dinner', 0.75, dur(45, 70, 75)),
  ],
  flex: [flex('gallery', 0.55, dur(30, 60, 90))],
})

// ── structure ────────────────────────────────────────────────────────────────

describe('timeline structure', () => {
  it('emits a contiguous timeline — no gaps, no overlaps — at every pace', () => {
    for (const pace of ['relaxed', 'balanced', 'packed'] as Pace[]) {
      expectContiguous(packDay(typicalDay(), pace, NO_TRAVEL))
      expectContiguous(packDay(typicalDay(), pace, travel(12, 900)))
    }
    expectContiguous(packDay(overShrinkable(), 'balanced', NO_TRAVEL))
  })

  it('numbers stops by position, in the order it was handed them', () => {
    const day = packDay(typicalDay(), 'balanced', NO_TRAVEL)
    expect(activities(day).map((s) => s.position)).toEqual([1, 2, 3, 4])
    expect(activities(day).map((s) => s.placeId)).toEqual(
      typicalDay().assignments.map((a) => a.place.placeId),
    )
  })

  it('never schedules a place it was not given', () => {
    const input = overShrinkable()
    const given = new Set([
      ...input.assignments.map((a) => a.place.placeId),
      ...(input.flex ?? []).map((f) => f.place.placeId),
    ])
    for (const seg of activities(packDay(input, 'balanced', NO_TRAVEL))) {
      expect(given.has(seg.placeId), `${seg.placeId} appeared from nowhere`).toBe(true)
    }
  })

  it('puts exactly one travel segment between consecutive activities, never at the edges', () => {
    const day = packDay(typicalDay(), 'balanced', travel(10, 800))
    expect(day.segments[0].kind).toBe('activity')
    expect(day.segments.at(-1)!.kind).not.toBe('travel')

    const between: number[] = []
    let count = 0
    let seen = false
    for (const seg of day.segments) {
      if (seg.kind === 'activity') {
        if (seen) between.push(count)
        count = 0
        seen = true
      } else if (seg.kind === 'travel') {
        count++
      }
    }
    expect(between).toEqual(between.map(() => 1))
    expect(between.length).toBe(activities(day).length - 1)
  })
})

// ── anchors ──────────────────────────────────────────────────────────────────

describe('meal and long-visit anchors', () => {
  it('lands lunch inside [690, 810] regardless of what precedes it', () => {
    const nothingBefore: PackDayInput = {
      assignments: [
        assign('tofu_lunch', 'lunch', 0.8, dur(60)),
        assign('izakaya', 'dinner', 0.7, dur(60)),
      ],
    }
    const overlongMorning: PackDayInput = {
      assignments: [
        assign('mega_market', 'activity', 0.9, dur(180, 300, 300)),
        assign('tofu_lunch', 'lunch', 0.8, dur(60)),
        assign('izakaya', 'dinner', 0.7, dur(60)),
      ],
    }
    for (const input of [typicalDay(), nothingBefore, overlongMorning]) {
      const lunch = segmentFor(packDay(input, 'balanced', NO_TRAVEL), 'tofu_lunch')!
      expect(lunch.startMin).toBeGreaterThanOrEqual(690)
      expect(lunch.startMin).toBeLessThanOrEqual(810)
    }
  })

  it('lands dinner inside [1080, 1200]', () => {
    const dinner = segmentFor(packDay(typicalDay(), 'balanced', NO_TRAVEL), 'izakaya')!
    expect(dinner.startMin).toBeGreaterThanOrEqual(1080)
    expect(dinner.startMin).toBeLessThanOrEqual(1200)
  })

  it('promotes a >180-minute visit to an anchor and shrinks the day around it', () => {
    const input: PackDayInput = {
      assignments: [
        assign('garden', 'activity', 0.9, dur(60, 120, 150)),
        assign('tofu_lunch', 'lunch', 0.8, dur(60)),
        assign('teamlab', 'activity', 0.7, dur(180, 200, 220)),
        assign('izakaya', 'dinner', 0.75, dur(60)),
        assign('night_walk', 'activity', 0.6, dur(60, 120, 150)),
      ],
    }
    const day = packDay(input, 'balanced', NO_TRAVEL)
    // The anchor owns its block at full preferred size…
    expect(lengthOf(segmentFor(day, 'teamlab')!)).toBe(200)
    // …the elastic activities around it gave up the minutes instead…
    const shrunk = activities(day).filter(
      (s) => s.placeId !== 'ChIJ_teamlab' && lengthOf(s) < 120 && !s.role.match(/lunch|dinner/),
    )
    expect(shrunk.length).toBeGreaterThan(0)
    // …and nothing had to be dropped.
    expect(day.dropped).toEqual([])
  })
})

// ── travel mode ──────────────────────────────────────────────────────────────

describe('travel mode', () => {
  it('walks under 1.2 km; at exactly 1.2 km and beyond it takes transit', () => {
    expect(travelModeForMeters(WALK_MAX_METERS - 1)).toBe('walk')
    expect(travelModeForMeters(WALK_MAX_METERS)).toBe('transit')

    const legs = travel(10, 800, {
      'ChIJ_temple->ChIJ_tofu_lunch': { minutes: 14, meters: 1199 },
      'ChIJ_tofu_lunch->ChIJ_museum': { minutes: 18, meters: 1200 },
    })
    const t = travels(packDay(typicalDay(), 'balanced', legs))
    expect(t[0].mode).toBe('walk')
    expect(t[1].mode).toBe('transit')
  })
})

// ── over budget: the degradation ORDER is the spec ───────────────────────────

describe('over budget', () => {
  it('shrinks durations toward min first — flex picks are still present', () => {
    const day = packDay(overShrinkable(), 'balanced', NO_TRAVEL)
    const museum = segmentFor(day, 'museum')!
    expect(lengthOf(museum)).toBeLessThan(270)
    expect(lengthOf(museum)).toBeGreaterThanOrEqual(120)
    expect(segmentFor(day, 'gallery'), 'the flex pick was sacrificed before shrinking').toBeDefined()
    expect(day.dropped).toEqual([])
  })

  it('drops flex picks next — real assignments untouched', () => {
    // No slack anywhere (min === preferred), so shrinking cannot help. Meals
    // sit exactly at `MEAL_MAX_MINUTES` so the cap has nothing to give back —
    // the thirty minutes they used to carry are in the museum instead, which
    // keeps the day's total, and so the test's premise, unchanged.
    const input: PackDayInput = {
      assignments: [
        assign('temple', 'activity', 0.9, dur(120)),
        assign('tofu_lunch', 'lunch', 0.8, dur(75)),
        assign('museum', 'activity', 0.95, dur(270)),
        assign('izakaya', 'dinner', 0.75, dur(75)),
        assign('night_walk', 'activity', 0.8, dur(60)),
      ],
      flex: [flex('gallery', 0.55, dur(60))],
    }
    const day = packDay(input, 'packed', NO_TRAVEL)
    expect(droppedIds(day)).toEqual(['ChIJ_gallery'])
    expect(day.dropped[0].reason).toMatch(/over budget/i)
    for (const a of input.assignments) {
      expect(segmentFor(day, a.place.name), `${a.place.name} should have survived`).toBeDefined()
    }
  })

  it('floors the lowest-scored activity before ever dropping it', () => {
    const input: PackDayInput = {
      assignments: [
        assign('temple', 'activity', 0.9, dur(120)),
        assign('tofu_lunch', 'lunch', 0.8, dur(60)),
        assign('museum', 'activity', 0.95, dur(240)),
        assign('izakaya', 'dinner', 0.75, dur(60)),
        assign('night_walk', 'activity', 0.4, dur(60, 120, 150)),
      ],
    }
    const day = packDay(input, 'balanced', NO_TRAVEL)
    const walk = segmentFor(day, 'night_walk')!
    expect(lengthOf(walk)).toBeLessThan(120)
    expect(lengthOf(walk)).toBeGreaterThanOrEqual(60)
    expect(day.dropped).toEqual([])
  })

  it('drops the lowest-scored activity last — the highest-scored survives', () => {
    const input: PackDayInput = {
      assignments: [
        assign('temple', 'activity', 0.9, dur(120)),
        assign('tofu_lunch', 'lunch', 0.8, dur(60)),
        assign('museum', 'activity', 0.95, dur(240)),
        assign('izakaya', 'dinner', 0.75, dur(60)),
        // Not enough slack to shrink home — it has to go.
        assign('night_walk', 'activity', 0.4, dur(110, 120, 130)),
      ],
    }
    const day = packDay(input, 'balanced', NO_TRAVEL)
    expect(droppedIds(day)).toEqual(['ChIJ_night_walk'])
    expect(day.dropped[0].reason).toMatch(/over budget/i)
    expect(segmentFor(day, 'museum'), 'the highest-scored activity must survive').toBeDefined()
    expect(segmentFor(day, 'temple')).toBeDefined()
  })
})

// ── under budget ─────────────────────────────────────────────────────────────

describe('a meal that missed its window', () => {
  /**
   * Nothing has slack, so the shrink ladder cannot help and the packer must
   * drop. Lunch cannot start until 14:00 because of the one stop in front of
   * it; the cheap gallery sits after lunch and is the lowest-scored thing in
   * the day.
   */
  const lateLunch = (): PackDayInput => ({
    assignments: [
      assign('long_morning', 'activity', 0.9, dur(300, 300, 300)),
      assign('tofu_lunch', 'lunch', 0.8, dur(45, 45, 45)),
      assign('cheap_gallery', 'activity', 0.1, dur(30, 30, 30)),
      assign('izakaya', 'dinner', 0.75, dur(60, 60, 60)),
    ],
  })

  it('drops the stop in front of the meal, not the cheapest one behind it', () => {
    const day = packDay(lateLunch(), 'balanced', NO_TRAVEL)

    // Only `long_morning` can move lunch earlier. Dropping the gallery costs a
    // stop and leaves lunch exactly as late as it was, which is how one missed
    // window used to cost a whole afternoon.
    expect(droppedIds(day)).toEqual(['ChIJ_long_morning'])
    expect(segmentFor(day, 'cheap_gallery')).toBeDefined()
    expect(segmentFor(day, 'tofu_lunch')!.startMin).toBeLessThanOrEqual(DAY_SKELETON[0].window[1])
    expectContiguous(day)
  })

  it('still drops by score when the day runs long and nothing waited', () => {
    // Every stop is reached after its window has already opened, so no stop
    // absorbed any slack and there is nothing to narrow blame to. The ordinary
    // worst-first rule stands, and one cut is enough.
    //
    // This test was written asserting the same thing about a day whose dinner
    // *did* miss its window — so it exercised the `blockedBefore` path while
    // its comment claimed the opposite, and would have passed whatever the
    // overrun rule said. The fifteen-minute pace buffer on each leg is what
    // made the difference invisible.
    const day = packDay(
      {
        assignments: [
          assign('temple', 'activity', 0.9, dur(200, 200, 200)),
          assign('tofu_lunch', 'lunch', 0.8, dur(45, 45, 45)),
          assign('cheap_gallery', 'activity', 0.1, dur(150, 150, 150)),
          assign('museum', 'activity', 0.95, dur(150, 150, 150)),
          assign('izakaya', 'dinner', 0.75, dur(60, 60, 60)),
          assign('night_walk', 'activity', 0.5, dur(60, 60, 60)),
        ],
      },
      'balanced',
      NO_TRAVEL,
    )
    expect(droppedIds(day)).toEqual(['ChIJ_cheap_gallery'])
    expect(segmentFor(day, 'museum')).toBeDefined()
    expect(segmentFor(day, 'night_walk')).toBeDefined()
    expectContiguous(day)
  })

  /**
   * The mirror of a late lunch, and the reason `overrunFrom` exists.
   *
   * Lunch and dinner both wait for their windows here, so every minute the
   * morning gives up is a minute the day idles away instead. Only the two bars
   * behind dinner can move the end of the day — and they are the two
   * best-scored activities, so a worst-first cut over the whole day reaches
   * them last, after it has shed the entire morning for nothing.
   *
   * Measured on a live Singapore trip for a cafés-and-nightlife persona: nine
   * offered, two shipped, and the only stop whose removal helped was the last
   * one dropped. Every duration is fixed so the shrink ladder cannot dilute it.
   */
  it('drops from behind the anchor that waited, not the morning in front of it', () => {
    const day = packDay(
      {
        assignments: [
          assign('coffee_1', 'activity', 0.62, dur(45, 45, 45)),
          assign('coffee_2', 'activity', 0.64, dur(45, 45, 45)),
          assign('hawker_lunch', 'lunch', 0.68, dur(75, 75, 75)),
          assign('bakery_bun', 'activity', 0.6, dur(30, 30, 30)),
          assign('cocktail_dinner', 'dinner', 0.79, dur(75, 75, 75)),
          assign('rooftop_bar', 'activity', 0.76, dur(60, 60, 60)),
          assign('nightcap_bar', 'activity', 0.74, dur(60, 60, 60)),
        ],
      },
      'balanced',
      NO_TRAVEL,
    )

    // One cut, and it is the stop that was actually keeping the day open.
    expect(droppedIds(day)).toEqual(['ChIJ_nightcap_bar'])
    for (const name of ['coffee_1', 'coffee_2', 'bakery_bun', 'rooftop_bar']) {
      expect(segmentFor(day, name), `${name} cannot move the end of the day`).toBeDefined()
    }
    expect(segmentFor(day, 'hawker_lunch')!.startMin).toBe(DAY_SKELETON[0].window[0])
    expectContiguous(day)
  })
})

describe('under budget', () => {
  it('stretches durations toward max first', () => {
    const day = packDay(typicalDay(), 'balanced', NO_TRAVEL)
    expect(lengthOf(segmentFor(day, 'temple')!)).toBe(120) // max, not preferred 90
    expect(lengthOf(segmentFor(day, 'museum')!)).toBe(135)
  })

  it('promotes a flex pick when the budget allows', () => {
    const input: PackDayInput = { ...typicalDay(), flex: [flex('gallery', 0.6, dur(30, 45, 60))] }
    const day = packDay(input, 'balanced', NO_TRAVEL)
    expect(segmentFor(day, 'gallery')).toBeDefined()
    expect(day.dropped).toEqual([])
  })

  it('converts idle time in the cafe window into a cafe break', () => {
    const day = packDay(typicalDay(), 'balanced', NO_TRAVEL)
    const cafe = day.segments.find((s) => s.kind === 'break' && s.reason === 'cafe')
    const [w0, w1] = DAY_SKELETON.find((s) => s.role === 'cafe_break')!.window
    expect(cafe, 'an under-budget afternoon should grow a cafe break').toBeDefined()
    expect(cafe!.startMin).toBeGreaterThanOrEqual(w0)
    expect(cafe!.endMin).toBeLessThanOrEqual(w1)
    expectContiguous(day)
  })
})

// ── the dropped list ─────────────────────────────────────────────────────────

describe('the dropped list', () => {
  it('accounts for every input place: scheduled or dropped with a reason, never both', () => {
    const input: PackDayInput = {
      assignments: [
        assign('m1', 'activity', 0.9, dur(60)),
        assign('tofu_lunch', 'lunch', 0.8, dur(60)),
        assign('a1', 'activity', 0.8, dur(60)),
        assign('a2', 'activity', 0.7, dur(60)),
        assign('izakaya', 'dinner', 0.75, dur(60)),
        assign('e1', 'activity', 0.6, dur(60)),
      ],
      flex: [flex('gallery', 0.5, dur(45))],
    }
    for (const pace of ['relaxed', 'balanced', 'packed'] as Pace[]) {
      const day = packDay(input, pace, NO_TRAVEL)
      const scheduled = new Set(activities(day).map((s) => s.placeId))
      const dropped = new Set(droppedIds(day))
      for (const p of [...input.assignments.map((a) => a.place), ...input.flex!.map((f) => f.place)]) {
        const inDay = scheduled.has(p.placeId)
        const out = dropped.has(p.placeId)
        expect(inDay !== out, `${p.name} must be scheduled XOR dropped (got ${inDay}/${out})`).toBe(true)
      }
      for (const d of day.dropped) expect(d.reason.trim().length).toBeGreaterThan(0)
    }
  })
})

// ── pace ─────────────────────────────────────────────────────────────────────

describe('pace', () => {
  const sixStops = (): PackDayInput => ({
    assignments: [
      assign('m1', 'activity', 0.9, dur(60)),
      assign('tofu_lunch', 'lunch', 0.8, dur(60)),
      assign('a1', 'activity', 0.8, dur(60)),
      assign('a2', 'activity', 0.7, dur(60)),
      assign('izakaya', 'dinner', 0.75, dur(60)),
      assign('e1', 'activity', 0.6, dur(60)),
    ],
  })

  it('packed produces more activity segments than relaxed on identical input', () => {
    const packed = packDay(sixStops(), 'packed', NO_TRAVEL)
    const relaxed = packDay(sixStops(), 'relaxed', NO_TRAVEL)
    expect(activities(packed).length).toBeGreaterThan(activities(relaxed).length)
    // …and relaxed still names every cut it made.
    expect(relaxed.dropped.length).toBeGreaterThan(0)
    for (const cut of relaxed.dropped) expect(cut.reason).toMatch(/over budget/i)
  })

  it('relaxed stops earlier: nothing runs past its 20:00 day end', () => {
    const day = packDay(sixStops(), 'relaxed', NO_TRAVEL)
    expect(PACE_PLANS.relaxed.dayEndMin).toBeLessThan(DAY_END_MIN)
    expect(day.segments.at(-1)!.endMin).toBeLessThanOrEqual(PACE_PLANS.relaxed.dayEndMin)
  })

  it('cuts nothing while the clock still has room', () => {
    // Six short stops fit a packed day's clock with time to spare. A day that
    // drops one anyway is the "three temples, done by 13:28" bug — a stop cut
    // by a counter rather than by the day actually being full.
    const day = packDay(sixStops(), 'packed', NO_TRAVEL)
    expect(activities(day)).toHaveLength(6)
    expect(day.dropped).toEqual([])
  })

  it('buffers between activities follow the pace plan: 25 / 15 / 10', () => {
    const input = (): PackDayInput => ({
      assignments: [
        assign('m1', 'activity', 0.9, dur(60)),
        assign('m2', 'activity', 0.8, dur(60)),
        assign('tofu_lunch', 'lunch', 0.7, dur(60)),
        assign('izakaya', 'dinner', 0.6, dur(60)),
      ],
    })
    for (const pace of ['relaxed', 'balanced', 'packed'] as Pace[]) {
      const day = packDay(input(), pace, NO_TRAVEL)
      const firstLeg = travels(day)[0]
      expect(lengthOf(firstLeg), `${pace} buffer`).toBe(PACE_PLANS[pace].bufferMin)
    }
  })
})

describe('the step grid', () => {
  // Odd travel legs and odd durations on purpose: the inputs here are exactly
  // the shapes that used to leak a stray minute into the clock.
  const awkward = (): PackDayInput => ({
    assignments: [
      assign('temple', 'activity', 0.9, dur(43, 61, 97)),
      assign('tofu_lunch', 'lunch', 0.8, dur(37, 64, 91)),
      assign('museum', 'activity', 0.85, dur(58, 77, 133)),
      assign('izakaya', 'dinner', 0.75, dur(52, 73, 88)),
    ],
    flex: [flex('gallery', 0.55, dur(29, 43, 71))],
  })

  it.each(['relaxed', 'balanced', 'packed'] as const)(
    'stamps every start and end on a five-minute mark at %s pace',
    (pace) => {
      const day = packDay(awkward(), pace, travel(13, 1035))
      expectOnStepGrid(day)
      expectContiguous(day)
    },
  )

  it('rounds a travel leg up, never down', () => {
    // Erring long is the only safe direction: a schedule that has you arriving
    // before the route allows costs the stop it promised.
    const day = packDay(typicalDay(), 'balanced', travel(13, 1035))
    const leg = travels(day)[0]
    // 13 minutes rounds to 15, plus balanced's 15-minute buffer.
    expect(lengthOf(leg)).toBe(30)
  })

  it('keeps a leg that is already on the grid exactly as long as it was', () => {
    const day = packDay(typicalDay(), 'balanced', travel(10, 800))
    expect(lengthOf(travels(day)[0])).toBe(25) // 10 + 15
  })

  it('still fits and still drops on the grid when the day is over budget', () => {
    const day = packDay(overShrinkable(), 'balanced', travel(18, 1400))
    expectOnStepGrid(day)
    expectContiguous(day)
  })
})

describe('a meal is capped, not elastic upwards', () => {
  // The live failure: a restaurant whose stay_duration said 135 minutes was
  // planned at its ceiling and a Singapore day stamped lunch 11:30–14:55.
  const withLongLunch = (): PackDayInput => ({
    assignments: [
      assign('temple', 'activity', 0.9, dur(60, 60, 60)),
      assign('long_lunch', 'lunch', 0.8, dur(90, 160, 205)),
    ],
  })

  it('holds a meal to MEAL_MAX_MINUTES when no persona says otherwise', () => {
    const day = packDay(withLongLunch(), 'relaxed', NO_TRAVEL)
    expect(lengthOf(segmentFor(day, 'long_lunch')!)).toBeLessThanOrEqual(MEAL_MAX_MINUTES)
  })

  it('lets the persona move the ceiling in both directions', () => {
    const knobs = (mealMinutes: number) => ({
      visitDurationBias: 'max' as const,
      walkMaxMeters: 1200,
      mealMinutes,
    })
    const group = packDay(withLongLunch(), 'relaxed', NO_TRAVEL, knobs(95))
    const solo = packDay(withLongLunch(), 'relaxed', NO_TRAVEL, knobs(60))
    expect(lengthOf(segmentFor(group, 'long_lunch')!)).toBeLessThanOrEqual(95)
    expect(lengthOf(segmentFor(solo, 'long_lunch')!)).toBeLessThanOrEqual(60)
    expect(lengthOf(segmentFor(group, 'long_lunch')!)).toBeGreaterThan(
      lengthOf(segmentFor(solo, 'long_lunch')!),
    )
  })

  it('caps only meals — an activity of the same length is untouched', () => {
    const input: PackDayInput = {
      assignments: [assign('gallery', 'activity', 0.9, dur(90, 160, 205))],
    }
    const day = packDay(input, 'relaxed', NO_TRAVEL)
    expect(lengthOf(segmentFor(day, 'gallery')!)).toBeGreaterThan(MEAL_MAX_MINUTES)
  })

  it('keeps min at or below the new ceiling', () => {
    // A range whose floor sits above the cap would leave the packer squeezing
    // against bounds that contradict each other — worse than the long lunch.
    const input: PackDayInput = {
      assignments: [assign('banquet', 'lunch', 0.8, dur(180, 200, 240))],
    }
    const day = packDay(input, 'relaxed', NO_TRAVEL)
    expect(lengthOf(segmentFor(day, 'banquet')!)).toBeLessThanOrEqual(MEAL_MAX_MINUTES)
  })
})
