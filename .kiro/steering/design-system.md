---
inclusion: always
---
# Smart Checkup Portal Design System

## Decision Record
- **Source**: D3-13/D3-14 Foundation decisions; UX recommendation was generated locally and adopted as a system recommendation when the user selected `use recommendations`.
- **Direction**: Light-mode clinical research workspace — calm, trustworthy, information-first, clean surfaces and clear job-status hierarchy.
- **Scope**: Product text wordmark only; no third-party logos, images or tracking assets. SVG icons must inherit `currentColor`; emoji are prohibited.
- **Accessibility**: WCAG 2.2 AA, visible `:focus-visible`, labels plus icons for status, 44px interactive target, responsive mobile-first layout and `prefers-reduced-motion` support.
- **Theme**: Light is default. Dark mode is not in scope until explicitly approved.

## Token Architecture
Runtime source of truth: `apps/web/src/styles/tokens.css`.

Tokens follow three layers: primitive values → semantic aliases → component tokens. Components must use only `var(--token)` and must not hardcode colors, spacing, radius, shadows, timing or typography values.

### Token Map
- **Color**: clinical blue primary, health green accent, neutral surfaces; semantic `success`, `warning`, `danger`, `info` include text/icon labels and not color alone.
- **Typography**: `Atkinson Hyperlegible` body and `Crimson Pro` headings are OFL/open fonts with system fallbacks. Thai display uses `Noto Sans Thai` fallback.
- **Layout**: 4px primitive scale; component/section semantic spacing; content container max 1200px.
- **Elevation/Motion**: soft card elevation, 160–240ms transitions, reduced motion override.

## Component Rules
- **Button**: primary, secondary and ghost styles; all states use component tokens.
- **Input**: visible labels, hint/error text, focus ring and disabled state.
- **Card**: shared surface/border/radius/shadow tokens.
- **Status**: text label + distinct SVG icon + semantic color; never color alone.
- **Loading/empty/error/success**: every data page designs these states; loading uses tokenized skeleton rather than raw spinner where appropriate.

## Page Blueprint
- Landing: text wordmark, concise scope/disclaimer, licence link, secure sign-in action.
- Authenticated workspace: responsive header, centered container, primary action, Job sections arranged by user workflow.
- Mobile: one column, nav/menu collapse, horizontal table scrolling only inside its container.

## UX Review Notes
- Keep navigation shallow; show status and next action in context.
- Form validation is inline, specific and safe; destructive deletion requires confirmation.
- Motion is subtle and never blocks navigation; honor reduced-motion preference.
- Do not use the UX tool's suggested exaggerated-minimalist marketing layout because it conflicts with the information-first training workspace decision.

## Add-on — Responsive Token
- `--breakpoint-md: 48rem` is the shared medium responsive breakpoint token; responsive component styles must reference it rather than hardcode the breakpoint.

## Add-on — SamNohserver Brand Refinement
- **Name/wordmark**: SamNohserver. Use an original text wordmark with an abstract sequence-analysis SVG monogram; do not use any third-party asset.
- **Reference boundary**: B-Star informs only the focused scientific web-server workflow; page composition, layout, logo and copy are original.
- **Landing**: brand-forward clinical hero, one Start analysis action, a compact workflow preview and original scientific SVG anchor.
- **Workspace**: restrained Linear-style information surface with slim header, structured job content and responsive single-column behavior.
- **Motion**: subtle hover/focus/status transitions only; always honor reduced motion.

## Add-on — Scientific Landing Composition Refinement
- **Reference boundary**: The user-supplied Helix Star page capture informs the information hierarchy only: a white utility header, an expansive light research hero, one prominent workflow entry point, and a dark scientific-story section with generously rounded section edges. Do not reproduce its logo, wording, imagery, DOM/CSS, or exact page composition.
- **Original visual treatment**: SamNohserver landing uses the established clinical blue as the focused CTA/analysis-signal color, neutral paper-like hero surfaces, an original SVG sequence field, and a dark slate research panel. The hero must remain information-first: research context, a concise value statement, one `Start analysis` CTA, a secondary workflow link, and the training/non-medical scope notice.
- **Workflow treatment**: Show Prepare → Track → Review inside the dark research panel as an original three-step narrative. Use labelled step numbers and explanatory text; do not rely on color alone.
- **Landing token additions**: `--color-research-surface`, `--color-research-surface-muted`, `--color-on-research`, `--color-on-research-muted`, `--color-hero-tint`, `--fs-display`, `--radius-xl`, `--shadow-lg`, `--hero-column-min`, `--workflow-column-min`, and `--form-column-min` are the source-of-truth values for this composition. Implementations must use these tokens rather than raw visual values.
- **Responsive/accessibility**: Preserve a single-column reading order below `--breakpoint-md`, constrain decorative SVG to its container, keep 44px CTA targets and visible focus states, and remove decorative transitions when reduced motion is requested.
