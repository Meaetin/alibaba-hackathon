/**
 * The single source of column truth. Every row type in the app is
 * `InferSelectModel<typeof table>`; every select list is generated from one of
 * these definitions. See "The three-way sync this replaces" in
 * `docs/personalization-pipeline.md` for why that matters.
 *
 * TS property names are the Postgres column names — snake_case, deliberately.
 * The ported UI types (`ActivityLocation` in `src/lib/supabase/queries/home.ts`)
 * already speak snake_case, so a row can go straight to a card component
 * without a rename layer that would be its own thing to keep in sync.
 */

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import type {
  DimensionScores,
  QuizAnswers,
  TravelArchetypeId,
  TravelPersona,
} from "@/lib/persona/types";
import type { SavedTravelPreferences } from "@/lib/preferences/types";
import type { OpeningPeriod, PreferenceProfile } from "@/lib/planner/types";
import type { FunnelStats } from "@/lib/planner/funnel";
import type { PriceRange } from "@/lib/maps/price-range";
import type { ReviewSnippet } from "@/lib/planner/retrieval";
import type { TravelMode } from "@/lib/planner/pack";
import type { PlannerDebug } from "@/lib/planner/debug";

/** `itinerary_activities.travel_to_next`. `TravelLeg` plus the mode the packer
 *  chose, so a stored day renders without re-deriving it from the distance. */
export interface TravelToNext {
  mode: TravelMode;
  minutes: number;
  meters: number;
}

/** `area_guides.highlights`. */
export interface AreaHighlight {
  name: string;
  note: string;
  place_id?: string;
}

/** Pass C's per-activity prose. Typed loosely until Pass C ships (Step 14);
 *  the column exists now so the read path doesn't change when it does. */
export type ActivityContent = Record<string, unknown>;

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

// ─── Cached Google data ──────────────────────────────────────────────────────

export const locations = pgTable(
  "locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    place_id: text("place_id").unique().notNull(),
    name: text("name").notNull(),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    types: jsonb("types").$type<string[]>().notNull().default([]),
    primary_type: text("primary_type"),
    rating: real("rating"),
    user_rating_count: integer("user_rating_count"),
    /** 0..4 ordinal. The budget-filtering input — see `toPriceLevelOrdinal`. */
    price_level: integer("price_level"),
    /** Currency-denominated, so not comparable across cities. Display only. */
    price_range: jsonb("price_range").$type<PriceRange>(),
    formatted_address: text("formatted_address"),
    city: text("city"),
    opening_periods: jsonb("opening_periods").$type<OpeningPeriod[]>(),
    /** Up to 5. Null = shortlist hydration has not run; [] = ran, none found. */
    review_snippets: jsonb("review_snippets").$type<ReviewSnippet[]>(),
    /** Google's own blurb, from the shortlist mask. Enrichment input. */
    editorial_summary: text("editorial_summary"),
    /** Google's AI review digest, from the shortlist mask. Enrichment input. */
    review_summary: text("review_summary"),
    /** Three-state on purpose: null = Google never said, which is the common
     *  case outside chains. Never read null as false — see the dietary ladder. */
    serves_vegetarian_food: boolean("serves_vegetarian_food"),
    /** Null = the Enterprise + Atmosphere Details call never ran. Distinguishes
     *  that from "it ran and Google was quiet", which must not be refetched. */
    shortlist_hydrated_at: timestamptz("shortlist_hydrated_at"),
    /** Google photo RESOURCE NAMES. Free. Always populated. */
    photo_names: jsonb("photo_names").$type<string[]>(),
    /** Resolved media URLs. Billed. Filled at Step 11 only. */
    photo_urls: jsonb("photo_urls").$type<string[]>(),
    /** Null = names stored, media never fetched. */
    photos_resolved_at: timestamptz("photos_resolved_at"),
    business_status: text("business_status"),
    /** Google's canonical link for the place. Pro tier, so it rides free on a
     *  search mask that already asks for `rating` and `regularOpeningHours`.
     *  Null for every place retrieved before the field was on the mask — the
     *  page falls back to `place_id` via `googleMapsPlaceUrl`. */
    google_maps_uri: text("google_maps_uri"),
    /** Minutes; backfilled from enrichment. */
    stay_duration: integer("stay_duration"),
    fetched_at: timestamptz("fetched_at").notNull().defaultNow(),
  },
  (t) => [
    index("locations_city_idx").on(t.city),
    index("locations_types_idx").using("gin", t.types),
  ],
);

