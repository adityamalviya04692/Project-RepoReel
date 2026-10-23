---
version: alpha
name: RepoReel
description: Apple-inspired, content-first interface for finding GitHub repos and the reels that explain them. Calm parchment and white canvases alternate with near-black tiles; one accent (Action Blue) marks every interactive element; embedded reels are the "product photography" the layout frames.
source: Adapted from design-md/apple/DESIGN.md in VoltAgent/awesome-design-md (MIT). Full reference copy in docs/reference-apple-DESIGN.md.

colors:
  primary: "#0066cc"          # Action Blue — the only accent
  primary-focus: "#0071e3"
  primary-on-dark: "#2997ff"
  ink: "#1d1d1f"
  ink-muted-80: "#333333"
  ink-muted-48: "#7a7a7a"
  canvas: "#ffffff"
  canvas-parchment: "#f5f5f7"
  surface-pearl: "#fafafc"
  surface-tile-1: "#272729"
  surface-tile-2: "#2a2a2c"
  surface-black: "#000000"
  hairline: "#e0e0e0"
  divider-soft: "rgba(0,0,0,0.08)"
  on-dark: "#ffffff"
  on-dark-muted: "#cccccc"
  # Functional (status only, never decoration)
  health-good: "#1f9d55"
  health-warn: "#b26a00"
  health-bad: "#c4271f"

typography:
  hero-display: { fontFamily: "system-ui, -apple-system, 'SF Pro Display', Inter, sans-serif", fontSize: 56px, fontWeight: 600, lineHeight: 1.07, letterSpacing: -0.28px }
  display-lg:   { fontSize: 40px, fontWeight: 600, lineHeight: 1.1, letterSpacing: -0.2px }
  display-md:   { fontSize: 28px, fontWeight: 600, lineHeight: 1.14, letterSpacing: -0.2px }
  tagline:      { fontSize: 21px, fontWeight: 600, lineHeight: 1.19, letterSpacing: 0.231px }
  body:         { fontSize: 17px, fontWeight: 400, lineHeight: 1.47, letterSpacing: -0.374px }
  body-strong:  { fontSize: 17px, fontWeight: 600, lineHeight: 1.24, letterSpacing: -0.374px }
  caption:      { fontSize: 14px, fontWeight: 400, lineHeight: 1.43, letterSpacing: -0.224px }
  caption-strong: { fontSize: 14px, fontWeight: 600, lineHeight: 1.29, letterSpacing: -0.224px }
  fine-print:   { fontSize: 12px, fontWeight: 400, lineHeight: 1.33, letterSpacing: -0.12px }
  mono:         { fontFamily: "ui-monospace, 'SF Mono', 'JetBrains Mono', monospace", fontSize: 14px, fontWeight: 400 }

rounded: { sm: 8px, md: 11px, lg: 18px, pill: 9999px }
spacing: { xxs: 4px, xs: 8px, sm: 12px, md: 17px, lg: 24px, xl: 32px, xxl: 48px, section: 80px }

motion:
  spring-default: { damping: 1.0, response: 0.35 }   # all UI: no overshoot
  spring-sheet:   { damping: 0.8, response: 0.3 }    # draggable repo sheet only (momentum)
  press-scale: 0.97
  projection-deceleration: 0.998

components:
  search-pill:        { backgroundColor: "{colors.canvas}", textColor: "{colors.ink}", rounded: "{rounded.pill}", height: 56px, typography: "{typography.body}", padding: "0 24px" }
  facet-chip:         { backgroundColor: "{colors.canvas}", textColor: "{colors.ink}", rounded: "{rounded.pill}", padding: "8px 14px", typography: "{typography.caption}" }
  button-primary:     { backgroundColor: "{colors.primary}", textColor: "{colors.on-dark}", rounded: "{rounded.pill}", padding: "11px 22px", typography: "{typography.body}" }
  button-secondary:   { backgroundColor: "{colors.canvas}", textColor: "{colors.primary}", rounded: "{rounded.pill}", padding: "11px 22px", typography: "{typography.body}" }
  repo-card:          { backgroundColor: "{colors.canvas}", textColor: "{colors.ink}", rounded: "{rounded.lg}", padding: "{spacing.lg}" }
  repo-owner:         { textColor: "{colors.ink-muted-48}", typography: "{typography.mono}" }
  health-good:        { textColor: "{colors.health-good}", typography: "{typography.caption-strong}" }
  health-warn:        { textColor: "{colors.health-warn}", typography: "{typography.caption-strong}" }
  health-bad:         { textColor: "{colors.health-bad}", typography: "{typography.caption-strong}" }
  reel-frame:         { backgroundColor: "{colors.surface-black}", rounded: "{rounded.lg}" }
  trust-badge:        { backgroundColor: "{colors.surface-pearl}", textColor: "{colors.ink-muted-80}", rounded: "{rounded.pill}", padding: "4px 10px", typography: "{typography.caption-strong}" }
  tile-light:         { backgroundColor: "{colors.canvas}", textColor: "{colors.ink}", padding: "{spacing.section} 0" }
  tile-parchment:     { backgroundColor: "{colors.canvas-parchment}", textColor: "{colors.ink}", padding: "{spacing.section} 0" }
  tile-dark:          { backgroundColor: "{colors.surface-tile-1}", textColor: "{colors.on-dark}", padding: "{spacing.section} 0" }
  tile-dark-alt:      { backgroundColor: "{colors.surface-tile-2}", textColor: "{colors.on-dark-muted}", padding: "{spacing.section} 0" }
  link-on-dark:       { textColor: "{colors.primary-on-dark}", typography: "{typography.body}" }
  global-nav:         { backgroundColor: "{colors.canvas-parchment}", textColor: "{colors.ink}", height: 52px, typography: "{typography.caption}" }
  footer:             { backgroundColor: "{colors.canvas-parchment}", textColor: "{colors.ink-muted-80}", typography: "{typography.fine-print}" }
  sheet:              { backgroundColor: "{colors.canvas}", textColor: "{colors.ink}", rounded: "{rounded.lg}" }
  dropzone:           { backgroundColor: "{colors.canvas-parchment}", textColor: "{colors.ink-muted-80}", rounded: "{rounded.lg}" }
  hero-title:         { textColor: "{colors.ink}", typography: "{typography.hero-display}" }
  section-title:      { textColor: "{colors.ink}", typography: "{typography.display-lg}" }
  card-title:         { textColor: "{colors.ink}", typography: "{typography.display-md}" }
  eyebrow:            { textColor: "{colors.primary}", typography: "{typography.tagline}" }
  card-name:          { textColor: "{colors.ink}", typography: "{typography.body-strong}" }
  focus-ring:         { backgroundColor: "{colors.primary-focus}", rounded: "{rounded.sm}" }
  divider:            { backgroundColor: "{colors.hairline}", height: 1px }
  input-outline:      { backgroundColor: "{colors.divider-soft}", height: 1px }
  spacing-ref:        { padding: "{spacing.xxs} {spacing.xs} {spacing.sm} {spacing.md}" }
  spacing-ref-2:      { padding: "{spacing.xl} {spacing.xxl}" }
  rounded-ref:        { rounded: "{rounded.md}" }
