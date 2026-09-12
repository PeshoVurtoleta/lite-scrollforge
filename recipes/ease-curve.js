// recipes/ease-curve.js -- feed a @zakkster/lite-ease analytic easing into
// Scrollforge's CSS emission.
//
// Never ships (repo-only; not in package.json files[]). See recipes/README.md.
// Analytic curves like bounce/elastic cannot be fit by a single cubic-bezier;
// linearPoints samples the function into a CSS Level 4 linear() string that
// native animation-timing-function understands and the polyfill parses back.

import { linearPoints, easingToCssTimingFunction } from '@zakkster/lite-scrollforge';
import { easeOutBounce } from '@zakkster/lite-ease';

// Sample the bounce curve into a linear(...) string.
export function bounceLinear(samples) {
    return linearPoints(easeOutBounce, samples || 24);
}

// The smart mapper routes a preset NAME, a raw CSS timing-function STRING, or a
// (t) => number FUNCTION to the correct CSS output form.
export function timingFor(input) {
    return easingToCssTimingFunction(input);
}
