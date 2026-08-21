<script setup lang="ts">
import type { ConnectionKind, ConnectionMode } from '@shared/connection';
import { connectionInputSchema } from '@shared/connection';
import type { TestResult } from '@shared/engine-ops';
import { canRoundTripToFields, formatConnectionUri, parseConnectionUri } from '@shared/uri';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { control } from '../bridge/control';
import Codicon from '../theme/Codicon.vue';
import ColorPicker from './ColorPicker.vue';
import {
  type ConnectionDraft,
  closeDialog,
  connectionsState,
  createConnection,
  draftToInput,
  updateConnection,
} from './state/connections';

// §8.12 connection dialog. Same visual language as SettingsDialog (scrim, Escape, focus trap,
// footer buttons) — the .field / .segmented / .dialog CSS is copied, not shared (P1 rule).

const emit = defineEmits<{ close: [] }>();

const KINDS: Array<{ value: ConnectionKind; label: string; supported: boolean }> = [
  { value: 'postgres', label: 'PostgreSQL', supported: true },
  { value: 'mariadb', label: 'MariaDB', supported: false },
  { value: 'mongodb', label: 'MongoDB', supported: false },
  { value: 'redis', label: 'Redis', supported: false },
  { value: 'kafka', label: 'Kafka', supported: false },
  { value: 'sqs', label: 'SQS', supported: false },
  { value: 's3', label: 'S3', supported: false },
];

const editing = computed(() => connectionsState.dialog.mode === 'edit');
const targetId = computed(() => connectionsState.dialog.targetId);

const draft = ref<ConnectionDraft>(
  connectionsState.dialog.draft ?? {
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
  },
);

const dialogRef = ref<HTMLElement | null>(null);
const revealPassword = ref(false);
const uriReason = ref<string | null>(null);
const testing = ref(false);
const testResult = ref<TestResult | null>(null);
const saving = ref(false);
const saveError = ref<string | null>(null);

const parsed = computed(() =>
  connectionInputSchema.safeParse(draftToInput(draft.value, editing.value)),
);
const isValid = computed(() => parsed.value.success);

function issuesFor(path: string): string[] {
  if (parsed.value.success) return [];
  return parsed.value.error.issues.filter((i) => i.path[0] === path).map((i) => i.message);
}

const uriParsed = computed(() => parseConnectionUri(draft.value.uri));
const uriHint = computed(() => {
  const p = uriParsed.value;
  if (!p) return draft.value.uri ? 'Cannot be parsed into fields — will be used as-is.' : '';
  let out = `${p.scheme}://`;
  if (p.username) out += `${p.username}${p.password ? ':***' : ''}@`;
  out += p.host ?? '';
  if (p.port != null) out += `:${p.port}`;
  if (p.database) out += `/${p.database}`;
  const params = Object.keys(p.params);
  if (params.length) out += ` (${params.join(', ')})`;
  return out;
});

function setMode(mode: ConnectionMode): void {
  if (mode === draft.value.mode) return;
  if (mode === 'uri') {
    // fields → URI: regenerate from the current fields so the flip always shows a current string.
    draft.value.uri = formatConnectionUri(draftToInput(draft.value, false));
    draft.value.mode = 'uri';
    uriReason.value = null;
  } else {
    const p = parseConnectionUri(draft.value.uri);
    if (p && canRoundTripToFields(p, draft.value.kind)) {
      draft.value.host = p.host ?? '';
      draft.value.port = p.port;
      draft.value.database = p.database ?? '';
      draft.value.username = p.username ?? '';
      draft.value.password = p.password ?? '';
      draft.value.mode = 'fields';
      uriReason.value = null;
    } else {
      uriReason.value = 'Cannot be parsed into fields — will be used as-is.';
    }
  }
}

function onPortInput(e: Event): void {
  const value = (e.target as HTMLInputElement).value;
  draft.value.port = value === '' ? null : Number(value);
}

function onPasswordInput(e: Event): void {
  draft.value.password = (e.target as HTMLInputElement).value;
  draft.value.passwordTouched = true;
}

