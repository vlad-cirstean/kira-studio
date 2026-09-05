<script setup lang="ts">
import type { GrpcMetadataState } from '@shared/domain/grpc';
import type { GrpcRequestTabRecord } from '@shared/domain/tabs';
import { computed } from 'vue';
import { patchGrpcRequestTabState } from '../../api/tabs';
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
</script>

<template>
  <div class="metadata-table" data-testid="grpc-metadata-table">
    <div
      v-for="(row, i) in displayRows"
      :key="i"
      class="metadata-row"
      data-testid="grpc-metadata-row"
    >
      <input
        type="checkbox"
        :checked="row.enabled"
        :disabled="i >= tab.state.metadata.length"
        data-testid="grpc-metadata-enabled"
        @change="toggleEnabled(i)"
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
</style>