/** Retrieval cache. The 30-day TTL keeps us inside Places content-caching terms. */
export const place_search_cache = pgTable("place_search_cache", {
  /** `sha256(city | query | includedType)` — see `searchCacheKey`. */
  query_hash: text("query_hash").primaryKey(),
  place_ids: jsonb("place_ids").$type<string[]>().notNull(),
  created_at: timestamptz("created_at").notNull().defaultNow(),
  expires_at: timestamptz("expires_at")
    .notNull()
    .default(sql`now() + interval '30 days'`),
});

// ─── AI caches ───────────────────────────────────────────────────────────────

export const place_enrichments = pgTable(
  "place_enrichments",
  {
    place_id: text("place_id")
      .primaryKey()
      .references(() => locations.place_id, { onDelete: "cascade" }),
    /** Replaces Google's editorialSummary. */
    description: text("description").notNull(),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    confidence: real("confidence").notNull(),
    visit_min: integer("visit_min"),
    visit_max: integer("visit_max"),
    signature_dishes: jsonb("signature_dishes").$type<string[]>(),
    best_time_of_day: text("best_time_of_day").$type<
      "morning" | "midday" | "sunset" | "evening"
    >(),
    crowd_profile: text("crowd_profile").$type<"quiet" | "moderate" | "packed">(),
    /** Invalidate by model version, not time. */
    model: text("model").notNull(),
    /** Bumped when *we* change the prompt — the TTL never catches that. */
    prompt_version: integer("prompt_version").notNull(),
    /** sha256 of the exact input payload. */
    source_hash: text("source_hash").notNull(),
    created_at: timestamptz("created_at").notNull().defaultNow(),
    expires_at: timestamptz("expires_at")
      .notNull()
      .default(sql`now() + interval '90 days'`),
  },
  (t) => [
    index("place_enrichments_expiry").on(t.expires_at),
    check(
      "place_enrichments_best_time_of_day_check",
      sql`${t.best_time_of_day} in ('morning','midday','sunset','evening')`,
    ),
    check(
      "place_enrichments_crowd_profile_check",
      sql`${t.crowd_profile} in ('quiet','moderate','packed')`,
    ),
  ],
);

export const area_guides = pgTable("area_guides", {
  /** `lower(trim(area || '|' || city))`. */
  area_key: text("area_key").primaryKey(),
  highlights: jsonb("highlights").$type<AreaHighlight[]>().notNull(),
  narrative: text("narrative").notNull(),
  model: text("model").notNull(),
  expires_at: timestamptz("expires_at")
    .notNull()
    .default(sql`now() + interval '90 days'`),
});

// ─── Accounts ────────────────────────────────────────────────────────────────

/**
 * One row per person with an account. Identity lives here, in the same database
 * as the trips it owns, so an itinerary's owner is a foreign key rather than a
 * uuid issued by some other system that this one cannot join to.
 *
 * `password_hash` is the whole self-describing scrypt string — parameters, salt
 * and digest — never a bare digest. See `src/lib/auth/password.ts`: a stored
 * hash has to carry the cost parameters it was made with, or raising them later
 * silently invalidates every existing password.
 *
 * `email` is stored already lower-cased by the route, and the unique index is
 * what makes that load-bearing rather than cosmetic.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  display_name: text("display_name"),
  password_hash: text("password_hash").notNull(),
  /**
   * The traveller's saved travel preferences, or null if they have not set any.
   *
   * A column on `users` rather than a table of its own: there is exactly one
   * set per person, nobody wants a history of them, and `users` is already the
   * per-person row. Same shape of decision as `itineraries.persona` being a
   * jsonb snapshot rather than a join.
   *
   * `selectedIds` inside it is the **source of truth**; `profile` is derived
   * from it by `createSavedPreferences` and stored beside it for the same
   * reason `travel_personas` stores both answers and scores — a read wants the
   * planner-ready shape without re-deriving, and a re-derivation wants the ids.
   * The server rebuilds `profile` on every write, so the two cannot drift.
   */
  preferences: jsonb("preferences").$type<SavedTravelPreferences>(),
  created_at: timestamptz("created_at").notNull().defaultNow(),
  updated_at: timestamptz("updated_at").notNull().defaultNow(),
});

