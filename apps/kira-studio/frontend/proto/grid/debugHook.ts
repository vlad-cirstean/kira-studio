import cheetahGrid, { type ListGrid } from 'cheetah-grid';
import type { KiraGridProtoHook } from './hookTypes';
import { selectedCols, selectedRows } from './selection';
import { type ProtoState, pageRowOf } from './state';

export interface HookDeps {
  grid: ListGrid<unknown>;
  state: ProtoState;
}

/** Playwright-only. Reached through `if (__KIRA_DEBUG_HOOKS__)` so a release build drops it. */
export function installDebugHook({ state }: HookDeps): void {
  // cheetah-grid-playwright resolves cells through `window.cheetahGrid`, the same module instance
  // the grid was built from.
  (window as unknown as { cheetahGrid: unknown }).cheetahGrid = cheetahGrid;
  const hook: KiraGridProtoHook = {
    recordIndex(pageRow) {
      if (!state.rowOrder) return pageRow < state.data.rowCount ? pageRow : null;
      const at = state.rowOrder.indexOf(pageRow);
      return at < 0 ? null : at;
    },
    pageRow: (recordIndex) => pageRowOf(state, recordIndex),
    selection() {
      const { sel } = state.selection;
      const rows = selectedRows(sel, state.rowCount()).map((r) => pageRowOf(state, r));
      const columns = selectedCols(sel, state.order.length).map(
        (c) => state.data.columns[state.order[c] as number]?.name as string,
      );
      const active = sel && 'row' in sel ? sel : null;
      return {
        kind: sel?.kind ?? null,
        rows,
        columns,
        active: active
          ? {
              row: pageRowOf(state, active.row),
              column: state.data.columns[state.order[active.col] as number]?.name as string,
            }
          : null,
      };
    },
  };
  window.__kiraGridProto = hook;
}
