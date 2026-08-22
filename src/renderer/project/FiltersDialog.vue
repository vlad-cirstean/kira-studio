<script setup lang="ts">
import type {
  ConnectionFilter,
  ConnectionFilterInput,
  FilterNodeKind,
} from '@shared/domain/connection-filter';
import { computed, ref, watch } from 'vue';
import Codicon from '../theme/Codicon.vue';
import { evaluate } from './filter';
import { closeFiltersDialog, filtersDialogState, saveFilters, treeState } from './state/tree';

const NODE_KIND_LABEL: Record<FilterNodeKind, string> = {
  database: 'Database',
  schema: 'Schema',
  table: 'Table',
};

const draft = ref<ConnectionFilterInput[]>([]);

watch(
  () => filtersDialogState.connectionId,
  (connectionId) => {
    if (!connectionId) return;
    const existing = treeState.filters[connectionId] ?? [];
    draft.value = existing.map((r) => ({
      nodeKind: r.nodeKind,
      pattern: r.pattern,
      isRegex: r.isRegex,
      action: r.action,
    }));
  },
  { immediate: true },
);

function addRule(): void {
  draft.value.push({ nodeKind: 'schema', pattern: '', isRegex: false, action: 'hide' });
}

function removeRule(index: number): void {
  draft.value.splice(index, 1);
}

function ruleError(rule: ConnectionFilterInput): string | null {
  if (!rule.isRegex || !rule.pattern) return null;
  try {
    new RegExp(rule.pattern);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'Invalid pattern';
  }
}

// A live preview computed from the same filter.ts evaluate() the tree itself uses, so this
// dialog cannot disagree with what the tree will actually show.
const preview = computed(() => {
  const connectionId = filtersDialogState.connectionId;
  if (!connectionId) return { hidden: 0, total: 0 };
  const prefix = `${connectionId}|`;
  const evalRules: ConnectionFilter[] = draft.value.map((r) => ({
    ...r,
    id: '',
    connectionId: '',
  }));
  let hidden = 0;
  let total = 0;
  for (const [key, nodes] of Object.entries(treeState.children)) {
    if (!key.startsWith(prefix)) continue;
    for (const node of nodes) {
      total += 1;
      if (!evaluate(node, evalRules)) hidden += 1;
    }
  }
  return { hidden, total };
});

async function onSave(): Promise<void> {
  const connectionId = filtersDialogState.connectionId;
  if (!connectionId) return;
  await saveFilters(
    connectionId,
    draft.value.filter((r) => r.pattern.trim() !== ''),
  );
  closeFiltersDialog();
}
</script>

<template>
  <div v-if="filtersDialogState.open" class="scrim" data-testid="filters-dialog" @click.self="closeFiltersDialog">
    <div class="dialog" role="dialog" aria-modal="true">
      <div class="dialog-title">
        <span>Filters</span>
        <button
          type="button"
          class="title-close"
          aria-label="Close"
          data-testid="filters-dialog-close"
          @click="closeFiltersDialog"
        >
          <Codicon name="close" :size="14" />
        </button>
      </div>
      <div class="dialog-body">
        <div v-for="(rule, index) in draft" :key="index" class="rule-row">
          <select v-model="rule.nodeKind">
            <option v-for="(label, kind) in NODE_KIND_LABEL" :key="kind" :value="kind">{{ label }}</option>
          </select>
          <select v-model="rule.action">
            <option value="hide">Hide</option>
            <option value="show">Show</option>
          </select>
          <input v-model="rule.pattern" type="text" class="pattern-input" placeholder="pg_*" />
          <label class="regex-checkbox">
            <input v-model="rule.isRegex" type="checkbox" />
            Regex
          </label>
          <button type="button" class="icon-button" aria-label="Delete rule" @click="removeRule(index)">
            <Codicon name="trash" :size="14" />
          </button>
          <span v-if="ruleError(rule)" class="rule-error">{{ ruleError(rule) }}</span>
        </div>

        <button type="button" class="add-rule" @click="addRule">
          <Codicon name="add" :size="12" />
          Add rule
        </button>

        <p class="preview-line">hides {{ preview.hidden }} of {{ preview.total }} cached nodes</p>
      </div>
      <div class="dialog-footer">
        <button type="button" @click="closeFiltersDialog">Cancel</button>
        <button type="button" @click="onSave">Save</button>
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
  width: 460px;
  max-height: 70vh;
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
  overflow: auto;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 12px;
}

.rule-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.rule-row select,
.rule-row input[type='text'] {
  background: var(--kira-bg-input);
  border: var(--kira-border-width) solid var(--kira-border);
  border-radius: var(--kira-radius-sm);
  color: var(--kira-fg);
  padding: 3px 5px;
  font-size: 12px;
}

.pattern-input {
  flex: 1;
  min-width: 100px;
}

.regex-checkbox {
  display: flex;
  align-items: center;
  gap: 3px;
  color: var(--kira-fg-muted);
  white-space: nowrap;
}

.icon-button {
  background: transparent;
  border: none;
  color: var(--kira-fg-muted);
  cursor: pointer;
  padding: 2px;
}

.rule-error {
  color: var(--kira-error);
  font-size: 11px;
  width: 100%;
}

.add-rule {
  align-self: flex-start;
  display: flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: none;
  color: var(--kira-accent);
  cursor: pointer;
  padding: 2px 0;
  font-size: 12px;
}

.preview-line {
  color: var(--kira-fg-muted);
  font-size: 11px;
}

.dialog-footer {
  border-top: var(--kira-border-width) solid var(--kira-border);
  padding: 8px 12px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.dialog-footer button {
  padding: 4px 10px;
  border-radius: var(--kira-radius-sm);
  border: var(--kira-border-width) solid var(--kira-border);
  background: var(--kira-bg-input);
  color: var(--kira-fg);
  cursor: pointer;
}

.dialog-footer button:last-child {
  background: var(--kira-accent);
  border-color: var(--kira-accent);
  color: var(--kira-accent-fg);
}
</style>
