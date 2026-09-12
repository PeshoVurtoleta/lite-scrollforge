// test/harness-guard.test.js -- part of `npm test` (no Chromium required).
//
// Guards the browser oracle's page harness against SYMBOL DRIFT without a
// browser. The oracle (test:browser) is the only lane that exercises the page
// harness, and it is opt-in / skippable (LITE_NO_BROWSER=1) and slow -- so a
// rename in Scrollforge.js, a broken export strip, or a missing peer symbol
// would silently break the browser lane while the publish-gating node suite
// stayed green. This closes that gap the way RigPro's import-map-guard does:
// cheap node assertions that would fail the instant the harness's assumptions
// break.

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import * as SF from '../Scrollforge.js';
import { SCROLLFORGE_SRC } from './browser/storyboards.mjs';
import { easeOutBounce, easeInOutElastic, easeOutBack, easeInOutSine } from '@zakkster/lite-ease';

// The internal drive-train symbols test/torture.mjs imports by name.
const TORTURE_INTERNALS = ['_createTrackState', '_computeFrame', '_applyTrackFrame', '_installViewTicker'];
// The public API the browser + emitter lanes call.
const PUBLIC_API = ['attachStoryboardRuntime', 'toGsap', 'toRig', 'linearPoints'];

test('harness guard: internal drive-train symbols torture.mjs imports still exist', () => {
    for (const name of TORTURE_INTERNALS) {
        assert.equal(typeof SF[name], 'function',
            'Scrollforge.js no longer exports ' + name + ' -- test/torture.mjs import would break');
    }
});

test('harness guard: public symbols the browser + emitter lanes call still exist', () => {
    for (const name of PUBLIC_API) {
        assert.equal(typeof SF[name], 'function',
            'Scrollforge.js no longer exports ' + name + ' -- a harness/emitter call would break');
    }
});

test('harness guard: lite-ease peer symbols the corpus imports still exist', () => {
    // storyboards.mjs builds its easing corpus from these; a peer rename would
    // make the browser lane throw at import, not gate.
    for (const [name, fn] of [['easeOutBounce', easeOutBounce], ['easeInOutElastic', easeInOutElastic],
        ['easeOutBack', easeOutBack], ['easeInOutSine', easeInOutSine]]) {
        assert.equal(typeof fn, 'function', '@zakkster/lite-ease no longer exports ' + name);
    }
});

test('harness guard: stripped SCROLLFORGE_SRC parses and defines the page globals the oracle drives', () => {
    // This is what the browser lane relies on: storyboards.mjs strips `export `
    // from Scrollforge.js and injects it as a CLASSIC script, so every top-level
    // `function` becomes a page global. Replicate that in a vm sandbox -- a
    // strip regression, a stray `import`, or an undefined name in the trailing
    // `export { ... }` block would throw here, and a rename would leave the
    // global undefined. Either way the browser lane would hang with no drive fn;
    // this catches it in the node suite instead.
    const sandbox = {
        window: {}, document: { querySelector: () => null },
        CSS: { supports: () => true },
        IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
        requestAnimationFrame: () => 1, cancelAnimationFrame: () => {}
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);

    assert.doesNotThrow(() => vm.runInContext(SCROLLFORGE_SRC, sandbox),
        'stripped SCROLLFORGE_SRC failed to parse/run as a classic script (strip regression, stray import, or undefined export-block name)');

    // Top-level `export function` -> classic-script global; this is the drive
    // entry point the page harness calls on every leg.
    assert.equal(typeof sandbox.attachStoryboardRuntime, 'function',
        'attachStoryboardRuntime is not a global after the export strip -- the oracle page would have no drive function');
    assert.equal(typeof sandbox.toGsap, 'function', 'toGsap not defined as a page global after strip');
});
