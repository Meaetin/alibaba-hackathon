/**
 * Reads and writes for analyzed links.
 *
 * It follows `itineraries.ts` deliberately: a `ContentStore` port with a
 * Postgres implementation and an in-memory double, so the route handlers stay
 * drivable with no database. Same ownership rule too — **somebody else's link
 * is a 404, never a 403**, because a 403 confirms the id names a real thing,
 * which is the one fact an outsider wants.
 *
 * The pipeline's full output is not copied in here. It lives on `jobs.result`
 * and it is diagnostics: transcript, OCR lines, per-stage counters, model
 * spend. What these tables hold is the handful of fields a card and a detail
 * page read, plus the places, which are the actual product.
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";

import { youtubeVideoId } from "@/lib/links/media";

import { content, content_locations, locations } from "./schema";
import type { Database } from "./client";

export type ContentRow = InferSelectModel<typeof content>;
export type LocationRow = InferSelectModel<typeof locations>;

/** One card in the `/links` grid. Exactly the ported `CompletedContent`. */
export interface ContentListItem {
  id: string;
  content_type: "video" | "webpage";
  content_url: string;
  content_title: string | null;
  content_thumbnail: string | null;
  content_author: string | null;
  platform: string | null;
  generated_summary: string | null;
  location_count: number;
  processing_status: string;
  created_at: string;
  updated_at: string;
  /**
   * Pinned false, like `readItineraryList` does with the same two fields. They
   * belong to features whose backend left with the old REST API, and the card
   * components still require them.
   */
  is_bookmarked: boolean;
  is_archived: boolean;
  /** For the static map on `/home`. Grouped by "{region}, {country}". */
  primary_country: string | null;
  primary_region: string | null;
  /**
   * A representative coordinate: the first place this link named that has one.
   *
   * The same shape of decision as `thumbnail_url` on an itinerary card — one
   * value standing for a set, taken from the first member that can supply it.
   * Null when no place resolved, which is a missing pin rather than a pin at
   * (0, 0) in the Gulf of Guinea.
   */
  latitude: number | null;
  longitude: number | null;
}

/** A place one link named, and the row it resolved to. */
export interface ContentLocation {
  /** What the model wrote, kept beside what Google matched. */
  mention: string;
  location: LocationRow;
}

export interface ContentDetail {
  id: string;
  content_url: string;
  normalized_url: string;
  content_title: string | null;
  content_thumbnail: string | null;
  content_author: string | null;
  platform: string | null;
  generated_summary: string | null;
  primary_country: string | null;
  primary_region: string | null;
  created_at: string;
  locations: ContentLocation[];
}

/** What `saveContent` needs. Assembled by the route from a pipeline result. */
export interface ContentToSave {
  content_url: string;
  content_title: string | null;
  content_thumbnail: string | null;
  content_author: string | null;
  platform: string | null;
  generated_summary: string | null;
  primary_country: string | null;
  primary_region: string | null;
  /** `place_id`s, in the order the model named them. Anything not already in
   *  `locations` is skipped rather than invented — see `saveContent`. */
  placeIds: string[];
  /** Keyed by `place_id`. The model's own words for each place. */
  mentions: Record<string, string>;
}

export interface ContentStore {
  /** Upserts on `(user_id, normalized_url)`: re-analyzing a link replaces its
   *  places rather than creating a second copy of the same video. */
  saveContent(input: ContentToSave, ownerId: string, now: Date): Promise<{ contentId: string }>;
  listContent(userId: string): Promise<ContentListItem[]>;
  /** Undefined for an id that does not exist **and** for one owned by somebody
   *  else. The caller cannot tell the two apart, which is the point. */
  readContentDetail(id: string, userId: string): Promise<ContentDetail | undefined>;
  /** False when the row was not this person's to delete. */
  deleteContent(id: string, userId: string): Promise<boolean>;
  /** The existing row for a URL this person has already analyzed, if any. */
  findByUrl(normalizedUrl: string, userId: string): Promise<ContentListItem | undefined>;
}

