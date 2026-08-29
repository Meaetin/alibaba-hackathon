import { describe, expect, it } from "vitest";

import type { ResponsesClient, ResponsesRequest, ResponsesResult } from "@/lib/planner/openai";

import { applyMultiCountryOverride, extractLocations } from "./extract";
import type { LinkAnalysis, Transcript, VideoMetadata } from "./types";

const metadata: VideoMetadata = {
  url: "https://www.youtube.com/watch?v=abc",
  platform: "youtube",
  title: "3 Singapore Food Centres #shorts",
  description: "Lau Pa Sat, Maxwell Food Centre and Old Airport Road Food Centre.",
  uploader: "someone",
  thumbnail: "https://i.ytimg.com/vi/abc/hq.jpg",
  durationSeconds: 43,
};

const transcript: Transcript = { text: "you have to try the chicken rice", durationSeconds: 43 };

function answer(overrides: Partial<LinkAnalysis> = {}): LinkAnalysis {
  return {
    isLocationRelated: true,
    generatedTitle: "Three Hawker Centres in Singapore",
    summary: "A guide to three hawker centres.",
    primaryCountry: "Singapore",
    primaryRegion: "Singapore",
    locations: ["Lau Pa Sat, Singapore, Singapore"],
    ...overrides,
  };
}

interface FakeOptions {
  analysis?: LinkAnalysis;
  raw?: string;
  status?: string;
  incompleteReason?: string;
  throws?: number;
}

function fakeClient(options: FakeOptions = {}): ResponsesClient & { requests: ResponsesRequest[] } {
  const requests: ResponsesRequest[] = [];
  let thrown = 0;
  return {
    requests,
    async create(request): Promise<ResponsesResult> {
      requests.push(request);
      if (thrown < (options.throws ?? 0)) {
        thrown += 1;
        throw new Error("boom");
      }
      return {
        output_text: options.raw ?? JSON.stringify(options.analysis ?? answer()),
        usage: { input_tokens: 1200, output_tokens: 180 },
        status: options.status ?? "completed",
        ...(options.incompleteReason ? { incompleteReason: options.incompleteReason } : {}),
      };
    },
  };
}

function promptOf(request: ResponsesRequest): string {
  const block = request.input[request.input.length - 1];
  return typeof block.content === "string" ? block.content : "";
}

