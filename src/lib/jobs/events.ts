import type { QueueJob } from "./types";

export const PLANNING_JOB_CREATED_EVENT = "argo:planning-job-created";

/** Lets the persistent layout keep polling when the page that created a local
 * plan navigates away. Page queues still render the card from the same query. */
export function announcePlanningJob(job: QueueJob): void {
  window.dispatchEvent(new CustomEvent<QueueJob>(PLANNING_JOB_CREATED_EVENT, { detail: job }));
}
