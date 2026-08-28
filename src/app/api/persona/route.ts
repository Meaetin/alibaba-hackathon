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
const SIGNED_OUT_MESSAGE = "Please sign in to save your travel persona.";

/**
 * Shape only. Whether each index names a real option is `isScorableAnswers`'
 * job, because that question needs `QUESTIONS`, and a route handler that knew
 * how many options question seven has would be a second copy of the quiz.
 */
const PersonaRequestSchema = z.object({
  answers: z.array(z.union([z.number().int().nonnegative(), z.null()])),
  id: z.string().uuid().optional(),
});

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
