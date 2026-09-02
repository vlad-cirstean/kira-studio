import { type PredrawCommit, type PredrawOptions, RegularTableElement } from 'regular-table';

export const KIRA_REGULAR_TABLE_TAG = 'kira-regular-table';

/**
 * The trailing runway, in px, read fresh from `window.__kiraGridTuning.regularRunwayPx` on every
 * scroll-driven render — a console-set knob, exactly like `maxLeadPxOverride` is for the incumbent
 * grid, so the real-Mac A/B needs one build rather than one per variant. Default 0.
 *
 * **regular-table draws the visible viewport and nothing else** — measured: 28 rows in a 960px
 * window at 28px, so a runway of literally zero. That is smaller than SlickGrid's default (which
 * the SlickGrid plan's F4 already called decisive against it) and far smaller than this app's own
 * velocity-adaptive 560-2400px budget, so it is the single most likely way this engine could lose
 * the A/B for reasons that have nothing to do with how cheaply it renders.
 *
 * Inflating **both** the clip height and the container height by the same amount is what buys a
 * runway without distorting the scroll mapping. Working from `_calculate_row_range`
 * (scroll_panel.ts) with one header level:
 *
 *     total_scroll_height  = nrows·h + h − containerHeight
 *     clip_panel_rows      = height/h − 1
 *     scrollable_rows      = nrows − clip_panel_rows
 *     start_row            = scrollable_rows · scrollTop / total_scroll_height
 *
 * Adding R to both `height` and `containerHeight` leaves `scrollable_rows = total_scroll_height/h`,
 * so `start_row` stays exactly `scrollTop/h` — and `clamped_scroll_top`'s own ceiling moves down by
 * the same R, which is what keeps the final row reachable. The extra rows render past the bottom of
 * the `contain: strict` clip and are simply not painted. It is a *trailing* runway only: nothing in
 * this seam can extend the window upwards, which is a real asymmetry to keep in mind when reading
 * an upward-fling trace.
 *
 * The cancellation is exact only where the two height inputs agree; in practice the clip's
 * `clientHeight` and the element's differ by a scrollbar gutter, which leaves a sub-row residual
 * that can move the first rendered row by one across a `floor()` when the runway is toggled
 * (regular-table.spec.ts asserts exactly that bound). Harmless for an A/B; worth knowing before
 * reading a trace as if the two variants were pixel-aligned.
 */
function runwayPx(): number {
  const px = window.__kiraGridTuning?.regularRunwayPx;
  return typeof px === 'number' && px > 0 ? px : 0;
}

/**
 * P22 regular-table spike — `<regular-table>` plus one measurement seam.
 *
 * The library's scroll path is `_on_scroll` -> `predraw(...)` -> `await rAF` -> `commit()`
 * (events.ts:60-96): the data fetch and viewport arithmetic happen asynchronously, and the
 * returned closure applies the whole render to the DOM **synchronously**, inside an animation
 * frame. That closure is therefore the exact analogue of the incumbent grid's `renderMs` — the
 * main-thread work a momentum scroll has to fit inside one frame — so wrapping it here is the only
 * place a comparable number can be taken. Timing `draw()` instead would measure the awaits too.
 *
 * `commit.inline` is regular-table's own signal that it could not plan the render and fell back to
 * drawing inline (the closure is then a no-op), so those are passed through untimed rather than
 * reported as a suspiciously fast frame.
 */
export class KiraRegularTable extends RegularTableElement {
  /** Set by RegularTableHost.vue; called with the synchronous commit's own duration in ms. */
  onCommit: ((durationMs: number) => void) | null = null;

  override async predraw(
    width: number,
    height: number,
    options?: PredrawOptions,
  ): Promise<PredrawCommit> {
    const runway = runwayPx();
    const commit = await super.predraw(
      width,
      height + runway,
      runway
        ? { ...options, container_height: (options?.container_height ?? height) + runway }
        : options,
    );
    const report = this.onCommit;
    if (commit.inline || !report) return commit;
    const timed = (): boolean => {
      const started = performance.now();
      try {
        return commit();
      } finally {
        report(performance.now() - started);
      }
    };
    return Object.assign(timed, { inline: commit.inline });
  }
}

if (!customElements.get(KIRA_REGULAR_TABLE_TAG)) {
  customElements.define(KIRA_REGULAR_TABLE_TAG, KiraRegularTable);
}
