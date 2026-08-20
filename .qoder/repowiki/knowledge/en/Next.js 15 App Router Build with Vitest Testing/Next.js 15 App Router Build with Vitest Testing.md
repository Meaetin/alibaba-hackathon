---
kind: build_system
name: Next.js 15 App Router Build with Vitest Testing
category: build_system
scope:
    - '**'
source_files:
    - package.json
    - next.config.js
    - tsconfig.json
    - postcss.config.js
    - vitest.config.ts
---

## Build System Overview

This repository is a Next.js 15 (App Router) frontend application that uses the framework's built-in build pipeline as its primary build system. There are no custom Makefiles, Dockerfiles, or CI/CD pipelines in this repository — the build is entirely driven by `package.json` scripts and Next.js configuration.

## Key Files and Configuration

- **`package.json`** — Defines all build/dev/test scripts and dependencies. The project version is `0.1.0` and marked `private: true`, indicating it is not published to npm.
- **`next.config.js`** — Minimal Next.js configuration enabling React Strict Mode, disabling dev indicators, optimizing package imports for `lucide-react` and `@base-ui/react`, and whitelisting remote image sources from Unsplash, UI Avatars, and Supabase Storage.
- **`tsconfig.json`** — TypeScript configured with strict mode, ES2022 target, bundler module resolution, path aliases (`@/*` → `./src/*`), incremental builds, and the Next.js compiler plugin. No output is emitted (`noEmit: true`) since Next.js handles compilation.
- **`postcss.config.js`** — Uses Tailwind CSS v4 via `@tailwindcss/postcss`.
- **`vitest.config.ts`** — Configures Vitest v4 with Node environment, path alias support via `vite-tsconfig-paths`, test discovery under `src/**/*.test.ts`, and `passWithNoTests: true`.

## Scripts and Commands

| Script | Command | Purpose |
|---|---|---|
| `dev` | `next dev --turbopack` | Development server using Next.js Turbopack for faster rebuilds |
| `build` | `next build` | Production build of the Next.js app |
| `start` | `next start` | Start the production server |
| `lint` | `next lint` | ESLint via Next.js integration |
| `type-check` | `tsc --noEmit` | Type checking without emitting files |
| `test` | `vitest run` | Run unit tests |
| `test:watch` | `vitest` | Watch mode for tests |

## Architecture and Conventions

- **Framework-centric build**: All compilation, bundling, optimization, and asset processing are delegated to Next.js. There is no custom Webpack/Vite config; only PostCSS is configured separately for Tailwind v4.
- **Path aliases**: Both TypeScript (`tsconfig.json`) and Vitest (`vite-tsconfig-paths`) resolve `@/*` imports to `./src/*`, keeping imports consistent across dev and test environments.
- **Image optimization**: Remote images are restricted to a whitelist in `next.config.js` (Unsplash, ui-avatars.com, Supabase storage), enforcing security at build time.
- **Package import optimization**: `optimizePackageImports` is enabled for `lucide-react` and `@base-ui/react` to tree-shake unused components during the Next.js build.
- **Testing strategy**: Unit tests live alongside source code under `src/**/*.test.ts` and use Vitest with a Node environment. Tests can reference source modules via `@/*` path aliases.

## Constraints and Observations

- No containerization (Dockerfile) or CI/CD pipeline files exist in this repository.
- No Makefile or shell-based build scripts are present.
- Versioning is a simple semantic version in `package.json` (`0.1.0`) with no automated release process visible.
- The build relies on `package-lock.json` for deterministic dependency resolution.
- Environment variables are expected via `.env.local` (example provided as `.env.local.example`).
- Linting is handled through Next.js's built-in ESLint integration via the `next lint` script.