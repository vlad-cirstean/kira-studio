<script setup lang="ts">
import type { ConnectionKind } from '@shared/domain/connection';
import {
  AWS_STYLE_KINDS,
  connectionInputSchema,
  connectionKindSchema,
  DEFAULT_PORT,
} from '@shared/domain/connection';
import { canRoundTripToFields, formatConnectionUri, parseConnectionUri } from '@shared/domain/uri';
import { computed, onMounted, ref } from 'vue';
import { control } from '../bridge/control';
import { closeDialog, connectionsState, saveDialog } from '../state/connections';
import Codicon from '../theme/Codicon.vue';
import EngineIcon from '../theme/EngineIcon.vue';
import Button from '../theme/primitives/Button.vue';
import DialogFrame from '../theme/primitives/DialogFrame.vue';
import IconButton from '../theme/primitives/IconButton.vue';
import TextField from '../theme/primitives/TextField.vue';
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
  's3',
]);
const kinds = connectionKindSchema.options;

const draft = computed(() => connectionsState.dialog.draft);
const isEdit = computed(() => connectionsState.dialog.mode === 'edit');

// P16 design system: NewConnection.html (step 1, pick the engine) and ConnectionDialog.html
// (step 2, only that engine's fields) are two mockups for this one dialog — both steps live
// here. A brand-new connection starts at the engine picker (FirstRun.html's "one door, no
// vestibule" — nothing is assumed until an engine is chosen); editing an existing one starts
// on its fields directly, reaching the picker only through "Change engine".
const step = ref<'engine' | 'details'>(isEdit.value ? 'details' : 'engine');
const engineSearch = ref('');

const showPassword = ref(false);
const uriNote = ref('');
const testState = ref<{ status: 'idle' | 'testing' | 'ok' | 'error'; message?: string }>({
  status: 'idle',
});
const fieldErrors = ref<Record<string, string>>({});

function refreshUriNote(): void {
  const d = draft.value;
  if (!d) return;
  const parsed = d.uri ? parseConnectionUri(d.uri) : null;
  uriNote.value = parsed
    ? `${parsed.host ?? '?'}:${parsed.port ?? '?'} / ${parsed.database ?? '(default)'}`
    : 'Cannot be parsed into fields — will be used as-is.';
}

onMounted(() => {
  if (draft.value?.mode === 'uri') refreshUriNote();
});

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

// TextField's modelValue is always a string; the port field's own type is number|null (D27's
// per-kind default), so this mirrors what v-model.number did on the raw <input type="number">
// (parse on the way in, fall back rather than write a non-numeric value into a numeric field).
function setPort(value: string): void {
  const d = draft.value;
  if (!d) return;
  const n = Number.parseFloat(value);
  d.port = Number.isNaN(n) ? null : n;
}