/**
 * The stable identity of a link, for the unique index above.
 *
 * This is what makes "have I already analyzed this" answerable. A TikTok
 * arrives carrying the search that found it and the millisecond it was tapped
 * — `?q=cafe%20in%20bali&t=1787957482884` — so without dropping those, the same
 * video pasted twice is two links and is billed twice.
 *
 * **But a YouTube watch URL keeps its video id in the query**, and an earlier
 * version of this function dropped the whole query string on the theory that
 * all three platforms identify a video by its path. TikTok and Instagram do.
 * YouTube does for `youtu.be/ID` and `/shorts/ID` and does **not** for
 * `watch?v=ID` — so every watch URL collapsed to `youtube.com/watch`, and the
 * second YouTube link anybody pasted came back "already analyzed" pointing at
 * the first. Found by pasting two.
 *
 * So YouTube is canonicalized through `youtubeVideoId`, the same extractor the
 * media source uses to ask RapidAPI for a channel handle. One definition, no
 * drift between the id we fetch by and the id we deduplicate by.
 */
export function normalizeContentUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");

    // Every YouTube form — watch, youtu.be, shorts, embed, live — collapses to
    // one canonical string, so the same video pasted from a share sheet and
    // from the address bar is one link.

    if (host === "youtu.be" || host.endsWith("youtube.com")) {
      const videoId = youtubeVideoId(raw);
      if (videoId) return `https://youtube.com/watch?v=${videoId}`;
    }

    const path = url.pathname.replace(/\/+$/, "");
    return `${url.protocol}//${host}${path}`;
  } catch {
    return raw.trim().toLowerCase();
  }
}

const ISO = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : value;

function toListItem(
  row: ContentRow,
  coordinate?: { latitude: number | null; longitude: number | null },
): ContentListItem {
  return {
    id: row.id,
    content_type: row.content_type === "webpage" ? "webpage" : "video",
    content_url: row.content_url,
    content_title: row.content_title,
    content_thumbnail: row.content_thumbnail,
    content_author: row.content_author,
    platform: row.platform,
    generated_summary: row.generated_summary,
    location_count: row.location_count,
    processing_status: row.processing_status,
    created_at: ISO(row.created_at),
    updated_at: ISO(row.updated_at),
    is_bookmarked: false,
    is_archived: false,
    primary_country: row.primary_country,
    primary_region: row.primary_region,
    latitude: coordinate?.latitude ?? null,
    longitude: coordinate?.longitude ?? null,
  };
}

