/**
 * The spoken half of a video: ffmpeg to a small mono mp3, then Whisper.
 *
 * A near-straight port of Argo's `services/audio-transcription.ts`. The audio
 * settings are its settings and they are not arbitrary — 16 kHz is the rate
 * Whisper resamples to anyway, mono halves the file for content where the two
 * channels say the same thing, and 64 kbps keeps a ten-minute video around
 * 5 MB against the API's 25 MB ceiling.
 *
 * The one change is `execFile` over `exec`: see the note in `media.ts`.
 */

import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import type OpenAI from "openai";

import type { Transcript } from "./types";

const run = promisify(execFile);

const EXTRACT_TIMEOUT_MS = 180_000;

/**
 * Pulls the audio track out as `audio.mp3` in `dir` and returns its path.
 *
 * Injected into the pipeline rather than imported by it, so a test needs no
 * ffmpeg on the machine.
 */
export async function extractAudio(videoPath: string, dir: string): Promise<string> {
  const audioPath = path.join(dir, "audio.mp3");
  await run(
    "ffmpeg",
    ["-i", videoPath, "-vn", "-ar", "16000", "-ac", "1", "-b:a", "64k", "-y", audioPath],
    { timeout: EXTRACT_TIMEOUT_MS },
  );
  return audioPath;
}

/** The transcription seam. Four lines to fake, which is the point. */
export interface Transcriber {
  transcribe(audioPath: string): Promise<Transcript>;
}

/** Priced per second of audio, not per token — see the note on
 *  `LinkAnalysisStats.whisperAudioSeconds`. */
export const WHISPER_MODEL = "whisper-1";

export function createWhisperTranscriber(client: OpenAI): Transcriber {
  return {
    async transcribe(audioPath) {
      // `verbose_json` for the duration field: it is what was billed, and it is
      // the only honest source for it. The video's advertised length includes
      // any silent tail, and a stream reports none at all.
      const response = await client.audio.transcriptions.create({
        file: createReadStream(audioPath),
        model: WHISPER_MODEL,
        response_format: "verbose_json",
      });

      const text = typeof response.text === "string" ? response.text.trim() : "";
      const duration = (response as { duration?: number }).duration;
      return {
        text,
        durationSeconds: typeof duration === "number" ? duration : 0,
      };
    },
  };
}
