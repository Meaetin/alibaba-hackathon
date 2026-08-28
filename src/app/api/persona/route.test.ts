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
import { signedIn } from "../session-fixture";
import { GET, POST } from "./route";

const NOW = new Date("2026-08-25T09:00:00.000Z");
const LATER = new Date("2026-08-26T09:00:00.000Z");

const originalCreate = personaRouteDeps.create;

/** Rebuilt per install, so each test gets a fresh account and session. */
let session: Awaited<ReturnType<typeof signedIn>>;

/** Every question answered with its first option. */
const FIRST_OPTIONS = Array(QUESTIONS.length).fill(0);
/** Every question answered with its last option — a different persona. */
const LAST_OPTIONS = QUESTIONS.map((question) => question.options.length - 1);

async function install(now: Date = NOW) {
  const personas = createInMemoryPersonaStore();
  session = await signedIn({ now });
  personaRouteDeps.create = () => ({ personas, users: session.users, now: () => now });
  return personas;
}

function post(body: unknown, cookie: string = session.cookie): Promise<Response> {
  return POST(
    new Request("http://localhost/api/persona", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
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
    const personas = await install();

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
    await install();
    const body = (await (await post({ answers: FIRST_OPTIONS })).json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["id"]);
  });

  it("rewrites the same row on a retake, keeping the id and created_at", async () => {
    const personas = await install();
    const first = (await (await post({ answers: FIRST_OPTIONS })).json()) as { id: string };

    personaRouteDeps.create = () => ({ personas, users: session.users, now: () => LATER });
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
    const personas = await install();
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
    await install();
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
    await install();
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await post({ answers: [0, 1, 2] })).status).toBe(400);
  });

  it("accepts a partly answered quiz — an unanswered question just scores nothing", async () => {
    const personas = await install();
    const partial = [...FIRST_OPTIONS];
    partial[3] = null;

    const body = (await (await post({ answers: partial })).json()) as { id: string };
    expect((await personas.get(body.id))?.answers).toEqual(partial);
  });

  it("refuses to store a persona for a signed-out caller", async () => {
    const personas = await install();
    const response = await post({ answers: FIRST_OPTIONS }, "");

    expect(response.status).toBe(401);
    // A row has to belong to somebody. The quiz result still renders on the
    // screen the traveller is looking at; it just has nowhere to live yet.
    expect(personas.rows.size).toBe(0);
  });

  it("keys the row on the traveller, not on the id the browser sent", async () => {
    const personas = await install();
    // A stale pointer from another browser must not be able to name the row
    // this traveller's answers land in.
    const first = (await (await post({ answers: FIRST_OPTIONS }))).json() as Promise<{ id: string }>;
    const { id } = await first;

    await post({ answers: LAST_OPTIONS, id: "99999999-8888-4777-8666-555555555555" });

    expect(personas.rows.size).toBe(1);
    expect((await personas.get(id))?.answers).toEqual(LAST_OPTIONS);
    expect((await personas.getByUser(session.user.id))?.id).toBe(id);
  });

  it("turns a store failure into a sentence, not a stack trace", async () => {
    const personas = createInMemoryPersonaStore();
    session = await signedIn();
    personaRouteDeps.create = () => ({
      personas: {
        ...personas,
        upsert: () => Promise.reject(new Error('relation "travel_personas" does not exist')),
      },
      users: session.users,
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

describe("GET /api/persona", () => {
  function get(cookie: string | null = session.cookie): Promise<Response> {
    return GET(
      new Request("http://localhost/api/persona", {
        headers: cookie ? { cookie } : {},
      }),
    );
  }

  it("answers null when the traveller has never taken the quiz", async () => {
    await install();
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ persona: null });
  });

  it("returns the answers and the result built from them", async () => {
    await install();
    await post({ answers: FIRST_OPTIONS });

    const body = (await (await get()).json()) as {
      persona: { answers: unknown; result: { archetype: { id: string } } };
    };
    expect(body.persona.answers).toEqual(FIRST_OPTIONS);
    expect(body.persona.result.archetype.id).toBe(
      calculatePersona(FIRST_OPTIONS).archetype.id,
    );
  });

  it("rebuilds the result from the answers, not from the stored columns", async () => {
    // The reason `travel_personas` keeps the answers at all: a retuned
    // `calculatePersona` has to reach every traveller without re-asking anyone
    // twelve questions. Storing deliberately wrong scores proves the read
    // ignores them.
    const personas = await install();
    await personas.upsert({
      userId: session.user.id,
      answers: FIRST_OPTIONS,
      dimensions: { structure: 0, comfort: 0, focus: 0, social: 0 },
      // A lie, and it has to be a lie that differs from the truth:
      // FIRST_OPTIONS really does score `weekend_warrior`, so using that as the
      // fake proved nothing. The guard below is what caught it.
      archetype: "soulful_soloist",
      now: NOW,
    });

    const body = (await (await get()).json()) as {
      persona: { result: { dimensions: unknown; archetype: { id: string } } };
    };
    const expected = calculatePersona(FIRST_OPTIONS);
    expect(expected.archetype.id).not.toBe("soulful_soloist");
    expect(body.persona.result.dimensions).toEqual(expected.dimensions);
    expect(body.persona.result.archetype.id).toBe(expected.archetype.id);
  });

  it("reads null for answers this quiz can no longer score", async () => {
    // A row written by an older question set is a persona we no longer have,
    // not a server fault.
    const personas = await install();
    await personas.upsert({
      userId: session.user.id,
      answers: [0, 0],
      dimensions: { structure: 50, comfort: 50, focus: 50, social: 50 },
      archetype: "weekend_warrior",
      now: NOW,
    });

    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ persona: null });
  });

  it("answers 401 when signed out", async () => {
    await install();
    expect((await get(null)).status).toBe(401);
  });

  it("never returns another traveller's persona", async () => {
    const personas = await install();
    await post({ answers: FIRST_OPTIONS });

    const other = await signedIn({ email: "other@example.com", token: "other-token" });
    personaRouteDeps.create = () => ({ personas, users: other.users, now: () => NOW });

    expect(await (await get(other.cookie)).json()).toEqual({ persona: null });
  });

  it("turns a store failure into a sentence, not a stack trace", async () => {
    const personas = await install();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    personaRouteDeps.create = () => ({
      personas: { ...personas, getByUser: () => Promise.reject(new Error('relation "x" gone')) },
      users: session.users,
      now: () => NOW,
    });

    const response = await get();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toMatch(/relation/);
    expect(errors).toHaveBeenCalled();
  });
});
