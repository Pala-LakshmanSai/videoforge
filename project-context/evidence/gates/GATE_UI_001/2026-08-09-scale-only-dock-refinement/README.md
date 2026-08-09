# GATE_UI_001 scale-only dock refinement

## Identity

- Gate: `GATE_UI_001` (post-closure user-directed refinement)
- Run: `2026-08-09-scale-only-dock-refinement`
- Implementation commit: `277e18f5c370d445ec9c69c7447ddcad3287629e`
- Mode: local fixture data, no provider calls, `$0` authorized spend
- Technical decision: `PASS`
- Presentation review: pending the user's review of the implemented refinement

## User direction

The user compared the VideoForge dock with macOS screenshots and explicitly superseded the prior
lift/shift/backing-expansion behavior. The dock must magnify by scale alone: the pointer target grows
most, immediate and second neighbors grow progressively less, far icons retain their resting scale,
and no icon gains a bottom gap. Follow-up feedback requested larger resting icons and a stronger peak.

## Implementation

- Desktop icon tiles rest at `48×44` CSS px and all dock glyphs are `30` px.
- A symmetric raised-cosine curve over `300` CSS px peaks at `1.75×`; its exact centered samples are
  `1.75×` at 0 px, `1.5625×` at 100 px, `1.1875×` at 200 px, and `1×` at 300 px or farther.
- Only `--dock-scale` is animated. The former lift, horizontal shift, backing-surface scale, and
  backing-surface translation channels are removed.
- Icon transforms use a fixed bottom-center origin. Link boxes, labels, dock padding, and the active
  route's `::before` backing stay untransformed.
- Magnification is disabled for widths at or below 680 px, coarse/touch pointers, and reduced motion.

## Verification

- `pnpm verify` passed formatting, TypeScript and Python linting, typechecking, all package/worker
  tests, contract synchronization, context validation, secret scanning, production build, all 26
  Chrome journeys, and dependency audit.
- `pnpm --filter @videoforge/web test` passed all 118 web/server/component tests.
- `pnpm --filter @videoforge/web typecheck` and `pnpm --filter @videoforge/web lint` passed.
- `pnpm --filter @videoforge/web test:chrome -- tests/e2e/shell.spec.ts` passed 20/20 desktop and
  compact Chrome journeys, including exact resting/peak sizes, fixed item boxes, fixed icon bottoms,
  static active backing, leave reset, and reduced-motion reset.
- In the user's real Chrome at `2544×1105`, Image Styles measured `84×77` CSS px at `1.75×` while
  its resting size was `48×44`. The observed immediate neighbors measured `1.4907×` and `1.5150×`,
  second neighbors measured `1.1053×` and `1.1437×`, and far icons measured exactly `1×`.
- Every measured icon bottom remained at `1034` CSS px and every item box remained fixed at
  `y=981..1074`. Removed custom properties were absent and the active backing transform was `none`.
- The live health endpoint reported fixture commit `277e18f`, synthetic data, provider calls
  unauthorized, and `$0` authorized spend.

## Decision

The implementation satisfies the new technical acceptance criteria without reopening the already
closed presentation gate. The revised visual result remains explicitly pending the user's review.
