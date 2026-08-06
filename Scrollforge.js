/**
 * @zakkster/lite-scrollforge
 * Scroll-driven animation designer -- engine core (Session 1).
 *
 * Config -> native CSS (animation-timeline / animation-range) transform.
 * Runtime attach via <style> injection. Zero runtime overhead after
 * attach -- the browser's compositor handles the animation.
 *
 * Copyright (c) Zahary Shinikchiev <shinikchiev@yahoo.com>
 * MIT License
 */

// -------------------------------------------------------------------
// CSS easing presets
// -------------------------------------------------------------------
// Penner cubic-bezier approximations plus the four CSS native keywords.
// Analytic easings (Bounce, Elastic) can't be represented as a single
// cubic-bezier -- use `linearPoints(easingFn)` or pass an easing function
// directly to `easingToCssTimingFunction` to emit CSS Level 4 `linear()`.
//
// The full Penner numeric set (including Bounce and Elastic) lives in
// `@zakkster/lite-ease` as `(t) => number` functions. lite-ease is an
// OPTIONAL peer of Scrollforge -- pass its functions directly to Scrollforge
// APIs. Scrollforge stays zero-dep.
export const CSS_EASINGS = Object.freeze({
    // CSS native keywords
    linear:          'linear',
    ease:            'ease',
    easeIn:          'ease-in',
    easeOut:         'ease-out',
    easeInOut:       'ease-in-out',

    // Penner Sine
    easeInSine:      'cubic-bezier(0.12, 0, 0.39, 0)',
    easeOutSine:     'cubic-bezier(0.61, 1, 0.88, 1)',
    easeInOutSine:   'cubic-bezier(0.37, 0, 0.63, 1)',

    // Penner Quad
    easeInQuad:      'cubic-bezier(0.11, 0, 0.5, 0)',
    easeOutQuad:     'cubic-bezier(0.5, 1, 0.89, 1)',
    easeInOutQuad:   'cubic-bezier(0.45, 0, 0.55, 1)',

    // Penner Cubic
    easeInCubic:     'cubic-bezier(0.32, 0, 0.67, 0)',
    easeOutCubic:    'cubic-bezier(0.33, 1, 0.68, 1)',
    easeInOutCubic:  'cubic-bezier(0.65, 0, 0.35, 1)',

    // Penner Quart
    easeInQuart:     'cubic-bezier(0.5, 0, 0.75, 0)',
    easeOutQuart:    'cubic-bezier(0.25, 1, 0.5, 1)',
    easeInOutQuart:  'cubic-bezier(0.76, 0, 0.24, 1)',

    // Penner Quint
    easeInQuint:     'cubic-bezier(0.64, 0, 0.78, 0)',
    easeOutQuint:    'cubic-bezier(0.22, 1, 0.36, 1)',
    easeInOutQuint:  'cubic-bezier(0.83, 0, 0.17, 1)',

    // Penner Expo
    easeInExpo:      'cubic-bezier(0.7, 0, 0.84, 0)',
    easeOutExpo:     'cubic-bezier(0.16, 1, 0.3, 1)',
    easeInOutExpo:   'cubic-bezier(0.87, 0, 0.13, 1)',

    // Penner Circ
    easeInCirc:      'cubic-bezier(0.55, 0, 1, 0.45)',
    easeOutCirc:     'cubic-bezier(0, 0.55, 0.45, 1)',
    easeInOutCirc:   'cubic-bezier(0.85, 0, 0.15, 1)',

    // Penner Back (overshoot)
    easeInBack:      'cubic-bezier(0.36, 0, 0.66, -0.56)',
    easeOutBack:     'cubic-bezier(0.34, 1.56, 0.64, 1)',
    easeInOutBack:   'cubic-bezier(0.68, -0.6, 0.32, 1.6)'
});

/** @deprecated Renamed to `CSS_EASINGS`. Kept as alias for compatibility. */
export const EASINGS = CSS_EASINGS;

/**
 * Build a CSS `cubic-bezier(...)` timing-function string.
 * @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2
 * @returns {string} `cubic-bezier(x1, y1, x2, y2)`
 *
 * Note: this returns a STRING for CSS emission. If you need a `(t) => number`
 * function that evaluates the curve at runtime, use `@zakkster/lite-cubic-bezier`
 * -- the sibling package that owns the parametric-curve runtime.
 */
export function cubicBezierCss(x1, y1, x2, y2) {
    if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) {
        throw new RangeError('cubic-bezier x1 and x2 must be in [0, 1]');
    }
    return 'cubic-bezier(' + x1 + ', ' + y1 + ', ' + x2 + ', ' + y2 + ')';
}

/** @deprecated Renamed to `cubicBezierCss` to avoid name collision with
 *  `@zakkster/lite-cubic-bezier`'s runtime API. Kept as alias for compatibility. */
export const cubicBezier = cubicBezierCss;

// -------------------------------------------------------------------
// linearPoints -- CSS Level 4 `linear()` timing-function emission
// -------------------------------------------------------------------
// Represents any `(t) => number` easing (including oscillating curves
// like Bounce and Elastic which cubic-bezier can't fit) as a native CSS
// `linear(y0, y1, y2, ..., yN)` string. Browsers auto-distribute the
// samples evenly across the timeline.
//
// Baseline-cross-browser as of Chrome 113 / Firefox 116 / Safari 17.4.

const _LP_ROUND_ZEROS = /\.?0+$/;

/**
 * Emit a CSS `linear(...)` timing function by sampling an easing at
 * `samples + 1` evenly-spaced points across [0, 1].
 *
 * @param {(t: number) => number} easingFn  any pure easing function
 * @param {number} [samples=32]  number of segments; higher = smoother
 * @returns {string} e.g. `linear(0, 0.015, 0.061, ..., 1)`
 *
 * Usage with `@zakkster/lite-ease`:
 *   import { easeOutBounce } from '@zakkster/lite-ease';
 *   linearPoints(easeOutBounce);
 *   // -> 'linear(0, 0.019, 0.078, ..., 1)'
 *
 * Values are rounded to 4 decimals and trailing zeros stripped for
 * compact output. NaN/Infinity from `easingFn` propagates unchanged.
 */
export function linearPoints(easingFn, samples) {
    if (typeof easingFn !== 'function') {
        throw new TypeError('linearPoints: easingFn must be a function');
    }
    const n = (samples | 0) || 32;
    if (n < 2) {
        throw new RangeError('linearPoints: samples must be >= 2');
    }
    const parts = new Array(n + 1);
    for (let i = 0; i <= n; i++) {
        const t = i / n;
        const v = easingFn(t);
        // Round to 4 decimals, strip trailing zeros.
        const s = v.toFixed(4).replace(_LP_ROUND_ZEROS, '');
        parts[i] = s === '' || s === '-' ? '0' : s;
    }
    return 'linear(' + parts.join(', ') + ')';
}

// -------------------------------------------------------------------
// easingToCssTimingFunction -- the smart mapper
// -------------------------------------------------------------------
// Routes the `easing` field of a track into a valid CSS timing-function
// string. Accepts:
//   - preset name (looked up in CSS_EASINGS) -> the mapped cubic-bezier
//     or CSS keyword
//   - function `(t) => number` -> `linear(...)` via linearPoints
//   - raw CSS string starting with `cubic-bezier(`, `linear(`, or a CSS
//     keyword -> passes through unchanged (user's responsibility to be valid)
//   - null / undefined -> 'linear'

const _CSS_TIMING_PREFIXES = ['cubic-bezier(', 'linear(', 'steps('];

/**
 * @param {string | ((t: number) => number) | null | undefined} input
 * @param {number} [linearSamples=32] samples if `input` is a function
 * @returns {string}
 */
export function easingToCssTimingFunction(input, linearSamples) {
    if (input == null) return 'linear';
    if (typeof input === 'function') {
        return linearPoints(input, linearSamples);
    }
    if (typeof input === 'string') {
        // Preset name?
        if (Object.prototype.hasOwnProperty.call(CSS_EASINGS, input)) {
            return CSS_EASINGS[input];
        }
        // Trust raw CSS (cubic-bezier(...), linear(...), steps(...), or
        // known CSS keywords: linear, ease, ease-in, ease-out, ease-in-out).
        for (let i = 0; i < _CSS_TIMING_PREFIXES.length; i++) {
            if (input.startsWith(_CSS_TIMING_PREFIXES[i])) return input;
        }
        // CSS keywords that aren't caught by prefix match:
        if (input === 'ease' || input === 'ease-in' ||
            input === 'ease-out' || input === 'ease-in-out') return input;
        // Unknown name -- either a Penner analytic (`easeOutBounce`) the
        // user forgot to import from lite-ease, or a typo. Throw with a
        // helpful message.
        throw new TypeError(
            'easingToCssTimingFunction: unknown easing "' + input +
            '". Pass a preset name from CSS_EASINGS, a raw CSS timing string, ' +
            'or an easing function (import from @zakkster/lite-ease for ' +
            'analytic easings like easeOutBounce).');
    }
    throw new TypeError(
        'easingToCssTimingFunction: easing must be a string or function');
}

/**
 * True when the current browser supports CSS scroll-driven animations.
 * Evaluates once at module load.
 */
export const HAS_NATIVE_SUPPORT = (typeof CSS !== 'undefined' &&
    typeof CSS.supports === 'function' &&
    CSS.supports('animation-timeline: view()'));

// -------------------------------------------------------------------
// Keyframe naming (deterministic within one storyboardToCss call)
// -------------------------------------------------------------------
let _kfCounter = 0;

/**
 * Reset the keyframe-name counter. Call before a batch of trackToCss
 * calls if you need byte-stable output for golden-file testing.
 */
export function resetKeyframeCounter() { _kfCounter = 0; }

// -------------------------------------------------------------------
// Kebab-case conversion -- hoisted so V8 doesn't recompile the regex on
// every unmapped property.
// -------------------------------------------------------------------
const KEBAB_REGEX = /[A-Z]/g;
function _kebabRepl(m) { return '-' + m.toLowerCase(); }

