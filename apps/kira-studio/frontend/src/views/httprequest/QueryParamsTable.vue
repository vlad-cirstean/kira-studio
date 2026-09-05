<script setup lang="ts">
import { buildQuery, parseQuery, type QueryPair, splitUrl } from '@kira/api-core';
import type { HttpRequestTabRecord } from '@shared/domain/tabs';
import { computed } from 'vue';
import { patchHttpRequestTabState } from '../../http/tabs';
import FieldRowsTable from './FieldRowsTable.vue';

// D9/D15/C6: a derived two-way editor over the URL, never a stored `params` array (D6) — `pairs`
// is a pure computed off `tab.state.url`, so typing in the URL field re-renders this table without
// this component ever writing back; only an edit made *here* calls onUpdateRows, which rewrites
// the URL.
const props = defineProps<{ tab: HttpRequestTabRecord }>();

const pairs = computed<QueryPair[]>(() => parseQuery(splitUrl(props.tab.state.url).query));

function blankParam(): QueryPair {
  return { name: '', value: '' };
}

function onUpdateRows(next: QueryPair[]): void {
  const { base, hash } = splitUrl(props.tab.state.url);
  const query = buildQuery(next.filter((p) => p.name !== '' || p.value !== ''));
  const url = base + (query ? `?${query}` : '') + (hash ? `#${hash}` : '');
  patchHttpRequestTabState(props.tab.id, { url });
}
</script>

<template>
  <FieldRowsTable
    :rows="pairs"
    :blank-row="blankParam"
    name-placeholder="key"
    value-placeholder="value"
    testid-prefix="http-param"
    container-testid="http-params-table"
    @update:rows="onUpdateRows"
  />
</template>
