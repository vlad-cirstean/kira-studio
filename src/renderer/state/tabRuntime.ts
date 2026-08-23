// D4: a leaf cleanup registry breaking the cycle every view state module would otherwise create —
// each of `views/{grid,console,ddl,documents,keyvalue,stream}/state.ts` (plus `views/grid/search.ts`)
// imports `state/tabs.ts` (reality 18), so `state/tabs.ts` importing them back for their per-tab
// cleanup would be a module cycle. A view kind whose module was never loaded has nothing
// registered here, which is correct: it also never created a per-tab runtime record.
const cleanups = new Set<(tabId: string) => void>();

export function registerTabRuntimeCleanup(fn: (tabId: string) => void): void {
  cleanups.add(fn);
}

export function cleanupTabRuntime(tabId: string): void {
  for (const fn of cleanups) fn(tabId);
}
