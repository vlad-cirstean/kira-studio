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
import EngineIcon from '../theme/EngineIcon.vue';
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
// NewConnection.html's per-kind subtitle and accent colour for the engine picker tile —
// cosmetic copy/tint, not tied to anything persisted.
const KIND_SUB: Record<ConnectionKind, string> = {
  postgres: 'Tables, views, functions, DDL',
  mariadb: 'Also MySQL 8 and Percona',
  mongodb: 'Collections and documents',
  redis: 'Keys, hashes, lists, sorted sets',
  kafka: 'Topics, partitions, consumer groups',
  sqs: 'Queues and dead-letter queues',
  s3: 'Buckets and object prefixes',
};
const KIND_ACCENT: Record<ConnectionKind, string> = {
  postgres: 'cyan',
  mariadb: 'blue',
  mongodb: 'green',
  redis: 'red',
  kafka: 'amber',
  sqs: 'magenta',
  s3: 'olive',
};
const SUPPORTED_KINDS: ReadonlySet<ConnectionKind> = new Set([
  'postgres',
  'mariadb',
  'mongodb',
  'redis',
  'kafka',
  'sqs',
]);
const kinds = connectionKindSchema.options;

const draft = computed(() => connectionsState.dialog.draft);
const isEdit = computed(() => connectionsState.dialog.mode === 'edit');

// P16 design system: NewConnection.html (step 1, pick the engine) and ConnectionDialog.html
// (step 2, only that engine's fields) are two mockups for this one dialog — both steps live
// here. The fields step stays the default entry (unchanged from before the redesign) and the
// engine grid is reached through "Change engine"; the kind is settled there, not by a dropdown
// on step 2.
const step = ref<'engine' | 'details'>('details');
const engineSearch = ref('');

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

// Engine tiles pick and, since the engine is all step 1 exists for, immediately advance —
// the same radio-button "click selects" interaction this picker already had, just now
// followed by a step change instead of nothing.
function pickKind(kind: ConnectionKind): void {
  if (!SUPPORTED_KINDS.has(kind)) return;
  onKindChange(kind);
  step.value = 'details';
}

function continueToDetails(): void {
  const d = draft.value;
  if (!d || !SUPPORTED_KINDS.has(d.kind)) return;
  step.value = 'details';
}

function pasteUri(): void {
  setMode('uri');
  step.value = 'details';
}

const filteredKinds = computed(() => {
  const q = engineSearch.value.trim().toLowerCase();
  if (!q) return kinds;
  return kinds.filter((kind) => KIND_LABEL[kind].toLowerCase().includes(q));
});

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

// SQS has no host/port at all (D — connection.ts's superRefine exception); fields mode instead
// repurposes `database` for the AWS region and `username` for a named profile (S10's client.ts).
const isSqs = computed(() => draft.value?.kind === 'sqs');

// P11: '' <-> null bridging so an emptied field is "no script" rather than a schema violation
// the user cannot see (min(1) on the underlying schema rejects '').
const preconnectText = computed({
  get: () => draft.value?.preconnect ?? '',
  set: (value: string) => {
    if (draft.value) draft.value.preconnect = value.trim() === '' ? null : value;
  },
});
</script>

