/**
 * Stage 3 — one premise per day, each pinned to a real place.
 *
 * One Responses call for the whole trip, shaped exactly like Pass B: an
 * injected `ResponsesClient`, `withRetry`, a per-trip `prompt_cache_key`, and
 * **it never throws**. A trip that cannot get themes falls back to geography,
 * which is what this planner did before themes existed.
 *
 * ## The anchor constraint is the whole hallucination defence
 *
 * `anchorPlaceId` must be an id already in the pool. That single rule does
 * three things at once:
 *
 * - the model cannot invent a glassblowing quarter for a city with one glass
 *   shop, because it can only name places we retrieved;
 * - it hands us verified coordinates for free, so the nearby search that
 *   follows costs no geocode and cannot be aimed at nowhere;
 * - it is checkable in one line, deterministically, after parsing.
 *
 * An id that is not in the pool drops **that day** to the geographic fallback
 * and is recorded. It is never retried: a model that named a place we do not
 * have will name it again, and a second call is a second bill.
 *
 * ## What a theme is not allowed to do
 *
 * It is an aspiration, not a rule. Dietary needs and budget are enforced by
 * `hardFilterReason` after every model has spoken, and no instruction below
 * asks this pass to respect either — convenient as that would be. A constraint
 * a model is asked to honour is a constraint that is sometimes honoured.
 */

import { z } from "zod";

import {
  MODELS,
  jsonSchemaFormat,
  withRetry,
  type ReasoningEffort,
  type ResponsesClient,
  type ResponsesRequest,
  type ResponsesUsage,
} from "./openai";
import { renderPersonaBrief, type PersonaBrief } from "./persona-brief";
import type { CitySurvey } from "./survey";
import type { Weekday } from "./hours";
import type { PreferenceProfile } from "./types";

// ── what a theme is ──────────────────────────────────────────────────────────

/** How wide to search around the anchor. Turned into metres by `radiusFor`. */
export type RadiusHint = "tight" | "walkable" | "wide";

export interface DayTheme {
  dayIndex: number;
  /** Shown to the traveller. */
  title: string;
  /** One sentence. Fed to Pass B and Pass C so a day reads as one idea. */
  premise: string;
  /** MUST be an id from the pool. Verified, never trusted. */
  anchorPlaceId: string;
  /** Google Places types for the nearby search around the anchor. */
  includedTypes: string[];
  radiusHint: RadiusHint;
}

/**
 * Metres per hint, before the persona scales them.
 *
 * `walkable` is 1,200 m because that is `WALK_MAX_METERS` — the distance this
 * planner already calls "you walk this". Keeping the two aligned means a theme
 * described as walkable produces a day the packer also thinks is walkable.
 */
export const RADIUS_METERS: Record<RadiusHint, number> = {
  tight: 600,
  walkable: 1_200,
  wide: 4_000,
};

/**
 * The radius for one theme, scaled by how far this traveller will go.
 *
 * `comfortTolerance` owns distance — the same axis that owns `walkMaxMeters` in
 * `knobs.ts` — so the scale is derived from that knob rather than from a second
 * table that could drift away from it.
 */
export function radiusFor(hint: RadiusHint, walkMaxMeters: number): number {
  const scale = walkMaxMeters / RADIUS_METERS.walkable;
  return Math.round(RADIUS_METERS[hint] * scale);
}

// ── the model's answer ───────────────────────────────────────────────────────

const ThemeSchema = z.object({
  themes: z.array(
    z.object({
      day: z.number().int().positive(),
      title: z.string().min(1),
      premise: z.string().min(1),
      anchor_place_id: z.string().min(1),
      included_types: z.array(z.string().min(1)),
      radius_hint: z.enum(["tight", "walkable", "wide"]),
    }),
  ),
});

type ThemeAnswer = z.infer<typeof ThemeSchema>;

const SYSTEM_PROMPT = `You are the theme pass of a trip planner. You are given a survey of the places
already retrieved for one city, and you name what each day of the trip is ABOUT.

You are not choosing stops. A later pass does that, from places found around the
anchor you name here.

Rules:
- anchor_place_id MUST be one of the place_id values in the survey. An id that is
  not in the survey is discarded and that day loses its theme. Never invent one.
- One theme per day, in day order, exactly as many as you are asked for.
- Two themes must not share an anchor, and should not sit in the same area
  unless the survey shows that area is much larger than the others.
- premise is ONE sentence, written to the planner: what this day is for and what
  kind of place belongs in it.
- title is two to five words, for the traveller to read.
- included_types are Google Places types, for a search around the anchor. Three
  to six of them. Prefer types the survey shows this city actually has.
- radius_hint: "tight" for a dense quarter you walk in an hour, "walkable" for a
  neighbourhood, "wide" when the day is built around somewhere out of town.

Ground every theme in the survey. If the city has three museums, do not propose a
museum day.`;

// ── the call ─────────────────────────────────────────────────────────────────

export interface ThemeRequestDay {
  dayIndex: number;
  /** 0 = Sunday … 6 = Saturday. The model is told, so it can avoid a Monday
   *  museum day; nothing here enforces it — `validate.ts` does. */
  weekday: Weekday;
}

export interface ThemeInput {
  survey: CitySurvey;
  profile: PreferenceProfile;
  /** The persona as words. Absent means no persona. */
  brief?: PersonaBrief;
  days: readonly ThemeRequestDay[];
}

export interface ThemeDeps {
  client: ResponsesClient;
  model?: string;
  /** Defaults to `"low"`. Set at the call site: the API default is `medium`. */
  effort?: ReasoningEffort;
  promptCacheKey: string;
  retries?: number;
}

/** Why a day has no theme. Recorded, never retried. */
export interface ThemeRejection {
  dayIndex: number;
  anchorPlaceId?: string;
  reason: string;
}

