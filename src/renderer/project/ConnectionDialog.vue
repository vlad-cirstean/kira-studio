<script setup lang="ts">
import type { ConnectionKind } from '@shared/domain/connection';
import {
  connectionInputSchema,
  connectionKindSchema,
  DEFAULT_PORT,
} from '@shared/domain/connection';
import { canRoundTripToFields, formatConnectionUri, parseConnectionUri } from '@shared/domain/uri';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { control } from '../bridge/control';
import { closeDialog, connectionsState, saveDialog } from '../state/connections';
import Codicon from '../theme/Codicon.vue';
import ColorPicker from './ColorPicker.vue';

const KIND_LABEL: Record<ConnectionKind, string> = {
  postgres: 'PostgreSQL',
  mariadb: 'MariaDB',
  mongodb: 'MongoDB',
  redis: 'Redis',
  kafka: 'Kafka',
  sqs: 'SQS',
  s3: 'S3',
};
const SUPPORTED_KINDS: ReadonlySet<ConnectionKind> = new Set([
  'postgres',
  'mariadb',
  'mongodb',
  'redis',
]);
const kinds = connectionKindSchema.options;

const draft = computed(() => connectionsState.dialog.draft);
const isEdit = computed(() => connectionsState.dialog.mode === 'edit');

const showPassword = ref(false);
const uriNote = ref('');
const testState = ref<{ status: 'idle' | 'testing' | 'ok' | 'error'; message?: string }>({
  status: 'idle',
});
const fieldErrors = ref<Record<string, string>>({});

const dialogRef = ref<HTMLElement | null>(null);

function focusable(): HTMLElement[] {
  if (!dialogRef.value) return [];
  return Array.from(
    dialogRef.value.querySelectorAll<HTMLElement>(
      'button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => !el.hasAttribute('disabled'));
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    closeDialog();
    return;
  }
  if (e.key !== 'Tab') return;
  const items = focusable();
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

function refreshUriNote(): void {
  const d = draft.value;
  if (!d) return;
  const parsed = d.uri ? parseConnectionUri(d.uri) : null;
  uriNote.value = parsed
    ? `${parsed.host ?? '?'}:${parsed.port ?? '?'} / ${parsed.database ?? '(default)'}`
    : 'Cannot be parsed into fields — will be used as-is.';
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown);
  dialogRef.value?.focus();
  if (draft.value?.mode === 'uri') refreshUriNote();
});
onUnmounted(() => document.removeEventListener('keydown', onKeydown));

function setMode(mode: 'fields' | 'uri'): void {
  const d = draft.value;
  if (!d || mode === d.mode) return;

  if (mode === 'uri') {
    d.uri = formatConnectionUri(d);
    d.mode = 'uri';
    refreshUriNote();
    return;
  }

  // URI -> fields: only flip if it round-trips (§8.12); otherwise stay in URI mode and say why.
  const parsed = d.uri ? parseConnectionUri(d.uri) : null;
  if (!parsed || !canRoundTripToFields(parsed, d.kind)) {
    uriNote.value = parsed
      ? 'This URI cannot be represented as fields (multi-host, socket path, or unsafe characters) — staying in URI mode.'
      : 'Cannot be parsed into fields — will be used as-is.';
    return;
  }
  d.host = parsed.host;
  d.port = parsed.port;
  d.database = parsed.database;
  d.username = parsed.username;
  if (parsed.password) d.password = parsed.password;
  d.options = parsed.params;
  d.mode = 'fields';
  // Fields mode is now authoritative; a stale URI (which can carry a password in memory)
  // must not linger — the backend also refuses to store/return `uri` outside URI mode, but
  // there is no reason to keep it around in the draft either.
  d.uri = null;
}

function onKindChange(kind: ConnectionKind): void {
  const d = draft.value;
  if (!d || !SUPPORTED_KINDS.has(kind)) return;
  d.kind = kind;
  const defaultPort = DEFAULT_PORT[kind];
  if (defaultPort !== undefined) d.port = defaultPort;
}

async function onTest(): Promise<void> {
  const d = draft.value;
  if (!d) return;
  testState.value = { status: 'testing' };
  const result = await control.connectionsTest(d);
  testState.value = result.ok
    ? { status: 'ok', message: result.serverVersion }
    : { status: 'error', message: result.error };
}

