import { defaultHttpRequestTabState, type HttpRequestTabState } from '@shared/domain/http';
import type { AppMode } from '@shared/domain/mode';
import {
  asBrowseTab,
  asConsoleTab,
  asDataTab,
  asDocumentTab,
  asHttpRequestTab,
  asKeyValueTab,
  asStreamTab,
  type BrowseTabRecord,
  type BrowseTabState,
  type ConsoleTabRecord,
  type ConsoleTabState,
  type DataTabRecord,
  type DataTabState,
  type DefinitionTabState,
  type DocumentTabRecord,
  type DocumentTabState,
  defaultBrowseTabState,
  defaultConsoleTabState,
  defaultDataTabState,
  defaultDefinitionTabState,
  defaultDocumentTabState,
  defaultKeyValueTabState,
  defaultStreamTabState,
  type HttpRequestTabRecord,
  type KeyValueTabRecord,
  type KeyValueTabState,
  type StreamTabRecord,
  type StreamTabState,
  TAB_KIND_MODE,
  type TabKind,
  type TabRecord,
} from '@shared/domain/tabs';
import { reactive } from 'vue';
import { control } from '../bridge/control';
import { clearPending } from '../views/grid/pendingChanges';
import { clearSelectedCellFor } from './cellSelection';
import { connectionsState } from './connections';
import { consoleDefaultFor } from './consoleDefaults';
import { modeState } from './mode';
import { settingsState } from './settings';
import { TAB_KINDS } from './tabKinds';
import { cleanupTabRuntime } from './tabRuntime';

// Frees whichever page store(s) a tab could have populated (§2.2) — a plain no-op lookup miss
// for the stores a tab's own kind never touches, same discipline as calling
// clearPending/clearSelectedCellFor unconditionally below regardless of tab kind. Blind-calls
// every registered kind's own dropper rather than branching on the tab's kind, because by the
// time closeTab() calls this the tab record has already been spliced out of tabsState.tabs (F12).
function dropPageStoresForTab(id: string): void {
  for (const kind of Object.keys(TAB_KINDS) as TabKind[]) {
    TAB_KINDS[kind].dropResources(id);
  }
}

// The tab-closed signal: page stores plus the runtime record every view keeps its count,
// selection, find-toolbar state and actionError in (state/tabRuntime.ts). A disconnect (below)
// deliberately calls only dropPageStoresForTab — the tab comes back on reconnect and should keep
// looking like the same tab, not one that lost its find toolbar and selection along with its rows.
function dropAllPagesForTab(id: string): void {
  dropPageStoresForTab(id);
  cleanupTabRuntime(id);
}

// Cross-view state (§11): tabs are read by the tab strip, the toolbar, the main view and the
// operations panel, none of which may reach into each other — hence renderer/state/, not
// workbench/state/ or views/grid/.
export const tabsState = reactive({
  tabs: [] as TabRecord[], // ordered, all modes interleaved
  // P1 D5: one active tab per mode, not one app-wide — a tab's own mode is TAB_KIND_MODE[kind].
  activeIdByMode: { studio: null, http: null } as Record<AppMode, string | null>,
  /** In-memory only: a restored tab has not loaded and shows "Reconnect & load" (§8.4). */
  hydrated: new Set<string>(),
});

export interface RecentTableEntry {
  connectionId: string;
  path: string;
  kind: 'data' | 'document' | 'keyvalue' | 'stream';
  openedAt: number;
}

const RECENT_TABLES_LIMIT = 20;

// P16 design system's Empty.html "Recent tables" list — in-memory only, like tabsState.hydrated
// above: it resets on relaunch rather than adding a new storage table for tab-open history.
export const recentTablesState = reactive({
  entries: [] as RecentTableEntry[],
});

