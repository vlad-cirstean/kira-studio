import {
  asConsoleTab,
  asDataTab,
  asDocumentTab,
  type ConsoleTabRecord,
  type ConsoleTabState,
  type DataTabRecord,
  type DataTabState,
  type DocumentTabRecord,
  type DocumentTabState,
  defaultConsoleTabState,
  defaultDataTabState,
  defaultDdlTabState,
  defaultDocumentTabState,
  type TabRecord,
} from '@shared/domain/tabs';
import { computed, reactive } from 'vue';
import { control } from '../bridge/control';
import { dropForTab as dropConsoleResultPagesForTab } from '../views/console/resultPages';
import { dropForTab as dropDocumentPagesForTab } from '../views/documents/docPage';
import { dropForTab } from '../views/grid/page';
import { clearPending } from '../views/grid/pendingChanges';
import { clearSelectedCellFor } from './cellSelection';
import { consoleDefaultFor } from './consoleDefaults';
import { settingsState } from './settings';

// Closing a tab must free whichever page store(s) it could have populated (§2.2) — a plain
// no-op lookup miss for the stores a tab's own kind never touches, same discipline as calling
// clearPending/clearSelectedCellFor unconditionally below regardless of tab kind.
function dropAllPagesForTab(id: string): void {
  dropForTab(id);
  dropConsoleResultPagesForTab(id);
  dropDocumentPagesForTab(id);
}

// Cross-view state (§11): tabs are read by the tab strip, the toolbar, the main view and the
// operations panel, none of which may reach into each other — hence renderer/state/, not
// workbench/state/ or views/grid/.
export const tabsState = reactive({
  tabs: [] as TabRecord[], // ordered
  activeId: null as string | null,
  /** In-memory only: a restored tab has not loaded and shows "Reconnect & load" (§8.4). */
  hydrated: new Set<string>(),
});

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function saveNow(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  void control.tabsSave(tabsState.tabs);
}

function saveDebounced(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void control.tabsSave(tabsState.tabs);
  }, 1000);
}

// A pending debounced save is otherwise lost outright if the window closes before its timer
// fires (e.g. a pager/filter/sort change right before quit): main holds `before-quit` until
// every window acks this, so awaiting tabsSave here before acking is what actually makes the
// wait worthwhile — `beforeunload` can't do this, since main tears the renderer down without
// waiting for anything it starts there.
control.onFlushBeforeClose(() => {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  void control.tabsSave(tabsState.tabs).finally(() => control.appFlushed());
});

export async function hydrateTabs(): Promise<void> {
  const tabs = await control.tabsList();
  tabsState.tabs = tabs;
  const active = tabs.find((t) => t.active) ?? tabs[0];
  tabsState.activeId = active?.id ?? null;
  // hydrated stays empty — every restored tab shows Reconnect & load, and restoring never
  // connects anything (§8.4).
}

function deactivateAll(): void {
  for (const t of tabsState.tabs) t.active = false;
}

// Without `newTab`, activates an existing tab for the same (connectionId, path) if one exists
// (§8.10's "Open data"). "Open data in new tab" always creates (`newTab: true`), so the same
// table can be open N times with independent state — identity is `id`, never `path` (§8.4).
export function openDataTab(
  connectionId: string,
  path: string,
  opts?: { newTab?: boolean },
): string {
  if (!opts?.newTab) {
    const existing = tabsState.tabs.find(
      (t) => t.kind === 'data' && t.connectionId === connectionId && t.path === path,
    );
    if (existing) {
      activateTab(existing.id);
      return existing.id;
    }
  }

  const id = crypto.randomUUID();
  const record: TabRecord = {
    id,
    connectionId,
    path,
    kind: 'data',
    state: defaultDataTabState(settingsState.data.defaultPageSize),
    order: tabsState.tabs.length,
    active: true,
  };
  deactivateAll();
  tabsState.tabs.push(record);
  tabsState.activeId = id;
  // Opened from a live connection — nothing to reconnect.
  tabsState.hydrated.add(id);
  saveNow();
  return id;
}

