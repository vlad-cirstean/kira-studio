import { registerTabRuntimeCleanup } from '../../../state/tabRuntime';

// P42 D39: a tab's currently-visible page-row window, reported by whichever view renders it
// (DataGrid.vue's own visiblePageRowBounds watch, VirtualList.vue's visible-range emit) and read
// by that same view's runSearch as the scan's priority window (scan.ts's opts.priority) — the
// rows a search should highlight first, since they're the ones already on screen.
//
// Deliberately NOT views/{grid,console}/page.ts's own setVisibleWindow (F31a): those prune a
// decode cache and are keyed by *page*; this is search priority and keyed by *tab*. A plain object
// (not `reactive`) — nothing here needs to trigger a re-render on its own, it is only ever read at
// the moment a scan starts.
const visibleRows: Record<string, { from: number; to: number }> = {};

export function setVisibleRows(scope: string, from: number, to: number): void {
  visibleRows[scope] = { from, to };
}

export function visibleRowsOf(scope: string): { from: number; to: number } | null {
  return visibleRows[scope] ?? null;
}

function clearVisibleRows(scope: string): void {
  delete visibleRows[scope];
}

registerTabRuntimeCleanup(clearVisibleRows);