// -------------------------------------------------------------------
// Property-to-CSS mapping
// -------------------------------------------------------------------
// The subset of common animatable properties Session 1 supports.
// Values are:
//   { css, unit, wrap }
//     css:  the target CSS property name (or 'translate'/'scale'/'rotate'
//           for the individual transform components)
//     unit: default unit appended when value is a plain number
//     wrap: for translate axes, whether this is the 'x' or 'y' slot
// Any property not in the map is emitted verbatim (name: value).
const PROP_MAPPING = Object.freeze({
    opacity:      { css: 'opacity',     unit: ''    },
    translateX:   { css: 'translate',   unit: 'px', wrap: 'x' },
    translateY:   { css: 'translate',   unit: 'px', wrap: 'y' },
    translateZ:   { css: 'translate',   unit: 'px', wrap: 'z' },
    scale:        { css: 'scale',       unit: ''    },
    scaleX:       { css: 'scale',       unit: '',   wrap: 'x' },
    scaleY:       { css: 'scale',       unit: '',   wrap: 'y' },
    rotate:       { css: 'rotate',      unit: 'deg' },
    width:        { css: 'width',       unit: 'px'  },
    height:       { css: 'height',      unit: 'px'  },
    top:          { css: 'top',         unit: 'px'  },
    left:         { css: 'left',        unit: 'px'  },
    right:        { css: 'right',       unit: 'px'  },
    bottom:       { css: 'bottom',      unit: 'px'  },
    filter:       { css: 'filter',      unit: ''    },
    backdropFilter:{css: 'backdrop-filter', unit: '' },
    color:        { css: 'color',       unit: ''    },
    background:   { css: 'background',  unit: ''    },
    backgroundColor: { css: 'background-color', unit: '' },
    borderRadius: { css: 'border-radius', unit: 'px' },
    boxShadow:    { css: 'box-shadow',  unit: ''    },
    transform:    { css: 'transform',   unit: ''    }
});

/**
 * Turn a single scalar+unit value into a CSS token.
 * `30` + 'px' -> '30px'. Strings pass through untouched.
 */
function _emit(value, unit) {
    if (typeof value === 'string') return value;
    if (unit === '' || unit == null) return String(value);
    return value + unit;
}

/**
 * Serialize one keyframe's properties into a CSS declaration block.
 * Returns the semicolon-separated declarations (no braces).
 *
 * Handles the transform-component aggregation:
 *   { translateX: 10, translateY: 20, scale: 1.2 }
 *   -> 'translate: 10px 20px; scale: 1.2;'
 * Individual `translate:` / `scale:` / `rotate:` (Transforms Level 2)
 * compose without a wrapper `transform:` value.
 *
 * `offset` is skipped inline -- no defensive clone needed.
 */
function _serializeKeyframe(props) {
    // Aggregate translate axes into one value.
    let tx = null, ty = null, tz = null;
    let sx = null, sy = null;
    // Single output buffer -- non-transform declarations get pushed
    // directly here in source order; transform composites appended at
    // the end. Replaces the earlier `rest` + `out` two-array design.
    const declarations = [];

    for (const key in props) {
        if (!Object.prototype.hasOwnProperty.call(props, key)) continue;
        if (key === 'offset') continue;   // reserved metadata, not a CSS prop
        const value = props[key];
        if (value === undefined || value === null) continue;
        const map = PROP_MAPPING[key];

        if (map && map.css === 'translate') {
            if (map.wrap === 'x') tx = _emit(value, map.unit);
            else if (map.wrap === 'y') ty = _emit(value, map.unit);
            else if (map.wrap === 'z') tz = _emit(value, map.unit);
            continue;
        }
        if (map && map.css === 'scale' && (map.wrap === 'x' || map.wrap === 'y')) {
            if (map.wrap === 'x') sx = _emit(value, map.unit);
            else                  sy = _emit(value, map.unit);
            continue;
        }

        if (map) {
            declarations.push(map.css + ': ' + _emit(value, map.unit));
        } else {
            // Unknown property -- emit as CSS custom property or raw
            // kebab-case, whichever looks intentional.
            const cssName = key.startsWith('--') ? key : key.replace(KEBAB_REGEX, _kebabRepl);
            declarations.push(cssName + ': ' + (typeof value === 'string' ? value : String(value)));
        }
    }

    // Transform composites AFTER non-transform declarations, so output
    // reads naturally as `opacity: ...; translate: ...; scale: ...;`.
    // translate: x y z (any absent slots default to 0)
    if (tx !== null || ty !== null || tz !== null) {
        const parts = [tx !== null ? tx : '0', ty !== null ? ty : '0'];
        if (tz !== null) parts.push(tz);
        declarations.push('translate: ' + parts.join(' '));
    }
    // scale: sx sy -- missing axis explicitly defaults to '1' (independent
    // axes, no aspect-ratio guessing).
    if (sx !== null || sy !== null) {
        declarations.push('scale: ' + (sx !== null ? sx : '1') + ' ' + (sy !== null ? sy : '1'));
    }
    return declarations.join('; ') + (declarations.length ? ';' : '');
}

/**
 * Format an animation-range endpoint. Accepts:
 *   - a string like 'entry 0%' or 'cover 50%'  -> passed through
 *   - a bare percentage number 42              -> '42%'
 *   - null/undefined                            -> null (caller decides)
 */
function _formatRange(v) {
    if (v == null) return null;
    if (typeof v === 'string') return v.trim();
    if (typeof v === 'number') return v + '%';
    throw new TypeError('animation range endpoint must be string or number');
}

/**
 * Format a timeline config into its CSS timeline function value.
 *   { kind: 'view' }              -> 'view()'
 *   { kind: 'view', axis: 'inline' } -> 'view(inline)'
 *   { kind: 'scroll' }            -> 'scroll()'
 *   { kind: 'scroll', scroller: 'nearest' } -> 'scroll(nearest)'
 *   { name: '--my-timeline' }     -> '--my-timeline'
 */
function _formatTimeline(t) {
    if (!t) return null;
    if (t.name) return t.name;   // custom named timeline (declared elsewhere)
    const kind = t.kind === 'scroll' ? 'scroll' : 'view';
    const args = [];
    if (t.scroller) args.push(t.scroller);    // 'nearest' | 'root' | 'self'
    if (t.axis) args.push(t.axis);            // 'block' | 'inline' | 'x' | 'y'
    return kind + '(' + args.join(' ') + ')';
}

// -------------------------------------------------------------------
// trackToCss -- the core transform
// -------------------------------------------------------------------
/**
 * Convert one animation track to its CSS pieces.
 *
 * @param {Object} track  { selector, timeline, range?, keyframes, easing?, fill? }
 * @returns {Object} { keyframesName, keyframesCss, ruleCss }
 */
export function trackToCss(track) {
    if (!track || typeof track !== 'object') {
        throw new TypeError('trackToCss: track must be an object');
    }
    if (typeof track.selector !== 'string' || !track.selector) {
        throw new TypeError('trackToCss: track.selector required');
    }
    if (!Array.isArray(track.keyframes) || track.keyframes.length < 2) {
        throw new TypeError('trackToCss: track.keyframes must be an array of length >= 2');
    }

    const name = '__scrollforge_' + (_kfCounter++);

    // Sort keyframes by offset if present, otherwise assume author order.
    // Distribute missing offsets evenly (WAAPI convention).
    const kfs = track.keyframes;
    const n = kfs.length;
    let hasAnyOffset = false;
    for (let i = 0; i < n; i++) {
        if (typeof kfs[i].offset === 'number') { hasAnyOffset = true; break; }
    }

    const kfLines = [];
    for (let i = 0; i < n; i++) {
        const kf = kfs[i];
        let offset;
        if (typeof kf.offset === 'number') {
            offset = kf.offset;
        } else if (!hasAnyOffset) {
            offset = i / (n - 1);
        } else {
            // Sparse offsets -- assign endpoints to 0 and 1, error mid-frames.
            if (i === 0) offset = 0;
            else if (i === n - 1) offset = 1;
            else throw new TypeError('trackToCss: interior keyframe #' + i + ' missing offset');
        }
        if (offset < 0 || offset > 1) {
            throw new RangeError('trackToCss: offset must be in [0, 1], got ' + offset);
        }

        // Serialize props directly -- _serializeKeyframe skips `offset`
        // inline, so no defensive clone needed.
        const decl = _serializeKeyframe(kf);
        const pct = (offset * 100).toFixed(offset === 0 || offset === 1 ? 0 : 2);
        kfLines.push('    ' + pct + '% { ' + decl + ' }');
    }

    const keyframesCss = '@keyframes ' + name + ' {\n' + kfLines.join('\n') + '\n}';

    // Rule assembly
    const easingCss = easingToCssTimingFunction(track.easing);
    const fillCss = track.fill || 'both';
    const timelineCss = _formatTimeline(track.timeline);
    if (!timelineCss) {
        throw new TypeError('trackToCss: track.timeline required (' +
            "e.g. { kind: 'view' } or { name: '--my-timeline' })");
    }

    const decls = [
        'animation-name: ' + name,
        'animation-timing-function: ' + easingCss,
        'animation-fill-mode: ' + fillCss,
        'animation-duration: 1ms',  // required for animation to run; ignored by scroll timelines
        'animation-timeline: ' + timelineCss
    ];

    if (track.range) {
        const start = _formatRange(track.range.start);
        const end = _formatRange(track.range.end);
        if (start && end) {
            decls.push('animation-range: ' + start + ' ' + end);
        } else if (start) {
            decls.push('animation-range-start: ' + start);
        } else if (end) {
            decls.push('animation-range-end: ' + end);
        }
    }

    const ruleCss = track.selector + ' {\n    ' + decls.join(';\n    ') + ';\n}';

    return { keyframesName: name, keyframesCss, ruleCss };
}

// -------------------------------------------------------------------
// storyboardToCss -- the multi-track transform
// -------------------------------------------------------------------
/**
 * Convert a storyboard (multiple tracks + optional named timelines) to
 * one deterministic CSS string.
 *
 * @param {Object} storyboard { tracks: Track[], timelines?: { [name]: TimelineDecl } }
 * @param {Object} [opts]     { reset?: boolean }  -- reset keyframe counter first (default: true)
 * @returns {string} the combined CSS text
 */
