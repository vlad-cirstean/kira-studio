<script setup lang="ts">
import type { HttpHeaderState } from '@shared/domain/http';
import type { HttpRequestTabRecord } from '@shared/domain/tabs';
import { computed } from 'vue';
import { patchHttpRequestTabState } from '../../state/tabs';
import IconButton from '../../theme/primitives/IconButton.vue';
import TextField from '../../theme/primitives/TextField.vue';

// D6: headers are the one persisted array in this tab's state (unlike query params, which are
// derived from the URL, D9) — this table edits `tab.state.headers` directly. A trailing blank row
// is always rendered for typing a new header.
const props = defineProps<{ tab: HttpRequestTabRecord }>();

const rows = computed<HttpHeaderState[]>(() => [
  ...props.tab.state.headers,
  { name: '', value: '', enabled: true },
]);

function updateField(index: number, field: 'name' | 'value', value: string): void {
  const headers = [...props.tab.state.headers];
  if (index === headers.length) headers.push({ name: '', value: '', enabled: true });
  headers[index] = { ...headers[index], [field]: value };
  patchHttpRequestTabState(props.tab.id, { headers });
}

function toggleEnabled(index: number): void {
  const headers = [...props.tab.state.headers];
  if (index >= headers.length) return;
  headers[index] = { ...headers[index], enabled: !headers[index].enabled };
  patchHttpRequestTabState(props.tab.id, { headers });
}

function removeRow(index: number): void {
  patchHttpRequestTabState(props.tab.id, {
    headers: props.tab.state.headers.filter((_, i) => i !== index),
  });
}
</script>

<template>
  <div class="headers-table" data-testid="http-headers-table">
    <div v-for="(row, i) in rows" :key="i" class="header-row" data-testid="http-header-row">
      <input
        type="checkbox"
        :checked="row.enabled"
        :disabled="i >= tab.state.headers.length"
        data-testid="http-header-enabled"
        @change="toggleEnabled(i)"
      />
      <TextField
        :model-value="row.name"
        placeholder="Header-Name"
        data-testid="http-header-name"
        @update:model-value="updateField(i, 'name', $event)"
      />
      <TextField
        :model-value="row.value"
        placeholder="value"
        data-testid="http-header-value"
        @update:model-value="updateField(i, 'value', $event)"
      />
      <IconButton
        icon="close"
        :disabled="i >= tab.state.headers.length"
        v-tooltip="'Remove'"
        data-testid="http-header-remove"
        @click="removeRow(i)"
      />
    </div>
  </div>
</template>

<style scoped>
.headers-table {
  padding: var(--kira-s-3);
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-2);
  overflow: auto;
  height: 100%;
}

.header-row {
  display: flex;
  align-items: center;
  gap: var(--kira-s-2);
}

.header-row > :nth-child(2),
.header-row > :nth-child(3) {
  flex: 1;
  min-width: 0;
}
</style>
