// test/browser/scorer.test.mjs -- node --test test/browser/scorer.test.mjs
//
// HEADLESS boundary suite for the fail-closed scorer (test/browser/score.mjs).
// node:test only. NO browser, no Playwright import -- pure arithmetic over
// plain structured-clonable sample data, so this gates even under
// LITE_NO_BROWSER=1, independent of Chromium availability.
//
// This locks the contract the reviewer just hardened:
//   - push() drives non-finite deviations to Infinity, never a passing 0.
//   - the custom branch refuses a zero-property comparison (proven at the
//     pairScore/oracle boundary; here we prove pairScore's raw output shape
//     that oracle.test.mjs's `Object.keys(sc.custom).length > 0` gate reads).
//   - the known-tripwire's `Number.isFinite(worst)` requirement is downstream
//     of push()'s Infinity guard -- proven directly here.
//
// Boundary matrix: 0, 1, N-1/N/N+1, empty, null, undefined, NaN, -0,
// idempotent fin() read (duplicate-dispose analogue -- there is no disposable
// resource here, so the closest hazard is a second read mutating state),
// re-entrant/rapid push, and one adversarial case the planner's spec did not
// name explicitly (a custom prop missing entirely from one leg, not merely
// NaN-valued -- same fail-closed path, different cause).

import test from 'node:test';
import assert from 'node:assert/strict';
import { newAcc, push, fin, pairScore } from './score.mjs';

// --- newAcc / fin: the empty-accumulator (n=0) boundary ---------------------

test('newAcc: fresh accumulator is the zero state (n=0 boundary)', () => {
    const a = newAcc();
    assert.deepEqual(a, { max: 0, sumSq: 0, n: 0 });
    const scored = fin(a);
    assert.equal(scored.maxDev, 0);
    assert.equal(scored.rmsDev, 0);
});

// --- push: fail-closed on non-finite deviations -----------------------------

test('push: NaN deviation drives maxDev to Infinity, not 0 (fail closed)', () => {
    const a = newAcc();
    push(a, NaN);
    const scored = fin(a);
    assert.equal(scored.maxDev, Infinity);
    // the load-bearing consequence: a `<= tol` gate must FAIL, never pass
    assert.equal(scored.maxDev <= 0.02, false);
});

test('push: undefined deviation is non-finite -- fails closed to Infinity', () => {
    const a = newAcc();
    push(a, undefined);
    assert.equal(fin(a).maxDev, Infinity);
});

test('push: null deviation is non-finite -- fails closed to Infinity', () => {
    const a = newAcc();
    push(a, null);
    assert.equal(fin(a).maxDev, Infinity);
});

test('push: -0 deviation is treated as 0, not a negative sentinel', () => {
    const a = newAcc();
    push(a, -0);
    const scored = fin(a);
    assert.equal(scored.maxDev, 0);
    assert.equal(scored.rmsDev, 0);
});

// --- push: finite deviations, the n=1 / N-1 / N / N+1 boundaries -----------

test('push: a single finite deviation (n=1) scores itself as both max and rms', () => {
    const a = newAcc();
    push(a, 0.5);
    const scored = fin(a);
    assert.equal(scored.maxDev, 0.5);
    assert.equal(scored.rmsDev, 0.5);
});

test('push: N-1/N/N+1 -- running max is correct at each boundary regardless of arrival order', () => {
    const a = newAcc();
    const values = [5, 3, 8, 1]; // N = 4
    push(a, values[0]); push(a, values[1]); push(a, values[2]); // N-1 = 3 pushes
    assert.equal(a.n, 3);
    assert.equal(fin(a).maxDev, 8);
    push(a, values[3]); // N = 4 pushes
    assert.equal(a.n, 4);
    assert.equal(fin(a).maxDev, 8);
    push(a, 2); // N+1 = 5 pushes
    assert.equal(a.n, 5);
    assert.equal(fin(a).maxDev, 8);
    const expectedRms = Math.sqrt((25 + 9 + 64 + 1 + 4) / 5);
    assert.equal(fin(a).rmsDev, expectedRms);
});

test('push: finite deviations still score correctly -- maxDev is the true max, rmsDev is sqrt(mean of squares)', () => {
    const a = newAcc();
    for (const d of [0.1, 0.4, 0.2]) push(a, d);
    const scored = fin(a);
    assert.equal(scored.maxDev, 0.4);
    const expectedRms = Math.sqrt((0.01 + 0.16 + 0.04) / 3);
    assert.ok(Math.abs(scored.rmsDev - expectedRms) < 1e-12,
        'rmsDev ' + scored.rmsDev + ' !~= ' + expectedRms);
});

