import type { SortSpec } from '@shared/domain/queries';
import type { PageCursor } from '@shared/protocol/data-ops';
import { registerTabRuntimeCleanup } from '@workbench/state/tabRuntime';
import { defineStore } from 'pinia';
import { data } from '../../bridge/data';
import { pinia } from '../../state/pinia';
import type { DocumentTabState } from '../../state/tabDomain';
import { useTabsStore } from '../../state/tabs';
import { registerTabCount, registerTabReload } from '../../state/viewCommands';
import {
  applyLoadFailure,
  beginOp,
  createRuntimeStore,
  runPagedCount,
  stopOp,
} from '../shared/viewOp';
import { setPage } from './page';

// Mirrors views/grid/state.ts's DataViewRuntime shape (status/pager/count) — projection, sort and
// pageSize now live on DocumentTabState (mirroring DataTabState) rather than being grid-only, so
// `searchOpen` (DataView.vue's precedent) and `selectedRow` (P43 F3/D4: highlight-only local UI
// state, narrowed to a single row index since a document has no columns to select within — this
// view mounts no cell editor dock to publish into at all) are the only view-local runtime this
// adds.
interface DocumentViewRuntime {
  status: 'idle' | 'loading' | 'error' | 'cancelled';
  error: { code: string; message: string } | null;
  /** P43 F6/D7: the last *action* (insert/edit/delete) that failed, verbatim from the server —
   *  sibling to `error` (a failed *load*), never a reuse of it. Cleared by the next successful
   *  action or load. */
  actionError: string | null;
  opId: string | null;
  count: { value: number; exact: boolean; stale: boolean } | null;
  /** P48 F17/D15: the grid's own countOpId guard (P43 F7/D10), ported here — a filter change
   *  since this count started already cleared rt.count/countOpId (setSearch), and an answer to
   *  the previous filter landing now would resurrect a total for the wrong query. */
  countOpId: string | null;
  rowCount: number;
  hasMore: boolean;
  nextToken: string | null;
  prevToken: string | null;
  searchOpen: boolean;
  selectedRow: number | null;
}

function defaultRuntime(): DocumentViewRuntime {
  return {
    status: 'idle',
    error: null,
    actionError: null,
    opId: null,
    count: null,
    countOpId: null,
    rowCount: 0,
    hasMore: false,
    nextToken: null,
    prevToken: null,
    searchOpen: false,
    selectedRow: null,
  };
}

