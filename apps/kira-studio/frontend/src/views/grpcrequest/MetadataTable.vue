<script setup lang="ts">
import type { GrpcMetadataState } from '@shared/domain/grpc';
import type { GrpcRequestTabRecord } from '@shared/domain/tabs';
import { computed } from 'vue';
import { patchGrpcRequestTabState } from '../../api/tabs';
import Checkbox from '../../theme/primitives/Checkbox.vue';
import IconButton from '../../theme/primitives/IconButton.vue';
import TextField from '../../theme/primitives/TextField.vue';

// F18: this package's own copy of views/httprequest/FieldRowsTable.vue's row-plus-trailing-blank
// shape — views/grpcrequest/** may not import views/httprequest/** (biome.json), and the shape is
// small enough that duplicating it costs less than the coupling reuse would have created (D5's own
// grpcMetadataSchema comment makes the identical trade).
const props = defineProps<{ tab: GrpcRequestTabRecord }>();

function blankRow(): GrpcMetadataState {
  return { name: '', value: '', enabled: true };
}

const displayRows = computed<GrpcMetadataState[]>(() => [...props.tab.state.metadata, blankRow()]);

function updateField(index: number, field: 'name' | 'value', value: string): void {
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

// P15b D6 (item 12): arrow-key navigation across this table's rows — a literal copy of
// views/httprequest/FieldRowsTable.vue's own handler (F18/OQ-4: `views/grpcrequest/**` may not
// import `views/httprequest/**`, biome.json, and this handler is small enough that duplicating it
// costs less than the coupling a shared module would create). See that file's own comment for the
// full rule set.
function textInputsIn(row: Element): HTMLInputElement[] {
  return Array.from(row.querySelectorAll<HTMLInputElement>('input:not([type="checkbox"])'));
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
  if (!(el instanceof HTMLInputElement) || el.type === 'checkbox') return;

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
  <div class="metadata-table" data-testid="grpc-metadata-table" @keydown="onContainerKeydown">
    <div
      v-for="(row, i) in displayRows"
      :key="i"
      class="metadata-row"
      data-testid="grpc-metadata-row"
    >
      <Checkbox
        :model-value="row.enabled"
        :disabled="i >= tab.state.metadata.length"
        data-testid="grpc-metadata-enabled"
        @update:model-value="toggleEnabled(i)"
      />
      <div class="metadata-cell">
        <TextField
          :model-value="row.name"
          placeholder="key (lowercase, - _ . only)"
          data-testid="grpc-metadata-name"
          @update:model-value="updateField(i, 'name', $event)"
        />
      </div>
      <div class="metadata-cell">
        <TextField
          :model-value="row.value"
          placeholder="value"
          data-testid="grpc-metadata-value"
          @update:model-value="updateField(i, 'value', $event)"
        />
      </div>
      <IconButton
        icon="close"
        :disabled="i >= tab.state.metadata.length"
        v-tooltip="'Remove'"
        data-testid="grpc-metadata-remove"
        @click="removeRow(i)"
      />
    </div>
  </div>
</template>

<style scoped>
.metadata-table {
  padding: var(--kira-s-3);
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-2);
  overflow: auto;
  height: 100%;
}

.metadata-row {
  display: flex;
  align-items: center;
  gap: var(--kira-s-2);
}

.metadata-cell {
  flex: 1;
  min-width: 0;
}
.metadata-cell :deep(.p-input) {
  width: 100%;
}
</style>
