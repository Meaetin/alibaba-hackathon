import type { QueueJob } from "./types";

export const PLANNING_JOB_CREATED_EVENT = "argo:planning-job-created";
export const LINK_JOB_CREATED_EVENT = "argo:link-job-created";

/** Lets the persistent layout keep polling when the page that created a local
 * plan navigates away. Page queues still render the card from the same query. */
export function announcePlanningJob(job: QueueJob): void {
  window.dispatchEvent(new CustomEvent<QueueJob>(PLANNING_JOB_CREATED_EVENT, { detail: job }));
}

/** Lets the persistent layout and whichever listing page is mounted observe
 * the same link-analysis job immediately. The layout owns notifications; Home
 * and `/links` own the visible progress card. */
export function announceLinkJob(job: QueueJob): void {
  window.dispatchEvent(new CustomEvent<QueueJob>(LINK_JOB_CREATED_EVENT, { detail: job }));
}
