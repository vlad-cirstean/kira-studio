import { encodeKafkaStreamFilter } from '@shared/domain/streamFilter';
import type { PageSize } from '@shared/domain/tabs';
import type { PageCursor } from '@shared/protocol/data-ops';
import { data } from '../../bridge/data';
import { connectionsState } from '../../state/connections';
import { registerTabRuntimeCleanup } from '../../state/tabRuntime';
import { findStreamTab, patchStreamTabState, unmarkHydrated } from '../../state/tabs';
import { registerTabReload } from '../../state/viewCommands';
import { classifyLoadError, createRuntimeStore, stopOp } from '../shared/viewOp';
import { setPage } from './page';
import { recordStreamFilterUse } from './streamFilterHistory';

// Mirrors views/keyvalue/state.ts's KeyValueViewRuntime shape, minus pageIndex (StreamTabState
// is deliberately empty, §tabs.ts — offsetWindow is always token-driven, batch has no position
// at all) plus `polled`: runtime-only (never persisted) tracking of whether this tab has loaded
// at least once, so SQS's view (caps.pagination === 'batch') can show a "click Poll" placeholder
// until the user explicitly asks for a page (D10/D12 — never auto-loaded).
export interface StreamViewRuntime {
  status: 'idle' | 'loading' | 'error' | 'cancelled';
  error: { code: string; message: string } | null;
  /** P43 F6/D7: the last *action* (SQS delete) that failed, verbatim from the server — sibling to
   *  `error` (a failed *load*), never a reuse of it. Cleared by the next successful action or
   *  load. */
  actionError: string | null;
  opId: string | null;
  count: { value: number; exact: boolean; stale: boolean } | null;
  rowCount: number;
  hasMore: boolean;
  nextToken: string | null;
  visibilityTimeoutSeconds: number | null;
  polled: boolean;
  /** Mirrors grid/state.ts's own field — a runtime UI flag, never session state (item 5). */
  searchOpen: boolean;
  /** The row last clicked, for the cell-editor preview (item 6) and — for SQS — Delete message's
   *  target; `null` once the page reloads out from under it (see stream/page.ts's pageVersion). */
  selectedRow: number | null;
}

function defaultRuntime(): StreamViewRuntime {
  return {
    status: 'idle',
    error: null,
    actionError: null,
    opId: null,
    count: null,
    rowCount: 0,
    hasMore: false,
    nextToken: null,
    visibilityTimeoutSeconds: null,
    polled: false,
    searchOpen: false,
    selectedRow: null,
  };
}

const { runtime, ensureRuntime } = createRuntimeStore<StreamViewRuntime>(defaultRuntime);

export { runtime };

// D4: closeTab has no way to import this leaf module directly (reality 18) — registers here.
registerTabRuntimeCleanup((tabId) => {
  delete runtime[tabId];
});

/** P43 F6/D7: written by StreamView.vue's own catch around onDeleteMessage (SQS only — Kafka/
 *  RabbitMQ have no addressable delete). */
export function setActionError(tabId: string, message: string | null): void {
  const rt = runtime[tabId];
  if (rt) rt.actionError = message;
}

