# Clipped Flight Ticket Edge Design QA

- Source visual truth: `/var/folders/wr/_4bt8g251bjcqfc5pp1380x00000gn/T/codex-clipboard-4c39a8d9-94a6-4b18-9acf-93443cd21296.png`
- Implementation screenshot: `/tmp/atlas-flight-clipped-ticket.png`
- Focused implementation crop: `/tmp/atlas-flight-clipped-ticket-focused.png`
- Combined comparison: `/tmp/atlas-flight-clipped-ticket-comparison.png`
- Browser: Codex in-app Browser, existing itinerary tab only
- Viewport: Laptop L, 1440 × 900 CSS px
- State: Flight tab → Add Flight → populated SIN–BKK sandbox results
- Source pixels: 492 × 55 at 1×
- Implementation capture pixels: 2360 × 2044; focused crop 455 × 225
- Density normalization: the reported issue crop and focused implementation were independently contained in equal comparison areas. The source documents the faulty unclipped edge; the requested target is the same ticket with content clipped to its rounded boundary.

## Full-view comparison evidence

Clipping is scoped to each ticket. Result density, scrolling, the flight form, itinerary column, and map remain unchanged.

## Focused-region comparison evidence

The combined comparison at `/tmp/atlas-flight-clipped-ticket-comparison.png` shows that the reported full circles no longer protrude beyond the ticket. Only the inward semicircular perforation remains visible, and the selected side border cannot continue behind content outside the rounded boundary.

## Required fidelity surfaces

- Fonts and typography: unchanged; all ticket content remains at least 14 px with no clipping or wrapping regressions.
- Spacing and layout rhythm: the rounded ticket is now the clipping boundary. The perforation line and inward half-notches retain their existing alignment.
- Interaction polish: every fare card now inherits the arrival card's restrained material response—a 1 px lift, very slight scale, and semantic shadow—while reduced-motion users receive no movement and card content never darkens.
- Colors and tokens: ticket selection and semantic border colors are unchanged. Clipping prevents the selected border from showing behind protruding notch content.
- Image quality and asset fidelity: the Argo plane sticker remains fully visible and sharp.
- Copy and content: flight identity, route, duration, availability, and price CTA remain intact. Tracking uses visible `Track price` / `Stop tracking` labels with distinct bell / crossed-bell icons.

## Findings

No actionable P0, P1, or P2 issue remains. The protruding full-circle artifact shown in the source crop is resolved.

## Interaction and runtime checks

- Ticket content stays inside the rounded border in selected and unselected states.
- Tracking and fare-selection actions remain interactive.
- Track and untrack states expose distinct text, icons, accessible names, and tooltips.
- Every tracked-fare summary row exposes its own crossed-bell `Stop tracking {flight}` action; using it removes only that watch and does not open the row.
- Hover treatment is applied consistently to every fare-card surface without changing its actions or selected state.
- Browser console error check returned no errors.
- Type-check, lint, and `git diff --check` pass.

## Comparison history

1. Moving the actions inside the ticket left the perforation circles positioned outside an unclipped selected container.
2. The circles protruded as full detached shapes and exposed the selected side border behind them.
3. The rounded ticket container now clips its descendants. Focused post-change evidence shows clean inward half-notches with no external overflow.

## Implementation checklist

- [x] Make the rounded ticket the clipping boundary
- [x] Preserve the inward perforation treatment
- [x] Prevent selected border bleed behind the notches
- [x] Preserve ticket content and interactions
- [x] Verify Laptop L rendering and console state

final result: passed

---

# Argo Authentication Screen Design QA

