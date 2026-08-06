import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    trackToCss,
    storyboardToCss,
    attachStoryboard,
    attachStoryboardRuntime,        // Session 5
    resetKeyframeCounter,
    cubicBezierCss,
    cubicBezier,                    // deprecated alias
    CSS_EASINGS,
    EASINGS,                        // deprecated alias
    linearPoints,
    easingToCssTimingFunction,
    sequenceOnTimeline,             // Session 3
    toGsap,                         // Session 4
    toRig,                          // Session 4
    HAS_NATIVE_SUPPORT
} from '../Scrollforge.js';

// ---------- CSS_EASINGS + deprecated aliases ---------------------

test('CSS_EASINGS: full Penner-tractable set plus CSS keywords', () => {
    // Native CSS keywords
    assert.equal(CSS_EASINGS.linear,    'linear');
    assert.equal(CSS_EASINGS.ease,      'ease');
    assert.equal(CSS_EASINGS.easeIn,    'ease-in');
    assert.equal(CSS_EASINGS.easeOut,   'ease-out');
    assert.equal(CSS_EASINGS.easeInOut, 'ease-in-out');
    // Spot-check families for all three variants
    const families = ['Sine', 'Quad', 'Cubic', 'Quart', 'Quint', 'Expo', 'Circ', 'Back'];
    for (const fam of families) {
        assert.ok(CSS_EASINGS['easeIn' + fam],    'missing easeIn' + fam);
        assert.ok(CSS_EASINGS['easeOut' + fam],   'missing easeOut' + fam);
        assert.ok(CSS_EASINGS['easeInOut' + fam], 'missing easeInOut' + fam);
    }
    // Total = 5 keywords + 8 families × 3 variants = 29
    assert.equal(Object.keys(CSS_EASINGS).length, 29);
});

test('CSS_EASINGS: frozen', () => {
    assert.ok(Object.isFrozen(CSS_EASINGS));
});

test('EASINGS: deprecated alias points to CSS_EASINGS', () => {
    assert.equal(EASINGS, CSS_EASINGS);
});

test('cubicBezierCss: builds a valid CSS timing function', () => {
    assert.equal(cubicBezierCss(0.25, 0.1, 0.25, 1), 'cubic-bezier(0.25, 0.1, 0.25, 1)');
});

test('cubicBezierCss: rejects x outside [0, 1]', () => {
    assert.throws(() => cubicBezierCss(-0.1, 0, 0.5, 1), RangeError);
    assert.throws(() => cubicBezierCss(0, 0, 1.5, 1), RangeError);
    // y is allowed outside [0, 1] (overshoot easings like easeOutBack)
    assert.doesNotThrow(() => cubicBezierCss(0.5, -0.5, 0.5, 1.5));
});

test('cubicBezier: deprecated alias behaves like cubicBezierCss', () => {
    assert.equal(cubicBezier, cubicBezierCss);
    assert.equal(cubicBezier(0.5, 0, 0.5, 1), 'cubic-bezier(0.5, 0, 0.5, 1)');
});

test('HAS_NATIVE_SUPPORT: boolean (false in node)', () => {
    assert.equal(typeof HAS_NATIVE_SUPPORT, 'boolean');
    assert.equal(HAS_NATIVE_SUPPORT, false);
});

// ---------- linearPoints ------------------------------------------

test('linearPoints: identity easing yields evenly-spaced 0..1', () => {
    const identity = (t) => t;
    const css = linearPoints(identity, 4);
    assert.equal(css, 'linear(0, 0.25, 0.5, 0.75, 1)');
});

test('linearPoints: default samples = 32 produces 33 points', () => {
    const identity = (t) => t;
    const css = linearPoints(identity);
    const inner = css.slice('linear('.length, -1);
    assert.equal(inner.split(', ').length, 33);
});

test('linearPoints: samples floor to integer, minimum 2', () => {
    const identity = (t) => t;
    assert.throws(() => linearPoints(identity, 1), RangeError);
    assert.doesNotThrow(() => linearPoints(identity, 2));
});

test('linearPoints: non-function input rejected', () => {
    assert.throws(() => linearPoints('easeOutBounce', 8), TypeError);
    assert.throws(() => linearPoints(null, 8), TypeError);
});

test('linearPoints: represents a Bounce-like analytic (overshoot OK)', () => {
    // Minimal easeOutBounce approximation for the test (real one comes
    // from lite-ease). Ensures overshoot values > 1 aren't clamped.
    const bounce = (t) => {
        if (t < 0.5)  return 4 * t * t;
        return 1 - 0.05 * Math.sin(t * 20);
    };
    const css = linearPoints(bounce, 8);
    assert.ok(css.startsWith('linear(0, '));
    assert.ok(css.endsWith(', ' + (bounce(1)).toFixed(4).replace(/\.?0+$/, '') + ')'));
});

test('linearPoints: compact — trailing zeros stripped', () => {
    const constant = () => 0.5;
    const css = linearPoints(constant, 4);
    // Every value is 0.5 (or 0/1 at endpoints via the constant closure).
    // We should NOT see "0.5000" in output.
    assert.doesNotMatch(css, /0\.5000/);
    assert.match(css, /0\.5/);
});

// ---------- easingToCssTimingFunction routing --------------------

test('easingToCssTimingFunction: null/undefined -> "linear"', () => {
    assert.equal(easingToCssTimingFunction(undefined), 'linear');
    assert.equal(easingToCssTimingFunction(null),      'linear');
});

test('easingToCssTimingFunction: preset name -> cubic-bezier lookup', () => {
    assert.equal(
        easingToCssTimingFunction('easeOutCubic'),
        'cubic-bezier(0.33, 1, 0.68, 1)'
    );
});

test('easingToCssTimingFunction: CSS keyword preset -> keyword literal', () => {
    assert.equal(easingToCssTimingFunction('easeOut'), 'ease-out');
});

test('easingToCssTimingFunction: raw cubic-bezier(...) string passes through', () => {
    const raw = 'cubic-bezier(0.5, 0, 0.5, 1)';
    assert.equal(easingToCssTimingFunction(raw), raw);
});

test('easingToCssTimingFunction: raw linear(...) string passes through', () => {
    const raw = 'linear(0, 0.2, 0.5, 1)';
    assert.equal(easingToCssTimingFunction(raw), raw);
});

test('easingToCssTimingFunction: CSS native keyword passes through', () => {
    assert.equal(easingToCssTimingFunction('ease-in-out'), 'ease-in-out');
});

test('easingToCssTimingFunction: function -> linear(...) via sampling', () => {
    const identity = (t) => t;
    const css = easingToCssTimingFunction(identity, 4);
    assert.equal(css, 'linear(0, 0.25, 0.5, 0.75, 1)');
});

test('easingToCssTimingFunction: unknown name throws helpfully', () => {
    // Simulates a user who typed 'easeOutBounce' as a string, forgetting
    // that analytic easings need to come from lite-ease as functions.
    assert.throws(
        () => easingToCssTimingFunction('easeOutBounce'),
        /unknown easing "easeOutBounce".*lite-ease/
    );
});

test('easingToCssTimingFunction: non-string/non-function throws', () => {
    assert.throws(() => easingToCssTimingFunction(42), TypeError);
});

// ---------- trackToCss integration with new mapper ---------------

test('trackToCss: easing as a function -> linear(...) in the rule', () => {
    resetKeyframeCounter();
    const identity = (t) => t;
    const out = trackToCss({
        selector: '.p',
        timeline: { kind: 'view' },
        easing: identity,
        keyframes: [{ opacity: 0 }, { opacity: 1 }]
    });
    assert.match(out.ruleCss, /animation-timing-function: linear\(0, .+?, 1\);/);
});

test('trackToCss: expanded preset (easeInOutBack) resolves correctly', () => {
    resetKeyframeCounter();
    const out = trackToCss({
        selector: '.p',
        timeline: { kind: 'view' },
        easing: 'easeInOutBack',
        keyframes: [{ opacity: 0 }, { opacity: 1 }]
    });
    assert.match(out.ruleCss, /cubic-bezier\(0\.68, -0\.6, 0\.32, 1\.6\);/);
});

// ---------- Existing Session 1 tests, unchanged ------------------

// ---------- trackToCss: basic shapes ------------------------------

