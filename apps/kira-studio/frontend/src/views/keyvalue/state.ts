import type { PageSize } from '@shared/domain/tabs';
import type { PageCursor } from '@shared/protocol/data-ops';
import { data } from '../../bridge/data';
import { registerTabRuntimeCleanup } from '../../state/tabRuntime';
import { registerTabReload } from '../../state/viewCommands';
import { applyLoadFailure, beginOp, createRuntimeStore, stopOp } from '../shared/viewOp';
import { keyValueHost } from './host';
import { getPage, setPage } from './page';

// Mirrors views/documents/state.ts's DataViewRuntime shape, narrowed further: no expand/collapse
// memory (still no nesting to remember — a redis key's rows are always flat). `searchOpen`
// mirrors grid/state.ts's own field — search toggles a per-tab UI flag, not session state.
//
// P63: keyed by `viewKey`, not `tabId` — a real KeyValue tab's own id, or BrowseView.vue's
// `${tab.id}::preview` for the split's preview pane (host.ts's own seam).
export interface KeyValueViewRuntime {
  status: 'idle' | 'loading' | 'error' | 'cancelled';
  error: { code: string; message: string } | null;
  /** P43 F6/D7: the last *action* (edit/add/delete) that failed, verbatim from the server —
   *  sibling to `error` (a failed *load*), never a reuse of it. Cleared by the next successful
   *  action or load. */
  actionError: string | null;
  opId: string | null;
  count: { value: number; exact: boolean; stale: boolean } | null;
  /** P48 F17/D15: the grid's own countOpId guard (P43 F7/D10), ported here — this view has no
   *  filter to change, but Refresh carries the same late-response race. */
  countOpId: string | null;
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
    countOpId: null,
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
// P63: also drops the browse split's own `${tabId}::preview` entry — that viewKey is not a real
// tab id, so it never closes on its own; it dies only when the browse tab that owns it does.
registerTabRuntimeCleanup((tabId) => {
  delete runtime[tabId];
  delete runtime[`${tabId}::preview`];
});

/** P43 F6/D7: written by KeyValueView.vue's own catch around onDeleteKey — the popover-local
 *  editError/objectSaveError/addError refs already cover the edit/add surfaces (F6's own table),
 *  this is what was missing: delete has no popover to hold a local ref, so it gets the shared
 *  per-tab field every other immediate-mutation view uses. */
export { setActionError };

// P2 R2 (task #93): mirrors views/grid/state.ts's own `load()` — `revertPageIndexOnFailure`, when
// given, is the pageIndex this tab was showing before its caller optimistically advanced it. A
// failed or cancelled load never calls setPage, so without this the pager would show the new page
// number while the grid still renders the old page's rows.
export async function load(
  viewKey: string,
  cursor?: PageCursor,
  revertPageIndexOnFailure?: number,
): Promise<void> {
  const host = keyValueHost(viewKey);
  if (!host?.connectionId) return;
  const rt = ensureRuntime(viewKey);
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
    // only fires for a page that was already cursor-paged. Mirrors KeyValuePane's own
    // prevDisabled, which reads the same `position.strategy` to answer the same question.
    const currentPage = getPage(viewKey);
    if (currentPage && currentPage.position.strategy !== 'offset') {
      effectiveCursor = { mode: 'offset', offset: 0 };
      host.patch({ pageIndex: 0 });
    } else {
      effectiveCursor = { mode: 'offset', offset: host.pageIndex * host.pageSize };
    }
  }
  const opId = beginOp(rt);

