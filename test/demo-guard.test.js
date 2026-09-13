// test/demo-guard.test.js -- part of `npm test` (no Chromium required).
//
// Keeps demo/ + recipes/ HONEST and DRIFT-FREE against the headless truth:
//
//   1. ASCII gate on every file in demo/ and recipes/ (Law: ASCII-only source,
//      U+00D7 and U+00B5 excepted). A stray tool-call tag or smart-quote fails.
//   2. The demo's committed WRITES_PER_FRAME EQUALS the headless-measured
//      per-frame write count (the same _applyTrackFrame instrument ceilings.test.js
//      gates), and its 1000-frame total EQUALS 5000 -- so scene 04's counter
//      cannot drift from the dirty-check truth.
//   3. The demo's PARITY_TOL EQUALS storyboards.mjs DEMO_SCENE02.tol (the
//      decisions/0003-parity.md tolerances), and the scene-02 storyboard the demo
//      mounts EQUALS DEMO_SCENE02 -- so scene 02's live readout and the oracle's
//      maxDev are the same storyboard at the same ceilings.
//
// THE BREAK CONTROL is intrinsic: these are EQUALITY assertions against the
// canonical sources. Edit the demo constant, the fixture, or the runtime write
// count in isolation and this lane fails -- which is the whole point.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { _createTrackState, _applyTrackFrame, storyboardToCss, toGsap, toRig } from '../Scrollforge.js';
import { installFakeDom, makeEl, makeCountingStyle } from './fixtures.mjs';
import { DEMO_SCENE02 } from './browser/storyboards.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DEMO_HTML = join(ROOT, 'demo', 'scrollforge.html');

installFakeDom();

// ---- 1. ASCII gate -------------------------------------------------------
// Law exceptions: U+00D7 (multiplication sign) and U+00B5 (micro sign) only.
function walk(dir) {
    const out = [];
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) out.push(...walk(p));
        else out.push(p);
    }
    return out;
}

// Scope: the SF3-owned surface -- the SF3 demo (demo/scrollforge.html) and every
// recipe. The pre-existing demo/index.html + demo/native-vs-polyfill.html are
// earlier-session artifacts (index.html leans on box-drawing art); ASCII-cleaning
// them is an out-of-scope refactor for SF3, so they are deliberately not walked
// here. The gate has full teeth over everything SF3 produces.
test('ASCII gate: the SF3 demo and every recipe are ASCII (U+00D7, U+00B5 excepted)', () => {
    const files = [DEMO_HTML].concat(walk(join(ROOT, 'recipes')));
    assert.ok(files.length > 1, 'no SF3 demo/recipe files found');
    for (const f of files) {
        const src = readFileSync(f, 'utf8');
        for (let i = 0; i < src.length; i++) {
            const c = src.charCodeAt(i);
            if (c <= 0x7f || c === 0x00d7 || c === 0x00b5) continue;
            const line = src.slice(0, i).split('\n').length;
            assert.fail(f + ':' + line + ' has non-ASCII U+' +
                c.toString(16).padStart(4, '0') + ' -- Law violation');
        }
    }
});

// ---- headless truth: the ceilings varying-control, measured here ---------
// Mirrors test/ceilings.test.js hotState: two non-transform numeric props
// (opacity + a custom) AND all three individual transform components = five
// changed properties per varying frame, one write string each.
function hotState(selector) {
    makeEl(selector);
    const state = _createTrackState({
        selector: selector, timeline: { kind: 'view' },
        keyframes: [
            { opacity: 0, '--tint': 0,   translateX: 0,  translateY: 30, scale: 1,   rotate: 0 },
            { opacity: 1, '--tint': 240, translateX: 10, translateY: 0,  scale: 1.5, rotate: 45 }
        ],
        easing: 'linear'
    });
    state.rangeStart = 0;
    state.rangeEnd = 1;
    return state;
}

function measuredWritesPerFrame() {
    const state = hotState('.demo-guard-vary');
    const style = makeCountingStyle();
    state.el.style = style;
    for (let i = 0; i < 1000; i++) _applyTrackFrame(state, i / 999);
    return { total: style.numericStrings + style.transformStrings, frames: 1000 };
}

function measuredIdenticalWrites() {
    const state = hotState('.demo-guard-ident');
    const style = makeCountingStyle();
    state.el.style = style;
    _applyTrackFrame(state, 0.5);   // prime from the sentinel
    style.numericStrings = 0; style.transformStrings = 0;
    for (let i = 0; i < 1000; i++) _applyTrackFrame(state, 0.5);
    return style.numericStrings + style.transformStrings;
}

// ---- parse the demo's committed constants --------------------------------
function demoSrc() { return readFileSync(DEMO_HTML, 'utf8'); }

function num(re, label) {
    const m = demoSrc().match(re);
    assert.ok(m, 'demo/scrollforge.html: could not find ' + label);
    return Number(m[1]);
}

test('scene 04: demo WRITES_PER_FRAME == headless-measured per-frame count; 1000-frame total == 5000; identical == 0', () => {
    const measured = measuredWritesPerFrame();
    const perFrame = measured.total / measured.frames;
    assert.equal(measured.total, 5000, 'ceilings varying-control changed: total ' + measured.total + ' != 5000');
    assert.equal(perFrame, 5, 'measured per-frame writes ' + perFrame + ' != 5');
    assert.equal(measuredIdenticalWrites(), 0, 'identical frames wrote > 0 -- dirty check regressed');

    const wpf = num(/const WRITES_PER_FRAME = (\d+);/, 'WRITES_PER_FRAME');
    const frames = num(/const ZEROGC_FRAMES = (\d+);/, 'ZEROGC_FRAMES');
    assert.equal(wpf, perFrame,
        'demo WRITES_PER_FRAME (' + wpf + ') != headless-measured (' + perFrame + ')');
    assert.equal(wpf * frames, 5000,
        'demo WRITES_PER_FRAME*ZEROGC_FRAMES (' + (wpf * frames) + ') != ceilings 5000');
});

