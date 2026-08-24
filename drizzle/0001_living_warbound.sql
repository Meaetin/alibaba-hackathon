ALTER TABLE "locations" ADD COLUMN "editorial_summary" text;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "review_summary" text;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "serves_vegetarian_food" boolean;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "shortlist_hydrated_at" timestamp with time zone;