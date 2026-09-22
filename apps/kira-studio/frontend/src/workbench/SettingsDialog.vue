<script setup lang="ts">
import type { PaletteColor } from '@shared/domain/color';
import type { ConnectionSummary } from '@shared/domain/connection';
import type { CustomScript, CustomScriptFields } from '@shared/domain/scripts';
import {
  CACHE_L2_BUDGET_MB_RANGE,
  defaultSettings,
  EXPENSIVE_QUERY_ROWS_RANGE,
  FONT_SIZE_RANGE,
  HTTP_VERSIONS,
  MAX_REDIRECTS_RANGE,
  MAX_RESPONSE_MB_RANGE,
  OP_LOG_RETENTION_DAYS_RANGE,
  REQUEST_TIMEOUT_MS_RANGE,
  type RowDensity,
  type Settings,
  type SettingsPatch,
} from '@shared/domain/settings';
import { useQuery } from '@tanstack/vue-query';
import CodiconIcon from '@theme/CodiconIcon.vue';
import AppButton from '@theme/primitives/AppButton.vue';
import Checkbox from '@theme/primitives/Checkbox.vue';
import DialogFrame from '@theme/primitives/DialogFrame.vue';
import IconButton from '@theme/primitives/IconButton.vue';
import TextField from '@theme/primitives/TextField.vue';
import { useConfirmDialogStore } from '@workbench/state/confirmDialog';
import { formatBytes } from '@workbench/util/format';
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { data } from '../bridge/data';
import { FONT_CHOICES, fontStackAvailable, resolveFontFallback } from '../fonts';
import { useAgentHooksStore } from '../state/agentHooks';
import { useCacheStatsStore } from '../state/cacheStats';
import { useConnectionsStore } from '../state/connections';
import { useCustomScriptsStore } from '../state/customScripts';
import { useDbMcpStore } from '../state/dbmcp';
import { useKeepAwakeStore } from '../state/keepAwake';
import { loadMaskRuleCounts, maskRuleCountsQueryKey } from '../state/maskRules';
import { type Section, sections, useSettingsStore } from '../state/settings';
import ColorPicker from '../theme/primitives/ColorPicker.vue';

const PAGE_SIZES = [10, 100, 1000, 10000] as const;

const emit = defineEmits<{ close: [] }>();

const agentHooksStore = useAgentHooksStore();
const cacheStatsStore = useCacheStatsStore();
const confirmDialogStore = useConfirmDialogStore();
const customScriptsStore = useCustomScriptsStore();
const dbMcpStore = useDbMcpStore();
const keepAwakeStore = useKeepAwakeStore();
const connectionsStore = useConnectionsStore();
const settingsStore = useSettingsStore();
const maskRuleCountsQuery = useQuery({
  queryKey: maskRuleCountsQueryKey,
  queryFn: loadMaskRuleCounts,
  staleTime: Number.POSITIVE_INFINITY,
});

// P17 D1: everything the user touches lives in this draft until Save — settingsStore (and
// therefore every other window, the database, and the app's own rendering) sees nothing until
// then. The component is created on open and destroyed on close (StatusBar.vue's
// v-if="settingsStore.settingsOpen"), which is the draft's whole lifetime — no reset logic needed.
// JSON round-trip rather than structuredClone(): settingsStore's leaves are Vue reactive proxies,
// and structuredClone's algorithm throws on a Proxy rather than cloning the plain data underneath it.
const cloneSections = (s: Settings): Settings =>
  JSON.parse(
    JSON.stringify({
      appearance: s.appearance,
      data: s.data,
      cache: s.cache,
      advanced: s.advanced,
      git: s.git,
      api: s.api,
    }),
  );

// Frozen at runtime (mutation would be a bug); typed as plain Settings so diffSection below can
// compare it against the mutable draft without a readonly/mutable type mismatch.
const baseline: Settings = Object.freeze(cloneSections(settingsStore)) as Settings;
const draft = reactive<Settings>(cloneSections(settingsStore));

// G7 D16: git.protectedBranches is this dialog's first array-valued leaf — cloneSections gives
// draft/baseline each their own array object even when unedited, so a bare `!==`/`===` (every
// other leaf here is a primitive) would report it changed/non-default on every open. Compared by
// value instead; every other leaf still takes the cheap `===` path.
function valuesEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

// P17 D2: the generic per-leaf diff Save sends. Walking Object.keys(base) rather than a
// hand-maintained leaf list means a future leaf (P18's, or anything after it) is picked up with
// no edit here — see the plan doc's own reasoning for why that removes the need for a dedicated
// diff unit test.
function diffSection<T extends object>(base: T, current: T): Partial<T> | undefined {
  const changed: Partial<T> = {};
  let anyChanged = false;
  for (const key of Object.keys(base) as (keyof T)[]) {
    if (!valuesEqual(current[key], base[key])) {
      changed[key] = current[key];
      anyChanged = true;
    }
  }
  return anyChanged ? changed : undefined;
}

const pendingPatch = computed<SettingsPatch>(() => {
  const patch: SettingsPatch = {};
  const appearance = diffSection(baseline.appearance, draft.appearance);
  if (appearance) patch.appearance = appearance;
  const dataDiff = diffSection(baseline.data, draft.data);
  if (dataDiff) patch.data = dataDiff;
  const cache = diffSection(baseline.cache, draft.cache);
  if (cache) patch.cache = cache;
  const advanced = diffSection(baseline.advanced, draft.advanced);
  if (advanced) patch.advanced = advanced;
  const git = diffSection(baseline.git, draft.git);
  if (git) patch.git = git;
  const api = diffSection(baseline.api, draft.api);
  if (api) patch.api = api;
  return patch;
});

const isDirty = computed(() => Object.keys(pendingPatch.value).length > 0);

// P85 §10.1: activeSection seeds from settingsStore.settingsSection (state/settings.ts's own ref,
// set by openSettingsAt for a "Manage scripts…" deep link) — null (a plain open) falls back to
// 'Appearance', G12 D9's own default.
const activeSection = ref<Section>(settingsStore.settingsSection ?? 'Appearance');

// P100 Part 2: onRevokeGitClient/onInstallVsCodeIntegration/vsixOutcomeMessage (D16/G10 D12/D14 —
// the 'Connected editors' section's own instant-action, bypass-draft-entirely posture) used to
// live here. state/gitClients.ts and the whole 'Connected editors' UI section moved to
// apps/kira-space wholesale — removed along with them.

onBeforeUnmount(() => {
  // §10.1: a later plain open (TitleBar.vue's gear icon, the command palette) must not inherit a
  // deep link this instance was opened with.
  settingsStore.settingsSection = null;
});

// M1 §6.2: the DB MCP token's own expiry line — "expired, regenerate" rather than a stale-looking
// date once the instant has passed.
function tokenExpired(expiresAt: string): boolean {
  return !!expiresAt && new Date(expiresAt).getTime() <= Date.now();
}

// C3 §7.1/D7: same instant-action posture as onRevokeGitClient/onInstallVsCodeIntegration above —
// the toggle bypasses draft/Save entirely, since SetEnabled both persists the leaf and starts/stops
// the embedded DB MCP server in one call.
const dbMcpToggling = ref(false);
async function onToggleDbMcpEnabled(enabled: boolean): Promise<void> {
  dbMcpToggling.value = true;
  try {
    await dbMcpStore.setDbMcpEnabled(enabled);
  } finally {
    dbMcpToggling.value = false;
  }
}

const dbMcpRegenerating = ref(false);
async function onRegenerateDbMcpToken(): Promise<void> {
  dbMcpRegenerating.value = true;
  try {
    await dbMcpStore.regenerateDbMcpToken();
  } finally {
    dbMcpRegenerating.value = false;
  }
}

const dbMcpInstalling = ref(false);
async function onInstallDbMcpClaudeCode(): Promise<void> {
  dbMcpInstalling.value = true;
  try {
    await dbMcpStore.installDbMcpClaudeCode();
  } finally {
    dbMcpInstalling.value = false;
  }
}

