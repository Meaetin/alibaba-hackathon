import { describe, expect, it } from "vitest";

import { interpretPreferenceText } from "./interpreter";

describe("interpretPreferenceText", () => {
  it("extracts structured preferences from the supplied example", () => {
    const result = interpretPreferenceText(
      "i am allergic to seafood and i like hiking usually. i am a breakfast person and dont like to stay out late",
    );

    expect(result.items.map((item) => item.id)).toEqual(
      expect.arrayContaining(["seafood_allergy", "hiking", "breakfast_focus", "early_evenings"]),
    );
    expect(result.items.find((item) => item.id === "seafood_allergy")?.requiresConfirmation).toBe(true);
    expect(result.items.find((item) => item.id === "early_evenings")?.requiresConfirmation).toBe(true);
  });

  it("maps short phrases to canonical tags", () => {
    expect(interpretPreferenceText("sunrise hikes").items.map((item) => item.id)).toContain("hiking");
    expect(interpretPreferenceText("local bakeries").items.map((item) => item.id)).toContain("cafes");
  });

  it("does not turn a negated interest into a positive tag", () => {
    expect(interpretPreferenceText("I don't like nightlife").items.map((item) => item.id)).not.toContain("nightlife");
  });
});
