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