// P86 §9.3: same instant-action posture as onToggleDbMcpEnabled — claudeCode.hooksEnabled both
// persists and starts/stops the embedded hook listener in one call.
const claudeCodeHooksToggling = ref(false);
async function onToggleAgentHooksEnabled(enabled: boolean): Promise<void> {
  claudeCodeHooksToggling.value = true;
  try {
    await agentHooksStore.setAgentHooksEnabled(enabled);
  } finally {
    claudeCodeHooksToggling.value = false;
  }
}

// P87 §9: same instant-action posture — claudeCode.keepAwakeWithAgents both persists and
// recomputes the live assertion in one call.
const keepAwakeAgentAwareToggling = ref(false);
async function onToggleKeepAwakeAgentAware(enabled: boolean): Promise<void> {
  keepAwakeAgentAwareToggling.value = true;
  try {
    await keepAwakeStore.setKeepAwakeAgentAware(enabled);
  } finally {
    keepAwakeAgentAwareToggling.value = false;
  }
}

const dbMcpInstallMessage = computed(() => {
  const result = dbMcpStore.installResult;
  if (!result) return null;
  switch (result.outcome) {
    case 'installed':
      return 'Registered with Claude Code.';
    case 'notFound':
      return "Claude Code's CLI isn't available. Copy the command above and run it yourself once it is installed.";
    case 'installFailed':
      return `Claude Code refused the registration: ${result.detail}. Copy the command above and run it yourself.`;
    default:
      return null;
  }
});

const dbMcpTokenExpired = computed(() => tokenExpired(dbMcpStore.status.expiresAt));

// M1 §6.1: exposure itself (deny by default) stays an instant toggle here. M2 §7.3: the three
// permission modes and the description are edited in the connection's own MCP tab, not here —
// this list stays a read-only glance plus the one control it already had.
async function onToggleConnectionMcpEnabled(id: string, enabled: boolean): Promise<void> {
  await connectionsStore.setConnectionMcpEnabled(id, enabled);
}

// M2 §7.3: the row's own description glance — first line only, "" when unset.
function mcpDescriptionFirstLine(conn: ConnectionSummary): string {
  return conn.mcpDescription.split('\n', 1)[0] ?? '';
}

const fontFamilyUnavailable = computed(() => !fontStackAvailable(draft.appearance.fontFamily));
const fontFamilyFallback = computed(() => resolveFontFallback(draft.appearance.fontFamily));

// P28 §1.2: computed once — fontStackAvailable's canvas probe is a per-call measurement, but the
// dialog is created on open and destroyed on close (P17 D1), so no invalidation is needed for
// the component's lifetime.
const availableStacks = computed(() => {
  const on = FONT_CHOICES.filter((f) => fontStackAvailable(f.stack));
  const off = FONT_CHOICES.filter((f) => !fontStackAvailable(f.stack));
  return { on, off };
});

// An already-stored value outside FONT_CHOICES must not be silently discarded by the dropdown —
// prepended as its own "Current" option so the select always has a matching value.
const currentFontIsListed = computed(() =>
  FONT_CHOICES.some((f) => f.stack === draft.appearance.fontFamily),
);

function onFontFamilyChange(e: Event): void {
  draft.appearance.fontFamily = (e.target as HTMLSelectElement).value;
}

function onFontSizeInput(e: Event): void {
  draft.appearance.fontSize = Number((e.target as HTMLInputElement).value);
}

function setRowDensity(density: RowDensity): void {
  draft.appearance.rowDensity = density;
}

function onWordWrapChange(checked: boolean): void {
  draft.appearance.wordWrap = checked;
}

function onRowColoringChange(checked: boolean): void {
  draft.appearance.rowColoring = checked;
}

function onInlineBlameChange(checked: boolean): void {
  draft.appearance.inlineBlame = checked;
}

// P72 §9.1: relative-vs-absolute commit timestamps in the git graph, moved here from the per-repo
// RepoSettingsDialog.vue — a reading preference about the person, not the repository.
function onDateFormatChange(e: Event): void {
  draft.appearance.dateFormat = (e.target as HTMLSelectElement)
    .value as Settings['appearance']['dateFormat'];
}

const rowPreviewHeight = computed(() => (draft.appearance.rowDensity === 'compact' ? 22 : 28));

function onDefaultPageSizeChange(e: Event): void {
  const value = Number((e.target as HTMLSelectElement).value);
  const pageSize = PAGE_SIZES.find((size) => size === value);
  if (!pageSize) return;
  draft.data.defaultPageSize = pageSize;
}

function onCacheBudgetInput(e: Event): void {
  draft.cache.l2BudgetMb = Number((e.target as HTMLInputElement).value);
}

function onOpLogRetentionInput(e: Event): void {
  draft.advanced.opLogRetentionDays = Number((e.target as HTMLInputElement).value);
}

function onExpensiveQueryRowsInput(e: Event): void {
  draft.advanced.expensiveQueryRows = Number((e.target as HTMLInputElement).value);
}

// P90 §2.7: the global Api section's own handlers — same shape as every other leaf above.
function onHttpVersionChange(e: Event): void {
  draft.api.httpVersion = (e.target as HTMLSelectElement).value as Settings['api']['httpVersion'];
}
function onRequestTimeoutMsInput(e: Event): void {
  draft.api.requestTimeoutMs = Number((e.target as HTMLInputElement).value);
}
function onMaxResponseMbInput(e: Event): void {
  draft.api.maxResponseMb = Number((e.target as HTMLInputElement).value);
}
function onSslVerifyChange(checked: boolean): void {
  draft.api.sslVerify = checked;
}
function onFollowRedirectsChange(checked: boolean): void {
  draft.api.followRedirects = checked;
}
function onMaxRedirectsInput(e: Event): void {
  draft.api.maxRedirects = Number((e.target as HTMLInputElement).value);
}
function onDisableCookieJarChange(checked: boolean): void {
  draft.api.disableCookieJar = checked;
}

// P72 §9.2: kira-space's own diagnostic log verbosity, moved here from the per-repo
// RepoSettingsDialog.vue's kiraVersion.log.level — genuinely installation-wide, not a per-repo
// fact, so this is now the one control that sets it.
function onGitLogLevelChange(e: Event): void {
  draft.advanced.gitLogLevel = (e.target as HTMLSelectElement)
    .value as Settings['advanced']['gitLogLevel'];
}

// P100 Part 2: protectedBranchesText (G7 D17 — the Git section's own protected-branch-pattern
// textarea, one-directionally parsed into draft.git.protectedBranches) and resetProtectedBranches
// used to live here. The whole 'Git' settings section moved to apps/kira-space along with the repo
// workspace it configured — removed along with it (draft.git/baseline.git themselves stay, below:
// Settings is still one shared cross-app type, kira-space's own git.* leaves included).

// P17 D6: the draft accepts whatever is typed (@input, so the field never fights the user
// mid-keystroke) — validity is derived here, not enforced at write time, and gates Save below.
const fontSizeError = computed<string | null>(() => {
  const v = draft.appearance.fontSize;
  if (!Number.isFinite(v)) return 'Enter a number.';
  if (v < FONT_SIZE_RANGE.min || v > FONT_SIZE_RANGE.max) {
    return `${FONT_SIZE_RANGE.min}–${FONT_SIZE_RANGE.max} px`;
  }
  return null;
});

const cacheBudgetError = computed<string | null>(() => {
  const v = draft.cache.l2BudgetMb;
  if (!Number.isFinite(v)) return 'Enter a number.';
  if (v < CACHE_L2_BUDGET_MB_RANGE.min || v > CACHE_L2_BUDGET_MB_RANGE.max) {
    return `${CACHE_L2_BUDGET_MB_RANGE.min}–${CACHE_L2_BUDGET_MB_RANGE.max} MB`;
  }
  return null;
});

