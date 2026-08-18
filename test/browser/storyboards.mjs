// test/browser/storyboards.mjs
//
// THE CORPUS + the page-side parity harness.
// =================================================================
// Package-agnostic driver (runner.mjs) knows nothing about scrollforge; this
// file owns everything that does. It exports:
//   - CORPUS      -- the parity storyboards (data), each mounted twice.
//   - CONTROL     -- the v1.0.0 transform-order divergence (rotate + non-uniform
//                    scale over an author transform). Mounted THREE times:
//                    native, polyfill-individual, polyfill-legacy. Proves the
//                    oracle has teeth: legacy diverges, individual matches.
//   - SCROLLFORGE_SRC -- Scrollforge.js turned into a classic script (exports
//                    stripped) so every top-level function -- INCLUDING the
//                    internal drive-train (_createTrackState, ...) -- is a page
//                    global. Scrollforge.js on disk is NOT modified.
//   - PAGE_SRC    -- the in-page harness: composed-matrix sampler + a per-item
//                    mount(build DOM twice/thrice, attach native + polyfill) +
//                    a scripted-scroll sample loop. Injected as a classic script.
//   - inject / collect / makeScenario -- wiring for runner.mjs.
//
// MEASUREMENT (documented, so the metric is falsifiable):
//   At each scroll step, for each leg, we read from getComputedStyle:
//     - opacity           (absolute scalar)
//     - the COMPOSED VISUAL MATRIX: translate . rotate . scale . transform in
//       CSS spec composition order, as a DOMMatrix [a,b,c,d,e,f]. This is the
//       ONLY honest way to compare the native individual-property path against
//       the polyfill: native animates `translate:`/`rotate:`/`scale:` (the
//       `transform` shorthand stays `none`), so a naive getComputedStyle(...)
//       .transform read would see `none` on native and a matrix on the legacy
//       polyfill. Composing all four into one matrix captures the true visual
//       result for BOTH paths -- and captures the legacy path clobbering an
//       author `transform` (the exact SF-04 divergence the control pins).
//     - registered custom properties (numeric, exact after rounding).
//   parityScore per property = { maxDev, rmsDev } over all sampled steps.
//   Matrix e,f are px (translate); a,b,c,d are unitless (rotate/scale/skew).
//
// SAMPLING WINDOW (the recorded park boundary, decisions/0003-parity.md):
//   For view() items we sample only scroll positions where the subject is
//   meaningfully ON-SCREEN. The polyfill's SF-01 park model gives a parked
//   (fully off-screen) track ZERO rAF wake-ups, so it does not paint native's
//   backward fill BEFORE first entry. That divergence is deliberate and
//   recorded; we do not measure inside it. While the subject is on-screen the
//   ticker runs every frame and clamped/filled progress matches native exactly.
// =================================================================

import { readFileSync } from 'node:fs';
import { linearPoints } from '../../Scrollforge.js';
import { easeOutBounce, easeInOutElastic, easeOutBack, easeInOutSine } from '@zakkster/lite-ease';

export const SCROLLFORGE_SRC = readFileSync(
    new URL('../../Scrollforge.js', import.meta.url), 'utf8'
).replace(/^export /gm, '');

// Viewport is 800x600 (runner default). Geometry constants shared by node
// (range planning) and the page (DOM build) -- kept in lockstep here.
const VIEWPORT_H = 600;
const SPACER_TOP = 1000;    // px above the subject in a window-scrolled column
const SPACER_BOTTOM = 1400; // px below
const PAD = 70;             // inset past the park-engagement band, both edges
const STEPS = 12;

const CONTAINER_H = 400;
const CONTENT_TOP = 600;
const CONTENT_BOTTOM = 900;
const CPAD = 55;

