# Changelog

All notable changes to `@zakkster/lite-scrollforge` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.3.0] -- 2026-09-13

The positioning release: a four-scene demo, recipes verified in CI against
published peers, a repositioned README, and one shipped fix -- `toRig` now
emits code that runs against the current `@zakkster/lite-scroll-rig-pro`.
Everything but the `toRig` fix and the README is repo-only (outside `files[]`).

### Fixed

- **`toRig` emits code that runs against `@zakkster/lite-scroll-rig-pro@1.3.2`.**
  The generated `attachScrollRig` now calls `engine.addRenderer(scroller)`,
  `engine.resize()` (seeds `VirtualScroll.maxScroll`, without which the loop
  clamps `targetY` to 0 and never advances), and `engine.start()`, and tears
  down via `engine.destroy()`. Previously it constructed the engine and scroller
  but wired neither into the run loop, and its teardown called `.dispose()` --
  not a method on 1.3.2, so a `typeof` guard made detach a silent no-op that
  also leaked the engine. The change is confined to the cold `toRig` string
  emitter; the runtime hot path is untouched and the torture GATE holds at the
  1.2.0 baseline (~159 B/op, major=2, ok). Emitter snapshots regenerated.

### Added

- **`demo/scrollforge.html`** (repo-only) -- a four-scene demo: 01 AUTHOR
  (storyboard editor + live scroll stage, native/polyfill toggle), 02 PARITY
  (both runtimes on mirrored elements, live per-property deviation, a legacy-
  transform control that visibly diverges), 03 COMPILE (live native CSS / GSAP
  / rig output), 04 ZERO-GC (auto-scroll with the per-frame write counter
  dropping to 0 at range ends, an allocating control).
- **Recipes** (repo-only, `recipes/` + `test/recipes.test.js`): `oklch-sunset`
  (OKLCH custom-property ramp via `@zakkster/lite-color-engine`), `signal-swap`
  (a `@zakkster/lite-signal` effect that detaches/reattaches on config change),
  and `rig-handoff` (`toRig` output executed against real rig@1.3.2 in headless
  Chromium -- self-drives and tears down). Each has a mutate-the-input break
  control.
- **`test/demo-guard.test.js`** (repo-only) -- binds the demo's committed write
  count and parity tolerances to the independently measured
  (`test/ceilings.test.js`) and oracle (`demo-scene02` corpus item) numbers, so
  the demo cannot drift from headless truth; asserts the scene-03 native/GSAP/
  rig emitters are non-empty.
- **README repositioning** -- a `#positioning` section (author-once /
  target-four forge framing) and a shared scroll-story section placing
  scrollforge (native-first authoring) and `@zakkster/lite-scroll-rig-pro`
  (virtual-scroll runtime) as the two answers, with `toRig` as the bridge.

## [1.2.0] -- 2026-09-13

The first hot-path change to `Scrollforge.js` since 1.0.1: a per-frame write
dirty-check, a detach that restores the pre-attach inline style, and fail-closed
attach and `resetKeyframeCounter`. Repo-only tooling and examples from the
`@zakkster/lite-scroll-rig-pro` playbook are included below.

### Changed

- **Dirty-check on the write half (SF-06).** `_applyTrackFrame` now compares
  each interpolated value against a per-property last-written cache
  (`_lastNum` / `_lastStr` / the transform scalars, all sentinel-initialized so
  the first frame after attach always writes -- null is not zero). An unchanged
  property is skipped WITHOUT building its string; a track clamped at a range
  endpoint writes nothing (0 writes, 0 B/op). This changes only WHEN writes
  fire, never the final computed style -- the native-parity oracle's
  maxDev/rmsDev are unchanged (byte-identical).
- **detach restores the pre-attach inline style.** attach snapshots each
  subject's touched inline properties once (cold); detach restores them and
  invalidates the caches, so a polyfill attach/detach cycle converges
  byte-equal with native's `<style>`-removal end state.
