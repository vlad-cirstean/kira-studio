import type {
  ResponseHistoryEntry,
  ResponseHistorySnapshot,
} from '@shared/domain/response-history';
import { defineStore } from 'pinia';
import { createHistoryQueries } from '../../api/state/history';
import { findHttpRequestTab } from '../../api/tabs';
import { control } from '../../bridge/control';

// P8 D11/P12 D12, P175 D4: the HTTP history's per-tab UI state — the entry being viewed, the last
// action error and the compare selection (D12). Never persisted (P2 D6's rule: the response is
// runtime-only, and a pointer at a stored response is not either); what persists is
// tab.state.responsePane === 'history'. The list and snapshots are server state, in the queries
// api/state/history.ts's createHistoryQueries owns.
interface Extra {
  /** Compare selection (D12), at most two. */
  selected: string[];
}

const history = createHistoryQueries<ResponseHistoryEntry, ResponseHistorySnapshot, Extra>({
  domain: 'httpHistory',
  list: (itemId, tabId) => control.historyList(itemId, tabId),
  get: (id) => control.historyGet(id),
  remove: (id) => control.historyDelete(id),
  clear: (itemId, tabId) => control.historyClear(itemId, tabId),
  findTab: findHttpRequestTab,
  extra: () => ({ selected: [] }),
});

export const useHttpHistoryList = history.useHistoryList;
export const useHttpHistoryViewing = history.useHistoryViewing;

export const useHttpHistoryStore = defineStore('httpHistory', () => {
  const {
    ui,
    ensure,
    view: viewHistoryEntry,
    backToLatest,
    noteRecorded: noteSendRecorded,
  } = history;

  async function deleteHistoryEntry(tabId: string, id: string): Promise<void> {
    await history.del(tabId, id);
    const state = ui[tabId];
    if (state) state.selected = state.selected.filter((s) => s !== id);
  }

  /** D15's destructive, unrecoverable action — the caller gates this behind confirmDialog(). */
  async function clearHistory(tabId: string): Promise<void> {
    await history.clearAll(tabId);
    const state = ui[tabId];
    if (state) state.selected = [];
  }

  /** D12: a checkbox per row, capped at two — toggling a third selected row is a no-op rather than
   *  silently evicting the first (the caller disables an unchecked row's checkbox once two are
   *  already selected, so this is reached only for a check/uncheck of an eligible row). */
  function toggleSelected(tabId: string, id: string): void {
    const state = ensure(tabId);
    const i = state.selected.indexOf(id);
    if (i !== -1) {
      state.selected.splice(i, 1);
      return;
    }
    if (state.selected.length >= 2) return;
    state.selected.push(id);
  }

  return {
    ui,
    viewHistoryEntry,
    backToLatest,
    noteSendRecorded,
    deleteHistoryEntry,
    clearHistory,
    toggleSelected,
  };
});