<template>
  <div v-if="draft" class="scrim" data-testid="connection-dialog" @click.self="closeDialog">
    <div
      ref="dialogRef"
      class="dialog"
      :class="{ 'is-engine-step': step === 'engine' }"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
    >
      <!-- Step 1: NewConnection.html — a grid of engine tiles, each with its own mark. -->
      <template v-if="step === 'engine'">
        <div class="dialog-title">
          <span class="icon-box muted"><Codicon name="database" :size="14" /></span>
          <span>{{ isEdit ? 'Change engine' : 'New connection' }}</span>
          <span class="title-mid p-push">
            <span v-if="!isEdit" class="steps">
              <span class="step on"><span class="n">1</span>Engine</span>
              <span class="dim">›</span>
              <span class="step"><span class="n">2</span>Details</span>
            </span>
          </span>
          <button
            v-if="isEdit"
            type="button"
            class="p-btn"
            @click="step = 'details'"
          >
            <span class="icon-box"><Codicon name="chevron-left" :size="14" /></span>
            Back
          </button>
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

        <div class="dialog-body engine-body">
          <div class="p-input ui md">
            <span class="icon-box"><Codicon name="search" :size="14" /></span>
            <input v-model="engineSearch" type="text" placeholder="Search engines" data-testid="connection-engine-search" />
          </div>

          <div class="kind-grid" role="radiogroup" aria-label="Connection kind" data-testid="connection-kind">
            <button
              v-for="kind in filteredKinds"
              :key="kind"
              type="button"
              class="kind"
              :class="{ 'is-off': !SUPPORTED_KINDS.has(kind), 'is-selected': draft.kind === kind }"
              :disabled="!SUPPORTED_KINDS.has(kind)"
              role="radio"
              :aria-checked="draft.kind === kind"
              :title="KIND_LABEL[kind] + (SUPPORTED_KINDS.has(kind) ? '' : ' — not yet supported')"
              :data-testid="`connection-kind-${kind}`"
              @click="pickKind(kind)"
            >
              <span
                class="kind-ic"
                :style="{ color: SUPPORTED_KINDS.has(kind) ? `var(--kira-conn-${KIND_ACCENT[kind]})` : undefined }"
              >
                <EngineIcon :kind="kind" :size="22" />
              </span>
              <span class="kind-name">{{ KIND_LABEL[kind] }}</span>
              <span class="kind-sub">{{ SUPPORTED_KINDS.has(kind) ? KIND_SUB[kind] : 'Not supported yet' }}</span>
            </button>
          </div>
        </div>

        <div class="dialog-footer">
          <button type="button" class="p-dlgbtn" @click="pasteUri">
            <span class="icon-box"><Codicon name="code" :size="14" /></span>
            Paste a URI
          </button>
          <span class="footer-actions p-push">
            <button type="button" class="p-dlgbtn" data-testid="connection-cancel" @click="closeDialog">
              Cancel
            </button>
            <button type="button" class="p-dlgbtn primary" @click="continueToDetails">
              Continue
              <span class="icon-box"><Codicon name="chevron-right" :size="14" /></span>
            </button>
          </span>
        </div>
      </template>

      <!-- Step 2: ConnectionDialog.html — only the chosen engine's fields; the engine itself
           is identity here, not a control (changed via "Change engine" back to step 1). -->
      <template v-else>
        <div class="dialog-title">
          <span class="engine-mark" :style="{ color: `var(--kira-conn-${KIND_ACCENT[draft.kind]})` }">
            <EngineIcon :kind="draft.kind" :size="16" />
          </span>
          <span>{{ isEdit ? 'Edit' : 'New' }} {{ KIND_LABEL[draft.kind] }} connection</span>
          <button type="button" class="p-btn p-push" title="Pick a different engine" @click="step = 'engine'">
            <span class="icon-box"><Codicon name="chevron-left" :size="14" /></span>
            Change engine
          </button>
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
            <div class="field name-field">
              <label>Name</label>
              <div class="p-input md ui">
                <input v-model="draft.name" type="text" data-testid="connection-name" />
              </div>
            </div>
            <div class="field color-field">
              <label>Color</label>
              <ColorPicker v-model="draft.color" />
            </div>
          </div>
          <span v-if="fieldErrors.name" class="field-error">{{ fieldErrors.name }}</span>

          <div class="field">
            <label>Mode</label>
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
                Connection URI
              </button>
            </div>
          </div>

          <template v-if="draft.mode === 'fields'">
            <div v-if="!isSqs" class="field-row">
              <div class="field">
                <label>Host</label>
                <div class="p-input md"><input v-model="draft.host" type="text" data-testid="connection-host" /></div>
              </div>
              <div class="field port-field">
                <label>Port</label>
                <div class="p-input md"><input v-model.number="draft.port" type="number" data-testid="connection-port" /></div>
              </div>
            </div>
            <span v-if="fieldErrors.host" class="field-error">{{ fieldErrors.host }}</span>
            <div class="field-row">
              <div class="field">
                <label>{{ isSqs ? 'Region' : 'Database' }}</label>
                <div class="p-input md"><input v-model="draft.database" type="text" data-testid="connection-database" /></div>
              </div>
              <div class="field">
                <label>{{ isSqs ? 'AWS profile (optional)' : 'User' }}</label>
                <div class="p-input md"><input v-model="draft.username" type="text" data-testid="connection-username" /></div>
              </div>
            </div>
            <div v-if="!isSqs" class="field">
              <label>Password</label>
              <div class="p-input md password-row">
                <input
                  v-model="draft.password"
                  :type="showPassword ? 'text' : 'password'"
                  data-testid="connection-password"
                />
                <button
                  type="button"
                  class="p-iconbtn"
                  :aria-label="showPassword ? 'Hide password' : 'Show password'"
                  @click="showPassword = !showPassword"
                >
                  <Codicon :name="showPassword ? 'eye-closed' : 'eye'" :size="14" />
                </button>
              </div>
            </div>
          </template>
          <template v-else>
            <div class="field">
              <label>Connection URI</label>
              <div class="p-input md">
                <input
                  v-model="draft.uri"
                  type="text"
                  class="mono"
                  data-testid="connection-uri"
                  @input="refreshUriNote"
                  @blur="refreshUriNote"
                />
              </div>
            </div>
            <p class="mono uri-note">{{ uriNote }}</p>
          </template>

          <label class="field checkbox">
            <input v-model="draft.readOnly" type="checkbox" data-testid="connection-readonly" />
            <span>Read-only</span>
            <span class="helper-text">Blocks every mutation path for this connection — grid edits, DDL, and console writes.</span>
          </label>

          <div class="field">
            <label>Pre-connect command <span class="dim">— optional</span></label>
            <div class="p-input md">
              <input v-model="preconnectText" type="text" class="mono" data-testid="connection-preconnect" />
            </div>
            <span class="helper-text">
              Runs in your shell before connecting — e.g. a port-forward or an SSO session-keeper.
            </span>
            <span v-if="preconnectText" class="preconnect-warning" data-testid="connection-preconnect-warning">
              This command runs on your machine with your permissions every time this connection
              connects.
            </span>
          </div>
          <span v-if="fieldErrors.preconnect" class="field-error">{{ fieldErrors.preconnect }}</span>

          <label v-if="preconnectText" class="field checkbox">
            <input
              v-model="draft.preconnectSidecar"
              type="checkbox"
              data-testid="connection-preconnect-sidecar"
            />
            <span>Keep it running, disconnect if it dies</span>
            <span class="helper-text">
              On: the command stays alive for the whole session — e.g. a port-forward — and this
              connection drops the moment it exits. Off (default): a fresh instance runs each time
              you connect, and its exit is never monitored — the right choice for a one-off prep
              script.
            </span>
          </label>

          <p class="credential-warning">
            Credentials are stored unencrypted in ~/.kira-studio/kira.sqlite.
          </p>
        </div>

        <div class="dialog-footer">
          <div class="test-area">
            <button type="button" class="p-dlgbtn" data-testid="connection-test" @click="onTest">
              <span class="icon-box"><Codicon name="plug" :size="14" /></span>
              Test connection
            </button>
            <span
              v-if="testState.status !== 'idle'"
              class="test-chip p-chip"
              :class="testState.status === 'ok' ? 'ok' : testState.status === 'error' ? 'err' : 'info'"
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
            <button type="button" class="p-dlgbtn" data-testid="connection-cancel" @click="closeDialog">Cancel</button>
            <button
              type="button"
              class="p-dlgbtn primary"
              data-testid="connection-save"
              :disabled="!isValid"
              @click="onSave"
            >
              Save
            </button>
          </div>
        </div>
      </template>
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
  width: 560px;
  max-height: 80vh;
  background: var(--kira-bg-elevated);
  border: var(--kira-border-width) solid var(--kira-border-strong);
  border-radius: var(--kira-radius-lg);
  box-shadow: var(--kira-shadow-dialog);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.dialog.is-engine-step {
  width: 620px;
}

