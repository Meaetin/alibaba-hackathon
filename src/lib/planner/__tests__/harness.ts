/**
 * The Gate A machinery, shared by every city fixture.
 *
 * Gate A drives the deterministic core end-to-end with no API keys, no database
 * and no network. Everything city-specific — the candidates, the traveller, the
 * length of the trip, the day of the week — is a parameter; everything else is
 * here, so a second fixture is a data file and a handful of assertions rather
 * than a second copy of the pipeline.
 *
 * Two stand-ins live in this file, both deliberately dumber than what replaces
 * them. `straightLineLegs` stands in for the Routes API: what the packer needs
 * from a leg is a number that grows with distance and a mode that flips at
 * 1.2 km, and crow-flight gives both. `assignDay` stands in for Pass B, which
 * is an LLM and therefore not something Gate A may call. What these legs test
 * is whether the *packer and validator* turn a plausible assignment into a day
 * a person could walk — not whether the assignment was inspired.
 */

import type { CandidatePlace, Pace, PreferenceProfile } from '../types'
import type { ScoredCluster } from '../funnel'
import type { PackDayInput, SlotRole, TimelineSegment, TravelLegProvider } from '../pack'
import type { Weekday } from '../hours'
import type { Alternate, AssignClient } from '../validate'
import { clusterPlaces } from '../cluster'
import { runFunnel } from '../funnel'
import { resolveVisitDuration } from '../duration'
import { isRestaurant } from '../taxonomy'
import { WALK_MAX_METERS, packDay } from '../pack'
import { isOpenDuring } from '../hours'
import { validateDay } from '../validate'
import { mulberry32 } from './rng'

/** The one seed every fixture runs on — k-means++ is the only rng consumer. */
export const SEED = 1337

/** Straight-line metres between two places, turned into a travel leg. */
export const straightLineLegs: TravelLegProvider = (from, to) => {
  const R = 6_371_000
  const rad = (deg: number) => (deg * Math.PI) / 180
  const dLat = rad(to.latitude! - from.latitude!)
  const dLng = rad(to.longitude! - from.longitude!)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(from.latitude!)) * Math.cos(rad(to.latitude!)) * Math.sin(dLng / 2) ** 2
  const meters = Math.round(2 * R * Math.asin(Math.sqrt(a)))
  // 80 m/min on foot; transit is faster per metre but costs you the wait.
  const minutes = meters < WALK_MAX_METERS ? Math.ceil(meters / 80) : 8 + Math.ceil(meters / 400)
  return { minutes, meters }
}

/**
 * Pass B's stand-in: take a day's cluster best-first and lay out an ordered day
 * — stops around two meals, with the next-best sight held back as the flex pick.
 *
 * It offers a full day's worth and lets the packer's clock decide what survives.
 * An assigner that hands over exactly as many stops as it expects to fit is
 * making a scheduling decision it has no clock to make.
 */
export function assignDay(cluster: ScoredCluster, pace: Pace): PackDayInput {
  const withScores = cluster.places.map((place, i) => ({ place, score: cluster.scored[i].score }))
  const eats = withScores.filter((entry) => isRestaurant(entry.place))
  const sights = withScores.filter((entry) => !isRestaurant(entry.place))
  const sized = (entry: { place: CandidatePlace; score: number }, role: SlotRole) => ({
    ...entry,
    role,
    duration: resolveVisitDuration(entry.place, undefined, pace),
  })

  const layout: Array<[(typeof sights)[number] | undefined, SlotRole]> = [
    [sights[0], 'activity'],
    [eats[0], 'lunch'],
    [sights[1], 'activity'],
    [sights[2], 'activity'],
    [sights[3], 'activity'],
    [eats[1], 'dinner'],
    [sights[4], 'activity'],
  ]

  return {
    assignments: layout.flatMap(([entry, role]) => (entry ? [sized(entry, role)] : [])),
    flex: sights[5]
      ? [{ ...sights[5], duration: resolveVisitDuration(sights[5].place, undefined, pace) }]
      : [],
  }
}

