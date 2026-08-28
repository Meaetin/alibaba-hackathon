import type { PreferenceProfile } from "@/lib/planner/types";

export type PreferenceCategory =
  | "interest"
  | "dietary"
  | "meal"
  | "schedule";

export type PreferenceGroup =
  | "Culture & sights"
  | "Food & drink"
  | "Nature & adventure"
  | "Wellness & rest"
  | "Local life & social"
  | "Practical preferences";

export interface PreferenceDefinition {
  id: string;
  label: string;
  category: PreferenceCategory;
  group: PreferenceGroup;
  aliases: readonly string[];
  /** Google Places types that receive a soft ranking boost. */
  placeTypes?: readonly string[];
  /** Safety-sensitive or ambiguous preferences must be explicitly confirmed. */
  requiresConfirmation?: boolean;
}

export interface InterpretedPreference {
  id: string;
  confidence: number;
  evidence: string;
  requiresConfirmation: boolean;
}

export interface PreferenceInterpretation {
  items: InterpretedPreference[];
  unresolved: string[];
  source: "ai" | "rules";
}

export interface SavedTravelPreferences {
  selectedIds: string[];
  confirmedConstraintIds: string[];
  preferredEndTime?: string;
  /** Planner-ready projection of the selected tags. */
  profile: PreferenceProfile;
  updatedAt: string;
}

