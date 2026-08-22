import type { SourceText } from '@shared/domain/ddl';
import { reactive } from 'vue';
import { control } from '../../bridge/control';
import { tabsState } from '../../state/tabs';

export interface DdlViewRuntime {
  status: 'idle' | 'loading' | 'error';
  error: string | null; // the raw IPC message, '[CODE] text' and all (§0 note 13)
  source: 'cache' | 'server' | null;
  ddl: SourceText | null;
}

export const runtime = reactive({} as Record<string, DdlViewRuntime>);

function defaultRuntime(): DdlViewRuntime {
  return { status: 'idle', error: null, source: null, ddl: null };
}

function ensureRuntime(tabId: string): DdlViewRuntime {
  let rt = runtime[tabId];
  if (!rt) {
    rt = defaultRuntime();
    runtime[tabId] = rt;
  }
  return rt;
}

function findTab(tabId: string) {
  return tabsState.tabs.find((t) => t.id === tabId && t.kind === 'ddl') ?? null;
}

// Deliberately simpler than the grid's load(): there is no op-id bookkeeping and no supersession
// guard. The only two callers are the view's onMounted and the toolbar's Refresh — no pager, no
// filter, no prefetch to race against.
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
