/**
 * `GET`/`PUT /api/preferences` — the traveller's saved travel preferences.
 *
 * They used to live in `localStorage`, keyed by user id, which meant they
 * followed a browser rather than a person: the same account on a laptop and a
 * phone had two different sets, and clearing site data lost them.
 *
 * ## The client sends ids; the server derives the rest
 *
 * The stored shape carries a planner-ready `profile` alongside the picked
 * `selectedIds`, and only the ids come over the wire. The server rebuilds the
 * profile with `createSavedPreferences` on every write, using the traveller's
 * own persona — so a retuned `buildPreferenceProfile`, or a retaken quiz,
 * reaches the stored row rather than being frozen at whatever the browser
 * computed on the day.
 *
 * That is the same rule `POST /api/persona` keeps about `calculatePersona`:
 * the answers are the source of truth and the derivation belongs to the server.
 * Accepting a client-computed `profile` would make it a fourth thing to keep
 * true, and one nobody could re-derive after the fact.
 *
 * ## Unknown ids are dropped, not rejected
 *
 * `createSavedPreferences` filters to ids in `PREFERENCE_REGISTRY`. A stale id
 * from an older build is a preference that no longer exists, which is a reason
 * to forget it rather than to refuse the whole save and lose the other eleven.
 */

import { z } from "zod";

import { calculatePersona, isScorableAnswers } from "@/lib/persona/quiz";
import type { PersonaResult } from "@/lib/persona/types";
import { createSavedPreferences } from "@/lib/preferences/registry";

import { preferencesRouteDeps, userFor } from "../deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGNED_OUT_MESSAGE = "Please sign in to save your travel preferences.";
const BAD_REQUEST_MESSAGE = "We couldn't read those preferences. Please try again.";
const READ_FAILED_MESSAGE = "We couldn't load your travel preferences. Please try again.";
const SAVE_FAILED_MESSAGE = "We couldn't save your travel preferences. Please try again.";

/** Only the picked ids. Everything else on the stored shape is derived. */
const PreferencesRequestSchema = z.object({
  selectedIds: z.array(z.string().trim().min(1)).max(200),
  confirmedConstraintIds: z.array(z.string().trim().min(1)).max(200),
  /** A clock face, `HH:MM`. Meaningful only with `early_evenings` picked. */
  preferredEndTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
});

export async function GET(request: Request): Promise<Response> {
  const deps = preferencesRouteDeps.create();
  const user = await userFor(request, deps);
  if (!user) return Response.json({ error: SIGNED_OUT_MESSAGE }, { status: 401 });

  try {
    // `null`, never an omitted key: "this traveller has set none" is an answer,
    // and the client renders it as the "Add Preferences" state.
    return Response.json({ preferences: (await deps.users.readPreferences(user.id)) ?? null });
  } catch (error) {
    console.error("[GET /api/preferences] could not be read", error);
    return Response.json({ error: READ_FAILED_MESSAGE }, { status: 500 });
  }
}

export async function PUT(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: BAD_REQUEST_MESSAGE }, { status: 400 });
  }

  const parsed = PreferencesRequestSchema.safeParse(body);
  if (!parsed.success) {
    console.error("[PUT /api/preferences] rejected request body", parsed.error.issues);
    return Response.json({ error: BAD_REQUEST_MESSAGE }, { status: 400 });
  }

  const deps = preferencesRouteDeps.create();
  const user = await userFor(request, deps);
  if (!user) return Response.json({ error: SIGNED_OUT_MESSAGE }, { status: 401 });

  try {
    const preferences = createSavedPreferences(
      parsed.data.selectedIds,
      parsed.data.confirmedConstraintIds,
      parsed.data.preferredEndTime,
      await resolvePersona(user.id, deps),
      deps.now(),
    );
    await deps.users.writePreferences({ userId: user.id, preferences, now: deps.now() });
    // Echo what was stored rather than what was sent — the two differ whenever
    // an id was dropped or the persona moved the pace, and the client must
    // render the stored answer.
    return Response.json({ preferences });
  } catch (error) {
    console.error("[PUT /api/preferences] could not be saved", error);
    return Response.json({ error: SAVE_FAILED_MESSAGE }, { status: 500 });
  }
}

/**
 * The traveller's persona, rebuilt from their stored answers.
 *
 * **No persona is a supported path**, exactly as it is in the planner: the
 * preference profile falls back to a balanced pace and no budget rather than
 * refusing the save. Somebody may set preferences before taking the quiz.
 */
async function resolvePersona(
  userId: string,
  deps: ReturnType<typeof preferencesRouteDeps.create>,
): Promise<PersonaResult | null> {
  try {
    const row = await deps.personas.getByUser(userId);
    if (!row || !isScorableAnswers(row.answers)) return null;
    return calculatePersona(row.answers);
  } catch (error) {
    // A persona that cannot be read costs pace and budget, never the save.
    console.error(`[PUT /api/preferences] the persona for ${userId} could not be read`, error);
    return null;
  }
}
