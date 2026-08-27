import { PREFERENCE_BY_ID, PREFERENCE_REGISTRY } from "./registry";
import type { InterpretedPreference, PreferenceInterpretation } from "./types";

const NEGATION_PATTERN = /\b(?:don['’]?t|dont|do not|not|avoid|dislike|hate|never)\b/i;

function normalized(value: string): string {
  return value.toLocaleLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ").trim();
}

function isNegatedInterest(text: string, aliasIndex: number): boolean {
  const prefix = text.slice(Math.max(0, aliasIndex - 32), aliasIndex);
  return NEGATION_PATTERN.test(prefix);
}

export function interpretPreferenceText(text: string): PreferenceInterpretation {
  const value = normalized(text);
  const items: InterpretedPreference[] = [];

  for (const definition of PREFERENCE_REGISTRY) {
    const alias = [...definition.aliases]
      .sort((a, b) => b.length - a.length)
      .find((candidate) => {
        const index = value.indexOf(normalized(candidate));
        if (index < 0) return false;
        return definition.category !== "interest" || !isNegatedInterest(value, index);
      });
    if (!alias) continue;

    items.push({
      id: definition.id,
      confidence: definition.requiresConfirmation ? 0.98 : 0.92,
      evidence: alias,
      requiresConfirmation: Boolean(definition.requiresConfirmation),
    });
  }

  // Longer, safer matches win when aliases overlap (e.g. local markets / markets).
  const unique = new Map<string, InterpretedPreference>();
  for (const item of items) unique.set(item.id, item);

  return {
    items: [...unique.values()],
    unresolved: unique.size === 0 && value ? [text.trim()] : [],
    source: "rules",
  };
}

export function sanitizeInterpretation(value: unknown): PreferenceInterpretation | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { items?: unknown; unresolved?: unknown };
  if (!Array.isArray(candidate.items)) return null;
  const seen = new Set<string>();
  const items: InterpretedPreference[] = [];
  for (const raw of candidate.items) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.id !== "string" || seen.has(item.id)) continue;
    const definition = PREFERENCE_BY_ID.get(item.id);
    if (!definition) continue;
    seen.add(item.id);
    items.push({
      id: item.id,
      confidence: typeof item.confidence === "number" ? Math.max(0, Math.min(1, item.confidence)) : 0.75,
      evidence: typeof item.evidence === "string" ? item.evidence.slice(0, 160) : "",
      requiresConfirmation: Boolean(definition.requiresConfirmation),
    });
  }
  return {
    items,
    unresolved: Array.isArray(candidate.unresolved)
      ? candidate.unresolved.filter((item): item is string => typeof item === "string").slice(0, 8)
      : [],
    source: "ai",
  };
}

