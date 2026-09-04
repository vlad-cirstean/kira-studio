import type { HttpBodyWire, HttpRequestTabState, HttpResponseWire } from '@shared/domain/http';
import { control } from '../../bridge/control';
import { registerTabRuntimeCleanup } from '../../state/tabRuntime';
import { findHttpRequestTab } from '../../state/tabs';
import { classifyLoadError, createRuntimeStore, stopOp } from '../shared/viewOp';

// P3 C2: the still-two-mode state ('none'|'json') translated onto the wire's six-mode union —
// C4 widens the state itself; until then this is the whole of the mapping.
function buildBodyWire(state: HttpRequestTabState): HttpBodyWire {
  const empty: HttpBodyWire = {
    mode: 'none',
    raw: '',
    rawLanguage: '',
    urlEncoded: [],
    formData: [],
    file: '',
    graphql: { query: '', variables: '' },
  };
  if (state.bodyMode === 'json') {
    return { ...empty, mode: 'raw', rawLanguage: 'json', raw: state.body };
  }
  return empty;
}

// D6: the response is runtime-only, never persisted (mirrors consoleTabStateSchema's own results
// comment) — a restored tab's response pane starts empty, exactly like a fresh one.
export interface HttpRequestViewRuntime {
  status: 'idle' | 'running' | 'error' | 'cancelled';
  opId: string | null;
  error: { code: string; message: string } | null;
  response: HttpResponseWire | null;
}

function defaultRuntime(): HttpRequestViewRuntime {
  return { status: 'idle', opId: null, error: null, response: null };
}

const { runtime, ensureRuntime } = createRuntimeStore<HttpRequestViewRuntime>(defaultRuntime);

export { runtime };

registerTabRuntimeCleanup((tabId) => {
  delete runtime[tabId];
});

/** D3: one Send op, run through HttpService.Send → the existing op scheduler — mirrors
 *  console/state.ts's own run() (manual status/opId preamble, no beginOp/applyLoadFailure — D8:
 *  an HTTP failure never touches tabsState.hydrated, since there is no connection to reconnect). */
export async function send(tabId: string): Promise<void> {
  const tab = findHttpRequestTab(tabId);
  if (!tab) return;
  const rt = ensureRuntime(tabId);
  if (rt.status === 'running') return;

  const opId = crypto.randomUUID();
  rt.status = 'running';
  rt.opId = opId;
  rt.error = null;

  const headers = tab.state.headers
    .filter((h) => h.enabled && h.name.trim() !== '')
    .map((h) => ({ name: h.name, value: h.value }));

  try {
    const response = await control.httpSend({
      opId,
      tabId,
      method: tab.state.method,
      url: tab.state.url,
      headers,
      body: buildBodyWire(tab.state),
    });
    if (rt.opId !== opId) return; // superseded by a newer send
    rt.status = 'idle';
    rt.opId = null;
    rt.response = response;
  } catch (err) {
    if (rt.opId !== opId) return;
    rt.opId = null;
    const failure = classifyLoadError(err);
    if (failure.kind === 'cancelled') {
      rt.status = 'cancelled';
      return;
    }
    // D8: httpclient's own error codes never land in viewOp.ts's DISCONNECTED_CODES, so this is
    // never actually 'disconnected' — but even if it were, applyLoadFailure/unmarkHydrated are
    // deliberately not called here: a Reconnect gate has nothing to gate on a connectionless tab.
    rt.status = 'error';
    rt.error = { code: failure.code, message: failure.message };
  }
}

export function stop(tabId: string): void {
  stopOp(runtime[tabId]);
}
