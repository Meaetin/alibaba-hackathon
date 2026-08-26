/**
 * The one great-circle distance in the planner.
 *
 * It takes **definite** coordinates, because the three callers disagree about
 * what a missing one means and each is right in its own place: a travel leg
 * with no coordinates is zero minutes, a place with no coordinates joins no
 * theme, and a borrowable restaurant with no coordinates sorts last. Folding
 * those into one default would give two of them the wrong answer silently, so
 * the guard stays at the call site and only the trigonometry is shared.
 */

/** Metres between two points on the earth's surface. */
export function metersBetween(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): number {
  const EARTH_RADIUS_M = 6_371_000;
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(to.latitude - from.latitude);
  const dLng = rad(to.longitude - from.longitude);
  const half =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(from.latitude)) * Math.cos(rad(to.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(half)));
}
