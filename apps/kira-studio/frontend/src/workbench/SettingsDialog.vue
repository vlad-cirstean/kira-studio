<script setup lang="ts">
import type { RowDensity, SettingsPatch } from '@shared/domain/settings';
import { computed, ref } from 'vue';
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

// Cancel reverts to whatever was in effect when the dialog opened — every field otherwise
// applies immediately (the footer says so), so "cancel" needs a baseline to patch back to
// rather than an unsaved draft to simply discard.
// JSON round-trip rather than structuredClone(): settingsState is a Vue reactive proxy, and
// structuredClone's algorithm throws on a Proxy in this Electron/Chromium build rather than
// transparently cloning the plain data underneath it.
const initialSettings: SettingsPatch = JSON.parse(
  JSON.stringify({
    appearance: settingsState.appearance,
    data: settingsState.data,
    cache: settingsState.cache,
    advanced: settingsState.advanced,
  }),
);

async function onCancel(): Promise<void> {
  await patchSettings(initialSettings);
  emit('close');
}

const sections = ['Appearance', 'Data', 'Cache', 'Advanced'] as const;
type Section = (typeof sections)[number];
const activeSection = ref<Section>('Appearance');

// P31 D9/D10: a live local draft, updated on every keystroke (@input) so the preview line and
// the availability check track what's actually typed — the commit itself stays on @change
// (P16 §6's original reasoning holds: per-keystroke commits would repaint the whole app's font
// for every partial family name). Superseding P16 §6's later `7641dd6` revert to plain @change
// with no feedback at all: this restores the feedback without reintroducing the repaint cost.
const fontFamilyDraft = ref(settingsState.appearance.fontFamily);
const fontFamilyUnavailable = computed(() => !fontStackAvailable(fontFamilyDraft.value));
const fontFamilyFallback = computed(() => resolveFontFallback(fontFamilyDraft.value));

function onFontFamilyInput(e: Event): void {
  fontFamilyDraft.value = (e.target as HTMLInputElement).value;
}

function onFontFamilyChange(e: Event): void {
  const value = (e.target as HTMLInputElement).value;
  fontFamilyDraft.value = value;
  void patchSettings({ appearance: { fontFamily: value } });
}

function onFontSizeChange(e: Event): void {
  const value = Number((e.target as HTMLInputElement).value);
  if (Number.isNaN(value)) return;
  void patchSettings({ appearance: { fontSize: value } });
}

function setRowDensity(density: RowDensity): void {
  void patchSettings({ appearance: { rowDensity: density } });
}

function onWordWrapChange(e: Event): void {
  void patchSettings({ appearance: { wordWrap: (e.target as HTMLInputElement).checked } });
}

function onRowColoringChange(e: Event): void {
  void patchSettings({ appearance: { rowColoring: (e.target as HTMLInputElement).checked } });
}

const rowPreviewHeight = computed(() =>
  settingsState.appearance.rowDensity === 'compact' ? 22 : 28,
);

function onDefaultPageSizeChange(e: Event): void {
  const value = Number((e.target as HTMLSelectElement).value);
  const pageSize = PAGE_SIZES.find((size) => size === value);
  if (!pageSize) return;
  void patchSettings({ data: { defaultPageSize: pageSize } });
}

function onCacheBudgetChange(e: Event): void {
  const value = Number((e.target as HTMLInputElement).value);
  if (!Number.isFinite(value) || value < 8 || value > 1024) return;
  void patchSettings({ cache: { l2BudgetMb: value } });
}

function onOpLogRetentionChange(e: Event): void {
  const value = Number((e.target as HTMLInputElement).value);
  if (!Number.isFinite(value) || value < 1 || value > 365) return;
  void patchSettings({ advanced: { opLogRetentionDays: value } });
}

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
</script>

<template>
  <DialogFrame
    title="Settings"
    :width="780"
    :height="560"
    test-id="settings-dialog"
    close-test-id="settings-dialog-close"
    @close="emit('close')"
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
                :model-value="fontFamilyDraft"
                @input="onFontFamilyInput"
                @change="onFontFamilyChange"
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
                :style="{ fontFamily: fontFamilyDraft }"
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
                  min="9"
                  max="24"
                  size="md"
                  :model-value="String(settingsState.appearance.fontSize)"
                  @change="onFontSizeChange"
                />
              </div>
              <span class="helper-text">9–24 px</span>
            </label>

            <div class="field">
              <span>Row height</span>
              <div class="segmented">
                <button
                  type="button"
                  :class="{ active: settingsState.appearance.rowDensity === 'compact' }"
                  @click="setRowDensity('compact')"
                >
                  Compact · 22 px
                </button>
                <button
                  type="button"
                  :class="{ active: settingsState.appearance.rowDensity === 'comfortable' }"
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
                :checked="settingsState.appearance.wordWrap"
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
                :checked="settingsState.appearance.rowColoring"
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
                :value="settingsState.data.defaultPageSize"
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
                min="8"
                max="1024"
                size="md"
                data-testid="settings-cache-budget"
                :model-value="String(settingsState.cache.l2BudgetMb)"
                @change="onCacheBudgetChange"
              />
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
                min="1"
                max="365"
                size="md"
                data-testid="settings-oplog-retention"
                :model-value="String(settingsState.advanced.opLogRetentionDays)"
                @change="onOpLogRetentionChange"
              />
            </label>
            <p class="muted-note">Takes effect after restart.</p>
          </template>
      </section>
    </div>

    <template #footer>
      <span class="helper-text">Stored in <span class="mono">~/.kira-studio/kira.sqlite</span> · changes apply immediately</span>
      <span class="footer-actions">
        <AppButton kind="dialog" data-testid="settings-cancel" @click="onCancel">Cancel</AppButton>
        <AppButton
          kind="dialog"
          variant="primary"
          data-testid="settings-close"
          @click="emit('close')"
        >
          Done
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

.footer-actions {
  display: flex;
  gap: var(--kira-s-3);
  margin-left: auto;
}
</style>