// --- analytic easings routed through native linear() vs the piecewise
// evaluator. BOTH legs get the SAME linear(...) string: native feeds it to
// `animation-timing-function`, the polyfill parses it with _makeLinearPiecewise.
// Two implementations of one curve, compared through the DOM.
const LINEAR_SAMPLES = 32;
function linStr(fn) { return linearPoints(fn, LINEAR_SAMPLES); }

// --- corpus item builders -------------------------------------------------
// A corpus item is plain, structured-clonable data. The page-side mount()
// interprets `timelineKind`, `scrollTarget`, `named` to wire timelines per leg.

function viewItem(name, rangeKind, subjectH, extra) {
    const from = SPACER_TOP - VIEWPORT_H + PAD;
    const to = SPACER_TOP + subjectH - PAD;
    const range = rangeKind
        ? { start: rangeKind + ' 0%', end: rangeKind + ' 100%' }
        : { start: 'entry 0%', end: 'exit 100%' };
    return Object.assign({
        name: name,
        legs: ['native', 'polyfill'],
        timelineKind: 'view',
        scrollTarget: 'window',
        named: false,
        dom: { subjectH: subjectH, spacerTop: SPACER_TOP, spacerBottom: SPACER_BOTTOM,
            authorTransform: null, container: null, custom: [] },
        track: { range: range,
            keyframes: [{ opacity: 0, translateY: 0, rotate: 0 }, { opacity: 1, translateY: 120, rotate: 45 }],
            easing: 'easeOutCubic', fill: 'both' },
        scroll: { target: 'window', from: from, to: to, steps: STEPS },
        compare: ['opacity', 'matrix'],
        tol: { opacity: 0.02, transformPx: 1.0, matrix: 0.01, custom: 0.5 }
    }, extra || {});
}

function containerViewItem(name, subjectH) {
    const from = CONTENT_TOP - CONTAINER_H + CPAD;
    const to = CONTENT_TOP + subjectH - CPAD;
    return {
        name: name,
        legs: ['native', 'polyfill'],
        timelineKind: 'view',
        scrollTarget: 'container',
        named: false,
        dom: { subjectH: subjectH, spacerTop: 0, spacerBottom: 0, authorTransform: null,
            container: { h: CONTAINER_H, contentTop: CONTENT_TOP, contentBottom: CONTENT_BOTTOM },
            nested: false, custom: [] },
        track: { range: { start: 'entry 0%', end: 'exit 100%' },
            keyframes: [{ opacity: 0, translateY: 0 }, { opacity: 1, translateY: 100 }],
            easing: 'easeInOutQuad', fill: 'both' },
        scroll: { target: 'container', from: from, to: to, steps: STEPS },
        compare: ['opacity', 'matrix'],
        tol: { opacity: 0.02, transformPx: 1.0, matrix: 0.01, custom: 0.5 }
    };
}

function scrollItem(name, target) {
    return {
        name: name,
        legs: ['native', 'polyfill'],
        timelineKind: 'scroll',
        scrollTarget: target,
        named: false,
        dom: target === 'container'
            ? { subjectH: 120, spacerTop: 0, spacerBottom: 0, authorTransform: null,
                container: { h: CONTAINER_H, contentTop: CONTENT_TOP, contentBottom: CONTENT_BOTTOM },
                sticky: true, nested: false, custom: [] }
            : { subjectH: 120, spacerTop: SPACER_TOP, spacerBottom: SPACER_BOTTOM, authorTransform: null,
                container: null, sticky: true, custom: [] },
        track: { range: null,
            keyframes: [{ opacity: 0, translateX: 0 }, { opacity: 1, translateX: 200 }],
            easing: 'linear', fill: 'both' },
        scroll: { target: target, from: 0, to: 'max', steps: STEPS },
        compare: ['opacity', 'matrix'],
        tol: { opacity: 0.02, transformPx: 1.0, matrix: 0.01, custom: 0.5 }
    };
}