export function createContentStore(db: Database): ContentStore {
  return {
    async saveContent(input, ownerId, now) {
      const normalized = normalizeContentUrl(input.content_url);

      const [row] = await db
        .insert(content)
        .values({
          user_id: ownerId,
          content_url: input.content_url,
          normalized_url: normalized,
          content_type: "video",
          content_title: input.content_title,
          content_thumbnail: input.content_thumbnail,
          content_author: input.content_author,
          platform: input.platform,
          generated_summary: input.generated_summary,
          primary_country: input.primary_country,
          primary_region: input.primary_region,
          location_count: 0,
          processing_status: "completed",
          created_at: now,
          updated_at: now,
        })
        .onConflictDoUpdate({
          target: [content.user_id, content.normalized_url],
          set: {
            content_url: input.content_url,
            content_title: input.content_title,
            content_thumbnail: input.content_thumbnail,
            content_author: input.content_author,
            platform: input.platform,
            generated_summary: input.generated_summary,
            primary_country: input.primary_country,
            primary_region: input.primary_region,
            updated_at: now,
          },
        })
        .returning();

      // Re-analyzing replaces the places outright. A merge would keep a venue
      // the new run no longer believes in, and there is no way to tell that
      // from one the run simply did not reach.
      await db.delete(content_locations).where(eq(content_locations.content_id, row.id));

      // `place_id` to row id. A place the pipeline resolved but whose row is
      // gone is skipped rather than invented — the same rule `retrievePlaces`
      // applies to a cache entry whose location row has since disappeared.
      const rows =
        input.placeIds.length > 0
          ? await db
              .select({ id: locations.id, place_id: locations.place_id })
              .from(locations)
              .where(inArray(locations.place_id, input.placeIds))
          : [];
      const byPlaceId = new Map(rows.map((entry) => [entry.place_id, entry.id]));

      const links = input.placeIds.flatMap((placeId, position) => {
        const locationId = byPlaceId.get(placeId);
        if (!locationId) return [];
        return [
          {
            content_id: row.id,
            location_id: locationId,
            mention: input.mentions[placeId] ?? placeId,
            position,
          },
        ];
      });

      if (links.length > 0) {
        // A model can name one venue twice under two names; the unique index
        // refuses the second and the first keeps its position.
        await db.insert(content_locations).values(links).onConflictDoNothing();
      }

      // Counted from what actually landed, not from what was offered. The two
      // differ whenever a place's row is missing, and a card claiming eight
      // places over a page showing six is the kind of lie nobody reports.
      await db
        .update(content)
        .set({ location_count: links.length, updated_at: now })
        .where(eq(content.id, row.id));

      return { contentId: row.id };
    },

    async listContent(userId) {
      const rows = await db
        .select()
        .from(content)
        .where(eq(content.user_id, userId))
        .orderBy(desc(content.created_at));
      if (rows.length === 0) return [];

      // One query for every link's places rather than one per link. Only the
      // first located place per link survives — see `ContentListItem.latitude`.
      const placed = await db
        .select({
          content_id: content_locations.content_id,
          position: content_locations.position,
          latitude: locations.latitude,
          longitude: locations.longitude,
        })
        .from(content_locations)
        .innerJoin(locations, eq(content_locations.location_id, locations.id))
        .where(
          inArray(
            content_locations.content_id,
            rows.map((row) => row.id),
          ),
        )
        .orderBy(content_locations.position);

      const firstCoordinate = new Map<string, { latitude: number; longitude: number }>();
      for (const entry of placed) {
        if (entry.latitude === null || entry.longitude === null) continue;
        if (firstCoordinate.has(entry.content_id)) continue;
        firstCoordinate.set(entry.content_id, {
          latitude: entry.latitude,
          longitude: entry.longitude,
        });
      }

      return rows.map((row) => toListItem(row, firstCoordinate.get(row.id)));
    },

    async readContentDetail(id, userId) {
      if (!isUuid(id)) return undefined;

      // The owner check is in the `where`, not a comparison afterwards: a row
      // read and then rejected is a row that was still read.
      const [row] = await db
        .select()
        .from(content)
        .where(and(eq(content.id, id), eq(content.user_id, userId)))
        .limit(1);
      if (!row) return undefined;

      const places = await db
        .select({ mention: content_locations.mention, location: locations })
        .from(content_locations)
        .innerJoin(locations, eq(content_locations.location_id, locations.id))
        .where(eq(content_locations.content_id, row.id))
        .orderBy(content_locations.position);

      return {
        id: row.id,
        content_url: row.content_url,
        normalized_url: row.normalized_url,
        content_title: row.content_title,
        content_thumbnail: row.content_thumbnail,
        content_author: row.content_author,
        platform: row.platform,
        generated_summary: row.generated_summary,
        primary_country: row.primary_country,
        primary_region: row.primary_region,
        created_at: ISO(row.created_at),
        locations: places.map((entry) => ({ mention: entry.mention, location: entry.location })),
      };
    },

    async deleteContent(id, userId) {
      if (!isUuid(id)) return false;
      const deleted = await db
        .delete(content)
        .where(and(eq(content.id, id), eq(content.user_id, userId)))
        .returning({ id: content.id });
      return deleted.length > 0;
    },

    async findByUrl(normalizedUrl, userId) {
      const [row] = await db
        .select()
        .from(content)
        .where(and(eq(content.user_id, userId), eq(content.normalized_url, normalizedUrl)))
        .limit(1);
      return row ? toListItem(row) : undefined;
    },
  };
}

