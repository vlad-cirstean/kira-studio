<script setup lang="ts">
import type { HttpUrlEncodedFieldState } from '@shared/domain/http';
import type { HttpRequestTabRecord } from '@shared/domain/tabs';
import { patchHttpRequestTabState } from '../../state/tabs';
import FieldRowsTable from './FieldRowsTable.vue';

// C7: over C6's shared table, wired to state.urlEncoded — Go already serializes this mode (C1)
// and the body caption already knows its Content-Type (C5/D7).
const props = defineProps<{ tab: HttpRequestTabRecord }>();

function blankField(): HttpUrlEncodedFieldState {
  return { name: '', value: '', enabled: true };
}

function onUpdateRows(urlEncoded: HttpUrlEncodedFieldState[]): void {
  patchHttpRequestTabState(props.tab.id, { urlEncoded });
}
</script>

<template>
  <FieldRowsTable
    :rows="tab.state.urlEncoded"
    :blank-row="blankField"
    show-enabled
    name-placeholder="key"
    value-placeholder="value"
    testid-prefix="http-urlencoded"
    container-testid="http-urlencoded-table"
    @update:rows="onUpdateRows"
  />
</template>
