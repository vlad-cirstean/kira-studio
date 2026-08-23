import type { PageCursor } from '@shared/protocol/data-ops';
import { reactive } from 'vue';
import { control } from '../../bridge/control';
import { data } from '../../bridge/data';
import { registerTabRuntimeCleanup } from '../../state/tabRuntime';
import { findStreamTab, unmarkHydrated } from '../../state/tabs';
import { setPage } from './streamPage';

// Mirrors views/keyvalue/state.ts's KeyValueViewRuntime shape, minus pageIndex (StreamTabState
// is deliberately empty, §tabs.ts — offsetWindow is always token-driven, batch has no position
// at all) plus `polled`: runtime-only (never persisted) tracking of whether this tab has loaded
// at least once, so SQS's view (caps.pagination === 'batch') can show a "click Poll" placeholder
// until the user explicitly asks for a page (D10/D12 — never auto-loaded).
export interface StreamViewRuntime {
  status: 'idle' | 'loading' | 'error' | 'cancelled';
  error: { code: string; message: string } | null;
  opId: string | null;
  count: { value: number; exact: boolean; stale: boolean } | null;
  rowCount: number;
  hasMore: boolean;
  nextToken: string | null;
  visibilityTimeoutSeconds: number | null;
  polled: boolean;
}

const PAGE_SIZE = 100; // one of pageSizeSchema's fixed literals (D24) — mirrors keyvalue/state.ts

export const runtime = reactive({} as Record<string, StreamViewRuntime>);

// D4: closeTab has no way to import this leaf module directly (reality 18) — registers here.
registerTabRuntimeCleanup((tabId) => {
  delete runtime[tabId];
});

function defaultRuntime(): StreamViewRuntime {
  return {
    status: 'idle',
    error: null,
    opId: null,
    count: null,
    rowCount: 0,
    hasMore: false,
    nextToken: null,
    visibilityTimeoutSeconds: null,
    polled: false,
  };
}

function ensureRuntime(tabId: string): StreamViewRuntime {
  if (!runtime[tabId]) runtime[tabId] = defaultRuntime();
  return runtime[tabId];
}

const DISCONNECTED_CODES = new Set(['E_NOT_FOUND', 'E_ENGINE_DOWN', 'E_CONNECT']);

export async function load(tabId: string, cursor?: PageCursor): Promise<void> {
  const tab = findStreamTab(tabId);
  if (!tab?.connectionId) return;
  const rt = ensureRuntime(tabId);
  const effectiveCursor: PageCursor = cursor ?? { mode: 'offset', offset: 0 };
  const opId = crypto.randomUUID();
  rt.status = 'loading';
  rt.opId = opId;
  rt.error = null;
  rt.polled = true;

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
  const rt = runtime[tabId];
  if (rt?.opId) void control.opsCancel(rt.opId);
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
