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
 * 5–8 hold on the deterministic core as it stands today and are enforced here.
 * 1–4 are about a *packed day*, which doesn't exist until `pack.ts` — add
 * `assertValidItinerary` alongside these when it does, rather than stubbing it
 * now: an invariant that passes because it checks nothing is worse than none.
 */

import { expect } from 'vitest'

import type { CandidatePlace, PreferenceProfile } from '../types'
import type { FunnelResult, MealSelection } from '../funnel'
import { hardFilterReason } from '../score'

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