/**
 * Live sessions. The primary key is the **sha256 of the cookie token**, never
 * the token: a row here cannot be replayed as a login, so a database dump is
 * not a set of live sessions. The browser holds the only copy of the secret.
 *
 * Opaque tokens rather than a signed JWT so that signing out is a delete rather
 * than a wish. A stateless token stays valid until it expires no matter what
 * the server would prefer.
 */
export const sessions = pgTable(
  "sessions",
  {
    token_hash: text("token_hash").primaryKey(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    created_at: timestamptz("created_at").notNull().defaultNow(),
    expires_at: timestamptz("expires_at").notNull(),
  },
  (t) => [index("sessions_user_id_idx").on(t.user_id)],
);

// ─── Traveller ───────────────────────────────────────────────────────────────

/**
 * One row per traveller who finished the quiz. The client holds only `id`; the
 * data lives here so a persona survives the dialog closing and can be named by
 * a later plan request.
 *
 * `answers` is the source of truth and the other two columns are derived from
 * it by `calculatePersona`. Storing the derivation as well is not redundancy:
 * a read wants the archetype without re-running the scorer, and re-deriving
 * every stored row after a scoring change wants the answers. Neither column
 * can answer the other's question.
 *
 * **A retake rewrites the row in place** — one persona per person, one stable
 * id, no pointer churn in `localStorage`. The consequence is that this table
 * describes who the traveller is *now*, never who they were when an older trip
 * was planned. That is what makes `itineraries.persona` load-bearing rather
 * than decorative: after a retake it is the only record of what produced an
 * older itinerary. Nothing explaining an existing trip may join to this table.
 */
export const travel_personas = pgTable("travel_personas", {
  id: uuid("id").primaryKey().defaultRandom(),
  /**
   * The traveller this persona belongs to, **unique**: the prose above promises
   * one persona per person and this is what makes that true rather than hoped
   * for. Nullable because the quiz is open to anyone — a persona taken signed
   * out has no owner until the browser hands its id to sign-up or sign-in.
   */
  user_id: uuid("user_id")
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  /** `QuizAnswers` — one option index per question, `null` where unanswered. */
  answers: jsonb("answers").$type<QuizAnswers>().notNull(),
  /** Derived. The four raw 0–100 axis scores. */
  dimensions: jsonb("dimensions").$type<DimensionScores>().notNull(),
  /** Derived. The nearest archetype's id. */
  archetype: text("archetype").$type<TravelArchetypeId>().notNull(),
  created_at: timestamptz("created_at").notNull().defaultNow(),
  updated_at: timestamptz("updated_at").notNull().defaultNow(),
});

// ─── Itinerary ───────────────────────────────────────────────────────────────

export const itineraries = pgTable("itineraries", {
  id: uuid("id").primaryKey().defaultRandom(),
  /**
   * The owner. Nullable because the rows planned before accounts existed have
   * none, and inventing an owner for them would be a lie told in a foreign key.
   * `POST /api/plan` requires a user, so nothing written from here on is null.
   *
   * `set null` rather than `cascade`: deleting an account should not silently
   * destroy trips, and an orphaned itinerary is still readable at its own URL.
   */
  user_id: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  city: text("city").notNull(),
  country: text("country"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  start_date: date("start_date").notNull(),
  total_days: integer("total_days").notNull(),
  /** The `PreferenceProfile` as submitted. */
  profile: jsonb("profile").$type<PreferenceProfile>().notNull(),
  /**
   * The persona that produced this trip, snapshotted whole — answers and
   * derived result together. Null means the traveller never took the quiz.
   *
   * A snapshot, not a foreign key, and written on **every** plan rather than
   * only the first: `travel_personas` is rewritten in place on a retake, so a
   * join would silently re-explain an old trip with a new personality, and a
   * snapshot taken only once is missing exactly when you need it. The prose
   * inside `PersonaResult` is duplicated static text — that is the price of a
   * record that does not need today's code to be read.
   */
  persona: jsonb("persona").$type<TravelPersona>(),
  /** Every cut, replayable: "why wasn't teamLab included?" has an answer. */
  funnel_stats: jsonb("funnel_stats").$type<FunnelStats>(),
  /**
   * What the model said and what we threw away — Pass B's per-stop reasoning,
   * every id it named that we refused, and the per-stage counters. It is the
   * only durable record of the two; both used to live and die inside one
   * request. Diagnostics, never read by a card. See `src/lib/planner/debug.ts`.
   */
  planner_debug: jsonb("planner_debug").$type<PlannerDebug>(),
  created_at: timestamptz("created_at").notNull().defaultNow(),
});

export const itinerary_days = pgTable(
  "itinerary_days",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itinerary_id: uuid("itinerary_id")
      .notNull()
      .references(() => itineraries.id, { onDelete: "cascade" }),
    day_index: integer("day_index").notNull(),
    date: date("date").notNull(),
    /** The cluster label, e.g. "Arashiyama". */
    area_name: text("area_name"),
  },
  (t) => [unique("itinerary_days_itinerary_id_day_index_key").on(t.itinerary_id, t.day_index)],
);

export const itinerary_activities = pgTable(
  "itinerary_activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    day_id: uuid("day_id")
      .notNull()
      .references(() => itinerary_days.id, { onDelete: "cascade" }),
    location_id: uuid("location_id").references(() => locations.id),
    position: integer("position").notNull(),
    slot_role: text("slot_role").notNull(),
    /** Minutes from midnight. Code owns the clock — never a timestamp. */
    start_min: integer("start_min").notNull(),
    end_min: integer("end_min").notNull(),
    score: real("score"),
    match_reasons: jsonb("match_reasons").$type<string[]>().notNull().default([]),
    /** From Pass C; null on the fallback path. */
    content: jsonb("content").$type<ActivityContent>(),
    travel_to_next: jsonb("travel_to_next").$type<TravelToNext>(),
  },
  (t) => [unique("itinerary_activities_day_id_position_key").on(t.day_id, t.position)],
);

