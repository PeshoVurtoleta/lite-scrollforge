// recipes/rig-export.js -- compile a Scrollforge storyboard to runnable
// @zakkster/lite-scroll-rig-pro + @zakkster/lite-keyframe code.
//
// Never ships (repo-only; not in package.json files[]). See recipes/README.md.
// The rig supports translateX / translateY / scale / rotate; other properties
// are dropped with a per-track comment, so this storyboard sticks to those.

import { toRig } from '@zakkster/lite-scrollforge';

export function cardStoryboard() {
    return {
        tracks: [
            {
                selector: '.card', timeline: { kind: 'view' },
                range: { start: 'cover 0%', end: 'cover 100%' },
                keyframes: [
                    { translateY: 60, scale: 0.9, rotate: -4 },
                    { translateY: 0, scale: 1, rotate: 0 }
                ],
                easing: 'easeOutCubic'
            }
        ]
    };
}

// Returns the generated module SOURCE. opts.moduleFormat is 'esm' (default) or
// 'cjs'.
export function emitRig(opts) {
    return toRig(cardStoryboard(), opts || { moduleFormat: 'esm' });
}
