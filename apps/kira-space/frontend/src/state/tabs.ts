import {
  defaultRepoGraphTabState,
  type RepoFileTabState,
  type RepoGraphTabState,
  type TabRecord,
} from '@shared/domain/tabs';
import { useDebounceFn } from '@vueuse/core';
import { defineStore } from 'pinia';
import { reactive, toRefs } from 'vue';
import { control } from '../bridge/control';
import { type SpaceTabKind, TAB_KINDS } from './tabKinds';
import { cleanupTabRuntime } from './tabRuntime';
import { GENERAL_WORKSPACE, useWorkspaceStore, type WorkspaceKey } from './workspace';

// TAB_KINDS (state/tabKinds.ts) is total over SpaceTabKind, this app's own five kinds — narrower
// than the shared TabKind union above, which still carries every DB-client kind Kira Studio keeps.
// This app's TabsService.Save/List only ever round-trips a SpaceTabKind row (the Go side has no
// other kind to write), so indexing TAB_KINDS by a TabRecord's own `.kind` is always safe; this
// one cast documents that trust boundary once instead of at each call site (rpc.ts's own `trust`
// precedent).
function kindDef(tab: Pick<TabRecord, 'kind'>) {
  return TAB_KINDS[tab.kind as SpaceTabKind];
}

// P100 Part 2: Kira Studio's own state/tabs.ts (state/tabs.ts, pre-Part-2), trimmed to this app's
// own five kinds (repo-graph/repo-file/repo-diff/repo-multi-diff/terminal) — every DB-client tab
// kind (data/console/definition/document/keyvalue/stream/browse), the incognito filter
// (state/tabIncognito.ts, never ported — a Studio-only privacy feature) and the connection-loss
// reconnect gate (`hydrated`/markHydrated/isHydrated, engine-cache-specific) all have no
// equivalent here: a repo tab has no live connection to lose, and a terminal tab is never
// persisted (persistableTabs below), so nothing in this app ever needs a "Reconnect & load" state.
// `workspaceKeyOf`/`tabsForWorkspace` (state/mode.ts there) live here instead, since this app has
// no separate mode dispatch to house them in.

// A tab's own workspace: its `workspaceId` when a repo (or a scoped terminal) set one, else the
// one shared slot for a fully-unscoped terminal tab — see state/workspace.ts's own header comment
// for why there is exactly one non-repo slot here.
function workspaceKeyOf(tab: TabRecord): WorkspaceKey {
  return tab.workspaceId ?? GENERAL_WORKSPACE;
}

/** Every tab in workspace `key` — pinned-kind tabs first (in their existing relative order), then
 *  the rest, regardless of where each sits in `tabsState.tabs`. Two-pass filter/concat, not a
 *  comparator sort — a sort's stability is not a property to lean on here (Kira Studio's own
 *  tabsForWorkspace, state/mode.ts). */
export function tabsForWorkspace(key: WorkspaceKey): TabRecord[] {
  const pinned: TabRecord[] = [];
  const rest: TabRecord[] = [];
  for (const t of useTabsStore().tabs) {
    if (workspaceKeyOf(t) !== key) continue;
    (kindDef(t).pinned ? pinned : rest).push(t);
  }
  return [...pinned, ...rest];
}

export interface OpenTabResult {
  id: string;
  reused: boolean;
}

