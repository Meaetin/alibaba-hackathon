/**
 * Opening-hours arithmetic — the input to invariant 3.
 *
 * Fixtures mirror shapes that actually came back from the Places API in the
 * Singapore probe (`scripts/fetch-singapore-place-details.ts`), which in twenty
 * places produced all three awkward cases: seven periods whose close lands on a
 * different day from their open, one place with no close at all, and one with
 * no periods whatsoever. None of the edge cases below are hypothetical. The
 * probe output itself is gitignored, so the shapes are restated here.
 */

import { describe, it, expect } from 'vitest'

import type { CandidatePlace, OpeningPeriod } from './types'
import { hasKnownHours, isAlwaysOpen, isOpenDuring, type Weekday } from './hours'

const SUN = 0 as Weekday
const MON = 1 as Weekday
const FRI = 5 as Weekday
const SAT = 6 as Weekday

const at = (day: number, hour: number, minute = 0) => ({ day, hour, minute })

const withHours = (periods: OpeningPeriod[] | undefined): Pick<CandidatePlace, 'openingPeriods'> => ({
  openingPeriods: periods,
})

/** `hh:mm` as minutes from midnight, so the tests read like a clock. */
const t = (hour: number, minute = 0) => hour * 60 + minute

describe('the ordinary case', () => {
  // Monday 09:00–17:00 only.
  const museum = withHours([{ open: at(1, 9), close: at(1, 17) }])

  it('is open for a visit that sits inside the window', () => {
    expect(isOpenDuring(museum, MON, t(10), t(11, 30))).toBe(true)
  })

  it('is closed on a day it has no period for', () => {
    expect(isOpenDuring(museum, SUN, t(10), t(11))).toBe(false)
    expect(isOpenDuring(museum, FRI, t(10), t(11))).toBe(false)
  })

  it('reads day 0 as Sunday, following the Places API', () => {
    const sundayOnly = withHours([{ open: at(0, 9), close: at(0, 17) }])
    expect(isOpenDuring(sundayOnly, SUN, t(10), t(11))).toBe(true)
    expect(isOpenDuring(sundayOnly, MON, t(10), t(11))).toBe(false)
  })

  it('needs the WHOLE visit inside the window, not just its start', () => {
    // The bug this exists to prevent: an hour of the visit is spent in a
    // building that locked at 17:00.
    expect(isOpenDuring(museum, MON, t(16, 30), t(18))).toBe(false)
    // …and the mirror, arriving before it opens.
    expect(isOpenDuring(museum, MON, t(8, 30), t(10))).toBe(false)
  })

  it('treats the window edges as open', () => {
    expect(isOpenDuring(museum, MON, t(9), t(17))).toBe(true)
    expect(isOpenDuring(museum, MON, t(9), t(17, 1))).toBe(false)
    expect(isOpenDuring(museum, MON, t(8, 59), t(17))).toBe(false)
  })

  it('closes in the gap between split lunch and dinner service', () => {
    const kaiseki = withHours([
      { open: at(1, 11, 30), close: at(1, 14) },
      { open: at(1, 17, 30), close: at(1, 22) },
    ])
    expect(isOpenDuring(kaiseki, MON, t(12), t(13))).toBe(true)
    expect(isOpenDuring(kaiseki, MON, t(18), t(20))).toBe(true)
    expect(isOpenDuring(kaiseki, MON, t(15), t(16))).toBe(false)
    // Straddling the afternoon break is not "open for both halves".
    expect(isOpenDuring(kaiseki, MON, t(13), t(18))).toBe(false)
  })
})

describe('periods that cross midnight', () => {
  // Friday 18:00 → Saturday 02:00. Seven of these in the twenty-place probe.
  const bar = withHours([{ open: at(5, 18), close: at(6, 2) }])

  it('stays open past midnight into the next day', () => {
    expect(isOpenDuring(bar, FRI, t(23), t(23, 45))).toBe(true)
    expect(isOpenDuring(bar, SAT, t(0, 30), t(1, 30))).toBe(true)
  })

  it('closes once the span ends', () => {
    expect(isOpenDuring(bar, SAT, t(3), t(4))).toBe(false)
    expect(isOpenDuring(bar, FRI, t(17), t(17, 30))).toBe(false)
  })

  it('does not leak into the same clock time on an unrelated day', () => {
    expect(isOpenDuring(bar, MON, t(23), t(23, 30))).toBe(false)
  })

  it('handles a span that wraps the end of the week', () => {
    // Saturday 18:00 → Sunday 02:00: the span sits at the top of the weekly
    // clock, the Sunday query sits at the bottom.
    const saturdayNight = withHours([{ open: at(6, 18), close: at(0, 2) }])
    expect(isOpenDuring(saturdayNight, SAT, t(20), t(22))).toBe(true)
    expect(isOpenDuring(saturdayNight, SUN, t(0, 30), t(1, 30))).toBe(true)
    expect(isOpenDuring(saturdayNight, SUN, t(3), t(4))).toBe(false)
  })
})

