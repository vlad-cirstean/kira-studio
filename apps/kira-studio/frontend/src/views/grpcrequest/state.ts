import type {
  GrpcCallResultWire,
  GrpcMessageWire,
  GrpcMetaPairWire,
  GrpcRequestTabState,
  GrpcSchemaWire,
} from '@shared/domain/grpc';
import { control } from '../../bridge/control';
import { loadDynamicGenerator } from '../../http/dynamic/catalog';
import { collectionIdFor } from '../../http/state/collections';
import { activeEnvironmentId, mergedValuesAndSecrets } from '../../http/state/variables';
import { type Reference, resolve } from '../../http/substitute';
import { findGrpcRequestTab } from '../../http/tabs';
import { registerTabRuntimeCleanup } from '../../state/tabRuntime';
import { classifyLoadError, createRuntimeStore, stopOp } from '../shared/viewOp';
import { noteGrpcCallRecorded } from './history';

// D9: {{name}} substitution is reused exactly — the same two-token grammar http/substitute.ts's
// resolve() already implements, over gRPC's own three substitutable fields (target, metadata,
// message). Deliberately NOT protoPath/importPaths/caFile (picker-supplied local paths, P5 D7's
// own rule). P12 D9/F10: mergedValuesAndSecrets/collectionIdFor used to be hand-copied here from
// views/httprequest/state.ts, because views/grpcrequest/** may not import views/httprequest/**
// (biome.json, F18) — now both live in http/state/{variables,collections}.ts, which both view
// directories already import, so this is a move rather than an abstraction.

export interface ResolvedGrpcRequest {
  target: string;
  metadata: GrpcMetaPairWire[];
  message: string;
  refs: Reference[];
}

/** D9 stage 1: resolves every non-secret {{name}} (and {{$dynamic}}, when `dynamic` is supplied)
 *  reference across target/metadata/message — a secret name is left verbatim and classified
 *  'deferred' (Go finishes it, strictly after op.SetCommand). Only enabled, named metadata rows
 *  cross the wire — mirrors buildBodyWire's own header filter (views/httprequest/state.ts). */
export function resolveGrpcTabState(
  state: GrpcRequestTabState,
  values: Readonly<Record<string, string>>,
  secretNames: readonly string[],
  dynamic?: (name: string) => string | null,
): ResolvedGrpcRequest {
  const refs: Reference[] = [];
  const sub = (text: string): string => {
    const result = resolve(text, values, secretNames, dynamic);
    refs.push(...result.refs);
    return result.text;
  };

  const target = sub(state.target);
  const metadata = state.metadata
    .filter((m) => m.enabled && m.name.trim() !== '')
    .map((m) => ({ name: sub(m.name), value: sub(m.value) }));
  const message = sub(state.message);

  return { target, metadata, message, refs };
}

// D6: the response is runtime-only, never persisted.
export interface GrpcRequestViewRuntime {
  status: 'idle' | 'running' | 'error' | 'cancelled';
  opId: string | null;
  streaming: boolean;
  error: { code: string; message: string } | null;
  result: GrpcCallResultWire | null;
  messages: GrpcMessageWire[];
  /** Set once a terminal event/return confirms the live count — separate from messages.length so
   *  D17's "showing the most recent 10,000 of N" sentence can name the true N even after D15's own
   *  live-view ceiling drops older ones (not yet reached by any server this app has tested against,
   *  kept here so the UI is ready for it). */
  trueMessageCount: number;
}

function defaultRuntime(): GrpcRequestViewRuntime {
  return {
    status: 'idle',
    opId: null,
    streaming: false,
    error: null,
    result: null,
    messages: [],
    trueMessageCount: 0,
  };
}

const { runtime, ensureRuntime } = createRuntimeStore<GrpcRequestViewRuntime>(defaultRuntime);

export { runtime };

// D2: dropResources is noDrop (the registry entry) — the runtime lives here, and a still-running
// call must be cancelled through this hook rather than through dropResources (registerTabRuntimeCleanup
// is the one place a closing tab's cleanup and an in-flight op's cancellation can share one call).
registerTabRuntimeCleanup((tabId) => {
  stopOp(runtime[tabId]);
  delete runtime[tabId];
  delete schemaRuntime[tabId];
});

// ---- D4: the schema browser's own runtime ----

export interface GrpcSchemaRuntime {
  status: 'idle' | 'loading' | 'error';
  schema: GrpcSchemaWire | null;
  error: string | null;
}

function defaultSchemaRuntime(): GrpcSchemaRuntime {
  return { status: 'idle', schema: null, error: null };
}

const { runtime: schemaRuntime, ensureRuntime: ensureSchemaRuntime } =
  createRuntimeStore<GrpcSchemaRuntime>(defaultSchemaRuntime);

export { schemaRuntime };

/** Resolves stage 1 over target/metadata only (Describe has no message field) — the same
 *  short-circuit shape send() uses below. */
async function resolveForDescribe(
  tabId: string,
): Promise<{ target: string; metadata: { name: string; value: string }[] } | null> {
  const tab = findGrpcRequestTab(tabId);
  if (!tab) return null;
  const collectionId = collectionIdFor(tab.state);
  const environmentId = activeEnvironmentId.value;
  const { values, secretNames } = mergedValuesAndSecrets(collectionId, environmentId);
  const first = resolveGrpcTabState(tab.state, values, secretNames);
  const resolved = first.refs.some((r) => r.kind === 'dynamic')
    ? resolveGrpcTabState(tab.state, values, secretNames, await loadDynamicGenerator())
    : first;
  return { target: resolved.target, metadata: resolved.metadata };
}

