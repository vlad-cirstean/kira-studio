<script setup lang="ts" generic="T extends { name: string; value: string; enabled?: boolean }">
import { computed } from 'vue';
import AutocompleteField from '../../theme/primitives/AutocompleteField.vue';
import Checkbox from '../../theme/primitives/Checkbox.vue';
import type { Completion } from '../../theme/primitives/completion';
import { templateToken, wholeFieldToken } from '../../theme/primitives/completion';
import IconButton from '../../theme/primitives/IconButton.vue';
import TextField from '../../theme/primitives/TextField.vue';
import type { VariableSupport } from './variableCompletion';

// P3 D15/C6: the one row table behind Params, Headers, urlencoded (C7) and form-data (C8) —
// RequestHeadersTable.vue and QueryParamsTable.vue were the same file twice minus a checkbox
// column. Each wrapper keeps its own write semantics (headers/urlencoded write their array
// directly; Params writes back through the URL, P2 D9) and supplies only `rows` (the real,
// non-trailing rows) plus a blank-row factory; this component owns the trailing-blank-row UX, the
// optional checkbox column, and the always-disabled-on-the-trailing-row remove button.
const props = withDefaults(
  defineProps<{
    rows: T[];
    /** A fresh blank row — each wrapper's own row shape (headers default `enabled: true`, params
     *  carry no `enabled` at all), so this can't be derived generically. */
    blankRow: () => T;
    /** Renders the checkbox column. Off for Params (P2 D6/§8 OQ-1: no disabled query params). */
    showEnabled?: boolean;
    namePlaceholder?: string;
    valuePlaceholder?: string;
    /** `${testidPrefix}-row` / `-name` / `-value` / `-enabled` / `-remove` — must reproduce the
     *  exact testids the pre-extraction tables used (C6's own guard). */
    testidPrefix: string;
    /** The outer container's own testid (e.g. `http-headers-table`) — kept at the wrapper's
     *  discretion since the two existing tables pluralize their prefix differently. */
    containerTestid?: string;
    /** P15b D4: when present, the default value cell renders as an AutocompleteField wired for
     *  `{{variable}}` colouring/hover/completion instead of a plain TextField — absent for any
     *  caller that has not been wired (form-data's own slot wires this itself, D4's "form-data
     *  value cells" too, since it overrides the `value` slot entirely). */
    valueVariableSupport?: VariableSupport;
    /** P15b D7 (item 7): when present, the name cell renders as an AutocompleteField over this
     *  list, using `wholeFieldToken` (F1: the default word-run tokenizer has no `-`, so typing
     *  `Content-T` would tokenize as just `T` and accepting a suggestion would produce
     *  `Content-Content-Type`). Absent for every caller but the headers table. */
    nameCandidates?: readonly Completion[];
  }>(),
  { showEnabled: false, namePlaceholder: 'key', valuePlaceholder: 'value' },
);

const emit = defineEmits<{ 'update:rows': [rows: T[]] }>();

const displayRows = computed<T[]>(() => [...props.rows, props.blankRow()]);

function updateField(index: number, field: 'name' | 'value', value: string): void {
  const next = [...props.rows];
  if (index === next.length) next.push(props.blankRow());
  next[index] = { ...next[index], [field]: value };
  emit('update:rows', next);
}

function toggleEnabled(index: number): void {
  if (index >= props.rows.length) return;
  const next = [...props.rows];
  next[index] = { ...next[index], enabled: !next[index].enabled };
  emit('update:rows', next);
}

function removeRow(index: number): void {
  emit(
    'update:rows',
    props.rows.filter((_, i) => i !== index),
  );
}
</script>

<template>
  <div class="field-rows-table" :data-testid="containerTestid">
    <div v-for="(row, i) in displayRows" :key="i" class="field-row" :data-testid="`${testidPrefix}-row`">
      <Checkbox
        v-if="showEnabled"
        :model-value="!!row.enabled"
        :disabled="i >= rows.length"
        :data-testid="`${testidPrefix}-enabled`"
        @update:model-value="toggleEnabled(i)"
      />
      <div class="field-cell">
        <AutocompleteField
          v-if="nameCandidates"
          :model-value="row.name"
          :placeholder="namePlaceholder"
          :data-testid="`${testidPrefix}-name`"
          :candidates="nameCandidates"
          :token-at="wholeFieldToken"
          @update:model-value="updateField(i, 'name', $event)"
        />
        <TextField
          v-else
          :model-value="row.name"
          :placeholder="namePlaceholder"
          :data-testid="`${testidPrefix}-name`"
          @update:model-value="updateField(i, 'name', $event)"
        />
      </div>
      <slot
        name="value"
        :row="row"
        :index="i"
        :is-trailing="i >= rows.length"
        :update="(v: string) => updateField(i, 'value', v)"
      >
        <div class="field-cell">
          <AutocompleteField
            v-if="valueVariableSupport"
            :model-value="row.value"
            :placeholder="valuePlaceholder"
            :data-testid="`${testidPrefix}-value`"
            :candidates="valueVariableSupport.candidates"
            :token-at="templateToken"
            :range-highlights="valueVariableSupport.rangeHighlights"
            :hover-at="valueVariableSupport.hoverAt"
            @update:model-value="updateField(i, 'value', $event)"
          />
          <TextField
            v-else
            :model-value="row.value"
            :placeholder="valuePlaceholder"
            :data-testid="`${testidPrefix}-value`"
            @update:model-value="updateField(i, 'value', $event)"
          />
        </div>
      </slot>
      <slot name="trailing" :row="row" :index="i" :is-trailing="i >= rows.length" />
      <IconButton
        icon="close"
        :disabled="i >= rows.length"
        v-tooltip="'Remove'"
        :data-testid="`${testidPrefix}-remove`"
        @click="removeRow(i)"
      />
    </div>
  </div>
</template>

<style scoped>
.field-rows-table {
  padding: var(--kira-s-3);
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-2);
  overflow: auto;
  height: 100%;
}

.field-row {
  display: flex;
  align-items: center;
  gap: var(--kira-s-2);
}

.field-cell {
  flex: 1;
  min-width: 0;
}
.field-cell :deep(.p-input) {
  width: 100%;
}
</style>
