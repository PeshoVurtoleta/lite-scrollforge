// recipes/gsap-export.js -- compile a Scrollforge storyboard to runnable GSAP.
//
// Never ships (repo-only; not in package.json files[]). See recipes/README.md.
// Scrollforge itself stays zero-dependency: toGsap emits ScrollTrigger +
// Timeline JavaScript as a STRING that you paste into a project that has gsap.

import { toGsap } from '@zakkster/lite-scrollforge';

// A hero title that fades + rises as it enters the viewport, plus a parallax
// band driven by raw scroll position.
export function heroStoryboard() {
    return {
        tracks: [
            {
                selector: '.hero-title', timeline: { kind: 'view' },
                range: { start: 'entry 0%', end: 'entry 100%' },
                keyframes: [{ opacity: 0, translateY: 30 }, { opacity: 1, translateY: 0 }],
                easing: 'easeOutCubic'
            },
            {
                selector: '.parallax', timeline: { kind: 'scroll', scroller: 'root' },
                keyframes: [{ translateY: 0 }, { translateY: -200 }],
                easing: 'linear'
            }
        ]
    };
}

// Returns the generated module SOURCE. opts.moduleFormat is 'esm' (default) or
// 'cjs'.
export function emitGsap(opts) {
    return toGsap(heroStoryboard(), opts || { moduleFormat: 'esm' });
}