describe("extractLocations", () => {
  it("returns the model's answer and counts what it cost", async () => {
    const client = fakeClient();
    const result = await extractLocations({ metadata, transcript, ocrLines: [] }, {
      responses: client,
    });

    expect(result.analysis).toMatchObject({ isLocationRelated: true });
    expect(result.analysis?.locations).toEqual(["Lau Pa Sat, Singapore, Singapore"]);
    expect(result.usage.calls).toBe(1);
    expect(result.usage.inputTokens).toBe(1200);
    expect(result.failure).toBeUndefined();
  });

  it("puts the title, description, transcript and on-screen text in the prompt", async () => {
    const client = fakeClient();
    await extractLocations(
      { metadata, transcript, ocrLines: ["Lau Pa Sat Hawker Centre"] },
      { responses: client },
    );

    const prompt = promptOf(client.requests[0]);
    expect(prompt).toContain("3 Singapore Food Centres");
    expect(prompt).toContain("Old Airport Road Food Centre");
    expect(prompt).toContain("you have to try the chicken rice");
    expect(prompt).toContain("Lau Pa Sat Hawker Centre");
  });

  /**
   * A real video came back with 8 places on one run and 3 on the next: the five
   * stall names were only in the description, and nothing told the model to
   * read it as carefully as the transcript. Saying so made the run stable.
   */
  it("tells the model the description may name more venues than anything else", async () => {
    const client = fakeClient();
    await extractLocations({ metadata, transcript, ocrLines: [] }, { responses: client });

    expect(promptOf(client.requests[0])).toContain("description is where a creator");
  });

  /**
   * The other half of that change. Without it "Ellenborough Market" — a market
   * that closed, named in a paragraph of history — resolved to a café.
   */
  it("tells the model to skip places named only as background", async () => {
    const client = fakeClient();
    await extractLocations({ metadata, transcript, ocrLines: [] }, { responses: client });

    expect(promptOf(client.requests[0])).toContain("named only as background");
  });

  it("says so plainly when there is no transcript and no on-screen text", async () => {
    const client = fakeClient();
    await extractLocations(
      { metadata, transcript: { text: "", durationSeconds: 0 }, ocrLines: [] },
      { responses: client },
    );

    const prompt = promptOf(client.requests[0]);
    expect(prompt).toContain("no audio transcript available");
    expect(prompt).toContain("no text detected in frames");
  });

  it("trims a title that ran past ten words", async () => {
    const client = fakeClient({
      analysis: answer({
        generatedTitle: "one two three four five six seven eight nine ten eleven twelve",
      }),
    });
    const result = await extractLocations({ metadata, transcript, ocrLines: [] }, {
      responses: client,
    });

    expect(result.analysis?.generatedTitle.split(/\s+/)).toHaveLength(10);
  });

  it("leaves a summary a little over the limit alone, and cuts a runaway one", async () => {
    const nearly = Array.from({ length: 110 }, (_, i) => `w${i}`).join(" ");
    const runaway = Array.from({ length: 300 }, (_, i) => `w${i}`).join(" ");

    const kept = await extractLocations({ metadata, transcript, ocrLines: [] }, {
      responses: fakeClient({ analysis: answer({ summary: nearly }) }),
    });
    expect(kept.analysis?.summary).toBe(nearly);

    const cut = await extractLocations({ metadata, transcript, ocrLines: [] }, {
      responses: fakeClient({ analysis: answer({ summary: runaway }) }),
    });
    expect(cut.analysis?.summary.endsWith("...")).toBe(true);
    expect(cut.analysis?.summary.split(/\s+/).length).toBeLessThan(110);
  });

  it("returns null and a sentence when the response was cut off", async () => {
    const result = await extractLocations({ metadata, transcript, ocrLines: [] }, {
      responses: fakeClient({
        raw: '{"isLocationRelated":true,"gener',
        status: "incomplete",
        incompleteReason: "max_output_tokens",
      }),
    });

    expect(result.analysis).toBeNull();
    expect(result.failure).toContain("max_output_tokens");
    // Truncated is still generated, and still billed.
    expect(result.usage.calls).toBe(1);
  });

  it("returns null when the text is not JSON, and again when it is the wrong shape", async () => {
    const notJson = await extractLocations({ metadata, transcript, ocrLines: [] }, {
      responses: fakeClient({ raw: "sorry, I can't help with that" }),
    });
    expect(notJson.analysis).toBeNull();
    expect(notJson.failure).toContain("not JSON");

    const wrongShape = await extractLocations({ metadata, transcript, ocrLines: [] }, {
      responses: fakeClient({ raw: '{"locations":"not an array"}' }),
    });
    expect(wrongShape.analysis).toBeNull();
    expect(wrongShape.failure).toContain("wrong shape");
  });

  it("retries once, then degrades rather than looping", async () => {
    const flaky = fakeClient({ throws: 1 });
    const recovered = await extractLocations({ metadata, transcript, ocrLines: [] }, {
      responses: flaky,
    });
    expect(recovered.analysis).not.toBeNull();
    expect(flaky.requests).toHaveLength(2);

    const broken = fakeClient({ throws: 99 });
    const gaveUp = await extractLocations({ metadata, transcript, ocrLines: [] }, {
      responses: broken,
    });
    expect(gaveUp.analysis).toBeNull();
    expect(broken.requests).toHaveLength(2);
  });
});

describe("applyMultiCountryOverride", () => {
  it("drops both primary fields when the places span two countries", () => {
    const override = applyMultiCountryOverride(
      answer({
        primaryCountry: "Italy",
        primaryRegion: "Tuscany",
        locations: ["Colosseum, Rome, Italy", "Sagrada Familia, Barcelona, Spain"],
      }),
    );

    expect(override).toMatchObject({ overridden: true, primaryCountry: null, primaryRegion: null });
    expect(override.countries.sort()).toEqual(["italy", "spain"]);
  });

  it("leaves a single-country list exactly as the model wrote it", () => {
    const override = applyMultiCountryOverride(
      answer({
        locations: ["Lau Pa Sat, Singapore, Singapore", "Maxwell Food Centre, Singapore, Singapore"],
      }),
    );

    expect(override).toMatchObject({
      overridden: false,
      primaryCountry: "Singapore",
      primaryRegion: "Singapore",
    });
  });

  it("reads the country off a two-part mention, which is what a city-state gets", () => {
    const override = applyMultiCountryOverride(
      answer({ locations: ["Lau Pa Sat, Singapore", "Colosseum, Rome, Italy"] }),
    );
    expect(override.overridden).toBe(true);
  });

  it("is applied to the result, not just available to be applied", async () => {
    // The wiring, not the function. A version of this that computed the
    // override and never used it passed every assertion above.
    const result = await extractLocations({ metadata, transcript, ocrLines: [] }, {
      responses: fakeClient({
        analysis: answer({
          primaryCountry: "Italy",
          primaryRegion: "Tuscany",
          locations: ["Colosseum, Rome, Italy", "Sagrada Familia, Barcelona, Spain"],
        }),
      }),
    });

    expect(result.analysis?.primaryCountry).toBeNull();
    expect(result.analysis?.primaryRegion).toBeNull();
  });
});
