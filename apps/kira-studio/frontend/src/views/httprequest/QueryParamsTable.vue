<script setup lang="ts">
import {
  buildQuery,
  parseQuery,
  type QueryPair,
  reconcileParamDescriptions,
  splitUrl,
} from '@kira/api-core';
import type { HttpRequestTabRecord } from '@shared/domain/tabs';
import { computed } from 'vue';
import type { VariableSupport } from '../../api/state/variableCompletion';
import { patchHttpRequestTabState } from '../../api/tabs';
import FieldRowsTable from './FieldRowsTable.vue';

// D9/D15/C6: a derived two-way editor over the URL, never a stored `params` array (D6) — `pairs`
// is a pure computed off `tab.state.url`, so typing in the URL field re-renders this table without
// this component ever writing back; only an edit made *here* calls onUpdateRows, which rewrites
// the URL.
const props = defineProps<{
  tab: HttpRequestTabRecord;
  /** P15b D4: HttpRequestView.vue's own variableSupport(...) — forwarded to the value cell. */
  variables?: VariableSupport;
  /** P16 D13: HttpRequestView.vue's own #toolbar-2 filter box, forwarded to FieldRowsTable. */
  filterQuery?: string;
  /** P22b D7: HttpRequestView.vue's own persisted description-column toggle, forwarded to
   *  FieldRowsTable. */
  showDescriptions?: boolean;
}>();

// P22b D7: a query param row has nowhere of its own to carry a description (F10 — there is no
// `params` array; the URL is the single source of truth for the query string, D9). `description`
// is annotation merged in from the tab's own side-car map, keyed by name — never input to
// buildQuery below, so the two can never disagree about what is actually sent.
interface ParamRow extends QueryPair {
  description: string;
}

const pairs = computed<ParamRow[]>(() =>
  parseQuery(splitUrl(props.tab.state.url).query).map((p) => ({
    ...p,
    description: props.tab.state.paramDescriptions[p.name] ?? '',
  })),
);

function blankParam(): ParamRow {
  return { name: '', value: '', description: '' };
}

function onUpdateRows(next: ParamRow[]): void {
  const { base, hash } = splitUrl(props.tab.state.url);
  const realRows = next.filter((p) => p.name !== '' || p.value !== '');
  const query = buildQuery(realRows);
  const url = base + (query ? `?${query}` : '') + (hash ? `#${hash}` : '');
  const paramDescriptions = reconcileParamDescriptions(realRows);
  patchHttpRequestTabState(props.tab.id, { url, paramDescriptions });
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
    :value-variable-support="variables"
    :filter-query="filterQuery"
    :show-descriptions="showDescriptions"
    @update:rows="onUpdateRows"
  />
</template>
