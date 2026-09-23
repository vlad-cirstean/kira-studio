<script setup lang="ts">
import { WELL_KNOWN_REQUEST_METADATA } from '@kira/api-core';
import type { GrpcMetadataState } from '@shared/domain/grpc';
import type { VariableSupport } from '../../api/state/variableCompletion';
import { patchGrpcRequestTabState } from '../../api/tabs';
import type { GrpcRequestTabRecord } from '../../state/tabDomain';
import type { Completion } from '../../theme/primitives/completion';
import FieldRowsTable from '../shared/fields/FieldRowsTable.vue';

// P107 T2-18: a thin wrapper over FieldRowsTable, same D15/C6 shape RequestHeadersTable.vue uses —
// replaces this package's own former MetadataTable.vue copy (F18's trade only held while
// views/grpcrequest/** could not import views/httprequest/**; FieldRowsTable now lives in
// views/shared/fields/, which both kinds may import).
const props = defineProps<{
  tab: GrpcRequestTabRecord;
  /** P16 D13: GrpcRequestView.vue's own #toolbar-2 filter box, forwarded to FieldRowsTable. */
  filterQuery?: string;
  /** P18 D10: GrpcRequestView.vue's own variableSupport(...), forwarded to the value cell. */
  variables?: VariableSupport;
  /** P22b D6/D7: GrpcRequestView.vue's own persisted description-column toggle. */
  showDescriptions?: boolean;
}>();

function blankMetadata(): GrpcMetadataState {
  return { name: '', value: '', enabled: true, description: '' };
}

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

function onUpdateRows(metadata: GrpcMetadataState[]): void {
  patchGrpcRequestTabState(props.tab.id, { metadata });
}
</script>

<template>
  <FieldRowsTable
    :rows="tab.state.metadata"
    :blank-row="blankMetadata"
    show-enabled
    name-placeholder="key (lowercase, - _ . only)"
    value-placeholder="value"
    testid-prefix="grpc-metadata"
    container-testid="grpc-metadata-table"
    :name-candidates="WELL_KNOWN_REQUEST_METADATA"
    :value-candidates-for="metadataValueCompletions"
    :value-variable-support="variables"
    :filter-query="filterQuery"
    :show-descriptions="showDescriptions"
    @update:rows="onUpdateRows"
  />
</template>
