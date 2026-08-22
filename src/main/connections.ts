import type {
  ConnectionInput,
  ConnectionState,
  ConnectionSummary,
} from '../shared/domain/connection';
import { injectUriPassword, stripUriPassword } from '../shared/domain/uri';
import { ENGINE_OP, type ResolvedConnectionConfig } from '../shared/protocol/engine-ops';
import type { EngineHost } from './engine-host';
import { log } from './log';
import type { Db } from './storage/db';
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
  list(): ConnectionSummary[];
  create(input: ConnectionInput): Promise<ConnectionSummary>;
  update(id: string, input: ConnectionInput): Promise<ConnectionSummary>;
  duplicate(id: string): Promise<ConnectionSummary>;
  remove(id: string): Promise<void>;
  reorder(ids: string[]): ConnectionSummary[];
  reveal(id: string): Promise<{ password: string | null }>;
  test(input: ConnectionInput): Promise<ConnectionTestResult>;
  connect(id: string): Promise<ConnectionState>;
  disconnect(id: string): Promise<ConnectionState>;
  states(): ConnectionState[];
  stateOf(id: string): ConnectionState;
  onStateChange(cb: (state: ConnectionState) => void): () => void;
  onMetadataInvalidated(cb: (connectionId: string) => void): () => void;
  /** Called when engine-host reports the engine process exited (D2/D11 gap coverage). */
  markAllErrored(reason: string): void;
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

export function createConnectionsService(db: Db, engineHost: EngineHost): ConnectionsService {
  const secrets = createSecretStore(db);
  const states = new Map<string, ConnectionState>();
  const stateHandlers = new Set<(state: ConnectionState) => void>();
  const invalidatedHandlers = new Set<(connectionId: string) => void>();

  function emitState(state: ConnectionState): void {
    states.set(state.connectionId, state);
    for (const handler of stateHandlers) handler(state);
  }

  function emitInvalidated(connectionId: string): void {
    for (const handler of invalidatedHandlers) handler(connectionId);
  }

  function stateOf(id: string): ConnectionState {
    return (
      states.get(id) ?? {
        connectionId: id,
        status: 'disconnected',
        serverVersion: null,
        error: null,
        since: Date.now(),
      }
    );
  }

  // Private — never returned over IPC (D9).
  async function resolve(id: string): Promise<ResolvedConnectionConfig> {
    const summary = getConnection(db, id);
    if (!summary) throw new Error(`connection ${id} not found`);
    const password = await secrets.get(id);
    return {
      ...summary,
      password,
      uri: summary.uri ? injectUriPassword(summary.uri, password) : summary.uri,
    };
  }

  // Same shape as `resolve`, but built from an unsaved draft (the dialog's "Test connection"
  // button tests the input as typed, not what is on disk).
  function resolveFromInput(input: ConnectionInput): ResolvedConnectionConfig {
    return {
      ...input,
      id: 'test',
      sortOrder: 0,
      createdAt: '',
      updatedAt: '',
    };
  }

  return {
    list: () => listConnections(db),

    async create(input) {
      let uri = input.uri;
      let password = input.password;
      if (input.mode === 'uri' && uri) {
        const stripped = stripUriPassword(uri);
        uri = stripped.uri;
        password = stripped.password;
      }
      const id = crypto.randomUUID();
      const created = insertConnection(db, {
        id,
        fields: { ...input, uri },
        createdAt: new Date().toISOString(),
      });
      await secrets.set(id, password);
      return created;
    },

    async update(id, input) {
      let uri = input.uri;
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
      return updateConnection(db, id, { ...input, uri }, new Date().toISOString());
    },

    async duplicate(id) {
      const existing = getConnection(db, id);
      if (!existing) throw new Error(`connection ${id} not found`);
      const password = await secrets.get(id);
      const newId = crypto.randomUUID();
      const fields = extractFields(existing);
      const created = insertConnection(db, {
        id: newId,
        fields: { ...fields, name: `${fields.name} copy` },
        createdAt: new Date().toISOString(),
      });
      await secrets.set(newId, password);
      return created;
    },

    async remove(id) {
      const current = stateOf(id);
      if (current.status === 'connected' || current.status === 'connecting') {
        await engineHost.call(ENGINE_OP.disconnect, { connectionId: id }).catch(() => {});
      }
      deleteConnection(db, id); // cascades filters, metadata cache, saved queries
      await secrets.delete(id);
      states.delete(id);
    },

    reorder: (ids) => reorderConnections(db, ids),

    async reveal(id) {
      const password = await secrets.get(id);
      log('info', 'connections', `secret revealed for ${id}`);
      return { password };
    },

    async test(input) {
      const cfg = resolveFromInput(input);
      try {
        return await engineHost.call<ConnectionTestResult>(ENGINE_OP.test, { config: cfg }, 20_000);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },

    async connect(id) {
      const summary = getConnection(db, id);
      if (!summary) throw new Error(`connection ${id} not found`);
      emitState({
        connectionId: id,
        status: 'connecting',
        serverVersion: null,
        error: null,
        since: Date.now(),
      });
      try {
        const cfg = await resolve(id);
        const result = await engineHost.call<{ serverVersion: string }>(
          ENGINE_OP.connect,
          { config: cfg },
          20_000,
        );
        const state: ConnectionState = {
          connectionId: id,
          status: 'connected',
          serverVersion: result.serverVersion,
          error: null,
          since: Date.now(),
        };
        emitState(state);
        // D11: the whole connection's metadata is refreshed on every reconnect. A blunt
        // delete alone would blank the tree, so the renderer re-fetches only the paths it
        // currently has expanded once it sees the invalidation push.
        dropCached(db, id);
        emitInvalidated(id);
        return state;
      } catch (err) {
        const state: ConnectionState = {
          connectionId: id,
          status: 'error',
          serverVersion: null,
          error: err instanceof Error ? err.message : String(err),
          since: Date.now(),
        };
        emitState(state);
        return state;
      }
    },

    async disconnect(id) {
      await engineHost.call(ENGINE_OP.disconnect, { connectionId: id }).catch(() => {});
      // Cached metadata stays — §2.2: "metadata stays, it is on disk".
      const state: ConnectionState = {
        connectionId: id,
        status: 'disconnected',
        serverVersion: null,
        error: null,
        since: Date.now(),
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

    markAllErrored(reason) {
      for (const state of states.values()) {
        if (state.status === 'connected' || state.status === 'connecting') {
          emitState({ ...state, status: 'error', error: reason, since: Date.now() });
        }
      }
    },
  };
}
