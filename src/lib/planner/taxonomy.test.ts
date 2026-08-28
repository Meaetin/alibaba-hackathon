import { describe, it, expect } from 'vitest'

import type { Interest } from './types'
import {
  ALL_INTERESTS,
  MEAL_SEARCH_TYPES,
  bridgeFor,
  isRestaurant,
  mealSearchTypes,
  queriesFor,
  typesFor,
  dietaryBridgeFor,
} from './taxonomy'
import { NON_SEARCHABLE_TYPES } from './retrieval'

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

describe('mealSearchTypes', () => {
  /**
   * The rule this list exists to keep: a themed day asks for somewhere to eat
   * whatever its premise is about. A live Bali run had a museum-day theme
   * search for museums, and the nearest restaurant in the whole pool ended up
   * 8 km away — the day shipped with no lunch and nothing to repair from.
   */
  it('always asks for the broad meal types, with no dietary need at all', () => {
    expect(mealSearchTypes()).toEqual(expect.arrayContaining([...MEAL_SEARCH_TYPES]))
    expect(mealSearchTypes([])).toEqual(mealSearchTypes())
  })

  /**
   * Google types a vegetarian izakaya `izakaya_restaurant`, so asking only for
   * `vegetarian_restaurant` is how a vegetarian ends up with nowhere to eat
   * rather than somewhere to ask. `hardFilterReason` and `selectMealCandidates`
   * are what enforce the need; this stage only has to find candidates.
   */
  it('widens for a dietary need and never narrows', () => {
    const veg = mealSearchTypes(['vegetarian'])
    expect(veg).toEqual(expect.arrayContaining([...MEAL_SEARCH_TYPES]))
    expect(veg).toContain('vegetarian_restaurant')
    expect(veg.length).toBeGreaterThan(mealSearchTypes().length)
  })

  it('ignores a need it has no bridge for rather than sending nothing', () => {
    expect(mealSearchTypes(['pescatarian'])).toEqual(mealSearchTypes())
  })

  it('deduplicates, because retrieval bills per request', () => {
    const types = mealSearchTypes(['vegetarian', 'vegan'])
    expect(new Set(types).size).toBe(types.length)
  })

  /**
   * The one rule that cannot be checked at the call site. Google rejects the
   * **entire** Nearby Search with a 400 if any single `includedTypes` entry is
   * descriptive-only — not "ignores that type", the whole circle is lost, and a
   * live Singapore run lost two of three that way. Every meal circle in every
   * themed plan carries this list, so one bad entry here is every day with no
   * lunch.
   *
   * `mealSearchTypes` deliberately does **not** filter at runtime: these are
   * constants in our own source, not something a model proposed, and silently
   * dropping one would trade a loud 400 for a quiet empty circle.
   */
  it('sends nothing Google refuses to search for', () => {
    for (const type of mealSearchTypes(['vegetarian', 'vegan'])) {
      expect(NON_SEARCHABLE_TYPES.has(type), `${type} is descriptive-only`).toBe(false)
    }
  })
})

describe('isRestaurant', () => {
  it('accepts the generic type and every cuisine suffix', () => {
    expect(isRestaurant({ types: ['restaurant'] })).toBe(true)
    expect(isRestaurant({ types: ['ramen_restaurant', 'food'] })).toBe(true)
  })

  /**
   * The shape this rule exists for, copied from live rows rather than invented.
   * Twelve of twenty `food_court` places in the store carry no `restaurant`
   * type at all — Satay Street @ Lau Pa Sat, Chinatown Food Street, Kopitiam
   * Food Hall — and every one is somewhere you eat lunch. Before `food_court`
   * was in this predicate they were retrieved, scored, and then unable to hold
   * the meal slot they exist to hold.
   *
   * `singapore-candidates.json` cannot catch a regression here: all nine of its
   * food courts are big named hawker centres, which Google *does* type
   * `food_court, market, restaurant`. Both Gate A snapshots pass either way,
   * which is exactly why this assertion is written out by hand.
   */
  it('accepts a bare food court, the way Google actually types a hawker street', () => {
    expect(
      isRestaurant({ types: ['food_court', 'food', 'point_of_interest', 'establishment'] }),
    ).toBe(true)
  })

  it('still accepts the hawker centres that also carry restaurant', () => {
    expect(isRestaurant({ types: ['food_court', 'market', 'restaurant'] })).toBe(true)
  })

  /**
   * Searched for, never seated. All seven live rows carrying `meal_takeaway`
   * already carry `restaurant`, so promoting it here would assert something no
   * evidence supports — and a takeaway counter is a weaker claim to a
   * seventy-five-minute meal slot than a food hall is.
   */
  it('does not seat a meal on meal_takeaway alone, though it searches for it', () => {
    expect(MEAL_SEARCH_TYPES).toContain('meal_takeaway')
    expect(isRestaurant({ types: ['meal_takeaway', 'food', 'establishment'] })).toBe(false)
  })

  it('refuses a department store, which is what this predicate was added for', () => {
    expect(isRestaurant({ types: ['department_store', 'shopping_mall', 'store'] })).toBe(false)
  })

  /**
   * A search type we cannot seat is the Bali warung failure repeated: found,
   * ranked, and then useless. `cafe` and `bakery` are the deliberate
   * exceptions — they hold a `cafe_break`, never a meal.
   */
  it('can seat every meal type it searches for, bar the two that hold a coffee', () => {
    for (const type of MEAL_SEARCH_TYPES) {
      if (type === 'cafe' || type === 'bakery' || type === 'meal_takeaway') continue
      expect(isRestaurant({ types: [type] }), `${type} is searched but cannot be seated`).toBe(
        true,
      )
    }
  })
})
