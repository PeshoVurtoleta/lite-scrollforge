// recipes/react-hook.jsx -- a React hook wrapping the polyfill runtime.
//
// Never ships (repo-only; not in package.json files[]). See recipes/README.md.
// SPELLING GATE ONLY: test/recipes.test.js asserts this file is ASCII and that
// every symbol it imports from @zakkster/lite-scrollforge is a real export. It
// is NOT executed -- JSX will not `node --check`, and running it would pull
// React into this zero-dependency package purely to prove a sample compiles.

import { useEffect, useRef } from 'react';
import { attachStoryboardRuntime } from '@zakkster/lite-scrollforge';

// Attach a storyboard for the lifetime of the component; detach on unmount.
// attachStoryboardRuntime auto-detects native support and falls back to the
// zero-GC polyfill.
export function useScrollforge(storyboard) {
    const rootRef = useRef(null);

    useEffect(function () {
        const handle = attachStoryboardRuntime(storyboard, { root: rootRef.current });
        return function () { handle.detach(); };
    }, [storyboard]);

    return rootRef;
}
