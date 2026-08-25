import { afterEach, describe, expect, it, vi } from "vitest";

import { LOCAL_DEMO_PROFILE } from "@/lib/planner/demo-profile";
import { createItineraryRouted } from "./itineraries";

const JOB = {
  id: "00000000-0000-4000-8000-000000000001",
  type: "itinerary-planning",
  status: "queued" as const,
  itinerary_id: null,
  payload: null,
  result: null,
  error: null,
  progress: null,
  created_at: "2026-08-24T09:00:00.000Z",
  updated_at: "2026-08-24T09:00:00.000Z",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createItineraryRouted localhost planning", () => {
  it("sends AI-only creation to the local planner with the explicit demo profile", async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 202,
      json: async () => JOB,
    })) as unknown as typeof globalThis.fetch;
    vi.stubGlobal("fetch", fetch);

    const result = await createItineraryRouted({
      source: "itineraries",
      tripName: "Kyoto week",
      country: "Japan",
      region: "Kyoto",
      startDate: "2026-09-14",
      totalDays: 4,
      selectedLocationIds: [],
      aiRecommendations: true,
    });

    expect(result).toEqual({ kind: "planning", job: JOB });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/plan");
    expect(JSON.parse(String(init?.body))).toEqual({
      city: "Kyoto",
      country: "Japan",
      startDate: "2026-09-14",
      totalDays: 4,
      name: "Kyoto week",
      profile: LOCAL_DEMO_PROFILE,
      // The product default lives here, not in `runPlan` — a library default
      // that changes behaviour silently is a trap.
      mode: "themed",
    });
  });

  it("sends the pace the traveller chose, over the demo default", async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 202,
      json: async () => JOB,
    })) as unknown as typeof globalThis.fetch;
    vi.stubGlobal("fetch", fetch);

    await createItineraryRouted({
      source: "itineraries",
      tripName: "Kyoto week",
      country: "Japan",
      region: "Kyoto",
      startDate: "2026-09-14",
      totalDays: 4,
      selectedLocationIds: [],
      aiRecommendations: true,
      pace: "packed",
    });

    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(body.profile.pace).toBe("packed");
    expect(LOCAL_DEMO_PROFILE.pace).toBe("balanced");
  });

  it("does not silently discard selected place ids", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    await expect(
      createItineraryRouted({
        source: "collection_detail",
        tripName: "Pinned trip",
        country: "Japan",
        region: "Kyoto",
        startDate: "2026-09-14",
        totalDays: 2,
        selectedLocationIds: ["place-1"],
        aiRecommendations: true,
      }),
    ).rejects.toThrow("Planning from selected places is not available in this demo yet");
    expect(fetch).not.toHaveBeenCalled();
  });
});
