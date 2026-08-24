/**
 * Step 8. Every scenario here is a day that Pass B could plausibly hand back
 * and that nothing upstream would catch: `pack.ts` will stamp times onto a
 * closed temple as happily as an open one.
 *
 * Two rules are load-bearing enough to be asserted directly rather than
 * inferred from behaviour — repair never calls the LLM, and a day with nothing
 * wrong comes back untouched.
 */

import { describe, it, expect } from 'vitest'

import type { CandidatePlace, OpeningPeriod, PreferenceProfile } from './types'
import type { VisitDuration } from './duration'
import type { PackDayInput, SlotRole, TravelLeg, TravelLegProvider } from './pack'
import { packDay } from './pack'
import type { Weekday } from './hours'
import type { Alternate, AssignClient, ValidateDeps } from './validate'
import { MAX_REPAIR_ROUNDS, validateDay } from './validate'

// ── fixtures ─────────────────────────────────────────────────────────────────

const MONDAY: Weekday = 1

/** One `[open, close)` span, in minutes from midnight, on every day of the week. */
function daily(...spans: Array<[number, number]>): OpeningPeriod[] {
  const point = (day: number, minutes: number) => ({
    day,
    hour: Math.floor(minutes / 60),
    minute: minutes % 60,
  })
  return Array.from({ length: 7 }, (_, day) =>
    spans.map(([from, to]) => ({ open: point(day, from), close: point(day, to) })),
  ).flat()
}

const ALL_DAY = daily([9 * 60, 22 * 60])
const TEMPLE_HOURS = daily([9 * 60, 17 * 60])
const AFTERNOON_ONLY = daily([13 * 60, 17 * 60])
const MEAL_SERVICE = daily([11 * 60, 14 * 60 + 30], [17 * 60, 22 * 60])

function place(
  placeId: string,
  types: string[],
  openingPeriods?: OpeningPeriod[],
): CandidatePlace {
  return {
    placeId,
    name: placeId,
    types,
    latitude: 35.0,
    longitude: 135.0,
    rating: 4.5,
    userRatingCount: 800,
    openingPeriods,
  }
}

const SIGHT: VisitDuration = { min: 45, preferred: 60, max: 75 }
const MEAL: VisitDuration = { min: 45, preferred: 60, max: 75 }

const stop = (p: CandidatePlace, role: SlotRole, score = 0.7) => ({
  place: p,
  role,
  score,
  duration: role === 'lunch' || role === 'dinner' ? MEAL : SIGHT,
})

const spare = (p: CandidatePlace, score = 0.6): Alternate => ({
  place: p,
  score,
  duration: p.types.some((t) => t.endsWith('restaurant') || t === 'restaurant') ? MEAL : SIGHT,
})

const NEARBY: TravelLeg = { minutes: 10, meters: 800 }

/** Fixed short legs, with named pairs overridden — that's how a day is broken. */
function legs(overrides: Record<string, TravelLeg> = {}): TravelLegProvider {
  return (from, to) => overrides[`${from.placeId}->${to.placeId}`] ?? NEARBY
}

const PROFILE: PreferenceProfile = { interests: ['temples', 'food'], dietary: [], pace: 'balanced' }

function deps(overrides: Partial<ValidateDeps> = {}): ValidateDeps {
  return {
    pace: 'balanced',
    weekday: MONDAY,
    profile: PROFILE,
    getTravelLeg: legs(),
    alternates: [],
    ...overrides,
  }
}

const scheduled = (result: { day: { segments: Array<{ kind: string }> } }) =>
  result.day.segments
    .filter((segment): segment is typeof segment & { placeId: string } => segment.kind === 'activity')
    .map((segment) => segment.placeId)

/** `ok` is a reading of `failures`, never a separately maintained flag. */
function expectSelfConsistent(result: ReturnType<typeof validateDay>): void {
  expect(result.ok).toBe(result.failures.length === 0)
}

// ── a day with nothing wrong ─────────────────────────────────────────────────

