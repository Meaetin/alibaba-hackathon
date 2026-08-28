CREATE TABLE "enrichment_batches" (
	"provider_batch_id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"subjects" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "enrichment_batches_status_idx" ON "enrichment_batches" USING btree ("status","created_at");