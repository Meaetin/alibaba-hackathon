/**
 * Reads and writes for a trip's flights.
 *
 * It follows `content.ts` and `itineraries.ts` deliberately: a `FlightStore`
 * port with a Postgres implementation and an in-memory double, so the route
 * handlers stay drivable with no database and no mocking framework.
 *
 * **Ownership is not checked here.** A flight belongs to an itinerary and an
 * itinerary belongs to a person, so the guard is one join away and it lives in
 * the route, beside `readItineraryOwner`, the same way `GET /api/itineraries/[id]`
 * does it. A store that silently filtered by owner would be a second place for
 * that rule to be true, and the two would eventually disagree.
 *
 * The row type the UI reads is `ExtractedFlight` — the name is historical (the
 * first flights in this app came out of a PDF) but the shape is the one every
 * flight component already speaks, so nothing here renames a column on the way
 * out. Only `created_at` / `updated_at` are converted, from `Date` to ISO,
 * because JSON has no date.
 */

import { and, asc, eq } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";

import type { ExtractedFlight } from "@/lib/api/flights";

import { itinerary_flights } from "./schema";
import type { Database } from "./client";

export type FlightRow = InferSelectModel<typeof itinerary_flights>;

/** Where a row came from. See the column's own comment in `schema.ts`. */
export type FlightSource = "booked" | "manual" | "extracted";

/**
 * A flight as written. Every field is optional except the two dates, which is
 * what the column definitions say: a flight with no date is not a flight, and
 * everything else is something an airline may simply not have told us.
 */
export interface FlightInput {
  source?: FlightSource;
  flight_number?: string | null;
  airline?: string | null;
  depart_date: string;
  depart_time?: string | null;
  depart_airport_code?: string | null;
  depart_city?: string | null;
  depart_country?: string | null;
  arrive_date: string;
  arrive_time?: string | null;
  arrive_airport_code?: string | null;
  arrive_city?: string | null;
  arrive_country?: string | null;
  duration_minutes?: number | null;
  confirmation?: string | null;
  fare_class?: string | null;
  cost?: string | null;
  currency?: string | null;
  terminal?: string | null;
  baggage_allowance?: string | null;
  ticket_number?: string | null;
  seat?: string | null;
  passenger_name?: string | null;
  status?: string | null;
}

/** An edit. Both dates become optional; nothing else changes. */
export type FlightPatch = Partial<FlightInput>;

export interface FlightStore {
  /** Every flight on a trip, earliest departure first. */
  listByItinerary(itineraryId: string): Promise<ExtractedFlight[]>;
  create(itineraryId: string, input: FlightInput, now: Date): Promise<ExtractedFlight>;
  /** Returns null when the flight is not on that itinerary — which is how a
   *  handler tells "somebody else's flight" from "a flight that changed". */
  update(
    itineraryId: string,
    flightId: string,
    patch: FlightPatch,
    now: Date,
  ): Promise<ExtractedFlight | null>;
  /** True when a row was removed. False means it was already gone or was never
   *  on this trip; both are the same answer to the caller. */
  remove(itineraryId: string, flightId: string): Promise<boolean>;
}

const ISO = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : value;

/**
 * A row as the flight components read it.
 *
 * `created_by` is pinned to the empty string: `ExtractedFlight` requires it and
 * this table has no such column, because a flight's owner is its itinerary's
 * owner and storing a second copy is a second thing to keep true. Same for
 * `source_attachment_id` — PDF extraction is not wired in this repo, so no row
 * here has ever come from an attachment.
 */
function toExtractedFlight(row: FlightRow): ExtractedFlight {
  return {
    id: row.id,
    itinerary_id: row.itinerary_id,
    created_by: "",
    flight_number: row.flight_number ?? undefined,
    airline: row.airline ?? undefined,
    depart_date: row.depart_date,
    depart_time: row.depart_time ?? undefined,
    depart_airport_code: row.depart_airport_code ?? undefined,
    depart_city: row.depart_city ?? undefined,
    depart_country: row.depart_country ?? undefined,
    arrive_date: row.arrive_date,
    arrive_time: row.arrive_time ?? undefined,
    arrive_airport_code: row.arrive_airport_code ?? undefined,
    arrive_city: row.arrive_city ?? undefined,
    arrive_country: row.arrive_country ?? undefined,
    duration_minutes: row.duration_minutes ?? undefined,
    confirmation: row.confirmation ?? undefined,
    fare_class: row.fare_class ?? undefined,
    cost: row.cost ?? undefined,
    currency: row.currency ?? undefined,
    terminal: row.terminal ?? undefined,
    baggage_allowance: row.baggage_allowance ?? undefined,
    ticket_number: row.ticket_number ?? undefined,
    seat: row.seat ?? undefined,
    passenger_name: row.passenger_name ?? undefined,
    status: (row.status as ExtractedFlight["status"]) ?? undefined,
    source: row.source as FlightSource,
    source_attachment_id: null,
    created_at: ISO(row.created_at),
    updated_at: ISO(row.updated_at),
  };
}

/**
 * The insert values for an input.
 *
 * `undefined` and `null` are collapsed to `null` on purpose: on a create there
 * is no prior value for "leave this alone" to mean, so a field nobody sent is a
 * field this flight does not have. `update` treats them differently — see there.
 */