describe('a valid day', () => {
  const input: PackDayInput = {
    assignments: [
      stop(place('temple', ['place_of_worship'], TEMPLE_HOURS), 'activity'),
      stop(place('soba', ['restaurant'], MEAL_SERVICE), 'lunch'),
      stop(place('garden', ['garden'], TEMPLE_HOURS), 'activity'),
    ],
  }

  it('passes through byte-identical — no gratuitous rewriting', () => {
    const result = validateDay(input, deps())

    expect(result.ok).toBe(true)
    expect(result.repairs).toEqual([])
    expect(result.failures).toEqual([])
    // The caller's own object, by reference: a validator that rebuilds an
    // assignment it had no complaint about churns the stored itinerary on
    // every replan, and the churn is indistinguishable from a real change.
    expect(result.input).toBe(input)
    expect(result.day).toEqual(packDay(input, 'balanced', legs()))
    expectSelfConsistent(result)
  })

  it('does not spend an alternate it had no use for', () => {
    const untouched = place('backup', ['place_of_worship'], ALL_DAY)
    const result = validateDay(input, deps({ alternates: [spare(untouched)] }))

    expect(result.repairs).toEqual([])
    expect(scheduled(result)).not.toContain('backup')
  })
})

// ── rule 1: closed during its slot ───────────────────────────────────────────

describe('a place closed during its assigned slot', () => {
  // Pass B put an afternoon-only temple in the 09:00 slot. Nothing upstream
  // looks at hours, so this reaches the timeline intact.
  const shutTemple = place('shut-temple', ['place_of_worship'], AFTERNOON_ONLY)
  const openTemple = place('open-temple', ['place_of_worship'], TEMPLE_HOURS)

  const input: PackDayInput = {
    assignments: [
      stop(shutTemple, 'activity'),
      stop(place('soba', ['restaurant'], MEAL_SERVICE), 'lunch'),
      stop(place('garden', ['garden'], TEMPLE_HOURS), 'activity'),
    ],
  }

  it('is swapped for the next-best open candidate, and the day is then valid', () => {
    const result = validateDay(input, deps({ alternates: [spare(openTemple)] }))

    expect(result.ok).toBe(true)
    expect(scheduled(result)).toContain('open-temple')
    expect(scheduled(result)).not.toContain('shut-temple')
    expect(result.repairs).toHaveLength(1)
    expect(result.repairs[0]).toMatchObject({
      rule: 'closed',
      removed: { placeId: 'shut-temple' },
      inserted: { placeId: 'open-temple' },
    })
    expect(result.repairs[0].reason).toMatch(/closed during its 09:00–/)
    expectSelfConsistent(result)
  })

  it('takes the best-ranked candidate that fits, not the best-ranked candidate', () => {
    // Higher score, but shut at 09:00 too — rank does not excuse a locked door.
    const betterButShut = place('better-but-shut', ['place_of_worship'], AFTERNOON_ONLY)
    const result = validateDay(
      input,
      deps({ alternates: [spare(betterButShut, 0.95), spare(openTemple, 0.5)] }),
    )

    expect(result.ok).toBe(true)
    expect(scheduled(result)).toContain('open-temple')
    expect(scheduled(result)).not.toContain('better-but-shut')
  })

  it('holds the slot the failure was in — a repair is not a reshuffle', () => {
    const result = validateDay(input, deps({ alternates: [spare(openTemple)] }))
    const roles = result.day.segments
      .filter((segment) => segment.kind === 'activity')
      .map((segment) => segment.role)

    expect(roles).toEqual(['activity', 'lunch', 'activity'])
  })
})

// ── rule 2: a meal slot holding something you can't eat in ───────────────────