/**
 * The fallback queue for one day: everything the funnel put in this cluster
 * that the assigner did not use, still in the funnel's order. This is the whole
 * of what repair is allowed to draw on.
 */
export function alternatesFor(
  cluster: ScoredCluster,
  input: PackDayInput,
  pace: Pace,
): Alternate[] {
  const used = new Set([
    ...input.assignments.map((a) => a.place.placeId),
    ...(input.flex ?? []).map((f) => f.place.placeId),
  ])
  return cluster.places
    .map((place, index) => ({
      place,
      score: cluster.scored[index].score,
      duration: resolveVisitDuration(place, undefined, pace),
    }))
    .filter((alternate) => !used.has(alternate.place.placeId))
}

export interface TripFixture {
  city: string
  candidates: CandidatePlace[]
  profile: PreferenceProfile
  days: number
  /** 0 = Sunday … 6 = Saturday. Museums shut on Mondays in both fixtures. */
  weekday: Weekday
}

/** Everything a fixture's assertions need, bound to one city. */
export function createTrip(fixture: TripFixture) {
  const { candidates, profile, days, weekday } = fixture

  const runPipeline = (traveller: PreferenceProfile = profile, dayCount = days) => {
    const located = candidates.filter((c) => c.latitude !== undefined)
    const unlocated = candidates.filter((c) => c.latitude === undefined)
    const clusters = clusterPlaces(located, { k: dayCount, rng: mulberry32(SEED) })
    return { clusters, result: runFunnel(clusters, traveller, { unlocated }) }
  }

  const packTrip = (pace: Pace = profile.pace) => {
    const { result } = runPipeline({ ...profile, pace })
    return result.clusters.map((cluster) => {
      const input = assignDay(cluster, pace)
      return { input, day: packDay(input, pace, straightLineLegs) }
    })
  }

  const validateTrip = (
    pace: Pace = profile.pace,
    onWeekday: Weekday = weekday,
    assign?: AssignClient,
  ) => {
    const { result } = runPipeline({ ...profile, pace })
    return result.clusters.map((cluster) => {
      const input = assignDay(cluster, pace)
      return {
        cluster,
        input,
        validation: validateDay(input, {
          pace,
          weekday: onWeekday,
          profile: { ...profile, pace },
          getTravelLeg: straightLineLegs,
          alternates: alternatesFor(cluster, input, pace),
          assign,
        }),
      }
    })
  }

  /** Stops the packer put inside a locked building, before anything repairs them. */
  const lockedStops = (onWeekday: Weekday = weekday) =>
    packTrip().flatMap(({ input, day }) => {
      const given = new Map(input.assignments.map((a) => [a.place.placeId, a.place]))
      for (const pick of input.flex ?? []) given.set(pick.place.placeId, pick.place)
      return day.segments.flatMap((segment) => {
        if (segment.kind !== 'activity') return []
        const place = given.get(segment.placeId)!
        return isOpenDuring(place, onWeekday, segment.startMin, segment.endMin) ? [] : [place.name]
      })
    })

  const nameOf = (id: string) => candidates.find((c) => c.placeId === id)!.name

  return { ...fixture, runPipeline, packTrip, validateTrip, lockedStops, nameOf }
}

export type Trip = ReturnType<typeof createTrip>

/** `09:00-11:15` — how both snapshots render a segment's span. */
export const hhmm = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

/** One day's timeline as readable lines. The snapshot a human actually reviews. */
export function renderTimeline(segments: readonly TimelineSegment[]): string[] {
  return segments.map((segment) => {
    const span = `${hhmm(segment.startMin)}-${hhmm(segment.endMin)}`
    if (segment.kind === 'activity') return `${span} ${segment.role}: ${segment.name}`
    if (segment.kind === 'travel') return `${span} ${segment.mode} ${segment.fromName} -> ${segment.toName}`
    return `${span} ${segment.reason} break`
  })
}
