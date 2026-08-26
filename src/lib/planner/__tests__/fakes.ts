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
  /**
   * Places only `places:searchNearby` can return — invisible to Text Search.
   *
   * Without these the fake cannot tell a themed run apart from a plain one:
   * every "explored" place would already be in the text-search pool, so a
   * pipeline that dropped the explored half would still look complete. That is
   * the shape of a real bug this suite could not see.
   */
  nearbyOnly?: readonly CandidatePlace[]
}

export interface FakeGoogle {
  fetch: FetchLike
  /** Every URL asked for, in order. */
  calls: string[]
  searchCalls: string[]
  /** One entry per `places:searchNearby` — a different SKU from Text Search,
   *  so counted separately, which is what makes "themes cost N more calls"
   *  assertable. */
  nearbyCalls: { latitude: number; longitude: number; radius: number; includedTypes: string[] }[]
  detailsCalls: string[]
  /** Photo resource names turned into an image — the billed Photos SKU. */
  mediaCalls: string[]
}

const SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText'
const NEARBY_URL = 'https://places.googleapis.com/v1/places:searchNearby'

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
  // Reachable by circle only. Details and photos still answer for them, the
  // way Google does once you hold an id.
  const nearbyPool = [...pool, ...(options.nearbyOnly ?? [])]
  const queryOffsets = new Map<string, number>()
  const calls: string[] = []
  const searchCalls: string[] = []
  const nearbyCalls: FakeGoogle['nearbyCalls'] = []
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

    if (url === NEARBY_URL) {
      const body = JSON.parse(init.body ?? '{}') as {
        maxResultCount?: number
        includedTypes?: string[]
        locationRestriction: { circle: { center: { latitude: number; longitude: number }; radius: number } }
      }
      const { center, radius } = body.locationRestriction.circle
      nearbyCalls.push({
        latitude: center.latitude,
        longitude: center.longitude,
        radius,
        includedTypes: body.includedTypes ?? [],
      })
      // Answers with what is genuinely near the circle's centre, which is the
      // one property a nearby search has that a text search does not. A fake
      // that ignored the circle would let a broken radius pass unnoticed.
      const degrees = radius / 111_320
      const near = nearbyPool.filter(
        (place) =>
          place.latitude !== undefined &&
          Math.abs(place.latitude - center.latitude) <= degrees &&
          Math.abs(place.longitude! - center.longitude) <= degrees,
      )
      return json({ places: near.slice(0, body.maxResultCount ?? 20).map(toRawPlace) })
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

  return { fetch, calls, searchCalls, nearbyCalls, detailsCalls, mediaCalls }
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
  fail?: 'assign' | 'narrate' | 'theme' | 'enrich' | 'all'
  /** The error the failing call throws. */
  error?: Error
  /** Anchor ids the theme fake should name instead of real ones — the
   *  hallucination case, which is the whole reason anchors are verified. */
  hallucinateAnchors?: readonly string[]
  /** Answer enrichment with something that is not an enrichment. A schema
   *  violation is not an exception, so it is the one enrichment failure the
   *  `fail` switch above cannot produce. */
  enrichmentGarbage?: boolean
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

      // The theme pass shares `MODELS.assign`, so the model name cannot tell
      // the two apart — the payload can. Dispatching on shape also means a
      // renamed model does not silently route a call to the wrong answer.
      const content = userContentOf(request)
      const payload = JSON.parse(content) as Record<string, unknown>
      const isTheme = 'survey' in payload
      if (isTheme && options.fail === 'theme') throw boom
      // Enrichment shares `MODELS.enrich` with nothing, but it shares the model
      // *name* with narration — so this dispatches on shape like the theme case
      // above. `buildEnrichmentInput` is the only payload with `reviewSnippets`.
      const isEnrich = 'reviewSnippets' in payload
      if (isEnrich && options.fail === 'enrich') throw boom
      return {
        output_text: isTheme
          ? JSON.stringify(themesFor(payload as unknown as ThemePayload, options))
          : isAssign
            ? JSON.stringify(assignmentFor(payload as unknown as AssignPayload))
            : isEnrich
              ? JSON.stringify(enrichmentFor(payload as unknown as EnrichPayload, options))
              : JSON.stringify(narrationFor(payload)),
        usage: { input_tokens: 500, output_tokens: 100, input_tokens_details: { cached_tokens: 0 } },
      }
    },
  }
}

interface EnrichPayload {
  name: string
  types: string[]
}

/**
 * A deterministic enrichment, derived from the payload so two places never get
 * the same answer.
 *
 * `visitMinutes` is the field that matters: it is rung 2 of the ladder in
 * `duration.ts` and outranks the type table, so a test that wants to prove the
 * live path reached the packer asserts on a duration only this can produce.
 * Deliberately not a round number a type heuristic could also land on.
 */
function enrichmentFor(payload: EnrichPayload, options: FakeResponsesOptions) {
  if (options.enrichmentGarbage) return { not: 'an enrichment' }
  const spread = (payload.name.length % 4) * 5
  return {
    description: `${payload.name} is worth the detour.`,
    tags: payload.types.slice(0, 2).map((type) => `fake-${type}`),
    confidence: 0.5,
    visitMinutesMin: 35 + spread,
    visitMinutesMax: 95 + spread,
    signatureDishes: [],
    bestTimeOfDay: null,
    crowdProfile: null,
  }
}

interface ThemePayload {
  city: string
  days: { day: number; weekday: number }[]
  survey: {
    areas: {
      area: number
      landmarks: { place_id: string; name: string; types: string[] }[]
    }[]
  }
}

/**
 * One theme per day, anchored on the best-known place in the day's own area —
 * which is what a model doing this job properly would land on, and, crucially,
 * always a real id. A fake that invented ids would exercise the rejection path
 * and nothing else; `hallucinateAnchors` is how a test asks for that on purpose.
 */
function themesFor(payload: ThemePayload, options: FakeResponsesOptions) {
  return {
    themes: payload.days.map((day, index) => {
      const area = payload.survey.areas[index % Math.max(1, payload.survey.areas.length)]
      const landmark = area?.landmarks[0]
      const anchor = options.hallucinateAnchors?.[index] ?? landmark?.place_id ?? 'missing'
      return {
        day: day.day,
        title: `Around ${landmark?.name ?? 'town'}`,
        premise: `A day built around ${landmark?.name ?? 'the centre'} and what is walkable from it.`,
        anchor_place_id: anchor,
        included_types: landmark?.types.slice(0, 3) ?? ['tourist_attraction'],
        radius_hint: 'walkable',
      }
    }),
  }
}

/** The last text block, whichever role it carries. The theme request appends a
 *  developer block after the payload when the traveller has a persona. */
function userContentOf(request: ResponsesRequest): string {
  for (let i = request.input.length - 1; i >= 0; i--) {
    const block = request.input[i]
    if (block.role === 'user' && typeof block.content === 'string') return block.content
  }
  throw new Error('Fake expects a text payload')
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
