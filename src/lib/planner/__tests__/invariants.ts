/**
 * The cross-cutting invariant suite — the guarantees that must hold no matter
 * how any single module is refactored. See "Cross-cutting: the invariant suite"
 * in `docs/implementation-plan.md`.
 *
 * These are worth more than any individual module's tests, because they don't
 * encode *how* the pipeline works, only what it may never do. Call them from
 * every level: the Gate A fixture run, the route handlers (Step 15), and the
 * golden end-to-end (Step 17).
 *
 *   1. No two segments in a day overlap; the day is contiguous   → Step 7
 *   2. Every meal slot holds a restaurant type                   → Step 7
 *   3. Every place is open during its assigned window            → Step 8
 *   4. No day exceeds its minute budget                          → Step 7
 *   5. Every place_id in the output was in the retrieved set     ✔ below
 *   6. No dietary violation at rung 1 or 2; a caveat at rung 3   ✔ below
 *   7. Every activity has non-empty match_reasons                ✔ below
 *   8. Every dropped candidate has a recorded reason             ✔ below
 *
 * 3 landed with Step 8 and lives in `assertHoursHonoured`, apart from the rest
 * because it needs the **weekday** and a packed day does not carry one. Nothing
 * in the planner does: `start_date` sits on `GenerateItineraryParams` and stops
 * at the API seam, so until Step 15 threads it through, the weekday is a
 * parameter every caller supplies — injected the way `rng` and `now` are.
 *
 * The other half of what 3 needs is real hours on the candidates. Retrieval
 * already requests `openingPeriods` in its field mask, and the Kyoto fixture
 * now carries them; a candidate set without them makes this assertion vacuous
 * rather than false, which is why `assumed` exists to say so out loud.
 */

import { expect } from 'vitest'

import type { CandidatePlace, PreferenceProfile } from '../types'
import type { FunnelResult, MealSelection } from '../funnel'
import type { PackDayInput, PackedDay } from '../pack'
import { DAY_END_MIN, DAY_START_MIN, isMealRole, slotWindow } from '../pack'
import type { Weekday } from '../hours'
import { hasKnownHours, isOpenDuring } from '../hours'
import { hardFilterReason } from '../score'
import { isRestaurant } from '../taxonomy'

/**
 * Everything the funnel guarantees about a shortlist. Deliberately stated as
 * properties of the *result*, not of any stage's internals — a rewrite of
 * `runFunnel` that keeps these true is a safe rewrite.
 */
