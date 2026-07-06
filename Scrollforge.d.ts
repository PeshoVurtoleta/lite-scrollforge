// Type definitions for @zakkster/lite-scrollforge v1.0.0
// Zero-GC, zero-dependency authoring layer for CSS Scroll-Driven Animations.
// Types match the .js exports set verbatim.

// -------------------------------------------------------------------
// Storyboard shapes
// -------------------------------------------------------------------

/**
 * An easing input. Accepts:
 *  - a preset name from `CSS_EASINGS` (e.g., 'easeOutCubic', 'ease-in')
 *  - a raw CSS timing-function string (`'cubic-bezier(...)'`, `'linear(...)'`,
 *    `'steps(...)'`, or a keyword)
 *  - a pure `(t: number) => number` function -- will be sampled and emitted
 *    as CSS `linear(...)` by trackToCss / storyboardToCss, and used directly
 *    at runtime by attachStoryboardRuntime's polyfill path.
 */
export type Easing = string | ((t: number) => number) | null | undefined;

/** A single keyframe. `offset` is optional; when absent, keyframes auto-distribute. */
export interface Keyframe {
    offset?: number;
    opacity?: number;
    translateX?: number;
    translateY?: number;
    translateZ?: number;
    scale?: number;
    scaleX?: number;
    scaleY?: number;
    rotate?: number;
    [property: string]: number | string | undefined;
}

/**
 * Timeline reference. Either an anonymous view()/scroll() (via `kind`) or a
 * named timeline declared on some ancestor (via `name`).
 */
export interface TimelineRef {
    kind?: 'view' | 'scroll';
    name?: string;
    axis?: 'block' | 'inline' | 'x' | 'y';
    scroller?: string;   // CSS selector for the scroll container (scroll timelines)
}

/**
 * A range endpoint expressed in CSS animation-range syntax.
 *   - '25%' / '100%'                  bare percentage
 *   - 'entry 0%' | 'entry 100%'       named view-timeline range
 *   - 'contain 0%' | 'contain 100%'
 *   - 'exit 0%' | 'exit 100%'
 *   - 'cover 0%' | 'cover 100%'
 */
export type RangeEndpoint = string;

export interface RangeSpec {
    start?: RangeEndpoint;
    end?:   RangeEndpoint;
}

/** A single animation track -- one selector, one timeline, N keyframes. */
export interface Track {
    selector: string;
    timeline?: TimelineRef;
    range?: RangeSpec;
    keyframes: Keyframe[];
    easing?: Easing;
    fill?: 'none' | 'forwards' | 'backwards' | 'both';
    duration?: number | string;
}

/**
 * A named-timeline declaration. Attaches `view-timeline-name:` or
 * `scroll-timeline-name:` to `attachedSelector` in the emitted CSS.
 */
export interface NamedTimeline {
    attachedSelector: string;
    kind: 'view' | 'scroll';
    axis?: 'block' | 'inline' | 'x' | 'y';
    scroller?: string;
}

/** The top-level storyboard config. */
export interface Storyboard {
    timelines?: Record<string, NamedTimeline>;
    tracks: Track[];
}

// -------------------------------------------------------------------
// Session 1 -- Core CSS emission
// -------------------------------------------------------------------

/**
 * The output of `trackToCss`: a keyframes rule + a selector rule.
 * `storyboardToCss` combines these across all tracks and timelines.
 */
export interface TrackCssResult {
    keyframesName: string;
    keyframesCss: string;
    ruleCss: string;
}

/**
 * Convert a single track config to CSS keyframes + rule.
 * Deterministic keyframe naming (see resetKeyframeCounter for byte-stable tests).
 */
export function trackToCss(track: Track): TrackCssResult;

/**
 * Convert a full storyboard (including named timelines) to a single CSS string.
 */
export function storyboardToCss(storyboard: Storyboard, opts?: {
    prettyPrint?: boolean;
}): string;

/**
 * Handle returned by attachStoryboard / attachStoryboardRuntime.
 */
export interface AttachHandle {
    detach(): void;
    styleElement?: HTMLStyleElement;
}

/**
 * Attach a storyboard's compiled CSS to the document via a <style> element.
 * Browser-only. For cross-browser (including polyfill), use attachStoryboardRuntime.
 */
export function attachStoryboard(storyboard: Storyboard, root?: Node): AttachHandle;

/**
 * Reset the internal keyframe counter used by trackToCss / storyboardToCss.
 * Useful for byte-stable golden-file tests.
 */
export function resetKeyframeCounter(): void;

/**
 * `true` when the browser supports CSS scroll-driven animations natively
 * (via `CSS.supports('animation-timeline: view()')`). In Node / SSR, always false.
 */
export const HAS_NATIVE_SUPPORT: boolean;

// -------------------------------------------------------------------
// Session 2 -- Easing presets + CSS Level 4 linear() emission
// -------------------------------------------------------------------

