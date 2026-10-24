---
name: motion-system
description: How RepoReel moves. Read before adding or changing any animation, transition or landing-page effect in this repo.
---

# RepoReel motion system

Motion here has a job: show what the product does, or confirm what the user just did. Decoration that
moves on its own is the exception, and there is exactly one of it per page.

## The signature moment
The phone on the home page (web/src/components/Phone.tsx): the reel in view and the next one load Instagram's official embed on their own, the feed advances every 9 s while idle, and a reel the visitor taps into (the embed takes focus) holds the feed. Instagram's embed cannot be autoplayed, muted or asked when a video ends; never re-host videos to get around that.

Keep it a pure function of elapsed time (derive every state from `t`), pause it when off-screen
(IntersectionObserver), and show its most telling frame, static, under `prefers-reduced-motion`.

## Where motion lives
- Home: the phone (signature). The empty question box types example questions as its placeholder (pauses on focus or text). Result cards enter with a short spring stagger.
- Elsewhere: Snap's OCR progress, the Trending filters, sheet open/close (spring, interruptible), button press feedback (scale 0.97).

## Tokens
Instagram identity in web/src/styles.css: black canvas, #262626 hairlines, the IG gradient (--ig, --ig-text) reserved for CTAs, active states and one headline phrase; Inter + JetBrains Mono. The design source is the Stitch 'RepoReel Instagram Identity' suite.

## Rules
- Animate `transform` and `opacity` only (`clip-path` and SVG `stroke-dashoffset` are fine). Never `width`, `height`, `top`, `left` or `transition: all`.
- Curves: entering/exiting `cubic-bezier(0.23, 1, 0.32, 1)`; moving on screen `cubic-bezier(0.77, 0, 0.175, 1)`; colour/hover `ease`; constant motion `linear`. Never `ease-in` on UI.
- Durations: press 100-160 ms, popovers 150-250 ms, panels 200-400 ms. Explanatory landing motion may be longer.
- Enter from `scale(0.95-0.97)` + `opacity: 0`, never `scale(0)`. Exit the way you entered.
- Hover motion only inside `@media (hover: hover) and (pointer: fine)`. Buttons get press feedback (`scale(0.97)` on `:active`).
- No fade-and-slide-up on every section and no hover lift on every card: that is the generic look this project avoids.
- Anything a user can trigger repeatedly uses transitions (they retarget), not keyframes (they restart).
- Every animation ships with its `prefers-reduced-motion` variant: fewer and gentler, opacity instead of movement.
- Check the result in a browser: watch it at 2-5x slower, and on a phone width.
