import { describe, it, expect } from 'vitest'

import { toPriceLevelOrdinal } from './price-level'

describe('toPriceLevelOrdinal', () => {
  it('maps the Maps JS spelling ("MODERATE") to 2', () => {
    expect(toPriceLevelOrdinal('MODERATE')).toBe(2)
  })

  it('maps the REST spelling ("PRICE_LEVEL_MODERATE") to 2', () => {
    expect(toPriceLevelOrdinal('PRICE_LEVEL_MODERATE')).toBe(2)
  })

  it('maps PRICE_LEVEL_FREE to 0', () => {
    expect(toPriceLevelOrdinal('PRICE_LEVEL_FREE')).toBe(0)
  })

  it('maps PRICE_LEVEL_UNSPECIFIED to undefined', () => {
    expect(toPriceLevelOrdinal('PRICE_LEVEL_UNSPECIFIED')).toBeUndefined()
  })

  it.each([undefined, null, 2, '', 'MODERATELY'])(
    'maps %s to undefined',
    (raw) => {
      expect(toPriceLevelOrdinal(raw)).toBeUndefined()
    },
  )

  // The whole reason the function returns undefined instead of 0: "it's free"
  // and "we don't know" must never collapse into the same value — budget
  // filtering treats unknown as neutral, free as an exact match.
  it('distinguishes free (0) from unknown (undefined)', () => {
    const free = toPriceLevelOrdinal('PRICE_LEVEL_FREE')
    const unknown = toPriceLevelOrdinal(undefined)
    expect(free).toBe(0)
    expect(unknown).toBeUndefined()
    expect(free).not.toBe(unknown)
  })
})
