<script setup lang="ts">
import { PALETTE_COLOR_CHOICES } from '@shared/domain/color';
import type { ConnectionKind, McpPermissionMode } from '@shared/domain/connection';
import {
  AWS_STYLE_KINDS,
  CONNECTION_THROTTLE_RANGE,
  connectionInputSchema,
  connectionKindSchema,
  DEFAULT_PORT,
  EXPLAIN_SUPPORTED_KINDS,
  FILE_KINDS,
  MIN_SERVER_VERSION,
} from '@shared/domain/connection';
import type { MaskKind, MaskRuleFields } from '@shared/domain/mask';
import { canRoundTripToFields, formatConnectionUri, parseConnectionUri } from '@shared/domain/uri';
import { useQuery } from '@tanstack/vue-query';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Checkbox } from '@theme/components/ui/checkbox';
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@theme/components/ui/dialog';
import { Input } from '@theme/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@theme/components/ui/input-group';
import { Label } from '@theme/components/ui/label';
import { Textarea } from '@theme/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@theme/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { useNumberStepper } from '@theme/composables/useNumberStepper';
import { wrapSelectionOnType } from '@theme/wrapSelection';
import { useConfirmDialogStore } from '@workbench/state/confirmDialog';
import { computed, onMounted, ref, watch } from 'vue';
import { control } from '../bridge/control';
import { useConnectionDialogStore, useConnectionsStore } from '../state/connections';
import {
  loadMaskRules,
  maskRulesQueryKey,
  regenerateMaskKey,
  removeMaskRule,
  upsertMaskRule,
} from '../state/maskRules';
import { schemaDialectFor } from '../state/schemas';
import EngineIcon from '../theme/EngineIcon.vue';

const confirmDialogStore = useConfirmDialogStore();
const connectionsStore = useConnectionsStore();
const connectionDialogStore = useConnectionDialogStore();

const KIND_LABEL: Record<ConnectionKind, string> = {
  postgres: 'PostgreSQL',
  mariadb: 'MariaDB',
  mysql: 'MySQL',
  sqlite: 'SQLite',
  clickhouse: 'ClickHouse',
  mongodb: 'MongoDB',
  redis: 'Redis',
  kafka: 'Kafka',
  sqs: 'SQS',
  s3: 'S3',
};
// P34 D19: 'teal' is unused elsewhere in the rail and is the furthest free hue from MariaDB's
// own 'blue' — the two engines a MySQL connection most often sits beside. P35 D29: 'violet' is
// free too, and sits furthest from the three other SQL engines' blue/cyan/teal hues. P36 D32:
// 'orange' is ClickHouse's own identity colour and sits apart from every other SQL engine's
// blue/cyan/teal/violet hues (Kafka's amber is the nearest neighbour, and belongs to a stream
// engine that never sits beside a SQL connection in the same list).
const KIND_ACCENT: Record<ConnectionKind, string> = {
  postgres: 'cyan',
  mariadb: 'blue',
  mysql: 'teal',
  sqlite: 'violet',
  clickhouse: 'orange',
  mongodb: 'green',
  redis: 'red',
  kafka: 'amber',
  sqs: 'magenta',
  s3: 'olive',
};
const SUPPORTED_KINDS: ReadonlySet<ConnectionKind> = new Set([
  'postgres',
  'mariadb',
  'mysql',
  'sqlite',
  'clickhouse',
  'mongodb',
  'redis',
  'kafka',
  'sqs',
  's3',
]);
const kinds = connectionKindSchema.options;
// P104 §3: ColorPicker inlined -- the offered subset (not the full storable enum), same as its
// own `colors` constant.
const connectionColors = PALETTE_COLOR_CHOICES;

// M2 §7.2: the MCP tab's three permission rows, one SegmentedControl per class — mcpModeOptions(x)
// builds each row's own per-button testids (connection-mcp-<class>-<mode>) under the row's own
// data-testid (connection-mcp-<class>) prefix.
function mcpModeOptions(
  cls: 'read' | 'write' | 'ddl',
): readonly { value: McpPermissionMode; label: string; testid: string }[] {
  return [
    { value: 'deny', label: 'Deny', testid: `connection-mcp-${cls}-deny` },
    { value: 'allow', label: 'Allow', testid: `connection-mcp-${cls}-allow` },
    { value: 'prompt', label: 'Ask me', testid: `connection-mcp-${cls}-prompt` },
  ];
}

const draft = computed(() => connectionDialogStore.draft);
const isEdit = computed(() => connectionDialogStore.mode === 'edit');
// M5 §7: the Privacy tab operates against the real, saved connection — a brand-new (unsaved)
// connection has no id yet, so its own pane shows a "save first" message instead (below).
const editingConnectionId = computed(() => connectionDialogStore.editingId);
// M3 §9.1: whether this kind has an EXPLAIN this app can parse at all — the auto-explain checkbox
// is disabled (never hidden) for the rest, since the setting is visible where it's set rather than
// discovered missing.
const mcpExplainSupported = computed(
  () => !!draft.value && EXPLAIN_SUPPORTED_KINDS.has(draft.value.kind),
);
// P25 D8: reported once at startup (state/connections.ts's hydrateConnections()), never changes
// for the life of the process.
const secretStatus = computed(() => connectionsStore.secretStorage);

// P16 design system: NewConnection.html (step 1, pick the engine) and ConnectionDialog.html
// (step 2, only that engine's fields) are two mockups for this one dialog — both steps live
// here. A brand-new connection starts at the engine picker (FirstRun.html's "one door, no
// vestibule" — nothing is assumed until an engine is chosen); editing an existing one starts
// on its fields directly, reaching the picker only through "Change engine".
const step = ref<'engine' | 'details'>(isEdit.value ? 'details' : 'engine');
const engineSearch = ref('');

// P28 §4.2: step 2's own tab strip — General/Advanced/Pre-connect. Reset to 'General' whenever
// step 2 is (re-)entered so "Change engine → back" never lands on a stale tab.
type DetailTab = 'General' | 'Advanced' | 'Pre-connect' | 'MCP' | 'Privacy';
const activeTab = ref<DetailTab>('General');
watch(step, (s) => {
  if (s === 'details') activeTab.value = 'General';
});

const showPassword = ref(false);
// P14 D1: a brand-new connection has no stored secret to reveal at all — whatever's typed is
// already "revealed" in the only sense that applies, so the eye button is a free toggle from the
// start. Editing an existing connection starts un-revealed; pressing the eye is what fetches the
// real secret, gated behind local authentication (onReveal, below).
const revealed = ref(!isEdit.value);
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

