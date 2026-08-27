import { describe, expect, it } from "vitest";

import {
  getNextRandomBannerIndex,
  TRAVEL_PROFILE_BANNERS,
} from "./banner-images";

describe("getNextRandomBannerIndex", () => {
  it("always selects a different banner", () => {
    for (let current = 0; current < TRAVEL_PROFILE_BANNERS.length; current += 1) {
      expect(getNextRandomBannerIndex(current, () => 0)).not.toBe(current);
      expect(getNextRandomBannerIndex(current, () => 0.999)).not.toBe(current);
    }
  });

  it("keeps the selected index inside the travel banner pool", () => {
    const next = getNextRandomBannerIndex(3, () => 0.5);

    expect(next).toBeGreaterThanOrEqual(0);
    expect(next).toBeLessThan(TRAVEL_PROFILE_BANNERS.length);
  });

  it("uses consistent optimized Unsplash parameters", () => {
    for (const banner of TRAVEL_PROFILE_BANNERS) {
      expect(banner.src).toContain("images.unsplash.com/photo-");
      expect(banner.src).toContain("auto=format&fit=crop&w=1800&q=85");
      expect(banner.alt.length).toBeGreaterThan(0);
    }
  });
});
