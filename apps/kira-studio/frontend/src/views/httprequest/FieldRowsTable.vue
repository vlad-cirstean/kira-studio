<script setup lang="ts" generic="T extends { name: string; value: string; enabled?: boolean }">
import { computed } from 'vue';
import type { VariableSupport } from '../../api/state/variableCompletion';
import AutocompleteField from '../../theme/primitives/AutocompleteField.vue';
import Checkbox from '../../theme/primitives/Checkbox.vue';
import type { Completion } from '../../theme/primitives/completion';
import { templateToken, wholeFieldToken } from '../../theme/primitives/completion';
import IconButton from '../../theme/primitives/IconButton.vue';
import TextField from '../../theme/primitives/TextField.vue';

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
    /** P16 D13: the toolbar's own filter box text, forwarded down — absent/empty shows every row.
     *  A plain case-insensitive substring test over name-or-value (both are user-authored request
     *  content, never a secret's plaintext — §5). */
    filterQuery?: string;
  }>(),
  { showEnabled: false, namePlaceholder: 'key', valuePlaceholder: 'value' },
);

const emit = defineEmits<{ 'update:rows': [rows: T[]] }>();

// P16 D13/F11: `index` is the row's position in `props.rows` — i.e. its real write-through index
// — carried alongside the row through filtering, never the position in `displayRows` (which a
// filter can move). The trailing blank row is appended last and unconditionally, at
// `index: props.rows.length`: it is the add affordance, not data, and hiding it under a filter
// would make a filtered table un-appendable.
interface DisplayEntry {
  row: T;
  index: number;
}

const displayRows = computed<DisplayEntry[]>(() => {
  const q = (props.filterQuery ?? '').trim().toLowerCase();
  const withIndex = props.rows.map((row, index) => ({ row, index }));
  const filtered = q
    ? withIndex.filter(
        ({ row }) => row.name.toLowerCase().includes(q) || row.value.toLowerCase().includes(q),
      )
    : withIndex;
  return [...filtered, { row: props.blankRow(), index: props.rows.length }];
});

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

// P15b D6 (item 12): arrow-key navigation across this table's rows, one container-level handler —
// not a shared `theme/rowKeyNav.ts`-shaped module (OQ-4): `views/grpcrequest/**` may not import
// `views/httprequest/**` (biome.json), MetadataTable.vue is `views/grpcrequest`'s own literal copy
// of this table (F18's own trade, accepted deliberately), and this handler is small enough that
// duplicating it costs less than the coupling a shared module would create.
//
// Column identity is positional among a row's *text* inputs — `input:not([type="checkbox"])`
// excludes the enabled-checkbox column (a real `<input type="checkbox">`, Checkbox.vue) from the
// count, so form-data's own extra content-type field in the trailing slot does not shift the
// mapping for rows that lack it (it simply has no target there, and navigation into it does
// nothing rather than landing on the wrong field).
function textInputsIn(row: Element): HTMLInputElement[] {
  return Array.from(row.querySelectorAll<HTMLInputElement>('input:not([type="checkbox"])'));
}

