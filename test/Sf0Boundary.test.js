// test/Sf0Boundary.test.js -- SF0 drive-train BOUNDARY matrix.
//
// Fail-closed / idempotency edges the Sf0Drive fixtures do not exercise:
// missing selectors, missing scroller fallback, zero-height elements, the
// degenerate 1x-viewport range cross-checked from the boundary side,
// hysteresis thrash guards, detach idempotency, re-entrancy, and one
// negative-zero / one sibling-isolation adversarial case.
// (Law: fail closed on every unverified state. null is not zero.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    attachStoryboardRuntime,
    _parseRangeEndpoint,
    _computeRangeBoundsInto
} from '../Scrollforge.js';

// --- instrumented headless environment -------------------------------------
// Same fake-DOM shape as Sf0Drive.test.js's _installViewEnv, extended with
// call-count spies (listener add/remove, rAF schedule/cancel, IO
// observe/disconnect/construct) so idempotency and no-thrash claims are
// MEASURED, not inferred from a passing test name.

function _mkEl(opts) {
    opts = opts || {};
    const setters = [];
    return {
        offsetTop: opts.offsetTop != null ? opts.offsetTop : 400,
        offsetHeight: opts.offsetHeight != null ? opts.offsetHeight : 100,
        offsetParent: opts.offsetParent !== undefined ? opts.offsetParent : null,
        parentElement: opts.parentElement !== undefined ? opts.parentElement : null,
        style: {
            transform: '', translate: '', scale: '', rotate: '',
            setProperty(name, value) { setters.push({ name, value }); }
        },
        _setters: setters
    };
}

function _mkScrollTarget(opts) {
    opts = opts || {};
    const t = {
        clientHeight: opts.clientHeight != null ? opts.clientHeight : 0,
        scrollTop: opts.scrollTop != null ? opts.scrollTop : 0,
        scrollHeight: opts.scrollHeight != null ? opts.scrollHeight : 0,
        offsetTop: opts.offsetTop != null ? opts.offsetTop : 0,
        offsetParent: opts.offsetParent !== undefined ? opts.offsetParent : null,
        _cb: null,
        _addCalls: 0, _removeCalls: 0,
        addEventListener(type, cb) { if (type === 'scroll') { t._cb = cb; t._addCalls++; } },
        removeEventListener(type) { if (type === 'scroll') { t._cb = null; t._removeCalls++; } }
    };
    return t;
}

function _installEnv(opts) {
    opts = opts || {};
    const selectors = opts.selectors || {};   // selector -> element (absent key == no match)
    const rafCalls = { count: 0 };
    const cancelCalls = { count: 0 };
    const ioCalls = { construct: 0, observe: 0, disconnect: 0 };
    let rafCb = null;
    let ioCb = null;

    const win = _mkScrollTarget({ clientHeight: opts.viewportH, scrollTop: opts.scrollY });
    win.innerHeight = opts.viewportH != null ? opts.viewportH : 800;
    win.scrollY = opts.scrollY != null ? opts.scrollY : 0;

    global.document = {
        querySelector: (s) => (Object.prototype.hasOwnProperty.call(selectors, s) ? selectors[s] : null)
    };
    global.window = win;
    global.requestAnimationFrame = (cb) => { rafCb = cb; rafCalls.count++; return rafCalls.count; };
    global.cancelAnimationFrame = () => { rafCb = null; cancelCalls.count++; };
    global.IntersectionObserver = function (cb) {
        ioCb = cb; ioCalls.construct++;
        return {
            observe() { ioCalls.observe++; },
            disconnect() { ioCalls.disconnect++; }
        };
    };
    global.CSS = { supports: () => true };
    if (opts.getComputedStyle) global.getComputedStyle = opts.getComputedStyle;

    function flush() { if (rafCb) { const c = rafCb; rafCb = null; c(); } }

    return {
        win, rafCalls, cancelCalls, ioCalls,
        flush,
        fireIo(entries) { if (ioCb) ioCb(entries); },
        hasPendingRaf() { return rafCb != null; },
        scrollWindowTo(y) { win.scrollY = y; if (win._cb) win._cb(); },
        teardown() {
            delete global.document; delete global.window;
            delete global.requestAnimationFrame; delete global.cancelAnimationFrame;
            delete global.IntersectionObserver; delete global.CSS;
            delete global.getComputedStyle;
        }
    };
}

