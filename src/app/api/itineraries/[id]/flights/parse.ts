/**
 * Request bodies into flight rows, for both flight routes.
 *
 * It sits beside the handlers rather than inside one because **a Next.js route
 * file may only export the handler and the known config fields** — the same
 * constraint that put `deps.ts` one file across. `route.ts` and
 * `[flightId]/route.ts` both parse, and two copies of this would eventually
 * disagree about what a valid flight is.
 *
 * Nothing here is a route. `parse.ts` is not a filename Next treats specially.
 */

import type { FlightInput, FlightPatch, FlightSource } from "@/lib/db/flights";

/** ISO calendar date, `YYYY-MM-DD`. A `date` column rejects anything else. */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The three the table's check constraint allows. One list, not two. */
const SOURCES: ReadonlySet<string> = new Set<FlightSource>(["booked", "manual", "extracted"]);

/**
 * Every column a browser is allowed to write, minus the two dates, which are
 * handled apart because they are the only required ones.
 *
 * An allowlist rather than a spread: the body comes from a browser, and a `set`
 * built from it directly would be a way to write `id`, `itinerary_id`, or
 * `created_at`.
 *
 * **`toColumns` in `src/lib/db/flights.ts` is a second allowlist over the same
 * fields, and either one alone holds the line.** Mutation-checked: turning
 * *either* into a spread leaves every test green, and only turning both red
 * fails the assertion in `route.test.ts` that a caller cannot choose an id.
 * That is defence in depth rather than a redundancy to tidy away — but it does
 * mean a green suite is not evidence that the layer you are editing works.
 */
const TEXT_FIELDS = [
  "flight_number", "airline", "depart_time", "depart_airport_code", "depart_city",
  "depart_country", "arrive_time", "arrive_airport_code", "arrive_city",
  "arrive_country", "confirmation", "fare_class", "currency", "terminal",
  "baggage_allowance", "ticket_number", "seat", "passenger_name",
] as const;

/** A trimmed non-empty string, or undefined. An empty field is not a value. */
function text(raw: Record<string, unknown>, key: string): string | undefined {
  const value = raw[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * A fare arrives as a string from the manual form and as a number from a
 * booking. The column is text — see the note on `cost` in `schema.ts`.
 */
function cost(raw: Record<string, unknown>): string | undefined {
  const value = raw.cost;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : undefined;
  return text(raw, "cost");
}

function duration(raw: Record<string, unknown>): number | undefined {
  const value = raw.duration_minutes;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * A source label, or undefined when the caller sent something else.
 *
 * An invalid one is dropped rather than failing the write: the flight is real
 * either way, and refusing to save a traveller's booking over a label would
 * lose the thing that matters to keep the thing that does not.
 */
function source(raw: Record<string, unknown>): FlightSource | undefined {
  const value = text(raw, "source");
  return value && SOURCES.has(value) ? (value as FlightSource) : undefined;
}

/**
 * Insert values for a create, or null when the body is not a flight.
 *
 * The two dates are the only required fields, matching the two `notNull`
 * columns. `arrive_date` falls back to `depart_date`, because a same-day hop is
 * the common case and the manual form leaves the field empty for it.
 */
export function toFlightInput(body: unknown): FlightInput | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const raw = body as Record<string, unknown>;

  const depart_date = text(raw, "depart_date");
  const arrive_date = text(raw, "arrive_date") ?? depart_date;
  if (!depart_date || !arrive_date) return null;
  if (!DATE_PATTERN.test(depart_date) || !DATE_PATTERN.test(arrive_date)) return null;

  const input: FlightInput = {
    source: source(raw) ?? "manual",
    depart_date,
    arrive_date,
    duration_minutes: duration(raw) ?? null,
    cost: cost(raw) ?? null,
    status: text(raw, "status") ?? "confirmed",
  };
  for (const field of TEXT_FIELDS) input[field] = text(raw, field) ?? null;
  return input;
}

/**
 * The changed columns for an edit, or null when the body is unusable.
 *
 * **A key the caller did not send is absent from the result, not null.** That
 * is the whole difference between a patch and a replace: collapsing the two
 * would make an edit carrying one field wipe every other field on the row.
 * A date sent in the wrong shape fails the patch rather than being dropped —
 * silently ignoring it would report success on an edit that did not happen.
 */
export function toFlightPatch(body: unknown): FlightPatch | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const raw = body as Record<string, unknown>;

  const patch: FlightPatch = {};

  for (const key of ["depart_date", "arrive_date"] as const) {
    if (!(key in raw)) continue;
    const value = text(raw, key);
    if (!value || !DATE_PATTERN.test(value)) return null;
    patch[key] = value;
  }

  for (const field of TEXT_FIELDS) {
    if (!(field in raw)) continue;
    patch[field] = text(raw, field) ?? null;
  }

  if ("duration_minutes" in raw) patch.duration_minutes = duration(raw) ?? null;
  if ("cost" in raw) patch.cost = cost(raw) ?? null;
  if ("status" in raw) patch.status = text(raw, "status") ?? "confirmed";

  const label = source(raw);
  if (label) patch.source = label;

  return patch;
}
