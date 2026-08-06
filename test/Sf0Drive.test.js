// test/Sf0Drive.test.js -- SF0 drive-train control fixtures.
//
// Four headless controls, each pinning one of the three SF0 defects with an
// encoded v1.0.0 control beside the fix:
//   (a) contain-phase freeze  -- hybrid ticker applies every frame; the
//       IO-callback-only v1.0.0 control applies zero under a constant ratio.
//   (b) transform feedback    -- offsetTop-chain progress is linear in scroll;
//       the getBoundingClientRect-fed v1.0.0 control bends by its own translate.
//   (c) tall-subject range     -- 16 geometry x range bounds vs hand-derived
//       values to 1e-12; the 1x degenerate contain asserted separately.
//   (d) parked off-screen      -- zero ticks over a scripted idle window.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    attachStoryboardRuntime,
    _parseRangeEndpoint,
    _computeRangeBoundsInto,
    _applyTrackFrame
} from '../Scrollforge.js';

// --- shared headless view environment -------------------------------------
// Drives the real polyfill drive train against fake DOM globals. Progress is
// a pure function of window.scrollY vs a fixed offsetTop -- the SF-02 point.
function _installViewEnv(opts) {
    opts = opts || {};
    const selector = opts.selector || '.a';
    const setters = [];
    const el = {
        offsetTop: opts.offsetTop != null ? opts.offsetTop : 400,
        offsetHeight: opts.elH != null ? opts.elH : 100,
        offsetParent: null,
        parentElement: null,
        style: {
            transform: '', translate: '', scale: '', rotate: '',
            setProperty(name, value) { setters.push({ name, value }); }
        }
    };
    let rafCb = null;
    let ioCb = null;
    const win = {
        innerHeight: opts.viewportH != null ? opts.viewportH : 800,
        scrollY: opts.scrollY != null ? opts.scrollY : 0,
        _scroll: null,
        addEventListener(t, cb) { if (t === 'scroll') win._scroll = cb; },
        removeEventListener(t) { if (t === 'scroll') win._scroll = null; }
    };
    global.document = { querySelector: (s) => (s === selector ? el : null) };
    global.window = win;
    global.requestAnimationFrame = (cb) => { rafCb = cb; return 1; };
    global.cancelAnimationFrame = () => { rafCb = null; };
    global.IntersectionObserver = function (cb) {
        ioCb = cb;
        return { observe() {}, disconnect() {} };
    };
    global.CSS = { supports: () => true };
    function flush() { if (rafCb) { const c = rafCb; rafCb = null; c(); } }
    return {
        el, setters, win,
        enter() { if (ioCb) ioCb([{ intersectionRatio: 0.5 }]); flush(); },
        leave() { if (ioCb) ioCb([{ intersectionRatio: 0 }]); },
        scrollTo(y) { win.scrollY = y; if (win._scroll) win._scroll(); flush(); },
        fireScroll() { if (win._scroll) win._scroll(); },
        hasPendingRaf() { return rafCb != null; },
        translateY() {
            const m = /([-\d.eE+]+)px\s+([-\d.eE+]+)px/.exec(el.style.translate);
            return m ? +m[2] : 0;
        },
        teardown() {
            delete global.document; delete global.window;
            delete global.requestAnimationFrame; delete global.cancelAnimationFrame;
            delete global.IntersectionObserver; delete global.CSS;
        }
    };
}