function recordRecent(connectionId: string, path: string, kind: RecentTableEntry['kind']): void {
  const withoutThis = recentTablesState.entries.filter(
    (e) => !(e.connectionId === connectionId && e.path === path && e.kind === kind),
  );
  withoutThis.unshift({ connectionId, path, kind, openedAt: Date.now() });
  recentTablesState.entries = withoutThis.slice(0, RECENT_TABLES_LIMIT);
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
// D17: the last serialisation actually written — a save whose snapshot is identical to this
// (e.g. a scroll-offset patch that set a field to the value it already had) skips the IPC and
// the write entirely, not just the debounce.
let lastSavedSnapshot: string | null = null;

function saveIfChanged(): void {
  const snapshot = JSON.stringify(tabsState.tabs);
  if (snapshot === lastSavedSnapshot) return;
  lastSavedSnapshot = snapshot;
  void control.tabsSave(tabsState.tabs);
}

function saveNow(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  saveIfChanged();
}

function saveDebounced(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveIfChanged();
  }, 1000);
}

// A pending debounced save is otherwise lost outright if the window closes before its timer
// fires (e.g. a pager/filter/sort change right before quit, or before this window's own close —
// P8 C6/F8 gives the latter the same protection the quit handshake already had): main (quit) or
// this window's own WindowClosing hook (close) holds the corresponding event until the ack
// below arrives, so awaiting tabsSave first is what actually makes either wait worthwhile —
// `beforeunload` can't do this, since main tears the renderer down without waiting for anything
// it starts there. One routine, two triggers, so the two handshakes can't drift out of sync.
function flushPendingTabState(ack: () => void): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  void control.tabsSave(tabsState.tabs).finally(ack);
}

control.onFlushBeforeClose(() => flushPendingTabState(control.appFlushed));
control.onWindowFlushBeforeClose(() => flushPendingTabState(control.windowFlushed));

// D7: main's `tabs.connection_id` is ON DELETE CASCADE, so a deleted connection's `tabs` rows
// are already gone server-side — a tab this store still holds for it is a row that can never be
// re-inserted (every later debounced save would throw FOREIGN KEY constraint failed and get
// silently discarded, F7). Closing routes through the same closeTab() a manual close uses, so
// pages (F5) and runtime (F4) are freed by one code path rather than a second one to keep in sync.
control.onConnectionsChanged((records) => {
  const liveIds = new Set(records.map((r) => r.id));
  const stale = tabsState.tabs
    .filter((t) => t.connectionId && !liveIds.has(t.connectionId))
    .map((t) => t.id);
  for (const id of stale) closeTab(id);
});

// P43 F9/D12: an explicit Disconnect (or a lost connection surfacing as 'error') never used to
// touch tabsState.hydrated at all — only a failed *load* did, so a tab kept rendering its
// pre-disconnect rows until the moment something happened to try reading it again. Regating here
// puts every open tab of the connection behind §8.4's Reconnect gate the instant the connection
// itself says it is gone, matching what the engine already did with its own cache
// (engine/cache/index.ts's dropConnection). D13: only the page bytes are freed — the runtime
// record (count, selection, find toolbar, actionError) stays, so the tab that comes back on
// reconnect is still the same tab, not a blank one.
control.onConnectionState((state) => {
  if (state.status !== 'disconnected' && state.status !== 'error') return;
  for (const t of tabsState.tabs) {
    if (t.connectionId !== state.connectionId) continue;
    unmarkHydrated(t.id);
    dropPageStoresForTab(t.id);
  }
});

export async function hydrateTabs(): Promise<void> {
  const tabs = await control.tabsList();
  tabsState.tabs = tabs;
  // One restored active tab per mode (F18: SQL's `active` column has no uniqueness constraint,
  // so this needs no migration) — same "active, else first" fallback the old single-mode code
  // used, just scoped to each mode's own subset.
  for (const mode of ['studio', 'http'] as const) {
    const modeTabs = tabs.filter((t) => TAB_KIND_MODE[t.kind] === mode);
    const active = modeTabs.find((t) => t.active) ?? modeTabs[0];
    tabsState.activeIdByMode[mode] = active?.id ?? null;
  }
  // The boot mode is whichever tab was active app-wide before this phase ever shipped a second
  // mode — there is at most one such tab in a pre-P1 session, so this is unambiguous today and
  // stays correct once P2 gives Http its own kinds (D5, §8 OQ-2).
  const bootTab = tabs.find((t) => t.active) ?? tabs[0];
  modeState.active = bootTab ? TAB_KIND_MODE[bootTab.kind] : 'studio';
  // hydrated stays empty — every restored tab shows Reconnect & load, and restoring never
  // connects anything (§8.4).
}

