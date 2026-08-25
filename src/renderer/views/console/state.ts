import { data } from '../../bridge/data';
import { registerTabRuntimeCleanup } from '../../state/tabRuntime';
import { findConsoleTab, patchConsoleTabState, unmarkHydrated } from '../../state/tabs';
import { classifyLoadError, createRuntimeStore, stopOp } from '../shared/viewOp';
import { drop as dropPage, setPage } from './resultPages';

/** One result set of a run. `key` is identity and never changes while the result is open — the
 *  "Result N" label the strip prints (P40) is its *position*, which renumbers when a sibling
 *  closes, so it is deliberately not stored here. */
export interface ConsoleResult {
  key: string;
  rowCount: number;
}

export interface ConsoleViewRuntime {
  status: 'idle' | 'running' | 'error' | 'cancelled';
  error: { code: string; message: string } | null;
  opId: string | null; // the in-flight op, for the stop button
  results: ConsoleResult[]; // the last run's result sets — runtime-only, never saved (§8.4)
  nextSeq: number; // per-tab monotonic result-set counter (P40 D1) — never reused
}

function defaultRuntime(): ConsoleViewRuntime {
  return { status: 'idle', error: null, opId: null, results: [], nextSeq: 0 };
}

const { runtime, ensureRuntime } = createRuntimeStore<ConsoleViewRuntime>(defaultRuntime);

export { runtime };

// D4/D5: closeTab has no way to import this leaf module directly (reality 18) — registers here.
// state/tabs.ts's dropAllPagesForTab already frees this tab's entries in resultPages.ts's own
// `pages` map directly (P40 D1: rt.results holds only { key, rowCount } now, never a Page, so
// there is no second reference here left to release before the record itself is dropped).
registerTabRuntimeCleanup((tabId) => {
  delete runtime[tabId];
});

/** `views/grid/page.ts`-style key for one result set. `seq` is the tab's own monotonic
 *  `nextSeq` (P40 D1), not an array index — a result keeps the same key for its whole lifetime
 *  even after an earlier sibling result set closes. */
export function resultPageKey(tabId: string, seq: number): string {
  return `${tabId}:result:${seq}`;
}

function dropResults(tabId: string): void {
  const rt = runtime[tabId];
  if (!rt) return;
  for (const result of rt.results) dropPage(result.key);
  rt.results = [];
}

export function setText(tabId: string, text: string): void {
  patchConsoleTabState(tabId, { text });
}

// One execute() call per run, covering both "Run statement" (one-element array) and "Run all"
// (the caller pre-splits via sql-split.ts) — the adapter's own all-or-nothing semantics (P5.5
// D-plan) mean there is exactly one op-log row and one success/failure outcome per call.
export async function run(tabId: string, statements: string[]): Promise<void> {
  if (statements.length === 0) return;
  const tab = findConsoleTab(tabId);
  if (!tab?.connectionId) return;
  const rt = ensureRuntime(tabId);
  const opId = crypto.randomUUID();
  rt.status = 'running';
  rt.opId = opId;
  rt.error = null;

  try {
    const response = await data.execute({
      opId,
      tabId,
      connectionId: tab.connectionId,
      path: tab.path,
      statements,
    });
    if (rt.opId !== opId) return; // superseded by a newer run

    dropResults(tabId);
    rt.results = response.pages.map((page) => {
      const key = resultPageKey(tabId, rt.nextSeq++);
      setPage(key, page);
      return { key, rowCount: page.rowCount };
    });
    rt.status = 'idle';
    rt.opId = null;
  } catch (err) {
    if (rt.opId !== opId) return;
    rt.opId = null;
    const failure = classifyLoadError(err);
    if (failure.kind === 'cancelled') {
      // Same discipline as the data grid's stop button: the previous results stay exactly as
      // they were rather than being blanked.
      rt.status = 'cancelled';
      return;
    }
    if (failure.kind === 'disconnected') {
      // unmarkHydrated swaps ViewChrome out for ReconnectGate immediately, but `status` still
      // has to drop out of 'running' here — ConsoleView's `running`/`canStop` read it directly,
      // and onReconnectAndLoad only ever calls markHydrated(), never touches `rt`. Left as
      // 'running', the Stop button would come back permanently enabled (and, since it now tints
      // red while live) permanently red the moment the tab reconnects, for as long as the tab
      // stays open.
      rt.status = 'idle';
      unmarkHydrated(tabId);
      return;
    }
    rt.status = 'error';
    rt.error = { code: failure.code, message: failure.message };
  }
}

export function stop(tabId: string): void {
  stopOp(runtime[tabId]);
}