- Source visual truth: `/var/folders/wr/_4bt8g251bjcqfc5pp1380x00000gn/T/codex-clipboard-f5bc1b2b-0b45-4df7-bee7-dd1a3bd633ad.png`
- Initial implementation screenshot: `/Users/zile/.codex/visualizations/2026/08/29/01a04cf1-d94a-7e53-b3e1-936efd8413c1/axac-login-desktop.png`
- Final implementation screenshot: `/Users/zile/.codex/visualizations/2026/08/29/01a04cf1-d94a-7e53-b3e1-936efd8413c1/axac-login-desktop-final.png`
- Sign-up state screenshot: `/Users/zile/.codex/visualizations/2026/08/29/01a04cf1-d94a-7e53-b3e1-936efd8413c1/axac-signup-desktop-final.png`
- Responsive screenshot: `/Users/zile/.codex/visualizations/2026/08/29/01a04cf1-d94a-7e53-b3e1-936efd8413c1/axac-login-mobile-final.png`
- Browser: Codex in-app Browser
- Desktop viewport: 1460 × 838 CSS px
- Mobile viewport: 390 × 844 CSS px
- State: unauthenticated, light theme; sign-in and sign-up modes
- Source pixels: 2920 × 1676 at 2× density, normalized to 1460 × 838 CSS px
- Implementation pixels: 1460 × 838 at 1× density

## Full-view comparison evidence

The source and final implementation were opened together at the same normalized desktop viewport. The implementation preserves the source's equal-width split, 60 px panel inset, logo placement, form width, form hierarchy, pale illustration surface, and exact sticker composition. The intentionally omitted Google, divider, password recovery, privacy, and terms content leaves open space below the primary action without moving the retained controls away from their source positions.

## Focused-region comparison evidence

A separate crop was not needed: at the normalized 1460 × 838 comparison size, the 320 px form, 44 px controls, typography, borders, password icon, and all decorative assets remain clearly legible. The form and illustration regions were also checked independently through browser DOM inspection.

## Required fidelity surfaces

- Fonts and typography: the retained Argo heading uses the existing Lora secondary type token; body and control copy use Switzer through the existing primary type tokens. Weight, scale, line height, and hierarchy match the source.
- Spacing and layout rhythm: the desktop form is anchored to the source's heading and input positions, controls remain 320 × 44 px, and the panel split is 50/50. Mobile centers the form and removes the decorative panel without overflow.
- Colors and tokens: all surfaces, borders, content, placeholders, focus states, errors, and the primary action use the existing semantic design tokens. No new hardcoded palette was introduced.
- Image quality and asset fidelity: the Argo logo and six sticker SVGs are the original Argo project assets and are byte-identical to the source project copies. Their scale, rotation, and placement match the reference.
- Copy and content: sign-in and sign-up headings, cross-mode prompts, Email, Password, and primary actions are present. Google, password recovery, privacy policy, and terms copy are omitted as requested.
- Icons and accessibility: the existing Lucide eye/eye-off pair is retained and now exposes `Show password` / `Hide password` accessible names. Decorative stickers are hidden from assistive technology.

## Findings

No actionable P0, P1, or P2 issue remains. The black outer frame visible in the supplied image is treated as screenshot/browser chrome rather than application UI.

## Interaction and runtime checks

- Sign-in → sign-up and sign-up → sign-in switching works without navigating away or losing the auth integration.
- Password visibility toggles between password and text input states.
- Native required, email, and eight-character password validation keeps the source-matching active primary button while preventing invalid submission.
- No account was created during QA; form submission was deliberately not triggered.
- Mobile layout has no horizontal overflow and hides the illustration panel at the original large breakpoint.
- Browser console error check returned no errors.
- Targeted lint and TypeScript checks pass.
- Full test suite: 70 files passed; 1231 tests passed and 1 skipped.

## Comparison history

1. Initial pass: the retained form shifted roughly 84 px too low after the omitted secondary controls shortened the centered content block. The primary action also rendered in a pale disabled state, unlike the source.
2. Fix: the desktop form region was anchored to the source position, the primary action now relies on native field validation, and the password control gained an accessible interactive label.
3. Final pass: source and implementation align at the normalized desktop viewport; both auth modes and the responsive collapse pass without actionable P0/P1/P2 differences.

## Implementation checklist

- [x] Preserve AxAC's existing Neon-backed sign-in and sign-up behavior
- [x] Match the Argo split-screen composition and original assets
- [x] Omit Google, password recovery, privacy, and terms UI
- [x] Verify sign-in, sign-up, and password visibility interactions
- [x] Verify desktop and mobile rendering
- [x] Verify console, lint, types, and tests

final result: passed
