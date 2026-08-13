---
version: alpha
name: Re:Memory — Memory Editorial System
description: "A warm, editorial, evidence-first design system for a personal memory AI. Memory is a surface, evidence is a node, relations are lines, and uncertainty is visible rather than hidden."
colors:
  primary: "#3D3A78"
  on-primary: "#FFFDF8"
  secondary: "#5A7358"
  on-secondary: "#FFFDF8"
  tertiary: "#B24A3E"
  on-tertiary: "#FFFDF8"
  neutral: "#F7F3EA"
  background: "#F7F3EA"
  surface: "#FFFDF8"
  surface-muted: "#F0ECE3"
  ink: "#1C1A22"
  ink-muted: "#68636E"
  border: "#D8D1C6"
  border-strong: "#B8B0A4"
  indigo-soft: "#EAE8F5"
  coral-soft: "#F4E2DE"
  sage-soft: "#E5ECE3"
  error: "#A43E3E"
  focus: "#3D3A78"
  overlay: "rgba(28, 26, 34, 0.48)"
typography:
  display-lg:
    fontFamily: "Newsreader, 'Noto Serif JP', Georgia, serif"
    fontSize: 48px
    fontWeight: 500
    lineHeight: 1.05
    letterSpacing: -0.025em
  display-md:
    fontFamily: "Newsreader, 'Noto Serif JP', Georgia, serif"
    fontSize: 36px
    fontWeight: 500
    lineHeight: 1.1
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: "Newsreader, 'Noto Serif JP', Georgia, serif"
    fontSize: 30px
    fontWeight: 500
    lineHeight: 1.15
    letterSpacing: -0.015em
  headline-md:
    fontFamily: "Newsreader, 'Noto Serif JP', Georgia, serif"
    fontSize: 24px
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: "Inter, 'Noto Sans JP', system-ui, sans-serif"
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: -0.01em
  body-lg:
    fontFamily: "Inter, 'Noto Sans JP', system-ui, sans-serif"
    fontSize: 18px
    fontWeight: 400
    lineHeight: 1.65
    letterSpacing: 0em
  body-md:
    fontFamily: "Inter, 'Noto Sans JP', system-ui, sans-serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: 0em
  body-sm:
    fontFamily: "Inter, 'Noto Sans JP', system-ui, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: 0em
  label-lg:
    fontFamily: "Inter, 'Noto Sans JP', system-ui, sans-serif"
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: 0.01em
  label-md:
    fontFamily: "Inter, 'Noto Sans JP', system-ui, sans-serif"
    fontSize: 13px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: 0.015em
  caption:
    fontFamily: "Inter, 'Noto Sans JP', system-ui, sans-serif"
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.45
    letterSpacing: 0.01em
rounded:
  none: 0px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  full: 9999px
spacing:
  micro: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  2xl: 48px
  3xl: 64px
  mobile-gutter: 20px
  desktop-gutter: 32px
  content-max: 72rem
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label-lg}"
    rounded: "{rounded.md}"
    height: 48px
    padding: 16px
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.label-lg}"
    rounded: "{rounded.md}"
    height: 48px
    padding: 16px
  button-confirm:
    backgroundColor: "{colors.tertiary}"
    textColor: "{colors.on-tertiary}"
    typography: "{typography.label-lg}"
    rounded: "{rounded.md}"
    height: 48px
    padding: 16px
  memory-surface:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: 16px
  evidence-chip:
    backgroundColor: "{colors.indigo-soft}"
    textColor: "{colors.primary}"
    typography: "{typography.label-md}"
    rounded: "{rounded.full}"
    height: 36px
    padding: 12px
  confirmed-chip:
    backgroundColor: "{colors.sage-soft}"
    textColor: "{colors.ink}"
    typography: "{typography.label-md}"
    rounded: "{rounded.full}"
    height: 36px
    padding: 12px
  gap-chip:
    backgroundColor: "{colors.coral-soft}"
    textColor: "{colors.ink}"
    typography: "{typography.label-md}"
    rounded: "{rounded.full}"
    height: 36px
    padding: 12px
  search-input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    height: 52px
    padding: 16px
  bottom-nav:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.label-md}"
    rounded: "{rounded.none}"
    height: 64px
    padding: 8px
---

# Re:Memory DESIGN.md

## Overview

Re:Memory should feel like a **living personal archive**, not an AI dashboard, photo utility, CRM, or social network. The emotional target is **quiet recognition**: the interface should make a user feel that scattered moments are becoming understandable without pretending the AI knows more than it does.