function easingItem(name, fn) {
    const from = SPACER_TOP - VIEWPORT_H + PAD;
    const to = SPACER_TOP + 100 - PAD;
    return {
        name: name,
        legs: ['native', 'polyfill'],
        timelineKind: 'view',
        scrollTarget: 'window',
        named: false,
        dom: { subjectH: 100, spacerTop: SPACER_TOP, spacerBottom: SPACER_BOTTOM,
            authorTransform: null, container: null, custom: [] },
        // SAME linear() string on both legs -- native linear() vs polyfill
        // piecewise. Range is entry-only so the full curve plays across a
        // narrow, fully-on-screen band.
        track: { range: { start: 'entry 25%', end: 'contain 100%' },
            keyframes: [{ opacity: 0 }, { opacity: 1 }],
            easing: linStr(fn), fill: 'both' },
        scroll: { target: 'window', from: from, to: to, steps: 20 },
        compare: ['opacity'],
        // one sample-quantization step of the 32-sample linear() curve is
        // ~1/32 ~= 0.031 in opacity; the CSS engine and the JS piecewise
        // evaluate the SAME breakpoints, so measured agreement is far tighter.
        tol: { opacity: 0.02, transformPx: 1.0, matrix: 0.01, custom: 0.5 }
    };
}

export const CORPUS = [
    // quick-start (README's first example)
    (function quickstart() {
        const it = viewItem('quick-start', null, 100);
        it.track = { range: { start: 'entry 0%', end: 'entry 100%' },
            keyframes: [{ opacity: 0, translateY: 30 }, { opacity: 1, translateY: 0 }],
            easing: 'easeOutCubic', fill: 'both' };
        it.scroll = { target: 'window', from: SPACER_TOP - VIEWPORT_H + PAD,
            to: SPACER_TOP + 100 - PAD, steps: STEPS };
        return it;
    })(),

    // every range kind x short subject AND tall subject.
    // entry-tall / exit-tall are QUARANTINED KNOWN DIVERGENCES (finding SF-03,
    // REOPENED -- recorded in decisions/0003-parity.md): for a subject TALLER
    // than the scrollport the polyfill runs entry/exit across span ==
    // elementHeight, but native (the reference engine) uses span ==
    // min(elementHeight, viewport). SF0 closed SF-03's contain-phase clamp-to-
    // zero, but this entry/exit span defect in the same tall-subject geometry
    // family survived -- the headless SF-03 fixtures matched hand-derived math,
    // and only the browser oracle, comparing against the real native engine,
    // surfaces it (entry-tall ~20.5px, exit-tall ~77.3px). This is an OPEN
    // polyfill bug -- NOT a deliberate exception -- fixed by reopening SF0 (out
    // of scope for SF1, which only builds the oracle). The `known` flag inverts
    // the assertion into a tripwire: the item MUST keep diverging; the day an
    // SF0 fix makes it match native, the oracle fails and forces this quarantine
    // to be lifted.
    viewItem('entry-short', 'entry', 100),
    viewItem('entry-tall', 'entry', 900, { known: 'SF-03' }),
    viewItem('contain-short', 'contain', 100),
    viewItem('contain-tall', 'contain', 900),
    viewItem('exit-short', 'exit', 100),
    viewItem('exit-tall', 'exit', 900, { known: 'SF-03' }),
    viewItem('cover-short', 'cover', 100),
    viewItem('cover-tall', 'cover', 900),

    // named timeline with attachedSelector (attached to the subject itself so
    // native's view-timeline-name source == the polyfill's subject view position)
    (function named() {
        const it = viewItem('named-timeline', null, 120);
        it.named = true;
        return it;
    })(),

    // nested scrollers -- subject inside an inner scroller inside an outer one;
    // both native view() and the polyfill resolve the nearest (inner) scrollport
    (function nested() {
        const it = containerViewItem('nested-scrollers', 120);
        it.dom.nested = true;
        return it;
    })(),

    // scroll timeline against BOTH window and a container
    scrollItem('scroll-window', 'window'),
    scrollItem('scroll-container', 'container'),

    // view timeline against a container (short + tall handled by the range items;
    // this pins the container-as-scrollport view path directly)
    containerViewItem('view-container', 120),

    // custom properties (registered <number> so native interpolates too)
    (function custom() {
        const it = viewItem('custom-properties', null, 120);
        it.track = { range: { start: 'entry 0%', end: 'contain 100%' },
            keyframes: [{ opacity: 0, '--sf-x': 0 }, { opacity: 1, '--sf-x': 300 }],
            easing: 'linear', fill: 'both' };
        it.dom.custom = ['--sf-x'];
        it.compare = ['opacity', 'custom'];
        return it;
    })(),

    // each analytic lite-ease easing: linear() (native) vs piecewise (polyfill)
    easingItem('ease-bounce', easeOutBounce),
    easingItem('ease-elastic', easeInOutElastic),
    easingItem('ease-back', easeOutBack),
    easingItem('ease-sine', easeInOutSine)
];

