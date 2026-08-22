import { toRaw } from 'vue';
import type { ReadRequest } from '@shared/data';
import { countRows as portCount, readPage as portReadPage } from '../../bridge/port';
import { settingsState } from './settings';
import { setTabReadScheduler } from './filters';
import { PageView } from './page';
import {
  findDataTab,
  getPage,
  setPage,
  setTabRuntime,
  updateTabState,
  activeTab,
} from './tabs';

// Tab data orchestration (P2 D9, D21, D26). One function, `loadTabData(tabId, opts)`, drives the
// read + optional count + prefetch lifecycle for a tab. Every read goes through the port's
// readPage, which consults L2; refresh bypasses it. Prefetch is scheduled on idle and cancelled by
// any navigation (D21).

export function initDataScheduler(): void {
  setTabReadScheduler((tabId) => {
    void loadTabData(tabId);
  });
}

// The port payloads must be plain, structured-cloneable objects — the tab state is a Vue reactive
// Proxy (tabsState.tabs is reactive), and a Proxy thrown into postMessage is "could not be cloned".
// toRaw unwraps the proxy; structuredClone then yields plain values (and would throw loudly on
// anything still proxy-shaped).
function plain<T>(value: T): T {
  return structuredClone(toRaw(value)) as T;
}

export async function loadTabData(
  tabId: string,
  opts: { refresh?: boolean; cursor?: ReadRequest['cursor'] } = {},
): Promise<void> {
  const tab = findDataTab(tabId);
  if (!tab) return;

  // D26: any fresh read invalidates the count (it was for the old predicate/page).
  updateTabState(tabId, { totalRows: null, totalExact: false });

  setTabRuntime(tabId, { status: 'loading', error: null });
  cancelPrefetch(tabId);

  const cursor = opts.cursor ?? plain(tab.state.cursor);
  const req: ReadRequest = {
    connectionId: tab.connectionId,
    path: tab.path,
    tabId,
    projection: plain(tab.state.projection),
    where: tab.state.where,
    orderBy: tab.state.orderBy,
    pageSize: tab.state.pageSize,
    cursor,
    refresh: opts.refresh ?? false,
    prefetch: false,
  };

  try {
    const started = performance.now();
    const result = await portReadPage(req);
    if (result.delivered === false) {
      setTabRuntime(tabId, { status: 'error', error: null });
      return;
    }
    const page = result.page;
    const view = new PageView(page, tab.state.columnOrder, tab.state.columnWidths);
    setPage(tabId, view);

    const pageIndex = cursor.kind === 'offset' ? Math.floor(cursor.offset / tab.state.pageSize) + 1 : tab.state.pageIndex;
    updateTabState(tabId, {
      cursor,
      pageIndex: Math.max(1, pageIndex),
    });

    setTabRuntime(tabId, {
      status: 'ready',
      elapsedMs: Math.round(performance.now() - started),
      rowsLoaded: page.rowCount,
      fromCache: page.fromCache,
    });

    // Count on open (D8): only when the tab has no known total and the setting asks for it.
    if (tab.state.totalRows === null && findDataTab(tabId)) {
      const countSetting = settingsState.data.countOnOpen;
      if (countSetting !== 'never') {
        void maybeAutoCount(tabId, countSetting);
      }
    }

    schedulePrefetch(tabId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // D13: a filter error keeps the last good page on screen — the toolbar renders the server's
    // message under the offending input instead of blanking the grid. Only a load with no page yet
    // (first open) flips the tab to the error state.
    if (getPage(tabId)) {
      setTabRuntime(tabId, { status: 'ready', error: message });
    } else {
      setTabRuntime(tabId, { status: 'error', error: message });
    }
  }
}

async function maybeAutoCount(tabId: string, mode: 'estimate' | 'exact'): Promise<void> {
  const tab = findDataTab(tabId);
  if (!tab) return;
  if (tab.state.where.trim() !== '' && mode === 'estimate') return; // D8: no estimate with a filter
  try {
    const result = await portCount({
      connectionId: tab.connectionId,
      path: tab.path,
      tabId,
      where: tab.state.where,
      mode,
      refresh: false,
    });
    updateTabState(tabId, { totalRows: result.value, totalExact: result.exact });
  } catch {
    // A failed count is not a failed tab.
  }
}

export async function countAll(tabId: string): Promise<void> {
  const tab = findDataTab(tabId);
  if (!tab) return;
  updateTabState(tabId, { totalRows: null, totalExact: false });
  await maybeAutoCount(tabId, 'exact');
}

// ---- paging ----
export function pageFirst(tabId: string): void {
  void loadTabData(tabId, { cursor: { kind: 'offset', offset: 0 } });
}

export function pagePrev(tabId: string): void {
  const tab = findDataTab(tabId);
  if (!tab) return;
  const offset = Math.max(0, tab.state.cursor.kind === 'offset' ? tab.state.cursor.offset - tab.state.pageSize : 0);
  void loadTabData(tabId, { cursor: { kind: 'offset', offset } });
}

export function pageNext(tabId: string): void {
  const tab = findDataTab(tabId);
  if (!tab) return;
  const view = getPage(tabId);
  if (view && tab.state.cursor.kind === 'offset') {
    void loadTabData(tabId, { cursor: { kind: 'offset', offset: tab.state.cursor.offset + tab.state.pageSize } });
  }
}

export function pageLast(tabId: string): void {
  const tab = findDataTab(tabId);
  if (!tab || tab.state.totalRows === null) return;
  const lastOffset = Math.max(0, Math.ceil(tab.state.totalRows / tab.state.pageSize) - 1) * tab.state.pageSize;
  void loadTabData(tabId, { cursor: { kind: 'offset', offset: lastOffset } });
}

export function jumpToPage(tabId: string, page: number): void {
  const tab = findDataTab(tabId);
  if (!tab || page < 1) return;
  void loadTabData(tabId, { cursor: { kind: 'offset', offset: (page - 1) * tab.state.pageSize } });
}

// ---- prefetch (D21) ----
const prefetchTimers = new Map<string, number>();

function schedulePrefetch(tabId: string): void {
  const tab = findDataTab(tabId);
  if (!tab) return;
  // Prefetch only the next page when we know there is one (a nextToken or a cursor that is not the
  // last offset). The engine fills L2 and returns no payload.
  const view = getPage(tabId);
  if (!view || view.rowCount < tab.state.pageSize) return;
  if (tab.state.cursor.kind === 'offset') {
    const nextCursor: ReadRequest['cursor'] = { kind: 'offset', offset: tab.state.cursor.offset + tab.state.pageSize };
    schedulePrefetchRequest(tabId, nextCursor);
  }
}

function schedulePrefetchRequest(tabId: string, cursor: ReadRequest['cursor']): void {
  cancelPrefetch(tabId);
  const handle = window.requestIdleCallback(
    () => {
      prefetchTimers.delete(tabId);
      const tab = findDataTab(tabId);
      if (!tab || activeTab()?.id !== tabId) return;
      void portReadPage({
        connectionId: tab.connectionId,
        path: tab.path,
        tabId,
        projection: tab.state.projection,
        where: tab.state.where,
        orderBy: tab.state.orderBy,
        pageSize: tab.state.pageSize,
        cursor,
        refresh: false,
        prefetch: true,
      }).catch(() => {});
    },
    { timeout: 500 },
  );
  prefetchTimers.set(tabId, handle);
}

export function cancelPrefetch(tabId: string): void {
  const handle = prefetchTimers.get(tabId);
  if (handle !== undefined) {
    window.cancelIdleCallback(handle);
    prefetchTimers.delete(tabId);
  }
}

export function cancelAllPrefetches(): void {
  for (const id of prefetchTimers.keys()) cancelPrefetch(id);
}
