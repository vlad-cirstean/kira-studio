<script setup lang="ts">
import { WELL_KNOWN_REQUEST_METADATA } from '@kira/api-core';
import type { GrpcMetadataState } from '@shared/domain/grpc';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Checkbox } from '@theme/components/ui/checkbox';
import { InputGroup, InputGroupTextarea } from '@theme/components/ui/input-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { computed, nextTick, ref, watch } from 'vue';
import type { VariableSupport } from '../../api/state/variableCompletion';
import { patchGrpcRequestTabState } from '../../api/tabs';
import type { GrpcRequestTabRecord } from '../../state/tabDomain';
import { type Completion, templateToken, wholeFieldToken } from '../../theme/primitives/completion';
import AutocompleteField from '../shared/AutocompleteField.vue';

// P22b D2: this table's own value vocabulary — genuinely different from
// packages/api-core/src/http/headers.ts's headerValueCompletions (gRPC metadata keys are
// lowercase by wire rule), covering the two metadata keys with a real value vocabulary.
function metadataValueCompletions(name: string): readonly Completion[] {
  switch (name.trim().toLowerCase()) {
    case 'authorization':
      return [
        { label: 'Bearer ', insert: 'Bearer ', icon: 'symbol-value' },
        { label: 'Basic ', insert: 'Basic ', icon: 'symbol-value' },
        { label: 'Digest ', insert: 'Digest ', icon: 'symbol-value' },
        { label: 'Token ', insert: 'Token ', icon: 'symbol-value' },
        { label: 'ApiKey ', insert: 'ApiKey ', icon: 'symbol-value' },
      ];
    case 'grpc-accept-encoding':
      return [
        { label: 'identity', icon: 'symbol-value' },
        { label: 'gzip', icon: 'symbol-value' },
      ];
    default:
      return [];
  }
}

// F18: this package's own copy of views/httprequest/FieldRowsTable.vue's row-plus-trailing-blank
// shape — views/grpcrequest/** may not import views/httprequest/** (biome.json), and the shape is
// small enough that duplicating it costs less than the coupling reuse would have created (D5's own
// grpcMetadataSchema comment makes the identical trade).
const props = defineProps<{
  tab: GrpcRequestTabRecord;
  /** P16 D13: GrpcRequestView.vue's own #toolbar-2 filter box — a plain case-insensitive
   *  substring test over name-or-value, same rule FieldRowsTable.vue's own copy follows. */
  filterQuery?: string;
  /** P18 D10: GrpcRequestView.vue's own variableSupport(...) — forwarded to the value cell, the
   *  highest-value one of the three surfaces (an Authorization bearer is the canonical case). */
  variables?: VariableSupport;
  /** P22b D6/D7: FieldRowsTable.vue's own showDescriptions prop, mirrored here — off by default. */
  showDescriptions?: boolean;
}>();

// P22b D2: the same composition FieldRowsTable.vue's own rowValueCandidates does — a bare
// position offers this row's own vocabulary plus the {{variable}} list, a caret inside an
// unclosed {{…}} offers the variable list alone. See that file's own comment for why `from > 0`
// is an exact test for "inside a reference".
function headerValueToken(
  text: string,
  caret: number,
): { from: number; to: number; word: string } | null {
  return templateToken(text, caret) ?? wholeFieldToken(text, caret);
}

function rowValueCandidates(row: GrpcMetadataState) {
  return (ctx: { text: string; from: number; word: string }): readonly Completion[] => {
    const variableCandidates = props.variables?.candidates(ctx) ?? [];
    if (ctx.from > 0) return variableCandidates;
    return [...metadataValueCompletions(row.name), ...variableCandidates];
  };
}

function blankRow(): GrpcMetadataState {
  return { name: '', value: '', enabled: true, description: '' };
}

// P16 D13/F11: `index` is the row's real position in `tab.state.metadata` — its write-through
// index — carried alongside the row through filtering (F18: this file's own copy of
// FieldRowsTable.vue's identical fix, for the identical reason). The trailing blank row is
// appended last and unconditionally: it is the add affordance, not data.
interface DisplayEntry {
  row: GrpcMetadataState;
  index: number;
}

const displayRows = computed<DisplayEntry[]>(() => {
  const q = (props.filterQuery ?? '').trim().toLowerCase();
  const withIndex = props.tab.state.metadata.map((row, index) => ({ row, index }));
  const filtered = q
    ? withIndex.filter(
        ({ row }) => row.name.toLowerCase().includes(q) || row.value.toLowerCase().includes(q),
      )
    : withIndex;
  return [...filtered, { row: blankRow(), index: props.tab.state.metadata.length }];
});

function updateField(index: number, field: 'name' | 'value' | 'description', value: string): void {
  const next = [...props.tab.state.metadata];
  if (index === next.length) next.push(blankRow());
  next[index] = { ...next[index], [field]: value };
  patchGrpcRequestTabState(props.tab.id, { metadata: next });
}

function toggleEnabled(index: number): void {
  if (index >= props.tab.state.metadata.length) return;
  const next = [...props.tab.state.metadata];
  next[index] = { ...next[index], enabled: !next[index].enabled };
  patchGrpcRequestTabState(props.tab.id, { metadata: next });
}

function removeRow(index: number): void {
  patchGrpcRequestTabState(props.tab.id, {
    metadata: props.tab.state.metadata.filter((_, i) => i !== index),
  });
}

