import type {
  ConnectionInput,
  ConnectionState,
  ConnectionSummary,
} from '@shared/domain/connection';
import { DEFAULT_PORT } from '@shared/domain/connection';
import { reactive } from 'vue';
import { control } from '../bridge/control';

export interface ConnectionDialogState {
  open: boolean;
  mode: 'create' | 'edit';
  editingId: string | null;
  draft: ConnectionInput | null;
}

export const connectionsState = reactive({
  records: [] as ConnectionSummary[],
  states: {} as Record<string, ConnectionState>,
  dialog: {
    open: false,
    mode: 'create',
    editingId: null,
    draft: null,
  } as ConnectionDialogState,
});

let unsubscribeState: (() => void) | null = null;
let unsubscribeListChanged: (() => void) | null = null;

export async function hydrateConnections(): Promise<void> {
  const [records, states] = await Promise.all([
    control.connectionsList(),
    control.connectionsStates(),
  ]);
  connectionsState.records = records;
  for (const state of states) connectionsState.states[state.connectionId] = state;

  unsubscribeState?.();
  unsubscribeState = control.onConnectionState((state) => {
    connectionsState.states[state.connectionId] = state;
  });

  // Covers any mutation that didn't go through this store's own wrappers below (saveDialog(),
  // duplicateConnection(), ...) — e.g. a connection created via a direct IPC call — so the tree
  // never silently diverges from what main actually persisted.
  unsubscribeListChanged?.();
  unsubscribeListChanged = control.onConnectionsChanged((records) => {
    connectionsState.records = records;
  });
}

export function defaultDraft(): ConnectionInput {
  return {
    name: '',
    kind: 'postgres',
    color: 'blue',
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
  };
}

export function openCreateDialog(): void {
  connectionsState.dialog = { open: true, mode: 'create', editingId: null, draft: defaultDraft() };
}

// D9: editing calls reveal() once and puts the secret in the draft's password field; if the
// user never touches it, the draft still carries the real value here but the field renders
// masked (ConnectionDialog.vue) and the plain three-state convention on save is unaffected —
// the dialog always sends the *current* password value, never a sentinel for "unchanged".
export async function openEditDialog(id: string): Promise<void> {
  const summary = connectionsState.records.find((r) => r.id === id);
  if (!summary) return;
  const { password } = await control.connectionsReveal(id);
  const {
    id: _id,
    sortOrder: _sortOrder,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...fields
  } = summary;
  connectionsState.dialog = {
    open: true,
    mode: 'edit',
    editingId: id,
    draft: { ...fields, password },
  };
}

export function closeDialog(): void {
  connectionsState.dialog.open = false;
  connectionsState.dialog.draft = null;
}

export async function saveDialog(): Promise<ConnectionSummary | null> {
  const { mode, editingId, draft } = connectionsState.dialog;
  if (!draft) return null;

  let saved: ConnectionSummary;
  if (mode === 'create') {
    saved = await control.connectionsCreate(draft);
    connectionsState.records.push(saved);
  } else {
    if (!editingId) return null;
    saved = await control.connectionsUpdate(editingId, draft);
    const idx = connectionsState.records.findIndex((r) => r.id === editingId);
    if (idx >= 0) connectionsState.records[idx] = saved;
  }
  closeDialog();
  return saved;
}

export async function duplicateConnection(id: string): Promise<ConnectionSummary> {
  const created = await control.connectionsDuplicate(id);
  connectionsState.records.push(created);
  return created;
}

export async function deleteConnection(id: string): Promise<void> {
  await control.connectionsDelete(id);
  connectionsState.records = connectionsState.records.filter((r) => r.id !== id);
  delete connectionsState.states[id];
}

export async function connectConnection(id: string): Promise<void> {
  const state = await control.connectionsConnect(id);
  connectionsState.states[id] = state;
}

export async function disconnectConnection(id: string): Promise<void> {
  const state = await control.connectionsDisconnect(id);
  connectionsState.states[id] = state;
}

export async function setConnectionColor(
  id: string,
  color: ConnectionSummary['color'],
): Promise<void> {
  const existing = connectionsState.records.find((r) => r.id === id);
  if (!existing) return;
  const {
    id: _id,
    sortOrder: _sortOrder,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...fields
  } = existing;
  const updated = await control.connectionsUpdate(id, { ...fields, color, password: null });
  const idx = connectionsState.records.findIndex((r) => r.id === id);
  if (idx >= 0) connectionsState.records[idx] = updated;
}

export async function setConnectionReadOnly(id: string, readOnly: boolean): Promise<void> {
  const existing = connectionsState.records.find((r) => r.id === id);
  if (!existing) return;
  const {
    id: _id,
    sortOrder: _sortOrder,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...fields
  } = existing;
  const updated = await control.connectionsUpdate(id, { ...fields, readOnly, password: null });
  const idx = connectionsState.records.findIndex((r) => r.id === id);
  if (idx >= 0) connectionsState.records[idx] = updated;
  // §9b: forces a reconnect so the engine picks up the new flag when the connection is live.
  if (connectionsState.states[id]?.status === 'connected') {
    await disconnectConnection(id);
    await connectConnection(id);
  }
}
