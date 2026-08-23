import type { PageCursor } from '@shared/protocol/data-ops';
import { reactive } from 'vue';
import { control } from '../../bridge/control';
import { data } from '../../bridge/data';
import { findDocumentTab, patchDocumentTabState, unmarkHydrated } from '../../state/tabs';
import { setPage } from './docPage';

// Mirrors views/grid/state.ts's DataViewRuntime shape (status/pager/count), narrowed to what a
// document page actually varies on: no projection, no sort, no column widths — §8.7 gives
// documents one search box, not the grid's full toolbar.
export interface DocumentViewRuntime {
  status: 'idle' | 'loading' | 'error' | 'cancelled';
  error: { code: string; message: string } | null;
  opId: string | null;
  count: { value: number; exact: boolean; stale: boolean } | null;
  rowCount: number;
  hasMore: boolean;
  nextToken: string | null;
  prevToken: string | null;
}

const PAGE_SIZE = 100;

export const runtime = reactive({} as Record<string, DocumentViewRuntime>);

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
      projection: null,
      filter: tab.state.search.trim() === '' ? null : tab.state.search,
      sort: null,
      pageSize: PAGE_SIZE,
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
