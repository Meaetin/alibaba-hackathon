import { describe, expect, it } from "vitest";

import type { LinkStage } from "./pipeline";
import { LINK_STAGE_COUNT, linkStageOutlook, toLinkJobProgress } from "./progress";

const NOW = new Date("2026-08-29T09:00:00Z");
const STAGES: LinkStage[] = ["metadata", "download", "watching", "extracting", "resolving", "done"];

describe("linkStageOutlook", () => {
  /**
   * The bar is a hand-maintained weights table, which is exactly the kind of
   * thing that ends up with stage four behind stage three after an edit.
   */
  it("never moves backwards, and ends at 100", () => {
    const percents = STAGES.map((stage) => linkStageOutlook(stage).percent);

    expect(percents[0]).toBe(0);
    expect(percents.at(-1)).toBe(100);
    for (let i = 1; i < percents.length; i++) {
      expect(percents[i], STAGES[i]).toBeGreaterThan(percents[i - 1]);
    }
  });

  it("hands each stage the span it owns, so the crawl has somewhere to walk", () => {
    for (const stage of STAGES.slice(0, -1)) {
      const outlook = linkStageOutlook(stage);
      expect(outlook.nextPercent, stage).toBeGreaterThan(outlook.percent);
      expect(outlook.stageMs, stage).toBeGreaterThan(0);
    }
  });

  it("counts down to nothing", () => {
    const etas = STAGES.map((stage) => linkStageOutlook(stage).etaSeconds);
    for (let i = 1; i < etas.length; i++) expect(etas[i]).toBeLessThan(etas[i - 1]);
    expect(etas.at(-1)).toBe(0);
  });
});

describe("toLinkJobProgress", () => {
  it("reports a real percentage and leaves `step` unset", () => {
    const progress = toLinkJobProgress("watching", NOW);

    // `useProgressAnimation` trusts `percent` when it is there and otherwise
    // looks `step` up in a table written for a different pipeline.
    expect(typeof progress.percent).toBe("number");
    expect(progress.step).toBeUndefined();
    expect(progress.total).toBe(LINK_STAGE_COUNT);
  });

  it("carries a label a person can read, per stage", () => {
    expect(toLinkJobProgress("metadata", NOW).label).toBe("Reading the post");
    expect(toLinkJobProgress("watching", NOW).label).toBe("Watching and listening");
    expect(toLinkJobProgress("done", NOW).label).toBe("Done");
  });

  it("stamps the injected clock, which the crawl counts from", () => {
    expect(toLinkJobProgress("download", NOW).fired_at).toBe(NOW.toISOString());
  });

  it("carries the thumbnail when there is one, and omits the key when there is not", () => {
    expect(toLinkJobProgress("download", NOW, "https://cdn/thumb.jpg").thumbnail).toBe(
      "https://cdn/thumb.jpg",
    );
    expect("thumbnail" in toLinkJobProgress("download", NOW)).toBe(false);
  });
});
