import { randomUUID } from 'node:crypto';
import { AdapterError } from '../engine/adapters/errors';
import {
  type ConnectionInput,
  type ConnectionState,
  type ConnectionSummary,
  connectionInputSchema,
} from '../shared/connection';
import {
  type ConnectInfo,
  ENGINE_OP,
  type ResolvedConnectionConfig,
  type TestResult,
} from '../shared/engine-ops';
import { IPC } from '../shared/ipc';
import { injectUriPassword, stripUriPassword } from '../shared/uri';
import type { EngineHost } from './engine-host';
import { log } from './log';
import {
  type ConnectionColumns,
  deleteConnection,
  getConnection,
  insertConnection,
  listConnections,
  reorderConnections,
  updateConnection,
} from './storage/connections';
import type { Db } from './storage/db';
import { dropCached } from './storage/metadata-cache';
import type { SecretStore } from './storage/secrets';

// Orchestration for connection CRUD + connect/disconnect (Step 6a). Storage does SQL, the engine
// does the network, this module joins them and owns the authoritative ConnectionState map — the
// green dot reads it and it survives a renderer reload. The renderer never sees a password: `resolve`
// is private to this module and every public return value is a `ConnectionSummary`.

type Push = (channel: string, payload: unknown) => void;

const CONNECT_TIMEOUT_MS = 20_000;

export interface ConnectionsService {
  list(): Promise<ConnectionSummary[]>;
  create(input: ConnectionInput): Promise<ConnectionSummary>;
  update(id: string, input: ConnectionInput): Promise<ConnectionSummary>;
  duplicate(id: string): Promise<ConnectionSummary>;
  remove(id: string): Promise<void>;
  reorder(ids: string[]): Promise<ConnectionSummary[]>;
  reveal(id: string): Promise<{ password: string | null }>;
  test(input: ConnectionInput): Promise<TestResult>;
  connect(id: string): Promise<ConnectionState>;
  disconnect(id: string): Promise<ConnectionState>;
  states(): ConnectionState[];
  getState(id: string): ConnectionState;
  summary(id: string): Promise<ConnectionSummary | null>;
  handleEngineExit(): void;
}