The visual idea is **Memory Editorial**: the calm hierarchy of a photo essay or personal archive, combined with a precise evidence system. Photography carries emotion. Typography carries narrative. Nodes and lines carry epistemic state.

Three principles govern every screen:

1. **Memory is the hero.** The first thing the user should understand is the event or memory itself, not the AI machinery.
2. **Uncertainty must be visible.** AI inference is visually distinct from evidence and user-confirmed truth.
3. **AI stays quiet until useful.** Avoid decorative AI branding. Show intelligence through good reconstruction, relevant clarification, provenance, and grounded recall.

### Signature visual grammar

```text
Memory      = Surface / editorial block
Evidence    = ● filled node
AI inference= ○ open node
Confirmed   = ● filled node
Confirmed relation = ━━ solid line
AI inferred relation = ┈┈ dotted line
Time        = vertical axis
Gap         = a deliberate interruption, not an error state
```

The colon in `Re:Memory` may echo the two-node grammar. It should be treated as a subtle brand device, not a decorative motif repeated everywhere.

### Product personality

- Warm, reflective, trustworthy
- Human before technical
- Editorial before dashboard
- Precise without feeling clinical
- Calm rather than magical
- Modern without trend-chasing
- Personal without becoming sentimental or childish

### Reference priority

When implementing UI, use this order:

1. Product behavior in `IMPLEMENTATION_PROMPT.md`
2. Data truth and state semantics in `DATABASE_DESIGN.md`
3. This `DESIGN.md`
4. `docs/images/ui/ui-final.webp` as the primary visual reference
5. Older UI images only to understand design history

If a screenshot conflicts with product or data invariants, the specification wins.

## Colors

The palette is built from **warm paper + deep ink + restrained semantic accents**. Pure white and pure black should be rare. The UI should feel physical enough to hold memories, but not skeuomorphic.

- **Primary / Indigo (`#3D3A78`)** — Identity, confirmed thread emphasis, primary action, focus. It should feel archival and thoughtful rather than “tech blue.”
- **Neutral / Warm Ivory (`#F7F3EA`)** — Main page background. The base should feel warmer than a SaaS canvas.
- **Surface (`#FFFDF8`)** — Memory surfaces, search fields, sheets, and content that needs separation from the page.
- **Ink (`#1C1A22`)** — Main text and high-importance labels.
- **Muted Ink (`#68636E`)** — Metadata, secondary labels, and support text. Never use faint gray that sacrifices readability.
- **Tertiary / Coral (`#B24A3E`)** — Human action and unresolved context. Use for confirmation prompts, “tell me more,” or a moment requiring the user’s participation. Do not use as a generic brand accent everywhere.
- **Secondary / Sage (`#5A7358`)** — Resolved, grounded, completed, or calm confirmation states. Do not equate it mechanically with “success” if the semantics are only “confirmed.”
- **Soft variants** — Background tints only. They should not replace clear labels, icons, line styles, or text descriptions.

### State color mapping

```text
AI inference       → primary/ink-muted + open node + dotted line + explicit label
Evidence           → ink/primary + filled node
User confirmed     → primary or sage + filled node + solid line + "確認済み"
Memory gap         → coral/coral-soft + question language
Error              → error + plain-language recovery action
Unknown            → muted ink + neutral surface; never red by default
```

Do not communicate epistemic state with color alone.

## Typography

Typography separates **memory narrative** from **interface control**.

- **Serif display / headings:** `Newsreader` first, with Japanese serif fallback. Use for memory titles, large dates, section statements, and emotionally important headings. It creates an album/editorial voice.
- **Sans-serif body / controls:** `Inter` first, with Japanese sans fallback. Use for body copy, metadata, buttons, forms, navigation, filters, and system state.

Rules:

- Default body is 16px. Do not shrink core UI to create artificial sophistication.
- Captions should generally stay at 13px or larger.
- Memory title is more important than AI summary.
- Metadata should be compact but never low-contrast.
- Avoid excessive uppercase. The product is personal, not industrial telemetry.
- Keep line length around 45–70 characters on desktop reading surfaces.
- Use at most three visible type sizes in one compact mobile region unless hierarchy genuinely requires more.

## Layout

Re:Memory is **smartphone-first**. Desktop should feel like a wider archive, not a stretched phone screen.

### Mobile

- Base horizontal gutter: 20px.
- Primary content is one column.
- Bottom navigation may contain up to five destinations.
- Important controls must fit comfortable thumb reach where practical.
- Tap targets should be at least 44px in both dimensions.
- Safe-area insets must be respected.

### Desktop