describe('a meal slot holding a non-restaurant', () => {
  const museum = place('museum', ['museum'], TEMPLE_HOURS)
  const ramen = place('ramen', ['ramen_restaurant'], MEAL_SERVICE)

  const input: PackDayInput = {
    assignments: [
      stop(place('temple', ['place_of_worship'], TEMPLE_HOURS), 'activity'),
      stop(museum, 'lunch'),
      stop(place('garden', ['garden'], TEMPLE_HOURS), 'activity'),
    ],
  }

  it('is repaired from the ranked list', () => {
    const result = validateDay(input, deps({ alternates: [spare(ramen)] }))

    expect(result.ok).toBe(true)
    expect(result.repairs).toHaveLength(1)
    expect(result.repairs[0].rule).toBe('meal_slot')
    expect(result.repairs[0].reason).toMatch(/eat/)
    expect(scheduled(result)).toContain('ramen')
    expectSelfConsistent(result)
  })

  it('will not seat a restaurant that is shut through the whole meal window', () => {
    const dinnerOnly = place('dinner-only', ['restaurant'], daily([17 * 60, 22 * 60]))
    const result = validateDay(input, deps({ alternates: [spare(dinnerOnly)] }))

    expect(result.ok).toBe(false)
    expect(result.failures[0].rule).toBe('meal_slot')
    expect(scheduled(result)).not.toContain('dinner-only')
  })

  it('never repairs a dietary violation into the slot', () => {
    const vegetarian: PreferenceProfile = { ...PROFILE, dietary: ['vegetarian'] }
    const steakhouse = place('steakhouse', ['restaurant', 'steak_house'], MEAL_SERVICE)
    const shojin = place('shojin', ['vegetarian_restaurant'], MEAL_SERVICE)

    // The steakhouse *is* a restaurant, so it clears the first half of the rule
    // and is caught by the second: a vegetarian shown a steakhouse is a system
    // failure, and repair is a place a bad one could be reintroduced.
    const withSteak: PackDayInput = {
      assignments: [...input.assignments.slice(0, 1), stop(steakhouse, 'lunch'), ...input.assignments.slice(2)],
    }
    // The decoy has to be a place the day is not already holding: an alternate
    // that is *in* the day is skipped before eligibility is ever consulted, so
    // offering the same steakhouse back would test nothing.
    const anotherSteakhouse = place('yakiniku', ['restaurant', 'steak_house'], MEAL_SERVICE)
    const result = validateDay(
      withSteak,
      deps({ profile: vegetarian, alternates: [spare(anotherSteakhouse, 0.95), spare(shojin, 0.5)] }),
    )

    expect(result.ok).toBe(true)
    // One swap, not two. `inspect` would catch a steakhouse admitted by mistake
    // on the next round, but only after spending a candidate on it — and
    // running out of candidates is how a repair turns into a failure.
    expect(result.repairs).toHaveLength(1)
    expect(result.repairs[0].reason).toMatch(/dietary conflict: vegetarian/)
    expect(scheduled(result)).toContain('shojin')
    expect(scheduled(result)).not.toContain('steakhouse')
    expect(scheduled(result), 'a higher-ranked steakhouse was repaired in').not.toContain('yakiniku')
  })
})

// ── rule 3: travel that costs the day a meal ─────────────────────────────────

