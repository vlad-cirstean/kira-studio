<script setup lang="ts">
import type { ApiVariable } from '@shared/domain/variables';
import { computed, reactive, ref, watch } from 'vue';
import { connectionsState } from '../state/connections';
import AppButton from '../theme/primitives/AppButton.vue';
import DialogFrame from '../theme/primitives/DialogFrame.vue';
import MessageStrip from '../theme/primitives/MessageStrip.vue';
import PanelSearchBox from '../theme/primitives/PanelSearchBox.vue';
import {
  closeVariablesDialog,
  deleteVariable,
  isDuplicateName,
  reorderVariables,
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
  description: string;
}

const drafts = reactive<Record<string, Draft>>({});
const trailingDraft = reactive<Draft>({ name: '', value: '', isSecret: false, description: '' });

// D14: the drag-reorderable display order, seeded from the server's own sort_order every time the
// list reloads (ColumnsMenu.vue's own precedent, adapted from a purely-local array to one that
// commits through Reorder on drop rather than only on dialog close).
const order = ref<string[]>([]);

function syncDrafts(): void {
  for (const key of Object.keys(drafts)) delete drafts[key];
  for (const row of variablesDialogState.rows) {
    drafts[row.id] = {
      name: row.name,
      value: row.value,
      isSecret: row.isSecret,
      description: row.description,
    };
  }
  trailingDraft.name = '';
  trailingDraft.value = '';
  trailingDraft.isSecret = false;
  trailingDraft.description = '';
  order.value = variablesDialogState.rows.map((row) => row.id);
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

// P16 D14/§5: the filter box's own state — matches the row's `name` and nothing else. Not a
// convenience choice: matching on `value` would turn the box into an oracle a user could type a
// guess into and read the answer off whether a (masked, until revealed) secret row appeared. See
// §5 of the P16 plan for the full analysis.
const filterQuery = ref('');
const isFiltered = computed(() => filterQuery.value.trim() !== '');

// The full, unfiltered real-row list (drafts folded in) — kept separate from `displayRows` so
// duplicate-name detection (below) and every write path still reason about every row, not just
// the currently-visible ones.
const allRealRows = computed<ApiVariable[]>(() => {
  const byId = new Map(variablesDialogState.rows.map((row) => [row.id, row]));
  return order.value.flatMap((id) => {
    const row = byId.get(id);
    if (!row) return [];
    const draft = drafts[id] ?? {
      name: row.name,
      value: row.value,
      isSecret: row.isSecret,
      description: row.description,
    };
    return [
      {
        ...row,
        name: draft.name,
        value: draft.value,
        isSecret: draft.isSecret,
        description: draft.description,
      },
    ];
  });
});

const trailingRow = computed<ApiVariable>(() => ({
  id: '',
  scope: variablesDialogState.scope ?? 'collection',
  ownerId: variablesDialogState.ownerId,
  name: trailingDraft.name,
  value: trailingDraft.value,
  isSecret: trailingDraft.isSecret,
  description: trailingDraft.description,
  sortOrder: allRealRows.value.length,
}));

// The trailing blank row is never filtered — it is the add affordance, not data, and hiding it
// would make a filtered list un-appendable (F11/D13's own rule, applied here too).
const displayRows = computed<ApiVariable[]>(() => {
  const q = filterQuery.value.trim().toLowerCase();
  const real = q
    ? allRealRows.value.filter((row) => row.name.toLowerCase().includes(q))
    : allRealRows.value;
  return [...real, trailingRow.value];
});

// Duplicate-name detection against the full (unfiltered) list — a filter must not hide a real
// duplicate-name warning just because the other same-named row happens not to match the filter.
function duplicateFor(row: ApiVariable): boolean {
  const full = [...allRealRows.value, trailingRow.value];
  const idx = row.id === '' ? full.length - 1 : allRealRows.value.findIndex((r) => r.id === row.id);
  if (idx === -1) return false;
  return isDuplicateName(full, idx);
}

function draftFor(id: string): Draft {
  if (id === '') return trailingDraft;
  if (!drafts[id]) drafts[id] = { name: '', value: '', isSecret: false, description: '' };
  return drafts[id];
}

function onUpdateName(id: string, value: string): void {
  draftFor(id).name = value;
}
function onUpdateValue(id: string, value: string): void {
  draftFor(id).value = value;
}
function onUpdateDescription(id: string, value: string): void {
  draftFor(id).description = value;
}

/** Commits whatever the draft currently holds — the trailing row only if it has a name yet. */
async function commitDraft(id: string): Promise<void> {
  const draft = draftFor(id);
  if (id === '') {
    if (draft.name.trim() === '') return; // nothing typed yet — not a row to create
    const { value, isSecret, description } = draft;
    const name = draft.name.trim();
    trailingDraft.name = '';
    trailingDraft.value = '';
    trailingDraft.isSecret = false;
    trailingDraft.description = '';
    await upsertVariable({ id: '', name, value, isSecret, description });
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
    description: draft.description,
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
  if (
    draft.name === row.name &&
    draft.value === row.value &&
    draft.isSecret === row.isSecret &&
    draft.description === row.description
  )
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
  if (id !== '') {
    // Finding 5 (round 1) / Finding 1 (round 2): always go through a real reveal call here, never
    // short-circuited by a frontend cache that might hold a stale entry from an unrelated dialog
    // (Copy as curl also writes into this same revealedValues map) or an arbitrarily old reveal
    // from earlier in this same session — the backend's own grace window (internal/localauth) is
    // the only cache this gate trusts. Branch on *this call's own* return value, not on the shared
    // map: a cancelled/unavailable/errored outcome here must not be masked by a stale success the
    // map already holds from an earlier, unrelated reveal of the same variable.
    const value = await revealVariable(id);
    if (value === undefined) return; // cancelled, unavailable, or errored — stays secret
    draft.value = value;
  }
  draft.isSecret = false;
  await commitDraft(id);
}

function onReveal(id: string): void {
  void revealVariable(id);
}

// D14: drag — ColumnsMenu.vue's own dragstart/dragover.prevent/dragend shape, splicing the local
// `order` array on every dragover and committing the full new order once, on drop.
// P16 D14: both splice `order` by the *rendered* index, which a filter can move — but the deeper
// reason reordering is refused while filtered is semantic, not just index-fragile: "move up" past
// a neighbour the filter is hiding has no defined result, and silently reordering against the
// unfiltered list would move a row the user cannot see. Refusing is the honest answer.
const dragIndex = ref<number | null>(null);

function onDragStart(index: number): void {
  if (isFiltered.value) return;
  dragIndex.value = index;
}
function onDragOver(index: number): void {
  if (isFiltered.value) return;
  const from = dragIndex.value;
  if (from === null || from === index || index >= order.value.length) return;
  const next = [...order.value];
  const [moved] = next.splice(from, 1);
  next.splice(index, 0, moved);
  order.value = next;
  dragIndex.value = index;
}
async function onDragEnd(): Promise<void> {
  if (isFiltered.value) {
    dragIndex.value = null;
    return;
  }
  dragIndex.value = null;
  await reorderVariables(order.value);
}

// D14: Alt+↑/↓ — a keyboard-reachable equivalent, since a drag-only affordance is unusable from
// the keyboard. Each keypress is its own discrete commit, not batched with a later drop.
async function onMove(id: string, direction: 'up' | 'down'): Promise<void> {
  if (isFiltered.value) return;
  const from = order.value.indexOf(id);
  const to = direction === 'up' ? from - 1 : from + 1;
  if (from === -1 || to < 0 || to >= order.value.length) return;
  const next = [...order.value];
  [next[from], next[to]] = [next[to], next[from]];
  order.value = next;
  await reorderVariables(order.value);
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
    <div class="p-dialog-body list">
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
      <PanelSearchBox
        v-model="filterQuery"
        placeholder="Filter by name"
        testid="variables-filter"
      />
      <div class="header-row">
        <span class="cell">Name</span>
        <span class="cell">Value</span>
        <span class="cell">Description</span>
      </div>
      <VariableRow
        v-for="(row, i) in displayRows"
        :key="row.id || 'trailing'"
        :row="row"
        :index="i"
        :dragging="dragIndex === i"
        :duplicate="duplicateFor(row)"
        :trailing="row.id === ''"
        :filtered="isFiltered"
        :secrets-unavailable="!!connectionsState.secretStorage && !connectionsState.secretStorage.available"
        @update:name="onUpdateName(row.id, $event)"
        @update:value="onUpdateValue(row.id, $event)"
        @update:is-secret="onUpdateSecret(row.id, $event)"
        @update:description="onUpdateDescription(row.id, $event)"
        @blur="onBlur(row.id)"
        @remove="onRemove(row.id)"
        @reveal="onReveal(row.id)"
        @dragstart="onDragStart"
        @dragover="onDragOver"
        @dragend="onDragEnd"
        @move="onMove(row.id, $event)"
      />
    </div>

    <template #footer>
      <span class="p-dialog-actions end">
        <AppButton kind="dialog" data-testid="variables-close" @click="close">Close</AppButton>
      </span>
    </template>
  </DialogFrame>
</template>

<style scoped>
.header-row {
  display: flex;
  gap: var(--kira-s-2);
  padding: var(--kira-s-2) var(--kira-s-3);
  color: var(--kira-fg-subtle);
  font-size: var(--kira-t-sm);
  border-bottom: var(--kira-border-width) solid var(--kira-border);
}

.header-row .cell {
  flex: 1;
}
</style>