// Input's own modelValue type is string|number; the port field's own type is number|null (D27's
// per-kind default), so this mirrors what v-model.number did on the raw <input type="number">
// (parse on the way in, fall back rather than write a non-numeric value into a numeric field).
function setPort(value: string): void {
  const d = draft.value;
  if (!d) return;
  const n = Number.parseFloat(value);
  d.port = Number.isNaN(n) ? null : n;
}

// P104 §2: TextField's number stepper -> ui/input-group recipe. Each InputGroup's own root is
// queried for its live <input> by useNumberStepper rather than threading a ref through
// InputGroupInput (which forwards none of its own).
const portGroupRef = ref<HTMLElement | null>(null);
const portStepper = useNumberStepper(portGroupRef);
const throttleGroupRef = ref<HTMLElement | null>(null);
const throttleStepper = useNumberStepper(throttleGroupRef);

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

// P16 D8/D9: a plain informational note, sourced from the shared kind-keyed map beside
// DEFAULT_PORT — absent for kinds with no server version to state (SQS, S3).
const minVersionNote = computed(() => {
  const d = draft.value;
  return d ? MIN_SERVER_VERSION[d.kind] : undefined;
});

const filteredKinds = computed(() => {
  const q = engineSearch.value.trim().toLowerCase();
  if (!q) return kinds;
  return kinds.filter((kind) => KIND_LABEL[kind].toLowerCase().includes(q));
});

async function onTest(): Promise<void> {
  const d = draft.value;
  if (!d) return;
  testState.value = { status: 'testing' };
  // P14 D3: editingId (empty for a brand-new connection) lets the backend fill in the stored
  // secret when the draft carries none, so testing an existing connection whose password was
  // never revealed still probes with the real credential rather than none at all.
  const result = await control.connectionsTest(d, connectionDialogStore.editingId ?? '');
  testState.value = result.ok
    ? { status: 'ok', message: result.serverVersion }
    : { status: 'error', message: result.error };
}

// P14 D6: the backend decides, this just renders what comes back. requestReveal recurses exactly
// once, for the confirmation-required -> user confirms -> re-ask-with-confirmed:true path; every
// other outcome is terminal.
async function requestReveal(id: string, confirmed: boolean): Promise<void> {
  const result = await control.connectionsReveal(id, confirmed);
  switch (result.outcome) {
    case 'revealed':
      if (draft.value) draft.value.password = result.password;
      revealed.value = true;
      showPassword.value = true;
      return;
    case 'cancelled':
      // D11: the user cancelled the OS prompt on purpose — nothing to show for it.
      return;
    case 'confirmation-required': {
      const name = draft.value?.name || 'this connection';
      const ok = await confirmDialogStore.confirmDialog(
        `Show the saved password for "${name}"? It will be displayed in plain text.`,
        { danger: false },
      );
      if (ok) await requestReveal(id, true);
      return;
    }
    default:
      connectionDialogStore.error = result.error ?? 'Could not reveal the saved password.';
  }
}

function onReveal(): void {
  const id = connectionDialogStore.editingId;
  if (!id) return;
  void requestReveal(id, false);
}

// Not yet revealed: the eye button is the reveal action itself (gated in Go). Once revealed (or
// for a brand-new connection, which was never gated to begin with), it's a free client-side mask
// toggle — no second round trip, no second prompt (F8/D5).
function onEyeClick(): void {
  if (revealed.value) {
    showPassword.value = !showPassword.value;
  } else {
    onReveal();
  }
}

// A password typed directly (without ever pressing the eye) must not later be clobbered by a
// deferred reveal fetch — once the user has edited the field themselves, `revealed` means "the
// eye is a plain toggle from here on", the same as if they had pressed it.
function onPasswordInput(value: string): void {
  if (draft.value) draft.value.password = value;
  revealed.value = true;
}

// P28 §4.2: with the fields split across tabs, a field error is no longer always on screen — a
// failed save must switch to the tab holding the first offending field, or the user never sees
// why Save did nothing.
const TAB_FOR_FIELD: Record<string, DetailTab> = {
  name: 'General',
  host: 'General',
  port: 'General',
  database: 'General',
  uri: 'General',
  preconnect: 'Pre-connect',
  throttlePerSec: 'Advanced',
  mcpDescription: 'MCP',
};

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
    const firstField = parsed.error.issues[0]?.path[0];
    if (typeof firstField === 'string' && firstField in TAB_FOR_FIELD) {
      activeTab.value = TAB_FOR_FIELD[firstField];
    }
    return;
  }
  fieldErrors.value = {};
  // P25 D7: cleared before every attempt so a retry doesn't show a stale failure from the last
  // one while the new one is in flight; saveDialog() throws rather than returning null on
  // failure (see its own comment), so catching here is the one place a failed save is handled.
  connectionDialogStore.error = null;
  try {
    await connectionDialogStore.saveDialog();
  } catch (err) {
    connectionDialogStore.error = err instanceof Error ? err.message : String(err);
  }
}

// P28 §5.6: mirrors setPort's own parse-on-input, same Input modelValue-type reason.
function setThrottlePerSec(value: string): void {
  const d = draft.value;
  if (!d) return;
  const n = Number.parseFloat(value);
  d.throttlePerSec = Number.isNaN(n) ? 0 : n;
}

// Same split SettingsDialog.vue's own numeric fields use (P17 D6): the draft accepts whatever is
// typed, validity is derived here and gates Save. 0 is always valid (unlimited); a non-zero value
// outside CONNECTION_THROTTLE_RANGE is not — mirrors connections/input.go's Validate().
const throttlePerSecError = computed<string | null>(() => {
  const v = draft.value?.throttlePerSec ?? 0;
  if (!Number.isFinite(v)) return 'Enter a number.';
  if (v !== 0 && (v < CONNECTION_THROTTLE_RANGE.min || v > CONNECTION_THROTTLE_RANGE.max)) {
    return `0 (unlimited), or ${CONNECTION_THROTTLE_RANGE.min}–${CONNECTION_THROTTLE_RANGE.max}`;
  }
  return null;
});

const isValid = computed(
  () =>
    !!draft.value &&
    connectionInputSchema.safeParse(draft.value).success &&
    !throttlePerSecError.value,
);

