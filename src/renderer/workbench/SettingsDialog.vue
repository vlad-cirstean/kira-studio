<script setup lang="ts">
import type { RowDensity } from '@shared/settings';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { data } from '../bridge/data';
import { cacheStatsState } from '../state/cacheStats';
import { patchSettings, settingsState } from '../state/settings';
import Codicon from '../theme/Codicon.vue';

const PAGE_SIZES = [10, 100, 1000, 10000] as const;
// SettingsDialog.html's "Connection colours" swatch row (D18/tokens.css's --kira-conn-*) —
// display only here; a colour is assigned per connection, in ConnectionDialog.vue/ColorPicker.vue.
const CONN_COLORS = [
  'red',
  'orange',
  'amber',
  'olive',
  'green',
  'teal',
  'cyan',
  'blue',
  'indigo',
  'violet',
  'magenta',
  'grey',
] as const;

const emit = defineEmits<{ close: [] }>();

const sections = ['Appearance', 'Data', 'Cache', 'Advanced'] as const;
type Section = (typeof sections)[number];
const activeSection = ref<Section>('Appearance');

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
    emit('close');
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

function onFontFamilyChange(e: Event): void {
  void patchSettings({ appearance: { fontFamily: (e.target as HTMLInputElement).value } });
}

function onFontSizeChange(e: Event): void {
  const value = Number((e.target as HTMLInputElement).value);
  if (Number.isNaN(value)) return;
  void patchSettings({ appearance: { fontSize: value } });
}

function setRowDensity(density: RowDensity): void {
  void patchSettings({ appearance: { rowDensity: density } });
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

function onPrefetchChange(e: Event): void {
  void patchSettings({ data: { prefetch: (e.target as HTMLInputElement).checked } });
}

function onCountOnOpenChange(e: Event): void {
  void patchSettings({ data: { countOnOpen: (e.target as HTMLInputElement).checked } });
}

function onCacheBudgetChange(e: Event): void {
  const value = Number((e.target as HTMLInputElement).value);
  if (!Number.isFinite(value) || value < 8 || value > 1024) return;
  void patchSettings({ cache: { l2BudgetMb: value } });
}

function onEngineMemoryCapChange(e: Event): void {
  const value = Number((e.target as HTMLInputElement).value);
  if (!Number.isFinite(value) || value < 256 || value > 4096) return;
  void patchSettings({ advanced: { engineMemoryCapMb: value } });
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
  return `${(stats.l2Bytes / (1024 * 1024)).toFixed(1)} / ${(stats.l2BudgetBytes / (1024 * 1024)).toFixed(0)} MB`;
});

async function onClearCaches(): Promise<void> {
  await data.clearCaches();
}
</script>

