import { describe, it, expect } from 'vitest'

import type { Interest } from './types'
import {
  ALL_INTERESTS,
  bridgeFor,
  queriesFor,
  typesFor,
  dietaryBridgeFor,
} from './taxonomy'

describe('taxonomy bridge', () => {
  // The exhaustiveness guarantee: the bridge is a Record<Interest, …>, so a
  // new union member without a bridge row is a *compile* error; this runtime
  // loop then catches a row that exists but is empty — an interest that would
  // silently retrieve nothing.
  it('every Interest has a bridge row with ≥1 type and ≥1 query', () => {
    // Compile guard: ALL_INTERESTS must cover the whole union.
    const covered = ALL_INTERESTS satisfies readonly Interest[]
    expect(covered.length).toBeGreaterThan(0)
    for (const interest of covered) {
      const bridge = bridgeFor(interest)
      expect(bridge.types.length, `${interest} has no types`).toBeGreaterThanOrEqual(1)
      expect(bridge.queries.length, `${interest} has no queries`).toBeGreaterThanOrEqual(1)
    }
  })

  it('"cafes" bridges to cafe and coffee_shop', () => {
    const { types } = bridgeFor('cafes')
    expect(types).toContain('cafe')
    expect(types).toContain('coffee_shop')
  })
})

describe('queriesFor', () => {
  it('interpolates {city}: cafes in Kyoto includes "specialty coffee Kyoto"', () => {
    expect(queriesFor('cafes', 'Kyoto')).toContain('specialty coffee Kyoto')
  })

  it('never leaks the {city} placeholder, for any interest', () => {
    for (const interest of ALL_INTERESTS) {
      for (const query of queriesFor(interest, 'Kyoto')) {
        expect(query).not.toContain('{city}')
      }
    }
  })
})

describe('dietary bridge', () => {
  it('"vegetarian" bridges to vegetarian_restaurant and vegan_restaurant', () => {
    const bridge = dietaryBridgeFor('vegetarian')
    expect(bridge?.types).toContain('vegetarian_restaurant')
    expect(bridge?.types).toContain('vegan_restaurant')
  })

  it('an unknown dietary need has no bridge', () => {
    expect(dietaryBridgeFor('carnivore')).toBeUndefined()
  })
})

describe('typesFor', () => {
  // Retrieval bills per query — a type shared by two interests must not be
  // requested twice.
  it('two interests sharing a type produce a deduped type list', () => {
    const foodTypes = bridgeFor('food').types
    const shoppingTypes = bridgeFor('shopping').types
    const shared = foodTypes.filter((t) => shoppingTypes.includes(t))
    // Precondition: these two interests genuinely overlap ("market").
    expect(shared.length).toBeGreaterThanOrEqual(1)

    const merged = typesFor(['food', 'shopping'])
    expect(new Set(merged).size).toBe(merged.length)
    for (const t of shared) expect(merged).toContain(t)
  })

  it('a single interest passes its types through unchanged', () => {
    expect(typesFor(['cafes'])).toEqual([...bridgeFor('cafes').types])
  })
})
