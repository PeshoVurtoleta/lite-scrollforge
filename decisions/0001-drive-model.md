# 0001 -- the view-timeline drive model

Status: accepted (SF0, v1.0.1)
Findings: SF-01, SF-02, SF-03, SF-04 (write half)

## Context

The polyfill turns scroll position into animation progress for `view()`
timelines. v1.0.0 drove progress from `IntersectionObserver` callbacks and
measured element position with `getBoundingClientRect`. Both choices were
wrong in the common case:

- IntersectionObserver fires only when the intersection RATIO crosses a
  threshold. Through the `contain` phase -- a short element fully in view, or
  a tall element covering the scrollport -- the ratio is pinned while progress
  keeps advancing. Zero callbacks arrive; the animation sticks mid-range and
  snaps when the ratio moves again (SF-01).
- `getBoundingClientRect().top` includes the element's OWN applied transform.
  The quick-start (`translateY: 30 -> 0`) moves `rect.top` as it animates, so
  measured progress bends away from scroll progress and can oscillate near
  boundaries -- the measurement feeds back on its own output (SF-02).

## Decision

One drive train, rebuilt once, with each defect pinned by a control fixture.

### IO is a visibility GATE, not a progress source (SF-01)

`_installViewObserver` no longer computes progress. The IntersectionObserver
exists only to park/unpark the ticker:

- Entering the observed band (ratio crosses the unpark edge) starts the
  scroll+rAF ticker on the already-detected scroller.
- Leaving it (ratio drops to the park edge) parks the ticker.
- Off-screen tracks cost ZERO rAF wake-ups: a parked `onScroll` returns before
  scheduling anything. Proven by the parked-ticker fixture (0 ticks over a
  scripted idle window) and the torture harness (0 bytes/call).

### One-threshold hysteresis

The gate uses exactly two thresholds: a park edge `_GATE_LO = 0` (fully
off-screen) and an unpark edge `_GATE_HI = 1/256` (meaningfully on-screen).
The gap between them -- one IntersectionObserver threshold wide -- is a
hysteresis dead-zone. Boundary jitter at a single threshold cannot thrash
park/unpark, because a state change requires crossing the FAR edge, not the
near one. `_GATE_HI` is `1/256` because that was the granularity of the old
257-slot threshold table, now deleted (the gate does not need resolution, only
a crossing).

### The ticker is the single progress code path

`_installViewTicker` computes progress for BOTH the IO world (gated) and the
no-IO world (always unparked). There is no second implementation to drift.
On-screen tracks tick every frame, including the entire `contain` phase where
the old IO-driven math froze. The contain-phase control fixture asserts the
contrast: the hybrid applies a frame on all 64 constant-ratio steps; a faithful
v1.0.0 IO-only control applies zero.

### Progress from an offsetTop-chain, not getBoundingClientRect (SF-02)

The ticker measures layout position by accumulating `offsetTop` up the
`offsetParent` chain, once per scroll pass, and subtracts the scroller's scroll
offset. `offsetTop` is a LAYOUT quantity: it does not include the element's
applied `translate`/`scale`/`rotate`, so the track's own output cannot feed
back into its measured progress. The quick-start control fixture asserts
`|progress - scrollY/total| <= 1e-9` over 200 steps for the new path, while the
transform-fed v1.0.0 control bends by more than 0.03.

