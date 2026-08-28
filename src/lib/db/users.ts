/**
 * Accounts and their live sessions.
 *
 * A port with an in-memory double, following `PersonaStore` in `personas.ts`
 * rather than the ports in `stores.ts` — those are the *planner's*, and nothing
 * in the planner knows a user exists. This one is declared where its consumers
 * live: the four auth route handlers.
 *
 * The store holds no policy. It does not hash a password (that is
 * `src/lib/auth/password.ts`), it does not mint a token (`session.ts`), and it
 * does not decide when a session is too old — it is *handed* `now` and filters
 * on it, the same way cache expiry is handed a `now` everywhere else here.
 *
 * ## The two claim operations, and why they are shaped so oddly
 *
 * `claimOwnerlessItineraries` and `claimPersona` are the migration path from
 * "this app had no accounts" to "it does". Both are single conditional
 * statements rather than read-then-decide-then-write, because the Neon HTTP
 * driver has no interactive transaction — `saveItinerary` says the same thing
 * about itself one file over. The condition therefore has to live *in* the
 * statement, which is what makes them safe to run concurrently and what makes
 * them read strangely.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";

import { hashToken } from "@/lib/auth/session";
import type { SavedTravelPreferences } from "@/lib/preferences/types";

import type { Database } from "./client";
import { isUuid } from "./itineraries";
import { itineraries, sessions, travel_personas, users } from "./schema";

export type UserRow = InferSelectModel<typeof users>;

export interface NewUser {
  email: string;
  display_name: string | null;
  password_hash: string;
  now: Date;
}

export interface UserStore {
  /** `undefined` when the email is taken — a duplicate is an answer, not a 500. */
  create(input: NewUser): Promise<UserRow | undefined>;
  findByEmail(email: string): Promise<UserRow | undefined>;
  findById(id: string): Promise<UserRow | undefined>;

  startSession(input: {
    tokenHash: string;
    userId: string;
    now: Date;
    expiresAt: Date;
  }): Promise<void>;
  /** The user behind a live token, or `undefined`. Expiry is checked here. */
  userForToken(token: string, now: Date): Promise<UserRow | undefined>;
  endSession(token: string): Promise<void>;

  /**
   * Hands every ownerless itinerary to `userId`, but **only if that user is the
   * only account there is**. The guard is inside the statement rather than
   * around it, so two people signing up at once cannot both claim: whichever
   * runs when the count is already 2 updates nothing. Returns how many rows
   * moved, which is the only way a caller can log what happened.
   */
  claimOwnerlessItineraries(userId: string): Promise<number>;

  /**
   * Attaches an ownerless persona to a user, if the persona is genuinely
   * ownerless and the user does not already have one. Both halves are in the
   * `where` clause for the same reason as above, and because
   * `travel_personas.user_id` is unique — a blind update would throw on the
   * second sign-in from a browser that still holds an old id.
   */
  claimPersona(input: { personaId: string; userId: string; now: Date }): Promise<boolean>;

  /** The traveller's saved preferences, or `undefined` if they have set none. */
  readPreferences(userId: string): Promise<SavedTravelPreferences | undefined>;

  /**
   * Replaces them wholesale. There is no merge and no history: a person edits
   * the set in one dialog and saves the set, so a partial update would be an
   * operation nothing performs and a second shape to keep true.
   */
  writePreferences(input: {
    userId: string;
    preferences: SavedTravelPreferences;
    now: Date;
  }): Promise<void>;
}

