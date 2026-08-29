/**
 * Stills out of a video, for OCR to read.
 *
 * Port of Argo's `services/frame-extractor.ts`, keeping its two numbers — one
 * frame per second, at most 180 of them — because a caption sits on screen for
 * a second or two and a slower rate starts missing them. 180 frames is three
 * minutes of a talking video, and the cap is what stops a ten-minute vlog
 * buying six hundred vision images.
 *
 * One thing added: the frames are boxed to 768px on the long side. It does not
 * change what OCR costs — `detail: "low"` bills a flat rate per image whatever
 * its size — but a portrait TikTok frame is 1080x1920, and base64-ing 180 of
 * those into a request body is minutes of pointless upload.
 */

import { execFile } from "node:child_process";
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const EXTRACT_TIMEOUT_MS = 240_000;

export const DEFAULT_FRAME_FPS = 1;
export const DEFAULT_MAX_FRAMES = 180;
/** Long side, pixels. A cap, not a target — a smaller source is left alone by
 *  `force_original_aspect_ratio=decrease`. */
export const DEFAULT_FRAME_BOX = 768;

export interface FrameOptions {
  fps?: number;
  maxFrames?: number;
  box?: number;
}

/**
 * Writes JPEGs into `<dir>/frames` and returns their paths in playback order.
 *
 * Sorted by filename, which is `frame_0001.jpg` upward — so the order is the
 * order they happened in, and a batch handed to the OCR pass is a contiguous
 * stretch of the video rather than a shuffle.
 */
export async function extractFrames(
  videoPath: string,
  dir: string,
  options: FrameOptions = {},
): Promise<string[]> {
  const fps = options.fps ?? DEFAULT_FRAME_FPS;
  const maxFrames = options.maxFrames ?? DEFAULT_MAX_FRAMES;
  const box = options.box ?? DEFAULT_FRAME_BOX;

  const framesDir = path.join(dir, "frames");
  await mkdir(framesDir, { recursive: true });

  await run(
    "ffmpeg",
    [
      "-i",
      videoPath,
      "-vf",
      `fps=${fps},scale=w=${box}:h=${box}:force_original_aspect_ratio=decrease`,
      "-frames:v",
      String(maxFrames),
      "-q:v",
      "5",
      "-y",
      path.join(framesDir, "frame_%04d.jpg"),
    ],
    { timeout: EXTRACT_TIMEOUT_MS },
  );

  const files = (await readdir(framesDir)).filter((name) => name.endsWith(".jpg")).sort();
  return files.map((name) => path.join(framesDir, name));
}
