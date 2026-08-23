import type { SortSpec } from '@shared/domain/queries';
import type { DocumentTabState } from '@shared/domain/tabs';
import type { PageCursor } from '@shared/protocol/data-ops';
import { reactive } from 'vue';
import { control } from '../../bridge/control';
import { data } from '../../bridge/data';
import { registerTabRuntimeCleanup } from '../../state/tabRuntime';
import { findDocumentTab, patchDocumentTabState, unmarkHydrated } from '../../state/tabs';
import { setPage } from './docPage';

// Mirrors views/grid/state.ts's DataViewRuntime shape (status/pager/count) — projection, sort and
// pageSize now live on DocumentTabState (mirroring DataTabState) rather than being grid-only, so
// `searchOpen` (DataView.vue's precedent) and `selectedRow` (the row published to the cell editor,
// DataGrid.vue's `selection` precedent, narrowed to a single row index since a document has no
// columns to select within) are the only view-local runtime this adds.
export interface DocumentViewRuntime {
  status: 'idle' | 'loading' | 'error' | 'cancelled';
  error: { code: string; message: string } | null;
  opId: string | null;
  count: { value: number; exact: boolean; stale: boolean } | null;
  rowCount: number;
  hasMore: boolean;
  nextToken: string | null;
  prevToken: string | null;
  searchOpen: boolean;
  selectedRow: number | null;
}

export const runtime = reactive({} as Record<string, DocumentViewRuntime>);

// D4: closeTab has no way to import this leaf module directly (reality 18) — registers here.
registerTabRuntimeCleanup((tabId) => {
  delete runtime[tabId];
});

function defaultRuntime(): DocumentViewRuntime {
  return {
    status: 'idle',
    error: null,
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

function ensureRuntime(tabId: string): DocumentViewRuntime {
  if (!runtime[tabId]) runtime[tabId] = defaultRuntime();
  return runtime[tabId];
}

const DISCONNECTED_CODES = new Set(['E_NOT_FOUND', 'E_ENGINE_DOWN', 'E_CONNECT']);

export async function load(tabId: string, cursor?: PageCursor): Promise<void> {
  const tab = findDocumentTab(tabId);
  if (!tab?.connectionId) return;
  const rt = ensureRuntime(tabId);
  const effectiveCursor: PageCursor = cursor ?? { mode: 'offset', offset: 0 };
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
    const code = (err as { code?: string } | undefined)?.code ?? 'E_QUERY';
    const message = err instanceof Error ? err.message : String(err);
    if (code === 'E_CANCELLED') {
      rt.status = 'cancelled';
      return;
    }
    if (DISCONNECTED_CODES.has(code)) {
      unmarkHydrated(tabId);
      return;
    }
    rt.status = 'error';
    rt.error = { code, message };
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
  const rt = runtime[tabId];
  if (rt?.opId) void control.opsCancel(rt.opId);
}

export async function goNext(tabId: string): Promise<void> {
  const rt = ensureRuntime(tabId);
  const cursor: PageCursor = rt.nextToken
    ? { mode: 'after', token: rt.nextToken }
    : { mode: 'offset', offset: 0 };
  await load(tabId, cursor);
}

export async function goPrev(tabId: string): Promise<void> {
  const rt = ensureRuntime(tabId);
  const cursor: PageCursor = rt.prevToken
    ? { mode: 'before', token: rt.prevToken }
    : { mode: 'offset', offset: 0 };
  await load(tabId, cursor);
}

export function setSearch(tabId: string, text: string): void {
  patchDocumentTabState(tabId, { search: text });
  void load(tabId);
}

// Mirrors views/grid/state.ts's setProjection/setSort/setPageSize — a document tab has no
// pageIndex to reset (it pages by cursor token, not an offset counter), so each of these is just
// "patch the tab's own state, then reload from the top" (setSearch's exact precedent above).
export function setProjection(tabId: string, projection: string[] | null): void {
  patchDocumentTabState(tabId, { projection });
  void load(tabId);
}

export function setSort(tabId: string, sort: SortSpec | null): void {
  patchDocumentTabState(tabId, { sort });
  void load(tabId);
}

export function setPageSize(tabId: string, pageSize: DocumentTabState['pageSize']): void {
  patchDocumentTabState(tabId, { pageSize });
  void load(tabId);
}

// The row published to the cell editor (§0 note: cellSelection.ts's "P8/P10 publish into the
// same slot"). A plain runtime field, not tab-persisted state — the same reasoning as the grid's
// own `selection`, which also never round-trips through tabs.save.
export function selectRow(tabId: string, row: number | null): void {
  ensureRuntime(tabId).selectedRow = row;
}

export function toggleExpanded(tabId: string, id: string): void {
  const tab = findDocumentTab(tabId);
  if (!tab) return;
  const expanded = { ...tab.state.expanded, [id]: !tab.state.expanded[id] };
  patchDocumentTabState(tabId, { expanded });
}

export function setAllExpanded(tabId: string, ids: string[], value: boolean): void {
  const expanded: Record<string, boolean> = {};
  for (const id of ids) expanded[id] = value;
  patchDocumentTabState(tabId, { expanded });
}
