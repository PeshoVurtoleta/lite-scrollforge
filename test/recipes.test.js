// test/recipes.test.js -- part of `npm test` (no Chromium required).
//
// THE RECIPE TIER. Each recipe in recipes/ is tested at an HONESTLY NAMED level
// (in its describe), so nobody mistakes a spelling gate for a runtime gate:
//
//   gsap-export  FULL node runtime -- emits GSAP, asserts the wiring + PARSE gate.
//   rig-export   FULL node runtime -- emits rig code, asserts imports + PARSE gate.
//   ease-curve   FULL node runtime -- lite-ease curve -> CSS linear(); mapper routes.
//   react-hook   SPELLING GATE ONLY -- ASCII + every imported scrollforge symbol real.
//
// THE BREAK CONTROL: `SCROLLFORGE_RECIPE_BREAK=1 npm test` corrupts the emitted
// GSAP module before the parse gate, so the gsap-export FULL tier fails. A tier
// that cannot fail is decorative.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as SF from '../Scrollforge.js';
import { emitGsap } from '../recipes/gsap-export.js';
import { emitRig } from '../recipes/rig-export.js';
import { bounceLinear, timingFor } from '../recipes/ease-curve.js';

const BREAK = process.env.SCROLLFORGE_RECIPE_BREAK === '1';

// new Function PARSES require()/module/exports (and the require() calls inside)
// but never EXECUTES them, so no gsap / rig runtime is needed to prove syntax.
function parseCjs(cjs) {
    // eslint-disable-next-line no-new-func
    new Function('require', 'module', 'exports', cjs);
}

describe('gsap-export [FULL node runtime]', () => {
    test('emits runnable GSAP ScrollTrigger code that parses', () => {
        const esm = emitGsap({ moduleFormat: 'esm' });
        assert.match(esm, /gsap\.registerPlugin\(ScrollTrigger\)/);
        assert.match(esm, /scrollTrigger:/);
        assert.match(esm, /export function attachScrollAnimations/);

        let cjs = emitGsap({ moduleFormat: 'cjs' });
        // BREAK control: a tier that cannot fail is decorative.
        if (BREAK) cjs = cjs + '\nfunction ){ deliberately invalid';
        assert.doesNotThrow(() => parseCjs(cjs), 'emitted GSAP (cjs) did not parse');
    });
});

describe('rig-export [FULL node runtime]', () => {
    test('emits runnable lite-scroll-rig-pro code that parses', () => {
        const esm = emitRig({ moduleFormat: 'esm' });
        assert.match(esm, /@zakkster\/lite-scroll-rig-pro/);
        assert.match(esm, /@zakkster\/lite-keyframe/);
        assert.match(esm, /export function attachScrollRig/);

        const cjs = emitRig({ moduleFormat: 'cjs' });
        assert.doesNotThrow(() => parseCjs(cjs), 'emitted rig (cjs) did not parse');
    });
});

describe('ease-curve [FULL node runtime]', () => {
    test('lite-ease bounce -> CSS Level 4 linear() string; mapper routes name + bezier', () => {
        const s = bounceLinear(24);
        assert.match(s, /^linear\(/, 'expected a CSS linear() string');
        assert.ok(s.length > 'linear()'.length, 'linear() string has no sampled points');

        assert.equal(typeof timingFor('easeOutCubic'), 'string');
        assert.match(timingFor('cubic-bezier(0.4, 0, 0.2, 1)'), /cubic-bezier/);
    });
});

describe('react-hook [SPELLING GATE ONLY -- not executed]', () => {
    test('ASCII, non-empty, and every imported scrollforge symbol is real', () => {
        const src = readFileSync(new URL('../recipes/react-hook.jsx', import.meta.url), 'utf8');
        assert.ok(src.length > 0, 'react-hook.jsx is empty');
        assert.ok(!/[^\x00-\x7F]/.test(src), 'react-hook.jsx must be ASCII-only');

        const m = src.match(/import\s*\{([^}]*)\}\s*from\s*['"]@zakkster\/lite-scrollforge['"]/);
        assert.ok(m, 'react-hook.jsx must import from @zakkster/lite-scrollforge');
        const symbols = m[1].split(',').map((x) => x.trim()).filter(Boolean);
        assert.ok(symbols.length > 0, 'no symbols imported from the package');
        for (const sym of symbols) {
            assert.ok(sym in SF,
                'react-hook.jsx imports a non-existent scrollforge symbol: ' + sym);
        }
    });
});