const opLogRetentionError = computed<string | null>(() => {
  const v = draft.advanced.opLogRetentionDays;
  if (!Number.isFinite(v)) return 'Enter a number.';
  if (v < OP_LOG_RETENTION_DAYS_RANGE.min || v > OP_LOG_RETENTION_DAYS_RANGE.max) {
    return `${OP_LOG_RETENTION_DAYS_RANGE.min}–${OP_LOG_RETENTION_DAYS_RANGE.max} days`;
  }
  return null;
});

const expensiveQueryRowsError = computed<string | null>(() => {
  const v = draft.advanced.expensiveQueryRows;
  if (!Number.isFinite(v)) return 'Enter a number.';
  if (v < EXPENSIVE_QUERY_ROWS_RANGE.min || v > EXPENSIVE_QUERY_ROWS_RANGE.max) {
    return `${EXPENSIVE_QUERY_ROWS_RANGE.min.toLocaleString()}–${EXPENSIVE_QUERY_ROWS_RANGE.max.toLocaleString()}`;
  }
  return null;
});

// P100 Part 2: fetchAutoIntervalError and graphFontSizeError (draft.git.fetchAutoIntervalMinutes/
// graphFontSize validation, P92 item 9's own 0-sentinel rule) used to live here, guarding the
// 'Git' settings section removed alongside them.

const requestTimeoutMsError = computed<string | null>(() => {
  const v = draft.api.requestTimeoutMs;
  if (!Number.isFinite(v)) return 'Enter a number.';
  if (v < REQUEST_TIMEOUT_MS_RANGE.min || v > REQUEST_TIMEOUT_MS_RANGE.max) {
    return `${REQUEST_TIMEOUT_MS_RANGE.min}–${REQUEST_TIMEOUT_MS_RANGE.max.toLocaleString()} ms`;
  }
  return null;
});

const maxResponseMbError = computed<string | null>(() => {
  const v = draft.api.maxResponseMb;
  if (!Number.isFinite(v)) return 'Enter a number.';
  if (v < MAX_RESPONSE_MB_RANGE.min || v > MAX_RESPONSE_MB_RANGE.max) {
    return `${MAX_RESPONSE_MB_RANGE.min}–${MAX_RESPONSE_MB_RANGE.max} MB`;
  }
  return null;
});

const maxRedirectsError = computed<string | null>(() => {
  const v = draft.api.maxRedirects;
  if (!Number.isFinite(v)) return 'Enter a number.';
  if (v < MAX_REDIRECTS_RANGE.min || v > MAX_REDIRECTS_RANGE.max) {
    return `${MAX_REDIRECTS_RANGE.min}–${MAX_REDIRECTS_RANGE.max}`;
  }
  return null;
});

const isValid = computed(
  () =>
    !fontSizeError.value &&
    !cacheBudgetError.value &&
    !opLogRetentionError.value &&
    !expensiveQueryRowsError.value &&
    !requestTimeoutMsError.value &&
    !maxResponseMbError.value &&
    !maxRedirectsError.value,
);

const hitRateLabel = computed(() => {
  const stats = cacheStatsStore.stats;
  if (!stats) return '—';
  const total = stats.l2Hits + stats.l2Misses;
  if (total === 0) return '—';
  return `${Math.round((stats.l2Hits / total) * 100)}% (${stats.l2Hits}/${total})`;
});

const cacheSizeLabel = computed(() => {
  const stats = cacheStatsStore.stats;
  if (!stats) return '—';
  return `${formatBytes(stats.l2Bytes)} / ${formatBytes(stats.l2BudgetBytes)}`;
});

async function onClearCaches(): Promise<void> {
  await data.clearCaches();
}

// P28 §2.2: two generic helpers replace the single all-or-nothing Revert to Defaults — the same
// discipline P17 D2 applied to diffSection, so a future leaf needs no edit here either.
function isAtDefault<S extends keyof Settings, K extends keyof Settings[S]>(s: S, k: K): boolean {
  return valuesEqual(draft[s][k], defaultSettings[s][k]);
}
function resetLeaf<S extends keyof Settings, K extends keyof Settings[S]>(s: S, k: K): void {
  draft[s][k] = defaultSettings[s][k];
}

// P17 D5: Cancel, Escape, the ✕ and the backdrop all route here — the draft dies with the
// component, no IPC call, no confirmation (see the plan doc's D5 for why not).
function onDismiss(): void {
  emit('close');
}

const saveError = ref<string | null>(null);

// P17 D7: a failed Save keeps the dialog open and shows the error; only a successful Save closes
// it. Saving with nothing changed sends no patch at all (D2).
async function onSave(): Promise<void> {
  if (!isValid.value) return;
  saveError.value = null;
  const patch = pendingPatch.value;
  if (Object.keys(patch).length === 0) {
    emit('close');
    return;
  }
  try {
    await settingsStore.patchSettings(patch);
    emit('close');
  } catch (err) {
    saveError.value = err instanceof Error ? err.message : String(err);
  }
}

// P85 §10.2: the Scripts section — ConnectionDialog.vue's own Privacy-tab list-editing layout
// (mask rules), restated for scripts. This section bypasses draft/pendingPatch entirely, the same
// posture 'Connected editors'/'Database MCP' already take (§10.1) — the custom scripts store is a
// Pinia store, not a settings leaf, and a script edited here must apply immediately so the
// tab strip's own dropdown reflects it without a Save.
interface ScriptDraft {
  name: string;
  command: string;
  workingDir: string;
}
const scriptDrafts = reactive<Record<string, ScriptDraft>>({});
function syncScriptDrafts(): void {
  for (const key of Object.keys(scriptDrafts)) delete scriptDrafts[key];
  for (const script of customScriptsStore.records) {
    scriptDrafts[script.id] = {
      name: script.name,
      command: script.command,
      workingDir: script.workingDir,
    };
  }
}
watch(() => customScriptsStore.records, syncScriptDrafts, { immediate: true });

// name/command commit on blur, not per keystroke (§10.2); a cleared field reverts rather than
// saving an invalid row — VariableSetView.vue's own onEnvFieldBlur takes the same "empty reverts"
// posture for a name field, and model.CustomScriptFields.Validate would reject it anyway.
async function onScriptFieldBlur(script: CustomScript): Promise<void> {
  const draft = scriptDrafts[script.id];
  if (!draft) return;
  const name = draft.name.trim();
  const command = draft.command.trim();
  if (name === '' || command === '') {
    draft.name = script.name;
    draft.command = script.command;
    draft.workingDir = script.workingDir;
    return;
  }
  if (
    name === script.name &&
    command === script.command &&
    draft.workingDir === script.workingDir
  ) {
    return;
  }
  try {
    await customScriptsStore.updateCustomScript(script.id, {
      name,
      command,
      workingDir: draft.workingDir,
      color: script.color,
    });
  } catch {
    // A rejected edit (e.g. a non-absolute workingDir) never arrives via the broadcast to
    // overwrite this draft, so revert it here instead of leaving unsaved text on screen.
    draft.name = script.name;
    draft.command = script.command;
    draft.workingDir = script.workingDir;
  }
}

// §10.2/VariableSetView.vue's own D17/D19: a swatch click applies immediately, unlike
// name/command's blur-commit — a colour choice is a discrete action with its own visible
// feedback, not text a user is still composing.
async function onScriptColorChange(script: CustomScript, color: PaletteColor): Promise<void> {
  await customScriptsStore.updateCustomScript(script.id, {
    name: script.name,
    command: script.command,
    workingDir: script.workingDir,
    color,
  });
}

async function onRemoveScript(script: CustomScript): Promise<void> {
  const ok = await confirmDialogStore.confirmDialog(
    `Remove "${script.name}"? It will no longer launch from the tab strip or the Terminal panel.`,
    {
      danger: true,
    },
  );
  if (ok) await customScriptsStore.removeCustomScript(script.id);
}

const newScriptName = ref('');
const newScriptCommand = ref('');
const newScriptWorkingDir = ref('');
const newScriptColor = ref<PaletteColor>('none');
const scriptError = ref<string | null>(null);