// P22b D16: FieldRowsTable.vue's own copy of this exact watcher (F18's own trade — see this
// file's header comment) — the trailing blank row is the add affordance, so the row a user needs
// next is the one appearing BELOW the one they just filled in.
const containerRef = ref<HTMLElement | null>(null);
watch(
  () => props.tab.state.metadata.length,
  (next, prev) => {
    if (next <= prev) return;
    void nextTick(() => {
      containerRef.value
        ?.querySelector('.metadata-row:last-child')
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  },
);

// P15b D6 (item 12): arrow-key navigation across this table's rows — a literal copy of
// views/httprequest/FieldRowsTable.vue's own handler (F18/OQ-4: `views/grpcrequest/**` may not
// import `views/httprequest/**`, biome.json, and this handler is small enough that duplicating it
// costs less than the coupling a shared module would create). See that file's own comment for the
// full rule set.
// P71 §8.3: `, textarea` covers a `grow` cell's own `<textarea>` — FieldRowsTable.vue's own
// identical comment applies verbatim.
function textInputsIn(row: Element): (HTMLInputElement | HTMLTextAreaElement)[] {
  return Array.from(
    row.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'input:not([type="checkbox"]), textarea',
    ),
  );
}

function onContainerKeydown(e: KeyboardEvent): void {
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
  if (
    !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) ||
    el.type === 'checkbox'
  )
    return;

  const row = el.closest<HTMLElement>('.metadata-row');
  const container = row?.parentElement;
  if (!row || !container) return;
  const rows = Array.from(container.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child.classList.contains('metadata-row'),
  );
  const rowIndex = rows.indexOf(row);
  const inputsInRow = textInputsIn(row);
  const colIndex = inputsInRow.indexOf(el);
  if (colIndex === -1) return;

  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const targetRow = rows[rowIndex + (e.key === 'ArrowDown' ? 1 : -1)];
    const target = targetRow ? textInputsIn(targetRow)[colIndex] : undefined;
    if (!target) return;
    e.preventDefault();
    const offset = Math.min(el.selectionStart ?? 0, target.value.length);
    target.focus();
    target.setSelectionRange(offset, offset);
    return;
  }

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
  <div
    ref="containerRef"
    class="metadata-table"
    data-testid="grpc-metadata-table"
    @keydown="onContainerKeydown"
  >
    <div
      v-for="entry in displayRows"
      :key="entry.index"
      class="metadata-row"
      :style="{ gridTemplateColumns: showDescriptions ? 'auto 1.2fr 2fr 1.5fr auto' : 'auto 1.2fr 2fr auto' }"
      data-testid="grpc-metadata-row"
    >
      <Checkbox
        :model-value="entry.row.enabled"
        :disabled="entry.index >= tab.state.metadata.length"
        data-testid="grpc-metadata-enabled"
        @update:model-value="toggleEnabled(entry.index)"
      >
        <CodiconIcon name="check" :size="10" />
      </Checkbox>
      <div class="metadata-cell">
        <AutocompleteField
          grow
          :model-value="entry.row.name"
          placeholder="key (lowercase, - _ . only)"
          data-testid="grpc-metadata-name"
          :candidates="WELL_KNOWN_REQUEST_METADATA"
          :token-at="wholeFieldToken"
          @update:model-value="updateField(entry.index, 'name', $event)"
        />
      </div>
      <div class="metadata-cell">
        <AutocompleteField
          v-if="variables"
          grow
          :model-value="entry.row.value"
          placeholder="value"
          data-testid="grpc-metadata-value"
          :candidates="rowValueCandidates(entry.row)"
          :token-at="headerValueToken"
          :range-highlights="variables.rangeHighlights"
          :hover-at="variables.hoverAt"
          @update:model-value="updateField(entry.index, 'value', $event)"
        />
        <InputGroup v-else>
          <InputGroupTextarea
            rows="1"
            :model-value="entry.row.value"
            placeholder="value"
            data-testid="grpc-metadata-value"
            @update:model-value="updateField(entry.index, 'value', String($event))"
          />
        </InputGroup>
      </div>
      <!-- P22b D6: FieldRowsTable.vue's own description cell, mirrored here (F18). -->
      <div v-if="showDescriptions" class="metadata-cell">
        <InputGroup>
          <InputGroupTextarea
            rows="1"
            :model-value="entry.row.description ?? ''"
            placeholder="description"
            data-testid="grpc-metadata-description"
            @update:model-value="updateField(entry.index, 'description', String($event))"
          />
        </InputGroup>
      </div>
      <Tooltip>
        <TooltipTrigger as-child>
          <span tabindex="0" class="inline-flex" :aria-describedby="undefined">
            <Button
              variant="toolbar"
              size="kira-icon"
              :disabled="entry.index >= tab.state.metadata.length"
              aria-label="Remove"
              data-testid="grpc-metadata-remove"
              @click="removeRow(entry.index)"
            >
              <CodiconIcon name="close" :size="13" />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>Remove</TooltipContent>
      </Tooltip>
    </div>
  </div>
</template>

<style scoped>
@reference "@theme/base.css";

.metadata-table {
  /* P16 D13: flex:1 rather than height:100% — GrpcRequestView.vue's own filter row, when open, is
     a sibling above this in the same flex-column parent. */
  @apply flex flex-1 min-h-0 flex-col gap-1 overflow-auto p-1.5;
}

/* P22b D9 (FieldRowsTable.vue's own sibling — F18's literal copy): a grid, not independent flex
   items, so name/value cells line up across rows regardless of what an individual row renders.
   grid-template-columns itself is set inline (above) since it depends on showDescriptions, which
   — like showEnabled in FieldRowsTable.vue — is fixed per table instance, never per row. */
.metadata-row {
  @apply grid items-center gap-1;
}

.metadata-cell {
  @apply min-w-0;
}
.metadata-cell :deep(.p-input) {
  @apply w-full;
}
</style>
