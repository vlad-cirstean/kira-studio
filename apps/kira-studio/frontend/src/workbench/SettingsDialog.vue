<script setup lang="ts">
import {
  CACHE_L2_BUDGET_MB_RANGE,
  defaultSettings,
  EXPENSIVE_QUERY_ROWS_RANGE,
  FONT_SIZE_RANGE,
  OP_LOG_RETENTION_DAYS_RANGE,
  type RowDensity,
  type Settings,
  type SettingsPatch,
} from '@shared/domain/settings';
import { computed, reactive, ref } from 'vue';
import { data } from '../bridge/data';
import { fontStackAvailable, resolveFontFallback } from '../fonts';
import { formatBytes } from '../format';
import { cacheStatsState } from '../state/cacheStats';
import { patchSettings, settingsState } from '../state/settings';
import CodiconIcon from '../theme/CodiconIcon.vue';
import AppButton from '../theme/primitives/AppButton.vue';
import DialogFrame from '../theme/primitives/DialogFrame.vue';
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
    }),
  );

// Frozen at runtime (mutation would be a bug); typed as plain Settings so diffSection below can
// compare it against the mutable draft without a readonly/mutable type mismatch.
const baseline: Settings = Object.freeze(cloneSections(settingsState)) as Settings;
const draft = reactive<Settings>(cloneSections(settingsState));

// P17 D2: the generic per-leaf diff Save sends. Walking Object.keys(base) rather than a
// hand-maintained leaf list means a future leaf (P18's, or anything after it) is picked up with
// no edit here — see the plan doc's own reasoning for why that removes the need for a dedicated
// diff unit test.
function diffSection<T extends object>(base: T, current: T): Partial<T> | undefined {
  const changed: Partial<T> = {};
  let anyChanged = false;
  for (const key of Object.keys(base) as (keyof T)[]) {
    if (current[key] !== base[key]) {
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
  return patch;
});

const isDirty = computed(() => Object.keys(pendingPatch.value).length > 0);

const sections = ['Appearance', 'Data', 'Cache', 'Advanced'] as const;
type Section = (typeof sections)[number];
const activeSection = ref<Section>('Appearance');

const fontFamilyUnavailable = computed(() => !fontStackAvailable(draft.appearance.fontFamily));
const fontFamilyFallback = computed(() => resolveFontFallback(draft.appearance.fontFamily));

function onFontFamilyInput(e: Event): void {
  draft.appearance.fontFamily = (e.target as HTMLInputElement).value;
}

function onFontSizeInput(e: Event): void {
  draft.appearance.fontSize = Number((e.target as HTMLInputElement).value);
}

function setRowDensity(density: RowDensity): void {
  draft.appearance.rowDensity = density;
}

function onWordWrapChange(e: Event): void {
  draft.appearance.wordWrap = (e.target as HTMLInputElement).checked;
}

function onRowColoringChange(e: Event): void {
  draft.appearance.rowColoring = (e.target as HTMLInputElement).checked;
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

const isValid = computed(
  () =>
    !fontSizeError.value &&
    !cacheBudgetError.value &&
    !opLogRetentionError.value &&
    !expensiveQueryRowsError.value,
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

// P17 D4: stages the defaults into the draft — Save still has to be clicked to commit them.
// Every section, not just the active one (the SPEC row asks for "every setting").
function onRevertDefaults(): void {
  Object.assign(draft.appearance, defaultSettings.appearance);
  Object.assign(draft.data, defaultSettings.data);
  Object.assign(draft.cache, defaultSettings.cache);
  Object.assign(draft.advanced, defaultSettings.advanced);
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
              <span>Data font</span>
              <TextField
                type="text"
                size="md"
                list="kira-font-families"
                :invalid="fontFamilyUnavailable"
                :model-value="draft.appearance.fontFamily"
                @input="onFontFamilyInput"
              />
              <datalist id="kira-font-families">
                <option value="Menlo, monospace" />
                <option value="'SF Mono', Menlo, monospace" />
                <option value="Monaco, monospace" />
                <option value="ui-monospace, Menlo, monospace" />
              </datalist>
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
              <span>Data font size</span>
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
              <span>Row height</span>
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

            <label class="field checkbox">
              <input
                :checked="draft.appearance.wordWrap"
                type="checkbox"
                data-testid="settings-word-wrap"
                @change="onWordWrapChange"
              />
              <span>Word wrap</span>
              <span class="helper-text"
                >Long lines wrap instead of scrolling — the query console, the Mongo console and
                the cell editor.</span
              >
            </label>

            <label class="field checkbox">
              <input
                :checked="draft.appearance.rowColoring"
                type="checkbox"
                data-testid="settings-row-coloring"
                @change="onRowColoringChange"
              />
              <span>Row colouring</span>
              <span class="helper-text"
                >Colour grid values by their column's data type. Off renders every row in the
                plain text colour.</span
              >
            </label>
          </template>

          <template v-else-if="activeSection === 'Data'">
            <label class="field">
              <span>Default page size</span>
              <select
                class="p-select bordered"
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
              <span>Result page cache budget (MB)</span>
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

          <template v-else>
            <label class="field">
              <span>Operation log retention (days)</span>
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
              <span>Expensive query threshold (rows)</span>
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
      <AppButton kind="dialog" data-testid="settings-revert-defaults" @click="onRevertDefaults">
        Revert to Defaults
      </AppButton>
      <span class="footer-status">
        <span v-if="saveError" class="field-error" data-testid="settings-save-error">{{ saveError }}</span>
        <span v-else class="helper-text" data-testid="settings-footer-status"
          >Stored in <span class="mono">~/.kira-studio/kira.sqlite</span> ·
          {{ isDirty ? 'Unsaved changes' : 'changes apply when you save' }}</span
        >
      </span>
      <span class="footer-actions">
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
  color: var(--kira-fg-disabled);
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

.field.checkbox {
  flex-direction: row;
  align-items: center;
  gap: var(--kira-s-3);
}

.field.checkbox input[type='checkbox'] {
  width: 14px;
  height: 14px;
  accent-color: var(--kira-accent);
  cursor: pointer;
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
  color: var(--kira-fg-disabled);
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
  font-family: var(--kira-font-family);
}

.muted-note {
  color: var(--kira-fg-disabled);
  font-size: var(--kira-t-xs);
}

.action-button {
  align-self: flex-start;
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
  font-family: var(--kira-font-family);
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
  color: var(--kira-fg-disabled);
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

.footer-actions {
  display: flex;
  gap: var(--kira-s-3);
}
</style>
