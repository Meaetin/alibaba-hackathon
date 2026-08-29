import { describe, expect, it } from "vitest";

import { detectLink } from "./detect";

describe("detectLink", () => {
  it("names the platform for each supported host", () => {
    const cases: [string, string][] = [
      ["https://www.youtube.com/watch?v=abc123", "youtube"],
      ["https://youtu.be/abc123", "youtube"],
      ["https://m.youtube.com/watch?v=abc123", "youtube"],
      ["https://www.tiktok.com/@someone/video/7123456789", "tiktok"],
      ["https://vm.tiktok.com/ZSabc/", "tiktok"],
      ["https://www.instagram.com/reel/Cabc123/", "instagram"],
    ];

    for (const [url, platform] of cases) {
      const target = detectLink(url);
      expect(target, url).toMatchObject({ ok: true, platform });
    }
  });

  it("keeps the query string, because the YouTube video id lives in it", () => {
    const target = detectLink("https://www.youtube.com/watch?v=jNQXAC9IVRw&t=5");
    expect(target.ok && target.url).toContain("v=jNQXAC9IVRw");
  });

  /**
   * The guard that matters. `urlLower.includes("youtube.com")` — which is what
   * Argo's detector does — says yes to every one of these, and each one sends a
   * subprocess somewhere a stranger chose.
   */
  it("refuses a host that merely contains a platform name", () => {
    const impostors = [
      "https://youtube.com.evil.test/watch?v=1",
      "https://evil.test/?next=https://youtube.com/watch?v=1",
      "https://tiktok.com.attacker.example/video/1",
      "https://notinstagram.com/reel/1",
    ];

    for (const url of impostors) {
      expect(detectLink(url), url).toMatchObject({ ok: false });
    }
  });

  it("refuses anything that is not https", () => {
    expect(detectLink("http://www.youtube.com/watch?v=1")).toMatchObject({ ok: false });
    expect(detectLink("file:///etc/passwd")).toMatchObject({ ok: false });
    expect(detectLink("https://169.254.169.254/latest/meta-data/")).toMatchObject({ ok: false });
  });

  it("refuses an unsupported platform, a non-URL and an empty string", () => {
    expect(detectLink("https://vimeo.com/12345")).toMatchObject({ ok: false });
    expect(detectLink("not a url")).toMatchObject({ ok: false });
    expect(detectLink("   ")).toMatchObject({ ok: false });
  });

  it("explains itself, because the route renders the reason to the caller", () => {
    const target = detectLink("https://vimeo.com/12345");
    expect(target.ok).toBe(false);
    if (!target.ok) expect(target.reason).toMatch(/YouTube, TikTok and Instagram/);
  });
});
