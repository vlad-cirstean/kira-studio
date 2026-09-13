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
/* Only these two aren't in the shared .def-table td rule (primitives.css) — see
   ColumnsSection.vue's own comment on why. */
.def-table td {
  border-right: var(--kira-border-width) solid var(--kira-border);
}
.def-table td:last-child {
  border-right: none;
}

.def-idx-columns {
  color: var(--kira-fg-muted);
}
</style>
