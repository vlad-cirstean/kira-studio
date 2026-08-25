import type { SortSpec } from '@shared/domain/queries';
import type { DataTabState } from '@shared/domain/tabs';
import type { ObjectMeta } from '@shared/domain/tree';
import type { PageCursor } from '@shared/protocol/data-ops';
import { control } from '../../bridge/control';
import { data } from '../../bridge/data';
import { registerTabRuntimeCleanup } from '../../state/tabRuntime';
import { findDataTab, patchDataTabState, unmarkHydrated } from '../../state/tabs';
import {
  registerDataQueryCommands,
  registerTabCount,
  registerTabReload,
  reloadTabsForTarget,
} from '../../state/viewCommands';
import { classifyLoadError, createRuntimeStore, stopOp } from '../shared/viewOp';
import { setPage } from './page';
import { clearPending } from './pendingChanges';

export type Selection =
  | { kind: 'cell'; row: number; col: number }
  | { kind: 'range'; anchorRow: number; anchorCol: number; row: number; col: number }
  | { kind: 'row'; rows: number[] }
  | { kind: 'column'; cols: number[] };

export interface DataViewRuntime {
  status: 'idle' | 'loading' | 'error' | 'cancelled';
  error: { code: string; message: string } | null;
  /** P43 F5/D7: the last *action* (commit) that failed, verbatim from the server. Distinct from
   *  `error`, which describes a failed page *load* — the page on screen is still valid when a
   *  commit is refused, so the view keeps rendering it and shows this above it instead. Cleared by
   *  the next successful action, a load, or a discard (DataToolbar.vue's own onDiscard — resolving
   *  the very staged change the error was about). */
  actionError: string | null;
  opId: string | null; // the in-flight op, for the stop button (D2)
  count: { value: number; exact: boolean; stale: boolean } | null;
  meta: ObjectMeta | null; // from kira:tree:describe (L1) — the projection menu
  lastStrategy: 'keyset' | 'offset';
  nextToken: string | null;
  prevToken: string | null;
  hasMore: boolean;
  selection: Selection | null;
  searchOpen: boolean;
}

function defaultRuntime(): DataViewRuntime {
  return {
    status: 'idle',
    error: null,
    actionError: null,
    opId: null,
    count: null,
    meta: null,
    lastStrategy: 'offset',
    nextToken: null,
    prevToken: null,
    hasMore: false,
    selection: null,
    searchOpen: false,
  };
}

const { runtime, ensureRuntime } = createRuntimeStore<DataViewRuntime>(defaultRuntime);

export { runtime };

// D4: `runtime` is this view's per-tab record — closeTab has no way to import this leaf module
// directly (reality 18), so it registers here instead.
registerTabRuntimeCleanup((tabId) => {
  delete runtime[tabId];
});

/** P43 F5/D7: written by DataToolbar.vue's own catch around commitPending — see actionError's own
 *  doc comment above for why this is a sibling of `error`, not a reuse of it. */
export function setActionError(tabId: string, message: string | null): void {
  const rt = runtime[tabId];
  if (rt) rt.actionError = message;
}

async function loadMeta(tabId: string): Promise<void> {
  const tab = findDataTab(tabId);
  if (!tab?.connectionId) return;
  const rt = ensureRuntime(tabId);
  try {
    const result = await control.treeDescribe(tab.connectionId, tab.path);
    rt.meta = result.meta;
  } catch {
    // The projection menu is a nicety fed by this — a failure here must not block reading rows.
  }
}

