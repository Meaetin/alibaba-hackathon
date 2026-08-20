import { describe, it, expect } from 'vitest'

import {
  normalizePlace,
  SEARCH_FIELDS,
  toPlaceDetailsPayload,
  type PlaceSearchResult,
} from './place-search'

// Minimal Place-shaped fake: normalizePlace only touches optional-chained
// fields plus location.lat()/lng(), id, displayName, and types.
function fakePlace(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ChIJ_fake',
    displayName: 'Fake Cafe',
    location: { lat: () => 35.0116, lng: () => 135.7681 },
    types: ['cafe'],
    primaryType: 'cafe',
    ...overrides,
  } as unknown as google.maps.places.Place
}

// The regression this file exists to pin: normalizePlace once requested
// `priceLevel` in the field mask and then dropped it during normalization —
// the mask paid for a field nobody read.
describe('normalizePlace price mapping', () => {
  it('maps a fake Place with priceLevel "MODERATE" to ordinal 2', () => {
    const result = normalizePlace(fakePlace({ priceLevel: 'MODERATE' }))
    expect(result?.priceLevel).toBe(2)
  })

  it('leaves priceLevel undefined when Google sends nothing', () => {
    const result = normalizePlace(fakePlace())
    expect(result?.priceLevel).toBeUndefined()
  })
})

// Guards mask/normalizer drift in the other direction — paying for a field
// nobody reads.
describe('SEARCH_FIELDS', () => {
  it('contains priceLevel', () => {
    expect(SEARCH_FIELDS).toContain('priceLevel')
  })
})

describe('toPlaceDetailsPayload', () => {
  // rating marks the result as Enterprise-enriched, so the payload builds
  // instead of falling through to the server-side fetch.
  const base: PlaceSearchResult = {
    id: 'ChIJ_fake',
    name: 'Fake Cafe',
    latitude: 35.0116,
    longitude: 135.7681,
    types: ['cafe'],
    rating: 4.5,
    priceLevel: 2,
  }

  it('carries priceLevel through to the persistence shape', () => {
    const payload = toPlaceDetailsPayload(base)
    expect(payload?.priceLevel).toBe(2)
  })

  it('carries a free place through as 0, not undefined', () => {
    const payload = toPlaceDetailsPayload({ ...base, priceLevel: 0 })
    expect(payload?.priceLevel).toBe(0)
  })
})
