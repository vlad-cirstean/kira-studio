<script setup lang="ts">
import type { HttpVariable } from '@shared/domain/variables';
import { ref, watch } from 'vue';
import IconButton from '../theme/primitives/IconButton.vue';
import TextField from '../theme/primitives/TextField.vue';

// P5 D11/D12/D9: one row — a name field, a value field (masked for a secret, until revealed), a
// secret checkbox, a duplicate-name warning chip, and a remove button. The history/grip handles
// (D13/D14) are added by a later commit directly onto this component.
const props = defineProps<{
  row: HttpVariable;
  duplicate: boolean;
  /** True for the trailing blank row — its remove button is always disabled, matching
   *  FieldRowsTable.vue's own convention for the row shape this reimplements. */
  trailing?: boolean;
  /** D10: secrets.Status().available is false — ticking "secret" is refused, with the reason
   *  shown once at the dialog level rather than repeated per row. */
  secretsUnavailable?: boolean;
}>();

const emit = defineEmits<{
  'update:name': [value: string];
  'update:value': [value: string];
  'update:isSecret': [value: boolean];
  blur: [];
  remove: [];
  /** Not yet revealed (row.value === '' && row.isSecret) — the eye IS the reveal action. */
  reveal: [];
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
function onSecretChange(e: Event): void {
  emit('update:isSecret', (e.target as HTMLInputElement).checked);
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
    <label class="secret-toggle" v-tooltip="secretsUnavailable ? 'Secret storage is unavailable' : 'Secret'">
      <input
        type="checkbox"
        :checked="row.isSecret"
        :disabled="secretsUnavailable && !row.isSecret"
        data-testid="variable-secret"
        @change="onSecretChange"
      />
    </label>
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

.masked-value {
  flex: 1;
  color: var(--kira-fg-dim);
  letter-spacing: 2px;
}

.secret-toggle {
  display: flex;
  align-items: center;
}
</style>
