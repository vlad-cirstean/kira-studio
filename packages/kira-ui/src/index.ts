/** `packages/kira-ui`'s public surface (G19 D3) — `@kira/kira-ui`'s own `./src/index.ts`,
 *  matching every other workspace package's convention.
 *
 *  P131 Part 3 §6: every `Kui*` component except `KuiColumnResizeHandle` (and every helper that
 *  served only them) is gone — git-ui's review view, the last consumer, moved onto shadcn-vue.
 *  What remains: `KuiColumnResizeHandle` (Studio's own consumer, `StreamView.vue`) and
 *  `floatingPosition.ts`'s primitives (workbench's own consumer, `util/floatingPosition.ts`). */

export type { FloatOptions, ReferenceElement } from './floatingPosition.ts';
export { autoUpdate, computeFloatPosition, pointReference } from './floatingPosition.ts';
export { default as KuiColumnResizeHandle } from './KuiColumnResizeHandle.vue';