// --- (a) contain-phase freeze ---------------------------------------------
test('SF-01 fixture: contain-phase -- hybrid applies 64 frames, v1.0.0 control applies 0', () => {
    // Tall subject fully covering the scrollport: the intersection ratio is
    // pinned through the contain phase. 64 scroll steps within that phase.
    const env = _installViewEnv({ selector: '.hero', viewportH: 400, elH: 800, offsetTop: 400 });
    try {
        attachStoryboardRuntime({
            tracks: [{
                selector: '.hero', timeline: { kind: 'view' },
                keyframes: [{ opacity: 0 }, { opacity: 1 }],
                easing: 'linear'
            }]
        }, { runtime: 'polyfill' });

        env.enter();               // gate unparks the ticker
        env.setters.length = 0;    // count only the contain-phase steps

        // --- the REAL v1.0.0 control -------------------------------------
        // v1.0.0 drove progress ONLY from IntersectionObserver callbacks, and
        // IO fires only when the intersection RATIO crosses one of its
        // thresholds. This is the actual old drive, replicated: compute the
        // ratio from element geometry each step, bucket it against the old
        // 257-slot threshold table, and apply a frame ONLY when the bucket
        // changes (i.e. only when IO would re-fire). The entry callback has
        // already been delivered, so lastBucket starts at the covering ratio.
        const V100_THRESHOLDS = new Float64Array(257);
        for (let t = 0; t <= 256; t++) V100_THRESHOLDS[t] = t / 256;
        function ratioBucket(r) {
            let b = 0;
            for (let t = 0; t < V100_THRESHOLDS.length; t++) {
                if (V100_THRESHOLDS[t] <= r) b = t; else break;
            }
            return b;
        }
        // vpTop=0, vpBottom=viewportH(400); elH=800. Element covers the
        // scrollport across the whole sweep, so the ratio stays pinned and IO
        // never re-fires -- the exact freeze v1.0.0 exhibited.
        const vpTop = 0, vpBottom = 400, elHeight = 800;
        let lastBucket = -2;   // set from the first (entry) frame below
        let v100Frames = 0;

        let hybridFrames = 0;
        for (let i = 0; i < 64; i++) {
            // Element scrolls up while still covering: elTop from 0 to -400.
            const elTop = -(i * 400) / 63;
            const elBottom = elTop + elHeight;

            // --- hybrid: the real runtime ticker drives every scroll step ---
            const y = 401 + i;   // advance scroll within the covering phase
            env.scrollTo(y);
            if (env.setters.some(s => s.name === 'opacity')) {
                hybridFrames++;
                env.setters.length = 0;
            }

            // --- v1.0.0: IO-callback-gated apply (faithful) ---
            const visible = Math.min(elBottom, vpBottom) - Math.max(elTop, vpTop);
            const ratio = visible / elHeight;     // pinned at 400/800 = 0.5
            const bucket = ratioBucket(ratio);
            if (i === 0) { lastBucket = bucket; continue; }   // entry callback already delivered
            if (bucket !== lastBucket) { v100Frames++; lastBucket = bucket; }
        }

        assert.equal(hybridFrames, 64, 'hybrid ticker applies a frame every scroll step');
        assert.equal(v100Frames, 0, 'v1.0.0 IO-only control applies zero frames -- the ratio never re-crosses a threshold (the freeze)');
    } finally {
        env.teardown();
    }
});

// --- (b) transform-immune measurement -------------------------------------
test('SF-02 fixture: quick-start translateY 30->0 -- progress linear in scroll, control bends', () => {
    const viewportH = 100, elH = 100, total = viewportH + elH, offsetTop = 100;
    const env = _installViewEnv({ selector: '.title', viewportH, elH, offsetTop });
    try {
        attachStoryboardRuntime({
            tracks: [{
                selector: '.title', timeline: { kind: 'view' },
                keyframes: [{ translateY: 30 }, { translateY: 0 }],
                easing: 'linear'
            }]
        }, { runtime: 'polyfill' });
        env.enter();

        let maxRealBend = 0;
        let maxControlBend = 0;
        const STEPS = 200;
        for (let i = 0; i < STEPS; i++) {
            const y = (i / (STEPS - 1)) * total;   // scroll across [0, total]
            const expected = y / total;

            // Real drive: offsetTop-chain -> progress read back from the
            // applied translateY. translateY = 30 * (1 - p) -> p = 1 - ty/30.
            env.scrollTo(y);
            const measured = 1 - env.translateY() / 30;
            const realBend = Math.abs(measured - expected);
            if (realBend > maxRealBend) maxRealBend = realBend;

            // v1.0.0 control: getBoundingClientRect().top includes the element's
            // OWN applied translateY -> the measurement feeds back on itself.
            const appliedTY = 30 * (1 - expected);
            const rectTop = (offsetTop - y) + appliedTY;
            let ctrl = (viewportH - rectTop) / total;
            if (ctrl < 0) ctrl = 0; else if (ctrl > 1) ctrl = 1;
            const controlBend = Math.abs(ctrl - expected);
            if (controlBend > maxControlBend) maxControlBend = controlBend;
        }

        assert.ok(maxRealBend <= 1e-9,
            'offsetTop-chain progress is linear in scroll to 1e-9, got ' + maxRealBend);
        assert.ok(maxControlBend > 0.03,
            'transform-fed v1.0.0 control bends > 0.03, got ' + maxControlBend);
    } finally {
        env.teardown();
    }
});