test('push: re-entrant/rapid pushes on the same accumulator accumulate n and never reset a lower max', () => {
    const a = newAcc();
    for (let i = 0; i < 100; i++) push(a, i % 7); // non-monotone order, repeated values
    assert.equal(a.n, 100);
    assert.equal(fin(a).maxDev, 6);
});

test('fin: a duplicate read does not mutate the accumulator (duplicate-dispose analogue)', () => {
    const a = newAcc();
    push(a, 1); push(a, 3);
    const first = fin(a);
    const second = fin(a);
    assert.deepEqual(first, second);
    assert.equal(a.n, 2); // untouched by the read
});

// --- pairScore: the empty-samples / empty-custom-names cases ---------------

test('pairScore: empty samples array (n=0) scores every property as the zero state, not a false pass', () => {
    const scored = pairScore([], 'native', 'polyfill', ['opacity', 'matrix', 'custom']);
    assert.equal(scored.opacity.maxDev, 0);
    assert.equal(scored.matrixPx.maxDev, 0);
    assert.equal(scored.matrixUnit.maxDev, 0);
    assert.deepEqual(Object.keys(scored.custom), []); // empty-custom-names case
});

test('pairScore: compare requests custom but no sample carries a custom prop -- custom stays empty', () => {
    // This is the shape oracle.test.mjs's `Object.keys(sc.custom).length > 0`
    // gate exists to catch: an empty custom result must not silently pass.
    const samples = [
        { legs: { native: { opacity: 0.1, matrix: [1, 0, 0, 1, 0, 0], custom: {} },
            polyfill: { opacity: 0.1, matrix: [1, 0, 0, 1, 0, 0], custom: {} } } }
    ];
    const scored = pairScore(samples, 'native', 'polyfill', ['custom']);
    assert.deepEqual(Object.keys(scored.custom), []);
});

// --- pairScore: the custom branch fails closed ------------------------------

test('pairScore: a NaN-valued custom property between legs yields Infinity for that name (custom path fails closed)', () => {
    const samples = [
        { legs: {
            native: { opacity: 0, matrix: [1, 0, 0, 1, 0, 0], custom: { '--sf-x': 10 } },
            polyfill: { opacity: 0, matrix: [1, 0, 0, 1, 0, 0], custom: { '--sf-x': NaN } }
        } },
        { legs: {
            native: { opacity: 0, matrix: [1, 0, 0, 1, 0, 0], custom: { '--sf-x': 20 } },
            polyfill: { opacity: 0, matrix: [1, 0, 0, 1, 0, 0], custom: { '--sf-x': 20 } }
        } }
    ];
    const scored = pairScore(samples, 'native', 'polyfill', ['custom']);
    assert.equal(scored.custom['--sf-x'].maxDev, Infinity);
});

test('ADVERSARIAL: a custom prop present on leg A but entirely absent on leg B fails closed to Infinity', () => {
    // The planner's spec named an explicit NaN value. A custom property that
    // is simply MISSING from one leg's object (e.g. registerProperty failed
    // silently on one side, or a leg's read raced the property registration)
    // produces `undefined`; `Math.abs(x - undefined)` is NaN by a different
    // route -- the same push() guard must still catch it.
    const samples = [
        { legs: {
            native: { opacity: 0, matrix: [1, 0, 0, 1, 0, 0], custom: { '--sf-x': 10 } },
            polyfill: { opacity: 0, matrix: [1, 0, 0, 1, 0, 0], custom: {} } // missing entirely
        } }
    ];
    const scored = pairScore(samples, 'native', 'polyfill', ['custom']);
    assert.equal(scored.custom['--sf-x'].maxDev, Infinity);
});

// --- pairScore: a synthetic finite two-leg set scores correctly (control) --

test('pairScore: a finite two-leg sample set scores opacity/matrix correctly (non-fail-closed control)', () => {
    const samples = [
        { legs: { native: { opacity: 0, matrix: [1, 0, 0, 1, 0, 0], custom: {} },
            polyfill: { opacity: 0.01, matrix: [1, 0, 0, 1, 0.5, 0.2], custom: {} } } },
        { legs: { native: { opacity: 1, matrix: [1, 0, 0, 1, 10, 20], custom: {} },
            polyfill: { opacity: 0.98, matrix: [1, 0, 0, 1, 9.5, 20.2], custom: {} } } }
    ];
    const scored = pairScore(samples, 'native', 'polyfill', ['opacity', 'matrix']);
    assert.ok(Math.abs(scored.opacity.maxDev - 0.02) < 1e-12);
    assert.ok(Math.abs(scored.matrixPx.maxDev - 0.5) < 1e-9);
    assert.equal(scored.matrixUnit.maxDev, 0);
});
