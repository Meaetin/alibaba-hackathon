/**
 * `POST /api/persona` — where a finished quiz goes.
 *
 * The dialog used to hold its result in React state and throw it away on
 * close. This gives it a row and an id, so the create flow can name a persona
 * that was taken on another page, on another day.
 *
 * The body is `{ answers, id? }` and the reply is `{ id }`. **Answers, not
 * scores**: `calculatePersona` is a scoring function that can be retuned, and
 * an answer set survives that. The derived dimensions and archetype are stored
 * beside them so a read need not re-run the scorer, never instead of them.
 *
 * With an `id`, the row is rewritten in place — one persona per person, one
 * stable id, nothing for the client to migrate. What that costs is stated on
 * the table itself in `schema.ts`: after a retake this row no longer describes
 * who planned an older trip, which is why every itinerary snapshots its own.
 */

import { z } from "zod";

import { calculatePersona, isScorableAnswers } from "@/lib/persona/quiz";
import type { QuizAnswers } from "@/lib/persona/types";

import { personaRouteDeps, userFor } from "../deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BAD_REQUEST_MESSAGE = "We couldn't read those quiz answers. Please try again.";
const SAVE_FAILED_MESSAGE = "We couldn't save your travel persona. Please try again.";
const SIGNED_OUT_MESSAGE = "Please sign in to see your travel persona.";
const READ_FAILED_MESSAGE = "We couldn't load your travel persona. Please try again.";

/**
 * Shape only. Whether each index names a real option is `isScorableAnswers`'
 * job, because that question needs `QUESTIONS`, and a route handler that knew
 * how many options question seven has would be a second copy of the quiz.
 */
const PersonaRequestSchema = z.object({
  answers: z.array(z.union([z.number().int().nonnegative(), z.null()])),
  id: z.string().uuid().optional(),
});

/**
 * `GET /api/persona` — the signed-in traveller's persona, or `null`.
 *
 * It exists so the profile page can stop keeping its own copy. That copy was a
 * whole `PersonaResult` in `localStorage`, which meant the page could show one
 * archetype while the planner used another — exactly what
 * `src/lib/persona/storage.ts` explains the browser holds only a pointer to
 * avoid: "a cached copy of the scores would quietly out-live a change to the
 * scoring tables and there would be no way to tell."
 *
 * **The result is rebuilt from the stored answers, never read from the derived
 * columns.** Same rule `POST /api/plan` follows, and the reason `travel_personas`
 * keeps the answers at all: a retuned `calculatePersona` has to reach every
 * traveller without re-asking anyone twelve questions.
 *
 * Answers this quiz cannot score read as `null` rather than 500 — that is a row
 * written by an older question set, which is a persona we no longer have, not a
 * server fault.
 */
export async function GET(request: Request): Promise<Response> {
  const deps = personaRouteDeps.create();
  const user = await userFor(request, deps);
  if (!user) return Response.json({ error: SIGNED_OUT_MESSAGE }, { status: 401 });

  try {
    const row = await deps.personas.getByUser(user.id);
    if (!row || !isScorableAnswers(row.answers)) {
      return Response.json({ persona: null });
    }
    return Response.json({
      persona: { id: row.id, answers: row.answers, result: calculatePersona(row.answers) },
    });
  } catch (error) {
    console.error("[GET /api/persona] the persona could not be read", error);
    return Response.json({ error: READ_FAILED_MESSAGE }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: BAD_REQUEST_MESSAGE }, { status: 400 });
  }

  const parsed = PersonaRequestSchema.safeParse(body);
  if (!parsed.success) {
    console.error("[POST /api/persona] rejected request body", parsed.error.issues);
    return Response.json({ error: BAD_REQUEST_MESSAGE }, { status: 400 });
  }

  const answers: QuizAnswers = parsed.data.answers;
  if (!isScorableAnswers(answers)) {
    // Scoring indexes straight into the option list, so an out-of-range index
    // would throw inside `calculatePersona` rather than score badly.
    console.error("[POST /api/persona] answers do not match the quiz", answers);
    return Response.json({ error: BAD_REQUEST_MESSAGE }, { status: 400 });
  }

  const deps = personaRouteDeps.create();

  // The quiz itself is open to anyone — this is where the answers get a row, and
  // a row belongs to somebody. A signed-out traveller keeps their result on the
  // screen they are looking at; they just cannot store it yet.
  const user = await userFor(request, deps);
  if (!user) return Response.json({ error: SIGNED_OUT_MESSAGE }, { status: 401 });

  const result = calculatePersona(answers);

  try {
    const row = await deps.personas.upsert({
      userId: user.id,
      id: parsed.data.id,
      answers,
      dimensions: result.dimensions,
      archetype: result.archetype.id,
      now: deps.now(),
    });
    return Response.json({ id: row.id }, { status: 200 });
  } catch (error) {
    console.error("[POST /api/persona] the persona could not be saved", error);
    return Response.json({ error: SAVE_FAILED_MESSAGE }, { status: 500 });
  }
}
