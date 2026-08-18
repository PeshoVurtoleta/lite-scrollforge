// test/browser/runner.mjs
//
// runScenarios -- the LIFTABLE SEAM.
// =================================================================
// Package-agnostic Playwright driver for scroll-parity harnesses. NOTHING in
// this file's signature or body is lite-scrollforge specific: it launches a
// real Chromium, opens one fresh page per scenario, lets the CALLER instrument
// the page (`inject`), lets each SCENARIO scripted-scroll and read computed
// styles (`run`), then lets the caller read a JSON snapshot (`collect`).
//
// SEAM CONTRACT
// -------------
// runScenarios({ pageUrl, inject, scenarios, collect, options }) -> Promise<Result[]>
//
//   pageUrl   string  navigated before instrumentation. 'about:blank' is valid;
//                     the caller builds the DOM in `inject` / per scenario.
//   inject    async (page, ctx) => void  runs ONCE per scenario after nav.
//   scenarios Array<{ name, run: async (ctx) => void }>  drive scroll + settle.
//   collect   async (page, ctx) => any   structured-clonable snapshot.
//   options   { headless?, viewport?, onLog?, requireSupport? }
//             requireSupport: a CSS.supports() query string asserted in-page
//             before any scenario runs. FAIL-CLOSED: if the installed Chromium
//             does not support it, the whole run throws loudly -- a faked oracle
//             is worse than no oracle. Skipping is the CALLER's choice, upstream.
//
// ctx (handed to inject, run, collect) -- generic browser primitives only:
//   ctx.page              Playwright Page.
//   ctx.cdp               Attached CDP session.
//   ctx.scrollWin(y)      window.scrollTo(0, y), then one painted frame.
//   ctx.scrollEl(sel, y)  set element.scrollTop = y, then one painted frame.
//   ctx.frame()           Await two rAFs (one painted frame boundary).
//   ctx.wait(ms)          Await ms of wall time in the page.
//   ctx.eval(fn, ...args) page.evaluate passthrough.
//   ctx.log(s)            options.onLog passthrough.
//
// The caller owns Playwright/CDP semantics; this seam owns nothing domain
// specific. Do not add a scrollforge import here.
// =================================================================

import { chromium } from 'playwright';

export async function runScenarios(config) {
    const pageUrl = config.pageUrl || 'about:blank';
    const inject = config.inject;
    const scenarios = config.scenarios || [];
    const collect = config.collect;
    const options = config.options || {};
    const headless = options.headless !== false;
    const viewport = options.viewport || { width: 800, height: 600 };
    const requireSupport = options.requireSupport || null;
    const onLog = typeof options.onLog === 'function' ? options.onLog : function () {};

    if (typeof inject !== 'function') throw new Error('runScenarios: inject must be a function');
    if (typeof collect !== 'function') throw new Error('runScenarios: collect must be a function');

    const browser = await chromium.launch({ headless: headless });
    const results = [];
    try {
        for (let i = 0; i < scenarios.length; i++) {
            const scenario = scenarios[i];
            const page = await browser.newPage({ viewport: viewport });
            const cdp = await page.context().newCDPSession(page);
            const ctx = makeCtx(page, cdp, onLog);

            await page.goto(pageUrl);

            if (requireSupport) {
                const supported = await page.evaluate(function (q) {
                    return typeof CSS !== 'undefined' && CSS.supports(q);
                }, requireSupport);
                if (!supported) {
                    await browser.close();
                    throw new Error(
                        'runScenarios: this Chromium does NOT support `' + requireSupport +
                        '` -- the parity oracle needs native scroll-driven animation. ' +
                        'A faked oracle is worse than no oracle; refusing to run. ' +
                        '(Set LITE_NO_BROWSER=1 upstream to skip the browser lane loudly.)');
                }
            }

            await inject(page, ctx);
            onLog('scenario ' + scenario.name + ': injected');
            await scenario.run(ctx);
            const snapshot = await collect(page, ctx);
            onLog('scenario ' + scenario.name + ': collected');
            results.push({ name: scenario.name, snapshot: snapshot });

            await cdp.detach().catch(function () {});
            await page.close();
        }
    } finally {
        await browser.close();
    }
    return results;
}

function makeCtx(page, cdp, onLog) {
    function frame() {
        return page.evaluate(function () {
            return new Promise(function (r) {
                requestAnimationFrame(function () { requestAnimationFrame(function () { r(); }); });
            });
        });
    }
    async function scrollWin(y) {
        await page.evaluate(function (yy) { window.scrollTo(0, yy); }, y);
        await frame();
    }
    async function scrollEl(sel, y) {
        await page.evaluate(function (arg) {
            const el = document.querySelector(arg.sel);
            if (el) el.scrollTop = arg.y;
        }, { sel: sel, y: y });
        await frame();
    }
    function wait(ms) {
        return page.evaluate(function (m) {
            return new Promise(function (r) { setTimeout(r, m); });
        }, ms);
    }
    return {
        page: page,
        cdp: cdp,
        scrollWin: scrollWin,
        scrollEl: scrollEl,
        frame: frame,
        wait: wait,
        eval: function (fn) {
            const args = Array.prototype.slice.call(arguments, 1);
            return page.evaluate(fn, ...args);
        },
        log: onLog
    };
}