test('scene 04: the demo scene-04 storyboard has exactly WRITES_PER_FRAME non-transform props', () => {
    const src = demoSrc();
    const m = src.match(/const ZEROGC_STORYBOARD = \{[\s\S]*?keyframes:\s*\[\s*(\{[^}]*\})/);
    assert.ok(m, 'could not locate ZEROGC_STORYBOARD first keyframe');
    // count declared keys in the first keyframe (opacity + custom props).
    const keys = m[1].match(/(?:'--[a-z-]+'|[a-zA-Z]+)\s*:/g) || [];
    const wpf = num(/const WRITES_PER_FRAME = (\d+);/, 'WRITES_PER_FRAME');
    assert.equal(keys.length, wpf,
        'scene-04 storyboard animates ' + keys.length + ' props but WRITES_PER_FRAME is ' + wpf +
        ' -- the page counter would not equal the committed constant');
});

test('scene 02: demo PARITY_TOL == DEMO_SCENE02.tol == the 0003 tolerances', () => {
    const src = demoSrc();
    const m = src.match(/const PARITY_TOL = \{ opacity: ([\d.]+), transformPx: ([\d.]+), matrix: ([\d.]+), custom: ([\d.]+) \};/);
    assert.ok(m, 'could not parse PARITY_TOL from the demo');
    const tol = { opacity: +m[1], transformPx: +m[2], matrix: +m[3], custom: +m[4] };
    assert.deepEqual(tol, {
        opacity: DEMO_SCENE02.tol.opacity,
        transformPx: DEMO_SCENE02.tol.transformPx,
        matrix: DEMO_SCENE02.tol.matrix,
        custom: DEMO_SCENE02.tol.custom
    }, 'demo PARITY_TOL drifted from storyboards.mjs DEMO_SCENE02.tol (the 0003 tolerances)');
});

test('scene 02: the demo storyboard matches storyboards.mjs DEMO_SCENE02', () => {
    const src = demoSrc();
    // range endpoints
    assert.ok(src.includes("start: '" + DEMO_SCENE02.range.start + "'") &&
        src.includes("end: '" + DEMO_SCENE02.range.end + "'"),
        'demo scene-02 range != DEMO_SCENE02 (' + DEMO_SCENE02.range.start + ' .. ' + DEMO_SCENE02.range.end + ')');
    // easing
    assert.ok(src.includes("easing: '" + DEMO_SCENE02.easing + "'"),
        'demo scene-02 easing != DEMO_SCENE02.easing (' + DEMO_SCENE02.easing + ')');
    // both keyframes, by their exact { opacity, translateY } values
    for (const kf of DEMO_SCENE02.keyframes) {
        const frag = '{ opacity: ' + kf.opacity + ', translateY: ' + kf.translateY + ' }';
        assert.ok(src.includes(frag),
            'demo scene-02 is missing keyframe ' + frag + ' from DEMO_SCENE02');
    }
});

// The default author storyboard scene 03 compiles (rise preset, default cfg).
// Mirrors demo buildAuthorStoryboard({ preset:'rise', ty:40, scale:1,
// easing:'easeOutCubic' }).
function defaultAuthorStoryboard() {
    return { tracks: [{
        selector: '#author-card', timeline: { kind: 'view' },
        range: { start: 'entry 0%', end: 'entry 100%' },
        keyframes: [{ opacity: 0, translateY: 40, scale: 1 }, { opacity: 1, translateY: 0, scale: 1 }],
        easing: 'easeOutCubic'
    }] };
}

test('scene 03: native / GSAP / rig panes are each non-empty for the default storyboard (native has @keyframes)', () => {
    const sb = defaultAuthorStoryboard();

    // storyboardToCss returns a STRING. Reading `.css` off it (the regressed
    // demo bug) yields undefined -> a blank pane. Assert the real emitters here.
    const nativeCss = storyboardToCss(sb);
    assert.equal(typeof nativeCss, 'string', 'storyboardToCss must return a string, not an object');
    assert.ok(nativeCss.length > 0, 'native CSS pane would be empty');
    assert.match(nativeCss, /@keyframes/, 'native CSS pane is missing @keyframes');

    const gsap = toGsap(sb, { moduleFormat: 'esm' });
    assert.ok(typeof gsap === 'string' && gsap.length > 0, 'GSAP pane would be empty');

    const rig = toRig(sb, { moduleFormat: 'esm' });
    assert.ok(typeof rig === 'string' && rig.length > 0, 'rig pane would be empty');
});

test('scene 03: the demo reads the storyboardToCss STRING directly (no .css-off-a-string regression)', () => {
    const src = demoSrc();
    // The exact regression the reviewer flagged: storyboardToCss(...).css reads a
    // property off a string -> undefined -> blank native pane. Fail if it returns.
    assert.ok(!/storyboardToCss\([^)]*\)\s*\.css/.test(src),
        'demo reads .css off storyboardToCss (which returns a STRING) -- the native pane would render blank');
    assert.match(src, /code = storyboardToCss\(sb\);/,
        'demo native branch must assign the storyboardToCss string directly');
});