// Opens a 'ddl' tab, reusing an existing one for the same (connectionId, path) — mirrors
// openDataTab's identity rule (§8.4), minus the `newTab` escape hatch: D14 gives DDL no
// "open in new tab" affordance.
export function openDdlTab(connectionId: string, path: string): string {
  const existing = tabsState.tabs.find(
    (t) => t.kind === 'ddl' && t.connectionId === connectionId && t.path === path,
  );
  if (existing) {
    activateTab(existing.id);
    return existing.id;
  }

  const id = crypto.randomUUID();
  const record: TabRecord = {
    id,
    connectionId,
    path,
    kind: 'ddl',
    state: defaultDdlTabState(),
    order: tabsState.tabs.length,
    active: true,
  };
  deactivateAll();
  tabsState.tabs.push(record);
  tabsState.activeId = id;
  tabsState.hydrated.add(id);
  saveNow();
  return id;
}

// Opens a new 'console' tab — always a fresh one, never reused by (connectionId, path): unlike
// data/ddl, a console is a scratch work surface (like a SQL client's "New Query"), so the same
// target routinely wants several independent consoles open at once.
//
// D9: opened at the bare connection root (`path === ''`), a Postgres console has no session-
// level way to redirect itself to a non-primary database — substituting a remembered "Set as
// default" path here, before the path ever reaches the engine, needs no adapter change at all.
export function openConsoleTab(connectionId: string, path: string): string {
  const effectivePath = path === '' ? (consoleDefaultFor(connectionId) ?? path) : path;
  const id = crypto.randomUUID();
  const record: TabRecord = {
    id,
    connectionId,
    path: effectivePath,
    kind: 'console',
    state: defaultConsoleTabState(),
    order: tabsState.tabs.length,
    active: true,
  };
  deactivateAll();
  tabsState.tabs.push(record);
  tabsState.activeId = id;
  tabsState.hydrated.add(id);
  saveNow();
  return id;
}

// Opens a 'document' tab, reusing an existing one for the same (connectionId, path) — mirrors
// openDataTab's identity rule (§8.4); `newTab` opens a fresh one regardless.
export function openDocumentTab(
  connectionId: string,
  path: string,
  opts?: { newTab?: boolean },
): string {
  if (!opts?.newTab) {
    const existing = tabsState.tabs.find(
      (t) => t.kind === 'document' && t.connectionId === connectionId && t.path === path,
    );
    if (existing) {
      activateTab(existing.id);
      return existing.id;
    }
  }

  const id = crypto.randomUUID();
  const record: TabRecord = {
    id,
    connectionId,
    path,
    kind: 'document',
    state: defaultDocumentTabState(),
    order: tabsState.tabs.length,
    active: true,
  };
  deactivateAll();
  tabsState.tabs.push(record);
  tabsState.activeId = id;
  tabsState.hydrated.add(id);
  saveNow();
  return id;
}

// Same target, fresh default state — the cheapest possible demonstration of §8.4's identity rule.
export function duplicateTab(id: string): string {
  const source = tabsState.tabs.find((t) => t.id === id);
  if (!source) return id;

  const newId = crypto.randomUUID();
  let record: TabRecord;
  if (source.kind === 'data') {
    record = {
      id: newId,
      connectionId: source.connectionId,
      path: source.path,
      kind: 'data',
      state: defaultDataTabState(source.state.pageSize),
      order: tabsState.tabs.length,
      active: true,
    };
  } else if (source.kind === 'ddl') {
    record = {
      id: newId,
      connectionId: source.connectionId,
      path: source.path,
      kind: 'ddl',
      state: defaultDdlTabState(),
      order: tabsState.tabs.length,
      active: true,
    };
  } else if (source.kind === 'document') {
    record = {
      id: newId,
      connectionId: source.connectionId,
      path: source.path,
      kind: 'document',
      state: defaultDocumentTabState(),
      order: tabsState.tabs.length,
      active: true,
    };
  } else {
    record = {
      id: newId,
      connectionId: source.connectionId,
      path: source.path,
      kind: 'console',
      state: defaultConsoleTabState(),
      order: tabsState.tabs.length,
      active: true,
    };
  }
  deactivateAll();
  tabsState.tabs.push(record);
  tabsState.activeId = newId;
  tabsState.hydrated.add(newId);
  saveNow();
  return newId;
}

export function closeTab(id: string): void {
  const idx = tabsState.tabs.findIndex((t) => t.id === id);
  if (idx < 0) return;
  const wasActive = tabsState.tabs[idx].active;
  tabsState.tabs.splice(idx, 1);
  tabsState.hydrated.delete(id);
  dropAllPagesForTab(id); // §2.2: closing a tab frees its cached page(s) immediately.
  clearSelectedCellFor(id);
  clearPending(id);

  if (tabsState.tabs.length === 0) {
    tabsState.activeId = null;
  } else if (wasActive) {
    const next = tabsState.tabs[Math.min(idx, tabsState.tabs.length - 1)];
    next.active = true;
    tabsState.activeId = next.id;
  }
  saveNow();
}