export function storyboardToCss(storyboard, opts) {
    if (!storyboard || !Array.isArray(storyboard.tracks)) {
        throw new TypeError('storyboardToCss: storyboard.tracks required');
    }
    const shouldReset = !opts || opts.reset !== false;
    if (shouldReset) _kfCounter = 0;

    const chunks = [];

    // Named timeline declarations (view-timeline-name / scroll-timeline-name).
    if (storyboard.timelines) {
        for (const name in storyboard.timelines) {
            if (!Object.prototype.hasOwnProperty.call(storyboard.timelines, name)) continue;
            const decl = storyboard.timelines[name];
            if (!decl || typeof decl.attachedSelector !== 'string') {
                throw new TypeError('storyboardToCss: timeline "' + name +
                    '" needs { attachedSelector, kind, axis? }');
            }
            const prop = decl.kind === 'scroll' ? 'scroll-timeline-name' : 'view-timeline-name';
            const axisProp = decl.kind === 'scroll' ? 'scroll-timeline-axis' : 'view-timeline-axis';
            const rule = decl.attachedSelector + ' {\n    ' + prop + ': ' + name +
                (decl.axis ? (';\n    ' + axisProp + ': ' + decl.axis) : '') + ';\n}';
            chunks.push(rule);
        }
    }

    // Tracks -- each contributes @keyframes + a rule.
    for (let i = 0; i < storyboard.tracks.length; i++) {
        const t = storyboard.tracks[i];
        const parts = trackToCss(t);
        chunks.push(parts.keyframesCss);
        chunks.push(parts.ruleCss);
    }

    return chunks.join('\n\n');
}

// -------------------------------------------------------------------
// sequenceOnTimeline -- even-distribution helper (Session 3)
// -------------------------------------------------------------------
// Common pattern: N tracks sharing one named timeline, each firing in
// order as the timeline progresses. Manually setting per-track ranges
// (0%-33%, 33%-66%, 66%-100%) is tedious and easy to get wrong.
//
// sequenceOnTimeline splits [0%, 100%] evenly across the input tracks
// and returns NEW track configs with `range` populated. Original tracks
// are untouched.

/**
 * Distribute N tracks evenly along a shared timeline.
 *
 * @param {Object[]} tracks   input tracks -- each must reference the same
 *                            named timeline (or Scrollforge will emit them
 *                            with independent implicit ranges, which is
 *                            probably not what you want)
 * @param {Object} [opts]
 * @param {number} [opts.overlap=0]   fraction in [0, 1) of a slot width
 *                                     to overlap neighbors. 0 = hard cuts,
 *                                     0.15 = tasteful cross-fade
 * @param {number} [opts.startPct=0]  timeline start (default 0)
 * @param {number} [opts.endPct=100]  timeline end (default 100)
 * @param {string} [opts.rangeName]   optional named-range prefix -- 'entry'
 *                                     or 'cover' etc. Emitted as
 *                                     `entry 0% entry 33%`. When omitted,
 *                                     bare percentages are used (works
 *                                     with any timeline; percentages are
 *                                     the natural choice for scroll and
 *                                     named view timelines).
 * @returns {Object[]}  new tracks with `range` set
 */
export function sequenceOnTimeline(tracks, opts) {
    if (!Array.isArray(tracks) || tracks.length === 0) {
        throw new TypeError('sequenceOnTimeline: tracks must be a non-empty array');
    }
    opts = opts || {};
    const overlap = opts.overlap == null ? 0 : opts.overlap;
    if (overlap < 0 || overlap >= 1) {
        throw new RangeError('sequenceOnTimeline: overlap must be in [0, 1)');
    }
    const startPct = opts.startPct == null ? 0   : opts.startPct;
    const endPct   = opts.endPct   == null ? 100 : opts.endPct;
    if (endPct <= startPct) {
        throw new RangeError('sequenceOnTimeline: endPct must be > startPct');
    }
    const rangeName = opts.rangeName || null;

    const n = tracks.length;
    const span = endPct - startPct;
    const slotWidth = span / n;
    // Overlap widens each slot by `overlap * slotWidth` on each side,
    // clamped to the outer bounds.
    const grow = overlap * slotWidth;

    const out = new Array(n);
    for (let i = 0; i < n; i++) {
        const rawStart = startPct + i * slotWidth - grow;
        const rawEnd   = startPct + (i + 1) * slotWidth + grow;
        const s = rawStart < startPct ? startPct : rawStart;
        const e = rawEnd   > endPct   ? endPct   : rawEnd;
        // Format each endpoint. `Number.isInteger` isn't quite right (we
        // want to strip trailing zeros); toFixed(4) + strip is compact.
        const startStr = _fmtPct(s) + '%';
        const endStr   = _fmtPct(e) + '%';
        const start = rangeName ? (rangeName + ' ' + startStr) : startStr;
        const end   = rangeName ? (rangeName + ' ' + endStr)   : endStr;
        // Shallow clone the input track (compile-time helper -- one-shot
        // allocation, not on a hot path).
        const orig = tracks[i];
        out[i] = Object.assign({}, orig, { range: { start, end } });
    }
    return out;
}

const _FMT_ROUND_ZEROS = /\.?0+$/;
function _fmtPct(n) {
    // Compact percentage: integers stay integer, fractions get up to
    // 4 decimals with trailing zeros stripped.
    if (n === (n | 0)) return String(n);
    return n.toFixed(4).replace(_FMT_ROUND_ZEROS, '');
}

// -------------------------------------------------------------------
// attachStoryboard -- inject CSS via a <style> tag
// -------------------------------------------------------------------
/**
 * Attach a storyboard's CSS to the document via a <style> element.
 * Returns a handle that removes the <style> on detach.
 *
 * @param {Object} storyboard
 * @param {Node} [root]   defaults to document.head
 * @returns {{ detach: () => void, styleElement: HTMLStyleElement }}
 */
export function attachStoryboard(storyboard, root) {
    if (typeof document === 'undefined') {
        throw new Error('attachStoryboard: no document available (browser-only)');
    }
    const target = root || document.head;
    const css = storyboardToCss(storyboard);
    const style = document.createElement('style');
    style.setAttribute('data-scrollforge', 'true');
    style.textContent = css;
    target.appendChild(style);
    return {
        styleElement: style,
        detach() {
            if (style.parentNode) style.parentNode.removeChild(style);
        }
    };
}

// -------------------------------------------------------------------
// Export targets (Session 4)
// -------------------------------------------------------------------
// toGsap  -- GSAP ScrollTrigger + Timeline runnable code
// toRig   -- @zakkster/lite-scroll-rig-pro + @zakkster/lite-keyframe runnable code
//
// Both return a STRING of JavaScript. The user writes it to a file or
// pastes it into their project. Generation happens once (at build time
// or console); the runtime is 100% the target framework, no Scrollforge
// dependency at runtime.

// --- GSAP mapping tables ----------------------------------------------
// CSS_EASINGS preset name  ->  GSAP built-in easing name.
// GSAP's built-ins closely match Penner; where a preset has no exact
// GSAP twin we fall back to CustomEase with the cubic-bezier args.
const _GSAP_EASING_MAP = Object.freeze({
    linear:          'none',
    ease:            'power1.inOut',
    easeIn:          'power1.in',
    easeOut:         'power1.out',
    easeInOut:       'power1.inOut',
    easeInSine:      'sine.in',
    easeOutSine:     'sine.out',
    easeInOutSine:   'sine.inOut',
    easeInQuad:      'power1.in',
    easeOutQuad:     'power1.out',
    easeInOutQuad:   'power1.inOut',
    easeInCubic:     'power2.in',
    easeOutCubic:    'power2.out',
    easeInOutCubic:  'power2.inOut',
    easeInQuart:     'power3.in',
    easeOutQuart:    'power3.out',
    easeInOutQuart:  'power3.inOut',
    easeInQuint:     'power4.in',
    easeOutQuint:    'power4.out',
    easeInOutQuint:  'power4.inOut',
    easeInExpo:      'expo.in',
    easeOutExpo:     'expo.out',
    easeInOutExpo:   'expo.inOut',
    easeInCirc:      'circ.in',
    easeOutCirc:     'circ.out',
    easeInOutCirc:   'circ.inOut',
    easeInBack:      'back.in',
    easeOutBack:     'back.out',
    easeInOutBack:   'back.inOut'
});

// Scrollforge property  ->  GSAP property.
// GSAP accepts most CSS property names natively as tween targets; only
// the transform components need renaming (x/y/z, rotation).
const _GSAP_PROP_MAP = Object.freeze({
    translateX: 'x',
    translateY: 'y',
    translateZ: 'z',
    rotate:     'rotation'
    // Others (opacity, scale, scaleX/Y, width, color, filter, ...)
    // pass through unchanged; GSAP accepts them by their CSS names.
});

// --- Rig mapping tables ----------------------------------------------
// DOMScroller (lite-scroll-rig-pro) fixes 4 rows per element.
const _RIG_PROP_ROWS = Object.freeze({
    translateX: 0,
    translateY: 1,
    scale:      2,
    rotate:     3
});

// Range-parsing regexes -- hoisted so V8 compiles them once.
// Neither uses /g so they're safe to share across callers (no stateful
// lastIndex to reset). Both sites call .exec() and read the match array.
const _NAMED_RANGE_RE = /^(entry|contain|exit|cover)\s+(-?\d+(?:\.\d+)?)%$/i;
const _BARE_PCT_RE    = /^(-?\d+(?:\.\d+)?)%$/;

/**
 * Map a CSS view-timeline range endpoint to a GSAP ScrollTrigger
 * position string.
 *
 *   `entry X%`   ->  `X% bottom`      (element X% at viewport bottom)
 *   `exit X%`    ->  `X% top`         (element X% at viewport top)
 *   `cover X%`   ->  `X% (100-X)%`    (symmetric interp -- exact)
 *   `contain X%` ->  approximation; caller emits a comment
 *
 *   bare `X%`    ->  `X% top`         (works for scroll-timelines)
 */
function _rangeEndpointToGsapPos(endpoint, kind) {
    if (typeof endpoint !== 'string') endpoint = String(endpoint);
    const trimmed = endpoint.trim();

    // Named range with percentage: `entry 25%` / `cover 100%` etc.
    const namedMatch = _NAMED_RANGE_RE.exec(trimmed);
    if (namedMatch) {
        const name = namedMatch[1].toLowerCase();
        const pct = +namedMatch[2];
        switch (name) {
            case 'entry':  return pct + '% bottom';
            case 'exit':   return pct + '% top';
            case 'cover':  return pct + '% ' + (100 - pct) + '%';
            case 'contain': {
                // Contain-range interpolation depends on element/viewport
                // size ratio, which we don't know at generation time.
                // Linear approximation: element goes from 'bottom' to 'top',
                // viewport goes from 'bottom' to 'top', both at rate (100-X)%.
                const p = 100 - pct;
                return p + '% ' + p + '%';
            }
        }
    }

    // Bare percentage (typical for scroll-timelines and named view timelines).
    if (_BARE_PCT_RE.test(trimmed)) {
        // For scroll timelines, bare X% means "X% through the scroller."
        // GSAP interprets this differently; use as element position for view,
        // or as absolute offset for scroll. Emitter decides per timeline kind.
        return trimmed + (kind === 'scroll' ? '' : ' top');
    }

    return trimmed;  // pass through anything unknown; user gets whatever GSAP does
}

