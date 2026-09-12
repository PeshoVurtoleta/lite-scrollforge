# `@zakkster/lite-scrollforge` — roadmap

Four sessions plus a deferred block. Written against published **v1.0.0** —
static source audit of the full 1823-line single file (easing/CSS emission
layers structurally mapped; the polyfill runtime, range math, serializer,
and attach/detach paths read line-by-line), plus package.json (zero deps,
node:test + test:gc + coverage, **no gc-profiler/leak devDeps**).

**Is it worth it? Yes — and strategically it may be the best-placed scroll
package in the portfolio.** Where lite-scroll-rig-pro fights the native CSS
Scroll-Driven Animations wave, scrollforge *rides* it: author once, emit
native CSS where supported, polyfill where not, export to GSAP (a genuinely
clever adoption hook — GSAP users get value before ever running your code)
or hand off to the rig. The authoring/compile shape is forge-DNA — the same
config-in, artifact-out pattern as hueforge and patternforge, applied to
motion. The lite-ease `linear()` emission (analytic Bounce/Elastic curves
that cubic-bezier cannot express, compiled to native CSS) is a real
differentiator nobody else in this niche ships.

But the package's entire promise is one sentence — *the polyfill matches
native* — and the audit found that promise broken in the most common case:
the polyfill freezes wherever intersection ratio stops changing while
progress doesn't, which is the middle of essentially every animation. The
roadmap fixes the progress engine first, then builds the native-parity
oracle that makes the promise checkable forever, then makes the zero-GC
claim honest, then ships the forge-style evaluation kit.

What deserves credit before the findings: parse-once integer-kind range
structs with switch dispatch, parallel Float64Array keyframe storage with
the for..in-deopt rationale written down, the shared 257-slot IO threshold
table, `_computeRangeBoundsInto` writing into state instead of returning
objects, nested-scroller detection matching `view()` semantics with
rootBounds handling, and a native emitter that outputs Transforms Level 2
individual properties. The bones are good; the drive train has two real
defects.

---

## 1. State, verified (static)

| | |
| --- | --- |
| Published | 1.0.0, single file, zero deps, 15 exports, 115 tests (node:test), test:gc lane exists |
| devDeps | none — no gc-profiler, no leak, no bench, no browser lane |
| Native path | CSS injection; Transforms Level 2 individual `translate:`/`scale:` props; `animation-timeline` / `animation-range` emission |
| Polyfill path (verified) | IO (257 thresholds) for view timelines; passive scroll + rAF for scroll timelines and no-IO fallback; parsed-range structs; parallel-array interpolation; transform scratch; per-element style writes |
| Emitters | toGsap (27-easing map, prop renames, CustomEase markers), toRig (4-slot mapping, honest dropped-prop comments, honest entry/exit 0.5-split warning) |

---

## 2. Findings

**SF-01 (S1). The view polyfill freezes through the middle of every
animation.** The IO path drives progress *only* from IntersectionObserver
callbacks, and IO fires only when the intersection **ratio** crosses a
threshold. But view-timeline progress keeps advancing while the ratio is
constant: a short element fully in view (ratio pinned at 1 — the native
`contain` phase) and a tall element covering the viewport (ratio pinned at
viewportH/elH) both scroll onward with **zero callbacks arriving** — the
animation visibly sticks mid-range and snaps when the ratio moves again.
Any track whose range spans `contain` — which is most `cover`-range
storyboards — stalls on the primary path. The scroll+rAF fallback is
architecturally correct and currently reserved for browsers *without* IO.
The fix is the standard hybrid: IO gates visibility (cheap, park when
off-screen), scroll+rAF drives progress while visible. The 257-threshold
table mitigated granularity during entry/exit; it cannot manufacture
callbacks the ratio never triggers.

**SF-02 (S1-adjacent). The polyfill feeds its own output back into its
input.** Both the IO entry's `boundingClientRect` and the fallback's
`getBoundingClientRect` include the track's *own applied transforms* —
native view timelines use layout position, transforms excluded. The
package's quick-start (`translateY: 30 → 0`) moves `rect.top` as it
animates, so measured progress ≠ scroll progress: the mapping bends,
diverges from native, and can oscillate near boundaries. The same defect
class as the rig's SR-01, in this package's own front-page example. Fix:
compensate using the last-applied scratch values (state already carries
them) or measure untransformed layout; either way, recorded and tortured.