describe('travel time that overruns the window', () => {
  // `pack.ts` cannot return an overrunning day — it shrinks, then drops. So the
  // overrun is observed through what it cost: a dinner ten hours away is a
  // dinner the packer surrenders, and meals are the last thing it gives up.
  const lunch = place('lunch-near', ['restaurant'], MEAL_SERVICE)
  const farDinner = place('dinner-far', ['restaurant'], MEAL_SERVICE)
  const nearDinner = place('dinner-near', ['restaurant'], MEAL_SERVICE)

  const input: PackDayInput = {
    assignments: [
      stop(place('temple', ['place_of_worship'], TEMPLE_HOURS), 'activity'),
      stop(lunch, 'lunch', 0.8),
      stop(farDinner, 'dinner', 0.4),
    ],
  }
  const marooned = legs({ 'lunch-near->dinner-far': { minutes: 600, meters: 90_000 } })

  it('loses the meal before repair, which is the failure worth catching', () => {
    const packed = packDay(input, 'balanced', marooned)
    const dinner = packed.segments.find(
      (segment) => segment.kind === 'activity' && segment.role === 'dinner',
    )

    expect(dinner, 'the packer seated a dinner ten hours away — rebuild this fixture').toBeUndefined()
    expect(packed.dropped.map((record) => record.placeId)).toContain('dinner-far')
  })

  it('is repaired by swapping in a reachable restaurant', () => {
    const result = validateDay(
      input,
      deps({ getTravelLeg: marooned, alternates: [spare(nearDinner)] }),
    )

    expect(result.ok).toBe(true)
    expect(result.repairs).toHaveLength(1)
    expect(result.repairs[0].rule).toBe('lost_meal')
    expect(result.repairs[0].role).toBe('dinner')
    expect(scheduled(result)).toContain('dinner-near')
    expectSelfConsistent(result)
  })

  it('does not treat a dropped activity as a failure — that is pace, not a bug', () => {
    // A day the packer trimmed to fit is a day working as designed, and
    // `pack.ts` already names the cut. Repairing it would undo the pace knob.
    const crowded: PackDayInput = {
      assignments: [
        ...Array.from({ length: 8 }, (_, i) =>
          stop(place(`temple-${i}`, ['place_of_worship'], TEMPLE_HOURS), 'activity'),
        ),
        stop(lunch, 'lunch'),
      ],
    }
    const result = validateDay(crowded, deps({ pace: 'relaxed' }))

    expect(result.day.dropped.length, 'nothing was cut — this assertion went vacuous').toBeGreaterThan(0)
    expect(result.ok).toBe(true)
    expect(result.repairs).toEqual([])
  })
})

// ── the rule that makes repair cheap ─────────────────────────────────────────

describe('repair never calls the LLM', () => {
  it('leaves the assign client untouched across every kind of repair', () => {
    let calls = 0
    const assign: AssignClient = {
      assign: () => {
        calls++
        return null
      },
    }

    const broken: PackDayInput = {
      assignments: [
        stop(place('shut-temple', ['place_of_worship'], AFTERNOON_ONLY), 'activity'),
        stop(place('museum', ['museum'], TEMPLE_HOURS), 'lunch'),
        stop(place('garden', ['garden'], TEMPLE_HOURS), 'activity'),
      ],
    }
    const result = validateDay(
      broken,
      deps({
        assign,
        alternates: [
          spare(place('open-temple', ['place_of_worship'], TEMPLE_HOURS)),
          spare(place('ramen', ['ramen_restaurant'], MEAL_SERVICE)),
        ],
      }),
    )

    expect(result.repairs.length, 'nothing was repaired — this assertion went vacuous').toBe(2)
    expect(calls, 'repair asked the model to try again').toBe(0)
  })

  it('does not call it on the path where repair fails either', () => {
    let calls = 0
    const assign: AssignClient = { assign: () => ++calls }
    const result = validateDay(
      { assignments: [stop(place('dinner-only', ['restaurant'], daily([17 * 60, 22 * 60])), 'lunch')] },
      deps({ assign }),
    )

    expect(result.ok).toBe(false)
    expect(calls).toBe(0)
  })

  it('does not call it when the answer is to drop the stop', () => {
    let calls = 0
    const assign: AssignClient = { assign: () => ++calls }
    const result = validateDay(
      {
        assignments: [
          stop(place('temple', ['place_of_worship'], TEMPLE_HOURS), 'activity'),
          stop(place('shut', ['place_of_worship'], AFTERNOON_ONLY), 'activity'),
        ],
      },
      deps({ assign }),
    )

    expect(result.repairs).toHaveLength(1)
    expect(calls).toBe(0)
  })
})

// ── nothing left to swap in ──────────────────────────────────────────────────

