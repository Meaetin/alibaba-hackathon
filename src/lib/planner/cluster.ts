/**
 * Stage 4 — geographic clustering. k-means over raw lat/lng, `k = total_days`,
 * so each planned day gets a coherent neighborhood. Runs BEFORE the LLM: the
 * rerank assigns one cluster per day, so it must receive candidates already
 * clustered. See "Stage 4" ordering note in `docs/personalization-pipeline.md`.
 *
 * Unrelated to `src/lib/maps/locality-pins.ts` (static-map pin grouping by
 * "{region}, {country}") — never share code across the two.
 *
 * Randomness is an injected parameter (`rng`), never ambient: k-means++
 * seeding is the only consumer, and a fixed seed makes the whole run
 * reproducible in tests.
 */

import type { CandidatePlace } from "./types";

export interface PlaceCluster {
  /** Mean of member coordinates. */
  centroid: { latitude: number; longitude: number };
  places: CandidatePlace[];
  /** Neighborhood name, filled by the funnel/LLM later. Always starts unset. */
  label?: string;
}

export interface ClusterParams {
  /** Target cluster count — the trip's total_days. Clamped to the number of located candidates. */
  k: number;
  /** Uniform [0, 1) source. Injected, never Math.random. */
  rng: () => number;
  /** Lloyd-iteration cap (from `SchedulerOptions.maxIterations`). */
  maxIterations?: number;
}

const DEFAULT_MAX_ITERATIONS = 50;

type Point = { lat: number; lng: number };

function distSq(a: Point, b: Point): number {
  const dLat = a.lat - b.lat;
  const dLng = a.lng - b.lng;
  return dLat * dLat + dLng * dLng;
}

/**
 * k-means++ seeding: first centroid uniform, each subsequent one sampled
 * proportional to squared distance from the nearest chosen centroid. A point
 * already chosen has weight 0, so with k ≤ distinct points the seeds are
 * distinct — which is what keeps clusters non-empty.
 */
function seedCentroids(points: Point[], k: number, rng: () => number): Point[] {
  const centroids: Point[] = [points[Math.floor(rng() * points.length)]];
  while (centroids.length < k) {
    const weights = points.map((p) =>
      Math.min(...centroids.map((c) => distSq(p, c))),
    );
    const total = weights.reduce((sum, w) => sum + w, 0);
    if (total === 0) {
      // All remaining points coincide with a centroid (duplicate coords).
      // Any unchosen point works; take the first.
      const unchosen = points.find((p) => !centroids.includes(p)) ?? points[0];
      centroids.push(unchosen);
      continue;
    }
    let threshold = rng() * total;
    let picked = points.length - 1;
    for (let i = 0; i < points.length; i++) {
      threshold -= weights[i];
      if (threshold <= 0) {
        picked = i;
        break;
      }
    }
    centroids.push(points[picked]);
  }
  return centroids.map((c) => ({ ...c }));
}

/**
 * Groups candidates into ≤ k geographic clusters. Candidates without
 * coordinates are excluded — a missing lat/lng must never become (0, 0).
 * Never returns an empty cluster; `k > candidates.length` degrades to one
 * cluster per candidate.
 */
export function clusterPlaces(
  candidates: CandidatePlace[],
  { k, rng, maxIterations = DEFAULT_MAX_ITERATIONS }: ClusterParams,
): PlaceCluster[] {
  const located = candidates.filter(
    (c) => c.latitude !== undefined && c.longitude !== undefined,
  );
  if (located.length === 0) return [];

  const points: Point[] = located.map((c) => ({
    lat: c.latitude!,
    lng: c.longitude!,
  }));
  const effectiveK = Math.max(1, Math.min(k, located.length));

  const centroids = seedCentroids(points, effectiveK, rng);
  let assignment = new Array<number>(points.length).fill(0);

  for (let iter = 0; iter < maxIterations; iter++) {
    // Assign each point to its nearest centroid.
    const next = points.map((p) => {
      let best = 0;
      let bestDist = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const d = distSq(p, centroids[c]);
        if (d < bestDist) {
          bestDist = d;
          best = c;
        }
      }
      return best;
    });

    const converged =
      iter > 0 && next.every((c, i) => c === assignment[i]);
    assignment = next;
    if (converged) break;

    // Recompute centroids; an emptied centroid is reseeded to the point
    // farthest from its assigned centroid so no cluster stays empty.
    for (let c = 0; c < centroids.length; c++) {
      const members = points.filter((_, i) => assignment[i] === c);
      if (members.length === 0) {
        let farthest = 0;
        let farthestDist = -1;
        for (let i = 0; i < points.length; i++) {
          const d = distSq(points[i], centroids[assignment[i]]);
          if (d > farthestDist) {
            farthestDist = d;
            farthest = i;
          }
        }
        centroids[c] = { ...points[farthest] };
        assignment[farthest] = c;
        continue;
      }
      centroids[c] = {
        lat: members.reduce((s, p) => s + p.lat, 0) / members.length,
        lng: members.reduce((s, p) => s + p.lng, 0) / members.length,
      };
    }
  }

  // Materialize: recompute centroids from final membership, drop any cluster
  // the reseeding couldn't save (possible only when maxIterations is tiny).
  const clusters: PlaceCluster[] = [];
  for (let c = 0; c < centroids.length; c++) {
    const members = located.filter((_, i) => assignment[i] === c);
    if (members.length === 0) continue;
    clusters.push({
      centroid: {
        latitude:
          members.reduce((s, m) => s + m.latitude!, 0) / members.length,
        longitude:
          members.reduce((s, m) => s + m.longitude!, 0) / members.length,
      },
      places: members,
      label: undefined,
    });
  }
  return clusters;
}