**SF-03 (S2). Tall elements invert the range math.** `entryFrac = elH /
total` exceeds `exitStart = viewportH / total` once the element is taller
than the scrollport, so `contain` produces `rangeEnd < rangeStart`, span
≤ 0, and the clamp pins progress at 0 — silently stuck, where the native
spec defines well-formed (endpoint-swapped) behavior for tall subjects.
One geometry family, three broken range kinds; conform to the spec's
tall-subject definitions with fixtures at elH = 0.5×, 1×, 2×, 5× viewport.

**SF-04 (S2). The parity claim has no oracle, and two divergences are
already visible from the source.** Nothing anywhere runs the same
storyboard through native and polyfill and compares. And the write targets
differ: native emits individual `translate:`/`scale:`/`rotate:` (spec
composition order translate→rotate→scale, composing with author
transforms); the polyfill writes a `style.transform` string in
translate→**scale**→**rotate** order, clobbering any author transform. A
rotate + non-uniform-scale track renders differently on the two paths
today, and an element with its own CSS transform breaks only on the
polyfill. For the polyfill's actual audience (Firefox stable, Safari,
Chrome 104–114) individual transform properties are supported — the
polyfill can write the same properties native animates, closing both gaps
at once, with the transform-string path demoted to an ancient-browser
fallback.

**SF-05 (S3). Detach is asymmetric across runtimes.** Native detach
removes the `<style>` element — everything reverts cleanly. Polyfill
detach disconnects observers and leaves the last frame's inline styles
baked onto every element (opacity 0.37, a half-finished transform).
Decide — restore prior inline values or clear the properties the runtime
set — and make both runtimes converge on the same post-detach state,
asserted. Adjacent: `resetKeyframeCounter` against a live attachment can
collide generated names; posture recorded.

**SF-06 (S3). The zero-GC claim overstates, and nothing gates it.** "The
single unavoidable per-frame allocation is the transform string" — but
every non-transform numeric property and every custom property builds a
fresh string per element per frame (`String(value)`, `value + unit`),
including `opacity`, the quick-start's headline property. That is a DOM
boundary reality, not a flaw — but the honest claim is *one string per
changed property per frame*, in a table. Related: there is no dirty check,
so unchanged values still hit `setProperty` and trigger style recalc every
frame. And no ceilings, no gc-profiler/leak devDeps, no browser-lane
measurement — the claim is prose.

---

## 3. Session ladder

```
SF0 (1.0.1 — the progress engine: hybrid drive, feedback fix, tall subjects)
  ├─► SF1 (1.1.0 — the native-parity oracle, promoted to release gate)
  ├─► SF2 (1.2.0 — honest allocations, dirty writes, symmetric detach)
  └─► SF3 (1.3.0 — the forge demo and the positioning)
        └─► DEFERRED (WAAPI runtime · axis/inline · Safari-ships trigger)
```

SF0 before the oracle only because the freeze is already source-proven —
building the parity lane first would demonstrate at length what one page of
arithmetic already establishes. SF1 then makes regressions impossible
rather than merely fixed.

===============================================================================
# SF0 — v1.0.1 — the progress engine
===============================================================================

