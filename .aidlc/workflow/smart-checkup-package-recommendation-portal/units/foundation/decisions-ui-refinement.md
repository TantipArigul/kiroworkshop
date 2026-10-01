# UI Design Refinement — SamNohserver

## Context Summary
- Current product has a light clinical/research visual system, CSS token runtime, accessible React primitives, SPA shell, and no approved third-party logo/image assets.
- The supplied B-Star reference is used only for interaction/layout inspiration: a focused bioinformatics web-server entry, simple submission path, and information-first results flow. Its name, logo, images, copy, and brand assets must not be copied.
- Requested product name: **SamNohserver**.

---

## Decision Questions

### UIR-1: Product brand and logo
**Question**: How should SamNohserver appear in the primary header and landing hero?
- 1) Create an original text wordmark `SamNohserver` plus a small custom SVG monogram built from abstract sequence/analysis lines; no third-party assets **(Recommended)**
- 2) Text wordmark only
- 3) User-provided logo asset (provide file/path)
- 4) Other: _______

**Answer**: 1

---

### UIR-2: Reference relationship
**Question**: Which aspects of the supplied B-Star reference may inform the redesign?
- 1) Borrow only the focused web-server workflow, concise scientific tone, and clear submit→status→result path; create an entirely original visual composition **(Recommended)**
- 2) Closely reproduce its page layout
- 3) Use only its content structure, not visual direction
- 4) Other: _______

**Answer**: 1

---

### UIR-3: Landing composition
**Question**: What should the SamNohserver landing first viewport prioritize?
- 1) Brand-forward clinical hero, one primary “Start analysis” action, a compact workflow preview, and a scientific visual anchor drawn with original SVG/CSS **(Recommended)**
- 2) Dense dashboard-style landing with many cards and metrics
- 3) Minimal login-first page without product introduction
- 4) Other: _______

**Answer**: 1

---

### UIR-4: Workspace layout
**Question**: What layout should authenticated pages use?
- 1) Calm Linear-style workspace: slim header, clear page title/action bar, job list as structured content surface, contextual status rail and responsive one-column mobile layout **(Recommended)**
- 2) Persistent desktop sidebar with card mosaic dashboard
- 3) Full-width table-first layout with no contextual guidance
- 4) Other: _______

**Answer**: 1

---

### UIR-5: Visual detail and motion
**Question**: How much visual polish should be used?
- 1) Subtle scientific visual anchor, soft depth, status transitions and hover/focus feedback; respect reduced motion **(Recommended)**
- 2) Rich animated marketing effects and multiple gradients
- 3) No motion or visual anchor
- 4) Other: _______

**Answer**: 1

---

### UIR-6: Product copy language
**Question**: Which copy language should the redesigned UI use?
- 1) English product UI with concise scientific terminology; retain non-medical training disclaimer **(Recommended)**
- 2) Thai-only UI
- 3) Bilingual Thai/English UI
- 4) Other: _______

**Answer**: 1

---

## Decisions Summary
- UIR-1 Brand: Original SamNohserver text wordmark plus custom abstract analysis-line SVG monogram
- UIR-2 Reference: Use only focused scientific workflow and submit→status→result flow; original composition required
- UIR-3 Landing: Brand-forward clinical hero, Start analysis CTA, workflow preview and original SVG/CSS science anchor
- UIR-4 Workspace: Calm Linear-style information workspace with responsive one-column mobile layout
- UIR-5 Polish: Subtle scientific anchor, soft depth, restrained transitions and reduced-motion support
- UIR-6 Copy: Concise English scientific product UI with non-medical training disclaimer

## Validation Outcome
- No third-party layout, logo, image or brand asset will be copied.
- Motion remains subtle, purposeful and disabled for reduced-motion preference.
- The direction remains light-mode, accessible and information-first.

---

**Instructions**: Fill answers then say `done`, or say `use recommendations`.

## Add-on — Scientific Landing Composition Refinement
- **Request source**: User-supplied static capture of a scientific web-server landing page on 2026-10-01.
- **Approved interpretation**: Adopt only its high-level hierarchy—white header, light expansive research hero, primary analysis entry, then a dark rounded research/workflow narrative. SamNohserver retains its own original wordmark, SVG sequence field, text, clinical blue/green token palette, data/privacy notices, and React implementation.
- **Explicit exclusions**: No third-party logo, image, typography asset, text, CSS, DOM structure, tracking behavior, or exact visual reproduction is permitted.
- **UX validation**: The UX heuristic review prioritised no page-level horizontal scrolling, responsive decorative visuals, and descriptive alternatives for meaningful visuals. The landing’s existing `role="img"` accessible label is retained and the revised layout must remain single-column on smaller viewports.
- **Resulting scope**: Refine the token source, landing JSX, and landing stylesheet only. No authentication, API, cookie, data, analytics, or deployment behavior changes.
