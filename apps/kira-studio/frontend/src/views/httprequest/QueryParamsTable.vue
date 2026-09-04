<script setup lang="ts">
import type { HttpRequestTabRecord } from '@shared/domain/tabs';
import { computed } from 'vue';
import { patchHttpRequestTabState } from '../../state/tabs';
import IconButton from '../../theme/primitives/IconButton.vue';
import TextField from '../../theme/primitives/TextField.vue';
import { buildQuery, parseQuery, type QueryPair, splitUrl } from './url';

// D9: a derived two-way editor over the URL, never a stored `params` array (D6) — `pairs` is a
// pure computed off `tab.state.url`, so typing in the URL field re-renders this table without
// this component ever writing back; only an edit made *here* calls writeBack, which rewrites the
// URL. A trailing blank row is always rendered for typing a new param.
const props = defineProps<{ tab: HttpRequestTabRecord }>();

const pairs = computed<QueryPair[]>(() => parseQuery(splitUrl(props.tab.state.url).query));
const rows = computed<QueryPair[]>(() => [...pairs.value, { name: '', value: '' }]);

function writeBack(next: QueryPair[]): void {
  const { base, hash } = splitUrl(props.tab.state.url);
  // Drop a wholly-empty row (the trailing blank one, unless the user actually typed into it) —
  // otherwise every edit would grow the query string by one bare '&'.
  const query = buildQuery(next.filter((p) => p.name !== '' || p.value !== ''));
  const url = base + (query ? `?${query}` : '') + (hash ? `#${hash}` : '');
  patchHttpRequestTabState(props.tab.id, { url });
}

function updateField(index: number, field: 'name' | 'value', value: string): void {
  const next = [...pairs.value];
  if (index === next.length) next.push({ name: '', value: '' });
  next[index] = { ...next[index], [field]: value };
  writeBack(next);
}

function removeRow(index: number): void {
  writeBack(pairs.value.filter((_, i) => i !== index));
}
</script>

<template>
  <div class="params-table" data-testid="http-params-table">
    <div v-for="(row, i) in rows" :key="i" class="param-row" data-testid="http-param-row">
      <TextField
        :model-value="row.name"
        placeholder="key"
        data-testid="http-param-name"
        @update:model-value="updateField(i, 'name', $event)"
      />
      <TextField
        :model-value="row.value"
        placeholder="value"
        data-testid="http-param-value"
        @update:model-value="updateField(i, 'value', $event)"
      />
      <IconButton
        icon="close"
        :disabled="i >= pairs.length"
        v-tooltip="'Remove'"
        data-testid="http-param-remove"
        @click="removeRow(i)"
      />
    </div>
  </div>
</template>

<style scoped>
.params-table {
  padding: var(--kira-s-3);
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-2);
  overflow: auto;
  height: 100%;
}

.param-row {
  display: flex;
  align-items: center;
  gap: var(--kira-s-2);
}

.param-row > :first-child,
.param-row > :nth-child(2) {
  flex: 1;
  min-width: 0;
}
</style>
