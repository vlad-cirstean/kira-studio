<script setup lang="ts">
import { computed } from 'vue';
import Codicon from '../theme/Codicon.vue';
import { countFiltered } from './filter';
import {
  cachedNodesFor,
  closeFiltersDialog,
  type FilterRuleDraft,
  filtersDialogState,
  saveFilters,
} from './state/tree';

// §8.3 filters dialog. Edits a list of hide/show rules; the live preview uses the same filter.ts
// as render, so the dialog cannot disagree with the tree.

const emit = defineEmits<{ close: [] }>();

const NODE_KINDS: Array<{ value: FilterRuleDraft['nodeKind']; label: string }> = [
  { value: 'database', label: 'Database' },
  { value: 'schema', label: 'Schema' },
  { value: 'table', label: 'Table' },
];

const preview = computed(() => {
  const connectionId = filtersDialogState.connectionId;
  if (!connectionId) return { total: 0, hidden: 0 };
  return countFiltered(cachedNodesFor(connectionId), filtersDialogState.rules);
});

function addRule(): void {
  filtersDialogState.rules.push({
    nodeKind: 'table',
    action: 'hide',
    pattern: '',
    isRegex: false,
  });
}

function removeRule(index: number): void {
  filtersDialogState.rules.splice(index, 1);
}

function onClose(): void {
  closeFiltersDialog();
  emit('close');
}

function onSave(): void {
  void saveFilters().then(() => emit('close'));
}
</script>

<template>
  <div class="scrim" data-testid="filters-dialog" @click.self="onClose">
    <div class="dialog" role="dialog" aria-modal="true">
      <div class="dialog-body">
        <div class="preview muted-note">
          {{ preview.hidden ? `Hides ${preview.hidden} of ${preview.total} cached nodes.` : 'No nodes hidden.' }}
        </div>

        <div v-if="filtersDialogState.rules.length === 0" class="muted-note">No rules yet.</div>

        <div v-for="(rule, i) in filtersDialogState.rules" :key="i" class="rule-row">
          <select v-model="rule.nodeKind">
            <option v-for="kind in NODE_KINDS" :key="kind.value" :value="kind.value">
              {{ kind.label }}
            </option>
          </select>
          <select v-model="rule.action">
            <option value="hide">Hide</option>
            <option value="show">Show</option>
          </select>
          <input v-model="rule.pattern" type="text" placeholder="pattern" />
          <label class="checkbox">
            <input v-model="rule.isRegex" type="checkbox" />
            <span>Regex</span>
          </label>
          <button type="button" aria-label="Remove rule" @click="removeRule(i)">
            <Codicon name="trash" :size="14" />
          </button>
        </div>

        <button type="button" class="add-rule" data-testid="filters-add-rule" @click="addRule">
          <Codicon name="add" :size="14" />
          Add rule
        </button>
      </div>

      <div class="dialog-footer">
        <button type="button" data-testid="filters-cancel" @click="onClose">Cancel</button>
        <button type="button" class="primary" data-testid="filters-save" @click="onSave">Save</button>
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
  width: 480px;
  background: var(--kira-bg-elevated);
  border: var(--kira-border-width) solid var(--kira-border-strong);
  border-radius: var(--kira-radius);
  box-shadow: var(--kira-shadow);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.dialog-body {
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 60vh;
  overflow: auto;
}

.preview {
  font-size: 11px;
}

.rule-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.rule-row select,
.rule-row input[type='text'] {
  background: var(--kira-bg-input);
  border: var(--kira-border-width) solid var(--kira-border);
  border-radius: var(--kira-radius);
  color: var(--kira-fg);
  padding: 3px 6px;
  font-size: 12px;
}

.rule-row input[type='text'] {
  flex: 1;
}

.checkbox {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--kira-fg-muted);
  white-space: nowrap;
}

.rule-row button {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 3px;
  border: none;
  background: transparent;
  color: var(--kira-fg-muted);
  cursor: pointer;
}

.rule-row button:hover {
  color: var(--kira-error);
}

.add-rule {
  display: flex;
  align-items: center;
  gap: 4px;
  align-self: flex-start;
  padding: 3px 8px;
  border-radius: var(--kira-radius);
  border: var(--kira-border-width) solid var(--kira-border);
  background: var(--kira-bg-input);
  color: var(--kira-fg);
  cursor: pointer;
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
  gap: 6px;
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

.dialog-footer button.primary {
  background: var(--kira-accent);
  border-color: var(--kira-accent);
  color: var(--kira-accent-fg);
}
</style>
