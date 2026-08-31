// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import type { QueueJob } from "./types";
import { announceLinkJob, LINK_JOB_CREATED_EVENT } from "./events";

describe("link job events", () => {
  it("hands the created job to every mounted queue", () => {
    const job = { id: "link-job-1", type: "content-analysis" } as QueueJob;
    const listener = vi.fn<(event: Event) => void>();
    window.addEventListener(LINK_JOB_CREATED_EVENT, listener);

    announceLinkJob(job);

    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0][0] as CustomEvent<QueueJob>).detail).toBe(job);
    window.removeEventListener(LINK_JOB_CREATED_EVENT, listener);
  });
});