```markdown
---
package: "@zakkster/lite-scrollforge"
version_target: 1.0.1
status: planned
findings: [SF-01, SF-02, SF-03, SF-04-partial]
devPeers: ["@zakkster/lite-gc-profiler ^1.15.0", "@zakkster/lite-leak ^1.9.0"]
blocks: [SF1, SF2, SF3]
---

# lite-scrollforge — progress that never sticks, geometry that never lies

PURPOSE
  Three defects share one subsystem — how the view polyfill turns scroll
  into progress. Fixing them separately would touch the same forty lines
  three times; this session rewrites the drive train once, with each
  defect pinned by its own fixture before and after.

TASKS
  - **SF-01: the hybrid drive** (`decisions/0001-drive-model.md`). IO
    becomes the visibility gate only: entering the observed band attaches
    the scroll+rAF ticker to the already-detected scroller; leaving it
    (with hysteresis one threshold wide, so boundary jitter cannot
    thrash attach/detach) parks the ticker. Progress is computed
    exclusively by the ticker — the same math the no-IO fallback already
    runs, now the single code path for both worlds. Off-screen tracks
    cost zero rAF wake-ups (the parking claim, asserted); on-screen
    tracks update every frame including the entire contain phase. The
    fake-driver headless fixture that proves the freeze: constant-ratio
    scroll sequence, v1.0.0 applies zero frames (the control), the
    hybrid applies every one.
  - **SF-02: transform-immune measurement.** The ticker subtracts the
    track's own last-applied translate from the measured rect (the
    scratch already holds it), or — cleaner, and unified with the next
    task — reads layout position via offsetTop-chain accumulation cached
    per scroll pass. Recorded with the known limits. Fixture: the
    quick-start storyboard itself; progress-vs-scrollY must be linear to
    tolerance, v1.0.0's curve (bent by its own translateY) is the
    control.
  - **SF-03: tall subjects.** Range formulas conform to the spec's
    tall-subject endpoint behavior; fixtures at elH = 0.5× / 1× / 2× / 5×
    viewport for entry, contain, exit, cover — each against hand-derived
    expected bounds. The 1× case (entryFrac == exitStart exactly) gets
    its own assertion; degenerate spans resolve per spec, not to
    stuck-at-zero.
  - **SF-04, the write half: individual transform properties.** The
    polyfill writes `style.translate` / `style.scale` / `style.rotate` —
    the same properties the native path animates, spec composition
    order, author transforms untouched. The `style.transform` string
    survives only behind a feature check for browsers without
    Transforms Level 2, documented as the visually-divergent legacy
    path. This is half of parity; SF1 proves the other half.
  - **Gates wired:** gc-profiler + leak devDeps; assertOps on
    `_applyTrackFrame` with the fake style sink — ceiling per property
    class committed (numeric non-transform: 1 string; transform via
    individual props: 1 string per changed component; the honest
    numbers, gated); leak on attach/detach ×4096 with fake observers.

ASSERTIONS
  - Contain-phase fixture: every scroll step applies a frame; v1.0.0
    control applies none.
  - Quick-start progress curve linear within tolerance; control bent.
  - All 16 geometry × range fixtures match hand-derived bounds.
  - Parked off-screen tracks: zero ticks over a scripted idle window.

NON-GOALS
  No browser lane yet — every fixture here is headless with injected
  drivers, which is exactly what makes the controls reproducible.

DONE WHEN
  progress is a pure function of scroll position — never of callback
  luck, and never of the animation's own output
```

===============================================================================
# SF1 — v1.1.0 — the native-parity oracle
===============================================================================

```markdown
---
package: "@zakkster/lite-scrollforge"
version_target: 1.1.0
status: planned
findings: [SF-04]
depends_on: [SF0]
---

# lite-scrollforge — "matches native" becomes a gated number

PURPOSE
  The package's one-sentence promise has never been tested against the
  thing it promises to match. This is the round-trip-oracle move from the
  tracing plan, applied here: same storyboard, both runtimes, one real
  browser, computed styles compared at every scroll position — and then
  promoted to the release gate so parity can never silently regress.

TASKS
  - **The parity harness** (shared Playwright lane): a fixture page
    mounts each storyboard twice — native-forced on one element set,
    polyfill-forced on a mirrored set — in a browser with native
    support. CDP-scripted scroll steps through the full range; at each
    step, getComputedStyle on paired elements, per-property diff.
    `parityScore = { maxDev, rmsDev }` per property per storyboard —
    the traceScore shape, with the metric's method documented.
  - **The corpus:** quick-start; every range kind × short/tall subject;
    named timelines with attachedSelector; nested scrollers; scroll
    timelines against both window and container; custom properties;
    each analytic lite-ease easing through `linear()` (native) vs the
    piecewise evaluator (polyfill) — the two implementations of the
    same curve, compared through the DOM.
  - **Committed tolerances**, measured then pinned: transforms in px,
    opacity absolute, custom properties exact-after-rounding.
    Native-only behaviors the polyfill deliberately does not replicate
    go in a recorded divergence table with reasons — parity is allowed
    exceptions, but only out loud.
  - **Promotion:** the parity run joins `verify`; publish is
    mechanically impossible while any corpus item exceeds its ceiling.
    The v1.0.0 transform-order divergence (rotate + non-uniform scale)
    is kept as the control storyboard that the legacy string path
    fails and the SF0 individual-property path passes.
  - **Emitter conformance, the cheap half:** toGsap / toRig outputs as
    committed snapshots (drift is a diff, reviewed not accidental) plus
    a syntax gate (`new Function` parse) on every generated module. A
    live-GSAP execution lane is deliberately out of scope — recorded,
    with the reason (no third-party runtime deps, even dev).

ASSERTIONS
  - Full corpus inside tolerances on the lane; the control storyboard
    fails on the legacy path.
  - Easing parity: analytic curves agree between linear() and the
    piecewise evaluator within one sample-quantization step.
  - Snapshots current; generated code parses.

DONE WHEN
  the promise on the first line of the README is a number in CI
```

