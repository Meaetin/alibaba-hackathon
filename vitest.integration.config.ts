/**
 * The integration half of the suite: every `*.integration.test.ts`, which the
 * default config excludes. Nothing here runs on `npm test`.
 *
 *   npm run test:db      real Neon branch, needs DATABASE_URL
 *   npm run test:blobs   real bucket, needs PHOTO_BLOB_*
 *   npm run test:places  live Google, needs GOOGLE_PLACES_API_KEY, bills per call
 *
 * Each script loads `.env.local` through Node's `--env-file-if-exists` — Vitest
 * does not read dotenv files itself, so without that flag every suite here
 * still skips on its own `describe.skipIf`.
 *
 * Kept as a sibling file rather than an `exclude` override because a filename
 * on the CLI only filters `include`; it cannot add back what `include` omits.
 */
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    environment: 'node',
    include: [
      'src/**/*.integration.test.ts',
      // Named on its own because it is not `*.integration.test.ts`: it mixes
      // pure row-shaper tests with one `DATABASE_URL`-gated `saveItinerary`
      // block, on purpose. The shapers run twice as a result, which is cheap.
      // Splitting that block into its own file would retire this entry.
      'src/lib/db/itineraries.test.ts',
    ],
  },
})
