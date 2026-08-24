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
import type { VisitDuration } from './duration'
import {
  DAY_END_MIN,
  DAY_SKELETON,
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
const overShrinkable = (): PackDayInput => ({
  assignments: [
    assign('temple', 'activity', 0.9, dur(90, 180, 240)),
    assign('tofu_lunch', 'lunch', 0.8, dur(60, 90, 120)),
    assign('museum', 'activity', 0.95, dur(120, 270, 330)),
    assign('izakaya', 'dinner', 0.75, dur(60, 90, 120)),
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
    // No slack anywhere (min === preferred), so shrinking cannot help.
    const input: PackDayInput = {
      assignments: [
        assign('temple', 'activity', 0.9, dur(120)),
        assign('tofu_lunch', 'lunch', 0.8, dur(90)),
        assign('museum', 'activity', 0.95, dur(240)),
        assign('izakaya', 'dinner', 0.75, dur(90)),
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
