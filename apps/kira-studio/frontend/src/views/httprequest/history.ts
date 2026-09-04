import type {
  ResponseHistoryEntry,
  ResponseHistorySnapshot,
} from '@shared/domain/response-history';
import { control } from '../../bridge/control';
import { createHistoryStore } from '../../http/state/history';
import { findHttpRequestTab } from '../../http/tabs';

// P8 D11/P12 D12: the per-tab history runtime — never persisted (P2 D6's rule applied
// consistently: the response is runtime-only, and a pointer at a stored response is not either).
// What *does* persist is tab.state.responsePane === 'history', a pane choice like the two that
// persist today. The runtime itself, and the seven functions below it, are now a factory call over
// http/state/history.ts's createHistoryStore — HTTP's own extra is the compare selection (D12).
interface Extra {
  /** Compare selection (D12), at most two. */
  selected: string[];
}

const {
  runtime,
  ensure: ensureRuntime,
  load: loadHistory,
  ensureLoaded: ensureHistoryLoaded,
  noteRecorded: noteSendRecorded,
  view: viewHistoryEntry,
  backToLatest,
  del,
  clearAll,
} = createHistoryStore<ResponseHistoryEntry, ResponseHistorySnapshot, Extra>({
  list: (itemId, tabId) => control.historyList(itemId, tabId),
  get: (id) => control.historyGet(id),
  remove: (id) => control.historyDelete(id),
  clear: (itemId, tabId) => control.historyClear(itemId, tabId),
  findTab: findHttpRequestTab,
  extra: () => ({ selected: [] }),
});

export {
  backToLatest,
  ensureHistoryLoaded,
  loadHistory,
  noteSendRecorded,
  runtime as historyRuntime,
  viewHistoryEntry,
};

export async function deleteHistoryEntry(tabId: string, id: string): Promise<void> {
  await del(tabId, id);
  const rt = runtime[tabId];
  if (rt) rt.selected = rt.selected.filter((s) => s !== id);
}

/** D15's destructive, unrecoverable action — the caller gates this behind confirmDialog(). */
export async function clearHistory(tabId: string): Promise<void> {
  await clearAll(tabId);
  const rt = runtime[tabId];
  if (rt) rt.selected = [];
}

/** D12: a checkbox per row, capped at two — toggling a third selected row is a no-op rather than
 *  silently evicting the first (the caller disables an unchecked row's checkbox once two are
 *  already selected, so this is reached only for a check/uncheck of an eligible row). */
export function toggleSelected(tabId: string, id: string): void {
  const rt = ensureRuntime(tabId);
  const i = rt.selected.indexOf(id);
  if (i !== -1) {
    rt.selected.splice(i, 1);
    return;
  }
  if (rt.selected.length >= 2) return;
  rt.selected.push(id);
}
