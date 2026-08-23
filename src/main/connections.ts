import type { Caps } from '../shared/caps';
import type {
  ConnectionInput,
  ConnectionState,
  ConnectionSummary,
} from '../shared/domain/connection';
import { injectUriPassword, stripUriPassword } from '../shared/domain/uri';
import { ENGINE_OP, type ResolvedConnectionConfig } from '../shared/protocol/engine-ops';
import type { EngineHost } from './engine-host';
import { log } from './log';
import { createPreconnectSupervisor, type PreconnectExit } from './preconnect';
import type { KiraDb } from './storage/db';
import {
  type ConnectionFields,
  deleteConnection,
  getConnection,
  insertConnection,
  listConnections,
  reorderConnections,
  updateConnection,
} from './storage/repos/connections';
import { dropCached } from './storage/repos/metadata-cache';
import { createSecretStore } from './storage/repos/secrets';

export interface ConnectionTestResult {
  ok: boolean;
  serverVersion?: string;
  error?: string;
}

export interface ConnectionsService {
  list(): Promise<ConnectionSummary[]>;
  create(input: ConnectionInput): Promise<ConnectionSummary>;
  update(id: string, input: ConnectionInput): Promise<ConnectionSummary>;
  duplicate(id: string): Promise<ConnectionSummary>;
  remove(id: string): Promise<void>;
  reorder(ids: string[]): Promise<ConnectionSummary[]>;
  reveal(id: string): Promise<{ password: string | null }>;
  test(input: ConnectionInput): Promise<ConnectionTestResult>;
  connect(id: string): Promise<ConnectionState>;
  disconnect(id: string): Promise<ConnectionState>;
  states(): ConnectionState[];
  stateOf(id: string): ConnectionState;
  onStateChange(cb: (state: ConnectionState) => void): () => void;
  onMetadataInvalidated(cb: (connectionId: string) => void): () => void;
  onListChanged(cb: (records: ConnectionSummary[]) => void): () => void;
  /** Called when engine-host reports the engine process exited (D2/D11 gap coverage). */
  markAllErrored(reason: string): void;
  /** Kills every live pre-connect process. Called from main/index.ts's before-quit. */
  shutdown(): Promise<void>;
}

function extractFields(summary: ConnectionSummary): ConnectionFields {
  const {
    id: _id,
    sortOrder: _sortOrder,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...fields
  } = summary;
  return fields;
}

