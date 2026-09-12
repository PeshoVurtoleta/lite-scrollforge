# 0002 -- the dirty-check, detach restore, and fail-closed attach

Status: accepted (SF2, v1.2.0)
Findings: SF-06 (per-frame write accounting + dirty-check)
Related: [[0001-drive-model]] (the drive train this rides on),
[[0003-parity]] (the oracle that proves the end state is unchanged)

## Context

SF0 gated the write half of `_applyTrackFrame` by a per-frame CEILING and an
allocation RATE (see 0001, "Allocation gate semantics"), but it wrote EVERY
animated property EVERY frame, even when the interpolated value had not moved.
A track clamped at a range endpoint -- fully entered, fully exited, or parked on
a plateau of its easing -- kept re-emitting byte-identical strings to the DOM,
one allocation per property per frame for no visual change. SF-06 is the honest
per-changed-property accounting SF0 deferred, plus the dirty-check that makes an
unchanged property allocate and write nothing.

Adding a cache that suppresses writes forces two adjacent questions that SF0
never had to answer, because SF0 wrote unconditionally:

1. What is the element's inline style supposed to look like AFTER detach?
2. What happens if the author mutates the same inline properties we cache?

## Decision

### The dirty-check: value compare against a per-property cache

`_createTrackState` pre-allocates, per track, a last-written cache for every
property class: `_lastNum` (a `Float64Array`, one slot per numeric prop),
`_lastStr` (a plain array, one slot per string prop), and the five transform
scalars `_lastTx / _lastTy / _lastSx / _lastSy / _lastRot`. Every slot is
initialized to its UNKNOWN sentinel -- `NaN` for numbers, `undefined` for
strings.

`null is not zero`: the sentinel is deliberately a value no real interpolation
produces, so the FIRST frame after attach always writes (a computed `0` is not
equal to `NaN`; a computed `''`-less string is not equal to `undefined`). An
uninitialized cache WRITES; it never silently skips.

The hot body compares the freshly computed value against its cache slot BEFORE
building any string; on equality it `continue`s -- no string is constructed, no
`setProperty` fires, no `style.translate/rotate/scale` assignment happens. After
a write it stores the new value. This adds exactly one equality guard per write
site and no other branch, per the hot-path law. A track clamped at a range
endpoint goes fully silent: 0 writes, 0 bytes.

This changes only WHEN writes fire, never WHAT the steady state paints. The
compute half (`_computeFrame`) is untouched, so the interpolated values are
bit-identical; skipping a write that would have re-emitted the same string
cannot move `getComputedStyle`. The parity oracle confirms it: every
non-quarantined corpus item stays at maxDev 0.0000, unchanged from the SF1
baseline.

### Detach restores the pre-attach inline style (restore-prior policy)

The native path attaches by injecting a `<style>` element and detaches by
removing it; it never touches the subject's inline style, so its post-detach end
state is exactly its pre-attach state. For the polyfill to converge byte-equal
with native across an attach/detach cycle, detach must UNDO the inline writes it
made.

Policy: restore-prior, not clear-all. At attach (cold, a permitted setup cost)
`_createTrackState` snapshots the element's current inline value for every
touched property -- `getPropertyValue(name)` for the numeric/string props,
the `style.translate/rotate/scale/transform` IDL attributes for the transform
components. At detach, `_restoreTrackInlineStyle` writes those snapshots back:
a property the element ALREADY carried is restored to its prior value; a
property it did NOT carry (empty snapshot) is `removeProperty`'d, not left as a
stale runtime write. Then every cache is reset to its sentinel so a subsequent
re-attach starts clean. `tracker.size()` returns to 0 across 4096 attach/detach
cycles and the post-detach inline style is byte-identical to pre-attach on both
runtimes.

Restore is defensive about the sink: it feature-checks `setProperty` /
`removeProperty` / the transform IDL attributes so a headless or partial style
object cannot make detach throw.

### Author-mutated inline style mid-attach is an owned-property limit

Between attach and detach, Scrollforge treats the properties it animates as
OWNED. If the author mutates one of those inline properties directly (e.g.
`el.style.translate = ...` from their own code) while the track is attached, two
things follow, both by design and recorded here rather than discovered later:

