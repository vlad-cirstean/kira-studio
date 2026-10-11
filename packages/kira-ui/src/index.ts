/** `packages/kira-ui`'s public surface (G19 D3) — `@kira/kira-ui`'s own `./src/index.ts`,
 *  matching every other workspace package's convention.
 *
 *  P131 Part 3 §6, P264: every `Kui*` component is gone. What remains is
 *  `floatingPosition.ts`'s primitives (workbench's own consumer, `util/floatingPosition.ts`). */

export type { FloatOptions, ReferenceElement } from './floatingPosition.ts';
export { autoUpdate, computeFloatPosition, pointReference } from './floatingPosition.ts';