- Max content width: approximately 72rem.
- Do not center every section into a generic marketing column.
- Memory Thread may use a main narrative column plus a restrained evidence/detail rail when space permits.
- Keep the timeline visually continuous across content; do not fragment it into unrelated cards.

### Memory Thread geometry

On mobile, the thread is compact by default:

```text
  ●  2026.08.12
  │  FTC Practice
  │  神山 · 5 photos
  │
  ○  Related context
  ┊
  ●  Robot Build
```

Guidelines:

- Use a stable vertical axis.
- Align nodes consistently; the thread should read at a glance.
- Selected memory may expand relations. Unselected memories remain compact.
- Do not render the entire product as a graph.
- Never allow edge crossings or dense node clouds on small screens.
- Relation lines exist to explain memory structure, not to decorate empty space.

### Spacing rhythm

Use 4px only for micro-alignment. Normal component spacing should follow 8/12/16/24/32/48/64 rhythm. Large empty space is allowed when it helps photography or memory hierarchy, but avoid a generic oversized landing-page aesthetic inside the app.

## Elevation & Depth

Depth is created primarily by **tonal separation, borders, photography, and hierarchy**, not floating shadows.

- Page background: warm ivory.
- Memory surfaces: near-white paper.
- Default divider/border: 1px warm gray.
- Shadows: either none or a very restrained low-opacity shadow for transient overlays and elevated sheets.
- Bottom sheets/dialogs may use an overlay and modest elevation because they are temporary layers.
- Do not stack multiple shadow levels on normal content.
- Do not use glow around AI states.

A memory should feel placed on a page, not floating in a SaaS dashboard.

## Shapes

The shape language is **softly structured**, not bubbly.

- Normal buttons/inputs: 12px radius.
- Memory surfaces: 16px radius maximum in most cases.
- Photos: 8–12px radius, depending on crop and context.
- Pills: reserve full rounding for compact semantic chips and filters.
- Full-screen sections, navigation bars, timelines, evidence rows, and editorial text blocks do not need card containers or rounded corners.

The most important circular shapes are the evidence/inference nodes. Preserve circles for semantic meaning rather than using circles decoratively everywhere.

## Components

### Memory Thread

This is the signature component and should receive the highest visual QA attention.

**Compact state**
- Node + time axis
- Memory title
- Date/time
- One or two useful context lines
- Optional representative photo thumbnail
- Minimal status label only if it changes interpretation

**Expanded state**
- Representative photo(s)
- AI summary clearly labeled as AI reconstruction/inference
- Related evidence and relations
- Memory gap prompt if eligible
- Provenance entry point

Transitions between inferred and confirmed relations should be legible even with motion disabled.

### Memory Surface

A Memory Surface is not a generic card template. It may be a bordered editorial block, a photo-led section, or a compact thread row. Use a contained card only when containment clarifies interaction or grouping.

A memory surface prioritizes:

1. photo / memory identity
2. title
3. time + place
4. status when important
5. AI reconstruction
6. evidence on demand

### Evidence Node

- Evidence / user-confirmed: filled circular node.
- AI inference: open circular node.
- Minimum visible diameter approximately 10–12px; interaction target may be larger.
- Pair with text labels for non-obvious cases.
- Nodes must align to thread lines with pixel precision.

### Relation Line

- Confirmed relation: solid.
- AI inferred relation: dotted or dashed.
- Keep line weight restrained, roughly 1–2px.
- Use animation only to explain state change, never as ambient decoration.

### Confirmation Prompt

The prompt should feel like a **small invitation to complete context**, not a form or interrogation.

Preferred pattern:

```text
この記憶について、ひとつだけ確認したいことがあります。

これは FTC の練習でしたか？

[そう] [違う] [あとで]
```

- Prefer tap-first choices.
- One primary question at a time.
- “あとで” and Skip must be visually legitimate choices, not hidden escape hatches.
- Do not open blocking modals during unrelated browsing.

### Search

Search is memory recall, not database query UI.

- Input should accept vague natural language.
- After parsing, show a compact interpretation such as time/place/activity chips.
- If retrieval is ambiguous, show 2–3 candidates with **match reasons**, not arbitrary percentages.
- Candidate cards should differ enough to support recognition: representative image, date, place, and one decisive reason.

### Memory Detail

Use a three-layer hierarchy:

1. **Memory** — photo, title, date, place, state
2. **AI reconstruction** — clearly identified as inferred/generated
3. **Evidence** — collapsed by default behind an explicit provenance action

The user should know what the memory is within roughly three seconds.

### Buttons