- **resetKeyframeCounter fails closed while a runtime is attached.** It now
  throws a named error instead of silently resetting the keyframe-name counter,
  which could collide generated `@keyframes` names on a later attach. A
  cold-path live-attachment counter tracks this at zero hot-path cost, and
  detach is idempotent. **BREAKING:** the call was previously an unconditional
  reset. See `decisions/0002-detach.md`.
- **attachStoryboardRuntime fails closed on an unresolved selector.** A
  selector matching no element now throws a named error (naming the selector
  and track index) instead of silently skipping the track. Every track is
  resolved before any observer/listener is installed, so an aborted attach
  leaves ZERO side effects. See `decisions/0002-detach.md`.
- **sequenceOnTimeline precise named errors.** Rejects a single track (needs
  `>= 2` to distribute), a non-numeric/`NaN`/out-of-`[0, 1)` `overlap`, and
  `endPct <= startPct`, each with a value-bearing message. **BREAKING:** a
  single-track call previously returned one full-range slot; it now throws.

### Fixed

- **Redundant per-frame DOM writes.** Tracks parked at a range endpoint or on
  an easing plateau previously re-emitted byte-identical strings every frame;
  they now allocate and write nothing until a value moves.

### Added

- **Dirty-check test lane.** `test/ceilings.test.js` and `test/torture.mjs`
  gain a lane proving repeated-identical frames write 0 (and allocate 0 B/call)
  while a varying control still writes every changed property (5 strings/frame
  x 1000). `sequenceOnTimeline` and fail-closed attach get node:test coverage.
- **`decisions/0002-detach.md`.** Records the dirty-check, the restore-prior
  detach policy, the author-mutated-inline-style owned-property limit, and the
  fail-closed-vs-warn-once rationale.

- **Recipe tier (`recipes/` + `test/recipes.test.js`).** Runnable
  ecosystem-wiring examples -- `gsap-export`, `rig-export`, `ease-curve`
  (FULL node runtime) and `react-hook.jsx` (SPELLING GATE ONLY) -- each tested
  at an honestly named level, with a `SCROLLFORGE_RECIPE_BREAK=1` control that
  forces a tier to fail (a tier that cannot fail is decorative).
- **Ceilings lane (`test/ceilings.test.js`, `npm run test:ceilings`).** The
  `_computeFrame` 0-byte and `_applyTrackFrame` write-budget ceilings as a
  first-class node:test that skips cleanly without `--expose-gc`, with an
  allocating failing control proving the gate can fail.
- **Harness symbol guard (`test/harness-guard.test.js`).** Pins the internal
  and public symbols, the lite-ease peers, and the stripped-source page globals
  the browser oracle relies on -- without Chromium, so a rename is caught by the
  publish-gating node suite rather than the skippable browser lane.
- **Shared fake-DOM fixtures (`test/fixtures.mjs`).** Factored plumbing for the
  headless node lanes.
- **Native-vs-polyfill demo (`demo/native-vs-polyfill.html`).** The oracle as an
  interactive page: one storyboard driven by native CSS scroll-timeline and by
  the polyfill side by side, with live emitted CSS/GSAP/rig and a live parity
  readout.
- Scripts: `test:ceilings` and `test:recipes`; `verify` now includes
  `test:ceilings`.

## [1.1.0] -- 2026-09-12

Native-parity verification. No runtime code changed -- `Scrollforge.js` is
byte-for-byte identical to 1.0.1, and the public API is unchanged. This release
adds the instrument that proves the package's core promise -- the polyfill
matches native -- as a gate that runs in CI, and records one open divergence it
surfaced.

### Added

- **Native-parity oracle (`test/browser/oracle.test.mjs`).** Mounts each
  storyboard twice in one real Chromium -- native-forced (CSS injection) vs
  polyfill-forced (JS drive) -- scripted-scrolls the band, reads
  `getComputedStyle` on the paired subjects, and diffs per property
  (`parityScore = { maxDev, rmsDev }` over opacity, composed-matrix translate
  in px, matrix unit entries, and registered `<number>` custom properties).
  Every corpus item must sit inside a measured-then-pinned tolerance. Playwright
  drives the browser as a dev-only dependency; the framework stays `node:test`
  and runtime dependencies stay zero.