describe('when the ranked list is spent', () => {
  // A restaurant that only opens for dinner, seated in the lunch slot: the
  // packer honours the window and puts it at 11:30, where its door is locked.
  // A meal is the one thing rung 2 may not drop, so this is the case that comes
  // back `ok: false` — the ladder's last rung, and the reason it has one.
  const input: PackDayInput = {
    assignments: [
      stop(place('temple', ['place_of_worship'], TEMPLE_HOURS), 'activity'),
      stop(place('dinner-only', ['restaurant'], daily([17 * 60, 22 * 60])), 'lunch'),
    ],
  }

  it('reports a validation failure with a reason rather than throwing', () => {
    const result = validateDay(input, deps({ alternates: [] }))

    expect(result.ok).toBe(false)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]).toMatchObject({ rule: 'closed', placeId: 'dinner-only', role: 'lunch' })
    expect(result.failures[0].reason.trim().length).toBeGreaterThan(0)
    expectSelfConsistent(result)
  })

  it('returns the day it could not fix rather than nothing at all', () => {
    // The caller needs to see what is wrong, and with what. `ok: false` is the
    // instruction not to store it; an empty result would just look like a crash.
    const result = validateDay(input, deps({ alternates: [] }))

    expect(result.day.segments.length).toBeGreaterThan(0)
    expect(scheduled(result)).toContain('dinner-only')
  })

  it('never drops a meal to make the day validate', () => {
    const result = validateDay(input, deps({ alternates: [] }))

    expect(result.repairs).toEqual([])
    expect(result.day.dropped.map((record) => record.placeId)).not.toContain('dinner-only')
  })

  it('reports the same failure when every alternate is unusable', () => {
    const alsoShut = Array.from({ length: 4 }, (_, i) =>
      spare(place(`also-shut-${i}`, ['restaurant'], daily([17 * 60, 22 * 60]))),
    )
    const result = validateDay(input, deps({ alternates: alsoShut }))

    expect(result.ok).toBe(false)
    expect(result.repairs).toEqual([])
    expect(result.failures[0].placeId).toBe('dinner-only')
  })

  it('stops swapping once the round budget is spent', () => {
    // Every alternate is a restaurant open right through the dinner window, so
    // each one is admitted — and every one of them is ten hours away, so the
    // packer drops it again and the next round finds the same failure. Nothing
    // about the candidates ends this; the round bound does.
    const marooned: Record<string, TravelLeg> = {}
    const faraway = Array.from({ length: MAX_REPAIR_ROUNDS + 6 }, (_, i) => {
      marooned[`lunch-near->far-${i}`] = { minutes: 600, meters: 90_000 }
      return spare(place(`far-${i}`, ['restaurant'], MEAL_SERVICE))
    })
    const unreachable: PackDayInput = {
      assignments: [
        stop(place('lunch-near', ['restaurant'], MEAL_SERVICE), 'lunch', 0.8),
        stop(place('far-seed', ['restaurant'], MEAL_SERVICE), 'dinner', 0.4),
      ],
    }
    marooned['lunch-near->far-seed'] = { minutes: 600, meters: 90_000 }

    const result = validateDay(
      unreachable,
      deps({ getTravelLeg: legs(marooned), alternates: faraway }),
    )

    expect(result.ok).toBe(false)
    expect(result.repairs, 'the bound never engaged — this test went vacuous').toHaveLength(
      MAX_REPAIR_ROUNDS,
    )
    expect(result.failures[0].rule).toBe('lost_meal')
    // …and it stopped because the budget ran out, not because the queue did.
    expect(faraway.length).toBeGreaterThan(result.repairs.length)
  })
})

// ── rung 2: nothing fits, and it isn't a meal ────────────────────────────────

