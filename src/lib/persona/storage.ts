/**
 * The client's half of persona persistence: **one id in `localStorage`, and
 * nothing else.**
 *
 * The answers, the scores and the archetype all live in `travel_personas`. The
 * browser keeps a pointer because a pointer cannot go stale in a way that
 * matters — an id naming no row plans without a persona, which is a supported
 * path, whereas a cached copy of the scores would quietly out-live a change to
 * the scoring tables and there would be no way to tell.
 *
 * Nothing here throws. A traveller who has just answered twelve questions must
 * see their result whether or not the write landed; a failed save costs them
 * personalisation on the next plan, not the screen they are looking at.
 */

import type { QuizAnswers } from "./types";

/** Namespaced so it is obvious in devtools which app wrote it. */
export const PERSONA_ID_STORAGE_KEY = "argo.persona.id";

/** `localStorage` is absent during SSR and throws outright in a locked-down
 *  browser profile. Both are "this browser has no persona", not an error. */
function storage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function readPersonaId(): string | undefined {
  return storage()?.getItem(PERSONA_ID_STORAGE_KEY) ?? undefined;
}

export function writePersonaId(id: string): void {
  try {
    storage()?.setItem(PERSONA_ID_STORAGE_KEY, id);
  } catch {
    // A full or blocked store is not worth a broken quiz result screen.
  }
}

export function clearPersonaId(): void {
  try {
    storage()?.removeItem(PERSONA_ID_STORAGE_KEY);
  } catch {
    // Same.
  }
}

/**
 * Sends a finished quiz to `POST /api/persona` and remembers the id it comes
 * back with.
 *
 * Sends the existing id when there is one, which is what makes a retake rewrite
 * the same row instead of littering the table — one persona per person, one
 * stable id, no pointer churn here.
 *
 * Returns the id on success and `undefined` on any failure, having already
 * logged the technical detail. Callers treat `undefined` as "this browser has
 * no persona yet" and carry on.
 */
export async function savePersona(answers: QuizAnswers): Promise<string | undefined> {
  const existing = readPersonaId();
  try {
    const response = await fetch("/api/persona", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers, ...(existing ? { id: existing } : {}) }),
    });
    if (!response.ok) {
      console.error("[persona] the quiz result could not be saved", response.status);
      return undefined;
    }
    const body = (await response.json()) as { id?: unknown };
    if (typeof body.id !== "string") {
      console.error("[persona] the save reply carried no id", body);
      return undefined;
    }
    writePersonaId(body.id);
    return body.id;
  } catch (error) {
    console.error("[persona] the quiz result could not be saved", error);
    return undefined;
  }
}
