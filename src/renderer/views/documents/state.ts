import type { SortSpec } from '@shared/domain/queries';
import type { DocumentTabState } from '@shared/domain/tabs';
import type { PageCursor } from '@shared/protocol/data-ops';
import { data } from '../../bridge/data';
import { registerTabRuntimeCleanup } from '../../state/tabRuntime';
import { findDocumentTab, patchDocumentTabState, unmarkHydrated } from '../../state/tabs';
import { registerTabCount, registerTabReload } from '../../state/viewCommands';
import { classifyLoadError, createRuntimeStore, stopOp } from '../shared/viewOp';
import { setPage } from './page';

// Mirrors views/grid/state.ts's DataViewRuntime shape (status/pager/count) — projection, sort and
// pageSize now live on DocumentTabState (mirroring DataTabState) rather than being grid-only, so
// `searchOpen` (DataView.vue's precedent) and `selectedRow` (P43 F3/D4: highlight-only local UI
// state, narrowed to a single row index since a document has no columns to select within — this
// view mounts no cell editor dock to publish into at all) are the only view-local runtime this
// adds.
export interface DocumentViewRuntime {
  status: 'idle' | 'loading' | 'error' | 'cancelled';
  error: { code: string; message: string } | null;
  /** P43 F6/D7: the last *action* (insert/edit/delete) that failed, verbatim from the server —
   *  sibling to `error` (a failed *load*), never a reuse of it. Cleared by the next successful
   *  action or load. */
  actionError: string | null;
  opId: string | null;
  count: { value: number; exact: boolean; stale: boolean } | null;
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
    rowCount: 0,
    hasMore: false,
    nextToken: null,
    prevToken: null,
    searchOpen: false,
    selectedRow: null,
  };
}

const { runtime, ensureRuntime } = createRuntimeStore<DocumentViewRuntime>(defaultRuntime);

export { runtime };

// D4: closeTab has no way to import this leaf module directly (reality 18) — registers here.
registerTabRuntimeCleanup((tabId) => {
  delete runtime[tabId];
});

/** P43 F6/D7: written by DocumentView.vue's own catches around commitCreate/commitEdit/deleteDocument. */
export function setActionError(tabId: string, message: string | null): void {
  const rt = runtime[tabId];
  if (rt) rt.actionError = message;
}

export async function load(tabId: string, cursor?: PageCursor): Promise<void> {
  const tab = findDocumentTab(tabId);
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
      filter: tab.state.search.trim() === '' ? null : tab.state.search,
      sort: tab.state.sort,
      pageSize: tab.state.pageSize,
      cursor: effectiveCursor,
    });
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
    if (rt.opId !== opId) return;
    rt.opId = null;
    const failure = classifyLoadError(err);
    if (failure.kind === 'cancelled') {
      rt.status = 'cancelled';
      return;
    }
    if (failure.kind === 'disconnected') {
      unmarkHydrated(tabId);
      return;
    }
    rt.status = 'error';
    rt.error = { code: failure.code, message: failure.message };
  }
}

export async function reload(tabId: string): Promise<void> {
  const tab = findDocumentTab(tabId);
  if (!tab?.connectionId) return;
  await data.invalidate(tab.connectionId, tab.path);
  await load(tabId);
}

export async function runCount(tabId: string): Promise<void> {
  const tab = findDocumentTab(tabId);
  if (!tab?.connectionId) return;
  const rt = ensureRuntime(tabId);
  try {
    const response = await data.count({
      opId: crypto.randomUUID(),
      tabId,
      connectionId: tab.connectionId,
      path: tab.path,
      filter: tab.state.search.trim() === '' ? null : tab.state.search,
    });
    rt.count = { value: response.value, exact: response.exact, stale: response.stale };
  } catch {
    // Leave the previous count (if any) rather than blanking it on a failed refresh (estimate
    // path, matching Caps.count === 'estimate-only').
  }
}

export function stop(tabId: string): void {
  stopOp(runtime[tabId]);
}

// D7's cursor choice (views/grid/state.ts's own goNext precedent): prefer the token when one is
// available, falling back to offset — `pageIndex` always advances by one regardless of which
// strategy served it. Bug fix: this used to fall back to a hardcoded `offset: 0` whenever
// `rt.nextToken` was null, which is exactly the case any real (non-`_id`) sort leaves it in
// (mongo/read.ts's skip/limit fallback never mints a token) — so Next silently reloaded page one
// forever instead of advancing, which is what "sort doesn't work" looked like once a collection
// spanned more than one page.
export async function goNext(tabId: string): Promise<void> {
  const tab = findDocumentTab(tabId);
  if (!tab) return;
  const rt = ensureRuntime(tabId);
  const nextIndex = tab.state.pageIndex + 1;
  const cursor: PageCursor = rt.nextToken
    ? { mode: 'after', token: rt.nextToken }
    : { mode: 'offset', offset: nextIndex * tab.state.pageSize };
  patchDocumentTabState(tabId, { pageIndex: nextIndex });
  await load(tabId, cursor);
}

export async function goPrev(tabId: string): Promise<void> {
  const tab = findDocumentTab(tabId);
  if (!tab) return;
  const rt = ensureRuntime(tabId);
  const prevIndex = Math.max(0, tab.state.pageIndex - 1);
  const cursor: PageCursor = rt.prevToken
    ? { mode: 'before', token: rt.prevToken }
    : { mode: 'offset', offset: prevIndex * tab.state.pageSize };
  patchDocumentTabState(tabId, { pageIndex: prevIndex });
  await load(tabId, cursor);
}