export function assertValidShortlist(result: FunnelResult, profile: PreferenceProfile): void {
  const retrieved = result.stages.retrieved
  const retrievedIds = new Set(retrieved.map((p) => p.placeId))
  const shortlistIds = result.stages.afterGlobalCap.map((p) => p.placeId)

  // 5. Nothing may be invented between retrieval and the shortlist.
  for (const id of shortlistIds) {
    expect(retrievedIds.has(id), `${id} is in the shortlist but was never retrieved`).toBe(true)
  }
  expect(new Set(shortlistIds).size, 'the shortlist contains a duplicate').toBe(shortlistIds.length)

  // 7. Every survivor explains itself — the "why this place" UX has no fallback.
  expect(result.shortlist.map((s) => s.placeId)).toEqual(shortlistIds)
  for (const scored of result.shortlist) {
    expect(scored.reasons.length, `${scored.placeId} survived with no match_reasons`).toBeGreaterThan(0)
    expect(scored.reasons.every((r) => r.trim().length > 0)).toBe(true)
    expect(Number.isFinite(scored.score), `${scored.placeId} has a non-finite score`).toBe(true)
  }

  // 8. Retrieved partitions exactly into survivors and dropped-with-a-reason.
  const survived = new Set(shortlistIds)
  const dropped = new Map(result.dropped.map((d) => [d.placeId, d]))
  for (const place of retrieved) {
    if (survived.has(place.placeId)) {
      expect(dropped.has(place.placeId), `${place.placeId} both survived and was dropped`).toBe(false)
      continue
    }
    const record = dropped.get(place.placeId)
    expect(record, `${place.placeId} vanished with no recorded reason`).toBeDefined()
    expect(record!.reason.trim().length, `${place.placeId} was dropped with an empty reason`).toBeGreaterThan(0)
  }
  expect(survived.size + dropped.size).toBe(retrieved.length)

  // Nothing that failed a hard filter may reappear downstream.
  for (const place of result.stages.afterGlobalCap) {
    expect(hardFilterReason(place, profile), `${place.placeId} survived a hard filter it fails`).toBeUndefined()
  }

  // Stats are the stage lengths, not a separately maintained tally.
  const { stages, stats } = result
  for (const stage of Object.keys(stats) as (keyof typeof stats)[]) {
    expect(stats[stage], `stats.${stage} disagrees with stages.${stage}`).toBe(stages[stage].length)
  }

  // The cluster grouping is a partition of the shortlist — nothing lost, nothing
  // double-counted, no empty cluster handed to Pass B.
  const grouped = result.clusters.flatMap((c) => c.places.map((p) => p.placeId))
  expect(grouped.slice().sort()).toEqual(shortlistIds.slice().sort())
  for (const cluster of result.clusters) {
    expect(cluster.places.length, 'an empty cluster reached Pass B').toBeGreaterThan(0)
    expect(cluster.scored.map((s) => s.placeId)).toEqual(cluster.places.map((p) => p.placeId))
  }
}

/**
 * 6. The dietary guarantee. Rungs 1 and 2 must contain no violation; rung 3 is
 * allowed to, and must say so — that caveat is the only thing standing between
 * a vegetarian and a steakhouse.
 */
export function assertDietaryHonoured(
  selection: MealSelection,
  profile: PreferenceProfile,
): void {
  if (selection.rung === 3) {
    expect(selection.caveat, 'rung 3 without a caveat is a silent dietary failure').toBeTruthy()
    return
  }
  expect(selection.caveat, `rung ${selection.rung} must not carry a caveat`).toBeUndefined()
  for (const place of selection.places) {
    expect(
      hardFilterReason(place, profile, { mealSlot: true }),
      `${place.name} violates ${profile.dietary.join('/')} at rung ${selection.rung}`,
    ).toBeUndefined()
  }
}

/** Every candidate a fixture feeds in must be shaped like retrieval's output. */
export function assertWellFormedCandidates(candidates: readonly CandidatePlace[]): void {
  const ids = new Set<string>()
  for (const place of candidates) {
    expect(place.placeId.length, 'a candidate has no placeId').toBeGreaterThan(0)
    expect(ids.has(place.placeId), `duplicate candidate ${place.placeId}`).toBe(false)
    ids.add(place.placeId)
    expect(place.types.length, `${place.placeId} has no types`).toBeGreaterThan(0)
    // A half-located place is worse than an unlocated one: it clusters at (0, 0).
    expect(
      (place.latitude === undefined) === (place.longitude === undefined),
      `${place.placeId} has one coordinate but not the other`,
    ).toBe(true)
    if (place.priceLevel !== undefined) {
      expect(place.priceLevel).toBeGreaterThanOrEqual(0)
      expect(place.priceLevel).toBeLessThanOrEqual(4)
    }
  }
}

/**
 * 1, 2 and 4 — everything a *packed day* guarantees, stated over the returned
 * timeline rather than over the packer's internals. Takes the input it was
 * built from because half the guarantees are about the relationship between the
 * two: a day is only correct relative to what it was asked to schedule.
 */
