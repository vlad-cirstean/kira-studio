<script setup lang="ts">
import type {
  ConnectionFilter,
  ConnectionFilterInput,
  FilterNodeKind,
} from '@shared/domain/connection-filter';
import { computed, ref, watch } from 'vue';
import { connectionsState } from '../state/connections';
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

// Title identity (FiltersDialog.html: "Tree filters — prod-analytics") — reads the name off
// the store that already has it, same as ConnectionDialog.vue does; adds no new state.
const connectionName = computed(
  () => connectionsState.records.find((r) => r.id === filtersDialogState.connectionId)?.name ?? '',
);
</script>

<template>
  <div v-if="filtersDialogState.open" class="scrim" data-testid="filters-dialog" @click.self="closeFiltersDialog">
    <div class="dialog" role="dialog" aria-modal="true">
      <div class="dialog-title">
        <span class="icon-box muted"><Codicon name="filter" :size="14" /></span>
        <span>Tree filters<template v-if="connectionName"> — {{ connectionName }}</template></span>
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
        <!-- Rules run top to bottom, last match wins — the preview strip below is the running
             answer to "what will the tree actually show", so nobody has to evaluate the order
             by hand. -->
        <span class="help">
          Rules run top to bottom; the last matching rule wins. This never changes what a query
          returns — only what is listed on the left.
        </span>

        <div class="rule-list">
          <div v-for="(rule, index) in draft" :key="index" class="rule-row">
            <select v-model="rule.nodeKind" class="p-select bordered">
              <option v-for="(label, kind) in NODE_KIND_LABEL" :key="kind" :value="kind">{{ label }}</option>
            </select>
            <select v-model="rule.action" class="p-select bordered">
              <option value="hide">Hide</option>
              <option value="show">Show</option>
            </select>
            <div class="p-input md pattern-input-wrap">
              <input v-model="rule.pattern" type="text" class="pattern-input" placeholder="pg_*" />
            </div>
            <label class="regex-checkbox">
              <input v-model="rule.isRegex" type="checkbox" />
              Regex
            </label>
            <button type="button" class="p-iconbtn" aria-label="Delete rule" @click="removeRule(index)">
              <Codicon name="trash" :size="14" />
            </button>
            <span v-if="ruleError(rule)" class="field-error rule-error">{{ ruleError(rule) }}</span>
          </div>
        </div>

        <button type="button" class="p-btn add-rule" @click="addRule">
          <span class="icon-box"><Codicon name="add" :size="12" /></span>
          Add rule
        </button>

        <div class="p-strip note preview-strip">
          <span class="icon-box"><Codicon name="info" :size="14" /></span>
          <span>
            Hides <b>{{ preview.hidden }}</b> of <b>{{ preview.total }}</b> cached nodes. Nothing
            is deleted — removing a rule brings it straight back.
          </span>
        </div>
      </div>
      <div class="dialog-footer">
        <span class="help">Applies to <span class="mono">{{ connectionName }}</span> only</span>
        <span class="footer-actions p-push">
          <button type="button" class="p-dlgbtn" @click="closeFiltersDialog">Cancel</button>
          <button type="button" class="p-dlgbtn primary" @click="onSave">Save filters</button>
        </span>
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
}

.title-close:hover {
  background: var(--kira-hover);
  color: var(--kira-fg);
}

.dialog-body {
  flex: 1;
  overflow: auto;
  padding: var(--kira-s-5);
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-4);
}

.help {
  font-size: var(--kira-t-xs);
  color: var(--kira-fg-disabled);
  line-height: 1.5;
}

.mono {
  font-family: var(--kira-font-family);
}

.rule-list {
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-2);
}

.rule-row {
  display: flex;
  align-items: center;
  gap: var(--kira-s-2);
  flex-wrap: wrap;
}

.rule-row select {
  height: var(--kira-h-md);
}

.pattern-input-wrap {
  flex: 1;
  min-width: 100px;
}

.regex-checkbox {
  display: flex;
  align-items: center;
  gap: var(--kira-s-2);
  font-size: var(--kira-t-sm);
  color: var(--kira-fg-muted);
  white-space: nowrap;
  cursor: pointer;
}

.regex-checkbox input {
  width: 14px;
  height: 14px;
  accent-color: var(--kira-accent);
  cursor: pointer;
}

.field-error {
  color: var(--kira-error);
  font-size: var(--kira-t-xs);
}

.rule-error {
  width: 100%;
}

.add-rule {
  align-self: flex-start;
}

/* the live-consequence strip is boxed rather than full-bleed, since it sits inside the
   dialog body rather than spanning a whole view */
.preview-strip {
  align-self: stretch;
  border: var(--kira-border-width) solid var(--kira-border);
  border-radius: var(--kira-radius-sm);
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

.footer-actions {
  display: flex;
  gap: var(--kira-s-3);
}
</style>
