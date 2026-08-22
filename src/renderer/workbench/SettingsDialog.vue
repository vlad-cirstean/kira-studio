<script setup lang="ts">
import type { RowDensity } from '@shared/settings';
import { onMounted, onUnmounted, reactive, ref } from 'vue';
import Codicon from '../theme/Codicon.vue';
import { applyAppearance, patchSettings, settingsState } from './state/settings';

const emit = defineEmits<{ close: [] }>();

const sections = ['Appearance', 'Data', 'Cache', 'Advanced'] as const;
type Section = (typeof sections)[number];
const activeSection = ref<Section>('Appearance');

const dialogRef = ref<HTMLElement | null>(null);

// Draft-based editing: changes preview live but are only persisted on Save. Closing (or Escape /
// scrim) restores the values that were persisted when the dialog opened.
const saved = { ...settingsState.appearance };
const draft = reactive({ ...settingsState.appearance });

function preview(): void {
  Object.assign(settingsState.appearance, draft);
  applyAppearance();
}

async function onSave(): Promise<void> {
  await patchSettings({ appearance: { ...draft } });
  emit('close');
}

function onClose(): void {
  Object.assign(settingsState.appearance, saved);
  applyAppearance();
  emit('close');
}

function setRowDensity(density: RowDensity): void {
  draft.rowDensity = density;
  preview();
}

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
    onClose();
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
</script>

<template>
  <div class="scrim" data-testid="settings-dialog" @click.self="onClose">
    <div ref="dialogRef" class="dialog" role="dialog" aria-modal="true" tabindex="-1">
      <div class="header">
        <span>Settings</span>
        <button
          type="button"
          class="header-close"
          aria-label="Close settings"
          @click="onClose"
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
                v-model="draft.fontFamily"
                @input="preview"
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
                v-model.number="draft.fontSize"
                @change="preview"
              />
            </label>

            <div class="field">
              <span>Row density</span>
              <div class="segmented">
                <button
                  type="button"
                  :class="{ active: draft.rowDensity === 'compact' }"
                  @click="setRowDensity('compact')"
                >
                  Compact
                </button>
                <button
                  type="button"
                  :class="{ active: draft.rowDensity === 'comfortable' }"
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
            <button type="button" class="secondary-button" disabled>Clear caches</button>
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
        <button
          type="button"
          class="footer-close"
          data-testid="settings-close"
          @click="onClose"
        >
          <Codicon name="close" :size="12" />
          Close
        </button>
        <button type="button" class="footer-save" data-testid="settings-save" @click="onSave">
          Save
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
  border-radius: 8px;
  box-shadow: var(--kira-shadow);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.header {
  height: 36px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  border-bottom: var(--kira-border-width) solid var(--kira-border);
  font-size: 13px;
  font-weight: 600;
}

.header-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  border-radius: var(--kira-radius);
  color: var(--kira-fg-muted);
  cursor: pointer;
}

.header-close:hover {
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
  padding: 4px;
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
  font-size: 12px;
}

.section-item:hover {
  background: var(--kira-hover);
  color: var(--kira-fg);
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
.field input[type='checkbox'] {
  background: var(--kira-bg-input);
  border: var(--kira-border-width) solid var(--kira-border-strong);
  border-radius: var(--kira-radius);
  color: var(--kira-fg);
  padding: 4px 6px;
  outline: none;
}

.field input[type='text']:focus,
.field input[type='number']:focus {
  border-color: var(--kira-focus);
}

.field input[disabled] {
  color: var(--kira-fg-disabled);
}

.segmented {
  display: flex;
  gap: 2px;
}

.segmented button {
  flex: 1;
  padding: 4px 8px;
  border-radius: var(--kira-radius);
  border: var(--kira-border-width) solid var(--kira-border-strong);
  background: var(--kira-bg-input);
  color: var(--kira-fg-muted);
  cursor: pointer;
  font-size: 12px;
}

.segmented button.active {
  background: var(--kira-select);
  color: var(--kira-fg);
}

.secondary-button {
  align-self: flex-start;
  padding: 4px 10px;
  border-radius: var(--kira-radius);
  border: var(--kira-border-width) solid var(--kira-border-strong);
  background: var(--kira-bg-input);
  color: var(--kira-fg);
  cursor: pointer;
  font-size: 12px;
}

.muted-note {
  color: var(--kira-fg-disabled);
  font-size: 11px;
}

.dialog-footer {
  flex-shrink: 0;
  border-top: var(--kira-border-width) solid var(--kira-border);
  padding: 8px 12px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.footer-close {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: var(--kira-radius);
  border: var(--kira-border-width) solid var(--kira-border-strong);
  background: var(--kira-bg-input);
  color: var(--kira-fg);
  cursor: pointer;
  font-size: 12px;
}

.footer-close:hover {
  background: var(--kira-hover);
}

.footer-save {
  padding: 4px 10px;
  border-radius: var(--kira-radius);
  border: var(--kira-border-width) solid var(--kira-accent);
  background: var(--kira-accent);
  color: var(--kira-accent-fg);
  cursor: pointer;
  font-size: 12px;
}

.footer-save:hover {
  filter: brightness(1.1);
}
</style>