/**
 * Build the { start, end, scrub } part of a GSAP scrollTrigger from a
 * Scrollforge track's timeline + range. Returns an object literal for
 * later formatting.
 */
function _gsapScrollTriggerFor(track) {
    const kind = (track.timeline && track.timeline.kind) || 'view';
    let start, end;
    if (track.range) {
        start = _rangeEndpointToGsapPos(track.range.start, kind);
        end   = _rangeEndpointToGsapPos(track.range.end,   kind);
    } else {
        // Sensible defaults: view = full cover, scroll = full scroller.
        start = kind === 'scroll' ? 'top top'    : 'top bottom';
        end   = kind === 'scroll' ? 'bottom top' : 'bottom top';
    }
    return { trigger: track.selector, start, end, scrub: true };
}

/**
 * Map a Scrollforge easing input (name / raw string / function) to a
 * GSAP easing string. Functions get emitted as CustomEase via the
 * linearPoints CSS `linear()` output (usable in GSAP >= 3.12) OR fall
 * back to a warning + 'power2.out'.
 */
function _gsapEasingFor(input) {
    if (input == null) return 'none';
    if (typeof input === 'function') {
        // GSAP 3.12+ supports CSS-style linear() via CustomEase.
        // Simpler + more portable: emit a linear() string and note the
        // caller must have CustomEase available.
        return { __needsCustomEase: true, expression: linearPoints(input) };
    }
    if (typeof input === 'string') {
        if (Object.prototype.hasOwnProperty.call(_GSAP_EASING_MAP, input)) {
            return _GSAP_EASING_MAP[input];
        }
        // Raw cubic-bezier(...) -- pass through as a hint; user needs CustomEase.
        if (input.startsWith('cubic-bezier(')) {
            return { __needsCustomEase: true, expression: input };
        }
        // Raw linear(...) -- same story
        if (input.startsWith('linear(')) {
            return { __needsCustomEase: true, expression: input };
        }
        // CSS keyword
        if (input === 'linear' || input === 'ease' ||
            input === 'ease-in' || input === 'ease-out' || input === 'ease-in-out') {
            return _GSAP_EASING_MAP[input === 'linear' ? 'linear'
                : input === 'ease'    ? 'ease'
                : input === 'ease-in' ? 'easeIn'
                : input === 'ease-out'? 'easeOut'
                : 'easeInOut'];
        }
    }
    return 'power2.out';   // safe default
}

/**
 * Translate a Scrollforge keyframe object into a GSAP props object.
 * - Skips 'offset'.
 * - Renames transform components (translateX -> x, rotate -> rotation).
 * - Numeric transform values pick up implied units matching GSAP's
 *   expectations (px for translate*, degrees for rotation) -- GSAP
 *   accepts numbers directly.
 * - Everything else passes through by name.
 */
function _keyframeToGsapProps(kf) {
    const out = {};
    for (const key in kf) {
        if (!Object.prototype.hasOwnProperty.call(kf, key)) continue;
        if (key === 'offset') continue;
        const value = kf[key];
        if (value === undefined || value === null) continue;
        const mapped = _GSAP_PROP_MAP[key] || key;
        out[mapped] = value;
    }
    return out;
}

// -------------------------------------------------------------------
// JS object-literal emitter (small formatter used by both toGsap/toRig)
// -------------------------------------------------------------------
function _jsValue(v) {
    if (typeof v === 'string')  return JSON.stringify(v);
    if (typeof v === 'number')  return String(v);
    if (typeof v === 'boolean') return String(v);
    if (v == null) return 'null';
    return JSON.stringify(v);
}

// JS identifier regex -- hoisted so V8 doesn't recompile per _fmtObjInline call.
const _IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Format an object as `{ k: v, k: v }` on one line. */
function _fmtObjInline(obj) {
    const keys = Object.keys(obj);
    if (keys.length === 0) return '{}';
    const parts = new Array(keys.length);
    for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        // Property names that aren't valid identifiers need quoting.
        const kStr = _IDENT_RE.test(k) ? k : JSON.stringify(k);
        parts[i] = kStr + ': ' + _jsValue(obj[k]);
    }
    return '{ ' + parts.join(', ') + ' }';
}

// -------------------------------------------------------------------
// toGsap
// -------------------------------------------------------------------
/**
 * Convert a storyboard to runnable GSAP ScrollTrigger + Timeline code.
 *
 * @param {Object} storyboard
 * @param {Object} [opts]
 * @param {'esm'|'cjs'} [opts.moduleFormat='esm']
 * @param {string} [opts.functionName='attachScrollAnimations']
 * @param {boolean} [opts.includeImports=true]
 * @returns {string} runnable JS
 */
export function toGsap(storyboard, opts) {
    if (!storyboard || !Array.isArray(storyboard.tracks)) {
        throw new TypeError('toGsap: storyboard.tracks required');
    }
    opts = opts || {};
    const moduleFormat = opts.moduleFormat || 'esm';
    const functionName = opts.functionName || 'attachScrollAnimations';
    const includeImports = opts.includeImports !== false;

    const lines = [];
    lines.push('// Generated by @zakkster/lite-scrollforge - toGsap');
    lines.push('// Do not edit by hand. Regenerate from the source storyboard.');
    lines.push('');

    if (includeImports) {
        if (moduleFormat === 'esm') {
            lines.push("import { gsap } from 'gsap';");
            lines.push("import { ScrollTrigger } from 'gsap/ScrollTrigger';");
        } else {
            lines.push("const { gsap } = require('gsap');");
            lines.push("const { ScrollTrigger } = require('gsap/ScrollTrigger');");
        }
        lines.push('gsap.registerPlugin(ScrollTrigger);');
        lines.push('');
    }

    const openFn = moduleFormat === 'cjs'
        ? 'module.exports.' + functionName + ' = function ' + functionName + '() {'
        : 'export function ' + functionName + '() {';
    lines.push(openFn);
    lines.push('    const animations = [];');
    lines.push('');

    for (let i = 0; i < storyboard.tracks.length; i++) {
        const track = storyboard.tracks[i];
        const kfs = track.keyframes;
        if (!Array.isArray(kfs) || kfs.length < 2) {
            lines.push('    // Track ' + i + ' (' + track.selector +
                '): skipped -- needs at least 2 keyframes');
            lines.push('');
            continue;
        }
        lines.push('    // Track ' + i + ': ' + track.selector);
        if (kfs.length > 2) {
            lines.push('    // Note: ' + kfs.length +
                ' keyframes; GSAP export uses endpoints only ' +
                '(intermediates lose in the fromTo emission).');
        }

        const easing = _gsapEasingFor(track.easing);
        const easingLiteral = typeof easing === 'string'
            ? _jsValue(easing)
            : ('/* needs CustomEase */ ' + _jsValue(easing.expression));
        if (typeof easing !== 'string') {
            lines.push("    // Easing '" + (track.easing && track.easing.name ||
                track.easing) + "' requires CustomEase plugin " +
                '(gsap/CustomEase). Import it and register: ' +
                'gsap.registerPlugin(CustomEase).');
        }

        const from = _keyframeToGsapProps(kfs[0]);
        const to   = _keyframeToGsapProps(kfs[kfs.length - 1]);
        const st   = _gsapScrollTriggerFor(track);
        const kind = (track.timeline && track.timeline.kind) || 'view';

        if (kind === 'scroll') {
            lines.push('    // Timeline kind: scroll (attached to nearest scroll container).');
        }
        if (track.range && /contain/i.test(track.range.start + ' ' + track.range.end)) {
            lines.push('    // Note: `contain` range is approximated (depends on ' +
                'element/viewport size ratio at generation time).');
        }

        lines.push('    animations.push(gsap.fromTo(' + _jsValue(track.selector) + ',');
        lines.push('        ' + _fmtObjInline(from) + ',');
        lines.push('        {');
        const toKeys = Object.keys(to);
        for (let k = 0; k < toKeys.length; k++) {
            lines.push('            ' + toKeys[k] + ': ' + _jsValue(to[toKeys[k]]) + ',');
        }
        lines.push('            ease: ' + easingLiteral + ',');
        lines.push('            scrollTrigger: {');
        lines.push('                trigger: ' + _jsValue(st.trigger) + ',');
        lines.push('                start: '   + _jsValue(st.start)   + ',');
        lines.push('                end: '     + _jsValue(st.end)     + ',');
        lines.push('                scrub: true');
        lines.push('            }');
        lines.push('        }));');
        lines.push('');
    }

    lines.push('    return function detach() {');
    lines.push('        for (let i = 0; i < animations.length; i++) {');
    lines.push('            const anim = animations[i];');
    lines.push('            if (anim && anim.scrollTrigger) anim.scrollTrigger.kill();');
    lines.push('        }');
    lines.push('    };');
    lines.push('}');
    return lines.join('\n');
}

// -------------------------------------------------------------------
// toRig
// -------------------------------------------------------------------
/**
 * Convert a storyboard to runnable @zakkster/lite-scroll-rig-pro code.
 *
 * The rig supports EXACTLY 4 tracks per element (translateX, translateY,
 * scale, rotate). Any other property (opacity, filter, color, ...) is
 * dropped with an explanatory comment. scroll-timeline tracks are also
 * dropped -- the rig operates on view-timeline semantics only.
 *
 * Ranges other than the natural cover-range (element enter -> element
 * exit) are approximated by pre-scaling keyframe offsets. entry/exit
 * ranges use a 0.5-split heuristic; contain-range keyframes are placed
 * near t=0.5 with a warning.
 *
 * @param {Object} storyboard
 * @param {Object} [opts]
 * @param {'esm'|'cjs'} [opts.moduleFormat='esm']
 * @param {string} [opts.functionName='attachScrollRig']
 * @param {boolean} [opts.includeImports=true]
 * @returns {string} runnable JS
 */