export const useTabsStore = defineStore('tabs', () => {
  function dropPageStoresForTab(id: string): void {
    for (const kind of Object.keys(TAB_KINDS) as SpaceTabKind[]) {
      TAB_KINDS[kind].dropResources(id);
    }
  }

  function dropAllPagesForTab(id: string): void {
    dropPageStoresForTab(id);
    cleanupTabRuntime(id);
  }

  const tabsState = reactive({
    tabs: [] as TabRecord[], // ordered, all workspaces interleaved
    activeIdByWorkspace: {} as Record<WorkspaceKey, string | null>,
    previewIdsByWorkspace: {} as Record<WorkspaceKey, readonly string[]>,
  });

  let lastSavedSnapshot: string | null = null;
  let pendingSnapshot: string | null = null;

  // A terminal tab's whole content is a live process — a restored row would be an empty terminal
  // wired to a PTY that died with the last run, so it is never persisted (Kira Studio's own rule,
  // state/tabs.ts).
  function persistableTabs(): TabRecord[] {
    return tabsState.tabs.filter((t) => t.kind !== 'terminal');
  }

  function saveIfChanged(): void {
    const snapshot = JSON.stringify(persistableTabs());
    if (snapshot === lastSavedSnapshot || snapshot === pendingSnapshot) return;
    pendingSnapshot = snapshot;
    void control
      .tabsSave(JSON.parse(snapshot) as TabRecord[])
      .then(
        () => {
          lastSavedSnapshot = snapshot;
        },
        () => {},
      )
      .finally(() => {
        if (pendingSnapshot === snapshot) pendingSnapshot = null;
      });
  }

  const saveDebounced = useDebounceFn(saveIfChanged, 1000);

  function saveNow(): void {
    saveDebounced.cancel();
    saveIfChanged();
  }

  function flushPendingTabState(ack: () => void): void {
    saveDebounced.cancel();
    void control.tabsSave(persistableTabs()).finally(ack);
  }

  control.onFlushBeforeClose(() => flushPendingTabState(control.appFlushed));
  control.onWindowFlushBeforeClose(() => flushPendingTabState(control.windowFlushed));

  async function hydrateTabs(): Promise<void> {
    const raw = await control.tabsList();
    const tabs = raw.map((t) => {
      const parsed = kindDef(t).parseState(t.state);
      return parsed ? ({ ...t, state: parsed } as TabRecord) : t;
    });
    tabsState.tabs = tabs;

    const keys = new Set<WorkspaceKey>();
    for (const t of tabs) keys.add(workspaceKeyOf(t));
    for (const key of keys) {
      const keyTabs = tabs.filter((t) => workspaceKeyOf(t) === key);
      const active = keyTabs.find((t) => t.active) ?? keyTabs[0];
      tabsState.activeIdByWorkspace[key] = active?.id ?? null;
    }

    const openRepos: string[] = [];
    for (const t of tabs) {
      const key = workspaceKeyOf(t);
      if (key === GENERAL_WORKSPACE) continue;
      if (!openRepos.includes(key)) openRepos.push(key);
    }
    // state/workspace.ts imports closeWorkspaceTabs from this file, a two-way call graph — not a
    // cycle, since neither side reads the other at module-evaluation time, only inside a function
    // body called after both modules have finished loading (Pinia's own store registry resolves
    // useWorkspaceStore() lazily regardless).
    useWorkspaceStore().openRepos = openRepos;
  }

  function setActiveTabId(id: string, key: WorkspaceKey): void {
    for (const t of tabsState.tabs) {
      if (workspaceKeyOf(t) === key) t.active = t.id === id;
    }
    tabsState.activeIdByWorkspace[key] = id;
  }

  function removeFromPreviewCohort(key: WorkspaceKey, id: string): void {
    const cohort = tabsState.previewIdsByWorkspace[key];
    if (!cohort?.includes(id)) return;
    tabsState.previewIdsByWorkspace[key] = cohort.filter((x) => x !== id);
  }

  function evictPreviewCohort(key: WorkspaceKey, keepId?: string): void {
    const cohort = tabsState.previewIdsByWorkspace[key] ?? [];
    for (const id of cohort) {
      if (id !== keepId) closeTabInternal(id);
    }
    tabsState.previewIdsByWorkspace[key] = keepId ? [keepId] : [];
  }

  interface OpenTabOpts {
    reuse: boolean;
    workspaceId?: string | null;
    preview?: boolean;
    previewCohort?: boolean;
  }

  function reuseExistingTab(
    kind: TabRecord['kind'],
    connectionId: string | null,
    path: string,
    workspaceId: string | null,
    workspaceKey: WorkspaceKey,
    opts: OpenTabOpts,
  ): OpenTabResult | null {
    if (!opts.reuse) return null;
    const existing = tabsState.tabs.find(
      (t) =>
        t.kind === kind &&
        t.connectionId === connectionId &&
        t.path === path &&
        (t.workspaceId ?? null) === workspaceId,
    );
    if (!existing) return null;
    activateTab(existing.id);
    if (!opts.preview) removeFromPreviewCohort(workspaceKey, existing.id);
    return { id: existing.id, reused: true };
  }

  function insertNewTabRecord(
    record: TabRecord,
    workspaceKey: WorkspaceKey,
    opts: OpenTabOpts,
  ): void {
    if (opts.preview && opts.previewCohort) {
      tabsState.tabs.push(record);
      tabsState.previewIdsByWorkspace[workspaceKey] = [
        ...(tabsState.previewIdsByWorkspace[workspaceKey] ?? []),
        record.id,
      ];
      return;
    }
    if (!opts.preview) {
      tabsState.tabs.push(record);
      return;
    }
    const evictedIds = tabsState.previewIdsByWorkspace[workspaceKey] ?? [];
    if (evictedIds.length > 0) {
      const evictedIdx = tabsState.tabs.findIndex((t) => t.id === evictedIds[0]);
      const insertAt = evictedIdx < 0 ? tabsState.tabs.length : evictedIdx;
      tabsState.tabs.splice(insertAt, 0, record);
      evictPreviewCohort(workspaceKey);
    } else {
      tabsState.tabs.push(record);
    }
    tabsState.previewIdsByWorkspace[workspaceKey] = [record.id];
  }

  function openTab<S>(
    kind: TabRecord['kind'],
    connectionId: string | null,
    path: string,
    makeState: () => S,
    opts: OpenTabOpts,
  ): OpenTabResult {
    const workspaceId = opts.workspaceId ?? null;
    const workspaceKey = workspaceId ?? GENERAL_WORKSPACE;

    const reused = reuseExistingTab(kind, connectionId, path, workspaceId, workspaceKey, opts);
    if (reused) return reused;

    const id = crypto.randomUUID();
    const record = {
      id,
      connectionId,
      path,
      kind,
      state: makeState(),
      order: tabsState.tabs.length,
      active: true,
      workspaceId,
    } as unknown as TabRecord;

    insertNewTabRecord(record, workspaceKey, opts);
    setActiveTabId(id, workspaceKey);
    saveNow();
    return { id, reused: false };
  }

  // Creates workspace `workspaceId`'s pinned graph tab — a plain push that never activates it
  // (unlike openTab's own always-active-on-create behavior), so ensureWorkspaceShell
  // (state/repoTabs.ts) can decide separately whether to activate it (only when the workspace has
  // no active tab at all) — a restored session's own active tab must never be stolen by shell
  // creation.
  function createPinnedRepoGraphTab(workspaceId: string): TabRecord {
    const id = crypto.randomUUID();
    const record = {
      id,
      connectionId: null,
      // A repo-graph tab has no file behind it, but `path` is a required column and an empty one
      // aborts the whole window's tab save, not just this row — the workspace key is this tab's
      // real identity, stable and unique per workspace.
      path: workspaceId,
      kind: 'repo-graph',
      state: defaultRepoGraphTabState(),
      order: tabsState.tabs.length,
      active: false,
      workspaceId,
    } as unknown as TabRecord;
    tabsState.tabs.push(record);
    saveNow();
    return record;
  }

  function duplicateTab(id: string): string {
    const source = tabsState.tabs.find((t) => t.id === id);
    if (!source) return id;
    if (kindDef(source).pinned) return id;

    const newId = crypto.randomUUID();
    const def = kindDef(source);
    const record = {
      id: newId,
      connectionId: source.connectionId,
      path: source.path,
      kind: source.kind,
      state: (def.duplicateState as (tab: TabRecord) => TabRecord['state'])(source),
      order: tabsState.tabs.length,
      active: true,
      workspaceId: source.workspaceId ?? null,
    } as unknown as TabRecord;
    tabsState.tabs.push(record);
    setActiveTabId(newId, workspaceKeyOf(source));
    saveNow();
    return newId;
  }

  function closeTabInternal(id: string): void {
    const idx = tabsState.tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const closed = tabsState.tabs[idx];
    if (kindDef(closed).pinned) return;
    const key = workspaceKeyOf(closed);
    const wasActive = closed.active;
    const keyIdxBefore = tabsState.tabs
      .filter((t) => workspaceKeyOf(t) === key)
      .findIndex((t) => t.id === id);

    tabsState.tabs.splice(idx, 1);
    dropAllPagesForTab(id);
    removeFromPreviewCohort(key, id);

    if (wasActive) {
      const keyTabs = tabsState.tabs.filter((t) => workspaceKeyOf(t) === key);
      if (keyTabs.length === 0) {
        tabsState.activeIdByWorkspace[key] = null;
      } else {
        const next = keyTabs[Math.min(keyIdxBefore, keyTabs.length - 1)];
        next.active = true;
        tabsState.activeIdByWorkspace[key] = next.id;
      }
    }
  }

  function closeTab(id: string): void {
    closeTabInternal(id);
    saveNow();
  }

  // Closes every tab of workspace `key`, pinned tabs included — the one path that bypasses
  // closeTab's own pin guard, since discarding the whole workspace (closeRepoWorkspace,
  // state/workspace.ts) is a different act from closing one of its tabs.
  function closeWorkspaceTabs(key: WorkspaceKey): void {
    const ids = tabsState.tabs.filter((t) => workspaceKeyOf(t) === key).map((t) => t.id);
    for (const id of ids) dropAllPagesForTab(id);
    tabsState.tabs = tabsState.tabs.filter((t) => workspaceKeyOf(t) !== key);
    delete tabsState.activeIdByWorkspace[key];
    delete tabsState.previewIdsByWorkspace[key];
    saveNow();
  }

  function closeOthers(id: string): void {
    const keep = tabsState.tabs.find((t) => t.id === id);
    if (!keep) return;
    const key = workspaceKeyOf(keep);
    const closeIds = new Set(
      tabsState.tabs
        .filter((t) => t.id !== id && workspaceKeyOf(t) === key && !kindDef(t).pinned)
        .map((t) => t.id),
    );
    for (const tabId of closeIds) {
      dropAllPagesForTab(tabId);
      removeFromPreviewCohort(key, tabId);
    }
    tabsState.tabs = tabsState.tabs.filter((t) => !closeIds.has(t.id));
    keep.active = true;
    tabsState.activeIdByWorkspace[key] = id;
    saveNow();
  }

  function closeToTheRight(id: string): void {
    const target = tabsState.tabs.find((t) => t.id === id);
    if (!target) return;
    const key = workspaceKeyOf(target);
    const keyTabs = tabsForWorkspace(key);
    const keyIdx = keyTabs.findIndex((t) => t.id === id);
    const closeIds = new Set(
      keyTabs
        .slice(keyIdx + 1)
        .filter((t) => !kindDef(t).pinned)
        .map((t) => t.id),
    );
    for (const tabId of closeIds) {
      dropAllPagesForTab(tabId);
      removeFromPreviewCohort(key, tabId);
    }
    tabsState.tabs = tabsState.tabs.filter((t) => !closeIds.has(t.id));
    const remaining = tabsState.tabs.filter((t) => workspaceKeyOf(t) === key);
    if (!remaining.some((t) => t.active)) {
      target.active = true;
      tabsState.activeIdByWorkspace[key] = id;
    }
    saveNow();
  }

  function closeAll(key: WorkspaceKey): void {
    const closeIds = new Set(
      tabsState.tabs
        .filter((t) => workspaceKeyOf(t) === key && !kindDef(t).pinned)
        .map((t) => t.id),
    );
    for (const tabId of closeIds) dropAllPagesForTab(tabId);
    tabsState.tabs = tabsState.tabs.filter((t) => !closeIds.has(t.id));
    tabsState.previewIdsByWorkspace[key] = [];
    const remaining = tabsState.tabs.filter((t) => workspaceKeyOf(t) === key);
    if (remaining.length === 0) {
      tabsState.activeIdByWorkspace[key] = null;
    } else if (!remaining.some((t) => t.active)) {
      remaining[0].active = true;
      tabsState.activeIdByWorkspace[key] = remaining[0].id;
    }
    saveNow();
  }

  function activateTab(id: string): void {
    const target = tabsState.tabs.find((t) => t.id === id);
    if (!target) return;
    setActiveTabId(id, workspaceKeyOf(target));
    saveNow();
  }

  function moveTab(fromId: string, toId: string): void {
    if (fromId === toId) return;
    const tabs = tabsState.tabs;
    const fromIdx = tabs.findIndex((t) => t.id === fromId);
    const toTab = tabs.find((t) => t.id === toId);
    if (fromIdx < 0 || !toTab) return;
    const fromTab = tabs[fromIdx];
    if (kindDef(fromTab).pinned || kindDef(toTab).pinned) return;
    const key = workspaceKeyOf(fromTab);
    removeFromPreviewCohort(key, fromId);

    const next = [...tabs];
    const [moved] = next.splice(fromIdx, 1);
    const toIdx = next.findIndex((t) => t.id === toId);
    next.splice(toIdx, 0, moved);
    tabsState.tabs = next;
    saveNow();
  }

  function stepTab(key: WorkspaceKey, delta: 1 | -1): void {
    const tabs = tabsForWorkspace(key);
    if (tabs.length === 0) return;
    const idx = tabs.findIndex((t) => t.id === tabsState.activeIdByWorkspace[key]);
    const next = tabs[(idx + delta + tabs.length) % tabs.length];
    activateTab(next.id);
  }

  function isPreview(id: string): boolean {
    const tab = tabsState.tabs.find((t) => t.id === id);
    if (!tab) return false;
    return (tabsState.previewIdsByWorkspace[workspaceKeyOf(tab)] ?? []).includes(id);
  }

  function promoteTab(id: string): void {
    const tab = tabsState.tabs.find((t) => t.id === id);
    if (!tab) return;
    const key = workspaceKeyOf(tab);
    if (!tabsState.previewIdsByWorkspace[key]?.includes(id)) return;
    removeFromPreviewCohort(key, id);
    saveNow();
  }

  function patchChanged<T extends object>(target: T, patch: Partial<T>): boolean {
    for (const key of Object.keys(patch) as (keyof T)[]) {
      if (!Object.is(target[key], patch[key])) return true;
    }
    return false;
  }

  function patchTabState<S extends object>(
    id: string,
    kind: TabRecord['kind'],
    patch: Partial<S>,
    opts: { skipUnchanged: boolean },
  ): void {
    const target = tabsState.tabs.find((t) => t.id === id);
    if (target?.kind !== kind) return;
    const state = target.state as S;
    if (opts.skipUnchanged && !patchChanged(state, patch)) return;
    Object.assign(state, patch);
    void saveDebounced();
  }

  // revealLine is re-patched (debounced) as the user scrolls/navigates — skipUnchanged since
  // Monaco's own scroll events fire far more often than the line actually changes.
  function patchRepoFileTabState(id: string, patch: Partial<RepoFileTabState>): void {
    patchTabState(id, 'repo-file', patch, { skipUnchanged: true });
  }

  // TabViewStateStore's own write() — git-ui re-serializes its whole PersistedViewState on nearly
  // every interaction (scroll, selection, column resize), so this skips a save when the value is
  // reference-unchanged, the same posture patchRepoFileTabState's own revealLine follows.
  function patchRepoGraphTabState(id: string, patch: Partial<RepoGraphTabState>): void {
    patchTabState(id, 'repo-graph', patch, { skipUnchanged: true });
  }

  return {
    ...toRefs(tabsState),
    hydrateTabs,
    removeFromPreviewCohort,
    evictPreviewCohort,
    openTab,
    createPinnedRepoGraphTab,
    duplicateTab,
    closeTab,
    closeWorkspaceTabs,
    closeOthers,
    closeToTheRight,
    closeAll,
    activateTab,
    moveTab,
    stepTab,
    isPreview,
    promoteTab,
    patchTabState,
    patchRepoFileTabState,
    patchRepoGraphTabState,
  };
});

// Exported for state/workspace.ts's own closeRepoWorkspace, which must call it without importing
// useTabsStore's whole surface back — mirrors state/tabs.ts (Kira Studio)'s own export shape.
export function closeWorkspaceTabs(key: WorkspaceKey): void {
  useTabsStore().closeWorkspaceTabs(key);
}
