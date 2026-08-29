import { describe, expect, it } from "vitest";

import { creatorHandle, normalizeDuration, selectMedia, youtubeVideoId } from "./media";

describe("normalizeDuration", () => {
  it("converts TikTok's milliseconds and leaves everyone else's seconds alone", () => {
    expect(normalizeDuration("tiktok", 43_000)).toBe(43);
    expect(normalizeDuration("youtube", 43)).toBe(43);
    // Under the threshold TikTok is already reporting seconds.
    expect(normalizeDuration("tiktok", 43)).toBe(43);
    // A slideshow reports zero, which is what identifies it.
    expect(normalizeDuration("tiktok", 0)).toBe(0);
  });
});

describe("creatorHandle", () => {
  it("prefers each platform's own handle over the display name", () => {
    expect(
      creatorHandle("instagram", { author: "Faye", owner: { username: "fayejimeno" } }),
    ).toBe("fayejimeno");
    expect(creatorHandle("tiktok", { author: "rach", unique_id: "r3c_chel" })).toBe("r3c_chel");
    expect(creatorHandle("youtube", { author: "" }, "jawed")).toBe("jawed");
  });

  it("falls back to the display name, then to Unknown", () => {
    expect(creatorHandle("youtube", { author: "Some Channel" }, null)).toBe("Some Channel");
    expect(creatorHandle("youtube", { author: "" }, null)).toBe("Unknown");
    expect(creatorHandle("tiktok", {})).toBe("Unknown");
  });
});

describe("selectMedia", () => {
  it("prefers TikTok's unwatermarked HD, then unwatermarked, then any mp4", () => {
    const all = selectMedia({
      source: "tiktok",
      duration: 43_000,
      medias: [
        { type: "video", url: "plain", extension: "mp4" },
        { type: "video", url: "clean", extension: "mp4", quality: "no_watermark" },
        { type: "video", url: "hd", extension: "mp4", quality: "hd_no_watermark" },
      ],
    });
    expect(all.videoUrls).toEqual(["hd"]);

    const noHd = selectMedia({
      source: "tiktok",
      duration: 43_000,
      medias: [
        { type: "video", url: "plain", extension: "mp4" },
        { type: "video", url: "clean", extension: "mp4", quality: "no_watermark" },
      ],
    });
    expect(noHd.videoUrls).toEqual(["clean"]);

    const last = selectMedia({
      source: "tiktok",
      duration: 43_000,
      medias: [{ type: "video", url: "plain", extension: "mp4" }],
    });
    expect(last.videoUrls).toEqual(["plain"]);
  });

  it("reads a zero-duration TikTok as a slideshow and takes its images", () => {
    const result = selectMedia({
      source: "tiktok",
      duration: 0,
      medias: [
        { type: "image", url: "one" },
        { type: "image", url: "two" },
      ],
    });

    expect(result).toEqual({ videoUrls: [], imageUrls: ["one", "two"] });
  });

  /**
   * `is_audio` is the difference between a file Whisper can read and a silent
   * one. Instagram and YouTube both list video tracks with no audio muxed in,
   * and taking the first mp4 gets you one of those about half the time.
   */
  it("takes the mp4 that actually carries audio", () => {
    const result = selectMedia({
      source: "youtube",
      duration: 60,
      medias: [
        { type: "video", url: "silent-1080p", extension: "mp4", is_audio: false },
        { type: "video", url: "muxed-360p", extension: "mp4", is_audio: true },
      ],
    });

    expect(result.videoUrls).toEqual(["muxed-360p"]);
  });

  it("falls back to any mp4 when nothing is flagged as carrying audio", () => {
    const result = selectMedia({
      source: "instagram",
      duration: 30,
      medias: [{ type: "video", url: "only", extension: "mp4" }],
    });
    expect(result.videoUrls).toEqual(["only"]);
  });

  it("falls back to images for an Instagram carousel with no video", () => {
    const result = selectMedia({
      source: "instagram",
      duration: 0,
      medias: [{ type: "image", url: "slide" }],
    });
    expect(result).toEqual({ videoUrls: [], imageUrls: ["slide"] });
  });

  it("returns nothing when the response carries no media", () => {
    expect(selectMedia({ source: "tiktok", duration: 10 })).toEqual({
      videoUrls: [],
      imageUrls: [],
    });
  });
});

describe("youtubeVideoId", () => {
  it("reads the id out of every URL form YouTube uses", () => {
    expect(youtubeVideoId("https://www.youtube.com/watch?v=jNQXAC9IVRw")).toBe("jNQXAC9IVRw");
    expect(youtubeVideoId("https://youtu.be/jNQXAC9IVRw")).toBe("jNQXAC9IVRw");
    expect(youtubeVideoId("https://www.youtube.com/shorts/G8s0syV_ocs")).toBe("G8s0syV_ocs");
    expect(youtubeVideoId("https://m.youtube.com/watch?v=abc&t=5")).toBe("abc");
  });

  it("returns null for anything that is not a YouTube video", () => {
    expect(youtubeVideoId("https://www.tiktok.com/@x/video/1")).toBeNull();
    expect(youtubeVideoId("not a url")).toBeNull();
  });
});
