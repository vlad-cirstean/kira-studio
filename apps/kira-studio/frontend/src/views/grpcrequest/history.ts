import type { GrpcCallHistoryEntry, GrpcCallSnapshot } from '@shared/domain/grpc-history';
import { defineStore } from 'pinia';
import { createHistoryQueries } from '../../api/state/history';
import { findGrpcRequestTab } from '../../api/tabs';
import { control } from '../../bridge/control';

// P11 D11/D14, P12 D12, P175 D4: the per-tab gRPC history UI state — mirrors
// views/httprequest/history.ts over grpc_call_history, sharing api/state/history.ts's
// createHistoryQueries (F9). gRPC has no compare selection, so it passes no Extra.
const history = createHistoryQueries<GrpcCallHistoryEntry, GrpcCallSnapshot>({
  domain: 'grpcHistory',
  list: (itemId, tabId) => control.grpcHistoryList(itemId, tabId),
  get: (id) => control.grpcHistoryGet(id),
  remove: (id) => control.grpcHistoryDelete(id),
  clear: (itemId, tabId) => control.grpcHistoryClear(itemId, tabId),
  findTab: findGrpcRequestTab,
});

export const useGrpcHistoryList = history.useHistoryList;
export const useGrpcHistoryViewing = history.useHistoryViewing;

export const useGrpcCallHistoryStore = defineStore('grpcCallHistory', () => {
  const {
    ui,
    view: viewGrpcHistoryEntry,
    backToLatest: backToLatestGrpc,
    noteRecorded: noteGrpcCallRecorded,
    del: deleteGrpcHistoryEntry,
    clearAll: clearGrpcHistory,
  } = history;

  return {
    ui,
    viewGrpcHistoryEntry,
    backToLatestGrpc,
    noteGrpcCallRecorded,
    deleteGrpcHistoryEntry,
    clearGrpcHistory,
  };
});
