import type { KeyValueTabState } from '@shared/domain/tabs';
import type { PageCursor } from '@shared/protocol/data-ops';
import { data } from '../../bridge/data';
import { registerTabRuntimeCleanup } from '../../state/tabRuntime';
import { findKeyValueTab, patchKeyValueTabState } from '../../state/tabs';
import { registerTabReload } from '../../state/viewCommands';
import { applyLoadFailure, beginOp, createRuntimeStore, stopOp } from '../shared/viewOp';
import { getPage, setPage } from './page';

// Mirrors views/documents/state.ts's DataViewRuntime shape, narrowed further: no expand/collapse
// memory (still no nesting to remember — a redis key's rows are always flat). `searchOpen`
// mirrors grid/state.ts's own field — search toggles a per-tab UI flag, not session state.
export interface KeyValueViewRuntime {
  status: 'idle' | 'loading' | 'error' | 'cancelled';
  error: { code: string; message: string } | null;
  /** P43 F6/D7: the last *action* (edit/add/delete) that failed, verbatim from the server —
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
}

function defaultRuntime(): KeyValueViewRuntime {
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
  };
}

const { runtime, ensureRuntime, setActionError, toggleSearchOpen, setSearchOpen } =
  createRuntimeStore<KeyValueViewRuntime>(defaultRuntime);

export { runtime, setSearchOpen, toggleSearchOpen };

// D4: closeTab has no way to import this leaf module directly (reality 18) — registers here.
registerTabRuntimeCleanup((tabId) => {
  delete runtime[tabId];
});

/** P43 F6/D7: written by KeyValueView.vue's own catch around onDeleteKey — the popover-local
 *  editError/objectSaveError/addError refs already cover the edit/add surfaces (F6's own table),
 *  this is what was missing: delete has no popover to hold a local ref, so it gets the shared
 *  per-tab field every other immediate-mutation view uses. */
export { setActionError };

export async function load(tabId: string, cursor?: PageCursor): Promise<void> {
  const tab = findKeyValueTab(tabId);
  if (!tab?.connectionId) return;
  const rt = ensureRuntime(tabId);
  let effectiveCursor: PageCursor;
  if (cursor) {
    effectiveCursor = cursor;
  } else {
    // P43 iter3 D40/F37: a hash/set/zset/stream key's page is cursor-paged (redis/read.ts's
    // readScanFamily/readStream), and an `offset` cursor is neither honoured nor rejected by
    // either — it falls through and silently restarts the scan from the beginning. So a
    // no-cursor load (Refresh, a sibling tab's mutation, a post-Save reload) on any page but the
    // first of a cursor-paged key must ask for page one honestly, by resetting the tab's own
    // pager to match, rather than sending an offset the server ignores while the pager keeps
    // claiming a page further in. A list key's own LRANGE offset strategy is unaffected — this
    // only fires for a page that was already cursor-paged. Mirrors KeyValueView.vue's own
    // prevDisabled, which reads the same `position.strategy` to answer the same question.
    const currentPage = getPage(tabId);
    if (currentPage && currentPage.position.strategy !== 'offset') {
      effectiveCursor = { mode: 'offset', offset: 0 };
      patchKeyValueTabState(tabId, { pageIndex: 0 });
    } else {
      effectiveCursor = { mode: 'offset', offset: tab.state.pageIndex * tab.state.pageSize };
    }
  }
  const opId = beginOp(rt);

  try {
    const response = await data.read({
      opId,
      tabId,
      connectionId: tab.connectionId,
      path: tab.path,
      projection: null,
      filter: null,
      sort: null,
      pageSize: tab.state.pageSize,
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
    applyLoadFailure(rt, opId, err, tabId);
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
  stopOp(runtime[tabId]);
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
    : { mode: 'offset', offset: nextIndex * tab.state.pageSize };
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
    : { mode: 'offset', offset: prevIndex * tab.state.pageSize };
  patchKeyValueTabState(tabId, { pageIndex: prevIndex });
  await load(tabId, cursor);
}

// Mirrors grid/state.ts's setPageSize: resets to the first page and clears whatever cursor
// tokens were held for the old page size (a SCAN cursor from a 100-sized page is not valid
// against a 1000-sized one).
export async function setPageSize(
  tabId: string,
  pageSize: KeyValueTabState['pageSize'],
): Promise<void> {
  const rt = ensureRuntime(tabId);
  rt.nextToken = null;
  rt.prevToken = null;
  patchKeyValueTabState(tabId, { pageSize, pageIndex: 0 });
  await load(tabId, { mode: 'offset', offset: 0 });
}

// D5/D6: project/ no longer imports this module directly — it reaches reload through
// state/viewCommands.ts's registry instead.
registerTabReload('keyvalue', reload);