// THE CONTROL. rotate + NON-UNIFORM scale animated over an element that carries
// an author `transform: skewX(18deg)`. The native path and the SF-04
// individual-property polyfill path both COMPOSE with the author transform
// (translate . rotate . scale . [author transform]); the legacy `style.transform`
// string path CLOBBERS the author transform. So legacy diverges from native by a
// large matrix deviation while individual matches to floating point. If both
// pass, the oracle is blind.
export const CONTROL = {
    name: 'control-transform-order',
    legs: ['native', 'polyfill', 'legacy'],
    timelineKind: 'view',
    scrollTarget: 'window',
    named: false,
    dom: { subjectH: 100, spacerTop: SPACER_TOP, spacerBottom: SPACER_BOTTOM,
        authorTransform: 'skewX(18deg)', container: null, custom: [] },
    track: { range: { start: 'entry 0%', end: 'exit 100%' },
        keyframes: [{ rotate: 0, scaleX: 1, scaleY: 1 }, { rotate: 90, scaleX: 2, scaleY: 0.5 }],
        easing: 'linear', fill: 'both' },
    scroll: { target: 'window', from: SPACER_TOP - VIEWPORT_H + PAD,
        to: SPACER_TOP + 100 - PAD, steps: STEPS },
    compare: ['matrix'],
    // individual must be well within this; legacy must clear it by a mile.
    tol: { opacity: 0.02, transformPx: 1.0, matrix: 0.02, custom: 0.5 }
};

