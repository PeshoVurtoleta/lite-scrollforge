// test/browser/score.mjs -- the fail-closed scorer, shared by the browser
// oracle (oracle.test.mjs) and the headless boundary suite (scorer.test.mjs).
//
// Zero deps. No browser, no Playwright import -- pure arithmetic over plain
// structured-clonable sample data, so it is importable and testable without
// Chromium. This is the load-bearing contract: a deviation the runner could
// not actually MEASURE (a missing leg, an unparseable getComputedStyle, an
// unregistered custom prop) must fail every gate, never silently score as
// perfect parity. null is not zero.
//
//   parityScore = { maxDev, rmsDev } per property per storyboard.
//     - opacity   : |native - polyfill|, absolute.
//     - matrixPx  : max |native - polyfill| over the composed matrix's e,f
//                   (translate, in px).
//     - matrixUnit: max |native - polyfill| over a,b,c,d (rotate/scale/skew,
//                   unitless).
//     - custom    : |native - polyfill| per registered <number> property.

export function newAcc() { return { max: 0, sumSq: 0, n: 0 }; }

// Fail closed: a non-finite deviation is an UNMEASURED state, not a zero. NaN
// (a missing leg, an unparseable getComputedStyle, an unregistered custom prop)
// fails every `d > a.max` test, so without this it would leave max at 0 and
// pass `<= tol` -- the oracle reporting parity exactly when measurement broke.
// Drive it to Infinity instead so the gate fails loudly. null is not zero.
export function push(a, d) { if (!Number.isFinite(d)) d = Infinity; if (d > a.max) a.max = d; a.sumSq += d * d; a.n++; }

export function fin(a) { return { maxDev: a.max, rmsDev: a.n ? Math.sqrt(a.sumSq / a.n) : 0 }; }

function finalize(acc) {
    const out = { opacity: fin(acc.opacity), matrixPx: fin(acc.matrixPx),
        matrixUnit: fin(acc.matrixUnit), custom: Object.create(null) };
    for (const name in acc.custom) out.custom[name] = fin(acc.custom[name]);
    return out;
}

export function pairScore(samples, legA, legB, compare) {
    const acc = {
        opacity: newAcc(), matrixPx: newAcc(), matrixUnit: newAcc(),
        custom: Object.create(null)
    };
    for (let i = 0; i < samples.length; i++) {
        const a = samples[i].legs[legA];
        const b = samples[i].legs[legB];
        if (compare.indexOf('opacity') !== -1) push(acc.opacity, Math.abs(a.opacity - b.opacity));
        if (compare.indexOf('matrix') !== -1) {
            push(acc.matrixPx, Math.max(Math.abs(a.matrix[4] - b.matrix[4]),
                Math.abs(a.matrix[5] - b.matrix[5])));
            let mu = 0;
            for (let k = 0; k < 4; k++) mu = Math.max(mu, Math.abs(a.matrix[k] - b.matrix[k]));
            push(acc.matrixUnit, mu);
        }
        if (compare.indexOf('custom') !== -1) {
            for (const name in a.custom) {
                if (!acc.custom[name]) acc.custom[name] = newAcc();
                push(acc.custom[name], Math.abs(a.custom[name] - b.custom[name]));
            }
        }
    }
    return finalize(acc);
}