async function onSave(): Promise<void> {
  const d = draft.value;
  if (!d) return;
  const parsed = connectionInputSchema.safeParse(d);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === 'string') errors[key] = issue.message;
    }
    fieldErrors.value = errors;
    return;
  }
  fieldErrors.value = {};
  await saveDialog();
}

const isValid = computed(() =>
  draft.value ? connectionInputSchema.safeParse(draft.value).success : false,
);
</script>

<template>
  <div v-if="draft" class="scrim" data-testid="connection-dialog" @click.self="closeDialog">
    <div ref="dialogRef" class="dialog" role="dialog" aria-modal="true" tabindex="-1">
      <div class="dialog-title">
        <span>{{ isEdit ? 'Edit Connection' : 'New Connection' }}</span>
        <button
          type="button"
          class="title-close"
          aria-label="Close"
          data-testid="connection-dialog-close"
          @click="closeDialog"
        >
          <Codicon name="close" :size="14" />
        </button>
      </div>
      <div class="dialog-body">
        <div class="field-row">
          <label class="field name-field">
            <span>Name</span>
            <input v-model="draft.name" type="text" data-testid="connection-name" />
          </label>
          <label class="field">
            <span>Color</span>
            <ColorPicker v-model="draft.color" />
          </label>
        </div>
        <span v-if="fieldErrors.name" class="field-error">{{ fieldErrors.name }}</span>

        <label class="field">
          <span>Kind</span>
          <select
            :value="draft.kind"
            data-testid="connection-kind"
            @change="onKindChange(($event.target as HTMLSelectElement).value as ConnectionKind)"
          >
            <option
              v-for="kind in kinds"
              :key="kind"
              :value="kind"
              :disabled="!SUPPORTED_KINDS.has(kind)"
            >
              {{ KIND_LABEL[kind] }}{{ SUPPORTED_KINDS.has(kind) ? '' : ' — not yet supported' }}
            </option>
          </select>
        </label>

        <div class="field">
          <span>Mode</span>
          <div class="segmented">
            <button
              type="button"
              :class="{ active: draft.mode === 'fields' }"
              data-testid="mode-fields"
              @click="setMode('fields')"
            >
              Fields
            </button>
            <button
              type="button"
              :class="{ active: draft.mode === 'uri' }"
              data-testid="mode-uri"
              @click="setMode('uri')"
            >
              URI
            </button>
          </div>
        </div>

        <template v-if="draft.mode === 'fields'">
          <div class="field-row">
            <label class="field">
              <span>Host</span>
              <input v-model="draft.host" type="text" data-testid="connection-host" />
            </label>
            <label class="field port-field">
              <span>Port</span>
              <input v-model.number="draft.port" type="number" data-testid="connection-port" />
            </label>
          </div>
          <span v-if="fieldErrors.host" class="field-error">{{ fieldErrors.host }}</span>
          <label class="field">
            <span>Database</span>
            <input v-model="draft.database" type="text" data-testid="connection-database" />
          </label>
          <label class="field">
            <span>User</span>
            <input v-model="draft.username" type="text" data-testid="connection-username" />
          </label>
          <label class="field">
            <span>Password</span>
            <div class="password-row">
              <input
                v-model="draft.password"
                :type="showPassword ? 'text' : 'password'"
                data-testid="connection-password"
              />
              <button
                type="button"
                class="icon-button"
                :aria-label="showPassword ? 'Hide password' : 'Show password'"
                @click="showPassword = !showPassword"
              >
                <Codicon :name="showPassword ? 'eye-closed' : 'eye'" />
              </button>
            </div>
          </label>
        </template>
        <template v-else>
          <label class="field">
            <span>URI</span>
            <input
              v-model="draft.uri"
              type="text"
              class="mono"
              data-testid="connection-uri"
              @input="refreshUriNote"
              @blur="refreshUriNote"
            />
          </label>
          <p class="mono uri-note">{{ uriNote }}</p>
        </template>

        <label class="field checkbox">
          <input v-model="draft.readOnly" type="checkbox" data-testid="connection-readonly" />
          <span>Read-only</span>
          <span class="helper-text">Blocks every mutation path for this connection.</span>
        </label>

        <p class="credential-warning">
          Credentials are stored unencrypted in ~/.kira-studio/kira.sqlite.
        </p>
      </div>

      <div class="dialog-footer">
        <div class="test-area">
          <button type="button" data-testid="connection-test" @click="onTest">
            <Codicon name="plug" />
            Test connection
          </button>
          <span
            v-if="testState.status !== 'idle'"
            class="test-chip"
            :class="testState.status"
            data-testid="connection-test-result"
          >
            {{
              testState.status === 'testing'
                ? 'Testing…'
                : testState.status === 'ok'
                  ? `OK — ${testState.message}`
                  : testState.message
            }}
          </span>
        </div>
        <div class="footer-actions">
          <button type="button" data-testid="connection-cancel" @click="closeDialog">Cancel</button>
          <button
            type="button"
            class="primary"
            data-testid="connection-save"
            :disabled="!isValid"
            @click="onSave"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  background: rgb(0 0 0 / 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.dialog {
  width: 480px;
  max-height: 80vh;
  background: var(--kira-bg-elevated);
  border: var(--kira-border-width) solid var(--kira-border-strong);
  border-radius: var(--kira-radius-lg);
  box-shadow: var(--kira-shadow-dialog);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.dialog-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 8px 8px 16px;
  border-bottom: var(--kira-border-width) solid var(--kira-border);
  font-size: 12px;
  font-weight: 600;
  flex-shrink: 0;
}

.title-close {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--kira-radius-sm);
  background: transparent;
  border: none;
  color: var(--kira-fg-muted);
  cursor: pointer;
  flex-shrink: 0;
}

