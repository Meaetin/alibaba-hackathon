## Profile Page UI Overhaul

### 1. Update `src/app/profile/page.tsx`
- Replace the centered hero + CTA card + account card layout with the Figma structure:
  - Full-width hero banner (`rounded-2xl`, `bg-surface-muted`, height ~240px).
  - 148px avatar overlapping the bottom-left edge of the banner.
  - Name in serif display style (`type-secondary` / Lora, 24–32px).
  - Username handle below name.
  - Stats row: `{location} · {N} Locations · {M} Collections · {K} Itineraries` with dot separators.
  - Action row: "Add Preferences" secondary button + settings icon button.
  - "Persona Quiz" button anchored on the right side of the profile header row.
  - User description paragraph.
  - Content grid below using existing card components or placeholder skeletons.
- Keep a lightweight guest fallback that shows the new layout with placeholder data (e.g., "Guest", "Not signed in", zeroed stats).
- Replace the broken `type-title-2` and `type-label-2` classes with existing token classes (`type-h2`/`type-body-1`, `type-body-4`).

### 2. Extend avatar support for the large profile picture
- Either add an `xl` size (148px) to `src/components/ui/primitives/Avatar.tsx` or render a one-off large avatar in the profile page using the same token styling. Prefer adding the size variant so it stays consistent with the primitive system.

### 3. Query wiring
- `useSessionUserId()` and `useProfileQuery(userId)` already exist. Use `profile.display_name`, `profile.email`, `profile.avatar_url`.
- Stats counts will be stubbed/placeholder until the backend exposes them (reuse the existing unwired hooks pattern rather than changing call sites).

## Persona Quiz Dialog

### 4. Create quiz data module
- New file `src/lib/persona/quiz.ts`:
  - Export the 12 questions with 3 answer options each.
  - Each answer maps to a score vector across the 4 axes (Structure, Comfort, Focus, Social).
  - Export a `calculateArchetype(scores)` function that averages the vectors and finds the nearest archetype by Euclidean distance against the 12 centers defined in `docs/archetype-personas.md`.
- New file `src/lib/persona/types.ts`:
  - Types for `QuizAnswer`, `QuizState`, `PersonaResult`, and the four axes.
- Seed question copy from the Figma screens and `docs/travel-persona-quiz.html`, ensuring the answer-to-axis mapping matches the methodology in `docs/travel-persona-quiz-methodology.md`.

### 5. Build the quiz dialog component
- New file `src/components/profile/PersonaQuizDialog.tsx`:
  - Uses `@base-ui/react/dialog` directly (or wraps `FormModal`) for a centered 520px modal with the Figma styling.
  - Internal state machine: `intro` → `question-{0..11}` → `result`.
  - Progress bar at the top of the modal (red fill advancing across 12 steps).
  - Question screen: large illustration area, question text, 3 numbered answer options (selectable rows), Back/Next buttons.
  - Intro screen matches the Figma "Persona Quiz" modal (title + description + Cancel/Start Quiz).
  - Result screen: persona name, tagline, and paragraph description from `docs/archetype-personas.md`.

### 6. Launch from the profile page
- In `src/app/profile/page.tsx`, replace the current `router.push("/quiz")` with state-driven dialog opening:
  - `const [quizOpen, setQuizOpen] = useState(false);`
  - Pass `open`/`onOpenChange` to `PersonaQuizDialog`.

## CSS / Token Cleanup

### 7. Fix missing typography classes
- `src/app/profile/page.tsx` currently references `type-title-2` and `type-label-2`, which do not exist in `src/app/globals.css`. Either:
  - Add them to `globals.css` aligned with the Figma type scale, **or**
  - Replace usages with existing classes (`type-h2`, `type-body-4`).
- Recommendation: replace usages to avoid expanding the type scale without a broader design-system decision.

## Test Plan
- Run `npm run dev` and verify `/profile` renders the new layout without console errors.
- Verify the "Persona Quiz" button opens the modal.
- Walk through all 12 questions; confirm Back/Next navigation and progress bar update.
- Submit answers and confirm the result screen shows the expected archetype based on the Figma sample flow.
- Verify guest fallback still renders sensibly when `useSessionUserId()` returns `null`.

## Assumptions
- The signed-in profile stats (locations/collections/itineraries counts) are not yet wired to a backend; they will be displayed as placeholder zeros or omitted until the data layer is ready.
- The 12 archetype descriptions and centers in `docs/archetype-personas.md` are the source of truth for the result screen.
- The quiz modal is intentionally launched from `/profile`; the old `/quiz` route will not be created.