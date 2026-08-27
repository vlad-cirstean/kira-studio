import type { Page } from '@shared/protocol/page';
import { data } from '../../bridge/data';
import { registerTabRuntimeCleanup } from '../../state/tabRuntime';
import { findConsoleTab, patchConsoleTabState, unmarkHydrated } from '../../state/tabs';
import { dropRows, registerDocumentRows, unregisterDocumentRows } from '../shared/document/rows';
import { classifyLoadError, createRuntimeStore, stopOp } from '../shared/viewOp';
import { bumpPageVersion, documentRow, drop as dropPage, getPage, setPage } from './resultPages';

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
  // P42 D11: `${resultKey}:${docId}`, present = expanded. Unlike a Mongo data tab's own
  // documents/state.ts (persisted, default-expanded, P27 D2), a console result set is
  // runtime-only and starts collapsed — a find() result is usually skimmed for shape, and
  // expanding a couple hundred documents by default is a very tall list nobody asked for.
  expandedDocIds: Set<string>;
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
    expandedDocIds: new Set(),
  };
}

const { runtime, ensureRuntime, toggleSearchOpen, setSearchOpen } =
  createRuntimeStore<ConsoleViewRuntime>(defaultRuntime);

export { runtime, setSearchOpen, toggleSearchOpen };

export function isResultDocExpanded(tabId: string, resultKey: string, id: string): boolean {
  return runtime[tabId]?.expandedDocIds.has(`${resultKey}:${id}`) ?? false;
}

export function toggleResultDocExpanded(tabId: string, resultKey: string, id: string): void {
  const rt = ensureRuntime(tabId);
  const key = `${resultKey}:${id}`;
  if (rt.expandedDocIds.has(key)) rt.expandedDocIds.delete(key);
  else rt.expandedDocIds.add(key);
}

// Item (regression pass, task batch P46-4): the expand-all/collapse-all toolbar pair
// DocumentView.vue's own document tab has (its own state.ts's setAllExpanded) — added here once
// the console's document results lost their other way to see a whole document at a glance (the
// cell editor dock, now removed as a redundant second copy of the same DocumentTree, P42 D11).
// Unlike that tab's map (absent = expanded, D2/D32's own comment), this Set's model is the
// opposite — absent = collapsed (this file's own defaultRuntime comment) — so *expand* all adds
// every id instead of clearing the set, and *collapse* all prunes by prefix same as a result close.
export function setAllResultDocsExpanded(
  tabId: string,
  resultKey: string,
  ids: string[],
  expand: boolean,
): void {
  const rt = ensureRuntime(tabId);
  if (!expand) {
    pruneExpandedDocIds(rt, resultKey);
    return;
  }
  for (const id of ids) rt.expandedDocIds.add(`${resultKey}:${id}`);
}

// P43 iter2 F23a: `rt.expandedDocIds` is keyed `${resultKey}:${docId}` — a result's own keys are
// contiguous under one prefix by construction (resultPageKey's `seq` never repeats), so pruning
// by prefix is correct without touching any other result's entries.
function pruneExpandedDocIds(rt: ConsoleViewRuntime, key: string): void {
  const prefix = `${key}:`;
  for (const id of rt.expandedDocIds) {
    if (id.startsWith(prefix)) rt.expandedDocIds.delete(id);
  }
}

// D4/D5: closeTab has no way to import this leaf module directly (reality 18) — registers here.
// state/tabs.ts's dropAllPagesForTab already frees this tab's entries in resultPages.ts's own
// `pages` map directly (P40 D1: rt.results holds only { key, rowCount } now, never a Page, so
// there is no second reference here left to release before the record itself is dropped).
// P43 iter2 F23/D32: dropRows(result.key) is the same release for views/shared/document/rows.ts's
// own per-result parse cache — unregisterDocumentRows alone only drops the *source* pointer
// (rows.ts:25-27's own `rowSources.delete`), leaving every already-parsed document tree for that
// result retained under a key `nextSeq` guarantees is never reused, for the life of the process.
registerTabRuntimeCleanup((tabId) => {
  const rt = runtime[tabId];
  if (rt) {
    for (const result of rt.results) {
      unregisterDocumentRows(result.key);
      dropRows(result.key);
    }
  }
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
  for (const result of rt.results) {
    dropPage(result.key);
    unregisterDocumentRows(result.key);
    dropRows(result.key);
    pruneExpandedDocIds(rt, result.key);
  }
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
  unregisterDocumentRows(key);
  dropRows(key);
  pruneExpandedDocIds(rt, key);
  rt.results.splice(index, 1);
  if (rt.activeKey === key) {
    rt.activeKey = (rt.results[index] ?? rt.results[index - 1])?.key ?? null;
  }
}

/** Result-strip context menu (P42 D8), mirroring TabStrip.vue's own closeOthers/closeToTheRight
 *  over one tab's result sets rather than the app's whole tab list. Keeps `key` active if it
 *  survives; re-selects the last survivor otherwise. */
export function closeOtherResults(tabId: string, key: string): void {
  const rt = runtime[tabId];
  if (!rt) return;
  const keep = rt.results.find((r) => r.key === key);
  if (!keep) return;
  for (const result of rt.results) {
    if (result.key !== key) {
      dropPage(result.key);
      unregisterDocumentRows(result.key);
      dropRows(result.key);
      pruneExpandedDocIds(rt, result.key);
    }
  }
  rt.results = [keep];
  rt.activeKey = key;
}

export function closeResultsToTheRight(tabId: string, key: string): void {
  const rt = runtime[tabId];
  if (!rt) return;
  const index = rt.results.findIndex((r) => r.key === key);
  if (index === -1) return;
  const dropped = rt.results.slice(index + 1);
  for (const result of dropped) {
    dropPage(result.key);
    unregisterDocumentRows(result.key);
    dropRows(result.key);
    pruneExpandedDocIds(rt, result.key);
  }
  rt.results = rt.results.slice(0, index + 1);
  if (dropped.some((r) => r.key === rt.activeKey)) rt.activeKey = key;
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

    // P40 D6, default re-flipped back on P46-2: the toolbar toggle decides append vs. replace — on
    // (the default, shown unpressed — see ConsoleView.vue) keeps stacking each run's result
    // set(s) on top of the last; pressing it drops what came before so every run starts fresh.
    if (!tab.state.newResultSet) dropResults(tabId);
    const newResults = response.pages.map((page) => {
      const key = resultPageKey(tabId, rt.nextSeq++);
      setPage(key, page);
      // P42 D11: a document-kind result renders through views/shared/document/'s row model,
      // which resolves a scope key through a registered source rather than an import — this
      // result's own key is that scope, and resultPages.ts's documentRow is its source.
      if (page.kind === 'document') registerDocumentRows(key, (row) => documentRow(key, row));
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
