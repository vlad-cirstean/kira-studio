<script setup lang="ts">
import type { IndexMeta } from '@shared/domain/tree';

defineProps<{
  indexes: IndexMeta[];
}>();
</script>

<template>
  <section class="def-section" data-testid="definition-indexes">
    <header class="def-section-head">
      <span class="def-section-title">Indexes</span>
      <span class="p-badge">{{ indexes.length }}</span>
    </header>
    <table class="def-table">
      <thead>
        <tr class="def-head-row">
          <th>Name</th>
          <th>Kind</th>
          <th>Method</th>
          <th>Columns</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="idx in indexes" :key="idx.name" class="def-row">
          <td class="def-idx-name">{{ idx.name }}</td>
          <td class="def-idx-badges">
            <span v-if="idx.primary" class="p-badge">primary</span>
            <span v-else-if="idx.unique" class="p-badge">unique</span>
          </td>
          <td class="def-idx-method mono">{{ idx.method ?? '' }}</td>
          <td class="def-idx-columns mono">({{ idx.columns.join(', ') }})</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.def-section {
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-3);
}

.def-section-head {
  display: flex;
  align-items: center;
  gap: var(--kira-s-3);
}

.def-section-title {
  font-weight: 600;
  color: var(--kira-fg);
}

.def-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--kira-t-md);
}

.def-head-row th {
  text-align: left;
  font-weight: 400;
  padding: var(--kira-s-2) var(--kira-s-3);
  background: var(--kira-bg-elevated);
  border-bottom: var(--kira-border-width) solid var(--kira-border-strong);
  border-right: var(--kira-border-width) solid var(--kira-border);
  color: var(--kira-fg-muted);
  font-size: var(--kira-t-sm);
  white-space: nowrap;
}
.def-head-row th:last-child {
  border-right: none;
}

.def-row {
  border-bottom: 1px solid var(--kira-border);
}
.def-row:hover {
  background: var(--kira-hover);
}

.def-table td {
  padding: var(--kira-s-2) var(--kira-s-3);
  vertical-align: middle;
  color: var(--kira-fg);
  border-right: var(--kira-border-width) solid var(--kira-border);
}
.def-table td:last-child {
  border-right: none;
}

.def-idx-columns {
  color: var(--kira-fg-muted);
}

.mono {
  font-family: var(--kira-font-family);
}
</style>