.title-close:hover {
  background: var(--kira-hover);
  color: var(--kira-fg);
}

.dialog-body {
  flex: 1;
  overflow: auto;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  flex: 1;
}

.field-row {
  display: flex;
  gap: 12px;
}

.name-field {
  flex: 2;
}

.port-field {
  flex: 0 0 90px;
}

.field.checkbox {
  flex-direction: row;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.field input[type='text'],
.field input[type='number'],
.field input[type='password'],
.field select {
  background: var(--kira-bg-input);
  border: var(--kira-border-width) solid var(--kira-border);
  border-radius: var(--kira-radius-sm);
  color: var(--kira-fg);
  padding: 4px 6px;
}

.mono {
  font-family: var(--kira-font-family);
}

.password-row {
  display: flex;
  gap: 4px;
  align-items: center;
}

.password-row input {
  flex: 1;
}

.icon-button {
  background: transparent;
  border: none;
  color: var(--kira-fg-muted);
  cursor: pointer;
  padding: 2px;
}

.segmented {
  display: flex;
  gap: 2px;
}

.segmented button {
  flex: 1;
  padding: 4px 8px;
  border-radius: var(--kira-radius-sm);
  border: var(--kira-border-width) solid var(--kira-border);
  background: var(--kira-bg-input);
  color: var(--kira-fg-muted);
  cursor: pointer;
}

.segmented button.active {
  background: var(--kira-select);
  color: var(--kira-fg);
}

.uri-note {
  color: var(--kira-fg-muted);
  font-size: 11px;
}

.helper-text {
  color: var(--kira-fg-muted);
  font-size: 11px;
  width: 100%;
}

.field-error {
  color: var(--kira-error);
  font-size: 11px;
}

.credential-warning {
  color: var(--kira-warn);
  font-size: 11px;
}

.dialog-footer {
  border-top: var(--kira-border-width) solid var(--kira-border);
  padding: 8px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.test-area {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.test-chip {
  font-size: 11px;
  color: var(--kira-fg-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.test-chip.ok {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: var(--kira-radius-pill);
  background: #1c3d2c;
  color: var(--kira-ok);
}

.test-chip.error {
  color: var(--kira-error);
}

.footer-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.dialog-footer button {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: var(--kira-radius-sm);
  border: var(--kira-border-width) solid var(--kira-border);
  background: var(--kira-bg-input);
  color: var(--kira-fg);
  cursor: pointer;
}

.dialog-footer button:disabled {
  color: var(--kira-fg-disabled);
  cursor: not-allowed;
}

.dialog-footer button.primary {
  background: var(--kira-accent);
  border-color: var(--kira-accent);
  color: var(--kira-accent-fg);
}

.dialog-footer button.primary:disabled {
  background: var(--kira-bg-input);
  border-color: var(--kira-border);
  color: var(--kira-fg-disabled);
}
</style>