// Deactivates every other tab of `mode` and marks `id` active, in both the per-tab flag and
// tabsState.activeIdByMode — the one thing every activation path (open, duplicate, activateTab)
// shares. Also brings that mode forward (D5: "activating a tab from anywhere brings its mode
// forward"), which is a no-op when the caller is already in that mode.
function setActiveTabId(id: string, mode: AppMode): void {
  for (const t of tabsState.tabs) {
    if (TAB_KIND_MODE[t.kind] === mode) t.active = t.id === id;
  }
  tabsState.activeIdByMode[mode] = id;
  modeState.active = mode;
}

// Result of an open*Tab call: `reused` tells the caller whether an existing tab was activated
// (Task 62) rather than a fresh one created — a fresh tab is about to fetch on mount anyway, so
// only a caller that cares about the double-click "also reload the data" behavior needs to check
// this; everyone else can destructure just `id` and ignore it.
export interface OpenTabResult {
  id: string;
  reused: boolean;
}

// P39 F16/D12: the six Studio openers below shared this exact sequence — find-existing-and-
// activate (opt-in per caller via `reuse`), else create-and-push-and-activate, then an opt-in
// recordRecent — differing only in which of those two opt-ins applied and which kind/state
// constructor built the record. Kept internal: the six exported Studio signatures are unchanged.
// P2 C5/F3: `connectionId` widens to `string | null` so openHttpRequestTab can share this same
// sequence for a connectionless tab — `recentKind` stays Studio-only (RecentTableEntry itself
// requires a real connectionId), so a null id and a recentKind are never both present at once.
function openTab<S>(
  kind: TabRecord['kind'],
  connectionId: string | null,
  path: string,
  makeState: () => S,
  opts: { reuse: boolean; recentKind?: RecentTableEntry['kind'] },
): OpenTabResult {
  if (opts.reuse) {
    const existing = tabsState.tabs.find(
      (t) => t.kind === kind && t.connectionId === connectionId && t.path === path,
    );
    if (existing) {
      activateTab(existing.id);
      // Reopening (double-click, "recent tables", …) against a connection that's live right
      // now reads as "load this" just as much as a brand-new tab does — without this, a tab
      // left unhydrated by an earlier disconnect (or never hydrated after a session restore)
      // stays stuck behind the reconnect gate until its own button is clicked, even though the
      // very re-open that just happened proves the connection needs no reconnecting at all.
      if (connectionId && connectionsState.states[connectionId]?.status === 'connected') {
        tabsState.hydrated.add(existing.id);
      }
      return { id: existing.id, reused: true };
    }
  }

  const id = crypto.randomUUID();
  const record = {
    id,
    connectionId,
    path,
    kind,
    state: makeState(),
    order: tabsState.tabs.length,
    active: true,
    // `kind` and `makeState()`'s return type agree at every call site below — TabRecord's own
    // discriminated union can't express that generically, so this is asserted rather than typed.
  } as unknown as TabRecord;
  tabsState.tabs.push(record);
  setActiveTabId(id, TAB_KIND_MODE[kind]);
  // Opened from a live connection (or, for an HTTP tab, from nothing to reconnect at all) —
  // either way there is no Reconnect gate to show.
  tabsState.hydrated.add(id);
  // recentKind is Studio-only (F3) — every caller that sets it also passes a real connectionId.
  if (opts.recentKind && connectionId) recordRecent(connectionId, path, opts.recentKind);
  saveNow();
  return { id, reused: false };
}

