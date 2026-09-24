<script setup lang="ts">
import type { IndexMeta } from '@shared/domain/tree';
import { Badge } from '@theme/components/ui/badge';

defineProps<{
  indexes: IndexMeta[];
}>();
</script>

<template>
  <section class="def-section" data-testid="definition-indexes">
    <header class="def-section-head">
      <span class="def-section-title">Indexes</span>
      <Badge>{{ indexes.length }}</Badge>
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
            <Badge v-if="idx.primary">primary</Badge>
            <Badge v-else-if="idx.unique">unique</Badge>
          </td>
          <td class="def-idx-method font-data">{{ idx.method ?? '' }}</td>
          <td class="def-idx-columns font-data">({{ idx.columns.join(', ') }})</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
@reference "@theme/base.css";

/* Only these two aren't in the shared .def-table td rule (primitives.css) — see
   ColumnsSection.vue's own comment on why. */
.def-table td {
  @apply border-r border-border;
}
.def-table td:last-child {
  @apply border-r-0;
}

.def-idx-columns {
  @apply text-muted-foreground;
}
</style>
