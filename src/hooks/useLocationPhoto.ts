"use client";

import { useEffect, useState } from "react";

import {
  cachedLocationPhoto,
  fetchLocationPhoto,
  type LocationPhotoQuery,
} from "@/lib/api/photos";

/**
 * Destination photo for a place, from the API's `unsplash_cache` pool — the
 * same pool the worker picks itinerary and collection thumbnails from, so a
 * placeholder photo and the saved thumbnail show the same destination.
 *
 * `isPending` separates "still looking" from "there is no photo": a cached hit
 * resolves synchronously and never pends, while a destination nobody has
 * planned before takes an Unsplash round trip. Callers that want a loading
 * state need the difference — the two look identical through `url` alone.
 */
export function useLocationPhoto(
  location: LocationPhotoQuery | undefined | null,
  skip = false,
): { url: string | null; isPending: boolean } {
  const region = location?.region?.trim() ?? "";
  const country = location?.country?.trim() ?? "";
  const seed = location?.seed ?? "";

  const [url, setUrl] = useState<string | null>(() =>
    cachedLocationPhoto({ region, country, seed }),
  );
  const [isPending, setIsPending] = useState(
    () =>
      !skip && Boolean(region || country) && !cachedLocationPhoto({ region, country, seed }),
  );

  useEffect(() => {
    if (skip || (!region && !country)) {
      setIsPending(false);
      return;
    }

    const cached = cachedLocationPhoto({ region, country, seed });
    if (cached) {
      setUrl(cached);
      setIsPending(false);
      return;
    }

    let cancelled = false;
    setIsPending(true);
    fetchLocationPhoto({ region, country, seed }).then((photo) => {
      if (cancelled) return;
      if (photo) setUrl(photo);
      setIsPending(false);
    });

    return () => {
      cancelled = true;
    };
  }, [region, country, seed, skip]);

  return { url, isPending };
}