export async function load(tabId: string, cursor?: PageCursor): Promise<void> {
  const tab = findDataTab(tabId);
  if (!tab?.connectionId) return;
  const rt = ensureRuntime(tabId);
  // D3: a pending-change set is scoped to the page it was staged against — paging, filtering,
  // sorting or refreshing all replace that page, so whatever was staged no longer identifies
  // anything real and must not silently reappear against different rows.
  clearPending(tabId);

  const effectiveCursor: PageCursor = cursor ?? {
    mode: 'offset',
    offset: tab.state.pageIndex * tab.state.pageSize,
  };
  const opId = crypto.randomUUID();
  rt.status = 'loading';
  rt.opId = opId;
  rt.error = null;
  rt.actionError = null;

  try {
    const response = await data.read({
      opId,
      tabId,
      connectionId: tab.connectionId,
      path: tab.path,
      projection: tab.state.projection,
      filter: tab.state.filter,
      sort: tab.state.sort,
      pageSize: tab.state.pageSize,
      cursor: effectiveCursor,
    });
    if (rt.opId !== opId) return; // superseded by a newer load

    // A 'data' tab only ever exists against a tabular-shaped adapter (Postgres/MariaDB) — Mongo
    // opens a 'document' tab instead (P8) — so this narrows rather than widening setPage/getPage.
    if (response.page.kind !== 'tabular') {
      throw new Error(`unexpected page kind for a data tab: ${response.page.kind}`);
    }
    setPage(tabId, response.page);
    rt.status = 'idle';
    rt.opId = null;
    rt.hasMore = response.page.position.hasMore;
    rt.nextToken = response.page.position.nextToken;
    rt.prevToken = response.page.position.prevToken;
    // 'cursor'/'offsetWindow'/'batch' are keyvalue/stream-page concepts (P9/P10) — a tabular
    // page's own keyset/offset readers never produce them.
    const strategy = response.page.position.strategy;
    if (strategy !== 'keyset' && strategy !== 'offset') {
      throw new Error(`unexpected ${strategy} pagination for a tabular page`);
    }
    rt.lastStrategy = strategy;
    if (!rt.meta) void loadMeta(tabId);
  } catch (err) {
    if (rt.opId !== opId) return;
    rt.opId = null;
    const failure = classifyLoadError(err);
    if (failure.kind === 'cancelled') {
      // A stop button that blanks the grid is worse than the query the user stopped — the
      // previously rendered page stays exactly as it was.
      rt.status = 'cancelled';
      return;
    }
    if (failure.kind === 'disconnected') {
      // Same entry point as a restored tab: one component, two ways in.
      unmarkHydrated(tabId);
      return;
    }
    rt.status = 'error';
    rt.error = { code: failure.code, message: failure.message };
  }
}

// The explicit ↻ Refresh affordance — hard-drops both pages and the count (default `scope: 'all'`).
export async function reload(tabId: string): Promise<void> {
  const tab = findDataTab(tabId);
  if (!tab?.connectionId) return;
  await data.invalidate(tab.connectionId, tab.path);
  await load(tabId, { mode: 'offset', offset: tab.state.pageIndex * tab.state.pageSize });
}

// D18: the post-commit reload. `handleMutate` has already dropped pages and marked the count
// stale server-side (cache.invalidateAfterMutation) — invalidating with `scope: 'pages'` here
// reloads the grid without erasing that stale mark a moment after it was set.
export async function reloadAfterMutation(tabId: string): Promise<void> {
  const tab = findDataTab(tabId);
  if (!tab?.connectionId) return;
  await data.invalidate(tab.connectionId, tab.path, 'pages');
  await load(tabId, { mode: 'offset', offset: tab.state.pageIndex * tab.state.pageSize });
  // §7's "immediately marked stale" needs the toolbar's own `rt.count` mirror to pick up the
  // server-side mark, which nothing else here does. `rt.count?.stale` is still false at this
  // point, so runCount's own `refresh` flag stays false too — this reads the now-stale L3 entry
  // (a cache hit, not a rescan; handleRead/handleCount's contract keeps a hit out of the op log)
  // rather than forcing a real recount. Skipped when this tab never ran a count in the first
  // place — nothing to grey, and nothing cached yet to read this cheaply.
  if (runtime[tabId]?.count) await runCount(tabId);
  // P43 F10/D14: a second tab open on this same table kept rendering rows this commit just
  // changed — this tab is already correcting itself above, so it is the one excepted here.
  reloadTabsForTarget(tab.connectionId, tab.path, tabId);
}

export async function runCount(tabId: string): Promise<void> {
  const tab = findDataTab(tabId);
  if (!tab?.connectionId) return;
  const rt = ensureRuntime(tabId);
  try {
    const response = await data.count({
      opId: crypto.randomUUID(),
      tabId,
      connectionId: tab.connectionId,
      path: tab.path,
      filter: tab.state.filter,
      // D18: a Σ click on an already-fresh count stays an L3 hit; only a stale one bypasses it.
      refresh: rt.count?.stale === true,
    });
    rt.count = { value: response.value, exact: response.exact, stale: response.stale };
  } catch {
    // Leave the previous count (if any) rather than blanking it on a failed refresh.
  }
}

export function stop(tabId: string): void {
  stopOp(runtime[tabId]);
}

export async function goFirst(tabId: string): Promise<void> {
  patchDataTabState(tabId, { pageIndex: 0 });
  await load(tabId, { mode: 'offset', offset: 0 });
}

