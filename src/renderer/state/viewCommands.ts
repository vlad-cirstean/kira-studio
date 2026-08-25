import type { SortSpec } from '@shared/domain/queries';

// P39 iter3 D5/D6: the leaf-registry inversion state/tabRuntime.ts already uses, applied to the six
// project/ -> views/ edges (ProjectTree.vue's four reload imports, menus.ts's runCount/
// runDocumentCount/setFilter/setProjection/setSort). Registration happens at module scope in each
// view's own state.ts, and every one of those modules is reached by a chain of static imports from
// main.ts (main.ts -> App.vue -> WorkbenchShell.vue -> MainView.vue -> each view's *View.vue ->
// ./state), so the registry is populated before the first render — unlike shortcuts/commands.ts's
// deliberate no-op (mount-scoped, legitimately empty), an unregistered kind here can only mean that
// static import chain broke, so the accessors below throw rather than silently doing nothing.
export type CommandTabKind = 'data' | 'document' | 'keyvalue' | 'stream';

const reloaders = new Map<CommandTabKind, (tabId: string) => Promise<void>>();

export function registerTabReload(
  kind: CommandTabKind,
  fn: (tabId: string) => Promise<void>,
): void {
  reloaders.set(kind, fn);
}

/** Fire-and-forget, matching today's `void reload*Tab(id)` call sites exactly. */
export function reloadTab(kind: CommandTabKind, tabId: string): void {
  const fn = reloaders.get(kind);
  if (!fn) throw new Error(`viewCommands: no reload registered for tab kind "${kind}"`);
  void fn(tabId);
}

type CountableKind = 'data' | 'document';

const counters = new Map<CountableKind, (tabId: string) => Promise<void>>();

// Only the data and document views have a row/document count reachable from the tree menu.
export function registerTabCount(kind: CountableKind, fn: (tabId: string) => Promise<void>): void {
  counters.set(kind, fn);
}

export function countTab(kind: CountableKind, tabId: string): void {
  const fn = counters.get(kind);
  if (!fn) throw new Error(`viewCommands: no count registered for tab kind "${kind}"`);
  void fn(tabId);
}

// The three views/grid/state.ts operations reached from outside the grid module: project/menus.ts's
// saved-filter items, and the column-menu's Add-to-projection / Sort-by items.
export interface DataQueryCommands {
  setFilter(tabId: string, filter: string | null): Promise<void>;
  setSort(tabId: string, sort: SortSpec | null): Promise<void>;
  setProjection(tabId: string, projection: string[] | null): Promise<void>;
}

let dataQueryCmds: DataQueryCommands | null = null;

export function registerDataQueryCommands(cmds: DataQueryCommands): void {
  dataQueryCmds = cmds;
}

export function dataQueryCommands(): DataQueryCommands {
  if (!dataQueryCmds) throw new Error('viewCommands: data query commands were never registered');
  return dataQueryCmds;
}