export function toRig(storyboard, opts) {
    if (!storyboard || !Array.isArray(storyboard.tracks)) {
        throw new TypeError('toRig: storyboard.tracks required');
    }
    opts = opts || {};
    const moduleFormat = opts.moduleFormat || 'esm';
    const functionName = opts.functionName || 'attachScrollRig';
    const includeImports = opts.includeImports !== false;

    const lines = [];
    lines.push('// Generated by @zakkster/lite-scrollforge - toRig');
    lines.push('// Do not edit by hand. Regenerate from the source storyboard.');
    lines.push('// Rig supports translateX, translateY, scale, rotate only --');
    lines.push('// other properties are dropped with a comment per track.');
    lines.push('');

    if (includeImports) {
        if (moduleFormat === 'esm') {
            lines.push("import { ScrollEngine, DOMScroller } from '@zakkster/lite-scroll-rig-pro';");
            lines.push("import { KeyframePool } from '@zakkster/lite-keyframe';");
        } else {
            lines.push("const { ScrollEngine, DOMScroller } = require('@zakkster/lite-scroll-rig-pro');");
            lines.push("const { KeyframePool } = require('@zakkster/lite-keyframe');");
        }
        lines.push('');
    }

    // Filter to view-timeline tracks and build the selector list.
    const supportedTracks = [];
    const skippedForKind = [];
    for (let i = 0; i < storyboard.tracks.length; i++) {
        const track = storyboard.tracks[i];
        const kind = (track.timeline && track.timeline.kind) || 'view';
        if (kind === 'scroll') {
            skippedForKind.push({ i, selector: track.selector });
            continue;
        }
        supportedTracks.push({ i, track });
    }

    const openFn = moduleFormat === 'cjs'
        ? 'module.exports.' + functionName + ' = function ' + functionName + '(container) {'
        : 'export function ' + functionName + '(container) {';
    lines.push(openFn);

    for (let s = 0; s < skippedForKind.length; s++) {
        lines.push('    // Track ' + skippedForKind[s].i + ' (' +
            skippedForKind[s].selector + '): skipped -- ' +
            'scroll-timeline is not supported by the rig.');
    }
    if (skippedForKind.length > 0) lines.push('');

    lines.push('    const selectors = [');
    for (let s = 0; s < supportedTracks.length; s++) {
        lines.push('        ' + _jsValue(supportedTracks[s].track.selector) + ',');
    }
    lines.push('    ];');
    lines.push('    const elements = selectors.map(function (s) { return document.querySelector(s); });');
    lines.push('    const pool = new KeyframePool(elements.length * 4, 8);');
    lines.push('');

    for (let s = 0; s < supportedTracks.length; s++) {
        const idx = supportedTracks[s].i;
        const track = supportedTracks[s].track;
        const rowBase = s * 4;
        lines.push('    // Track ' + idx + ': ' + track.selector);

        // Compute the effective (tStart, tEnd) on the rig's [0, 1] axis.
        const tBounds = _rigTBoundsForRange(track.range);
        if (tBounds.warning) lines.push('    // ' + tBounds.warning);

        // Collect per-property keyframe data, dropping unsupported props.
        const kfs = track.keyframes;
        const dropped = new Set();
        const perProp = { translateX: [], translateY: [], scale: [], rotate: [] };

        for (let k = 0; k < kfs.length; k++) {
            const kf = kfs[k];
            // Determine offset (0..1), same logic as trackToCss.
            let offset;
            if (typeof kf.offset === 'number') {
                offset = kf.offset;
            } else if (kfs.length === 2) {
                offset = k === 0 ? 0 : 1;
            } else {
                offset = k / (kfs.length - 1);
            }
            // Scale offset into rig t-bounds.
            const t = tBounds.start + (tBounds.end - tBounds.start) * offset;
            for (const propName in kf) {
                if (propName === 'offset') continue;
                if (!Object.prototype.hasOwnProperty.call(kf, propName)) continue;
                if (Object.prototype.hasOwnProperty.call(_RIG_PROP_ROWS, propName)) {
                    perProp[propName].push({ t, value: kf[propName] });
                } else {
                    dropped.add(propName);
                }
            }
        }
        if (dropped.size > 0) {
            lines.push('    // Dropped (rig unsupported): ' +
                Array.from(dropped).join(', ') + '.');
        }

        // Emit pool.addKey(...) per supported property.
        for (const propName in perProp) {
            const rowOffset = _RIG_PROP_ROWS[propName];
            const keys = perProp[propName];
            for (let kk = 0; kk < keys.length; kk++) {
                lines.push('    pool.addKey(' + rowBase + ' + ' + rowOffset + ', ' +
                    _fmtNum(keys[kk].t) + ', ' + _fmtNum(keys[kk].value) + '); // ' + propName);
            }
        }
        lines.push('');
    }

    lines.push('    const engine = new ScrollEngine(container || document.body);');
    lines.push('    const scroller = new DOMScroller(elements, pool, { engine: engine });');
    lines.push('');
    lines.push('    return function detach() {');
    lines.push('        if (scroller && typeof scroller.dispose === "function") scroller.dispose();');
    lines.push('        if (engine   && typeof engine.dispose   === "function") engine.dispose();');
    lines.push('    };');
    lines.push('}');
    return lines.join('\n');
}

/**
 * Map a Scrollforge range to (tStart, tEnd) on the rig's [0, 1] axis.
 * Returns { start, end, warning? }.
 */
function _rigTBoundsForRange(range) {
    if (!range) return { start: 0, end: 1 };
    const s = _rangeToRigT(range.start, 'start');
    const e = _rangeToRigT(range.end,   'end');
    const warn = (s.warn || e.warn)
        ? 'Note: range endpoints approximated for the rig (entry/exit split at t=0.5; contain interior).'
        : null;
    return { start: s.t, end: e.t, warning: warn };
}
function _rangeToRigT(endpoint, kind /* 'start' | 'end' */) {
    if (endpoint == null) return { t: kind === 'start' ? 0 : 1, warn: false };
    if (typeof endpoint === 'number') return { t: endpoint / 100, warn: false };
    const s = String(endpoint).trim();
    // Named range: entry/contain/exit/cover X%
    const nm = _NAMED_RANGE_RE.exec(s);
    if (nm) {
        const name = nm[1].toLowerCase();
        const pct = +nm[2] / 100;
        switch (name) {
            case 'cover':   return { t: pct, warn: false };
            case 'entry':   return { t: pct * 0.5, warn: true };
            case 'exit':    return { t: 0.5 + pct * 0.5, warn: true };
            case 'contain': return { t: 0.5, warn: true };
        }
    }
    // Bare percentage.
    const pctMatch = _BARE_PCT_RE.exec(s);
    if (pctMatch) return { t: +pctMatch[1] / 100, warn: false };
    return { t: kind === 'start' ? 0 : 1, warn: true };
}

/** Compact number formatter -- strips trailing zeros, up to 6 decimals. */
function _fmtNum(n) {
    if (n === (n | 0)) return String(n);
    return (+n.toFixed(6)).toString();
}

// -------------------------------------------------------------------
// Session 5: Fallback runtime (polyfill for non-native browsers)
// -------------------------------------------------------------------
// attachStoryboardRuntime auto-detects native scroll-driven support and
// delegates to the CSS-injection path (attachStoryboard) when available.
// When not, it installs JS-driven animations: IntersectionObserver for
// view timelines, passive scroll listeners for scroll timelines. All
// per-track buffers pre-allocated at attach time.
//
// Zero-JS in the animation path on the NATIVE side (compositor handles
// it). Zero-alloc in the polyfill side (no per-frame object literals).

// --- Easing parsing (string -> (t) => number) ------------------------
const _CUBIC_BEZIER_RE = /^cubic-bezier\(\s*([^)]+)\s*\)$/;
const _LINEAR_FN_RE    = /^linear\(\s*([^)]+)\s*\)$/;

// CSS keywords -> bezier control points (per CSS Transitions spec).
const _CSS_KEYWORD_BEZIER = Object.freeze({
    'ease':        [0.25, 0.1, 0.25, 1],
    'ease-in':     [0.42, 0,   1,    1],
    'ease-out':    [0,    0,   0.58, 1],
    'ease-in-out': [0.42, 0,   0.58, 1]
});

function _linearFn(t) { return t; }

/**
 * Cubic-bezier evaluator (Newton-Raphson with bisection fallback).
 * Returns y(t) for the curve defined by (0,0), (x1,y1), (x2,y2), (1,1).
 * The runtime companion for this is @zakkster/lite-cubic-bezier -- we
 * ship an inline evaluator to keep zero-dep.
 */
function _makeBezier(x1, y1, x2, y2) {
    // Precompute polynomial coefficients (DoD: closure captures 6 numbers).
    const cx = 3 * x1;
    const bx = 3 * (x2 - x1) - cx;
    const ax = 1 - cx - bx;
    const cy = 3 * y1;
    const by = 3 * (y2 - y1) - cy;
    const ay = 1 - cy - by;

    function sampleX(t) { return ((ax * t + bx) * t + cx) * t; }
    function sampleY(t) { return ((ay * t + by) * t + cy) * t; }
    function sampleDX(t) { return (3 * ax * t + 2 * bx) * t + cx; }

    return function bezierEval(x) {
        if (x <= 0) return 0;
        if (x >= 1) return 1;
        // Newton-Raphson up to 8 iterations.
        let t = x;
        for (let i = 0; i < 8; i++) {
            const currentX = sampleX(t) - x;
            if (Math.abs(currentX) < 1e-6) return sampleY(t);
            const dx = sampleDX(t);
            if (Math.abs(dx) < 1e-6) break;
            t -= currentX / dx;
        }
        // Bisection fallback for pathological curves.
        let t0 = 0, t1 = 1;
        t = x;
        while (t0 < t1) {
            const currentX = sampleX(t);
            if (Math.abs(currentX - x) < 1e-6) return sampleY(t);
            if (x > currentX) t0 = t; else t1 = t;
            t = (t1 + t0) * 0.5;
            if (t1 - t0 < 1e-6) break;
        }
        return sampleY(t);
    };
}

/**
 * Piecewise-linear evaluator built from a CSS `linear()` argument string.
 * Accepts `'0, 0.5, 1'` (evenly spaced) OR `'0, 0.5 40%, 1'` (mixed).
 * Untagged points are auto-distributed.
 */
