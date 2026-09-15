import {
  asBrowseTab,
  asConsoleTab,
  asDataTab,
  asDocumentTab,
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
  defaultRepoGraphTabState,
  defaultStreamTabState,
  type KeyValueTabRecord,
  type KeyValueTabState,
  type RepoFileTabState,
  type RepoGraphTabState,
  type StreamTabRecord,
  type StreamTabState,
  TAB_KIND_MODE,
  type TabKind,
  type TabRecord,
} from '@shared/domain/tabs';
import type { WorkspaceKey } from '@shared/domain/workspace';
import { reactive } from 'vue';
import { control } from '../bridge/control';
import { clearPending } from '../views/grid/pendingChanges';
import { clearSelectedCellFor } from './cellSelection';
import { connectionsState } from './connections';
import { consoleDefaultFor } from './consoleDefaults';
import { tabsForWorkspace, workspaceKeyOf } from './mode';
import { settingsState } from './settings';
import { isIncognito, registerIncognitoSetListener, setIncognito } from './tabIncognito';
import { TAB_KINDS } from './tabKinds';
import { cleanupTabRuntime } from './tabRuntime';
import { activateWorkspace, workspaceState } from './workspace';

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
  tabs: [] as TabRecord[], // ordered, all workspaces interleaved
  // C5 D2/§4.2: widened from `Record<AppMode, string | null>` to every WorkspaceKey — a tab's own
  // workspace is workspaceKeyOf(tab), not just TAB_KIND_MODE[tab.kind] any more. 'studio'/'api'
  // are still always present; a repo key is added the first time a tab of that workspace exists.
  activeIdByWorkspace: { studio: null, api: null } as Record<WorkspaceKey, string | null>,
  /** In-memory only: a restored tab has not loaded and shows "Reconnect & load" (§8.4). */
  hydrated: new Set<string>(),
  // C5 §5.1: one entry per workspace, in memory only (like `hydrated` above) — no schema change,
  // and a restored session comes back with every tab permanent (D3). P74 §5.2: widened from a
  // single `string | null` slot to a set of ids — "Open all changes" needs a whole cohort of
  // preview tabs to replace as a unit, not one slot fought over by every file in the commit.
  previewIdsByWorkspace: {} as Record<WorkspaceKey, readonly string[]>,
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
// The snapshot of an in-flight (not yet resolved) tabsSave call, if any — kept separate from
// lastSavedSnapshot (which now only ever reflects a write that actually succeeded) so a second
// saveIfChanged call landing on the identical snapshot while the first is still in flight does not
// fire a redundant duplicate write.
let pendingSnapshot: string | null = null;

// P21 round 2 functional finding ("smaller, real, but narrow"): lastSavedSnapshot used to be
// assigned *before* awaiting control.tabsSave, so a rejected write (the FK case
// onConnectionsChanged above exists to prevent, or any transient failure) was still recorded as
// "already persisted" — the next saveIfChanged call, even for the identical snapshot, would then
// see snapshot === lastSavedSnapshot and skip the retry entirely, silently dropping the save for
// good. Assigning only after tabsSave actually resolves means a failed write leaves
// lastSavedSnapshot at its last real success, so the next state change (even one that lands on the
// same snapshot the failed save had) is not short-circuited away.
// P71 §3.1: an incognito tab is never written — left out of the snapshot entirely, and
// TabsService.Save replaces the window's whole tab set, so a tab switched to incognito mid-session
// also drops whatever row it already had, with no separate delete call needed.
function persistableTabs(): TabRecord[] {
  return tabsState.tabs.filter((t) => !isIncognito(t.id));
}

