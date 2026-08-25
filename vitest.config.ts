import { defineConfig } from 'vitest/config'
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
  },
})