describe('always open', () => {
  it('an open with no close is 24/7, per the API contract', () => {
    const trail = withHours([{ open: at(0, 0) }])
    expect(isAlwaysOpen(trail)).toBe(true)
    expect(isOpenDuring(trail, SAT, t(3), t(5))).toBe(true)
    // …and we did get hours for it, so this is a check, not an assumption.
    expect(hasKnownHours(trail)).toBe(true)
  })

  it('missing hours are assumed open — and flagged as an assumption', () => {
    for (const place of [withHours(undefined), withHours([])]) {
      expect(isOpenDuring(place, MON, t(3), t(5))).toBe(true)
      expect(isAlwaysOpen(place)).toBe(true)
      // The assumption stays visible. Without this, invariant 3 passes for a
      // place it never checked and nothing downstream can tell the difference.
      expect(hasKnownHours(place)).toBe(false)
    }
  })
})

describe('malformed input', () => {
  it('skips periods with an out-of-range day, hour or minute', () => {
    const place = withHours([
      { open: at(9, 9), close: at(9, 17) }, // day out of range
      { open: at(1, 9), close: at(1, 17) }, // the real one
    ])
    expect(isOpenDuring(place, MON, t(10), t(11))).toBe(true)
    // The junk period must not have created a window of its own.
    expect(isOpenDuring(place, SUN, t(10), t(11))).toBe(false)
  })

  it('falls back to open when every period is unusable — same as knowing nothing', () => {
    const place = withHours([{ open: at(-1, 9), close: at(1, 99) }])
    expect(isOpenDuring(place, MON, t(10), t(11))).toBe(true)
  })

  it('reads a zero-length period as bad data, not a week of opening', () => {
    const place = withHours([
      { open: at(1, 9), close: at(1, 9) }, // degenerate
      { open: at(1, 13), close: at(1, 17) }, // the real one
    ])
    expect(isOpenDuring(place, MON, t(14), t(15))).toBe(true)
    // Had the degenerate period been read as wrapping to the next week it would
    // cover all seven days, and both of these would come back open.
    expect(isOpenDuring(place, MON, t(10), t(11))).toBe(false)
    expect(isOpenDuring(place, FRI, t(14), t(15))).toBe(false)
  })

  it('counts unusable hours as no hours, so the assumption stays visible', () => {
    // Periods present but none of them usable: we know exactly as much as if
    // the field had been missing, and `hasKnownHours` has to say so — otherwise
    // Step 8 reports an unverified stop as a verified one.
    for (const place of [
      withHours([{ open: at(1, 9), close: at(1, 9) }]),
      withHours([{ open: at(-1, 9), close: at(1, 99) }]),
    ]) {
      expect(hasKnownHours(place)).toBe(false)
      expect(isOpenDuring(place, MON, t(10), t(11))).toBe(true)
    }
  })
})

describe('shapes the packer will hand it', () => {
  it('answers an instant as well as a span', () => {
    const museum = withHours([{ open: at(1, 9), close: at(1, 17) }])
    expect(isOpenDuring(museum, MON, t(12), t(12))).toBe(true)
    expect(isOpenDuring(museum, MON, t(18), t(18))).toBe(false)
  })

  it('covers a full planner day for a place open 09:00–21:00', () => {
    // DAY_START_MIN 540 → DAY_END_MIN 1260, the widest a packed day can be.
    const allDay = withHours([{ open: at(1, 9), close: at(1, 21) }])
    expect(isOpenDuring(allDay, MON, 540, 1260)).toBe(true)
    expect(isOpenDuring(allDay, MON, 540, 1261)).toBe(false)
  })
})
