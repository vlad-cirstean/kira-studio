<script setup lang="ts">
import type { HttpVariable } from '@shared/domain/variables';
import { computed, reactive, watch } from 'vue';
import DialogFrame from '../theme/primitives/DialogFrame.vue';
import {
  closeVariablesDialog,
  deleteVariable,
  isDuplicateName,
  upsertVariable,
  variablesDialogState,
} from './state/variables';
import VariableRow from './VariableRow.vue';

// P5 D11: one scope's variable list — the collection row's "Variables…" context-menu item, the
// environments dialog's per-row "Edit variables…", and a palette entry (registered in App.vue's
// mount, mirroring SaveRequestDialog.vue's own pattern) all open this same dialog, differing only
// in the (scope, ownerId, title) openVariablesDialog was called with.
//
// D12's own reimplementation of FieldRowsTable.vue's trailing-blank-row UX — that primitive lives
// under views/grid/, which http/** may not import, and this row differs by three columns anyway.
// Unlike FieldRowsTable's purely-local array, each row here is a persisted server row: typing
// updates a local draft immediately (so the field never stutters), and a blur commits it through
// VariablesRepo.Upsert — one call per edit, not one per keystroke.
interface Draft {
  name: string;
  value: string;
  isSecret: boolean;
}

const drafts = reactive<Record<string, Draft>>({});
const trailingDraft = reactive<Draft>({ name: '', value: '', isSecret: false });

function syncDrafts(): void {
  for (const key of Object.keys(drafts)) delete drafts[key];
  for (const row of variablesDialogState.rows) {
    drafts[row.id] = { name: row.name, value: row.value, isSecret: row.isSecret };
  }
  trailingDraft.name = '';
  trailingDraft.value = '';
  trailingDraft.isSecret = false;
}
watch(() => variablesDialogState.rows, syncDrafts, { immediate: true });

const displayRows = computed<HttpVariable[]>(() => {
  const real = variablesDialogState.rows.map((row) => {
    const draft = drafts[row.id] ?? { name: row.name, value: row.value, isSecret: row.isSecret };
    return { ...row, name: draft.name, value: draft.value, isSecret: draft.isSecret };
  });
  const trailing: HttpVariable = {
    id: '',
    scope: variablesDialogState.scope ?? 'collection',
    ownerId: variablesDialogState.ownerId,
    name: trailingDraft.name,
    value: trailingDraft.value,
    isSecret: false,
    sortOrder: real.length,
  };
  return [...real, trailing];
});

function draftFor(id: string): Draft {
  if (id === '') return trailingDraft;
  if (!drafts[id]) drafts[id] = { name: '', value: '', isSecret: false };
  return drafts[id];
}

function onUpdateName(id: string, value: string): void {
  draftFor(id).name = value;
}
function onUpdateValue(id: string, value: string): void {
  draftFor(id).value = value;
}

async function onBlur(id: string): Promise<void> {
  const draft = draftFor(id);
  if (id === '') {
    if (draft.name.trim() === '') return; // nothing typed yet — not a row to create
    const name = draft.name.trim();
    trailingDraft.name = '';
    trailingDraft.value = '';
    await upsertVariable({ id: '', name, value: draft.value, isSecret: false });
    return;
  }
  const row = variablesDialogState.rows.find((r) => r.id === id);
  if (!row) return;
  if (draft.name.trim() === '') {
    draft.name = row.name; // a name can't be blanked out — restore it
    return;
  }
  if (draft.name === row.name && draft.value === row.value && draft.isSecret === row.isSecret)
    return;
  await upsertVariable({
    id,
    name: draft.name.trim(),
    value: draft.value,
    isSecret: draft.isSecret,
  });
}

async function onRemove(id: string): Promise<void> {
  if (id === '') return;
  await deleteVariable(id);
}

function close(): void {
  closeVariablesDialog();
}
</script>

<template>
  <DialogFrame
    :title="variablesDialogState.title"
    :width="720"
    max-height="80vh"
    test-id="variables-dialog"
    close-test-id="variables-dialog-close"
    @close="close"
  >
    <div class="variables-dialog-body">
      <div class="header-row">
        <span class="cell">Name</span>
        <span class="cell">Value</span>
      </div>
      <VariableRow
        v-for="(row, i) in displayRows"
        :key="row.id || 'trailing'"
        :row="row"
        :duplicate="isDuplicateName(displayRows, i)"
        :trailing="row.id === ''"
        @update:name="onUpdateName(row.id, $event)"
        @update:value="onUpdateValue(row.id, $event)"
        @blur="onBlur(row.id)"
        @remove="onRemove(row.id)"
      />
    </div>
  </DialogFrame>
</template>

<style scoped>
.variables-dialog-body {
  display: flex;
  flex-direction: column;
}

.header-row {
  display: flex;
  gap: var(--kira-s-2);
  padding: var(--kira-s-2) var(--kira-s-3);
  color: var(--kira-fg-dim);
  font-size: var(--kira-t-sm);
  border-bottom: var(--kira-border-width) solid var(--kira-border);
}

.header-row .cell {
  flex: 1;
}
</style>
