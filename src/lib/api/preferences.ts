import type { PreferenceInterpretation } from "@/lib/preferences/types";

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

