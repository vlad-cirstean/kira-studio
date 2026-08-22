import type { DataTabRecord, DdlTabRecord, Selection, TabRecord } from '@shared/tabs';
import { reactive, toRaw } from 'vue';
import { control } from '../../bridge/control';
import { decodePath, type NodePath } from '@shared/tree';
import { scheduleTabRead } from './filters';
import type { PageView } from './page';
import type { SourceText } from '@shared/ddl';

// Tab state (P2 D15/D16). A tab's identity is a UUID, never its path; "Open data" focuses an
// existing tab for that path if one exists, while "Open data in new tab" always creates one. Each
// tab owns an independent filter/sort/projection/page state. Persisted state (TabRecord.state) is
// debounced 250 ms into the `tabs` table; runtime state (page, selection, status) never touches
// SQLite.
//
// D22: pageView is deliberately NOT a ref/reactive — pages hold megabytes of typed buffers and
// must never be wrapped in Vue proxies. They live in a separate plain Map keyed by tabId, and the
// store carries only a `pageVersion` counter that DataGrid reads to re-render.

export type TabStatus = 'idle' | 'loading' | 'ready' | 'error' | 'restored';

export interface TabRuntime {
  status: TabStatus;
  /** The server's verbatim error message (D13). */
  error: string | null;
  selection: Selection;
  elapsedMs: number;
  rowsLoaded: number;
  fromCache: boolean;
}

export interface Tab extends DataTabRecord {
  runtime: TabRuntime;
}

// P4 D1/D7: the DDL tab arm. Persisted state is minimal `{ scrollTop, selectedStatement }`; the DDL
// text itself lives in a non-reactive Map keyed by tabId (exactly as the data path holds PageView),
// never in SQLite and never proxied.
export interface DdlTab extends DdlTabRecord {
  runtime: TabRuntime;
}

export type AnyTab = Tab | DdlTab;

export const tabsState = reactive({
  tabs: [] as AnyTab[],
  activeId: null as string | null,
});

// Non-reactive page store (D22): the PageView buffers must NEVER be proxied. The version counter,
// however, is the one reactive number the grid watches — a plain Map would be invisible to Vue.
const pageViews = new Map<string, PageView>();
const pageVersions = reactive(new Map<string, number>());

export function getPage(tabId: string): PageView | null {
  return pageViews.get(tabId) ?? null;
}

export function getPageVersion(tabId: string): number {
  return pageVersions.get(tabId) ?? 0;
}

function bumpVersion(tabId: string): void {
  pageVersions.set(tabId, (pageVersions.get(tabId) ?? 0) + 1);
}

export function setPage(tabId: string, view: PageView | null): void {
  if (view === null) pageViews.delete(tabId);
  else pageViews.set(tabId, view);
  bumpVersion(tabId);
}

// P4 D7: the DDL text store, non-reactive (same discipline as pageViews). Holds SourceText only for
// `ddl` tabs; the persisted tab state never contains the text.
const ddlTexts = new Map<string, SourceText>();

export function getDdlText(tabId: string): SourceText | null {
  return ddlTexts.get(tabId) ?? null;
}

export function setDdlText(tabId: string, source: SourceText | null): void {
  if (source === null) ddlTexts.delete(tabId);
  else ddlTexts.set(tabId, source);
}

export function clearDdlText(tabId: string): void {
  ddlTexts.delete(tabId);
}

export function activeTab(): AnyTab | null {
  if (tabsState.activeId === null) return null;
  return tabsState.tabs.find((t) => t.id === tabsState.activeId) ?? null;
}

// D1: the persisted kind union means a data-path call (load/count/page/prefetch) must only ever see
// a `data` tab. This is the one narrowing helper the data path uses; a ddl tab is never passed here.
export function findDataTab(tabId: string): Tab | null {
  const tab = tabsState.tabs.find((t) => t.id === tabId);
  return tab && tab.kind === 'data' ? tab : null;
}

// ---- persistence ----
let persistTimer: ReturnType<typeof setTimeout> | null = null;
export function schedulePersist(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void persistTabs();
  }, 250);
}