// SQS/S3 have no host/port at all (connection.ts's AWS_STYLE_KINDS/superRefine exception); fields
// mode instead repurposes `database` for the AWS region and `username` for a named profile
// (sqs/client.ts's, s3/client.ts's own D8/D9).
const isAwsStyle = computed(() => !!draft.value && AWS_STYLE_KINDS.has(draft.value.kind));

// P35 D10/D11/D14: a file kind (SQLite) has no host/port/username/password at all — `database`
// carries the absolute file path instead, edited through one full-width field with a Browse
// button rather than the network-shaped host/port/user/password block.
const isFileStyle = computed(() => !!draft.value && FILE_KINDS.has(draft.value.kind));

// P18 (v1.1) D18: the auto-explain checkbox is a SQL-only surface, same gate the console's own
// SQL behaviours use — through state/schemas.ts's schemaDialectFor wrapper, SPEC §11's own rule
// that project/ must not import views/ directly (menus.ts's "Schema (DDL)…" gate uses the same
// wrapper). Absent, not disabled, on the five non-SQL kinds, matching isFileStyle's own precedent
// immediately above.
const isSqlKind = computed(() => !!draft.value && schemaDialectFor(draft.value.kind) !== undefined);

// M5 §7: the Privacy tab's own state. A rule takes effect immediately (§7.2's own "not part of
// the connection's save/cancel draft") — no local draft copy, this reads state/maskRules.ts
// directly and every control here writes straight through it.
// P99 §5.5: a reactive useQuery, `enabled` only once the Privacy tab is actually open — replaces
// the old watch(activeTab)/ensureMaskRulesLoaded pair with TanStack Query's own lazy-fetch-on-
// enable, and Query's in-flight dedupe means a caller elsewhere already loading this connection's
// rules (SlickGridHost.vue's own mount-time load) is shared rather than re-fetched.
const maskRulesQuery = useQuery(() => ({
  queryKey: maskRulesQueryKey(editingConnectionId.value ?? ''),
  queryFn: () => loadMaskRules(editingConnectionId.value ?? ''),
  enabled: activeTab.value === 'Privacy' && !!editingConnectionId.value,
  staleTime: Number.POSITIVE_INFINITY,
}));
const maskRules = computed(() => maskRulesQuery.data.value ?? []);

// §7.4: table — placeholder `*`, column, kind. Reset after a successful Add.
const newMaskTable = ref('');
const newMaskColumn = ref('');
const newMaskKind = ref<MaskKind>('redact');
const maskRuleError = ref<string | null>(null);

// §2.3, verbatim: the per-kind one-line explanation shown under the kind select.
const MASK_KIND_EXPLANATION: Record<MaskKind, string> = {
  name: 'Keeps initials and word lengths — "Maria Gonzalez" becomes "M•••• G•••••••".',
  email: 'Keeps the domain and the local part’s first letter and length.',
  text: 'Keeps nothing but a bucketed length — no first character, no exact length.',
  number:
    'Shows an order of magnitude, never a joinable key — use a text/redact rule, or mark ' +
    'a numeric identifier column with a kind other than number, for a value that must join.',
  date: 'Keeps the year, destroys month/day/time.',
  redact:
    'Keeps nothing at all — the right default when unsure, or when the shape itself is sensitive.',
};

// keepHint's own label changes per kind (§7.4); hidden for the four kinds where it means nothing.
const KEEP_HINT_LABEL: Partial<Record<MaskKind, string>> = {
  name: 'Keep initials',
  email: 'Keep domain',
  date: 'Keep year',
};

async function onAddMaskRule(): Promise<void> {
  const connectionId = editingConnectionId.value;
  const columnName = newMaskColumn.value.trim();
  if (!connectionId || !columnName) return;
  maskRuleError.value = null;
  const fields: MaskRuleFields = {
    tableName: newMaskTable.value.trim() || '*',
    columnName,
    kind: newMaskKind.value,
    keepHint: true,
    correlate: newMaskKind.value !== 'number' && newMaskKind.value !== 'date',
  };
  try {
    await upsertMaskRule(connectionId, fields);
    newMaskTable.value = '';
    newMaskColumn.value = '';
    newMaskKind.value = 'redact';
  } catch (err) {
    maskRuleError.value = err instanceof Error ? err.message : String(err);
  }
}

async function onChangeMaskRuleKind(ruleId: string, kind: MaskKind): Promise<void> {
  const connectionId = editingConnectionId.value;
  const rule = maskRules.value.find((r) => r.id === ruleId);
  if (!connectionId || !rule) return;
  await upsertMaskRule(connectionId, {
    tableName: rule.tableName,
    columnName: rule.columnName,
    kind,
    keepHint: rule.keepHint,
    correlate: kind === 'number' ? false : rule.correlate,
  });
}

async function onToggleMaskRuleFlag(
  ruleId: string,
  field: 'keepHint' | 'correlate',
): Promise<void> {
  const connectionId = editingConnectionId.value;
  const rule = maskRules.value.find((r) => r.id === ruleId);
  if (!connectionId || !rule) return;
  await upsertMaskRule(connectionId, {
    tableName: rule.tableName,
    columnName: rule.columnName,
    kind: rule.kind,
    keepHint: field === 'keepHint' ? !rule.keepHint : rule.keepHint,
    correlate: field === 'correlate' ? !rule.correlate : rule.correlate,
  });
}

async function onRemoveMaskRule(ruleId: string): Promise<void> {
  const connectionId = editingConnectionId.value;
  if (!connectionId) return;
  await removeMaskRule(connectionId, ruleId);
}

async function onRegenerateMaskKey(): Promise<void> {
  const connectionId = editingConnectionId.value;
  if (!connectionId) return;
  const ok = await confirmDialogStore.confirmDialog(
    'Regenerating the correlation key changes every masked correlation tag for this connection. ' +
      'Masked results already given to an AI client, or saved anywhere outside this app, will no ' +
      'longer correlate with results produced after the change. The real values are not affected, ' +
      'and this cannot be undone.',
  );
  if (!ok) return;
  await regenerateMaskKey(connectionId);
}

