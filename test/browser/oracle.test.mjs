// test/browser/oracle.test.mjs -- node --test test/browser/oracle.test.mjs
//
// THE NATIVE-PARITY ORACLE.
// Runs each storyboard in one real Chromium, mounted TWICE (native-forced CSS
// injection vs polyfill-forced JS drive), scripted-scrolls the on-screen band,
// reads getComputedStyle on the paired subjects, and diffs per property.
//
//   parityScore = { maxDev, rmsDev } per property per storyboard.
//     - opacity   : |native - polyfill|, absolute.
//     - matrixPx  : max |native - polyfill| over the composed matrix's e,f
//                   (translate, in px).
//     - matrixUnit: max |native - polyfill| over a,b,c,d (rotate/scale/skew,
//                   unitless).
//     - custom    : |native - polyfill| per registered <number> property.
//   Every corpus item must sit inside its committed tolerance (measured then
//   pinned; see decisions/0003-parity.md).
//
// THE CONTROL (control-transform-order): mounted THREE times -- native,
// polyfill-individual, polyfill-legacy. The individual leg MUST match native
// within tolerance; the legacy leg MUST exceed it by a wide margin. If both
// pass, the oracle is blind.
//
// Browser policy: FAIL-CLOSED. Missing/insufficient Chromium is a FAILURE, not
// a skip, unless LITE_NO_BROWSER=1 -- then this lane skips loudly and the Node
// lanes still gate.

import test from 'node:test';
import assert from 'node:assert/strict';
import { runScenarios } from './runner.mjs';
import { CORPUS, CONTROL, inject, collect, makeScenario } from './storyboards.mjs';
import { pairScore } from './score.mjs';

const SKIP = process.env.LITE_NO_BROWSER === '1';
const VIEW = 'animation-timeline: view()';

// --- scoring ----------------------------------------------------------------
// The scorer itself (push/newAcc/fin/pairScore, fail-closed on non-finite
// deviations) lives in ./score.mjs -- a tiny zero-dep module shared with the
// headless boundary suite (scorer.test.mjs), so the fail-closed contract is
// unit-tested independent of Chromium availability.
function f(x) { return x.toFixed(4); }

