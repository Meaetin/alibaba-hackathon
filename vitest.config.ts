import { defaultExclude, defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  // `tsconfig.json` has to keep `jsx: preserve` — Next owns the app build and
  // does its own transform. Vitest's bundler then meets JSX it will not parse,
  // so it is told the runtime here instead. Without this, importing any `.tsx`
  // from a test fails at parse time with "make sure to not set jsx to preserve".
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    environment: 'node',
    // `.tsx` as well, so a server component can be rendered to a string and
    // have its own test. The environment stays `node`: nothing needs a DOM.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Integration tests are unreachable from here, by design. They talk to a
    // real Neon branch, a real bucket and the live Places API, and the Places
    // one bills per call. Their gate is `vitest.integration.config.ts` plus a
    // named script, never an environment variable that happens to be empty.
    exclude: [...defaultExclude, 'src/**/*.integration.test.ts'],
  },
})
