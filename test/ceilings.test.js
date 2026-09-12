// test/ceilings.test.js -- part of `npm test`; the allocation gates run under
// `--expose-gc` (npm run test:gc / test:ceilings) and SKIP cleanly otherwise.
//
// Committed hot-path ceilings as a first-class, granular node:test lane
// (extracted from test/torture.mjs so the budget is not buried inside the
// retention torture). Two hot bodies:
//
//   _computeFrame    -- the PURE math half (range map, easing, interpolation
//                       into pre-allocated scratch). Must be 0 bytes/call.
//   _applyTrackFrame -- the DOM-write half. At most ONE string per changed
//                       numeric non-transform property, at most THREE transform
//                       strings (individual translate/scale/rotate) per frame.
//
// THE FAILING CONTROL: a deliberately-allocating function measured by the SAME
// measureAllocs/checkAllocs must FAIL the 0-byte gate. A ceiling that cannot
// fail is decorative -- this proves the instrument has teeth.

import test from 'node:test';
import assert from 'node:assert/strict';
import { measureAllocs, checkAllocs, GcProfiler, checkNoGc } from '@zakkster/lite-gc-profiler';
import { _createTrackState, _computeFrame, _applyTrackFrame } from '../Scrollforge.js';
import { installFakeDom, makeEl, makeCountingStyle } from './fixtures.mjs';

const NO_GC = typeof globalThis.gc !== 'function';

installFakeDom();

// A track spanning both halves: numeric non-transform (opacity + a custom prop)
// AND every individual transform component.
function hotState(selector) {
    makeEl(selector);
    const state = _createTrackState({
        selector: selector, timeline: { kind: 'view' },
        keyframes: [
            { opacity: 0, '--tint': 0,   translateX: 0,  translateY: 30, scale: 1,   rotate: 0  },
            { opacity: 1, '--tint': 240, translateX: 10, translateY: 0,  scale: 1.5, rotate: 45 }
        ],
        easing: 'linear'
    });
    state.rangeStart = 0;
    state.rangeEnd = 1;
    return state;
}

test('ceiling: _applyTrackFrame writes <= 1 string per changed non-transform prop, <= 3 transform strings', () => {
    const state = hotState('.ceil-write');
    const style = makeCountingStyle();
    state.el.style = style;

    // Count non-transform numeric props the way the drive train classifies them.
    let nonTransformProps = 0;
    for (let i = 0; i < state.numericProps.length; i++) {
        const nm = state.numericProps[i];
        if (nm !== 'translateX' && nm !== 'translateY' && nm !== 'translateZ' &&
            nm !== 'scale' && nm !== 'scaleX' && nm !== 'scaleY' && nm !== 'rotate') {
            nonTransformProps++;
        }
    }
    assert.ok(nonTransformProps >= 2,
        'test needs >= 2 non-transform numeric props to prove the budget PER prop, got ' + nonTransformProps);

    _applyTrackFrame(state, 0.5);

    const stringsPerProp = style.numericStrings / nonTransformProps;
    assert.ok(stringsPerProp <= 1,
        'numeric writes ' + style.numericStrings + ' / ' + nonTransformProps +
        ' props = ' + stringsPerProp + ' > 1 per prop');
    assert.ok(style.transformStrings <= 3,
        'transform writes ' + style.transformStrings + ' > 3 (translate/scale/rotate)');
});

test('dirty-check: a repeated-identical frame writes 0; a varying control writes every changed prop', () => {
    // SF-06: the per-property last-written caches make an unchanged frame write
    // nothing (and build no string), while a frame whose progress moves still
    // writes every changed property. This changes only WHEN writes fire, never
    // the final computed style -- so the parity oracle stays byte-identical.
    const state = hotState('.ceil-dirty');
    const style = makeCountingStyle();
    state.el.style = style;

    _applyTrackFrame(state, 0.5);   // prime: first frame writes from the NaN/undefined sentinel
    style.numericStrings = 0; style.transformStrings = 0;
    for (let i = 0; i < 1000; i++) _applyTrackFrame(state, 0.5);   // identical progress x1000
    assert.equal(style.numericStrings, 0,
        'repeated-identical frame wrote ' + style.numericStrings + ' numeric strings (want 0)');
    assert.equal(style.transformStrings, 0,
        'repeated-identical frame wrote ' + style.transformStrings + ' transform strings (want 0)');

    // Control: monotonically-varying progress writes every changed property
    // every frame -- 2 non-transform (opacity + --tint) + 3 transform
    // (translate/rotate/scale) = 5 strings/frame x 1000 frames.
    const cstate = hotState('.ceil-dirty-ctl');
    const cstyle = makeCountingStyle();
    cstate.el.style = cstyle;
    for (let i = 0; i < 1000; i++) _applyTrackFrame(cstate, i / 999);
    const total = cstyle.numericStrings + cstyle.transformStrings;
    assert.equal(total, 5000,
        'varying control wrote ' + total + ' strings (want 5 x 1000); numeric=' +
        cstyle.numericStrings + ' transform=' + cstyle.transformStrings);
});

