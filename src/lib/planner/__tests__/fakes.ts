/**
 * The offline stand-ins for Google and OpenAI, shared by the two tests that
 * drive the whole pipeline: `src/lib/planner/pipeline.test.ts` and
 * `src/app/api/plan/route.test.ts`.
 *
 * They live in `__tests__/` for the reason AGENTS.md gives — this is
 * cross-module material, used from two directories — and they are shaped like
 * the real services rather than like the assertions that consume them:
 *
 * - the Places fake answers the **three** endpoints retrieval, hydration and
 *   photo resolution actually call, and pages its results the way a real Text
 *   Search does, so a run costs the same number of calls it would in production;
 * - the OpenAI fake reads the payload it was sent and answers from it. Pass B's
 *   response names ids out of that day's own cluster, which is the only way the
 *   membership check downstream can be exercised at all.
 *
 * Every call is recorded, because "what did we bill for" is the question these
 * fakes exist to answer.
 */

import type { CandidatePlace } from '../types'
import type { FetchLike, HttpResponse } from '../http'
import { MODELS, type ResponsesClient, type ResponsesRequest, type ResponsesResult } from '../openai'
import { isRestaurant } from '../taxonomy'

// ── Google Places ────────────────────────────────────────────────────────────

const PRICE_LEVEL_NAMES = [
  'PRICE_LEVEL_FREE',
  'PRICE_LEVEL_INEXPENSIVE',
  'PRICE_LEVEL_MODERATE',
  'PRICE_LEVEL_EXPENSIVE',
  'PRICE_LEVEL_VERY_EXPENSIVE',
]

/** A `CandidatePlace` fixture rendered back into the JSON Google would send. */
export function toRawPlace(place: CandidatePlace): Record<string, unknown> {
  return {
    id: place.placeId,
    displayName: { text: place.name },
    formattedAddress: `${place.name}, Kyoto`,
    ...(place.latitude === undefined
      ? {}
      : { location: { latitude: place.latitude, longitude: place.longitude } }),
    types: place.types,
    ...(place.primaryType === undefined ? {} : { primaryType: place.primaryType }),
    ...(place.rating === undefined ? {} : { rating: place.rating }),
    ...(place.userRatingCount === undefined ? {} : { userRatingCount: place.userRatingCount }),
    ...(place.priceLevel === undefined ? {} : { priceLevel: PRICE_LEVEL_NAMES[place.priceLevel] }),
    ...(place.openingPeriods === undefined
      ? {}
      : { regularOpeningHours: { periods: place.openingPeriods } }),
    ...(place.businessStatus === undefined ? {} : { businessStatus: place.businessStatus }),
    photos: [{ name: `places/${place.placeId}/photos/photo-1` }],
  }
}

export interface FakeGoogleOptions {
  places: readonly CandidatePlace[]
  /** `servesVegetarianFood` by place id, returned by the shortlist Details call. */
  servesVegetarianFood?: Readonly<Record<string, boolean>>
  /** Review text by place id. Absent means Google had nothing to say. */
  reviews?: Readonly<Record<string, readonly string[]>>
  /** Place ids whose photo media call fails. */
  photoFailures?: readonly string[]
}

export interface FakeGoogle {
  fetch: FetchLike
  /** Every URL asked for, in order. */
  calls: string[]
  searchCalls: string[]
  detailsCalls: string[]
  /** Photo resource names turned into an image — the billed Photos SKU. */
  mediaCalls: string[]
}

const SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText'

/**
 * A Places stand-in over a fixture pool.
 *
 * Text Search pages: each distinct query gets its own offset into the pool and
 * takes `pageSize` places, wrapping. That is what makes the fake worth having —
 * a fake that returned the whole pool for every query would hide the fact that
 * retrieval is many small billed calls whose union is the candidate set.
 */