/**
 * A flight on a trip: booked through Atlas, or typed in by hand.
 *
 * It hangs off `itineraries` rather than off a day, because a flight is not an
 * activity — the planner never produces one, never schedules one, and
 * `itinerary_activities` is keyed on a `day_id` and a `position` that a flight
 * has no answer for. Deleting a trip takes its flights with it; nothing else
 * points at them.
 *
 * **The column names are `ExtractedFlight`'s, field for field.** That type is
 * what the flight card, the manual form and the edit form already speak, so a
 * row goes to a card with no rename layer — the same rule the rest of this file
 * keeps about snake_case.
 *
 * Dates and clock times are stored apart, as `date` and `text`, because that is
 * how every airline states them and how every form in the UI collects them: a
 * departure is "14 Sep, 23:55 local", not an instant. Composing them into one
 * timestamp needs the airport's timezone, which this app does not have — see
 * `ITINERARY_TIMEZONE` for the same decision made once already.
 */
export const itinerary_flights = pgTable(
  "itinerary_flights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itinerary_id: uuid("itinerary_id")
      .notNull()
      .references(() => itineraries.id, { onDelete: "cascade" }),
    /**
     * Where the row came from. A fare booked through Atlas and a flight
     * somebody typed in are the same shape and are not the same claim: only
     * the first has a ticket number we issued, and only the first should ever
     * be re-priced against a live search.
     */
    source: text("source").notNull().default("manual"),
    flight_number: text("flight_number"),
    airline: text("airline"),
    depart_date: date("depart_date").notNull(),
    /** Local clock at the departure airport, "HH:MM". Never a timestamp. */
    depart_time: text("depart_time"),
    depart_airport_code: text("depart_airport_code"),
    depart_city: text("depart_city"),
    depart_country: text("depart_country"),
    arrive_date: date("arrive_date").notNull(),
    /** Local clock at the arrival airport, "HH:MM". */
    arrive_time: text("arrive_time"),
    arrive_airport_code: text("arrive_airport_code"),
    arrive_city: text("arrive_city"),
    arrive_country: text("arrive_country"),
    duration_minutes: integer("duration_minutes"),
    /** The airline's booking reference (PNR). */
    confirmation: text("confirmation"),
    fare_class: text("fare_class"),
    /**
     * Stored as text, not `real`. A fare is a decimal amount and binary
     * floating point is the wrong shape for money; the UI only ever formats it
     * beside `currency` anyway, and `FlightCardProps.cost` is already a string.
     */
    cost: text("cost"),
    currency: text("currency"),
    terminal: text("terminal"),
    baggage_allowance: text("baggage_allowance"),
    ticket_number: text("ticket_number"),
    /** The seat the traveller picked, e.g. "12A". Null when none was chosen —
     *  which is different from a seat we failed to record. */
    seat: text("seat"),
    /** Who is flying, as given at booking. One passenger per row today. */
    passenger_name: text("passenger_name"),
    status: text("status").notNull().default("confirmed"),
    created_at: timestamptz("created_at").notNull().defaultNow(),
    updated_at: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("itinerary_flights_itinerary_idx").on(t.itinerary_id, t.depart_date),
    check(
      "itinerary_flights_source_check",
      sql`${t.source} in ('booked', 'manual', 'extracted')`,
    ),
  ],
);