// --- 1. missing element selector --------------------------------------------
test('boundary: element selector matches nothing -- track skipped, no style writes, detach clean', () => {
    const env = _installEnv({ selectors: {} });   // '.ghost' intentionally absent
    try {
        const handle = attachStoryboardRuntime({
            tracks: [{
                selector: '.ghost', timeline: { kind: 'view' },
                keyframes: [{ opacity: 0 }, { opacity: 1 }], easing: 'linear'
            }]
        }, { runtime: 'polyfill' });

        assert.equal(env.ioCalls.construct, 0, 'no observer constructed for a track with no element');
        assert.equal(env.win._addCalls, 0, 'no scroll listener installed for a track with no element');
        assert.doesNotThrow(() => handle.detach(), 'detach on an all-skipped storyboard does not throw');
        assert.doesNotThrow(() => handle.detach(), 'second detach on an all-skipped storyboard is also safe');
    } finally {
        env.teardown();
    }
});

// --- 2a. scroller selector matches nothing, no ancestor scroller ------------
test('boundary: scroller selector matches nothing, no ancestor scroller -- falls back to window, not silent zero', () => {
    const el = _mkEl({ offsetTop: 100, offsetHeight: 100, offsetParent: null, parentElement: null });
    const env = _installEnv({ selectors: { '.subj': el }, viewportH: 100, scrollY: 0 });
    // getComputedStyle is intentionally undefined -- _findNearestScroller
    // short-circuits to null, so the only remaining fallback is window.
    try {
        attachStoryboardRuntime({
            tracks: [{
                selector: '.subj', timeline: { kind: 'view', scroller: '.nonexistent-scroller' },
                keyframes: [{ opacity: 0 }, { opacity: 1 }], easing: 'linear'
            }]
        }, { runtime: 'polyfill' });

        assert.equal(env.win._addCalls, 1, 'ticker falls back to window: exactly one scroll listener on window');

        env.fireIo([{ intersectionRatio: 0.5 }]);
        env.flush();
        el._setters.length = 0;
        env.scrollWindowTo(150);   // raw = (viewportH - (offsetTop - scrollY)) / (viewportH+elH) = 150/200
        env.flush();
        const op = el._setters.filter((s) => s.name === 'opacity').pop();
        assert.ok(op, 'window scroll drives a real frame through the fallback path');
        assert.ok(Math.abs(+op.value - 0.75) < 1e-9,
            'progress tracks window.scrollY, not silently pinned at 0 -- got ' + op.value);
    } finally {
        env.teardown();
    }
});

// --- 2b. scroller selector matches nothing, but an ancestor auto-scroller exists ---
test('boundary: scroller selector matches nothing but an ancestor auto-scroller exists -- falls back to that scroller, not window', () => {
    const scroller = _mkScrollTarget({ clientHeight: 100, scrollTop: 0, scrollHeight: 400, offsetTop: 50, offsetParent: null });
    const el = _mkEl({ offsetTop: 150, offsetHeight: 100, offsetParent: scroller, parentElement: scroller });
    const env = _installEnv({
        selectors: { '.subj2': el },
        viewportH: 800, scrollY: 0,
        getComputedStyle: (node) => (node === scroller ? { overflowY: 'auto' } : { overflowY: 'visible' })
    });
    try {
        attachStoryboardRuntime({
            tracks: [{
                selector: '.subj2', timeline: { kind: 'view', scroller: '.nonexistent-scroller' },
                keyframes: [{ opacity: 0 }, { opacity: 1 }], easing: 'linear'
            }]
        }, { runtime: 'polyfill' });

        assert.equal(scroller._addCalls, 1, 'ticker attaches to the auto-detected ancestor scroller');
        assert.equal(env.win._addCalls, 0, 'window is NOT used when an ancestor scroller is found (assert which)');

        env.fireIo([{ intersectionRatio: 0.5 }]);
        env.flush();
        el._setters.length = 0;
        scroller.scrollTop = 100;
        if (scroller._cb) scroller._cb();
        env.flush();
        const op = el._setters.filter((s) => s.name === 'opacity').pop();
        assert.ok(op, 'scrolling the ancestor drives a frame');
        assert.ok(Math.abs(+op.value - 0.25) < 1e-9,
            'progress tracks the ancestor scroller scrollTop -- got ' + op.value);
    } finally {
        env.teardown();
    }
});