function _makeLinearPiecewise(argsStr) {
    // Parse into { t, v } pairs.
    const rawParts = argsStr.split(',');
    const raw = new Array(rawParts.length);
    for (let i = 0; i < rawParts.length; i++) {
        const seg = rawParts[i].trim();
        // "0.5 40%" or "0.5"
        const spaceIdx = seg.indexOf(' ');
        if (spaceIdx === -1) {
            raw[i] = { v: +seg, tPct: null };
        } else {
            const v = +seg.slice(0, spaceIdx);
            const pctPart = seg.slice(spaceIdx + 1).trim();
            const pct = +pctPart.replace('%', '') / 100;
            raw[i] = { v: v, tPct: pct };
        }
    }
    // Fill missing tPct values via linear interpolation between neighbors.
    if (raw[0].tPct == null) raw[0].tPct = 0;
    if (raw[raw.length - 1].tPct == null) raw[raw.length - 1].tPct = 1;
    let lastKnown = 0;
    for (let i = 1; i < raw.length - 1; i++) {
        if (raw[i].tPct != null) { lastKnown = i; continue; }
        // Find next known
        let next = i + 1;
        while (next < raw.length && raw[next].tPct == null) next++;
        const knownStart = raw[lastKnown].tPct;
        const knownEnd = raw[next].tPct;
        const gap = next - lastKnown;
        for (let j = i; j < next; j++) {
            raw[j].tPct = knownStart + ((j - lastKnown) / gap) * (knownEnd - knownStart);
        }
        i = next - 1;
        lastKnown = next;
    }
    // Pack into typed arrays for hot lookup.
    const n = raw.length;
    const ts = new Float64Array(n);
    const vs = new Float64Array(n);
    for (let i = 0; i < n; i++) { ts[i] = raw[i].tPct; vs[i] = raw[i].v; }

    return function linearEval(x) {
        if (x <= ts[0])       return vs[0];
        if (x >= ts[n - 1])   return vs[n - 1];
        // Binary search for the segment.
        let lo = 0, hi = n - 1;
        while (hi - lo > 1) {
            const mid = (lo + hi) >>> 1;
            if (ts[mid] > x) hi = mid; else lo = mid;
        }
        const span = ts[hi] - ts[lo];
        if (span <= 0) return vs[lo];
        const localT = (x - ts[lo]) / span;
        return vs[lo] + localT * (vs[hi] - vs[lo]);
    };
}

/**
 * Convert a Scrollforge easing input (string, function, null) into a
 * pure `(t: number) => number` function.
 */
function _parseEasingToFn(input) {
    if (input == null) return _linearFn;
    if (typeof input === 'function') return input;
    if (typeof input !== 'string') return _linearFn;

    // Resolve preset names via CSS_EASINGS first.
    let str = input;
    if (Object.prototype.hasOwnProperty.call(CSS_EASINGS, input)) {
        str = CSS_EASINGS[input];
    }

    if (str === 'linear') return _linearFn;

    // cubic-bezier(...)
    const cbMatch = _CUBIC_BEZIER_RE.exec(str);
    if (cbMatch) {
        const nums = cbMatch[1].split(',');
        return _makeBezier(+nums[0], +nums[1], +nums[2], +nums[3]);
    }

    // linear(...)
    const linMatch = _LINEAR_FN_RE.exec(str);
    if (linMatch) return _makeLinearPiecewise(linMatch[1]);

    // CSS keywords
    if (Object.prototype.hasOwnProperty.call(_CSS_KEYWORD_BEZIER, str)) {
        const cps = _CSS_KEYWORD_BEZIER[str];
        return _makeBezier(cps[0], cps[1], cps[2], cps[3]);
    }

    return _linearFn;
}

// --- Range endpoint -> progress [0, 1] mapping (polyfill side) -------
// The polyfill computes progress based on element/scroll position and
// then maps range-endpoint semantics onto that raw progress. This is
// where entry/contain/exit/cover ranges get their DEFINITION in JS.

// Range kind enum -- integer codes so hot-path dispatch is a fast switch
// on a small int, not a string compare. Kind is stored on the parsed
// endpoint struct at setup time.
const _RK_NONE    = 0;
const _RK_BARE    = 1;
const _RK_COVER   = 2;
const _RK_ENTRY   = 3;
const _RK_CONTAIN = 4;
const _RK_EXIT    = 5;

/**
 * Parse a range endpoint string ONCE at setup time. Called from
 * _createTrackState -- never from the frame loop.
 *
 * Returns a compact { kind: number, pct: number } struct. All the
 * expensive stuff (String() coercion, regex compilation + exec, match-
 * array allocation) happens here, then the observer callback does pure
 * arithmetic on the pre-parsed struct -- zero allocation per frame.
 */
function _parseRangeEndpoint(endpoint, fallback) {
    if (endpoint == null) return { kind: _RK_NONE, pct: fallback };
    if (typeof endpoint === 'number') return { kind: _RK_BARE, pct: endpoint / 100 };
    const s = String(endpoint).trim();
    const nm = _NAMED_RANGE_RE.exec(s);
    if (nm) {
        const name = nm[1].toLowerCase();
        const pct = +nm[2] / 100;
        let kind;
        switch (name) {
            case 'cover':   kind = _RK_COVER;   break;
            case 'entry':   kind = _RK_ENTRY;   break;
            case 'contain': kind = _RK_CONTAIN; break;
            case 'exit':    kind = _RK_EXIT;    break;
            default:        return { kind: _RK_NONE, pct: fallback };
        }
        return { kind: kind, pct: pct };
    }
    const pm = _BARE_PCT_RE.exec(s);
    if (pm) return { kind: _RK_BARE, pct: +pm[1] / 100 };
    return { kind: _RK_NONE, pct: fallback };
}

/**
 * Compute range bounds from pre-parsed endpoints and write directly into
 * state.rangeStart / state.rangeEnd. Writing into an existing struct
 * avoids the `{ start, end }` object allocation that a return value
 * would produce -- zero allocations per frame.
 */
function _computeRangeBoundsInto(parsedStart, parsedEnd, elH, viewportH, state) {
    const total = viewportH + elH;
    const entryFrac = total > 0 ? elH / total : 0;
    const exitStart = total > 0 ? viewportH / total : 1;
    state.rangeStart = _applyParsedRange(parsedStart, entryFrac, exitStart);
    state.rangeEnd   = _applyParsedRange(parsedEnd,   entryFrac, exitStart);
}

function _applyParsedRange(parsed, entryFrac, exitStart) {
    // Identity: entryFrac + exitStart == 1 (elH/(S+E) + S/(S+E)). So entry
    // spans [0, entryFrac] and exit spans [exitStart, 1] for ANY subject
    // height -- neither needs a tall-subject swap. Only `contain` inverts:
    // for a SHORT subject (elH < viewportH) entryFrac < exitStart and the
    // element is fully CONTAINED across [entryFrac, exitStart]; for a TALL
    // subject (elH > viewportH) exitStart < entryFrac and the element fully
    // COVERS the scrollport across [exitStart, entryFrac]. The spec's
    // tall-subject behavior is the endpoint swap: contain 0% == min, contain
    // 100% == max -- never rangeEnd < rangeStart, never clamp-stuck-at-zero.
    const pct = parsed.pct;
    switch (parsed.kind) {
        case _RK_NONE:    return pct;
        case _RK_BARE:    return pct;
        case _RK_COVER:   return pct;
        case _RK_ENTRY:   return pct * entryFrac;
        case _RK_EXIT:    return exitStart + pct * entryFrac;
        case _RK_CONTAIN: {
            const lo = entryFrac < exitStart ? entryFrac : exitStart;
            const hi = entryFrac < exitStart ? exitStart : entryFrac;
            return lo + pct * (hi - lo);
        }
        default:          return pct;
    }
}

// --- Track state builder --------------------------------------------
// A "track state" holds all pre-allocated buffers + observer handles
// for one live track. Constructed at attach time; mutated per frame.

const _TRANSFORM_COMPONENTS = Object.freeze({
    translateX: true, translateY: true, translateZ: true,
    scale: true, scaleX: true, scaleY: true, rotate: true
});

/**
 * Attach-time feature check for Transforms Level 2 individual transform
 * properties (`translate:` / `scale:` / `rotate:`). True on the polyfill's
 * actual audience (Firefox stable, Safari, Chrome 104+). When false, the
 * frame loop falls back to the visually-divergent legacy `style.transform`
 * string. Evaluated once per track at attach -- never in the frame loop.
 */
function _supportsIndividualTransforms() {
    return typeof CSS !== 'undefined' &&
        typeof CSS.supports === 'function' &&
        CSS.supports('translate: 0px');
}

