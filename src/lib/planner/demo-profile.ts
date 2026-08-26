import type { PreferenceProfile } from "./types";

/**
 * Temporary profile used by the localhost demo for the fields the create flow
 * still does not collect. Dietary is deliberately empty: inventing a hard food
 * constraint for the user would be worse than omitting one.
 *
 * `pace` here is only the fallback. The create modal asks for it directly now,
 * and `createItineraryRouted` overwrites this field with the answer — a thing
 * the user typed beats a default, and beats anything the quiz infers.
 */
export const LOCAL_DEMO_PROFILE: PreferenceProfile = {
  interests: ["outdoors", "cafes", "museums", "food"],
  dietary: [],
  pace: "balanced",
};

export const LOCAL_DEMO_PROFILE_LABEL =
  "Demo interests: outdoors, cafés, museums and food";