// --- 3. zero-height element -------------------------------------------------
test('boundary: zero-height element (offsetHeight 0) with nonzero viewport -- no NaN/Infinity progress', () => {
    const el = _mkEl({ offsetTop: 100, offsetHeight: 0, offsetParent: null, parentElement: null });
    const env = _installEnv({ selectors: { '.flat': el }, viewportH: 400, scrollY: 0 });
    try {
        attachStoryboardRuntime({
            tracks: [{
                selector: '.flat', timeline: { kind: 'view' },
                keyframes: [{ opacity: 0 }, { opacity: 1 }], easing: 'linear'
            }]
        }, { runtime: 'polyfill' });
        env.fireIo([{ intersectionRatio: 0.5 }]);
        env.flush();

        let sawFinite = false;
        for (let y = -50; y <= 500; y += 10) {
            el._setters.length = 0;
            env.scrollWindowTo(y);
            env.flush();
            const op = el._setters.filter((s) => s.name === 'opacity').pop();
            if (op) {
                const v = +op.value;
                assert.ok(Number.isFinite(v), 'progress must be finite at scrollY=' + y + ', got ' + v);
                sawFinite = true;
            }
        }
        assert.ok(sawFinite, 'at least one frame was applied across the sweep (total>0 branch taken)');
    } finally {
        env.teardown();
    }
});

// --- 4. degenerate contain range (elH == viewport), cross-checked ----------
test('boundary: degenerate contain range (elH == viewport) resolves as a step via the real drive train', () => {
    const viewportH = 100, elH = 100, offsetTop = 100;
    const el = _mkEl({ offsetTop, offsetHeight: elH, offsetParent: null, parentElement: null });
    const env = _installEnv({ selectors: { '.deg': el }, viewportH, scrollY: 0 });
    try {
        attachStoryboardRuntime({
            tracks: [{
                selector: '.deg', timeline: { kind: 'view' },
                range: { start: 'contain 0%', end: 'contain 100%' },
                keyframes: [{ opacity: 0 }, { opacity: 1 }], easing: 'linear'
            }]
        }, { runtime: 'polyfill' });
        env.fireIo([{ intersectionRatio: 0.5 }]);
        env.flush();

        // Cross-check against the same hand-derived bounds Sf0Drive's 1x
        // fixture uses: entryFrac == exitStart == 0.5 -> rangeStart == rangeEnd == 0.5.
        const ps = _parseRangeEndpoint('contain 0%', 0);
        const pe = _parseRangeEndpoint('contain 100%', 1);
        const boundsState = { rangeStart: 0, rangeEnd: 0 };
        _computeRangeBoundsInto(ps, pe, elH, viewportH, boundsState);
        assert.equal(boundsState.rangeStart, 0.5);
        assert.equal(boundsState.rangeEnd, 0.5);

        function opacityAt(y) {
            el._setters.length = 0;
            env.scrollWindowTo(y);
            env.flush();
            const op = el._setters.filter((s) => s.name === 'opacity').pop();
            return op ? +op.value : undefined;
        }

        // raw = scrollY / (viewportH+elH) = scrollY/200; boundary at raw==0.5 -> scrollY==100.
        assert.equal(opacityAt(99), 0, 'before the degenerate boundary -- 0');
        assert.equal(opacityAt(100), 1, 'at the degenerate boundary -- step to 1, not stuck-at-zero');
        assert.equal(opacityAt(150), 1, 'after the degenerate boundary -- stays 1');
    } finally {
        env.teardown();
    }
});