export function createFakeGoogle(options: FakeGoogleOptions): FakeGoogle {
  const pool = [...options.places]
  const queryOffsets = new Map<string, number>()
  const calls: string[] = []
  const searchCalls: string[] = []
  const detailsCalls: string[] = []
  const mediaCalls: string[] = []

  const json = (body: unknown): HttpResponse => ({
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify(body)
    },
    async json() {
      return body
    },
  })

  const failure = (status: number, message: string): HttpResponse => ({
    ok: false,
    status,
    async text() {
      return message
    },
    async json() {
      return { error: message }
    },
  })

  const fetch: FetchLike = async (url, init) => {
    calls.push(url)

    if (url === SEARCH_URL) {
      const body = JSON.parse(init.body ?? '{}') as { textQuery: string; pageSize?: number }
      searchCalls.push(body.textQuery)
      const pageSize = body.pageSize ?? 20
      if (!queryOffsets.has(body.textQuery)) {
        queryOffsets.set(body.textQuery, (queryOffsets.size * pageSize) % Math.max(1, pool.length))
      }
      const offset = queryOffsets.get(body.textQuery)!
      const page = Array.from({ length: Math.min(pageSize, pool.length) }, (_, i) =>
        toRawPlace(pool[(offset + i) % pool.length]),
      )
      return json({ places: page })
    }

    const media = /\/v1\/places\/([^/]+)\/photos\/([^/]+)\/media/.exec(url)
    if (media) {
      const placeId = decodeURIComponent(media[1])
      mediaCalls.push(`places/${placeId}/photos/${media[2]}`)
      if (options.photoFailures?.includes(placeId)) {
        return failure(404, 'photo is gone')
      }
      return json({ photoUri: `https://lh3.googleusercontent.com/${placeId}` })
    }

    const details = /\/v1\/places\/([^/?]+)$/.exec(url)
    if (details) {
      const placeId = decodeURIComponent(details[1])
      detailsCalls.push(placeId)
      const reviews = options.reviews?.[placeId]
      const serves = options.servesVegetarianFood?.[placeId]
      return json({
        ...(reviews ? { reviews: reviews.map((text) => ({ rating: 5, text: { text } })) } : {}),
        ...(serves === undefined ? {} : { servesVegetarianFood: serves }),
      })
    }

    throw new Error(`the Google fake was asked for an endpoint it does not serve: ${url}`)
  }

  return { fetch, calls, searchCalls, detailsCalls, mediaCalls }
}

// ── OpenAI ───────────────────────────────────────────────────────────────────

interface AssignPayload {
  days: { day: number; cluster_id: string }[]
  clusters: {
    cluster_id: string
    candidates: { place_id: string; name: string; types: string[] }[]
  }[]
}

export interface FakeResponsesOptions {
  /** Throw on every call — the "Pass B is down" case. */
  fail?: 'assign' | 'narrate' | 'all'
  /** The error the failing call throws. */
  error?: Error
}

export interface FakeResponses extends ResponsesClient {
  requests: ResponsesRequest[]
}

/**
 * A Responses stand-in that answers from the payload it was sent.
 *
 * Pass B's answer is the same shape the Gate A harness's `assignDay` produces —
 * two meals with sights around them, the next sight held back as flex — but
 * built by *reading the request*, so an id it names is always an id that day's
 * cluster actually contains. A fake that invented ids would exercise the drop
 * path and nothing else.
 */
export function createFakeResponses(options: FakeResponsesOptions = {}): FakeResponses {
  const requests: ResponsesRequest[] = []
  const boom = options.error ?? new Error('OpenAI 429 rate_limit_exceeded')

  return {
    requests,
    async create(request): Promise<ResponsesResult> {
      requests.push(request)
      const isAssign = request.model === MODELS.assign
      if (options.fail === 'all' || options.fail === (isAssign ? 'assign' : 'narrate')) throw boom

      const content = request.input.at(-1)!.content
      if (typeof content !== 'string') throw new Error('Fake expects a text payload')
      const payload = JSON.parse(content) as Record<string, unknown>
      return {
        output_text: isAssign
          ? JSON.stringify(assignmentFor(payload as unknown as AssignPayload))
          : JSON.stringify(narrationFor(payload)),
        usage: { input_tokens: 500, output_tokens: 100, input_tokens_details: { cached_tokens: 0 } },
      }
    },
  }
}

function assignmentFor(payload: AssignPayload) {
  return {
    days: payload.days.map((day) => {
      const cluster = payload.clusters.find((c) => c.cluster_id === day.cluster_id)
      const candidates = cluster?.candidates ?? []
      const eats = candidates.filter((c) => isRestaurant({ types: c.types }))
      const sights = candidates.filter((c) => !isRestaurant({ types: c.types }))
      const layout: [(typeof sights)[number] | undefined, string][] = [
        [sights[0], 'activity'],
        [eats[0], 'lunch'],
        [sights[1], 'activity'],
        [sights[2], 'activity'],
        [sights[3], 'activity'],
        [eats[1], 'dinner'],
        [sights[4], 'activity'],
      ]
      return {
        day: day.day,
        area_name: candidates[0]?.name ?? null,
        assignments: layout.flatMap(([entry, slot_role]) =>
          entry ? [{ slot_role, place_id: entry.place_id, why: 'it fits your interests' }] : [],
        ),
        flex: sights[5] ? [{ place_id: sights[5].place_id, why: 'a spare if you have time' }] : [],
      }
    }),
  }
}

function narrationFor(payload: Record<string, unknown>) {
  const place = payload.place as { place_id: string; name: string }
  return {
    place_id: place.place_id,
    why_for_you: `You asked for places like this, and ${place.name} is one of the good ones.`,
    highlights: ['the courtyard', 'the view from the terrace'],
    // Dishes are grounded in `signature_dishes`, and an unenriched place has
    // none — so the honest answer is no recommendations at all.
    food_recommendations: null,
    tips: ['Go early if you can.'],
  }
}
