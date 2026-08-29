CREATE TABLE "itinerary_flights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"itinerary_id" uuid NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"flight_number" text,
	"airline" text,
	"depart_date" date NOT NULL,
	"depart_time" text,
	"depart_airport_code" text,
	"depart_city" text,
	"depart_country" text,
	"arrive_date" date NOT NULL,
	"arrive_time" text,
	"arrive_airport_code" text,
	"arrive_city" text,
	"arrive_country" text,
	"duration_minutes" integer,
	"confirmation" text,
	"fare_class" text,
	"cost" text,
	"currency" text,
	"terminal" text,
	"baggage_allowance" text,
	"ticket_number" text,
	"seat" text,
	"passenger_name" text,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "itinerary_flights_source_check" CHECK ("itinerary_flights"."source" in ('booked', 'manual', 'extracted'))
);
--> statement-breakpoint
ALTER TABLE "itinerary_flights" ADD CONSTRAINT "itinerary_flights_itinerary_id_itineraries_id_fk" FOREIGN KEY ("itinerary_id") REFERENCES "public"."itineraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "itinerary_flights_itinerary_idx" ON "itinerary_flights" USING btree ("itinerary_id","depart_date");