===============================================================================
# SF2 — v1.2.0 — honest allocations, dirty writes, symmetric detach
===============================================================================

```markdown
---
package: "@zakkster/lite-scrollforge"
version_target: 1.2.0
status: planned
findings: [SF-05, SF-06]
depends_on: [SF0]
---

# lite-scrollforge — the claims say what the code does

PURPOSE
  The zero-GC story is the brand; right now it is one sentence too
  generous, unmeasured where it runs, and paired with a lifecycle
  asymmetry that surprises anyone who detaches on the polyfill path.

TASKS
  - **SF-06: the allocation table.** README rewritten from "the single
    unavoidable allocation is the transform string" to the true
    statement: one string per **changed** property per element per
    frame — the DOM boundary — itemized per property class, with the
    CDP-sampled numbers from the lane beside them (the lite-inp IN0
    method, on a 10k-step scripted scroll). The parked state (SF0)
    samples at zero and says so.
  - **The dirty check that makes "changed" true.** Per-property
    last-written value cached in the state's parallel arrays; equal
    values skip `setProperty` entirely — no string, no style recalc.
    Progress clamped at a range end goes fully silent. Measured before/
    after in the lane: style-recalc count per scroll step, the number
    in the README.
  - **SF-05: symmetric detach** (`decisions/0002-detach.md`). Recommend
    restore-prior: attach snapshots each element's touched inline
    properties once (setup cost, allowed), detach restores them —
    byte-equal end state with the native path's style-removal, asserted
    for both runtimes on the same fixture. `resetKeyframeCounter`
    documented as unsafe while attached (or guarded with a named error
    — decide, record).
  - **Posture sweep:** selector-matches-nothing currently skips
    silently — decide (warn once vs named error vs documented
    leniency) consistently with the ecosystem's fail-closed lean;
    `sequenceOnTimeline` edge torture (overlap 0, 1, >1, single track,
    startPct > endPct — precise named errors).

ASSERTIONS
  - Detach leaves both runtimes byte-identical to pre-attach, ×4096
    cycles, zero leaks.
  - Clamped-at-rest track: zero setProperty calls per frame, lane-
    verified via recalc counts.
  - Every README allocation claim has a measured number beside it.

DONE WHEN
  the claim, the code, and the measurement are the same sentence
```

===============================================================================
# SF3 — v1.3.0 — the forge demo and the positioning
===============================================================================

