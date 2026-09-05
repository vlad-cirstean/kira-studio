import { loadDynamicGenerator, type Reference, resolve } from '@kira/api-core';
import type {
  GrpcCallResultWire,
  GrpcMessageWire,
  GrpcMetaPairWire,
  GrpcRequestTabState,
  GrpcSchemaWire,
} from '@shared/domain/grpc';
import { collectionIdFor } from '../../api/state/collections';
import { activeEnvironmentId, mergedValuesAndSecrets } from '../../api/state/variables';
import { findGrpcRequestTab } from '../../api/tabs';
import { control } from '../../bridge/control';
import { registerTabRuntimeCleanup } from '../../state/tabRuntime';
import { classifyLoadError, createRuntimeStore, stopOp } from '../shared/viewOp';
import { noteGrpcCallRecorded } from './history';

// D9: {{name}} substitution is reused exactly — the same two-token grammar @kira/api-core's
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

// D15: the live view's own ceiling — an infinite stream must not grow the renderer without bound.
// The oldest messages are dropped once this is exceeded; trueMessageCount (below) keeps the real
// total so D17's "showing the most recent 10,000 of N" sentence can still name it.
const MAX_LIVE_MESSAGES = 10_000;

// D6: the response is runtime-only, never persisted.
export interface GrpcRequestViewRuntime {
  status: 'idle' | 'running' | 'error' | 'cancelled';
  opId: string | null;
  streaming: boolean;
  error: { code: string; message: string } | null;
  result: GrpcCallResultWire | null;
  /** Capped at MAX_LIVE_MESSAGES (D15) — the oldest are spliced off the head as new ones arrive. */
  messages: GrpcMessageWire[];
  /** The true count of every message this call has produced so far — kept incrementally
   *  (never re-derived from messages.length, which is capped) so D17's "showing the most recent
   *  10,000 of N" sentence can name the real N once messages.length has hit the ceiling. */
  trueMessageCount: number;
  /** Running total of wireBytes across every message received so far, updated once per push
   *  rather than re-`reduce`d over `messages` on every read — the same reasoning as
   *  trueMessageCount, and what makes the response pane's own byte total O(1) per message instead
   *  of O(N) per push (finding 11). */
  messageBytes: number;
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
    messageBytes: 0,
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
      rt.trueMessageCount += event.messages.length;
      for (const m of event.messages) rt.messageBytes += m.wireBytes;
      if (rt.messages.length > MAX_LIVE_MESSAGES) {
        rt.messages.splice(0, rt.messages.length - MAX_LIVE_MESSAGES);
      }
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
  rt.messageBytes = 0;
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
    if (!streaming && result.messages) {
      rt.messages = result.messages;
      rt.trueMessageCount = result.messages.length;
      rt.messageBytes = result.messages.reduce((n, m) => n + m.wireBytes, 0);
    }
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