.dialog-title {
  height: var(--kira-h-lg);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--kira-s-3);
  padding: 0 var(--kira-s-4) 0 var(--kira-s-5);
  border-bottom: var(--kira-border-width) solid var(--kira-border);
  font-size: var(--kira-t-lg);
  color: var(--kira-fg);
}

.title-mid {
  display: flex;
  min-width: 0;
}

.engine-mark {
  display: flex;
  flex-shrink: 0;
}

.title-close {
  width: var(--kira-h-sm);
  height: var(--kira-h-sm);
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
  padding: var(--kira-s-5);
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-4);
}

.engine-body {
  gap: var(--kira-s-5);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-2);
  flex: 1;
}

.field > label {
  font-size: var(--kira-t-sm);
  color: var(--kira-fg-muted);
}

.field-row {
  display: flex;
  gap: var(--kira-s-4);
  align-items: flex-start;
}

.name-field {
  flex: 2;
}

.port-field {
  flex: 0 0 96px;
}

.color-field {
  flex: 0 0 auto;
}

.field.checkbox {
  flex-direction: row;
  align-items: center;
  gap: var(--kira-s-3);
  flex-wrap: wrap;
  cursor: pointer;
}

.field.checkbox input[type='checkbox'] {
  width: 14px;
  height: 14px;
  accent-color: var(--kira-accent);
  cursor: pointer;
}

