**Design QA**

- Source visual truth: `/Users/zile/Downloads/Plane.svg`
- Project asset: `/Users/zile/Documents/ChatGPT/atlas-flight/public/assets/flights/plane.svg`
- Browser-rendered implementation: `/Users/zile/Documents/ChatGPT/atlas-flight/artifacts/supplied-plane-svg-final.png`
- Combined comparison: `/Users/zile/Documents/ChatGPT/atlas-flight/artifacts/supplied-plane-svg-comparison.jpg`
- Route: `http://localhost:3001/flights`
- Viewport: 1440 × 900 CSS px, desktop, light theme
- Source dimensions: 891 × 1764 SVG viewBox
- Implementation aircraft dimensions: 800 × 1584 CSS px, preserving the source aspect ratio
- Comparison normalization: the SVG was rendered over white and both images were proportionally scaled to 600 px high.
- State: supplied aircraft SVG with interactive seat 12A selected.

**Full-view Comparison Evidence**

The app now uses the exact supplied SVG asset rather than a traced or handcrafted substitute. The source and project copies have the same SHA-256 hash: `7ab389fb7854dd56a697bff45fb2f75cd722a514eea0b3156be7f9dfc783a42c`. The browser rendering preserves the original nose, cockpit band, fuselage, engine pods, wings, flaps, rear taper, and tailplanes without distortion.

**Focused Region Comparison Evidence**

The browser loaded the asset at its natural 891 × 1764 dimensions and displayed it at 800 × 1584. The rendered fuselage spans x=399.15–568.85 while all 96 seat controls span x=408–560, leaving approximately 9 px of clearance on each side. The seat grid occupies y=300–740 and remains completely inside the straight cabin section.

**Required Fidelity Surfaces**

- Fonts and typography: existing Argo typography remains unchanged.
- Spacing and layout rhythm: the aircraft preserves its native 0.505 aspect ratio; the cabin overlay was narrowed and positioned below the supplied cockpit.
- Colors and visual tokens: the aircraft uses the exact colors embedded in the user-supplied SVG; surrounding UI continues using Argo semantic tokens.
- Image quality and asset fidelity: exact source SVG, unoptimized and resolution-independent, with no raster substitution.
- Copy and content: seat-state, selection, and price content remains unchanged.

**Findings**

- No actionable P0, P1, or P2 differences remain.

**Comparison History**

- Earlier implementations recreated the aircraft with custom paths and did not match the supplied visual.
- Fix: removed the handcrafted paths, added the exact `Plane.svg` to the project, rendered it with its original aspect ratio, and realigned the seat controls to its fuselage.
- Final evidence: identical file hashes, correct natural browser dimensions, visible source geometry, contained seats, and zero clean-page console errors.

**Primary Interactions Tested**

- Selected seat 12A and verified the summary and price.
- Verified all 96 seat controls render inside the supplied plane.
- Confirmed the SVG loads successfully from `/assets/flights/plane.svg`.
- Passed ESLint, TypeScript, diff validation, and clean browser-console verification.

**Follow-up Polish**

- P3: future aircraft-specific seat maps can select different supplied SVG assets while retaining the same overlay system.

final result: passed