export function assertValidItinerary(day: PackedDay, input: PackDayInput): void {
  const given = new Map<string, CandidatePlace>()
  for (const assignment of input.assignments) given.set(assignment.place.placeId, assignment.place)
  for (const pick of input.flex ?? []) given.set(pick.place.placeId, pick.place)

  // 1. Contiguous: no overlap, no gap, and no segment that takes zero minutes.
  for (const segment of day.segments) {
    expect(
      segment.endMin,
      `a ${segment.kind} segment at ${segment.startMin} takes no time at all`,
    ).toBeGreaterThan(segment.startMin)
  }
  for (let i = 0; i + 1 < day.segments.length; i++) {
    expect(
      day.segments[i].endMin,
      `the day tears open between segment ${i} (${day.segments[i].kind}) and ${i + 1}`,
    ).toBe(day.segments[i + 1].startMin)
  }

  const activities = day.segments.filter((segment) => segment.kind === 'activity')

  // 2. Every meal slot holds somewhere you can actually eat, inside its window.
  //    The window is the reason the slot exists — a "lunch" at 16:00 is not one.
  for (const activity of activities) {
    if (!isMealRole(activity.role)) continue
    const place = given.get(activity.placeId)!
    expect(
      isRestaurant(place),
      `${place.name} is holding the ${activity.role} slot and is not a restaurant`,
    ).toBe(true)
    const [opens, latest] = slotWindow(activity.role)
    expect(activity.startMin, `${activity.role} starts before its window opens`).toBeGreaterThanOrEqual(opens)
    expect(activity.startMin, `${activity.role} starts after its window closes`).toBeLessThanOrEqual(latest)
  }

  // 4. The day stays inside its own wall clock.
  if (day.segments.length > 0) {
    expect(day.segments[0].startMin, 'the day starts before 09:00').toBeGreaterThanOrEqual(DAY_START_MIN)
    expect(day.segments.at(-1)!.endMin, 'the day runs past 21:00').toBeLessThanOrEqual(DAY_END_MIN)
  }

  // 5 and 8 again, one day at a time: nothing invented, nothing vanished.
  const scheduled = new Set(activities.map((activity) => activity.placeId))
  const dropped = new Set(day.dropped.map((record) => record.placeId))
  expect(scheduled.size, 'a place is scheduled twice in one day').toBe(activities.length)
  for (const id of scheduled) {
    expect(given.has(id), `${id} is in the day but was never assigned to it`).toBe(true)
  }
  for (const [id, place] of given) {
    expect(
      scheduled.has(id) !== dropped.has(id),
      `${place.name} must be scheduled XOR dropped, not ${scheduled.has(id) ? 'both' : 'neither'}`,
    ).toBe(true)
  }
  for (const record of day.dropped) {
    expect(record.reason.trim().length, `${record.name} was cut with no reason given`).toBeGreaterThan(0)
  }
}

/**
 * 3. Every place is open for the whole of its assigned window — the guarantee
 * `validate.ts` exists to produce, stated over the finished day so that any
 * future repair strategy is judged by the same rule.
 *
 * Returns the stops it could only *assume* were open, so a caller can tell an
 * empty check from a passed one. A fixture with no hours makes this assertion
 * true and meaningless; the returned list is how you find out that happened.
 */
export function assertHoursHonoured(
  day: PackedDay,
  input: PackDayInput,
  weekday: Weekday,
): CandidatePlace[] {
  const given = new Map<string, CandidatePlace>()
  for (const assignment of input.assignments) given.set(assignment.place.placeId, assignment.place)
  for (const pick of input.flex ?? []) given.set(pick.place.placeId, pick.place)

  const assumed: CandidatePlace[] = []
  for (const segment of day.segments) {
    if (segment.kind !== 'activity') continue
    const place = given.get(segment.placeId)
    if (!place) continue
    if (!hasKnownHours(place)) {
      assumed.push(place)
      continue
    }
    expect(
      isOpenDuring(place, weekday, segment.startMin, segment.endMin),
      `${place.name} is scheduled ${segment.startMin}–${segment.endMin} on weekday ${weekday}, when it is shut`,
    ).toBe(true)
  }
  return assumed
}
