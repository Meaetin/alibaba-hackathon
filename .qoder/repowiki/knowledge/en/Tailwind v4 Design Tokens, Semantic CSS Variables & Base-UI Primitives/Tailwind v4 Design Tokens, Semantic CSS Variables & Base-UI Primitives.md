---
kind: frontend_style
name: Tailwind v4 Design Tokens, Semantic CSS Variables & Base-UI Primitives
category: frontend_style
scope:
    - '**'
source_files:
    - src/app/globals.css
    - src/styles/tokens/motion.css
    - src/components/ThemeProvider.tsx
    - src/components/ui/primitives/Button.tsx
    - postcss.config.js
    - package.json
    - next.config.js
---

## System Overview

The frontend uses **Tailwind CSS v4** (via `@tailwindcss/postcss`) as the styling engine, layered over a **semantic design-token system** defined in CSS custom properties and exposed through Tailwind's `@theme inline` directive. Components are built on top of **Base UI primitives** (`@base-ui/react`) with visual variants composed via **Class Variance Authority (CVA)** and class merging via `clsx` + `tailwind-merge`. Theme switching is handled by **next-themes**, which toggles a `.dark` class on the root element.

## Key Files and Packages

- `src/app/globals.css` — single source of truth for all design tokens, typography scales, color aliases, dark-mode overrides, base styles, scrollbars, animations, and utility classes; imports Tailwind v4 and motion tokens.
- `src/styles/tokens/motion.css` — centralized motion token scale (durations, easings, distances, stagger) plus shared modal/sheet keyframes and `prefers-reduced-motion` overrides.
- `src/components/ThemeProvider.tsx` — wraps the app with `next-themes`, currently forced to light mode (`forcedTheme: 'light'`).
- `src/components/ui/primitives/*.tsx` — unstyled-at-core primitives (Button, Input, Sheet, Tooltip, etc.) that compose Base UI with CVA variant maps and semantic token classes.
- `package.json` — declares `tailwindcss ^4`, `@tailwindcss/postcss ^4`, `tw-animate-css`, `class-variance-authority`, `clsx`, `tailwind-merge`, `@base-ui/react`, `motion`, `next-themes`, `lucide-react`.
- `postcss.config.js` — registers only `@tailwindcss/postcss`.
- `next.config.js` — enables `optimizePackageImports` for `lucide-react` and `@base-ui/react`.

## Architecture and Conventions

### Token layers
1. **Raw palette variables** — `--color-brand-*` (50–950) are the only hand-written palette; everything else references Tailwind v4 built-in scales (`mist`, `zinc`, `blue`, `red`, `emerald`, `amber`, `brand`, etc.).
2. **Semantic CSS variables** — grouped into categories under `:root` and `.dark`: `surface-*`, `content-*`, `glyph-*`, `edge-*`, `action-*`, `category-*`, `cal-*` (calendar), `chart-*`, `sidebar-*`. These are property-agnostic names used everywhere in components.
3. **`@theme inline` exposure** — semantic variables are re-exposed as `--color-*` tokens so they can be consumed via Tailwind utilities (e.g., `bg-action-brand`, `text-content-secondary`).
4. **Typography tokens** — `--font-primary` (`Switzer`), `--font-secondary` (`Lora`), plus `--text-h1..h4`, `--text-body-1..4` and corresponding leading/tracking values, applied via `.type-*` classes in `@layer base` / `@layer utilities`.

### Dark mode
A single `.dark` block redefines every semantic variable for the dark palette. The `@custom-variant dark (&:where(.dark, .dark *));` declaration lets Tailwind generate `dark:` variants that scope to the nearest `.dark` ancestor. Theme state is managed by `next-themes` with `attribute="class"`; currently forced to light.

### Motion system
All durations, easings, distances, and stagger offsets live in `src/styles/tokens/motion.css`. Components reference them via CSS variables like `--motion-button-duration`, `--motion-ease-standard`, `--motion-overlay-ease`, `--motion-distance-sm/md/lg`. A `prefers-reduced-motion: reduce` block collapses every duration to `1ms` and disables decorative animations. Custom keyframes (`fade-up-in/out`, `float-slow/medium/fast`, `highlight-pulse`, `progress-fill`, `progress-drain`, `modal-stagger-in`, field validation shake) are declared once and exposed as `animate-*` utilities.

### Component styling pattern
Primitives use CVA to declare variant maps (`variant`, `size`, `icon`) and compound/default variants. Visual decoration (e.g., Button's three-layer fill/bevel/ring) is expressed as plain Tailwind utility strings referencing semantic tokens — no CSS modules or styled-components. Class composition goes through `cn(...)` (from `@/lib/utils`, a `clsx` + `tailwind-merge` wrapper). Icons come from `lucide-react`.

### Responsive strategy
- Uses Tailwind v4 responsive prefixes (`sm:`, `md:`, `lg:`, `xl:`, `2xl:`).
- A custom `short:` breakpoint (`@media (max-height: 60rem)`) targets short viewports to compact height-critical sections above the fold.
- Global `html, body { overflow: hidden }` pins layout to the viewport; scrolling is delegated to internal containers.

### Utility conventions
- Scrollbars are globally restyled (thin, pill-shaped thumb, transparent track) with a separate `.scrollbar-none` utility.
- Content cards disable user selection and image dragging via `.content-card` rules.
- Placeholder text is non-selectable globally.
- Animations consume motion tokens rather than hard-coded timings.

## Constraints and Enforced Rules

- **No ad-hoc colors**: new colors must be added to the brand scale or mapped through semantic variables; components should never hard-code hex values.
- **Motion tokens are centralized**: comments in `motion.css` explicitly state that components should consume the semantic aliases (`--motion-button-duration`, etc.) rather than introducing new durations/easings inline.
- **Reduced motion is respected**: `prefers-reduced-motion: reduce` disables all decorative animations and collapses motion durations to 1ms across the entire motion system.
- **Dark mode parity**: every semantic variable has a corresponding definition inside the `.dark` block, ensuring theme coverage is enforced at the token layer.
- **Base UI primitives are the foundation**: component primitives wrap `@base-ui/react` elements and add CVA-driven styling; business components compose these primitives rather than building raw DOM nodes with ad-hoc styles.
- **Single global stylesheet**: all CSS lives in `src/app/globals.css` (with motion tokens in `src/styles/tokens/motion.css`); there are no per-component CSS files.