// =========================================================================
// PAGE_SRC -- classic-script string. Defines window.__sf with the mount +
// scripted-scroll sample loop. Kept as a string (not addScriptTag fn) so it
// runs in the page global scope alongside the stripped Scrollforge globals.
// =========================================================================
export const PAGE_SRC = `
window.__sf = (function () {
  function q(sel) { return document.querySelector(sel); }

  // Compose translate . rotate . scale . transform (CSS spec order) into one
  // DOMMatrix. Captures BOTH the native individual-property path and the legacy
  // transform-string path in one comparable visual matrix.
  function composedMatrix(el) {
    var cs = getComputedStyle(el);
    var m = new DOMMatrix();
    var tr = cs.translate, ro = cs.rotate, sc = cs.scale, tf = cs.transform;
    if (tr && tr !== 'none') {
      var a = tr.split(/\\s+/).map(parseFloat);
      m = m.translate(a[0] || 0, a.length > 1 ? (a[1] || 0) : 0);
    }
    if (ro && ro !== 'none') m = m.rotate(parseFloat(ro) || 0);
    if (sc && sc !== 'none') {
      var s = sc.split(/\\s+/).map(parseFloat);
      m = m.scale(s[0], s.length > 1 ? s[1] : s[0]);
    }
    if (tf && tf !== 'none') m = m.multiply(new DOMMatrix(tf));
    return [m.a, m.b, m.c, m.d, m.e, m.f];
  }

  function readLeg(el, customNames) {
    var cs = getComputedStyle(el);
    var custom = {};
    for (var i = 0; i < customNames.length; i++) {
      custom[customNames[i]] = parseFloat(cs.getPropertyValue(customNames[i]));
    }
    return { opacity: parseFloat(cs.opacity), matrix: composedMatrix(el), custom: custom };
  }

  function registerCustom(names) {
    for (var i = 0; i < names.length; i++) {
      try {
        window.CSS.registerProperty({ name: names[i], syntax: '<number>',
          inherits: false, initialValue: '0' });
      } catch (e) { /* already registered */ }
    }
  }

  function spacer(h) { var d = document.createElement('div'); d.style.height = h + 'px'; return d; }

  // Build one leg's DOM column and return the subject element + scroller.
  function buildColumn(item, leg, colId, leftPx) {
    var dom = item.dom;
    var col = document.createElement('div');
    col.id = colId;
    col.style.cssText = 'position:absolute;top:0;width:200px;left:' + leftPx + 'px;';

    var subj = document.createElement('div');
    subj.id = colId + '-subj';
    subj.style.cssText = 'width:100px;height:' + dom.subjectH + 'px;background:#c33;' +
      (item.timelineKind === 'scroll' && dom.sticky ? 'position:sticky;top:0;' : '');
    if (dom.authorTransform) subj.style.transform = dom.authorTransform;

    var scrollerEl = null;
    if (dom.container) {
      var outer = null;
      var host = col;
      if (dom.nested) {
        outer = document.createElement('div');
        outer.id = colId + '-outer';
        outer.style.cssText = 'overflow:auto;height:' + (dom.container.h + 120) + 'px;';
        outer.appendChild(spacer(200));
        col.appendChild(outer);
        host = outer;
      }
      var sc = document.createElement('div');
      sc.id = colId + '-scroller';
      sc.style.cssText = 'overflow:auto;height:' + dom.container.h + 'px;';
      sc.appendChild(spacer(dom.container.contentTop));
      sc.appendChild(subj);
      sc.appendChild(spacer(dom.container.contentBottom));
      host.appendChild(sc);
      if (dom.nested) outer.appendChild(spacer(400));
      scrollerEl = sc;
    } else {
      col.appendChild(spacer(dom.spacerTop));
      col.appendChild(subj);
      col.appendChild(spacer(dom.spacerBottom));
    }
    document.body.appendChild(col);
    return { subj: subj, subjSel: '#' + colId + '-subj', scroller: scrollerEl,
      scrollerSel: scrollerEl ? '#' + colId + '-scroller' : null };
  }

  // Resolve the timeline config for a given leg from item flags.
  function timelineFor(item, leg, built) {
    if (item.named) {
      // native/legacy: real named view-timeline attached to the subject.
      // polyfill: plain view() on the subject (nearest scrollport).
      return null; // signalled via storyboard.timelines below
    }
    if (item.timelineKind === 'scroll') {
      if (item.scrollTarget === 'window') return { kind: 'scroll', scroller: 'root' };
      // container: native uses nearest keyword; polyfill uses the selector.
      return leg === 'native'
        ? { kind: 'scroll' }
        : { kind: 'scroll', scroller: built.scrollerSel };
    }
    // view
    if (item.scrollTarget === 'container' && leg !== 'native') {
      return { kind: 'view', scroller: built.scrollerSel };
    }
    return { kind: 'view' };
  }

  function storyboardFor(item, leg, built) {
    var track = { selector: built.subjSel,
      keyframes: item.track.keyframes, easing: item.track.easing, fill: item.track.fill };
    if (item.track.range) track.range = item.track.range;
    if (item.named) {
      var tlName = '--sf-' + built.subjSel.replace(/[^a-z0-9]/gi, '');
      if (leg === 'native') {
        track.timeline = { name: tlName };
        var timelines = {};
        timelines[tlName] = { attachedSelector: built.subjSel, kind: 'view' };
        return { timelines: timelines, tracks: [track] };
      }
      track.timeline = { kind: 'view' };
      return { tracks: [track] };
    }
    track.timeline = timelineFor(item, leg, built);
    return { tracks: [track] };
  }

  function attachLeg(item, leg, built) {
    var sb = storyboardFor(item, leg, built);
    if (leg === 'native') return window.attachStoryboardRuntime(sb, { runtime: 'native' });
    if (leg === 'legacy') {
      // Force the legacy style.transform path: make _supportsIndividualTransforms
      // return false for THIS attach only, then restore.
      var real = window.CSS.supports.bind(window.CSS);
      window.CSS.supports = function (query, val) {
        if (arguments.length === 1 && /translate:\\s*0px/.test(query)) return false;
        return real(query, val);
      };
      var h;
      try { h = window.attachStoryboardRuntime(sb, { runtime: 'polyfill' }); }
      finally { window.CSS.supports = real; }
      return h;
    }
    return window.attachStoryboardRuntime(sb, { runtime: 'polyfill' });
  }

  // Mount every leg side by side and run the scripted-scroll sample loop.
  async function run(item) {
    document.body.style.margin = '0';
    registerCustom(item.dom.custom || []);
    var built = {};
    var handles = {};
    for (var i = 0; i < item.legs.length; i++) {
      var leg = item.legs[i];
      var colId = 'col-' + item.name + '-' + leg;
      var b = buildColumn(item, leg, colId, 30 + i * 240);
      built[leg] = b;
      handles[leg] = attachLeg(item, leg, b);
    }

    // Resolve scroll target (window vs the FIRST leg's scroller; all legs'
    // scrollers are scrolled together each step).
    var scrollKind = item.scroll.target;
    var maxOf = function () {
      if (scrollKind === 'window') {
        return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      }
      var sc = built[item.legs[0]].scroller;
      return sc ? Math.max(0, sc.scrollHeight - sc.clientHeight) : 0;
    };
    var to = item.scroll.to === 'max' ? maxOf() : item.scroll.to;
    var from = item.scroll.from;
    var steps = item.scroll.steps;

    function doScroll(y) {
      if (scrollKind === 'window') { window.scrollTo(0, y); return; }
      for (var i = 0; i < item.legs.length; i++) {
        var sc = built[item.legs[i]].scroller;
        if (sc) sc.scrollTop = y;
      }
    }
    function twoFrames() {
      return new Promise(function (r) {
        requestAnimationFrame(function () { requestAnimationFrame(function () { r(); }); });
      });
    }

    var samples = [];
    for (var s = 0; s <= steps; s++) {
      var y = from + (to - from) * (s / steps);
      doScroll(y);
      await twoFrames();
      var legVals = {};
      for (var j = 0; j < item.legs.length; j++) {
        var lg = item.legs[j];
        legVals[lg] = readLeg(built[lg].subj, item.dom.custom || []);
      }
      samples.push({ y: y, legs: legVals });
    }

    for (var k in handles) { if (handles[k] && handles[k].detach) handles[k].detach(); }
    for (var c in built) { var el = document.getElementById('col-' + item.name + '-' + c); if (el) el.remove(); }
    return { name: item.name, compare: item.compare, tol: item.tol,
      legs: item.legs, known: item.known || null, samples: samples };
  }

  return { run: run };
})();
`;

// --- runner.mjs wiring ----------------------------------------------------
export async function inject(page) {
    await page.addScriptTag({ content: SCROLLFORGE_SRC });
    await page.addScriptTag({ content: PAGE_SRC });
}

export function makeScenario(item) {
    return {
        name: item.name,
        async run(ctx) {
            const snap = await ctx.eval(function (it) { return window.__sf.run(it); }, item);
            ctx.__snap = snap; // node-side stash for collect
        }
    };
}

export function collect(page, ctx) {
    return ctx.__snap;
}
