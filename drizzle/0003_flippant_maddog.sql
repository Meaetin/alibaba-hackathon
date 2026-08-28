ALTER TABLE "enrichment_batches" ADD COLUMN "failures" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "itineraries" ADD COLUMN "planner_debug" jsonb;