export function createConnectionsService(db: KiraDb, engineHost: EngineHost): ConnectionsService {
  const secrets = createSecretStore(db);
  const states = new Map<string, ConnectionState>();
  const stateHandlers = new Set<(state: ConnectionState) => void>();
  const invalidatedHandlers = new Set<(connectionId: string) => void>();
  const listChangedHandlers = new Set<(records: ConnectionSummary[]) => void>();
  const preconnect = createPreconnectSupervisor({
    log: (level, message) => log(level, 'preconnect', message),
  });
  // D11: at most one in-flight connect() per connection, so two Connect clicks cannot race two
  // pre-connect processes against each other.
  const inFlightConnects = new Map<string, Promise<ConnectionState>>();

  function emitState(state: ConnectionState): void {
    states.set(state.connectionId, state);
    for (const handler of stateHandlers) handler(state);
  }

  function emitInvalidated(connectionId: string): void {
    for (const handler of invalidatedHandlers) handler(connectionId);
  }

  // Broadcasts the authoritative list after any mutation — the renderer store otherwise only
  // ever sees a connection created/changed through its own saveDialog()/duplicateConnection()
  // wrappers, never one created via a direct IPC call (e.g. Playwright driving the app headless).
  async function emitListChanged(): Promise<void> {
    const records = await listConnections(db);
    for (const handler of listChangedHandlers) handler(records);
  }

  function stateOf(id: string): ConnectionState {
    return (
      states.get(id) ?? {
        connectionId: id,
        status: 'disconnected',
        serverVersion: null,
        error: null,
        since: Date.now(),
        caps: null,
      }
    );
  }

  // Private — never returned over IPC (D9). `preconnect` is stripped from the engine-bound config
  // (D13): the engine has no use for a shell string and must never be handed one.
  async function resolve(
    id: string,
  ): Promise<{ config: ResolvedConnectionConfig; preconnect: string | null }> {
    const summary = await getConnection(db, id);
    if (!summary) throw new Error(`connection ${id} not found`);
    const password = await secrets.get(id);
    const { preconnect: script, ...fields } = summary;
    return {
      config: {
        ...fields,
        password,
        uri: summary.uri ? injectUriPassword(summary.uri, password) : summary.uri,
      },
      preconnect: script,
    };
  }

  // Same shape as `resolve`, but built from an unsaved draft (the dialog's "Test connection"
  // button tests the input as typed, not what is on disk).
  function resolveFromInput(input: ConnectionInput): {
    config: ResolvedConnectionConfig;
    preconnect: string | null;
  } {
    const { preconnect: script, ...fields } = input;
    return {
      config: { ...fields, id: 'test', sortOrder: 0, createdAt: '', updatedAt: '' },
      preconnect: script,
    };
  }

  // Any exit while armed means the connection can no longer reach its target (a died port-
  // forward, a died SSO session-keeper) — best-effort disconnect the adapter and surface why.
  preconnect.onExit((exit: PreconnectExit) => {
    void engineHost.call(ENGINE_OP.disconnect, { connectionId: exit.connectionId }).catch(() => {});
    const detail = exit.signal
      ? `(signal ${exit.signal})`
      : `(exit ${exit.code === null ? 'unknown' : exit.code})`;
    const tail = exit.lastStderr ? `: ${exit.lastStderr}` : '';
    emitState({
      connectionId: exit.connectionId,
      status: 'error',
      serverVersion: null,
      error: `Pre-connect script exited ${detail}${tail} — connection dropped.`,
      since: Date.now(),
      caps: null,
    });
  });

  async function doConnect(id: string): Promise<ConnectionState> {
    const summary = await getConnection(db, id);
    if (!summary) throw new Error(`connection ${id} not found`);
    emitState({
      connectionId: id,
      status: 'connecting',
      serverVersion: null,
      error: null,
      since: Date.now(),
      caps: null,
    });
    let started = false;
    try {
      const { config, preconnect: script } = await resolve(id);
      let sidecar = false;
      if (script) {
        const startResult = await preconnect.start(id, script);
        started = true;
        sidecar = startResult.kind === 'sidecar';
      }
      const result = await engineHost.call<{ serverVersion: string; caps: Caps }>(
        ENGINE_OP.connect,
        { config },
        20_000,
      );
      if (sidecar) {
        // May synchronously flip this connection to 'error' via the onExit handler above, if
        // the script already died between start() resolving and this call (D7).
        preconnect.arm(id);
      }
      const afterArm = stateOf(id);
      if (afterArm.status === 'error') return afterArm;
      const state: ConnectionState = {
        connectionId: id,
        status: 'connected',
        serverVersion: result.serverVersion,
        error: null,
        since: Date.now(),
        caps: result.caps,
      };
      emitState(state);
      // D11 (Step 6a numbering): the whole connection's metadata is refreshed on every
      // reconnect. A blunt delete alone would blank the tree, so the renderer re-fetches only
      // the paths it currently has expanded once it sees the invalidation push.
      await dropCached(db, id);
      emitInvalidated(id);
      return state;
    } catch (err) {
      if (started) await preconnect.stop(id);
      const state: ConnectionState = {
        connectionId: id,
        status: 'error',
        serverVersion: null,
        error: err instanceof Error ? err.message : String(err),
        since: Date.now(),
        caps: null,
      };
      emitState(state);
      return state;
    }
  }

  return {
    list: () => listConnections(db),

    async create(input) {
      // In fields mode `uri` is not authoritative — never store or return it, even if the
      // draft still carries a stale value from a mode toggle (it can carry a password: D9's
      // guarantee that connectionsList() never leaks one must hold regardless of what the
      // client sends, not just what the dialog is expected to send).
      let uri = input.mode === 'uri' ? input.uri : null;
      let password = input.password;
      if (input.mode === 'uri' && uri) {
        const stripped = stripUriPassword(uri);
        uri = stripped.uri;
        password = stripped.password;
      }
      const id = crypto.randomUUID();
      const created = await insertConnection(db, {
        id,
        fields: { ...input, uri },
        createdAt: new Date().toISOString(),
      });
      await secrets.set(id, password);
      void emitListChanged();
      return created;
    },

    async update(id, input) {
      // See create()'s comment — `uri` is never stored/returned outside URI mode.
      let uri = input.mode === 'uri' ? input.uri : null;
      // Three-state convention (Step 6a): null = unchanged, '' = clear, non-empty = replace.
      // In URI mode the dialog only ever submits a passwordless URI unless it explicitly
      // re-embedded a new one (Step 7's reveal flow) — stripUriPassword naturally yields
      // `password: null` ("unchanged") for a URI with nothing embedded, so no special case
      // is needed for URI mode beyond running the same extraction fields mode's password
      // field does not go through.
      let password = input.password;
      if (input.mode === 'uri' && uri) {
        const stripped = stripUriPassword(uri);
        uri = stripped.uri;
        password = stripped.password;
      }
      if (password !== null) {
        await secrets.set(id, password === '' ? null : password);
      }
      const updated = await updateConnection(db, id, { ...input, uri }, new Date().toISOString());
      void emitListChanged();
      return updated;
    },

    async duplicate(id) {
      const existing = await getConnection(db, id);
      if (!existing) throw new Error(`connection ${id} not found`);
      const password = await secrets.get(id);
      const newId = crypto.randomUUID();
      const fields = extractFields(existing);
      const created = await insertConnection(db, {
        id: newId,
        fields: { ...fields, name: `${fields.name} copy` },
        createdAt: new Date().toISOString(),
      });
      await secrets.set(newId, password);
      void emitListChanged();
      return created;
    },

    async remove(id) {
      const current = stateOf(id);
      if (current.status === 'connected' || current.status === 'connecting') {
        await engineHost.call(ENGINE_OP.disconnect, { connectionId: id }).catch(() => {});
      }
      await preconnect.stop(id);
      await deleteConnection(db, id); // cascades filters, metadata cache, saved queries
      await secrets.delete(id);
      states.delete(id);
      void emitListChanged();
    },

    async reorder(ids) {
      const reordered = await reorderConnections(db, ids);
      void emitListChanged();
      return reordered;
    },

    async reveal(id) {
      const password = await secrets.get(id);
      log('info', 'connections', `secret revealed for ${id}`);
      return { password };
    },

    async test(input) {
      const { config, preconnect: script } = resolveFromInput(input);
      try {
        if (script) await preconnect.start(config.id, script);
        return await engineHost.call<ConnectionTestResult>(ENGINE_OP.test, { config }, 20_000);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      } finally {
        // A test run is never armed and never leaves a process behind, however it ended.
        await preconnect.stop(config.id);
      }
    },

    async connect(id) {
      const existing = inFlightConnects.get(id);
      if (existing) return existing;
      const attempt = doConnect(id).finally(() => {
        if (inFlightConnects.get(id) === attempt) inFlightConnects.delete(id);
      });
      inFlightConnects.set(id, attempt);
      return attempt;
    },

    async disconnect(id) {
      await preconnect.stop(id);
      await engineHost.call(ENGINE_OP.disconnect, { connectionId: id }).catch(() => {});
      // Cached metadata stays — §2.2: "metadata stays, it is on disk".
      const state: ConnectionState = {
        connectionId: id,
        status: 'disconnected',
        serverVersion: null,
        error: null,
        since: Date.now(),
        caps: null,
      };
      emitState(state);
      return state;
    },

    states: () => [...states.values()],
    stateOf,

    onStateChange(cb) {
      stateHandlers.add(cb);
      return () => stateHandlers.delete(cb);
    },
    onMetadataInvalidated(cb) {
      invalidatedHandlers.add(cb);
      return () => invalidatedHandlers.delete(cb);
    },
    onListChanged(cb) {
      listChangedHandlers.add(cb);
      return () => listChangedHandlers.delete(cb);
    },

    markAllErrored(reason) {
      for (const state of states.values()) {
        if (state.status === 'connected' || state.status === 'connecting') {
          void preconnect.stop(state.connectionId);
          emitState({ ...state, status: 'error', error: reason, since: Date.now(), caps: null });
        }
      }
    },

    shutdown: () => preconnect.stopAll(),
  };
}
