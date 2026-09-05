<script setup lang="ts">
import { WELL_KNOWN_REQUEST_HEADERS } from '@kira/api-core';
import type { HttpHeaderState } from '@shared/domain/http';
import type { HttpRequestTabRecord } from '@shared/domain/tabs';
import { patchHttpRequestTabState } from '../../api/tabs';
import FieldRowsTable from './FieldRowsTable.vue';
import type { VariableSupport } from './variableCompletion';

// D15/C6: a thin wrapper over FieldRowsTable — headers write `tab.state.headers` directly (D6:
// the one persisted array with real write-through, unlike Params which is derived from the URL).
const props = defineProps<{
  tab: HttpRequestTabRecord;
  /** P15b D4: HttpRequestView.vue's own variableSupport(...) — forwarded to the value cell. */
  variables?: VariableSupport;
}>();

function blankHeader(): HttpHeaderState {
  return { name: '', value: '', enabled: true };
}

function onUpdateRows(headers: HttpHeaderState[]): void {
  patchHttpRequestTabState(props.tab.id, { headers });
}
</script>

<template>
  <FieldRowsTable
    :rows="tab.state.headers"
    :blank-row="blankHeader"
    show-enabled
    name-placeholder="Header-Name"
    value-placeholder="value"
    testid-prefix="http-header"
    container-testid="http-headers-table"
    :name-candidates="WELL_KNOWN_REQUEST_HEADERS"
    :value-variable-support="variables"
    @update:rows="onUpdateRows"
  />
</template>
