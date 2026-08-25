import type { Page } from '@shared/protocol/page';
import { data } from '../../bridge/data';
import { registerTabRuntimeCleanup } from '../../state/tabRuntime';
import { findConsoleTab, patchConsoleTabState, unmarkHydrated } from '../../state/tabs';
import { classifyLoadError, createRuntimeStore, stopOp } from '../shared/viewOp';
import { bumpPageVersion, drop as dropPage, getPage, setPage } from './resultPages';

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
  activeKey: string | null; // which result set the single mounted grid shows (P40 D2)
  searchOpen: boolean; // mirrors views/{grid,documents,keyvalue}/state.ts's own flag (P40 D8)
  nextSeq: number; // per-tab monotonic result-set counter (P40 D1) — never reused
}

function defaultRuntime(): ConsoleViewRuntime {
  return {
    status: 'idle',
    error: null,
    opId: null,
    results: [],
    activeKey: null,
    searchOpen: false,
    nextSeq: 0,
  };
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
  rt.activeKey = null;
}

/** The strip's ×  (P40 D5) — drops the result's page (so the retained-byte guard, F21, sees it
 *  freed), removes its entry, and re-selects a neighbour: the next result, else the previous,
 *  else none, mirroring what happens today when a tab ends up with zero results. */
export function closeResult(tabId: string, key: string): void {
  const rt = runtime[tabId];
  if (!rt) return;
  const index = rt.results.findIndex((r) => r.key === key);
  if (index === -1) return;
  dropPage(key);
  rt.results.splice(index, 1);
  if (rt.activeKey === key) {
    rt.activeKey = (rt.results[index] ?? rt.results[index - 1])?.key ?? null;
  }
}

/** Selects which result set the single mounted grid shows (P40 D2). Bumps resultPages'
 *  pageVersion (D9): to every reader of that store — the find toolbar above all — "the page this
 *  scope resolves to has changed" is the same event as a page being replaced under a key. */
export function setActiveResult(tabId: string, key: string): void {
  const rt = runtime[tabId];
  if (!rt) return;
  rt.activeKey = key;
  bumpPageVersion();
}

/** The page the tab's active result set holds — the console's answer to the other three views'
 *  `getPage(tabId)`, and the one place "which of this tab's N pages" is resolved (D9). */
export function activePage(tabId: string): Page | null {
  const rt = runtime[tabId];
  if (!rt?.activeKey) return null;
  return getPage(rt.activeKey);
}

export function setText(tabId: string, text: string): void {
  patchConsoleTabState(tabId, { text });
}

export function setNewResultSet(tabId: string, on: boolean): void {
  patchConsoleTabState(tabId, { newResultSet: on });
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

    // P40 D6: the toolbar toggle decides append vs. replace — off (the default) keeps today's
    // always-replace behavior.
    if (!tab.state.newResultSet) dropResults(tabId);
    const newResults = response.pages.map((page) => {
      const key = resultPageKey(tabId, rt.nextSeq++);
      setPage(key, page);
      return { key, rowCount: page.rowCount };
    });
    rt.results.push(...newResults);
    rt.activeKey = newResults[0]?.key ?? rt.activeKey;
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