test('trackToCss: minimal view-timeline track', () => {
    resetKeyframeCounter();
    const track = {
        selector: '.card',
        timeline: { kind: 'view' },
        keyframes: [
            { opacity: 0 },
            { opacity: 1 }
        ]
    };
    const out = trackToCss(track);
    assert.equal(out.keyframesName, '__scrollforge_0');
    assert.match(out.keyframesCss, /@keyframes __scrollforge_0 \{/);
    assert.match(out.keyframesCss, /0% \{ opacity: 0;/);
    assert.match(out.keyframesCss, /100% \{ opacity: 1;/);
    assert.match(out.ruleCss, /^\.card \{/);
    assert.match(out.ruleCss, /animation-name: __scrollforge_0;/);
    assert.match(out.ruleCss, /animation-timeline: view\(\);/);
    assert.match(out.ruleCss, /animation-timing-function: linear;/);
    assert.match(out.ruleCss, /animation-fill-mode: both;/);
});

test('trackToCss: view timeline with axis', () => {
    resetKeyframeCounter();
    const out = trackToCss({
        selector: '.hero',
        timeline: { kind: 'view', axis: 'inline' },
        keyframes: [{ opacity: 0 }, { opacity: 1 }]
    });
    assert.match(out.ruleCss, /animation-timeline: view\(inline\);/);
});

test('trackToCss: scroll timeline with scroller + axis', () => {
    resetKeyframeCounter();
    const out = trackToCss({
        selector: '.progress',
        timeline: { kind: 'scroll', scroller: 'nearest', axis: 'block' },
        keyframes: [{ width: 0 }, { width: 100 }]
    });
    assert.match(out.ruleCss, /animation-timeline: scroll\(nearest block\);/);
});

test('trackToCss: named timeline reference', () => {
    resetKeyframeCounter();
    const out = trackToCss({
        selector: '.section',
        timeline: { name: '--hero-timeline' },
        keyframes: [{ opacity: 0 }, { opacity: 1 }]
    });
    assert.match(out.ruleCss, /animation-timeline: --hero-timeline;/);
});

// ---------- trackToCss: keyframe distribution ---------------------

test('trackToCss: auto-distributes offsets when none given', () => {
    resetKeyframeCounter();
    const out = trackToCss({
        selector: '.x',
        timeline: { kind: 'view' },
        keyframes: [
            { opacity: 0 },
            { opacity: 0.5 },
            { opacity: 1 }
        ]
    });
    assert.match(out.keyframesCss, /0% \{/);
    assert.match(out.keyframesCss, /50\.00% \{/);
    assert.match(out.keyframesCss, /100% \{/);
});

test('trackToCss: respects explicit offsets', () => {
    resetKeyframeCounter();
    const out = trackToCss({
        selector: '.x',
        timeline: { kind: 'view' },
        keyframes: [
            { offset: 0,    opacity: 0 },
            { offset: 0.25, opacity: 0.8 },
            { offset: 1,    opacity: 1 }
        ]
    });
    assert.match(out.keyframesCss, /25\.00% \{/);
});

test('trackToCss: rejects offset outside [0, 1]', () => {
    assert.throws(() => trackToCss({
        selector: '.x',
        timeline: { kind: 'view' },
        keyframes: [{ offset: -0.1, opacity: 0 }, { offset: 1, opacity: 1 }]
    }), RangeError);
});

// ---------- trackToCss: transform-component aggregation -----------

test('trackToCss: translateX + translateY compose into translate:', () => {
    resetKeyframeCounter();
    const out = trackToCss({
        selector: '.p',
        timeline: { kind: 'view' },
        keyframes: [
            { translateX: 10, translateY: 20 },
            { translateX: 0,  translateY: 0  }
        ]
    });
    assert.match(out.keyframesCss, /translate: 10px 20px;/);
    assert.match(out.keyframesCss, /translate: 0px 0px;/);
});

test('trackToCss: translateY only defaults X to 0', () => {
    resetKeyframeCounter();
    const out = trackToCss({
        selector: '.p',
        timeline: { kind: 'view' },
        keyframes: [{ translateY: 30 }, { translateY: 0 }]
    });
    assert.match(out.keyframesCss, /translate: 0 30px;/);
    assert.match(out.keyframesCss, /translate: 0 0px;/);
});

test('trackToCss: scale single value expands to sx sy', () => {
    resetKeyframeCounter();
    const out = trackToCss({
        selector: '.p',
        timeline: { kind: 'view' },
        keyframes: [{ scale: 0.8 }, { scale: 1.2 }]
    });
    assert.match(out.keyframesCss, /scale: 0\.8/);
});

test('trackToCss: scaleX only emits `<sx> 1` (symmetric fallback)', () => {
    resetKeyframeCounter();
    const out = trackToCss({
        selector: '.p',
        timeline: { kind: 'view' },
        keyframes: [{ scaleX: 1 }, { scaleX: 1.5 }]
    });
    assert.match(out.keyframesCss, /scale: 1 1;/);
    assert.match(out.keyframesCss, /scale: 1\.5 1;/);
});

test('trackToCss: scaleY only emits `1 <sy>` (symmetric fallback)', () => {
    resetKeyframeCounter();
    const out = trackToCss({
        selector: '.p',
        timeline: { kind: 'view' },
        keyframes: [{ scaleY: 1 }, { scaleY: 1.5 }]
    });
    assert.match(out.keyframesCss, /scale: 1 1;/);
    assert.match(out.keyframesCss, /scale: 1 1\.5;/);
});

test('trackToCss: rotate emits degrees by default', () => {
    resetKeyframeCounter();
    const out = trackToCss({
        selector: '.p',
        timeline: { kind: 'view' },
        keyframes: [{ rotate: 0 }, { rotate: 45 }]
    });
    assert.match(out.keyframesCss, /rotate: 0deg;/);
    assert.match(out.keyframesCss, /rotate: 45deg;/);
});

test('trackToCss: string values pass through untouched', () => {
    resetKeyframeCounter();
    const out = trackToCss({
        selector: '.p',
        timeline: { kind: 'view' },
        keyframes: [
            { filter: 'blur(0)',   opacity: 1 },
            { filter: 'blur(8px)', opacity: 0 }
        ]
    });
    assert.match(out.keyframesCss, /filter: blur\(0\);/);
    assert.match(out.keyframesCss, /filter: blur\(8px\);/);
});

test('trackToCss: unknown property emits kebab-case verbatim', () => {
    resetKeyframeCounter();
    const out = trackToCss({
        selector: '.p',
        timeline: { kind: 'view' },
        keyframes: [
            { fontWeight: 400 },
            { fontWeight: 700 }
        ]
    });
    assert.match(out.keyframesCss, /font-weight: 400;/);
    assert.match(out.keyframesCss, /font-weight: 700;/);
});

test('trackToCss: CSS custom properties preserved', () => {
    resetKeyframeCounter();
    const out = trackToCss({
        selector: '.p',
        timeline: { kind: 'view' },
        keyframes: [
            { '--hue': '20deg' },
            { '--hue': '240deg' }
        ]
    });
    assert.match(out.keyframesCss, /--hue: 20deg;/);
    assert.match(out.keyframesCss, /--hue: 240deg;/);
});

// ---------- trackToCss: range formatting --------------------------

test('trackToCss: range with string endpoints', () => {
    resetKeyframeCounter();
    const out = trackToCss({
        selector: '.p',
        timeline: { kind: 'view' },
        range: { start: 'entry 0%', end: 'entry 100%' },
        keyframes: [{ opacity: 0 }, { opacity: 1 }]
    });
    assert.match(out.ruleCss, /animation-range: entry 0% entry 100%;/);
});

test('trackToCss: range with numeric percent shortcut', () => {
    resetKeyframeCounter();
    const out = trackToCss({
        selector: '.p',
        timeline: { kind: 'view' },
        range: { start: 20, end: 80 },
        keyframes: [{ opacity: 0 }, { opacity: 1 }]
    });
    assert.match(out.ruleCss, /animation-range: 20% 80%;/);
});

test('trackToCss: partial range emits animation-range-start only', () => {
    resetKeyframeCounter();
    const out = trackToCss({
        selector: '.p',
        timeline: { kind: 'view' },
        range: { start: 'entry 25%' },
        keyframes: [{ opacity: 0 }, { opacity: 1 }]
    });
    assert.match(out.ruleCss, /animation-range-start: entry 25%;/);
    assert.doesNotMatch(out.ruleCss, /animation-range:/);
});

// ---------- trackToCss: easing --------------------------------------

test('trackToCss: preset easing name maps through EASINGS', () => {
    resetKeyframeCounter();
    const out = trackToCss({
        selector: '.p',
        timeline: { kind: 'view' },
        easing: 'easeOutCubic',
        keyframes: [{ opacity: 0 }, { opacity: 1 }]
    });
    assert.match(out.ruleCss, /animation-timing-function: cubic-bezier\(0\.33, 1, 0\.68, 1\);/);
});

test('trackToCss: raw cubic-bezier string passes through', () => {
    resetKeyframeCounter();
    const out = trackToCss({
        selector: '.p',
        timeline: { kind: 'view' },
        easing: 'cubic-bezier(0.5, 0, 0.5, 1)',
        keyframes: [{ opacity: 0 }, { opacity: 1 }]
    });
    assert.match(out.ruleCss, /animation-timing-function: cubic-bezier\(0\.5, 0, 0\.5, 1\);/);
});

test('trackToCss: fill mode override', () => {
    resetKeyframeCounter();
    const out = trackToCss({
        selector: '.p',
        timeline: { kind: 'view' },
        fill: 'forwards',
        keyframes: [{ opacity: 0 }, { opacity: 1 }]
    });
    assert.match(out.ruleCss, /animation-fill-mode: forwards;/);
});

// ---------- trackToCss: validation --------------------------------

test('trackToCss: missing selector throws', () => {
    assert.throws(() => trackToCss({
        timeline: { kind: 'view' },
        keyframes: [{ opacity: 0 }, { opacity: 1 }]
    }), TypeError);
});

test('trackToCss: missing timeline throws', () => {
    assert.throws(() => trackToCss({
        selector: '.p',
        keyframes: [{ opacity: 0 }, { opacity: 1 }]
    }), TypeError);
});

test('trackToCss: <2 keyframes throws', () => {
    assert.throws(() => trackToCss({
        selector: '.p',
        timeline: { kind: 'view' },
        keyframes: [{ opacity: 0 }]
    }), TypeError);
});

// ---------- storyboardToCss ---------------------------------------

test('storyboardToCss: two-track output has deterministic naming', () => {
    const css = storyboardToCss({
        tracks: [
            { selector: '.a', timeline: { kind: 'view' }, keyframes: [{ opacity: 0 }, { opacity: 1 }] },
            { selector: '.b', timeline: { kind: 'view' }, keyframes: [{ opacity: 0 }, { opacity: 1 }] }
        ]
    });
    assert.match(css, /__scrollforge_0/);
    assert.match(css, /__scrollforge_1/);
    assert.match(css, /\.a \{/);
    assert.match(css, /\.b \{/);
});

test('storyboardToCss: byte-stable across repeat calls (reset counter)', () => {
    const sb = {
        tracks: [
            { selector: '.x', timeline: { kind: 'view' }, keyframes: [{ opacity: 0 }, { opacity: 1 }] }
        ]
    };
    const a = storyboardToCss(sb);
    const b = storyboardToCss(sb);
    assert.equal(a, b);
});

test('storyboardToCss: named timeline declarations emitted first', () => {
    const css = storyboardToCss({
        timelines: {
            '--hero': { attachedSelector: '.hero', kind: 'view', axis: 'block' }
        },
        tracks: [
            { selector: '.child', timeline: { name: '--hero' },
              keyframes: [{ opacity: 0 }, { opacity: 1 }] }
        ]
    });
    assert.match(css, /\.hero \{[\s\S]*view-timeline-name: --hero;[\s\S]*view-timeline-axis: block;/);
    assert.match(css, /animation-timeline: --hero;/);
    // Timeline declaration comes before the animation rule
    assert.ok(css.indexOf('view-timeline-name') < css.indexOf('animation-timeline'));
});

test('storyboardToCss: scroll-timeline-name variant', () => {
    const css = storyboardToCss({
        timelines: {
            '--main-scroll': { attachedSelector: 'main', kind: 'scroll' }
        },
        tracks: [
            { selector: '.p', timeline: { name: '--main-scroll' },
              keyframes: [{ width: 0 }, { width: 100 }] }
        ]
    });
    assert.match(css, /scroll-timeline-name: --main-scroll;/);
});

test('storyboardToCss: no tracks throws', () => {
    assert.throws(() => storyboardToCss({}), TypeError);
});

// ---------- attachStoryboard (jsdom-lite shim) --------------------

test('attachStoryboard: injects a <style data-scrollforge> and returns detach', () => {
    // Minimal document/head shim adequate for what attachStoryboard does.
    const created = [];
    global.document = {
        head: {
            appendChild(node) { node._parent = this; created.push(node); }
        },
        createElement(tag) {
            const attrs = {};
            return {
                tagName: tag.toUpperCase(),
                textContent: '',
                _parent: null,
                setAttribute(k, v) { attrs[k] = v; this['__' + k] = v; },
                get parentNode() { return this._parent; }
            };
        }
    };
    try {
        const handle = attachStoryboard({
            tracks: [{ selector: '.p', timeline: { kind: 'view' },
                       keyframes: [{ opacity: 0 }, { opacity: 1 }] }]
        });
        assert.equal(created.length, 1);
        assert.equal(created[0].tagName, 'STYLE');
        assert.equal(created[0]['__data-scrollforge'], 'true');
        assert.match(created[0].textContent, /@keyframes/);
        // detach removes it
        created[0]._parent.removeChild = (n) => { n._parent = null; };
        handle.detach();
        assert.equal(created[0]._parent, null);
    } finally {
        delete global.document;
    }
});

test('attachStoryboard: throws when no document (SSR path)', () => {
    // No global.document set — sanity check the guard.
    assert.throws(() => attachStoryboard({
        tracks: [{ selector: '.p', timeline: { kind: 'view' },
                   keyframes: [{ opacity: 0 }, { opacity: 1 }] }]
    }), /no document available/);
});

// ---------- Regression: real-world recipes -----------------------

test('recipe: fade-in-up (view timeline, entry range)', () => {
    resetKeyframeCounter();
    const out = trackToCss({
        selector: '.card',
        timeline: { kind: 'view' },
        range: { start: 'entry 0%', end: 'entry 80%' },
        keyframes: [
            { offset: 0, opacity: 0, translateY: 30 },
            { offset: 1, opacity: 1, translateY: 0  }
        ],
        easing: 'easeOutCubic',
        fill: 'both'
    });
    assert.match(out.keyframesCss, /0% \{ opacity: 0; translate: 0 30px; \}/);
    assert.match(out.keyframesCss, /100% \{ opacity: 1; translate: 0 0px; \}/);
    assert.match(out.ruleCss, /animation-timeline: view\(\);/);
    assert.match(out.ruleCss, /animation-range: entry 0% entry 80%;/);
    assert.match(out.ruleCss, /cubic-bezier\(0\.33, 1, 0\.68, 1\)/);
});

test('recipe: scroll progress bar (scroll timeline, full range)', () => {
    resetKeyframeCounter();
    const out = trackToCss({
        selector: '.progress-fill',
        timeline: { kind: 'scroll', scroller: 'root', axis: 'block' },
        keyframes: [
            { scaleX: 0 },
            { scaleX: 1 }
        ],
        easing: 'linear'
    });
    assert.match(out.ruleCss, /animation-timeline: scroll\(root block\);/);
    // scaleX-only correctly emits `<sx> 1` — height stays 1, width
    // animates 0->1. Progress bar semantics preserved.
    assert.match(out.keyframesCss, /scale: 0 1;/);
    assert.match(out.keyframesCss, /scale: 1 1;/);
});

test('recipe: named-timeline sequenced storyboard', () => {
    const css = storyboardToCss({
        timelines: {
            '--gallery': { attachedSelector: '.gallery', kind: 'view', axis: 'block' }
        },
        tracks: [
            { selector: '.gallery .img-1', timeline: { name: '--gallery' },
              range: { start: 'entry 0%', end: 'entry 50%' },
              keyframes: [{ opacity: 0 }, { opacity: 1 }],
              easing: 'easeOutQuad' },
            { selector: '.gallery .img-2', timeline: { name: '--gallery' },
              range: { start: 'entry 50%', end: 'entry 100%' },
              keyframes: [{ opacity: 0 }, { opacity: 1 }],
              easing: 'easeOutQuad' }
        ]
    });
    // Timeline declared once
    const timelineDeclCount = (css.match(/view-timeline-name: --gallery;/g) || []).length;
    assert.equal(timelineDeclCount, 1);
    // Both tracks refer to it
    const refCount = (css.match(/animation-timeline: --gallery;/g) || []).length;
    assert.equal(refCount, 2);
    // Sequenced ranges emit correctly
    assert.match(css, /animation-range: entry 0% entry 50%;/);
    assert.match(css, /animation-range: entry 50% entry 100%;/);
});

// ---------- Session 3: sequenceOnTimeline -----------------------

test('sequenceOnTimeline: splits 3 tracks evenly (0-33.33%, 33.33-66.66%, 66.66-100%)', () => {
    const inputs = [
        { selector: '.a', timeline: { name: '--t' }, keyframes: [{ opacity: 0 }, { opacity: 1 }] },
        { selector: '.b', timeline: { name: '--t' }, keyframes: [{ opacity: 0 }, { opacity: 1 }] },
        { selector: '.c', timeline: { name: '--t' }, keyframes: [{ opacity: 0 }, { opacity: 1 }] }
    ];
    const out = sequenceOnTimeline(inputs);
    assert.equal(out.length, 3);
    assert.deepEqual(out[0].range, { start: '0%',       end: '33.3333%' });
    assert.deepEqual(out[1].range, { start: '33.3333%', end: '66.6667%' });
    assert.deepEqual(out[2].range, { start: '66.6667%', end: '100%'     });
});

test('sequenceOnTimeline: does not mutate input tracks', () => {
    const inputs = [
        { selector: '.a', timeline: { name: '--t' }, keyframes: [{}, {}] },
        { selector: '.b', timeline: { name: '--t' }, keyframes: [{}, {}] }
    ];
    const inputsSnapshot = JSON.stringify(inputs);
    sequenceOnTimeline(inputs);
    assert.equal(JSON.stringify(inputs), inputsSnapshot);
});

test('sequenceOnTimeline: overlap widens each slot symmetrically', () => {
    const inputs = [
        { selector: '.a', timeline: { name: '--t' }, keyframes: [{}, {}] },
        { selector: '.b', timeline: { name: '--t' }, keyframes: [{}, {}] },
        { selector: '.c', timeline: { name: '--t' }, keyframes: [{}, {}] }
    ];
    // overlap 0.5 * slotWidth (33.33) = ~16.67 on each side
    const out = sequenceOnTimeline(inputs, { overlap: 0.5 });
    // Middle track gains overlap on both sides:
    //   raw 33.33 - 16.67 = 16.67; raw 66.67 + 16.67 = 83.33
    assert.match(out[1].range.start, /^16\.6/);
    assert.match(out[1].range.end,   /^83\.3/);
    // First track's start is clamped to 0
    assert.equal(out[0].range.start, '0%');
    // Last track's end is clamped to 100
    assert.equal(out[2].range.end, '100%');
});

test('sequenceOnTimeline: custom rangeName prepended to endpoints', () => {
    const inputs = [
        { selector: '.a', timeline: { name: '--t' }, keyframes: [{}, {}] },
        { selector: '.b', timeline: { name: '--t' }, keyframes: [{}, {}] }
    ];
    const out = sequenceOnTimeline(inputs, { rangeName: 'entry' });
    assert.match(out[0].range.start, /^entry 0%$/);
    assert.match(out[0].range.end,   /^entry 50%$/);
    assert.match(out[1].range.start, /^entry 50%$/);
    assert.match(out[1].range.end,   /^entry 100%$/);
});

test('sequenceOnTimeline: custom bounds (startPct / endPct)', () => {
    const inputs = [
        { selector: '.a', timeline: { name: '--t' }, keyframes: [{}, {}] },
        { selector: '.b', timeline: { name: '--t' }, keyframes: [{}, {}] }
    ];
    // Only use the middle 20-80% of the timeline
    const out = sequenceOnTimeline(inputs, { startPct: 20, endPct: 80 });
    assert.equal(out[0].range.start, '20%');
    assert.equal(out[0].range.end,   '50%');
    assert.equal(out[1].range.start, '50%');
    assert.equal(out[1].range.end,   '80%');
});

test('sequenceOnTimeline: single track spans the full range', () => {
    const inputs = [{ selector: '.only', timeline: { name: '--t' }, keyframes: [{}, {}] }];
    const out = sequenceOnTimeline(inputs);
    assert.deepEqual(out[0].range, { start: '0%', end: '100%' });
});

test('sequenceOnTimeline: rejects empty array', () => {
    assert.throws(() => sequenceOnTimeline([]), TypeError);
});

test('sequenceOnTimeline: rejects non-array', () => {
    assert.throws(() => sequenceOnTimeline({}), TypeError);
});

test('sequenceOnTimeline: rejects overlap outside [0, 1)', () => {
    const t = [{ selector: '.a', timeline: { name: '--t' }, keyframes: [{}, {}] }];
    assert.throws(() => sequenceOnTimeline(t, { overlap: -0.1 }), RangeError);
    assert.throws(() => sequenceOnTimeline(t, { overlap: 1 }),    RangeError);
    assert.throws(() => sequenceOnTimeline(t, { overlap: 1.5 }),  RangeError);
    assert.doesNotThrow(() => sequenceOnTimeline(t, { overlap: 0.99 }));
});

test('sequenceOnTimeline: rejects endPct <= startPct', () => {
    const t = [{ selector: '.a', timeline: { name: '--t' }, keyframes: [{}, {}] }];
    assert.throws(() => sequenceOnTimeline(t, { startPct: 50, endPct: 50 }), RangeError);
    assert.throws(() => sequenceOnTimeline(t, { startPct: 50, endPct: 30 }), RangeError);
});

test('sequenceOnTimeline: preserves other track fields (selector, easing, keyframes)', () => {
    const inputs = [
        { selector: '.a', timeline: { name: '--t' }, easing: 'easeOutCubic', fill: 'both',
          keyframes: [{ opacity: 0 }, { opacity: 1 }] },
        { selector: '.b', timeline: { name: '--t' }, easing: 'easeInOutBack',
          keyframes: [{ scale: 0.9 }, { scale: 1 }] }
    ];
    const out = sequenceOnTimeline(inputs);
    assert.equal(out[0].selector, '.a');
    assert.equal(out[0].easing, 'easeOutCubic');
    assert.equal(out[0].fill, 'both');
    assert.deepEqual(out[0].keyframes, [{ opacity: 0 }, { opacity: 1 }]);
    assert.equal(out[1].selector, '.b');
    assert.equal(out[1].easing, 'easeInOutBack');
});

test('sequenceOnTimeline: integrates end-to-end via storyboardToCss', () => {
    const tracks = sequenceOnTimeline([
        { selector: '.gallery .img-1', timeline: { name: '--gallery' },
          keyframes: [{ opacity: 0 }, { opacity: 1 }], easing: 'easeOutCubic' },
        { selector: '.gallery .img-2', timeline: { name: '--gallery' },
          keyframes: [{ opacity: 0 }, { opacity: 1 }], easing: 'easeOutCubic' },
        { selector: '.gallery .img-3', timeline: { name: '--gallery' },
          keyframes: [{ opacity: 0 }, { opacity: 1 }], easing: 'easeOutCubic' }
    ], { overlap: 0.15 });

    const css = storyboardToCss({
        timelines: {
            '--gallery': { attachedSelector: '.gallery', kind: 'view', axis: 'block' }
        },
        tracks
    });
    // All three ranges should be present, tuned by overlap
    const ranges = css.match(/animation-range: [\d.%]+ [\d.%]+;/g) || [];
    assert.equal(ranges.length, 3);
    // First range starts at 0 (clamped)
    assert.ok(ranges[0].includes('0%'));
    // Third range ends at 100 (clamped)
    assert.ok(ranges[2].includes('100%'));
});

// ---------- Session 3: nested scroller topology -----------------

test('nested topology: outer scroll timeline + inner view timeline coexist', () => {
    const css = storyboardToCss({
        timelines: {
            '--outer-scroll': { attachedSelector: '.article', kind: 'scroll', axis: 'block' },
            '--inner-view':   { attachedSelector: '.hero',    kind: 'view',   axis: 'block' }
        },
        tracks: [
            { selector: '.progress-bar', timeline: { name: '--outer-scroll' },
              keyframes: [{ scaleX: 0 }, { scaleX: 1 }] },
            { selector: '.hero-title',   timeline: { name: '--inner-view' },
              range: { start: 'entry 0%', end: 'cover 25%' },
              keyframes: [{ opacity: 0, translateY: 20 }, { opacity: 1, translateY: 0 }],
              easing: 'easeOutCubic' }
        ]
    });
    // Outer scroll timeline declared on .article
    assert.match(css, /\.article \{[\s\S]*scroll-timeline-name: --outer-scroll;/);
    // Inner view timeline declared on .hero
    assert.match(css, /\.hero \{[\s\S]*view-timeline-name: --inner-view;/);
    // Both timeline references resolve
    assert.match(css, /animation-timeline: --outer-scroll;/);
    assert.match(css, /animation-timeline: --inner-view;/);
    // Named-range syntax (entry/cover) still passes through on the view timeline
    assert.match(css, /animation-range: entry 0% cover 25%;/);
});

// ---------- Session 3: CSS variable animation recipe ------------

test('recipe: animating a CSS custom property (--hue for lite-color-engine)', () => {
    resetKeyframeCounter();
    // The composition: use --hue in a downstream `color: oklch(...)`
    // declaration; Scrollforge animates the variable, the color engine
    // consumes it. Zero-JS at runtime.
    const out = trackToCss({
        selector: '.sunset',
        timeline: { kind: 'view' },
        range: { start: 'entry 0%', end: 'exit 100%' },
        keyframes: [
            { '--hue': '20deg' },
            { '--hue': '240deg' }
        ],
        easing: 'linear'
    });
    assert.match(out.keyframesCss, /--hue: 20deg;/);
    assert.match(out.keyframesCss, /--hue: 240deg;/);
    assert.match(out.ruleCss, /animation-range: entry 0% exit 100%;/);
});

test('recipe: CSS variable animation composes with color-engine downstream', () => {
    // This is a full recipe: user attaches this + a separate stylesheet
    // that uses the animated variable in oklch(). No JS runtime needed.
    const css = storyboardToCss({
        tracks: [{
            selector: '.pill',
            timeline: { kind: 'view' },
            keyframes: [
                { '--l': 0.35, '--c': 0.08, '--h': '20deg' },
                { '--l': 0.85, '--c': 0.20, '--h': '240deg' }
            ]
        }]
    });
    // All three custom properties should appear in each keyframe
    const kf0 = css.match(/0% \{ ([^}]+)\}/);
    assert.ok(kf0, 'keyframe 0 missing');
    assert.match(kf0[1], /--l: 0\.35;/);
    assert.match(kf0[1], /--c: 0\.08;/);
    assert.match(kf0[1], /--h: 20deg;/);
    // No transform composites (since these are custom props, not translate/scale)
    assert.doesNotMatch(css, /translate:/);
    assert.doesNotMatch(css, /scale: 0/);
});

// ---------- Session 4: toGsap -------------------------------------

test('toGsap: minimal fade-in-up track emits gsap.fromTo', () => {
    const code = toGsap({
        tracks: [{
            selector: '.card',
            timeline: { kind: 'view' },
            range: { start: 'entry 0%', end: 'entry 80%' },
            keyframes: [
                { opacity: 0, translateY: 30 },
                { opacity: 1, translateY: 0 }
            ],
            easing: 'easeOutCubic'
        }]
    });
    assert.match(code, /import \{ gsap \} from 'gsap';/);
    assert.match(code, /import \{ ScrollTrigger \} from 'gsap\/ScrollTrigger';/);
    assert.match(code, /gsap\.registerPlugin\(ScrollTrigger\);/);
    assert.match(code, /export function attachScrollAnimations\(\)/);
    assert.match(code, /gsap\.fromTo\("\.card",/);
    assert.match(code, /\{ opacity: 0, y: 30 \}/);
    assert.match(code, /opacity: 1,\s*y: 0,/);
    assert.match(code, /ease: "power2\.out"/);
    assert.match(code, /trigger: "\.card"/);
    assert.match(code, /start: "0% bottom"/);
    assert.match(code, /end: "80% bottom"/);
    assert.match(code, /scrub: true/);
});

test('toGsap: transform property renames (translateX -> x, rotate -> rotation)', () => {
    const code = toGsap({
        tracks: [{
            selector: '.p',
            timeline: { kind: 'view' },
            keyframes: [
                { translateX: 0,  translateY: 0,  translateZ: 0,  rotate: 0  },
                { translateX: 50, translateY: 20, translateZ: 10, rotate: 45 }
            ]
        }]
    });
    // From block
    assert.match(code, /\{ x: 0, y: 0, z: 0, rotation: 0 \}/);
    // To block properties (multi-line)
    assert.match(code, /x: 50,/);
    assert.match(code, /y: 20,/);
    assert.match(code, /z: 10,/);
    assert.match(code, /rotation: 45,/);
});

test('toGsap: easing name maps to GSAP built-in', () => {
    const code = toGsap({
        tracks: [{
            selector: '.a',
            timeline: { kind: 'view' },
            keyframes: [{ opacity: 0 }, { opacity: 1 }],
            easing: 'easeInOutBack'
        }]
    });
    assert.match(code, /ease: "back\.inOut"/);
});

test('toGsap: linear/none for no easing', () => {
    const code = toGsap({
        tracks: [{
            selector: '.a',
            timeline: { kind: 'view' },
            keyframes: [{ opacity: 0 }, { opacity: 1 }]
        }]
    });
    // Default easing (no easing set) -> 'none'
    assert.match(code, /ease: "none"/);
});

test('toGsap: raw cubic-bezier marked as needing CustomEase', () => {
    const code = toGsap({
        tracks: [{
            selector: '.a',
            timeline: { kind: 'view' },
            keyframes: [{ opacity: 0 }, { opacity: 1 }],
            easing: 'cubic-bezier(0.5, 0, 0.5, 1)'
        }]
    });
    assert.match(code, /requires CustomEase plugin/);
    assert.match(code, /needs CustomEase/);
});

test('toGsap: function easing marked as needing CustomEase, emits linear()', () => {
    const identity = (t) => t;
    const code = toGsap({
        tracks: [{
            selector: '.a',
            timeline: { kind: 'view' },
            keyframes: [{ opacity: 0 }, { opacity: 1 }],
            easing: identity
        }]
    });
    assert.match(code, /requires CustomEase/);
    assert.match(code, /linear\(0,/);
});

test('toGsap: range mapping - entry/exit uses percentage endpoint', () => {
    const code = toGsap({
        tracks: [{
            selector: '.a',
            timeline: { kind: 'view' },
            range: { start: 'entry 25%', end: 'exit 75%' },
            keyframes: [{ opacity: 0 }, { opacity: 1 }]
        }]
    });
    assert.match(code, /start: "25% bottom"/);
    assert.match(code, /end: "75% top"/);
});

test('toGsap: range mapping - cover uses symmetric interpolation', () => {
    const code = toGsap({
        tracks: [{
            selector: '.a',
            timeline: { kind: 'view' },
            range: { start: 'cover 0%', end: 'cover 100%' },
            keyframes: [{ opacity: 0 }, { opacity: 1 }]
        }]
    });
    assert.match(code, /start: "0% 100%"/);
    assert.match(code, /end: "100% 0%"/);
});

test('toGsap: contain range emits approximation warning', () => {
    const code = toGsap({
        tracks: [{
            selector: '.a',
            timeline: { kind: 'view' },
            range: { start: 'contain 0%', end: 'contain 100%' },
            keyframes: [{ opacity: 0 }, { opacity: 1 }]
        }]
    });
    assert.match(code, /contain.*approximated/i);
});

test('toGsap: multi-keyframe track emits an endpoint-only note', () => {
    const code = toGsap({
        tracks: [{
            selector: '.a',
            timeline: { kind: 'view' },
            keyframes: [
                { opacity: 0 },
                { opacity: 0.5 },
                { opacity: 1 }
            ]
        }]
    });
    assert.match(code, /3 keyframes.*endpoints only/i);
});

test('toGsap: cjs module format', () => {
    const code = toGsap({
        tracks: [{
            selector: '.a', timeline: { kind: 'view' },
            keyframes: [{ opacity: 0 }, { opacity: 1 }]
        }]
    }, { moduleFormat: 'cjs' });
    assert.match(code, /const \{ gsap \} = require\('gsap'\);/);
    assert.match(code, /module\.exports\.attachScrollAnimations = function/);
});

test('toGsap: custom functionName option', () => {
    const code = toGsap({
        tracks: [{
            selector: '.a', timeline: { kind: 'view' },
            keyframes: [{ opacity: 0 }, { opacity: 1 }]
        }]
    }, { functionName: 'attachHeroReveals' });
    assert.match(code, /export function attachHeroReveals\(\)/);
});

test('toGsap: includeImports=false omits import lines', () => {
    const code = toGsap({
        tracks: [{
            selector: '.a', timeline: { kind: 'view' },
            keyframes: [{ opacity: 0 }, { opacity: 1 }]
        }]
    }, { includeImports: false });
    assert.doesNotMatch(code, /import /);
    assert.doesNotMatch(code, /require\(/);
    assert.doesNotMatch(code, /registerPlugin/);
    // Function body still emitted
    assert.match(code, /export function attachScrollAnimations/);
});

test('toGsap: output is syntactically valid JS (Function() parse)', () => {
    const code = toGsap({
        tracks: [{
            selector: '.card',
            timeline: { kind: 'view' },
            keyframes: [{ opacity: 0, translateY: 30 }, { opacity: 1, translateY: 0 }],
            easing: 'easeOutCubic'
        }]
    }, { includeImports: false });
    // Wrap in a function and try to parse — throws on syntax error.
    assert.doesNotThrow(() => new Function(
        'gsap',
        code.replace(/export function/, 'return function')
    ));
});

test('toGsap: empty tracks throws', () => {
    assert.throws(() => toGsap({}), TypeError);
});

test('toGsap: track with < 2 keyframes is skipped with comment', () => {
    const code = toGsap({
        tracks: [{
            selector: '.a', timeline: { kind: 'view' },
            keyframes: [{ opacity: 0 }]
        }]
    });
    assert.match(code, /Track 0.*skipped.*at least 2 keyframes/);
    assert.doesNotMatch(code, /gsap\.fromTo/);
});

// ---------- Session 4: toRig --------------------------------------

test('toRig: minimal supported track emits pool.addKey per property', () => {
    const code = toRig({
        tracks: [{
            selector: '.card',
            timeline: { kind: 'view' },
            keyframes: [
                { translateY: 30, scale: 0.9 },
                { translateY: 0,  scale: 1   }
            ]
        }]
    });
    assert.match(code, /import \{ ScrollEngine, DOMScroller \} from '@zakkster\/lite-scroll-rig-pro';/);
    assert.match(code, /import \{ KeyframePool \} from '@zakkster\/lite-keyframe';/);
    assert.match(code, /export function attachScrollRig\(container\)/);
    assert.match(code, /new KeyframePool\(elements\.length \* 4, 8\)/);
    // translateY on row + 1
    assert.match(code, /pool\.addKey\(0 \+ 1, 0, 30\);/);
    assert.match(code, /pool\.addKey\(0 \+ 1, 1, 0\);/);
    // scale on row + 2
    assert.match(code, /pool\.addKey\(0 \+ 2, 0, 0\.9\);/);
    assert.match(code, /pool\.addKey\(0 \+ 2, 1, 1\);/);
    // Engine + Scroller wired
    assert.match(code, /new ScrollEngine\(container \|\| document\.body\)/);
    assert.match(code, /new DOMScroller\(elements, pool, \{ engine: engine \}\)/);
});

test('toRig: unsupported properties dropped with a per-track comment', () => {
    const code = toRig({
        tracks: [{
            selector: '.card',
            timeline: { kind: 'view' },
            keyframes: [
                { opacity: 0, translateY: 30, filter: 'blur(0px)' },
                { opacity: 1, translateY: 0,  filter: 'blur(4px)' }
            ]
        }]
    });
    assert.match(code, /Dropped \(rig unsupported\): opacity, filter/);
    // translateY should still be emitted
    assert.match(code, /pool\.addKey\(0 \+ 1, 0, 30\);/);
});

test('toRig: scroll-timeline tracks skipped entirely', () => {
    const code = toRig({
        tracks: [
            { selector: '.a', timeline: { kind: 'scroll' },
              keyframes: [{ scaleX: 0 }, { scaleX: 1 }] },
            { selector: '.b', timeline: { kind: 'view' },
              keyframes: [{ translateY: 20 }, { translateY: 0 }] }
        ]
    });
    // scroll timeline gets a skip note
    assert.match(code, /Track 0 \(\.a\): skipped.*scroll-timeline is not supported/);
    // supported track still present, using row 0 (only one supported)
    assert.match(code, /pool\.addKey\(0 \+ 1, 0, 20\);/);
    // Selectors array contains only the supported track
    assert.match(code, /selectors = \[\s+"\.b",/);
});

test('toRig: row indexing walks by 4 per element', () => {
    const code = toRig({
        tracks: [
            { selector: '.a', timeline: { kind: 'view' },
              keyframes: [{ translateX: 0 }, { translateX: 10 }] },
            { selector: '.b', timeline: { kind: 'view' },
              keyframes: [{ scale: 1 }, { scale: 1.5 }] },
            { selector: '.c', timeline: { kind: 'view' },
              keyframes: [{ rotate: 0 }, { rotate: 90 }] }
        ]
    });
    assert.match(code, /pool\.addKey\(0 \+ 0, /);   // element 0 · translateX
    assert.match(code, /pool\.addKey\(4 \+ 2, /);   // element 1 · scale
    assert.match(code, /pool\.addKey\(8 \+ 3, /);   // element 2 · rotate
});

test('toRig: cover range maps to full [0, 1] t exactly', () => {
    const code = toRig({
        tracks: [{
            selector: '.a',
            timeline: { kind: 'view' },
            range: { start: 'cover 0%', end: 'cover 100%' },
            keyframes: [{ translateY: 30 }, { translateY: 0 }]
        }]
    });
    assert.doesNotMatch(code, /approximated/);
    assert.match(code, /pool\.addKey\(0 \+ 1, 0, 30\);/);
    assert.match(code, /pool\.addKey\(0 \+ 1, 1, 0\);/);
});

test('toRig: entry range maps to [0, 0.5] with a warning', () => {
    const code = toRig({
        tracks: [{
            selector: '.a',
            timeline: { kind: 'view' },
            range: { start: 'entry 0%', end: 'entry 100%' },
            keyframes: [{ translateY: 30 }, { translateY: 0 }]
        }]
    });
    assert.match(code, /approximated/i);
    // t bounds are [0, 0.5]; keyframes at 0.0 and 0.5
    assert.match(code, /pool\.addKey\(0 \+ 1, 0, 30\);/);
    assert.match(code, /pool\.addKey\(0 \+ 1, 0\.5, 0\);/);
});

test('toRig: exit range maps to [0.5, 1] with a warning', () => {
    const code = toRig({
        tracks: [{
            selector: '.a',
            timeline: { kind: 'view' },
            range: { start: 'exit 0%', end: 'exit 100%' },
            keyframes: [{ translateY: 0 }, { translateY: -30 }]
        }]
    });
    assert.match(code, /approximated/i);
    assert.match(code, /pool\.addKey\(0 \+ 1, 0\.5, 0\);/);
    assert.match(code, /pool\.addKey\(0 \+ 1, 1, -30\);/);
});

test('toRig: multi-keyframe distributes offsets across the t-range', () => {
    const code = toRig({
        tracks: [{
            selector: '.a',
            timeline: { kind: 'view' },
            keyframes: [
                { scale: 1   },
                { scale: 1.3 },
                { scale: 1   }
            ]
        }]
    });
    // 3 keyframes -> t = 0, 0.5, 1
    assert.match(code, /pool\.addKey\(0 \+ 2, 0, 1\);/);
    assert.match(code, /pool\.addKey\(0 \+ 2, 0\.5, 1\.3\);/);
    assert.match(code, /pool\.addKey\(0 \+ 2, 1, 1\);/);
});

test('toRig: cjs module format', () => {
    const code = toRig({
        tracks: [{
            selector: '.a', timeline: { kind: 'view' },
            keyframes: [{ translateY: 10 }, { translateY: 0 }]
        }]
    }, { moduleFormat: 'cjs' });
    assert.match(code, /const \{ ScrollEngine, DOMScroller \} = require\('@zakkster\/lite-scroll-rig-pro'\);/);
    assert.match(code, /module\.exports\.attachScrollRig = function/);
});

test('toRig: output is syntactically valid JS (Function() parse)', () => {
    const code = toRig({
        tracks: [{
            selector: '.card', timeline: { kind: 'view' },
            keyframes: [{ translateY: 30, scale: 0.9 }, { translateY: 0, scale: 1 }]
        }]
    }, { includeImports: false });
    assert.doesNotThrow(() => new Function(
        'ScrollEngine', 'DOMScroller', 'KeyframePool',
        code.replace(/export function/, 'return function')
    ));
});

test('toRig: empty tracks throws', () => {
    assert.throws(() => toRig({}), TypeError);
});

test('toGsap and toRig from the same storyboard produce independent outputs', () => {
    const sb = {
        tracks: [{
            selector: '.card',
            timeline: { kind: 'view' },
            range: { start: 'entry 0%', end: 'entry 100%' },
            keyframes: [{ opacity: 0, translateY: 30 }, { opacity: 1, translateY: 0 }],
            easing: 'easeOutCubic'
        }]
    };
    const gsapCode = toGsap(sb);
    const rigCode  = toRig(sb);
    // GSAP keeps opacity, rig drops it
    assert.match(gsapCode, /opacity: 1/);
    assert.match(rigCode,  /Dropped \(rig unsupported\): opacity/);
    // GSAP uses `y: 0`, rig uses `pool.addKey(0 + 1, ...)`
    assert.match(gsapCode, /y: 0/);
    assert.match(rigCode, /pool\.addKey\(0 \+ 1, /);
});

// ---------- Session 5: fallback runtime -------------------------

test('attachStoryboardRuntime: SSR guard — no document throws helpfully', () => {
    // Ensure no lingering document from previous tests.
    delete global.document;
    assert.throws(
        () => attachStoryboardRuntime({
            tracks: [{ selector: '.p', timeline: { kind: 'view' },
                       keyframes: [{ opacity: 0 }, { opacity: 1 }] }]
        }, { runtime: 'polyfill' }),
        /no document available/
    );
});

test('attachStoryboardRuntime: runtime="native" delegates to attachStoryboard', () => {
    // Native path uses <style> injection — same shim we used for attachStoryboard.
    const created = [];
    global.document = {
        head: { appendChild(node) { node._parent = this; created.push(node); } },
        createElement(tag) {
            return { tagName: tag.toUpperCase(), textContent: '', _parent: null,
                     setAttribute(k, v) { this['__' + k] = v; },
                     get parentNode() { return this._parent; } };
        }
    };
    try {
        const handle = attachStoryboardRuntime({
            tracks: [{ selector: '.p', timeline: { kind: 'view' },
                       keyframes: [{ opacity: 0 }, { opacity: 1 }] }]
        }, { runtime: 'native' });
        assert.equal(created.length, 1);
        assert.equal(created[0].tagName, 'STYLE');
        assert.match(created[0].textContent, /@keyframes/);
        assert.equal(typeof handle.detach, 'function');
    } finally {
        delete global.document;
    }
});

test('attachStoryboardRuntime: empty tracks throws', () => {
    assert.throws(() => attachStoryboardRuntime({}), TypeError);
});

test('attachStoryboardRuntime: auto with HAS_NATIVE_SUPPORT=false uses polyfill', () => {
    // In node, HAS_NATIVE_SUPPORT is always false. `runtime: 'auto'` should
    // route to the polyfill path — which needs document + IntersectionObserver
    // (or a scroll fallback).
    let observerCreated = false;
    const styleSetters = [];
    const rootEl = _makeShimElement('.p', styleSetters);

    global.document = {
        querySelector(sel) { return sel === '.p' ? rootEl : null; }
    };
    global.window = {
        innerHeight: 800,
        addEventListener() {},
        removeEventListener() {}
    };
    global.IntersectionObserver = function (cb) {
        observerCreated = true;
        return {
            _cb: cb,
            observe() {},
            disconnect() {}
        };
    };
    global.requestAnimationFrame = function () { return 1; };
    global.cancelAnimationFrame  = function () {};

    try {
        const handle = attachStoryboardRuntime({
            tracks: [{ selector: '.p', timeline: { kind: 'view' },
                       keyframes: [{ opacity: 0 }, { opacity: 1 }] }]
        }, { runtime: 'auto' });
        assert.ok(observerCreated, 'IntersectionObserver should have been created');
        assert.equal(typeof handle.detach, 'function');
        handle.detach();
    } finally {
        delete global.document;
        delete global.window;
        delete global.IntersectionObserver;
        delete global.requestAnimationFrame;
        delete global.cancelAnimationFrame;
    }
});

// Helper: shim element with a style tracker so tests can assert
// which properties were set to what values.
function _makeShimElement(selector, setters) {
    const el = {
        // Layout position (transform-immune) used by the offsetTop-chain
        // ticker. Tests drive progress by varying window.scrollY against a
        // fixed offsetTop -- exactly what the real drive train reads.
        offsetTop: 400,
        offsetHeight: 100,
        offsetParent: null,
        parentElement: null,
        style: {
            transform: '',
            translate: '',
            scale: '',
            rotate: '',
            setProperty(name, value) {
                setters.push({ name, value });
                el.style['__' + name] = value;
            }
        },
        getBoundingClientRect() {
            return { top: 400, bottom: 500, height: 100 };
        }
    };
    return el;
}

// Install a headless view-timeline environment on the globals the polyfill
// reads. Returns handles that drive the hybrid model: `enter()`/`leave()`
// flip the IO visibility gate; `scrollTo(y)` moves window.scrollY and flushes
// the scheduled rAF -- one applied frame per call, exactly like a real scroll.
function _installViewEnv(opts) {
    opts = opts || {};
    const selector = opts.selector || '.a';
    const setters = [];
    const el = _makeShimElement(selector, setters);
    el.offsetTop = opts.offsetTop != null ? opts.offsetTop : 400;
    el.offsetHeight = opts.elH != null ? opts.elH : 100;
    let rafCb = null;
    let ioCb = null;
    const win = {
        innerHeight: opts.viewportH != null ? opts.viewportH : 800,
        scrollY: opts.scrollY != null ? opts.scrollY : 0,
        _scroll: null,
        addEventListener(t, cb) { if (t === 'scroll') win._scroll = cb; },
        removeEventListener(t) { if (t === 'scroll') win._scroll = null; }
    };
    global.document = { querySelector: (s) => (s === selector ? el : null) };
    global.window = win;
    global.requestAnimationFrame = (cb) => { rafCb = cb; return 1; };
    global.cancelAnimationFrame = () => { rafCb = null; };
    global.IntersectionObserver = function (cb) {
        ioCb = cb;
        return { observe() {}, disconnect() {} };
    };
    if (opts.individual !== false) global.CSS = { supports: () => true };
    function flush() { if (rafCb) { const c = rafCb; rafCb = null; c(); } }
    return {
        el, setters, win,
        enter() { if (ioCb) ioCb([{ intersectionRatio: 0.5 }]); flush(); },
        leave() { if (ioCb) ioCb([{ intersectionRatio: 0 }]); },
        scrollTo(y) { win.scrollY = y; if (win._scroll) win._scroll(); flush(); },
        fireScroll() { if (win._scroll) win._scroll(); },
        hasPendingRaf() { return rafCb != null; },
        teardown() {
            delete global.document; delete global.window;
            delete global.requestAnimationFrame; delete global.cancelAnimationFrame;
            delete global.IntersectionObserver; delete global.CSS;
        }
    };
}

test('polyfill: hybrid drive -- IO gate unparks, ticker writes styles', () => {
    // offsetTop=400, viewportH=800, elH=100 -> raw = (800-400)/(800+100) = ~0.444
    const env = _installViewEnv({ selector: '.card', viewportH: 800, elH: 100, offsetTop: 400 });
    try {
        attachStoryboardRuntime({
            tracks: [{
                selector: '.card',
                timeline: { kind: 'view' },
                keyframes: [
                    { opacity: 0, translateY: 30 },
                    { opacity: 1, translateY: 0 }
                ],
                easing: 'linear'
            }]
        }, { runtime: 'polyfill' });

        // The IO gate is a visibility gate ONLY: entering unparks and the
        // ticker computes progress from layout position (offsetTop-chain).
        env.enter();
        const opacitySet = env.setters.find(s => s.name === 'opacity');
        assert.ok(opacitySet, 'opacity should have been set');
        const opacity = +opacitySet.value;
        assert.ok(opacity > 0 && opacity < 1,
            'opacity should be strictly between 0 and 1 -- got ' + opacity);
        // Individual transform property written (SF-04), author transform untouched.
        assert.match(env.el.style.translate, /px/);
    } finally {
        env.teardown();
    }
});

test('polyfill: keyframe interpolation at endpoints matches (opacity 0 -> 1)', () => {
    // viewportH=100, elH=100, total=200, offsetTop=100 -> raw = scrollY/200.
    const env = _installViewEnv({ selector: '.p', viewportH: 100, elH: 100, offsetTop: 100 });
    try {
        attachStoryboardRuntime({
            tracks: [{
                selector: '.p', timeline: { kind: 'view' },
                keyframes: [{ opacity: 0 }, { opacity: 1 }],
                easing: 'linear'
            }]
        }, { runtime: 'polyfill' });
        env.enter();
        // scrollY=0 -> raw ~0
        env.scrollTo(0);
        const first = env.setters.filter(s => s.name === 'opacity').pop();
        // scrollY=200 -> raw ~1
        env.setters.length = 0;
        env.scrollTo(200);
        const last = env.setters.filter(s => s.name === 'opacity').pop();
        assert.ok(+first.value < 0.1, 'expected ~0 at bottom of viewport, got ' + first.value);
        assert.ok(+last.value  > 0.9, 'expected ~1 at top of viewport, got ' + last.value);
    } finally {
        env.teardown();
    }
});

test('polyfill: element not found — track silently skipped', () => {
    global.document = { querySelector: () => null };
    global.window = { innerHeight: 800 };
    global.IntersectionObserver = function () { return { observe(){}, disconnect(){} }; };
    try {
        const handle = attachStoryboardRuntime({
            tracks: [{
                selector: '.does-not-exist', timeline: { kind: 'view' },
                keyframes: [{ opacity: 0 }, { opacity: 1 }]
            }]
        }, { runtime: 'polyfill' });
        // Should not throw; detach should work
        assert.equal(typeof handle.detach, 'function');
        assert.doesNotThrow(() => handle.detach());
    } finally {
        delete global.document;
        delete global.window;
        delete global.IntersectionObserver;
    }
});

test('polyfill: detach disconnects observers and removes scroll listeners', () => {
    let disconnectedCount = 0;
    let removedCount = 0;
    const el = _makeShimElement('.p', []);
    global.document = { querySelector: () => el };
    global.window = {
        innerHeight: 800, scrollY: 0,
        addEventListener() {}, removeEventListener() { removedCount++; }
    };
    global.requestAnimationFrame = () => 1;
    global.cancelAnimationFrame = () => {};
    global.IntersectionObserver = function () {
        return { observe() {}, disconnect() { disconnectedCount++; } };
    };
    try {
        const handle = attachStoryboardRuntime({
            tracks: [
                { selector: '.p', timeline: { kind: 'view' },
                  keyframes: [{ opacity: 0 }, { opacity: 1 }] },
                { selector: '.p', timeline: { kind: 'view' },
                  keyframes: [{ scale: 0 }, { scale: 1 }] }
            ]
        }, { runtime: 'polyfill' });
        handle.detach();
        assert.equal(disconnectedCount, 2, 'both IO gates disconnected');
        assert.equal(removedCount, 2, 'both ticker scroll listeners removed');
    } finally {
        delete global.document;
        delete global.window;
        delete global.requestAnimationFrame;
        delete global.cancelAnimationFrame;
        delete global.IntersectionObserver;
    }
});

test('polyfill: scroll timeline installs scroll listener + rAF', () => {
    const setters = [];
    const el = _makeShimElement('.progress', setters);
    let scrollListener = null;
    let scrollTop = 0;
    const scroller = {
        scrollTop: 0, scrollHeight: 2000, clientHeight: 800,
        addEventListener(evt, cb) { if (evt === 'scroll') scrollListener = cb; },
        removeEventListener() {}
    };
    global.document = {
        querySelector(sel) { return sel === '.progress' ? el : sel === '.scroller' ? scroller : null; }
    };
    global.window = {
        addEventListener() {}, removeEventListener() {},
        innerHeight: 800, scrollY: 0
    };
    let rafCb = null;
    global.requestAnimationFrame = (cb) => { rafCb = cb; return 1; };
    global.cancelAnimationFrame = () => {};
    try {
        attachStoryboardRuntime({
            tracks: [{
                selector: '.progress',
                timeline: { kind: 'scroll', scroller: '.scroller' },
                keyframes: [{ scaleX: 0 }, { scaleX: 1 }]
            }]
        }, { runtime: 'polyfill' });
        assert.equal(typeof scrollListener, 'function', 'scroll listener registered');
        // Simulate a scroll event
        scroller.scrollTop = 600;   // 600 / (2000 - 800) = 0.5
        scrollListener();
        if (rafCb) rafCb();   // flush the scheduled tick
        // Transform should have scale ~= 0.5 (linear interp at t=0.5)
        assert.match(el.style.transform, /scale\(/);
    } finally {
        delete global.document;
        delete global.window;
        delete global.requestAnimationFrame;
        delete global.cancelAnimationFrame;
    }
});

test('polyfill: CSS custom property gets setProperty(--foo, value)', () => {
    // offsetTop=400, viewportH=800, elH=100 -> raw = ~0.444 (mid-range).
    const env = _installViewEnv({ selector: '.pill', viewportH: 800, elH: 100, offsetTop: 400 });
    try {
        attachStoryboardRuntime({
            tracks: [{
                selector: '.pill', timeline: { kind: 'view' },
                keyframes: [{ '--hue': 20 }, { '--hue': 240 }],
                easing: 'linear'
            }]
        }, { runtime: 'polyfill' });
        env.enter();
        const hueSet = env.setters.find(s => s.name === '--hue');
        assert.ok(hueSet, '--hue should have been set');
        const val = +hueSet.value;
        assert.ok(val > 20 && val < 240, 'value should interpolate between 20 and 240');
    } finally {
        env.teardown();
    }
});

test('polyfill: easing preset (easeOutCubic) produces non-linear progress', () => {
    // viewportH=100, elH=100, total=200, offsetTop=100 -> raw = scrollY/200.
    // scrollY=100 -> raw=0.5.
    const env = _installViewEnv({ selector: '.a', viewportH: 100, elH: 100, offsetTop: 100, scrollY: 100 });
    try {
        attachStoryboardRuntime({
            tracks: [{
                selector: '.a', timeline: { kind: 'view' },
                keyframes: [{ opacity: 0 }, { opacity: 1 }],
                easing: 'easeOutCubic'
            }]
        }, { runtime: 'polyfill' });
        env.enter();   // ticks at scrollY=100 -> raw=0.5
        const op = +env.setters.filter(s => s.name === 'opacity').pop().value;
        // For easeOutCubic at t=0.5, y = 1 - (1-0.5)^3 = 0.875.
        assert.ok(op > 0.8, 'easeOutCubic at t=0.5 should be ~0.875, got ' + op);
    } finally {
        env.teardown();
    }
});

test('polyfill: multi-keyframe interpolates through the middle stop', () => {
    // viewportH=100, elH=100, total=200, offsetTop=100, scrollY=100 -> raw=0.5.
    const env = _installViewEnv({ selector: '.a', viewportH: 100, elH: 100, offsetTop: 100, scrollY: 100 });
    try {
        attachStoryboardRuntime({
            tracks: [{
                selector: '.a', timeline: { kind: 'view' },
                keyframes: [
                    { offset: 0,   scale: 1   },
                    { offset: 0.5, scale: 1.5 },
                    { offset: 1,   scale: 1   }
                ],
                easing: 'linear'
            }]
        }, { runtime: 'polyfill' });
        env.enter();   // ticks at raw=0.5, matches the offset 0.5 keyframe
        // SF-04: individual `scale` property, not a transform string.
        const match = /([-\d.]+)\s+([-\d.]+)/.exec(env.el.style.scale);
        assert.ok(match, 'scale should be present as an individual property');
        assert.ok(+match[1] > 1.4, 'scale at middle keyframe should be ~1.5, got ' + match[1]);
    } finally {
        env.teardown();
    }
});

test('polyfill: range mapping -- entry 0-100% keeps animation in the early cover portion', () => {
    // elH=100, viewportH=800, entryFrac=100/900 ~= 0.111. offsetTop=755,
    // scrollY=0 -> relTop=755 -> raw = (800-755)/900 = 0.05.
    // p within entry range = 0.05/0.111 ~= 0.45.
    const env = _installViewEnv({ selector: '.a', viewportH: 800, elH: 100, offsetTop: 755, scrollY: 0 });
    try {
        attachStoryboardRuntime({
            tracks: [{
                selector: '.a', timeline: { kind: 'view' },
                range: { start: 'entry 0%', end: 'entry 100%' },
                keyframes: [{ opacity: 0 }, { opacity: 1 }],
                easing: 'linear'
            }]
        }, { runtime: 'polyfill' });
        env.enter();
        const op = +env.setters.filter(s => s.name === 'opacity').pop().value;
        assert.ok(op > 0.3 && op < 0.7,
            'opacity should be mid-range within entry, got ' + op);
    } finally {
        env.teardown();
    }
});