- **Oracle control + fail-closed scorer.** A control storyboard is mounted
  native / polyfill-individual / polyfill-legacy: the individual leg must match
  native and the legacy leg must fail parity by a wide margin, so the oracle
  cannot be silently blind. The scorer fails closed on any non-finite deviation
  (a broken measurement scores Infinity, never a passing 0) and is unit-tested
  headless in `test/browser/scorer.test.mjs`, so the contract gates even without
  a browser.
- **Emitter conformance lane (`test/browser/emitter.test.mjs`).** `toGsap` and
  `toRig` output pinned as committed snapshots, plus a `new Function` parse gate
  on every generated module.
- **`decisions/0003-parity.md`.** The parity record: the metric, the committed
  tolerance table and how each bound was pinned, and the divergence table.
- **Verify lanes.** `npm run verify` now chains `test:emitter`, `test:scorer`,
  and `test:browser` after the node and torture gates; publishing is
  mechanically blocked while any corpus item exceeds its tolerance.

### Changed

- Dev tooling upgraded (dev-only, not shipped): `@zakkster/lite-leak`
  `^1.8.1 -> ^1.10.0` and `@zakkster/lite-gc-profiler` `^1.15.0 -> ^1.16.0`.
  The torture harness's fake `IntersectionObserver` is now a class so
  lite-leak 1.10.0's observer-orphan kernel finds `disconnect` on the
  prototype (it constructs via `Reflect.construct` and calls
  `OriginalCtor.prototype.disconnect`). Gate numbers are unchanged: leak
  size 0, 4096/4096 listeners balanced, pure compute 0 B/call, steady-state
  ~158 B/op.
- Parity oracle sampling made deterministic: it now settles each scroll
  position to stability (advancing frames until the scene stops changing)
  before reading, instead of a fixed two-rAF wait that could occasionally
  sample one leg a frame behind the other under load. Removes transient
  sampling skew only -- the committed tolerances and the recorded SF-03 /
  control divergences are unchanged.

### Known issues

- **Tall-subject entry/exit span (SF-03, reopened).** The oracle surfaced a
  residual of the 1.0.1 SF-03 fix: for a subject taller than the viewport the
  polyfill runs the entry/exit range across `span == elementHeight` while native
  uses `span == min(elementHeight, viewport)`, so the composed translate
  diverges by up to ~77px mid-range. Quarantined with an inverted tripwire (the
  divergence must persist until the fix lands, then the oracle forces the
  quarantine lifted) and documented in `decisions/0003-parity.md`. Fix tracked
  for a 1.0.x follow-up.

## [1.0.1] -- 2026-08-06

The view-timeline polyfill drive train rewritten so progress is a pure function
of scroll position -- never of IntersectionObserver callback timing, and never
of the animated element's own transform output. Compile paths (native CSS,
GSAP, rig) are unchanged.

### Fixed

- **Contain-phase freeze (SF-01).** The polyfill drove progress only from
  IntersectionObserver callbacks, which fire only when the intersection ratio
  crosses a threshold -- so progress stalled wherever the ratio was constant
  while scroll continued (a short element fully in view, a tall element
  covering the viewport: the middle of most `cover`-range storyboards).
  IntersectionObserver is now a visibility gate only (one-threshold
  hysteresis); a single scroll + `requestAnimationFrame` ticker computes
  progress for both the observer and no-observer paths, applying a frame on
  every scroll step through the entire contain phase.
- **Transform feedback (SF-02).** Progress was measured with
  `getBoundingClientRect`, which includes the track's own applied transform, so
  an animated `translate` bent the very progress driving it. Progress is now
  read from the element's `offsetTop` layout chain (transform-excluded).
  Elements inside a scrollable ancestor are reconciled to the scroller's own
  coordinate origin, fixing a silent clamp-to-0 on `position: static`
  `overflow` scrollers (the common scroll-container shape).
