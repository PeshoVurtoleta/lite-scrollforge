// test/browser/rig-handoff.test.mjs -- node --test test/browser/rig-handoff.test.mjs
//
// THE RIG-HANDOFF EXECUTION LANE (SF3).
// Unlike the gsap recipe (parse-gated -- no gsap runtime in this tree), the rig
// is a published zero-dep peer, so we EXECUTE the emitted module against the real
// @zakkster/lite-scroll-rig-pro@1.3.2 in a real Chromium. This is the user's
// explicit decision: real execution, not parse-only.
//
// What runs: recipes/rig-handoff.js calls toRig(sb); we serve that emitted module
// verbatim over HTTP with an import map that resolves the rig's bare specifiers
// to the real installed files. The emitted attachScrollRig now wires the way the
// real rig 1.3.2 API requires -- new DOMScroller(elements, pool);
// engine.addRenderer(scroller); engine.start(); detach via engine.destroy() --
// so it SELF-DRIVES: it registers the renderer and runs the frame loop itself.
//
// The map points @zakkster/lite-scroll-rig-pro at a thin SHIM that re-exports the
// real package but subclasses ScrollEngine to count destroy() (proving detach
// tears the engine down, no leak). Everything else is the real rig.
//
// CONTRACT (the real thing, not a tripwire): attach the emitted module against a
// tall real document; scroll the window; the rig's own loop reconciles the native
// scroll and drives a real matrix3d onto the card -- t=0 => ty 80 / sc 0.8 /
// rot -6, t=1 => ty 0 / sc 1 / rot 0. Detach => engine.destroy() called,
// engine.isActive false. Break control: mutate the FROM keyframe, the observed
// t=0 matrix moves off the endpoints.
//
// Browser policy: FAIL-CLOSED. Missing Chromium is a FAILURE unless
// LITE_NO_BROWSER=1 -- then this lane skips loudly and the node lanes still gate.

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';
import { emitRigModule, RIG_ENDPOINTS } from '../../recipes/rig-handoff.js';

