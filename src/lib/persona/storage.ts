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

import type { SavedTravelPreferences } from "@/lib/preferences/types";

import type { QuizAnswers, TravelPersona } from "./types";

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

/**
 * The signed-in traveller's persona, straight from `GET /api/persona`.
 *
 * The profile page used to keep its own `PersonaResult` in `localStorage`
 * beside the server's row, which is the cached copy the note at the top of this
 * file says not to keep: it could show one archetype while the planner used
 * another, and nothing would say so. This is the read that replaced it.
 *
 * Returns `null` for signed out, for never having taken the quiz, and for a
 * failed request alike. All three render as "take the quiz", and a page that
 * distinguished them would need three empty states for one button.
 */
export async function fetchPersona(): Promise<TravelPersona | null> {
  try {
    const response = await fetch("/api/persona", { credentials: "same-origin" });
    if (!response.ok) return null;
    const body = (await response.json()) as { persona?: TravelPersona | null };
    return body.persona ?? null;
  } catch (error) {
    console.error("[persona] the saved persona could not be read", error);
    return null;
  }
}

/**
 * Clears the signed-in traveller's persona and returns the preferences left
 * after the server removes that archetype's preset tags.
 *
 * `undefined` means the reset did not land. Like the other persistence helpers
 * here, this logs the technical detail and leaves user-facing wording to the
 * surface that initiated the action.
 */
export async function resetPersona(): Promise<SavedTravelPreferences | null | undefined> {
  try {
    const response = await fetch("/api/persona", {
      method: "DELETE",
      credentials: "same-origin",
    });
    if (!response.ok) {
      console.error("[persona] the saved persona could not be reset", response.status);
      return undefined;
    }
    const body = (await response.json()) as {
      preferences?: SavedTravelPreferences | null;
    };
    clearPersonaId();
    return body.preferences ?? null;
  } catch (error) {
    console.error("[persona] the saved persona could not be reset", error);
    return undefined;
  }
}