export function closeOthers(id: string): void {
  const keep = tabsState.tabs.find((t) => t.id === id);
  if (!keep) return;
  for (const t of tabsState.tabs) {
    if (t.id !== id) {
      tabsState.hydrated.delete(t.id);
      dropAllPagesForTab(t.id);
      clearSelectedCellFor(t.id);
      clearPending(t.id);
    }
  }
  tabsState.tabs = [keep];
  keep.active = true;
  tabsState.activeId = id;
  saveNow();
}

export function closeToTheRight(id: string): void {
  const idx = tabsState.tabs.findIndex((t) => t.id === id);
  if (idx < 0) return;
  for (const t of tabsState.tabs.slice(idx + 1)) {
    tabsState.hydrated.delete(t.id);
    dropAllPagesForTab(t.id);
    clearSelectedCellFor(t.id);
    clearPending(t.id);
  }
  tabsState.tabs = tabsState.tabs.slice(0, idx + 1);
  if (!tabsState.tabs.some((t) => t.active)) {
    tabsState.tabs[idx].active = true;
    tabsState.activeId = id;
  }
  saveNow();
}

export function closeAll(): void {
  for (const t of tabsState.tabs) {
    tabsState.hydrated.delete(t.id);
    dropAllPagesForTab(t.id);
    clearSelectedCellFor(t.id);
    clearPending(t.id);
  }
  tabsState.tabs = [];
  tabsState.activeId = null;
  saveNow();
}

export function activateTab(id: string): void {
  const target = tabsState.tabs.find((t) => t.id === id);
  if (!target) return;
  for (const t of tabsState.tabs) t.active = t.id === id;
  tabsState.activeId = id;
  saveNow();
}

// D11: Control+Tab / Control+Shift+Tab — wraps around at either end, matching the tab strip's
// own left-to-right visual order (`tabsState.tabs` is already kept in that order).
function stepTab(delta: 1 | -1): void {
  const tabs = tabsState.tabs;
  if (tabs.length === 0) return;
  const idx = tabs.findIndex((t) => t.id === tabsState.activeId);
  const next = tabs[(idx + delta + tabs.length) % tabs.length];
  activateTab(next.id);
}

export function activateNextTab(): void {
  stepTab(1);
}

export function activatePrevTab(): void {
  stepTab(-1);
}

export function patchDataTabState(id: string, patch: Partial<DataTabState>): void {
  const target = tabsState.tabs.find((t) => t.id === id);
  if (target?.kind !== 'data') return;
  Object.assign(target.state, patch);
  saveDebounced();
}

export function patchConsoleTabState(id: string, patch: Partial<ConsoleTabState>): void {
  const target = tabsState.tabs.find((t) => t.id === id);
  if (target?.kind !== 'console') return;
  Object.assign(target.state, patch);
  saveDebounced();
}

export function patchDocumentTabState(id: string, patch: Partial<DocumentTabState>): void {
  const target = tabsState.tabs.find((t) => t.id === id);
  if (target?.kind !== 'document') return;
  Object.assign(target.state, patch);
  saveDebounced();
}

export function markHydrated(id: string): void {
  tabsState.hydrated.add(id);
}

// A read that comes back E_NOT_FOUND/E_ENGINE_DOWN/E_CONNECT means the adapter is gone —
// flip the tab back to the Reconnect & load affordance rather than showing a red error
// (views/grid/state.ts's load()).
export function unmarkHydrated(id: string): void {
  tabsState.hydrated.delete(id);
}

export function isHydrated(id: string): boolean {
  return tabsState.hydrated.has(id);
}

export const activeTab = computed<TabRecord | null>(
  () => tabsState.tabs.find((t) => t.id === tabsState.activeId) ?? null,
);

export function findDataTab(id: string): DataTabRecord | null {
  return asDataTab(tabsState.tabs.find((t) => t.id === id));
}

export function findConsoleTab(id: string): ConsoleTabRecord | null {
  return asConsoleTab(tabsState.tabs.find((t) => t.id === id));
}

export function findDocumentTab(id: string): DocumentTabRecord | null {
  return asDocumentTab(tabsState.tabs.find((t) => t.id === id));
}

export const activeDataTab = computed<DataTabRecord | null>(() => asDataTab(activeTab.value));