// P35 D15: the SQLite-specific filter list — chooseOpen's own filters payload is generic, so a
// second file kind would pass a different list here rather than this being hardcoded lower down.
async function onBrowseDatabaseFile(): Promise<void> {
  const d = draft.value;
  if (!d) return;
  const res = await control.filesChooseOpen({
    filters: [
      { name: 'SQLite database', extensions: ['sqlite', 'sqlite3', 'db', 'db3'] },
      { name: 'All files', extensions: ['*'] },
    ],
    title: 'Choose a database file',
  });
  if (!res.canceled && res.file) d.database = res.file.path;
}

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
  <Dialog v-if="draft" :open="true" @update:open="(v) => !v && connectionDialogStore.closeDialog()">
    <DialogContent
      :show-close-button="false"
      data-testid="connection-dialog"
      class="flex flex-col p-0 gap-0"
      style="width: 620px; max-width: min(620px, calc(100% - 2rem)); height: 520px"
    >
      <!-- Step 1: NewConnection.html — a grid of engine tiles, each with its own mark. -->
      <DialogHeader v-if="step === 'engine'" class="flex-row items-center gap-1.5 border-b border-border px-3 py-2">
        <span class="icon-box muted"><CodiconIcon name="database" :size="13" /></span>
        <DialogTitle class="text-kira-lg font-normal">{{ isEdit ? 'Change engine' : 'New connection' }}</DialogTitle>
        <span class="title-mid p-push">
          <span v-if="!isEdit" class="steps">
            <span class="step on"><span class="n">1</span>Engine</span>
            <span class="dim">›</span>
            <span class="step"><span class="n">2</span>Details</span>
          </span>
        </span>
        <Button v-if="isEdit" variant="toolbar" size="kira" @click="step = 'details'">
          <CodiconIcon name="chevron-left" :size="13" />
          Back
        </Button>
        <DialogClose as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close"
            data-testid="connection-dialog-close"
            @click="connectionDialogStore.closeDialog"
          >
            <CodiconIcon name="close" :size="13" />
          </Button>
        </DialogClose>
      </DialogHeader>
      <!-- Step 2: ConnectionDialog.html — only the chosen engine's fields; the engine itself
           is identity here, not a control (changed via "Change engine" back to step 1). -->
      <DialogHeader v-else class="flex-row items-center gap-1.5 border-b border-border px-3 py-2">
        <span class="engine-mark" :style="{ color: `var(--kira-conn-${KIND_ACCENT[draft.kind]})` }">
          <EngineIcon :kind="draft.kind" :size="13" />
        </span>
        <DialogTitle class="text-kira-lg font-normal">{{ isEdit ? 'Edit' : 'New' }} {{ KIND_LABEL[draft.kind] }} connection</DialogTitle>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="toolbar" size="kira" class="p-push" @click="step = 'engine'">
              <CodiconIcon name="chevron-left" :size="13" />
              Change engine
            </Button>
          </TooltipTrigger>
          <TooltipContent>Pick a different engine</TooltipContent>
        </Tooltip>
        <DialogClose as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close"
            data-testid="connection-dialog-close"
            @click="connectionDialogStore.closeDialog"
          >
            <CodiconIcon name="close" :size="13" />
          </Button>
        </DialogClose>
      </DialogHeader>

      <div class="flex-1 min-h-0 overflow-auto" data-testid="connection-dialog-body">
    <template v-if="step === 'engine'">
      <div class="p-dialog-body engine-body">
        <div class="flex items-center gap-1 h-control-lg rounded-kira-sm border border-border-strong bg-input px-2">
          <CodiconIcon name="search" :size="13" class="shrink-0 text-fg-muted" />
          <Input
            v-model="engineSearch"
            placeholder="Search engines"
            class="h-full w-full border-0 bg-transparent p-0 font-ui focus-visible:ring-0"
            data-testid="connection-engine-search"
          />
        </div>

        <div class="kind-grid" role="radiogroup" aria-label="Connection kind" data-testid="connection-kind">
          <Tooltip v-for="kind in filteredKinds" :key="kind">
            <TooltipTrigger as-child>
              <button
                type="button"
                class="kind"
                :class="{ 'is-off': !SUPPORTED_KINDS.has(kind), 'is-selected': draft.kind === kind }"
                :disabled="!SUPPORTED_KINDS.has(kind)"
                role="radio"
                :aria-checked="draft.kind === kind"
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
            </TooltipTrigger>
            <TooltipContent>{{ KIND_LABEL[kind] + (SUPPORTED_KINDS.has(kind) ? '' : ' — not yet supported') }}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </template>
    <template v-else>
      <div class="p-dialog-body">
          <nav class="p-tab-strip" role="tablist" aria-label="Connection detail tabs">
            <button
              type="button"
              class="p-tab"
              role="tab"
              :class="{ 'is-active': activeTab === 'General' }"
              :aria-selected="activeTab === 'General'"
              data-testid="connection-tab-general"
              @click="activeTab = 'General'"
            >
              General
            </button>
            <button
              type="button"
              class="p-tab"
              role="tab"
              :class="{ 'is-active': activeTab === 'Advanced' }"
              :aria-selected="activeTab === 'Advanced'"
              data-testid="connection-tab-advanced"
              @click="activeTab = 'Advanced'"
            >
              Advanced
            </button>
            <button
              type="button"
              class="p-tab"
              role="tab"
              :class="{ 'is-active': activeTab === 'Pre-connect' }"
              :aria-selected="activeTab === 'Pre-connect'"
              data-testid="connection-tab-preconnect"
              @click="activeTab = 'Pre-connect'"
            >
              Pre-connect
            </button>
            <button
              type="button"
              class="p-tab"
              role="tab"
              :class="{ 'is-active': activeTab === 'MCP' }"
              :aria-selected="activeTab === 'MCP'"
              data-testid="connection-tab-mcp"
              @click="activeTab = 'MCP'"
            >
              MCP
            </button>
            <button
              type="button"
              class="p-tab"
              role="tab"
              :class="{ 'is-active': activeTab === 'Privacy' }"
              :aria-selected="activeTab === 'Privacy'"
              data-testid="connection-tab-privacy"
              @click="activeTab = 'Privacy'"
            >
              Privacy
            </button>
          </nav>

          <div v-if="activeTab === 'General'" class="tab-pane" role="tabpanel">
          <div class="field-row">
            <div class="field name-field">
              <Label>Name</Label>
              <Input v-model="draft.name" class="h-control-lg w-full rounded-kira-sm border-border-strong bg-input px-2 font-ui" data-testid="connection-name" />
            </div>
            <div class="field color-field">
              <Label>Color</Label>
              <div
                class="color-picker flex h-6.5 flex-wrap items-center gap-1"
                role="radiogroup"
                aria-label="Connection color"
              >
                <Tooltip v-for="color in connectionColors" :key="color">
                  <TooltipTrigger as-child>
                    <Button
                      variant="ghost"
                      class="swatch h-4 w-4 shrink-0 cursor-pointer rounded-full border-0 bg-transparent p-0 hover:bg-transparent"
                      :class="{ 'outline outline-2 outline-offset-2 outline-fg': draft.color === color, none: color === 'none' }"
                      :style="color === 'none' ? undefined : { background: `var(--kira-conn-${color})` }"
                      :aria-label="color === 'none' ? 'No colour' : color"
                      role="radio"
                      :aria-checked="draft.color === color"
                      :data-testid="`color-${color}`"
                      @click="draft.color = color"
                    />
                  </TooltipTrigger>
                  <TooltipContent>{{ color === 'none' ? 'No colour' : color }}</TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>
          <span v-if="fieldErrors.name" class="field-error">{{ fieldErrors.name }}</span>

          <p v-if="minVersionNote" class="min-version-note" data-testid="connection-min-version">
            {{ minVersionNote }}
          </p>

          <div class="field">
            <Label>Mode</Label>
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

          <template v-if="draft.mode === 'fields' && isFileStyle">
            <div class="field">
              <Label>Database file</Label>
              <div class="password-row">
                <div class="password-input">
                  <Input
                    :model-value="draft.database ?? ''"
                    class="h-control-lg w-full rounded-kira-sm border-border-strong bg-input px-2 font-data"
                    data-testid="connection-database"
                    @update:model-value="draft.database = String($event)"
                  />
                </div>
                <Button variant="dialog" size="kira-lg" data-testid="connection-browse" @click="onBrowseDatabaseFile">
                  Browse…
                </Button>
              </div>
            </div>
            <span v-if="fieldErrors.database" class="field-error">{{ fieldErrors.database }}</span>
          </template>
          <template v-else-if="draft.mode === 'fields'">
            <div v-if="!isAwsStyle" class="field-row">
              <div class="field">
                <Label>Host</Label>
                <Input
                  :model-value="draft.host ?? ''"
                  class="h-control-lg w-full rounded-kira-sm border-border-strong bg-input px-2 font-data"
                  data-testid="connection-host"
                  @update:model-value="draft.host = String($event)"
                />
              </div>
              <div class="field port-field" ref="portGroupRef">
                <Label>Port</Label>
                <InputGroup class="h-control-lg w-full rounded-kira-sm border-border-strong bg-input">
                  <InputGroupInput
                    :model-value="draft.port != null ? String(draft.port) : ''"
                    type="number"
                    class="h-full font-data"
                    data-testid="connection-port"
                    @update:model-value="(v: string | number) => setPort(String(v))"
                  />
                  <InputGroupAddon align="inline-end" class="self-stretch flex-col gap-0 p-0">
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <InputGroupButton
                          class="step-btn flex-1 h-auto min-h-0 w-5 rounded-none p-0"
                          tabindex="-1"
                          aria-hidden="true"
                          @mousedown.prevent="portStepper.stepBy(1)"
                        >
                          <CodiconIcon name="chevron-up" :size="9" />
                        </InputGroupButton>
                      </TooltipTrigger>
                      <TooltipContent>Increase</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <InputGroupButton
                          class="step-btn flex-1 h-auto min-h-0 w-5 rounded-none p-0"
                          tabindex="-1"
                          aria-hidden="true"
                          @mousedown.prevent="portStepper.stepBy(-1)"
                        >
                          <CodiconIcon name="chevron-down" :size="9" />
                        </InputGroupButton>
                      </TooltipTrigger>
                      <TooltipContent>Decrease</TooltipContent>
                    </Tooltip>
                  </InputGroupAddon>
                </InputGroup>
              </div>
            </div>
            <span v-if="fieldErrors.host" class="field-error">{{ fieldErrors.host }}</span>
            <div v-if="isAwsStyle" class="field-row">
              <div class="field">
                <Label>Region</Label>
                <Input
                  :model-value="draft.database ?? ''"
                  class="h-control-lg w-full rounded-kira-sm border-border-strong bg-input px-2 font-data"
                  data-testid="connection-database"
                  @update:model-value="draft.database = String($event)"
                />
              </div>
              <div class="field">
                <Label>AWS profile (optional)</Label>
                <Input
                  :model-value="draft.username ?? ''"
                  class="h-control-lg w-full rounded-kira-sm border-border-strong bg-input px-2 font-data"
                  data-testid="connection-username"
                  @update:model-value="draft.username = String($event)"
                />
              </div>
            </div>
            <template v-else>
              <div class="field">
                <Label>Database</Label>
                <Input
                  :model-value="draft.database ?? ''"
                  class="h-control-lg w-full rounded-kira-sm border-border-strong bg-input px-2 font-data"
                  data-testid="connection-database"
                  @update:model-value="draft.database = String($event)"
                />
              </div>
              <div class="field-row">
                <div class="field">
                  <Label>User</Label>
                  <Input
                    :model-value="draft.username ?? ''"
                    class="h-control-lg w-full rounded-kira-sm border-border-strong bg-input px-2 font-data"
                    data-testid="connection-username"
                    @update:model-value="draft.username = String($event)"
                  />
                </div>
                <div class="field">
                  <Label>Password</Label>
                  <div class="password-row">
                    <div class="password-input">
                      <Input
                        :model-value="draft.password ?? ''"
                        :type="showPassword ? 'text' : 'password'"
                        class="h-control-lg w-full rounded-kira-sm border-border-strong bg-input px-2 font-data"
                        :placeholder="revealed ? undefined : 'Unchanged — click the eye to reveal'"
                        data-testid="connection-password"
                        @update:model-value="(v) => onPasswordInput(String(v))"
                      />
                    </div>
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <Button
                          variant="toolbar"
                          size="kira-icon"
                          :aria-label="showPassword ? 'Hide password' : 'Show password'"
                          @click="onEyeClick"
                        >
                          <CodiconIcon :name="showPassword ? 'eye-closed' : 'eye'" :size="13" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{{ showPassword ? 'Hide password' : 'Show password' }}</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              </div>
            </template>
          </template>
          <template v-else>
            <div class="field">
              <Label>Connection URI</Label>
              <Input
                :model-value="draft.uri ?? ''"
                class="h-control-lg w-full rounded-kira-sm border-border-strong bg-input px-2 font-data"
                data-testid="connection-uri"
                @update:model-value="(v) => setUri(String(v))"
                @blur="refreshUriNote"
              />
            </div>
            <p class="mono uri-note">{{ uriNote }}</p>
          </template>
          </div>

          <div v-else-if="activeTab === 'Advanced'" class="tab-pane" role="tabpanel">
          <Label class="field checkbox">
            <Checkbox
              :model-value="draft.readOnly"
              class="size-3.5"
              data-testid="connection-readonly"
              @update:model-value="(v) => { if (draft) draft.readOnly = v === true; }"
            >
              <CodiconIcon name="check" :size="10" />
            </Checkbox>
            <span>Read-only</span>
            <span class="helper-text">Blocks every mutation path for this connection — grid edits, DDL, and console writes.</span>
          </Label>

          <Label v-if="isSqlKind" class="field checkbox">
            <Checkbox
              :model-value="draft.autoExplain"
              class="size-3.5"
              data-testid="connection-auto-explain"
              @update:model-value="(v) => { if (draft) draft.autoExplain = v === true; }"
            >
              <CodiconIcon name="check" :size="10" />
            </Checkbox>
            <span>Auto-explain SELECT queries</span>
            <span class="helper-text">
              Runs the database's own EXPLAIN before each SELECT this connection issues from a
              query console, and warns when a query is estimated to read more than the configured
              row threshold. EXPLAIN only plans the query — it never runs it — so this costs one
              extra planning round trip, not a second execution.
            </span>
          </Label>

          <div class="field">
            <Label>Throttle commands <span class="dim">— per second</span></Label>
            <div class="size-input" ref="throttleGroupRef">
              <InputGroup class="h-control-lg w-full rounded-kira-sm border-border-strong bg-input">
                <InputGroupInput
                  type="number"
                  :min="0"
                  :max="CONNECTION_THROTTLE_RANGE.max"
                  step="0.5"
                  class="h-full font-data"
                  :aria-invalid="!!throttlePerSecError"
                  data-testid="connection-throttle"
                  :model-value="String(draft.throttlePerSec)"
                  @update:model-value="(v: string | number) => setThrottlePerSec(String(v))"
                />
                <InputGroupAddon align="inline-end" class="self-stretch flex-col gap-0 p-0">
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <InputGroupButton
                        class="step-btn flex-1 h-auto min-h-0 w-5 rounded-none p-0"
                        tabindex="-1"
                        aria-hidden="true"
                        @mousedown.prevent="throttleStepper.stepBy(1)"
                      >
                        <CodiconIcon name="chevron-up" :size="9" />
                      </InputGroupButton>
                    </TooltipTrigger>
                    <TooltipContent>Increase</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <InputGroupButton
                        class="step-btn flex-1 h-auto min-h-0 w-5 rounded-none p-0"
                        tabindex="-1"
                        aria-hidden="true"
                        @mousedown.prevent="throttleStepper.stepBy(-1)"
                      >
                        <CodiconIcon name="chevron-down" :size="9" />
                      </InputGroupButton>
                    </TooltipTrigger>
                    <TooltipContent>Decrease</TooltipContent>
                  </Tooltip>
                </InputGroupAddon>
              </InputGroup>
            </div>
            <span v-if="throttlePerSecError" class="field-error" data-testid="connection-throttle-error">
              {{ throttlePerSecError }}
            </span>
            <span v-else class="helper-text">
              0 disables the limit. Reads served from cache are never throttled, and connecting is
              never throttled. Applies immediately to a connected connection.
            </span>
          </div>
          </div>

          <div v-else-if="activeTab === 'Pre-connect'" class="tab-pane" role="tabpanel">
          <div class="field">
            <Label>Pre-connect command <span class="dim">— optional</span></Label>
            <Textarea
              v-model="preconnectText"
              class="font-data"
              rows="4"
              maxlength="2000"
              data-testid="connection-preconnect"
              @keydown="wrapSelectionOnType"
            />
            <span class="helper-text">
              Runs in your shell before connecting — e.g. a port-forward or an SSO session-keeper.
            </span>
            <span v-if="preconnectText" class="preconnect-warning" data-testid="connection-preconnect-warning">
              This command runs on your machine with your permissions every time this connection
              connects.
            </span>
          </div>
          <span v-if="fieldErrors.preconnect" class="field-error">{{ fieldErrors.preconnect }}</span>

          <Label v-if="preconnectText" class="field checkbox">
            <Checkbox
              :model-value="draft.preconnectSidecar"
              class="size-3.5"
              data-testid="connection-preconnect-sidecar"
              @update:model-value="(v) => { if (draft) draft.preconnectSidecar = v === true; }"
            >
              <CodiconIcon name="check" :size="10" />
            </Checkbox>
            <span>Keep it running, disconnect if it dies</span>
            <span class="helper-text">
              On: the command stays alive for the whole session — e.g. a port-forward — and this
              connection drops the moment it exits. Off (default): a fresh instance runs each time
              you connect, and its exit is never monitored — the right choice for a one-off prep
              script.
            </span>
          </Label>
          </div>

          <div v-else-if="activeTab === 'MCP'" class="tab-pane" role="tabpanel">
          <Label class="field checkbox">
            <Checkbox
              :model-value="draft.mcpEnabled"
              class="size-3.5"
              data-testid="connection-mcp-enabled"
              @update:model-value="(v) => { if (draft) draft.mcpEnabled = v === true; }"
            >
              <CodiconIcon name="check" :size="10" />
            </Checkbox>
            <span>Expose to the database MCP server</span>
            <span class="helper-text">
              Nothing is exposed by default. The same switch lives in Settings' Database MCP
              section — either one toggles the other.
            </span>
          </Label>

          <div class="field">
            <Label
              >Description
              <span class="dim">— what this database is for, read verbatim by an AI client</span></Label
            >
            <Textarea
              v-model="draft.mcpDescription"
              class="font-data"
              rows="2"
              maxlength="1000"
              :disabled="!draft.mcpEnabled"
              data-testid="connection-mcp-description"
              @keydown="wrapSelectionOnType"
            />
            <span v-if="fieldErrors.mcpDescription" class="field-error">{{ fieldErrors.mcpDescription }}</span>
          </div>

          <Label class="field checkbox">
            <Checkbox
              :model-value="draft.mcpAutoExplain"
              :disabled="!draft.mcpEnabled || !mcpExplainSupported"
              class="size-3.5"
              data-testid="connection-mcp-auto-explain"
              @update:model-value="(v) => { if (draft) draft.mcpAutoExplain = v === true; }"
            >
              <CodiconIcon name="check" :size="10" />
            </Checkbox>
            <span>Plan queries before running them</span>
            <span v-if="!mcpExplainSupported" class="helper-text">
              This engine has no query plan this app can read.
            </span>
          </Label>

          <div class="field">
            <Label>Read <span class="dim">— SELECT and its engine equivalents</span></Label>
            <ToggleGroup
              type="single"
              :model-value="draft.mcpReadMode"
              :disabled="!draft.mcpEnabled"
              data-testid="connection-mcp-read"
              @update:model-value="(v) => v && draft && (draft.mcpReadMode = v as McpPermissionMode)"
            >
              <ToggleGroupItem
                v-for="opt in mcpModeOptions('read')"
                :key="opt.value"
                :value="opt.value"
                :data-testid="opt.testid"
              >
                {{ opt.label }}
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div class="field">
            <Label>Write <span class="dim">— INSERT/UPDATE/DELETE and equivalents</span></Label>
            <ToggleGroup
              type="single"
              :model-value="draft.mcpWriteMode"
              :disabled="!draft.mcpEnabled"
              data-testid="connection-mcp-write"
              @update:model-value="(v) => v && draft && (draft.mcpWriteMode = v as McpPermissionMode)"
            >
              <ToggleGroupItem
                v-for="opt in mcpModeOptions('write')"
                :key="opt.value"
                :value="opt.value"
                :data-testid="opt.testid"
              >
                {{ opt.label }}
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div class="field">
            <Label>DDL <span class="dim">— CREATE/ALTER/DROP/TRUNCATE and equivalents, SQL engines only</span></Label>
            <ToggleGroup
              type="single"
              :model-value="draft.mcpDdlMode"
              :disabled="!draft.mcpEnabled"
              data-testid="connection-mcp-ddl"
              @update:model-value="(v) => v && draft && (draft.mcpDdlMode = v as McpPermissionMode)"
            >
              <ToggleGroupItem
                v-for="opt in mcpModeOptions('ddl')"
                :key="opt.value"
                :value="opt.value"
                :data-testid="opt.testid"
              >
                {{ opt.label }}
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <p class="helper-text">
            A statement this app cannot classify is treated as whichever of the three is strictest.
            These govern the MCP server only — the Read-only flag on the Advanced tab is what
            governs this app's own console.
          </p>
          </div>

          <div v-else class="tab-pane" role="tabpanel">
          <p class="helper-text">
            Rules redact values for this connection's MCP clients and for the data viewer's
            masking preview. They never change stored data.
          </p>

          <template v-if="!editingConnectionId">
            <p class="helper-text">Save this connection first to manage masking rules.</p>
          </template>
          <template v-else>
            <div v-if="maskRules.length" class="mask-rule-list" data-testid="mask-rule-list">
              <div v-for="rule in maskRules" :key="rule.id" class="mask-rule-row" :data-testid="`mask-rule-${rule.id}`">
                <span class="mask-rule-target mono" :title="`${rule.tableName}.${rule.columnName}`"
                  >{{ rule.tableName }}.{{ rule.columnName }}</span
                >
                <select
                  class="p-select bordered"
                  :value="rule.kind"
                  data-testid="mask-rule-kind"
                  @change="onChangeMaskRuleKind(rule.id, ($event.target as HTMLSelectElement).value as MaskKind)"
                >
                  <option value="name">Name</option>
                  <option value="email">Email</option>
                  <option value="text">Text</option>
                  <option value="number">Number</option>
                  <option value="date">Date</option>
                  <option value="redact">Redact</option>
                </select>
                <Label v-if="KEEP_HINT_LABEL[rule.kind]" class="field checkbox mask-rule-flag">
                  <Checkbox
                    :model-value="rule.keepHint"
                    class="size-3.5"
                    data-testid="mask-rule-keep-hint"
                    @update:model-value="onToggleMaskRuleFlag(rule.id, 'keepHint')"
                  >
                    <CodiconIcon name="check" :size="10" />
                  </Checkbox>
                  <span>{{ KEEP_HINT_LABEL[rule.kind] }}</span>
                </Label>
                <Label class="field checkbox mask-rule-flag">
                  <Checkbox
                    :model-value="rule.correlate"
                    :disabled="rule.kind === 'number'"
                    class="size-3.5"
                    data-testid="mask-rule-correlate"
                    @update:model-value="onToggleMaskRuleFlag(rule.id, 'correlate')"
                  >
                    <CodiconIcon name="check" :size="10" />
                  </Checkbox>
                  <span>Correlate</span>
                </Label>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button
                      variant="danger"
                      size="kira-icon"
                      aria-label="Remove this rule"
                      data-testid="mask-rule-remove"
                      @click="onRemoveMaskRule(rule.id)"
                    >
                      <CodiconIcon name="trash" :size="13" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Not PII — remove this rule</TooltipContent>
                </Tooltip>
              </div>
            </div>
            <p v-else class="helper-text">No masking rules yet on this connection.</p>

            <div class="mask-rule-add field-row">
              <Input v-model="newMaskTable" placeholder="*" class="h-control-lg w-full rounded-kira-sm border-border-strong bg-input px-2 font-data" data-testid="mask-rule-add-table" />
              <Input v-model="newMaskColumn" placeholder="column" class="h-control-lg w-full rounded-kira-sm border-border-strong bg-input px-2 font-data" data-testid="mask-rule-add-column" />
              <select v-model="newMaskKind" class="p-select bordered" data-testid="mask-rule-add-kind">
                <option value="name">Name</option>
                <option value="email">Email</option>
                <option value="text">Text</option>
                <option value="number">Number</option>
                <option value="date">Date</option>
                <option value="redact">Redact</option>
              </select>
              <Button variant="dialog" size="kira-lg" data-testid="mask-rule-add" @click="onAddMaskRule">Add</Button>
            </div>
            <p class="helper-text">{{ MASK_KIND_EXPLANATION[newMaskKind] }}</p>
            <span v-if="maskRuleError" class="field-error" data-testid="mask-rule-error">{{ maskRuleError }}</span>

            <Button variant="dialog" size="kira-lg" class="self-start" data-testid="mask-regenerate-key" @click="onRegenerateMaskKey">
              Regenerate correlation key
            </Button>

            <template v-if="!isFileStyle">
              <Alert
                v-if="secretStatus?.insecureFallback"
                data-testid="mask-key-credential-note"
                class="strip-warn"
              >
                <AlertDescription class="strip-warn-text">
                  Development fallback: the correlation key is obfuscated with a built-in key, not a
                  real keychain, on this platform — an attacker with filesystem access could recover
                  it. The redaction itself is unaffected; it stays uninvertible regardless.
                </AlertDescription>
              </Alert>
            </template>
          </template>
          </div>

          <span
            v-if="connectionDialogStore.error"
            class="field-error"
            data-testid="connection-save-error"
            >{{ connectionDialogStore.error }}</span
          >

          <!-- P25 D8: three states driven by connectionsStore.secretStorage, replacing the old
               unconditional plaintext warning — a null secretStatus (not hydrated yet) renders
               none of them rather than guessing. P35 D14: a file kind has no credentials at all,
               so none of the three states apply — the note would be describing something that
               doesn't exist. Dialog-level, not tab-level: describes the connection as a whole and
               must stay visible no matter which tab is active. -->
          <template v-if="!isFileStyle">
            <p
              v-if="secretStatus?.available && !secretStatus.insecureFallback"
              class="credential-note"
              data-testid="connection-credential-note"
            >
              Credentials are encrypted with your macOS Keychain.
            </p>
            <Alert
              v-else-if="secretStatus?.insecureFallback"
              data-testid="connection-credential-note"
              class="strip-warn"
            >
              <AlertDescription class="strip-warn-text">
                Development fallback: credentials on this platform are obfuscated with a built-in
                key, not a real keychain.
              </AlertDescription>
            </Alert>
            <Alert
              v-else-if="secretStatus"
              variant="destructive"
              data-testid="connection-credential-note"
            >
              <AlertDescription>
                The macOS Keychain is unavailable, so passwords cannot be saved. Everything else
                about this connection can be.
              </AlertDescription>
            </Alert>
          </template>
      </div>
    </template>
      </div>

      <DialogFooter v-if="step === 'engine'" class="border-t border-border">
        <span class="flex items-center gap-1 ml-auto">
          <Button variant="dialog" size="kira-lg" data-testid="connection-cancel" @click="connectionDialogStore.closeDialog">Cancel</Button>
          <Button variant="dialog-primary" size="kira-lg" @click="continueToDetails">
            Continue
            <CodiconIcon name="chevron-right" :size="13" />
          </Button>
        </span>
      </DialogFooter>
      <DialogFooter v-else class="border-t border-border">
        <div class="test-area">
          <Button variant="dialog" size="kira-lg" data-testid="connection-test" @click="onTest">
            <CodiconIcon name="plug" :size="13" />
            Test connection
          </Button>
          <Tooltip v-if="testState.status !== 'idle'" :disabled="testState.status !== 'error'">
            <TooltipTrigger as-child>
              <span
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
            </TooltipTrigger>
            <TooltipContent v-if="testState.status === 'error'">{{ testState.message ?? '' }}</TooltipContent>
          </Tooltip>
        </div>
        <div class="flex items-center gap-1 ml-auto">
          <Button variant="dialog" size="kira-lg" data-testid="connection-cancel" @click="connectionDialogStore.closeDialog">Cancel</Button>
          <Button
            variant="dialog-primary"
            size="kira-lg"
            data-testid="connection-save"
            :disabled="!isValid"
            @click="onSave"
          >
            Save
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<style scoped>
@reference "@theme/base.css";

