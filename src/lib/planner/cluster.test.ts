import { describe, it, expect } from 'vitest'

import type { CandidatePlace } from './types'
import { clusterPlaces, type PlaceCluster } from './cluster'
// The module never touches Math.random — the rng is an injected parameter,
// which is exactly what the determinism test below forces.
import { mulberry32 } from './__tests__/rng'

function place(
  placeId: string,
  latitude: number,
  longitude: number,
): CandidatePlace {
  return { placeId, name: placeId, types: ['tourist_attraction'], latitude, longitude }
}

// Three tight Kyoto blobs, ~5 places each, jittered by fixed offsets (no
// ambient randomness in fixtures either).
const JITTER = [
  [0, 0],
  [0.002, 0.001],
  [-0.001, 0.002],
  [0.001, -0.002],
  [-0.002, -0.001],
] as const

function blob(name: string, lat: number, lng: number): CandidatePlace[] {
  return JITTER.map(([dLat, dLng], i) =>
    place(`${name}-${i}`, lat + dLat, lng + dLng),
  )
}

const ARASHIYAMA = blob('arashiyama', 35.0094, 135.6668)
const GION = blob('gion', 35.0037, 135.7788)
const FUSHIMI = blob('fushimi', 34.9671, 135.7727)

/** blob name for a placeId like "gion-3" */
function blobOf(placeId: string): string {
  return placeId.split('-')[0]
}

/** Canonical, order-independent view of an assignment: sorted groups of sorted ids. */
function grouping(clusters: PlaceCluster[]): string[] {
  return clusters
    .map((c) => c.places.map((p) => p.placeId).sort().join(','))
    .sort()
}

describe('clusterPlaces', () => {
  it('separates three tight geographic blobs with k = 3, each blob wholly in one cluster', () => {
    const candidates = [...ARASHIYAMA, ...GION, ...FUSHIMI]
    const clusters = clusterPlaces(candidates, { k: 3, rng: mulberry32(42) })

    expect(clusters).toHaveLength(3)
    // Assert by grouping, not by cluster index — index order is not stable.
    for (const cluster of clusters) {
      const names = new Set(cluster.places.map((p) => blobOf(p.placeId)))
      expect(names.size, `cluster mixes blobs: ${[...names].join(', ')}`).toBe(1)
    }
    // And every blob is represented (no blob split across clusters).
    const represented = new Set(
      clusters.map((c) => blobOf(c.places[0].placeId)),
    )
    expect(represented).toEqual(new Set(['arashiyama', 'gion', 'fushimi']))
  })

  it('is deterministic given a fixed rng: same input + same seed → identical assignment', () => {
    const candidates = [...ARASHIYAMA, ...GION, ...FUSHIMI]
    const a = clusterPlaces(candidates, { k: 3, rng: mulberry32(7) })
    const b = clusterPlaces(candidates, { k: 3, rng: mulberry32(7) })
    expect(grouping(a)).toEqual(grouping(b))
  })

  it('k > candidates.length → candidates.length non-empty clusters, no throw', () => {
    const candidates = [
      place('a', 35.0, 135.7),
      place('b', 35.1, 135.8),
      place('c', 34.9, 135.6),
    ]
    const clusters = clusterPlaces(candidates, { k: 10, rng: mulberry32(1) })
    expect(clusters).toHaveLength(3)
    for (const cluster of clusters) {
      expect(cluster.places.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('never emits an empty cluster', () => {
    const candidates = [...ARASHIYAMA, ...GION, ...FUSHIMI]
    // Try a handful of seeds — an empty cluster is a bug at any seed.
    for (const seed of [1, 2, 3, 4, 5]) {
      const clusters = clusterPlaces(candidates, { k: 5, rng: mulberry32(seed) })
      for (const cluster of clusters) {
        expect(cluster.places.length).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it('k === 1 → one cluster containing everything', () => {
    const candidates = [...ARASHIYAMA, ...GION, ...FUSHIMI]
    const clusters = clusterPlaces(candidates, { k: 1, rng: mulberry32(3) })
    expect(clusters).toHaveLength(1)
    expect(clusters[0].places).toHaveLength(candidates.length)
  })

  it('empty input → [], no throw', () => {
    expect(clusterPlaces([], { k: 3, rng: mulberry32(1) })).toEqual([])
  })

  it('candidates without coordinates are excluded, never placed at (0, 0)', () => {
    const noCoords: CandidatePlace = {
      placeId: 'no-coords',
      name: 'No Coords',
      types: ['cafe'],
    }
    const clusters = clusterPlaces([...GION, noCoords], {
      k: 1,
      rng: mulberry32(1),
    })
    expect(clusters).toHaveLength(1)
    const ids = clusters[0].places.map((p) => p.placeId)
    expect(ids).not.toContain('no-coords')
    // A (0,0) phantom would drag the centroid into the Gulf of Guinea.
    expect(clusters[0].centroid.latitude).toBeCloseTo(35.0037, 2)
  })

  it('respects a low maxIterations cap: terminates and still assigns every place', () => {
    const candidates = [...ARASHIYAMA, ...GION, ...FUSHIMI]
    const clusters = clusterPlaces(candidates, {
      k: 3,
      rng: mulberry32(11),
      maxIterations: 1,
    })
    const assigned = clusters.flatMap((c) => c.places.map((p) => p.placeId))
    expect(assigned.sort()).toEqual(candidates.map((p) => p.placeId).sort())
  })

  it('each cluster carries a centroid inside its members’ bounding box and a fillable label slot', () => {
    const candidates = [...ARASHIYAMA, ...GION, ...FUSHIMI]
    const clusters = clusterPlaces(candidates, { k: 3, rng: mulberry32(42) })
    for (const cluster of clusters) {
      const lats = cluster.places.map((p) => p.latitude!)
      const lngs = cluster.places.map((p) => p.longitude!)
      expect(cluster.centroid.latitude).toBeGreaterThanOrEqual(Math.min(...lats))
      expect(cluster.centroid.latitude).toBeLessThanOrEqual(Math.max(...lats))
      expect(cluster.centroid.longitude).toBeGreaterThanOrEqual(Math.min(...lngs))
      expect(cluster.centroid.longitude).toBeLessThanOrEqual(Math.max(...lngs))
      // Label slot exists (the funnel/LLM fills it later), starts unset.
      expect('label' in cluster).toBe(true)
      expect(cluster.label).toBeUndefined()
    }
  })
})