// Without `newTab`, activates an existing tab for the same (connectionId, path) if one exists
// (§8.10's "Open data"). "Open data in new tab" always creates (`newTab: true`), so the same
// table can be open N times with independent state — identity is `id`, never `path` (§8.4).
export function openDataTab(
  connectionId: string,
  path: string,
  opts?: { newTab?: boolean },
): OpenTabResult {
  return openTab(
    'data',
    connectionId,
    path,
    () => defaultDataTabState(settingsState.data.defaultPageSize),
    {
      reuse: !opts?.newTab,
      recentKind: 'data',
    },
  );
}

// Opens a 'definition' tab, reusing an existing one for the same (connectionId, path) — mirrors
// openDataTab's identity rule (§8.4), minus the `newTab` escape hatch: D14 gives the definition
// view no "open in new tab" affordance.
export function openDefinitionTab(connectionId: string, path: string): string {
  return openTab('definition', connectionId, path, () => defaultDefinitionTabState(), {
    reuse: true,
  }).id;
}

// Opens a new 'console' tab — always a fresh one, never reused by (connectionId, path): unlike
// data/definition, a console is a scratch work surface (like a SQL client's "New Query"), so the same
// target routinely wants several independent consoles open at once.
//
// D9: opened at the bare connection root (`path === ''`), a Postgres console has no session-
// level way to redirect itself to a non-primary database — substituting a remembered "Set as
// default" path here, before the path ever reaches the engine, needs no adapter change at all.
export function openConsoleTab(connectionId: string, path: string): string {
  const effectivePath = path === '' ? (consoleDefaultFor(connectionId) ?? path) : path;
  return openTab('console', connectionId, effectivePath, () => defaultConsoleTabState(), {
    reuse: false,
  }).id;
}

// Opens a 'document' tab, reusing an existing one for the same (connectionId, path) — mirrors
// openDataTab's identity rule (§8.4); `newTab` opens a fresh one regardless.
export function openDocumentTab(
  connectionId: string,
  path: string,
  opts?: { newTab?: boolean },
): OpenTabResult {
  return openTab(
    'document',
    connectionId,
    path,
    () => defaultDocumentTabState(settingsState.data.defaultPageSize),
    { reuse: !opts?.newTab, recentKind: 'document' },
  );
}

// Opens a 'keyvalue' tab, reusing an existing one for the same (connectionId, path) — mirrors
// openDataTab's identity rule (§8.4); `newTab` opens a fresh one regardless.
export function openKeyValueTab(
  connectionId: string,
  path: string,
  opts?: { newTab?: boolean },
): OpenTabResult {
  return openTab(
    'keyvalue',
    connectionId,
    path,
    () => defaultKeyValueTabState(settingsState.data.defaultPageSize),
    { reuse: !opts?.newTab, recentKind: 'keyvalue' },
  );
}

// Opens a 'stream' tab, reusing an existing one for the same (connectionId, path) — mirrors
// openDataTab's identity rule (§8.4); `newTab` opens a fresh one regardless.
export function openStreamTab(
  connectionId: string,
  path: string,
  opts?: { newTab?: boolean },
): OpenTabResult {
  return openTab(
    'stream',
    connectionId,
    path,
    () => defaultStreamTabState(settingsState.data.defaultPageSize),
    { reuse: !opts?.newTab, recentKind: 'stream' },
  );
}

// Opens a 'browse' tab (P41 D11/D14) over a redis database / s3 bucket's key or object space —
// identity is the container (`path`), reused across "Browse keys"/"Browse objects" invocations on
// the same container the same way openDataTab reuses a table's tab; `newTab` opens a fresh one
// regardless, with its own independent levelPath.
export function openBrowseTab(
  connectionId: string,
  path: string,
  opts?: { newTab?: boolean },
): OpenTabResult {
  return openTab('browse', connectionId, path, () => defaultBrowseTabState(), {
    reuse: !opts?.newTab,
  });
}

