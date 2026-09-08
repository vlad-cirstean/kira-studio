<script setup lang="ts">
import {
  CACHE_L2_BUDGET_MB_RANGE,
  defaultSettings,
  EXPENSIVE_QUERY_ROWS_RANGE,
  FETCH_AUTO_INTERVAL_MINUTES_RANGE,
  FONT_SIZE_RANGE,
  OP_LOG_RETENTION_DAYS_RANGE,
  type RowDensity,
  type Settings,
  type SettingsPatch,
} from '@shared/domain/settings';
import { computed, reactive, ref, watch } from 'vue';
import { data } from '../bridge/data';
import { FONT_CHOICES, fontStackAvailable, resolveFontFallback } from '../fonts';
import { formatBytes, formatRelative } from '../format';
import { cacheStatsState } from '../state/cacheStats';
import { confirmDialog } from '../state/confirmDialog';
import { gitClientsState, installVsCodeIntegration, revokeGitClient } from '../state/gitClients';
import { patchSettings, settingsState } from '../state/settings';
import CodiconIcon from '../theme/CodiconIcon.vue';
import AppButton from '../theme/primitives/AppButton.vue';
import Checkbox from '../theme/primitives/Checkbox.vue';
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
  return patch;
});

const isDirty = computed(() => Object.keys(pendingPatch.value).length > 0);

const sections = ['Appearance', 'Data', 'Cache', 'Connected editors', 'Advanced'] as const;
type Section = (typeof sections)[number];
const activeSection = ref<Section>('Appearance');

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

const isValid = computed(
  () =>
    !fontSizeError.value &&
    !cacheBudgetError.value &&
    !opLogRetentionError.value &&
    !expensiveQueryRowsError.value &&
    !fetchAutoIntervalError.value,
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

          <template v-else-if="activeSection === 'Connected editors'">
            <!-- G10 D14: the Install VS Code Integration entry point — advisory-rendered from
                 VsixStatus, but the click itself always re-resolves through Install. -->
            <div class="git-vsix-install">
              <p v-if="!gitClientsState.vsix.bundled" class="muted-note" data-testid="git-vsix-not-bundled">
                The extension ships inside the packaged app. This build has none.
              </p>
              <AppButton
                v-else
                kind="dialog"
                class="action-button"
                :disabled="vsixInstalling"
                data-testid="git-vsix-install-button"
                @click="onInstallVsCodeIntegration"
              >
                {{ gitClientsState.vsix.codeAvailable ? 'Install VS Code Integration' : 'Reveal Extension in Finder' }}
              </AppButton>
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
</style>
