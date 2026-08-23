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
}

.def-idx-columns {
  color: var(--kira-fg-muted);
}

.mono {
  font-family: var(--kira-font-family);
}
</style>
