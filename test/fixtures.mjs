// test/fixtures.mjs -- shared fake-DOM plumbing for the headless node lanes.
// NOT a test file (no `.test.js`), so the `test/*.test.js` glob never runs it.
//
// Borrowed shape from the torture harness's inline fakes, factored out so the
// ceilings lane and any future node lane build the same DOM the drive train
// expects without each re-deriving it. Kept dependency-free.
//
// The fake IntersectionObserver is a CLASS on purpose (observe/disconnect on the
// prototype): lite-leak's observer-orphan kernel builds instances via
// Reflect.construct and calls OriginalCtor.prototype.disconnect -- an
// object-literal return has no such method. See test/torture.mjs.

const _elMap = new Map();

// A map-backed inline-style stub that implements the real CSSOM surface the
// drive train and _restoreTrackInlineStyle use: getPropertyValue / setProperty
// / removeProperty for named props (mirrors a real element.style, returning ''
// for an unset prop), plus the individual transform IDL attributes. `initial`
// seeds pre-existing author inline values so a test can assert restore returns
// to them. Byte-comparable via snapshot(): { props, translate, rotate, scale,
// transform }.
export function makeInlineStyle(initial) {
    const props = new Map();
    if (initial && initial.props) {
        for (const k in initial.props) {
            if (Object.prototype.hasOwnProperty.call(initial.props, k)) props.set(k, initial.props[k]);
        }
    }
    return {
        translate: (initial && initial.translate) || '',
        rotate: (initial && initial.rotate) || '',
        scale: (initial && initial.scale) || '',
        transform: (initial && initial.transform) || '',
        getPropertyValue(name) { return props.has(name) ? props.get(name) : ''; },
        setProperty(name, value) { props.set(name, String(value)); },
        removeProperty(name) { props.delete(name); },
        snapshot() {
            const out = {};
            for (const [k, v] of props) out[k] = v;
            return { props: out, translate: this.translate, rotate: this.rotate,
                scale: this.scale, transform: this.transform };
        }
    };
}

// A fake element the drive train can query, measure, and write. Its style is a
// map-backed inline-style stub (see makeInlineStyle) so the restore path is
// exercised for real; pass overrides.style to inject a counting sink instead.
export function makeEl(selector, overrides) {
    const el = Object.assign({
        offsetTop: 400, offsetHeight: 800, offsetParent: null, parentElement: null,
        style: makeInlineStyle()
    }, overrides || {});
    _elMap.set(selector, el);
    return el;
}

// A style sink that counts DOM-boundary writes: one bump per numeric
// (setProperty) write, one per individual transform component write. Mirrors
// the torture harness's countingStyle so the write budget is measured the same.
export function makeCountingStyle() {
    const s = {
        numericStrings: 0, transformStrings: 0,
        _t: '', _s: '', _r: '',
        setProperty() { s.numericStrings++; },
        set translate(v) { s.transformStrings++; s._t = v; }, get translate() { return s._t; },
        set scale(v) { s.transformStrings++; s._s = v; }, get scale() { return s._s; },
        set rotate(v) { s.transformStrings++; s._r = v; }, get rotate() { return s._r; },
        set transform(v) { s.transformStrings++; }, get transform() { return ''; }
    };
    return s;
}

// Install the stable global surface the runtime patches once. Returns a handle
// with the observer/scroll callbacks so a test can fire them, plus reset().
export function installFakeDom() {
    let ioCb = null, scrollCb = null;
    let listenerAdds = 0, listenerRemoves = 0;

    class FakeIntersectionObserver {
        constructor(cb) { ioCb = cb; }
        observe() {}
        unobserve() {}
        disconnect() {}
    }

    global.document = { querySelector: (sel) => _elMap.get(sel) || null };
    global.window = {
        innerHeight: 400, scrollY: 0,
        addEventListener(t, cb) { if (t === 'scroll') { scrollCb = cb; listenerAdds++; } },
        removeEventListener(t) { if (t === 'scroll') { scrollCb = null; listenerRemoves++; } }
    };
    global.requestAnimationFrame = (cb) => { cb(); return 1; };
    global.cancelAnimationFrame = () => {};
    global.IntersectionObserver = FakeIntersectionObserver;
    global.CSS = { supports: () => true };

    return {
        fireEnter() { if (ioCb) ioCb([{ intersectionRatio: 0.5 }]); },
        fireScroll() { if (scrollCb) scrollCb(); },
        get listenerAdds() { return listenerAdds; },
        get listenerRemoves() { return listenerRemoves; },
        reset() { _elMap.clear(); ioCb = null; scrollCb = null; }
    };
}