// ─── Job queue ───────────────────────────────────────────────────────────────

/**
 * What the loading screen reads out of `jobs.progress`.
 *
 * The first five fields are the planner's own report: which stage is running,
 * how far along the run is, and how many stages there are. The optional five
 * below exist for the two hooks that animate the card between reports — a plan
 * writes a row every stage or two, and without them the bar sits still through
 * a twenty-second model call.
 *
 * `progress` is a `jsonb` column, so adding a field here changes no DDL and
 * needs no migration.
 */
export interface JobProgress {
  percent: number;
  label: string;
  stage: string;
  done: number;
  total: number;
  /**
   * Legacy step ordinal, read by `useProgressAnimation` only when `percent` is
   * absent. The planner leaves it unset: that hook's step→percent table
   * describes the content-analysis pipeline, and a stage number from this one
   * would map onto the wrong percentage.
   */
  step?: number;
  /** When this report was written, ISO. `useProgressAnimation` starts its crawl
   *  from it and `useProgressEta` counts down from it. */
  fired_at?: string;
  /** Seconds left in the whole run. Read by `useProgressEta`. */
  eta_seconds?: number;
  /** The percentage this stage ends at. `useProgressAnimation` walks the bar
   *  toward it rather than parking on `percent`. */
  next_percent?: number;
  /** How long this stage is expected to take, ms. `useProgressAnimation` uses
   *  it as the crawl's denominator. */
  stage_ms?: number;
}

// ─── Analyzed links ──────────────────────────────────────────────────────────

/**
 * One video somebody pasted in, after the link pipeline has read it.
 *
 * A `jobs` row is about a *run* — it has no owner, no delete and no dedupe, and
 * a queue is not a library. This is the artifact the run produced, and it is
 * the same split the planner already makes between `jobs` and `itineraries`.
 *
 * The full pipeline output stays on `jobs.result` and is not copied here: that
 * blob is diagnostics — transcript, OCR lines, per-stage counters — and the
 * columns below are the handful a card and a detail page actually read.
 */
export const content = pgTable(
  "content",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** `cascade`, unlike `itineraries.user_id`. A link is a cheap thing to
     *  re-analyze and it is meaningless without the person who saved it, so an
     *  orphan here is litter rather than a record worth keeping. */
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** As pasted, so the card can link back to the exact post. */
    content_url: text("content_url").notNull(),
    /**
     * Scheme, host and path — query and fragment stripped, host lowercased.
     *
     * It exists for the unique index below. A TikTok arrives with `?q=` search
     * terms and a `&t=` timestamp attached, so without normalizing, the same
     * video pasted from two places is two links and is analyzed (and billed)
     * twice. See `normalizeContentUrl`.
     */
    normalized_url: text("normalized_url").notNull(),
    /** `webpage` is unreachable today — there is no webpage pipeline — but the
     *  ported cards are typed against both and the column costs nothing. */
    content_type: text("content_type").notNull().default("video"),
    content_title: text("content_title"),
    content_thumbnail: text("content_thumbnail"),
    content_author: text("content_author"),
    platform: text("platform"),
    generated_summary: text("generated_summary"),
    primary_country: text("primary_country"),
    primary_region: text("primary_region"),
    /**
     * Distinct venues, not mentions.
     *
     * Denormalized on purpose: every card in the grid renders it, and counting
     * `content_locations` per row would be a join the list query does not
     * otherwise need. `saveContent` is the only writer.
     */
    location_count: integer("location_count").notNull().default(0),
    /** Only ever `completed`. The queue card owns in-flight state, and a
     *  half-written row would be a second source of truth for the same fact. */
    processing_status: text("processing_status").notNull().default("completed"),
    created_at: timestamptz("created_at").notNull().defaultNow(),
    updated_at: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    // Per person, not global: two travellers may each save the same video.
    unique("content_user_url_idx").on(t.user_id, t.normalized_url),
    index("content_user_created_idx").on(t.user_id, t.created_at),
  ],
);