/** Same guard `itineraries.ts` uses: a non-uuid reaches Postgres as a cast
 *  error, not an empty result, and "not a uuid" is a 404 rather than a 500. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(value: string): boolean {
  return UUID.test(value);
}

// ── the in-memory double ─────────────────────────────────────────────────────

/**
 * Backs the route tests. It holds the same rules the SQL does — the unique
 * `(user, url)` pair, the owner check inside the read, the count taken from
 * what landed — because a double that is more permissive than the database
 * turns a route test into a test of the double.
 */
export function createInMemoryContentStore(seed?: {
  rows?: ContentRow[];
  /** `place_id` to the `locations` row it names. */
  locations?: Record<string, LocationRow>;
}): ContentStore & {
  rows: Map<string, ContentRow>;
  links: Map<string, { location: LocationRow; mention: string; position: number }[]>;
} {
  const rows = new Map<string, ContentRow>((seed?.rows ?? []).map((row) => [row.id, row]));
  const links = new Map<string, { location: LocationRow; mention: string; position: number }[]>();
  const known = seed?.locations ?? {};
  let sequence = 0;
  const nextId = () => `00000000-0000-4000-9000-${String(++sequence).padStart(12, "0")}`;

  return {
    rows,
    links,

    async saveContent(input, ownerId, now) {
      const normalized = normalizeContentUrl(input.content_url);
      const existing = [...rows.values()].find(
        (row) => row.user_id === ownerId && row.normalized_url === normalized,
      );

      const seated = input.placeIds.flatMap((placeId, position) => {
        const location = known[placeId];
        if (!location) return [];
        return [{ location, mention: input.mentions[placeId] ?? placeId, position }];
      });
      // The unique (content, location) pair: one venue named twice lands once.
      const deduped = seated.filter(
        (entry, index) =>
          seated.findIndex((other) => other.location.id === entry.location.id) === index,
      );

      const row: ContentRow = {
        id: existing?.id ?? nextId(),
        user_id: ownerId,
        content_url: input.content_url,
        normalized_url: normalized,
        content_type: "video",
        content_title: input.content_title,
        content_thumbnail: input.content_thumbnail,
        content_author: input.content_author,
        platform: input.platform,
        generated_summary: input.generated_summary,
        primary_country: input.primary_country,
        primary_region: input.primary_region,
        location_count: deduped.length,
        processing_status: "completed",
        created_at: existing?.created_at ?? now,
        updated_at: now,
      };

      rows.set(row.id, row);
      links.set(row.id, deduped);
      return { contentId: row.id };
    },

    async listContent(userId) {
      return [...rows.values()]
        .filter((row) => row.user_id === userId)
        .sort((a, b) => new Date(ISO(b.created_at)).getTime() - new Date(ISO(a.created_at)).getTime())
        .map((row) => {
          const located = (links.get(row.id) ?? [])
            .slice()
            .sort((a, b) => a.position - b.position)
            .find(
              (entry) => entry.location.latitude !== null && entry.location.longitude !== null,
            );
          return toListItem(
            row,
            located
              ? { latitude: located.location.latitude, longitude: located.location.longitude }
              : undefined,
          );
        });
    },

    async readContentDetail(id, userId) {
      const row = rows.get(id);
      if (!row || row.user_id !== userId) return undefined;
      return {
        id: row.id,
        content_url: row.content_url,
        normalized_url: row.normalized_url,
        content_title: row.content_title,
        content_thumbnail: row.content_thumbnail,
        content_author: row.content_author,
        platform: row.platform,
        generated_summary: row.generated_summary,
        primary_country: row.primary_country,
        primary_region: row.primary_region,
        created_at: ISO(row.created_at),
        locations: (links.get(row.id) ?? [])
          .slice()
          .sort((a, b) => a.position - b.position)
          .map((entry) => ({ mention: entry.mention, location: entry.location })),
      };
    },

    async deleteContent(id, userId) {
      const row = rows.get(id);
      if (!row || row.user_id !== userId) return false;
      rows.delete(id);
      links.delete(id);
      return true;
    },

    async findByUrl(normalizedUrl, userId) {
      const row = [...rows.values()].find(
        (entry) => entry.user_id === userId && entry.normalized_url === normalizedUrl,
      );
      return row ? toListItem(row) : undefined;
    },
  };
}
