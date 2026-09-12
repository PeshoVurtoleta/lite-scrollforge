// test/Sf2Detach.test.js -- SF2 cold-path guarantees, in their own file so the
// module-global _liveAttachments counter starts pristine (node --test isolates
// each test file in its own process).
//
// Covers what the throwaway probes verified but the committed suite did not:
//   1. Post-detach inline style is BYTE-IDENTICAL to pre-attach on the POLYFILL
//      runtime -- for (a) no prior author inline value and (b) a prior value --
//      exercising both the removeProperty and setProperty restore branches, and
//      asserting a CHANGED value was actually written mid-attach so the
//      byte-identity is not vacuous.
//   2. resetKeyframeCounter fails closed while attached, succeeds detached, and
//      is safe when idle; detach is idempotent -- asserted by reading the live
//      _liveAttachments binding directly (the > 0 guard alone cannot catch an
//      underflow to -1, so doesNotThrow(reset) would NOT prove no-underflow).
//   3. The NATIVE leg (<style> injection) increment/decrement also balances to 0.

import test from 'node:test';
import assert from 'node:assert/strict';
import { attachStoryboardRuntime, resetKeyframeCounter, _liveAttachments } from '../Scrollforge.js';
import { installFakeDom, makeEl, makeInlineStyle } from './fixtures.mjs';

const env = installFakeDom();

const TRACK = {
    selector: '.subj', timeline: { kind: 'view' },
    keyframes: [
        { opacity: 0, '--tint': 0,   translateX: 0,  scale: 1   },
        { opacity: 1, '--tint': 240, translateX: 10, scale: 1.5 }
    ],
    easing: 'linear'
};

test('detach restores pre-attach inline style byte-identical (polyfill) -- no prior author value', () => {
    const el = makeEl('.subj');
    el.style = makeInlineStyle();            // pristine, no author inline props
    const before = el.style.snapshot();      // { props: {}, translate:'', rotate:'', scale:'', transform:'' }

    const handle = attachStoryboardRuntime({ tracks: [TRACK] }, { runtime: 'polyfill' });
    env.fireEnter();                          // unpark + drive an initial frame
    env.fireScroll();
    // Not vacuous: the runtime actually wrote opacity while attached.
    assert.notEqual(el.style.getPropertyValue('opacity'), '',
        'sanity: the runtime wrote opacity while attached (byte-identity below is not vacuous)');
    handle.detach();

    const after = el.style.snapshot();
    assert.deepEqual(after, before,
        'post-detach inline style must be byte-identical to pre-attach (removeProperty branch)');
});

test('detach restores pre-attach inline style byte-identical (polyfill) -- prior author value present', () => {
    const el = makeEl('.subj');
    // Author set inline values BEFORE Scrollforge attached -- restore must return
    // to exactly these, not remove them.
    el.style = makeInlineStyle({
        props: { opacity: '0.3', '--tint': '90' },
        translate: '5px 5px', scale: '2 2'
    });
    const before = el.style.snapshot();
    const priorOpacity = el.style.getPropertyValue('opacity');   // '0.3'

    const handle = attachStoryboardRuntime({ tracks: [TRACK] }, { runtime: 'polyfill' });
    env.fireEnter();
    env.fireScroll();
    // Not vacuous: the runtime wrote a value DIFFERENT from the prior author
    // value while attached, so the byte-identical restore below is meaningful.
    assert.notEqual(el.style.getPropertyValue('opacity'), priorOpacity,
        'sanity: the runtime wrote a changed opacity while attached (differs from the prior author value)');
    handle.detach();

    const after = el.style.snapshot();
    assert.deepEqual(after, before,
        'post-detach inline style must be byte-identical to the prior author values (setProperty branch)');
});

test('resetKeyframeCounter fails closed while attached, succeeds after detach; detach is idempotent', () => {
    makeEl('.subj');

    // Nothing attached in this fresh module -> reset is fine.
    assert.equal(_liveAttachments, 0, 'no attachments at test start');
    assert.doesNotThrow(() => resetKeyframeCounter(), 'reset is allowed with nothing attached');

    const handle = attachStoryboardRuntime({ tracks: [TRACK] }, { runtime: 'polyfill' });
    assert.equal(_liveAttachments, 1, 'a live polyfill attach increments the count');
    assert.throws(() => resetKeyframeCounter(), /cannot reset while/,
        'reset fails closed while a runtime is attached');

    handle.detach();
    assert.equal(_liveAttachments, 0, 'detach returns the count to 0');
    assert.doesNotThrow(() => resetKeyframeCounter(), 'reset succeeds once detached');

    // A second detach must NOT underflow the counter. Asserted on the live
    // binding directly: the > 0 guard would still let a -1 pass doesNotThrow, so
    // only reading the count itself has teeth. (Removing `if (detached) return`
    // in detach would drive this to -1 and fail here.)
    handle.detach();
    assert.equal(_liveAttachments, 0,
        'idempotent detach did not underflow the live-attachment count (must be exactly 0, not -1)');
});

test('native leg: _liveAttachments balances to 0 after <style> injection attach+detach', () => {
    // A faithful minimal native DOM -- exactly the surface attachStoryboard uses:
    // document.createElement('style'), setAttribute, textContent, and a root that
    // tracks parentNode via appendChild/removeChild. Not achievable through
    // installFakeDom (which only stubs querySelector), so built inline here.
    function makeNode() {
        return {
            parentNode: null, children: [], attributes: {}, textContent: '',
            setAttribute(k, v) { this.attributes[k] = v; },
            appendChild(child) { child.parentNode = this; this.children.push(child); },
            removeChild(child) { child.parentNode = null; }
        };
    }
    const head = makeNode();
    const created = [];
    const prevDoc = global.document;
    global.document = {
        head,
        createElement() { const n = makeNode(); created.push(n); return n; },
        querySelector: () => null
    };
    try {
        const before = _liveAttachments;
        const handle = attachStoryboardRuntime({
            tracks: [{ selector: '.n', timeline: { kind: 'view' },
                keyframes: [{ opacity: 0 }, { opacity: 1 }], easing: 'linear' }]
        }, { runtime: 'native' });
        assert.equal(_liveAttachments, before + 1, 'native attach increments the live count');
        assert.equal(created[0].parentNode, head, 'the <style> was appended to the root');

        handle.detach();
        assert.equal(_liveAttachments, before, 'native detach returns the live count');
        assert.equal(created[0].parentNode, null, 'the <style> was removed on detach');

        handle.detach();   // idempotent
        assert.equal(_liveAttachments, before, 'idempotent native detach does not underflow');
    } finally {
        global.document = prevDoc;
    }
});