export const useDocumentViewStore = defineStore('documentView', () => {
  const { runtime, ensureRuntime, setActionError, toggleSearchOpen, setSearchOpen } =
    createRuntimeStore<DocumentViewRuntime>(defaultRuntime);

  // D4: closeTab has no way to import this leaf module directly (reality 18) — registers here.
  registerTabRuntimeCleanup((tabId) => {
    delete runtime[tabId];
  });

  // P2 R2 (task #93): mirrors views/grid/state.ts's own `load()` — `revertPageIndexOnFailure`, when
  // given, is the pageIndex this tab was showing before its caller optimistically advanced it. A
  // failed or cancelled load never calls setPage, so without this the pager would show the new page
  // number while the grid still renders the old page's rows.
  async function load(
    tabId: string,
    cursor?: PageCursor,
    revertPageIndexOnFailure?: number,
  ): Promise<void> {
    const tab = useTabsStore().findDocumentTab(tabId);
    if (!tab?.connectionId) return;
    const rt = ensureRuntime(tabId);
    // Mirrors views/grid/state.ts's `load()`: the fallback cursor tracks `pageIndex * pageSize`,
    // not a hardcoded 0 — this is what keeps a bare `load(tabId)` (reload, or any setter below)
    // re-fetching the page the user is actually on instead of silently snapping back to page one.
    // Applies on the default (unsorted/`_id`-sorted) view too (P43 iter2 D24): mongo/read.ts's
    // `skip` now runs on any non-zero offset cursor, not just a real (non-`_id`) sort.
    const effectiveCursor: PageCursor = cursor ?? {
      mode: 'offset',
      offset: tab.state.pageIndex * tab.state.pageSize,
    };
    const opId = beginOp(rt);

    try {
      const response = await data.read({
        opId,
        tabId,
        connectionId: tab.connectionId,
        path: tab.path,
        projection: tab.state.projection,
        filter: tab.state.search.trim() === '' ? null : tab.state.search,
        sort: tab.state.sort,
        pageSize: tab.state.pageSize,
        cursor: effectiveCursor,
      });
      // P12 round 2 finding #3: the tab may have closed while this load was in flight — `rt` is
      // still a live reference to the detached runtime object, so `rt.opId !== opId` alone doesn't
      // catch this and setPage below would leak a page keyed by a tabId nothing can reach again.
      if (!runtime[tabId]) return;
      if (rt.opId !== opId) return;
      if (response.page.kind !== 'document') {
        throw new Error(`unexpected page kind for a document tab: ${response.page.kind}`);
      }

      setPage(tabId, response.page);
      rt.status = 'idle';
      rt.opId = null;
      rt.rowCount = response.page.rowCount;
      rt.hasMore = response.page.position.hasMore;
      rt.nextToken = response.page.position.nextToken;
      rt.prevToken = response.page.position.prevToken;
    } catch (err) {
      const superseded = rt.opId !== opId;
      applyLoadFailure(rt, opId, err, tabId);
      if (!superseded && revertPageIndexOnFailure !== undefined) {
        useTabsStore().patchDocumentTabState(tabId, { pageIndex: revertPageIndexOnFailure });
      }
    }
  }

  async function reload(tabId: string): Promise<void> {
    const tab = useTabsStore().findDocumentTab(tabId);
    if (!tab?.connectionId) return;
    await data.invalidate(tab.connectionId, tab.path);
    await load(tabId);
  }

  async function runCount(tabId: string): Promise<void> {
    const tab = useTabsStore().findDocumentTab(tabId);
    if (!tab?.connectionId) return;
    const connectionId = tab.connectionId;
    const rt = ensureRuntime(tabId);
    await runPagedCount(rt, (opId, refresh) =>
      data.count({
        opId,
        tabId,
        connectionId,
        path: tab.path,
        filter: tab.state.search.trim() === '' ? null : tab.state.search,
        refresh,
      }),
    );
  }

  function stop(tabId: string): void {
    stopOp(runtime[tabId]);
  }

  // D7's cursor choice (views/grid/state.ts's own goNext precedent): prefer the token when one is
  // available, falling back to offset — `pageIndex` always advances by one regardless of which
  // strategy served it. Bug fix: this used to fall back to a hardcoded `offset: 0` whenever
  // `rt.nextToken` was null, which is exactly the case any real (non-`_id`) sort leaves it in
  // (mongo/read.ts's skip/limit fallback never mints a token) — so Next silently reloaded page one
  // forever instead of advancing, which is what "sort doesn't work" looked like once a collection
  // spanned more than one page.
  async function goNext(tabId: string): Promise<void> {
    const tab = useTabsStore().findDocumentTab(tabId);
    if (!tab) return;
    const rt = ensureRuntime(tabId);
    const prevIndex = tab.state.pageIndex;
    const nextIndex = prevIndex + 1;
    const cursor: PageCursor = rt.nextToken
      ? { mode: 'after', token: rt.nextToken }
      : { mode: 'offset', offset: nextIndex * tab.state.pageSize };
    useTabsStore().patchDocumentTabState(tabId, { pageIndex: nextIndex });
    await load(tabId, cursor, prevIndex);
  }

  async function goPrev(tabId: string): Promise<void> {
    const tab = useTabsStore().findDocumentTab(tabId);
    if (!tab) return;
    const rt = ensureRuntime(tabId);
    const prevIndex = tab.state.pageIndex;
    const targetIndex = Math.max(0, prevIndex - 1);
    const cursor: PageCursor = rt.prevToken
      ? { mode: 'before', token: rt.prevToken }
      : { mode: 'offset', offset: targetIndex * tab.state.pageSize };
    useTabsStore().patchDocumentTabState(tabId, { pageIndex: targetIndex });
    await load(tabId, cursor, prevIndex);
  }

  // First/last/jump — mirrors views/grid/state.ts's own goFirst/goLast/goToPage exactly. Mongo
  // supports an arbitrary skip()/limit() offset (unlike Redis's SCAN cursor or Kafka/SQS's
  // per-partition offsets), so a page-N jump is just as meaningful here as it is for SQL.
  async function goFirst(tabId: string): Promise<void> {
    const prevIndex = useTabsStore().findDocumentTab(tabId)?.state.pageIndex;
    useTabsStore().patchDocumentTabState(tabId, { pageIndex: 0 });
    await load(tabId, { mode: 'offset', offset: 0 }, prevIndex);
  }

  // Requires a count, same as the grid's own goLast — the toolbar disables the Last-page button
  // until an exact/estimated count has run.
  async function goLast(tabId: string): Promise<void> {
    const tab = useTabsStore().findDocumentTab(tabId);
    const rt = runtime[tabId];
    if (!tab || !rt?.count) return;
    const prevIndex = tab.state.pageIndex;
    const pageCount = Math.max(1, Math.ceil(rt.count.value / tab.state.pageSize));
    const lastIndex = pageCount - 1;
    useTabsStore().patchDocumentTabState(tabId, { pageIndex: lastIndex });
    await load(tabId, { mode: 'offset', offset: lastIndex * tab.state.pageSize }, prevIndex);
  }

  async function goToPage(tabId: string, n: number): Promise<void> {
    const tab = useTabsStore().findDocumentTab(tabId);
    if (!tab) return;
    const prevIndex = tab.state.pageIndex;
    const index = Math.max(0, n);
    useTabsStore().patchDocumentTabState(tabId, { pageIndex: index });
    await load(tabId, { mode: 'offset', offset: index * tab.state.pageSize }, prevIndex);
  }

  // P43 F8/D11: mirrors views/grid/state.ts's own resetTokens exactly — a keyset token is only
  // meaningful under the query that produced it. On the happy path the very next load() overwrites
  // nextToken/prevToken anyway, which is why this gap was never seen; when that load fails or is
  // superseded (load()'s own `if (rt.opId !== opId) return`), goNext/goPrev would otherwise send a
  // cursor built under the *old* filter/sort/projection. The grid already guards this; this view
  // didn't.
  function resetTokens(tabId: string): void {
    const rt = ensureRuntime(tabId);
    rt.nextToken = null;
    rt.prevToken = null;
  }

  function setSearch(tabId: string, text: string): void {
    const prevIndex = useTabsStore().findDocumentTab(tabId)?.state.pageIndex;
    resetTokens(tabId);
    // P43 F7/D10: same reasoning as views/grid/state.ts's setFilter — a count taken under the
    // previous search text answers a different question, not a drifted answer to this one.
    const rt = ensureRuntime(tabId);
    rt.count = null;
    rt.countOpId = null;
    useTabsStore().patchDocumentTabState(tabId, { search: text, pageIndex: 0 });
    void load(tabId, undefined, prevIndex);
  }

  // Mirrors views/grid/state.ts's setProjection/setSort/setPageSize — each resets `pageIndex` to 0
  // alongside the field it actually changes, same as the grid's own setters, since a new
  // filter/sort/projection/pageSize invalidates whatever "page N" meant under the old one. A
  // document tab pages by cursor token only when the sort is unset or purely by `_id` (mongo/
  // read.ts's D6 keyset strategy); any other sort falls back to skip/limit and `pageIndex` is what
  // goNext/goPrev (above) use to compute that offset.
  function setProjection(tabId: string, projection: string[] | null): void {
    const prevIndex = useTabsStore().findDocumentTab(tabId)?.state.pageIndex;
    resetTokens(tabId);
    useTabsStore().patchDocumentTabState(tabId, { projection, pageIndex: 0 });
    void load(tabId, undefined, prevIndex);
  }

  function setSort(tabId: string, sort: SortSpec | null): void {
    const prevIndex = useTabsStore().findDocumentTab(tabId)?.state.pageIndex;
    resetTokens(tabId);
    useTabsStore().patchDocumentTabState(tabId, { sort, pageIndex: 0 });
    void load(tabId, undefined, prevIndex);
  }

  function setPageSize(tabId: string, pageSize: DocumentTabState['pageSize']): void {
    const prevIndex = useTabsStore().findDocumentTab(tabId)?.state.pageIndex;
    resetTokens(tabId);
    useTabsStore().patchDocumentTabState(tabId, { pageSize, pageIndex: 0 });
    void load(tabId, undefined, prevIndex);
  }

  // P43 F3/D4: the clicked row's own highlight — this view has no cell editor dock to publish a
  // selection into (§8.7: a document's own row is already the read/write surface). A plain runtime
  // field, not tab-persisted state — the same reasoning as the grid's own `selection`, which also
  // never round-trips through tabs.save.
  function selectRow(tabId: string, row: number | null): void {
    ensureRuntime(tabId).selectedRow = row;
  }

  // P27 D2: a document is expanded by default now — `expanded[id] === undefined` means expanded,
  // and only an explicit `false` collapses it. A tab saved under the old semantics (every row
  // missing meant collapsed) reads as `{}`, which under this new reading means "all expanded" —
  // exactly the new default, so no schema change and no migration.
  function isDocumentExpanded(tabId: string, id: string): boolean {
    const tab = useTabsStore().findDocumentTab(tabId);
    return tab ? tab.state.expanded[id] !== false : true;
  }

  function toggleExpanded(tabId: string, id: string): void {
    const tab = useTabsStore().findDocumentTab(tabId);
    if (!tab) return;
    const expanded = { ...tab.state.expanded };
    if (isDocumentExpanded(tabId, id)) {
      expanded[id] = false;
    } else {
      // Back to the default (expanded) — deleting the key keeps the map from growing an entry for
      // every row a user has ever touched, one direction of which never happens with `true`.
      delete expanded[id];
    }
    useTabsStore().patchDocumentTabState(tabId, { expanded });
  }

  // D2/D32: *Expand all* clears the map outright rather than writing one `true` per row — the
  // default is already expanded, so a 10 000-row page writes an empty object to `state_json`
  // instead of 10 000 keys. *Collapse all* is unchanged: it still needs one `false` per row.
  //
  // P21 round 3 functional finding 13: the collapse branch used to *replace* `state.expanded`
  // wholesale with a fresh map containing only `ids` (the currently rendered page) — discarding
  // every `false` entry for a document on any other page. Since an absent key means expanded,
  // paging away and back re-expanded everything collapsed there, and the map is persisted tab
  // state, so this survived a restart as the wrong value. Merging keeps every other page's own
  // collapsed entries intact; the `value === true` branch above is unaffected — clearing the whole
  // map genuinely does mean "everything, everywhere, expanded".
  function setAllExpanded(tabId: string, ids: string[], value: boolean): void {
    if (value) {
      useTabsStore().patchDocumentTabState(tabId, { expanded: {} });
      return;
    }
    const tab = useTabsStore().findDocumentTab(tabId);
    const expanded: Record<string, boolean> = { ...tab?.state.expanded };
    for (const id of ids) expanded[id] = false;
    useTabsStore().patchDocumentTabState(tabId, { expanded });
  }

  return {
    runtime,
    load,
    reload,
    runCount,
    stop,
    goNext,
    goPrev,
    goFirst,
    goLast,
    goToPage,
    setSearch,
    setProjection,
    setSort,
    setPageSize,
    selectRow,
    isDocumentExpanded,
    toggleExpanded,
    setAllExpanded,
    setActionError,
    toggleSearchOpen,
    setSearchOpen,
  };
});

// D5/D6: project/ no longer imports this module directly — it reaches reload/runCount through
// state/viewCommands.ts's registry instead.
registerTabReload('document', (tabId) => useDocumentViewStore(pinia).reload(tabId));
registerTabCount('document', (tabId) => useDocumentViewStore(pinia).runCount(tabId));
