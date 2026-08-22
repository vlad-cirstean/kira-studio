import type { SortSpec } from '@shared/domain/queries';
import type { DataTabState } from '@shared/domain/tabs';
import type { ObjectMeta } from '@shared/domain/tree';
import type { PageCursor } from '@shared/protocol/data-ops';
import { reactive } from 'vue';
import { control } from '../../bridge/control';
import { data } from '../../bridge/data';
import { settingsState } from '../../state/settings';
import { findDataTab, patchDataTabState, tabsState, unmarkHydrated } from '../../state/tabs';
import { setPage } from './page';

export type Selection =
  | { kind: 'cell'; row: number; col: number }
  | { kind: 'range'; anchorRow: number; anchorCol: number; row: number; col: number }
  | { kind: 'row'; rows: number[] }
  | { kind: 'column'; cols: number[] };

export interface DataViewRuntime {
  status: 'idle' | 'loading' | 'error' | 'cancelled';
  error: { code: string; message: string } | null;
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

export const runtime = reactive({} as Record<string, DataViewRuntime>);

function defaultRuntime(): DataViewRuntime {
  return {
    status: 'idle',
    error: null,
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

function ensureRuntime(tabId: string): DataViewRuntime {
  let rt = runtime[tabId];
  if (!rt) {
    rt = defaultRuntime();
    runtime[tabId] = rt;
  }
  return rt;
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

const DISCONNECTED_CODES = new Set(['E_NOT_FOUND', 'E_ENGINE_DOWN', 'E_CONNECT']);

// Handles for the one pending prefetch per tab (§8's "prefetch the next page ahead of need").
// Keyed by tabId since a prefetch is scoped to whatever page follows the tab's current one.
const prefetchHandles = new Map<string, { idleId: number; opId: string | null }>();

// Exported so DataView.vue's onUnmounted can cancel a still-pending prefetch when its tab is
// switched away from (MainView.vue keys DataView by tab.id, so switching tabs unmounts it).
export function cancelPrefetch(tabId: string): void {
  const pending = prefetchHandles.get(tabId);
  if (!pending) return;
  if (pending.idleId) cancelIdleCallback(pending.idleId);
  if (pending.opId) void control.opsCancel(pending.opId);
  prefetchHandles.delete(tabId);
}

async function runPrefetch(tabId: string): Promise<void> {
  const tab = findDataTab(tabId);
  const rt = runtime[tabId];
  if (!tab?.connectionId || !rt?.hasMore) return;

  const nextIndex = tab.state.pageIndex + 1;
  const cursor: PageCursor = rt.nextToken
    ? { mode: 'after', token: rt.nextToken }
    : { mode: 'offset', offset: nextIndex * tab.state.pageSize };
  const opId = crypto.randomUUID();
  prefetchHandles.set(tabId, { idleId: 0, opId });
  try {
    await data.prefetch({
      opId,
      tabId,
      connectionId: tab.connectionId,
      path: tab.path,
      projection: tab.state.projection,
      filter: tab.state.filter,
      sort: tab.state.sort,
      pageSize: tab.state.pageSize,
      cursor,
    });
  } catch {
    // Best-effort: the user never sees a failed prefetch — the real load simply won't hit cache.
  } finally {
    prefetchHandles.delete(tabId);
  }
}

// Runs once a load settles on a page that has more rows — schedules a background fetch of the
// next page during idle time so the eventual goNext() is a cache hit (D-prefetch). Gated on the
// prefetch setting and on the tab still being the active one (no point warming a background tab).
function schedulePrefetch(tabId: string): void {
  cancelPrefetch(tabId);
  if (!settingsState.data.prefetch) return;
  if (tabId !== tabsState.activeId) return;
  const tab = findDataTab(tabId);
  const rt = runtime[tabId];
  if (!tab?.connectionId || !rt?.hasMore) return;

  const idleId = requestIdleCallback(
    () => {
      prefetchHandles.delete(tabId);
      void runPrefetch(tabId);
    },
    { timeout: 250 },
  );
  prefetchHandles.set(tabId, { idleId, opId: null });
}

export async function load(tabId: string, cursor?: PageCursor): Promise<void> {
  const tab = findDataTab(tabId);
  if (!tab?.connectionId) return;
  // Evaluated before ensureRuntime() creates the entry — true only for this tab's very first
  // load, which is when countOnOpen (§ settings) should trigger a background Σ.
  const isFirstLoad = !runtime[tabId];
  const rt = ensureRuntime(tabId);
  cancelPrefetch(tabId);

  const effectiveCursor: PageCursor = cursor ?? {
    mode: 'offset',
    offset: tab.state.pageIndex * tab.state.pageSize,
  };
  const opId = crypto.randomUUID();
  rt.status = 'loading';
  rt.opId = opId;
  rt.error = null;

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

    setPage(tabId, response.page);
    rt.status = 'idle';
    rt.opId = null;
    rt.hasMore = response.page.position.hasMore;
    rt.nextToken = response.page.position.nextToken;
    rt.prevToken = response.page.position.prevToken;
    rt.lastStrategy = response.page.position.strategy;
    if (!rt.meta) void loadMeta(tabId);
    if (isFirstLoad && settingsState.data.countOnOpen) void runCount(tabId);
    schedulePrefetch(tabId);
  } catch (err) {
    if (rt.opId !== opId) return;
    rt.opId = null;
    const code = (err as { code?: string } | undefined)?.code ?? 'E_QUERY';
    const message = err instanceof Error ? err.message : String(err);
    if (code === 'E_CANCELLED') {
      // A stop button that blanks the grid is worse than the query the user stopped — the
      // previously rendered page stays exactly as it was.
      rt.status = 'cancelled';
      return;
    }
    if (DISCONNECTED_CODES.has(code)) {
      // Same entry point as a restored tab: one component, two ways in.
      unmarkHydrated(tabId);
      return;
    }
    rt.status = 'error';
    rt.error = { code, message };
  }
}

export async function reload(tabId: string): Promise<void> {
  const tab = findDataTab(tabId);
  if (!tab?.connectionId) return;
  await data.invalidate(tab.connectionId, tab.path);
  await load(tabId, { mode: 'offset', offset: tab.state.pageIndex * tab.state.pageSize });
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
    });
    rt.count = { value: response.value, exact: response.exact, stale: response.stale };
  } catch {
    // Leave the previous count (if any) rather than blanking it on a failed refresh.
  }
}

export function stop(tabId: string): void {
  const rt = runtime[tabId];
  if (rt?.opId) void control.opsCancel(rt.opId);
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
  patchDataTabState(tabId, { filter, pageIndex: 0 });
  await load(tabId, { mode: 'offset', offset: 0 });
}

export async function setSort(tabId: string, sort: SortSpec | null): Promise<void> {
  resetTokens(tabId);
  patchDataTabState(tabId, { sort, pageIndex: 0 });
  await load(tabId, { mode: 'offset', offset: 0 });
}
