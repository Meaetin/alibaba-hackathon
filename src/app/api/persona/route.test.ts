/**
 * `POST /api/persona`, driven through the real handler with a fake store.
 *
 * The properties worth holding here are all about identity and rejection:
 * an id issued once must never move, a retake must land on the same row, and
 * an answer set the quiz cannot score must be turned away at the door rather
 * than throwing inside `calculatePersona`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { createInMemoryPersonaStore } from "@/lib/db/personas";
import { calculatePersona, QUESTIONS } from "@/lib/persona/quiz";

import { personaRouteDeps } from "../deps";
import { POST } from "./route";

const NOW = new Date("2026-08-25T09:00:00.000Z");
const LATER = new Date("2026-08-26T09:00:00.000Z");

const originalCreate = personaRouteDeps.create;

/** Every question answered with its first option. */
const FIRST_OPTIONS = Array(QUESTIONS.length).fill(0);
/** Every question answered with its last option — a different persona. */
const LAST_OPTIONS = QUESTIONS.map((question) => question.options.length - 1);

function install(now: Date = NOW) {
  const personas = createInMemoryPersonaStore();
  personaRouteDeps.create = () => ({ personas, now: () => now });
  return personas;
}

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/persona", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

afterEach(() => {
  personaRouteDeps.create = originalCreate;
  vi.restoreAllMocks();
});

describe("POST /api/persona", () => {
  it("stores the answers and the derivation, and returns only the id", async () => {
    const personas = install();

    const response = await post({ answers: FIRST_OPTIONS });
    expect(response.status).toBe(200);

    const body = (await response.json()) as { id: string };
    expect(typeof body.id).toBe("string");

    const row = await personas.get(body.id);
    // The answers are the source of truth; the other two columns exist so a
    // read need not re-run the scorer, never instead of them.
    expect(row?.answers).toEqual(FIRST_OPTIONS);
    const expected = calculatePersona(FIRST_OPTIONS);
    expect(row?.dimensions).toEqual(expected.dimensions);
    expect(row?.archetype).toBe(expected.archetype.id);
  });

  it("keeps the reply to the id — the client already has the result", async () => {
    install();
    const body = (await (await post({ answers: FIRST_OPTIONS })).json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["id"]);
  });

  it("rewrites the same row on a retake, keeping the id and created_at", async () => {
    const personas = install();
    const first = (await (await post({ answers: FIRST_OPTIONS })).json()) as { id: string };

    personaRouteDeps.create = () => ({ personas, now: () => LATER });
    const second = (await (await post({ answers: LAST_OPTIONS, id: first.id })).json()) as {
      id: string;
    };

    expect(second.id).toBe(first.id);
    expect(personas.rows.size).toBe(1);

    const row = await personas.get(first.id);
    expect(row?.answers).toEqual(LAST_OPTIONS);
    // A retake rewrites what the persona says, not when it was first taken.
    expect(row?.created_at).toEqual(NOW);
    expect(row?.updated_at).toEqual(LATER);
  });

  it("keeps a client pointer valid when its row is gone", async () => {
    const personas = install();
    const orphan = "11111111-2222-4333-8444-555555555555";

    const body = (await (await post({ answers: FIRST_OPTIONS, id: orphan })).json()) as {
      id: string;
    };

    // Inserting under the id the client already holds beats issuing a new one:
    // a wiped dev database would otherwise strand that pointer forever.
    expect(body.id).toBe(orphan);
    expect(await personas.get(orphan)).toBeDefined();
  });

  it("rejects an option index the quiz does not have, without throwing", async () => {
    install();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    // One past the end of question one. `scoreAnswers` indexes straight into
    // the option list, so reaching the scorer would be a TypeError, not a 400.
    const overrun = [...FIRST_OPTIONS];
    overrun[0] = QUESTIONS[0].options.length;

    const response = await post({ answers: overrun });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(/quiz answers/);
    expect(errors).toHaveBeenCalled();
  });

  it("rejects an answer array that is not the length of the quiz", async () => {
    install();
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await post({ answers: [0, 1, 2] })).status).toBe(400);
  });

  it("accepts a partly answered quiz — an unanswered question just scores nothing", async () => {
    const personas = install();
    const partial = [...FIRST_OPTIONS];
    partial[3] = null;

    const body = (await (await post({ answers: partial })).json()) as { id: string };
    expect((await personas.get(body.id))?.answers).toEqual(partial);
  });

  it("turns a store failure into a sentence, not a stack trace", async () => {
    const personas = createInMemoryPersonaStore();
    personaRouteDeps.create = () => ({
      personas: {
        ...personas,
        upsert: () => Promise.reject(new Error('relation "travel_personas" does not exist')),
      },
      now: () => NOW,
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await post({ answers: FIRST_OPTIONS });
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/travel persona/);
    expect(body.error).not.toMatch(/relation/);
    expect(errors).toHaveBeenCalled();
  });
});
