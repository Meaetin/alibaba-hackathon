CREATE TABLE "content" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"content_url" text NOT NULL,
	"normalized_url" text NOT NULL,
	"content_type" text DEFAULT 'video' NOT NULL,
	"content_title" text,
	"content_thumbnail" text,
	"content_author" text,
	"platform" text,
	"generated_summary" text,
	"primary_country" text,
	"primary_region" text,
	"location_count" integer DEFAULT 0 NOT NULL,
	"processing_status" text DEFAULT 'completed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_user_url_idx" UNIQUE("user_id","normalized_url")
);
--> statement-breakpoint
CREATE TABLE "content_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"mention" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "content_locations_unique_idx" UNIQUE("content_id","location_id")
);
--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_locations" ADD CONSTRAINT "content_locations_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_locations" ADD CONSTRAINT "content_locations_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_user_created_idx" ON "content" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "content_locations_content_idx" ON "content_locations" USING btree ("content_id","position");