// --- 5. hysteresis: jitter at _GATE_HI must not thrash ---------------------
test('boundary: jitter around _GATE_HI does not thrash park/unpark -- no listener stacking, no extra rAF, no cancel', () => {
    const el = _mkEl({ offsetTop: 400, offsetHeight: 800, offsetParent: null, parentElement: null });
    const env = _installEnv({ selectors: { '.hero': el }, viewportH: 400, scrollY: 401 });
    try {
        attachStoryboardRuntime({
            tracks: [{
                selector: '.hero', timeline: { kind: 'view' },
                keyframes: [{ opacity: 0 }, { opacity: 1 }], easing: 'linear'
            }]
        }, { runtime: 'polyfill' });

        const GATE_HI = 1 / 256;
        env.fireIo([{ intersectionRatio: GATE_HI }]);   // exactly the unpark edge
        env.flush();
        assert.equal(env.win._addCalls, 1, 'exactly one scroll listener installed at attach');

        const rafBefore = env.rafCalls.count;
        // Jitter the ratio around _GATE_HI without ever touching _GATE_LO (0)
        // -- the element stays meaningfully on-screen the whole time.
        for (let i = 0; i < 200; i++) {
            const r = (i % 2 === 0) ? GATE_HI - 1e-6 : GATE_HI + 1e-6;
            env.fireIo([{ intersectionRatio: Math.max(r, 1e-9) }]);
        }
        assert.equal(env.win._addCalls, 1, 'jitter around the gate does not stack a second scroll listener');
        assert.equal(env.rafCalls.count, rafBefore, 'IO-only jitter never schedules an rAF (only real scroll does)');
        assert.equal(env.cancelCalls.count, 0, 'the gate never dropped to _GATE_LO -- ticker never parked/cancelled');
    } finally {
        env.teardown();
    }
});

// --- 6. hysteresis: double-unpark / double-park idempotency ----------------
test('boundary: double-unpark and double-park are idempotent (no duplicate catch-up ticks, no duplicate cancel)', () => {
    const el = _mkEl({ offsetTop: 400, offsetHeight: 800, offsetParent: null, parentElement: null });
    const env = _installEnv({ selectors: { '.hero2': el }, viewportH: 400, scrollY: 401 });
    try {
        attachStoryboardRuntime({
            tracks: [{
                selector: '.hero2', timeline: { kind: 'view' },
                keyframes: [{ opacity: 0 }, { opacity: 1 }], easing: 'linear'
            }]
        }, { runtime: 'polyfill' });

        // Double-unpark: two separate high-ratio deliveries in a row.
        env.fireIo([{ intersectionRatio: 1 }]);
        env.flush();
        el._setters.length = 0;
        env.fireIo([{ intersectionRatio: 1 }]);   // gate already on -- must be a no-op
        assert.equal(el._setters.length, 0,
            'a second high-ratio IO delivery while already unparked applies no extra catch-up frame');

        // Schedule exactly one pending rAF via a real scroll event.
        env.scrollWindowTo(420);
        assert.equal(env.hasPendingRaf(), true, 'scroll schedules a pending rAF while unparked');

        // Double-park: two separate zero-ratio deliveries in a row, rAF pending.
        env.fireIo([{ intersectionRatio: 0 }]);
        assert.equal(env.cancelCalls.count, 1, 'park cancels the one pending rAF exactly once');
        assert.equal(env.hasPendingRaf(), false, 'the pending rAF is dropped by park');
        const cancelAfterFirstPark = env.cancelCalls.count;
        env.fireIo([{ intersectionRatio: 0 }]);   // already parked -- must be a no-op
        assert.equal(env.cancelCalls.count, cancelAfterFirstPark,
            'a second zero-ratio IO delivery while already parked does not double-cancel');
    } finally {
        env.teardown();
    }
});