// P2 D2/D13: always a fresh tab — an HTTP request has no target to reuse by (its own id is its
// identity, D2), the same "always new" shape openConsoleTab already has for the same reason.
// `connectionId` is null (F3) and `path` is the literal constant 'request' (D2: non-empty per
// F2, carrying no false uniqueness, safe through pathTail per F4).
export function openHttpRequestTab(): string {
  return openTab('http-request', null, 'request', () => defaultHttpRequestTabState(), {
    reuse: false,
  }).id;
}

// Same target, fresh default state — the cheapest possible demonstration of §8.4's identity rule.
// P1 D4/F12: reads TAB_KINDS[source.kind].duplicateState instead of a seven-branch if/else — each
// kind's own entry already knows what "fresh" means for it (data/document/keyvalue/stream keep the
// source's pageSize; the rest start fully blank).
export function duplicateTab(id: string): string {
  const source = tabsState.tabs.find((t) => t.id === id);
  if (!source) return id;

  const newId = crypto.randomUUID();
  const def = TAB_KINDS[source.kind];
  const record = {
    id: newId,
    connectionId: source.connectionId,
    path: source.path,
    kind: source.kind,
    // `def.duplicateState` is one of seven concrete, kind-specific functions once `source.kind`
    // narrows K — TS can't carry that narrowing through the TAB_KINDS[...] index, so this asserts
    // it the same way openTab's own record construction does above.
    state: (def.duplicateState as (tab: TabRecord) => TabRecord['state'])(source),
    order: tabsState.tabs.length,
    active: true,
  } as unknown as TabRecord;
  tabsState.tabs.push(record);
  setActiveTabId(newId, TAB_KIND_MODE[source.kind]);
  tabsState.hydrated.add(newId);
  saveNow();
  return newId;
}

export function closeTab(id: string): void {
  const idx = tabsState.tabs.findIndex((t) => t.id === id);
  if (idx < 0) return;
  const closed = tabsState.tabs[idx];
  const mode = TAB_KIND_MODE[closed.kind];
  const wasActive = closed.active;
  // Where the closed tab sat among its own mode's tabs, not the whole (multi-mode) array — needed
  // below to pick "whatever landed in its spot" the same way the pre-mode code did with idx.
  const modeIdxBefore = tabsState.tabs
    .filter((t) => TAB_KIND_MODE[t.kind] === mode)
    .findIndex((t) => t.id === id);

  tabsState.tabs.splice(idx, 1);
  tabsState.hydrated.delete(id);
  dropAllPagesForTab(id); // §2.2: closing a tab frees its cached page(s) immediately.
  clearSelectedCellFor(id);
  clearPending(id);

  if (wasActive) {
    const modeTabs = tabsState.tabs.filter((t) => TAB_KIND_MODE[t.kind] === mode);
    if (modeTabs.length === 0) {
      tabsState.activeIdByMode[mode] = null;
    } else {
      const next = modeTabs[Math.min(modeIdxBefore, modeTabs.length - 1)];
      next.active = true;
      tabsState.activeIdByMode[mode] = next.id;
    }
  }
  saveNow();
}

export function closeOthers(id: string): void {
  const keep = tabsState.tabs.find((t) => t.id === id);
  if (!keep) return;
  // Scoped to the kept tab's own mode (D5) — "Close others" in one mode's strip never touches a
  // tab that isn't even rendered there.
  const mode = TAB_KIND_MODE[keep.kind];
  const closeIds = new Set(
    tabsState.tabs.filter((t) => t.id !== id && TAB_KIND_MODE[t.kind] === mode).map((t) => t.id),
  );
  for (const tabId of closeIds) {
    tabsState.hydrated.delete(tabId);
    dropAllPagesForTab(tabId);
    clearSelectedCellFor(tabId);
    clearPending(tabId);
  }
  tabsState.tabs = tabsState.tabs.filter((t) => !closeIds.has(t.id));
  keep.active = true;
  tabsState.activeIdByMode[mode] = id;
  saveNow();
}

