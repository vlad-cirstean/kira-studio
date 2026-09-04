import type { GrpcCallHistoryEntry, GrpcCallSnapshot } from '@shared/domain/grpc-history';
import { control } from '../../bridge/control';
import { registerTabRuntimeCleanup } from '../../state/tabRuntime';
import { findGrpcRequestTab } from '../../state/tabs';
import { createRuntimeStore } from '../shared/viewOp';

// P11 D11/D14: the per-tab gRPC history runtime — mirrors views/httprequest/history.ts's own
// shape exactly, over grpc_call_history instead of http_response_history. Never persisted (the
// call result is runtime-only).
export interface GrpcHistoryRuntime {
  entries: GrpcCallHistoryEntry[] | null; // null = never loaded; [] = loaded and empty
  loading: boolean;
  stale: boolean; // a call happened while the pane was not showing
  viewing: { id: string; snapshot: GrpcCallSnapshot } | null;
  error: string | null;
}

function defaultRuntime(): GrpcHistoryRuntime {
  return { entries: null, loading: false, stale: false, viewing: null, error: null };
}

const { runtime, ensureRuntime } = createRuntimeStore<GrpcHistoryRuntime>(defaultRuntime);

export { runtime as grpcHistoryRuntime };

registerTabRuntimeCleanup((tabId) => {
  delete runtime[tabId];
});

function scopeIdsFor(tabId: string): { itemId: string; tabId: string } {
  const tab = findGrpcRequestTab(tabId);
  return { itemId: tab?.state.itemId ?? '', tabId };
}

/** Fetches (or re-fetches) the list for this tab's own scope. */
export async function loadGrpcHistory(tabId: string): Promise<void> {
  const rt = ensureRuntime(tabId);
  rt.loading = true;
  rt.error = null;
  try {
    const { itemId, tabId: tid } = scopeIdsFor(tabId);
    const entries = await control.grpcHistoryList(itemId, tid);
    if (!findGrpcRequestTab(tabId)) return;
    rt.entries = entries;
    rt.stale = false;
  } catch (err) {
    if (!findGrpcRequestTab(tabId)) return;
    rt.error = err instanceof Error ? err.message : String(err);
  } finally {
    if (findGrpcRequestTab(tabId)) rt.loading = false;
  }
}

/** The one initial load a tab's history ever gets unprompted — mirrors
 *  views/httprequest/history.ts's own ensureHistoryLoaded exactly. */
export function ensureGrpcHistoryLoaded(tabId: string): void {
  const rt = ensureRuntime(tabId);
  if (rt.entries === null && !rt.loading) void loadGrpcHistory(tabId);
}

/** D11's refresh policy: eager when the History pane is showing, lazy otherwise. Called once a
 *  call's terminal outcome is known (state.ts's call() success path and its streaming terminal
 *  event handler both call this). */
export function noteGrpcCallRecorded(tabId: string): void {
  const tab = findGrpcRequestTab(tabId);
  const rt = ensureRuntime(tabId);
  if (tab?.state.responsePane === 'history') {
    void loadGrpcHistory(tabId);
  } else {
    rt.stale = true;
  }
}

/** Selects one entry to view — the source swap, mirroring P8 D10. */
export async function viewGrpcHistoryEntry(tabId: string, id: string): Promise<void> {
  const rt = ensureRuntime(tabId);
  try {
    const snapshot = await control.grpcHistoryGet(id);
    if (!findGrpcRequestTab(tabId)) return;
    rt.viewing = { id, snapshot };
  } catch (err) {
    if (!findGrpcRequestTab(tabId)) return;
    rt.error = err instanceof Error ? err.message : String(err);
  }
}

export function backToLatestGrpc(tabId: string): void {
  const rt = runtime[tabId];
  if (rt) rt.viewing = null;
}

export async function deleteGrpcHistoryEntry(tabId: string, id: string): Promise<void> {
  await control.grpcHistoryDelete(id);
  const rt = runtime[tabId];
  if (rt?.viewing?.id === id) rt.viewing = null;
  await loadGrpcHistory(tabId);
}

export async function clearGrpcHistory(tabId: string): Promise<void> {
  const { itemId, tabId: tid } = scopeIdsFor(tabId);
  await control.grpcHistoryClear(itemId, tid);
  const rt = runtime[tabId];
  if (rt) rt.viewing = null;
  await loadGrpcHistory(tabId);
}
