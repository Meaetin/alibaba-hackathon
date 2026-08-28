/**
 * `GET`/`PUT /api/preferences`, driven end to end against the in-memory stores.
 *
 * The thing worth testing here is not that a blob round-trips. It is that the
 * **server owns the derivation**: `profile` on the stored shape is rebuilt from
 * the picked ids and the traveller's persona on every write, so a client cannot
 * put an arbitrary profile in the row and a retaken quiz reaches preferences
 * that were saved before it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QUESTIONS } from "@/lib/persona/quiz";
import type { QuizAnswers } from "@/lib/persona/types";
import { calculatePersona } from "@/lib/persona/quiz";
import { createInMemoryPersonaStore } from "@/lib/db/personas";
import { PREFERENCE_REGISTRY } from "@/lib/preferences/registry";
import type { SavedTravelPreferences } from "@/lib/preferences/types";

import { preferencesRouteDeps } from "../deps";
import { signedIn, signedInRequest } from "../session-fixture";
import { GET, PUT } from "./route";

const NOW = new Date("2026-08-28T10:00:00.000Z");
const LATER = new Date("2026-09-01T09:30:00.000Z");

/** Two real ids from the registry, so nothing here depends on my invention. */
const [FIRST, SECOND] = PREFERENCE_REGISTRY.map((preference) => preference.id);

const FIRST_OPTIONS: QuizAnswers = Array(QUESTIONS.length).fill(0);
const LAST_OPTIONS: QuizAnswers = QUESTIONS.map((question) => question.options.length - 1);

const originalCreate = preferencesRouteDeps.create;

let session: Awaited<ReturnType<typeof signedIn>>;
let personas: ReturnType<typeof createInMemoryPersonaStore>;

async function install(now: Date = NOW) {
  session = await signedIn({ now: NOW });
  personas = createInMemoryPersonaStore();
  preferencesRouteDeps.create = () => ({ users: session.users, personas, now: () => now });
}

function get(cookie: string | null = session.cookie): Promise<Response> {
  return GET(
    cookie
      ? signedInRequest("http://localhost/api/preferences", cookie)
      : new Request("http://localhost/api/preferences"),
  );
}

function put(body: unknown, cookie: string | null = session.cookie): Promise<Response> {
  return PUT(
    new Request("http://localhost/api/preferences", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

async function storedFrom(response: Response): Promise<SavedTravelPreferences> {
  const body = (await response.json()) as { preferences: SavedTravelPreferences };
  return body.preferences;
}

beforeEach(async () => {
  await install();
});

afterEach(() => {
  preferencesRouteDeps.create = originalCreate;
  vi.restoreAllMocks();
});

describe("GET /api/preferences", () => {
  it("answers null when the traveller has set none", async () => {
    // `null`, not an omitted key and not a 404: "you have none" is an answer,
    // and the page renders it as the "Add Preferences" state.
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ preferences: null });
  });

  it("returns what was saved", async () => {
    await put({ selectedIds: [FIRST], confirmedConstraintIds: [] });
    expect((await storedFrom(await get())).selectedIds).toEqual([FIRST]);
  });

  it("answers 401 when signed out", async () => {
    expect((await get(null)).status).toBe(401);
  });

  it("turns a failed read into a sentence, not a stack trace", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    preferencesRouteDeps.create = () => ({
      users: {
        ...session.users,
        readPreferences: () => Promise.reject(new Error('column "preferences" does not exist')),
      },
      personas,
      now: () => NOW,
    });

    const response = await get();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toMatch(/column/);
    expect(errors).toHaveBeenCalled();
  });
});