function _createTrackState(track) {
    const el = document.querySelector(track.selector);
    if (!el) return null;

    const kfs = track.keyframes;
    const n = kfs.length;
    const offsets = new Float64Array(n);

    // Determine offsets (auto-distribute if not set).
    let hasAny = false;
    for (let i = 0; i < n; i++) {
        if (typeof kfs[i].offset === 'number') { hasAny = true; break; }
    }
    for (let i = 0; i < n; i++) {
        if (typeof kfs[i].offset === 'number')  offsets[i] = kfs[i].offset;
        else if (!hasAny)                        offsets[i] = i / (n - 1);
        else                                     offsets[i] = i === 0 ? 0 : i === n - 1 ? 1 : NaN;
    }

    // Collect the set of animated properties across all keyframes.
    const propSet = Object.create(null);
    for (let i = 0; i < n; i++) {
        for (const k in kfs[i]) {
            if (k === 'offset') continue;
            if (!Object.prototype.hasOwnProperty.call(kfs[i], k)) continue;
            propSet[k] = true;
        }
    }
    const props = Object.keys(propSet);

    // Per-property Float64Array of values across keyframes.
    // Non-numeric props (strings) get a plain array of strings.
    // We build these into PARALLEL ARRAYS keyed by index so the hot
    // loop can use a dense `for (let i = 0; i < N; i++)` -- for..in
    // would force V8 to walk the prototype chain and deoptimize.
    const numericProps  = [];
    const numericArrays = [];
    const stringProps   = [];
    const stringArrays  = [];
    for (let p = 0; p < props.length; p++) {
        const name = props[p];
        const arr = new Float64Array(n);
        const strArr = new Array(n);
        let anyString = false;
        for (let i = 0; i < n; i++) {
            const v = kfs[i][name];
            if (typeof v === 'number') {
                arr[i] = v;
                strArr[i] = null;
            } else if (v == null) {
                // Missing keyframe value -- carry forward from previous.
                arr[i] = i > 0 ? arr[i - 1] : 0;
                strArr[i] = i > 0 ? strArr[i - 1] : null;
            } else {
                arr[i] = NaN;
                strArr[i] = String(v);
                anyString = true;
            }
        }
        if (anyString) {
            stringProps.push(name);
            stringArrays.push(strArr);
        } else {
            numericProps.push(name);
            numericArrays.push(arr);
        }
    }

    // Cache the resolved CSS property NAME and unit for every numeric prop
    // ONCE at attach (NIT 2). The frame loop then allocates exactly one string
    // per changed property -- the VALUE -- never a second string for the
    // kebab-cased name of an unmapped/custom prop. Transform components are
    // flushed separately, so their slots stay null.
    const numericCss  = new Array(numericProps.length);
    const numericUnit = new Array(numericProps.length);
    for (let i = 0; i < numericProps.length; i++) {
        const name = numericProps[i];
        if (_TRANSFORM_COMPONENTS[name] === true) { numericCss[i] = null; numericUnit[i] = ''; continue; }
        if (name.startsWith('--')) { numericCss[i] = name; numericUnit[i] = ''; continue; }
        const map = PROP_MAPPING[name];
        if (map) { numericCss[i] = map.css; numericUnit[i] = map.unit || ''; }
        else     { numericCss[i] = name.replace(KEBAB_REGEX, _kebabRepl); numericUnit[i] = ''; }
    }
    // Same for string props (mapped css is stable; kebab of an unmapped name
    // is computed once here, not per frame).
    const stringCss = new Array(stringProps.length);
    for (let i = 0; i < stringProps.length; i++) {
        const name = stringProps[i];
        if (name.startsWith('--')) { stringCss[i] = name; continue; }
        const map = PROP_MAPPING[name];
        stringCss[i] = map ? map.css : name.replace(KEBAB_REGEX, _kebabRepl);
    }

    // Pre-parse range endpoints ONCE. The hot path reads these compact
    // structs and does pure arithmetic -- no String() or regex per frame.
    const rangeSrc = track.range || null;
    const parsedRangeStart = _parseRangeEndpoint(rangeSrc && rangeSrc.start, 0);
    const parsedRangeEnd   = _parseRangeEndpoint(rangeSrc && rangeSrc.end,   1);

    return {
        el,
        selector: track.selector,
        timelineKind: (track.timeline && track.timeline.kind) || 'view',
        scroller: (track.timeline && track.timeline.scroller) || null,
        parsedRangeStart,
        parsedRangeEnd,
        offsets,
        numericProps,
        numericArrays,
        numericCss,
        numericUnit,
        stringProps,
        stringArrays,
        stringCss,
        propsCount: numericProps.length + stringProps.length,
        easingFn: _parseEasingToFn(track.easing),
        fill: track.fill || 'both',
        // Write half (SF-04): individual transform props vs legacy string,
        // decided ONCE here at attach time -- never re-checked per frame.
        useIndividual: _supportsIndividualTransforms(),
        // Runtime state:
        observer:  null,
        listener:  null,
        rafHandle: null,
        boundApply: null,
        rangeStart: 0,
        rangeEnd:   1,
        // Hybrid-drive state (SF-01): the IO visibility gate flips _gateOn and
        // parks/unparks the ticker; _tickFn is the ticker's tick(), invoked on
        // unpark for an immediate catch-up. _rootEl is set at install.
        _parked:   false,
        _gateOn:   false,
        _tickFn:   null,
        _rootEl:   undefined,
        _scrollTarget: null,
        // Pure-compute scratch (zero per-frame allocation): _computeFrame
        // writes interpolated numeric values into _values (parallel to
        // numericProps) and the located keyframe index into _kLo, and
        // accumulates transform components into _scratch. The DOM-write half
        // of _applyTrackFrame reads these; only the writes allocate strings.
        _values: new Float64Array(numericProps.length),
        _kLo: 0,
        _scratch: { tx: 0, ty: 0, sx: 1, sy: 1, rot: 0, hasTr: false, hasSc: false, hasRot: false }
    };
}

// IO is a visibility GATE ONLY (SF-01) -- it no longer drives progress, so
// the old 257-slot resolution table is gone. The gate needs exactly two
// thresholds: a park edge (_GATE_LO, fully off-screen) and an unpark edge
// (_GATE_HI, meaningfully on-screen). The gap between them -- one IO
// threshold wide (1/256) -- is the hysteresis that stops boundary jitter at a
// single threshold from thrashing park/unpark.
const _GATE_LO = 0;
const _GATE_HI = 1 / 256;
const _GATE_THRESHOLDS = [_GATE_LO, _GATE_HI];

// --- Frame apply (called by the ticker) -----------------------------
// Split into two halves so the allocation story is honest and separately
// gated (see decisions/0001-drive-model.md, "Allocation gate semantics"):
//   _computeFrame -- PURE math: range mapping, easing, keyframe-interval
//     location, numeric interpolation into pre-allocated scratch. ZERO
//     allocation per call; gated at 0 B/op.
//   _applyTrackFrame -- the DOM-write half. Reads the scratch and writes it
//     out. Allocates exactly one string per changed property at the DOM
//     boundary (unavoidable); gated by the per-frame ceiling and bytes/op +
//     majors-per-KOp RATE, not an absolute major-GC count over a loop.
function _computeFrame(state, rawProgress) {
    // Map raw [0, 1] progress through the range bounds.
    const span = state.rangeEnd - state.rangeStart;
    let p;
    if (span > 0) {
        p = (rawProgress - state.rangeStart) / span;
        if (p < 0) p = 0;
        else if (p > 1) p = 1;
    } else {
        // Degenerate zero-length range -- the 1x-viewport contain case where
        // entryFrac == exitStart exactly. Resolve per spec as a step at the
        // boundary: 0 before the point, 1 at/after it. NOT stuck-at-zero.
        p = rawProgress < state.rangeStart ? 0 : 1;
    }
    // Apply easing.
    const pE = state.easingFn(p);

    // Locate keyframe interval containing pE.
    const offsets = state.offsets;
    const n = offsets.length;
    let kLo = 0;
    for (let i = 1; i < n; i++) {
        if (offsets[i] > pE) break;
        kLo = i;
    }
    const kHi = kLo === n - 1 ? kLo : kLo + 1;
    const oLo = offsets[kLo];
    const oHi = offsets[kHi];
    const localT = oHi === oLo ? 0 : (pE - oLo) / (oHi - oLo);

    // Reset transform scratch.
    const sc = state._scratch;
    sc.tx = 0; sc.ty = 0; sc.sx = 1; sc.sy = 1; sc.rot = 0;
    sc.hasTr = false; sc.hasSc = false; sc.hasRot = false;

    // Numeric interpolation -- dense indexed loop over parallel arrays.
    // Values land in the pre-allocated _values buffer; transform components
    // also accumulate into scratch. No style writes here -> no allocation.
    const numericProps  = state.numericProps;
    const numericArrays = state.numericArrays;
    const values = state._values;
    const nNumeric = numericProps.length;
    for (let i = 0; i < nNumeric; i++) {
        const arr = numericArrays[i];
        const value = arr[kLo] + localT * (arr[kHi] - arr[kLo]);
        values[i] = value;
        const name = numericProps[i];
        if (_TRANSFORM_COMPONENTS[name] === true) {
            if (name === 'translateX') { sc.tx = value; sc.hasTr = true; }
            else if (name === 'translateY') { sc.ty = value; sc.hasTr = true; }
            else if (name === 'scale')      { sc.sx = value; sc.sy = value; sc.hasSc = true; }
            else if (name === 'scaleX')     { sc.sx = value; sc.hasSc = true; }
            else if (name === 'scaleY')     { sc.sy = value; sc.hasSc = true; }
            else if (name === 'rotate')     { sc.rot = value; sc.hasRot = true; }
        }
    }
    state._kLo = kLo;
}

function _applyTrackFrame(state, rawProgress) {
    _computeFrame(state, rawProgress);   // pure, zero-allocation

    // --- DOM-write half (the acknowledged per-frame string boundary) ---
    // Exactly one allocated string per changed property: the VALUE. The CSS
    // name + unit were resolved once at attach (state.numericCss/numericUnit).
    const style = state.el.style;
    const numericProps = state.numericProps;
    const numericCss   = state.numericCss;
    const numericUnit  = state.numericUnit;
    const values = state._values;
    const nNumeric = numericProps.length;
    for (let i = 0; i < nNumeric; i++) {
        if (_TRANSFORM_COMPONENTS[numericProps[i]] === true) continue;   // flushed below
        const unit = numericUnit[i];
        style.setProperty(numericCss[i], unit ? (values[i] + unit) : String(values[i]));
    }
    // String properties -- snap to the CURRENT keyframe (no interpolation).
    const stringArrays = state.stringArrays;
    const stringCss    = state.stringCss;
    const kLo = state._kLo;
    const nString = stringArrays.length;
    for (let i = 0; i < nString; i++) {
        const v = stringArrays[i][kLo];
        if (v != null) style.setProperty(stringCss[i], v);
    }
    // Flush transform if any transform component was set. SF-04: write the
    // INDIVIDUAL Transforms Level 2 properties -- the same properties the
    // native path animates -- in spec composition order translate -> rotate
    // -> scale (the browser composes them in that order regardless of write
    // order), leaving any author `transform` untouched. One allocated string
    // per CHANGED component: at most three per frame.
    const sc = state._scratch;
    if (state.useIndividual) {
        if (sc.hasTr)  style.translate = sc.tx + 'px ' + sc.ty + 'px';
        if (sc.hasRot) style.rotate    = sc.rot + 'deg';
        if (sc.hasSc)  style.scale     = sc.sx + ' ' + sc.sy;
    } else if (sc.hasTr || sc.hasSc || sc.hasRot) {
        // Legacy path -- browsers without Transforms Level 2 individual
        // properties. A single `style.transform` string in spec composition
        // order translate -> rotate -> scale. VISUALLY DIVERGENT LEGACY: this
        // clobbers any author `transform`; the individual-property path above
        // does not. Gated behind the attach-time feature check in
        // _createTrackState (state.useIndividual).
        style.transform =
            (sc.hasTr  ? ('translate(' + sc.tx + 'px, ' + sc.ty + 'px)') : '') +
            (sc.hasRot ? (' rotate(' + sc.rot + 'deg)') : '') +
            (sc.hasSc  ? (' scale(' + sc.sx + ', ' + sc.sy + ')') : '');
    }
}

// --- Observers ------------------------------------------------------

/**
 * Accumulate offsetTop up the offsetParent chain to the document root.
 * Layout position, transform-immune for the node itself (the documented
 * ancestor-transform limit still applies). Zero allocation -- a pointer walk
 * over integers, called at most twice per scroll pass.
 */
function _offsetChainTop(node) {
    let top = 0;
    while (node) {
        top += node.offsetTop || 0;
        node = node.offsetParent;
    }
    return top;
}