export function createConnectionsService(
  db: Db,
  engineHost: EngineHost,
  secrets: SecretStore,
  push: Push,
): ConnectionsService {
  const states = new Map<string, ConnectionState>();

  function setState(state: ConnectionState): void {
    states.set(state.connectionId, state);
    push(IPC.connectionState, state);
  }

  function disconnectedState(id: string): ConnectionState {
    return {
      connectionId: id,
      status: 'disconnected',
      serverVersion: null,
      error: null,
      since: Date.now(),
    };
  }

  // Summary + stored secret + (in URI mode) the password re-injected into the URI (D7). Never
  // returned over IPC — the only consumer is the engine channel.
  async function resolve(id: string): Promise<ResolvedConnectionConfig> {
    const summary = await getConnection(db, id);
    if (!summary) throw new AdapterError('E_NOT_FOUND', `connection "${id}" not found`);
    const password = await secrets.get(id);
    const uri =
      summary.mode === 'uri' && summary.uri
        ? injectUriPassword(summary.uri, password)
        : summary.uri;
    return {
      id: summary.id,
      name: summary.name,
      kind: summary.kind,
      color: summary.color,
      mode: summary.mode,
      readOnly: summary.readOnly,
      host: summary.host,
      port: summary.port,
      database: summary.database,
      username: summary.username,
      password,
      uri,
      options: summary.options,
    };
  }

  function columns(input: ConnectionInput, uri: string | null): ConnectionColumns {
    return {
      name: input.name,
      kind: input.kind,
      color: input.color,
      mode: input.mode,
      readOnly: input.readOnly,
      host: input.host,
      port: input.port,
      database: input.database,
      username: input.username,
      uri,
      options: input.options,
    };
  }

  async function create(input: ConnectionInput): Promise<ConnectionSummary> {
    const parsed = connectionInputSchema.parse(input);
    const id = randomUUID();
    let uri = parsed.uri;
    let password = parsed.password;
    if (parsed.mode === 'uri' && parsed.uri) {
      // D7: the stored URI is passwordless; the extracted secret goes to the SecretStore.
      const stripped = stripUriPassword(parsed.uri);
      uri = stripped.uri;
      password = stripped.password;
    }
    const summary = await insertConnection(db, id, columns(parsed, uri));
    await secrets.set(id, password);
    return summary;
  }

  async function update(id: string, input: ConnectionInput): Promise<ConnectionSummary> {
    const parsed = connectionInputSchema.parse(input);
    if (!(await getConnection(db, id))) {
      throw new AdapterError('E_NOT_FOUND', `connection "${id}" not found`);
    }

    let uri = parsed.uri;
    // Three-state password (D9): null = unchanged, '' = clear, non-empty = set. In URI mode the
    // string is authoritative, so the extracted password wins and a missing one means "cleared".
    let secretToSet: string | null | undefined;
    if (parsed.mode === 'uri' && parsed.uri) {
      const stripped = stripUriPassword(parsed.uri);
      uri = stripped.uri;
      secretToSet = stripped.password;
    } else if (parsed.password !== null) {
      secretToSet = parsed.password === '' ? null : parsed.password;
    }

    const summary = await updateConnection(db, id, columns(parsed, uri));
    if (!summary) throw new AdapterError('E_NOT_FOUND', `connection "${id}" not found`);
    if (secretToSet !== undefined) await secrets.set(id, secretToSet);
    return summary;
  }

  async function duplicate(id: string): Promise<ConnectionSummary> {
    const existing = await getConnection(db, id);
    if (!existing) throw new AdapterError('E_NOT_FOUND', `connection "${id}" not found`);
    const password = await secrets.get(id);
    const summary = await insertConnection(db, randomUUID(), {
      name: `${existing.name} copy`,
      kind: existing.kind,
      color: existing.color,
      mode: existing.mode,
      readOnly: existing.readOnly,
      host: existing.host,
      port: existing.port,
      database: existing.database,
      username: existing.username,
      uri: existing.uri,
      options: existing.options,
    });
    // D9/§8.10: a duplicate that cannot connect is useless — copy the secret too.
    await secrets.set(summary.id, password);
    return summary;
  }

  async function remove(id: string): Promise<void> {
    const state = states.get(id);
    if (state && (state.status === 'connected' || state.status === 'connecting')) {
      await disconnect(id).catch(() => {});
    }
    await deleteConnection(db, id); // cascade clears filters/cache/saved queries
    await secrets.delete(id);
    states.delete(id);
  }

  async function reorder(ids: string[]): Promise<ConnectionSummary[]> {
    return reorderConnections(db, ids);
  }

  async function reveal(id: string): Promise<{ password: string | null }> {
    const password = await secrets.get(id);
    log('info', 'connections', `secret revealed for ${id}`);
    return { password };
  }

  async function test(input: ConnectionInput): Promise<TestResult> {
    const parsed = connectionInputSchema.parse(input);
    // Resolved from the input, not storage — the dialog tests unsaved edits. The throwaway id never
    // surfaces (the engine logs test ops with connectionId null).
    const cfg: ResolvedConnectionConfig = {
      id: randomUUID(),
      name: parsed.name,
      kind: parsed.kind,
      color: parsed.color,
      mode: parsed.mode,
      readOnly: parsed.readOnly,
      host: parsed.host,
      port: parsed.port,
      database: parsed.database,
      username: parsed.username,
      password: parsed.password ?? null,
      uri: parsed.uri,
      options: parsed.options,
    };
    try {
      return await engineHost.call<TestResult>(ENGINE_OP.test, cfg, CONNECT_TIMEOUT_MS);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async function connect(id: string): Promise<ConnectionState> {
    if (!(await getConnection(db, id))) {
      throw new AdapterError('E_NOT_FOUND', `connection "${id}" not found`);
    }
    const cfg = await resolve(id);
    setState({
      connectionId: id,
      status: 'connecting',
      serverVersion: null,
      error: null,
      since: Date.now(),
    });
    try {
      const info = await engineHost.call<ConnectInfo>(ENGINE_OP.connect, cfg, CONNECT_TIMEOUT_MS);
      const state: ConnectionState = {
        connectionId: id,
        status: 'connected',
        serverVersion: info.serverVersion,
        error: null,
        since: Date.now(),
      };
      setState(state);
      // D11: on reconnect, invalidate the whole connection's metadata and let the renderer re-fetch
      // only its currently-expanded paths.
      await dropCached(db, id);
      push(IPC.connectionMetadataInvalidated, { connectionId: id });
      return state;
    } catch (err) {
      const state: ConnectionState = {
        connectionId: id,
        status: 'error',
        serverVersion: null,
        error: err instanceof Error ? err.message : String(err),
        since: Date.now(),
      };
      setState(state);
      return state;
    }
  }

  async function disconnect(id: string): Promise<ConnectionState> {
    try {
      await engineHost.call(ENGINE_OP.disconnect, { connectionId: id });
    } catch {
      // engine may already be down; the local state still moves to disconnected.
    }
    // Cached metadata stays (SPEC §2.2: "metadata stays, it is on disk").
    const state = disconnectedState(id);
    setState(state);
    return state;
  }

  function handleEngineExit(): void {
    for (const [id, state] of states) {
      if (state.status === 'connected' || state.status === 'connecting') {
        setState({
          connectionId: id,
          status: 'error',
          serverVersion: null,
          error: 'engine process exited',
          since: Date.now(),
        });
      }
    }
  }

  return {
    list: () => listConnections(db),
    create,
    update,
    duplicate,
    remove,
    reorder,
    reveal,
    test,
    connect,
    disconnect,
    states: () => [...states.values()],
    getState: (id) => states.get(id) ?? disconnectedState(id),
    summary: (id) => getConnection(db, id),
    handleEngineExit,
  };
}
