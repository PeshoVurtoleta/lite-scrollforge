// recipes/oklch-sunset.js -- an OKLCH custom-property "sunset" ramp compiled
// into a Scrollforge storyboard with @zakkster/lite-color-engine.
//
// Never ships (repo-only; not in package.json files[]). See recipes/README.md.
// Headless: color-engine is DOM-free, so this whole recipe (and its test tier)
// runs in node. The point of the handoff -- color-engine owns perceptual color
// math, Scrollforge owns the scroll-driven emission; the bridge is a `--` custom
// property whose keyframe values are OKLCH strings the CSS engine interpolates.
//
// sRGB endpoints -> OKLCH buffers (sRgbToOklchBuffer) -> shortest-path OKLCH
// lerp per stop (lerpOklchBuffer) -> `oklch(L% C H)` strings (formatOklchCss),
// dropped into a keyframe's `--sunset` custom property at even offsets. OKLCH,
// not sRGB, so the ramp stays perceptually even through the orange->violet arc
// (a naive sRGB lerp muddies the midpoint).

import { sRgbToOklchBuffer, lerpOklchBuffer, formatOklchCss } from '@zakkster/lite-color-engine';
import { storyboardToCss } from '@zakkster/lite-scrollforge';

// Warm horizon orange -> deep dusk violet, in 0-255 sRGB bytes.
export const SUNSET_FROM = [255, 126, 95];   // #ff7e5f
export const SUNSET_TO   = [43, 16, 85];     // #2b1055

// Compute `count` OKLCH css strings ramping SUNSET_FROM -> SUNSET_TO. `from`/`to`
// are [r, g, b] byte triplets so a caller (and the break control) can perturb an
// endpoint. count >= 2.
export function sunsetStops(count, from, to) {
    const n = count | 0;
    if (n < 2) throw new RangeError('sunsetStops: count must be >= 2');
    const a = from || SUNSET_FROM;
    const b = to || SUNSET_TO;
    // Two source triplets + one scratch output triplet, stride 3.
    const buf = new Float32Array(9);
    sRgbToOklchBuffer(a[0], a[1], a[2], buf, 0);
    sRgbToOklchBuffer(b[0], b[1], b[2], buf, 3);
    const out = [];
    for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        lerpOklchBuffer(buf, 0, buf, 3, t, buf, 6);
        out.push(formatOklchCss(buf, 6));
    }
    return out;
}

// A storyboard whose single track drives a `--sunset` custom property across the
// ramp as the subject scrolls through its cover range. `count` stops -> `count`
// evenly-spaced keyframes.
export function sunsetStoryboard(count, from, to) {
    const stops = sunsetStops(count || 5, from, to);
    const keyframes = [];
    for (let i = 0; i < stops.length; i++) {
        keyframes.push({ offset: i / (stops.length - 1), '--sunset': stops[i] });
    }
    return {
        tracks: [
            {
                selector: '.sky',
                timeline: { kind: 'view' },
                range: { start: 'cover 0%', end: 'cover 100%' },
                keyframes: keyframes,
                easing: 'linear'
            }
        ]
    };
}

// Returns the emitted CSS for the sunset storyboard.
export function emitSunsetCss(count, from, to) {
    return storyboardToCss(sunsetStoryboard(count, from, to));
}
