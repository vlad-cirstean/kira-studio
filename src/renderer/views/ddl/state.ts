import type { SourceText } from '@shared/domain/ddl';
import { reactive } from 'vue';
import { control } from '../../bridge/control';
import { registerTabRuntimeCleanup } from '../../state/tabRuntime';
import { tabsState } from '../../state/tabs';

export interface DdlViewRuntime {
  status: 'idle' | 'loading' | 'error';
  error: string | null; // the raw IPC message, '[CODE] text' and all (§0 note 13)
  source: 'cache' | 'server' | null;
  ddl: SourceText | null;
}

export const runtime = reactive({} as Record<string, DdlViewRuntime>);

// D4: closeTab has no way to import this leaf module directly (reality 18) — registers here.
registerTabRuntimeCleanup((tabId) => {
  delete runtime[tabId];
});

function defaultRuntime(): DdlViewRuntime {
  return { status: 'idle', error: null, source: null, ddl: null };
}

// Returns through `runtime[tabId]` even on creation — never the object literal handed to the
// assignment — so the reference callers mutate is the reactive proxy Vue wraps it in, not the
// raw target. A raw reference's property writes bypass the proxy's set trap entirely: they land
// in the same underlying storage (a later `runtime[tabId]` read sees them) but fire no trigger,
// so nothing re-renders until some unrelated reactive write happens to sweep the view along with
// it. DdlView has no such unrelated write to ride on, unlike the grid's runtime map, where
// `setPage()` re-rendering the page data papers over the same shape of bug on a tab's first load.
function ensureRuntime(tabId: string): DdlViewRuntime {
  if (!runtime[tabId]) {
    runtime[tabId] = defaultRuntime();
  }
  return runtime[tabId];
}

function findTab(tabId: string) {
  return tabsState.tabs.find((t) => t.id === tabId && t.kind === 'ddl') ?? null;
}

// Deliberately simpler than the grid's load(): there is no op-id bookkeeping and no supersession
// guard. The only two callers are the view's onMounted and the toolbar's Refresh — no pager, no
// filter to race against.
export async function load(tabId: string, opts?: { refresh?: boolean }): Promise<void> {
  const tab = findTab(tabId);
  if (!tab?.connectionId) return;
  const rt = ensureRuntime(tabId);
  rt.status = 'loading';
  rt.error = null;

  try {
    const response = await control.treeDdl(tab.connectionId, tab.path, opts?.refresh);
    rt.ddl = response.ddl;
    rt.source = response.source;
    rt.status = 'idle';
  } catch (err) {
    // On error this stores the message and nothing else (§0 note 13). It does not parse the
    // [CODE] prefix and does not call unmarkHydrated: the reconnect gate is computed from
    // connectionsState.states[…].status, which the engine's own connection:state event already
    // flips when a connection dies (§0 note 14), so the disconnected case corrects itself here.
    rt.status = 'error';
    rt.error = err instanceof Error ? err.message : String(err);
  }
}
