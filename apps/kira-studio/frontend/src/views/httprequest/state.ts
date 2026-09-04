import type { HttpBodyWire, HttpRequestTabState, HttpResponseWire } from '@shared/domain/http';
import { control } from '../../bridge/control';
import { itemRecord } from '../../http/state/collections';
import { activeEnvironmentId, cachedVariables } from '../../http/state/variables';
import { type Reference, resolve } from '../../http/substitute';
import { registerTabRuntimeCleanup } from '../../state/tabRuntime';
import { findHttpRequestTab } from '../../state/tabs';
import { classifyLoadError, createRuntimeStore, stopOp } from '../shared/viewOp';

// The state's own five-mode fields, translated onto the wire union. Only the fields the active
// mode's own serializer reads are populated — the rest stay at their zero value, since `Body.Mode`
// is what Go's buildBody() actually switches on (D5: every other member is ignored). D5: only
// enabled, named rows cross the wire (mirrors the header filter just below in send()).
function buildBodyWire(state: HttpRequestTabState): HttpBodyWire {
  const empty: HttpBodyWire = {
    mode: 'none',
    raw: '',
    code: '',
    codeLanguage: '',
    urlEncoded: [],
    formData: [],
    file: '',
  };
  switch (state.bodyMode) {
    case 'none':
      return empty;
    case 'raw':
      return { ...empty, mode: 'raw', raw: state.body };
    case 'code':
      return { ...empty, mode: 'code', codeLanguage: state.codeLanguage, code: state.code };
    case 'urlencoded':
      return {
        ...empty,
        mode: 'urlencoded',
        urlEncoded: state.urlEncoded
          .filter((f) => f.enabled && f.name.trim() !== '')
          .map((f) => ({ name: f.name, value: f.value })),
      };
    case 'formdata':
      return {
        ...empty,
        mode: 'formdata',
        formData: state.formData
          .filter((f) => f.enabled && f.name.trim() !== '')
          .map((f) => ({
            name: f.name,
            kind: f.kind,
            value: f.value,
            path: f.path,
            contentType: f.contentType,
          })),
      };
    case 'file':
      return { ...empty, mode: 'file', file: state.binaryFile?.path ?? '' };
  }
}

// P5 D7: every substitutable field, and only those — a form-data file row's `path` and the `file`
// body's own path are deliberately excluded (D7: a local path is `os.Stat`-checked at send and was
// never seen by any picker if it came from a substituted `{{var}}`, so its failure would name a
// string the user never typed).
function substituteBody(body: HttpBodyWire, sub: (text: string) => string): HttpBodyWire {
  switch (body.mode) {
    case 'raw':
      return { ...body, raw: sub(body.raw) };
    case 'code':
      return { ...body, code: sub(body.code) };
    case 'urlencoded':
      return {
        ...body,
        urlEncoded: body.urlEncoded.map((f) => ({ name: sub(f.name), value: sub(f.value) })),
      };
    case 'formdata':
      return {
        ...body,
        formData: body.formData.map((f) => ({
          ...f,
          name: sub(f.name),
          contentType: sub(f.contentType),
          value: f.kind === 'text' ? sub(f.value) : f.value,
        })),
      };
    default:
      return body;
  }
}

export interface ResolvedRequest {
  url: string;
  headers: { name: string; value: string }[];
  body: HttpBodyWire;
  /** Every reference stage 1 found, across every D7 field — resolved, deferred (a secret, left
   *  for Go), dynamic ($-prefixed, P6), or unknown. */
  refs: Reference[];
}

/** D6 stage 1 / D7: resolves every non-secret {{name}} reference across the URL, enabled headers,
 *  and the active body mode's own substitutable fields — a secret name is left verbatim and
 *  classified 'deferred' (Go finishes it, strictly after op.SetCommand, D6/F3). Pure over its
 *  arguments, called both by send() (to build the wire args) and by HttpRequestView.vue's own
 *  live "unresolved reference" chip (over the same tab state, before a send ever happens). */
export function resolveTabState(
  state: HttpRequestTabState,
  values: Readonly<Record<string, string>>,
  secretNames: readonly string[],
): ResolvedRequest {
  const refs: Reference[] = [];
  const sub = (text: string): string => {
    const result = resolve(text, values, secretNames);
    refs.push(...result.refs);
    return result.text;
  };

  const url = sub(state.url);
  const headers = state.headers
    .filter((h) => h.enabled && h.name.trim() !== '')
    .map((h) => ({ name: sub(h.name), value: sub(h.value) }));
  const body = substituteBody(buildBodyWire(state), sub);

  return { url, headers, body, refs };
}

/** D2's precedence (environment over collection), read from the cache
 *  http/state/variables.ts keeps in step with its own dialog edits — a fresh IPC round trip on
 *  every keystroke of the chip's own preview would be needless; send() calls
 *  ensureVariablesLoaded first so the cache is fresh by the time this runs there. */
export function mergedValuesAndSecrets(
  collectionId: string,
  environmentId: string,
): { values: Record<string, string>; secretNames: string[] } {
  const merged = new Map<string, { value: string; isSecret: boolean }>();
  for (const v of cachedVariables('collection', collectionId)) {
    merged.set(v.name, { value: v.value, isSecret: v.isSecret });
  }
  for (const v of cachedVariables('environment', environmentId)) {
    merged.set(v.name, { value: v.value, isSecret: v.isSecret }); // environment wins
  }
  const values: Record<string, string> = {};
  const secretNames: string[] = [];
  for (const [name, entry] of merged) {
    if (entry.isSecret) secretNames.push(name);
    else values[name] = entry.value;
  }
  return { values, secretNames };
}

/** The collection a tab's own saved row belongs to, or '' for a scratch tab (D6). */
export function collectionIdFor(state: HttpRequestTabState): string {
  if (!state.itemId) return '';
  return itemRecord(state.itemId)?.collectionId ?? '';
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
 *  an HTTP failure never touches tabsState.hydrated, since there is no connection to reconnect).
 *  P5 D6: stage 1 (this function) resolves every non-secret reference before the wire args are
 *  built; collectionId/environmentId travel alongside so Go's stage 2 can finish the rest. */
export async function send(tabId: string): Promise<void> {
  const tab = findHttpRequestTab(tabId);
  if (!tab) return;
  const rt = ensureRuntime(tabId);
  if (rt.status === 'running') return;

  const opId = crypto.randomUUID();
  rt.status = 'running';
  rt.opId = opId;
  rt.error = null;

  const collectionId = collectionIdFor(tab.state);
  const environmentId = activeEnvironmentId.value;
  const { values, secretNames } = mergedValuesAndSecrets(collectionId, environmentId);
  const resolved = resolveTabState(tab.state, values, secretNames);

  try {
    const response = await control.httpSend({
      opId,
      tabId,
      method: tab.state.method,
      url: resolved.url,
      headers: resolved.headers,
      body: resolved.body,
      collectionId,
      environmentId,
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