---

## Overview

RepoReel borrows Apple's "product as photography" idea: the **embedded reel is the hero object** and the UI recedes around it. Pages are stacks of full-bleed tiles alternating white/parchment and near-black, with the colour change as the only section divider. Every interactive element is Action Blue; status colours (health) appear only inside the health strip.

## Component details the token schema can't express
- **Borders:** `search-pill`, `facet-chip`, `repo-card` and `dropzone` use a 1px `{colors.hairline}` (or `{colors.divider-soft}`) border; `dropzone` is 2px dashed. Active `facet-chip` = 2px `{colors.primary-focus}` border. `button-secondary` = 1px `{colors.primary}` border.
- **The one shadow:** `reel-frame` only, `rgba(0,0,0,0.22) 3px 5px 30px`; aspect ratio 9:16.
- **Materials:** `global-nav` at 80% opacity and `sheet` at 92%, both with `backdrop-filter: saturate(180%) blur(20–24px)`; solid when `prefers-reduced-transparency`.
- **Layout:** `health-strip` is an inline row with `{spacing.sm}` gaps holding `health-*` chips.

## Rules we adopt from the Apple DESIGN.md
- **One accent.** `{colors.primary}` for links, pills and focus; `{colors.primary-on-dark}` on dark tiles. No second brand colour, no decorative gradients.
- **Type.** System font first (resolves to SF Pro on Apple devices; Inter elsewhere). Body at **17px/1.47**, display at weight **600** with negative tracking. No weight 500.
- **Shapes.** Pills for actions (search, CTAs, chips), 18px radius for cards, 0px for full-bleed tiles. No radii in between.
- **Elevation.** No shadows on cards or buttons. The single soft shadow is reserved for the **reel frame**, our equivalent of product imagery. Floating chrome (nav, sheet) uses backdrop blur, not shadow.
- **Press state.** `transform: scale(0.97)` on pointer-down, instantly.

## Motion (from Apple's fluid-interface principles)
- **Springs, not timed curves**, for anything the user touches; critically damped by default (`spring-default`).
- The **repo sheet** follows the pointer 1:1 from the grab offset, projects momentum on release (`d = 0.998`) to decide open or dismiss, hands release velocity to `spring-sheet`, and rubber-bands past its top edge.
- Every transition can be interrupted; animations start from the current on-screen value.
- **Spatial consistency:** the sheet rises from and returns to the card that opened it; results enter in reading order.
- `prefers-reduced-motion`: cross-fades only. `prefers-reduced-transparency`: solid nav and sheet.

## Key screens
1. **Home:** `tile-parchment` hero → hero-display "What are you building?" → `search-pill` → example `facet-chip`s. Then a `tile-dark` "Rising this week" carousel and a `tile-light` "Trusted creators" row.
2. **Results:** "Understood:" facet chips (editable) above a column of `repo-card`s. Each card has: name (body-strong, mono owner), reason (body), `health-strip` (★, Δ7d, last push, licence, AI-compat glyphs), 1–3 `reel-frame`s with `trust-badge`s, and a `button-secondary` "Details".
3. **Repo sheet:** `sheet` with README excerpt, momentum sparkline, all reels, HN threads, and `button-primary` "Open on GitHub".
4. **Snap a reel:** `dropzone` → OCR progress → result card.
5. **Pipeline status:** `tile-dark` stats band (rows per layer, freshness), checks list, lineage diagram.

## Accessibility
- Minimum target 44×44px; visible 2px `{colors.primary-focus}` focus rings.
- Contrast: Action Blue on white is 5.6:1; Sky Link Blue on tile-1 is 5.4:1.
- Every reel embed gets a text alternative: creator, date, matched repo and caption summary.