export async function load(tabId: string, cursor?: PageCursor): Promise<void> {
  const tab = findStreamTab(tabId);
  if (!tab?.connectionId) return;
  const rt = ensureRuntime(tabId);
  const effectiveCursor: PageCursor = cursor ?? { mode: 'offset', offset: 0 };
  const opId = crypto.randomUUID();
  rt.status = 'loading';
  rt.opId = opId;
  rt.error = null;
  rt.actionError = null;
  rt.polled = true;

  // Kafka-only (item 2); always null for SQS, since StreamView.vue never lets an SQS tab's three
  // filter fields become non-null in the first place — encodeKafkaStreamFilter itself would still
  // collapse them to null even if it did.
  // P31 D14/F17: Date.parse returns NaN for junk, and isEmptyKafkaStreamFilter's own `!== null`
  // check doesn't catch it — a NaN would silently ride through encodeKafkaStreamFilter (JSON.
  // stringify turns it into `null` on the wire, so the engine reads "no timestamp filter" while
  // the field looks applied). StreamView.vue validates before ever calling load(), but this guard
  // makes the wire payload honest regardless of caller.
  const parsedTimestampMs =
    tab.state.timestampFilter === null ? null : Date.parse(tab.state.timestampFilter);
  const filter = encodeKafkaStreamFilter({
    offset: tab.state.offsetFilter,
    partitions: tab.state.partitions,
    timestampMs: Number.isNaN(parsedTimestampMs) ? null : parsedTimestampMs,
  });

  try {
    const response = await data.read({
      opId,
      tabId,
      connectionId: tab.connectionId,
      path: tab.path,
      projection: null,
      filter,
      sort: null,
      pageSize: tab.state.pageSize,
      cursor: effectiveCursor,
    });
    if (rt.opId !== opId) return;
    if (response.page.kind !== 'stream') {
      throw new Error(`unexpected page kind for a stream tab: ${response.page.kind}`);
    }

    setPage(tabId, response.page);
    rt.status = 'idle';
    rt.opId = null;
    rt.rowCount = response.page.rowCount;
    rt.hasMore = response.page.position.hasMore;
    rt.nextToken = response.page.position.nextToken;
    rt.visibilityTimeoutSeconds = response.page.visibilityTimeoutSeconds;
    rt.selectedRow = null; // a fresh page invalidates whatever row index used to be selected
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
  const tab = findStreamTab(tabId);
  if (!tab?.connectionId) return;
  await data.invalidate(tab.connectionId, tab.path);
  await load(tabId);
}

export async function runCount(tabId: string): Promise<void> {
  const tab = findStreamTab(tabId);
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

// D10: SQS's toolbar calls this directly from an explicit "Poll" click — same operation as
// `load`, named separately so the view never has to explain why a batch-strategy tab "loads".
export async function poll(tabId: string): Promise<void> {
  await load(tabId);
}

// Kafka's offsetWindow strategy is always token-driven (no plain-offset fallback — a browse
// tab has no addressable position to go back to, per the ground rules' forward-only browsing).
export async function goNext(tabId: string): Promise<void> {
  const rt = runtime[tabId];
  if (!rt?.nextToken) return;
  await load(tabId, { mode: 'after', token: rt.nextToken });
}

// Item 1: mirrors grid/state.ts's/keyvalue/state.ts's own setPageSize — reset whatever
// continuation token was held for the old size (never valid against a different one), persist the
// new size, and start over from the top. SQS's `batch` pagination has no continuation to reset and
// is never auto-loaded (D10/D12) — changing the size there just takes effect on the next Poll.
export async function setPageSize(tabId: string, pageSize: PageSize): Promise<void> {
  const tab = findStreamTab(tabId);
  if (!tab) return;
  const rt = ensureRuntime(tabId);
  rt.nextToken = null;
  patchStreamTabState(tabId, { pageSize });
  const caps = tab.connectionId ? connectionsState.states[tab.connectionId]?.caps : null;
  if (caps?.pagination === 'batch') return;
  if (!rt.polled) return; // mirrors onMounted's own guard — never auto-load before the first view
  await load(tabId, { mode: 'offset', offset: 0 });
}

export interface StreamFilterInput {
  offset: string | null;
  partitions: number[];
  timestamp: string | null;
}

// Item 2 — Kafka-only (StreamView.vue only renders the filter row, and thus only ever calls this,
// when connection.kind === 'kafka'). Mirrors grid/state.ts's setFilter: reset the continuation
// token, persist, record it in the (session-only) filter history, and restart the browse fresh —
// a filter changes which messages a *new* browse would see, so continuing an old token under it
// would silently ignore it.
export async function applyStreamFilter(tabId: string, filter: StreamFilterInput): Promise<void> {
  const tab = findStreamTab(tabId);
  if (!tab?.connectionId) return;
  const rt = ensureRuntime(tabId);
  rt.nextToken = null;
  patchStreamTabState(tabId, {
    offsetFilter: filter.offset,
    partitions: filter.partitions,
    timestampFilter: filter.timestamp,
  });
  recordStreamFilterUse(tab.connectionId, tab.path, filter);
  await load(tabId, { mode: 'offset', offset: 0 });
}

// Item 6: the row last clicked — StreamView.vue pairs this with cellSelection.ts's
// publishSelectedCell(). Kept here (rather than only local component state) so SQS's Delete
// message toolbar action, which lives beside the row list but isn't itself a per-row control, can
// read the same target.
export function selectRow(tabId: string, row: number | null): void {
  ensureRuntime(tabId).selectedRow = row;
}

// D5/D6: project/ no longer imports this module directly — it reaches reload through
// state/viewCommands.ts's registry instead.
registerTabReload('stream', reload);