- **Tall subjects (SF-03).** When an element was taller than the scrollport the
  `contain` range produced `rangeEnd < rangeStart` and progress pinned at 0.
  Range endpoints now swap per the spec's tall-subject definition; the exact
  `element height == viewport height` degenerate case resolves to a boundary
  step, not stuck-at-zero. Covered by fixtures at 0.5x / 1x / 2x / 5x viewport.

### Changed

- **Individual transform properties (SF-04).** The polyfill now writes
  `style.translate` / `style.rotate` / `style.scale` (composition order
  translate -> rotate -> scale) -- the same individual properties the native
  path animates -- leaving author transforms untouched. The single
  `style.transform` string is retained only as a fallback behind a Transforms
  Level 2 feature check.
- Off-screen tracks are parked: zero `requestAnimationFrame` wake-ups while not
  visible (gated at 0 ticks / 0 bytes-per-op).

### Added

- `test/torture.mjs` gate (lite-gc-profiler + lite-leak): per-frame write
  ceiling (<= 1 string per changed non-transform property, <= 3 transform
  strings), the pure interpolation path proven at 0 bytes/call, parked ticker
  at 0 ticks / 0 bytes, and attach/detach x4096 with observer-orphan and
  scroll-listener balance (net 0). Steady-state `_applyTrackFrame` measures
  ~157 bytes/op -- one DOM-boundary string per changed property per frame, the
  honest number, itemized in `decisions/0001-drive-model.md`.
- `decisions/0001-drive-model.md`: the IntersectionObserver-as-gate drive
  model, hysteresis, single-ticker path, the offsetTop ancestor-transform
  limit, and the allocation-gate semantics.
- devDependencies (dev-only, not shipped): `@zakkster/lite-gc-profiler
  ^1.15.0`, `@zakkster/lite-leak ^1.8.1`.

## [1.0.0] -- 2026-07

Initial public release.

### Added -- Core CSS emission

- `trackToCss(track)` -- compile a single track config into a `@keyframes`
  rule and a selector rule. Deterministic keyframe names (byte-stable
  across identical inputs).
- `storyboardToCss(storyboard, opts?)` -- full-storyboard compiler with
  named timelines, prettyPrint option, per-timeline `view-timeline-name` /
  `scroll-timeline-name` declarations.
- `attachStoryboard(storyboard, root?)` -- browser-side helper that injects
  the compiled CSS via a `<style>` element and returns a `{ detach }` handle.
- `resetKeyframeCounter()` -- reset the internal counter for byte-stable
  golden-file tests.
- `HAS_NATIVE_SUPPORT` -- feature-detection constant. Uses
  `CSS.supports('animation-timeline: view()')`.

### Added -- Easing presets + CSS Level 4 `linear()` emission

- `CSS_EASINGS` -- frozen table of 29 timing-function presets: 5 CSS keywords
  (linear / ease / ease-in / ease-out / ease-in-out) plus 8 Penner families
  (Sine / Quad / Cubic / Quart / Quint / Expo / Circ / Back) x 3 variants
  (in / out / inOut).
- `cubicBezierCss(x1, y1, x2, y2)` -- build a CSS `cubic-bezier(...)` string.
  Renamed from `cubicBezier` to avoid name collision with
  `@zakkster/lite-cubic-bezier`'s runtime API.
- `linearPoints(easingFn, samples?)` -- emit a CSS Level 4 `linear(...)`
  string by sampling any `(t) => number` function at N+1 points.
  Represents analytic curves (Bounce, Elastic) that cubic-bezier can't fit.
- `easingToCssTimingFunction(input, samples?)` -- smart mapper: routes preset
  names, raw CSS strings, and function easings to the correct output form.

### Added -- Sequencing

- `sequenceOnTimeline(tracks, opts?)` -- distribute N tracks evenly along a
  shared timeline. Supports `overlap` for cross-fades, custom `startPct` /
  `endPct` bounds, and optional `rangeName` prefix. Non-mutating.

### Added -- Export targets