// --- the run --------------------------------------------------------------
test('oracle: polyfill matches native across the storyboard corpus', { skip: SKIP }, async () => {
    const scenarios = CORPUS.concat([CONTROL]).map(makeScenario);
    const results = await runScenarios({
        pageUrl: 'about:blank',
        inject: inject,
        scenarios: scenarios,
        collect: collect,
        options: { headless: true, viewport: { width: 800, height: 600 },
            requireSupport: VIEW, onLog: function (s) { console.log('  [runner] ' + s); } }
    });

    assert.equal(results.length, scenarios.length,
        'expected ' + scenarios.length + ' scenario results, got ' + results.length);

    let controlSeen = false;
    for (const r of results) {
        const snap = r.snapshot;
        assert.ok(snap && snap.samples && snap.samples.length > 1,
            r.name + ': no samples collected');

        if (r.name === CONTROL.name) {
            controlSeen = true;
            const ind = pairScore(snap.samples, 'native', 'polyfill', ['matrix']);
            const leg = pairScore(snap.samples, 'native', 'legacy', ['matrix']);
            const indDev = Math.max(ind.matrixPx.maxDev, ind.matrixUnit.maxDev);
            const legDev = Math.max(leg.matrixPx.maxDev, leg.matrixUnit.maxDev);
            console.log('  ' + r.name.padEnd(24) +
                ' individual maxDev=' + f(indDev) + ' legacy maxDev=' + f(legDev));
            // individual PASSES
            assert.ok(ind.matrixUnit.maxDev <= snap.tol.matrix && ind.matrixPx.maxDev <= snap.tol.transformPx,
                'control individual leg must MATCH native (matrixUnit ' + f(ind.matrixUnit.maxDev) +
                ' <= ' + snap.tol.matrix + ', px ' + f(ind.matrixPx.maxDev) + ' <= ' + snap.tol.transformPx + ')');
            // legacy FAILS parity -- the oracle has teeth
            assert.ok(legDev > snap.tol.matrix * 3,
                'control legacy leg must FAIL parity (clobbers author transform): maxDev ' +
                f(legDev) + ' must exceed 3x tol ' + snap.tol.matrix + ' -- oracle is blind otherwise');
            continue;
        }

        const sc = pairScore(snap.samples, 'native', 'polyfill', snap.compare);
        const tol = snap.tol;
        console.log('  ' + r.name.padEnd(24) +
            (snap.known ? '[KNOWN ' + snap.known + '] ' : '') +
            ' opacity=' + f(sc.opacity.maxDev) +
            ' px=' + f(sc.matrixPx.maxDev) +
            ' mat=' + f(sc.matrixUnit.maxDev) +
            (snap.compare.indexOf('custom') !== -1
                ? ' custom=' + f(maxCustom(sc.custom)) : ''));

        // QUARANTINE TRIPWIRE: a known divergence MUST still diverge. If a
        // future SF0 fix makes it match native, this assertion fails on purpose
        // -- lift the quarantine (drop the `known` flag) and let it gate.
        if (snap.known) {
            const worst = Math.max(sc.opacity.maxDev, sc.matrixPx.maxDev, sc.matrixUnit.maxDev);
            const ceil = Math.max(tol.opacity, tol.transformPx, tol.matrix);
            // Fail closed even on the inverted assertion: a non-finite `worst`
            // (Infinity via the push() NaN guard) means measurement broke, NOT
            // that the item healthily diverges. Require finite divergence so a
            // future NaN-prone `known` item can't stay quarantined on broken data.
            assert.ok(Number.isFinite(worst) && worst > ceil,
                r.name + ': KNOWN divergence ' + snap.known + ' no longer diverges (worst ' +
                f(worst) + ' <= tol ' + f(ceil) + ') -- the SF0 bug appears FIXED. ' +
                'Remove the `known` flag in storyboards.mjs and let this item gate.');
            continue;
        }

        if (snap.compare.indexOf('opacity') !== -1) {
            assert.ok(sc.opacity.maxDev <= tol.opacity,
                r.name + ': opacity maxDev ' + f(sc.opacity.maxDev) + ' > tol ' + tol.opacity);
        }
        if (snap.compare.indexOf('matrix') !== -1) {
            assert.ok(sc.matrixPx.maxDev <= tol.transformPx,
                r.name + ': transform-px maxDev ' + f(sc.matrixPx.maxDev) + ' > tol ' + tol.transformPx);
            assert.ok(sc.matrixUnit.maxDev <= tol.matrix,
                r.name + ': matrix-unit maxDev ' + f(sc.matrixUnit.maxDev) + ' > tol ' + tol.matrix);
        }
        if (snap.compare.indexOf('custom') !== -1) {
            // Fail closed: a 'custom' comparison that scored ZERO properties
            // asserts nothing -- an empty loop is a silent pass. Require at
            // least one registered custom prop to have flowed through.
            assert.ok(Object.keys(sc.custom).length > 0,
                r.name + ': compare requests custom but no custom property was scored ' +
                '(registration or measurement failed) -- nothing to gate');
            for (const name in sc.custom) {
                assert.ok(sc.custom[name].maxDev <= tol.custom,
                    r.name + ': custom ' + name + ' maxDev ' + f(sc.custom[name].maxDev) + ' > tol ' + tol.custom);
            }
        }
    }
    assert.ok(controlSeen, 'control storyboard did not run');
});

function maxCustom(custom) {
    let m = 0;
    for (const n in custom) m = Math.max(m, custom[n].maxDev);
    return m;
}

if (SKIP) console.log('[oracle] LITE_NO_BROWSER=1 -- browser lane SKIPPED (Node lanes still gate).');