function toColumns(input: FlightInput) {
  return {
    source: input.source ?? "manual",
    flight_number: input.flight_number ?? null,
    airline: input.airline ?? null,
    depart_date: input.depart_date,
    depart_time: input.depart_time ?? null,
    depart_airport_code: input.depart_airport_code ?? null,
    depart_city: input.depart_city ?? null,
    depart_country: input.depart_country ?? null,
    arrive_date: input.arrive_date,
    arrive_time: input.arrive_time ?? null,
    arrive_airport_code: input.arrive_airport_code ?? null,
    arrive_city: input.arrive_city ?? null,
    arrive_country: input.arrive_country ?? null,
    duration_minutes: input.duration_minutes ?? null,
    confirmation: input.confirmation ?? null,
    fare_class: input.fare_class ?? null,
    cost: input.cost ?? null,
    currency: input.currency ?? null,
    terminal: input.terminal ?? null,
    baggage_allowance: input.baggage_allowance ?? null,
    ticket_number: input.ticket_number ?? null,
    seat: input.seat ?? null,
    passenger_name: input.passenger_name ?? null,
    status: input.status ?? "confirmed",
  };
}

/**
 * The changed columns for a patch, and **only** the ones the caller named.
 *
 * A key that is absent means "leave it alone"; a key sent as `null` means
 * "clear it". Collapsing the two the way `toColumns` does would make a PATCH
 * carrying one field wipe every other field on the row — which is the whole
 * difference between a patch and a replace.
 */
function toPatchColumns(patch: FlightPatch): Record<string, unknown> {
  const columns: Record<string, unknown> = {};
  const keys = [
    "source", "flight_number", "airline", "depart_date", "depart_time",
    "depart_airport_code", "depart_city", "depart_country", "arrive_date",
    "arrive_time", "arrive_airport_code", "arrive_city", "arrive_country",
    "duration_minutes", "confirmation", "fare_class", "cost", "currency",
    "terminal", "baggage_allowance", "ticket_number", "seat", "passenger_name",
    "status",
  ] as const;

  for (const key of keys) {
    if (!(key in patch)) continue;
    const value = patch[key];
    if (value === undefined) continue;
    columns[key] = value;
  }
  return columns;
}

export function createFlightStore(db: Database): FlightStore {
  return {
    async listByItinerary(itineraryId) {
      const rows = await db
        .select()
        .from(itinerary_flights)
        .where(eq(itinerary_flights.itinerary_id, itineraryId))
        .orderBy(asc(itinerary_flights.depart_date), asc(itinerary_flights.created_at));
      return rows.map(toExtractedFlight);
    },

    async create(itineraryId, input, now) {
      const [row] = await db
        .insert(itinerary_flights)
        .values({
          itinerary_id: itineraryId,
          ...toColumns(input),
          created_at: now,
          updated_at: now,
        })
        .returning();
      return toExtractedFlight(row);
    },

    async update(itineraryId, flightId, patch, now) {
      const columns = toPatchColumns(patch);
      // An empty patch still stamps `updated_at`, and still has to answer
      // whether the flight exists — so it is a write, not an early return.
      const [row] = await db
        .update(itinerary_flights)
        .set({ ...columns, updated_at: now })
        .where(
          and(
            eq(itinerary_flights.id, flightId),
            eq(itinerary_flights.itinerary_id, itineraryId),
          ),
        )
        .returning();
      return row ? toExtractedFlight(row) : null;
    },

    async remove(itineraryId, flightId) {
      const rows = await db
        .delete(itinerary_flights)
        .where(
          and(
            eq(itinerary_flights.id, flightId),
            eq(itinerary_flights.itinerary_id, itineraryId),
          ),
        )
        .returning({ id: itinerary_flights.id });
      return rows.length > 0;
    },
  };
}

/**
 * The double the route tests drive.
 *
 * Ids are deterministic and carry the store's own sequence, for the reason
 * `signedIn()` in the auth tests learned the hard way: two doubles whose
 * counters both restart at 1 hand out the same id, and every "this is not that"
 * assertion silently becomes a comparison of a thing with itself.
 */
export function createInMemoryFlightStore(seed?: {
  rows?: FlightRow[];
}): FlightStore & { rows: Map<string, FlightRow> } {
  const rows = new Map<string, FlightRow>((seed?.rows ?? []).map((row) => [row.id, row]));
  let sequence = 0;
  const nextId = () => `00000000-0000-4000-a000-${String(++sequence).padStart(12, "0")}`;

  const sorted = (itineraryId: string) =>
    [...rows.values()]
      .filter((row) => row.itinerary_id === itineraryId)
      .sort(
        (a, b) =>
          a.depart_date.localeCompare(b.depart_date) ||
          ISO(a.created_at).localeCompare(ISO(b.created_at)),
      );

  return {
    rows,

    async listByItinerary(itineraryId) {
      return sorted(itineraryId).map(toExtractedFlight);
    },

    async create(itineraryId, input, now) {
      const row: FlightRow = {
        id: nextId(),
        itinerary_id: itineraryId,
        ...toColumns(input),
        created_at: now,
        updated_at: now,
      };
      rows.set(row.id, row);
      return toExtractedFlight(row);
    },

    async update(itineraryId, flightId, patch, now) {
      const existing = rows.get(flightId);
      if (!existing || existing.itinerary_id !== itineraryId) return null;
      const next = { ...existing, ...toPatchColumns(patch), updated_at: now } as FlightRow;
      rows.set(flightId, next);
      return toExtractedFlight(next);
    },

    async remove(itineraryId, flightId) {
      const existing = rows.get(flightId);
      if (!existing || existing.itinerary_id !== itineraryId) return false;
      rows.delete(flightId);
      return true;
    },
  };
}