test('dirty-check: repeated-identical _applyTrackFrame provokes 0 major GC', { skip: NO_GC }, async () => {
    // 0 B/call is the per-call proof; this is the collection proof -- a static
    // frame that builds no string cannot pressure the heap into a major GC over
    // a long loop. Gate the RATE at zero majors, not just the per-call bytes.
    const state = hotState('.ceil-dirty-major');
    state.el.style = makeCountingStyle();
    _applyTrackFrame(state, 0.5);   // prime from the sentinel
    globalThis.gc();
    const gc = new GcProfiler().start();
    for (let i = 0; i < 200000; i++) _applyTrackFrame(state, 0.5);
    await new Promise((r) => setTimeout(r, 50));   // let async GC entries settle before reading
    const s = gc.summary();
    gc.stop();
    const report = checkNoGc(s, { maxMajor: 0 });
    assert.ok(report.ok,
        'repeated-identical _applyTrackFrame caused ' + s.gc.major + ' major GC over 200k frames (want 0)');
});

test('dirty-check: repeated-identical _applyTrackFrame is 0 bytes/call', { skip: NO_GC }, () => {
    // With the dirty-check, a static frame builds no DOM string, so the hot
    // body is truly allocation-free -- not merely young-gen bounded.
    const state = hotState('.ceil-dirty-alloc');
    state.el.style = makeCountingStyle();
    _applyTrackFrame(state, 0.5);   // prime
    const allocs = measureAllocs(() => { _applyTrackFrame(state, 0.5); },
        { iterations: 512, batches: 32 });
    const report = checkAllocs(allocs, { maxBytesPerCall: 0 });
    assert.equal(report.verdict, 'pass',
        'repeated-identical _applyTrackFrame allocated ' + allocs.bytesPerCall +
        ' B/call (gated 0); verdict ' + report.verdict);
});

test('ceiling: _computeFrame is 0 bytes/call (pure compute path)', { skip: NO_GC }, () => {
    const state = hotState('.ceil-compute');
    const allocs = measureAllocs((i) => { _computeFrame(state, (i & 1023) / 1023); },
        { iterations: 512, batches: 32 });
    const report = checkAllocs(allocs, { maxBytesPerCall: 0 });
    assert.equal(report.verdict, 'pass',
        '_computeFrame allocated ' + allocs.bytesPerCall + ' B/call (gated 0); verdict ' + report.verdict);
});

test('ceiling FAILING CONTROL: an allocating function does NOT pass the 0-byte gate', { skip: NO_GC }, () => {
    // Proves the gate has teeth: the same instrument that passes _computeFrame
    // must reject a body that allocates every call. The object is pushed into a
    // GROWING array (reset when it gets large) so the allocation genuinely
    // escapes and is retained -- a bounded ring or an unused local is
    // scalar-replaced by V8 escape analysis and measures a false 0, and the
    // min-over-batches estimator nets it away.
    let sink = [];
    const allocs = measureAllocs((i) => { sink.push({ v: i }); if (sink.length > 4096) sink = []; },
        { iterations: 512, batches: 32 });
    const report = checkAllocs(allocs, { maxBytesPerCall: 0 });
    assert.notEqual(report.verdict, 'pass',
        'allocating control passed the 0-byte gate (' + allocs.bytesPerCall +
        ' B/call, verdict ' + report.verdict + ') -- the ceiling cannot fail, it is decorative');
});