async function persistTabs(): Promise<void> {
  // toRaw: tab.state is a reactive Proxy (tabsState is reactive) and a Proxy cannot cross the IPC
  // structured-clone boundary. Unwrap before sending.
  const records: TabRecord[] = tabsState.tabs.map((t) => {
    const base = {
      id: t.id,
      connectionId: t.connectionId,
      path: t.path,
      order: t.order,
      active: t.id === tabsState.activeId,
    };
    if (t.kind === 'data') return { ...base, kind: 'data' as const, state: toRaw(t.state) };
    return { ...base, kind: 'ddl' as const, state: toRaw(t.state) };
  });
  await control.tabsReplace(records).catch((err) => {
    console.error('[kira:tabs] persist failed', err);
  });
}

// ---- lifecycle ----
function defaultState() {
  return {
    projection: null,
    where: '',
    orderBy: '',
    pageSize: 500,
    cursor: { kind: 'offset' as const, offset: 0 },
    pageIndex: 1,
    totalRows: null,
    totalExact: false,
    columnWidths: {} as Record<string, number>,
    columnOrder: [] as string[],
    scrollTop: 0,
    scrollLeft: 0,
  };
}

export function openData(connectionId: string, path: string, opts?: { newTab?: boolean }): Tab {
  const existing = opts?.newTab
    ? undefined
    : tabsState.tabs.find(
        (t): t is Tab => t.connectionId === connectionId && t.path === path && t.kind === 'data',
      );
  if (existing) {
    activate(existing.id);
    return existing;
  }
  return createDataTab(connectionId, path);
}

// P4 D6: "Open DDL" opens or focuses the `ddl` tab for that path — the same object's DDL never
// opens twice unless the user asks (mirrors D16's focus-vs-new for data tabs).
export function openDdl(connectionId: string, path: string): DdlTab {
  const existing = tabsState.tabs.find(
    (t): t is DdlTab => t.connectionId === connectionId && t.path === path && t.kind === 'ddl',
  );
  if (existing) {
    activate(existing.id);
    return existing;
  }
  return createDdlTab(connectionId, path);
}

export function createDataTab(connectionId: string, path: string): Tab {
  const tab: Tab = {
    id: crypto.randomUUID(),
    connectionId,
    path,
    kind: 'data',
    state: defaultState(),
    order: tabsState.tabs.length,
    active: true,
    runtime: {
      status: 'idle',
      error: null,
      selection: { mode: 'cell', anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } },
      elapsedMs: 0,
      rowsLoaded: 0,
      fromCache: false,
    },
  };
  tabsState.tabs.push(tab);
  tabsState.activeId = tab.id;
  schedulePersist();
  // Fire the initial read (the scheduler no-ops until initDataScheduler runs at bootstrap).
  scheduleTabRead(tab.id);
  return tab;
}

// P4 D7: a ddl tab persists only `{ scrollTop, selectedStatement }`; the SourceText itself is held
// in the non-reactive ddlTexts Map and never touches SQLite.
export function createDdlTab(connectionId: string, path: string): DdlTab {
  const tab: DdlTab = {
    id: crypto.randomUUID(),
    connectionId,
    path,
    kind: 'ddl',
    state: { scrollTop: 0, selectedStatement: null },
    order: tabsState.tabs.length,
    active: true,
    runtime: {
      status: 'idle',
      error: null,
      selection: { mode: 'cell', anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } },
      elapsedMs: 0,
      rowsLoaded: 0,
      fromCache: false,
    },
  };
  tabsState.tabs.push(tab);
  tabsState.activeId = tab.id;
  schedulePersist();
  void loadDdl(tab.id);
  return tab;
}