// The dialog's own affordance (§10.3's "the Go check is the authority, the zod one is the
// affordance") — disables Add before a round trip rather than duplicating Validate's full rule.
const canAddScript = computed(
  () => newScriptName.value.trim() !== '' && newScriptCommand.value.trim() !== '',
);

async function onAddScript(): Promise<void> {
  if (!canAddScript.value) return;
  scriptError.value = null;
  const fields: CustomScriptFields = {
    name: newScriptName.value.trim(),
    command: newScriptCommand.value.trim(),
    workingDir: newScriptWorkingDir.value.trim(),
    color: newScriptColor.value,
  };
  try {
    await customScriptsStore.createCustomScript(fields);
    newScriptName.value = '';
    newScriptCommand.value = '';
    newScriptWorkingDir.value = '';
    newScriptColor.value = 'none';
  } catch (err) {
    scriptError.value = err instanceof Error ? err.message : String(err);
  }
}
</script>

<template>
  <DialogFrame
    title="Settings"
    :width="780"
    :height="560"
    test-id="settings-dialog"
    close-test-id="settings-dialog-close"
    @close="onDismiss"
  >
    <template #header>
      <span class="icon-box muted"><CodiconIcon name="gear" :size="13" /></span>
      <span>Settings</span>
    </template>

    <div class="dialog-body-inner">
      <nav class="section-list">
        <button
          v-for="section in sections"
          :key="section"
          type="button"
          class="section-item"
          :class="{ active: activeSection === section }"
          :data-testid="`settings-section-${section}`"
          @click="activeSection = section"
        >
          {{ section }}
        </button>
      </nav>

      <section class="section-pane">
          <template v-if="activeSection === 'Appearance'">
            <div class="sec-label first">Typography</div>
            <label class="field">
              <div class="field-head">
                <span>Data font</span>
                <IconButton
                  icon="discard"
                  data-testid="settings-reset-appearance-fontFamily"
                  :disabled="isAtDefault('appearance', 'fontFamily')"
                  v-tooltip="'Reset to default'"
                  @click="resetLeaf('appearance', 'fontFamily')"
                />
              </div>
              <select
                class="p-select bordered md"
                data-testid="settings-font-family"
                :value="draft.appearance.fontFamily"
                @change="onFontFamilyChange"
              >
                <optgroup v-if="!currentFontIsListed" label="Current">
                  <option :value="draft.appearance.fontFamily">{{ draft.appearance.fontFamily }}</option>
                </optgroup>
                <optgroup label="On this Mac">
                  <option
                    v-for="f in availableStacks.on"
                    :key="f.stack"
                    :value="f.stack"
                    :style="{ fontFamily: f.stack }"
                  >
                    {{ f.label }}
                  </option>
                </optgroup>
                <optgroup label="Not installed">
                  <option
                    v-for="f in availableStacks.off"
                    :key="f.stack"
                    :value="f.stack"
                    :style="{ fontFamily: f.stack }"
                  >
                    {{ f.label }}
                  </option>
                </optgroup>
              </select>
              <span
                class="font-preview"
                data-testid="font-preview"
                :style="{ fontFamily: draft.appearance.fontFamily }"
                >The quick brown fox jumps over the lazy dog — 0123456789</span
              >
              <span v-if="fontFamilyUnavailable" class="field-error" data-testid="font-unavailable">
                Not installed<template v-if="fontFamilyFallback">
                  — text falls back to the browser's {{ fontFamilyFallback }} default.</template
                ><template v-else> — text falls back to the browser's default.</template>
              </span>
              <span v-else class="helper-text">Grid cells, editors, anything that came out of a database.</span>
            </label>

            <label class="field">
              <div class="field-head">
                <span>Data font size</span>
                <IconButton
                  icon="discard"
                  data-testid="settings-reset-appearance-fontSize"
                  :disabled="isAtDefault('appearance', 'fontSize')"
                  v-tooltip="'Reset to default'"
                  @click="resetLeaf('appearance', 'fontSize')"
                />
              </div>
              <div class="size-input">
                <TextField
                  type="number"
                  :min="FONT_SIZE_RANGE.min"
                  :max="FONT_SIZE_RANGE.max"
                  size="md"
                  :invalid="!!fontSizeError"
                  data-testid="settings-font-size"
                  :model-value="String(draft.appearance.fontSize)"
                  @input="onFontSizeInput"
                />
              </div>
              <span v-if="fontSizeError" class="field-error" data-testid="settings-font-size-error">
                {{ fontSizeError }}
              </span>
              <span v-else class="helper-text">{{ FONT_SIZE_RANGE.min }}–{{ FONT_SIZE_RANGE.max }} px</span>
            </label>

            <div class="field">
              <div class="field-head">
                <span>Row height</span>
                <IconButton
                  icon="discard"
                  data-testid="settings-reset-appearance-rowDensity"
                  :disabled="isAtDefault('appearance', 'rowDensity')"
                  v-tooltip="'Reset to default'"
                  @click="resetLeaf('appearance', 'rowDensity')"
                />
              </div>
              <div class="segmented">
                <button
                  type="button"
                  :class="{ active: draft.appearance.rowDensity === 'compact' }"
                  @click="setRowDensity('compact')"
                >
                  Compact · 22 px
                </button>
                <button
                  type="button"
                  :class="{ active: draft.appearance.rowDensity === 'comfortable' }"
                  @click="setRowDensity('comfortable')"
                >
                  Comfortable · 28 px
                </button>
              </div>
              <span class="helper-text">Applies to the tree, the grid and every list.</span>
              <div class="row-preview">
                <div class="row-preview-row row-preview-head">
                  <span class="row-preview-cell row-preview-gutter" :style="{ height: `${rowPreviewHeight}px` }" />
                  <span class="row-preview-cell" :style="{ height: `${rowPreviewHeight}px` }">id</span>
                  <span class="row-preview-cell row-preview-grow" :style="{ height: `${rowPreviewHeight}px` }">email</span>
                </div>
                <div class="row-preview-row" :style="{ height: `${rowPreviewHeight}px` }">
                  <span class="row-preview-cell row-preview-gutter">1</span>
                  <span class="row-preview-cell">c1d0-88ae</span>
                  <span class="row-preview-cell row-preview-grow">rowan.brooks@example.com</span>
                </div>
                <div class="row-preview-row" :style="{ height: `${rowPreviewHeight}px` }">
                  <span class="row-preview-cell row-preview-gutter">2</span>
                  <span class="row-preview-cell">7f2b-19cd</span>
                  <span class="row-preview-cell row-preview-grow">amari.osei@example.com</span>
                </div>
              </div>
            </div>

            <div class="field checkbox-row">
              <label class="field checkbox">
                <Checkbox
                  :model-value="draft.appearance.wordWrap"
                  data-testid="settings-word-wrap"
                  @update:model-value="onWordWrapChange"
                />
                <span>Word wrap</span>
                <span class="helper-text"
                  >Long lines wrap instead of scrolling — the query console, the Mongo console and
                  the cell editor.</span
                >
              </label>
              <IconButton
                icon="discard"
                class="p-push"
                data-testid="settings-reset-appearance-wordWrap"
                :disabled="isAtDefault('appearance', 'wordWrap')"
                v-tooltip="'Reset to default'"
                @click="resetLeaf('appearance', 'wordWrap')"
              />
            </div>

            <div class="field checkbox-row">
              <label class="field checkbox">
                <Checkbox
                  :model-value="draft.appearance.rowColoring"
                  data-testid="settings-row-coloring"
                  @update:model-value="onRowColoringChange"
                />
                <span>Row colouring</span>
                <span class="helper-text"
                  >Colour grid values by their column's data type. Off renders every row in the
                  plain text colour.</span
                >
              </label>
              <IconButton
                icon="discard"
                class="p-push"
                data-testid="settings-reset-appearance-rowColoring"
                :disabled="isAtDefault('appearance', 'rowColoring')"
                v-tooltip="'Reset to default'"
                @click="resetLeaf('appearance', 'rowColoring')"
              />
            </div>

            <div class="field checkbox-row">
              <label class="field checkbox">
                <Checkbox
                  :model-value="draft.appearance.inlineBlame"
                  data-testid="settings-inline-blame"
                  @update:model-value="onInlineBlameChange"
                />
                <span>Inline blame</span>
                <span class="helper-text"
                  >Show who last changed the current line, at the end of that line, in the
                  repository file viewer.</span
                >
              </label>
              <IconButton
                icon="discard"
                class="p-push"
                data-testid="settings-reset-appearance-inlineBlame"
                :disabled="isAtDefault('appearance', 'inlineBlame')"
                v-tooltip="'Reset to default'"
                @click="resetLeaf('appearance', 'inlineBlame')"
              />
            </div>

            <label class="field">
              <div class="field-head">
                <span>Commit date</span>
                <IconButton
                  icon="discard"
                  data-testid="settings-reset-appearance-dateFormat"
                  :disabled="isAtDefault('appearance', 'dateFormat')"
                  v-tooltip="'Reset to default'"
                  @click="resetLeaf('appearance', 'dateFormat')"
                />
              </div>
              <select
                class="p-select bordered md"
                data-testid="settings-date-format"
                :value="draft.appearance.dateFormat"
                @change="onDateFormatChange"
              >
                <option value="relative">Relative (3 days ago)</option>
                <option value="absolute">Absolute (2024-12-30 22:48)</option>
              </select>
              <span class="helper-text">The git graph's own commit timestamps.</span>
            </label>
          </template>

          <template v-else-if="activeSection === 'Data'">
            <label class="field">
              <div class="field-head">
                <span>Default page size</span>
                <IconButton
                  icon="discard"
                  data-testid="settings-reset-data-defaultPageSize"
                  :disabled="isAtDefault('data', 'defaultPageSize')"
                  v-tooltip="'Reset to default'"
                  @click="resetLeaf('data', 'defaultPageSize')"
                />
              </div>
              <select
                class="p-select bordered md"
                data-testid="settings-default-page-size"
                :value="draft.data.defaultPageSize"
                @change="onDefaultPageSizeChange"
              >
                <option v-for="size in PAGE_SIZES" :key="size" :value="size">{{ size }}</option>
              </select>
            </label>
          </template>

          <template v-else-if="activeSection === 'Cache'">
            <label class="field">
              <div class="field-head">
                <span>Result page cache budget (MB)</span>
                <IconButton
                  icon="discard"
                  data-testid="settings-reset-cache-l2BudgetMb"
                  :disabled="isAtDefault('cache', 'l2BudgetMb')"
                  v-tooltip="'Reset to default'"
                  @click="resetLeaf('cache', 'l2BudgetMb')"
                />
              </div>
              <TextField
                type="number"
                :min="CACHE_L2_BUDGET_MB_RANGE.min"
                :max="CACHE_L2_BUDGET_MB_RANGE.max"
                size="md"
                :invalid="!!cacheBudgetError"
                data-testid="settings-cache-budget"
                :model-value="String(draft.cache.l2BudgetMb)"
                @input="onCacheBudgetInput"
              />
              <span v-if="cacheBudgetError" class="field-error" data-testid="settings-cache-budget-error">
                {{ cacheBudgetError }}
              </span>
            </label>
            <label class="field">
              <span>Current usage</span>
              <TextField type="text" size="md" :model-value="cacheSizeLabel" disabled />
            </label>
            <label class="field">
              <span>Hit rate</span>
              <TextField type="text" size="md" :model-value="hitRateLabel" disabled />
            </label>
            <AppButton
              kind="dialog"
              class="action-button"
              data-testid="settings-clear-caches"
              @click="onClearCaches"
            >
              Clear caches
            </AppButton>
          </template>

          <template v-else-if="activeSection === 'Api'">
            <label class="field">
              <div class="field-head">
                <span>HTTP version</span>
                <IconButton
                  icon="discard"
                  data-testid="settings-reset-api-httpVersion"
                  :disabled="isAtDefault('api', 'httpVersion')"
                  v-tooltip="'Reset to default'"
                  @click="resetLeaf('api', 'httpVersion')"
                />
              </div>
              <select
                class="p-select bordered md"
                data-testid="settings-api-httpVersion"
                :value="draft.api.httpVersion"
                @change="onHttpVersionChange"
              >
                <option v-for="v in HTTP_VERSIONS" :key="v" :value="v">HTTP/{{ v }}</option>
              </select>
            </label>

            <label class="field">
              <div class="field-head">
                <span>Request timeout (ms)</span>
                <IconButton
                  icon="discard"
                  data-testid="settings-reset-api-requestTimeoutMs"
                  :disabled="isAtDefault('api', 'requestTimeoutMs')"
                  v-tooltip="'Reset to default'"
                  @click="resetLeaf('api', 'requestTimeoutMs')"
                />
              </div>
              <TextField
                type="number"
                :min="REQUEST_TIMEOUT_MS_RANGE.min"
                :max="REQUEST_TIMEOUT_MS_RANGE.max"
                size="md"
                :invalid="!!requestTimeoutMsError"
                data-testid="settings-api-requestTimeoutMs"
                :model-value="String(draft.api.requestTimeoutMs)"
                @input="onRequestTimeoutMsInput"
              />
              <span
                v-if="requestTimeoutMsError"
                class="field-error"
                data-testid="settings-api-requestTimeoutMs-error"
              >
                {{ requestTimeoutMsError }}
              </span>
              <span v-else class="helper-text">0 = no timeout.</span>
            </label>

            <label class="field">
              <div class="field-head">
                <span>Max response size (MB)</span>
                <IconButton
                  icon="discard"
                  data-testid="settings-reset-api-maxResponseMb"
                  :disabled="isAtDefault('api', 'maxResponseMb')"
                  v-tooltip="'Reset to default'"
                  @click="resetLeaf('api', 'maxResponseMb')"
                />
              </div>
              <TextField
                type="number"
                :min="MAX_RESPONSE_MB_RANGE.min"
                :max="MAX_RESPONSE_MB_RANGE.max"
                size="md"
                :invalid="!!maxResponseMbError"
                data-testid="settings-api-maxResponseMb"
                :model-value="String(draft.api.maxResponseMb)"
                @input="onMaxResponseMbInput"
              />
              <span
                v-if="maxResponseMbError"
                class="field-error"
                data-testid="settings-api-maxResponseMb-error"
              >
                {{ maxResponseMbError }}
              </span>
              <span v-else class="helper-text">0 = unlimited. A larger body is truncated, not refused.</span>
            </label>

            <div class="field checkbox-row">
              <label class="field checkbox">
                <Checkbox
                  :model-value="draft.api.sslVerify"
                  data-testid="settings-api-sslVerify"
                  @update:model-value="onSslVerifyChange"
                />
                <span>Verify SSL certificates</span>
              </label>
              <IconButton
                icon="discard"
                class="p-push"
                data-testid="settings-reset-api-sslVerify"
                :disabled="isAtDefault('api', 'sslVerify')"
                v-tooltip="'Reset to default'"
                @click="resetLeaf('api', 'sslVerify')"
              />
            </div>
            <p v-if="!draft.api.sslVerify" class="field-error" data-testid="settings-api-sslVerify-warning">
              Turning certificate verification off lets any server present any certificate.
              Anything on the network between you and the server can then read and modify every
              request and response, including credentials. Leave this on unless you are testing
              against a server with a self-signed certificate you control.
            </p>

            <div class="field checkbox-row">
              <label class="field checkbox">
                <Checkbox
                  :model-value="draft.api.followRedirects"
                  data-testid="settings-api-followRedirects"
                  @update:model-value="onFollowRedirectsChange"
                />
                <span>Follow redirects</span>
              </label>
              <IconButton
                icon="discard"
                class="p-push"
                data-testid="settings-reset-api-followRedirects"
                :disabled="isAtDefault('api', 'followRedirects')"
                v-tooltip="'Reset to default'"
                @click="resetLeaf('api', 'followRedirects')"
              />
            </div>

            <label class="field">
              <div class="field-head">
                <span>Max redirects</span>
                <IconButton
                  icon="discard"
                  data-testid="settings-reset-api-maxRedirects"
                  :disabled="isAtDefault('api', 'maxRedirects')"
                  v-tooltip="'Reset to default'"
                  @click="resetLeaf('api', 'maxRedirects')"
                />
              </div>
              <TextField
                type="number"
                :min="MAX_REDIRECTS_RANGE.min"
                :max="MAX_REDIRECTS_RANGE.max"
                size="md"
                :disabled="!draft.api.followRedirects"
                :invalid="!!maxRedirectsError"
                data-testid="settings-api-maxRedirects"
                :model-value="String(draft.api.maxRedirects)"
                @input="onMaxRedirectsInput"
              />
              <span
                v-if="maxRedirectsError"
                class="field-error"
                data-testid="settings-api-maxRedirects-error"
              >
                {{ maxRedirectsError }}
              </span>
              <span v-else-if="!draft.api.followRedirects" class="helper-text">
                Follow redirects is off — this has no effect.
              </span>
            </label>

            <div class="field checkbox-row">
              <label class="field checkbox">
                <Checkbox
                  :model-value="draft.api.disableCookieJar"
                  data-testid="settings-api-disableCookieJar"
                  @update:model-value="onDisableCookieJarChange"
                />
                <span>Disable cookie jar</span>
                <span class="helper-text"
                  >Off keeps a session cookie a server sets and replays it on later requests to
                  the same host.</span
                >
              </label>
              <IconButton
                icon="discard"
                class="p-push"
                data-testid="settings-reset-api-disableCookieJar"
                :disabled="isAtDefault('api', 'disableCookieJar')"
                v-tooltip="'Reset to default'"
                @click="resetLeaf('api', 'disableCookieJar')"
              />
            </div>
          </template>

          <template v-else-if="activeSection === 'Scripts'">
            <p class="helper-text">
              Each script becomes an entry in the tab strip's "+" button and the Terminal module's
              own quick-command panel, opening a new terminal tab running its command. An empty
              working directory falls back to the Terminal module's own default directory.
            </p>

            <div
              v-if="customScriptsStore.records.length"
              class="custom-script-list"
              data-testid="custom-script-list"
            >
              <div
                v-for="script in customScriptsStore.records"
                :key="script.id"
                class="custom-script-row"
                :data-testid="`custom-script-${script.id}`"
              >
                <div class="script-row-top">
                  <div class="script-name">
                    <TextField
                      v-model="scriptDrafts[script.id].name"
                      placeholder="Name"
                      size="md"
                      data-testid="custom-script-name"
                      @blur="onScriptFieldBlur(script)"
                    />
                  </div>
                  <ColorPicker
                    :model-value="script.color"
                    label="Script colour"
                    @update:model-value="(color) => onScriptColorChange(script, color)"
                  />
                  <IconButton
                    icon="trash"
                    data-testid="custom-script-remove"
                    v-tooltip="'Remove this script'"
                    @click="onRemoveScript(script)"
                  />
                </div>
                <div class="script-command">
                  <TextField
                    v-model="scriptDrafts[script.id].command"
                    placeholder="Command"
                    size="md"
                    class="mono"
                    data-testid="custom-script-command"
                    @blur="onScriptFieldBlur(script)"
                  />
                </div>
                <div class="script-workingdir">
                  <TextField
                    v-model="scriptDrafts[script.id].workingDir"
                    placeholder="Active repository"
                    size="md"
                    data-testid="custom-script-workingdir"
                    @blur="onScriptFieldBlur(script)"
                  />
                </div>
              </div>
            </div>
            <p v-else class="helper-text">
              No scripts yet. Add one to launch it from the tab strip's + button.
            </p>

            <div class="custom-script-add">
              <div class="script-row-top">
                <div class="script-name">
                  <TextField
                    v-model="newScriptName"
                    placeholder="Name"
                    size="md"
                    data-testid="custom-script-add-name"
                  />
                </div>
                <ColorPicker v-model="newScriptColor" label="Script colour" />
                <AppButton
                  kind="dialog"
                  :disabled="!canAddScript"
                  data-testid="custom-script-add"
                  @click="onAddScript"
                  >Add</AppButton
                >
              </div>
              <div class="script-command">
                <TextField
                  v-model="newScriptCommand"
                  placeholder="Command"
                  size="md"
                  class="mono"
                  data-testid="custom-script-add-command"
                />
              </div>
              <div class="script-workingdir">
                <TextField
                  v-model="newScriptWorkingDir"
                  placeholder="Active repository"
                  size="md"
                  data-testid="custom-script-add-workingdir"
                />
              </div>
            </div>
            <span v-if="scriptError" class="field-error" data-testid="custom-script-error">{{
              scriptError
            }}</span>
          </template>

          <template v-else-if="activeSection === 'Claude Code'">
            <!-- P86 §9.3: instant-action only, same posture as Connected editors/Database MCP —
                 this leaf (claudeCode.hooksEnabled) both persists and starts/stops the embedded
                 hook listener in one call, so it belongs on the action side of the draft/Save
                 line, never mixed with it. -->
            <label class="field checkbox">
              <Checkbox
                :model-value="settingsStore.claudeCode.hooksEnabled"
                :disabled="claudeCodeHooksToggling"
                data-testid="settings-claude-code-hooks"
                @update:model-value="onToggleAgentHooksEnabled"
              />
              <span>Report session activity to Kira Studio</span>
              <span class="helper-text"
                >A Claude Code tab launches with a `--settings` flag pointing at a file this app
                owns — no project file is written. Turning this off affects only the next launch;
                a session already running simply stops reporting.</span
              >
            </label>

            <template v-if="settingsStore.claudeCode.hooksEnabled">
              <p
                v-if="agentHooksStore.status.error"
                class="muted-note"
                data-testid="claude-code-hooks-error"
              >
                {{ agentHooksStore.status.error }}
              </p>
              <p
                v-else-if="agentHooksStore.status.running"
                class="mono command-text"
                data-testid="claude-code-hooks-path"
              >
                {{ agentHooksStore.status.settingsPath }}
              </p>
            </template>

            <!-- P87 §9: independent of the title bar's own keep-awake button — either source is
                 enough to hold the assertion, and this leaf's own instant-action posture mirrors
                 the hooks toggle just above. -->
            <label class="field checkbox">
              <Checkbox
                :model-value="settingsStore.claudeCode.keepAwakeWithAgents"
                :disabled="keepAwakeAgentAwareToggling"
                data-testid="settings-claude-code-keep-awake"
                @update:model-value="onToggleKeepAwakeAgentAware"
              />
              <span>Keep this Mac awake while a Claude Code session is running</span>
              <span class="helper-text"
                >Prevents idle sleep, and system sleep on AC power, for as long as at least one
                Claude Code tab is live. Independent of the title bar's own keep-awake button —
                either one is enough to keep the machine awake.</span
              >
            </label>
          </template>

          <template v-else-if="activeSection === 'Database MCP'">
            <!-- M1 §6.2: the same instant-action posture the 'Connected editors' section's own
                 revoke/install actions used before it moved to apps/kira-space (P100 Part 2) — this leaf
                 (dbMcp.serverEnabled) both persists and starts/stops the embedded DB MCP server in
                 one call, so it belongs on the action side of the draft/Save line, never mixed with
                 it. Toggle, then command, then button, strictly in that DOM order (§11.4/SPEC's own
                 "enabling is never a silent action"). -->
            <label class="field checkbox">
              <Checkbox
                :model-value="settingsStore.dbMcp.serverEnabled"
                :disabled="dbMcpToggling"
                data-testid="settings-db-mcp-enabled"
                @update:model-value="onToggleDbMcpEnabled"
              />
              <span>Enable the database MCP server</span>
              <span class="helper-text"
                >Lets an AI client list, browse and query the connections exposed below, through
                the same path this app's own SQL console uses. Starts and stops with this
                toggle.</span
              >
            </label>

            <template v-if="settingsStore.dbMcp.serverEnabled">
              <p v-if="dbMcpStore.status.error" class="muted-note" data-testid="db-mcp-error">
                {{ dbMcpStore.status.error }}
              </p>
              <template v-else-if="dbMcpStore.status.running && dbMcpStore.status.command">
                <p class="mono command-text" data-testid="db-mcp-command">
                  {{ dbMcpStore.status.command }}
                </p>
                <AppButton
                  kind="dialog"
                  class="action-button"
                  :disabled="dbMcpInstalling"
                  data-testid="db-mcp-install-button"
                  @click="onInstallDbMcpClaudeCode"
                >
                  {{ dbMcpStore.status.claudeAvailable ? 'Register with Claude Code' : 'Copy command above' }}
                </AppButton>
                <p v-if="dbMcpInstallMessage" class="helper-text" data-testid="db-mcp-install-outcome">
                  {{ dbMcpInstallMessage }}
                </p>
              </template>
              <template v-else-if="dbMcpStore.status.running">
                <p class="muted-note" data-testid="db-mcp-no-token">
                  This server restarted since it was last enabled; its registration command needs a
                  fresh token to show again.
                </p>
                <AppButton
                  kind="dialog"
                  class="action-button"
                  :disabled="dbMcpRegenerating"
                  data-testid="db-mcp-regenerate-button"
                  @click="onRegenerateDbMcpToken"
                >
                  Regenerate token
                </AppButton>
              </template>
              <p
                v-if="dbMcpStore.status.running && dbMcpStore.status.expiresAt"
                class="helper-text"
                data-testid="db-mcp-token-expiry"
              >
                {{
                  dbMcpTokenExpired
                    ? 'Token expired — regenerate it above.'
                    : `Token valid until ${new Date(dbMcpStore.status.expiresAt).toLocaleString()}.`
                }}
              </p>
            </template>

            <div class="sec-label">Exposed connections</div>
            <p class="helper-text">
              Deny by default — only connections checked here are visible to an AI client through
              this server.
            </p>
            <p class="muted-note">
              A newly exposed connection defaults to read allow, write prompt, DDL deny — this
              migration tightened what an already-exposed connection allowed too. Edit a
              connection's own three modes and description in its MCP tab. Newly exposed
              connections plan their queries before running them, and a plan over the
              expensive-query threshold pauses for approval.
            </p>
            <ul
              v-if="connectionsStore.records.length"
              class="db-mcp-connections-list"
              data-testid="db-mcp-connections-list"
            >
              <li
                v-for="conn in connectionsStore.records"
                :key="conn.id"
                class="db-mcp-connection-row"
                :data-testid="`db-mcp-connection-row-${conn.id}`"
              >
                <div class="db-mcp-connection-info">
                  <span class="db-mcp-connection-name">{{ conn.name }}</span>
                  <span class="helper-text"
                    >read {{ conn.mcpReadMode }} · write {{ conn.mcpWriteMode }} · DDL
                    {{ conn.mcpDdlMode }}<template v-if="conn.mcpAutoExplain">
                      · plans queries</template
                    ></span
                  >
                  <span v-if="mcpDescriptionFirstLine(conn)" class="helper-text">{{
                    mcpDescriptionFirstLine(conn)
                  }}</span>
                  <!-- M5 §7.5: extends this existing read-only glance — no second full editor
                       here (M2's own established split); editing lives in the connection's own
                       Privacy tab. -->
                  <span
                    v-if="maskRuleCountsQuery.data.value?.[conn.id]"
                    class="helper-text"
                    :data-testid="`db-mcp-connection-masked-${conn.id}`"
                    >{{ maskRuleCountsQuery.data.value?.[conn.id] }} masked column{{
                      maskRuleCountsQuery.data.value?.[conn.id] === 1 ? '' : 's'
                    }}</span
                  >
                </div>
                <Checkbox
                  :model-value="conn.mcpEnabled"
                  :data-testid="`db-mcp-connection-${conn.id}`"
                  @update:model-value="(v: boolean) => onToggleConnectionMcpEnabled(conn.id, v)"
                />
              </li>
            </ul>
            <p v-else class="muted-note" data-testid="db-mcp-connections-empty">
              No connections yet — add one first.
            </p>
          </template>

          <template v-else-if="activeSection === 'Advanced'">
            <label class="field">
              <div class="field-head">
                <span>Operation log retention (days)</span>
                <IconButton
                  icon="discard"
                  data-testid="settings-reset-advanced-opLogRetentionDays"
                  :disabled="isAtDefault('advanced', 'opLogRetentionDays')"
                  v-tooltip="'Reset to default'"
                  @click="resetLeaf('advanced', 'opLogRetentionDays')"
                />
              </div>
              <TextField
                type="number"
                :min="OP_LOG_RETENTION_DAYS_RANGE.min"
                :max="OP_LOG_RETENTION_DAYS_RANGE.max"
                size="md"
                :invalid="!!opLogRetentionError"
                data-testid="settings-oplog-retention"
                :model-value="String(draft.advanced.opLogRetentionDays)"
                @input="onOpLogRetentionInput"
              />
              <span v-if="opLogRetentionError" class="field-error" data-testid="settings-oplog-retention-error">
                {{ opLogRetentionError }}
              </span>
            </label>
            <p class="muted-note">Takes effect after restart.</p>

            <label class="field">
              <div class="field-head">
                <span>Expensive query threshold (rows)</span>
                <IconButton
                  icon="discard"
                  data-testid="settings-reset-advanced-expensiveQueryRows"
                  :disabled="isAtDefault('advanced', 'expensiveQueryRows')"
                  v-tooltip="'Reset to default'"
                  @click="resetLeaf('advanced', 'expensiveQueryRows')"
                />
              </div>
              <TextField
                type="number"
                :min="EXPENSIVE_QUERY_ROWS_RANGE.min"
                :max="EXPENSIVE_QUERY_ROWS_RANGE.max"
                size="md"
                :invalid="!!expensiveQueryRowsError"
                data-testid="settings-expensive-query-rows"
                :model-value="String(draft.advanced.expensiveQueryRows)"
                @input="onExpensiveQueryRowsInput"
              />
              <span
                v-if="expensiveQueryRowsError"
                class="field-error"
                data-testid="settings-expensive-query-rows-error"
              >
                {{ expensiveQueryRowsError }}
              </span>
              <span v-else class="helper-text"
                >A query whose plan is estimated to read at least this many rows is flagged as
                expensive by the console's Explain button and by auto-explain. Not comparable
                across engines' own cost figures — see the plan panel's own note.</span
              >
            </label>

            <label class="field">
              <div class="field-head">
                <span>Git log level</span>
                <IconButton
                  icon="discard"
                  data-testid="settings-reset-advanced-gitLogLevel"
                  :disabled="isAtDefault('advanced', 'gitLogLevel')"
                  v-tooltip="'Reset to default'"
                  @click="resetLeaf('advanced', 'gitLogLevel')"
                />
              </div>
              <select
                class="p-select bordered md"
                data-testid="settings-git-log-level"
                :value="draft.advanced.gitLogLevel"
                @change="onGitLogLevelChange"
              >
                <option value="off">Off</option>
                <option value="error">Error</option>
                <option value="warn">Warn</option>
                <option value="info">Info</option>
                <option value="debug">Debug</option>
              </select>
              <span class="helper-text">Verbosity of kira-space's own diagnostic log, for every repository.</span>
            </label>
          </template>
      </section>
    </div>

    <template #footer>
      <span class="footer-status">
        <span v-if="saveError" class="field-error" data-testid="settings-save-error">{{ saveError }}</span>
        <span v-else class="helper-text" data-testid="settings-footer-status"
          >Stored in <span class="mono">~/.kira-studio/kira.sqlite</span><template v-if="isDirty">
          · Unsaved changes</template></span
        >
      </span>
      <span class="p-dialog-actions">
        <AppButton kind="dialog" data-testid="settings-cancel" @click="onDismiss">Cancel</AppButton>
        <AppButton
          kind="dialog"
          variant="primary"
          data-testid="settings-save"
          :disabled="!isValid"
          @click="onSave"
        >
          Save
        </AppButton>
      </span>
    </template>
  </DialogFrame>
</template>

<style scoped>
@reference "@theme/base.css";

.dialog-body-inner {
  @apply h-full flex min-h-0;
}

.section-list {
  @apply w-[176px] shrink-0 flex flex-col gap-px;
  border-right: var(--kira-border-width) solid var(--kira-border);
  padding: var(--kira-s-3) var(--kira-s-2);
}

.section-item {
  @apply text-left rounded-[var(--kira-radius-sm)] bg-transparent border-none cursor-pointer;
  height: var(--kira-h-sm);
  padding: 0 var(--kira-s-3);
  color: var(--kira-fg-muted);
  font-size: var(--kira-t-md);
}

.section-item:hover {
  background: var(--kira-hover);
}

.section-item.active {
  background: var(--kira-select);
  color: var(--kira-fg);
}

.section-pane {
  @apply flex-1 overflow-auto flex flex-col;
  padding: var(--kira-s-5);
  gap: var(--kira-s-4);
}

.sec-label {
  @apply uppercase;
  font-size: var(--kira-t-sm);
  color: var(--kira-fg-subtle);
  letter-spacing: 0.06em;
  padding-top: var(--kira-s-2);
}

.sec-label.first {
  @apply pt-0;
}

.field {
  @apply flex flex-col;
  gap: var(--kira-s-2);
  font-size: var(--kira-t-sm);
}

.field > span:first-child {
  color: var(--kira-fg-muted);
}

/* P28 §2.2: label + per-setting reset icon, for every leaf whose field isn't a checkbox row. */
.field-head {
  @apply flex items-center justify-between;
  gap: var(--kira-s-2);
}

.field.checkbox {
  @apply flex-row items-center;
  gap: var(--kira-s-3);
}

/* P28 §2.2: the reset icon sits OUTSIDE the checkbox's own <label> — a <button> inside a
   <label for a checkbox> re-dispatches its click to that checkbox, which would toggle the very
   setting the button resets. */
.checkbox-row {
  @apply flex-row items-start;
}

.checkbox-row .field.checkbox {
  @apply flex-1 min-w-0;
}

.size-input {
  @apply w-24;
}

.size-input :deep(.p-input) {
  @apply w-full;
}

.segmented {
  @apply inline-flex overflow-hidden self-start rounded-[var(--kira-radius-sm)];
  height: var(--kira-h-md);
  border: var(--kira-border-width) solid var(--kira-border-strong);
}

.segmented button {
  @apply cursor-pointer border-none bg-none;
  padding: 0 var(--kira-s-3);
  color: var(--kira-fg-muted);
  font-size: var(--kira-t-sm);
}

.segmented button + button {
  border-left: var(--kira-border-width) solid var(--kira-border-strong);
}

.segmented button.active {
  background: var(--kira-bg-input);
  color: var(--kira-fg);
}

.helper-text {
  @apply leading-normal;
  color: var(--kira-fg-subtle);
  font-size: var(--kira-t-xs);
}

.field-error {
  @apply leading-normal;
  color: var(--kira-error);
  font-size: var(--kira-t-xs);
}

.font-preview {
  @apply overflow-hidden text-ellipsis whitespace-nowrap;
  font-size: var(--kira-t-sm);
  color: var(--kira-fg);
}

.mono {
  font-family: var(--kira-font-data);
}

/* Command-before-button transparency (C3 §7.2/§7.5): a copyable, wrapped command string, shown
   ahead of every Install button that follows one. */
.command-text {
  @apply m-0 leading-normal whitespace-pre-wrap break-all select-all rounded-[var(--kira-radius-sm)];
  padding: var(--kira-s-2);
  background: var(--kira-bg-input);
  border: var(--kira-border-width) solid var(--kira-border);
  font-size: var(--kira-t-xs);
}

.muted-note {
  color: var(--kira-fg-subtle);
  font-size: var(--kira-t-xs);
}

.action-button {
  @apply self-start;
}

/* M2 §7.3: the "Exposed connections" list's own per-row glance. P100 Part 2: originally patterned
   after .git-clients-list/.git-client-row (the 'Connected editors' section's own rules) — both
   moved to apps/kira-space along with that section, so this now stands alone. */
.db-mcp-connections-list {
  @apply flex flex-col m-0 p-0 list-none;
  gap: var(--kira-s-1);
}

.db-mcp-connection-row {
  @apply flex items-center justify-between rounded-[var(--kira-radius-sm)];
  gap: var(--kira-s-3);
  padding: var(--kira-s-2) var(--kira-s-3);
  border: var(--kira-border-width) solid var(--kira-border);
}

.db-mcp-connection-info {
  @apply flex flex-col min-w-0;
  gap: var(--kira-s-1);
}

.db-mcp-connection-name {
  @apply break-words;
  color: var(--kira-fg);
  font-size: var(--kira-t-sm);
}

/* SettingsDialog.html's row-density preview strip */
.row-preview {
  @apply overflow-hidden rounded-[var(--kira-radius-sm)];
  border: var(--kira-border-width) solid var(--kira-border);
}

.row-preview-row {
  @apply flex;
}

.row-preview-row + .row-preview-row {
  border-top: var(--kira-border-width) solid var(--kira-border);
}

.row-preview-head {
  background: var(--kira-bg-elevated);
  border-bottom: var(--kira-border-width) solid var(--kira-border-strong);
}

.row-preview-cell {
  @apply flex items-center overflow-hidden whitespace-nowrap text-ellipsis;
  flex: 0 0 150px;
  padding: 0 var(--kira-s-4);
  font-family: var(--kira-font-data);
  font-size: var(--kira-t-md);
  color: var(--kira-fg);
  border-right: var(--kira-border-width) solid var(--kira-border);
}

.row-preview-head .row-preview-cell {
  color: var(--kira-fg-muted);
  font-size: var(--kira-t-sm);
  font-family: inherit;
}

.row-preview-gutter {
  @apply justify-end;
  flex: 0 0 36px;
  color: var(--kira-fg-subtle);
  font-size: var(--kira-t-xs);
  background: var(--kira-bg-elevated);
}

.row-preview-grow {
  @apply flex-1;
}

.footer-status {
  @apply flex-1 min-w-0 flex items-center;
}

/* P85 §10.2: the Scripts section's list/add row — ConnectionDialog.vue's own
   .mask-rule-list/.mask-rule-row/.mask-rule-add, restated here since that file's scoped styles
   don't reach this one. */
.custom-script-list {
  @apply flex flex-col max-h-80 overflow-y-auto;
  gap: var(--kira-s-3);
}

/* Bug fix (manual testing, "there's no space to see and edit anything"): a script's own Name
   (paired with its colour picker and remove/add button), Command, and Working directory each get
   a full-width line, stacked, instead of cramming three text fields into one row alongside the
   colour picker and a button. */
.custom-script-row {
  @apply flex flex-col;
  gap: var(--kira-s-2);
  padding: var(--kira-s-3) 0;
  border-bottom: var(--kira-border-width) solid var(--kira-border);
}

.custom-script-add {
  @apply flex flex-col;
  gap: var(--kira-s-2);
}

.script-row-top {
  @apply flex items-center;
  gap: var(--kira-s-3);
}

.script-name {
  @apply flex flex-col flex-1 min-w-0;
}

/* .field's own column-flex pattern (above): a TextField's own root is inline-flex, so it only
   stretches to fill its wrapper's width when the wrapper is itself a column-flex container
   (width is the cross axis there, and align-items defaults to stretch). */
.script-command,
.script-workingdir {
  @apply flex flex-col w-full;
}
</style>
