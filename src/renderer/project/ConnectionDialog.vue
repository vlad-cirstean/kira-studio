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
  refreshConnections,
  updateConnection,
} from './state/connections';

// §8.12 connection dialog. Same visual language as the design-review mockup (design/connection-dialog.html):
// header with close, label-left field rows, Fields/URI tabs, warning box, switch, footer actions.

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

async function onDelete(): Promise<void> {
  if (!editing.value || !targetId.value) return;
  await control.connectionsDelete({ id: targetId.value });
  await refreshConnections();
  onClose();
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
      <div class="header">
        <span>{{ editing ? 'Edit connection' : 'New connection' }}</span>
        <button type="button" class="header-close" aria-label="Close" @click="onClose">
          <Codicon name="close" :size="14" />
        </button>
      </div>

      <div class="body">
        <div class="row">
          <label class="row-label">Name</label>
          <div class="min-w-0 flex-1">
            <input
              v-model="draft.name"
              type="text"
              class="input"
              data-testid="connection-name"
            />
            <span v-if="issuesFor('name').length" class="issue">{{ issuesFor('name')[0] }}</span>
          </div>
        </div>

        <div class="row items-start">
          <label class="row-label pt-0.5">Color</label>
          <ColorPicker v-model="draft.color" />
        </div>

        <div class="row">
          <label class="row-label">Kind</label>
          <select v-model="draft.kind" class="input" data-testid="connection-kind">
            <option
              v-for="kind in KINDS"
              :key="kind.value"
              :value="kind.value"
              :disabled="!kind.supported"
            >
              {{ kind.supported ? kind.label : `${kind.label} — not yet supported` }}
            </option>
          </select>
        </div>

        <div class="mode-tabs">
          <button
            type="button"
            class="mode-tab"
            :class="{ active: draft.mode === 'fields' }"
            data-testid="connection-mode-fields"
            @click="setMode('fields')"
          >
            Fields
          </button>
          <button
            type="button"
            class="mode-tab"
            :class="{ active: draft.mode === 'uri' }"
            data-testid="connection-mode-uri"
            @click="setMode('uri')"
          >
            URI
          </button>
        </div>

        <template v-if="draft.mode === 'fields'">
          <div class="row">
            <label class="row-label">Host</label>
            <div class="min-w-0 flex-1">
              <input v-model="draft.host" type="text" class="input" data-testid="connection-host" />
              <span v-if="issuesFor('host').length" class="issue">{{ issuesFor('host')[0] }}</span>
            </div>
          </div>
          <div class="row">
            <label class="row-label">Port</label>
            <div class="w-24">
              <input
                type="number"
                min="1"
                max="65535"
                :value="draft.port ?? ''"
                class="input"
                data-testid="connection-port"
                @input="onPortInput"
              />
              <span v-if="issuesFor('port').length" class="issue">{{ issuesFor('port')[0] }}</span>
            </div>
          </div>
          <div class="row">
            <label class="row-label">Database</label>
            <div class="min-w-0 flex-1">
              <input
                v-model="draft.database"
                type="text"
                class="input"
                data-testid="connection-database"
              />
            </div>
          </div>
          <div class="row">
            <label class="row-label">User</label>
            <div class="min-w-0 flex-1">
              <input
                v-model="draft.username"
                type="text"
                class="input"
                data-testid="connection-user"
              />
            </div>
          </div>
          <div class="row">
            <label class="row-label">Password</label>
            <div class="relative min-w-0 flex-1">
              <input
                :type="revealPassword ? 'text' : 'password'"
                :value="draft.password"
                class="input pr-8"
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
          </div>
        </template>

        <template v-else>
          <div class="row">
            <label class="row-label">URI</label>
            <div class="min-w-0 flex-1">
              <input
                v-model="draft.uri"
                type="text"
                class="input mono"
                data-testid="connection-uri"
                @blur="uriReason = null"
              />
              <span v-if="issuesFor('uri').length" class="issue">{{ issuesFor('uri')[0] }}</span>
              <span v-else-if="uriReason" class="issue">{{ uriReason }}</span>
              <span v-else-if="uriHint" class="muted-note mono">{{ uriHint }}</span>
            </div>
          </div>
        </template>

        <div class="warn">
          <Codicon name="warning" :size="14" class="mt-px shrink-0" />
          <span
            >Credentials are stored unencrypted at
            <code class="font-mono">~/.kira-studio/kira.sqlite</code>.</span
          >
        </div>

        <div class="row">
          <label class="switch">
            <input
              type="checkbox"
              class="peer sr-only"
              v-model="draft.readOnly"
              data-testid="connection-readonly"
            />
            <span
              class="pointer-events-none absolute inset-0 rounded-full border border-line-strong bg-input transition-colors peer-checked:border-accent peer-checked:bg-accent"
            />
            <span
              class="pointer-events-none absolute top-[2px] left-[2px] h-3.5 w-3.5 rounded-full bg-white/80 transition-transform peer-checked:translate-x-[14px]"
            />
          </label>
          <span class="readonly-label">Read-only</span>
          <span class="readonly-hint">Blocks every mutation path for this connection.</span>
        </div>

        <div class="row pt-1">
          <button type="button" class="test-button" data-testid="connection-test" :disabled="testing" @click="onTest">
            <Codicon name="plug" :size="13" />
            Test connection
          </button>
          <span v-if="testing" class="chip muted">Testing…</span>
          <span v-else-if="testResult?.ok" class="chip ok" data-testid="connection-test-ok">
            Connected — {{ testResult.serverVersion }}
          </span>
          <span v-else-if="testResult && !testResult.ok" class="chip error" data-testid="connection-test-fail">
            {{ testResult.error }}
          </span>
        </div>

        <p v-if="saveError" class="issue">{{ saveError }}</p>
      </div>

      <div class="footer">
        <button
          v-if="editing"
          type="button"
          class="footer-button danger"
          data-testid="connection-delete"
          @click="onDelete"
        >
          Delete
        </button>
        <div class="flex-1" />
        <button type="button" class="footer-button" data-testid="connection-cancel" @click="onClose">
          Cancel
        </button>
        <button
          type="button"
          class="footer-button primary"
          data-testid="connection-save"
          :disabled="!isValid || saving"
          @click="onSave"
        >
          Save
        </button>
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
  width: 460px;
  max-width: calc(100vw - 32px);
  background: var(--kira-bg-elevated);
  border: var(--kira-border-width) solid var(--kira-border-strong);
  border-radius: 8px;
  box-shadow: var(--kira-shadow);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-size: 12px;
  color: var(--kira-fg);
}

