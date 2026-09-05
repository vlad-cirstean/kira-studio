<script setup lang="ts">
import type { ApiVariable } from '@shared/domain/variables';
import { ref, watch } from 'vue';
import CodiconIcon from '../theme/CodiconIcon.vue';
import Checkbox from '../theme/primitives/Checkbox.vue';
import IconButton from '../theme/primitives/IconButton.vue';
import TextField from '../theme/primitives/TextField.vue';
import { historyMenuState } from './state/variables';
import VariableHistoryMenu from './VariableHistoryMenu.vue';

// P5 D11/D12/D9/D13/D14: one row — a grip handle, a name field, a value field (masked for a
// secret, until revealed), a secret checkbox, a history button/popover, a duplicate-name warning
// chip, and a remove button.
const props = defineProps<{
  row: ApiVariable;
  duplicate: boolean;
  /** True for the trailing blank row — its remove/history/reorder controls are all disabled,
   *  matching FieldRowsTable.vue's own convention for the row shape this reimplements. */
  trailing?: boolean;
  /** D10: secrets.Status().available is false — ticking "secret" is refused, with the reason
   *  shown once at the dialog level rather than repeated per row. */
  secretsUnavailable?: boolean;
  /** D14: this row's position in the drag-reorderable list, and whether it is the one currently
   *  being dragged — both owned by the parent, since only it knows the full order. */
  index: number;
  dragging?: boolean;
  /** P16 D14: true while the dialog's own filter is non-empty — reordering is refused ("move up"
   *  past a filter-hidden neighbour has no defined result), and the drag handle says why. */
  filtered?: boolean;
}>();

const emit = defineEmits<{
  'update:name': [value: string];
  'update:value': [value: string];
  'update:isSecret': [value: boolean];
  'update:description': [value: string];
  blur: [];
  remove: [];
  /** Not yet revealed (row.value === '' && row.isSecret) — the eye IS the reveal action. */
  reveal: [];
  dragstart: [index: number];
  dragover: [index: number];
  dragend: [];
  move: [direction: 'up' | 'down'];
  /** R10: the parent knows the tab/scope/owner this row's history popover needs to open against
   *  (state/variables.ts's openHistoryMenu now takes them explicitly) — this row only says
   *  "the history button for this id was clicked". */
  history: [];
}>();

// D9/§1.4: "not yet revealed, the eye is the reveal action; once revealed, it's a free
// client-side mask toggle — no second round trip, no second prompt." A secret's `row.value` is ''
// until VariablesDialog.vue writes the revealed plaintext into this row's own draft (D5's
// projection guarantee: List/Upsert never hand this component a secret's real value any other
// way) — the transition from '' to non-empty, while still isSecret, is exactly "just revealed",
// which is when the value should first render unmasked rather than start hidden again.
const visible = ref(false);
watch(
  () => props.row.value,
  (value, previous) => {
    if (props.row.isSecret && previous === '' && value !== '') visible.value = true;
  },
);

const notYetRevealed = () => props.row.isSecret && props.row.value === '';

function onEyeClick(): void {
  if (notYetRevealed()) {
    emit('reveal');
  } else {
    visible.value = !visible.value;
  }
}

function onNameInput(v: string): void {
  emit('update:name', v);
}
function onValueInput(v: string): void {
  emit('update:value', v);
}
function onSecretChange(checked: boolean): void {
  emit('update:isSecret', checked);
}
function onDescriptionInput(v: string): void {
  emit('update:description', v);
}

const showHistory = ref(false);
function onHistoryClick(): void {
  showHistory.value = true;
  emit('history');
}
function onHistoryClose(): void {
  showHistory.value = false;
}

// D14: Alt+↑/↓ moves the focused row — a drag-only affordance is unusable from the keyboard, and
// every other control in this dialog is reachable by Tab.
function onKeydown(e: KeyboardEvent): void {
  if (props.trailing || props.filtered || !e.altKey) return;
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    emit('move', 'up');
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    emit('move', 'down');
  }
}
</script>

<template>
  <div
    class="variable-row"
    :class="{ 'is-dragging': dragging }"
    data-testid="variable-row"
    :data-id="row.id"
    :draggable="!trailing && !filtered"
    @keydown="onKeydown"
    @dragstart="emit('dragstart', index)"
    @dragover.prevent="emit('dragover', index)"
    @dragend="emit('dragend')"
  >
    <span
      class="drag-handle"
      :class="{ 'is-disabled': trailing }"
      aria-hidden="true"
      data-testid="variable-grip"
      v-tooltip="filtered && !trailing ? 'Clear the filter to reorder' : undefined"
    >
      <CodiconIcon name="gripper" :size="13" />
    </span>
    <div class="cell name-cell">
      <TextField
        :model-value="row.name"
        placeholder="name"
        data-testid="variable-name"
        @update:model-value="onNameInput"
        @blur="emit('blur')"
      />
      <span v-if="duplicate" class="p-chip warn" data-testid="variable-duplicate">duplicate</span>
    </div>
    <div class="cell value-cell">
      <span v-if="notYetRevealed()" class="masked-value" data-testid="variable-value-masked">••••••••</span>
      <TextField
        v-else
        :type="row.isSecret && !visible ? 'password' : 'text'"
        :model-value="row.value"
        placeholder="value"
        data-testid="variable-value"
        @update:model-value="onValueInput"
        @blur="emit('blur')"
      />
      <IconButton
        v-if="row.isSecret"
        icon="eye"
        :active="visible"
        v-tooltip="notYetRevealed() ? 'Reveal' : 'Toggle visibility'"
        data-testid="variable-reveal"
        @click="onEyeClick"
      />
    </div>
    <div class="cell description-cell">
      <TextField
        :model-value="row.description"
        placeholder="description"
        data-testid="variable-description"
        @update:model-value="onDescriptionInput"
        @blur="emit('blur')"
      />
    </div>
    <label class="secret-toggle" v-tooltip="secretsUnavailable ? 'Secret storage is unavailable' : 'Secret'">
      <Checkbox
        :model-value="row.isSecret"
        :disabled="secretsUnavailable && !row.isSecret"
        data-testid="variable-secret"
        @update:model-value="onSecretChange"
      />
    </label>
    <div class="history-anchor">
      <IconButton
        icon="history"
        :disabled="trailing"
        v-tooltip="'History'"
        data-testid="variable-history"
        @click="onHistoryClick"
      />
      <VariableHistoryMenu
        v-if="showHistory && historyMenuState.variableId === row.id"
        @close="onHistoryClose"
      />
    </div>
    <IconButton
      icon="trash"
      :disabled="props.trailing"
      v-tooltip="'Remove'"
      data-testid="variable-remove"
      @click="emit('remove')"
    />
  </div>
</template>

<style scoped>
.variable-row {
  display: flex;
  align-items: center;
  gap: var(--kira-s-2);
  padding: var(--kira-s-2) var(--kira-s-3);
}

.variable-row.is-dragging {
  opacity: 0.5;
}

.drag-handle {
  display: flex;
  align-items: center;
  cursor: grab;
  color: var(--kira-fg-subtle);
}

.drag-handle.is-disabled {
  visibility: hidden;
}

.cell {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--kira-s-2);
}

.masked-value {
  flex: 1;
  color: var(--kira-fg-subtle);
  letter-spacing: 2px;
}

.secret-toggle {
  display: flex;
  align-items: center;
}

.history-anchor {
  position: relative;
  display: flex;
}
</style>
