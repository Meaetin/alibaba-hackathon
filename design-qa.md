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