// --- 7. detach() idempotency -------------------------------------------------
test('boundary: detach() is idempotent -- calling it twice does not throw or write styles', () => {
    const el = _mkEl({ offsetTop: 100, offsetHeight: 100, offsetParent: null, parentElement: null });
    const env = _installEnv({ selectors: { '.d': el }, viewportH: 100, scrollY: 0 });
    try {
        const handle = attachStoryboardRuntime({
            tracks: [{
                selector: '.d', timeline: { kind: 'view' },
                keyframes: [{ opacity: 0 }, { opacity: 1 }], easing: 'linear'
            }]
        }, { runtime: 'polyfill' });
        env.fireIo([{ intersectionRatio: 0.5 }]);
        env.flush();

        assert.doesNotThrow(() => handle.detach(), 'first detach does not throw');
        assert.equal(env.ioCalls.disconnect, 1, 'observer disconnected once');
        assert.equal(env.win._removeCalls, 1, 'scroll listener removed once');

        el._setters.length = 0;
        assert.doesNotThrow(() => handle.detach(), 'second detach does not throw');
        assert.equal(el._setters.length, 0, 'a repeat detach writes no styles');
        assert.equal(env.win._addCalls, 1, 'a repeat detach never re-adds a listener');
    } finally {
        env.teardown();
    }
});

// --- 8. post-detach late callbacks are safe no-ops --------------------------
test('boundary: post-detach late IO callback and late scroll event are safe no-ops', () => {
    const el = _mkEl({ offsetTop: 100, offsetHeight: 100, offsetParent: null, parentElement: null });
    const env = _installEnv({ selectors: { '.late': el }, viewportH: 100, scrollY: 0 });
    try {
        const handle = attachStoryboardRuntime({
            tracks: [{
                selector: '.late', timeline: { kind: 'view' },
                keyframes: [{ opacity: 0 }, { opacity: 1 }], easing: 'linear'
            }]
        }, { runtime: 'polyfill' });
        env.fireIo([{ intersectionRatio: 0.5 }]);
        env.flush();

        // Capture the raw scroll closure BEFORE detach -- simulates a
        // callback that is already queued in the event loop when detach()
        // runs synchronously (real DOM removeEventListener would not affect
        // an event already dispatched; this pins the SAME race directly).
        const staleScrollCb = env.win._cb;

        handle.detach();
        el._setters.length = 0;

        assert.doesNotThrow(() => staleScrollCb(), 'a stale scroll callback after detach does not throw');
        env.flush();
        assert.equal(el._setters.length, 0, 'a stale scroll callback after detach writes no styles');

        assert.doesNotThrow(() => env.fireIo([{ intersectionRatio: 1 }]),
            'a late IO callback after detach does not throw');
        env.flush();
        assert.equal(el._setters.length, 0, 'a late IO callback after detach writes no styles');
    } finally {
        env.teardown();
    }
});

// --- 9. adversarial: -0 scrollY ---------------------------------------------
test('boundary (adversarial): scrollY = -0 behaves identically to scrollY = 0 -- no negative-zero propagation', () => {
    const el = _mkEl({ offsetTop: 100, offsetHeight: 100, offsetParent: null, parentElement: null });
    const env = _installEnv({ selectors: { '.negzero': el }, viewportH: 100, scrollY: 0 });
    try {
        attachStoryboardRuntime({
            tracks: [{
                selector: '.negzero', timeline: { kind: 'view' },
                keyframes: [{ opacity: 0 }, { opacity: 1 }], easing: 'linear'
            }]
        }, { runtime: 'polyfill' });
        env.fireIo([{ intersectionRatio: 0.5 }]);
        env.flush();

        el._setters.length = 0;
        env.scrollWindowTo(-0);
        env.flush();
        const op = el._setters.filter((s) => s.name === 'opacity').pop();
        assert.ok(op, 'a -0 scrollY still produces a frame');
        const v = +op.value;
        assert.ok(Number.isFinite(v), '-0 scrollY does not propagate to NaN/Infinity, got ' + v);
        assert.equal(Object.is(v, -0), false, 'progress value is not itself -0');
        assert.equal(v, 0, '-0 scrollY resolves identically to 0 scrollY');
    } finally {
        env.teardown();
    }
});