function saveIfChanged(): void {
  const snapshot = JSON.stringify(persistableTabs());
  if (snapshot === lastSavedSnapshot || snapshot === pendingSnapshot) return;
  pendingSnapshot = snapshot;
  // P21 round 3 performance finding 9: this used to hand `tabsState.tabs` itself — the live,
  // deep-`reactive()` tree — to control.tabsSave, which the Wails binding then serialises a
  // *second* time to cross the bridge: one full walk through Vue's reactivity proxies (this
  // stringify, purely for the change check above) immediately followed by a second one (Wails'
  // own JSON encoding of the call argument), of the same data, on every save. `JSON.parse(snapshot)`
  // turns the snapshot already built above back into a plain, non-reactive object graph — Wails'
  // own serialisation of *that* walks ordinary property reads with no proxy traps at all, so the
  // net cost is one reactive walk (this stringify) plus a cheap parse and a cheap plain walk,
  // instead of two reactive walks of a tab set that can hold a 1 MB pasted script per tab.
  void control
    .tabsSave(JSON.parse(snapshot) as TabRecord[])
    .then(
      () => {
        lastSavedSnapshot = snapshot;
      },
      // Left uncaught beyond this: lastSavedSnapshot simply isn't advanced, so the next
      // saveIfChanged call (triggered by whatever state change comes next) retries rather than
      // rejecting the renderer with an unhandled promise rejection over a write it will get another
      // chance at.
      () => {},
    )
    .finally(() => {
      if (pendingSnapshot === snapshot) pendingSnapshot = null;
    });
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
  void control.tabsSave(persistableTabs()).finally(ack);
}

control.onFlushBeforeClose(() => flushPendingTabState(control.appFlushed));
control.onWindowFlushBeforeClose(() => flushPendingTabState(control.windowFlushed));

// P71 §3.1: turning incognito on flushes the tab's existing row immediately, rather than at
// whatever unrelated state change saves next — tabIncognito.ts cannot call saveNow directly (it
// would recreate the cycle its own module comment avoids), so it publishes the toggle here instead.
registerIncognitoSetListener((_tabId, on) => {
  if (on) saveNow();
});

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
  const raw = await control.tabsList();
  // P3 D3: every restored record's state goes through its own kind's schema — the one place every
  // *TabStateSchema's `.default()` actually fires (F1 of P2: nothing else parses a restored tab at
  // all). Merge-only: a record that parses gets the defaults it was missing; one that fails to
  // parse is kept exactly as it arrived, never reset to defaultState() (that would silently drop a
  // required field's existing value, not fill in a missing one).
  const tabs = raw.map((t) => {
    const parsed = TAB_KINDS[t.kind].parseState(t.state);
    return parsed ? ({ ...t, state: parsed } as TabRecord) : t;
  });
  tabsState.tabs = tabs;

  // One restored active tab per workspace actually present among the restored tabs — 'studio'/
  // 'api' are always seeded (even at zero tabs, matching the old per-mode behavior exactly); a
  // repo workspace's own entry exists only when it has at least one restored tab.
  const keys = new Set<WorkspaceKey>(['studio', 'api']);
  for (const t of tabs) keys.add(workspaceKeyOf(t));
  for (const key of keys) {
    const keyTabs = tabs.filter((t) => workspaceKeyOf(t) === key);
    const active = keyTabs.find((t) => t.active) ?? keyTabs[0];
    tabsState.activeIdByWorkspace[key] = active?.id ?? null;
  }

  // C5 §4.2: openRepos is every repo workspace with at least one restored tab, in the order its
  // tabs first appear in the array — nothing new persisted beyond tabs.workspace_id (D2). A repo
  // whose row was removed since this window last saved is not filtered out here (that would need
  // this module reaching into state/coderepos.ts, adding a boot-order dependency this file has no
  // other reason to need) — main.ts's bootstrap calls hydrateCodeRepos() first and then drops an
  // orphaned repo workspace's tabs itself, once it can name which repo ids are still live.
  const openRepos: string[] = [];
  for (const t of tabs) {
    const key = workspaceKeyOf(t);
    if (key === 'studio' || key === 'api') continue;
    const repoId = key.slice('repo:'.length);
    if (!openRepos.includes(repoId)) openRepos.push(repoId);
  }
  workspaceState.openRepos = openRepos;
  // P22 D12: the boot mode used to be derived here, from whichever tab was active app-wide
  // before mode ever had its own persistence ("there is at most one such tab in a pre-P1
  // session, so this is unambiguous" — its own comment already flagged this as a stand-in,
  // §8 OQ-2). main.ts's bootstrap now calls hydrateMode() with the window's own stored mode
  // before this function ever runs, which is the real signal that heuristic was standing in
  // for — this function no longer touches modeState at all.
  // hydrated stays empty — every restored tab shows Reconnect & load, and restoring never
  // connects anything (§8.4).
}