```markdown
---
package: "@zakkster/lite-scrollforge"
version_target: 1.3.0
status: planned
depends_on: [SF1, SF2]
---

# lite-scrollforge — config in, motion out, code out

PURPOSE
  The forge packages sell themselves by showing the transformation. This
  one has the best version available: edit a storyboard, watch it run on
  two runtimes at once, and read the three artifacts it compiles to.

TASKS
  - **`demo/scrollforge.html`** — oscilloscope blueprint.
    **01 · AUTHOR** — a storyboard editor panel (preset storyboards +
    editable ranges/easings) driving a live scroll stage; native or
    polyfill runtime toggle with the active engine indicated.
    **02 · PARITY** — the SF1 oracle as theater: both runtimes
    side-by-side on mirrored elements, per-property deviation readout
    live, the legacy-transform-path toggle as the control that visibly
    diverges.
    **03 · COMPILE** — tabs showing the emitted native CSS, GSAP
    module, and rig module for the current storyboard, updating live;
    the dropped-prop and CustomEase markers visible — honesty as UI.
    **04 · ZERO-GC** — scripted auto-scroll with the per-frame write
    counter, the dirty-check making it drop to zero at range ends, and
    the allocating toggle as the control.
  - **Recipes, CI-verified:** the lite-ease analytic-easing showcase
    (easeOutBounce through linear() — the differentiator, front and
    center); the OKLCH custom-property sunset with lite-color-engine;
    the toRig handoff running against published lite-scroll-rig-pro
    (coordinating with that package's SR3 session — one shared fixture,
    tested from both repos); lite-signal-driven storyboard swap
    (effect detaches and reattaches on config change).
  - **README repositioned:** lead with author-once/target-four and the
    forge framing; the honest browser table stays; a short section
    placing this package and the rig as the two answers (native-first
    authoring vs virtual-scroll runtime) with toRig as the bridge —
    the portfolio's scroll story told once, consistently, in both
    READMEs.

ASSERTIONS
  - Demo scenes hold steady-state discipline; scene 04's counter
    matches headless-measured write counts; scene 02's live deviation
    agrees with the lane's parityScore on the same storyboard.
  - All recipes run in CI against published peers, APIs from llms.txt.

DONE WHEN
  a stranger edits one range value, sees both runtimes agree, and reads
  the CSS it would ship — in one screen
```

===============================================================================
# DEFERRED — WAAPI runtime · axis support · Safari trigger
===============================================================================

```markdown
---
package: "@zakkster/lite-scrollforge"
version_target: none scheduled
status: deferred by default
---

# recorded triggers, no scheduled work

WAAPI SCROLLTIMELINE RUNTIME
  A third runtime: JS `ScrollTimeline`/`ViewTimeline` objects driving
  Web Animations — compositor-driven like native CSS but observable and
  seekable from JS. TRIGGER: a client needs progress events or
  scrubbing that pure CSS cannot expose. Constraint recorded: it slots
  behind attachStoryboardRuntime's existing runtime switch; no new
  authoring surface.

INLINE AXIS / HORIZONTAL
  `axis: 'inline'` is emitted for native but the polyfill computes
  block-axis only. TRIGGER: a horizontal-scrolling client project.
  Constraint: the SF0 ticker parameterizes over axis; range math is
  identical with widths for heights.

SAFARI SHIPS
  When Safari lands scroll-driven animations, re-verify
  HAS_NATIVE_SUPPORT detection against their implementation, run the
  SF1 parity corpus on WebKit (the oracle earns its keep the day a
  second native engine exists), and update the browser table. TRIGGER:
  the release note.

DONE WHEN
  a trigger fires; until then, done means this block exists
```

---

## 4. If you only do two

1. **SF0.** The polyfill freezes through the contain phase of essentially
   every storyboard and bends its own progress with its own transforms —
   on the quick-start example. One session rewrites the drive train and
   pins all three defects with controls.
2. **SF1.** The package's entire pitch is one checkable sentence, and SF1
   makes it checked on every publish — plus it is the session that earns
   compound interest the day Safari ships and a second native engine
   needs the same corpus.

SF2 makes the brand honest; SF3 makes it visible. But a forge whose
output diverges from its target is not yet a forge.

*Written 2026-08-05 against `@zakkster/lite-scrollforge@1.0.0` — static
audit of the full single file; polyfill runtime, range math, serializer,
and lifecycle read line-by-line, easing/emitter layers structurally
verified. Gate tooling from SF0: lite-gc-profiler ^1.15.0, lite-leak
^1.9.0, Playwright lane shared with lite-inp / lite-gpu-profiler /
lite-scroll-rig-pro. One focused 4–5 h sitting per session. Copyright
Zahary Shinikchiev.*
