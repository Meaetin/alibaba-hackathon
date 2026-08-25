import type { PreferenceProfile } from "./types";

/**
 * Temporary profile used by the localhost demo until the create flow collects
 * traveller preferences. Dietary is deliberately empty: inventing a hard food
 * constraint for the user would be worse than omitting one.
 */
export const LOCAL_DEMO_PROFILE: PreferenceProfile = {
  interests: ["outdoors", "cafes", "museums", "food"],
  dietary: [],
  pace: "balanced",
};

export const LOCAL_DEMO_PROFILE_LABEL =
  "Demo profile: outdoors, cafés, museums and food · balanced pace";