<template>
  <div class="scrim" data-testid="settings-dialog" @click.self="emit('close')">
    <div ref="dialogRef" class="dialog" role="dialog" aria-modal="true" tabindex="-1">
      <div class="dialog-title">
        <span class="icon-box muted"><Codicon name="gear" :size="14" /></span>
        <span>Settings</span>
        <button
          type="button"
          class="title-close"
          aria-label="Close"
          data-testid="settings-dialog-close"
          @click="emit('close')"
        >
          <Codicon name="close" :size="14" />
        </button>
      </div>
      <div class="dialog-body">
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
              <div class="p-input md">
                <input
                  type="text"
                  list="kira-font-families"
                  :value="settingsState.appearance.fontFamily"
                  @input="onFontFamilyChange"
                />
              </div>
              <datalist id="kira-font-families">
                <option value="'SF Mono', Menlo, monospace" />
                <option value="Menlo, monospace" />
                <option value="Monaco, monospace" />
                <option value="'JetBrains Mono', monospace" />
              </datalist>
              <span class="helper-text">Grid cells, editors, anything that came out of a database.</span>
            </label>

            <label class="field">
              <span>Data font size</span>
              <div class="p-input md size-input">
                <input
                  type="number"
                  min="9"
                  max="24"
                  :value="settingsState.appearance.fontSize"
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

            <div class="sec-label">Connection colours</div>
            <div class="field">
              <span>Palette</span>
              <div class="swatches">
                <span
                  v-for="color in CONN_COLORS"
                  :key="color"
                  class="sw"
                  :style="{ background: `var(--kira-conn-${color})` }"
                />
              </div>
              <span class="helper-text">
                The twelve colours a connection can be given. Assigned per connection, in its
                dialog or from its context menu. Where it shows: the group rail in the tree, the
                rail on a tab, the cap on the view's toolbar, and the dot on an operations row.
              </span>
            </div>
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
            <label class="field checkbox">
              <input
                type="checkbox"
                data-testid="settings-prefetch"
                :checked="settingsState.data.prefetch"
                @change="onPrefetchChange"
              />
              <span>Prefetch next page</span>
            </label>
            <label class="field checkbox">
              <input
                type="checkbox"
                data-testid="settings-count-on-open"
                :checked="settingsState.data.countOnOpen"
                @change="onCountOnOpenChange"
              />
              <span>Count rows on tab open</span>
            </label>
          </template>

          <template v-else-if="activeSection === 'Cache'">
            <label class="field">
              <span>Result page cache budget (MB)</span>
              <div class="p-input md">
                <input
                  type="number"
                  min="8"
                  max="1024"
                  data-testid="settings-cache-budget"
                  :value="settingsState.cache.l2BudgetMb"
                  @change="onCacheBudgetChange"
                />
              </div>
            </label>
            <label class="field">
              <span>Current usage</span>
              <div class="p-input md">
                <input type="text" :value="cacheSizeLabel" disabled />
              </div>
            </label>
            <label class="field">
              <span>Hit rate</span>
              <div class="p-input md">
                <input type="text" :value="hitRateLabel" disabled />
              </div>
            </label>
            <button
              type="button"
              class="p-dlgbtn action-button"
              data-testid="settings-clear-caches"
              @click="onClearCaches"
            >
              Clear caches
            </button>
          </template>

          <template v-else>
            <label class="field">
              <span>Engine memory cap (MB)</span>
              <div class="p-input md">
                <input
                  type="number"
                  min="256"
                  max="4096"
                  data-testid="settings-engine-memory-cap"
                  :value="settingsState.advanced.engineMemoryCapMb"
                  @change="onEngineMemoryCapChange"
                />
              </div>
            </label>
            <label class="field">
              <span>Operation log retention (days)</span>
              <div class="p-input md">
                <input
                  type="number"
                  min="1"
                  max="365"
                  data-testid="settings-oplog-retention"
                  :value="settingsState.advanced.opLogRetentionDays"
                  @change="onOpLogRetentionChange"
                />
              </div>
            </label>
            <p class="muted-note">Takes effect after restart.</p>
          </template>
        </section>
      </div>

      <div class="dialog-footer">
        <span class="helper-text">Stored in <span class="mono">~/.kira-studio/kira.sqlite</span> · changes apply immediately</span>
        <button type="button" class="p-dlgbtn primary footer-close" data-testid="settings-close" @click="emit('close')">
          Done
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
  width: 780px;
  height: 560px;
  background: var(--kira-bg-elevated);
  border: var(--kira-border-width) solid var(--kira-border-strong);
  border-radius: var(--kira-radius-lg);
  box-shadow: var(--kira-shadow-dialog);
  display: flex;
  flex-direction: column;
  overflow: hidden;
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
  margin-left: auto;
}

.title-close:hover {
  background: var(--kira-hover);
  color: var(--kira-fg);
}

.dialog-body {
  flex: 1;
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

/* SettingsDialog.html's swatch row — display only, twelve hues at one lightness/chroma */
.swatches {
  display: flex;
  gap: var(--kira-s-2);
  align-items: center;
  height: var(--kira-h-md);
}

.sw {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dialog-footer {
  height: 46px;
  flex-shrink: 0;
  padding: 0 var(--kira-s-5);
  display: flex;
  align-items: center;
  gap: var(--kira-s-3);
  border-top: var(--kira-border-width) solid var(--kira-border);
}

.footer-close {
  margin-left: auto;
}
</style>
