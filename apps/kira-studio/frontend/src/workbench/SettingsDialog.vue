<script setup lang="ts">
import type { PaletteColor } from '@shared/domain/color';
import type { ConnectionSummary } from '@shared/domain/connection';
import type { CustomScript, CustomScriptFields } from '@shared/domain/scripts';
import {
  CACHE_L2_BUDGET_MB_RANGE,
  defaultSettings,
  EXPENSIVE_QUERY_ROWS_RANGE,
  FETCH_AUTO_INTERVAL_MINUTES_RANGE,
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
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { data } from '../bridge/data';
import { FONT_CHOICES, fontStackAvailable, resolveFontFallback } from '../fonts';
import { formatBytes, formatRelative } from '../format';
import { agentHooksState, setAgentHooksEnabled } from '../state/agentHooks';
import { cacheStatsState } from '../state/cacheStats';
import { confirmDialog } from '../state/confirmDialog';
import { connectionsState, setConnectionMcpEnabled } from '../state/connections';
import {
  createCustomScript,
  customScriptsState,
  removeCustomScript,
  updateCustomScript,
} from '../state/customScripts';
import {
  dbMcpState,
  installDbMcpClaudeCode,
  regenerateDbMcpToken,
  setDbMcpEnabled,
} from '../state/dbmcp';
import { gitClientsState, installVsCodeIntegration, revokeGitClient } from '../state/gitClients';
import { maskRulesState } from '../state/maskRules';
import {
  hydrateRepoMap,
  installRepoMapClaudeCode,
  regenerateRepoMapToken,
  repoMapState,
  setRepoMapEnabled,
  setRepoMapRepoEnabled,
} from '../state/repomap';
import {
  patchSettings,
  type Section,
  sections,
  settingsSection,
  settingsState,
} from '../state/settings';
import CodiconIcon from '../theme/CodiconIcon.vue';
import AppButton from '../theme/primitives/AppButton.vue';
import Checkbox from '../theme/primitives/Checkbox.vue';
import ColorPicker from '../theme/primitives/ColorPicker.vue';
import DialogFrame from '../theme/primitives/DialogFrame.vue';
import IconButton from '../theme/primitives/IconButton.vue';
import TextField from '../theme/primitives/TextField.vue';

const PAGE_SIZES = [10, 100, 1000, 10000] as const;

const emit = defineEmits<{ close: [] }>();

// P17 D1: everything the user touches lives in this draft until Save — settingsState (and
// therefore every other window, the database, and the app's own rendering) sees nothing until
// then. The component is created on open and destroyed on close (StatusBar.vue's
// v-if="settingsOpen"), which is the draft's whole lifetime — no store, no reset logic needed.
// JSON round-trip rather than structuredClone(): settingsState is a Vue reactive proxy, and
// structuredClone's algorithm throws on a Proxy rather than cloning the plain data underneath it.
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
const baseline: Settings = Object.freeze(cloneSections(settingsState)) as Settings;
const draft = reactive<Settings>(cloneSections(settingsState));

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

// P85 §10.1: activeSection seeds from settingsSection (state/settings.ts's own module-level ref,
// set by openSettingsAt for a "Manage scripts…" deep link) — null (a plain open) falls back to
// 'Appearance', G12 D9's own default.
const activeSection = ref<Section>(settingsSection.value ?? 'Appearance');

// D16: this section bypasses draft/pendingPatch entirely — a revoke must take effect immediately,
// not wait for Save, and gitClientsState is a module-level store, not a settings leaf.
async function onRevokeGitClient(id: string, label: string): Promise<void> {
  const ok = await confirmDialog(
    `Revoke access for "${label || id}"? It will need to be re-approved.`,
    {
      danger: true,
    },
  );
  if (ok) await revokeGitClient(id);
}

// G10 D12/D14: the same bypass-draft-entirely posture as onRevokeGitClient above — an install is
// an action, not a setting. installing starts true only while the click is in flight (the button
// itself has no separate loading affordance elsewhere in this dialog).
const vsixInstalling = ref(false);
async function onInstallVsCodeIntegration(): Promise<void> {
  vsixInstalling.value = true;
  try {
    await installVsCodeIntegration();
  } finally {
    vsixInstalling.value = false;
  }
}

// D12's own outcome copy, verbatim where it's a fixed string; installFailed/revealFailed weave in
// the server's own bounded Detail/vsixPath.
const vsixOutcomeMessage = computed(() => {
  const result = gitClientsState.vsixInstallResult;
  if (!result) return null;
  switch (result.outcome) {
    case 'installed':
      return 'Installed into VS Code. Reload the window to activate it.';
    case 'revealed':
      return "VS Code's code command isn't available. Revealed the file in Finder — drag it onto VS Code, or run Shell Command: Install 'code' command in PATH.";
    case 'notBundled':
      return 'The extension ships inside the packaged app. This build has none.';
    case 'installFailed':
      return `VS Code refused the install: ${result.detail}. Reveal the file in Finder and drag it onto VS Code instead.`;
    case 'revealFailed':
      return `Couldn't reveal the file automatically. Find it at ${result.vsixPath}.`;
    default:
      return null;
  }
});

// C3 §7.1/D7: same instant-action posture as onRevokeGitClient/onInstallVsCodeIntegration above —
// the toggle bypasses draft/Save entirely, since SetEnabled both persists the leaf and starts/stops
// the embedded instance in one call.
const repoMapToggling = ref(false);
async function onToggleRepoMapEnabled(enabled: boolean): Promise<void> {
  repoMapToggling.value = true;
  try {
    await setRepoMapEnabled(enabled);
  } finally {
    repoMapToggling.value = false;
  }
}

// P67d §7.4: the "Repository access" list's own per-row toggle — keyed by code_repos.id so two
// rows can never step on each other's disabled state while both are mid-flight.
const repoMapRepoToggling = ref<string | null>(null);
async function onToggleRepoMapRepo(id: string, enabled: boolean): Promise<void> {
  repoMapRepoToggling.value = id;
  try {
    await setRepoMapRepoEnabled(id, enabled);
  } finally {
    repoMapRepoToggling.value = null;
  }
}

const repoMapRegenerating = ref(false);
async function onRegenerateRepoMapToken(): Promise<void> {
  repoMapRegenerating.value = true;
  try {
    await regenerateRepoMapToken();
  } finally {
    repoMapRegenerating.value = false;
  }
}

// P69 review, Group 2: repoMapState.status was otherwise only written at boot and by this
// dialog's own mutation calls above — nothing re-fetched it when the Code intelligence section
// became active, so a repository imported elsewhere while Settings sat open stayed invisible,
// and a row stuck on "indexing" never advanced to "ready" without an unrelated refetch. Refresh
// on entering the section, then poll a short interval while any listed row is still indexing.
const REPOMAP_POLL_INTERVAL_MS = 3000;
let repoMapPollTimer: ReturnType<typeof setInterval> | null = null;

function repoMapStillIndexing(): boolean {
  return repoMapState.status.repos.some((r) => r.serving && !r.ready);
}

function stopRepoMapPoll(): void {
  if (repoMapPollTimer === null) return;
  clearInterval(repoMapPollTimer);
  repoMapPollTimer = null;
}

function startRepoMapPollIfNeeded(): void {
  if (repoMapPollTimer !== null || !repoMapStillIndexing()) return;
  repoMapPollTimer = setInterval(() => {
    void hydrateRepoMap().then(() => {
      if (!repoMapStillIndexing()) stopRepoMapPoll();
    });
  }, REPOMAP_POLL_INTERVAL_MS);
}

watch(
  activeSection,
  (section) => {
    if (section !== 'Code intelligence') {
      stopRepoMapPoll();
      return;
    }
    void hydrateRepoMap().then(startRepoMapPollIfNeeded);
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  stopRepoMapPoll();
  // §10.1: a later plain open (TitleBar.vue's gear icon, the command palette) must not inherit a
  // deep link this instance was opened with.
  settingsSection.value = null;
});

const repoMapInstalling = ref(false);
async function onInstallRepoMapClaudeCode(): Promise<void> {
  repoMapInstalling.value = true;
  try {
    await installRepoMapClaudeCode();
  } finally {
    repoMapInstalling.value = false;
  }
}

// §7.2's own outcome copy — mcpinstall's three-value vocabulary, verbatim where it's a fixed
// string.
const repoMapInstallMessage = computed(() => {
  const result = repoMapState.installResult;
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

// M1 §6.2: repo-map's own token-expiry line, on both servers now that both rotate — "expired,
// regenerate" rather than a stale-looking date once the instant has passed.
function tokenExpired(expiresAt: string): boolean {
  return !!expiresAt && new Date(expiresAt).getTime() <= Date.now();
}
const repoMapTokenExpired = computed(() => tokenExpired(repoMapState.status.expiresAt));

// M1 §6.2: same instant-action posture as onToggleRepoMapEnabled — dbMcp.serverEnabled both
// persists and starts/stops the embedded DB MCP server in one call.
const dbMcpToggling = ref(false);
async function onToggleDbMcpEnabled(enabled: boolean): Promise<void> {
  dbMcpToggling.value = true;
  try {
    await setDbMcpEnabled(enabled);
  } finally {
    dbMcpToggling.value = false;
  }
}

const dbMcpRegenerating = ref(false);
async function onRegenerateDbMcpToken(): Promise<void> {
  dbMcpRegenerating.value = true;
  try {
    await regenerateDbMcpToken();
  } finally {
    dbMcpRegenerating.value = false;
  }
}

const dbMcpInstalling = ref(false);
async function onInstallDbMcpClaudeCode(): Promise<void> {
  dbMcpInstalling.value = true;
  try {
    await installDbMcpClaudeCode();
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
    await setAgentHooksEnabled(enabled);
  } finally {
    claudeCodeHooksToggling.value = false;
  }
}

const dbMcpInstallMessage = computed(() => {
  const result = dbMcpState.installResult;
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

const dbMcpTokenExpired = computed(() => tokenExpired(dbMcpState.status.expiresAt));

// M1 §6.1: exposure itself (deny by default) stays an instant toggle here, P67d's own shape for
// the same problem on the repo-map side. M2 §7.3: the three permission modes and the description
// are edited in the connection's own MCP tab, not here — this list stays a read-only glance plus
// the one control it already had.
async function onToggleConnectionMcpEnabled(id: string, enabled: boolean): Promise<void> {
  await setConnectionMcpEnabled(id, enabled);
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

function onFetchAutoIntervalInput(e: Event): void {
  draft.git.fetchAutoIntervalMinutes = Number((e.target as HTMLInputElement).value);
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

// P72 §9.2: kira-version's own diagnostic log verbosity, moved here from the per-repo
// RepoSettingsDialog.vue's kiraVersion.log.level — genuinely installation-wide, not a per-repo
// fact, so this is now the one control that sets it.
function onGitLogLevelChange(e: Event): void {
  draft.advanced.gitLogLevel = (e.target as HTMLSelectElement)
    .value as Settings['advanced']['gitLogLevel'];
}

// G7 D17: `*` matches any run of characters except `/` — the same rule gitpreflight.
// MatchProtectedBranch enforces server-side; this dialog only edits the pattern list, never
// evaluates it. A plain ref, not a computed bound straight to draft.git.protectedBranches: parsing
// on every keystroke and feeding the result back into the textarea's own value would snap away a
// blank line the instant it's created, fighting the user mid-edit — parsed into the draft by the
// watcher below instead, one-directionally.
const protectedBranchesText = ref(draft.git.protectedBranches.join('\n'));
watch(protectedBranchesText, (v) => {
  draft.git.protectedBranches = v
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
});
function resetProtectedBranches(): void {
  draft.git.protectedBranches = [...defaultSettings.git.protectedBranches];
  protectedBranchesText.value = draft.git.protectedBranches.join('\n');
}

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

const fetchAutoIntervalError = computed<string | null>(() => {
  const v = draft.git.fetchAutoIntervalMinutes;
  if (!Number.isFinite(v)) return 'Enter a number.';
  if (v < FETCH_AUTO_INTERVAL_MINUTES_RANGE.min || v > FETCH_AUTO_INTERVAL_MINUTES_RANGE.max) {
    return `${FETCH_AUTO_INTERVAL_MINUTES_RANGE.min}–${FETCH_AUTO_INTERVAL_MINUTES_RANGE.max} minutes`;
  }
  return null;
});

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
    !fetchAutoIntervalError.value &&
    !requestTimeoutMsError.value &&
    !maxResponseMbError.value &&
    !maxRedirectsError.value,
);

const hitRateLabel = computed(() => {
  const stats = cacheStatsState.stats;
  if (!stats) return '—';
  const total = stats.l2Hits + stats.l2Misses;
  if (total === 0) return '—';
  return `${Math.round((stats.l2Hits / total) * 100)}% (${stats.l2Hits}/${total})`;
});

const cacheSizeLabel = computed(() => {
  const stats = cacheStatsState.stats;
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
    await patchSettings(patch);
    emit('close');
  } catch (err) {
    saveError.value = err instanceof Error ? err.message : String(err);
  }
}

// P85 §10.2: the Scripts section — ConnectionDialog.vue's own Privacy-tab list-editing layout
// (mask rules), restated for scripts. This section bypasses draft/pendingPatch entirely, the same
// posture 'Connected editors'/'Code intelligence' already take (§10.1) — customScriptsState is a
// module-level store, not a settings leaf, and a script edited here must apply immediately so the
// tab strip's own dropdown reflects it without a Save.
interface ScriptDraft {
  name: string;
  command: string;
  workingDir: string;
}
const scriptDrafts = reactive<Record<string, ScriptDraft>>({});
function syncScriptDrafts(): void {
  for (const key of Object.keys(scriptDrafts)) delete scriptDrafts[key];
  for (const script of customScriptsState.records) {
    scriptDrafts[script.id] = {
      name: script.name,
      command: script.command,
      workingDir: script.workingDir,
    };
  }
}
watch(() => customScriptsState.records, syncScriptDrafts, { immediate: true });

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
    await updateCustomScript(script.id, {
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
  await updateCustomScript(script.id, {
    name: script.name,
    command: script.command,
    workingDir: script.workingDir,
    color,
  });
}

async function onRemoveScript(script: CustomScript): Promise<void> {
  const ok = await confirmDialog(
    `Remove "${script.name}"? It will no longer launch from the tab strip or the Terminal panel.`,
    {
      danger: true,
    },
  );
  if (ok) await removeCustomScript(script.id);
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
    await createCustomScript(fields);
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

          <template v-else-if="activeSection === 'Connected editors'">
            <!-- G10 D14: the Install VS Code Integration entry point — advisory-rendered from
                 VsixStatus, but the click itself always re-resolves through Install. -->
            <div class="git-vsix-install">
              <p v-if="!gitClientsState.vsix.bundled" class="muted-note" data-testid="git-vsix-not-bundled">
                The extension ships inside the packaged app. This build has none.
              </p>
              <template v-else>
                <!-- C3 §7.5: the same command-before-button transparency the Code intelligence
                     tab's Claude Code flow uses, applied here too — unrelated feature, same
                     principle. -->
                <p class="mono command-text" data-testid="git-vsix-command">
                  {{ gitClientsState.vsix.command }}
                </p>
                <AppButton
                  kind="dialog"
                  class="action-button"
                  :disabled="vsixInstalling"
                  data-testid="git-vsix-install-button"
                  @click="onInstallVsCodeIntegration"
                >
                  {{ gitClientsState.vsix.codeAvailable ? 'Install VS Code Integration' : 'Reveal Extension in Finder' }}
                </AppButton>
              </template>
              <p v-if="vsixOutcomeMessage" class="helper-text" data-testid="git-vsix-outcome">
                {{ vsixOutcomeMessage }}
              </p>
              <p
                v-if="gitClientsState.vsix.bundled && !gitClientsState.vsix.codeAvailable && gitClientsState.vsix.probed.length > 0"
                class="muted-note"
                data-testid="git-vsix-probed"
              >
                Looked for VS Code's <span class="mono">code</span> command at:
                <span class="mono">{{ gitClientsState.vsix.probed.join(', ') }}</span>
              </p>
            </div>

            <p v-if="gitClientsState.clients.length === 0" class="muted-note" data-testid="git-clients-empty">
              No editors have been paired yet. A VS Code editor pairs by connecting to
              <span class="mono">~/.kira-studio/git.sock</span>.
            </p>
            <ul v-else class="git-clients-list">
              <li
                v-for="client in gitClientsState.clients"
                :key="client.id"
                class="git-client-row"
                :data-testid="`git-client-row-${client.id}`"
              >
                <div class="git-client-info">
                  <span class="git-client-label">{{ client.label || client.id }}</span>
                  <span class="helper-text">
                    <template v-if="client.revokedAt">Revoked</template>
                    <template v-else>Last seen {{ formatRelative(client.lastSeenAt) }}</template>
                  </span>
                </div>
                <IconButton
                  v-if="!client.revokedAt"
                  icon="trash"
                  tone="danger"
                  :data-testid="`git-client-revoke-${client.id}`"
                  v-tooltip="'Revoke'"
                  @click="onRevokeGitClient(client.id, client.label)"
                />
              </li>
            </ul>
          </template>

          <template v-else-if="activeSection === 'Git'">
            <h3 class="section-subhead">Git remote operations</h3>
            <p class="muted-note">
              Server-owned: applies to every connected editor immediately, since two windows
              disagreeing about either is a safety issue, not a preference.
            </p>
            <label class="field">
              <div class="field-head">
                <span>Protected branch patterns (one per line)</span>
                <IconButton
                  icon="discard"
                  data-testid="settings-reset-git-protectedBranches"
                  :disabled="isAtDefault('git', 'protectedBranches')"
                  v-tooltip="'Reset to default'"
                  @click="resetProtectedBranches"
                />
              </div>
              <textarea
                v-model="protectedBranchesText"
                class="p-textarea"
                rows="4"
                placeholder="main"
                data-testid="settings-git-protected-branches"
              />
              <span class="helper-text"
                >Force-pushing or deleting a matching remote branch requires typing its name to
                confirm. "*" matches any characters except "/". Ordinary pushes are never gated.</span
              >
            </label>
            <label class="field">
              <div class="field-head">
                <span>Auto-fetch interval (minutes)</span>
                <IconButton
                  icon="discard"
                  data-testid="settings-reset-git-fetchAutoIntervalMinutes"
                  :disabled="isAtDefault('git', 'fetchAutoIntervalMinutes')"
                  v-tooltip="'Reset to default'"
                  @click="resetLeaf('git', 'fetchAutoIntervalMinutes')"
                />
              </div>
              <TextField
                type="number"
                :min="FETCH_AUTO_INTERVAL_MINUTES_RANGE.min"
                :max="FETCH_AUTO_INTERVAL_MINUTES_RANGE.max"
                size="md"
                :invalid="!!fetchAutoIntervalError"
                data-testid="settings-git-fetch-auto-interval"
                :model-value="String(draft.git.fetchAutoIntervalMinutes)"
                @input="onFetchAutoIntervalInput"
              />
              <span
                v-if="fetchAutoIntervalError"
                class="field-error"
                data-testid="settings-git-fetch-auto-interval-error"
              >
                {{ fetchAutoIntervalError }}
              </span>
              <span v-else class="helper-text"
                >0 disables background fetching. Never prompts for a credential — a remote that
                needs one simply fails silently and disables the timer until the next explicit
                fetch.</span
              >
            </label>
            <label class="field">
              <div class="field-head">
                <span>Git executable path</span>
                <IconButton
                  icon="discard"
                  data-testid="settings-reset-git-gitPath"
                  :disabled="isAtDefault('git', 'gitPath')"
                  v-tooltip="'Reset to default'"
                  @click="resetLeaf('git', 'gitPath')"
                />
              </div>
              <TextField
                type="text"
                size="md"
                data-testid="settings-git-path"
                v-model="draft.git.gitPath"
              />
              <span class="helper-text"
                >Empty uses the host's own discovery (PATH). A remote op reads this fresh every
                time, never cached, so a change here takes effect on the next one.</span
              >
            </label>
          </template>

          <template v-else-if="activeSection === 'Scripts'">
            <p class="helper-text">
              Each script becomes an entry in the tab strip's "+" button and the Terminal module's
              own quick-command panel, opening a new terminal tab running its command. An empty
              working directory uses the active repository's own worktree root.
            </p>

            <div
              v-if="customScriptsState.records.length"
              class="custom-script-list"
              data-testid="custom-script-list"
            >
              <div
                v-for="script in customScriptsState.records"
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
            <!-- P86 §9.3: instant-action only, same posture as Code intelligence/Database MCP —
                 this leaf (claudeCode.hooksEnabled) both persists and starts/stops the embedded
                 hook listener in one call, so it belongs on the action side of the draft/Save
                 line, never mixed with it. -->
            <label class="field checkbox">
              <Checkbox
                :model-value="settingsState.claudeCode.hooksEnabled"
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

            <template v-if="settingsState.claudeCode.hooksEnabled">
              <p
                v-if="agentHooksState.status.error"
                class="muted-note"
                data-testid="claude-code-hooks-error"
              >
                {{ agentHooksState.status.error }}
              </p>
              <p
                v-else-if="agentHooksState.status.running"
                class="mono command-text"
                data-testid="claude-code-hooks-path"
              >
                {{ agentHooksState.status.settingsPath }}
              </p>
            </template>
          </template>

          <template v-else-if="activeSection === 'Code intelligence'">
            <!-- C3 §7.1/§7.4: instant-action only, same posture as Connected editors — this leaf
                 (codeIntel.mcpServerEnabled) both persists and starts/stops the embedded repo-map
                 MCP server in one call, so it belongs on the action side of the draft/Save line,
                 never mixed with it. Toggle, then command, then button, strictly in that DOM order
                 (§11.4/SPEC's own "enabling is never a silent action"). -->
            <label class="field checkbox">
              <Checkbox
                :model-value="settingsState.codeIntel.mcpServerEnabled"
                :disabled="repoMapToggling"
                data-testid="settings-code-intel-enabled"
                @update:model-value="onToggleRepoMapEnabled"
              />
              <span>Enable the repository-map MCP server</span>
              <span class="helper-text"
                >Starts a local MCP server so an AI coding assistant can navigate your code
                (definitions, references, file outlines) from a pre-built index instead of reading
                every file. Grant it access to individual repositories below.</span
              >
            </label>

            <template v-if="settingsState.codeIntel.mcpServerEnabled">
              <p v-if="repoMapState.status.error" class="muted-note" data-testid="repomap-error">
                {{ repoMapState.status.error }}
              </p>
              <template v-else-if="repoMapState.status.running && repoMapState.status.command">
                <p class="mono command-text" data-testid="repomap-command">
                  {{ repoMapState.status.command }}
                </p>
                <AppButton
                  kind="dialog"
                  class="action-button"
                  :disabled="repoMapInstalling"
                  data-testid="repomap-install-button"
                  @click="onInstallRepoMapClaudeCode"
                >
                  {{ repoMapState.status.claudeAvailable ? 'Register with Claude Code' : 'Copy command above' }}
                </AppButton>
                <p v-if="repoMapInstallMessage" class="helper-text" data-testid="repomap-install-outcome">
                  {{ repoMapInstallMessage }}
                </p>
              </template>
              <template v-else-if="repoMapState.status.running">
                <!-- P67d §6.3 (D2): one app-scoped token now covers every granted repository, so an
                     enable no longer mints unconditionally — this is also what an app restart looks
                     like (the existing token's hash+salt loaded, but the plaintext itself unknown to
                     this process; a hash cannot be reversed). -->
                <p class="muted-note" data-testid="repomap-no-token">
                  Using the registration from last time — it's still valid. Regenerate only if it
                  was never registered with Claude Code, or you want to invalidate it.
                </p>
                <AppButton
                  kind="dialog"
                  class="action-button"
                  :disabled="repoMapRegenerating"
                  data-testid="repomap-regenerate-button"
                  @click="onRegenerateRepoMapToken"
                >
                  Regenerate token
                </AppButton>
              </template>

              <!-- M1 §6.2: the 7-day rotation retrofit is otherwise a silent trap — a registered
                   client just starts getting 401s a week after upgrade with no visible cause. -->
              <p
                v-if="repoMapState.status.running && repoMapState.status.expiresAt"
                class="helper-text"
                data-testid="repomap-token-expiry"
              >
                {{
                  repoMapTokenExpired
                    ? 'Token expired — regenerate it above.'
                    : `Token valid until ${new Date(repoMapState.status.expiresAt).toLocaleString()}.`
                }}
              </p>

              <h3 class="section-subhead">Repository access</h3>
              <p class="muted-note">
                An assistant can navigate only the repositories granted here. Nothing is shared by
                default.
              </p>
              <p
                v-if="repoMapState.status.repos.length === 0"
                class="muted-note"
                data-testid="repomap-repos-empty"
              >
                No repositories imported yet. Import one from the Git module's panel.
              </p>
              <ul v-else class="repomap-repos-list" data-testid="repomap-repos-list">
                <li
                  v-for="repo in repoMapState.status.repos"
                  :key="repo.id"
                  class="repomap-repo-row"
                  :data-testid="`repomap-repo-row-${repo.id}`"
                >
                  <div class="repomap-repo-info">
                    <span class="repomap-repo-name">{{ repo.name }}</span>
                    <span class="helper-text mono">{{ repo.root }}</span>
                    <span
                      v-if="repo.error"
                      class="field-error"
                      :data-testid="`repomap-repo-error-${repo.id}`"
                    >
                      {{ repo.error }}
                    </span>
                    <span v-else-if="repo.serving" class="helper-text">
                      {{ repo.ready ? `Shared as "${repo.key}"` : 'Indexing…' }}
                    </span>
                  </div>
                  <Checkbox
                    :model-value="repo.enabled"
                    :disabled="repoMapRepoToggling === repo.id"
                    :data-testid="`repomap-repo-toggle-${repo.id}`"
                    @update:model-value="(v) => onToggleRepoMapRepo(repo.id, v)"
                  />
                </li>
              </ul>
            </template>
          </template>

          <template v-else-if="activeSection === 'Database MCP'">
            <!-- M1 §6.2: same instant-action posture as Code intelligence just above — this leaf
                 (dbMcp.serverEnabled) both persists and starts/stops the embedded DB MCP server in
                 one call, so it belongs on the action side of the draft/Save line, never mixed with
                 it. Toggle, then command, then button, strictly in that DOM order (§11.4/SPEC's own
                 "enabling is never a silent action"). -->
            <label class="field checkbox">
              <Checkbox
                :model-value="settingsState.dbMcp.serverEnabled"
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

            <template v-if="settingsState.dbMcp.serverEnabled">
              <p v-if="dbMcpState.status.error" class="muted-note" data-testid="db-mcp-error">
                {{ dbMcpState.status.error }}
              </p>
              <template v-else-if="dbMcpState.status.running && dbMcpState.status.command">
                <p class="mono command-text" data-testid="db-mcp-command">
                  {{ dbMcpState.status.command }}
                </p>
                <AppButton
                  kind="dialog"
                  class="action-button"
                  :disabled="dbMcpInstalling"
                  data-testid="db-mcp-install-button"
                  @click="onInstallDbMcpClaudeCode"
                >
                  {{ dbMcpState.status.claudeAvailable ? 'Register with Claude Code' : 'Copy command above' }}
                </AppButton>
                <p v-if="dbMcpInstallMessage" class="helper-text" data-testid="db-mcp-install-outcome">
                  {{ dbMcpInstallMessage }}
                </p>
              </template>
              <template v-else-if="dbMcpState.status.running">
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
                v-if="dbMcpState.status.running && dbMcpState.status.expiresAt"
                class="helper-text"
                data-testid="db-mcp-token-expiry"
              >
                {{
                  dbMcpTokenExpired
                    ? 'Token expired — regenerate it above.'
                    : `Token valid until ${new Date(dbMcpState.status.expiresAt).toLocaleString()}.`
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
              v-if="connectionsState.records.length"
              class="db-mcp-connections-list"
              data-testid="db-mcp-connections-list"
            >
              <li
                v-for="conn in connectionsState.records"
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
                    v-if="maskRulesState.counts[conn.id]"
                    class="helper-text"
                    :data-testid="`db-mcp-connection-masked-${conn.id}`"
                    >{{ maskRulesState.counts[conn.id] }} masked column{{
                      maskRulesState.counts[conn.id] === 1 ? '' : 's'
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
              <span class="helper-text">Verbosity of kira-version's own diagnostic log, for every repository.</span>
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
.dialog-body-inner {
  height: 100%;
  display: flex;
  min-height: 0;
}

.section-list {
  width: 176px;
  flex-shrink: 0;
  border-right: var(--kira-border-width) solid var(--kira-border);
  display: flex;
  flex-direction: column;
  padding: var(--kira-s-3) var(--kira-s-2);
  gap: 1px;
}

.section-item {
  height: var(--kira-h-sm);
  text-align: left;
  padding: 0 var(--kira-s-3);
  border-radius: var(--kira-radius-sm);
  background: transparent;
  border: none;
  color: var(--kira-fg-muted);
  font-size: var(--kira-t-md);
  cursor: pointer;
}

.section-item:hover {
  background: var(--kira-hover);
}

.section-item.active {
  background: var(--kira-select);
  color: var(--kira-fg);
}

.section-pane {
  flex: 1;
  padding: var(--kira-s-5);
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-4);
}

.sec-label {
  font-size: var(--kira-t-sm);
  color: var(--kira-fg-subtle);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding-top: var(--kira-s-2);
}

.sec-label.first {
  padding-top: 0;
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-2);
  font-size: var(--kira-t-sm);
}

.field > span:first-child {
  color: var(--kira-fg-muted);
}

/* P28 §2.2: label + per-setting reset icon, for every leaf whose field isn't a checkbox row. */
.field-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--kira-s-2);
}

.field.checkbox {
  flex-direction: row;
  align-items: center;
  gap: var(--kira-s-3);
}

/* P28 §2.2: the reset icon sits OUTSIDE the checkbox's own <label> — a <button> inside a
   <label for a checkbox> re-dispatches its click to that checkbox, which would toggle the very
   setting the button resets. */
.checkbox-row {
  flex-direction: row;
  align-items: flex-start;
}

.checkbox-row .field.checkbox {
  flex: 1;
  min-width: 0;
}

.size-input {
  width: 96px;
}

.size-input :deep(.p-input) {
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

.helper-text {
  color: var(--kira-fg-subtle);
  font-size: var(--kira-t-xs);
  line-height: 1.5;
}

.field-error {
  color: var(--kira-error);
  font-size: var(--kira-t-xs);
  line-height: 1.5;
}

.font-preview {
  font-size: var(--kira-t-sm);
  color: var(--kira-fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mono {
  font-family: var(--kira-font-data);
}

/* Command-before-button transparency (C3 §7.2/§7.5): a copyable, wrapped command string, shown
   ahead of every Install button that follows one. */
.command-text {
  margin: 0;
  padding: var(--kira-s-2);
  background: var(--kira-bg-input);
  border: var(--kira-border-width) solid var(--kira-border);
  border-radius: var(--kira-radius-sm);
  font-size: var(--kira-t-xs);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  user-select: all;
}

.muted-note {
  color: var(--kira-fg-subtle);
  font-size: var(--kira-t-xs);
}

.section-subhead {
  margin: var(--kira-s-3) 0 0;
  font-size: var(--kira-t-sm);
  font-weight: 600;
  color: var(--kira-fg);
}

.action-button {
  align-self: flex-start;
}

.git-vsix-install {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--kira-s-2);
  margin-bottom: var(--kira-s-4);
  padding-bottom: var(--kira-s-4);
  border-bottom: var(--kira-border-width) solid var(--kira-border);
}

.git-clients-list {
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.git-client-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--kira-s-3);
  padding: var(--kira-s-2) var(--kira-s-3);
  border: var(--kira-border-width) solid var(--kira-border);
  border-radius: var(--kira-radius-sm);
}

.git-client-info {
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-1);
  min-width: 0;
}

.git-client-label {
  color: var(--kira-fg);
  font-size: var(--kira-t-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* P67d §7.4: the "Repository access" list — .git-clients-list/.git-client-row's own pattern, with
   the info column allowed to wrap the root path instead of eliding it. */
.repomap-repos-list {
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.repomap-repo-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--kira-s-3);
  padding: var(--kira-s-2) var(--kira-s-3);
  border: var(--kira-border-width) solid var(--kira-border);
  border-radius: var(--kira-radius-sm);
}

.repomap-repo-info {
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-1);
  min-width: 0;
}

.repomap-repo-name {
  color: var(--kira-fg);
  font-size: var(--kira-t-sm);
  overflow-wrap: break-word;
}

/* M2 §7.3: the "Exposed connections" list's own per-row glance — repomap-repo-row's own shape. */
.db-mcp-connections-list {
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.db-mcp-connection-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--kira-s-3);
  padding: var(--kira-s-2) var(--kira-s-3);
  border: var(--kira-border-width) solid var(--kira-border);
  border-radius: var(--kira-radius-sm);
}

.db-mcp-connection-info {
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-1);
  min-width: 0;
}

.db-mcp-connection-name {
  color: var(--kira-fg);
  font-size: var(--kira-t-sm);
  overflow-wrap: break-word;
}

/* SettingsDialog.html's row-density preview strip */
.row-preview {
  border: var(--kira-border-width) solid var(--kira-border);
  border-radius: var(--kira-radius-sm);
  overflow: hidden;
}

.row-preview-row {
  display: flex;
}

.row-preview-row + .row-preview-row {
  border-top: var(--kira-border-width) solid var(--kira-border);
}

.row-preview-head {
  background: var(--kira-bg-elevated);
  border-bottom: var(--kira-border-width) solid var(--kira-border-strong);
}

.row-preview-cell {
  flex: 0 0 150px;
  display: flex;
  align-items: center;
  padding: 0 var(--kira-s-4);
  font-family: var(--kira-font-data);
  font-size: var(--kira-t-md);
  color: var(--kira-fg);
  border-right: var(--kira-border-width) solid var(--kira-border);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.row-preview-head .row-preview-cell {
  color: var(--kira-fg-muted);
  font-size: var(--kira-t-sm);
  font-family: inherit;
}

.row-preview-gutter {
  flex: 0 0 36px;
  justify-content: flex-end;
  color: var(--kira-fg-subtle);
  font-size: var(--kira-t-xs);
  background: var(--kira-bg-elevated);
}

.row-preview-grow {
  flex: 1;
}

.footer-status {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
}

/* P85 §10.2: the Scripts section's list/add row — ConnectionDialog.vue's own
   .mask-rule-list/.mask-rule-row/.mask-rule-add, restated here since that file's scoped styles
   don't reach this one. */
.custom-script-list {
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-3);
  max-height: 320px;
  overflow-y: auto;
}

/* Bug fix (manual testing, "there's no space to see and edit anything"): a script's own Name
   (paired with its colour picker and remove/add button), Command, and Working directory each get
   a full-width line, stacked, instead of cramming three text fields into one row alongside the
   colour picker and a button. */
.custom-script-row {
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-2);
  padding: var(--kira-s-3) 0;
  border-bottom: var(--kira-border-width) solid var(--kira-border);
}

.custom-script-add {
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-2);
}

.script-row-top {
  display: flex;
  align-items: center;
  gap: var(--kira-s-3);
}

.script-name {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

/* .field's own column-flex pattern (above): a TextField's own root is inline-flex, so it only
   stretches to fill its wrapper's width when the wrapper is itself a column-flex container
   (width is the cross axis there, and align-items defaults to stretch). */
.script-command,
.script-workingdir {
  display: flex;
  flex-direction: column;
  width: 100%;
}
</style>
