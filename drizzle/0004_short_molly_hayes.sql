CREATE TABLE "travel_personas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"answers" jsonb NOT NULL,
	"dimensions" jsonb NOT NULL,
	"archetype" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "itineraries" ADD COLUMN "persona" jsonb;