/** D4: fetches (or refetches, `reload`) the schema for the tab's current source. */
export async function loadSchema(tabId: string, reload = false): Promise<void> {
  const tab = findGrpcRequestTab(tabId);
  if (!tab) return;
  const rt = ensureSchemaRuntime(tabId);
  rt.status = 'loading';
  rt.error = null;

  const collectionId = collectionIdFor(tab.state);
  const environmentId = activeEnvironmentId.value;
  try {
    let target = tab.state.target;
    let metadata: { name: string; value: string }[] = [];
    if (tab.state.descriptorMode === 'reflection') {
      const resolved = await resolveForDescribe(tabId);
      if (!resolved) return;
      target = resolved.target;
      metadata = resolved.metadata;
    }
    const schema = await control.grpcDescribe({
      descriptorMode: tab.state.descriptorMode,
      target,
      tls: {
        enabled: tab.state.tlsMode === 'tls',
        caFile: tab.state.caFile,
        serverName: tab.state.serverName,
      },
      metadata,
      protoPath: tab.state.protoPath,
      importPaths: tab.state.importPaths,
      collectionId,
      environmentId,
      reload,
    });
    if (!findGrpcRequestTab(tabId)) return;
    rt.status = 'idle';
    rt.schema = schema;
  } catch (err) {
    if (!findGrpcRequestTab(tabId)) return;
    rt.status = 'error';
    rt.error = err instanceof Error ? err.message : String(err);
  }
}

/** Finds one method in a loaded schema by "Service/Method" full name. */
export function findMethod(
  schema: GrpcSchemaWire | null,
  service: string,
  method: string,
): { clientStreaming: boolean; serverStreaming: boolean; requestTemplate: string } | null {
  if (!schema) return null;
  const svc = schema.services.find((s) => s.name === service);
  const m = svc?.methods.find((m) => m.name === method);
  return m ?? null;
}

// ---- D7/D8: the call itself ----

let subscribedToGrpcCall = false;
function ensureGrpcCallSubscription(): void {
  if (subscribedToGrpcCall) return;
  subscribedToGrpcCall = true;
  control.onGrpcCall((event) => {
    for (const tabId of Object.keys(runtime)) {
      const rt = runtime[tabId];
      if (!rt || rt.opId !== event.callId) continue;
      rt.messages.push(...event.messages);
      rt.trueMessageCount = Math.max(rt.trueMessageCount, rt.messages.length);
      if (event.done) {
        rt.opId = null;
        if (event.error) {
          rt.status = event.error.code === 'E_GRPC_CANCELLED' ? 'cancelled' : 'error';
          rt.error = event.error;
          if (event.status) rt.result = event.status;
        } else {
          rt.status = 'idle';
          rt.result = event.status ?? rt.result;
        }
        noteGrpcCallRecorded(tabId);
      }
      break;
    }
  });
}

/** D7/D8: one Call op, run through GrpcService.Call → the existing op scheduler. Unary and
 *  server-streaming both go through this one function — Go is told which (`streaming`) from the
 *  method the schema already resolved. */
export async function call(tabId: string): Promise<void> {
  const tab = findGrpcRequestTab(tabId);
  if (!tab) return;
  const rt = ensureRuntime(tabId);
  if (rt.status === 'running') return;
  ensureGrpcCallSubscription();

  const schema = schemaRuntime[tabId]?.schema ?? null;
  const method = findMethod(schema, tab.state.service, tab.state.method);
  const streaming = method?.serverStreaming ?? false;

  const opId = crypto.randomUUID();
  rt.status = 'running';
  rt.opId = opId;
  rt.error = null;
  rt.result = null;
  rt.messages = [];
  rt.trueMessageCount = 0;
  rt.streaming = streaming;

  const collectionId = collectionIdFor(tab.state);
  const environmentId = activeEnvironmentId.value;
  const { values, secretNames } = mergedValuesAndSecrets(collectionId, environmentId);
  const first = resolveGrpcTabState(tab.state, values, secretNames);
  const resolved = first.refs.some((r) => r.kind === 'dynamic')
    ? resolveGrpcTabState(tab.state, values, secretNames, await loadDynamicGenerator())
    : first;

  try {
    const result = await control.grpcCall({
      opId,
      tabId,
      streaming,
      descriptorMode: tab.state.descriptorMode,
      target: resolved.target,
      tls: {
        enabled: tab.state.tlsMode === 'tls',
        caFile: tab.state.caFile,
        serverName: tab.state.serverName,
      },
      protoPath: tab.state.protoPath,
      importPaths: tab.state.importPaths,
      service: tab.state.service,
      method: tab.state.method,
      messageJson: resolved.message,
      metadata: resolved.metadata,
      collectionId,
      environmentId,
      itemId: tab.state.itemId ?? '',
    });
    if (rt.opId !== opId) return; // superseded, or the streaming subscription already finished it
    rt.status = 'idle';
    rt.opId = null;
    rt.result = result;
    if (!streaming && result.messages) rt.messages = result.messages;
    noteGrpcCallRecorded(tabId);
  } catch (err) {
    if (rt.opId !== opId) return;
    rt.opId = null;
    const failure = classifyLoadError(err);
    if (failure.kind === 'cancelled') {
      rt.status = 'cancelled';
      return;
    }
    rt.status = 'error';
    rt.error = { code: failure.code, message: failure.message };
  }
}

export function stop(tabId: string): void {
  stopOp(runtime[tabId]);
}
