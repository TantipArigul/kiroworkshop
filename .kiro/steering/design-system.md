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

## Add-on — Base Document Styles
- All elements use `box-sizing: border-box` so padded full-width sections never exceed their container.
- `body` has no default margin and uses `--color-page`, `--color-text`, `--font-body` and a reading line-height of 1.5; headings use `--font-heading`.
- Links use `--color-primary` (hover `--color-primary-hover`) with the shared `:focus-visible` outline; browser-default link colours are not used.
- Page headings and their lead paragraph are separated by spacing tokens, never by relying on default margins.
- Status badges represent real data only; empty states must not show a placeholder status.

## Add-on — Brand Font Loading
- `Atkinson Hyperlegible` (body, weights 400/700) and `Crimson Pro` (headings/brand, weights 600/700) are self-hosted through the pinned OFL-1.1 packages `@fontsource/atkinson-hyperlegible` 5.3.0 and `@fontsource/crimson-pro` 5.3.0, imported once in `apps/web/src/main.tsx`.
- Fonts are bundled and served from the application origin; third-party font CDNs are not used.
- `Noto Sans Thai` remains a fallback name only and is not bundled until Thai UI copy is approved.

## Add-on — Identity UI Tokens (2026-10-15)
- **Contrast fix**: new primitive `--color-green-700` (`#15803d`); `--color-success` now maps to it because `--color-green-600` on white is below WCAG 2.2 AA for small text. `--color-accent` stays `--color-green-600` for decorative SVG strokes only.
- **`--border-hairline`** (`1px`): row separators inside data tables.
- **`--font-mono`**: system monospace stack for identifiers (actor/resource/request IDs) in the audit table; no font files are added.
- **Identity screens**: Sign in, Change password and Audit viewer reuse `Button`, `Input`, `Select`, `FeedbackMessage` and the shared status pattern (label + SVG icon + colour). Loading states use tokenized skeletons; tables scroll horizontally only inside their own focusable region.

## Add-on — Results UI Tokens (2026-10-18)
- **Source**: Results & Guidance design C8/C10. Built from existing primitives only; no new primitive, no existing token renamed or changed.
- **`--color-band-low`** → `--color-blue-800` (`#075985`): bar fill, icon and optional label text for `BELOW_TRAINING_MIDPOINT`. Contrast 7.56:1 on `--color-surface`, 7.23:1 on `--color-page`, 7.09:1 on `--color-surface-subtle`, 6.90:1 on `--chart-track`.
- **`--color-band-high`** → `--color-amber-600` (`#b45309`): bar fill, icon and optional label text for `AT_OR_ABOVE_TRAINING_MIDPOINT`. Contrast 5.02:1 on `--color-surface`, 4.80:1 on `--color-page`, 4.71:1 on `--color-surface-subtle`, 4.58:1 on `--chart-track`.
- **Bands are never colour-only**: the two band colours are only 1.51:1 apart, so every band always shows a distinct SVG icon shape, a text label and a legend; the paired `<table>` carries the same values. Band colours mean "position against the synthetic training midpoint", never a clinical judgement.
- **`--chart-track`** → `--color-slate-100` (`#f1f5f9`): decorative range track behind bars (1.10:1 on `--color-surface`). The range itself is conveyed by min/max labels and the paired table, so the track carries no information; bars on it meet ≥ 3:1 (non-text) and ≥ 4.5:1 (text) as listed above. Midpoint lines and axis labels use `--color-text-muted` (6.92:1 on the track).
- **`--chart-bar-height`** → `--space-4`: height of one horizontal bar.
- **`--report-frame-height`** → `clamp(24rem, 70vh, 48rem)`: height of the sandboxed HTML report `<iframe>`; the viewer also offers "Open in new tab" for small screens.
- **Motion**: bar width transitions use `--dur-normal`/`--ease-standard` and are removed by the existing reduced-motion override.

## Add-on — Cookie Rule (US-013 AC3, 2026-10-18)
- The portal sets one essential, `HttpOnly`, `SameSite=strict`, `Secure` session cookie for sign-in; there is no consent banner because no other cookie exists.
- **Future permanent cookies** (any cookie that outlives the browser session) must not be set until the user has given consent through a consent notice designed in a new spec change; the notice must allow refusing with equal prominence.
- **Third-party, analytics and tracking cookies are opt-in only**: off by default, never set before explicit consent, and withdrawable at any time.

## Add-on — Primary colour contrast fix (approved 2026-10-18)
- **Issue**: `--color-primary` was `--color-blue-600` (#0284c7): 4.10:1 on `--color-surface` (#ffffff), 3.91:1 on `--color-page` (#f8fafc) and 4.10:1 for `--color-on-primary` text on primary buttons — below WCAG 2.2 AA (4.5:1) for normal text.
- **Fix**: new primitive `--color-blue-700` (#0369a1); `--color-primary` now maps to it — 5.93:1 on surface, 5.67:1 on page, 5.93:1 for white text on primary buttons. `--color-primary-hover` stays `--color-blue-800` (#075985, darker than primary). Token names are unchanged; only the value changes.
- `--color-focus` stays `--color-blue-600` (focus ring, non-text: 4.10:1 on surface ≥ 3:1).
