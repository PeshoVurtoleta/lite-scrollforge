// recipes/signal-swap.js -- swap a live storyboard when config changes, driven
// by a @zakkster/lite-signal effect.
//
// Never ships (repo-only; not in package.json files[]). See recipes/README.md.
// Headless against the fake-DOM fixtures (test/fixtures.mjs) -- attach/detach
// touch the DOM, but the fixture stubs stand in, so the whole pattern is
// node-testable without a browser.
//
// The pattern: an `effect` reads the config signal (subscribing to it), attaches
// the storyboard for the current config, and registers `onCleanup(detach)`. When
// the config changes the effect re-runs; the reactive graph fires the previous
// run's cleanup FIRST (detaching the stale attachment) and only then reattaches.
// Disposing the effect fires the last cleanup, so nothing outlives the wiring.
//
// lite-leak contract, honored here so this doubles as a leak-safe template: the
// cleanup closure captures `handle` (a detach thunk), never the storyboard target
// or its elements -- capturing the target would defeat finalization.

import { effect, onCleanup } from '@zakkster/lite-signal';
import { attachStoryboardRuntime } from '@zakkster/lite-scrollforge';

// Build a storyboard from a plain config object. The config is what a signal
// carries; swapping any field (selector, travel, easing) produces a different
// storyboard, which is what makes the swap observable.
export function storyboardFromConfig(cfg) {
    const c = cfg || {};
    return {
        tracks: [
            {
                selector: c.selector || '.hero',
                timeline: { kind: 'view' },
                range: { start: 'entry 0%', end: 'entry 100%' },
                keyframes: [
                    { opacity: 0, translateY: typeof c.travel === 'number' ? c.travel : 30 },
                    { opacity: 1, translateY: 0 }
                ],
                easing: c.easing || 'easeOutCubic'
            }
        ]
    };
}

// A cleanup thunk that captures ONLY the detach handle -- factored out so the
// closure cannot accidentally close over the storyboard target or its elements.
function detachOnCleanup(handle) {
    onCleanup(function () {
        if (handle && typeof handle.detach === 'function') handle.detach();
    });
}

// Wire a config signal to a live attachment. `configSig` is a lite-signal read
// accessor (call it to read + subscribe). `build` and `attach` are injectable
// for testing; they default to the real storyboard builder + runtime.
//
// Returns the effect's Dispose thunk -- call it (or lite-signal `dispose(api)`)
// to detach and stop reacting.
export function wireStoryboardSwap(configSig, build, attach) {
    const buildStoryboard = build || storyboardFromConfig;
    const doAttach = attach || attachStoryboardRuntime;
    return effect(function () {
        const cfg = configSig();                          // read + subscribe
        const handle = doAttach(buildStoryboard(cfg), { runtime: 'polyfill' });
        detachOnCleanup(handle);                          // detach on re-run / dispose
    });
}