export interface ThemeResult {
  /** Themes that survived validation, in day order. May be shorter than `days`. */
  themes: DayTheme[];
  /** Days that will fall back to geography, and why. */
  rejected: ThemeRejection[];
  /** True when the call itself failed — every day falls back. */
  unavailable: boolean;
  usage?: ResponsesUsage;
}

/**
 * Names each day of the trip, or returns nothing and lets geography do it.
 *
 * `poolIds` is the set every anchor is checked against. It is passed rather
 * than derived so the caller decides what "in the pool" means — today the whole
 * retrieval result, which is wider than the funnel's shortlist on purpose: an
 * anchor is a *location*, and a place the funnel cut for being off-interest is
 * still a perfectly good landmark to search around.
 */
export async function planThemes(
  input: ThemeInput,
  poolIds: ReadonlySet<string>,
  deps: ThemeDeps,
): Promise<ThemeResult> {
  if (input.days.length === 0) return { themes: [], rejected: [], unavailable: false };

  const outcome = await withRetry(async () => {
    const response = await deps.client.create(buildThemeRequest(input, deps));
    return { answer: parseThemes(response.output_text), usage: response.usage };
  }, deps.retries ?? 1);

  if ("error" in outcome) {
    console.error("[theme] the theme pass is unusable — every day falls back", outcome.error);
    return {
      themes: [],
      rejected: input.days.map((day) => ({
        dayIndex: day.dayIndex,
        reason: "the theme pass did not answer",
      })),
      unavailable: true,
    };
  }

  const { themes, rejected } = validateThemes(outcome.value.answer, input, poolIds);
  for (const rejection of rejected) {
    console.warn(
      `[theme] day ${rejection.dayIndex + 1} falls back to geography — ${rejection.reason}`,
    );
  }
  return { themes, rejected, unavailable: false, usage: outcome.value.usage };
}

export function buildThemeRequest(input: ThemeInput, deps: ThemeDeps): ResponsesRequest {
  const persona = renderPersonaBrief(input.brief, "theme");
  return {
    model: deps.model ?? MODELS.assign,
    input: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(buildPayload(input)) },
      ...(persona ? [{ role: "developer" as const, content: persona }] : []),
    ],
    reasoning: { effort: deps.effort ?? "low" },
    text: { format: jsonSchemaFormat("themes", ThemeSchema) },
    prompt_cache_key: deps.promptCacheKey,
  };
}

/**
 * What the model sees. Note what is absent: scores, price levels per place,
 * opening hours, photos. Every omitted field is hallucination surface removed,
 * and none of them helps decide what a day is about.
 */
function buildPayload(input: ThemeInput): Record<string, unknown> {
  return {
    city: input.survey.city,
    total_days: input.days.length,
    days: input.days.map((day) => ({ day: day.dayIndex + 1, weekday: day.weekday })),
    traveller: {
      interests: [...input.profile.interests],
      // Dietary rides along as context for the premise wording only. It is
      // enforced by `hardFilterReason` after this pass, never by this pass.
      dietary: [...input.profile.dietary],
    },
    survey: {
      total_places: input.survey.totalPlaces,
      common_types: input.survey.typeHistogram,
      areas: input.survey.areas.map((area) => ({
        area: area.index,
        places: area.placeCount,
        places_to_eat: area.mealCapableCount,
        common_types: area.topTypes,
        landmarks: area.landmarks.map((landmark) => ({
          place_id: landmark.placeId,
          name: landmark.name,
          types: landmark.types,
        })),
      })),
    },
  };
}

function parseThemes(text: string): ThemeAnswer {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("the theme pass returned text that is not JSON");
  }
  const parsed = ThemeSchema.safeParse(json);
  if (!parsed.success) throw new Error("the theme pass response did not match the schema");
  return parsed.data;
}

/**
 * Every rule the model was told, enforced in code.
 *
 * Exported for its own test: the interesting cases here — an anchor naming a
 * place we never retrieved, two days sharing one anchor — are not observable
 * from a finished itinerary, which is exactly where a silent hallucination
 * would hide.
 */
export function validateThemes(
  answer: ThemeAnswer,
  input: ThemeInput,
  poolIds: ReadonlySet<string>,
): { themes: DayTheme[]; rejected: ThemeRejection[] } {
  const byDay = new Map(answer.themes.map((theme) => [theme.day, theme]));
  const themes: DayTheme[] = [];
  const rejected: ThemeRejection[] = [];
  const claimedAnchors = new Set<string>();

  for (const day of input.days) {
    const proposed = byDay.get(day.dayIndex + 1);
    if (!proposed) {
      rejected.push({ dayIndex: day.dayIndex, reason: "no theme was proposed for this day" });
      continue;
    }
    if (!poolIds.has(proposed.anchor_place_id)) {
      // The hallucination case, and the reason the constraint exists.
      rejected.push({
        dayIndex: day.dayIndex,
        anchorPlaceId: proposed.anchor_place_id,
        reason: "the anchor names a place that is not in the pool",
      });
      continue;
    }
    if (claimedAnchors.has(proposed.anchor_place_id)) {
      // Two days built on one place is one day twice.
      rejected.push({
        dayIndex: day.dayIndex,
        anchorPlaceId: proposed.anchor_place_id,
        reason: "another day is already anchored here",
      });
      continue;
    }
    claimedAnchors.add(proposed.anchor_place_id);
    themes.push({
      dayIndex: day.dayIndex,
      title: proposed.title.trim(),
      premise: proposed.premise.trim(),
      anchorPlaceId: proposed.anchor_place_id,
      includedTypes: dedupe(proposed.included_types),
      radiusHint: proposed.radius_hint,
    });
  }

  return { themes, rejected };
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
