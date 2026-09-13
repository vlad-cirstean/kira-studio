import type { GrpcCallHistoryEntry, GrpcCallSnapshot } from '@shared/domain/grpc-history';
import { createHistoryStore } from '../../api/state/history';
import { findGrpcRequestTab } from '../../api/tabs';
import { control } from '../../bridge/control';

// P11 D11/D14, P12 D12: the per-tab gRPC history runtime — mirrors
// views/httprequest/history.ts's own shape exactly, over grpc_call_history instead of
// api_response_history, now sharing api/state/history.ts's createHistoryStore factory rather
// than a second hand-copied 100 lines (F9). gRPC has no compare selection, so it passes no Extra.
const {
  runtime,
  load: loadGrpcHistory,
  ensureFresh: ensureGrpcHistoryFresh,
  noteRecorded: noteGrpcCallRecorded,
  view: viewGrpcHistoryEntry,
  backToLatest: backToLatestGrpc,
  del,
  clearAll,
} = createHistoryStore<GrpcCallHistoryEntry, GrpcCallSnapshot>({
  list: (itemId, tabId) => control.grpcHistoryList(itemId, tabId),
  get: (id) => control.grpcHistoryGet(id),
  remove: (id) => control.grpcHistoryDelete(id),
  clear: (itemId, tabId) => control.grpcHistoryClear(itemId, tabId),
  findTab: findGrpcRequestTab,
});

export {
  backToLatestGrpc,
  ensureGrpcHistoryFresh,
  loadGrpcHistory,
  noteGrpcCallRecorded,
  runtime as grpcHistoryRuntime,
  viewGrpcHistoryEntry,
};

export async function deleteGrpcHistoryEntry(tabId: string, id: string): Promise<void> {
  await del(tabId, id);
}

// P13 D12: reachable from CallHistoryList.vue's own Clear history button, behind the same
// confirmDialog gate HTTP's clearHistory uses — P12's own F23 finding, closed here.
export async function clearGrpcHistory(tabId: string): Promise<void> {
  await clearAll(tabId);
}
