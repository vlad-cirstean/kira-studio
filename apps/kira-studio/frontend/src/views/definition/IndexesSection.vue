<script setup lang="ts">
import type { IndexMeta } from '@shared/domain/tree';
import { Badge } from '@theme/components/ui/badge';

defineProps<{
  indexes: IndexMeta[];
}>();

// P110 B30: ColumnsSection.vue's own DEF_TH/DEF_TH_LAST/DEF_TD constants (see its comment) --
// folded off primitives.css's old shared header-row and body-cell rules.
const DEF_TH =
  'text-left px-1.5 py-1 bg-elevated border-b border-border-strong border-r border-border text-muted-foreground text-kira-sm whitespace-nowrap';
const DEF_TH_LAST =
  'text-left px-1.5 py-1 bg-elevated border-b border-border-strong text-muted-foreground text-kira-sm whitespace-nowrap';
const DEF_TD = 'px-1.5 py-1 align-middle text-fg';
</script>

<template>
  <section class="flex flex-col gap-1.5" data-testid="definition-indexes">
    <header class="flex items-center gap-1.5">
      <span class="text-kira-sm text-muted-foreground uppercase tracking-wider">Indexes</span>
      <Badge>{{ indexes.length }}</Badge>
    </header>
    <table class="w-full border-collapse text-kira-md definition-table">
      <thead>
        <tr>
          <th :class="DEF_TH">Name</th>
          <th :class="DEF_TH">Kind</th>
          <th :class="DEF_TH">Method</th>
          <th :class="DEF_TH_LAST">Columns</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="idx in indexes" :key="idx.name" class="border-b border-border hover:bg-hover" data-testid="definition-row">
          <td :class="DEF_TD" class="def-idx-name">{{ idx.name }}</td>
          <td :class="DEF_TD" class="def-idx-badges">
            <Badge v-if="idx.primary">primary</Badge>
            <Badge v-else-if="idx.unique">unique</Badge>
          </td>
          <td :class="DEF_TD" class="def-idx-method font-data">{{ idx.method ?? '' }}</td>
          <td :class="DEF_TD" class="text-muted-foreground font-data">({{ idx.columns.join(', ') }})</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
@reference "@theme/base.css";

/* Only these two aren't in the shared cell utility list above — see ColumnsSection.vue's own
   comment on why. */
.definition-table td {
  @apply border-r border-border;
}
.definition-table td:last-child {
  @apply border-r-0;
}
</style>