export function closeToTheRight(id: string): void {
  const target = tabsState.tabs.find((t) => t.id === id);
  if (!target) return;
  const mode = TAB_KIND_MODE[target.kind];
  // "To the right" is a strip-visual concept, so it's computed over this tab's own mode's subset
  // (its own left-to-right order), not the whole multi-mode array.
  const modeTabs = tabsState.tabs.filter((t) => TAB_KIND_MODE[t.kind] === mode);
  const modeIdx = modeTabs.findIndex((t) => t.id === id);
  const closeIds = new Set(modeTabs.slice(modeIdx + 1).map((t) => t.id));
  for (const tabId of closeIds) {
    tabsState.hydrated.delete(tabId);
    dropAllPagesForTab(tabId);
    clearSelectedCellFor(tabId);
    clearPending(tabId);
  }
  tabsState.tabs = tabsState.tabs.filter((t) => !closeIds.has(t.id));
  const remaining = tabsState.tabs.filter((t) => TAB_KIND_MODE[t.kind] === mode);
  if (!remaining.some((t) => t.active)) {
    target.active = true;
    tabsState.activeIdByMode[mode] = id;
  }
  saveNow();
}

export function closeAll(): void {
  // "Close all" always means "in the mode whose strip this menu opened from" (D5) — the current
  // mode, since a tab's context menu can only ever come from a tab actually rendered there.
  const mode = modeState.active;
  const closeIds = new Set(
    tabsState.tabs.filter((t) => TAB_KIND_MODE[t.kind] === mode).map((t) => t.id),
  );
  for (const tabId of closeIds) {
    tabsState.hydrated.delete(tabId);
    dropAllPagesForTab(tabId);
    clearSelectedCellFor(tabId);
    clearPending(tabId);
  }
  tabsState.tabs = tabsState.tabs.filter((t) => !closeIds.has(t.id));
  tabsState.activeIdByMode[mode] = null;
  saveNow();
}

export function activateTab(id: string): void {
  const target = tabsState.tabs.find((t) => t.id === id);
  if (!target) return;
  setActiveTabId(id, TAB_KIND_MODE[target.kind]);
  saveNow();
}

// Tab-strip drag-reorder: called live on every dragover as the dragged tab crosses another one's
// midpoint, same "splice out, splice in" shape as ColumnsMenu.vue's own column drag. P1 F15: ids,
// not indices — the strip now renders a filtered (per-mode) view of tabsState.tabs, so an index
// into that view no longer addresses the same element in the underlying (multi-mode) array.
export function moveTab(fromId: string, toId: string): void {
  if (fromId === toId) return;
  const tabs = tabsState.tabs;
  const fromIdx = tabs.findIndex((t) => t.id === fromId);
  if (fromIdx < 0 || !tabs.some((t) => t.id === toId)) return;
  const next = [...tabs];
  const [moved] = next.splice(fromIdx, 1);
  const toIdx = next.findIndex((t) => t.id === toId);
  next.splice(toIdx, 0, moved);
  tabsState.tabs = next;
  saveNow();
}

// D11: Control+Tab / Control+Shift+Tab — wraps around at either end, matching the tab strip's own
// left-to-right visual order, scoped to the current mode's own tabs (D5).
function stepTab(delta: 1 | -1): void {
  const mode = modeState.active;
  const tabs = tabsState.tabs.filter((t) => TAB_KIND_MODE[t.kind] === mode);
  if (tabs.length === 0) return;
  const idx = tabs.findIndex((t) => t.id === tabsState.activeIdByMode[mode]);
  const next = tabs[(idx + delta + tabs.length) % tabs.length];
  activateTab(next.id);
}

export function activateNextTab(): void {
  stepTab(1);
}

export function activatePrevTab(): void {
  stepTab(-1);
}

// D17: a patch that sets every field to the value it already had (DataGrid.vue's scroll-persist
// timer is the common case) must not even schedule a save.
function patchChanged<T extends object>(target: T, patch: Partial<T>): boolean {
  for (const key of Object.keys(patch) as (keyof T)[]) {
    if (!Object.is(target[key], patch[key])) return true;
  }
  return false;
}