export function createUserStore(db: Database): UserStore {
  return {
    async create({ email, display_name, password_hash, now }) {
      const [row] = await db
        .insert(users)
        .values({ email, display_name, password_hash, created_at: now, updated_at: now })
        // The unique index on `email` is the race-proof half of "is this taken":
        // a check-then-insert has a window between the two, this does not.
        .onConflictDoNothing({ target: users.email })
        .returning();
      return row;
    },

    async findByEmail(email) {
      const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      return row;
    },

    async findById(id) {
      // A non-uuid reaches Postgres as a cast error rather than an empty result,
      // and "not a uuid" is a miss, not a 500. Same rule as `PersonaStore.get`.
      if (!isUuid(id)) return undefined;
      const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      return row;
    },

    async startSession({ tokenHash, userId, now, expiresAt }) {
      await db
        .insert(sessions)
        .values({ token_hash: tokenHash, user_id: userId, created_at: now, expires_at: expiresAt });
    },

    async userForToken(token, now) {
      const [row] = await db
        .select({ user: users })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.user_id))
        .where(and(eq(sessions.token_hash, hashToken(token)), sql`${sessions.expires_at} > ${now}`))
        .limit(1);
      return row?.user;
    },

    async endSession(token) {
      await db.delete(sessions).where(eq(sessions.token_hash, hashToken(token)));
    },

    async claimOwnerlessItineraries(userId) {
      if (!isUuid(userId)) return 0;
      const claimed = await db
        .update(itineraries)
        .set({ user_id: userId })
        .where(and(isNull(itineraries.user_id), sql`(select count(*) from ${users}) = 1`))
        .returning({ id: itineraries.id });
      return claimed.length;
    },

    async claimPersona({ personaId, userId, now }) {
      if (!isUuid(personaId) || !isUuid(userId)) return false;
      const claimed = await db
        .update(travel_personas)
        .set({ user_id: userId, updated_at: now })
        .where(
          and(
            eq(travel_personas.id, personaId),
            isNull(travel_personas.user_id),
            // The cast is not decoration: the driver sends this as text, and
            // `uuid = text` has no operator in Postgres.
            sql`not exists (select 1 from ${travel_personas} p where p.user_id = ${userId}::uuid)`,
          ),
        )
        .returning({ id: travel_personas.id });
      return claimed.length > 0;
    },

    async readPreferences(userId) {
      if (!isUuid(userId)) return undefined;
      const [row] = await db
        .select({ preferences: users.preferences })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return row?.preferences ?? undefined;
    },

    async writePreferences({ userId, preferences, now }) {
      if (!isUuid(userId)) return;
      await db
        .update(users)
        .set({ preferences, updated_at: now })
        .where(eq(users.id, userId));
    },
  };
}

/**
 * Test double and offline path, following `createInMemoryPersonaStore`. Same
 * contract, including the two claim conditions — a double that claimed
 * unconditionally would make every test about the guard vacuous.
 */
export function createInMemoryUserStore(seed?: { idFactory?: () => string }): UserStore & {
  rows: Map<string, UserRow>;
  sessions: Map<string, { userId: string; expiresAt: Date }>;
  /**
   * Stands in for the itineraries the real store reaches across to. A test
   * pushes ids onto it; the claim empties it **in place**, so the array a test
   * holds is the array the claim mutated. (An accessor here would not survive:
   * `Object.assign` copies a getter's current value, not the getter.)
   */
  ownerlessItineraries: string[];
  personaOwners: Map<string, string | null>;
} {
  const rows = new Map<string, UserRow>();
  const live = new Map<string, { userId: string; expiresAt: Date }>();
  const ownerlessItineraries: string[] = [];
  const personaOwners = new Map<string, string | null>();

  let sequence = 0;
  const nextId =
    seed?.idFactory ??
    (() => {
      sequence += 1;
      return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
    });

  const store: UserStore = {
    async create({ email, display_name, password_hash, now }) {
      for (const row of rows.values()) if (row.email === email) return undefined;
      const row: UserRow = {
        id: nextId(),
        email,
        display_name,
        password_hash,
        preferences: null,
        created_at: now,
        updated_at: now,
      };
      rows.set(row.id, row);
      return row;
    },

    async findByEmail(email) {
      for (const row of rows.values()) if (row.email === email) return row;
      return undefined;
    },

    async findById(id) {
      return rows.get(id);
    },

    async startSession({ tokenHash, userId, expiresAt }) {
      live.set(tokenHash, { userId, expiresAt });
    },

    async userForToken(token, now) {
      const found = live.get(hashToken(token));
      if (!found || found.expiresAt <= now) return undefined;
      return rows.get(found.userId);
    },

    async endSession(token) {
      live.delete(hashToken(token));
    },

    async claimOwnerlessItineraries(userId) {
      // The same "only account there is" guard the real store puts in its
      // `where` clause. A double that claimed unconditionally would make the
      // one-shot test pass whatever the rule said.
      if (rows.size !== 1 || !rows.has(userId)) return 0;
      return ownerlessItineraries.splice(0).length;
    },

    async claimPersona({ personaId, userId }) {
      // `undefined` (no such persona) and a set owner are both refusals; only a
      // stored `null` is genuinely ownerless.
      if (personaOwners.get(personaId) !== null) return false;
      for (const owner of personaOwners.values()) if (owner === userId) return false;
      personaOwners.set(personaId, userId);
      return true;
    },

    async readPreferences(userId) {
      return rows.get(userId)?.preferences ?? undefined;
    },

    async writePreferences({ userId, preferences, now }) {
      const row = rows.get(userId);
      if (!row) return;
      rows.set(userId, { ...row, preferences, updated_at: now });
    },
  };

  return Object.assign(store, {
    rows,
    sessions: live,
    ownerlessItineraries,
    personaOwners,
  });
}