async function onTest(): Promise<void> {
  testing.value = true;
  testResult.value = null;
  try {
    testResult.value = await control.connectionsTest(draftToInput(draft.value, false));
  } catch (err) {
    testResult.value = { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    testing.value = false;
  }
}

async function onSave(): Promise<void> {
  if (!parsed.value.success) return;
  saving.value = true;
  saveError.value = null;
  try {
    const input = parsed.value.data;
    if (editing.value && targetId.value) await updateConnection(targetId.value, input);
    else await createConnection(input);
    emit('close');
  } catch (err) {
    saveError.value = err instanceof Error ? err.message : String(err);
  } finally {
    saving.value = false;
  }
}

function onClose(): void {
  closeDialog();
  emit('close');
}

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
    onClose();
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

onMounted(() => {
  document.addEventListener('keydown', onKeydown);
  dialogRef.value?.focus();
});

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <div class="scrim" data-testid="connection-dialog" @click.self="onClose">
    <div ref="dialogRef" class="dialog" role="dialog" aria-modal="true" tabindex="-1">
      <div class="dialog-body">
        <div class="row">
          <label class="field grow">
            <span>Name</span>
            <input v-model="draft.name" type="text" data-testid="connection-name" />
            <span v-if="issuesFor('name').length" class="issue">{{ issuesFor('name')[0] }}</span>
          </label>
          <div class="field">
            <span>Color</span>
            <ColorPicker v-model="draft.color" />
          </div>
        </div>

        <label class="field">
          <span>Kind</span>
          <select v-model="draft.kind" data-testid="connection-kind">
            <option v-for="kind in KINDS" :key="kind.value" :value="kind.value" :disabled="!kind.supported">
              {{ kind.supported ? kind.label : `${kind.label} — not yet supported` }}
            </option>
          </select>
        </label>

        <div class="field">
          <span>Mode</span>
          <div class="segmented">
            <button
              type="button"
              data-testid="connection-mode-fields"
              :class="{ active: draft.mode === 'fields' }"
              @click="setMode('fields')"
            >
              Fields
            </button>
            <button
              type="button"
              data-testid="connection-mode-uri"
              :class="{ active: draft.mode === 'uri' }"
              @click="setMode('uri')"
            >
              URI
            </button>
          </div>
        </div>

        <template v-if="draft.mode === 'fields'">
          <div class="row">
            <label class="field grow">
              <span>Host</span>
              <input v-model="draft.host" type="text" data-testid="connection-host" />
              <span v-if="issuesFor('host').length" class="issue">{{ issuesFor('host')[0] }}</span>
            </label>
            <label class="field">
              <span>Port</span>
              <input
                type="number"
                min="1"
                max="65535"
                :value="draft.port ?? ''"
                data-testid="connection-port"
                @input="onPortInput"
              />
              <span v-if="issuesFor('port').length" class="issue">{{ issuesFor('port')[0] }}</span>
            </label>
          </div>

          <label class="field">
            <span>Database</span>
            <input v-model="draft.database" type="text" data-testid="connection-database" />
          </label>

          <label class="field">
            <span>User</span>
            <input v-model="draft.username" type="text" data-testid="connection-user" />
          </label>

          <label class="field">
            <span>Password</span>
            <div class="password-wrap">
              <input
                :type="revealPassword ? 'text' : 'password'"
                :value="draft.password"
                data-testid="connection-password"
                @input="onPasswordInput"
              />
              <button
                type="button"
                class="eye"
                :aria-label="revealPassword ? 'Hide password' : 'Show password'"
                @click="revealPassword = !revealPassword"
              >
                <Codicon :name="revealPassword ? 'eye-closed' : 'eye'" :size="14" />
              </button>
            </div>
          </label>
        </template>

        <template v-else>
          <label class="field">
            <span>URI</span>
            <input v-model="draft.uri" type="text" data-testid="connection-uri" @blur="uriReason = null" />
            <span v-if="issuesFor('uri').length" class="issue">{{ issuesFor('uri')[0] }}</span>
            <span v-else-if="uriReason" class="issue">{{ uriReason }}</span>
            <span v-else-if="uriHint" class="muted-note mono">{{ uriHint }}</span>
          </label>
        </template>

        <label class="field checkbox">
          <input v-model="draft.readOnly" type="checkbox" data-testid="connection-readonly" />
          <span>Read-only</span>
        </label>
        <p class="muted-note">Blocks every mutation path for this connection.</p>

        <p class="warn">Credentials are stored unencrypted in ~/.kira-studio/kira.sqlite.</p>
        <p v-if="saveError" class="issue">{{ saveError }}</p>
      </div>

      <div class="dialog-footer">
        <div class="footer-left">
          <button type="button" data-testid="connection-test" :disabled="testing" @click="onTest">
            <Codicon name="debug-start" :size="14" />
            Test connection
          </button>
          <span v-if="testing" class="chip muted">Testing…</span>
          <span v-else-if="testResult?.ok" class="chip ok" data-testid="connection-test-ok">
            OK — {{ testResult.serverVersion }}
          </span>
          <span v-else-if="testResult && !testResult.ok" class="chip error" data-testid="connection-test-fail">
            {{ testResult.error }}
          </span>
        </div>
        <div class="footer-right">
          <button type="button" data-testid="connection-cancel" @click="onClose">Cancel</button>
          <button
            type="button"
            class="primary"
            data-testid="connection-save"
            :disabled="!isValid || saving"
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
  width: 520px;
  background: var(--kira-bg-elevated);
  border: var(--kira-border-width) solid var(--kira-border-strong);
  border-radius: var(--kira-radius);
  box-shadow: var(--kira-shadow);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.dialog-body {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 70vh;
  overflow: auto;
}

.row {
  display: flex;
  gap: 12px;
}

.grow {
  flex: 1;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}

.field.checkbox {
  flex-direction: row;
  align-items: center;
  gap: 6px;
}

.field input[type='text'],
.field input[type='number'],
.field input[type='password'],
.field select {
  background: var(--kira-bg-input);
  border: var(--kira-border-width) solid var(--kira-border);
  border-radius: var(--kira-radius);
  color: var(--kira-fg);
  padding: 4px 6px;
}

.field select option:disabled {
  color: var(--kira-fg-disabled);
}

.password-wrap {
  position: relative;
}

.password-wrap input {
  width: 100%;
  box-sizing: border-box;
  padding-right: 26px;
}

.eye {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  background: transparent;
  border: none;
  color: var(--kira-fg-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
}

.segmented {
  display: flex;
  gap: 2px;
}

.segmented button {
  flex: 1;
  padding: 4px 8px;
  border-radius: var(--kira-radius);
  border: var(--kira-border-width) solid var(--kira-border);
  background: var(--kira-bg-input);
  color: var(--kira-fg-muted);
  cursor: pointer;
}

.segmented button.active {
  background: var(--kira-select);
  color: var(--kira-fg);
}

.muted-note {
  color: var(--kira-fg-disabled);
  font-size: 11px;
  margin: 0;
}

.mono {
  font-family: var(--kira-font-family);
  word-break: break-all;
}

.warn {
  color: var(--kira-warn);
  font-size: 11px;
  margin: 0;
}

.issue {
  color: var(--kira-error);
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

.footer-left,
.footer-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.dialog-footer button {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: var(--kira-radius);
  border: var(--kira-border-width) solid var(--kira-border);
  background: var(--kira-bg-input);
  color: var(--kira-fg);
  cursor: pointer;
}

.dialog-footer button:disabled {
  color: var(--kira-fg-disabled);
  cursor: default;
}

.dialog-footer button.primary {
  background: var(--kira-accent);
  border-color: var(--kira-accent);
  color: var(--kira-accent-fg);
}

.chip {
  font-size: 11px;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chip.ok {
  color: var(--kira-ok);
}

.chip.error {
  color: var(--kira-error);
}

.chip.muted {
  color: var(--kira-fg-muted);
}
</style>
