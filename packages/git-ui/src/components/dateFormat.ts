/**
 * The date column's two renderings (`docs/plans/P4.md` W6, §6.2: "clicking toggles relative/
 * absolute for every row and persists"). P62 D2: `formatRelativeDate`/`formatAbsoluteDate`
 * themselves moved to `@kira/git-core/src/util/dateFormat.ts` (no DOM dependency, and already
 * eager in every host that needs them) — re-exported here so this package's own existing importers
 * (`CommitGrid.vue`, `columns.ts`, `ReviewCommitRow.vue`) need no change. `measureAbsoluteDateWidth`
 * stays: it is canvas measurement, DOM-bound, and git-core has none.
 */
import { formatAbsoluteDate, formatRelativeDate } from '@kira/git-core';

export { formatAbsoluteDate, formatRelativeDate };

/** G21 D6b: a representative widest sample `formatAbsoluteDate` can produce — the format's own
 *  shape ("YYYY-MM-DD HH:MM") never varies in length, and `.kv-cell-date`'s own
 *  `font-variant-numeric: tabular-nums` makes which digits appear irrelevant to the rendered
 *  width, so any one concrete timestamp is as "widest" as any other. `Date.UTC` rather than a
 *  hand-computed epoch, so the sample string is legible directly from this file. */
const WIDEST_SAMPLE_TIMESTAMP = Date.UTC(2024, 11, 30, 22, 48) / 1000;

let measureCanvas: HTMLCanvasElement | OffscreenCanvas | undefined;

/**
 * The pixel width of the widest string `formatAbsoluteDate` can produce, rendered in `font` (a
 * CSS font shorthand — `CommitGrid.vue` reads this from a live `.kv-cell-date` probe's own
 * computed style). Item 6's second gap (F6): a hard-coded pixel width is only correct at one
 * font size, and G14 already made the type scale follow VS Code's own settings, so this measures
 * rather than assumes.
 *
 * Bun's own test environment has no DOM — no `document`, no `OffscreenCanvas` (the same reason
 * `rowSvg.ts`'s DOM-construction half is exercised only by the Playwright tier, not here) — so
 * this returns `0` there rather than throwing; `CommitGrid.vue`'s own `Math.max(152, …)` floor
 * means a `0` measurement changes nothing, and the real measurement is covered by
 * `graph-columns.spec.ts`.
 */
export function measureAbsoluteDateWidth(font: string): number {
  if (typeof document === 'undefined' && typeof OffscreenCanvas === 'undefined') return 0;
  if (!measureCanvas) {
    measureCanvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(1, 1)
        : document.createElement('canvas');
  }
  // `HTMLCanvasElement | OffscreenCanvas`'s own `getContext('2d')` overloads don't unify cleanly
  // across the union (TS falls back to a generic `RenderingContext`, which lacks `font`/
  // `measureText`) — both real return types share the same 2D-context shape this function
  // actually uses, so the cast is asserting a real shared interface, not papering over a
  // mismatch.
  const ctx = measureCanvas.getContext('2d') as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) return 0;
  ctx.font = font;
  return ctx.measureText(formatAbsoluteDate(WIDEST_SAMPLE_TIMESTAMP)).width;
}