// --- (b2) nested position:static overflow scroller partway down the page ---
// The offsetParent chain SKIPS a static scroller (the default scroll
// container), so the walk runs past it to the document root. Progress must
// still track the scroller's scrollTop, reconciled to the scroller's own
// origin -- NOT clamp to 0 mid-range (the SF-02 blocker regression). Every
// other fixture uses offsetParent:null/window; this one exercises rootEl!=null.
test('SF-02 fixture: nested static-overflow scroller -- progress tracks scroll, no clamp-to-0', () => {
    const setters = [];
    const body = { offsetTop: 0, offsetParent: null };
    // Element lives at document y=2500, but its offsetParent is body -- the
    // static scroller at y=2000 is NOT on the chain.
    const el = {
        offsetTop: 2500, offsetHeight: 100, offsetParent: body, parentElement: null,
        style: { transform: '', translate: '', scale: '', rotate: '',
            setProperty(n, v) { setters.push({ name: n, value: v }); } }
    };
    let scrollerCb = null;
    const scroller = {
        offsetTop: 2000, offsetParent: body,     // scroller's own document offset
        clientHeight: 400, scrollTop: 0,
        addEventListener(t, cb) { if (t === 'scroll') scrollerCb = cb; },
        removeEventListener(t) { if (t === 'scroll') scrollerCb = null; }
    };
    let rafCb = null, ioCb = null;
    global.document = { querySelector: (s) => (s === '.subj' ? el : s === '.scroller' ? scroller : null) };
    global.window = { innerHeight: 800, scrollY: 0, addEventListener() {}, removeEventListener() {} };
    global.requestAnimationFrame = (cb) => { rafCb = cb; return 1; };
    global.cancelAnimationFrame = () => {};
    global.IntersectionObserver = function (cb) { ioCb = cb; return { observe() {}, disconnect() {} }; };
    global.CSS = { supports: () => true };
    function flush() { if (rafCb) { const c = rafCb; rafCb = null; c(); } }
    try {
        attachStoryboardRuntime({
            tracks: [{
                selector: '.subj',
                timeline: { kind: 'view', scroller: '.scroller' },
                keyframes: [{ opacity: 0 }, { opacity: 1 }],
                easing: 'linear'
            }]
        }, { runtime: 'polyfill' });
        if (ioCb) ioCb([{ intersectionRatio: 0.5 }]);   // unpark
        flush();

        // el offset within scroller content = 2500 - 2000 = 500; viewportH=400,
        // elH=100 -> total=500. raw = (viewportH - (500 - scrollTop)) / 500.
        // raw=0 at scrollTop=100, raw=1 at scrollTop=600. Linear (scrollTop-100)/500.
        let maxErr = 0;
        let sawMidrange = false;
        for (let i = 0; i <= 50; i++) {
            const st = 100 + i * 10;   // 100 .. 600
            scroller.scrollTop = st;
            if (scrollerCb) scrollerCb();
            flush();
            const op = +setters.filter(s => s.name === 'opacity').pop().value;
            let expected = (st - 100) / 500;
            if (expected < 0) expected = 0; else if (expected > 1) expected = 1;
            const err = Math.abs(op - expected);
            if (err > maxErr) maxErr = err;
            if (expected > 0.2 && expected < 0.8 && op > 0.01) sawMidrange = true;
        }
        assert.ok(maxErr <= 1e-9,
            'nested static-scroller progress tracks scrollTop to 1e-9, got ' + maxErr);
        assert.ok(sawMidrange,
            'progress must advance mid-range -- NOT clamp to 0 (the SF-02 regression)');
    } finally {
        delete global.document; delete global.window;
        delete global.requestAnimationFrame; delete global.cancelAnimationFrame;
        delete global.IntersectionObserver; delete global.CSS;
    }
});