- `toGsap(storyboard, opts?)` -- emit runnable GSAP ScrollTrigger + Timeline
  JavaScript. Property renames (`translateX -> x`, `rotate -> rotation`);
  27-entry easing map to GSAP built-ins (`sine.in`, `power2.out`,
  `back.inOut`, etc.); raw `cubic-bezier(...)` and function easings marked
  as requiring `CustomEase`. Range mapping: entry/exit exact, cover exact,
  contain approximated with a warning comment. ESM / CJS module format.
- `toRig(storyboard, opts?)` -- emit runnable
  `@zakkster/lite-scroll-rig-pro` + `@zakkster/lite-keyframe` code. Rig
  supports 4 property slots per element (translateX / translateY / scale /
  rotate); unsupported properties dropped with a per-track comment.
  scroll-timeline tracks skipped entirely. Range mapping to rig's
  `t in [0, 1]`: cover exact; entry/exit approximated at 0.5-split.

### Added -- Fallback runtime

- `attachStoryboardRuntime(storyboard, opts?)` -- universal attach with
  auto-detection. On the native path, delegates to `attachStoryboard`.
  On the polyfill path: `IntersectionObserver` with a 257-slot threshold
  array (pre-allocated once, module-scope, shared across attachments) for
  view timelines; passive scroll + rAF for scroll timelines. Inline
  cubic-bezier evaluator (Newton-Raphson + bisection fallback) and
  `linear(...)` parser (piecewise, binary-search stop lookup).

### Zero-GC discipline (polyfill hot path)

The observer callback is provably free of `String()` coercion, `.exec()`,
`.test()`, `new RegExp`, and object-literal returns.

- Range endpoints (`'entry 25%'`, etc.) parsed once at attach into a
  `{ kind, pct }` struct with integer kind codes (`_RK_ENTRY = 3`, etc.);
  hot path is a fast integer switch -- no regex per frame.
- Per-property keyframe values stored as parallel `Float64Array` +
  `string[]` arrays; hot loop is a dense indexed `for` loop, not `for..in`.
- `_computeRangeBoundsInto(...)` writes directly into `state.rangeStart` /
  `state.rangeEnd` (mutable fields) -- no `{ start, end }` object per frame.
- Transform components aggregated into a persistent `_scratch` object;
  flushed as a single `style.transform` string write per element per
  frame (the only unavoidable allocation on the polyfill path).

### Deprecated

- `EASINGS` -- renamed to `CSS_EASINGS`. Alias kept for backward compatibility.
- `cubicBezier` -- renamed to `cubicBezierCss` to avoid name collision with
  `@zakkster/lite-cubic-bezier`'s runtime API. Alias kept.

### Documentation

- `README.md` -- feature overview, install, quickstart, full API reference,
  ecosystem-composition guide.
- `Scrollforge.d.ts` -- TypeScript declarations, set-identical to `.js` exports.
- `llms.txt` -- machine-readable package summary.
- `LICENSE.txt` -- MIT (c) Zahary Shinikchiev <shinikchiev@yahoo.com>.

### Tests

- 115 tests, `node:test` only. Both `npm test` and `npm run test:gc`
  (`--expose-gc`) pass with zero failures.
- Coverage: 88.5% lines, 80.7% branches, 93.9% functions. The uncovered
  code paths are deep browser-only fallbacks (double-fallback for
  environments without `IntersectionObserver`) that would require a full
  browser environment to exercise.

### Ecosystem

Optional peers (composition, not requirements):

- `@zakkster/lite-ease` -- 30 Penner easing functions. Pass its functions
  directly to any easing-accepting API; Scrollforge stays zero-dep.
- `@zakkster/lite-cubic-bezier` -- zero-GC bezier runtime. Scrollforge
  ships an inline evaluator to keep the zero-dep promise; use lite-cubic-bezier
  when you need shared curve state across contexts.
- `@zakkster/lite-scroll-rig-pro` -- target of `toRig()`; runs the emitted code.
- `@zakkster/lite-signal` -- reactive layer for building Scrollforge-driven
  UIs (used throughout the demo).

[1.0.0]: https://github.com/PeshoVurtoleta/lite-scrollforge/releases/tag/v1.0.0