  try {
    const response = await data.read({
      opId,
      tabId: viewKey,
      connectionId: host.connectionId,
      path: host.path,
      projection: null,
      filter: null,
      sort: null,
      pageSize: host.pageSize,
      cursor: effectiveCursor,
    });
    // P12 round 2 finding #3: the tab may have closed while this load was in flight — `rt` is
    // still a live reference to the detached runtime object, so `rt.opId !== opId` alone doesn't
    // catch this and setPage below would leak a page keyed by a viewKey nothing can reach again.
    if (!runtime[viewKey]) return;
    if (rt.opId !== opId) return;
    if (response.page.kind !== 'keyvalue') {
      throw new Error(`unexpected page kind for a key/value tab: ${response.page.kind}`);
    }

    setPage(viewKey, response.page);
    rt.status = 'idle';
    rt.opId = null;
    rt.rowCount = response.page.rowCount;
    rt.hasMore = response.page.position.hasMore;
    rt.nextToken = response.page.position.nextToken;
    rt.prevToken = response.page.position.prevToken;
  } catch (err) {
    const superseded = rt.opId !== opId;
    applyLoadFailure(rt, opId, err, viewKey);
    if (!superseded && revertPageIndexOnFailure !== undefined) {
      host.patch({ pageIndex: revertPageIndexOnFailure });
    }
  }
}

export async function reload(viewKey: string): Promise<void> {
  const host = keyValueHost(viewKey);
  if (!host?.connectionId) return;
  await data.invalidate(host.connectionId, host.path);
  await load(viewKey);
}

export async function runCount(viewKey: string): Promise<void> {
  const host = keyValueHost(viewKey);
  if (!host?.connectionId) return;
  const rt = ensureRuntime(viewKey);
  const opId = crypto.randomUUID();
  rt.countOpId = opId;
  try {
    const response = await data.count({
      opId,
      tabId: viewKey,
      connectionId: host.connectionId,
      path: host.path,
      filter: null,
      // D18: a Σ click on an already-fresh count stays an L3 hit; only a stale one bypasses it.
      refresh: rt.count?.stale === true,
    });
    // A Refresh since this count started already stamped a newer countOpId — an answer to the
    // previous request landing now would resurrect a stale total.
    if (rt.countOpId !== opId) return;
    rt.count = { value: response.value, exact: response.exact, stale: response.stale };
  } catch {
    // Leave the previous count (if any) rather than blanking it on a failed refresh.
  }
}

export function stop(viewKey: string): void {
  stopOp(runtime[viewKey]);
}

// D7's cursor choice, mirrors grid/state.ts's goNext/goPrev: prefer the token when one is
// available (hash/set/zset/stream's cursor strategy), falling back to `pageIndex`-tracked offset
// paging (a list key's LRANGE offset strategy has no token to advance by).
export async function goNext(viewKey: string): Promise<void> {
  const host = keyValueHost(viewKey);
  if (!host) return;
  const rt = ensureRuntime(viewKey);
  const prevIndex = host.pageIndex;
  const nextIndex = prevIndex + 1;
  const cursor: PageCursor = rt.nextToken
    ? { mode: 'after', token: rt.nextToken }
    : { mode: 'offset', offset: nextIndex * host.pageSize };
  host.patch({ pageIndex: nextIndex });
  await load(viewKey, cursor, prevIndex);
}

export async function goPrev(viewKey: string): Promise<void> {
  const host = keyValueHost(viewKey);
  if (!host) return;
  const rt = ensureRuntime(viewKey);
  const prevIndex = host.pageIndex;
  const targetIndex = Math.max(0, prevIndex - 1);
  const cursor: PageCursor = rt.prevToken
    ? { mode: 'before', token: rt.prevToken }
    : { mode: 'offset', offset: targetIndex * host.pageSize };
  host.patch({ pageIndex: targetIndex });
  await load(viewKey, cursor, prevIndex);
}

// Mirrors grid/state.ts's setPageSize: resets to the first page and clears whatever cursor
// tokens were held for the old page size (a SCAN cursor from a 100-sized page is not valid
// against a 1000-sized one).
export async function setPageSize(viewKey: string, pageSize: PageSize): Promise<void> {
  const host = keyValueHost(viewKey);
  const prevIndex = host?.pageIndex;
  const rt = ensureRuntime(viewKey);
  rt.nextToken = null;
  rt.prevToken = null;
  host?.patch({ pageSize, pageIndex: 0 });
  await load(viewKey, { mode: 'offset', offset: 0 }, prevIndex);
}

// D5/D6: project/ no longer imports this module directly — it reaches reload through
// state/viewCommands.ts's registry instead.
registerTabReload('keyvalue', reload);
