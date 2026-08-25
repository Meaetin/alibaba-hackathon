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
   * The client's existing id, when it has one. Present means "rewrite that
   * row"; absent means "issue me an id". An id naming no row still inserts
   * under that id, so a client pointer stays valid across a wiped dev database
   * instead of silently pointing at nothing forever.
   */
  id?: string;
  answers: QuizAnswers;
  dimensions: DimensionScores;
  archetype: TravelArchetypeId;
  now: Date;
}

export interface PersonaStore {
  get(id: string): Promise<PersonaRow | undefined>;
  upsert(input: PersonaWrite): Promise<PersonaRow>;
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

    async upsert({ id, answers, dimensions, archetype, now }) {
      const values = {
        ...(id && isUuid(id) ? { id } : {}),
        answers,
        dimensions,
        archetype,
        created_at: now,
        updated_at: now,
      };
      const [row] = await db
        .insert(travel_personas)
        .values(values)
        .onConflictDoUpdate({
          target: travel_personas.id,
          // `created_at` is deliberately absent: a retake rewrites what the
          // persona says, not when the traveller first told us.
          set: { answers, dimensions, archetype, updated_at: now },
        })
        .returning();
      return row;
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

    async upsert({ id, answers, dimensions, archetype, now }) {
      const key = id && isUuid(id) ? id : nextId();
      const existing = rows.get(key);
      const row: PersonaRow = {
        id: key,
        answers,
        dimensions,
        archetype,
        created_at: existing?.created_at ?? now,
        updated_at: now,
      };
      rows.set(key, row);
      return row;
    },
  };
}
