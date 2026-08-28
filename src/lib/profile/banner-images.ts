export interface TravelProfileBanner {
  src: string;
  alt: string;
}

const UNSPLASH_PARAMS = "auto=format&fit=crop&w=1800&q=85";

const unsplashBanner = (photoId: string, alt: string): TravelProfileBanner => ({
  src: `https://images.unsplash.com/photo-${photoId}?${UNSPLASH_PARAMS}`,
  alt,
});

/**
 * A deliberately curated travel-only pool. Keeping the set local makes the
 * randomizer reliable and prevents unrelated search results from appearing on
 * a user's profile. Every image uses the same banner crop, width, and quality.
 */
export const TRAVEL_PROFILE_BANNERS: readonly TravelProfileBanner[] = [
  unsplashBanner(
    "1664309793544-f1d21a3a25d1",
    "A mountain lake in the Italian Dolomites",
  ),
  unsplashBanner(
    "1476514525535-07fb3b4ae5f1",
    "A scenic lake surrounded by mountains",
  ),
  unsplashBanner(
    "1501785888041-af3ef285b470",
    "A traveler overlooking a mountain valley",
  ),
  unsplashBanner(
    "1469854523086-cc02fe5d8800",
    "A road trip through an open landscape",
  ),
  unsplashBanner(
    "1488085061387-422e29b40080",
    "An airplane wing above the clouds",
  ),
  unsplashBanner(
    "1530789253388-582c481c54b0",
    "A tropical coastline viewed from above",
  ),
];

/** Selects a different banner while keeping the result inside the pool. */
export function getNextRandomBannerIndex(
  currentIndex: number,
  rng: () => number = Math.random,
): number {
  if (TRAVEL_PROFILE_BANNERS.length < 2) return 0;

  const safeCurrent =
    Number.isInteger(currentIndex) &&
    currentIndex >= 0 &&
    currentIndex < TRAVEL_PROFILE_BANNERS.length
      ? currentIndex
      : 0;
  const randomValue = Math.min(Math.max(rng(), 0), 0.9999999999999999);
  const offset =
    1 + Math.floor(randomValue * (TRAVEL_PROFILE_BANNERS.length - 1));

  return (safeCurrent + offset) % TRAVEL_PROFILE_BANNERS.length;
}