- The dirty-check may skip the next runtime write if its cached value still
  matches what the runtime last wrote, leaving the author's value in place for
  a frame until the computed value moves. The cache tracks what the RUNTIME
  wrote, not what the DOM currently holds.
- On detach, restore returns the property to its ATTACH-TIME snapshot, not to
  the author's mid-attach value. The author's intervening write is not
  preserved.

The owned-property window is the attach/detach lifetime. Callers that need to
drive the same properties from two sources should detach first. This is a
documented limit, consistent with native (which likewise composes its own
animation output over author declarations for the properties it drives).

### Fail closed on a selector that matches nothing

SF0 skipped a track whose selector resolved to no element (`if (!state)
continue`). That is a silent no-op on an unverified state -- a typo'd or
not-yet-mounted target animated nothing with no signal. Per Law (fail closed;
null is not zero), `attachStoryboardRuntime` now throws a named error naming the
offending selector and track index.

Fail-closed over warn-once: a warning is discardable and, in the common
build-then-attach flow, arrives after the damage (an animation that never runs).
A thrown error is un-ignorable and points at the exact track. To keep the abort
clean, attach RESOLVES every track (allocating its state) BEFORE installing any
observer or listener, so a single unresolved selector aborts the whole attach
with ZERO side effects -- no half-installed observer left without a detach handle
to release it. The retention torture proves no observer or listener survives an
aborted attach.

### `resetKeyframeCounter` fails closed while any runtime is attached

`resetKeyframeCounter` zeroes the module-global `@keyframes`-naming counter so
`storyboardToCss` / `trackToCss` emit byte-stable golden output. Resetting it
while a runtime attachment is live is a category error -- mixing a compile-time
determinism knob with a live runtime -- and it is unsafe: zeroing the shared
counter mid-attach makes a later emission collide with `@keyframes` names a live
attachment may still depend on for regeneration.

Decision (reversed from the earlier no-op stance): `resetKeyframeCounter` now
FAILS CLOSED. If any runtime is attached it throws a named `Error`
("resetKeyframeCounter: cannot reset while N runtime(s) are attached; detach
first"); otherwise it resets as before.

The earlier objection -- that attach-tracking would cost hot-path-adjacent state
-- does not apply. The tracker is a single module-level integer, `_liveAttachments`,
touched ONLY on the cold attach/detach paths:

- Incremented once AFTER an attach fully succeeds. The fail-closed selector-miss
  throw aborts before install and does NOT increment, so a failed attach leaves
  the count untouched.
- Decremented once per handle on the FIRST `detach`; `detach` is idempotent (a
  per-handle `detached` flag), so a second detach never double-decrements.

It is never read or written in `_applyTrackFrame` or any per-frame code -- zero
hot-path cost, zero per-frame allocation. This aligns with the Law: fail closed
on every unverified state rather than let a misuse silently corrupt future
codegen.

Scope of the count: ALL live runtime attachments -- both native `<style>`
injections (`attachStoryboard`) and polyfill JS drivers -- not only the ones
that generate `@keyframes` names. This is the most conservative fail-closed
choice: the guard cannot be defeated by attaching via a path that happens not to
have emitted names this session, and the count has one obvious meaning ("is
anything live?"). `attachStoryboardRuntime`'s native leg delegates to
`attachStoryboard`, so a native attach is counted exactly once.

## Consequences

- An unchanged property allocates and writes nothing; a clamped track is fully
  silent. Repeated-identical `_applyTrackFrame` measures 0 B/call.
- A varying frame still writes every changed property -- the control lane
  measures exactly 5 strings/frame (2 numeric + 3 transform) x 1000 frames.
- Detach converges byte-equal with native's `<style>`-removal end state; the
  oracle's maxDev/rmsDev are unchanged from the SF1 baseline.
- Attach fails closed and side-effect-free on any unresolved selector.
- `resetKeyframeCounter` fails closed while any runtime is attached, tracked by
  a single cold-path integer; `detach` is idempotent and the count returns to
  exactly 0 across the 4096-cycle churn.
