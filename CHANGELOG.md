# Changelog

All notable changes to `@zakkster/lite-scrollforge` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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

## [1.0.0] — 2026-07

Initial public release.

### Added — Core CSS emission

- `trackToCss(track)` — compile a single track config into a `@keyframes`
  rule and a selector rule. Deterministic keyframe names (byte-stable
  across identical inputs).
- `storyboardToCss(storyboard, opts?)` — full-storyboard compiler with
  named timelines, prettyPrint option, per-timeline `view-timeline-name` /
  `scroll-timeline-name` declarations.
- `attachStoryboard(storyboard, root?)` — browser-side helper that injects
  the compiled CSS via a `<style>` element and returns a `{ detach }` handle.
- `resetKeyframeCounter()` — reset the internal counter for byte-stable
  golden-file tests.
- `HAS_NATIVE_SUPPORT` — feature-detection constant. Uses
  `CSS.supports('animation-timeline: view()')`.

### Added — Easing presets + CSS Level 4 `linear()` emission

- `CSS_EASINGS` — frozen table of 29 timing-function presets: 5 CSS keywords
  (linear / ease / ease-in / ease-out / ease-in-out) plus 8 Penner families
  (Sine / Quad / Cubic / Quart / Quint / Expo / Circ / Back) × 3 variants
  (in / out / inOut).
- `cubicBezierCss(x1, y1, x2, y2)` — build a CSS `cubic-bezier(...)` string.
  Renamed from `cubicBezier` to avoid name collision with
  `@zakkster/lite-cubic-bezier`'s runtime API.
- `linearPoints(easingFn, samples?)` — emit a CSS Level 4 `linear(...)`
  string by sampling any `(t) => number` function at N+1 points.
  Represents analytic curves (Bounce, Elastic) that cubic-bezier can't fit.
- `easingToCssTimingFunction(input, samples?)` — smart mapper: routes preset
  names, raw CSS strings, and function easings to the correct output form.

### Added — Sequencing

- `sequenceOnTimeline(tracks, opts?)` — distribute N tracks evenly along a
  shared timeline. Supports `overlap` for cross-fades, custom `startPct` /
  `endPct` bounds, and optional `rangeName` prefix. Non-mutating.

### Added — Export targets

- `toGsap(storyboard, opts?)` — emit runnable GSAP ScrollTrigger + Timeline
  JavaScript. Property renames (`translateX → x`, `rotate → rotation`);
  27-entry easing map to GSAP built-ins (`sine.in`, `power2.out`,
  `back.inOut`, etc.); raw `cubic-bezier(...)` and function easings marked
  as requiring `CustomEase`. Range mapping: entry/exit exact, cover exact,
  contain approximated with a warning comment. ESM / CJS module format.
- `toRig(storyboard, opts?)` — emit runnable
  `@zakkster/lite-scroll-rig-pro` + `@zakkster/lite-keyframe` code. Rig
  supports 4 property slots per element (translateX / translateY / scale /
  rotate); unsupported properties dropped with a per-track comment.
  scroll-timeline tracks skipped entirely. Range mapping to rig's
  `t ∈ [0, 1]`: cover exact; entry/exit approximated at 0.5-split.

### Added — Fallback runtime

- `attachStoryboardRuntime(storyboard, opts?)` — universal attach with
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
  hot path is a fast integer switch — no regex per frame.
- Per-property keyframe values stored as parallel `Float64Array` +
  `string[]` arrays; hot loop is a dense indexed `for` loop, not `for..in`.
- `_computeRangeBoundsInto(...)` writes directly into `state.rangeStart` /
  `state.rangeEnd` (mutable fields) — no `{ start, end }` object per frame.
- Transform components aggregated into a persistent `_scratch` object;
  flushed as a single `style.transform` string write per element per
  frame (the only unavoidable allocation on the polyfill path).

### Deprecated

- `EASINGS` — renamed to `CSS_EASINGS`. Alias kept for backward compatibility.
- `cubicBezier` — renamed to `cubicBezierCss` to avoid name collision with
  `@zakkster/lite-cubic-bezier`'s runtime API. Alias kept.

### Documentation

- `README.md` — feature overview, install, quickstart, full API reference,
  ecosystem-composition guide.
- `Scrollforge.d.ts` — TypeScript declarations, set-identical to `.js` exports.
- `llms.txt` — machine-readable package summary.
- `LICENSE.txt` — MIT © Zahary Shinikchiev <shinikchiev@yahoo.com>.

### Tests

- 115 tests, `node:test` only. Both `npm test` and `npm run test:gc`
  (`--expose-gc`) pass with zero failures.
- Coverage: 88.5% lines, 80.7% branches, 93.9% functions. The uncovered
  code paths are deep browser-only fallbacks (double-fallback for
  environments without `IntersectionObserver`) that would require a full
  browser environment to exercise.

### Ecosystem

Optional peers (composition, not requirements):

- `@zakkster/lite-ease` — 30 Penner easing functions. Pass its functions
  directly to any easing-accepting API; Scrollforge stays zero-dep.
- `@zakkster/lite-cubic-bezier` — zero-GC bezier runtime. Scrollforge
  ships an inline evaluator to keep the zero-dep promise; use lite-cubic-bezier
  when you need shared curve state across contexts.
- `@zakkster/lite-scroll-rig-pro` — target of `toRig()`; runs the emitted code.
- `@zakkster/lite-signal` — reactive layer for building Scrollforge-driven
  UIs (used throughout the demo).

[1.0.0]: https://github.com/PeshoVurtoleta/lite-scrollforge/releases/tag/v1.0.0
