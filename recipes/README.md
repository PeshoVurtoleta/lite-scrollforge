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
| `ease-curve.js` | `@zakkster/lite-ease` | **FULL node runtime**: a bounce easing sampled into a CSS Level 4 `linear(...)` string; the smart mapper routes a preset name and a raw `cubic-bezier(...)` string. |
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