function setUri(value: string): void {
  const d = draft.value;
  if (!d) return;
  d.uri = value;
  // options only used to sync from a parsed URI on the fields<->URI mode switch (see toggleMode
  // above) — which never runs for a connection created directly in URI mode (SQS's only mode).
  // Without this, an endpoint override in the URI's query string (e.g. SQS's LocalStack
  // `?endpoint=...`) never reaches `draft.options`, so the resolved config falls through to
  // real AWS instead. A URI that doesn't parse leaves `d.options` alone rather than clearing it.
  const parsed = parseConnectionUri(value);
  if (parsed) d.options = parsed.params;
  refreshUriNote();
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

// SQS/S3 have no host/port at all (connection.ts's AWS_STYLE_KINDS/superRefine exception); fields
// mode instead repurposes `database` for the AWS region and `username` for a named profile
// (sqs/client.ts's, s3/client.ts's own D8/D9).
const isAwsStyle = computed(() => !!draft.value && AWS_STYLE_KINDS.has(draft.value.kind));

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
  <DialogFrame
    v-if="draft"
    :title="
      step === 'engine'
        ? isEdit
          ? 'Change engine'
          : 'New connection'
        : `${isEdit ? 'Edit' : 'New'} ${KIND_LABEL[draft.kind]} connection`
    "
    :width="step === 'engine' ? 620 : 560"
    max-height="80vh"
    test-id="connection-dialog"
    close-test-id="connection-dialog-close"
    @close="closeDialog"
  >
    <!-- Step 1: NewConnection.html — a grid of engine tiles, each with its own mark. -->
    <template v-if="step === 'engine'" #header>
      <span class="icon-box muted"><Codicon name="database" :size="14" /></span>
      <span>{{ isEdit ? 'Change engine' : 'New connection' }}</span>
      <span class="title-mid p-push">
        <span v-if="!isEdit" class="steps">
          <span class="step on"><span class="n">1</span>Engine</span>
          <span class="dim">›</span>
          <span class="step"><span class="n">2</span>Details</span>
        </span>
      </span>
      <Button v-if="isEdit" icon="chevron-left" @click="step = 'details'">Back</Button>
    </template>
    <!-- Step 2: ConnectionDialog.html — only the chosen engine's fields; the engine itself
         is identity here, not a control (changed via "Change engine" back to step 1). -->
    <template v-else #header>
      <span class="engine-mark" :style="{ color: `var(--kira-conn-${KIND_ACCENT[draft.kind]})` }">
        <EngineIcon :kind="draft.kind" :size="16" />
      </span>
      <span>{{ isEdit ? 'Edit' : 'New' }} {{ KIND_LABEL[draft.kind] }} connection</span>
      <Button
        icon="chevron-left"
        class="p-push"
        title="Pick a different engine"
        @click="step = 'engine'"
      >
        Change engine
      </Button>
    </template>

    <template v-if="step === 'engine'">
      <div class="dialog-body-inner engine-body">
        <TextField
          v-model="engineSearch"
          icon="search"
          ui
          size="md"
          placeholder="Search engines"
          data-testid="connection-engine-search"
        />

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
          </button>
        </div>
      </div>
    </template>
    <template v-else>
      <div class="dialog-body-inner">
          <div class="field-row">
            <div class="field name-field">
              <label>Name</label>
              <TextField v-model="draft.name" ui size="md" data-testid="connection-name" />
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
            <div v-if="!isAwsStyle" class="field-row">
              <div class="field">
                <label>Host</label>
                <TextField
                  :model-value="draft.host ?? ''"
                  size="md"
                  data-testid="connection-host"
                  @update:model-value="draft.host = $event"
                />
              </div>
              <div class="field port-field">
                <label>Port</label>
                <TextField
                  :model-value="draft.port != null ? String(draft.port) : ''"
                  type="number"
                  size="md"
                  data-testid="connection-port"
                  @update:model-value="setPort"
                />
              </div>
            </div>
            <span v-if="fieldErrors.host" class="field-error">{{ fieldErrors.host }}</span>
            <div class="field-row">
              <div class="field">
                <label>{{ isAwsStyle ? 'Region' : 'Database' }}</label>
                <TextField
                  :model-value="draft.database ?? ''"
                  size="md"
                  data-testid="connection-database"
                  @update:model-value="draft.database = $event"
                />
              </div>
              <div class="field">
                <label>{{ isAwsStyle ? 'AWS profile (optional)' : 'User' }}</label>
                <TextField
                  :model-value="draft.username ?? ''"
                  size="md"
                  data-testid="connection-username"
                  @update:model-value="draft.username = $event"
                />
              </div>
            </div>
            <div v-if="!isAwsStyle" class="field">
              <label>Password</label>
              <div class="password-row">
                <div class="password-input">
                  <TextField
                    :model-value="draft.password ?? ''"
                    :type="showPassword ? 'text' : 'password'"
                    size="md"
                    data-testid="connection-password"
                    @update:model-value="draft.password = $event"
                  />
                </div>
                <IconButton
                  :icon="showPassword ? 'eye-closed' : 'eye'"
                  :title="showPassword ? 'Hide password' : 'Show password'"
                  :aria-label="showPassword ? 'Hide password' : 'Show password'"
                  @click="showPassword = !showPassword"
                />
              </div>
            </div>
          </template>
          <template v-else>
            <div class="field">
              <label>Connection URI</label>
              <TextField
                :model-value="draft.uri ?? ''"
                size="md"
                class="mono"
                data-testid="connection-uri"
                @update:model-value="setUri"
                @blur="refreshUriNote"
              />
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
            <TextField v-model="preconnectText" size="md" class="mono" data-testid="connection-preconnect" />
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
    </template>

    <template v-if="step === 'engine'" #footer>
      <span class="footer-actions p-push">
        <Button kind="dialog" data-testid="connection-cancel" @click="closeDialog">Cancel</Button>
        <Button kind="dialog" variant="primary" @click="continueToDetails">
          Continue
          <span class="icon-box"><Codicon name="chevron-right" :size="14" /></span>
        </Button>
      </span>
    </template>
    <template v-else #footer>
      <div class="test-area">
        <Button kind="dialog" icon="plug" data-testid="connection-test" @click="onTest">
          Test connection
        </Button>
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
        <Button kind="dialog" data-testid="connection-cancel" @click="closeDialog">Cancel</Button>
        <Button
          kind="dialog"
          variant="primary"
          data-testid="connection-save"
          :disabled="!isValid"
          @click="onSave"
        >
          Save
        </Button>
      </div>
    </template>
  </DialogFrame>
</template>

<style scoped>
.title-mid {
  display: flex;
  min-width: 0;
}

.engine-mark {
  display: flex;
  flex-shrink: 0;
}

.dialog-body-inner {
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
  display: flex;
  align-items: center;
  gap: var(--kira-s-2);
}

/* TextField's root <span class="p-input"> only receives fallthrough attrs on its inner <input>
   (see TextField.vue's inheritAttrs:false), so growing it to fill the row next to the show/hide
   IconButton moves onto this wrapper instead of a style attribute on the component tag itself. */
.password-input {
  flex: 1;
  min-width: 0;
}

.password-input :deep(.p-input) {
  width: 100%;
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
</style>