.title-mid {
  display: flex;
  min-width: 0;
}

.engine-mark {
  display: flex;
  flex-shrink: 0;
}

.engine-body {
  gap: var(--kira-s-5);
  /* D3: with the dialog's own height fixed (D1), the grid must collapse upward from a stable
     top edge as filteredKinds shrinks, rather than the body re-centring the remaining rows. */
  flex: 1;
  min-height: 0;
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

.size-input {
  width: 96px;
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

.mono {
  font-family: var(--kira-font-data);
}

.password-row {
  display: flex;
  align-items: center;
  gap: var(--kira-s-2);
}

.password-input {
  flex: 1;
  min-width: 0;
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

/* P28 §4.2: step 2's General/Advanced/Pre-connect tabs, using the app's existing .p-tab
   primitive rather than .segmented (already spent on the Fields/URI mode switch above). */
.p-tab-strip {
  display: flex;
  gap: var(--kira-s-2);
  border-bottom: var(--kira-border-width) solid var(--kira-border);
  padding-bottom: var(--kira-s-3);
}

.tab-pane {
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-4);
}

.uri-note {
  color: var(--kira-fg-muted);
  font-size: var(--kira-t-xs);
}

.min-version-note {
  margin: 0;
  color: var(--kira-fg-muted);
  font-size: var(--kira-t-xs);
}

.helper-text {
  color: var(--kira-fg-subtle);
  font-size: var(--kira-t-xs);
  line-height: 1.5;
  width: 100%;
}

.field-error {
  color: var(--kira-error);
  font-size: var(--kira-t-xs);
}

.credential-note {
  color: var(--kira-fg-muted);
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

/* p-dialog-actions supplies display/align-items/gap; this dialog's footer-actions can sit beside
   a variable-width .test-area sibling, so it still needs its own flex-shrink guard. */
.footer-actions {
  flex-shrink: 0;
}

/* ---------- engine picker (parts/_kindcss.html) ---------- */
.kind-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--kira-s-3);
  align-content: start;
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

/* M5 §7.4: the Privacy tab's rule list/add-row — a scrollable list of narrow rows, each one
   table.column + kind + flags + remove, mirroring .field-row's own row-of-controls shape. */
.mask-rule-list {
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-2);
  max-height: 220px;
  overflow-y: auto;
}

.mask-rule-row {
  display: flex;
  align-items: center;
  gap: var(--kira-s-3);
  padding: var(--kira-s-2) 0;
  border-bottom: var(--kira-border-width) solid var(--kira-border);
}

.mask-rule-target {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--kira-fg);
}

.mask-rule-flag {
  flex: 0 0 auto;
}

.mask-rule-add {
  align-items: center;
}

/* Alert tone classes replacing MessageStrip's own warn-tone colors (P104 §9 rule 5: literal hex,
   not a --kira-* token, so kept as-is rather than converted through §7.1's scale). */
.strip-warn {
  @apply bg-warn/10 border-warn/20;
}
.strip-warn-text {
  @apply text-[#d9c47a];
}

/* P104 §3: ColorPicker's own "none" swatch -- a diagonal slash, never a 13th hue standing in for
   "nothing chosen" (its own comment, ported verbatim). */
.swatch.none {
  border: 1.5px solid var(--kira-fg-muted);
  background: linear-gradient(
    to top right,
    transparent calc(50% - 0.75px),
    var(--kira-fg-muted) calc(50% - 0.75px),
    var(--kira-fg-muted) calc(50% + 0.75px),
    transparent calc(50% + 0.75px)
  );
}
</style>
