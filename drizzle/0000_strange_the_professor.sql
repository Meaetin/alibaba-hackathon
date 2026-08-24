CREATE TABLE "area_guides" (
	"area_key" text PRIMARY KEY NOT NULL,
	"highlights" jsonb NOT NULL,
	"narrative" text NOT NULL,
	"model" text NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '90 days' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "itineraries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"city" text NOT NULL,
	"country" text,
	"latitude" double precision,
	"longitude" double precision,
	"start_date" date NOT NULL,
	"total_days" integer NOT NULL,
	"profile" jsonb NOT NULL,
	"funnel_stats" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "itinerary_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day_id" uuid NOT NULL,
	"location_id" uuid,
	"position" integer NOT NULL,
	"slot_role" text NOT NULL,
	"start_min" integer NOT NULL,
	"end_min" integer NOT NULL,
	"score" real,
	"match_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content" jsonb,
	"travel_to_next" jsonb,
	CONSTRAINT "itinerary_activities_day_id_position_key" UNIQUE("day_id","position")
);
--> statement-breakpoint
CREATE TABLE "itinerary_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"itinerary_id" uuid NOT NULL,
	"day_index" integer NOT NULL,
	"date" date NOT NULL,
	"area_name" text,
	CONSTRAINT "itinerary_days_itinerary_id_day_index_key" UNIQUE("itinerary_id","day_index")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text DEFAULT 'itinerary-planning' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"itinerary_id" uuid,
	"payload" jsonb,
	"result" jsonb,
	"error" text,
	"progress" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"place_id" text NOT NULL,
	"name" text NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"primary_type" text,
	"rating" real,
	"user_rating_count" integer,
	"price_level" integer,
	"price_range" jsonb,
	"formatted_address" text,
	"city" text,
	"opening_periods" jsonb,
	"review_snippets" jsonb,
	"photo_names" jsonb,
	"photo_urls" jsonb,
	"photos_resolved_at" timestamp with time zone,
	"business_status" text,
	"stay_duration" integer,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "locations_place_id_unique" UNIQUE("place_id")
);
--> statement-breakpoint
CREATE TABLE "place_enrichments" (
	"place_id" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" real NOT NULL,
	"visit_min" integer,
	"visit_max" integer,
	"signature_dishes" jsonb,
	"best_time_of_day" text,
	"crowd_profile" text,
	"model" text NOT NULL,
	"prompt_version" integer NOT NULL,
	"source_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '90 days' NOT NULL,
	CONSTRAINT "place_enrichments_best_time_of_day_check" CHECK ("place_enrichments"."best_time_of_day" in ('morning','midday','sunset','evening')),
	CONSTRAINT "place_enrichments_crowd_profile_check" CHECK ("place_enrichments"."crowd_profile" in ('quiet','moderate','packed'))
);
--> statement-breakpoint
CREATE TABLE "place_search_cache" (
	"query_hash" text PRIMARY KEY NOT NULL,
	"place_ids" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '30 days' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "itinerary_activities" ADD CONSTRAINT "itinerary_activities_day_id_itinerary_days_id_fk" FOREIGN KEY ("day_id") REFERENCES "public"."itinerary_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itinerary_activities" ADD CONSTRAINT "itinerary_activities_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itinerary_days" ADD CONSTRAINT "itinerary_days_itinerary_id_itineraries_id_fk" FOREIGN KEY ("itinerary_id") REFERENCES "public"."itineraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_itinerary_id_itineraries_id_fk" FOREIGN KEY ("itinerary_id") REFERENCES "public"."itineraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_enrichments" ADD CONSTRAINT "place_enrichments_place_id_locations_place_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."locations"("place_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "locations_city_idx" ON "locations" USING btree ("city");--> statement-breakpoint
CREATE INDEX "locations_types_idx" ON "locations" USING gin ("types");--> statement-breakpoint
CREATE INDEX "place_enrichments_expiry" ON "place_enrichments" USING btree ("expires_at");