// --- (c) tall-subject range math ------------------------------------------
test('SF-03 fixture: 16 geometry x range bounds match hand-derived values to 1e-12', () => {
    const S = 100;                       // viewportH
    const ks = [0.5, 1, 2, 5];           // elH = k * viewportH
    const TOL = 1e-12;
    const state = { rangeStart: 0, rangeEnd: 0 };

    function bounds(startStr, endStr, elH) {
        const ps = _parseRangeEndpoint(startStr, 0);
        const pe = _parseRangeEndpoint(endStr, 1);
        _computeRangeBoundsInto(ps, pe, elH, S, state);
        return [state.rangeStart, state.rangeEnd];
    }
    function close(a, b, msg) { assert.ok(Math.abs(a - b) <= TOL, msg + ' -- got ' + a + ' want ' + b); }

    for (const k of ks) {
        const elH = k * S;
        const entryFrac = elH / (S + elH);       // = k/(1+k)
        const exitStart = S / (S + elH);         // = 1/(1+k)
        const lo = Math.min(entryFrac, exitStart);
        const hi = Math.max(entryFrac, exitStart);

        const [e0, e1] = bounds('entry 0%', 'entry 100%', elH);
        close(e0, 0, 'entry 0% (k=' + k + ')');
        close(e1, entryFrac, 'entry 100% (k=' + k + ')');

        const [c0, c1] = bounds('contain 0%', 'contain 100%', elH);
        close(c0, lo, 'contain 0% (k=' + k + ')');
        close(c1, hi, 'contain 100% (k=' + k + ')');

        const [x0, x1] = bounds('exit 0%', 'exit 100%', elH);
        close(x0, exitStart, 'exit 0% (k=' + k + ')');
        close(x1, 1, 'exit 100% (k=' + k + ')');

        const [v0, v1] = bounds('cover 0%', 'cover 100%', elH);
        close(v0, 0, 'cover 0% (k=' + k + ')');
        close(v1, 1, 'cover 100% (k=' + k + ')');
    }
});

test('SF-03 fixture: 1x-viewport degenerate contain resolves per spec, not stuck-at-zero', () => {
    const S = 100, elH = 100;   // k == 1 -> entryFrac == exitStart == 0.5
    const state = { rangeStart: 0, rangeEnd: 0, easingFn: (t) => t,
        offsets: new Float64Array([0, 1]),
        numericProps: ['opacity'], numericArrays: [new Float64Array([0, 1])],
        numericCss: ['opacity'], numericUnit: [''],
        stringProps: [], stringArrays: [], stringCss: [], useIndividual: false,
        el: { style: { setProperty() {}, transform: '' } },
        _values: new Float64Array(1), _kLo: 0,
        _scratch: { tx: 0, ty: 0, sx: 1, sy: 1, rot: 0, hasTr: false, hasSc: false, hasRot: false } };

    const ps = _parseRangeEndpoint('contain 0%', 0);
    const pe = _parseRangeEndpoint('contain 100%', 1);
    _computeRangeBoundsInto(ps, pe, elH, S, state);
    // Endpoints coincide (zero-length range), NOT rangeEnd < rangeStart.
    assert.equal(state.rangeStart, 0.5);
    assert.equal(state.rangeEnd, 0.5);

    // The degenerate span must resolve as a step at the boundary, never
    // clamp-stuck-at-zero. Read progress back from the applied opacity.
    let last;
    state.el.style.setProperty = (name, v) => { if (name === 'opacity') last = +v; };
    _applyTrackFrame(state, 0.49);   // before the point
    assert.equal(last, 0, 'raw < rangeStart -> progress 0');
    _applyTrackFrame(state, 0.50);   // at the point
    assert.equal(last, 1, 'raw >= rangeStart -> progress 1 (step, not stuck-at-zero)');
    _applyTrackFrame(state, 0.80);   // after the point
    assert.equal(last, 1, 'raw > rangeStart -> progress 1');
});

// --- (d) parked off-screen track ------------------------------------------
test('SF-01 fixture: parked off-screen track takes zero ticks over an idle window', () => {
    const env = _installViewEnv({ selector: '.off', viewportH: 400, elH: 800, offsetTop: 400 });
    try {
        attachStoryboardRuntime({
            tracks: [{
                selector: '.off', timeline: { kind: 'view' },
                keyframes: [{ opacity: 0 }, { opacity: 1 }],
                easing: 'linear'
            }]
        }, { runtime: 'polyfill' });

        env.enter();               // on-screen: one catch-up frame
        env.leave();               // gate parks the ticker
        env.setters.length = 0;

        // Scripted idle window: 500 scroll events while parked off-screen.
        for (let i = 0; i < 500; i++) env.fireScroll();

        assert.equal(env.setters.length, 0, 'parked ticker writes zero frames');
        assert.equal(env.hasPendingRaf(), false, 'parked ticker schedules zero rAF wake-ups');
    } finally {
        env.teardown();
    }
});