/**
 * A place one link talks about.
 *
 * `location_id` is a plain reference with **no** cascade, and that is the whole
 * point of the table: `locations` is the shared Places cache, so deleting a
 * link must not delete a restaurant that three other links and an itinerary
 * also point at.
 *
 * `mention` is what the model wrote — "Hoe Kee Porridge, Singapore, Singapore"
 * — kept beside the place it resolved to. Without it there is no way to see
 * that a mention matched the wrong venue, which is this pipeline's known
 * failure mode: a Text Search almost always returns *something*.
 */
export const content_locations = pgTable(
  "content_locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    content_id: uuid("content_id")
      .notNull()
      .references(() => content.id, { onDelete: "cascade" }),
    location_id: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    /** The model's own words for this place. */
    mention: text("mention").notNull(),
    /** Order the model named them in, which is roughly video order. */
    position: integer("position").notNull(),
  },
  (t) => [
    unique("content_locations_unique_idx").on(t.content_id, t.location_id),
    index("content_locations_content_idx").on(t.content_id, t.position),
  ],
);

// ─── Collections ─────────────────────────────────────────────────────────────

/**
 * A named set of places one traveller saved.
 *
 * The unit that lets a place found in a video, a place from a finished trip and
 * a place picked off a map all sit in the same list. `content` is what one link
 * produced and `itineraries` is what one plan produced; a collection is what a
 * person chose, which is why it is the only one of the three with a name they
 * typed.
 *
 * `itinerary_id` is how a generated trip gets its **companion collection** — a
 * collection either backs an itinerary or is free-standing, never both, which
 * the unique index is what makes true. The reference sits on this side rather
 * than as `itineraries.collection_id` for two reasons: cascade runs the right
 * way (deleting a trip takes its companion, deleting the companion leaves the
 * trip), and `itineraries` keeps a column that every row planned before this
 * existed would have had to leave null.
 *
 * **Older trips have no companion.** Nothing backfills one, so a read must
 * answer "this trip has no collection" rather than inventing an empty one.
 */
export const collections = pgTable(
  "collections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** `cascade`, like `content.user_id` and unlike `itineraries.user_id`. A
     *  collection is a person's own shelf; orphaned, it is litter. */
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    country: text("country"),
    region: text("region"),
    /** Where the collection is about, from the create modal's autocomplete.
     *  Seeds the trip form when planning from here, nothing more. */
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    is_bookmarked: boolean("is_bookmarked").notNull().default(false),
    is_archived: boolean("is_archived").notNull().default(false),
    /** The trip this collection was created alongside, or null for one the
     *  traveller made themselves. Unique: one companion per trip. */
    itinerary_id: uuid("itinerary_id")
      .unique()
      .references(() => itineraries.id, { onDelete: "cascade" }),
    created_at: timestamptz("created_at").notNull().defaultNow(),
    updated_at: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [index("collections_user_updated_idx").on(t.user_id, t.updated_at)],
);

/**
 * A place in a collection.
 *
 * `location_id` is a plain reference with **no** cascade, for the same reason
 * `content_locations.location_id` has none: `locations` is the shared Places
 * cache, so removing a place from somebody's shelf must not delete the row an
 * itinerary and three links also point at.
 *
 * `added_at` is on the junction rather than derived, because the grid sorts
 * newest-added-first and "when this place was saved here" is not the same fact
 * as "when Google's row for it was fetched".
 */
export const collection_locations = pgTable(
  "collection_locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    collection_id: uuid("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    location_id: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    added_at: timestamptz("added_at").notNull().defaultNow(),
  },
  (t) => [
    unique("collection_locations_unique_idx").on(t.collection_id, t.location_id),
    index("collection_locations_collection_idx").on(t.collection_id, t.added_at),
  ],
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").notNull().default("itinerary-planning"),
    status: text("status").notNull().default("queued"),
    itinerary_id: uuid("itinerary_id").references(() => itineraries.id, {
      onDelete: "cascade",
    }),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    result: jsonb("result").$type<Record<string, unknown>>(),
    error: text("error"),
    progress: jsonb("progress").$type<JobProgress>(),
    created_at: timestamptz("created_at").notNull().defaultNow(),
    updated_at: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [index("jobs_status_idx").on(t.status, t.created_at)],
);
