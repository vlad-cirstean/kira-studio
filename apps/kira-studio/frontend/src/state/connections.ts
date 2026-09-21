import type {
  ConnectionInput,
  ConnectionState,
  ConnectionSummary,
} from '@shared/domain/connection';
import { DEFAULT_PORT } from '@shared/domain/connection';
import type { SecretStorageStatus } from '@shared/domain/secrets';
import { defineStore } from 'pinia';
import { reactive, toRefs } from 'vue';
import { control } from '../bridge/control';

export interface ConnectionDialogState {
  open: boolean;
  mode: 'create' | 'edit';
  editingId: string | null;
  draft: ConnectionInput | null;
  /** A save failure (D7) or a reveal-on-open failure (D9) — the dialog shows both in the same
   *  slot, cleared whenever the dialog is (re)opened or a save is retried. */
  error: string | null;
}

interface ConnectionsState {
  records: ConnectionSummary[];
  states: Record<string, ConnectionState>;
  // P25: reported once at startup and never changes for the life of the process — the
  // connection dialog's credential note (D8) reads this directly.
  secretStorage: SecretStorageStatus | null;
}

export const useConnectionsStore = defineStore('connections', () => {
  const state = reactive<ConnectionsState>({
    records: [],
    states: {},
    secretStorage: null,
  });

  // P39 iter2 F8: connectionsState.records is a plain array — every one of its twenty-six
  // find-by-id call sites re-derived this same predicate. Accepts null/undefined so a call site's
  // own `connectionId ? … : undefined` ternary collapses into the call.
  function connectionRecord(id: string | null | undefined): ConnectionSummary | undefined {
    if (!id) return undefined;
    return state.records.find((r) => r.id === id);
  }

  let unsubscribeState: (() => void) | null = null;
  let unsubscribeListChanged: (() => void) | null = null;

  async function hydrateConnections(): Promise<void> {
    const [records, states, secretStorage] = await Promise.all([
      control.connectionsList(),
      control.connectionsStates(),
      control.connectionsSecretsStatus(),
    ]);
    state.records = records;
    for (const s of states) state.states[s.connectionId] = s;
    state.secretStorage = secretStorage;

    unsubscribeState?.();
    unsubscribeState = control.onConnectionState((s) => {
      state.states[s.connectionId] = s;
    });

    // Covers any mutation that didn't go through this store's own wrappers below (saveDialog(),
    // duplicateConnection(), ...) — e.g. a connection created via a direct IPC call — so the tree
    // never silently diverges from what main actually persisted.
    unsubscribeListChanged?.();
    unsubscribeListChanged = control.onConnectionsChanged((records) => {
      state.records = records;
    });
  }

  // P57 finding: `onConnectionsChanged`'s own full-replace (above) and this function's optimistic
  // append are independently scheduled — the Wails server-mode transport (tests/e2e-real/) delivers
  // the event on an independent WebSocket ahead of the bound call's own HTTP response often enough
  // to expose it, and nothing in the desktop transport actually guarantees the opposite order
  // either. Pushing a record the event's replace already added duplicates the row; upserting instead
  // of pushing makes either arrival order produce the same one-record result.
  function upsertRecord(record: ConnectionSummary): void {
    const idx = state.records.findIndex((r) => r.id === record.id);
    if (idx >= 0) state.records[idx] = record;
    else state.records.push(record);
  }

  async function duplicateConnection(id: string): Promise<ConnectionSummary> {
    const created = await control.connectionsDuplicate(id);
    upsertRecord(created);
    return created;
  }

  async function deleteConnection(id: string): Promise<void> {
    await control.connectionsDelete(id);
    state.records = state.records.filter((r) => r.id !== id);
    delete state.states[id];
  }

  async function connectConnection(id: string): Promise<void> {
    const s = await control.connectionsConnect(id);
    state.states[id] = s;
  }

  async function disconnectConnection(id: string): Promise<void> {
    const s = await control.connectionsDisconnect(id);
    state.states[id] = s;
  }

  // P39 iter2 F9/D9: the find-existing -> strip id/sortOrder/createdAt/updatedAt -> connectionsUpdate
  // -> splice-back body setConnectionColor and setConnectionReadOnly share. Returns whether a
  // record was found and patched — setConnectionReadOnly's reconnect tail must still not run when
  // it wasn't, which is why this isn't the void the two public functions themselves return.
  async function patchConnectionFields(
    id: string,
    patch: Partial<ConnectionInput>,
  ): Promise<boolean> {
    const existing = connectionRecord(id);
    if (!existing) return false;
    const {
      id: _id,
      sortOrder: _sortOrder,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      ...fields
    } = existing;
    const updated = await control.connectionsUpdate(id, { ...fields, ...patch, password: null });
    const idx = state.records.findIndex((r) => r.id === id);
    if (idx >= 0) state.records[idx] = updated;
    return true;
  }

  async function setConnectionColor(id: string, color: ConnectionSummary['color']): Promise<void> {
    await patchConnectionFields(id, { color });
  }

  async function setConnectionReadOnly(id: string, readOnly: boolean): Promise<void> {
    if (!(await patchConnectionFields(id, { readOnly }))) return;
    // §9b: forces a reconnect so the engine picks up the new flag when the connection is live.
    if (state.states[id]?.status === 'connected') {
      await disconnectConnection(id);
      await connectConnection(id);
    }
  }

  // M1 §6.2: the Database MCP section's own allow-list checkbox, setConnectionColor's own shape —
  // no reconnect needed, unlike setConnectionReadOnly: this gates whether the DB MCP server exposes
  // the connection to an AI client, never what the live adapter connection itself does.
  async function setConnectionMcpEnabled(id: string, mcpEnabled: boolean): Promise<void> {
    await patchConnectionFields(id, { mcpEnabled });
  }

  return {
    ...toRefs(state),
    connectionRecord,
    hydrateConnections,
    upsertRecord,
    duplicateConnection,
    deleteConnection,
    connectConnection,
    disconnectConnection,
    setConnectionColor,
    setConnectionReadOnly,
    setConnectionMcpEnabled,
  };
});

