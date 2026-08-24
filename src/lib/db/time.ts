/**
 * "Code owns the clock" at the storage boundary. `itinerary_activities` stores
 * `start_min` / `end_min` as minutes from midnight — trivially comparable,
 * trivially validatable, impossible to timezone-corrupt. The read handler
 * formats them here, once, for the card components that want `start_time` /
 * `end_time` strings.
 */

const MINUTES_PER_DAY = 1440;

/**
 * `750 → "12:30"`. Accepts `0..1440` inclusive; `1440` is `"24:00"`, which is
 * how a day that ends at midnight reads without looking like it ends at its own
 * start. Anything outside that range is corrupt data, not a display problem, so
 * it throws rather than rendering a plausible lie.
 */
export function formatMinutes(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > MINUTES_PER_DAY) {
    throw new RangeError(`minutes must be an integer in 0..${MINUTES_PER_DAY}, got ${minutes}`);
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}
