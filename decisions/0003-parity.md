# 0003 -- the native-parity oracle: metric, tolerances, and the divergence table

Status: accepted (SF1, v1.1.0)
Supersedes: nothing
Related: [[0001-drive-model]] (SF0 drive train the oracle measures)

## Why this exists

The package's one-sentence promise is *the polyfill matches native*. Before
SF1 nothing ran the same storyboard through both runtimes and compared. SF1
builds that instrument: `test/browser/oracle.test.mjs` mounts each storyboard
twice in one real Chromium (native-forced CSS injection vs polyfill-forced JS
drive), scripted-scrolls the on-screen band, reads `getComputedStyle` on the
paired subjects, and diffs per property. This document is the record the oracle
cites -- the metric method, the committed tolerances and how they were pinned,
and every divergence the corpus is allowed to carry, each with a reason.

Parity is allowed exceptions -- but only out loud, here.

## The metric

`parityScore = { maxDev, rmsDev }` per property per storyboard, over every
scripted scroll sample:

- `opacity`    -- `|native - polyfill|`, absolute.
- `matrixPx`   -- `max |native - polyfill|` over the composed matrix entries
                  `e, f` (translation, in px).
- `matrixUnit` -- `max |native - polyfill|` over `a, b, c, d`
                  (rotate / scale / skew, unitless).
- `custom`     -- `|native - polyfill|` per registered `<number>` custom
                  property.

The composed matrix is read from `getComputedStyle(el).transform` after the
runtime has written its frame, so it captures the *actual* rendered composition
(individual `translate`/`rotate`/`scale` properties composing with any author
transform), not the storyboard's intent. `maxDev` is what gates; `rmsDev` is
reported alongside as the distribution shape.

## Committed tolerances (measured, then pinned)

| property class | tolerance | unit | basis |
| --- | --- | --- | --- |
| opacity | 0.02 | absolute | native/polyfill agree to <0.02 across the corpus; the slack absorbs sub-pixel scroll-step quantization between the two drive clocks |
| transformPx (`e,f`) | 1.0 | px | composed translation agrees within a device pixel at the 800x600 test viewport |
| matrixUnit (`a,b,c,d`) | 0.01 | unitless | rotate/scale agree to <0.01 after native's own matrix rounding |
| custom | 0.5 | absolute | registered `<number>` custom props agree exact-after-rounding; 0.5 covers integer-rounding at the CSSOM boundary |

The control storyboard uses `matrix: 0.02` (one extra rounding step for its
compound rotate + non-uniform scale). Tolerances are pinned from the measured
run, not guessed; they are ceilings, and every non-quarantined corpus item sits
well inside them (typically at 0.0000).

## The divergence table

Every item the oracle does not gate at full tolerance, with its reason and
status. A quarantined item carries the `known` flag in `storyboards.mjs`, which
*inverts* its assertion into a tripwire: the item MUST keep diverging. The day a
fix makes it match native, the oracle fails on purpose and forces the quarantine
to be lifted -- a known divergence can never silently become "fixed" and then
regress unnoticed.

### SF-03 (REOPENED) -- tall-subject entry/exit span -- OPEN polyfill bug

- **Items:** `entry-tall`, `exit-tall` (subject height 900px vs 600px viewport).
- **Measured:** `entry-tall` matrixPx maxDev ~= 20.53px; `exit-tall` ~= 77.28px
  (both far outside the 1.0px ceiling). opacity and matrixUnit also drift in
  step, as the whole frame is driven off the wrong progress value.
- **Mechanism:** for a subject TALLER than the scrollport the polyfill runs the
  entry/exit range across `span == elementHeight`, while the native engine uses
  `span == min(elementHeight, viewport)`. Progress therefore advances at the
  wrong rate through entry and exit, and the composed translate diverges by tens
  of px mid-range.
- **Lineage:** SF0's SF-03 task closed the *contain*-phase defect (tall subjects
  producing `rangeEnd < rangeStart` and clamping to 0). The entry/exit span
  defect lives in the same tall-subject geometry family but is distinct, and
  SF0's headless SF-03 fixtures did not catch it: those fixtures assert against
  hand-derived expected bounds, so they prove the polyfill matches *its own*
  arithmetic, not the native engine. The browser oracle -- comparing against the
  real reference implementation -- is the first thing that could surface it, and
  did, on its first run. This is the oracle earning its keep.
- **Status:** OPEN. NOT a deliberate exception. The fix is range-math in the SF0
  drive train (`_applyParsedRange` / the entry-exit span computation), out of
  scope for SF1 (which only builds the oracle). Reopen SF-03 as a near-term SF0
  follow-up (see ROADMAP). When fixed, drop the `known` flag on both items and
  let them gate at full tolerance.

## The control (oracle-has-teeth proof)

`control-transform-order` is mounted THREE times -- native, polyfill-individual,
polyfill-legacy -- with an author `skewX(18deg)` on the subject and a compound
`rotate 0->90 / scaleX 1->2 / scaleY 1->0.5` track:

- **individual leg** composes `translate . rotate . scale` with the author
  transform, exactly as native does -> measured maxDev **0.0000**, well inside
  the 0.02 matrix tolerance. PASSES.
- **legacy leg** (`style.transform` string, the pre-SF0 path) CLOBBERS the
  author transform -> measured maxDev **0.6097**, > 3x tolerance. FAILS on
  purpose.

If both legs passed, the oracle would be blind to real divergence; the control
asserts the legacy leg fails by a wide margin so a future regression that
silently reverts to the string path cannot pass unnoticed.

## Emitter conformance (the cheap half)

`test/browser/emitter.test.mjs` (headless, no browser) holds `toGsap` / `toRig`
output as committed snapshots under `test/browser/emitter-snapshots/` (4
storyboards x {gsap, rig}) plus a `new Function(...)` parse gate asserting every
generated module is syntactically valid. Output drift is a reviewed diff, not an
accident; syntactic breakage fails immediately.

**Out of scope, recorded:** a live-GSAP *execution* lane. Running the emitted
GSAP against the real GSAP runtime would prove behavioral conformance, but it
requires a third-party runtime dependency (even dev-only), which the zero-dep
posture declines. Snapshot + parse is the committed substitute; behavioral GSAP
conformance is a recorded non-goal.

## What promotion means

`test:browser` and `test:emitter` join the `verify` script. Publishing is
mechanically impossible while any non-quarantined corpus item exceeds its
ceiling, or while a quarantined item stops diverging without its flag being
lifted. The promise on the first line of the README is now a number in CI.