Origin reconciliation for nested scrollers (the blocker fix). A
`position: static` `overflow: auto` scroller -- the DEFAULT scroll container --
is not a positioned ancestor, so `offsetParent` SKIPS it and the element's chain
runs past it to the document root. Naively subtracting `rootEl.scrollTop` from
that document-origin `chainTop` mixes two coordinate origins and, for a scroller
partway down the page, drives progress negative -> clamped to 0 ("stuck at
start"). The fix accumulates BOTH the element and the scroller to the same
document root and subtracts: `relTop = chainTop(el) - chainTop(rootEl) -
rootEl.scrollTop`. A positioned scroller cancels identically, since its own
offset appears in both walks. This matches v1.0.0's `rootBounds` behavior for
the nested-scrollable-container case, and is pinned by the nested
static-overflow-scroller fixture (progress tracks `scrollTop` to 1e-12 and
advances mid-range, never clamping to 0). The reconciliation costs one extra
`offsetParent` pointer walk per scroll pass when a scroller is present -- bounded
and zero-allocation. No case here fails open: every layout-derivable position is
recovered to the scroller's origin; only a genuinely non-layout case (below)
is a recorded limit rather than a silent 0.

Recorded limit: the offsetTop chain is layout, not visual, so a CSS-transformed
ANCESTOR (a `transform` on a parent between the element and the scrollport) is
NOT reflected in the measured position. Native view timelines use layout
position for the subject; a transformed ancestor is an edge the polyfill does
not compensate. Axis is block-only (see the roadmap's deferred inline-axis
block). Both are acceptable for SF0's audience and are called out here rather
than discovered later.

### Tall subjects: endpoint swap, not stuck-at-zero (SF-03)

`entryFrac = elH/(viewportH+elH)` exceeds `exitStart = viewportH/(viewportH+elH)`
once the element is taller than the scrollport. Only `contain` inverts: it is
`[min(entryFrac, exitStart), max(entryFrac, exitStart)]` -- the range over which
the element is fully contained by (short subject) or fully covers (tall subject)
the scrollport. `entry` (`[0, entryFrac]`) and `exit` (`[exitStart, 1]`) never
swap, because `entryFrac + exitStart == 1` identically. The 1x-viewport
degenerate case (`entryFrac == exitStart`) yields a zero-length range, resolved
per spec as a STEP at the boundary (0 before the point, 1 at/after) -- never
clamp-stuck-at-zero. Pinned by 16 geometry x range fixtures (elH 0.5/1/2/5x
viewport) to 1e-12, with the degenerate case asserted separately.

### Write half: individual transform properties (SF-04)

The polyfill writes `style.translate` / `style.scale` / `style.rotate` -- the
same Transforms Level 2 properties the native path animates -- in spec
composition order translate -> rotate -> scale, leaving author `transform`
untouched. The legacy single-string `style.transform` path survives only behind
an attach-time feature check (`_supportsIndividualTransforms`, i.e.
`CSS.supports('translate: 0px')`); it is documented as the visually-divergent
legacy fallback because it composes in a fixed order and clobbers author
transforms. This closes half of native parity; SF1 proves the other half with
a real-browser oracle.

## Allocation gate semantics

`_applyTrackFrame` is split into two halves so the allocation story is honest
and each half is gated by the metric that actually bounds it:

- `_computeFrame` -- the PURE compute: range mapping, easing eval,
  keyframe-interval location, and numeric interpolation into pre-allocated
  scratch (`_values` + `_scratch`). No style writes. Gated at exactly
  0 bytes/call with `measureAllocs` / `checkAllocs({ maxBytesPerCall: 0 })`.
  This is where "zero allocation on any hot path" is held literally.
- The DOM-write half -- reads the scratch and writes it out. It allocates
  exactly one string per CHANGED property per frame (`value + unit` /
  `String(value)` / the individual-transform strings). That is a DOM boundary
  reality, not a defect. The resolved CSS property NAME and unit are cached
  once at attach (`state.numericCss` / `numericUnit` / `stringCss`), so an
  unmapped or custom property does NOT pay a second string per frame for its
  kebab-cased name -- the per-changed-property budget is literally one string,
  the value, and the ceiling gate proves it PER PROP (a two-property
  opacity + custom track measures at 1 string/prop).

The write half is gated by three SCALE-INVARIANT budgets, all committed and
none widened to pass:

1. The per-frame CEILING: <= 1 string per changed numeric non-transform
   property, <= 3 transform strings (translate/scale/rotate), measured against
   a counting style sink.
2. `maxBytesPerOp` (committed 512 B; measured ~158 B for a five-property
   transform+opacity track).
3. `maxMajorsPerKOp: 0` -- the major-GC RATE per 1000 ops.

We deliberately do NOT gate on the ABSOLUTE major-GC count over a fixed-length
write loop. That number double-counts total transient volume: any path that
legitimately allocates one string per changed property per frame will, over a
long enough loop, allocate enough transient bytes to trip a full GC. Gating on
it would either be a lie about the write path or an invitation to shrink the
loop until it passes -- gaming the gate. The whole-loop `gc.major` is printed
in the torture GATE line as INFORMATIONAL only.

The honest per-frame DOM-string accounting -- one string per changed property,
itemized per property class with lane-sampled numbers, plus the dirty-check
that makes unchanged properties allocate nothing -- is SF2's deliverable
(finding SF-06). SF0 commits the ceiling + rate; SF2 puts the measured table
beside the claim.

## Consequences

- Progress is a pure function of scroll position -- never of callback luck, and
  never of the animation's own output.
- One code path drives both the IO and no-IO worlds; there is no second
  progress implementation to regress.
- The zero-allocation Law is held where it can be (compute) and the DOM
  boundary is gated where it must be (rate + ceiling), not papered over.
