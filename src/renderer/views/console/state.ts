import type { Page } from '@shared/protocol/page';
import { reactive } from 'vue';
import { control } from '../../bridge/control';
import { data } from '../../bridge/data';
import { findConsoleTab, patchConsoleTabState, unmarkHydrated } from '../../state/tabs';
import { drop as dropPage, setPage } from './resultPages';

export interface ConsoleViewRuntime {
  status: 'idle' | 'running' | 'error' | 'cancelled';
  error: { code: string; message: string } | null;
  opId: string | null; // the in-flight op, for the stop button
  results: Page[]; // the last run's result pages — runtime-only, never saved (§8.4)
}

export const runtime = reactive({} as Record<string, ConsoleViewRuntime>);

function defaultRuntime(): ConsoleViewRuntime {
  return { status: 'idle', error: null, opId: null, results: [] };
}

// See views/ddl/state.ts's ensureRuntime comment: must return through `runtime[tabId]`, never
// the object literal itself, so mutations land on the reactive proxy Vue actually tracks.
function ensureRuntime(tabId: string): ConsoleViewRuntime {
  if (!runtime[tabId]) {
    runtime[tabId] = defaultRuntime();
  }
  return runtime[tabId];
}

/** `views/grid/page.ts` keys, one per result set of a run — index-aligned with `rt.results`. */
export function resultPageKey(tabId: string, index: number): string {
  return `${tabId}:result:${index}`;
}

function dropResults(tabId: string): void {
  const rt = runtime[tabId];
  if (!rt) return;
  for (let i = 0; i < rt.results.length; i++) dropPage(resultPageKey(tabId, i));
  rt.results = [];
}

export function setText(tabId: string, text: string): void {
  patchConsoleTabState(tabId, { text });
}

const DISCONNECTED_CODES = new Set(['E_NOT_FOUND', 'E_ENGINE_DOWN', 'E_CONNECT']);

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
    response.pages.forEach((page, i) => {
      setPage(resultPageKey(tabId, i), page);
    });
    rt.results = response.pages;
    rt.status = 'idle';
    rt.opId = null;
  } catch (err) {
    if (rt.opId !== opId) return;
    rt.opId = null;
    const code = (err as { code?: string } | undefined)?.code ?? 'E_QUERY';
    const message = err instanceof Error ? err.message : String(err);
    if (code === 'E_CANCELLED') {
      // Same discipline as the data grid's stop button: the previous results stay exactly as
      // they were rather than being blanked.
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

export function stop(tabId: string): void {
  const rt = runtime[tabId];
  if (rt?.opId) void control.opsCancel(rt.opId);
}
