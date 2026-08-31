// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { QueueJob } from "@/lib/jobs/types";
import { LinkQueueCardItem } from "./LinkQueueCardItem";

function makeJob(): QueueJob {
  const now = new Date().toISOString();
  return {
    id: "link-job-1",
    type: "content-analysis",
    status: "queued",
    itinerary_id: null,
    payload: { url: "https://www.tiktok.com/@traveller/video/123" },
    result: null,
    error: null,
    progress: null,
    created_at: now,
    updated_at: now,
  };
}

afterEach(cleanup);

describe("LinkQueueCardItem", () => {
  it("renders a queued link as a dismissible Home-sized progress card", () => {
    const onRemove = vi.fn();

    render(
      <LinkQueueCardItem
        job={makeJob()}
        onRemove={onRemove}
        onRetry={async () => {}}
      />,
    );

    expect(screen.getByText("https://www.tiktok.com/@traveller/video/123")).toBeTruthy();
    expect(screen.getByText("Waiting...")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Remove from queue" }));
    expect(onRemove).toHaveBeenCalledWith("link-job-1");
  });
});