describe("PUT /api/preferences", () => {
  it("stores the picked ids and stamps the injected clock", async () => {
    await install(LATER);
    const stored = await storedFrom(await put({ selectedIds: [FIRST], confirmedConstraintIds: [] }));

    expect(stored.selectedIds).toEqual([FIRST]);
    // Not `new Date()`. Everything server-side here takes its clock.
    expect(stored.updatedAt).toBe(LATER.toISOString());
  });

  it("drops an id that no longer exists rather than refusing the save", async () => {
    // A stale id from an older build is a preference that is gone, which is a
    // reason to forget it — not to lose the eleven saved beside it.
    const stored = await storedFrom(
      await put({ selectedIds: [FIRST, "a_preference_that_never_existed"], confirmedConstraintIds: [] }),
    );
    expect(stored.selectedIds).toEqual([FIRST]);
  });

  it("ignores a profile the client tries to send", async () => {
    // The whole point of the shape on the wire: `profile` is derived from the
    // ids and the persona, so a client cannot put an arbitrary one in the row.
    const stored = await storedFrom(
      await put({
        selectedIds: [FIRST],
        confirmedConstraintIds: [],
        profile: { interests: ["nightlife"], dietary: ["invented"], pace: "packed" },
        updatedAt: "1999-01-01T00:00:00.000Z",
      }),
    );
    expect(stored.profile.dietary).not.toContain("invented");
    expect(stored.updatedAt).toBe(NOW.toISOString());
  });

  it("derives the profile from the traveller's persona, not from the request", async () => {
    // Two personas, same picked ids, different derived pace. If this stops
    // being true the persona has stopped reaching preferences at all.
    await personas.upsert({
      userId: session.user.id,
      answers: FIRST_OPTIONS,
      dimensions: calculatePersona(FIRST_OPTIONS).dimensions,
      archetype: calculatePersona(FIRST_OPTIONS).archetype.id,
      now: NOW,
    });
    const withFirst = await storedFrom(await put({ selectedIds: [FIRST], confirmedConstraintIds: [] }));

    await personas.upsert({
      userId: session.user.id,
      answers: LAST_OPTIONS,
      dimensions: calculatePersona(LAST_OPTIONS).dimensions,
      archetype: calculatePersona(LAST_OPTIONS).archetype.id,
      now: NOW,
    });
    const withLast = await storedFrom(await put({ selectedIds: [FIRST], confirmedConstraintIds: [] }));

    expect(withFirst.selectedIds).toEqual(withLast.selectedIds);
    expect([withFirst.profile.pace, withFirst.profile.budget]).not.toEqual([
      withLast.profile.pace,
      withLast.profile.budget,
    ]);
  });

  it("saves for a traveller who has never taken the quiz", async () => {
    // No persona is a supported path, exactly as it is in the planner. It costs
    // pace and budget, never the save.
    const stored = await storedFrom(await put({ selectedIds: [FIRST], confirmedConstraintIds: [] }));
    expect(stored.profile.pace).toBe("balanced");
    expect(stored.profile.budget).toBeUndefined();
  });

  it("saves even when the persona cannot be read", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    preferencesRouteDeps.create = () => ({
      users: session.users,
      personas: { ...personas, getByUser: () => Promise.reject(new Error("down")) },
      now: () => NOW,
    });

    const response = await put({ selectedIds: [FIRST], confirmedConstraintIds: [] });
    expect(response.status).toBe(200);
    expect(errors).toHaveBeenCalled();
  });

  it("replaces the set wholesale rather than merging", async () => {
    await put({ selectedIds: [FIRST, SECOND], confirmedConstraintIds: [] });
    const stored = await storedFrom(await put({ selectedIds: [SECOND], confirmedConstraintIds: [] }));
    expect(stored.selectedIds).toEqual([SECOND]);
  });

  it("refuses a signed-out caller, and writes nothing", async () => {
    const response = await put({ selectedIds: [FIRST], confirmedConstraintIds: [] }, null);
    expect(response.status).toBe(401);
    expect(await session.users.readPreferences(session.user.id)).toBeUndefined();
  });

  it("refuses a body that is not a preferences request", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const body of [{}, { selectedIds: "nope", confirmedConstraintIds: [] }, "not json at all"]) {
      expect((await put(body)).status).toBe(400);
    }
    // A clock face, not free text — the planner reads it as one.
    expect(
      (await put({ selectedIds: [], confirmedConstraintIds: [], preferredEndTime: "half eight" }))
        .status,
    ).toBe(400);
    expect(errors).toHaveBeenCalled();
  });

  it("keeps a valid preferred end time", async () => {
    const stored = await storedFrom(
      await put({ selectedIds: ["early_evenings"], confirmedConstraintIds: [], preferredEndTime: "21:30" }),
    );
    expect(stored.preferredEndTime).toBe("21:30");
  });
});
