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
