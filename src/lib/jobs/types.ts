import type { JobRow, JobStatus } from "@/lib/db/itineraries";

/**
 * The JSON representation of the Drizzle `jobs` row returned by
 * `GET /api/jobs/:id`. Dates cross the route boundary as ISO strings and the
 * schema's open text status is narrowed to the states the poller handles.
 */
export type QueueJob = Omit<
  JobRow,
  "status" | "progress" | "created_at" | "updated_at"
> & {
  status: JobStatus;
  progress: (NonNullable<JobRow["progress"]> & { thumbnail?: string }) | null;
  created_at: string;
  updated_at: string;
  /** External content-analysis metadata; never written by the local planner. */
  content_id?: string;
  completed_at?: string;
};
