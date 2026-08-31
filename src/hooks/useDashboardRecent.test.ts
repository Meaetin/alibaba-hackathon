// @vitest-environment jsdom
//
// jsdom is scoped to this hook test. The planner suite relies on the global
// Vitest environment remaining `node`.

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getCollections, type CollectionWithRole } from "@/lib/api/collections";
import { getContent } from "@/lib/api/content";
import { getItineraries } from "@/lib/api/itineraries";
import { useDashboardRecent } from "./useDashboardRecent";

vi.mock("@/lib/api/collections", () => ({ getCollections: vi.fn() }));
vi.mock("@/lib/api/content", () => ({ getContent: vi.fn() }));
vi.mock("@/lib/api/itineraries", () => ({ getItineraries: vi.fn() }));

function makeCollection(overrides: Partial<CollectionWithRole> = {}): CollectionWithRole {
  return {
    id: "collection-thailand",
    name: "Thailand",
    tags: [],
    owner_id: "user-1",
    is_public: false,
    is_bookmarked: true,
    is_archived: false,
    fork_count: 0,
    created_at: "2026-08-28T10:00:00.000Z",
    updated_at: "2026-08-29T10:00:00.000Z",
    user_role: "owner",
    location_count: 2,
    preview_images: ["https://images.example.com/bangkok.jpg"],
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(getItineraries).mockResolvedValue([]);
  vi.mocked(getCollections).mockResolvedValue([]);
  vi.mocked(getContent).mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useDashboardRecent", () => {
  it("includes non-archived collections in the recent Home feed", async () => {
    vi.mocked(getCollections).mockResolvedValue([
      makeCollection(),
      makeCollection({ id: "collection-archived", name: "Old trip", is_archived: true }),
    ]);

    const { result } = renderHook(() =>
      useDashboardRecent({ userId: "user-1", filter: "recent", sortOption: "modified" }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(getCollections).toHaveBeenCalledOnce();
    expect(result.current.items).toEqual([
      {
        id: "collection-thailand",
        type: "collection",
        name: "Thailand",
        thumbnail_url: null,
        preview_images: ["https://images.example.com/bangkok.jpg"],
        updated_at: "2026-08-29T10:00:00.000Z",
        is_bookmarked: true,
        is_archived: false,
      },
    ]);
  });

  it("loads only collections for the collection filter", async () => {
    vi.mocked(getCollections).mockResolvedValue([makeCollection()]);

    const { result } = renderHook(() =>
      useDashboardRecent({ userId: "user-1", filter: "collection", sortOption: "modified" }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(getCollections).toHaveBeenCalledOnce();
    expect(getItineraries).not.toHaveBeenCalled();
    expect(getContent).not.toHaveBeenCalled();
    expect(result.current.items.map((item) => item.type)).toEqual(["collection"]);
  });
});