.header {
  height: 36px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  border-bottom: var(--kira-border-width) solid var(--kira-border);
  font-size: 13px;
  font-weight: 600;
}

.header-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  border-radius: var(--kira-radius);
  color: var(--kira-fg-muted);
  cursor: pointer;
}

.header-close:hover {
  background: var(--kira-hover);
  color: var(--kira-fg);
}

.body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-height: 72vh;
  overflow: auto;
}

.row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.row-label {
  width: 72px;
  flex-shrink: 0;
  color: var(--kira-fg-muted);
}

.input {
  width: 100%;
  box-sizing: border-box;
  height: 24px;
  padding: 0 8px;
  background: var(--kira-bg-input);
  border: var(--kira-border-width) solid var(--kira-border-strong);
  border-radius: var(--kira-radius);
  color: var(--kira-fg);
  font-size: 12px;
  outline: none;
}

.input:focus {
  border-color: var(--kira-focus);
}

.input[disabled] {
  color: var(--kira-fg-disabled);
}

select.input option:disabled {
  color: var(--kira-fg-disabled);
}

.mono {
  font-family: var(--kira-font-family);
  word-break: break-all;
}

.eye {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--kira-fg-muted);
  cursor: pointer;
}

.eye:hover {
  color: var(--kira-fg);
}

.mode-tabs {
  display: flex;
  gap: 4px;
  margin: 0 -16px;
  padding: 0 16px;
  border-bottom: var(--kira-border-width) solid var(--kira-border);
}

.mode-tab {
  height: 28px;
  padding: 0 12px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--kira-fg-muted);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}

.mode-tab:hover {
  color: var(--kira-fg);
}

.mode-tab.active {
  border-bottom-color: var(--kira-accent);
  color: var(--kira-fg);
}

.warn {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border: var(--kira-border-width) solid var(--kira-border);
  border-radius: var(--kira-radius);
  background: color-mix(in srgb, var(--kira-warn) 10%, transparent);
  color: var(--kira-warn);
  font-size: 11px;
}

.switch {
  position: relative;
  display: inline-block;
  width: 32px;
  height: 18px;
  flex-shrink: 0;
  cursor: pointer;
}

.readonly-label {
  color: var(--kira-fg);
  flex-shrink: 0;
}

.readonly-hint {
  color: var(--kira-fg-disabled);
  font-size: 11px;
}

.test-button {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px;
  border-radius: var(--kira-radius);
  border: var(--kira-border-width) solid var(--kira-border-strong);
  background: var(--kira-bg-input);
  color: var(--kira-fg);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}

.test-button:hover:not(:disabled) {
  background: var(--kira-hover);
}

.test-button:disabled {
  color: var(--kira-fg-disabled);
  cursor: default;
}

.chip {
  font-size: 11px;
  max-width: 240px;
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

.muted-note {
  color: var(--kira-fg-disabled);
  font-size: 11px;
  margin: 0;
}

.issue {
  color: var(--kira-error);
  font-size: 11px;
}

.footer {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 44px;
  padding: 0 16px;
  border-top: var(--kira-border-width) solid var(--kira-border);
}

.footer-button {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 12px;
  border-radius: var(--kira-radius);
  border: var(--kira-border-width) solid var(--kira-border-strong);
  background: var(--kira-bg-input);
  color: var(--kira-fg);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}

.footer-button:hover:not(:disabled) {
  background: var(--kira-hover);
}

.footer-button:disabled {
  color: var(--kira-fg-disabled);
  cursor: default;
}

.footer-button.primary {
  background: var(--kira-accent);
  border-color: var(--kira-accent);
  color: var(--kira-accent-fg);
}

.footer-button.primary:hover:not(:disabled) {
  background: var(--kira-accent);
  filter: brightness(1.1);
}

.footer-button.danger {
  color: var(--kira-error);
}
</style>
