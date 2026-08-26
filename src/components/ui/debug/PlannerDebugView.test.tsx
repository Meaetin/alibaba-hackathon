/**
 * The debug view has more logic in it than a debug view should, so it gets a
 * test. Three things here are decisions rather than markup:
 *
 * - Pass B's sentences arrive as one flat list for the whole trip and have to
 *   be re-attached to the right stop on the right **day**. The same place can
 *   appear twice in a trip, so a key of `place_id` alone would put day two's
 *   sentence under day one's stop and look completely plausible.
 * - A record from before the column existed (`debug: null`) must render the
 *   page it can rather than throwing, because the itinerary is still real.
 * - The funnel is drawn as bars measured against the widest value, with the
 *   size of each cut spelled out.
 *
 * Rendered with `renderToStaticMarkup` rather than Testing Library: this is a
 * server component with no state, no effects and no events, so a DOM would only
 * be scenery. The suite's environment stays `node`.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { PlanDiagnostics } from "@/lib/db/diagnostics";
import { PLANNER_DEBUG_VERSION, type PlannerDebug } from "@/lib/planner/debug";
import type { PreferenceProfile } from "@/lib/planner/types";

import { PlannerDebugView } from "./PlannerDebugView";

const PROFILE: PreferenceProfile = {
  interests: ["temples", "cafes"],
  dietary: ["vegetarian"],
  pace: "balanced",
  budget: 2,
};

function stop(overrides: Partial<PlanDiagnostics["days"][number]["stops"][number]> = {}) {
  return {
    position: 1,
    role: "activity",
    startMin: 540,
    endMin: 630,
    placeId: "place-a",
    name: "Tenryu-ji",
    types: ["place_of_worship"],
    score: 0.8125,
    matchReasons: ["matches: temples"],
    content: null,
    travelToNext: null,
    stayDuration: null,
    ...overrides,
  };
}

function debugRecord(overrides: Partial<PlannerDebug> = {}): PlannerDebug {
  return {
    version: PLANNER_DEBUG_VERSION,
    recordedAt: "2026-08-25T09:00:00.000Z",
    assignment: { fallbackDays: [], rationale: [], dropped: [] },
    narration: { fallbacks: [], truncated: 0, rejectedDishes: 0 },
    enrichment: { misses: [] },
    ...overrides,
  };
}

function diagnostics(overrides: Partial<PlanDiagnostics> = {}): PlanDiagnostics {
  return {
    itinerary: {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Kyoto trip",
      city: "Kyoto",
      country: "Japan",
      startDate: "2026-09-14",
      totalDays: 2,
      profile: PROFILE,
      createdAt: new Date("2026-08-25T09:00:00.000Z"),
    },
    days: [
      { dayIndex: 0, date: "2026-09-14", areaName: "Arashiyama", stops: [stop()] },
      { dayIndex: 1, date: "2026-09-15", areaName: "Gion", stops: [] },
    ],
    debug: debugRecord(),
    funnelStats: {
      retrieved: 86,
      afterFilters: 82,
      afterClusterCap: 60,
      afterGlobalCap: 42,
    },
    job: { id: "job-1", status: "completed", error: null, stats: null },
    enrichmentFailures: {},
    ...overrides,
  };
}

const render = (input: PlanDiagnostics) =>
  renderToStaticMarkup(<PlannerDebugView diagnostics={input} />);

// ── the sentence has to land on the right stop ───────────────────────────────

describe("PlannerDebugView — model spend", () => {
  const stage = (over: Record<string, unknown>) => ({
    stage: "assign",
    model: "gpt-5.6-terra",
    calls: 1,
    inputTokens: 1_000_000,
    cachedInputTokens: 0,
    outputTokens: 0,
    ...over,
  });

  it("says 'not recorded' for a plan from before usage was tracked", () => {
    // Not the same claim as "this plan made no model calls" — see the
    // `debug: null` rule this file already keeps.
    const html = render(diagnostics({ job: { id: "j", status: "completed", error: null, stats: {} } }));
    expect(html).toContain("before token usage was tracked");
  });

  it("renders a row per stage with its tokens and its cost", () => {
    const html = render(
      diagnostics({
        job: {
          id: "j",
          status: "completed",
          error: null,
          stats: { cost: [stage({}), stage({ stage: "theme" })] },
        },
      }),
    );
    expect(html).toContain("assign");
    expect(html).toContain("theme");
    expect(html).toContain("gpt-5.6-terra");
    // 1M input on terra is $2 a stage, $4 the pair.
    expect(html).toContain("$2.0000");
    expect(html).toContain("$4.0000");
  });

  it("flags a model it has no rate for instead of pricing it at zero", () => {
    const html = render(
      diagnostics({
        job: {
          id: "j",
          status: "completed",
          error: null,
          stats: { cost: [stage({ model: "gpt-5-nano" })] },
        },
      }),
    );
    expect(html).toContain("no price on file");
    expect(html).toContain("lower than");
  });
});

describe("PlannerDebugView — route order", () => {
  // The rule the rest of this file already keeps: a field that is absent and a
  // field that is present and empty are different answers, and the one page
  // whose job is the truth must not conflate them.
  it("says 'not recorded' for an itinerary planned before sequencing existed", () => {
    const html = render(diagnostics({ debug: debugRecord({ sequencing: undefined }) }));
    expect(html).toContain("planned before the reorder existed");
  });

  it("distinguishes a day it improved from a day that was already shortest", () => {
    const html = render(
      diagnostics({
        debug: debugRecord({
          sequencing: [
            { dayIndex: 0, beforeMinutes: 92, afterMinutes: 69, savedMinutes: 23, reordered: true, meters: 6012 },
            { dayIndex: 1, beforeMinutes: 40, afterMinutes: 40, savedMinutes: 0, reordered: false, meters: 3100 },
          ],
        }),
      }),
    );
    expect(html).toContain("saved 23m");
    expect(html).toContain("already shortest");
    expect(html).toContain("6.0 km");
  });
});

describe("Pass B's rationale", () => {
  it("puts each sentence under the stop it was written for", () => {
    const html = render(
      diagnostics({
        debug: debugRecord({
          assignment: {
            fallbackDays: [],
            dropped: [],
            rationale: [
              { dayIndex: 0, placeId: "place-a", kind: "assignment", why: "the moss garden" },
            ],
          },
        }),
      }),
    );
    expect(html).toContain("the moss garden");
    expect(html).toContain("Pass B:");
  });

  it("keys by day as well as place, so a repeat visit does not steal the wrong line", () => {
    // The failure this pins is silent: key on `place_id` alone and day two's
    // stop renders day one's sentence, which reads perfectly well and is wrong.
    const html = render(
      diagnostics({
        days: [
          { dayIndex: 0, date: "2026-09-14", areaName: "Arashiyama", stops: [stop()] },
          {
            dayIndex: 1,
            date: "2026-09-15",
            areaName: "Gion",
            stops: [stop({ name: "Tenryu-ji again" })],
          },
        ],
        debug: debugRecord({
          assignment: {
            fallbackDays: [],
            dropped: [],
            rationale: [
              { dayIndex: 0, placeId: "place-a", kind: "assignment", why: "FIRST DAY REASON" },
              { dayIndex: 1, placeId: "place-a", kind: "assignment", why: "SECOND DAY REASON" },
            ],
          },
        }),
      }),
    );

    const firstDay = html.indexOf("Tenryu-ji<");
    const secondDay = html.indexOf("Tenryu-ji again");
    expect(firstDay).toBeGreaterThan(-1);
    expect(secondDay).toBeGreaterThan(firstDay);
    // Each reason sits between its own stop's name and the next stop's.
    expect(html.indexOf("FIRST DAY REASON")).toBeGreaterThan(firstDay);
    expect(html.indexOf("FIRST DAY REASON")).toBeLessThan(secondDay);
    expect(html.indexOf("SECOND DAY REASON")).toBeGreaterThan(secondDay);
  });

  it("renders a stop with no sentence rather than skipping it", () => {
    const html = render(diagnostics());
    expect(html).toContain("Tenryu-ji");
    expect(html).not.toContain("Pass B:");
  });
});

// ── the record that predates the column ──────────────────────────────────────

describe("an itinerary planned before planner_debug existed", () => {
  const html = render(diagnostics({ debug: null }));

  it("says so instead of rendering an empty page", () => {
    expect(html).toContain("No diagnostic record on this itinerary");
  });

  it("still shows everything that was stored", () => {
    expect(html).toContain("Kyoto trip");
    expect(html).toContain("Arashiyama");
    // The funnel lives on its own column and predates the debug record.
    expect(html).toContain("after cluster cap");
  });

  it("does not claim Pass B named only ids it was given", () => {
    // "Nothing was dropped" and "we never recorded what was dropped" are
    // different answers, and reporting the second as the first would be a lie
    // told by a page whose whole job is telling you the truth.
    expect(html).toContain("Not recorded for this itinerary.");
    expect(html).not.toContain("Pass B named only ids it was given");
  });
});

// ── the rest of the sections ─────────────────────────────────────────────────

describe("the day header", () => {
  it("flags a day the ranked shortlist had to fill", () => {
    const html = render(
      diagnostics({
        debug: debugRecord({
          assignment: { fallbackDays: [1], rationale: [], dropped: [] },
        }),
      }),
    );
    expect(html).toContain("ranked fallback filled this day");
  });

  it("says nothing when Pass B filled every day itself", () => {
    expect(render(diagnostics())).not.toContain("ranked fallback filled this day");
  });
});

describe("refused ids", () => {
  it("lists the day, the id and the reason", () => {
    const html = render(
      diagnostics({
        debug: debugRecord({
          assignment: {
            fallbackDays: [],
            rationale: [],
            dropped: [
              { dayIndex: 0, placeId: "ChIJ_invented", reason: "not in the candidate set" },
            ],
          },
        }),
      }),
    );
    expect(html).toContain("ChIJ_invented");
    expect(html).toContain("not in the candidate set");
  });

  it("says the list is empty rather than showing an empty table", () => {
    expect(render(diagnostics())).toContain("Pass B named only ids it was given");
  });
});

describe("narration", () => {
  it("annotates the stop whose card fell back", () => {
    const html = render(
      diagnostics({
        debug: debugRecord({
          narration: {
            fallbacks: [{ placeId: "place-a", message: "narration was cut off" }],
            truncated: 1,
            rejectedDishes: 2,
          },
        }),
      }),
    );
    expect(html).toContain("narration fell back");
    expect(html).toContain("narration was cut off");
    expect(html).toContain("1 cut off at max_output_tokens");
    // A rejected dish is the grounding rule working, so it is not styled as a
    // failure — but it is still counted where someone can see it.
    expect(html).toContain("2 ungrounded dishes rejected");
  });
});

describe("enrichment misses", () => {
  it("separates a place that was simply never asked from one that was refused", () => {
    const html = render(
      diagnostics({
        debug: debugRecord({ enrichment: { misses: ["place-a", "place-b"] } }),
        enrichmentFailures: {
          "place-b": {
            placeId: "place-b",
            reason: "api_error",
            message: "rate_limit_exceeded: too many requests",
            providerBatchId: "batch_9",
            batchStatus: "completed",
          },
        },
      }),
    );
    expect(html).toContain("no recorded failure");
    expect(html).toContain("rate_limit_exceeded");
    expect(html).toContain("batch_9");
  });
});

describe("the funnel", () => {
  it("says nothing about themes on a geographic plan", () => {
    // The default path has no themes, and a section headed "what each day was
    // about" over an empty table would read as a theme pass that produced
    // nothing rather than one that never ran.
    const html = render(diagnostics());
    expect(html).not.toContain("What each day was about");
  });

  it("names each day's premise, its anchor and every fallback", () => {
    const html = render(
      diagnostics({
        debug: debugRecord({
          themes: {
            titles: [{ dayIndex: 0, title: "Around Fushimi Inari", anchorPlaceId: "place-a" }],
            fallbacks: [
              {
                dayIndex: 1,
                anchorPlaceId: "a-glassblowing-quarter",
                reason: "the anchor names a place that is not in the pool",
              },
            ],
            repairs: [
              {
                dayIndex: 0,
                rung: "widened",
                before: 1,
                after: 2,
                reason: "searched wider and found 1 more place to eat",
              },
            ],
          },
        }),
      }),
    );

    expect(html).toContain("Around Fushimi Inari");
    expect(html).toContain("place-a");
    // A day that lost its premise says why, on the row, rather than in a log
    // line nobody kept.
    expect(html).toContain("a-glassblowing-quarter");
    expect(html).toContain("not in the pool");
    // And a repair that shrank nothing silently is the bug this records.
    expect(html).toContain("searched wider");
  });

  it("says the ladder never ran rather than showing nothing", () => {
    const html = render(
      diagnostics({
        debug: debugRecord({
          themes: {
            titles: [{ dayIndex: 0, title: "Around Fushimi Inari", anchorPlaceId: "place-a" }],
            fallbacks: [],
            repairs: [],
          },
        }),
      }),
    );
    expect(html).toContain("No day needed the feasibility ladder");
  });

  it("spells out the size of every cut", () => {
    const html = render(diagnostics());
    expect(html).toContain("−4"); // 86 → 82
    expect(html).toContain("−22"); // 82 → 60
    expect(html).toContain("−18"); // 60 → 42
  });

  it("measures each bar against the widest, not against a hundred", () => {
    const html = render(diagnostics());
    // 42 of 86 is 48.8%. A bar measured against 100 would be 42% — close enough
    // to look right on a screenshot and wrong on every trip with a small pool.
    expect(html).toContain("width:48.8");
  });
});

describe("a stop the join could not resolve", () => {
  it("renders it and names the gap, rather than dropping it", () => {
    const html = render(
      diagnostics({
        days: [
          {
            dayIndex: 0,
            date: "2026-09-14",
            areaName: "Arashiyama",
            stops: [stop({ placeId: null, name: "(no locations row)" })],
          },
        ],
      }),
    );
    expect(html).toContain("the stop is real, the join is missing");
  });
});

describe("a failed job", () => {
  it("leads with the error rather than burying it in the footer", () => {
    const html = render(
      diagnostics({
        job: { id: "job-1", status: "failed", error: "We couldn't build that itinerary.", stats: null },
      }),
    );
    expect(html).toContain("The job that produced this failed");
    expect(html).toContain("We couldn&#x27;t build that itinerary.");
  });
});

describe("stage counters", () => {
  it("renders whatever keys the stats happen to have", () => {
    // Generic on purpose: `PlanStats` grows a counter whenever a stage learns
    // to count something, and the newest one is always the one you are looking
    // for. A view that named each field would silently omit it.
    const html = render(
      diagnostics({
        job: {
          id: "job-1",
          status: "completed",
          error: null,
          stats: { scheduling: { scheduled: 15, dropped: 2 }, somethingNew: 7 },
        },
      }),
    );
    expect(html).toContain("scheduling");
    expect(html).toContain("scheduled");
    expect(html).toContain("somethingNew");
    expect(html).toContain("7");
  });

  it("explains an absent stats blob instead of showing nothing", () => {
    expect(render(diagnostics())).toContain("failed before the pipeline returned");
  });
});
