import type {
  ConnectionInput,
  ConnectionState,
  ConnectionSummary,
} from '@shared/domain/connection';
import { DEFAULT_PORT } from '@shared/domain/connection';
import type { SecretStorageStatus } from '@shared/domain/secrets';
import { reactive } from 'vue';
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

export const connectionsState = reactive({
  records: [] as ConnectionSummary[],
  states: {} as Record<string, ConnectionState>,
  dialog: {
    open: false,
    mode: 'create',
    editingId: null,
    draft: null,
    error: null,
  } as ConnectionDialogState,
  // P25: reported once at startup and never changes for the life of the process — the
  // connection dialog's credential note (D8) reads this directly.
  secretStorage: null as SecretStorageStatus | null,
});

// P39 iter2 F8: connectionsState.records is a plain array — every one of its twenty-six
// find-by-id call sites re-derived this same predicate. Accepts null/undefined so a call site's
// own `connectionId ? … : undefined` ternary collapses into the call.
export function connectionRecord(id: string | null | undefined): ConnectionSummary | undefined {
  if (!id) return undefined;
  return connectionsState.records.find((r) => r.id === id);
}

let unsubscribeState: (() => void) | null = null;
let unsubscribeListChanged: (() => void) | null = null;

export async function hydrateConnections(): Promise<void> {
  const [records, states, secretStorage] = await Promise.all([
    control.connectionsList(),
    control.connectionsStates(),
    control.connectionsSecretsStatus(),
  ]);
  connectionsState.records = records;
  for (const state of states) connectionsState.states[state.connectionId] = state;
  connectionsState.secretStorage = secretStorage;

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
  };
}

export function openCreateDialog(): void {
  connectionsState.dialog = {
    open: true,
    mode: 'create',
    editingId: null,
    draft: defaultDraft(),
    error: null,
  };
}

// D9: editing calls reveal() once and puts the secret in the draft's password field; if the
// user never touches it, the draft still carries the real value here but the field renders
// masked (ConnectionDialog.vue) and the plain three-state convention on save is unaffected —
// the dialog always sends the *current* password value, never a sentinel for "unchanged". A
// decrypt failure (a restored kira.sqlite from another machine, a reset login keychain) opens
// the dialog anyway, with an empty password field and `error` set instead of throwing — the
// caller here has no try/catch of its own, so a throw would silently no-op the Edit menu item.
//
// P2 R2: for a URI-mode connection, the revealed secret is deliberately left out of the draft.
// ConnectionDialog.vue renders no password input while `mode === 'uri'` (the URI text is the only
// thing the user can see or edit there, and D7 already strips any password out of it for
// display), so putting the plaintext secret in `draft.password` regardless of mode just left it
// sitting in memory with no way to clear it, still shipped verbatim on every later save/test even
// after the user retyped the URI for an entirely different host. Fields mode still needs it: it
// is the field the user actually sees and edits there.
export async function openEditDialog(id: string): Promise<void> {
  const summary = connectionRecord(id);
  if (!summary) return;
  const { password, error } = await control.connectionsReveal(id);
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
    draft: { ...fields, password: fields.mode === 'fields' ? password : null },
    error,
  };
}

export function closeDialog(): void {
  connectionsState.dialog.open = false;
  connectionsState.dialog.draft = null;
}

// P57 finding: `onConnectionsChanged`'s own full-replace (above) and this function's optimistic
// append are independently scheduled — the Wails server-mode transport (tests/e2e-real/) delivers
// the event on an independent WebSocket ahead of the bound call's own HTTP response often enough
// to expose it, and nothing in the desktop transport actually guarantees the opposite order
// either. Pushing a record the event's replace already added duplicates the row; upserting instead
// of pushing makes either arrival order produce the same one-record result.
function upsertRecord(record: ConnectionSummary): void {
  const idx = connectionsState.records.findIndex((r) => r.id === record.id);
  if (idx >= 0) connectionsState.records[idx] = record;
  else connectionsState.records.push(record);
}

// D7: throws on a failed create/update rather than swallowing it into a returned null — the
// dialog's own onSave() is the single place that decides what a failed save looks like, and it
// only sees a rejection if this function never catches one.
export async function saveDialog(): Promise<ConnectionSummary | null> {
  const { mode, editingId, draft } = connectionsState.dialog;
  if (!draft) return null;

  let saved: ConnectionSummary;
  if (mode === 'create') {
    saved = await control.connectionsCreate(draft);
    upsertRecord(saved);
  } else {
    if (!editingId) return null;
    saved = await control.connectionsUpdate(editingId, draft);
    upsertRecord(saved);
  }
  closeDialog();
  return saved;
}

export async function duplicateConnection(id: string): Promise<ConnectionSummary> {
  const created = await control.connectionsDuplicate(id);
  upsertRecord(created);
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
  const idx = connectionsState.records.findIndex((r) => r.id === id);
  if (idx >= 0) connectionsState.records[idx] = updated;
  return true;
}

export async function setConnectionColor(
  id: string,
  color: ConnectionSummary['color'],
): Promise<void> {
  await patchConnectionFields(id, { color });
}

export async function setConnectionReadOnly(id: string, readOnly: boolean): Promise<void> {
  if (!(await patchConnectionFields(id, { readOnly }))) return;
  // §9b: forces a reconnect so the engine picks up the new flag when the connection is live.
  if (connectionsState.states[id]?.status === 'connected') {
    await disconnectConnection(id);
    await connectConnection(id);
  }
}