// First/last/jump — mirrors views/grid/state.ts's own goFirst/goLast/goToPage exactly. Mongo
// supports an arbitrary skip()/limit() offset (unlike Redis's SCAN cursor or Kafka/SQS's
// per-partition offsets), so a page-N jump is just as meaningful here as it is for SQL.
export async function goFirst(tabId: string): Promise<void> {
  patchDocumentTabState(tabId, { pageIndex: 0 });
  await load(tabId, { mode: 'offset', offset: 0 });
}

// Requires a count, same as the grid's own goLast — the toolbar disables the Last-page button
// until an exact/estimated count has run.
export async function goLast(tabId: string): Promise<void> {
  const tab = findDocumentTab(tabId);
  const rt = runtime[tabId];
  if (!tab || !rt?.count) return;
  const pageCount = Math.max(1, Math.ceil(rt.count.value / tab.state.pageSize));
  const lastIndex = pageCount - 1;
  patchDocumentTabState(tabId, { pageIndex: lastIndex });
  await load(tabId, { mode: 'offset', offset: lastIndex * tab.state.pageSize });
}

export async function goToPage(tabId: string, n: number): Promise<void> {
  const tab = findDocumentTab(tabId);
  if (!tab) return;
  const index = Math.max(0, n);
  patchDocumentTabState(tabId, { pageIndex: index });
  await load(tabId, { mode: 'offset', offset: index * tab.state.pageSize });
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

export function setSearch(tabId: string, text: string): void {
  resetTokens(tabId);
  // P43 F7/D10: same reasoning as views/grid/state.ts's setFilter — a count taken under the
  // previous search text answers a different question, not a drifted answer to this one.
  ensureRuntime(tabId).count = null;
  patchDocumentTabState(tabId, { search: text, pageIndex: 0 });
  void load(tabId);
}

// Mirrors views/grid/state.ts's setProjection/setSort/setPageSize — each resets `pageIndex` to 0
// alongside the field it actually changes, same as the grid's own setters, since a new
// filter/sort/projection/pageSize invalidates whatever "page N" meant under the old one. A
// document tab pages by cursor token only when the sort is unset or purely by `_id` (mongo/
// read.ts's D6 keyset strategy); any other sort falls back to skip/limit and `pageIndex` is what
// goNext/goPrev (above) use to compute that offset.
export function setProjection(tabId: string, projection: string[] | null): void {
  resetTokens(tabId);
  patchDocumentTabState(tabId, { projection, pageIndex: 0 });
  void load(tabId);
}

export function setSort(tabId: string, sort: SortSpec | null): void {
  resetTokens(tabId);
  patchDocumentTabState(tabId, { sort, pageIndex: 0 });
  void load(tabId);
}

export function setPageSize(tabId: string, pageSize: DocumentTabState['pageSize']): void {
  resetTokens(tabId);
  patchDocumentTabState(tabId, { pageSize, pageIndex: 0 });
  void load(tabId);
}

// P43 F3/D4: the clicked row's own highlight — this view has no cell editor dock to publish a
// selection into (§8.7: a document's own row is already the read/write surface). A plain runtime
// field, not tab-persisted state — the same reasoning as the grid's own `selection`, which also
// never round-trips through tabs.save.
export function selectRow(tabId: string, row: number | null): void {
  ensureRuntime(tabId).selectedRow = row;
}

// P27 D2: a document is expanded by default now — `expanded[id] === undefined` means expanded,
// and only an explicit `false` collapses it. A tab saved under the old semantics (every row
// missing meant collapsed) reads as `{}`, which under this new reading means "all expanded" —
// exactly the new default, so no schema change and no migration.
export function isDocumentExpanded(tabId: string, id: string): boolean {
  const tab = findDocumentTab(tabId);
  return tab ? tab.state.expanded[id] !== false : true;
}

export function toggleExpanded(tabId: string, id: string): void {
  const tab = findDocumentTab(tabId);
  if (!tab) return;
  const expanded = { ...tab.state.expanded };
  if (isDocumentExpanded(tabId, id)) {
    expanded[id] = false;
  } else {
    // Back to the default (expanded) — deleting the key keeps the map from growing an entry for
    // every row a user has ever touched, one direction of which never happens with `true`.
    delete expanded[id];
  }
  patchDocumentTabState(tabId, { expanded });
}

// D2/D32: *Expand all* clears the map outright rather than writing one `true` per row — the
// default is already expanded, so a 10 000-row page writes an empty object to `state_json`
// instead of 10 000 keys. *Collapse all* is unchanged: it still needs one `false` per row.
export function setAllExpanded(tabId: string, ids: string[], value: boolean): void {
  if (value) {
    patchDocumentTabState(tabId, { expanded: {} });
    return;
  }
  const expanded: Record<string, boolean> = {};
  for (const id of ids) expanded[id] = false;
  patchDocumentTabState(tabId, { expanded });
}

// D5/D6: project/ no longer imports this module directly — it reaches reload/runCount through
// state/viewCommands.ts's registry instead.
registerTabReload('document', reload);
registerTabCount('document', runCount);
