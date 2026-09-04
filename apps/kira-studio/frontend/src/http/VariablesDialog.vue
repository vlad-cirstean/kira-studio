<script setup lang="ts">
import type { HttpVariable } from '@shared/domain/variables';
import { computed, reactive, watch } from 'vue';
import { connectionsState } from '../state/connections';
import DialogFrame from '../theme/primitives/DialogFrame.vue';
import MessageStrip from '../theme/primitives/MessageStrip.vue';
import {
  closeVariablesDialog,
  deleteVariable,
  isDuplicateName,
  revealedValues,
  revealVariable,
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
// VariablesRepo.Upsert — one call per edit, not one per keystroke. Ticking the secret checkbox is
// its own discrete commit (D9): it does not wait for a blur.
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

// D5/D9: once a reveal lands the plaintext in revealedValues, fold it into that row's own draft —
// VariableRow.vue's "not yet revealed" check is exactly `isSecret && value === ''`, so this is
// what makes a freshly-revealed row render unmasked and editable.
watch(revealedValues, (values) => {
  for (const [id, value] of Object.entries(values)) {
    const draft = drafts[id];
    if (draft && draft.value === '') draft.value = value;
  }
});

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
    isSecret: trailingDraft.isSecret,
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

/** Commits whatever the draft currently holds — the trailing row only if it has a name yet. */
async function commitDraft(id: string): Promise<void> {
  const draft = draftFor(id);
  if (id === '') {
    if (draft.name.trim() === '') return; // nothing typed yet — not a row to create
    const { value, isSecret } = draft;
    const name = draft.name.trim();
    trailingDraft.name = '';
    trailingDraft.value = '';
    trailingDraft.isSecret = false;
    await upsertVariable({ id: '', name, value, isSecret });
    return;
  }
  const row = variablesDialogState.rows.find((r) => r.id === id);
  if (!row) return;
  if (draft.name.trim() === '') {
    draft.name = row.name; // a name can't be blanked out — restore it
    return;
  }
  await upsertVariable({
    id,
    name: draft.name.trim(),
    value: draft.value,
    isSecret: draft.isSecret,
  });
}

async function onBlur(id: string): Promise<void> {
  const draft = draftFor(id);
  if (id === '') {
    await commitDraft(id);
    return;
  }
  const row = variablesDialogState.rows.find((r) => r.id === id);
  if (!row) return;
  if (draft.name.trim() === '') {
    draft.name = row.name;
    return;
  }
  if (draft.name === row.name && draft.value === row.value && draft.isSecret === row.isSecret)
    return;
  await commitDraft(id);
}

// D9: turning a secret ON needs nothing extra — the draft's own value is already the plaintext
// the user just typed (or '' for a still-empty trailing row). Turning a secret OFF needs the
// *real* plaintext first, which is itself a reveal (D9's own line: "turning a secret into visible
// text"), gated exactly like the eye button.
async function onUpdateSecret(id: string, checked: boolean): Promise<void> {
  const draft = draftFor(id);
  if (checked) {
    draft.isSecret = true;
    await commitDraft(id);
    return;
  }
  if (id !== '' && revealedValues[id] === undefined) {
    await revealVariable(id, false);
  }
  if (id !== '') {
    const value = revealedValues[id];
    if (value === undefined) return; // cancelled, unavailable, or errored — stays secret
    draft.value = value;
  }
  draft.isSecret = false;
  await commitDraft(id);
}

function onReveal(id: string): void {
  void revealVariable(id, false);
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
      <MessageStrip v-if="variablesDialogState.error" tone="err" data-testid="variables-error">
        {{ variablesDialogState.error }}
      </MessageStrip>
      <MessageStrip
        v-else-if="connectionsState.secretStorage && !connectionsState.secretStorage.available"
        tone="warn"
        data-testid="variables-secrets-unavailable"
      >
        {{ connectionsState.secretStorage.reason }}
      </MessageStrip>
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
        :secrets-unavailable="!!connectionsState.secretStorage && !connectionsState.secretStorage.available"
        @update:name="onUpdateName(row.id, $event)"
        @update:value="onUpdateValue(row.id, $event)"
        @update:is-secret="onUpdateSecret(row.id, $event)"
        @blur="onBlur(row.id)"
        @remove="onRemove(row.id)"
        @reveal="onReveal(row.id)"
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
