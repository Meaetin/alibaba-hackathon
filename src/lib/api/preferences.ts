import type {
  PreferenceInterpretation,
  SavedTravelPreferences,
} from "@/lib/preferences/types";

export async function interpretTravelPreferences(
  text: string,
  signal?: AbortSignal,
): Promise<PreferenceInterpretation> {
  const response = await fetch("/api/preferences/interpret", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
    signal,
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? "We couldn't interpret that preference.");
  }
  return response.json() as Promise<PreferenceInterpretation>;
}


/**
 * The traveller's saved preferences, or `null` if they have set none.
 *
 * These live on the `users` row now, not in `localStorage`, so they follow the
 * person rather than the browser. A 401 returns `null` rather than throwing:
 * the middleware redirects a signed-out visitor before the profile page
 * renders, so a 401 here means the session expired mid-session, and the "Add
 * Preferences" empty state is a better answer than an error card in the second
 * before the next navigation redirects.
 */
export async function fetchTravelPreferences(): Promise<SavedTravelPreferences | null> {
  const response = await fetch("/api/preferences", { credentials: "same-origin" });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error("We couldn't load your travel preferences.");
  const body = (await response.json()) as { preferences: SavedTravelPreferences | null };
  return body.preferences;
}

/**
 * Saves the picked ids and returns what the server actually stored.
 *
 * **Only the ids go over the wire.** The planner-ready `profile` on the stored
 * shape is derived server-side from these ids and the traveller's persona, so
 * that a retuned mapping or a retaken quiz reaches the row instead of being
 * frozen at whatever this browser computed. Callers must render the returned
 * value, not the one they sent — the two differ whenever an id was dropped.
 */
export async function saveTravelPreferences(input: {
  selectedIds: readonly string[];
  confirmedConstraintIds: readonly string[];
  preferredEndTime?: string;
}): Promise<SavedTravelPreferences> {
  const response = await fetch("/api/preferences", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      selectedIds: input.selectedIds,
      confirmedConstraintIds: input.confirmedConstraintIds,
      ...(input.preferredEndTime ? { preferredEndTime: input.preferredEndTime } : {}),
    }),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? "We couldn't save your travel preferences.");
  }
  const body = (await response.json()) as { preferences: SavedTravelPreferences };
  return body.preferences;
}
