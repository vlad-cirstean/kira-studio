import type {
  ConnectionColor,
  ConnectionInput,
  ConnectionKind,
  ConnectionMode,
  ConnectionState,
  ConnectionSummary,
} from '@shared/connection';
import { injectUriPassword } from '@shared/uri';
import { reactive } from 'vue';
import { control } from '../../bridge/control';

// Connection list + per-connection state (Step 7a). Plain reactive() per P0 D4 — no Pinia.

export interface ConnectionDraft {
  name: string;
  kind: ConnectionKind;
  color: ConnectionColor;
  mode: ConnectionMode;
  readOnly: boolean;
  host: string;
  port: number | null;
  database: string;
  username: string;
  password: string;
  uri: string;
  options: Record<string, unknown>;
  // For editing: whether the user touched the password field. Untouched → send null (unchanged).
  passwordTouched: boolean;
}

export const connectionsState = reactive({
  records: [] as ConnectionSummary[],
  states: {} as Record<string, ConnectionState>,
  dialog: {
    open: false,
    mode: 'create' as 'create' | 'edit',
    targetId: null as string | null,
    draft: null as ConnectionDraft | null,
  },
});

export function defaultDraft(): ConnectionDraft {
  return {
    name: '',
    kind: 'postgres',
    color: 'blue',
    mode: 'fields',
    readOnly: false,
    host: 'localhost',
    port: 5432,
    database: '',
    username: '',
    password: '',
    uri: '',
    options: {},
    passwordTouched: false,
  };
}

export function openCreateDialog(): void {
  connectionsState.dialog.mode = 'create';
  connectionsState.dialog.targetId = null;
  connectionsState.dialog.draft = defaultDraft();
  connectionsState.dialog.open = true;
}

export async function openEditDialog(id: string): Promise<void> {
  const summary = connectionsState.records.find((r) => r.id === id);
  if (!summary) return;
  const { password } = await control.connectionsReveal({ id });
  connectionsState.dialog.mode = 'edit';
  connectionsState.dialog.targetId = id;
  connectionsState.dialog.draft = {
    name: summary.name,
    kind: summary.kind,
    color: summary.color,
    mode: summary.mode,
    readOnly: summary.readOnly,
    host: summary.host ?? '',
    port: summary.port,
    database: summary.database ?? '',
    username: summary.username ?? '',
    password: password ?? '',
    // In URI mode the stored URI is passwordless (D7); re-inject the secret so the user edits a
    // complete string and saving round-trips the password instead of silently clearing it.
    uri:
      summary.mode === 'uri' && summary.uri
        ? injectUriPassword(summary.uri, password)
        : (summary.uri ?? ''),
    options: summary.options ?? {},
    passwordTouched: false,
  };
  connectionsState.dialog.open = true;
}

export function closeDialog(): void {
  connectionsState.dialog.open = false;
  connectionsState.dialog.draft = null;
}

// Draft → ConnectionInput. D9's three-state password rule applies only when editing: untouched →
// null (unchanged); '' clears; non-empty sets. Creating always sends the literal password.
export function draftToInput(draft: ConnectionDraft, editing: boolean): ConnectionInput {
  return {
    name: draft.name,
    kind: draft.kind,
    color: draft.color,
    mode: draft.mode,
    readOnly: draft.readOnly,
    host: draft.host || null,
    port: draft.port,
    database: draft.database || null,
    username: draft.username || null,
    password: editing && !draft.passwordTouched ? null : draft.password,
    uri: draft.uri || null,
    options: draft.options,
  };
}

export async function hydrateConnections(): Promise<void> {
  const [records, states] = await Promise.all([
    control.connectionsList(),
    control.connectionsStates(),
  ]);
  connectionsState.records = records;
  for (const state of states) connectionsState.states[state.connectionId] = state;
  control.onConnectionState((state) => {
    connectionsState.states[state.connectionId] = state;
  });
}

export async function refreshConnections(): Promise<void> {
  connectionsState.records = await control.connectionsList();
}

export async function createConnection(input: ConnectionInput): Promise<void> {
  await control.connectionsCreate(input);
  await refreshConnections();
}

export async function updateConnection(id: string, input: ConnectionInput): Promise<void> {
  await control.connectionsUpdate({ id, input });
  await refreshConnections();
}

// Partial update (color, read-only) without opening the full dialog. Builds a complete input from
// the stored summary; password null = unchanged (D9's three-state rule).
export async function patchConnection(id: string, patch: Partial<ConnectionInput>): Promise<void> {
  const summary = connectionsState.records.find((r) => r.id === id);
  if (!summary) return;
  await control.connectionsUpdate({
    id,
    input: {
      name: summary.name,
      kind: summary.kind,
      color: summary.color,
      mode: summary.mode,
      readOnly: summary.readOnly,
      host: summary.host,
      port: summary.port,
      database: summary.database,
      username: summary.username,
      password: null,
      uri: summary.uri,
      options: summary.options,
      ...patch,
    },
  });
  await refreshConnections();
}

export async function connectConnection(id: string): Promise<void> {
  connectionsState.states[id] = await control.connectionsConnect({ id });
}

export async function disconnectConnection(id: string): Promise<void> {
  connectionsState.states[id] = await control.connectionsDisconnect({ id });
}
