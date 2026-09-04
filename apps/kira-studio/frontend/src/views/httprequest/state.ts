import type {
  HttpBodyWire,
  HttpMethod,
  HttpRequestTabState,
  HttpResponseWire,
} from '@shared/domain/http';
import { control } from '../../bridge/control';
import { loadDynamicGenerator } from '../../http/dynamic/catalog';
import { itemRecord } from '../../http/state/collections';
import { activeEnvironmentId, cachedVariables } from '../../http/state/variables';
import { type Reference, resolve } from '../../http/substitute';
import { type ResolvedRequest, substituteBody } from '../../http/substituteRequest';
import { registerTabRuntimeCleanup } from '../../state/tabRuntime';
import { findHttpRequestTab } from '../../state/tabs';
import { classifyLoadError, createRuntimeStore, stopOp } from '../shared/viewOp';

export type { ResolvedRequest } from '../../http/substituteRequest';

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

/** D6 stage 1 / D7: resolves every non-secret {{name}} reference across the URL, enabled headers,
 *  and the active body mode's own substitutable fields — a secret name is left verbatim and
 *  classified 'deferred' (Go finishes it, strictly after op.SetCommand, D6/F3). Pure over its
 *  arguments, called both by send() (to build the wire args) and by HttpRequestView.vue's own
 *  live "unresolved reference" chip (over the same tab state, before a send ever happens).
 *
 *  P6 D2: `dynamic`, when supplied, is send()'s own {{$name}} generator callback — forwarded to
 *  every `resolve()` call this function makes, unchanged. HttpRequestView.vue's live preview never
 *  supplies it (F2: the chip must never generate a value, so it always calls this with three
 *  arguments, never four). */
export function resolveTabState(
  state: HttpRequestTabState,
  values: Readonly<Record<string, string>>,
  secretNames: readonly string[],
  dynamic?: (name: string) => string | null,
): ResolvedRequest {
  const refs: Reference[] = [];
  const sub = (text: string): string => {
    const result = resolve(text, values, secretNames, dynamic);
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
  // P6 D7: the common case — no {{$...}} reference at all — is byte-for-byte today's behaviour:
  // no await, no dynamic-generators chunk fetched or parsed. Only a request that actually
  // references a dynamic value pays for a second pass (over a handful of short strings — the
  // identical computation the live-preview chip already runs on every keystroke, F2) and the one
  // memoised chunk load (paid once per session, views/grid/fakeData/generate.ts's own technique).
  const first = resolveTabState(tab.state, values, secretNames);
  const resolved = first.refs.some((r) => r.kind === 'dynamic')
    ? resolveTabState(tab.state, values, secretNames, await loadDynamicGenerator())
    : first;

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

// P7 D10: the *Copy as curl* dialog's own frozen resolution — computed once on open, the same
// shape send() already demonstrates (P6 D7's short-circuit: only a request that actually
// references a dynamic value pays for loadDynamicGenerator()'s chunk). `http/state/curl.ts` cannot
// import views/** (§0.3), so this lives here rather than there, and is called once rather than on
// every render — re-running it on a later render would re-roll every {{$…}} the dialog is already
// showing (D11's whole reason to exist).
export interface ExportResolution {
  method: HttpMethod;
  resolved: ResolvedRequest;
  /** Every distinct secret name stage 1 deferred, in first-encountered order — what the dialog's
   *  reveal loop walks (D10). */
  deferredNames: string[];
}

export async function resolveForExport(tabId: string): Promise<ExportResolution | null> {
  const tab = findHttpRequestTab(tabId);
  if (!tab) return null;

  const collectionId = collectionIdFor(tab.state);
  const environmentId = activeEnvironmentId.value;
  const { values, secretNames } = mergedValuesAndSecrets(collectionId, environmentId);
  const first = resolveTabState(tab.state, values, secretNames);
  const resolved = first.refs.some((r) => r.kind === 'dynamic')
    ? resolveTabState(tab.state, values, secretNames, await loadDynamicGenerator())
    : first;

  const deferredNames: string[] = [];
  for (const ref of resolved.refs) {
    if (ref.kind === 'deferred' && !deferredNames.includes(ref.name)) deferredNames.push(ref.name);
  }

  return { method: tab.state.method, resolved, deferredNames };
}