.mono {
  font-family: var(--kira-font-family);
}

.password-row {
  gap: var(--kira-s-2);
}

.segmented {
  display: inline-flex;
  height: var(--kira-h-md);
  border: var(--kira-border-width) solid var(--kira-border-strong);
  border-radius: var(--kira-radius-sm);
  overflow: hidden;
  align-self: flex-start;
}

.segmented button {
  padding: 0 var(--kira-s-3);
  color: var(--kira-fg-muted);
  font-size: var(--kira-t-sm);
  cursor: pointer;
  border: none;
  background: none;
}

.segmented button + button {
  border-left: var(--kira-border-width) solid var(--kira-border-strong);
}

.segmented button.active {
  background: var(--kira-bg-input);
  color: var(--kira-fg);
}

.uri-note {
  color: var(--kira-fg-muted);
  font-size: var(--kira-t-xs);
}

.helper-text {
  color: var(--kira-fg-disabled);
  font-size: var(--kira-t-xs);
  line-height: 1.5;
  width: 100%;
}

.field-error {
  color: var(--kira-error);
  font-size: var(--kira-t-xs);
}

.credential-warning {
  color: var(--kira-warn);
  font-size: var(--kira-t-xs);
}

.preconnect-warning {
  color: var(--kira-warn);
  font-size: var(--kira-t-xs);
}

.dialog-footer {
  border-top: var(--kira-border-width) solid var(--kira-border);
  height: 46px;
  flex-shrink: 0;
  padding: 0 var(--kira-s-5);
  display: flex;
  align-items: center;
  gap: var(--kira-s-3);
}

.test-area {
  display: flex;
  align-items: center;
  gap: var(--kira-s-3);
  min-width: 0;
}

.test-chip {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.footer-actions {
  display: flex;
  gap: var(--kira-s-3);
  flex-shrink: 0;
}

/* ---------- engine picker (parts/_kindcss.html) ---------- */
.kind-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--kira-s-3);
}

.kind {
  padding: var(--kira-s-5) var(--kira-s-4);
  border: var(--kira-border-width) solid var(--kira-border);
  border-radius: var(--kira-radius);
  background: var(--kira-bg);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--kira-s-2);
  cursor: pointer;
  font: inherit;
  text-align: left;
  color: inherit;
}

.kind:hover:not(.is-off) {
  background: var(--kira-hover);
  border-color: var(--kira-border-strong);
}

.kind.is-selected {
  border-color: var(--kira-focus);
}

.kind.is-off {
  opacity: 0.4;
  cursor: default;
}

.kind-ic {
  display: flex;
  margin-bottom: var(--kira-s-2);
  color: var(--kira-fg-muted);
}

.kind-name {
  font-size: var(--kira-t-lg);
  color: var(--kira-fg);
}

.kind-sub {
  font-size: var(--kira-t-sm);
  color: var(--kira-fg-disabled);
  line-height: 1.4;
}
</style>
