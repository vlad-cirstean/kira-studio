<script setup lang="ts">
import type { RowDensity } from '@shared/settings';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { data } from '../bridge/data';
import { cacheStatsState } from '../state/cacheStats';
import { patchSettings, settingsState } from '../state/settings';
import Codicon from '../theme/Codicon.vue';

const PAGE_SIZES = [10, 100, 1000, 10000] as const;

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
            <label class="field">
              <span>Font family</span>
              <input
                type="text"
                list="kira-font-families"
                :value="settingsState.appearance.fontFamily"
                @change="onFontFamilyChange"
              />
              <datalist id="kira-font-families">
                <option value="'SF Mono', Menlo, monospace" />
                <option value="Menlo, monospace" />
                <option value="Monaco, monospace" />
                <option value="'JetBrains Mono', monospace" />
              </datalist>
            </label>

            <label class="field">
              <span>Font size</span>
              <input
                type="number"
                min="9"
                max="24"
                :value="settingsState.appearance.fontSize"
                @change="onFontSizeChange"
              />
            </label>

            <div class="field">
              <span>Row density</span>
              <div class="segmented">
                <button
                  type="button"
                  :class="{ active: settingsState.appearance.rowDensity === 'compact' }"
                  @click="setRowDensity('compact')"
                >
                  Compact
                </button>
                <button
                  type="button"
                  :class="{ active: settingsState.appearance.rowDensity === 'comfortable' }"
                  @click="setRowDensity('comfortable')"
                >
                  Comfortable
                </button>
              </div>
            </div>
          </template>

          <template v-else-if="activeSection === 'Data'">
            <label class="field">
              <span>Default page size</span>
              <select
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
              <input
                type="number"
                min="8"
                max="1024"
                data-testid="settings-cache-budget"
                :value="settingsState.cache.l2BudgetMb"
                @change="onCacheBudgetChange"
              />
            </label>
            <label class="field">
              <span>Current usage</span>
              <input type="text" :value="cacheSizeLabel" disabled />
            </label>
            <label class="field">
              <span>Hit rate</span>
              <input type="text" :value="hitRateLabel" disabled />
            </label>
            <button
              type="button"
              class="action-button"
              data-testid="settings-clear-caches"
              @click="onClearCaches"
            >
              Clear caches
            </button>
          </template>

          <template v-else>
            <label class="field">
              <span>Engine memory cap (MB)</span>
              <input
                type="number"
                min="256"
                max="4096"
                data-testid="settings-engine-memory-cap"
                :value="settingsState.advanced.engineMemoryCapMb"
                @change="onEngineMemoryCapChange"
              />
            </label>
            <label class="field">
              <span>Operation log retention (days)</span>
              <input
                type="number"
                min="1"
                max="365"
                data-testid="settings-oplog-retention"
                :value="settingsState.advanced.opLogRetentionDays"
                @change="onOpLogRetentionChange"
              />
            </label>
            <p class="muted-note">Takes effect after restart.</p>
          </template>
        </section>
      </div>

      <div class="dialog-footer">
        <button type="button" data-testid="settings-close" @click="emit('close')">
          <Codicon name="close" />
          Close
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
  width: 560px;
  height: 400px;
  background: var(--kira-bg-elevated);
  border: var(--kira-border-width) solid var(--kira-border-strong);
  border-radius: var(--kira-radius-lg);
  box-shadow: var(--kira-shadow-dialog);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.dialog-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 8px 8px 16px;
  border-bottom: var(--kira-border-width) solid var(--kira-border);
  font-size: 12px;
  font-weight: 600;
  flex-shrink: 0;
}

.title-close {
  width: 20px;
  height: 20px;
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
  display: flex;
  min-height: 0;
}

.section-list {
  width: 140px;
  flex-shrink: 0;
  border-right: var(--kira-border-width) solid var(--kira-border);
  display: flex;
  flex-direction: column;
  padding: var(--kira-gap);
  gap: 2px;
}

.section-item {
  text-align: left;
  padding: 4px 8px;
  border-radius: var(--kira-radius-sm);
  background: transparent;
  border: none;
  color: var(--kira-fg-muted);
  cursor: pointer;
}

.section-item.active {
  background: var(--kira-select);
  color: var(--kira-fg);
}

.section-pane {
  flex: 1;
  padding: 12px 16px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}

.field.checkbox {
  flex-direction: row;
  align-items: center;
  gap: 6px;
}

.field input[type='text'],
.field input[type='number'],
.field select {
  background: var(--kira-bg-input);
  border: var(--kira-border-width) solid var(--kira-border);
  border-radius: var(--kira-radius-sm);
  color: var(--kira-fg);
  padding: 4px 6px;
}

.segmented {
  display: flex;
  gap: 2px;
}

.segmented button {
  flex: 1;
  padding: 4px 8px;
  border-radius: var(--kira-radius-sm);
  border: var(--kira-border-width) solid var(--kira-border);
  background: var(--kira-bg-input);
  color: var(--kira-fg-muted);
  cursor: pointer;
}

.segmented button.active {
  background: var(--kira-select);
  color: var(--kira-fg);
}

.muted-note {
  color: var(--kira-fg-disabled);
  font-size: 11px;
}

.action-button {
  align-self: flex-start;
  padding: 4px 10px;
  border-radius: var(--kira-radius-sm);
  border: var(--kira-border-width) solid var(--kira-border);
  background: var(--kira-bg-input);
  color: var(--kira-fg);
  cursor: pointer;
}

.action-button:hover {
  background: var(--kira-hover);
}

.dialog-footer {
  border-top: var(--kira-border-width) solid var(--kira-border);
  padding: 8px 12px;
  display: flex;
  justify-content: flex-end;
}

.dialog-footer button {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: var(--kira-radius-sm);
  border: var(--kira-border-width) solid var(--kira-border);
  background: var(--kira-bg-input);
  color: var(--kira-fg);
  cursor: pointer;
}
</style>