// P4: fetch the DDL for a tab. A cached hit returns instantly; a miss issues the engine call. The
// text is stored non-reactively (D7); `fromCache` is read off the returned SourceText by DdlView.
export async function loadDdl(tabId: string, opts: { refresh?: boolean } = {}): Promise<void> {
  const tab = tabsState.tabs.find((t): t is DdlTab => t.id === tabId && t.kind === 'ddl');
  if (!tab) return;
  setTabRuntime(tabId, { status: 'loading', error: null });
  try {
    const started = performance.now();
    const result = await control.treeDdl({
      connectionId: tab.connectionId,
      path: tab.path,
      refresh: opts.refresh,
    });
    setDdlText(tabId, result.ddl);
    setTabRuntime(tabId, {
      status: 'ready',
      elapsedMs: Math.round(performance.now() - started),
      fromCache: result.source === 'cache',
    });
  } catch (err) {
    setTabRuntime(tabId, {
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function activate(id: string): void {
  tabsState.activeId = id;
  schedulePersist();
}

export function close(id: string): void {
  const index = tabsState.tabs.findIndex((t) => t.id === id);
  if (index < 0) return;
  tabsState.tabs.splice(index, 1);
  pageViews.delete(id);
  pageVersions.delete(id);
  ddlTexts.delete(id);
  if (tabsState.activeId === id) {
    // The right neighbour activates when available, else the left (D16 behaviour).
    const next = tabsState.tabs[index] ?? tabsState.tabs[index - 1];
    tabsState.activeId = next ? next.id : null;
  }
  schedulePersist();
}

export function closeOthers(id: string): void {
  tabsState.tabs = tabsState.tabs.filter((t) => t.id === id);
  for (const key of pageViews.keys()) if (key !== id) pageViews.delete(key);
  for (const key of ddlTexts.keys()) if (key !== id) ddlTexts.delete(key);
  tabsState.activeId = id;
  schedulePersist();
}

export function closeToRight(id: string): void {
  const index = tabsState.tabs.findIndex((t) => t.id === id);
  if (index < 0) return;
  tabsState.tabs = tabsState.tabs.slice(0, index + 1);
  for (const t of tabsState.tabs) pageViews.delete(t.id);
  for (const t of tabsState.tabs) ddlTexts.delete(t.id);
  schedulePersist();
}

export function duplicate(id: string): Tab | null {
  const src = tabsState.tabs.find((t): t is Tab => t.id === id && t.kind === 'data');
  if (!src) return null;
  const copy: Tab = {
    ...structuredClone(src),
    id: crypto.randomUUID(),
    order: tabsState.tabs.length,
    active: true,
    runtime: {
      status: 'idle',
      error: null,
      selection: { mode: 'cell', anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } },
      elapsedMs: 0,
      rowsLoaded: 0,
      fromCache: false,
    },
  };
  tabsState.tabs.push(copy);
  tabsState.activeId = copy.id;
  schedulePersist();
  scheduleTabRead(copy.id);
  return copy;
}

export function move(id: string, targetIndex: number): void {
  const index = tabsState.tabs.findIndex((t) => t.id === id);
  if (index < 0) return;
  const [tab] = tabsState.tabs.splice(index, 1);
  tabsState.tabs.splice(targetIndex, 0, tab);
  tabsState.tabs.forEach((t, i) => {
    t.order = i;
  });
  schedulePersist();
}

// ---- session restore (D15) ----
export async function hydrateTabs(): Promise<void> {
  const records = await control.tabsGetAll();
  // Every restored tab starts in `restored` status: it renders a Reconnect & load button and logs
  // zero ops until the user presses it (§8.4). Both the `data` and `ddl` arms restore this way (the
  // ddl arm is P4's D7: the text is re-fetched, never persisted).
  tabsState.tabs = records.map((r) => ({
    ...r,
    runtime: {
      status: 'restored',
      error: null,
      selection: { mode: 'cell', anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } },
      elapsedMs: 0,
      rowsLoaded: 0,
      fromCache: false,
    },
  }));
  const active = records.find((r) => r.active);
  tabsState.activeId = active?.id ?? tabsState.tabs[0]?.id ?? null;
}

// ---- misc ----
export function pathTailName(path: string): string {
  const node = decodePath('', path).segments.at(-1);
  return node?.name ?? 'untitled';
}

export function tabPath(tab: AnyTab): NodePath {
  return decodePath(tab.connectionId, tab.path);
}

export function updateTabState(id: string, patch: Partial<Tab['state']>): void {
  const tab = tabsState.tabs.find((t): t is Tab => t.id === id && t.kind === 'data');
  if (!tab) return;
  Object.assign(tab.state, patch);
  schedulePersist();
}

export function updateDdlTabState(id: string, patch: Partial<DdlTab['state']>): void {
  const tab = tabsState.tabs.find((t): t is DdlTab => t.id === id && t.kind === 'ddl');
  if (!tab) return;
  Object.assign(tab.state, patch);
  schedulePersist();
}

export function setTabRuntime(id: string, patch: Partial<TabRuntime>): void {
  const tab = tabsState.tabs.find((t) => t.id === id);
  if (!tab) return;
  Object.assign(tab.runtime, patch);
}

export const pageSizeOptions = [100, 500, 1_000, 5_000] as const;

export function isDataTabKind(kind: AnyTab['kind']): boolean {
  return kind === 'data';
}
