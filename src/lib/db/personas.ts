/**
 * Storage for the travel persona: one row, one stable id, rewritten on a
 * retake.
 *
 * A port with an in-memory double, following `PlanStore` in `itineraries.ts`
 * rather than `SearchCache` in `stores.ts` — the ports in `stores.ts` are
 * declared by the planner, and nothing in the planner knows a persona has a
 * row. This one is declared where its consumers live: the two route handlers.
 *
 * The store holds no decisions. It is handed the answers **and** the values
 * derived from them, because the derivation is `calculatePersona` and that
 * belongs to `src/lib/persona`, not to a table. Read `answers` back to
 * re-derive; read `dimensions` / `archetype` to avoid having to.
 */

import { eq } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";

import type { DimensionScores, QuizAnswers, TravelArchetypeId } from "@/lib/persona/types";

import type { Database } from "./client";
import { isUuid } from "./itineraries";
import { travel_personas } from "./schema";

export type PersonaRow = InferSelectModel<typeof travel_personas>;

export interface PersonaWrite {
  /**
   * Who this persona belongs to. **This is the key**, not `id` — the table
   * promises one persona per person and `travel_personas.user_id` is unique, so
   * a retake has to find the traveller's existing row rather than trust
   * whatever pointer the browser happens to be holding.
   */
  userId: string;
  /**
   * The client's `localStorage` pointer, when it has one. Advisory now that the
   * user is the key: it is used only to choose the id of a **new** row, so a
   * browser that already had a persona keeps the same id across this change
   * instead of pointing at nothing forever. Ignored when the traveller already
   * has a row, and ignored when some other row already holds it.
   */
  id?: string;
  answers: QuizAnswers;
  dimensions: DimensionScores;
  archetype: TravelArchetypeId;
  now: Date;
}

export interface PersonaStore {
  get(id: string): Promise<PersonaRow | undefined>;
  /** The traveller's persona, which is what every read after sign-in wants. */
  getByUser(userId: string): Promise<PersonaRow | undefined>;
  upsert(input: PersonaWrite): Promise<PersonaRow>;
  /** Removes the traveller's current persona. Retake uses this before a new result exists. */
  deleteByUser(userId: string): Promise<boolean>;
}

export function createPersonaStore(db: Database): PersonaStore {
  return {
    async get(id) {
      // A non-uuid reaches Postgres as a cast error rather than an empty
      // result, and "not a uuid" is a miss, not a 500.
      if (!isUuid(id)) return undefined;
      const [row] = await db
        .select()
        .from(travel_personas)
        .where(eq(travel_personas.id, id))
        .limit(1);
      return row;
    },

    async getByUser(userId) {
      if (!isUuid(userId)) return undefined;
      const [row] = await db
        .select()
        .from(travel_personas)
        .where(eq(travel_personas.user_id, userId))
        .limit(1);
      return row;
    },

    async upsert({ userId, id, answers, dimensions, archetype, now }) {
      // `user_id` is unique, so the conflict target is the traveller and a
      // retake rewrites their one row whatever id the browser sent. Two round
      // trips are not needed and would race; one statement settles it.
      //
      // The requested id is honoured only on the insert branch — Postgres
      // ignores it entirely when the conflict fires, which is exactly the
      // "advisory pointer" rule stated on `PersonaWrite`.
      const [row] = await db
        .insert(travel_personas)
        .values({
          ...(id && isUuid(id) ? { id } : {}),
          user_id: userId,
          answers,
          dimensions,
          archetype,
          created_at: now,
          updated_at: now,
        })
        .onConflictDoUpdate({
          target: travel_personas.user_id,
          // `created_at` is deliberately absent: a retake rewrites what the
          // persona says, not when the traveller first told us.
          set: { answers, dimensions, archetype, updated_at: now },
        })
        .returning();
      return row;
    },

    async deleteByUser(userId) {
      if (!isUuid(userId)) return false;
      const deleted = await db
        .delete(travel_personas)
        .where(eq(travel_personas.user_id, userId))
        .returning({ id: travel_personas.id });
      return deleted.length > 0;
    },
  };
}

/**
 * Test double and offline path, following `createInMemoryPlanStore`. Same
 * contract, including an unknown id inserting under that id rather than
 * inventing a new one.
 */
export function createInMemoryPersonaStore(seed?: {
  idFactory?: () => string;
}): PersonaStore & { rows: Map<string, PersonaRow> } {
  const rows = new Map<string, PersonaRow>();
  let sequence = 0;
  const nextId =
    seed?.idFactory ??
    (() => {
      sequence += 1;
      return `00000000-0000-4000-9000-${String(sequence).padStart(12, "0")}`;
    });

  return {
    rows,

    async get(id) {
      return rows.get(id);
    },

    async getByUser(userId) {
      for (const row of rows.values()) if (row.user_id === userId) return row;
      return undefined;
    },

    async upsert({ userId, id, answers, dimensions, archetype, now }) {
      // Same resolution order as the real store: the traveller's row wins, and
      // the requested id only ever names a new one. A double that keyed on `id`
      // would make every test about "one persona per person" vacuous.
      let existing: PersonaRow | undefined;
      for (const row of rows.values()) if (row.user_id === userId) existing = row;

      const key = existing?.id ?? (id && isUuid(id) && !rows.has(id) ? id : nextId());
      const row: PersonaRow = {
        id: key,
        user_id: userId,
        answers,
        dimensions,
        archetype,
        created_at: existing?.created_at ?? now,
        updated_at: now,
      };
      rows.set(key, row);
      return row;
    },

    async deleteByUser(userId) {
      for (const [id, row] of rows) {
        if (row.user_id !== userId) continue;
        rows.delete(id);
        return true;
      }
      return false;
    },
  };
}