- Primary indigo: one dominant action per local decision area.
- Coral confirm: reserved for user participation in resolving missing context; do not use it for every CTA.
- Secondary: paper surface + ink + visible border.
- Destructive actions must use error semantics and explicit labels.
- Avoid icon-only buttons when the action is not universally understood.

### Inputs

- 52px target height for primary search/input rows.
- Visible label or clear accessible name.
- Warm border and obvious focus state.
- Errors should describe what happened and how to recover.

### Bottom Navigation

- Maximum five destinations.
- No floating glass dock.
- Use a stable surface with a top border.
- Active state uses icon + label + primary color; inactive state remains readable.
- Confirmation may be a Home entry point rather than a permanent tab if frequency is low.

### Photography

Photography is the emotional center of Re:Memory.

- Preserve natural aspect ratios where possible; use 4:3 or 3:2 crops for galleries and hero regions.
- Avoid Polaroid frames, tape effects, scrapbook stickers, or nostalgic filters as the default language.
- Never place text over a photograph unless contrast is guaranteed and the image remains understandable.
- Do not blur photos merely to create “AI magic.”
- Skeletons should match expected image geometry to avoid layout shift.

### Motion

Motion explains state transitions.

Preferred duration: 150–300ms for most UI transitions.

Signature transition:

```text
○ ┈┈┈ ○
user confirms
● ━━━━━ ●
```

Requirements:

- Respect `prefers-reduced-motion`.
- The meaning must remain clear with animation disabled.
- Avoid spring-heavy, bouncy motion.
- No looping ambient animation in normal memory browsing.

### Loading, Empty, Error, Partial Success

These are first-class states, not afterthoughts.

- **Loading:** show which stage is happening in human language when work is long enough to notice.
- **AI processing:** distinguish upload success from AI reconstruction still processing.
- **Partial success:** preserve uploaded media and deterministic metadata even if AI fails.
- **Empty:** invite the first meaningful action; do not fake sample memories as if they were user data.
- **Error:** provide recovery, retry, or safe continuation.
- **Offline:** never imply server-side AI work completed if it did not.

## Do's and Don'ts

### Do

- Do read `DESIGN.md` before any UI implementation or refactor.
- Do make Memory Thread visually unmistakable from a normal timeline.
- Do show AI uncertainty with open nodes, dotted relations, labels, and language.
- Do prioritize photography and memory title over AI metadata.
- Do keep evidence provenance accessible without making every screen technical.
- Do use warm paper surfaces and strong readable ink.
- Do reserve coral for meaningful human participation and unresolved context.
- Do use sage for grounded/resolved states when appropriate.
- Do show search match reasons instead of fabricated precision percentages.
- Do support keyboard, visible focus, text scaling, reduced motion, and WCAG AA contrast.
- Do implement responsive states intentionally for phone, tablet, and desktop.
- Do test with long Japanese titles, short English metadata, missing photos, missing location, and uncertain AI output.
- Do preserve visual semantics when color is removed or viewed in grayscale.

### Don't

- Don't turn the product into a generic SaaS dashboard.
- Don't use blue-purple gradients, neon glows, glassmorphism, or sparkles as shorthand for AI.
- Don't center every page around a large generic hero and CTA.
- Don't put every block inside a rounded card.
- Don't use a complex force-directed graph as the default navigation.
- Don't render inferred claims as facts.
- Don't display confidence like `92%` unless the number has a precise, defensible product meaning.
- Don't use fake calendar, people, location, or evidence data to make the UI look complete.
- Don't hide “あとで”, Skip, privacy controls, or correction paths.
- Don't make tiny low-contrast captions to appear premium.
- Don't use full-round pill buttons for every action.
- Don't overuse serif typography for controls or dense metadata.
- Don't let motion be the only signal that a relation became confirmed.
- Don't imitate another product or brand directly; Re:Memory must remain its own visual system.

### Visual QA acceptance criteria

Before a UI task is considered complete, verify:

1. The page can be identified as Re:Memory even with the logo hidden.
2. AI inference and user-confirmed truth are distinguishable without relying only on color.
3. The memory title/photo outrank AI decoration and controls.
4. Mobile layout works at narrow widths without graph collisions or clipped controls.
5. Loading, empty, error, and partial-success states exist where the feature can enter them.
6. Focus states are visible and tap targets are comfortable.
7. No generic gradient/glass/glow AI styling has appeared.
8. Component styling uses shared semantic tokens rather than arbitrary one-off values.
9. `ui-final.webp` has been used as visual reference without copying data or inventing unsupported features.
10. A screenshot review has been performed at representative mobile and desktop widths before completion.
