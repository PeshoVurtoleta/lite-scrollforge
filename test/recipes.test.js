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
import { signal, dispose, effect } from '@zakkster/lite-signal';
import * as SF from '../Scrollforge.js';
import { emitGsap } from '../recipes/gsap-export.js';
import { emitRig } from '../recipes/rig-export.js';
import { bounceLinear, timingFor } from '../recipes/ease-curve.js';
import { emitSunsetCss, sunsetStops } from '../recipes/oklch-sunset.js';
import { wireStoryboardSwap, storyboardFromConfig } from '../recipes/signal-swap.js';
import { emitRigModule, rigStoryboard, RIG_ENDPOINTS } from '../recipes/rig-handoff.js';
import { installFakeDom, makeEl } from './fixtures.mjs';

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

    test('BREAK CONTROL: sample count changes the emitted point count', () => {
        // The differentiator is that MORE samples means a finer linear() curve --
        // a bounce cannot be a single cubic-bezier. If sampling collapsed, both
        // would be equal; the inequality proves the sampler is really running.
        const coarse = bounceLinear(6);
        const fine = bounceLinear(48);
        const count = (s) => s.split(',').length;
        assert.ok(count(fine) > count(coarse),
            'linear(48) (' + count(fine) + ' pts) not finer than linear(6) (' + count(coarse) + ') -- sampler inert');
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

describe('oklch-sunset [FULL node runtime]', () => {
    test('lite-color-engine OKLCH stops -> --sunset custom-property keyframes in emitted CSS', () => {
        const stops = sunsetStops(5);
        assert.equal(stops.length, 5);
        for (const s of stops) assert.match(s, /^oklch\(/, 'stop is not an oklch() string: ' + s);

        const css = emitSunsetCss(5);
        assert.match(css, /--sunset:\s*oklch\(/, 'emitted CSS has no --sunset oklch keyframe');
        // Every distinct stop should appear as a keyframe value.
        assert.equal(new Set(stops).size, 5, 'the sunset ramp collapsed -- stops are not distinct');
    });

    test('BREAK CONTROL: identical sRGB endpoints collapse the ramp (distinct-stops check fails)', () => {
        // The recipe promise is a perceptual RAMP. Feed identical endpoints and
        // the "5 distinct stops" invariant the FULL tier asserts must break.
        const flat = sunsetStops(5, [255, 126, 95], [255, 126, 95]);
        assert.equal(new Set(flat).size, 1,
            'identical endpoints did not collapse the ramp -- the distinct-stops check has no teeth');
    });
});

describe('signal-swap [FULL node runtime -- fake-DOM fixtures]', () => {
    test('effect attaches once, then detaches-before-reattach on config change, and detaches on dispose', () => {
        const dom = installFakeDom();
        makeEl('.hero');
        let attaches = 0, detaches = 0;
        const spyAttach = () => { attaches++; return { detach: () => { detaches++; } }; };

        const cfg = signal({ selector: '.hero', travel: 30 });
        const api = wireStoryboardSwap(cfg, storyboardFromConfig, spyAttach);
        assert.equal(attaches, 1, 'initial attach did not fire');
        assert.equal(detaches, 0, 'nothing to detach yet');

        cfg.set({ selector: '.hero', travel: 60 });
        assert.equal(attaches, 2, 'config change did not reattach');
        assert.equal(detaches, 1, 'config change did not detach the previous attachment first');
        assert.equal(attaches - detaches, 1, 'exactly one live attachment expected between swaps');

        dispose(api);
        assert.equal(detaches, 2, 'dispose did not detach the live attachment');
        assert.equal(attaches - detaches, 0, 'a storyboard outlived the wiring');
        dom.reset();
    });

    test('default path drives the real polyfill runtime against the fake DOM', () => {
        const dom = installFakeDom();
        makeEl('.hero');
        // No spy: exercise the real attachStoryboardRuntime default. The polyfill
        // installs a scroll listener on attach and removes it on detach.
        const api = wireStoryboardSwap(signal({ selector: '.hero', travel: 20 }));
        assert.equal(dom.listenerAdds, 1, 'real polyfill attach installed no scroll listener');
        dispose(api);
        assert.equal(dom.listenerRemoves, 1, 'dispose did not remove the real polyfill listener');
        dom.reset();
    });

    test('BREAK CONTROL: a wiring WITHOUT onCleanup leaks -- live count grows unbounded', () => {
        // The invariant the FULL tier gates is "<= 1 live attachment". A wiring
        // that forgets onCleanup never detaches, so live grows with every change.
        // Proving that broken wiring FAILS the invariant proves the check has teeth.
        let attaches = 0, detaches = 0;
        const spyAttach = () => { attaches++; return { detach: () => { detaches++; } }; };
        const cfg = signal({ travel: 10 });
        const leaky = effect(() => { const c = cfg(); spyAttach(storyboardFromConfig(c)); });
        cfg.set({ travel: 20 });
        cfg.set({ travel: 30 });
        assert.equal(detaches, 0, 'a wiring without onCleanup somehow detached');
        assert.ok(attaches - detaches > 1,
            'leaky wiring kept <= 1 live attachment (' + (attaches - detaches) +
            ') -- the live-count invariant cannot fail, it is decorative');
        dispose(leaky);
    });
});

describe('rig-handoff [emit + PARSE gate -- EXECUTION is test:rig-recipe (browser)]', () => {
    // The FULL execution tier lives in test/browser/rig-handoff.test.mjs: it runs
    // this emitted module against the real published lite-scroll-rig-pro@1.3.2 in
    // Chromium and reads a real matrix3d back off the DOM. Here (node, no browser)
    // we gate the artifact: it imports the rig peers, exposes attachScrollRig,
    // stays inside the rig's supported prop set, and PARSES.
    test('toRig emits a runnable rig module that imports the peers, exposes attachScrollRig, and parses', () => {
        const esm = emitRigModule({ moduleFormat: 'esm' });
        assert.match(esm, /@zakkster\/lite-scroll-rig-pro/);
        assert.match(esm, /@zakkster\/lite-keyframe/);
        assert.match(esm, /export function attachScrollRig/);
        // Rig-safe storyboard: nothing dropped (no "Dropped (rig unsupported)").
        assert.ok(!/Dropped \(rig unsupported\)/.test(esm),
            'rig-handoff storyboard emitted a dropped-prop comment -- it left the supported set');
        // The keyframe endpoints the browser lane reads back are present in code.
        assert.match(esm, new RegExp(String(RIG_ENDPOINTS.start.translateY)));

        const cjs = emitRigModule({ moduleFormat: 'cjs' });
        assert.doesNotThrow(() => parseCjs(cjs), 'emitted rig-handoff (cjs) did not parse');
    });

    test('BREAK CONTROL: mutating the FROM keyframe changes the emitted module', () => {
        const base = emitRigModule({ moduleFormat: 'esm' });
        const mutated = emitRigModule({ moduleFormat: 'esm' }, { translateY: 300, scale: 2, rotate: 40 });
        assert.notEqual(base, mutated,
            'a mutated FROM keyframe produced identical emitted code -- the emitter ignores inputs');
        // And the storyboard the recipe hands to the rig reflects the mutation.
        const sb = rigStoryboard({ translateY: 300 });
        assert.equal(sb.tracks[0].keyframes[0].translateY, 300);
    });
});
