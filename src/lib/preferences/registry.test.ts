import { describe, expect, it } from "vitest";

import { ARCHETYPE_PRESETS } from "@/lib/persona/presets";
import type { TravelArchetypeId } from "@/lib/persona/types";

import { PREFERENCE_BY_ID, getArchetypePreferenceIds } from "./registry";

describe("persona preference tags", () => {
  it("gives every persona a small set of registered preferences", () => {
    for (const archetypeId of Object.keys(ARCHETYPE_PRESETS) as TravelArchetypeId[]) {
      const ids = getArchetypePreferenceIds(archetypeId);

      expect(ids.length, archetypeId).toBeGreaterThanOrEqual(4);
      expect(ids.length, archetypeId).toBeLessThanOrEqual(6);
      expect(ids.every((id) => PREFERENCE_BY_ID.has(id)), archetypeId).toBe(true);
    }
  });
});
