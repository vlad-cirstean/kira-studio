<script setup lang="ts">
import type { HttpVariable } from '@shared/domain/variables';
import IconButton from '../theme/primitives/IconButton.vue';
import TextField from '../theme/primitives/TextField.vue';

// P5 D11/D12: one row — a name field, a value field, a duplicate-name warning chip, and a remove
// button. The secret checkbox/eye (D9/C9) and the history/grip handles (D13/D14/C10) are added by
// later commits directly onto this component, not stubbed here ahead of the store support they
// need (AGENTS.md: scope left out of a phase/commit is left out entirely).
const props = defineProps<{
  row: HttpVariable;
  duplicate: boolean;
  /** True for the trailing blank row — its remove button is always disabled, matching
   *  FieldRowsTable.vue's own convention for the row shape this reimplements. */
  trailing?: boolean;
}>();

const emit = defineEmits<{
  'update:name': [value: string];
  'update:value': [value: string];
  blur: [];
  remove: [];
}>();

function onNameInput(v: string): void {
  emit('update:name', v);
}
function onValueInput(v: string): void {
  emit('update:value', v);
}
</script>

<template>
  <div class="variable-row" data-testid="variable-row">
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
      <TextField
        :model-value="row.value"
        placeholder="value"
        data-testid="variable-value"
        @update:model-value="onValueInput"
        @blur="emit('blur')"
      />
    </div>
    <IconButton
      icon="close"
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

.cell {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--kira-s-2);
}
</style>