/**
 * Frozen table of CSS timing-function presets. 29 entries:
 *   - 5 CSS keywords: linear, ease, easeIn, easeOut, easeInOut
 *   - 8 Penner families × 3 variants each: Sine, Quad, Cubic, Quart, Quint,
 *     Expo, Circ, Back -- all in / out / inOut. Only cubic-bezier-representable
 *     easings are included; analytic curves (Bounce, Elastic) require a
 *     function easing from `@zakkster/lite-ease`.
 */
export const CSS_EASINGS: Readonly<Record<string, string>>;

/**
 * @deprecated Renamed to `CSS_EASINGS`. Kept as an alias for backward
 * compatibility; will be removed in a future major.
 */
export const EASINGS: Readonly<Record<string, string>>;

/**
 * Build a CSS `cubic-bezier(x1, y1, x2, y2)` timing-function string.
 * Throws RangeError if x1 or x2 is outside [0, 1].
 */
export function cubicBezierCss(x1: number, y1: number, x2: number, y2: number): string;

/**
 * @deprecated Renamed to `cubicBezierCss` to avoid name collision with
 * `@zakkster/lite-cubic-bezier`'s runtime API. Kept as an alias.
 */
export const cubicBezier: typeof cubicBezierCss;

/**
 * Emit a CSS Level 4 `linear(...)` timing function by sampling an easing
 * function at `samples + 1` evenly-spaced points across [0, 1].
 * Handles overshoot (values outside [0, 1]) without clamping.
 *
 * @param easingFn any `(t) => number` -- including analytic easings from
 *                 `@zakkster/lite-ease`
 * @param samples  number of segments (default 32; minimum 2)
 */
export function linearPoints(easingFn: (t: number) => number, samples?: number): string;

/**
 * Smart mapper: routes any easing input to a valid CSS timing-function string.
 *  - preset name  -> looked up in `CSS_EASINGS`
 *  - function     -> sampled via `linearPoints` to a CSS `linear(...)`
 *  - raw string   -> passed through (cubic-bezier / linear / steps / keyword)
 *  - null         -> 'linear'
 *
 * Throws TypeError on unknown string names -- the error message points at
 * `@zakkster/lite-ease` for analytic easings like `easeOutBounce`.
 */
export function easingToCssTimingFunction(
    input: Easing,
    linearSamples?: number
): string;

// -------------------------------------------------------------------
// Session 3 -- sequenceOnTimeline
// -------------------------------------------------------------------

export interface SequenceOnTimelineOpts {
    /** Fraction in [0, 1) of a slot width to overlap neighbors. Default 0. */
    overlap?: number;
    /** Timeline start percentage (default 0). */
    startPct?: number;
    /** Timeline end percentage (default 100). */
    endPct?: number;
    /** Optional named-range prefix ('entry', 'contain', 'exit', 'cover'). */
    rangeName?: 'entry' | 'contain' | 'exit' | 'cover';
}

/**
 * Distribute N tracks evenly along a shared timeline. Returns new track
 * objects with `range` populated; input tracks are not mutated.
 *
 * Common pattern: N cards cross-fading along one shared view-timeline.
 */
export function sequenceOnTimeline(
    tracks: Track[],
    opts?: SequenceOnTimelineOpts
): Track[];

// -------------------------------------------------------------------
// Session 4 -- Export targets
// -------------------------------------------------------------------

export interface ExportOpts {
    moduleFormat?: 'esm' | 'cjs';
    functionName?: string;
    includeImports?: boolean;
}

/**
 * Convert a storyboard to runnable GSAP + ScrollTrigger JavaScript.
 * Returns a string of module code (ESM by default). Property renames
 * (translateX->x, rotate->rotation) and easing translations (easeOutCubic->
 * power2.out, etc.) applied automatically.
 */
export function toGsap(storyboard: Storyboard, opts?: ExportOpts): string;

/**
 * Convert a storyboard to runnable `@zakkster/lite-scroll-rig-pro` code.
 * The rig supports 4 property slots per element (translateX, translateY,
 * scale, rotate); other properties emit as a per-track drop comment.
 * scroll-timeline tracks are dropped entirely.
 */
export function toRig(storyboard: Storyboard, opts?: ExportOpts): string;

// -------------------------------------------------------------------
// Session 5 -- Fallback runtime
// -------------------------------------------------------------------

export interface AttachRuntimeOpts {
    /** Where to inject the <style> on the native path. Defaults to document.head. */
    root?: Node;
    /**
     * 'auto' (default) -- native CSS when HAS_NATIVE_SUPPORT, polyfill otherwise.
     * 'native'        -- force the CSS-injection path (throws in Node).
     * 'polyfill'      -- force the JS-driven polyfill.
     */
    runtime?: 'auto' | 'native' | 'polyfill';
}

/**
 * Universal attach entry point with auto-detection.
 *
 * Native path: identical to `attachStoryboard` (CSS injection, compositor-driven).
 * Polyfill path: JS-driven -- IntersectionObserver for view timelines,
 * passive scroll + rAF for scroll timelines. Pre-allocated Float64Array
 * buffers per track; frame loop is allocation-free apart from the
 * unavoidable `element.style.transform` string.
 */
export function attachStoryboardRuntime(
    storyboard: Storyboard,
    opts?: AttachRuntimeOpts
): AttachHandle;