// --- 10. dispose-during-iteration (re-entrant detach mid-tick) -------------
test('boundary: dispose-during-iteration -- detach() called mid-tick (re-entrant) does not throw and parks cleanly', () => {
    const el = _mkEl({ offsetTop: 100, offsetHeight: 100, offsetParent: null, parentElement: null });
    const env = _installEnv({ selectors: { '.reentrant': el }, viewportH: 100, scrollY: 0 });
    let handle;
    let detachedDuringWrite = false;
    // Detach FROM WITHIN a style write -- simulates a consumer that tears
    // down the runtime as a side effect of the very frame it is applying
    // (e.g. a one-shot reveal-then-remove animation).
    const realSetProperty = el.style.setProperty.bind(el.style);
    el.style.setProperty = (name, value) => {
        realSetProperty(name, value);
        if (name === 'opacity' && !detachedDuringWrite) {
            detachedDuringWrite = true;
            handle.detach();
        }
    };
    try {
        handle = attachStoryboardRuntime({
            tracks: [{
                selector: '.reentrant', timeline: { kind: 'view' },
                keyframes: [{ opacity: 0 }, { opacity: 1 }], easing: 'linear'
            }]
        }, { runtime: 'polyfill' });

        const staleScrollCb = env.win._cb;   // captured before the re-entrant detach

        assert.doesNotThrow(() => { env.fireIo([{ intersectionRatio: 0.5 }]); env.flush(); },
            'detach() from inside a mid-tick style write does not throw or corrupt the running tick');
        assert.equal(detachedDuringWrite, true, 'the re-entrant detach actually fired');

        el._setters.length = 0;
        assert.doesNotThrow(() => staleScrollCb(), 'a late scroll callback after the re-entrant detach does not throw');
        env.flush();
        assert.equal(el._setters.length, 0,
            'the ticker is parked after the re-entrant detach -- no further writes');
    } finally {
        env.teardown();
    }
});

// --- 11. re-entrant scroll events: the pending guard holds -----------------
test('boundary: re-entrant/rapid scroll events do not double-schedule rAF -- the pending guard holds', () => {
    const el = _mkEl({ offsetTop: 100, offsetHeight: 100, offsetParent: null, parentElement: null });
    const env = _installEnv({ selectors: { '.pending': el }, viewportH: 100, scrollY: 0 });
    try {
        attachStoryboardRuntime({
            tracks: [{
                selector: '.pending', timeline: { kind: 'view' },
                keyframes: [{ opacity: 0 }, { opacity: 1 }], easing: 'linear'
            }]
        }, { runtime: 'polyfill' });
        env.fireIo([{ intersectionRatio: 0.5 }]);
        env.flush();

        const rafBefore = env.rafCalls.count;
        env.scrollWindowTo(10);   // schedules the first rAF
        env.scrollWindowTo(20);   // rapid re-entrant scroll before the rAF fired
        env.scrollWindowTo(30);
        assert.equal(env.rafCalls.count, rafBefore + 1,
            'three scroll events before the rAF flush schedule exactly one rAF');

        env.flush();
        assert.equal(env.rafCalls.count, rafBefore + 1, 'flushing does not itself schedule a second rAF');
    } finally {
        env.teardown();
    }
});

// --- 12. adversarial: sibling-track isolation on partial failure -----------
test('boundary (adversarial): one missing-selector track does not break a sibling track in the same storyboard', () => {
    const goodEl = _mkEl({ offsetTop: 100, offsetHeight: 100, offsetParent: null, parentElement: null });
    const env = _installEnv({ selectors: { '.good': goodEl }, viewportH: 100, scrollY: 0 });   // '.missing' absent
    try {
        const handle = attachStoryboardRuntime({
            tracks: [
                { selector: '.missing', timeline: { kind: 'view' },
                    keyframes: [{ opacity: 0 }, { opacity: 1 }], easing: 'linear' },
                { selector: '.good', timeline: { kind: 'view' },
                    keyframes: [{ opacity: 0 }, { opacity: 1 }], easing: 'linear' }
            ]
        }, { runtime: 'polyfill' });

        env.fireIo([{ intersectionRatio: 0.5 }]);
        env.flush();
        assert.ok(goodEl._setters.some((s) => s.name === 'opacity'),
            'the sibling track with a real element still animates despite the missing-selector track');
        assert.equal(env.ioCalls.construct, 1, 'exactly one observer constructed -- only for the live track');
        assert.doesNotThrow(() => handle.detach(), 'detach cleans up the mixed storyboard without throwing');
    } finally {
        env.teardown();
    }
});