// Deactivates every other tab of workspace `key` and marks `id` active, in both the per-tab flag
// and tabsState.activeIdByWorkspace — the one thing every activation path (open, duplicate,
// activateTab) shares. Also brings that workspace forward (D5's "activating a tab from anywhere
// brings its mode forward", generalised to every workspace), which is a no-op when the caller is
// already there. Goes through activateWorkspace (state/workspace.ts), not a direct modeState write
// — so a studio/api tab activated this way is eventually persisted exactly like a mode-tab click
// is. P67b §4.2: a repo tab activated this way now ALSO brings the Git module forward
// (activateWorkspace persists 'git' via setModule) — the behaviour change that makes clicking a
// repo file tab from anywhere (Quick Open, a restored session's own pinned graph tab) switch the
// title bar to Git, not just the workspace underneath it.
function setActiveTabId(id: string, key: WorkspaceKey): void {
  for (const t of tabsState.tabs) {
    if (workspaceKeyOf(t) === key) t.active = t.id === id;
  }
  tabsState.activeIdByWorkspace[key] = id;
  activateWorkspace(key);
}

// P74 §5.2: removes `id` from workspace `key`'s preview cohort if it is there, a no-op otherwise
// — every "one tab leaves the cohort, the rest stay previewed" site (a permanent reopen, close,
// drag-start, promoteTab, and repoTabs.ts's own reuse branches) shares this rather than repeating
// the same guarded filter. Exported for repoTabs.ts alone — every other site lives in this file.
export function removeFromPreviewCohort(key: WorkspaceKey, id: string): void {
  const cohort = tabsState.previewIdsByWorkspace[key];
  if (!cohort?.includes(id)) return;
  tabsState.previewIdsByWorkspace[key] = cohort.filter((x) => x !== id);
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
// P2 C5/F3: `connectionId` widens to `string | null` so http/tabs.ts's openApiRequestTab can
// share this same sequence for a connectionless tab — `recentKind` stays Studio-only
// (RecentTableEntry itself requires a real connectionId), so a null id and a recentKind are never
// both present at once.
//
// C5 §4.2/§5.2: `opts.workspaceId` (default null — every studio/api caller's own unchanged
// behavior) and `opts.preview` (default false — ditto) are the two additions this phase makes.
// The dedupe key widens to (workspaceId, kind, connectionId, path) — load-bearing: two
// repositories routinely hold the same relative path, and the old key would collapse them. The
// preview mechanism lives here, not in state/repoTabs.ts's own openRepoFileTab, because it is
// kind-agnostic and this is the one place every tab-open already funnels through (§15.1's own
// unit test targets this file for exactly that reason).
export function openTab<S>(
  kind: TabRecord['kind'],
  connectionId: string | null,
  path: string,
  makeState: () => S,
  opts: {
    reuse: boolean;
    recentKind?: RecentTableEntry['kind'];
    workspaceId?: string | null;
    preview?: boolean;
    /** P74 §5.2: a bulk open's own files join the workspace's preview cohort instead of each
     *  replacing the last — never evicts. Ignored when `preview` is falsy. The first file of a
     *  bulk open still passes `preview: true` without this flag, so it alone evicts whatever
     *  cohort/slot preceded it; every file after that passes it, joining what the first just
     *  started. */
    previewCohort?: boolean;
  },
): OpenTabResult {
  const workspaceId = opts.workspaceId ?? null;
  const workspaceKey = (workspaceId ?? TAB_KIND_MODE[kind]) as WorkspaceKey;

  if (opts.reuse) {
    const existing = tabsState.tabs.find(
      (t) =>
        t.kind === kind &&
        t.connectionId === connectionId &&
        t.path === path &&
        (t.workspaceId ?? null) === workspaceId,
    );
    if (existing) {
      activateTab(existing.id);
      // §5.2 rule 1: a permanent (`preview` false/undefined) open of the workspace's own current
      // preview tab promotes it — removed from the cohort, the tab itself is untouched.
      if (!opts.preview) removeFromPreviewCohort(workspaceKey, existing.id);
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
    workspaceId,
    // `kind` and `makeState()`'s return type agree at every call site below — TabRecord's own
    // discriminated union can't express that generically, so this is asserted rather than typed.
  } as unknown as TabRecord;

  if (opts.preview && opts.previewCohort) {
    // P74 §5.2: a bulk open's own file, after the first — joins the cohort at the end, evicts
    // nothing. The first file of the same bulk open passes `previewCohort` unset, so it already
    // did the one eviction this whole batch gets (see that branch below).
    tabsState.tabs.push(record);
    tabsState.previewIdsByWorkspace[workspaceKey] = [
      ...(tabsState.previewIdsByWorkspace[workspaceKey] ?? []),
      id,
    ];
  } else if (opts.preview) {
    const evictedIds = tabsState.previewIdsByWorkspace[workspaceKey] ?? [];
    if (evictedIds.length > 0) {
      // §5.2 rule 3: close-then-insert at the first evicted tab's own array position, never
      // mutate its kind in place — closeTab is the one path that frees page stores/runtime for a
      // discriminated-union record. No clamp against the workspace's pinned tab here: rendering
      // order comes from tabsForWorkspace's own computed partition (§6.1, state/mode.ts) and no
      // longer depends on where a tab physically sits in this array, so this insert can never land
      // a tab left of the graph tab visually regardless of index.
      const evictedIdx = tabsState.tabs.findIndex((t) => t.id === evictedIds[0]);
      const insertAt = evictedIdx < 0 ? tabsState.tabs.length : evictedIdx;
      tabsState.tabs.splice(insertAt, 0, record);
      for (const evictedId of evictedIds) closeTab(evictedId);
    } else {
      // §5.2 rule 4: no preview cohort yet — create at the end.
      tabsState.tabs.push(record);
    }
    tabsState.previewIdsByWorkspace[workspaceKey] = [id];
  } else {
    // §5.2 rule 2: a permanent open never evicts a preview cohort — it is left untouched.
    tabsState.tabs.push(record);
  }

  setActiveTabId(id, workspaceKey);
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

// C5 §6.1: creates workspace `workspaceId`'s pinned graph tab — a plain push that never activates
// it (unlike openTab's own always-active-on-create behavior), so ensureWorkspaceShell
// (state/repoTabs.ts) can decide separately whether to activate it (only when the workspace has no
// active tab at all) — a restored session's own active tab must never be stolen by shell creation.
export function createPinnedRepoGraphTab(workspaceId: string): TabRecord {
  const id = crypto.randomUUID();
  const record = {
    id,
    connectionId: null,
    path: '',
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

// Same target, fresh default state — the cheapest possible demonstration of §8.4's identity rule.
// P1 D4/F12: reads TAB_KINDS[source.kind].duplicateState instead of a seven-branch if/else — each
// kind's own entry already knows what "fresh" means for it (data/document/keyvalue/stream keep the
// source's pageSize; the rest start fully blank).
export function duplicateTab(id: string): string {
  const source = tabsState.tabs.find((t) => t.id === id);
  if (!source) return id;
  if (TAB_KINDS[source.kind].pinned) return id; // §6.1: a pinned tab is never duplicated.

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
    workspaceId: source.workspaceId ?? null,
  } as unknown as TabRecord;
  tabsState.tabs.push(record);
  // P71 §3.1: duplicating an incognito tab to try a variant must not silently start persisting
  // it — the copy carries the flag too.
  if (isIncognito(source.id)) setIncognito(newId, true);
  setActiveTabId(newId, workspaceKeyOf(source));
  tabsState.hydrated.add(newId);
  saveNow();
  return newId;
}

export function closeTab(id: string): void {
  const idx = tabsState.tabs.findIndex((t) => t.id === id);
  if (idx < 0) return;
  const closed = tabsState.tabs[idx];
  if (TAB_KINDS[closed.kind].pinned) return; // §6.1: a pinned tab never closes.
  const key = workspaceKeyOf(closed);
  const wasActive = closed.active;
  // Where the closed tab sat among its own workspace's tabs, not the whole (multi-workspace)
  // array — needed below to pick "whatever landed in its spot" the same way the pre-workspace
  // code did with idx.
  const keyIdxBefore = tabsState.tabs
    .filter((t) => workspaceKeyOf(t) === key)
    .findIndex((t) => t.id === id);

  tabsState.tabs.splice(idx, 1);
  tabsState.hydrated.delete(id);
  dropAllPagesForTab(id); // §2.2: closing a tab frees its cached page(s) immediately.
  clearSelectedCellFor(id);
  clearPending(id);
  // §5.2 rule 5: closing a preview tab removes it from the cohort.
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
  saveNow();
}

// C5 §4.2: closes every tab of workspace `key`, pinned tabs included — the one path that bypasses
// closeTab's own pin guard, since discarding the whole workspace (closeRepoWorkspace,
// state/workspace.ts) is a different act from closing one of its tabs. Never called for
// 'studio'/'api' (those workspaces cannot be closed, only their tabs can).
export function closeWorkspaceTabs(key: WorkspaceKey): void {
  const ids = tabsState.tabs.filter((t) => workspaceKeyOf(t) === key).map((t) => t.id);
  for (const id of ids) {
    tabsState.hydrated.delete(id);
    dropAllPagesForTab(id);
    clearSelectedCellFor(id);
    clearPending(id);
  }
  tabsState.tabs = tabsState.tabs.filter((t) => workspaceKeyOf(t) !== key);
  delete tabsState.activeIdByWorkspace[key];
  delete tabsState.previewIdsByWorkspace[key];
  saveNow();
}

export function closeOthers(id: string): void {
  const keep = tabsState.tabs.find((t) => t.id === id);
  if (!keep) return;
  // Scoped to the kept tab's own workspace (D5, generalised) — "Close others" in one workspace's
  // strip never touches a tab that isn't even rendered there. §6.1: a pinned tab is never closed.
  const key = workspaceKeyOf(keep);
  const closeIds = new Set(
    tabsState.tabs
      .filter((t) => t.id !== id && workspaceKeyOf(t) === key && !TAB_KINDS[t.kind].pinned)
      .map((t) => t.id),
  );
  for (const tabId of closeIds) {
    tabsState.hydrated.delete(tabId);
    dropAllPagesForTab(tabId);
    clearSelectedCellFor(tabId);
    clearPending(tabId);
    removeFromPreviewCohort(key, tabId);
  }
  tabsState.tabs = tabsState.tabs.filter((t) => !closeIds.has(t.id));
  keep.active = true;
  tabsState.activeIdByWorkspace[key] = id;
  saveNow();
}

export function closeToTheRight(id: string): void {
  const target = tabsState.tabs.find((t) => t.id === id);
  if (!target) return;
  const key = workspaceKeyOf(target);
  // "To the right" is a strip-visual concept, so it's computed over tabsForWorkspace's own
  // pinned-first, left-to-right order (§6.1) — for studio/api (no pinned kind ever) this is
  // identical to the old plain per-mode filter, byte for byte.
  const keyTabs = tabsForWorkspace(key);
  const keyIdx = keyTabs.findIndex((t) => t.id === id);
  const closeIds = new Set(
    keyTabs
      .slice(keyIdx + 1)
      .filter((t) => !TAB_KINDS[t.kind].pinned)
      .map((t) => t.id),
  );
  for (const tabId of closeIds) {
    tabsState.hydrated.delete(tabId);
    dropAllPagesForTab(tabId);
    clearSelectedCellFor(tabId);
    clearPending(tabId);
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

export function closeAll(): void {
  // "Close all" always means "in the workspace whose strip this menu opened from" (D5,
  // generalised) — the current workspace, since a tab's context menu can only ever come from a
  // tab actually rendered there. §6.1: a pinned tab survives "Close all".
  const key = workspaceState.active;
  const closeIds = new Set(
    tabsState.tabs
      .filter((t) => workspaceKeyOf(t) === key && !TAB_KINDS[t.kind].pinned)
      .map((t) => t.id),
  );
  for (const tabId of closeIds) {
    tabsState.hydrated.delete(tabId);
    dropAllPagesForTab(tabId);
    clearSelectedCellFor(tabId);
    clearPending(tabId);
  }
  tabsState.tabs = tabsState.tabs.filter((t) => !closeIds.has(t.id));
  tabsState.previewIdsByWorkspace[key] = [];
  const remaining = tabsState.tabs.filter((t) => workspaceKeyOf(t) === key);
  if (remaining.length === 0) {
    // studio/api always land here (no pinned kind exists in either) — byte-identical to the old
    // unconditional `tabsState.activeIdByMode[mode] = null`.
    tabsState.activeIdByWorkspace[key] = null;
  } else if (!remaining.some((t) => t.active)) {
    // A repo workspace's own pinned graph tab is all that's left and nothing marked it active —
    // it becomes the active tab rather than leaving the strip with no selection at all.
    remaining[0].active = true;
    tabsState.activeIdByWorkspace[key] = remaining[0].id;
  }
  saveNow();
}

export function activateTab(id: string): void {
  const target = tabsState.tabs.find((t) => t.id === id);
  if (!target) return;
  setActiveTabId(id, workspaceKeyOf(target));
  saveNow();
}

// Tab-strip drag-reorder: called live on every dragover as the dragged tab crosses another one's
// midpoint, same "splice out, splice in" shape as ColumnsMenu.vue's own column drag. P1 F15: ids,
// not indices — the strip now renders a filtered (per-workspace) view of tabsState.tabs, so an
// index into that view no longer addresses the same element in the underlying array.
export function moveTab(fromId: string, toId: string): void {
  if (fromId === toId) return;
  const tabs = tabsState.tabs;
  const fromIdx = tabs.findIndex((t) => t.id === fromId);
  const toTab = tabs.find((t) => t.id === toId);
  if (fromIdx < 0 || !toTab) return;
  const fromTab = tabs[fromIdx];
  // §6.1: a pinned tab never moves, and nothing may drop in front of one.
  if (TAB_KINDS[fromTab.kind].pinned || TAB_KINDS[toTab.kind].pinned) return;
  // §5.2's own promotion trigger list: starting a drag of the preview tab promotes it before it
  // splices — a tab you deliberately positioned must not vanish on the next single click.
  const key = workspaceKeyOf(fromTab);
  removeFromPreviewCohort(key, fromId);

  const next = [...tabs];
  const [moved] = next.splice(fromIdx, 1);
  const toIdx = next.findIndex((t) => t.id === toId);
  next.splice(toIdx, 0, moved);
  tabsState.tabs = next;
  saveNow();
}

// D11: Control+Tab / Control+Shift+Tab — wraps around at either end, matching the tab strip's own
// left-to-right visual order, scoped to the current workspace's own tabs (D5, generalised).
function stepTab(delta: 1 | -1): void {
  const key = workspaceState.active;
  const tabs = tabsForWorkspace(key);
  if (tabs.length === 0) return;
  const idx = tabs.findIndex((t) => t.id === tabsState.activeIdByWorkspace[key]);
  const next = tabs[(idx + delta + tabs.length) % tabs.length];
  activateTab(next.id);
}

export function activateNextTab(): void {
  stepTab(1);
}

export function activatePrevTab(): void {
  stepTab(-1);
}

// C5 §5.1: what TabStrip.vue renders in italics — a tab is one of its workspace's current
// preview cohort (P74 §5.2: a set now, not one slot).
export function isPreview(id: string): boolean {
  const tab = tabsState.tabs.find((t) => t.id === id);
  if (!tab) return false;
  return (tabsState.previewIdsByWorkspace[workspaceKeyOf(tab)] ?? []).includes(id);
}

// P74 §6: a double click on a preview tab makes it permanent — removes it from the cohort,
// leaving every other previewed tab as replaceable as before. The one place this rule lives, so
// TabStrip.vue's own `@dblclick` binding cannot drift from §5.2's own filters.
export function promoteTab(id: string): void {
  const tab = tabsState.tabs.find((t) => t.id === id);
  if (!tab) return;
  const key = workspaceKeyOf(tab);
  if (!tabsState.previewIdsByWorkspace[key]?.includes(id)) return;
  removeFromPreviewCohort(key, id);
  saveNow();
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
export function patchTabState<S extends object>(
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

// C5 §9.3/§12: revealLine is re-patched (debounced) as the user scrolls/navigates — skipUnchanged
// since Monaco's own scroll events fire far more often than the line actually changes.
export function patchRepoFileTabState(id: string, patch: Partial<RepoFileTabState>): void {
  patchTabState(id, 'repo-file', patch, { skipUnchanged: true });
}

// C10 §8 (S13): TabViewStateStore's own write() — git-ui re-serializes its whole PersistedViewState
// on nearly every interaction (scroll, selection, column resize), so this skips a save when the
// value is reference-unchanged, the same posture patchRepoFileTabState's own revealLine follows.
export function patchRepoGraphTabState(id: string, patch: Partial<RepoGraphTabState>): void {
  patchTabState(id, 'repo-graph', patch, { skipUnchanged: true });
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
