import type { PageCursor } from '@shared/protocol/data-ops';
import { reactive } from 'vue';
import { control } from '../../bridge/control';
import { data } from '../../bridge/data';
import { registerTabRuntimeCleanup } from '../../state/tabRuntime';
import { findKeyValueTab, patchKeyValueTabState, unmarkHydrated } from '../../state/tabs';
import { setPage } from './kvPage';

// Mirrors views/documents/state.ts's DataViewRuntime shape, narrowed further: no search box
// (§8.8 names no per-key filter), no expand/collapse memory (the view is read-only, P9's D2).
export interface KeyValueViewRuntime {
  status: 'idle' | 'loading' | 'error' | 'cancelled';
  error: { code: string; message: string } | null;
  opId: string | null;
  count: { value: number; exact: boolean; stale: boolean } | null;
  rowCount: number;
  hasMore: boolean;
  nextToken: string | null;
  prevToken: string | null;
}

const PAGE_SIZE = 100; // one of pageSizeSchema's fixed literals (D24) — mirrors documents/state.ts

export const runtime = reactive({} as Record<string, KeyValueViewRuntime>);

// D4: closeTab has no way to import this leaf module directly (reality 18) — registers here.
registerTabRuntimeCleanup((tabId) => {
  delete runtime[tabId];
});

function defaultRuntime(): KeyValueViewRuntime {
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

function ensureRuntime(tabId: string): KeyValueViewRuntime {
  if (!runtime[tabId]) runtime[tabId] = defaultRuntime();
  return runtime[tabId];
}

const DISCONNECTED_CODES = new Set(['E_NOT_FOUND', 'E_ENGINE_DOWN', 'E_CONNECT']);

export async function load(tabId: string, cursor?: PageCursor): Promise<void> {
  const tab = findKeyValueTab(tabId);
  if (!tab?.connectionId) return;
  const rt = ensureRuntime(tabId);
  const effectiveCursor: PageCursor = cursor ?? {
    mode: 'offset',
    offset: tab.state.pageIndex * PAGE_SIZE,
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
      projection: null,
      filter: null,
      sort: null,
      pageSize: PAGE_SIZE,
      cursor: effectiveCursor,
    });
    if (rt.opId !== opId) return;
    if (response.page.kind !== 'keyvalue') {
      throw new Error(`unexpected page kind for a key/value tab: ${response.page.kind}`);
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
  const tab = findKeyValueTab(tabId);
  if (!tab?.connectionId) return;
  await data.invalidate(tab.connectionId, tab.path);
  await load(tabId);
}

export async function runCount(tabId: string): Promise<void> {
  const tab = findKeyValueTab(tabId);
  if (!tab?.connectionId) return;
  const rt = ensureRuntime(tabId);
  try {
    const response = await data.count({
      opId: crypto.randomUUID(),
      tabId,
      connectionId: tab.connectionId,
      path: tab.path,
      filter: null,
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

// D7's cursor choice, mirrors grid/state.ts's goNext/goPrev: prefer the token when one is
// available (hash/set/zset/stream's cursor strategy), falling back to `pageIndex`-tracked offset
// paging (a list key's LRANGE offset strategy has no token to advance by).
export async function goNext(tabId: string): Promise<void> {
  const tab = findKeyValueTab(tabId);
  if (!tab) return;
  const rt = ensureRuntime(tabId);
  const nextIndex = tab.state.pageIndex + 1;
  const cursor: PageCursor = rt.nextToken
    ? { mode: 'after', token: rt.nextToken }
    : { mode: 'offset', offset: nextIndex * PAGE_SIZE };
  patchKeyValueTabState(tabId, { pageIndex: nextIndex });
  await load(tabId, cursor);
}

export async function goPrev(tabId: string): Promise<void> {
  const tab = findKeyValueTab(tabId);
  if (!tab) return;
  const rt = ensureRuntime(tabId);
  const prevIndex = Math.max(0, tab.state.pageIndex - 1);
  const cursor: PageCursor = rt.prevToken
    ? { mode: 'before', token: rt.prevToken }
    : { mode: 'offset', offset: prevIndex * PAGE_SIZE };
  patchKeyValueTabState(tabId, { pageIndex: prevIndex });
  await load(tabId, cursor);
}
