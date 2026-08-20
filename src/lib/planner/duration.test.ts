import { describe, it, expect } from 'vitest'

import type { CandidatePlace } from './types'
import {
  resolveVisitDuration,
  DEFAULT_VISIT_MINUTES,
  PACE_MULTIPLIERS,
  type VisitDuration,
} from './duration'

function makePlace(overrides: Partial<CandidatePlace> = {}): CandidatePlace {
  return { placeId: 'ChIJ_test', name: 'Test Place', types: ['cafe'], ...overrides }
}

function expectSane(d: VisitDuration) {
  for (const v of [d.min, d.preferred, d.max]) {
    expect(Number.isFinite(v)).toBe(true)
    expect(v).toBeGreaterThan(0)
  }
  expect(d.min).toBeLessThanOrEqual(d.preferred)
  expect(d.preferred).toBeLessThanOrEqual(d.max)
}

describe('resolution ladder — each rung beats the one below it', () => {
  it('rung 1: stay_duration beats enrichment when both are present', () => {
    const d = resolveVisitDuration(
      makePlace({ stayDuration: 100 }),
      { avgVisitMinutes: [40, 80] },
      'balanced',
    )
    expect(d.preferred).toBe(100)
    expectSane(d)
  })

  it('rung 2: enrichment beats the type heuristic when both are present', () => {
    // cafe heuristic says 45; enrichment says 60–120 → midpoint 90 wins.
    const d = resolveVisitDuration(makePlace({ types: ['cafe'] }), { avgVisitMinutes: [60, 120] }, 'balanced')
    expect(d.preferred).toBe(90)
    expect(d.min).toBe(60)
    expect(d.max).toBe(120)
  })

  it('rung 3: the type heuristic beats the global default', () => {
    const d = resolveVisitDuration(makePlace({ types: ['cafe'] }), undefined, 'balanced')
    expect(d.preferred).toBe(45)
    expect(d.preferred).not.toBe(DEFAULT_VISIT_MINUTES)
  })
})

describe('type heuristics', () => {
  it.each([
    ['cafe', 45],
    ['place_of_worship', 45], // temple
    ['museum', 90],
    ['hiking_area', 120],
  ])('%s → %d minutes at balanced pace', (type, minutes) => {
    const d = resolveVisitDuration(makePlace({ types: [type] }), undefined, 'balanced')
    expect(d.preferred).toBe(minutes)
    expectSane(d)
  })
})

describe('pace multipliers', () => {
  const museum = makePlace({ types: ['museum'] })

  it.each([
    ['relaxed', Math.round(90 * 1.2)],
    ['balanced', 90],
    ['packed', Math.round(90 * 0.85)],
  ] as const)('%s applies ×%f to preferred', (pace, expected) => {
    const d = resolveVisitDuration(museum, undefined, pace)
    expect(d.preferred).toBe(expected)
  })

  it('multiplies preferred only — min and max are identical across paces', () => {
    const relaxed = resolveVisitDuration(museum, undefined, 'relaxed')
    const packed = resolveVisitDuration(museum, undefined, 'packed')
    const balanced = resolveVisitDuration(museum, undefined, 'balanced')
    expect(relaxed.min).toBe(balanced.min)
    expect(relaxed.max).toBe(balanced.max)
    expect(packed.min).toBe(balanced.min)
    expect(packed.max).toBe(balanced.max)
  })

  it('never pushes preferred above max (relaxed on a tight enrichment range)', () => {
    // 90 × 1.2 = 108 would escape [85, 95] — clamp to 95.
    const d = resolveVisitDuration(makePlace(), { avgVisitMinutes: [85, 95] }, 'relaxed')
    expect(d.preferred).toBe(95)
    expectSane(d)
  })

  it('never pushes preferred below min (packed on a tight enrichment range)', () => {
    // 90 × 0.85 ≈ 77 would escape [85, 95] — clamp to 85.
    const d = resolveVisitDuration(makePlace(), { avgVisitMinutes: [85, 95] }, 'packed')
    expect(d.preferred).toBe(85)
    expectSane(d)
  })

  it('exports the documented multipliers', () => {
    expect(PACE_MULTIPLIERS).toEqual({ relaxed: 1.2, balanced: 1.0, packed: 0.85 })
  })
})

describe('fallback', () => {
  it('unknown type with no enrichment → the global default, not 0 and not NaN', () => {
    const d = resolveVisitDuration(
      makePlace({ types: ['intergalactic_spaceport'] }),
      undefined,
      'balanced',
    )
    expect(d.preferred).toBe(DEFAULT_VISIT_MINUTES)
    expectSane(d)
  })

  it('empty types array → still sane', () => {
    const d = resolveVisitDuration(makePlace({ types: [] }), undefined, 'balanced')
    expect(d.preferred).toBe(DEFAULT_VISIT_MINUTES)
    expectSane(d)
  })
})