function onContainerKeydown(e: KeyboardEvent): void {
  // AutocompleteField's own popup binds ArrowUp/ArrowDown while open with preventDefault and no
  // stopPropagation (F4) — this guard is what keeps the popup's own selection move from also
  // moving focus to another row.
  if (e.defaultPrevented) return;
  if (
    e.key !== 'ArrowDown' &&
    e.key !== 'ArrowUp' &&
    e.key !== 'ArrowLeft' &&
    e.key !== 'ArrowRight'
  ) {
    return;
  }
  const el = e.target;
  // Only real text inputs participate — a <select> (form-data's kind picker) or a <button> (Choose
  // file, Remove) stays Tab-reachable and keeps its own native arrow behaviour untouched.
  if (!(el instanceof HTMLInputElement) || el.type === 'checkbox') return;

  const row = el.closest<HTMLElement>('.field-row');
  const container = row?.parentElement;
  if (!row || !container) return;
  const rows = Array.from(container.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child.classList.contains('field-row'),
  );
  const rowIndex = rows.indexOf(row);
  const inputsInRow = textInputsIn(row);
  const colIndex = inputsInRow.indexOf(el);
  if (colIndex === -1) return;

  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    // No wrap at either end — the trailing blank row is itself a normal target, so ArrowDown from
    // the last real row reaches it exactly as a click would.
    const targetRow = rows[rowIndex + (e.key === 'ArrowDown' ? 1 : -1)];
    const target = targetRow ? textInputsIn(targetRow)[colIndex] : undefined;
    if (!target) return;
    e.preventDefault();
    const offset = Math.min(el.selectionStart ?? 0, target.value.length);
    target.focus();
    target.setSelectionRange(offset, offset);
    return;
  }

  // ArrowLeft/ArrowRight: native everywhere except a field edge — a real (non-collapsed) selection
  // is left to the browser's own left/right-collapses-selection behaviour.
  const start = el.selectionStart;
  const end = el.selectionEnd;
  if (start === null || end === null || start !== end) return;
  if (e.key === 'ArrowRight' && start === el.value.length) {
    const target = inputsInRow[colIndex + 1];
    if (!target) return;
    e.preventDefault();
    target.focus();
    target.setSelectionRange(0, 0);
  } else if (e.key === 'ArrowLeft' && start === 0) {
    const target = inputsInRow[colIndex - 1];
    if (!target) return;
    e.preventDefault();
    target.focus();
    target.setSelectionRange(target.value.length, target.value.length);
  }
}
</script>

<template>
  <div class="field-rows-table" :data-testid="containerTestid" @keydown="onContainerKeydown">
    <div
      v-for="entry in displayRows"
      :key="entry.index"
      class="field-row"
      :data-testid="`${testidPrefix}-row`"
    >
      <Checkbox
        v-if="showEnabled"
        :model-value="!!entry.row.enabled"
        :disabled="entry.index >= rows.length"
        :data-testid="`${testidPrefix}-enabled`"
        @update:model-value="toggleEnabled(entry.index)"
      />
      <div class="field-cell">
        <AutocompleteField
          v-if="nameCandidates"
          :model-value="entry.row.name"
          :placeholder="namePlaceholder"
          :data-testid="`${testidPrefix}-name`"
          :candidates="nameCandidates"
          :token-at="wholeFieldToken"
          @update:model-value="updateField(entry.index, 'name', $event)"
        />
        <TextField
          v-else
          :model-value="entry.row.name"
          :placeholder="namePlaceholder"
          :data-testid="`${testidPrefix}-name`"
          @update:model-value="updateField(entry.index, 'name', $event)"
        />
      </div>
      <slot
        name="value"
        :row="entry.row"
        :index="entry.index"
        :is-trailing="entry.index >= rows.length"
        :update="(v: string) => updateField(entry.index, 'value', v)"
      >
        <div class="field-cell">
          <AutocompleteField
            v-if="valueVariableSupport"
            :model-value="entry.row.value"
            :placeholder="valuePlaceholder"
            :data-testid="`${testidPrefix}-value`"
            :candidates="valueVariableSupport.candidates"
            :token-at="templateToken"
            :range-highlights="valueVariableSupport.rangeHighlights"
            :hover-at="valueVariableSupport.hoverAt"
            @update:model-value="updateField(entry.index, 'value', $event)"
          />
          <TextField
            v-else
            :model-value="entry.row.value"
            :placeholder="valuePlaceholder"
            :data-testid="`${testidPrefix}-value`"
            @update:model-value="updateField(entry.index, 'value', $event)"
          />
        </div>
      </slot>
      <slot name="trailing" :row="entry.row" :index="entry.index" :is-trailing="entry.index >= rows.length" />
      <IconButton
        icon="close"
        :disabled="entry.index >= rows.length"
        v-tooltip="'Remove'"
        :data-testid="`${testidPrefix}-remove`"
        @click="removeRow(entry.index)"
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
  /* P16 D13: flex:1 rather than height:100% — this is no longer always its flex-column parent's
     only child (HttpRequestView.vue's own filter row, when open, is a sibling above it), and a
     percentage height would ignore that sibling's own space and overflow past it. */
  flex: 1;
  min-height: 0;
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