describe('an unfixable activity', () => {
  const shutTemple = place('shut-temple', ['place_of_worship'], AFTERNOON_ONLY)
  const input: PackDayInput = {
    assignments: [
      stop(shutTemple, 'activity'),
      stop(place('soba', ['restaurant'], MEAL_SERVICE), 'lunch'),
      stop(place('garden', ['garden'], TEMPLE_HOURS), 'activity'),
    ],
  }

  it('is dropped rather than shipped locked, and the day is then valid', () => {
    const result = validateDay(input, deps({ alternates: [] }))

    expect(result.ok).toBe(true)
    expect(scheduled(result)).not.toContain('shut-temple')
    expect(result.repairs).toEqual([
      {
        rule: 'closed',
        role: 'activity',
        removed: { placeId: 'shut-temple', name: 'shut-temple' },
        inserted: null,
        reason: expect.stringMatching(/closed during its 09:00–/),
      },
    ])
    expectSelfConsistent(result)
  })

  it('lands in the same dropped list the packer uses, with the same kind of reason', () => {
    // A traveller asking "why isn't Kennin-ji in my day" must not have to know
    // which module removed it.
    const result = validateDay(input, deps({ alternates: [] }))
    const record = result.day.dropped.find((entry) => entry.placeId === 'shut-temple')

    expect(record).toBeDefined()
    expect(record!.reason.trim().length).toBeGreaterThan(0)
  })

  it('is only dropped after the ranked list has been tried', () => {
    const openTemple = place('open-temple', ['place_of_worship'], TEMPLE_HOURS)
    const result = validateDay(input, deps({ alternates: [spare(openTemple)] }))

    expect(result.repairs[0].inserted).toEqual({ placeId: 'open-temple', name: 'open-temple' })
    expect(result.day.dropped.map((entry) => entry.placeId)).not.toContain('shut-temple')
  })

  it('is never repaired with a restaurant — that is not the same bucket', () => {
    // The only thing open at 20:15 is always somewhere to eat. Spending the
    // funnel's restaurant quota on an activity slot puts a ramen shop twenty
    // minutes after dinner and calls the day valid.
    // Open right through the failed 09:00 slot, so the hours check has no
    // opinion on it — the only thing that may turn it away is the bucket.
    const allDayRamen = place('all-day-ramen', ['ramen_restaurant'], ALL_DAY)
    const result = validateDay(input, deps({ alternates: [spare(allDayRamen)] }))

    expect(result.ok).toBe(true)
    expect(scheduled(result)).not.toContain('all-day-ramen')
    expect(result.repairs[0].inserted).toBeNull()
  })
})

// ── hours we don't have are not hours we checked ─────────────────────────────

describe('places with no opening hours', () => {
  it('are passed, and reported as an assumption rather than a check', () => {
    const trail = place('trail', ['hiking_area'])
    const temple = place('temple', ['place_of_worship'], TEMPLE_HOURS)
    const result = validateDay(
      { assignments: [stop(temple, 'activity'), stop(trail, 'activity')] },
      deps(),
    )

    expect(result.ok).toBe(true)
    expect(result.assumed.map((entry) => entry.placeId)).toEqual(['trail'])
  })

  it('are not reported when the hours are real', () => {
    const result = validateDay(
      { assignments: [stop(place('temple', ['place_of_worship'], TEMPLE_HOURS), 'activity')] },
      deps(),
    )

    expect(result.assumed).toEqual([])
  })
})

// ── the weekday is an input, never ambient ───────────────────────────────────

describe('the weekday', () => {
  it('decides the day: the same trip is not the same trip on a Monday', () => {
    const mondayShut = place(
      'mon-shut',
      ['museum'],
      daily([9 * 60, 17 * 60]).filter((period) => period.open.day !== 1),
    )
    const input: PackDayInput = {
      assignments: [
        stop(place('temple', ['place_of_worship'], TEMPLE_HOURS), 'activity'),
        stop(mondayShut, 'activity'),
      ],
    }

    const monday = validateDay(input, deps({ weekday: 1 }))
    const tuesday = validateDay(input, deps({ weekday: 2 }))

    expect(scheduled(tuesday)).toContain('mon-shut')
    expect(tuesday.repairs).toEqual([])
    expect(scheduled(monday)).not.toContain('mon-shut')
    expect(monday.day.dropped.map((record) => record.placeId)).toContain('mon-shut')
  })

  it('is the difference between a failure and a clean day when the slot is a meal', () => {
    const mondayShut = place(
      'mon-shut-kitchen',
      ['restaurant'],
      MEAL_SERVICE.filter((period) => period.open.day !== 1),
    )
    const input: PackDayInput = { assignments: [stop(mondayShut, 'lunch')] }

    expect(validateDay(input, deps({ weekday: 1 })).ok).toBe(false)
    expect(validateDay(input, deps({ weekday: 2 })).ok).toBe(true)
  })
})
