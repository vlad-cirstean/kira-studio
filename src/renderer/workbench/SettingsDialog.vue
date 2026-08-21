<script setup lang="ts">
import type { RowDensity } from '@shared/settings';
import { onMounted, onUnmounted, ref } from 'vue';
import Codicon from '../theme/Codicon.vue';
import { patchSettings, settingsState } from './state/settings';

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
</script>

<template>
  <div class="scrim" data-testid="settings-dialog" @click.self="emit('close')">
    <div ref="dialogRef" class="dialog" role="dialog" aria-modal="true" tabindex="-1">
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
              <input type="number" value="100" disabled />
            </label>
            <label class="field checkbox">
              <input type="checkbox" checked disabled />
              <span>Prefetch next page</span>
            </label>
            <label class="field checkbox">
              <input type="checkbox" disabled />
              <span>Count rows on tab open</span>
            </label>
            <p class="muted-note">Available once data views land.</p>
          </template>

          <template v-else-if="activeSection === 'Cache'">
            <label class="field">
              <span>Result page cache budget</span>
              <input type="text" value="64 MB" disabled />
            </label>
            <label class="field">
              <span>Hit rate</span>
              <input type="text" value="—" disabled />
            </label>
            <button type="button" disabled>Clear caches</button>
            <p class="muted-note">Available once data views land.</p>
          </template>

          <template v-else>
            <label class="field">
              <span>Engine memory cap</span>
              <input type="text" value="512 MB" disabled />
            </label>
            <label class="field">
              <span>Operation log retention</span>
              <input type="text" value="30 days" disabled />
            </label>
            <p class="muted-note">Available once data views land.</p>
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
  border-radius: var(--kira-radius);
  box-shadow: var(--kira-shadow);
  display: flex;
  flex-direction: column;
  overflow: hidden;
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
  border-radius: var(--kira-radius);
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
.field input[type='number'] {
  background: var(--kira-bg-input);
  border: var(--kira-border-width) solid var(--kira-border);
  border-radius: var(--kira-radius);
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
  border-radius: var(--kira-radius);
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
  border-radius: var(--kira-radius);
  border: var(--kira-border-width) solid var(--kira-border);
  background: var(--kira-bg-input);
  color: var(--kira-fg);
  cursor: pointer;
}
</style>
