// recipes/rig-handoff.js -- hand a Scrollforge storyboard off to the
// @zakkster/lite-scroll-rig-pro virtual-scroll runtime via toRig().
//
// Never ships (repo-only; not in package.json files[]). See recipes/README.md.
// Unlike gsap-export (parse-gated -- no gsap runtime in this tree), the rig IS a
// published zero-dep peer, so test/browser/rig-handoff.test.mjs EXECUTES the
// emitted module against the real published rig in a real browser: it stands the
// generated KeyframePool + DOMScroller + ScrollEngine up against rig@1.3.2 and
// drives a real matrix3d transform onto the DOM. Real execution, not parse-only.
//
// The rig animates translateX / translateY / scale / rotate only; this storyboard
// stays inside that set so nothing is dropped -- the honest handoff surface.

import { toRig } from '@zakkster/lite-scrollforge';

// End state (t = 1) each keyframe endpoint resolves to -- the numbers the browser
// lane reads back out of the composed matrix. translateX is 0 (unused) so the
// rig's row-0 track is a flat 0, proving an unset transform slot stays identity.
export const RIG_ENDPOINTS = Object.freeze({
    start: { translateX: 0, translateY: 80, scale: 0.8, rotate: -6 },
    end:   { translateX: 0, translateY: 0,  scale: 1,   rotate: 0 }
});

// A rig-safe storyboard. `overrides` (optional) merges into the FROM keyframe so
// the test's break control can perturb one input and watch the observed matrix
// diverge from RIG_ENDPOINTS.
export function rigStoryboard(overrides) {
    const from = Object.assign(
        { translateY: RIG_ENDPOINTS.start.translateY, scale: RIG_ENDPOINTS.start.scale, rotate: RIG_ENDPOINTS.start.rotate },
        overrides || {}
    );
    return {
        tracks: [
            {
                selector: '.rig-card',
                timeline: { kind: 'view' },
                range: { start: 'cover 0%', end: 'cover 100%' },
                keyframes: [
                    from,
                    { translateY: RIG_ENDPOINTS.end.translateY, scale: RIG_ENDPOINTS.end.scale, rotate: RIG_ENDPOINTS.end.rotate }
                ],
                easing: 'easeOutCubic'
            }
        ]
    };
}

// Returns the generated rig module SOURCE. opts.moduleFormat is 'esm' (default)
// or 'cjs'; other toRig options pass through.
export function emitRigModule(opts, overrides) {
    return toRig(rigStoryboard(overrides), opts || { moduleFormat: 'esm' });
}
