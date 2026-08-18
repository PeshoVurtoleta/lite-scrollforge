# @zakkster/lite-scrollforge

[![npm version](https://img.shields.io/npm/v/@zakkster/lite-scrollforge.svg?style=for-the-badge&color=latest)](https://www.npmjs.com/package/@zakkster/lite-scrollforge)
![Zero-GC](https://img.shields.io/badge/Zero--GC-Hot%20path-00C853?style=for-the-badge&logo=leaf&logoColor=white)
[![sponsor](https://img.shields.io/badge/sponsor-PeshoVurtoleta-ea4aaa.svg?logo=github)](https://github.com/sponsors/PeshoVurtoleta)
[![npm bundle size](https://img.shields.io/bundlephobia/minzip/@zakkster/lite-scrollforge?style=for-the-badge)](https://bundlephobia.com/result?p=@zakkster/lite-scrollforge)
[![npm downloads](https://img.shields.io/npm/dm/@zakkster/lite-scrollforge?style=for-the-badge&color=blue)](https://www.npmjs.com/package/@zakkster/lite-scrollforge)
[![npm total downloads](https://img.shields.io/npm/dt/@zakkster/lite-scrollforge?style=for-the-badge&color=blue)](https://www.npmjs.com/package/@zakkster/lite-scrollforge)
![TypeScript](https://img.shields.io/badge/TypeScript-Types-informational)
![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

**Zero-GC | zero-dependency | single-file ESM.**

A CSS Scroll-Driven Animation authoring layer. Author animations as a
config object; compile to native CSS, GSAP, or `@zakkster/lite-scroll-rig-pro`;
drop in the polyfill runtime for browsers without native support.

- **~2000 LOC, one file, ASCII source.** No transpile step, no bundler
  required, no runtime dependencies.
- **15 exports.** Covers CSS emission, easing math, sequencing, three export
  targets, and a universal attach entry point.
- **Zero-GC hot path.** Compositor-driven on native browsers; pre-allocated
  `Float64Array` LUTs, integer switch dispatch on parsed range endpoints,
  and one style-write per element per frame on the polyfill.
- **134-test core suite, `node:test` only.** `npm test` and `npm run test:gc`
  (`--expose-gc`) pass; on top, a real-Chromium native-parity oracle plus
  headless scorer and emitter lanes gate every publish (`npm run verify`).

```bash
npm i @zakkster/lite-scrollforge
```

## Quickstart

```js
import { attachStoryboardRuntime } from '@zakkster/lite-scrollforge';

attachStoryboardRuntime({
    tracks: [{
        selector: '.hero-title',
        timeline: { kind: 'view' },
        range:    { start: 'entry 0%', end: 'entry 100%' },
        keyframes: [
            { opacity: 0, translateY: 30 },
            { opacity: 1, translateY: 0 }
        ],
        easing: 'easeOutCubic'
    }]
});
```

That's the whole minimal example. `attachStoryboardRuntime` auto-detects
native scroll-driven support (via `HAS_NATIVE_SUPPORT`) and either injects
pure CSS (zero JS in the animation loop) or installs the polyfill runtime
transparently. Detach with the returned handle:

```js
const handle = attachStoryboardRuntime(sb);
// ... later
handle.detach();
```

## Table of contents

- [Concepts](#concepts)
- [The storyboard shape](#the-storyboard-shape)
- [Emitting CSS](#emitting-css)
- [Attaching](#attaching)
- [Easings](#easings)
- [Sequencing many tracks](#sequencing-many-tracks)
- [Export targets](#export-targets)
- [Ecosystem composition](#ecosystem-composition)
- [Zero-GC discipline](#zero-gc-discipline)
- [Browser support](#browser-support)
- [API reference](#api-reference)
- [License](#license)

## Concepts

CSS Scroll-Driven Animations tie the progress of a CSS animation to scroll
position instead of wall-clock time. There are two flavors:

- **View timeline** -- progress driven by an element's position in the
  viewport. Ranges: `entry`, `contain`, `exit`, `cover`.
- **Scroll timeline** -- progress driven by a scroll container's scroll
  position. Ranges: bare percentages.

Native support is baseline-ish (Chrome 115+, Edge 115+, Opera 101+).
Firefox has it behind a flag. Safari is in progress. Scrollforge lets you
author once and target all four (native CSS + polyfill + GSAP + rig).

## The storyboard shape

```js
const storyboard = {
    // Optional: named timelines declared on ancestors, reused across tracks
    timelines: {
        '--gallery': {
            attachedSelector: '.gallery',
            kind: 'view',
            axis: 'block'
        }
    },
    // One entry per animated element
    tracks: [{
        selector: '.gallery .card-1',
        timeline: { name: '--gallery' },      // references the named timeline
        range:    { start: '0%', end: '33.33%' },
        keyframes: [
            { opacity: 0, translateY: 20 },
            { opacity: 1, translateY: 0 }
        ],
        easing: 'easeOutCubic'
    }, /* card-2, card-3, ... */]
};
```

Every track needs: `selector`, `keyframes` (at least 2), and optionally
`timeline` / `range` / `easing` / `fill`.

Keyframes accept: `opacity`, transform components (`translateX/Y/Z`, `scale`,
`scaleX/Y`, `rotate`), any CSS property, and CSS custom properties (`--foo`).

## Emitting CSS

`storyboardToCss(sb)` returns a string:

```js
import { storyboardToCss } from '@zakkster/lite-scrollforge';

const css = storyboardToCss({
    tracks: [{
        selector: '.card',
        timeline: { kind: 'view' },
        keyframes: [{ opacity: 0 }, { opacity: 1 }]
    }]
});
// @keyframes _sf_kf_1 { 0% { opacity: 0; } 100% { opacity: 1; } }
// .card { animation-name: _sf_kf_1; ... }
```

Inject it yourself, or use `attachStoryboard` to inject via a `<style>` element:

```js
import { attachStoryboard } from '@zakkster/lite-scrollforge';
const handle = attachStoryboard(storyboard);
// -> { detach(), styleElement }
```

`attachStoryboard` is the **native-only** path -- zero JS in the animation
loop, the compositor handles everything. Use `attachStoryboardRuntime` when
you want the polyfill fallback.

## Attaching

```js
import { attachStoryboardRuntime, HAS_NATIVE_SUPPORT } from '@zakkster/lite-scrollforge';

const handle = attachStoryboardRuntime(sb);            // auto
const handle = attachStoryboardRuntime(sb, { runtime: 'polyfill' });  // force
const handle = attachStoryboardRuntime(sb, { runtime: 'native' });    // force

if (!HAS_NATIVE_SUPPORT) console.warn('polyfill active');
```

The polyfill path uses `IntersectionObserver` for view timelines and passive
scroll listeners for scroll timelines. Both are coalesced through `rAF`.
Range endpoints are pre-parsed at attach time into an integer-kind struct;
the frame loop is a switch on the kind, no regex or string allocations.

## Easings

Three ways to specify an easing on a track:

**Preset name from `CSS_EASINGS`** (5 CSS keywords + 24 Penner presets):

```js
{ easing: 'easeOutCubic' }
{ easing: 'easeInOutBack' }
{ easing: 'ease-in-out' }
```

**Raw CSS string** (passed through):

```js
{ easing: 'cubic-bezier(0.5, 0, 0.5, 1)' }
{ easing: 'linear(0, 0.5, 1)' }
```

**A function `(t) => number`** -- including analytic easings from
`@zakkster/lite-ease` that can't be represented as a single cubic-bezier:

```js
import { easeOutBounce } from '@zakkster/lite-ease';
{ easing: easeOutBounce }
// -> emits `animation-timing-function: linear(0, 0.019, ...)` via linearPoints
```

### Sampling utilities

```js
import { linearPoints, easingToCssTimingFunction, cubicBezierCss } from '@zakkster/lite-scrollforge';
import { easeInOutElastic } from '@zakkster/lite-ease';

linearPoints(easeInOutElastic, 32);
// 'linear(0, 0.001, -0.002, ..., 1)'

easingToCssTimingFunction('easeOutBack');
// 'cubic-bezier(0.34, 1.56, 0.64, 1)'

easingToCssTimingFunction(easeInOutElastic);
// 'linear(0, 0.001, ..., 1)'

cubicBezierCss(0.5, 0, 0.5, 1);
// 'cubic-bezier(0.5, 0, 0.5, 1)'
```

## Sequencing many tracks

The common "N cards fade in as you scroll through a section" pattern:

```js
import { sequenceOnTimeline, storyboardToCss } from '@zakkster/lite-scrollforge';

const tracks = sequenceOnTimeline([
    { selector: '.gallery .card-1', timeline: { name: '--gallery' },
      keyframes: [{ opacity: 0 }, { opacity: 1 }], easing: 'easeOutCubic' },
    { selector: '.gallery .card-2', timeline: { name: '--gallery' },
      keyframes: [{ opacity: 0 }, { opacity: 1 }], easing: 'easeOutCubic' },
    { selector: '.gallery .card-3', timeline: { name: '--gallery' },
      keyframes: [{ opacity: 0 }, { opacity: 1 }], easing: 'easeOutCubic' }
], { overlap: 0.15 });   // 15% cross-fade

const css = storyboardToCss({
    timelines: {
        '--gallery': { attachedSelector: '.gallery', kind: 'view', axis: 'block' }
    },
    tracks
});
```

Options: `overlap` (0..1, default 0), `startPct` / `endPct` bounds,
`rangeName` prefix (`entry`, `contain`, `exit`, `cover`).

## Export targets

Both target-emitters return a string of runnable JavaScript. Ship it as a
`.js` file, or paste into your project.

### GSAP + ScrollTrigger

```js
import { toGsap } from '@zakkster/lite-scrollforge';
console.log(toGsap(storyboard));
```

```js
// generated
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
gsap.registerPlugin(ScrollTrigger);

export function attachScrollAnimations() {
    const animations = [];
    // Track 0: .card
    animations.push(gsap.fromTo(".card",
        { opacity: 0, y: 30 },
        {
            opacity: 1,
            y: 0,
            ease: "power2.out",
            scrollTrigger: {
                trigger: ".card",
                start: "0% bottom",
                end: "80% bottom",
                scrub: true
            }
        }));
    return function detach() { /* ... */ };
}
```

Property renames applied (`translateX -> x`, `rotate -> rotation`), 27-entry
easing map to GSAP built-ins. Raw `cubic-bezier(...)` and function easings
emit with a `/* needs CustomEase */` marker.

### lite-scroll-rig-pro

```js
import { toRig } from '@zakkster/lite-scrollforge';
console.log(toRig(storyboard));
```

Rig supports 4 property slots per element (translateX / translateY / scale /
rotate). Other props emit as a "dropped" comment. Range endpoints pre-scale
into the rig's `t in [0, 1]` axis (cover exact; entry/exit approximated at
0.5-split with a warning).

## Ecosystem composition

Scrollforge is one piece of the `@zakkster/*` ecosystem. Composition
happens through userland -- Scrollforge itself ships with zero runtime
dependencies.

- **`@zakkster/lite-ease`** -- 30 Penner easing functions. Robert Penner
  himself starred it. Pass its functions directly to any easing-accepting
  Scrollforge API; analytic curves (Bounce, Elastic) that cubic-bezier
  can't represent get emitted as CSS `linear(...)` automatically.
- **`@zakkster/lite-cubic-bezier`** -- zero-GC bezier runtime with a DoD
  coefficient compiler. Scrollforge ships an inline evaluator to preserve
  its zero-dep promise; use lite-cubic-bezier when you need shared curve
  state across multiple contexts.
- **`@zakkster/lite-scroll-rig-pro`** -- target of `toRig()`.
- **`@zakkster/lite-signal`** -- reactive primitives. Wire Scrollforge into
  a reactive UI: signals drive the storyboard config, effects detach +
  reattach on config changes.
- **`@zakkster/lite-color-engine`** -- pair with `--custom-properties` in
  keyframes to animate OKLCH color space parameters, downstream CSS uses
  `color: oklch(var(--l) var(--c) var(--h))`.

Example -- animating a color via a custom property, with lite-color-engine
consuming it downstream:

```js
attachStoryboardRuntime({
    tracks: [{
        selector: '.sunset',
        timeline: { kind: 'view' },
        keyframes: [
            { '--l': 0.35, '--c': 0.08, '--h': 20  },
            { '--l': 0.85, '--c': 0.20, '--h': 240 }
        ],
        easing: 'linear'
    }]
});
```

```css
.sunset {
    color: oklch(var(--l) var(--c) var(--h));
}
```

## Zero-GC discipline

The claim: zero allocations in the animation frame loop, on both the
native path (compositor thread) and the polyfill path (JS-driven).

**Native path.** Pure CSS injection. The compositor handles everything.
No JS runs during scroll.

**Polyfill path.** Every allocation-risk was audited and eliminated:

- **Range endpoints parsed once at attach.** `'entry 25%'` -> `{ kind: 3, pct: 0.25 }`.
  Hot-path resolution is an integer switch, not a string compare or regex.
- **Parallel arrays instead of `for..in`.** Keyframe values stored as parallel
  `Float64Array` + `string[]` arrays. Hot loop is a dense indexed `for` --
  V8 keeps it monomorphic.
- **`_computeRangeBoundsInto()` writes into state.** Mutates
  `state.rangeStart` / `state.rangeEnd` directly rather than returning a
  fresh `{ start, end }` object each observer tick.
- **Transform scratch object.** Transform components (translateX, scale,
  rotate) aggregate into a persistent `_scratch` struct at module scope;
  flushed as a single `style.transform` string write per element per frame.
- **`_IO_THRESHOLDS`.** 257-slot `IntersectionObserver` threshold array
  pre-allocated once at module load, shared across every polyfilled track.

The single unavoidable per-frame allocation is the `element.style.transform`
string when any transform component changes -- a DOM boundary that requires
a string. This is the theoretical minimum for JS-driven CSS animation.

## Browser support

**Native path** (via `HAS_NATIVE_SUPPORT`):

| Browser | Support |
|--------|-----|
| Chrome  | 115+ |
| Edge    | 115+ |
| Opera   | 101+ |
| Firefox | Behind flag |
| Safari  | In progress |

**Polyfill path** -- anywhere `IntersectionObserver` is available (all
evergreen browsers, IE11 with polyfill). Also transparently falls back to
passive-scroll + `getBoundingClientRect()` if `IntersectionObserver` is
missing.

## API reference

Full TypeScript declarations live in `Scrollforge.d.ts`. Summary:

| Export | Signature |
|---|---|
| `trackToCss` | `(track: Track) => { keyframesName, keyframesCss, ruleCss }` |
| `storyboardToCss` | `(sb: Storyboard, opts?) => string` |
| `attachStoryboard` | `(sb, root?) => { detach, styleElement }` |
| `resetKeyframeCounter` | `() => void` |
| `HAS_NATIVE_SUPPORT` | `boolean` |
| `CSS_EASINGS` | `Readonly<Record<string, string>>` |
| `EASINGS` | *(deprecated alias)* |
| `cubicBezierCss` | `(x1, y1, x2, y2) => string` |
| `cubicBezier` | *(deprecated alias)* |
| `linearPoints` | `(fn, samples?) => string` |
| `easingToCssTimingFunction` | `(input, samples?) => string` |
| `sequenceOnTimeline` | `(tracks, opts?) => Track[]` |
| `toGsap` | `(sb, opts?) => string` |
| `toRig` | `(sb, opts?) => string` |
| `attachStoryboardRuntime` | `(sb, opts?) => { detach }` |

## Testing

`node:test` only -- no test-framework dependency. Beyond the core suite, a
native-parity oracle mounts every storyboard in real Chromium and diffs the
polyfill against the native engine per property; its scorer fails closed and is
unit-tested headless. Method, tolerances, and the divergence table live in
[`decisions/0003-parity.md`](decisions/0003-parity.md).

```bash
npm test               # 134 tests, node:test only
npm run test:gc        # same suite with --expose-gc (zero-GC gate)
npm run test:torture   # lite-gc-profiler + lite-leak allocation/retention gate
npm run test:emitter   # toGsap/toRig snapshots + parse gate (2 tests)
npm run test:scorer    # oracle scorer fail-closed contract, headless (15 tests)
npm run test:browser   # native-parity oracle in real Chromium (needs Playwright)
npm run verify         # every lane in sequence -- the publish gate
npm run test:coverage  # node's built-in coverage
```

## License

MIT (c) [Zahary Shinikchiev](mailto:shinikchiev@yahoo.com)