const SKIP = process.env.LITE_NO_BROWSER === '1';
const ROOT = normalize(join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

// Bare specifiers the rig's static .js graph pulls, mapped to real installed
// files. If the rig tree grows a new peer, the browser import fails loudly here.
const IMPORT_MAP = {
    imports: {
        '@zakkster/lite-scroll-rig-pro': '/shim-rig.js',
        '@zakkster/lite-keyframe': '/node_modules/@zakkster/lite-keyframe/Keyframe.js',
        '@zakkster/lite-dom-binder': '/node_modules/@zakkster/lite-dom-binder/DOMBinder.js',
        '@zakkster/lite-lerp': '/node_modules/@zakkster/lite-lerp/Lerp.js',
        '@zakkster/lite-spring': '/node_modules/@zakkster/lite-spring/Spring.js',
        '@zakkster/lite-gesture': '/node_modules/@zakkster/lite-gesture/GestureTracker.js'
    }
};

// Re-export the real rig; subclass ScrollEngine to count destroy() so detach's
// teardown is observable. Internal bare imports inside the real package resolve
// via the map; the real index is loaded by its direct URL to avoid self-mapping.
const SHIM_RIG = `
import * as rig from '/node_modules/@zakkster/lite-scroll-rig-pro/src/index.js';
window.__rigCapture = { engines: [], destroyed: 0 };
export class ScrollEngine extends rig.ScrollEngine {
  constructor(...a) { super(...a); window.__rigCapture.engines.push(this); }
  destroy() { window.__rigCapture.destroyed++; return super.destroy(); }
}
export const DOMScroller = rig.DOMScroller;
export const MetricsCache = rig.MetricsCache;
export const VirtualScroll = rig.VirtualScroll;
export const composeMatrix2D = rig.composeMatrix2D;
export const writeIntersectionBounds = rig.writeIntersectionBounds;
export const calculateIntersectionBounds = rig.calculateIntersectionBounds;
export const computeProgress = rig.computeProgress;
export const computeParallaxOffset = rig.computeParallaxOffset;
export const isInteractiveTarget = rig.isInteractiveTarget;
export const INTERACTIVE_SELECTOR = rig.INTERACTIVE_SELECTOR;
export const VERSION = rig.VERSION;
`;

// Tall document so window scrolls; the card sits between big spacers. Page-side
// helpers expose attach/detach/settle so node drives them via page.evaluate.
function fixtureHtml(importMapJson) {
    return `<!doctype html><html><head><meta charset="utf-8">
<script type="importmap">${importMapJson}</script>
</head><body style="margin:0">
<div style="height:3000px"></div>
<div class="rig-card" style="width:100px;height:100px;background:#c33"></div>
<div style="height:3000px"></div>
<script type="module">
  import { attachScrollRig } from '/emitted.mjs';
  let _detach = null;
  function readMatrix() {
    const el = document.querySelector('.rig-card');
    const tf = getComputedStyle(el).transform;
    if (!tf || tf === 'none') return { tf: 'none', ty: 0, sc: 1, rot: 0 };
    const m = new DOMMatrix(tf);
    return { tf: tf, ty: m.f, sc: Math.sqrt(m.a * m.a + m.b * m.b), rot: Math.atan2(m.b, m.a) * 180 / Math.PI };
  }
  async function settleAt(y) {
    window.scrollTo(0, y);
    const el = document.querySelector('.rig-card');
    let prev = '', stable = 0;
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const tf = getComputedStyle(el).transform;
      if (tf === prev) { if (++stable >= 3) break; } else { stable = 0; prev = tf; }
    }
    return readMatrix();
  }
  window.__rig = {
    attach() {
      window.__rigCapture = { engines: [], destroyed: 0 };
      _detach = attachScrollRig(document.body);
      const eng = window.__rigCapture.engines[0];
      return { engines: window.__rigCapture.engines.length, active: eng ? eng.isActive : null };
    },
    settleAt: settleAt,
    detach() {
      if (_detach) _detach();
      const eng = window.__rigCapture.engines[0];
      return { destroyed: window.__rigCapture.destroyed, active: eng ? eng.isActive : null };
    }
  };
  window.__ready = true;
</script>
</body></html>`;
}

function startServer(emittedSrc, importMapJson) {
    const server = http.createServer(function (req, res) {
        const url = decodeURIComponent(req.url.split('?')[0]);
        try {
            if (url === '/' || url === '/fixture.html') {
                res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
                res.end(fixtureHtml(importMapJson));
                return;
            }
            if (url === '/emitted.mjs') {
                res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
                res.end(emittedSrc);
                return;
            }
            if (url === '/shim-rig.js') {
                res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
                res.end(SHIM_RIG);
                return;
            }
            const abs = normalize(join(ROOT, url));
            if (!abs.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
            const body = readFileSync(abs);
            const type = abs.endsWith('.js') || abs.endsWith('.mjs')
                ? 'text/javascript; charset=utf-8' : 'application/octet-stream';
            res.writeHead(200, { 'content-type': type });
            res.end(body);
        } catch (e) {
            res.writeHead(404); res.end('not found: ' + url);
        }
    });
    return new Promise(function (resolve) {
        server.listen(0, '127.0.0.1', function () { resolve(server); });
    });
}

test('rig-handoff: emitted toRig module SELF-DRIVES against real lite-scroll-rig-pro', { skip: SKIP }, async () => {
    const { chromium } = await import('playwright');

    const emitted = emitRigModule({ moduleFormat: 'esm' });
    assert.match(emitted, /@zakkster\/lite-scroll-rig-pro/);
    assert.match(emitted, /@zakkster\/lite-keyframe/);
    assert.match(emitted, /export function attachScrollRig/);
    // The corrected wiring the emitter must now produce for rig 1.3.2.
    assert.match(emitted, /engine\.addRenderer\(scroller\)/, 'emitted code does not register the renderer');
    assert.match(emitted, /engine\.start\(\)/, 'emitted code does not start the engine');
    assert.match(emitted, /engine\.destroy\(\)/, 'emitted detach does not tear the engine down');
    assert.ok(!/\.dispose\(/.test(emitted), 'emitted code still calls the nonexistent .dispose()');

    const importMapJson = JSON.stringify(IMPORT_MAP);
    const server = await startServer(emitted, importMapJson);
    const base = 'http://127.0.0.1:' + server.address().port;

    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
        const errors = [];
        page.on('pageerror', function (e) { errors.push(String(e)); });

        await page.goto(base + '/fixture.html');
        await page.waitForFunction('window.__ready === true', null, { timeout: 15000 });
        assert.deepEqual(errors, [], 'page errors importing the emitted rig module: ' + errors.join(' | '));

        // Attach the EMITTED module; it self-registers + starts the loop.
        const attached = await page.evaluate('window.__rig.attach()');
        assert.equal(attached.engines, 1, 'emitted attachScrollRig did not construct a ScrollEngine');
        assert.equal(attached.active, true, 'emitted attachScrollRig did not start the engine (isActive false)');

        // Scroll the window; the rig's own loop reconciles native scroll and
        // drives the transform. Past the card => t=1; back above it => t=0.
        const endM = await page.evaluate('window.__rig.settleAt(3100)');
        const startM = await page.evaluate('window.__rig.settleAt(0)');

        // Self-driven and moving with scroll.
        assert.notEqual(endM.tf, 'none', 'card never received a transform -- the emitted module did not self-drive');
        assert.ok(Math.abs(endM.ty - startM.ty) > 10, 'transform did not change between scroll extremes');

        assert.ok(Math.abs(endM.ty - RIG_ENDPOINTS.end.translateY) < 1.5,
            't=1 translateY ' + endM.ty + ' != ' + RIG_ENDPOINTS.end.translateY);
        assert.ok(Math.abs(endM.sc - RIG_ENDPOINTS.end.scale) < 0.02,
            't=1 scale ' + endM.sc + ' != ' + RIG_ENDPOINTS.end.scale);
        assert.ok(Math.abs(endM.rot - RIG_ENDPOINTS.end.rotate) < 0.6,
            't=1 rotate ' + endM.rot + ' != ' + RIG_ENDPOINTS.end.rotate);
        assert.ok(Math.abs(startM.ty - RIG_ENDPOINTS.start.translateY) < 1.5,
            't=0 translateY ' + startM.ty + ' != ' + RIG_ENDPOINTS.start.translateY);
        assert.ok(Math.abs(startM.sc - RIG_ENDPOINTS.start.scale) < 0.02,
            't=0 scale ' + startM.sc + ' != ' + RIG_ENDPOINTS.start.scale);
        assert.ok(Math.abs(startM.rot - RIG_ENDPOINTS.start.rotate) < 0.6,
            't=0 rotate ' + startM.rot + ' != ' + RIG_ENDPOINTS.start.rotate);

        console.log('  rig-handoff: t0 ty=' + startM.ty.toFixed(2) + ' sc=' + startM.sc.toFixed(3) +
            ' rot=' + startM.rot.toFixed(2) + ' | t1 ty=' + endM.ty.toFixed(2) +
            ' sc=' + endM.sc.toFixed(3) + ' rot=' + endM.rot.toFixed(2));

        // Detach tears the engine down (destroy called, loop inactive) -- no leak.
        const detached = await page.evaluate('window.__rig.detach()');
        assert.ok(detached.destroyed >= 1, 'detach did not call engine.destroy()');
        assert.equal(detached.active, false, 'engine still active after detach -- teardown leaked the frame loop');

        // BREAK CONTROL: mutate the FROM keyframe, re-import as a data module, drive
        // to t=0; the observed matrix must move off the endpoints. A read that
        // cannot fail is decorative.
        const broken = emitRigModule({ moduleFormat: 'esm' }, { translateY: 300, scale: 2, rotate: 40 });
        assert.notEqual(broken, emitted, 'break control did not change the emitted module');
        const brokenM = await page.evaluate(async function (src) {
            const url = 'data:text/javascript;base64,' + btoa(unescape(encodeURIComponent(src)));
            const mod = await import(url);
            const detach = mod.attachScrollRig(document.body);
            const m = await window.__rig.settleAt(0);
            detach();
            return m;
        }, broken);
        const unchanged = Math.abs(brokenM.ty - RIG_ENDPOINTS.start.translateY) < 1.5 &&
            Math.abs(brokenM.sc - RIG_ENDPOINTS.start.scale) < 0.02 &&
            Math.abs(brokenM.rot - RIG_ENDPOINTS.start.rotate) < 0.6;
        assert.ok(!unchanged,
            'BREAK CONTROL FAILED: mutated keyframe produced the same t=0 matrix (ty=' +
            brokenM.ty + ' sc=' + brokenM.sc + ' rot=' + brokenM.rot + ') -- the read is decorative');

        await page.close();
    } finally {
        await browser.close();
        await new Promise(function (r) { server.close(r); });
    }
});

if (SKIP) console.log('[rig-handoff] LITE_NO_BROWSER=1 -- browser lane SKIPPED (node lanes still gate).');