// D7's cursor choice: prefer the token when one is available, falling back to offset — the
// pager position (`pageIndex`) always advances by one regardless of which strategy served it.
export async function goNext(tabId: string): Promise<void> {
  const tab = findDataTab(tabId);
  if (!tab) return;
  const rt = ensureRuntime(tabId);
  const nextIndex = tab.state.pageIndex + 1;
  const cursor: PageCursor = rt.nextToken
    ? { mode: 'after', token: rt.nextToken }
    : { mode: 'offset', offset: nextIndex * tab.state.pageSize };
  patchDataTabState(tabId, { pageIndex: nextIndex });
  await load(tabId, cursor);
}

export async function goPrev(tabId: string): Promise<void> {
  const tab = findDataTab(tabId);
  if (!tab) return;
  const rt = ensureRuntime(tabId);
  const prevIndex = Math.max(0, tab.state.pageIndex - 1);
  const cursor: PageCursor = rt.prevToken
    ? { mode: 'before', token: rt.prevToken }
    : { mode: 'offset', offset: prevIndex * tab.state.pageSize };
  patchDataTabState(tabId, { pageIndex: prevIndex });
  await load(tabId, cursor);
}

// Requires a count and is offset (pageCount-1)*pageSize (§8c) — the toolbar disables ⏭ until
// Σ has run.
export async function goLast(tabId: string): Promise<void> {
  const tab = findDataTab(tabId);
  const rt = runtime[tabId];
  if (!tab || !rt?.count) return;
  const pageCount = Math.max(1, Math.ceil(rt.count.value / tab.state.pageSize));
  const lastIndex = pageCount - 1;
  patchDataTabState(tabId, { pageIndex: lastIndex });
  await load(tabId, { mode: 'offset', offset: lastIndex * tab.state.pageSize });
}

export async function goToPage(tabId: string, n: number): Promise<void> {
  const tab = findDataTab(tabId);
  if (!tab) return;
  const index = Math.max(0, n);
  patchDataTabState(tabId, { pageIndex: index });
  await load(tabId, { mode: 'offset', offset: index * tab.state.pageSize });
}

// Every state-changing control resets paging to page 0 (§8.5) — page 40 at 100 rows is not
// page 40 at 10 000, and a changed filter/sort/projection invalidates whatever tokens were held.
function resetTokens(tabId: string): void {
  const rt = ensureRuntime(tabId);
  rt.nextToken = null;
  rt.prevToken = null;
}

export async function setPageSize(
  tabId: string,
  pageSize: DataTabState['pageSize'],
): Promise<void> {
  resetTokens(tabId);
  patchDataTabState(tabId, { pageSize, pageIndex: 0 });
  await load(tabId, { mode: 'offset', offset: 0 });
}

export async function setProjection(tabId: string, projection: string[] | null): Promise<void> {
  resetTokens(tabId);
  patchDataTabState(tabId, { projection, pageIndex: 0 });
  await load(tabId, { mode: 'offset', offset: 0 });
}

export async function setFilter(tabId: string, filter: string | null): Promise<void> {
  resetTokens(tabId);
  // P43 F7/D10: a count taken under the previous WHERE is an answer to a different question, not
  // a drifted answer to this one — `stale` (§7) would still leave a wrong `of M` in the pager and
  // still let ⏭ page past the end. Clearing it (not staling it) returns the pager to "page N" with
  // no total, exactly what an un-counted state already looks like. Projection/sort setters below
  // don't do this: neither changes which rows match.
  const rt = ensureRuntime(tabId);
  rt.count = null;
  patchDataTabState(tabId, { filter, pageIndex: 0 });
  await load(tabId, { mode: 'offset', offset: 0 });
}

export async function setSort(tabId: string, sort: SortSpec | null): Promise<void> {
  resetTokens(tabId);
  patchDataTabState(tabId, { sort, pageIndex: 0 });
  await load(tabId, { mode: 'offset', offset: 0 });
}

// Purely a display concern (which page.columns index each display column reads from) — unlike
// projection/filter/sort above, reordering never changes what the query returns, so this neither
// resets tokens nor reloads.
export function setColumnOrder(tabId: string, columnOrder: string[] | null): void {
  patchDataTabState(tabId, { columnOrder });
}

// D5/D6: project/ no longer imports this module directly — it reaches reload/runCount/
// setFilter/setProjection/setSort through state/viewCommands.ts's registry instead.
registerTabReload('data', reload);
registerTabCount('data', runCount);
registerDataQueryCommands({ setFilter, setSort, setProjection });
