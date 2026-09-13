# Recipes

Runnable patterns for wiring `@zakkster/lite-scrollforge` to the wider
ecosystem. Each recipe imports the published package (and, where relevant, a
published peer); the library itself stays zero-dependency.

**`recipes/` never ships.** It is not in `package.json` `files[]` (the pack is
`Scrollforge.js`, `Scrollforge.d.ts`, `README.md`, `llms.txt`, `LICENSE.txt`,
`CHANGELOG.md`). These files, the demo, the tests, and `decisions/` are
repo-only.

| Recipe | Peer(s) | Testing level (in `test/recipes.test.js`) |
| ------ | ------- | ------------------------------------------ |
| `gsap-export.js` | `gsap` (in the emitted output only) | **FULL node runtime**: builds a storyboard, `toGsap` emits ScrollTrigger + Timeline JS, the output is asserted to contain the expected GSAP wiring and to PARSE via `new Function` (CJS form). No gsap runtime needed -- the emitter is pure string emission. |
| `rig-export.js` | `@zakkster/lite-scroll-rig-pro`, `@zakkster/lite-keyframe` (in the emitted output only) | **FULL node runtime**: `toRig` emits rig code asserted to import the rig peers, expose `attachScrollRig`, and PARSE. |
| `ease-curve.js` | `@zakkster/lite-ease` | **FULL node runtime**: a bounce easing sampled into a CSS Level 4 `linear(...)` string; the smart mapper routes a preset name and a raw `cubic-bezier(...)` string. Break control: `linear(48)` must be finer than `linear(6)`. |
| `oklch-sunset.js` | `@zakkster/lite-color-engine` | **FULL node runtime** (headless): sRGB endpoints -> OKLCH buffers -> shortest-path per-stop lerp -> `oklch(...)` strings dropped into a `--sunset` custom-property keyframe; `storyboardToCss` emits it. Break control: identical endpoints collapse the ramp to one stop. |
| `signal-swap.js` | `@zakkster/lite-signal` | **FULL node runtime** (fake-DOM fixtures): a `lite-signal` `effect` attaches a storyboard and registers `onCleanup(detach)`, so a config change detaches-before-reattach and dispose detaches the last one. Break control: a wiring without `onCleanup` leaks (live count grows). |
| `rig-handoff.js` | `@zakkster/lite-scroll-rig-pro`, `@zakkster/lite-keyframe` | **EMIT + PARSE here; FULL EXECUTION in `test:rig-recipe`.** `toRig` emits a rig module asserted to import the peers, stay inside the rig's supported prop set, and parse. The real execution -- running the emitted `KeyframePool` + `DOMScroller` against the *published* rig@1.3.2 in Chromium and reading a real `matrix3d` off the DOM -- lives in `test/browser/rig-handoff.test.mjs`. Break control: mutate the FROM keyframe, the observed `t=0` matrix moves. |
| `react-hook.jsx` | `react` | **SPELLING GATE ONLY** -- asserted ASCII + non-empty, and every symbol imported from `@zakkster/lite-scrollforge` is a real export. NOT executed: JSX will not `node --check`, and running it would tax this package with React purely to prove a sample compiles. |

## The break control

`SCROLLFORGE_RECIPE_BREAK=1 npm test` corrupts the emitted GSAP module before
the parse gate, so the `gsap-export` FULL tier fails closed. A tier that cannot
fail is decorative -- the break proves the parse gate has teeth.

## Why emit, not bundle

Scrollforge authors storyboards and *compiles* them to native CSS, GSAP, or rig
code. The recipes show the compile targets producing runnable output you paste
into a project that already has the target runtime -- Scrollforge never pulls
gsap, the rig, or React into its own dependency tree, in prod or in dev.
