// test/browser/emitter.test.mjs -- node --test test/browser/emitter.test.mjs
//
// EMITTER CONFORMANCE -- the cheap half of parity (headless, no browser).
//   1. SNAPSHOTS: toGsap / toRig output is pinned to committed .txt files.
//      Drift is a REVIEWED diff, not an accident. Regenerate deliberately with
//      UPDATE_SNAPSHOTS=1.
//   2. PARSE GATE: every generated module must be syntactically valid. We emit
//      the CJS form and compile it with `new Function(...)` -- which PARSES the
//      full source (including the require() calls) but never EXECUTES it, so no
//      gsap / lite-scroll-rig-pro runtime is needed.
//
// OUT OF SCOPE (recorded, decisions/0003-parity.md): a live-GSAP EXECUTION lane.
// Running the generated GSAP/rig code would need those frameworks as dev
// dependencies; the suite keeps zero third-party runtime deps, even in dev. The
// snapshot + parse gate proves the emitter's SHAPE and SYNTAX; behavioral parity
// of GSAP itself is GSAP's concern, not this package's.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { toGsap, toRig } from '../../Scrollforge.js';

const UPDATE = process.env.UPDATE_SNAPSHOTS === '1';
const SNAP_DIR = new URL('./emitter-snapshots/', import.meta.url);

// Deterministic storyboards spanning the emitter's branches: multi-track
// sequence, scroll timeline, a bounce easing (CustomEase path), a contain
// range (the approximated path), and non-transform props (dropped by toRig).
const BOARDS = [
    { name: 'quickstart', sb: { tracks: [{
        selector: '.hero-title', timeline: { kind: 'view' },
        range: { start: 'entry 0%', end: 'entry 100%' },
        keyframes: [{ opacity: 0, translateY: 30 }, { opacity: 1, translateY: 0 }],
        easing: 'easeOutCubic' }] } },
    { name: 'sequence', sb: { tracks: [
        { selector: '.card-1', timeline: { name: '--gallery' }, range: { start: '0%', end: '33%' },
          keyframes: [{ opacity: 0, translateY: 20, scale: 0.9 }, { opacity: 1, translateY: 0, scale: 1 }],
          easing: 'easeOutQuad' },
        { selector: '.card-2', timeline: { name: '--gallery' }, range: { start: '33%', end: '66%' },
          keyframes: [{ opacity: 0, rotate: -8 }, { opacity: 1, rotate: 0 }], easing: 'easeInOutSine' }
    ] } },
    { name: 'scroll-bounce', sb: { tracks: [{
        selector: '.parallax', timeline: { kind: 'scroll', scroller: 'root' },
        keyframes: [{ translateY: 0, scale: 1 }, { translateY: -200, scale: 1.2 }],
        easing: 'easeOutBack' }] } },
    { name: 'contain-filter', sb: { tracks: [{
        selector: '.panel', timeline: { kind: 'view' },
        range: { start: 'contain 0%', end: 'contain 100%' },
        keyframes: [{ opacity: 0.2, filter: 'blur(8px)', translateX: -40 },
                    { opacity: 1, filter: 'blur(0px)', translateX: 0 }],
        easing: 'easeInOutCubic' }] } }
];

const TARGETS = [
    { tag: 'gsap', fn: toGsap },
    { tag: 'rig', fn: toRig }
];

function snapPath(name, tag) { return new URL(name + '.' + tag + '.txt', SNAP_DIR); }

test('emitter: toGsap / toRig snapshots are current', function () {
    if (UPDATE && !existsSync(SNAP_DIR)) mkdirSync(SNAP_DIR, { recursive: true });
    for (const board of BOARDS) {
        for (const target of TARGETS) {
            const out = target.fn(board.sb, { moduleFormat: 'esm' });
            const p = snapPath(board.name, target.tag);
            if (UPDATE) {
                writeFileSync(p, out);
                console.log('  wrote snapshot ' + board.name + '.' + target.tag + '.txt');
                continue;
            }
            assert.ok(existsSync(p),
                'missing snapshot ' + board.name + '.' + target.tag +
                '.txt -- run UPDATE_SNAPSHOTS=1 to create it');
            const expected = readFileSync(p, 'utf8');
            assert.equal(out, expected,
                board.name + '.' + target.tag + ' drifted from its committed snapshot ' +
                '(reviewed diff expected; UPDATE_SNAPSHOTS=1 to re-pin)');
        }
    }
});

test('emitter: every generated module parses (new Function syntax gate)', function () {
    for (const board of BOARDS) {
        for (const target of TARGETS) {
            // CJS form: `new Function` PARSES the require() calls but never runs
            // them, so no gsap / rig runtime is needed to prove syntactic validity.
            const cjs = target.fn(board.sb, { moduleFormat: 'cjs' });
            assert.doesNotThrow(function () {
                // eslint-disable-next-line no-new-func
                new Function('require', 'module', 'exports', cjs);
            }, board.name + '.' + target.tag + ' (cjs) is not syntactically valid');

            // ESM form: validate by compiling with export/import tokens removed
            // (structure-only check; still catches unbalanced braces / bad literals).
            const esm = target.fn(board.sb, { moduleFormat: 'esm' })
                .replace(/^import[^\n]*$/gm, '')
                .replace(/^export /gm, '');
            assert.doesNotThrow(function () {
                // eslint-disable-next-line no-new-func
                new Function('gsap', 'ScrollTrigger', esm);
            }, board.name + '.' + target.tag + ' (esm) is not syntactically valid');
        }
    }
});