function defaultDraft(): ConnectionInput {
  return {
    name: '',
    kind: 'postgres',
    color: 'none',
    mode: 'fields',
    readOnly: false,
    host: '',
    port: DEFAULT_PORT.postgres ?? null,
    database: null,
    username: null,
    password: null,
    uri: null,
    options: {},
    preconnect: null,
    preconnectSidecar: false,
    autoExplain: false,
    throttlePerSec: 0,
    mcpEnabled: false,
    mcpDescription: '',
    mcpReadMode: 'allow',
    mcpWriteMode: 'prompt',
    mcpDdlMode: 'deny',
    mcpAutoExplain: true,
  };
}

export const useConnectionDialogStore = defineStore('connectionDialog', () => {
  const dialog = reactive<ConnectionDialogState>({
    open: false,
    mode: 'create',
    editingId: null,
    draft: null,
    error: null,
  });

  function openCreateDialog(): void {
    Object.assign(dialog, {
      open: true,
      mode: 'create',
      editingId: null,
      draft: defaultDraft(),
      error: null,
    });
  }

  // P14 D1: editing no longer reveals anything on open — the dialog used to call reveal() here and
  // put the plaintext straight into `draft.password` (P25 D9's old contract), but that secret was
  // then sitting in the DOM the whole time the dialog was open, whether or not the user ever asked
  // to see it (the eye toggle was just `type="password"` vs `type="text"` over a value already
  // there — no real confirmation gated it at all). The draft now opens with `password: null`, which
  // Update's three-state convention already treats as "unchanged" (service.go:253) — exactly what
  // URI mode has done since P2 R2, extended here to fields mode too. ConnectionDialog.vue's own
  // `onReveal()` is what actually fetches the secret now, gated behind local authentication
  // (internal/localauth), only when the user presses "Show password".
  function openEditDialog(id: string): void {
    const summary = useConnectionsStore().connectionRecord(id);
    if (!summary) return;
    const {
      id: _id,
      sortOrder: _sortOrder,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      ...fields
    } = summary;
    Object.assign(dialog, {
      open: true,
      mode: 'edit',
      editingId: id,
      draft: { ...fields, password: null },
      error: null,
    });
  }

  function closeDialog(): void {
    dialog.open = false;
    dialog.draft = null;
  }

  // D7: throws on a failed create/update rather than swallowing it into a returned null — the
  // dialog's own onSave() is the single place that decides what a failed save looks like, and it
  // only sees a rejection if this function never catches one.
  async function saveDialog(): Promise<ConnectionSummary | null> {
    const { mode, editingId, draft } = dialog;
    if (!draft) return null;

    const connectionsStore = useConnectionsStore();
    let saved: ConnectionSummary;
    if (mode === 'create') {
      saved = await control.connectionsCreate(draft);
      connectionsStore.upsertRecord(saved);
    } else {
      if (!editingId) return null;
      saved = await control.connectionsUpdate(editingId, draft);
      connectionsStore.upsertRecord(saved);
    }
    closeDialog();
    return saved;
  }

  return { ...toRefs(dialog), openCreateDialog, openEditDialog, closeDialog, saveDialog };
});