// P39 F16/D12: the six patchers below shared this exact body, differing only in which kind they
// target and whether they check patchChanged first — data/console/definition do (a patch that
// sets every field to a value it already had must not schedule a save, D17); document/keyvalue/
// stream never did. That is a real behavior difference, not a formatting one (F16), so it is kept
// as an explicit per-caller flag rather than silently unified either way.
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
  saveDebounced();
}

export function patchDataTabState(id: string, patch: Partial<DataTabState>): void {
  patchTabState(id, 'data', patch, { skipUnchanged: true });
}

export function patchConsoleTabState(id: string, patch: Partial<ConsoleTabState>): void {
  patchTabState(id, 'console', patch, { skipUnchanged: true });
}

export function patchDefinitionTabState(id: string, patch: Partial<DefinitionTabState>): void {
  patchTabState(id, 'definition', patch, { skipUnchanged: true });
}

export function patchDocumentTabState(id: string, patch: Partial<DocumentTabState>): void {
  patchTabState(id, 'document', patch, { skipUnchanged: false });
}

export function patchKeyValueTabState(id: string, patch: Partial<KeyValueTabState>): void {
  patchTabState(id, 'keyvalue', patch, { skipUnchanged: false });
}

export function patchStreamTabState(id: string, patch: Partial<StreamTabState>): void {
  patchTabState(id, 'stream', patch, { skipUnchanged: false });
}

// P41: mirrors data/console/definition's skipUnchanged: true — descending/ascending to the level
// a tab is already showing (e.g. a duplicate reload) must not schedule a save.
export function patchBrowseTabState(id: string, patch: Partial<BrowseTabState>): void {
  patchTabState(id, 'browse', patch, { skipUnchanged: true });
}

// P2: no skipUnchanged guard — a Params-table edit rewriting the URL to the value it already had
// (D9) is rare enough that the extra write is not worth the comparison every other patcher above
// already accepts skipping for a hotter path (scroll offsets, page index).
export function patchHttpRequestTabState(id: string, patch: Partial<HttpRequestTabState>): void {
  patchTabState(id, 'http-request', patch, { skipUnchanged: false });
}

export function markHydrated(id: string): void {
  tabsState.hydrated.add(id);
}

// A read that comes back E_ENGINE_DOWN/E_CONNECT means the adapter is gone — flip the tab back
// to the Reconnect & load affordance rather than showing a red error (views/grid/state.ts's
// load()). Item 4 (P46-2): deliberately not E_NOT_FOUND — several adapters also throw that for an
// ordinary query-time not-found against a still-live connection (viewOp.ts's own comment).
export function unmarkHydrated(id: string): void {
  tabsState.hydrated.delete(id);
}

export function isHydrated(id: string): boolean {
  return tabsState.hydrated.has(id);
}

export function findDataTab(id: string): DataTabRecord | null {
  return asDataTab(tabsState.tabs.find((t) => t.id === id));
}

export function findConsoleTab(id: string): ConsoleTabRecord | null {
  return asConsoleTab(tabsState.tabs.find((t) => t.id === id));
}

export function findDocumentTab(id: string): DocumentTabRecord | null {
  return asDocumentTab(tabsState.tabs.find((t) => t.id === id));
}

export function findKeyValueTab(id: string): KeyValueTabRecord | null {
  return asKeyValueTab(tabsState.tabs.find((t) => t.id === id));
}

export function findStreamTab(id: string): StreamTabRecord | null {
  return asStreamTab(tabsState.tabs.find((t) => t.id === id));
}

export function findBrowseTab(id: string): BrowseTabRecord | null {
  return asBrowseTab(tabsState.tabs.find((t) => t.id === id));
}

export function findHttpRequestTab(id: string): HttpRequestTabRecord | null {
  return asHttpRequestTab(tabsState.tabs.find((t) => t.id === id));
}