/**
 * Find the nearest scrolling ancestor of `el`. Returns the element (or
 * null if none found, meaning the document/window is the scrollport).
 * Matches how native CSS `view()` resolves its scrollport: the nearest
 * ancestor with `overflow-y: auto | scroll | overlay` whose content
 * actually overflows.
 *
 * Called ONCE per track at attach -- never in the frame loop.
 */
function _findNearestScroller(el) {
    if (typeof getComputedStyle === 'undefined') return null;
    let current = el && el.parentElement;
    while (current) {
        const cs = getComputedStyle(current);
        const oy = cs.overflowY;
        if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') {
            // Only count it if the element actually has an overflow to scroll.
            if (current.scrollHeight > current.clientHeight) return current;
        }
        current = current.parentElement;
    }
    return null;
}

function _installViewObserver(state) {
    const el = state.el;
    // Detect the scrollport once, shared by the ticker and (when present) the
    // IO visibility gate. Explicit `track.timeline.scroller` wins; otherwise
    // auto-detect the nearest scrolling ancestor (matches native `view()`).
    let rootEl = null;
    if (state.scroller && typeof document !== 'undefined') {
        rootEl = document.querySelector(state.scroller);
    }
    if (!rootEl) rootEl = _findNearestScroller(el);
    state._rootEl = rootEl;

    if (typeof IntersectionObserver === 'undefined') {
        // No IntersectionObserver -- the ticker runs UNPARKED (always active).
        // It is the single progress code path for both the IO and no-IO
        // worlds; nothing else computes progress.
        _installViewTicker(state, false);
        return;
    }

    // IO becomes a VISIBILITY GATE ONLY (SF-01): it never computes progress.
    // Attach the ticker PARKED, then let the gate unpark it on entry and park
    // it on exit. Parked off-screen tracks cost zero rAF wake-ups; on-screen
    // tracks tick every frame -- including the entire contain phase, where the
    // intersection ratio is constant and the old IO-driven math froze.
    _installViewTicker(state, true);
    state._gateOn = false;

    const observer = new IntersectionObserver(function (entries) {
        for (let i = 0; i < entries.length; i++) {
            const ratio = entries[i].intersectionRatio;
            if (!state._gateOn) {
                // Unpark once the element is meaningfully on-screen.
                if (ratio >= _GATE_HI) { state._gateOn = true; _unparkTicker(state); }
            } else {
                // Park only once the element is fully off-screen. The
                // _GATE_HI - _GATE_LO gap (one threshold) is the hysteresis.
                if (ratio <= _GATE_LO) { state._gateOn = false; _parkTicker(state); }
            }
        }
    }, { root: rootEl, threshold: _GATE_THRESHOLDS });
    observer.observe(el);
    state.observer = observer;
}

/** Unpark the ticker and immediately tick for a catch-up frame. */
function _unparkTicker(state) {
    state._parked = false;
    if (typeof state._tickFn === 'function') state._tickFn();
}

/** Park the ticker and drop any pending rAF -- zero wake-ups off-screen. */
function _parkTicker(state) {
    state._parked = true;
    if (state.rafHandle != null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(state.rafHandle);
        state.rafHandle = null;
    }
}

/**
 * The single view-progress ticker (SF-01 / SF-02). Progress is a pure
 * function of scroll position, computed from an offsetTop-chain accumulation
 * walked ONCE per scroll pass -- never from getBoundingClientRect, so the
 * track's OWN applied translate/scale/rotate cannot feed back into its
 * measured progress. Known limit: offsetTop is layout, not visual, so a
 * CSS-transformed ANCESTOR is not reflected here (see
 * decisions/0001-drive-model.md). When `startParked` is true the ticker is
 * dormant until the IO gate unparks it.
 */
function _installViewTicker(state, startParked) {
    const el = state.el;
    if (state._rootEl === undefined) {
        let rootEl = null;
        if (state.scroller && typeof document !== 'undefined') {
            rootEl = document.querySelector(state.scroller);
        }
        if (!rootEl) rootEl = _findNearestScroller(el);
        state._rootEl = rootEl;
    }
    const rootEl = state._rootEl;
    state._parked = startParked === true;
    let pending = false;

    function tick() {
        pending = false;
        state.rafHandle = null;
        let viewportH, scrollPos, originTop;
        if (rootEl) {
            viewportH = rootEl.clientHeight || 0;
            scrollPos = rootEl.scrollTop || 0;
            // Reconcile to the scroller's OWN coordinate origin. A
            // position:static overflow scroller -- the default scroll
            // container -- is not a positioned ancestor, so offsetParent skips
            // it and the element's chain runs past it to the document root.
            // Accumulate the scroller to the same root and subtract, so
            // chainTop and scrollPos share one origin. (A positioned scroller
            // cancels identically -- its own offset appears in both walks.)
            // Without this, a static scroller partway down the page pollutes
            // relTop and clamps progress to 0 (the v1.0.0 rootBounds path
            // handled this; see decisions/0001-drive-model.md).
            originTop = _offsetChainTop(rootEl);
        } else {
            viewportH = (typeof window !== 'undefined' ? window.innerHeight : 0) || 0;
            scrollPos = (typeof window !== 'undefined' ? window.scrollY : 0) || 0;
            originTop = 0;
        }
        // offsetTop chain: layout position of the element within the
        // scrollport's content, accumulated once here per scroll pass. Pure
        // number arithmetic + a pointer walk -- zero allocation.
        const chainTop = _offsetChainTop(el);
        const elH = el.offsetHeight || 0;
        const total = viewportH + elH;
        const relTop = chainTop - originTop - scrollPos;
        const traversed = viewportH - relTop;
        const raw = total > 0 ? traversed / total : 0;
        _computeRangeBoundsInto(state.parsedRangeStart, state.parsedRangeEnd, elH, viewportH, state);
        _applyTrackFrame(state, raw);
    }
    function onScroll() {
        if (state._parked) return;   // parked off-screen -- zero rAF wake-ups
        if (pending) return;
        pending = true;
        if (typeof requestAnimationFrame === 'function') {
            state.rafHandle = requestAnimationFrame(tick);
        } else {
            tick();
        }
    }
    const scrollTarget = rootEl || (typeof window !== 'undefined' ? window : null);
    if (scrollTarget) {
        scrollTarget.addEventListener('scroll', onScroll, { passive: true });
    }
    state.listener = onScroll;
    state._scrollTarget = scrollTarget;
    state._tickFn = tick;
    if (!state._parked) tick();   // initial paint
}

function _installScrollObserver(state) {
    const scrollerSel = state.scroller;
    const scroller = scrollerSel && scrollerSel !== 'root'
        ? document.querySelector(scrollerSel) : window;
    // Scroll-timeline range bounds are element-size-independent. Compute
    // ONCE here and store -- no need to recompute per frame.
    _computeRangeBoundsInto(state.parsedRangeStart, state.parsedRangeEnd, 0, 1, state);

    let pending = false;
    function tick() {
        pending = false;
        let progress;
        if (scroller === window) {
            const total = document.documentElement.scrollHeight - window.innerHeight;
            progress = total > 0 ? window.scrollY / total : 0;
        } else {
            const total = scroller.scrollHeight - scroller.clientHeight;
            progress = total > 0 ? scroller.scrollTop / total : 0;
        }
        _applyTrackFrame(state, progress);
    }
    function onScroll() {
        if (pending) return;
        pending = true;
        state.rafHandle = requestAnimationFrame(tick);
    }
    scroller.addEventListener('scroll', onScroll, { passive: true });
    state.listener = onScroll;
    state._scrollerEl = scroller;
    tick();
}

// --- Public entry point ---------------------------------------------
/**
 * Attach a storyboard for cross-browser scroll-driven playback.
 *
 * Auto-detects native support:
 *   - Native path: delegates to attachStoryboard (CSS injection).
 *   - Polyfill path: installs IntersectionObserver + scroll listeners
 *     and JS-drives the animations. Uses pre-allocated Float64Array
 *     buffers per track; frame loop is allocation-free apart from the
 *     transform string (unavoidable for style.transform).
 *
 * @param {Object} storyboard
 * @param {Object} [opts]
 * @param {Node|Element} [opts.root]        for native path (defaults document.head)
 * @param {'auto'|'native'|'polyfill'} [opts.runtime='auto']
 * @returns {{ detach: () => void }}
 */
export function attachStoryboardRuntime(storyboard, opts) {
    if (!storyboard || !Array.isArray(storyboard.tracks)) {
        throw new TypeError('attachStoryboardRuntime: storyboard.tracks required');
    }
    opts = opts || {};
    const runtime = opts.runtime || 'auto';
    const useNative = runtime === 'native' ||
                      (runtime === 'auto' && HAS_NATIVE_SUPPORT);

    if (useNative) {
        return attachStoryboard(storyboard, opts.root);
    }

    // Polyfill path.
    if (typeof document === 'undefined') {
        throw new Error('attachStoryboardRuntime: no document available (browser-only)');
    }
    const states = [];
    for (let i = 0; i < storyboard.tracks.length; i++) {
        const track = storyboard.tracks[i];
        const state = _createTrackState(track);
        if (!state) continue;   // element not found -- skip
        if (state.timelineKind === 'scroll') _installScrollObserver(state);
        else                                  _installViewObserver(state);
        states.push(state);
    }
    return {
        detach() {
            for (let i = 0; i < states.length; i++) {
                const st = states[i];
                if (st.observer) st.observer.disconnect();
                if (st.listener) {
                    const target = st._scrollTarget || st._scrollerEl || window;
                    target.removeEventListener('scroll', st.listener);
                }
                if (st.rafHandle != null && typeof cancelAnimationFrame === 'function') {
                    cancelAnimationFrame(st.rafHandle);
                    st.rafHandle = null;
                }
                // Cancel the ticker and clear the park flag (SF-01 / task 5):
                // park it so a late scroll event is a no-op, and drop the
                // tick closure so nothing outlives the attachment.
                st._parked = true;
                st._tickFn = null;
            }
        }
    };
}

// -------------------------------------------------------------------
// End of Session 5 exports
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Internal drive-train surface -- underscore-prefixed, NOT part of the
// supported public API (absent from Scrollforge.d.ts on purpose). Exported
// only so the SF0 fixtures and torture harness can pin the range math and the
// write half directly against hand-derived bounds and a fake style sink.
// -------------------------------------------------------------------
export {
    _parseRangeEndpoint,
    _computeRangeBoundsInto,
    _applyParsedRange,
    _computeFrame,
    _applyTrackFrame,
    _createTrackState,
    _installViewObserver,
    _installViewTicker,
    _supportsIndividualTransforms
};
